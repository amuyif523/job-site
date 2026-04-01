"""Centralized backend configuration and environment loading."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

_ENV_LOADED = False


def load_environment() -> None:
    """Load backend/.env once per process."""
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    env_path = Path(__file__).resolve().parent / ".env"
    load_dotenv(dotenv_path=env_path, override=False)
    _ENV_LOADED = True


def get_anthropic_api_key() -> str:
    load_environment()
    return os.getenv("ANTHROPIC_API_KEY", "").strip()


def get_openai_api_key() -> str:
    load_environment()
    return os.getenv("OPENAI_API_KEY", "").strip()


def get_openai_model() -> str:
    load_environment()
    return os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"


def get_anthropic_model() -> str:
    load_environment()
    return os.getenv("ANTHROPIC_MODEL", "claude-3-5-haiku-latest").strip() or "claude-3-5-haiku-latest"


def get_gemini_api_key() -> str:
    load_environment()
    return os.getenv("GEMINI_API_KEY", "").strip()


def get_gemini_model() -> str:
    load_environment()
    return os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip() or "gemini-2.0-flash"
