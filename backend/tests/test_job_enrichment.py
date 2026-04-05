from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services import job_enrichment


class JobEnrichmentTests(unittest.IsolatedAsyncioTestCase):
    def test_classify_description_quality_distinguishes_summary_partial_and_full(self) -> None:
        self.assertEqual(job_enrichment.classify_description_quality("Hiring for an engineer role."), "summary")
        self.assertEqual(
            job_enrichment.classify_description_quality(
                "Responsibilities include Python APIs, SQL dashboards, experimentation, stakeholder management, and delivery ownership. "
                * 3
            ),
            "partial",
        )
        self.assertEqual(
            job_enrichment.classify_description_quality(
                "Responsibilities and requirements include Python APIs, SQL dashboards, experimentation, stakeholder management, skills coaching, and experience with delivery ownership. "
                * 8
            ),
            "full",
        )

    async def test_fetch_job_enrichment_map_prefers_html_when_complete(self) -> None:
        with patch.object(
            job_enrichment,
            "_extract_with_html",
            new=AsyncMock(
                return_value=job_enrichment.EnrichmentAttempt(
                    description="Strong role description " * 30,
                    method="html",
                    duration_ms=120,
                    error="",
                    retryable=False,
                )
            ),
        ), patch.object(
            job_enrichment,
            "_extract_with_playwright_batch",
            new=AsyncMock(return_value={}),
        ) as playwright_mock:
            result = await job_enrichment.fetch_job_enrichment_map([(1, "https://example.com/job/1")])

        self.assertIn(1, result)
        self.assertEqual(result[1].method, "html")
        playwright_mock.assert_not_called()

    async def test_fetch_job_enrichment_map_falls_back_to_playwright_when_html_is_incomplete(self) -> None:
        with patch.object(
            job_enrichment,
            "_extract_with_html",
            new=AsyncMock(
                return_value=job_enrichment.EnrichmentAttempt(
                    description="Responsibilities include Python APIs, SQL dashboards, experimentation, and stakeholder communication." * 2,
                    method="html",
                    duration_ms=80,
                    error="HTML extraction was incomplete; falling back to Playwright.",
                    retryable=True,
                    quality="partial",
                )
            ),
        ), patch.object(
            job_enrichment,
            "_extract_with_playwright_batch",
            new=AsyncMock(
                return_value={
                    1: job_enrichment.EnrichmentAttempt(
                        description=(
                            "Responsibilities and requirements include Python APIs, SQL dashboards, experimentation, stakeholder communication, and experience owning delivery outcomes. "
                            * 6
                        ),
                        method="playwright",
                        duration_ms=900,
                        error="",
                        retryable=False,
                    )
                }
            ),
        ):
            result = await job_enrichment.fetch_job_enrichment_map([(1, "https://example.com/job/1")])

        self.assertEqual(result[1].method, "playwright")
        self.assertTrue(job_enrichment.has_high_fidelity_description(result[1].description))

    async def test_fetch_job_enrichment_map_keeps_html_attempt_when_fallback_fails(self) -> None:
        with patch.object(
            job_enrichment,
            "_extract_with_html",
            new=AsyncMock(
                return_value=job_enrichment.EnrichmentAttempt(
                    description="Short description",
                    method="html",
                    duration_ms=95,
                    error="HTML extraction was incomplete; falling back to Playwright.",
                    retryable=True,
                )
            ),
        ), patch.object(
            job_enrichment,
            "_extract_with_playwright_batch",
            new=AsyncMock(
                return_value={
                    1: job_enrichment.EnrichmentAttempt(
                        description="",
                        method="playwright",
                        duration_ms=1100,
                        error="browser launch failed",
                        retryable=False,
                    )
                }
            ),
        ):
            result = await job_enrichment.fetch_job_enrichment_map([(1, "https://example.com/job/1")])

        self.assertEqual(result[1].method, "html")
        self.assertTrue(result[1].retryable)

    async def test_fetch_job_enrichment_map_skips_playwright_for_listing_summary_only_results(self) -> None:
        with patch.object(
            job_enrichment,
            "_extract_with_html",
            new=AsyncMock(
                return_value=job_enrichment.EnrichmentAttempt(
                    description="Data Engineer",
                    method="html",
                    duration_ms=42,
                    error="HTML extraction only found a listing summary.",
                    retryable=False,
                    quality="summary",
                )
            ),
        ), patch.object(
            job_enrichment,
            "_extract_with_playwright_batch",
            new=AsyncMock(return_value={}),
        ) as playwright_mock:
            result = await job_enrichment.fetch_job_enrichment_map([(1, "https://example.com/job/1")])

        self.assertEqual(result[1].quality, "summary")
        playwright_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
