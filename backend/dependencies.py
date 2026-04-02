"""
dependencies.py — reusable FastAPI dependencies
"""

from fastapi import Depends, HTTPException, Request, status
from sqlmodel import Session

from database import get_session
from models import User, UserPublic
from security import decode_token, get_token_from_cookie


def get_current_user(
    request: Request,
    session: Session = Depends(get_session),
) -> UserPublic:
    try:
        token = get_token_from_cookie(request)
        payload = decode_token(token)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))

    user_id = int(payload["sub"])

    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    token_version = int(payload.get("ver", 0))
    if token_version != int(user.token_version or 0):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

    return UserPublic(
        id=int(user.id),
        name=user.name,
        email=user.email,
        target_role=user.target_role,
        plan=user.plan,
    )
