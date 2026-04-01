"""LLM scoring service used by the AI router."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from google import genai

from anthropic import APIError as AnthropicAPIError
from anthropic import APIStatusError as AnthropicAPIStatusError
from anthropic import AsyncAnthropic
from openai import APIError, APIStatusError, AsyncOpenAI

from config import (
    get_anthropic_api_key,
    get_anthropic_model,
    get_gemini_api_key,
    get_gemini_model,
    get_openai_api_key,
    get_openai_model,
)


class AuthenticationError(Exception):
    """Raised when the upstream model provider rejects the API key."""


class RateLimitError(Exception):
    """Raised when the upstream model provider rate-limits requests."""


class ProviderError(Exception):
    """Raised when the model provider fails for non-auth, non-rate reasons."""


def _get_gemini_client() -> genai.Client:
    api_key = get_gemini_api_key()
    if not api_key:
        raise AuthenticationError("Missing backend Gemini API key. Set GEMINI_API_KEY.")
    return genai.Client(api_key=api_key)


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
    content = content.strip()
    if content.startswith("```"):
        content = content.strip("`")
        content = content.replace("json\n", "", 1).strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise ProviderError("Model returned invalid JSON output") from exc


def _normalize_resume_list(value: Any) -> list[Any]:
    if not isinstance(value, list):
        return []
    normalized: list[Any] = []
    for item in value:
        if isinstance(item, (str, int, float, bool)) or item is None:
            normalized.append(item)
        elif isinstance(item, dict):
            normalized.append(item)
        else:
            normalized.append(str(item))
    return normalized


def _normalize_resume_result(data: dict[str, Any]) -> dict[str, Any]:
    summary = str(data.get("summary", "")).strip()[:5000]
    skills = _normalize_resume_list(data.get("skills"))
    experience = _normalize_resume_list(data.get("experience"))
    education = _normalize_resume_list(data.get("education"))
    projects = _normalize_resume_list(data.get("projects"))
    languages = _normalize_resume_list(data.get("languages"))

    return {
        "summary": summary,
        "skills": skills,
        "experience": experience,
        "education": education,
        "projects": projects,
        "languages": languages,
    }


def _fallback_resume_parse(text: str) -> dict[str, Any]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    summary = " ".join(lines[:3])[:500]
    skill_lines = [line for line in lines if any(keyword in line.lower() for keyword in ("skill", "technolog", "tool", "stack"))]
    skills: list[str] = []
    for line in skill_lines:
        parts = [part.strip("-•,; ") for part in line.split(",")]
        skills.extend([part for part in parts if part])

    return {
        "summary": summary,
        "skills": skills[:12],
        "experience": [],
        "education": [],
        "projects": [],
        "languages": [],
    }


def _build_resume_payload(data: dict[str, Any]) -> dict[str, Any]:
    normalized = _normalize_resume_result(data)
    suggestions = data.get("suggestions")
    if not isinstance(suggestions, list):
        suggestions = []

    clean_suggestions = [str(item).strip() for item in suggestions if str(item).strip()]
    return {
        "parsed_json": normalized,
        "suggestions": clean_suggestions,
    }


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


async def parse_resume(text: str) -> str:
    """Parse raw resume text into a structured JSON string using an available LLM provider."""
    cleaned_text = text.strip()
    if not cleaned_text:
        raise ProviderError("Resume text is empty and cannot be parsed")

    try:
        if get_gemini_api_key():
            data = await asyncio.to_thread(_parse_resume_with_gemini, cleaned_text)
        elif get_openai_api_key():
            data = await _parse_resume_with_openai(cleaned_text)
        elif get_anthropic_api_key():
            data = await _parse_resume_with_anthropic(cleaned_text)
        else:
            data = _fallback_resume_parse(cleaned_text)
    except Exception:
        data = _fallback_resume_parse(cleaned_text)

    return json.dumps(_build_resume_payload(data), ensure_ascii=False)


def _parse_resume_with_gemini(cleaned_text: str) -> dict[str, Any]:
    client = _get_gemini_client()
    response = client.models.generate_content(
        model=get_gemini_model(),
        contents=(
            "Extract the candidate resume into JSON only.\n"
            "Return exactly these keys: summary, education, experience, skills, languages, projects, suggestions.\n"
            "Rules:\n"
            "- summary must be a concise paragraph.\n"
            "- education, experience, skills, languages, and projects must be arrays.\n"
            "- suggestions must be an array of short improvement tips.\n"
            "- Use empty arrays if a section is missing.\n"
            "- No markdown, no code fences, no commentary.\n\n"
            f"Resume text:\n{cleaned_text[:30000]}"
        ),
    )
    content = (response.text or "").strip()
    data = _parse_json(content)
    return data


async def _parse_resume_with_openai(cleaned_text: str) -> dict[str, Any]:
    client = AsyncOpenAI(api_key=get_openai_api_key())
    response = await client.chat.completions.create(
        model=get_openai_model(),
        messages=[
            {
                "role": "system",
                "content": (
                    "You extract resumes into valid JSON only. Return no markdown, no commentary, and no extra keys."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Extract the candidate resume into JSON only.\n"
                    "Return exactly these keys: summary, education, experience, skills, languages, projects, suggestions.\n"
                    "Rules:\n"
                    "- summary must be a concise paragraph.\n"
                    "- education, experience, skills, languages, and projects must be arrays.\n"
                    "- suggestions must be an array of short improvement tips.\n"
                    "- Use empty arrays if a section is missing.\n\n"
                    f"Resume text:\n{cleaned_text[:30000]}"
                ),
            },
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )
    content = (response.choices[0].message.content or "").strip()
    return _parse_json(content)


async def _parse_resume_with_anthropic(cleaned_text: str) -> dict[str, Any]:
    client = AsyncAnthropic(api_key=get_anthropic_api_key())
    response = await client.messages.create(
        model=get_anthropic_model(),
        max_tokens=1200,
        temperature=0,
        system=(
            "You extract resumes into valid JSON only. Return no markdown, no commentary, and no extra keys."
        ),
        messages=[
            {
                "role": "user",
                "content": (
                    "Extract the candidate resume into JSON only.\n"
                    "Return exactly these keys: summary, education, experience, skills, languages, projects, suggestions.\n"
                    "Rules:\n"
                    "- summary must be a concise paragraph.\n"
                    "- education, experience, skills, languages, and projects must be arrays.\n"
                    "- suggestions must be an array of short improvement tips.\n"
                    "- Use empty arrays if a section is missing.\n\n"
                    f"Resume text:\n{cleaned_text[:30000]}"
                ),
            }
        ],
    )
    content = "".join(
        block.text for block in response.content if hasattr(block, "text") and isinstance(block.text, str)
    ).strip()
    return _parse_json(content)


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
