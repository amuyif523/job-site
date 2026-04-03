"""SQLModel entities and API schemas."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from pydantic import EmailStr, field_validator, model_validator
from sqlalchemy import Column, String
from sqlmodel import Field, SQLModel

MIN_NAME_LENGTH = 2
MAX_NAME_LENGTH = 80
MIN_TARGET_ROLE_LENGTH = 2
MAX_TARGET_ROLE_LENGTH = 120
MIN_PASSWORD_LENGTH = 10


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    email: str = Field(sa_column=Column(String, unique=True, index=True, nullable=False))
    hashed_pw: str
    token_version: int = Field(default=0)
    target_role: str = Field(default="")
    plan: str = Field(default="free")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CVData(SQLModel, table=True):
    __tablename__ = "cv_data"

    user_id: int = Field(primary_key=True, foreign_key="users.id")
    filename: str = Field(default="")
    extracted_text: str = Field(default="")
    parsed_json: str = Field(default="")
    last_updated: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PasswordResetToken(SQLModel, table=True):
    __tablename__ = "password_reset_tokens"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    token: str = Field(sa_column=Column(String, unique=True, index=True, nullable=False))
    expires_at: datetime
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


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
    enrichment_status: str = Field(default="pending")
    enrichment_error: str = Field(default="")
    scoring_ready: bool = Field(default=False)
    score: Optional[float] = Field(default=None)
    score_label: Optional[str] = Field(default=None)
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

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Name is required")
        if len(normalized) < MIN_NAME_LENGTH:
            raise ValueError(f"Name must be at least {MIN_NAME_LENGTH} characters")
        if len(normalized) > MAX_NAME_LENGTH:
            raise ValueError(f"Name must be at most {MAX_NAME_LENGTH} characters")
        return normalized

    @field_validator("target_role")
    @classmethod
    def validate_target_role(cls, value: Optional[str]) -> str:
        normalized = (value or "").strip()
        if not normalized:
            return ""
        if len(normalized) < MIN_TARGET_ROLE_LENGTH:
            raise ValueError(f"Target role must be at least {MIN_TARGET_ROLE_LENGTH} characters")
        if len(normalized) > MAX_TARGET_ROLE_LENGTH:
            raise ValueError(f"Target role must be at most {MAX_TARGET_ROLE_LENGTH} characters")
        return normalized

    @field_validator("password", "confirm_password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        if len(value) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
        if not any(char.islower() for char in value):
            raise ValueError("Password must include at least one lowercase letter")
        if not any(char.isupper() for char in value):
            raise ValueError("Password must include at least one uppercase letter")
        if not any(char.isdigit() for char in value):
            raise ValueError("Password must include at least one number")
        return value

    @model_validator(mode="after")
    def validate_password_match(self) -> "RegisterRequest":
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match")
        return self


class LoginRequest(SQLModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def validate_password_present(cls, value: str) -> str:
        if not value:
            raise ValueError("Password is required")
        return value


class UserPublic(SQLModel):
    id: int
    name: str
    email: str
    target_role: str
    plan: str


class AuthResponse(SQLModel):
    message: str = "Authenticated successfully"
    user: UserPublic


class ForgotPasswordRequest(SQLModel):
    email: EmailStr


class ResetPasswordRequest(SQLModel):
    token: str
    new_password: str


class MessageResponse(SQLModel):
    message: str
