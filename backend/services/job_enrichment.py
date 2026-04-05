from __future__ import annotations

import asyncio
import json
import re
import ssl
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from collections.abc import Sequence
from typing import Any

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, async_playwright

MAX_DESCRIPTION_LENGTH = 12000
MAX_LISTING_SUMMARY_LENGTH = 1000
MIN_SUMMARY_DESCRIPTION_LENGTH = 200
MIN_SCORING_DESCRIPTION_LENGTH = 600
MIN_DESCRIPTION_LENGTH = MIN_SUMMARY_DESCRIPTION_LENGTH
HTML_TIMEOUT_SECONDS = 12
HTML_FETCH_RETRIES = 2
HTML_CONCURRENCY = 4
PLAYWRIGHT_FALLBACK_BATCH_SIZE = 8
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
JS_HEAVY_HINTS = (
    "enable javascript",
    "javascript is required",
    "please turn on javascript",
    "__next",
    "webpack",
    "hydrate",
)


@dataclass
class EnrichmentAttempt:
    description: str = ""
    method: str = ""
    duration_ms: int = 0
    error: str = ""
    retryable: bool = False
    quality: str = "summary"


class _HTMLTextCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._capture_depth = 0
        self._skip_depth = 0
        self.body_chunks: list[str] = []
        self.focus_chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): (value or "") for key, value in attrs}
        if tag in {"script", "style", "noscript"}:
            self._skip_depth += 1
            return
        attr_blob = " ".join(attrs_dict.values()).lower()
        if tag in {"article", "main", "section"} or "description" in attr_blob or "content" in attr_blob:
            self._capture_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"} and self._skip_depth > 0:
            self._skip_depth -= 1
            return
        if tag in {"article", "main", "section"} and self._capture_depth > 0:
            self._capture_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        cleaned = _collapse_whitespace(data)
        if not cleaned:
            return
        self.body_chunks.append(cleaned)
        if self._capture_depth > 0:
            self.focus_chunks.append(cleaned)


def _collapse_whitespace(value: str) -> str:
    cleaned = re.sub(r"<[^>]+>", " ", value or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:MAX_DESCRIPTION_LENGTH]


def normalize_listing_summary(value: str) -> str:
    return _collapse_whitespace(value)[:MAX_LISTING_SUMMARY_LENGTH]


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


def _count_keyword_hits(value: str) -> int:
    lowered = normalize_job_description(value).lower()
    return sum(1 for keyword in KEYWORD_HINTS if keyword in lowered)


def classify_description_quality(value: str) -> str:
    normalized = normalize_job_description(value)
    if not normalized:
        return "summary"

    keyword_hits = _count_keyword_hits(normalized)
    if len(normalized) < MIN_SUMMARY_DESCRIPTION_LENGTH or keyword_hits == 0:
        return "summary"

    if len(normalized) < MIN_SCORING_DESCRIPTION_LENGTH or keyword_hits < 3:
        return "partial"

    return "full"


def has_high_fidelity_description(value: str) -> bool:
    return classify_description_quality(value) == "full"


