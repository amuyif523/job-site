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


class CVLatestResponse(BaseModel):
    has_cv: bool = Field(default=False)
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
    if not parsed:
        payload = CVLatestResponse()
        payload.has_cv = True
        return payload

    payload = CVLatestResponse()
    payload.has_cv = True

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

    return payload
