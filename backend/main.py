"""
JARVIS Backend — main.py
Run with: python -m uvicorn main:app --reload --port 8000
"""

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from config import load_environment
from database import init_db
from auth import router as auth_router
from jobs import router as jobs_router, init_jobs_table
from scraper import router as scraper_router
from routers.ai import router as ai_router
from routers.chat import router as chat_router
from dependencies import get_current_user
from models import UserPublic

load_environment()



@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    init_jobs_table()
    yield

app = FastAPI(title="JARVIS API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router,    prefix="/auth",     tags=["auth"])
app.include_router(jobs_router,    prefix="/api/jobs", tags=["jobs"])
app.include_router(scraper_router,                     tags=["scraper"])
app.include_router(ai_router,      prefix="/api",      tags=["ai"])


@app.get("/auth/me", response_model=UserPublic)
def me(current_user: UserPublic = Depends(get_current_user)):
    return current_user


@app.get("/health")
def health():
    return {"status": "ok"}


# DEV: seed fake jobs — DELETE BEFORE PRODUCTION
@app.post("/dev/seed-jobs", tags=["dev"])
def seed_jobs(current_user: UserPublic = Depends(get_current_user)):
    import sqlite3, json
    from database import DB_PATH
    from datetime import datetime, timezone

    fake_jobs = [
        {"title": "Senior Data Scientist", "company": "DeepMind", "location": "Munich, DE", "url": "https://deepmind.com/careers", "description": "Work on cutting-edge ML research. Python, PyTorch required.", "score": 92, "score_reasoning": json.dumps(["Strong Python match", "ML experience aligns"]), "red_flags": json.dumps([]), "status": "new"},
        {"title": "ML Engineer", "company": "Aleph Alpha", "location": "Heidelberg, DE", "url": "https://aleph-alpha.com/careers", "description": "Build and deploy large language models.", "score": 85, "score_reasoning": json.dumps(["LLM experience relevant"]), "red_flags": json.dumps(["Requires German"]), "status": "new"},
        {"title": "Data Analyst", "company": "BMW Group", "location": "Munich, DE", "url": "https://bmwgroup.jobs", "description": "Analyse production data. SQL, Python, Tableau.", "score": 61, "score_reasoning": json.dumps(["SQL match"]), "red_flags": json.dumps(["Heavy Tableau requirement"]), "status": "scored"},
        {"title": "Research Scientist", "company": "Siemens AI Lab", "location": "Erlangen, DE", "url": "https://siemens.com/careers", "description": "Research applied AI. PhD preferred.", "score": 44, "score_reasoning": json.dumps(["Partial match"]), "red_flags": json.dumps(["PhD required"]), "status": "new"},
        {"title": "Product Data Scientist", "company": "N26", "location": "Berlin, DE", "url": "https://n26.com/careers", "description": "Drive product decisions with data. A/B testing, Python.", "score": 78, "score_reasoning": json.dumps(["A/B testing match"]), "red_flags": json.dumps(["Fintech domain new"]), "status": "selected"},
    ]

    conn = sqlite3.connect(DB_PATH)
    now = datetime.now(timezone.utc).isoformat()
    for j in fake_jobs:
        conn.execute("""
            INSERT INTO jobs (user_id, title, company, location, url, description,
                              score, score_reasoning, red_flags, status, date_scraped)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (current_user.id, j["title"], j["company"], j["location"], j["url"],
              j["description"], j["score"], j["score_reasoning"], j["red_flags"], j["status"], now))
    conn.commit()
    conn.close()
    return {"seeded": len(fake_jobs)}


app.include_router(chat_router, prefix="/api", tags=["chat"])