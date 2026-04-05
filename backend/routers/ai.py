"""AI routes for CV ingestion and parallel job scoring."""

from __future__ import annotations

import asyncio
import io
import json
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from typing import List
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile, status
from kombu.exceptions import OperationalError
from pydantic import BaseModel, Field
from pypdf import PdfReader
from sqlmodel import Session, select

from dependencies import get_current_user
from database import engine, get_session
from models import CVData, Job, UserPublic
from services import llm_service
from services.job_enrichment import (
    EnrichmentAttempt,
    fetch_job_enrichment_map,
    has_high_fidelity_description,
    normalize_job_description,
)
from services.llm_service import ProviderError
from worker import celery_app

router = APIRouter()

UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"
ALLOWED_CV_EXTENSIONS = {".pdf"}
ALLOWED_CV_MIME_TYPES = {"application/pdf"}
MAX_CV_UPLOAD_BYTES = 5 * 1024 * 1024
TERMINAL_SCORE_STATUSES = {"SUCCESS", "FAILURE", "REVOKED"}
ACTIVE_SCORE_TASKS: dict[int, str] = {}
SCORE_TASK_OWNERS: dict[str, int] = {}
SCORE_TASK_LOCK = Lock()


class ScoreRequest(BaseModel):
    job_ids: List[int] = Field(default_factory=list)


class ScoreResult(BaseModel):
    job_id: int
    compatibility_score: int
    match_status: str
    reasoning: str


class ScoreResponse(BaseModel):
    scored: int
    results: List[ScoreResult]
    errors: List[str] = Field(default_factory=list)
    unscorable: int = 0


class TaskAcceptedResponse(BaseModel):
    task_id: str
    status: str
    message: str


class GenerateRequest(BaseModel):
    template_choice: str = "Modern"
    language: str = "English"
    custom_instructions: str = ""


class GenerateResponse(BaseModel):
    cv_url: str
    cover_letter_url: str


class CVUploadResponse(BaseModel):
    success: bool
    message: str
    filename: str


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    progress: dict | None = None
    result: dict | None = None
    error: str | None = None


UNSCORABLE_SCORE_LABEL = "Unscorable"
GENERATION_BLOCK_MESSAGE = (
    "This job is not ready for application generation yet. Run scoring on a complete job description first."
)


def _build_score_progress(
    *,
    phase: str,
    total_jobs: int = 0,
    jobs_scored: int = 0,
    jobs_failed: int = 0,
    jobs_unscorable: int = 0,
) -> dict[str, int | str]:
    return {
        "phase": phase,
        "total_jobs": max(total_jobs, 0),
        "jobs_scored": max(jobs_scored, 0),
        "jobs_failed": max(jobs_failed, 0),
        "jobs_unscorable": max(jobs_unscorable, 0),
    }


def _normalize_score_status(raw_status: str) -> str:
    if raw_status == "SUCCESS":
        return "success"
    if raw_status == "FAILURE":
        return "failure"
    if raw_status == "RETRY":
        return "retrying"
    if raw_status in {"STARTED", "PROGRESS"}:
        return "running"
    return "queued"


def _set_score_task_owner(user_id: int, task_id: str) -> None:
    with SCORE_TASK_LOCK:
        ACTIVE_SCORE_TASKS[user_id] = task_id
        SCORE_TASK_OWNERS[task_id] = user_id


def _clear_score_task(user_id: int, task_id: str | None = None) -> None:
    with SCORE_TASK_LOCK:
        current_task_id = ACTIVE_SCORE_TASKS.get(user_id)
        if current_task_id is None:
            return
        if task_id is not None and current_task_id != task_id:
            return
        ACTIVE_SCORE_TASKS.pop(user_id, None)
        SCORE_TASK_OWNERS.pop(current_task_id, None)


def _get_active_score_task_id(user_id: int) -> str | None:
    with SCORE_TASK_LOCK:
        return ACTIVE_SCORE_TASKS.get(user_id)


