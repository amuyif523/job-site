from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import auth as auth_router
import database
import dependencies
import main
from models import User
from security import hash_password


class AuthRouteTests(unittest.TestCase):
    def setUp(self) -> None:
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
                    name="Existing User",
                    email="existing@example.com",
                    hashed_pw=hash_password("correct-password"),
                    target_role="Engineer",
                    plan="free",
                )
            )
            session.commit()

        self.client = TestClient(main.app)

        def override_session():
            with Session(self.engine) as session:
                yield session

        main.app.dependency_overrides[database.get_session] = override_session
        main.app.dependency_overrides[auth_router.get_session] = override_session
        main.app.dependency_overrides[dependencies.get_session] = override_session
        auth_router._login_hits.clear()
        auth_router._register_hits.clear()
        auth_router._forgot_password_hits.clear()

    def tearDown(self) -> None:
        main.app.dependency_overrides.clear()
        auth_router._login_hits.clear()
        auth_router._register_hits.clear()
        auth_router._forgot_password_hits.clear()
        self.client.close()

    def test_login_rate_limits_repeated_failures(self) -> None:
        for _ in range(auth_router.LOGIN_RATE_LIMIT_MAX_REQUESTS):
            response = self.client.post(
                "/auth/login",
                json={"email": "existing@example.com", "password": "wrong-password"},
            )
            self.assertEqual(response.status_code, 401)

        throttled = self.client.post(
            "/auth/login",
            json={"email": "existing@example.com", "password": "wrong-password"},
        )
        self.assertEqual(throttled.status_code, 429)
        self.assertEqual(throttled.json()["detail"], auth_router.AUTH_RATE_LIMIT_ERROR)

    def test_register_rate_limits_repeated_attempts(self) -> None:
        first = self.client.post(
            "/auth/register",
            json={
                "name": "New User",
                "email": "fresh@example.com",
                "password": "StrongPass123",
                "confirm_password": "StrongPass123",
                "target_role": "Designer",
            },
        )
        self.assertEqual(first.status_code, 201)

        response = None
        for _ in range(auth_router.REGISTER_RATE_LIMIT_MAX_REQUESTS + 1):
            response = self.client.post(
                "/auth/register",
                json={
                    "name": "New User",
                    "email": "fresh@example.com",
                    "password": "StrongPass123",
                    "confirm_password": "StrongPass123",
                    "target_role": "Designer",
                },
            )
            if response.status_code == 429:
                break
            self.assertEqual(response.status_code, 409)

        assert response is not None
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["detail"], auth_router.AUTH_RATE_LIMIT_ERROR)

    def test_register_rejects_blank_name(self) -> None:
        response = self.client.post(
            "/auth/register",
            json={
                "name": "   ",
                "email": "blank-name@example.com",
                "password": "supersecret",
                "confirm_password": "supersecret",
                "target_role": "Engineer",
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("Name is required", response.text)

    def test_register_rejects_short_name(self) -> None:
        response = self.client.post(
            "/auth/register",
            json={
                "name": "A",
                "email": "short-name@example.com",
                "password": "StrongPass123",
                "confirm_password": "StrongPass123",
                "target_role": "Engineer",
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("Name must be at least 2 characters", response.text)

    def test_register_rejects_short_target_role(self) -> None:
        response = self.client.post(
            "/auth/register",
            json={
                "name": "Valid Name",
                "email": "short-role@example.com",
                "password": "StrongPass123",
                "confirm_password": "StrongPass123",
                "target_role": "A",
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("Target role must be at least 2 characters", response.text)

    def test_register_rejects_weak_password_without_uppercase(self) -> None:
        response = self.client.post(
            "/auth/register",
            json={
                "name": "Valid Name",
                "email": "weak-upper@example.com",
                "password": "lowercase123",
                "confirm_password": "lowercase123",
                "target_role": "Engineer",
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("Password must include at least one uppercase letter", response.text)

    def test_register_rejects_weak_password_without_number(self) -> None:
        response = self.client.post(
            "/auth/register",
            json={
                "name": "Valid Name",
                "email": "weak-number@example.com",
                "password": "LowercaseOnly",
                "confirm_password": "LowercaseOnly",
                "target_role": "Engineer",
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("Password must include at least one number", response.text)

    def test_register_rejects_password_mismatch(self) -> None:
        response = self.client.post(
            "/auth/register",
            json={
                "name": "Valid Name",
                "email": "mismatch@example.com",
                "password": "StrongPass123",
                "confirm_password": "StrongPass124",
                "target_role": "Engineer",
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("Passwords do not match", response.text)

    def test_register_trims_name_and_target_role_before_storage(self) -> None:
        response = self.client.post(
            "/auth/register",
            json={
                "name": "  Valid Name  ",
                "email": "trimmed@example.com",
                "password": "StrongPass123",
                "confirm_password": "StrongPass123",
                "target_role": "  Platform Engineer  ",
            },
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["message"], "Account created successfully")

        with Session(self.engine) as session:
            user = session.exec(select(User).where(User.email == "trimmed@example.com")).first()
            self.assertIsNotNone(user)
            assert user is not None
            self.assertEqual(user.name, "Valid Name")
            self.assertEqual(user.target_role, "Platform Engineer")

    def test_login_returns_consistent_success_message(self) -> None:
        response = self.client.post(
            "/auth/login",
            json={"email": "existing@example.com", "password": "correct-password"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["message"], "Signed in successfully")

    def test_logout_invalidates_previous_token(self) -> None:
        login_response = self.client.post(
            "/auth/login",
            json={"email": "existing@example.com", "password": "correct-password"},
        )
        self.assertEqual(login_response.status_code, 200)
        token = login_response.cookies.get("access_token")
        self.assertTrue(token)

        me_before = self.client.get("/auth/me")
        self.assertEqual(me_before.status_code, 200)

        logout_response = self.client.post("/auth/logout")
        self.assertEqual(logout_response.status_code, 200)

        replay_response = self.client.get("/auth/me", cookies={"access_token": token})
        self.assertEqual(replay_response.status_code, 401)
        self.assertEqual(replay_response.json()["detail"], "Session expired")

    def test_reset_password_invalidates_older_sessions(self) -> None:
        login_response = self.client.post(
            "/auth/login",
            json={"email": "existing@example.com", "password": "correct-password"},
        )
        old_token = login_response.cookies.get("access_token")
        self.assertTrue(old_token)

        with Session(self.engine) as session:
            user = session.get(User, 1)
            self.assertIsNotNone(user)
            assert user is not None
            user.token_version = 0
            session.add(user)
            session.commit()

        with patch.object(auth_router.secrets, "token_urlsafe", return_value="reset-token-123"):
            forgot_response = self.client.post(
                "/auth/forgot-password",
                json={"email": "existing@example.com"},
            )
        self.assertEqual(forgot_response.status_code, 200)

        reset_response = self.client.post(
            "/auth/reset-password",
            json={"token": "reset-token-123", "new_password": "brand-new-password"},
        )
        self.assertEqual(reset_response.status_code, 200)

        replay_response = self.client.get("/auth/me", cookies={"access_token": old_token})
        self.assertEqual(replay_response.status_code, 401)
        self.assertEqual(replay_response.json()["detail"], "Session expired")

    def test_cookie_policy_falls_back_to_safe_samesite(self) -> None:
        with patch.dict(
            auth_router.os.environ,
            {"FRONTEND_URL": "https://app.example.com", "COOKIE_SAMESITE": "none", "COOKIE_SECURE": "false"},
            clear=False,
        ):
            self.assertFalse(auth_router._cookie_secure())
            self.assertEqual(auth_router._cookie_samesite(), "lax")

        with patch.dict(
            auth_router.os.environ,
            {"FRONTEND_URL": "https://app.example.com", "COOKIE_SAMESITE": "none", "COOKIE_SECURE": "true"},
            clear=False,
        ):
            self.assertTrue(auth_router._cookie_secure())
            self.assertEqual(auth_router._cookie_samesite(), "none")


if __name__ == "__main__":
    unittest.main()
