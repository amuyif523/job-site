"""SQLModel entities and API schemas."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from pydantic import EmailStr
from sqlalchemy import Column, String
from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    email: str = Field(sa_column=Column(String, unique=True, index=True, nullable=False))
    hashed_pw: str
    target_role: str = Field(default="")
    plan: str = Field(default="free")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CVData(SQLModel, table=True):
    __tablename__ = "cv_data"

    user_id: int = Field(primary_key=True, foreign_key="users.id")
    filename: str = Field(default="")
    extracted_text: str = Field(default="")
    last_updated: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Job(SQLModel, table=True):
    __tablename__ = "jobs"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    title: str
    company: str
    location: str = Field(default="")
    url: str = Field(default="")
    date_scraped: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    description: str = Field(default="")
    score: Optional[float] = Field(default=None)
    score_reasoning: Optional[str] = Field(default=None)
    red_flags: Optional[str] = Field(default=None)
    status: str = Field(default="new")
    notes: str = Field(default="")
    events: str = Field(default="[]")


class RegisterRequest(SQLModel):
    name: str
    email: EmailStr
    password: str
    confirm_password: str
    target_role: Optional[str] = ""


class LoginRequest(SQLModel):
    email: EmailStr
    password: str


class UserPublic(SQLModel):
    id: int
    name: str
    email: str
    target_role: str
    plan: str


class TokenResponse(SQLModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic
