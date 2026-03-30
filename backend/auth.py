"""
auth.py — /auth/register and /auth/login routes
"""

import sqlite3
from fastapi import APIRouter, HTTPException, status, Depends

from database import get_db, DB_PATH
from models import RegisterRequest, LoginRequest, TokenResponse, UserPublic
from security import hash_password, verify_password, create_token
from dependencies import get_current_user

router = APIRouter()


def _row_to_user(row) -> UserPublic:
    return UserPublic(
        id=row["id"],
        name=row["name"],
        email=row["email"],
        target_role=row["target_role"],
        plan=row["plan"],
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest):
    if body.password != body.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    existing = conn.execute("SELECT id FROM users WHERE email = ?", (body.email,)).fetchone()
    if existing:
        conn.close()
        raise HTTPException(status_code=409, detail="Email already registered")

    hashed = hash_password(body.password)
    cursor = conn.execute(
        "INSERT INTO users (name, email, hashed_pw, target_role, plan) VALUES (?, ?, ?, ?, ?)",
        (body.name.strip(), body.email.lower(), hashed, body.target_role or "", "free"),
    )
    conn.commit()
    user_id = cursor.lastrowid

    row = conn.execute(
        "SELECT id, name, email, target_role, plan FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    conn.close()

    user = _row_to_user(row)
    token = create_token(user.id, user.email)
    return TokenResponse(access_token=token, user=user)


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    row = conn.execute(
        "SELECT id, name, email, hashed_pw, target_role, plan FROM users WHERE email = ?",
        (body.email.lower(),),
    ).fetchone()
    conn.close()

    if not row or not verify_password(body.password, row["hashed_pw"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user = UserPublic(
        id=row["id"],
        name=row["name"],
        email=row["email"],
        target_role=row["target_role"],
        plan=row["plan"],
    )
    token = create_token(user.id, user.email)
    return TokenResponse(access_token=token, user=user)