def _get_score_task_owner(task_id: str) -> int | None:
    with SCORE_TASK_LOCK:
        return SCORE_TASK_OWNERS.get(task_id)


def _get_conflicting_score_task(user_id: int) -> str | None:
    active_task_id = _get_active_score_task_id(user_id)
    if not active_task_id:
        return None

    result = celery_app.AsyncResult(active_task_id)
    if result.status in TERMINAL_SCORE_STATUSES:
        _clear_score_task(user_id, active_task_id)
        return None

    return active_task_id


def _coerce_score_progress(data: dict[str, Any] | None) -> dict[str, int | str]:
    payload = data or {}
    return _build_score_progress(
        phase=str(payload.get("phase", "queued")),
        total_jobs=int(payload.get("total_jobs", 0) or 0),
        jobs_scored=int(payload.get("jobs_scored", 0) or 0),
        jobs_failed=int(payload.get("jobs_failed", 0) or 0),
        jobs_unscorable=int(payload.get("jobs_unscorable", 0) or 0),
    )


def _load_json_list(raw_value: str | None) -> list:
    if not raw_value:
        return []
    try:
        parsed = json.loads(raw_value)
    except (json.JSONDecodeError, TypeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _set_json_list(row: Job, field_name: str, values: list[str]) -> None:
    setattr(row, field_name, json.dumps(values))


def _append_job_event(row: Job, event_type: str, *, score: int | None = None, score_label: str | None = None) -> None:
    events = _load_json_list(row.events)
    payload = {"type": event_type, "timestamp": datetime.now(timezone.utc).isoformat()}
    if score is not None:
        payload["score"] = score
    if score_label:
        payload["score_label"] = score_label
    events.append(payload)
    row.events = json.dumps(events)


def _set_job_enrichment_state(
    row: Job,
    *,
    status: str,
    error: str = "",
    scoring_ready: bool,
    method: str = "",
    duration_ms: int = 0,
    retryable: bool = False,
) -> None:
    row.enrichment_status = status
    row.enrichment_error = error
    row.scoring_ready = scoring_ready
    row.enrichment_method = method
    row.enrichment_duration_ms = max(duration_ms, 0)
    row.enrichment_retryable = retryable


def _refresh_job_scoring_readiness(
    row: Job,
    *,
    prefer_enriched_label: bool = False,
    error: str = "",
    method: str = "",
    duration_ms: int = 0,
    retryable: bool = False,
) -> None:
    description = normalize_job_description(row.description or "")
    row.description = description
    incomplete_retryable = bool(retryable and error and description)

    if has_high_fidelity_description(description):
        status_value = "enriched" if prefer_enriched_label else "ready"
        _set_job_enrichment_state(
            row,
            status=status_value,
            error="",
            scoring_ready=True,
            method=method,
            duration_ms=duration_ms,
            retryable=False,
        )
        return

    if description:
        status_value = "failed" if error and not incomplete_retryable else "partial"
        error_value = "" if incomplete_retryable else error
        _set_job_enrichment_state(
            row,
            status=status_value,
            error=error_value,
            scoring_ready=False,
            method=method,
            duration_ms=duration_ms,
            retryable=retryable,
        )
        return

    status_value = "failed" if error else "missing"
    _set_job_enrichment_state(
        row,
        status=status_value,
        error=error,
        scoring_ready=False,
        method=method,
        duration_ms=duration_ms,
        retryable=retryable,
    )


def _mark_job_unscorable(row: Job, reason: str) -> None:
    row.score = None
    row.score_label = UNSCORABLE_SCORE_LABEL
    row.scoring_ready = False
    _set_json_list(row, "score_reasoning", [reason])
    red_flags = _load_json_list(row.red_flags)
    if reason not in red_flags:
        red_flags.append(reason)
    _set_json_list(row, "red_flags", red_flags)


def _job_can_generate(row: Job) -> bool:
    return bool(row.scoring_ready and row.score is not None and row.score_label != UNSCORABLE_SCORE_LABEL)


def _parse_stored_cv_payload(raw_payload: str) -> dict:
    if not raw_payload.strip():
        return {}
    try:
        parsed = json.loads(raw_payload)
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _validate_upload_metadata(file: UploadFile) -> str:
    original_name = file.filename or ""
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_CV_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF CV uploads are supported",
        )

    content_type = (file.content_type or "").lower().strip()
    if content_type and content_type not in ALLOWED_CV_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must use the application/pdf content type",
        )

    return original_name or "cv_upload.pdf"


