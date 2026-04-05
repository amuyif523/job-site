from __future__ import annotations

import sys
import unittest
from collections.abc import Generator
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main
from models import Job, User, UserPublic
from routers import ai as ai_router
from routers import admin as admin_router
import scraper as scraper_router
from services import operational_visibility


class AdminRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)
        operational_visibility.reset_for_tests()
        ai_router.ACTIVE_SCORE_TASKS.clear()
        scraper_router.ACTIVE_SCRAPE_TASKS.clear()

        with Session(self.engine) as session:
            session.add(
                User(
                    id=1,
                    name="Admin Tester",
                    email="admin@example.com",
                    hashed_pw="hashed",
                    target_role="Engineer",
                    plan="pro",
                )
            )
            session.add(
                Job(
                    id=101,
                    user_id=1,
                    title="Backend Engineer",
                    company="Acme",
                    location="Remote",
                    url="https://example.com/jobs/101",
                    listing_summary="Build backend systems",
                    description=(
                        "Responsibilities and requirements include Python APIs, SQL systems, skills in stakeholder communication, and experience delivering production services. "
                        * 6
                    ),
                    description_quality="full",
                    intent_status="included",
                    enrichment_status="ready",
                    score=89,
                    score_label="Excellent",
                    scoring_ready=True,
                    status="scored",
                )
            )
            session.add(
                Job(
                    id=102,
                    user_id=1,
                    title="Product Manager",
                    company="Other",
                    location="Berlin",
                    url="https://example.com/jobs/102",
                    listing_summary="Coordinate product delivery",
                    description="",
                    description_quality="summary",
                    intent_status="borderline",
                    enrichment_status="missing",
                    scoring_ready=False,
                    status="new",
                )
            )
            session.commit()

        self.client = TestClient(main.app)

        def override_user() -> UserPublic:
            return UserPublic(
                id=1,
                name="Admin Tester",
                email="admin@example.com",
                target_role="Engineer",
                plan="pro",
            )

        def override_session() -> Generator[Session, None, None]:
            with Session(self.engine) as session:
                yield session

        main.app.dependency_overrides[admin_router.get_current_user] = override_user
        main.app.dependency_overrides[admin_router.get_session] = override_session

    def tearDown(self) -> None:
        operational_visibility.reset_for_tests()
        ai_router.ACTIVE_SCORE_TASKS.clear()
        scraper_router.ACTIVE_SCRAPE_TASKS.clear()
        main.app.dependency_overrides.clear()
        self.client.close()

    def test_ops_metrics_exposes_enrichment_and_intent_filter_counters(self) -> None:
        operational_visibility.record_enrichment_batch(
            expected_jobs=3,
            attempts={
                1: ai_router.EnrichmentAttempt(
                    description="Responsibilities and requirements include Python APIs and SQL systems." * 4,
                    method="html",
                    duration_ms=120,
                    quality="full",
                ),
                2: ai_router.EnrichmentAttempt(
                    description="Responsibilities include SQL, dashboards, and stakeholder communication." * 3,
                    method="playwright",
                    duration_ms=300,
                    quality="partial",
                ),
                3: ai_router.EnrichmentAttempt(
                    description="Short listing",
                    method="html",
                    duration_ms=80,
                    quality="summary",
                ),
            },
        )
        operational_visibility.record_intent_filter_metrics(
            jobs_found=12,
            skipped_irrelevant=5,
            enriched=2,
            scored=1,
            promoted_top_matches=1,
        )

        response = self.client.get("/api/admin/ops/metrics")
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        enrichment = payload["enrichment_metrics"]
        intent_filter = payload["intent_filter_metrics"]

        self.assertEqual(enrichment["html_success"], 1)
        self.assertEqual(enrichment["browser_fallback_success"], 1)
        self.assertEqual(enrichment["total_failures"], 1)
        self.assertGreater(enrichment["average_duration_ms"], 0)

        self.assertEqual(intent_filter["jobs_found"], 12)
        self.assertEqual(intent_filter["skipped_irrelevant"], 5)
        self.assertEqual(intent_filter["enriched"], 2)
        self.assertEqual(intent_filter["scored"], 1)
        self.assertEqual(intent_filter["promoted_top_matches"], 1)

    def test_ops_debug_exposes_provider_task_and_user_job_snapshot(self) -> None:
        operational_visibility.record_provider_issue(
            kind="provider",
            error="OpenAI request failed with status 500",
            provider="openai",
        )
        operational_visibility.record_scrape_summary(
            jobs_found=20,
            jobs_saved=7,
            jobs_filtered_out=13,
            target_role="Engineer",
            status="success",
        )

        ai_router.ACTIVE_SCORE_TASKS[1] = "score-task-id"
        scraper_router.ACTIVE_SCRAPE_TASKS[1] = "scrape-task-id"

        response = self.client.get("/api/admin/ops/debug")
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertIn("provider", payload)
        self.assertIn("tasks", payload)
        self.assertIn("runtime_metrics", payload)
        self.assertIn("user_job_snapshot", payload)

        self.assertEqual(payload["tasks"]["active_score_tasks"], 1)
        self.assertEqual(payload["tasks"]["active_scrape_tasks"], 1)

        provider_issues = payload["provider"]["issues"]
        self.assertEqual(provider_issues["provider_errors"], 1)
        self.assertEqual(provider_issues["last_provider"], "openai")

        user_snapshot = payload["user_job_snapshot"]
        self.assertEqual(user_snapshot["total_jobs"], 2)
        self.assertEqual(user_snapshot["scored_jobs"], 1)
        self.assertEqual(user_snapshot["top_match_ready_jobs"], 1)
        self.assertEqual(user_snapshot["intent_status_counts"]["included"], 1)
        self.assertEqual(user_snapshot["intent_status_counts"]["borderline"], 1)


if __name__ == "__main__":
    unittest.main()
