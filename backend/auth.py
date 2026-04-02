"""
auth.py — /auth/register and /auth/login routes
"""

import os
import secrets
from datetime import datetime, timedelta, timezone
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlmodel import Session, select

from database import get_session
from models import (
    AuthResponse,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    PasswordResetToken,
    RegisterRequest,
    ResetPasswordRequest,
    User,
    UserPublic,
)
from security import create_token, decode_token, get_token_from_cookie, hash_password, verify_password

router = APIRouter()

COOKIE_NAME = "access_token"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7
RESET_TOKEN_TTL_MINUTES = 15
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 5
AUTH_RATE_LIMIT_WINDOW_SECONDS = 60
LOGIN_RATE_LIMIT_MAX_REQUESTS = 10
REGISTER_RATE_LIMIT_MAX_REQUESTS = 5
AUTH_RATE_LIMIT_ERROR = "Too many authentication attempts. Please try again later."

_forgot_password_hits: dict[str, deque[datetime]] = defaultdict(deque)
_login_hits: dict[str, deque[datetime]] = defaultdict(deque)
_register_hits: dict[str, deque[datetime]] = defaultdict(deque)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _cookie_secure() -> bool:
    # Set COOKIE_SECURE=true in production to enforce HTTPS-only cookies.
    raw_value = os.getenv("COOKIE_SECURE", "").strip().lower()
    if raw_value in {"1", "true", "yes", "on"}:
        return True
    if raw_value in {"0", "false", "no", "off"}:
        return False

    frontend_url = os.getenv("FRONTEND_URL", "").strip().lower()
    return frontend_url.startswith("https://")


def _cookie_samesite() -> str:
    raw_value = os.getenv("COOKIE_SAMESITE", "lax").strip().lower()
    if raw_value not in {"lax", "strict", "none"}:
        return "lax"
    if raw_value == "none" and not _cookie_secure():
        return "lax"
    return raw_value


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=_cookie_secure(),
        samesite=_cookie_samesite(),
        max_age=COOKIE_MAX_AGE,
        path="/",
    )


def _to_user_public(user: User) -> UserPublic:
    return UserPublic(
        id=int(user.id),
        name=user.name,
        email=user.email,
        target_role=user.target_role,
        plan=user.plan,
    )


def _cleanup_rate_limit(now: datetime) -> None:
    cutoff = now - timedelta(seconds=RATE_LIMIT_WINDOW_SECONDS)
    stale_keys = []
    for key, hits in _forgot_password_hits.items():
        while hits and hits[0] < cutoff:
            hits.popleft()
        if not hits:
            stale_keys.append(key)
    for key in stale_keys:
        _forgot_password_hits.pop(key, None)


def _cleanup_auth_rate_limit(bucket: dict[str, deque[datetime]], now: datetime) -> None:
    cutoff = now - timedelta(seconds=AUTH_RATE_LIMIT_WINDOW_SECONDS)
    stale_keys = []
    for key, hits in bucket.items():
        while hits and hits[0] < cutoff:
            hits.popleft()
        if not hits:
            stale_keys.append(key)
    for key in stale_keys:
        bucket.pop(key, None)


def _auth_rate_limit_key(request: Request, identifier: str = "") -> str:
    client_ip = request.client.host if request.client else "unknown"
    normalized_identifier = identifier.strip().lower()
    return f"{client_ip}:{normalized_identifier}" if normalized_identifier else client_ip


def _consume_auth_attempt(
    bucket: dict[str, deque[datetime]],
    request: Request,
    max_requests: int,
    *,
    identifier: str = "",
) -> str:
    now = _utcnow()
    _cleanup_auth_rate_limit(bucket, now)
    key = _auth_rate_limit_key(request, identifier)
    hits = bucket[key]
    if len(hits) >= max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=AUTH_RATE_LIMIT_ERROR,
        )
    hits.append(now)
    return key


def _clear_auth_attempts(bucket: dict[str, deque[datetime]], key: str) -> None:
    bucket.pop(key, None)


def _check_rate_limit(request: Request, email: str) -> None:
    now = _utcnow()
    _cleanup_rate_limit(now)
    client_ip = request.client.host if request.client else "unknown"
    key = f"{client_ip}:{email}"
    hits = _forgot_password_hits[key]

    if len(hits) >= RATE_LIMIT_MAX_REQUESTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many password reset requests. Please try again later.",
        )

    hits.append(now)


