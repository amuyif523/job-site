"""AI routes for CV ingestion and parallel job scoring."""

from __future__ import annotations

import asyncio
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from pypdf import PdfReader
from sqlmodel import Session, select

from dependencies import get_current_user
from database import engine, get_session
from models import CVData, Job, UserPublic
from services import llm_service
from worker import celery_app

router = APIRouter()

UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"


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


def _extract_text_from_upload(data: bytes, filename: str) -> str:
    is_pdf = filename.lower().endswith(".pdf")
    if is_pdf:
        try:
            reader = PdfReader(io.BytesIO(data))
            pages = [page.extract_text() or "" for page in reader.pages]
            extracted = "\n".join(pages).strip()
            if extracted:
                return extracted[:50000]
        except Exception:
            # Fall back to plain text decoding below.
            pass

    return data.decode("utf-8", errors="ignore")[:50000]


def _fetch_cv_text(session: Session, user_id: int) -> str:
    row = session.get(CVData, user_id)
    return row.extracted_text if row else ""


def _fetch_jobs(session: Session, user_id: int, job_ids: List[int]) -> List[Job]:
    statement = select(Job).where(Job.user_id == user_id)
    if job_ids:
        statement = statement.where(Job.id.in_(job_ids))
    else:
        statement = statement.where(Job.score == None)  # noqa: E711
    return list(session.exec(statement).all())


@celery_app.task(name="tasks.score_jobs")
def score_jobs_task(user_id: int, job_ids: List[int] | None = None) -> dict:
    selected_ids = job_ids or []
    with Session(engine) as session:
        cv_text = _fetch_cv_text(session, user_id)
        if not cv_text.strip():
            return {"scored": 0, "errors": ["No CV extracted text found"]}

        job_rows = _fetch_jobs(session, user_id, selected_ids)
        if not job_rows:
            return {"scored": 0, "errors": ["No matching jobs found to score"]}

        scored_count = 0
        errors: List[str] = []

        for row in job_rows:
            try:
                item = asyncio.run(
                    llm_service.get_score_from_ai(
                        cv_text=cv_text,
                        job_description=row.description or "",
                    )
                )
            except llm_service.AuthenticationError as exc:
                errors.append(f"job_id={int(row.id)}: {exc}")
                continue
            except llm_service.RateLimitError as exc:
                errors.append(f"job_id={int(row.id)}: {exc}")
                continue
            except llm_service.ProviderError as exc:
                errors.append(f"job_id={int(row.id)}: {exc}")
                continue
            except Exception:
                errors.append(f"job_id={int(row.id)}: unexpected scoring error")
                continue

            score = int(item.get("compatibility_score", 0))
            status_value = str(item.get("match_status", "Poor"))
            reasoning = str(item.get("reasoning", "No reasoning provided."))

            row.score = float(score)
            row.status = "scored"
            row.score_reasoning = json.dumps([reasoning])
            if not row.red_flags:
                row.red_flags = json.dumps([])
            session.add(row)
            scored_count += 1

        session.commit()
        return {"scored": scored_count, "errors": errors}


@router.post("/score-all", response_model=TaskAcceptedResponse, status_code=202)
def score_all(
    body: ScoreRequest | None = Body(default=None),
    current_user: UserPublic = Depends(get_current_user),
) -> TaskAcceptedResponse:
    req = body or ScoreRequest()
    task = score_jobs_task.delay(current_user.id, req.job_ids)
    return TaskAcceptedResponse(
        task_id=task.id,
        status="queued",
        message="Scoring task started",
    )


@router.post("/generate/{job_id}", response_model=GenerateResponse)
def generate_documents(
    job_id: int,
    body: GenerateRequest | None = Body(default=None),
    current_user: UserPublic = Depends(get_current_user),
) -> GenerateResponse:
    req = body or GenerateRequest()
    lang = req.language.strip().lower().replace(" ", "-") or "english"
    template = req.template_choice.strip().lower().replace(" ", "-") or "modern"

    return GenerateResponse(
        cv_url=f"/downloads/cv_{job_id}_{template}_{lang}.pdf",
        cover_letter_url=f"/downloads/cover_{job_id}_{template}_{lang}.pdf",
    )


@router.post("/cv", response_model=CVUploadResponse)
async def upload_cv(
    file: UploadFile = File(...),
    current_user: UserPublic = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CVUploadResponse:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    original_name = file.filename or "cv_upload.bin"
    safe_name = f"{uuid4().hex}_{Path(original_name).name}"
    destination = UPLOADS_DIR / safe_name

    data = await file.read()
    destination.write_bytes(data)

    extracted_text = _extract_text_from_upload(data, original_name)

    current = session.get(CVData, current_user.id)
    if current:
        current.filename = safe_name
        current.extracted_text = extracted_text
        current.last_updated = datetime.now(timezone.utc)
        session.add(current)
    else:
        session.add(
            CVData(
                user_id=current_user.id,
                filename=safe_name,
                extracted_text=extracted_text,
                last_updated=datetime.now(timezone.utc),
            )
        )
    session.commit()

    return CVUploadResponse(
        success=True,
        message="CV uploaded successfully",
        filename=safe_name,
    )
