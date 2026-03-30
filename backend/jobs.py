"""
jobs.py — /api/jobs routes
"""

import sqlite3
import json
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

from database import DB_PATH
from dependencies import get_current_user
from models import UserPublic

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def init_jobs_table():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id          INTEGER NOT NULL,
            title            TEXT    NOT NULL,
            company          TEXT    NOT NULL,
            location         TEXT    NOT NULL DEFAULT '',
            url              TEXT    NOT NULL DEFAULT '',
            date_scraped     TEXT    NOT NULL DEFAULT (datetime('now')),
            description      TEXT    NOT NULL DEFAULT '',
            score            REAL,
            score_reasoning  TEXT,
            red_flags        TEXT,
            status           TEXT    NOT NULL DEFAULT 'new',
            notes            TEXT    NOT NULL DEFAULT '',
            events           TEXT    NOT NULL DEFAULT '[]',
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.commit()
    conn.close()


def row_to_job(row) -> dict:
    d = dict(row)
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


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def get_jobs(current_user: UserPublic = Depends(get_current_user)):
    init_jobs_table()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM jobs WHERE user_id = ? ORDER BY date_scraped DESC",
        (current_user.id,)
    ).fetchall()
    conn.close()
    return [row_to_job(r) for r in rows]


@router.get("/{job_id}")
def get_job(job_id: int, current_user: UserPublic = Depends(get_current_user)):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT * FROM jobs WHERE id = ? AND user_id = ?",
        (job_id, current_user.id)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return row_to_job(row)


@router.post("", status_code=201)
def create_job(body: JobCreate, current_user: UserPublic = Depends(get_current_user)):
    init_jobs_table()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.execute(
        """INSERT INTO jobs (user_id, title, company, location, url, description)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (current_user.id, body.title, body.company,
         body.location or "", body.url or "", body.description or "")
    )
    conn.commit()
    row = conn.execute("SELECT * FROM jobs WHERE id = ?", (cursor.lastrowid,)).fetchone()
    conn.close()
    return row_to_job(row)


@router.patch("/{job_id}/status")
def update_status(job_id: int, body: StatusUpdate, current_user: UserPublic = Depends(get_current_user)):
    valid = {"new", "scored", "selected", "applied", "rejected"}
    if body.status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    row = conn.execute(
        "SELECT id FROM jobs WHERE id = ? AND user_id = ?",
        (job_id, current_user.id)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Job not found")

    # Append to events log
    events_raw = conn.execute("SELECT events FROM jobs WHERE id = ?", (job_id,)).fetchone()["events"]
    events = json.loads(events_raw) if events_raw else []
    from datetime import datetime, timezone
    events.append({"type": body.status, "timestamp": datetime.now(timezone.utc).isoformat()})

    conn.execute(
        "UPDATE jobs SET status = ?, events = ? WHERE id = ?",
        (body.status, json.dumps(events), job_id)
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@router.patch("/{job_id}/notes")
def update_notes(job_id: int, body: NotesUpdate, current_user: UserPublic = Depends(get_current_user)):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT id FROM jobs WHERE id = ? AND user_id = ?",
        (job_id, current_user.id)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Job not found")
    conn.execute("UPDATE jobs SET notes = ? WHERE id = ?", (body.notes, job_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("/{job_id}", status_code=204)
def delete_job(job_id: int, current_user: UserPublic = Depends(get_current_user)):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT id FROM jobs WHERE id = ? AND user_id = ?",
        (job_id, current_user.id)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Job not found")
    conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    conn.commit()
    conn.close()
