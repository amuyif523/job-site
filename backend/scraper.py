"""
scraper.py — JobTeaser scraper using Playwright
"""

import asyncio
import json
from collections.abc import Callable
from threading import Lock
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from playwright.async_api import async_playwright
from datetime import datetime, timezone
from pydantic import BaseModel
from sqlmodel import Session, select
from kombu.exceptions import OperationalError

from database import engine
from dependencies import get_current_user
from models import Job, UserPublic
from services.job_enrichment import classify_description_quality, normalize_job_description, normalize_listing_summary
from services.job_intelligence import analyze_job_listing
from worker import celery_app

router = APIRouter()
SCRAPE_SOURCE = "JobTeaser"
TERMINAL_SCRAPE_STATUSES = {"SUCCESS", "FAILURE", "REVOKED"}
ACTIVE_SCRAPE_TASKS: dict[int, str] = {}
ACTIVE_SCRAPE_TASKS_LOCK = Lock()


class ScrapeProgress(BaseModel):
    phase: str
    page: int = 0
    jobs_found: int = 0
    jobs_saved: int = 0
    target_role: str = ""
    source: str = SCRAPE_SOURCE


class ScrapeTaskResult(BaseModel):
    saved: int = 0
    user_id: int
    source: str = SCRAPE_SOURCE
    target_role: str = ""
    jobs_found: int = 0
    jobs_saved: int = 0
    jobs_filtered_out: int = 0
    filters_applied: list[str] = []
    sample_filtered_reasons: list[str] = []
    progress: ScrapeProgress


class ScrapeTaskStatusResponse(BaseModel):
    task_id: str
    status: str
    progress: ScrapeProgress
    result: ScrapeTaskResult | None = None
    error: str | None = None


class TaskAcceptedResponse(BaseModel):
    task_id: str
    status: str
    message: str


def _build_progress(
    *,
    phase: str,
    page: int = 0,
    jobs_found: int = 0,
    jobs_saved: int = 0,
    target_role: str = "",
) -> dict[str, Any]:
    return ScrapeProgress(
        phase=phase,
        page=max(page, 0),
        jobs_found=max(jobs_found, 0),
        jobs_saved=max(jobs_saved, 0),
        target_role=target_role,
        source=SCRAPE_SOURCE,
    ).model_dump()


def _normalize_scrape_status(raw_status: str) -> str:
    if raw_status == "SUCCESS":
        return "success"
    if raw_status == "FAILURE":
        return "failure"
    if raw_status == "RETRY":
        return "retrying"
    if raw_status in {"STARTED", "PROGRESS"}:
        return "running"
    return "queued"


def _coerce_progress(data: dict[str, Any] | None, *, target_role: str) -> ScrapeProgress:
    payload = data or {}
    return ScrapeProgress(
        phase=str(payload.get("phase", "queued")),
        page=int(payload.get("page", 0) or 0),
        jobs_found=int(payload.get("jobs_found", 0) or 0),
        jobs_saved=int(payload.get("jobs_saved", 0) or 0),
        target_role=str(payload.get("target_role", target_role) or target_role),
        source=str(payload.get("source", SCRAPE_SOURCE) or SCRAPE_SOURCE),
    )


def _get_active_scrape_task_id(user_id: int) -> str | None:
    with ACTIVE_SCRAPE_TASKS_LOCK:
        return ACTIVE_SCRAPE_TASKS.get(user_id)


def _set_active_scrape_task(user_id: int, task_id: str) -> None:
    with ACTIVE_SCRAPE_TASKS_LOCK:
        ACTIVE_SCRAPE_TASKS[user_id] = task_id


def _clear_active_scrape_task(user_id: int, task_id: str | None = None) -> None:
    with ACTIVE_SCRAPE_TASKS_LOCK:
        current_task_id = ACTIVE_SCRAPE_TASKS.get(user_id)
        if current_task_id is None:
            return
        if task_id is not None and current_task_id != task_id:
            return
        ACTIVE_SCRAPE_TASKS.pop(user_id, None)


