"""
auth.py — /auth/register and /auth/login routes
"""

import os

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlmodel import Session, select

from database import get_session
from models import AuthResponse, LoginRequest, RegisterRequest, User, UserPublic
from security import hash_password, verify_password, create_token

router = APIRouter()

COOKIE_NAME = "access_token"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7


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
