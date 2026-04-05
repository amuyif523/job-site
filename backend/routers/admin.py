from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from database import get_session
from dependencies import get_current_user
from models import Job, UserPublic
from routers import ai as ai_router
import scraper as scraper_router
from services import llm_service
from services import operational_visibility

router = APIRouter()


def _provider_debug() -> dict[str, object]:
    configured = {
        "gemini": bool(llm_service.get_gemini_api_key()),
        "openai": bool(llm_service.get_openai_api_key()),
        "anthropic": bool(llm_service.get_anthropic_api_key()),
    }

    try:
        active_provider = llm_service.get_scoring_provider_name()
        provider_error = ""
    except llm_service.AuthenticationError as exc:
        active_provider = "unconfigured"
        provider_error = str(exc)

    return {
        "active_provider": active_provider,
        "configured_keys": configured,
        "provider_status_error": provider_error,
    }


def _job_debug_snapshot(session: Session, user_id: int) -> dict[str, object]:
    jobs = list(session.exec(select(Job).where(Job.user_id == user_id)).all())

    enrichment_status_counts = Counter(str((job.enrichment_status or "unknown")) for job in jobs)
    description_quality_counts = Counter(str((job.description_quality or "summary")) for job in jobs)
    intent_status_counts = Counter(str((job.intent_status or "included")) for job in jobs)

    scored_jobs = 0
    top_match_ready = 0
    for job in jobs:
        if job.score is not None and str(job.score_label or "") != "Unscorable":
            scored_jobs += 1
        if job.scoring_ready and job.score is not None and str(job.score_label or "") != "Unscorable":
            top_match_ready += 1

    return {
        "total_jobs": len(jobs),
        "intent_status_counts": dict(intent_status_counts),
        "enrichment_status_counts": dict(enrichment_status_counts),
        "description_quality_counts": dict(description_quality_counts),
        "scored_jobs": scored_jobs,
        "top_match_ready_jobs": top_match_ready,
    }


@router.get("/ops/metrics")
def get_operational_metrics(
    current_user: UserPublic = Depends(get_current_user),
) -> dict[str, object]:
    _ = current_user
    snapshot = operational_visibility.get_metrics_snapshot()

    enrichment = snapshot["enrichment"]
    intent_filter = snapshot["intent_filter"]

    return {
        "started_at": snapshot["started_at"],
        "last_updated": snapshot["last_updated"],
        "enrichment_metrics": {
            "html_success": enrichment["html_success"],
            "browser_fallback_success": enrichment["browser_fallback_success"],
            "total_failures": enrichment["total_failures"],
            "average_duration_ms": enrichment["average_duration_ms"],
            "last_error": enrichment["last_error"],
        },
        "intent_filter_metrics": {
            "jobs_found": intent_filter["jobs_found"],
            "skipped_irrelevant": intent_filter["skipped_irrelevant"],
            "enriched": intent_filter["enriched"],
            "scored": intent_filter["scored"],
            "promoted_top_matches": intent_filter["promoted_top_matches"],
        },
    }


@router.get("/ops/debug")
def get_operational_debug(
    current_user: UserPublic = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    metrics_snapshot = operational_visibility.get_metrics_snapshot()
    provider_debug = _provider_debug()

    return {
        "provider": {
            **provider_debug,
            "issues": metrics_snapshot["provider_issues"],
        },
        "tasks": {
            "active_score_tasks": len(ai_router.ACTIVE_SCORE_TASKS),
            "active_scrape_tasks": len(scraper_router.ACTIVE_SCRAPE_TASKS),
        },
        "runtime_metrics": {
            "enrichment": metrics_snapshot["enrichment"],
            "intent_filter": metrics_snapshot["intent_filter"],
            "scrape": metrics_snapshot["scrape"],
        },
        "user_job_snapshot": {
            "user_id": current_user.id,
            **_job_debug_snapshot(session, current_user.id),
        },
    }
