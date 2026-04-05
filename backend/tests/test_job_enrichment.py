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
    async def test_fetch_job_enrichment_map_prefers_html_when_complete(self) -> None:
        with patch.object(
            job_enrichment,
            "_extract_with_html",
            new=AsyncMock(
                return_value=job_enrichment.EnrichmentAttempt(
                    description="Strong role description " * 20,
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
                    description="Short description",
                    method="html",
                    duration_ms=80,
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
                        description="Full Playwright description " * 20,
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


if __name__ == "__main__":
    unittest.main()
