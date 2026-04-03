from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from kombu.exceptions import OperationalError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main
from models import User, UserPublic
import scraper as scraper_router


class CorruptedCeleryResult:
    @property
    def status(self) -> str:
        raise ValueError("Exception information must include the exception type")

    @property
    def info(self) -> None:
        return None

    def successful(self) -> bool:
        return False

    def failed(self) -> bool:
        return True

    @property
    def result(self) -> None:
        return None


class ScraperRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)
        scraper_router.ACTIVE_SCRAPE_TASKS.clear()

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

        def override_user() -> UserPublic:
            return UserPublic(
                id=1,
                name="Test User",
                email="test@example.com",
                target_role="Engineer",
                plan="free",
            )

        main.app.dependency_overrides[scraper_router.get_current_user] = override_user

    def tearDown(self) -> None:
        scraper_router.ACTIVE_SCRAPE_TASKS.clear()
        main.app.dependency_overrides.clear()
        self.client.close()

    def test_scrape_status_returns_normalized_running_progress(self) -> None:
        fake_result = SimpleNamespace(
            status="PROGRESS",
            info={
                "phase": "loading_page",
                "page": 3,
                "jobs_found": 14,
                "jobs_saved": 0,
                "target_role": "Engineer",
                "source": "JobTeaser",
            },
            successful=lambda: False,
            failed=lambda: False,
            result=None,
        )

        with patch.object(scraper_router.celery_app, "AsyncResult", return_value=fake_result):
            response = self.client.get("/api/scrape/status", params={"task_id": "scrape-task-1"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "running")
        self.assertEqual(payload["progress"]["phase"], "loading_page")
        self.assertEqual(payload["progress"]["page"], 3)
        self.assertEqual(payload["progress"]["jobs_found"], 14)
        self.assertEqual(payload["result"], None)

    def test_scrape_status_returns_retrying_payload(self) -> None:
        fake_result = SimpleNamespace(
            status="RETRY",
            info={
                "phase": "loading_page",
                "page": 2,
                "jobs_found": 4,
                "jobs_saved": 0,
                "target_role": "Engineer",
                "source": "JobTeaser",
            },
            successful=lambda: False,
            failed=lambda: False,
            result=RuntimeError("Temporary worker issue"),
        )

        with patch.object(scraper_router.celery_app, "AsyncResult", return_value=fake_result):
            response = self.client.get("/api/scrape/status", params={"task_id": "scrape-task-retry"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "retrying")
        self.assertEqual(payload["progress"]["phase"], "loading_page")
        self.assertEqual(payload["error"], "Temporary worker issue")

    def test_scrape_status_includes_failure_detail(self) -> None:
        fake_result = SimpleNamespace(
            status="FAILURE",
            info={
                "phase": "failed",
                "page": 0,
                "jobs_found": 0,
                "jobs_saved": 0,
                "target_role": "Engineer",
                "source": "JobTeaser",
                "error": "Browser launch failed",
            },
            successful=lambda: False,
            failed=lambda: True,
            result=RuntimeError("Browser launch failed"),
        )

        with patch.object(scraper_router.celery_app, "AsyncResult", return_value=fake_result):
            response = self.client.get("/api/scrape/status", params={"task_id": "scrape-task-2"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "failure")
        self.assertEqual(payload["progress"]["phase"], "failed")
        self.assertEqual(payload["error"], "Browser launch failed")

    def test_trigger_scrape_rejects_duplicate_running_task(self) -> None:
        scraper_router.ACTIVE_SCRAPE_TASKS[1] = "existing-task"
        fake_result = SimpleNamespace(status="PROGRESS")

        with patch.object(scraper_router.celery_app, "AsyncResult", return_value=fake_result):
            response = self.client.post("/api/scrape")

        self.assertEqual(response.status_code, 409)
        payload = response.json()
        self.assertIn("already running", payload["detail"])
        self.assertEqual(scraper_router.ACTIVE_SCRAPE_TASKS[1], "existing-task")

    def test_trigger_scrape_replaces_finished_task_and_tracks_new_one(self) -> None:
        scraper_router.ACTIVE_SCRAPE_TASKS[1] = "finished-task"
        queued_task = SimpleNamespace(id="new-task-id")
        fake_result = SimpleNamespace(status="FAILURE")

        with (
            patch.object(scraper_router.celery_app, "AsyncResult", return_value=fake_result),
            patch.object(scraper_router.run_scraper_task, "delay", return_value=queued_task) as delay_mock,
        ):
            response = self.client.post("/api/scrape")

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["task_id"], "new-task-id")
        delay_mock.assert_called_once_with(1, "Engineer", 300)
        self.assertEqual(scraper_router.ACTIVE_SCRAPE_TASKS[1], "new-task-id")

    def test_trigger_scrape_returns_service_unavailable_when_queue_backend_is_down(self) -> None:
        with patch.object(scraper_router.run_scraper_task, "delay", side_effect=OperationalError("redis down")):
            response = self.client.post("/api/scrape")

        self.assertEqual(response.status_code, 503)
        self.assertIn("could not be queued", response.json()["detail"])

    def test_scrape_status_clears_active_task_after_completion(self) -> None:
        scraper_router.ACTIVE_SCRAPE_TASKS[1] = "completed-task"
        fake_result = SimpleNamespace(
            status="SUCCESS",
            info={},
            successful=lambda: True,
            failed=lambda: False,
            result={
                "saved": 3,
                "user_id": 1,
                "source": "JobTeaser",
                "target_role": "Engineer",
                "jobs_found": 5,
                "jobs_saved": 3,
                "progress": {
                    "phase": "completed",
                    "page": 2,
                    "jobs_found": 5,
                    "jobs_saved": 3,
                    "target_role": "Engineer",
                    "source": "JobTeaser",
                },
            },
        )

        with patch.object(scraper_router.celery_app, "AsyncResult", return_value=fake_result):
            response = self.client.get("/api/scrape/status", params={"task_id": "completed-task"})

        self.assertEqual(response.status_code, 200)
        self.assertNotIn(1, scraper_router.ACTIVE_SCRAPE_TASKS)

    def test_scrape_status_returns_service_unavailable_when_backend_is_down(self) -> None:
        with patch.object(scraper_router.celery_app, "AsyncResult", side_effect=OperationalError("redis down")):
            response = self.client.get("/api/scrape/status", params={"task_id": "any-task"})

        self.assertEqual(response.status_code, 503)
        self.assertIn("status service is unavailable", response.json()["detail"])

    def test_scrape_status_returns_failure_when_celery_result_payload_is_corrupted(self) -> None:
        scraper_router.ACTIVE_SCRAPE_TASKS[1] = "broken-task"

        with patch.object(scraper_router.celery_app, "AsyncResult", return_value=CorruptedCeleryResult()):
            response = self.client.get("/api/scrape/status", params={"task_id": "broken-task"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "failure")
        self.assertEqual(payload["progress"]["phase"], "failed")
        self.assertIn("could not be decoded", payload["error"])
        self.assertNotIn(1, scraper_router.ACTIVE_SCRAPE_TASKS)


if __name__ == "__main__":
    unittest.main()
