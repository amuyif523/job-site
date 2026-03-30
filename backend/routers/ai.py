"""AI routes for CV ingestion and parallel job scoring."""

from __future__ import annotations

import asyncio
import io
import sqlite3
from pathlib import Path
from typing import List
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, File, Header, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from pypdf import PdfReader

from auth import get_current_user
from database import DB_PATH
from models import UserPublic
from services import llm_service

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


def _fetch_cv_text(user_id: int) -> str:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        """
        SELECT extracted_text
        FROM cv_data
        WHERE user_id = ?
        ORDER BY last_updated DESC
        LIMIT 1
        """,
        (user_id,),
    ).fetchone()
    conn.close()
    return row["extracted_text"] if row else ""


def _fetch_jobs(user_id: int, job_ids: List[int]) -> List[sqlite3.Row]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    if job_ids:
        placeholders = ",".join("?" for _ in job_ids)
        rows = conn.execute(
            f"""
            SELECT id, description
            FROM jobs
            WHERE user_id = ? AND id IN ({placeholders})
            """,
            (user_id, *job_ids),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT id, description
            FROM jobs
            WHERE user_id = ?
            """,
            (user_id,),
        ).fetchall()

    conn.close()
    return rows


@router.post("/score-all", response_model=ScoreResponse)
async def score_all(
    body: ScoreRequest | None = Body(default=None),
    x_api_key: str | None = Header(default=None, alias="x-api-key"),
    current_user: UserPublic = Depends(get_current_user),
) -> ScoreResponse:
    req = body or ScoreRequest()
    cv_text = _fetch_cv_text(current_user.id)
    if not cv_text.strip():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No CV extracted text found")

    job_rows = _fetch_jobs(current_user.id, req.job_ids)
    if not job_rows:
        return ScoreResponse(scored=0, results=[], errors=["No matching jobs found to score"])

    tasks = [
        llm_service.get_score_from_ai(
            cv_text=cv_text,
            job_description=row["description"] or "",
            user_api_key=x_api_key,
        )
        for row in job_rows
    ]

    try:
        ai_results = await asyncio.gather(*tasks, return_exceptions=True)
    except llm_service.AuthenticationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except llm_service.RateLimitError as exc:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc)) from exc

    results: List[ScoreResult] = []
    errors: List[str] = []
    for row, item in zip(job_rows, ai_results):
        if isinstance(item, llm_service.AuthenticationError):
            errors.append(f"job_id={int(row['id'])}: {item}")
            continue
        if isinstance(item, llm_service.RateLimitError):
            errors.append(f"job_id={int(row['id'])}: {item}")
            continue
        if isinstance(item, llm_service.ProviderError):
            errors.append(f"job_id={int(row['id'])}: {item}")
            continue
        if isinstance(item, Exception):
            errors.append(f"job_id={int(row['id'])}: unexpected scoring error")
            continue

        results.append(
            ScoreResult(
                job_id=int(row["id"]),
                compatibility_score=int(item.get("compatibility_score", 0)),
                match_status=str(item.get("match_status", "Poor")),
                reasoning=str(item.get("reasoning", "No reasoning provided.")),
            )
        )

    if errors and not results:
        return ScoreResponse(scored=0, results=[], errors=errors)

    return ScoreResponse(scored=len(results), results=results, errors=errors)


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
) -> CVUploadResponse:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    original_name = file.filename or "cv_upload.bin"
    safe_name = f"{uuid4().hex}_{Path(original_name).name}"
    destination = UPLOADS_DIR / safe_name

    data = await file.read()
    destination.write_bytes(data)

    extracted_text = _extract_text_from_upload(data, original_name)

    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        INSERT OR REPLACE INTO cv_data (user_id, filename, extracted_text, last_updated)
        VALUES (?, ?, ?, datetime('now'))
        """,
        (current_user.id, safe_name, extracted_text),
    )
    conn.commit()
    conn.close()

    return CVUploadResponse(
        success=True,
        message="CV uploaded successfully",
        filename=safe_name,
    )
