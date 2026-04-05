from __future__ import annotations

import sys
import tempfile
import unittest
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main
from models import CVData, Job, User, UserPublic
from routers import ai as ai_router


def pdf_bytes(body: bytes = b"test") -> bytes:
    return b"%PDF-1.4\n" + body


class AIRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_upload_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            session.add(
                User(
                    id=1,
                    name="Test User",
                    email="test@example.com",
                    hashed_pw="hashed",
                    target_role="Engineer",
                    plan="free",
                )
            )
            session.commit()

        self.client = TestClient(main.app)
        self.current_user = UserPublic(
            id=1,
            name="Test User",
            email="test@example.com",
            target_role="Engineer",
            plan="free",
        )

        def override_user() -> UserPublic:
            return self.current_user

        def override_session():
            with Session(self.engine) as session:
                yield session

        main.app.dependency_overrides[ai_router.get_current_user] = override_user
        main.app.dependency_overrides[ai_router.get_session] = override_session

    def tearDown(self) -> None:
        main.app.dependency_overrides.clear()
        self.client.close()
        self.temp_upload_dir.cleanup()
        ai_router.ACTIVE_SCORE_TASKS.clear()
        ai_router.SCORE_TASK_OWNERS.clear()

    def upload_file(self, name: str, content: bytes, content_type: str = "application/pdf"):
        return self.client.post(
            "/api/ai/upload_cv",
            files={"file": (name, content, content_type)},
        )

    def test_valid_upload_stores_raw_text_and_parsed_json(self) -> None:
        parsed_resume = '{"parsed_json":{"summary":"Strong backend engineer"},"suggestions":["Add metrics"]}'
        upload_dir = Path(self.temp_upload_dir.name)

        with (
            patch.object(ai_router, "UPLOADS_DIR", upload_dir),
            patch.object(ai_router, "_extract_text_from_upload", return_value="RAW CV TEXT"),
            patch.object(ai_router.llm_service, "parse_resume", new=AsyncMock(return_value=parsed_resume)),
            patch.object(ai_router, "uuid4", return_value=SimpleNamespace(hex="resumeone")),
        ):
            response = self.upload_file("resume.pdf", pdf_bytes())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["filename"], "resumeone_resume.pdf")

        with Session(self.engine) as session:
            row = session.get(CVData, 1)
            self.assertIsNotNone(row)
            assert row is not None
            self.assertEqual(row.filename, "resumeone_resume.pdf")
            self.assertEqual(row.extracted_text, "RAW CV TEXT")
            self.assertEqual(row.parsed_json, parsed_resume)

        self.assertTrue((upload_dir / "resumeone_resume.pdf").exists())

    def test_upload_rejects_invalid_type(self) -> None:
        upload_dir = Path(self.temp_upload_dir.name)
        with patch.object(ai_router, "UPLOADS_DIR", upload_dir):
            response = self.upload_file("resume.txt", b"not a pdf", "text/plain")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Only PDF CV uploads are supported")
        self.assertEqual(list(upload_dir.iterdir()), [])

    def test_upload_rejects_oversized_file(self) -> None:
        upload_dir = Path(self.temp_upload_dir.name)
        oversized = pdf_bytes(b"a" * ai_router.MAX_CV_UPLOAD_BYTES)

        with patch.object(ai_router, "UPLOADS_DIR", upload_dir):
            response = self.upload_file("resume.pdf", oversized, "application/pdf")

        self.assertEqual(response.status_code, 413)
        self.assertIn("exceeds the 5MB size limit", response.json()["detail"])
        self.assertEqual(list(upload_dir.iterdir()), [])

    def test_upload_rejects_empty_pdf(self) -> None:
        upload_dir = Path(self.temp_upload_dir.name)
        with patch.object(ai_router, "UPLOADS_DIR", upload_dir):
            response = self.upload_file("resume.pdf", b"", "application/pdf")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Uploaded CV file is empty")
        self.assertEqual(list(upload_dir.iterdir()), [])

    def test_upload_returns_error_and_keeps_disk_clean_when_parser_fails(self) -> None:
        upload_dir = Path(self.temp_upload_dir.name)

        with (
            patch.object(ai_router, "UPLOADS_DIR", upload_dir),
            patch.object(ai_router, "_extract_text_from_upload", return_value="RAW CV TEXT"),
            patch.object(ai_router.llm_service, "parse_resume", new=AsyncMock(side_effect=Exception("boom"))),
            patch.object(ai_router, "uuid4", return_value=SimpleNamespace(hex="parserfail")),
        ):
            response = self.upload_file("resume.pdf", pdf_bytes())

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"], "An error occurred while parsing the resume")
        self.assertFalse((upload_dir / "parserfail_resume.pdf").exists())

        with Session(self.engine) as session:
            self.assertIsNone(session.get(CVData, 1))

    def test_replacement_upload_deletes_old_file(self) -> None:
        upload_dir = Path(self.temp_upload_dir.name)
        parsed_resume = '{"parsed_json":{"summary":"Structured resume"},"suggestions":[]}'

        with (
            patch.object(ai_router, "UPLOADS_DIR", upload_dir),
            patch.object(ai_router, "_extract_text_from_upload", side_effect=["FIRST RAW", "SECOND RAW"]),
            patch.object(ai_router.llm_service, "parse_resume", new=AsyncMock(side_effect=[parsed_resume, parsed_resume])),
            patch.object(
                ai_router,
                "uuid4",
                side_effect=[SimpleNamespace(hex="firstcv"), SimpleNamespace(hex="secondcv")],
            ),
        ):
            first_response = self.upload_file("resume.pdf", pdf_bytes(b"first"))
            second_response = self.upload_file("resume.pdf", pdf_bytes(b"second"))

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertFalse((upload_dir / "firstcv_resume.pdf").exists())
        self.assertTrue((upload_dir / "secondcv_resume.pdf").exists())

        with Session(self.engine) as session:
            row = session.get(CVData, 1)
            self.assertIsNotNone(row)
            assert row is not None
            self.assertEqual(row.filename, "secondcv_resume.pdf")
            self.assertEqual(row.extracted_text, "SECOND RAW")

    def test_score_jobs_task_uses_raw_cv_text(self) -> None:
        captured: dict[str, str] = {}

        with Session(self.engine) as session:
            session.add(
                CVData(
                    user_id=1,
                    filename="resume.pdf",
                    extracted_text="RAW CV TEXT FOR SCORING",
                    parsed_json='{"parsed_json":{"summary":"Structured JSON only"}}',
                )
            )
            session.add(
                Job(
                    id=10,
                    user_id=1,
                    title="Backend Engineer",
                    company="Acme",
                    location="Remote",
                    url="https://example.com/jobs/10",
                    description="Python APIs and SQL systems",
                )
            )
            session.commit()

        async def fake_score_from_ai(cv_text: str, job_description: str) -> dict[str, object]:
            captured["cv_text"] = cv_text
            captured["job_description"] = job_description
            return {
                "compatibility_score": 91,
                "match_status": "Excellent",
                "reasoning": "Strong Python and API overlap.",
            }

        with (
            patch.object(ai_router, "engine", self.engine),
            patch.object(ai_router.llm_service, "get_score_from_ai", new=fake_score_from_ai),
        ):
            result = ai_router.score_jobs_task(1, [10])

        self.assertEqual(result["scored"], 1)
        self.assertEqual(result["unscorable"], 0)
        self.assertEqual(captured["cv_text"], "RAW CV TEXT FOR SCORING")
        self.assertEqual(captured["job_description"], "Python APIs and SQL systems")

        with Session(self.engine) as session:
            job = session.get(Job, 10)
            self.assertIsNotNone(job)
            assert job is not None
            self.assertEqual(job.score, 91)
            self.assertEqual(job.score_label, "Excellent")
            self.assertEqual(job.status, "scored")
            self.assertTrue(job.scoring_ready)
            self.assertEqual(job.enrichment_status, "ready")
            self.assertIn("Strong Python and API overlap.", job.score_reasoning or "")

    def test_score_jobs_task_enriches_missing_descriptions_before_scoring(self) -> None:
        captured: dict[str, str] = {}

        with Session(self.engine) as session:
            session.add(
                CVData(
                    user_id=1,
                    filename="resume.pdf",
                    extracted_text="RAW CV TEXT FOR SCORING",
                    parsed_json="{}",
                )
            )
            session.add(
                Job(
                    id=11,
                    user_id=1,
                    title="Data Scientist",
                    company="Acme",
                    location="Remote",
                    url="https://example.com/jobs/11",
                    description="",
                )
            )
            session.commit()

        async def fake_score_from_ai(cv_text: str, job_description: str) -> dict[str, object]:
            captured["cv_text"] = cv_text
            captured["job_description"] = job_description
            return {
                "compatibility_score": 78,
                "match_status": "Good",
                "reasoning": "Strong match after loading the full job details.",
            }

        with (
            patch.object(ai_router, "engine", self.engine),
            patch.object(
                ai_router,
                "fetch_job_enrichment_map",
                new=AsyncMock(
                    return_value={
                        11: ai_router.EnrichmentAttempt(
                            description=(
                                "Detailed role requirements covering SQL, experimentation, stakeholder communication, "
                                "dashboard delivery, forecasting, data quality ownership, and collaboration with engineering and product teams." * 2
                            ),
                            method="html",
                            duration_ms=420,
                            error="",
                            retryable=False,
                        )
                    }
                ),
            ),
            patch.object(ai_router.llm_service, "get_score_from_ai", new=fake_score_from_ai),
        ):
            result = ai_router.score_jobs_task(1, [11])

        self.assertEqual(result["scored"], 1)
        self.assertEqual(result["unscorable"], 0)
        self.assertIn("Detailed role requirements", captured["job_description"])

        with Session(self.engine) as session:
            job = session.get(Job, 11)
            self.assertIsNotNone(job)
            assert job is not None
            self.assertIn("Detailed role requirements", job.description)
            self.assertEqual(job.score_label, "Good")
            self.assertEqual(job.score, 78)
            self.assertEqual(job.enrichment_status, "enriched")
            self.assertTrue(job.scoring_ready)
            self.assertEqual(job.enrichment_method, "html")
            self.assertEqual(job.enrichment_duration_ms, 420)

    def test_score_jobs_task_marks_job_unscorable_when_description_is_missing(self) -> None:
        with Session(self.engine) as session:
            session.add(
                CVData(
                    user_id=1,
                    filename="resume.pdf",
                    extracted_text="RAW CV TEXT FOR SCORING",
                    parsed_json="{}",
                )
            )
            session.add(
                Job(
                    id=12,
                    user_id=1,
                    title="ML Engineer",
                    company="Acme",
                    location="Remote",
                    url="",
                    description="",
                )
            )
            session.commit()

        with (
            patch.object(ai_router, "engine", self.engine),
            patch.object(ai_router, "fetch_job_enrichment_map", new=AsyncMock(return_value={})),
            patch.object(ai_router.llm_service, "get_score_from_ai", new=AsyncMock(side_effect=AssertionError("should not score"))),
        ):
            result = ai_router.score_jobs_task(1, [12])

        self.assertEqual(result["scored"], 0)
        self.assertEqual(result["unscorable"], 1)
        self.assertIn("incomplete job description; scoring skipped", result["errors"][0])

        with Session(self.engine) as session:
            job = session.get(Job, 12)
            self.assertIsNotNone(job)
            assert job is not None
            self.assertIsNone(job.score)
            self.assertEqual(job.score_label, "Unscorable")
            self.assertEqual(job.status, "new")
            self.assertFalse(job.scoring_ready)
            self.assertEqual(job.enrichment_status, "missing")
            self.assertIn("no usable job description", (job.score_reasoning or "").lower())
            red_flags = json.loads(job.red_flags or "[]")
            self.assertTrue(any("job description" in flag.lower() for flag in red_flags))

    def test_score_jobs_task_marks_short_descriptions_unscorable_when_enrichment_cannot_help(self) -> None:
        with Session(self.engine) as session:
            session.add(
                CVData(
                    user_id=1,
                    filename="resume.pdf",
                    extracted_text="RAW CV TEXT FOR SCORING",
                    parsed_json="{}",
                )
            )
            session.add(
                Job(
                    id=13,
                    user_id=1,
                    title="Analytics Engineer",
                    company="Acme",
                    location="Remote",
                    url="https://example.com/jobs/13",
                    description="Short listing",
                )
            )
            session.commit()

        with (
            patch.object(ai_router, "engine", self.engine),
            patch.object(
                ai_router,
                "fetch_job_enrichment_map",
                new=AsyncMock(
                    return_value={
                        13: ai_router.EnrichmentAttempt(
                            description="Short listing",
                            method="html",
                            duration_ms=210,
                            error="HTML extraction was incomplete; falling back to Playwright.",
                            retryable=True,
                        )
                    }
                ),
            ),
            patch.object(ai_router.llm_service, "get_score_from_ai", new=AsyncMock(side_effect=AssertionError("should not score"))),
        ):
            result = ai_router.score_jobs_task(1, [13])

        self.assertEqual(result["scored"], 0)
        self.assertEqual(result["unscorable"], 1)

        with Session(self.engine) as session:
            job = session.get(Job, 13)
            self.assertIsNotNone(job)
            assert job is not None
            self.assertEqual(job.enrichment_status, "partial")
            self.assertFalse(job.scoring_ready)
            self.assertEqual(job.enrichment_method, "html")
            self.assertEqual(job.enrichment_duration_ms, 210)
            self.assertTrue(job.enrichment_retryable)
            self.assertIn("too short to score reliably", (job.score_reasoning or "").lower())

    def test_score_jobs_task_returns_partial_failure_summary(self) -> None:
        with Session(self.engine) as session:
            session.add(
                CVData(
                    user_id=1,
                    filename="resume.pdf",
                    extracted_text="RAW CV TEXT FOR SCORING",
                    parsed_json="{}",
                )
            )
            session.add(
                Job(
                    id=14,
                    user_id=1,
                    title="Backend Engineer",
                    company="Acme",
                    location="Remote",
                    url="https://example.com/jobs/14",
                    description="Python APIs and SQL systems " * 20,
                )
            )
            session.add(
                Job(
                    id=15,
                    user_id=1,
                    title="Data Analyst",
                    company="Acme",
                    location="Remote",
                    url="https://example.com/jobs/15",
                    description="Business intelligence, SQL, dashboards, experimentation, reporting, and stakeholder communication " * 10,
                )
            )
            session.commit()

        async def fake_score_from_ai(cv_text: str, job_description: str) -> dict[str, object]:
            if "Business intelligence" in job_description:
                raise ai_router.llm_service.RateLimitError("Rate limit hit")
            return {
                "compatibility_score": 88,
                "match_status": "Excellent",
                "reasoning": "Strong fit.",
            }

        with (
            patch.object(ai_router, "engine", self.engine),
            patch.object(ai_router.llm_service, "get_score_from_ai", new=fake_score_from_ai),
        ):
            result = ai_router.score_jobs_task(1, [14, 15])

        self.assertEqual(result["scored"], 1)
        self.assertEqual(result["unscorable"], 0)
        self.assertIn("job_id=15: Rate limit hit", result["errors"])
        self.assertEqual(result["progress"]["jobs_failed"], 1)
        self.assertEqual(result["progress"]["jobs_scored"], 1)

    def test_score_all_returns_clear_error_when_no_provider_is_configured(self) -> None:
        with patch.object(
            ai_router.llm_service,
            "get_scoring_provider_name",
            side_effect=ai_router.llm_service.AuthenticationError("Missing backend model provider key."),
        ), self.assertRaises(ai_router.HTTPException) as exc_info:
            ai_router.score_all(body=ai_router.ScoreRequest(), current_user=self.current_user)

        self.assertEqual(exc_info.exception.status_code, 503)
        self.assertEqual(exc_info.exception.detail, "Missing backend model provider key.")

    def test_score_all_rejects_duplicate_active_task(self) -> None:
        ai_router.ACTIVE_SCORE_TASKS[self.current_user.id] = "score-task-active"
        ai_router.SCORE_TASK_OWNERS["score-task-active"] = self.current_user.id

        class RunningResult:
            status = "PROGRESS"

        with (
            patch.object(ai_router.llm_service, "get_scoring_provider_name", return_value="gemini"),
            patch.object(ai_router.celery_app, "AsyncResult", return_value=RunningResult()),
            self.assertRaises(ai_router.HTTPException) as exc_info,
        ):
            ai_router.score_all(body=ai_router.ScoreRequest(), current_user=self.current_user)

        self.assertEqual(exc_info.exception.status_code, 409)
        self.assertIn("already running", exc_info.exception.detail)

    def test_score_all_replaces_stale_terminal_task(self) -> None:
        ai_router.ACTIVE_SCORE_TASKS[self.current_user.id] = "score-task-done"
        ai_router.SCORE_TASK_OWNERS["score-task-done"] = self.current_user.id

        class SuccessResult:
            status = "SUCCESS"

        class QueuedTask:
            id = "score-task-new"

        with (
            patch.object(ai_router.llm_service, "get_scoring_provider_name", return_value="gemini"),
            patch.object(ai_router.celery_app, "AsyncResult", return_value=SuccessResult()),
            patch.object(ai_router.score_jobs_task, "delay", return_value=QueuedTask()),
        ):
            response = ai_router.score_all(body=ai_router.ScoreRequest(), current_user=self.current_user)

        self.assertEqual(response.task_id, "score-task-new")
        self.assertEqual(ai_router.ACTIVE_SCORE_TASKS[self.current_user.id], "score-task-new")
        self.assertEqual(ai_router.SCORE_TASK_OWNERS["score-task-new"], self.current_user.id)
        self.assertNotIn("score-task-done", ai_router.SCORE_TASK_OWNERS)

    def test_score_all_status_rejects_foreign_task_id(self) -> None:
        ai_router.SCORE_TASK_OWNERS["other-users-task"] = 999

        with self.assertRaises(ai_router.HTTPException) as exc_info:
            ai_router.score_all_status(task_id="other-users-task", current_user=self.current_user)

        self.assertEqual(exc_info.exception.status_code, 404)
        self.assertEqual(exc_info.exception.detail, "Scoring task not found")

    def test_score_all_status_normalizes_running_state(self) -> None:
        ai_router.SCORE_TASK_OWNERS["score-task-1"] = self.current_user.id

        class RunningResult:
            status = "PROGRESS"
            info = {
                "phase": "running",
                "total_jobs": 4,
                "jobs_scored": 2,
                "jobs_failed": 1,
                "jobs_unscorable": 0,
            }

            def successful(self) -> bool:
                return False

            def failed(self) -> bool:
                return False

        with patch.object(ai_router.celery_app, "AsyncResult", return_value=RunningResult()):
            response = ai_router.score_all_status(task_id="score-task-1", current_user=self.current_user)

        self.assertEqual(response.status, "running")
        assert response.progress is not None
        self.assertEqual(response.progress["jobs_scored"], 2)
        self.assertEqual(response.progress["total_jobs"], 4)

    def test_score_all_status_returns_safe_failure_when_payload_is_corrupted(self) -> None:
        ai_router.SCORE_TASK_OWNERS["score-task-bad"] = self.current_user.id
        ai_router.ACTIVE_SCORE_TASKS[self.current_user.id] = "score-task-bad"

        class CorruptedResult:
            @property
            def status(self) -> str:
                raise ValueError("Exception information must include the exception type")

        with patch.object(ai_router.celery_app, "AsyncResult", return_value=CorruptedResult()):
            response = ai_router.score_all_status(task_id="score-task-bad", current_user=self.current_user)

        self.assertEqual(response.status, "failure")
        assert response.error is not None
        self.assertIn("could not be decoded", response.error)
        self.assertNotIn(self.current_user.id, ai_router.ACTIVE_SCORE_TASKS)

    def test_generate_documents_rejects_jobs_without_trustworthy_scores(self) -> None:
        with Session(self.engine) as session:
            session.add(
                Job(
                    id=20,
                    user_id=1,
                    title="Backend Engineer",
                    company="Acme",
                    location="Remote",
                    url="https://example.com/jobs/20",
                    description="Short listing",
                    score=None,
                    score_label=None,
                    scoring_ready=False,
                    enrichment_status="partial",
                )
            )
            session.commit()

        with Session(self.engine) as session, self.assertRaises(ai_router.HTTPException) as exc_info:
            ai_router.generate_documents(job_id=20, current_user=self.current_user, session=session)

        self.assertEqual(exc_info.exception.status_code, 409)
        self.assertEqual(exc_info.exception.detail, ai_router.GENERATION_BLOCK_MESSAGE)

    def test_generate_documents_allows_scored_jobs_with_complete_descriptions(self) -> None:
        description = "Python APIs and SQL systems " * 20
        with Session(self.engine) as session:
            session.add(
                Job(
                    id=21,
                    user_id=1,
                    title="Backend Engineer",
                    company="Acme",
                    location="Remote",
                    url="https://example.com/jobs/21",
                    description=description,
                    score=91,
                    score_label="Excellent",
                    scoring_ready=True,
                    enrichment_status="ready",
                )
            )
            session.commit()

        with Session(self.engine) as session:
            response = ai_router.generate_documents(job_id=21, current_user=self.current_user, session=session)

        self.assertIn("/downloads/cv_21_", response.cv_url)


if __name__ == "__main__":
    unittest.main()
