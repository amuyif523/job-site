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
from security import hash_password, verify_password, create_token

router = APIRouter()

COOKIE_NAME = "access_token"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7
RESET_TOKEN_TTL_MINUTES = 15
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 5

_forgot_password_hits: dict[str, deque[datetime]] = defaultdict(deque)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _cookie_secure() -> bool:
    # Set COOKIE_SECURE=true in production to enforce HTTPS-only cookies.
    return os.getenv("COOKIE_SECURE", "false").strip().lower() == "true"


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
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
    response: Response,
    session: Session = Depends(get_session),
):
    if body.password != body.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    email = str(body.email).lower().strip()
    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        name=body.name.strip(),
        email=email,
        hashed_pw=hash_password(body.password),
        target_role=body.target_role or "",
        plan="free",
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    public_user = _to_user_public(user)
    token = create_token(public_user.id, public_user.email)
    _set_auth_cookie(response, token)
    return AuthResponse(user=public_user)


@router.post("/login", response_model=AuthResponse)
def login(
    body: LoginRequest,
    response: Response,
    session: Session = Depends(get_session),
):
    email = str(body.email).lower().strip()
    user = session.exec(select(User).where(User.email == email)).first()

    if not user or not verify_password(body.password, user.hashed_pw):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    public_user = _to_user_public(user)
    token = create_token(public_user.id, public_user.email)
    _set_auth_cookie(response, token)
    return AuthResponse(user=public_user)


@router.post("/logout")
def logout(response: Response):
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
    session.add(user)
    session.delete(row)
    session.commit()

    public_user = _to_user_public(user)
    auth_token = create_token(public_user.id, public_user.email)
    _set_auth_cookie(response, auth_token)
    return MessageResponse(message="Password reset successful")
