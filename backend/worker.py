"""Celery worker configuration for background scalability tasks."""

from __future__ import annotations

import os

from celery import Celery

from config import load_environment
from database import engine

load_environment()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0").strip()

celery_app = Celery(
    "jarvis_worker",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["scraper", "routers.ai"],
)

# Keep SQLModel engine accessible to worker tasks through shared module import.
SQLMODEL_ENGINE = engine

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
)
