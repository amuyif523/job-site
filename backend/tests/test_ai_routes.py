from __future__ import annotations

import sys
import tempfile
import unittest
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
        self.assertEqual(captured["cv_text"], "RAW CV TEXT FOR SCORING")
        self.assertEqual(captured["job_description"], "Python APIs and SQL systems")

        with Session(self.engine) as session:
            job = session.get(Job, 10)
            self.assertIsNotNone(job)
            assert job is not None
            self.assertEqual(job.score, 91)
            self.assertEqual(job.status, "scored")
            self.assertIn("Strong Python and API overlap.", job.score_reasoning or "")


if __name__ == "__main__":
    unittest.main()
