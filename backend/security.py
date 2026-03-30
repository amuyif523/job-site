"""
security.py — password hashing and JWT creation/verification
"""

import os
import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import Request

from config import load_environment

load_environment()

SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY or not SECRET_KEY.strip():
    raise RuntimeError("JWT_SECRET environment variable is not set; application cannot start")

SECRET_KEY = SECRET_KEY.strip()
ALGORITHM   = "HS256"
EXPIRE_DAYS = 7


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=EXPIRE_DAYS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise ValueError("Token expired")
    except jwt.InvalidTokenError:
        raise ValueError("Invalid token")


def get_token_from_cookie(request: Request) -> str:
    token = (request.cookies.get("access_token") or "").strip()
    if not token:
        raise ValueError("Missing authentication cookie")
    return token