def _send_password_reset_email(email: str, reset_url: str) -> None:
    # For local development/testing, log the URL instead of SMTP delivery.
    print(f"[Password Reset] email={email} url={reset_url}")


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(
    body: RegisterRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
):
    email = str(body.email).lower().strip()
    rate_limit_key = _consume_auth_attempt(
        _register_hits,
        request,
        REGISTER_RATE_LIMIT_MAX_REQUESTS,
        identifier=email,
    )

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    if body.password != body.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        name=name,
        email=email,
        hashed_pw=hash_password(body.password),
        target_role=body.target_role or "",
        plan="free",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    _clear_auth_attempts(_register_hits, rate_limit_key)

    public_user = _to_user_public(user)
    token = create_token(public_user.id, public_user.email, user.token_version)
    _set_auth_cookie(response, token)
    return AuthResponse(user=public_user)


@router.post("/login", response_model=AuthResponse)
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
):
    email = str(body.email).lower().strip()
    rate_limit_key = _consume_auth_attempt(
        _login_hits,
        request,
        LOGIN_RATE_LIMIT_MAX_REQUESTS,
        identifier=email,
    )
    user = session.exec(select(User).where(User.email == email)).first()

    if not user or not verify_password(body.password, user.hashed_pw):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    _clear_auth_attempts(_login_hits, rate_limit_key)
    public_user = _to_user_public(user)
    token = create_token(public_user.id, public_user.email, user.token_version)
    _set_auth_cookie(response, token)
    return AuthResponse(user=public_user)


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
):
    try:
        token = get_token_from_cookie(request)
        payload = decode_token(token)
        user = session.get(User, int(payload["sub"]))
        if user:
            user.token_version = int(user.token_version or 0) + 1
            session.add(user)
            session.commit()
    except Exception:
        session.rollback()
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"ok": True}


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(
    body: ForgotPasswordRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> MessageResponse:
    email = str(body.email).lower().strip()
    _check_rate_limit(request, email)

    expired = session.exec(
        select(PasswordResetToken).where(PasswordResetToken.expires_at <= _utcnow())
    ).all()
    for row in expired:
        session.delete(row)

    user = session.exec(select(User).where(User.email == email)).first()

    # Always return a generic success message to avoid account enumeration.
    response_message = MessageResponse(
        message="If an account exists for this email, a reset link has been sent."
    )
    if not user:
        session.commit()
        return response_message

    existing_tokens = session.exec(
        select(PasswordResetToken).where(PasswordResetToken.user_id == int(user.id))
    ).all()
    for token_row in existing_tokens:
        session.delete(token_row)

    raw_token = secrets.token_urlsafe(48)
    expires_at = _utcnow() + timedelta(minutes=RESET_TOKEN_TTL_MINUTES)
    session.add(
        PasswordResetToken(
            user_id=int(user.id),
            token=raw_token,
            expires_at=expires_at,
        )
    )
    session.commit()

    frontend_base_url = os.getenv("FRONTEND_URL", "http://localhost:8080").strip() or "http://localhost:8080"
    reset_url = f"{frontend_base_url.rstrip('/')}/reset-password?token={raw_token}"
    _send_password_reset_email(email=email, reset_url=reset_url)
    return response_message


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(
    body: ResetPasswordRequest,
    response: Response,
    session: Session = Depends(get_session),
) -> MessageResponse:
    token = body.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token is required")

    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    row = session.exec(
        select(PasswordResetToken).where(PasswordResetToken.token == token)
    ).first()
    if not row:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    if row.expires_at <= _utcnow():
        session.delete(row)
        session.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user = session.get(User, row.user_id)
    if not user:
        session.delete(row)
        session.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user.hashed_pw = hash_password(body.new_password)
    user.token_version = int(user.token_version or 0) + 1
    session.add(user)
    session.delete(row)
    session.commit()

    public_user = _to_user_public(user)
    auth_token = create_token(public_user.id, public_user.email, user.token_version)
    _set_auth_cookie(response, auth_token)
    return MessageResponse(message="Password reset successful")
