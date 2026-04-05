from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_STATE_LOCK = Lock()
_STATE: dict[str, Any] = {
    "started_at": _utc_now_iso(),
    "last_updated": _utc_now_iso(),
    "enrichment": {
        "html_success": 0,
        "browser_fallback_success": 0,
        "total_failures": 0,
        "total_duration_ms": 0,
        "duration_samples": 0,
        "last_error": "",
        "last_updated": _utc_now_iso(),
    },
    "intent_filter": {
        "jobs_found": 0,
        "skipped_irrelevant": 0,
        "enriched": 0,
        "scored": 0,
        "promoted_top_matches": 0,
        "last_updated": _utc_now_iso(),
    },
    "provider_issues": {
        "authentication_errors": 0,
        "rate_limit_errors": 0,
        "provider_errors": 0,
        "unexpected_errors": 0,
        "last_error": "",
        "last_provider": "",
        "last_updated": _utc_now_iso(),
    },
    "scrape": {
        "runs": 0,
        "last_summary": {
            "jobs_found": 0,
            "jobs_saved": 0,
            "jobs_filtered_out": 0,
            "target_role": "",
            "status": "",
            "error": "",
            "timestamp": "",
        },
        "last_updated": _utc_now_iso(),
    },
}


def _touch(state: dict[str, Any], section: str | None = None) -> None:
    now = _utc_now_iso()
    state["last_updated"] = now
    if section:
        state[section]["last_updated"] = now


def record_enrichment_batch(expected_jobs: int, attempts: dict[int, Any], batch_error: str = "") -> None:
    with _STATE_LOCK:
        enrichment = _STATE["enrichment"]

        for attempt in attempts.values():
            method = str(getattr(attempt, "method", "") or "")
            quality = str(getattr(attempt, "quality", "summary") or "summary")
            description = str(getattr(attempt, "description", "") or "").strip()
            duration_ms = int(getattr(attempt, "duration_ms", 0) or 0)

            if duration_ms > 0:
                enrichment["total_duration_ms"] += duration_ms
                enrichment["duration_samples"] += 1

            is_usable = bool(description and quality != "summary")
            if method == "html" and is_usable:
                enrichment["html_success"] += 1
            elif method == "playwright" and is_usable:
                enrichment["browser_fallback_success"] += 1
            else:
                enrichment["total_failures"] += 1

        missing_attempts = max(int(expected_jobs) - len(attempts), 0)
        if missing_attempts:
            enrichment["total_failures"] += missing_attempts

        if batch_error:
            enrichment["last_error"] = str(batch_error)

        _touch(_STATE, "enrichment")


def record_intent_filter_metrics(
    *,
    jobs_found: int = 0,
    skipped_irrelevant: int = 0,
    enriched: int = 0,
    scored: int = 0,
    promoted_top_matches: int = 0,
) -> None:
    with _STATE_LOCK:
        intent_filter = _STATE["intent_filter"]
        intent_filter["jobs_found"] += max(int(jobs_found), 0)
        intent_filter["skipped_irrelevant"] += max(int(skipped_irrelevant), 0)
        intent_filter["enriched"] += max(int(enriched), 0)
        intent_filter["scored"] += max(int(scored), 0)
        intent_filter["promoted_top_matches"] += max(int(promoted_top_matches), 0)
        _touch(_STATE, "intent_filter")


def record_provider_issue(kind: str, error: str, provider: str = "") -> None:
    with _STATE_LOCK:
        issues = _STATE["provider_issues"]
        kind_value = (kind or "").strip().lower()

        if kind_value == "authentication":
            issues["authentication_errors"] += 1
        elif kind_value == "rate_limit":
            issues["rate_limit_errors"] += 1
        elif kind_value == "provider":
            issues["provider_errors"] += 1
        else:
            issues["unexpected_errors"] += 1

        issues["last_error"] = (error or "").strip()
        issues["last_provider"] = (provider or "").strip()
        _touch(_STATE, "provider_issues")


def record_scrape_summary(
    *,
    jobs_found: int,
    jobs_saved: int,
    jobs_filtered_out: int,
    target_role: str,
    status: str,
    error: str = "",
) -> None:
    with _STATE_LOCK:
        scrape = _STATE["scrape"]
        scrape["runs"] += 1
        scrape["last_summary"] = {
            "jobs_found": max(int(jobs_found), 0),
            "jobs_saved": max(int(jobs_saved), 0),
            "jobs_filtered_out": max(int(jobs_filtered_out), 0),
            "target_role": str(target_role or ""),
            "status": str(status or ""),
            "error": str(error or ""),
            "timestamp": _utc_now_iso(),
        }
        _touch(_STATE, "scrape")


def get_metrics_snapshot() -> dict[str, Any]:
    with _STATE_LOCK:
        snapshot = deepcopy(_STATE)

    enrichment = snapshot["enrichment"]
    duration_samples = int(enrichment.get("duration_samples", 0) or 0)
    total_duration_ms = int(enrichment.get("total_duration_ms", 0) or 0)
    enrichment["average_duration_ms"] = (
        round(total_duration_ms / duration_samples, 2) if duration_samples else 0.0
    )

    return snapshot


def reset_for_tests() -> None:
    with _STATE_LOCK:
        now = _utc_now_iso()
        _STATE["started_at"] = now
        _STATE["last_updated"] = now
        _STATE["enrichment"] = {
            "html_success": 0,
            "browser_fallback_success": 0,
            "total_failures": 0,
            "total_duration_ms": 0,
            "duration_samples": 0,
            "last_error": "",
            "last_updated": now,
        }
        _STATE["intent_filter"] = {
            "jobs_found": 0,
            "skipped_irrelevant": 0,
            "enriched": 0,
            "scored": 0,
            "promoted_top_matches": 0,
            "last_updated": now,
        }
        _STATE["provider_issues"] = {
            "authentication_errors": 0,
            "rate_limit_errors": 0,
            "provider_errors": 0,
            "unexpected_errors": 0,
            "last_error": "",
            "last_provider": "",
            "last_updated": now,
        }
        _STATE["scrape"] = {
            "runs": 0,
            "last_summary": {
                "jobs_found": 0,
                "jobs_saved": 0,
                "jobs_filtered_out": 0,
                "target_role": "",
                "status": "",
                "error": "",
                "timestamp": "",
            },
            "last_updated": now,
        }