async def _read_upload_bytes(file: UploadFile) -> bytes:
    data = await file.read(MAX_CV_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded CV file is empty",
        )
    if len(data) > MAX_CV_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Uploaded CV exceeds the {MAX_CV_UPLOAD_BYTES // (1024 * 1024)}MB size limit",
        )
    return data


def _validate_pdf_signature(data: bytes) -> None:
    if not data.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is not a valid PDF document",
        )


def _delete_uploaded_file(path: Path | None) -> None:
    if not path or not path.exists():
        return
    try:
        path.unlink()
        print(f"[backend] Deleted uploaded file: {path.name}")
    except OSError as exc:
        print(f"[backend] Failed to delete uploaded file {path.name}: {exc}")


def _extract_text_from_upload(data: bytes, filename: str) -> str:
    if not filename.lower().endswith(".pdf"):
        return ""

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
        extracted = "\n".join(pages).strip()
        if extracted:
            return extracted[:50000]
    except Exception:
        return ""

    return ""


def _fetch_cv_text(session: Session, user_id: int) -> str:
    row = session.get(CVData, user_id)
    if not row:
        return ""
    return row.extracted_text.strip()


def _fetch_jobs(session: Session, user_id: int, job_ids: List[int]) -> List[Job]:
    statement = select(Job).where(Job.user_id == user_id)
    if job_ids:
        statement = statement.where(Job.id.in_(job_ids))
    else:
        statement = statement.where(Job.score == None)  # noqa: E711
    return list(session.exec(statement).all())


