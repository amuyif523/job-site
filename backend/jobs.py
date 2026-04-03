"""
jobs.py — /api/jobs routes
"""

import json
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlmodel import Session, select

from database import get_session
from dependencies import get_current_user
from models import Job, UserPublic
from services.job_enrichment import has_high_fidelity_description, normalize_job_description

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def init_jobs_table():
    # SQLModel metadata creation runs in database.init_db().
    return None


def job_to_dict(job: Job) -> dict:
    d = job.model_dump()
    d["score_reasoning"] = json.loads(d["score_reasoning"]) if d["score_reasoning"] else None
    d["red_flags"]        = json.loads(d["red_flags"])       if d["red_flags"]        else None
    d["events"]           = json.loads(d["events"])          if d["events"]           else []
    return d


# ── Schemas ───────────────────────────────────────────────────────────────────

class StatusUpdate(BaseModel):
    status: str

class NotesUpdate(BaseModel):
    notes: str

class JobCreate(BaseModel):
    title:       str
    company:     str
    location:    Optional[str] = ""
    url:         Optional[str] = ""
    description: Optional[str] = ""


def _derive_manual_job_readiness(description: str) -> tuple[str, bool]:
    if has_high_fidelity_description(description):
        return ("ready", True)
    if description:
        return ("partial", False)
    return ("missing", False)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def get_jobs(
    current_user: UserPublic = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    rows = session.exec(
        select(Job).where(Job.user_id == current_user.id).order_by(Job.date_scraped.desc())
    ).all()
    return [job_to_dict(r) for r in rows]


@router.get("/{job_id}")
def get_job(
    job_id: int,
    current_user: UserPublic = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    row = session.exec(
        select(Job).where(Job.id == job_id, Job.user_id == current_user.id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_to_dict(row)


@router.post("", status_code=201)
def create_job(
    body: JobCreate,
    current_user: UserPublic = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    normalized_description = normalize_job_description(body.description or "")
    enrichment_status, scoring_ready = _derive_manual_job_readiness(normalized_description)
    row = Job(
        user_id=current_user.id,
        title=body.title,
        company=body.company,
        location=body.location or "",
        url=body.url or "",
        description=normalized_description,
        enrichment_status=enrichment_status,
        scoring_ready=scoring_ready,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return job_to_dict(row)


@router.patch("/{job_id}/status")
def update_status(
    job_id: int,
    body: StatusUpdate,
    current_user: UserPublic = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    valid = {"new", "scored", "selected", "applied", "interviewing", "offered", "rejected"}
    if body.status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid}")

    row = session.exec(
        select(Job).where(Job.id == job_id, Job.user_id == current_user.id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    # Append to events log
    events_raw = row.events
    events = json.loads(events_raw) if events_raw else []
    events.append({"type": body.status, "timestamp": datetime.now(timezone.utc).isoformat()})

    row.status = body.status
    row.events = json.dumps(events)
    session.add(row)
    session.commit()
    return {"ok": True}


@router.patch("/{job_id}/notes")
def update_notes(
    job_id: int,
    body: NotesUpdate,
    current_user: UserPublic = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    row = session.exec(
        select(Job).where(Job.id == job_id, Job.user_id == current_user.id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    row.notes = body.notes
    session.add(row)
    session.commit()
    return {"ok": True}


@router.delete("/{job_id}", status_code=204)
def delete_job(
    job_id: int,
    current_user: UserPublic = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    row = session.exec(
        select(Job).where(Job.id == job_id, Job.user_id == current_user.id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    session.delete(row)
    session.commit()
