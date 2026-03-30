"""LLM scoring service used by the AI router."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from anthropic import APIError as AnthropicAPIError
from anthropic import APIStatusError as AnthropicAPIStatusError
from anthropic import AsyncAnthropic
from openai import APIError, APIStatusError, AsyncOpenAI

from config import (
    get_anthropic_api_key,
    get_anthropic_model,
    get_openai_api_key,
    get_openai_model,
)


class AuthenticationError(Exception):
    """Raised when the upstream model provider rejects the API key."""


class RateLimitError(Exception):
    """Raised when the upstream model provider rate-limits requests."""


class ProviderError(Exception):
    """Raised when the model provider fails for non-auth, non-rate reasons."""


def _status_from_score(score: int) -> str:
    if score >= 85:
        return "Excellent"
    if score >= 70:
        return "Good"
    if score >= 50:
        return "Fair"
    return "Poor"


def _normalize_status(value: Any, score: int) -> str:
    if not isinstance(value, str):
        return _status_from_score(score)
    lowered = value.strip().lower()
    if lowered == "excellent":
        return "Excellent"
    if lowered == "good":
        return "Good"
    if lowered == "fair":
        return "Fair"
    if lowered == "poor":
        return "Poor"
    return _status_from_score(score)


def _parse_json(content: str) -> dict[str, Any]:
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise ProviderError("Model returned invalid JSON output") from exc


def _build_messages(cv_text: str, job_description: str) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "You are a strict hiring evaluator. Compare a candidate CV with a job description and "
                "return only valid JSON. No markdown, no extra keys."
            ),
        },
        {
            "role": "user",
            "content": (
                "Score this CV against the job description.\n"
                "Rules:\n"
                "- compatibility_score must be an integer from 0 to 100.\n"
                "- match_status must be one of: Excellent, Good, Fair, Poor.\n"
                "- reasoning must be a concise explanation (max 2 sentences).\n"
                "Return JSON with exactly these keys: compatibility_score, match_status, reasoning.\n\n"
                f"CV:\n{cv_text}\n\n"
                f"Job Description:\n{job_description}"
            ),
        },
    ]


async def get_score_from_ai(
    cv_text: str,
    job_description: str,
) -> dict:
    """Return AI score payload for one job using a structured LLM response."""
    if not cv_text.strip():
        raise ProviderError("CV text is empty and cannot be scored")

    anthropic_key = get_anthropic_api_key()
    openai_key = get_openai_api_key()

    if not anthropic_key and not openai_key:
        raise AuthenticationError("Missing backend model provider key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.")

    if anthropic_key:
        return await _score_with_anthropic(
            api_key=anthropic_key,
            model=get_anthropic_model(),
            cv_text=cv_text,
            job_description=job_description,
        )

    return await _score_with_openai(
        api_key=openai_key,
        model=get_openai_model(),
        cv_text=cv_text,
        job_description=job_description,
    )


def _normalize_result(data: dict[str, Any]) -> dict[str, Any]:
    raw_score = data.get("compatibility_score", 0)
    score = max(0, min(100, int(raw_score)))
    status = _normalize_status(data.get("match_status"), score)
    reasoning = str(data.get("reasoning", "")).strip()[:500]

    if not reasoning:
        reasoning = "No reasoning provided by model."

    return {
        "compatibility_score": score,
        "match_status": status,
        "reasoning": reasoning,
    }


async def _score_with_openai(
    api_key: str,
    model: str,
    cv_text: str,
    job_description: str,
) -> dict[str, Any]:
    client = AsyncOpenAI(api_key=api_key)

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=_build_messages(cv_text=cv_text[:30000], job_description=job_description[:12000]),
            temperature=0,
            response_format={"type": "json_object"},
        )
        content = (response.choices[0].message.content or "").strip()
        data = _parse_json(content)
        return _normalize_result(data)
    except APIStatusError as exc:
        if exc.status_code in (401, 403):
            raise AuthenticationError("Invalid backend OpenAI API key") from exc
        if exc.status_code == 429:
            raise RateLimitError("OpenAI rate limit exceeded") from exc
        raise ProviderError(f"OpenAI request failed with status {exc.status_code}") from exc
    except APIError as exc:
        raise ProviderError("OpenAI request failed") from exc
    except ValueError as exc:
        raise ProviderError("Model returned an invalid score format") from exc
    finally:
        # Keep the coroutine scheduling point in place for large batches.
        await asyncio.sleep(0)


async def _score_with_anthropic(
    api_key: str,
    model: str,
    cv_text: str,
    job_description: str,
) -> dict[str, Any]:
    client = AsyncAnthropic(api_key=api_key)

    user_prompt = (
        "Score this CV against the job description.\n"
        "Rules:\n"
        "- compatibility_score must be an integer from 0 to 100.\n"
        "- match_status must be one of: Excellent, Good, Fair, Poor.\n"
        "- reasoning must be a concise explanation (max 2 sentences).\n"
        "Return JSON with exactly these keys: compatibility_score, match_status, reasoning.\n\n"
        f"CV:\n{cv_text[:30000]}\n\n"
        f"Job Description:\n{job_description[:12000]}"
    )

    try:
        response = await client.messages.create(
            model=model,
            max_tokens=350,
            temperature=0,
            system=(
                "You are a strict hiring evaluator. Compare a candidate CV with a job description and "
                "return only valid JSON. No markdown, no extra keys."
            ),
            messages=[{"role": "user", "content": user_prompt}],
        )

        content = "".join(
            block.text for block in response.content if hasattr(block, "text") and isinstance(block.text, str)
        ).strip()
        data = _parse_json(content)
        return _normalize_result(data)
    except AnthropicAPIStatusError as exc:
        if exc.status_code in (401, 403):
            raise AuthenticationError("Invalid backend Anthropic API key") from exc
        if exc.status_code == 429:
            raise RateLimitError("Anthropic rate limit exceeded") from exc
        raise ProviderError(f"Anthropic request failed with status {exc.status_code}") from exc
    except AnthropicAPIError as exc:
        raise ProviderError("Anthropic request failed") from exc
    except ValueError as exc:
        raise ProviderError("Model returned an invalid score format") from exc
    finally:
        # Keep the coroutine scheduling point in place for large batches.
        await asyncio.sleep(0)