@celery_app.task(bind=True, name="tasks.score_jobs")
def score_jobs_task(self, user_id: int, job_ids: List[int] | None = None) -> dict:
    selected_ids = job_ids or []

    def report_progress(
        *,
        phase: str,
        total_jobs: int = 0,
        jobs_scored: int = 0,
        jobs_failed: int = 0,
        jobs_unscorable: int = 0,
    ) -> None:
        task_id = getattr(getattr(self, "request", None), "id", None)
        if not task_id:
            return
        self.update_state(
            state="PROGRESS",
            meta=_build_score_progress(
                phase=phase,
                total_jobs=total_jobs,
                jobs_scored=jobs_scored,
                jobs_failed=jobs_failed,
                jobs_unscorable=jobs_unscorable,
            ),
        )

    with Session(engine) as session:
        cv_text = _fetch_cv_text(session, user_id)
        if not cv_text.strip():
            return {
                "scored": 0,
                "results": [],
                "unscorable": 0,
                "progress": _build_score_progress(phase="failed"),
                "errors": [
                    "CV is not ready for scoring. Re-upload a resume with readable text before scoring jobs."
                ],
            }

        job_rows = _fetch_jobs(session, user_id, selected_ids)
        if not job_rows:
            return {
                "scored": 0,
                "results": [],
                "unscorable": 0,
                "progress": _build_score_progress(phase="completed"),
                "errors": ["No matching jobs found to score"],
            }

        total_jobs = len(job_rows)
        report_progress(phase="running", total_jobs=total_jobs)

        jobs_needing_description = [
            row
            for row in job_rows
            if not has_high_fidelity_description(row.description or "")
            and (row.url or "").strip()
            and row.id is not None
        ]
        enrichment_attempts: dict[int, EnrichmentAttempt] = {}
        enrichment_error: str | None = None
        if jobs_needing_description:
            try:
                enrichment_attempts = asyncio.run(
                    fetch_job_enrichment_map(
                        [(int(row.id), row.url or "") for row in jobs_needing_description if row.id is not None]
                    )
                )
            except Exception as exc:
                enrichment_attempts = {}
                enrichment_error = str(exc)

        scored_count = 0
        unscorable_count = 0
        failed_count = 0
        errors: List[str] = []
        results: List[dict[str, object]] = []

        for row in job_rows:
            job_id = int(row.id or 0)
            enriched_this_job = False
            enrichment_attempt = enrichment_attempts.get(int(row.id)) if row.id is not None else None
            if row.id is not None and not has_high_fidelity_description(row.description or ""):
                enriched_description = (enrichment_attempt.description if enrichment_attempt else "").strip()
                if enriched_description:
                    row.description = enriched_description
                    _append_job_event(row, "enriched")
                    enriched_this_job = True

            _refresh_job_scoring_readiness(
                row,
                prefer_enriched_label=enriched_this_job,
                error=enrichment_error or (enrichment_attempt.error if enrichment_attempt else ""),
                method=enrichment_attempt.method if enrichment_attempt else row.enrichment_method,
                duration_ms=enrichment_attempt.duration_ms if enrichment_attempt else row.enrichment_duration_ms,
                retryable=enrichment_attempt.retryable if enrichment_attempt else row.enrichment_retryable,
            )

            job_description = (row.description or "").strip()
            if not row.scoring_ready:
                reason = "This job could not be scored because no usable job description was available for the listing."
                if enrichment_error:
                    reason = f"{reason} Enrichment failed: {enrichment_error}"
                elif job_description:
                    reason = (
                        "This job could not be scored because the stored job description is too short to score reliably."
                    )
                _mark_job_unscorable(row, reason)
                session.add(row)
                unscorable_count += 1
                errors.append(f"job_id={job_id}: incomplete job description; scoring skipped")
                report_progress(
                    phase="running",
                    total_jobs=total_jobs,
                    jobs_scored=scored_count,
                    jobs_failed=failed_count,
                    jobs_unscorable=unscorable_count,
                )
                continue

            try:
                item = asyncio.run(
                    llm_service.get_score_from_ai(
                        cv_text=cv_text,
                        job_description=job_description,
                    )
                )
            except llm_service.AuthenticationError as exc:
                errors.append(f"job_id={job_id}: {exc}")
                failed_count += 1
                report_progress(
                    phase="running",
                    total_jobs=total_jobs,
                    jobs_scored=scored_count,
                    jobs_failed=failed_count,
                    jobs_unscorable=unscorable_count,
                )
                continue
            except llm_service.RateLimitError as exc:
                errors.append(f"job_id={job_id}: {exc}")
                failed_count += 1
                report_progress(
                    phase="running",
                    total_jobs=total_jobs,
                    jobs_scored=scored_count,
                    jobs_failed=failed_count,
                    jobs_unscorable=unscorable_count,
                )
                continue
            except llm_service.ProviderError as exc:
                errors.append(f"job_id={job_id}: {exc}")
                failed_count += 1
                report_progress(
                    phase="running",
                    total_jobs=total_jobs,
                    jobs_scored=scored_count,
                    jobs_failed=failed_count,
                    jobs_unscorable=unscorable_count,
                )
                continue
            except Exception:
                errors.append(f"job_id={job_id}: unexpected scoring error")
                failed_count += 1
                report_progress(
                    phase="running",
                    total_jobs=total_jobs,
                    jobs_scored=scored_count,
                    jobs_failed=failed_count,
                    jobs_unscorable=unscorable_count,
                )
                continue

            score = int(item.get("compatibility_score", 0))
            status_value = str(item.get("match_status", "Poor"))
            reasoning = str(item.get("reasoning", "No reasoning provided."))

            row.score = float(score)
            row.score_label = status_value
            if row.status == "new":
                row.status = "scored"
            row.score_reasoning = json.dumps([reasoning])
            if not row.red_flags:
                row.red_flags = json.dumps([])
            _append_job_event(row, "scored", score=score, score_label=status_value)
            session.add(row)
            scored_count += 1
            report_progress(
                phase="running",
                total_jobs=total_jobs,
                jobs_scored=scored_count,
                jobs_failed=failed_count,
                jobs_unscorable=unscorable_count,
            )
            results.append(
                {
                    "job_id": job_id,
                    "compatibility_score": score,
                    "match_status": status_value,
                    "reasoning": reasoning,
                }
            )

        session.commit()
        return {
            "scored": scored_count,
            "results": results,
            "unscorable": unscorable_count,
            "errors": errors,
            "progress": _build_score_progress(
                phase="completed",
                total_jobs=total_jobs,
                jobs_scored=scored_count,
                jobs_failed=failed_count,
                jobs_unscorable=unscorable_count,
            ),
        }


