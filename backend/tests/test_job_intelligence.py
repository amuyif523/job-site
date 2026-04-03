from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.job_intelligence import analyze_job_listing, infer_seniority


class JobIntelligenceTests(unittest.TestCase):
    def test_analyze_job_listing_includes_target_matches(self) -> None:
        result = analyze_job_listing(
            title="Investment Fund Risk Analytics and Data Science Analyst",
            company="Deloitte",
            location="Luxembourg",
            target_role="Data Science",
        )

        self.assertTrue(result.should_save)
        self.assertEqual(result.status, "included")
        self.assertIn("data", result.matched_keywords)
        self.assertEqual(result.source_confidence, "high")

    def test_analyze_job_listing_marks_borderline_roles(self) -> None:
        result = analyze_job_listing(
            title="Data Reporting Coordinator",
            company="Lufthansa",
            location="Berlin",
            target_role="Data Science",
        )

        self.assertTrue(result.should_save)
        self.assertEqual(result.status, "included")
        self.assertIn("data", result.matched_keywords)

    def test_analyze_job_listing_excludes_clear_mismatches(self) -> None:
        result = analyze_job_listing(
            title="Senior Account Manager - Enterprise Sales",
            company="Acme",
            location="Remote",
            target_role="Data Science",
        )

        self.assertFalse(result.should_save)
        self.assertEqual(result.status, "excluded")
        self.assertIn("sales", result.blocked_keywords)

    def test_infer_seniority_handles_internships(self) -> None:
        self.assertEqual(infer_seniority("Working Student Data Analyst"), "internship")


if __name__ == "__main__":
    unittest.main()