def _extract_json_ld_candidates_from_html(html: str) -> list[str]:
    candidates: list[str] = []
    for match in re.findall(r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", html, flags=re.I | re.S):
        if not match.strip():
            continue
        try:
            parsed = json.loads(match)
        except json.JSONDecodeError:
            continue
        candidates.extend(_iter_json_candidates(parsed))
    return candidates


def _extract_html_candidates(html: str) -> list[str]:
    collector = _HTMLTextCollector()
    collector.feed(html)
    candidates: list[str] = []
    if collector.focus_chunks:
        candidates.append(" ".join(collector.focus_chunks))
    if collector.body_chunks:
        candidates.append(" ".join(collector.body_chunks))
    candidates.extend(_extract_json_ld_candidates_from_html(html))
    return candidates


def _looks_js_heavy(html: str) -> bool:
    lowered = html.lower()
    return any(hint in lowered for hint in JS_HEAVY_HINTS)


def _fetch_html_sync(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    context = ssl.create_default_context()
    with urlopen(request, timeout=HTML_TIMEOUT_SECONDS, context=context) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="ignore")


async def _fetch_html(url: str) -> str:
    return await asyncio.wait_for(asyncio.to_thread(_fetch_html_sync, url), timeout=HTML_TIMEOUT_SECONDS + 1)


async def _extract_with_html(url: str) -> EnrichmentAttempt:
    start = time.perf_counter()
    last_error = ""
    for attempt in range(HTML_FETCH_RETRIES):
        try:
            html = await _fetch_html(url)
            candidates = _extract_html_candidates(html)
            description = _pick_best_candidate(candidates)
            quality = classify_description_quality(description)
            duration_ms = int((time.perf_counter() - start) * 1000)
            if quality == "full" and not _looks_js_heavy(html):
                return EnrichmentAttempt(
                    description=description,
                    method="html",
                    duration_ms=duration_ms,
                    error="",
                    retryable=False,
                    quality=quality,
                )
            if quality in {"partial", "full"} and _looks_js_heavy(html):
                return EnrichmentAttempt(
                    description=description,
                    method="html",
                    duration_ms=duration_ms,
                    error="HTML extraction looks JS-rendered; falling back to Playwright.",
                    retryable=True,
                    quality=quality,
                )
            if quality == "partial":
                return EnrichmentAttempt(
                    description=description,
                    method="html",
                    duration_ms=duration_ms,
                    error="HTML extraction was incomplete; falling back to Playwright.",
                    retryable=True,
                    quality=quality,
                )
            return EnrichmentAttempt(
                description=description,
                method="html",
                duration_ms=duration_ms,
                error="HTML extraction only found a listing summary.",
                retryable=False,
                quality=quality,
            )
        except (asyncio.TimeoutError, URLError, HTTPError) as exc:
            last_error = str(exc)
            if attempt + 1 < HTML_FETCH_RETRIES:
                await asyncio.sleep(0.35 * (attempt + 1))
                continue
            break
        except Exception as exc:
            last_error = str(exc)
            break

    return EnrichmentAttempt(
        description="",
        method="html",
        duration_ms=int((time.perf_counter() - start) * 1000),
        error=last_error or "HTML extraction failed.",
        retryable=False,
        quality="summary",
    )


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
    body_text = _collapse_whitespace(await page.evaluate("() => document.body ? document.body.innerText : ''"))
    candidates = [*json_ld_candidates, *selector_candidates]
    if body_text:
        candidates.append(body_text)
    return _pick_best_candidate(candidates)


async def _extract_with_playwright_batch(job_targets: Sequence[tuple[int, str]]) -> dict[int, EnrichmentAttempt]:
    if not job_targets:
        return {}

    attempts: dict[int, EnrichmentAttempt] = {}
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
        await page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

        try:
            for job_id, url in job_targets[:PLAYWRIGHT_FALLBACK_BATCH_SIZE]:
                start = time.perf_counter()
                try:
                    description = await _extract_job_description(page, url)
                    quality = classify_description_quality(description)
                    attempts[job_id] = EnrichmentAttempt(
                        description=description,
                        method="playwright",
                        duration_ms=int((time.perf_counter() - start) * 1000),
                        error="" if description else "Playwright could not find a usable description.",
                        retryable=False,
                        quality=quality,
                    )
                except Exception as exc:
                    attempts[job_id] = EnrichmentAttempt(
                        description="",
                        method="playwright",
                        duration_ms=int((time.perf_counter() - start) * 1000),
                        error=str(exc),
                        retryable=False,
                        quality="summary",
                    )
        finally:
            await browser.close()

    return attempts


async def fetch_job_enrichment_map(job_targets: Sequence[tuple[int, str]]) -> dict[int, EnrichmentAttempt]:
    valid_targets = [(job_id, url.strip()) for job_id, url in job_targets if job_id and url and url.strip()]
    if not valid_targets:
        return {}

    semaphore = asyncio.Semaphore(HTML_CONCURRENCY)
    html_attempts: dict[int, EnrichmentAttempt] = {}

    async def enrich_html(job_id: int, url: str) -> None:
        async with semaphore:
            html_attempts[job_id] = await _extract_with_html(url)

    await asyncio.gather(*(enrich_html(job_id, url) for job_id, url in valid_targets))

    fallback_targets = [
        (job_id, url)
        for job_id, url in valid_targets
        if (
            not has_high_fidelity_description(html_attempts.get(job_id, EnrichmentAttempt()).description)
            and html_attempts.get(job_id, EnrichmentAttempt()).retryable
        )
    ]

    playwright_attempts: dict[int, EnrichmentAttempt] = {}
    if fallback_targets:
        playwright_attempts = await _extract_with_playwright_batch(fallback_targets)
    attempts = dict(html_attempts)
    for job_id, attempt in playwright_attempts.items():
        html_attempt = html_attempts.get(job_id)
        if has_high_fidelity_description(attempt.description):
            attempts[job_id] = attempt
            continue

        if html_attempt is None:
            attempts[job_id] = attempt
            continue

        if not html_attempt.description and attempt.description:
            attempts[job_id] = attempt
    return attempts


async def fetch_job_description_map(job_targets: Sequence[tuple[int, str]]) -> dict[int, str]:
    attempts = await fetch_job_enrichment_map(job_targets)
    return {
        job_id: attempt.description
        for job_id, attempt in attempts.items()
        if has_high_fidelity_description(attempt.description)
    }