@router.post("/score-all", response_model=TaskAcceptedResponse, status_code=202)
def score_all(
    body: ScoreRequest | None = Body(default=None),
    current_user: UserPublic = Depends(get_current_user),
) -> TaskAcceptedResponse:
    try:
        llm_service.get_scoring_provider_name()
    except llm_service.AuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    try:
        conflicting_task_id = _get_conflicting_score_task(current_user.id)
    except (OperationalError, ConnectionError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The scoring status service is unavailable. Check Redis and the Celery worker, then try again.",
        ) from exc

    if conflicting_task_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A scoring task is already running for this account. Wait for it to finish before starting another.",
        )

    req = body or ScoreRequest()
    try:
        task = score_jobs_task.delay(current_user.id, req.job_ids)
    except (OperationalError, ConnectionError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The scoring task could not be queued because Redis or the Celery worker is unavailable.",
        ) from exc
    _set_score_task_owner(current_user.id, task.id)
    return TaskAcceptedResponse(
        task_id=task.id,
        status="queued",
        message="Scoring task started",
    )


@router.get("/score-all/status", response_model=TaskStatusResponse)
def score_all_status(
    task_id: str = Query(..., description="Celery task identifier"),
    current_user: UserPublic = Depends(get_current_user),
) -> TaskStatusResponse:
    owner_id = _get_score_task_owner(task_id)
    if owner_id is not None and owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scoring task not found")

    try:
        result = celery_app.AsyncResult(task_id)
    except (OperationalError, ConnectionError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The scoring status service is unavailable. Check Redis and the Celery worker, then try again.",
        ) from exc

    try:
        raw_status = result.status
        raw_info = result.info
    except Exception as exc:
        _clear_score_task(current_user.id, task_id)
        error_message = str(exc)
        if "exception type" in error_message.lower():
            error_message = (
                "The background scoring task failed and its stored worker error payload could not be decoded. "
                "Check the Celery worker logs for the original failure."
            )

        return TaskStatusResponse(
            task_id=task_id,
            status="failure",
            progress=_build_score_progress(phase="failed"),
            error=error_message,
            result=None,
        )

    progress_data = raw_info if isinstance(raw_info, dict) else {}
    payload = TaskStatusResponse(
        task_id=task_id,
        status=_normalize_score_status(raw_status),
        progress=_coerce_score_progress(progress_data if progress_data else _build_score_progress(phase="queued")),
        result=None,
        error=None,
    )

    if result.successful():
        try:
            result_data = result.result if isinstance(result.result, dict) else {}
        except Exception:
            result_data = {}
        payload.result = result_data
        payload.progress = _coerce_score_progress(result_data.get("progress"))

    if raw_status == "RETRY":
        try:
            payload.error = str(result.result)
        except Exception:
            payload.error = "The scoring task is retrying after a worker-side failure."

    if result.failed():
        payload.progress = _coerce_score_progress(progress_data if progress_data else _build_score_progress(phase="failed"))
        if isinstance(progress_data, dict) and isinstance(progress_data.get("error"), str):
            payload.error = str(progress_data["error"])
        if not payload.error:
            try:
                payload.error = str(result.result)
            except Exception:
                payload.error = (
                    "The scoring task failed, but the worker error payload could not be decoded. "
                    "Check the Celery worker logs for the original failure."
                )

    if raw_status in TERMINAL_SCORE_STATUSES:
        _clear_score_task(current_user.id, task_id)

    return payload


