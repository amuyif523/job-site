"""
JARVIS Backend — main.py
Run with: python -m uvicorn main:app --reload --port 8000
"""

import os
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from config import load_environment
from auth import router as auth_router
from jobs import router as jobs_router
from scraper import router as scraper_router
from routers.ai import router as ai_router
from routers.chat import router as chat_router
from routers.cv import router as cv_router
from dependencies import get_current_user
from models import UserPublic

load_environment()



@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(title="JARVIS API", version="1.0.0", lifespan=lifespan)

# In production, set FRONTEND_URL to your deployed frontend origin.
allowed_origins = [
    "http://localhost:5173",
    "http://localhost:8080",
    "http://localhost:8081",
]
frontend_url = os.getenv("FRONTEND_URL", "").strip()
if frontend_url:
    allowed_origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router,    prefix="/auth",     tags=["auth"])
app.include_router(jobs_router,    prefix="/api/jobs", tags=["jobs"])
app.include_router(scraper_router,                     tags=["scraper"])
app.include_router(ai_router,      prefix="/api",      tags=["ai"])
app.include_router(cv_router,      prefix="/api/cv",   tags=["cv"])


@app.get("/auth/me", response_model=UserPublic)
def me(current_user: UserPublic = Depends(get_current_user)):
    return current_user


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(chat_router, prefix="/api", tags=["chat"])