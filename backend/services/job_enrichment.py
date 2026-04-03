from __future__ import annotations

import json
import re
from collections.abc import Sequence
from typing import Any

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, async_playwright

MAX_DESCRIPTION_LENGTH = 12000
MIN_SCORING_DESCRIPTION_LENGTH = 200
MIN_DESCRIPTION_LENGTH = MIN_SCORING_DESCRIPTION_LENGTH
JOB_DESCRIPTION_SELECTORS = (
    "[data-testid*='description']",
    "[class*='description']",
    "[class*='jobDescription']",
    "[class*='job-description']",
    "[class*='content']",
    "article",
    "main",
)
DESCRIPTION_KEYS = {
    "description",
    "jobdescription",
    "job_description",
    "articlebody",
    "responsibilities",
    "qualifications",
    "requirements",
    "skills",
}
KEYWORD_HINTS = (
    "responsibilities",
    "requirements",
    "qualifications",
    "skills",
    "experience",
    "apply",
    "role",
    "about",
)


def _collapse_whitespace(value: str) -> str:
    cleaned = re.sub(r"<[^>]+>", " ", value or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:MAX_DESCRIPTION_LENGTH]


def _iter_json_candidates(value: Any) -> list[str]:
    results: list[str] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized_key = str(key).replace("-", "").replace("_", "").lower()
            if normalized_key in DESCRIPTION_KEYS and isinstance(nested, str):
                text = _collapse_whitespace(nested)
                if text:
                    results.append(text)
            results.extend(_iter_json_candidates(nested))
    elif isinstance(value, list):
        for item in value:
            results.extend(_iter_json_candidates(item))
    return results


def _score_candidate(text: str) -> tuple[int, int]:
    lowered = text.lower()
    keyword_hits = sum(1 for keyword in KEYWORD_HINTS if keyword in lowered)
    return (keyword_hits, len(text))


def _pick_best_candidate(candidates: Sequence[str]) -> str:
    usable = [_collapse_whitespace(candidate) for candidate in candidates]
    usable = [candidate for candidate in usable if len(candidate) >= MIN_DESCRIPTION_LENGTH]
    if not usable:
        return ""
    usable.sort(key=_score_candidate, reverse=True)
    return usable[0][:MAX_DESCRIPTION_LENGTH]


def normalize_job_description(value: str) -> str:
    return _collapse_whitespace(value)


def has_high_fidelity_description(value: str) -> bool:
    return len(normalize_job_description(value)) >= MIN_SCORING_DESCRIPTION_LENGTH


async def _collect_selector_candidates(page: Page) -> list[str]:
    candidates: list[str] = []
    for selector in JOB_DESCRIPTION_SELECTORS:
        elements = await page.query_selector_all(selector)
        for element in elements[:4]:
            try:
                text = _collapse_whitespace(await element.inner_text())
            except Exception:
                continue
            if text:
                candidates.append(text)
    return candidates


async def _collect_json_ld_candidates(page: Page) -> list[str]:
    candidates: list[str] = []
    scripts = await page.query_selector_all("script[type='application/ld+json']")
    for script in scripts[:8]:
        try:
            raw = await script.inner_text()
        except Exception:
            continue
        if not raw.strip():
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        candidates.extend(_iter_json_candidates(parsed))
    return candidates


async def _extract_job_description(page: Page, url: str) -> str:
    try:
        await page.goto(url, wait_until="networkidle", timeout=30000)
    except PlaywrightTimeoutError:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)

    selector_candidates = await _collect_selector_candidates(page)
    json_ld_candidates = await _collect_json_ld_candidates(page)
    body_text = _collapse_whitespace(
        await page.evaluate("() => document.body ? document.body.innerText : ''")
    )
    candidates = [*json_ld_candidates, *selector_candidates]
    if body_text:
        candidates.append(body_text)
    return _pick_best_candidate(candidates)


async def fetch_job_description_map(job_targets: Sequence[tuple[int, str]]) -> dict[int, str]:
    valid_targets = [(job_id, url.strip()) for job_id, url in job_targets if job_id and url and url.strip()]
    if not valid_targets:
        return {}

    descriptions: dict[int, str] = {}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="en-US",
        )
        page = await context.new_page()
        await page.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )

        try:
            for job_id, url in valid_targets:
                try:
                    description = await _extract_job_description(page, url)
                except Exception:
                    continue
                if description:
                    descriptions[job_id] = description
        finally:
            await browser.close()

    return descriptions
