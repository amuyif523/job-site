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
    parsed_json: dict[str, Any] = Field(default_factory=dict)
    suggestions: list[str] = Field(default_factory=list)


@router.get("/latest", response_model=CVLatestResponse)
def get_latest_cv(
    current_user: UserPublic = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CVLatestResponse:
    # Keep ordering by most recent timestamp for compatibility if schema evolves
    # to store multiple CV snapshots per user.
    statement = (
        select(CVData)
        .where(CVData.user_id == current_user.id)
        .order_by(CVData.last_updated.desc())
    )
    row = session.exec(statement).first()

    if not row:
        return CVLatestResponse()

    try:
        parsed = json.loads(row.extracted_text)
    except (json.JSONDecodeError, TypeError):
        parsed = {}

    if not isinstance(parsed, dict):
        return CVLatestResponse()

    payload = CVLatestResponse()

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