@router.post("/generate/{job_id}", response_model=GenerateResponse)
def generate_documents(
    job_id: int,
    body: GenerateRequest | None = Body(default=None),
    current_user: UserPublic = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> GenerateResponse:
    job = session.exec(
        select(Job).where(Job.id == job_id, Job.user_id == current_user.id)
    ).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    _refresh_job_scoring_readiness(job, error=job.enrichment_error or "")
    session.add(job)
    session.commit()
    if not _job_can_generate(job):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=GENERATION_BLOCK_MESSAGE,
        )

    req = body if isinstance(body, GenerateRequest) else GenerateRequest()
    lang = req.language.strip().lower().replace(" ", "-") or "english"
    template = req.template_choice.strip().lower().replace(" ", "-") or "modern"

    return GenerateResponse(
        cv_url=f"/downloads/cv_{job_id}_{template}_{lang}.pdf",
        cover_letter_url=f"/downloads/cover_{job_id}_{template}_{lang}.pdf",
    )


@router.post("/ai/upload_cv", response_model=CVUploadResponse)
@router.post("/cv", response_model=CVUploadResponse)
async def upload_cv(
    file: UploadFile = File(...),
    current_user: UserPublic = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CVUploadResponse:
    print(f"[backend] upload_cv started for user {current_user.id}, file {file.filename}")
    destination: Path | None = None
    old_destination: Path | None = None
    safe_name = ""
    try:
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

        original_name = _validate_upload_metadata(file)
        safe_name = f"{uuid4().hex}_{Path(original_name).name}"
        destination = UPLOADS_DIR / safe_name

        data = await _read_upload_bytes(file)
        print(f"[backend] file read, size: {len(data)} bytes")
        _validate_pdf_signature(data)

        extracted_text = _extract_text_from_upload(data, original_name)
        print(f"[backend] Extracted raw text length: {len(extracted_text)}")
        if not extracted_text.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not extract readable text from the uploaded PDF",
            )

        try:
            structured_resume = await llm_service.parse_resume(extracted_text)
            payload = _parse_stored_cv_payload(structured_resume)
            print(
                "[backend] LLM parsed resume successfully, "
                f"payload_keys: {sorted(payload.keys()) if payload else []}"
            )
        except ProviderError as e:
            print(f"[backend] ProviderError: {e}")
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            print(f"[backend] Exception in parse_resume: {e}")
            raise HTTPException(status_code=500, detail="An error occurred while parsing the resume")

        destination.write_bytes(data)

        current = session.get(CVData, current_user.id)
        if current:
            print("[backend] Updating existing CVData")
            if current.filename:
                candidate_old_destination = UPLOADS_DIR / current.filename
                if candidate_old_destination != destination:
                    old_destination = candidate_old_destination
            current.filename = safe_name
            current.extracted_text = extracted_text
            current.parsed_json = structured_resume
            current.last_updated = datetime.now(timezone.utc)
            session.add(current)
        else:
            print("[backend] Creating new CVData")
            session.add(
                CVData(
                    user_id=current_user.id,
                    filename=safe_name,
                    extracted_text=extracted_text,
                    parsed_json=structured_resume,
                    last_updated=datetime.now(timezone.utc),
                )
            )
        try:
            session.commit()
        except Exception:
            session.rollback()
            _delete_uploaded_file(destination)
            raise
        print("[backend] Session committed successfully")
        _delete_uploaded_file(old_destination)
    except Exception:
        _delete_uploaded_file(destination)
        raise
    finally:
        await file.close()

    return CVUploadResponse(
        success=True,
        message="CV uploaded successfully",
        filename=safe_name,
    )
