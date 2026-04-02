"""CV data routes."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from database import get_session
from dependencies import get_current_user
from models import CVData, UserPublic

router = APIRouter()


class CVReadinessResponse(BaseModel):
    dashboard: bool = Field(default=False)
    scoring: bool = Field(default=False)
    parsed_payload: bool = Field(default=False)
    raw_text: bool = Field(default=False)


class CVLatestResponse(BaseModel):
    has_cv: bool = Field(default=False)
    status: str = Field(default="no_cv")
    readiness: CVReadinessResponse = Field(default_factory=CVReadinessResponse)
    parsed_json: dict[str, Any] = Field(default_factory=dict)
    suggestions: list[str] = Field(default_factory=list)


def _load_stored_payload(row: CVData) -> dict[str, Any]:
    stored_payload = row.parsed_json or ""
    if not stored_payload.strip():
        # Backward compatibility for rows created before parsed_json existed.
        stored_payload = row.extracted_text or ""

    try:
        parsed = json.loads(stored_payload)
    except (json.JSONDecodeError, TypeError):
        return {}

    return parsed if isinstance(parsed, dict) else {}


def _has_parsed_resume_content(parsed_json: dict[str, Any]) -> bool:
    summary = parsed_json.get("summary")
    if isinstance(summary, str) and summary.strip():
        return True

    for key in ("education", "experience", "skills", "languages", "projects"):
        value = parsed_json.get(key)
        if isinstance(value, list) and len(value) > 0:
            return True

    return False


def _has_raw_cv_text(row: CVData) -> bool:
    return bool((row.extracted_text or "").strip())


@router.get("/latest", response_model=CVLatestResponse)
def get_latest_cv(
    current_user: UserPublic = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CVLatestResponse:
    print(f"[backend] get_latest_cv requested for user {current_user.id}")
    # Keep ordering by most recent timestamp for compatibility if schema evolves
    # to store multiple CV snapshots per user.
    statement = (
        select(CVData)
        .where(CVData.user_id == current_user.id)
        .order_by(CVData.last_updated.desc())
    )
    row = session.exec(statement).first()

    if not row:
        print("[backend] get_latest_cv: No row found")
        return CVLatestResponse()

    print("[backend] get_latest_cv: Row found, returning data")
    parsed = _load_stored_payload(row)
    has_raw_text = _has_raw_cv_text(row)

    if not parsed:
        payload = CVLatestResponse()
        payload.has_cv = True
        payload.status = "invalid"
        payload.readiness.raw_text = has_raw_text
        payload.readiness.scoring = has_raw_text
        return payload

    payload = CVLatestResponse()
    payload.has_cv = True
    payload.readiness.parsed_payload = True
    payload.readiness.raw_text = has_raw_text
    payload.readiness.scoring = has_raw_text

    parsed_json = parsed.get("parsed_json")
    if isinstance(parsed_json, dict):
        payload.parsed_json = parsed_json
    else:
        # Support direct parsed-json style payloads where top-level keys are
        # CV sections like summary/experience/education.
        payload.parsed_json = {
            k: v
            for k, v in parsed.items()
            if k != "suggestions"
        }

    suggestions = parsed.get("suggestions")
    if isinstance(suggestions, list):
        payload.suggestions = [str(item) for item in suggestions]

    payload.readiness.dashboard = _has_parsed_resume_content(payload.parsed_json)
    payload.status = "ready" if payload.readiness.dashboard else "incomplete"

    return payload