def _get_conflicting_scrape_task(user_id: int) -> str | None:
    active_task_id = _get_active_scrape_task_id(user_id)
    if not active_task_id:
        return None

    result = celery_app.AsyncResult(active_task_id)
    if result.status in TERMINAL_SCRAPE_STATUSES:
        _clear_active_scrape_task(user_id, active_task_id)
        return None

    return active_task_id

# ── Scraper core ──────────────────────────────────────────────────────────────

async def scrape_jobteaser(
    user_id: int,
    target_role: str = "",
    max_jobs: int = 300,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
):
    """Scrape JobTeaser and save jobs to DB for a specific user."""

    def report_progress(*, phase: str, page: int = 0, jobs_found: int = 0, jobs_saved: int = 0) -> None:
        if progress_callback is None:
            return
        progress_callback(
            _build_progress(
                phase=phase,
                page=page,
                jobs_found=jobs_found,
                jobs_saved=jobs_saved,
                target_role=target_role,
            )
        )

    base_url = (
        "https://www.jobteaser.com/en/job-offers"
        "?contract=cdi&locale=de&locale=en&sort=recency"
        "&study_levels=3&study_levels=4"
        "&work_experience_code=young_graduate"
        "&work_experience_code=three_to_five_years"
    )

    if target_role:
        from urllib.parse import quote
        base_url += f"&q={quote(target_role)}"

    all_jobs = []
    filtered_out = 0
    filtered_reasons: list[str] = []
    page_num = 1
    report_progress(phase="launching_browser", page=0, jobs_found=0, jobs_saved=0)

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"]
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="en-US",
        )
        page = await context.new_page()

        # Hide webdriver fingerprint
        await page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

        while len(all_jobs) < max_jobs:
            url = f"{base_url}&page={page_num}"
            print(f"  Scraping page {page_num} — {len(all_jobs)} jobs so far...")
            report_progress(phase="loading_page", page=page_num, jobs_found=len(all_jobs), jobs_saved=0)

            await page.goto(url, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(3000)

            cards = await page.query_selector_all("div.JobAdCard_main__1mTeA")
            report_progress(phase="extracting_jobs", page=page_num, jobs_found=len(all_jobs), jobs_saved=0)

            if not cards:
                print(f"  No cards on page {page_num}, stopping.")
                break

            for card in cards:
                try:
                    title_el    = await card.query_selector("h3.JobAdCard_title__l2BSO")
                    company_el  = await card.query_selector("p.JobAdCard_companyName__7vp_H")
                    contract_el = await card.query_selector("div.JobAdCard_contractInfo__8S_AD")
                    link_el     = await card.query_selector("a.JobAdCard_link__LMtBN")

                    title    = await title_el.inner_text()    if title_el    else ""
                    company  = await company_el.inner_text()  if company_el  else ""
                    contract = await contract_el.inner_text() if contract_el else ""
                    href     = await link_el.get_attribute("href") if link_el else ""

                    job_url = f"https://www.jobteaser.com{href}" if href else ""

                    # Parse location from contract info (usually "City · Contract type")
                    parts    = contract.split("·")
                    location = parts[0].strip() if parts else ""
                    listing_summary = normalize_listing_summary(await card.inner_text())
                    description_quality = classify_description_quality("")

                    intent = analyze_job_listing(
                        title=title.strip(),
                        company=company.strip(),
                        location=location,
                        target_role=target_role,
                    )

                    if not intent.should_save:
                        filtered_out += 1
                        if len(filtered_reasons) < 5:
                            filtered_reasons.append(f"{title.strip()}: {intent.reason}")
                        continue

                    all_jobs.append({
                        "title":    title.strip(),
                        "company":  company.strip(),
                        "location": location,
                        "url":      job_url,
                        "listing_summary": listing_summary,
                        "description_quality": description_quality,
                        "intent_status": intent.status,
                        "intent_reason": intent.reason,
                        "matched_keywords": intent.matched_keywords,
                        "blocked_keywords": intent.blocked_keywords,
                        "inferred_seniority": intent.inferred_seniority,
                        "source_confidence": intent.source_confidence,
                    })
                    report_progress(
                        phase="extracting_jobs",
                        page=page_num,
                        jobs_found=len(all_jobs),
                        jobs_saved=0,
                    )

                except Exception as e:
                    print(f"  Error parsing card: {e}")
                    continue

            page_num += 1
            await page.wait_for_timeout(2000)

        await browser.close()

    # ── Save to DB ────────────────────────────────────────────────────────────
    now  = datetime.now(timezone.utc).isoformat()
    saved = 0
    report_progress(phase="saving_jobs", page=max(page_num - 1, 0), jobs_found=len(all_jobs), jobs_saved=saved)

    with Session(engine) as session:
        for job in all_jobs[:max_jobs]:
            exists = session.exec(
                select(Job.id).where(Job.user_id == user_id, Job.url == job["url"])
            ).first()

            if not exists and job["title"]:
                session.add(
                    Job(
                        user_id=user_id,
                        title=job["title"],
                        company=job["company"],
                        location=job["location"],
                        url=job["url"],
                        listing_summary=job["listing_summary"],
                        description=normalize_job_description(""),
                        description_quality=job["description_quality"],
                        intent_status=job["intent_status"],
                        intent_reason=job["intent_reason"],
                        matched_keywords=json.dumps(job["matched_keywords"]),
                        blocked_keywords=json.dumps(job["blocked_keywords"]),
                        inferred_seniority=job["inferred_seniority"],
                        source_confidence=job["source_confidence"],
                        enrichment_status="pending",
                        enrichment_error="",
                        enrichment_method="",
                        enrichment_duration_ms=0,
                        enrichment_retryable=False,
                        scoring_ready=False,
                        status="new",
                        date_scraped=datetime.fromisoformat(now),
                    )
                )
                saved += 1
                report_progress(
                    phase="saving_jobs",
                    page=max(page_num - 1, 0),
                    jobs_found=len(all_jobs),
                    jobs_saved=saved,
                )

        session.commit()
    print(f"  ✅ Saved {saved} new jobs for user {user_id}")
    progress = _build_progress(
        phase="completed",
        page=max(page_num - 1, 0),
        jobs_found=len(all_jobs),
        jobs_saved=saved,
        target_role=target_role,
    )
    report_progress(
        phase="completed",
        page=max(page_num - 1, 0),
        jobs_found=len(all_jobs),
        jobs_saved=saved,
    )
    return {
        "saved": saved,
        "user_id": user_id,
        "source": SCRAPE_SOURCE,
        "target_role": target_role,
        "jobs_found": len(all_jobs),
        "jobs_saved": saved,
        "jobs_filtered_out": filtered_out,
        "filters_applied": [
            "Target role keyword matching",
            "Off-role keyword blocking",
            "Title-based seniority inference",
        ],
        "sample_filtered_reasons": filtered_reasons,
        "progress": progress,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@celery_app.task(
    bind=True,
    name="tasks.run_scraper",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    max_retries=5,
)
def run_scraper_task(self, user_id: int, target_role: str = "", max_jobs: int = 300) -> dict:
    def progress_callback(progress: dict[str, Any]) -> None:
        self.update_state(state="PROGRESS", meta=progress)

    try:
        return asyncio.run(
            scrape_jobteaser(
                user_id=user_id,
                target_role=target_role,
                max_jobs=max_jobs,
                progress_callback=progress_callback,
            )
        )
    except Exception as exc:
        raise

@router.post("/api/scrape", response_model=TaskAcceptedResponse, status_code=202)
def trigger_scrape(
    current_user: UserPublic = Depends(get_current_user),
):
    try:
        conflicting_task_id = _get_conflicting_scrape_task(current_user.id)
    except (OperationalError, ConnectionError, OSError) as exc:
        raise HTTPException(
            status_code=503,
            detail="The scraper status service is unavailable. Check Redis and the Celery worker, then try again.",
        ) from exc

    if conflicting_task_id:
        raise HTTPException(
            status_code=409,
            detail=(
                "A JobTeaser scrape is already running for this account. "
                "Wait for it to finish before starting another."
            ),
        )

    try:
        task = run_scraper_task.delay(current_user.id, current_user.target_role, 300)
    except (OperationalError, ConnectionError, OSError) as exc:
        raise HTTPException(
            status_code=503,
            detail="The scraper could not be queued because Redis or the Celery worker is unavailable.",
        ) from exc

    _set_active_scrape_task(current_user.id, task.id)
    return TaskAcceptedResponse(
        task_id=task.id,
        status="queued",
        message=f"Scraping jobs for '{current_user.target_role}'...",
    )


@router.get("/api/scrape/status", response_model=ScrapeTaskStatusResponse)
def scrape_status_check(
    task_id: str = Query(..., description="Celery task identifier"),
    current_user: UserPublic = Depends(get_current_user),
):
    try:
        result = celery_app.AsyncResult(task_id)
    except (OperationalError, ConnectionError, OSError) as exc:
        raise HTTPException(
            status_code=503,
            detail="The scraper status service is unavailable. Check Redis and the Celery worker, then try again.",
        ) from exc

    try:
        raw_status = result.status
        raw_info = result.info
    except Exception as exc:
        _clear_active_scrape_task(current_user.id, task_id)
        error_message = str(exc)
        if "exception type" in error_message.lower():
            error_message = (
                "The background scrape failed and its stored worker error payload could not be decoded. "
                "This usually means the worker crashed while saving failure metadata. "
                "Check the Celery worker logs; if Playwright browsers are missing, install them and retry."
            )

        return ScrapeTaskStatusResponse(
            task_id=task_id,
            status="failure",
            progress=_coerce_progress(
                {
                    **_build_progress(phase="failed", target_role=current_user.target_role),
                    "error": error_message,
                },
                target_role=current_user.target_role,
            ),
            result=None,
            error=error_message,
        )

    progress_data = raw_info if isinstance(raw_info, dict) else {}
    progress = _coerce_progress(
        progress_data if progress_data else _build_progress(phase="queued", target_role=current_user.target_role),
        target_role=current_user.target_role,
    )

    payload = ScrapeTaskStatusResponse(
        task_id=task_id,
        status=_normalize_scrape_status(raw_status),
        progress=progress,
        error=None,
        result=None,
    )

    if result.successful():
        try:
            result_data = result.result if isinstance(result.result, dict) else {}
        except Exception:
            result_data = {}
        payload.result = ScrapeTaskResult(**result_data)
        payload.progress = _coerce_progress(result_data.get("progress", progress.model_dump()), target_role=current_user.target_role)

    if raw_status == "RETRY":
        payload.progress = _coerce_progress(
            progress_data if progress_data else _build_progress(phase="failed", target_role=current_user.target_role),
            target_role=current_user.target_role,
        )
        try:
            payload.error = str(result.result)
        except Exception:
            payload.error = "The scrape is retrying after a worker-side failure."

    if result.failed():
        payload.progress = _coerce_progress(
            progress_data if progress_data else _build_progress(phase="failed", target_role=current_user.target_role),
            target_role=current_user.target_role,
        )
        payload.error = progress_data.get("error") if isinstance(progress_data, dict) else None
        if not payload.error:
            try:
                payload.error = str(result.result)
            except Exception:
                payload.error = (
                    "The scrape failed, but the worker error payload could not be decoded. "
                    "Check the Celery worker logs for the original failure."
                )

    if raw_status in TERMINAL_SCRAPE_STATUSES:
        _clear_active_scrape_task(current_user.id, task_id)

    return payload
