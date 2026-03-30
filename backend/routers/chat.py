"""Gemini chat route for JARVIS."""
from __future__ import annotations
from typing import List
import os

from google import genai
from fastapi import APIRouter, Depends
from fastapi import HTTPException, status
from pydantic import BaseModel, field_validator

from dependencies import get_current_user
from models import UserPublic

def _get_genai_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        # Fail closed when provider credentials are missing.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gemini API key is not configured on the server.",
        )
    return genai.Client(api_key=api_key)

SYSTEM_PROMPT = (
    "You are JARVIS — an AI assistant embedded in a job-search platform. "
    "Help users understand match scores, improve their CV, explain job flags, "
    "and guide them through their application pipeline. Be concise and practical."
)

router = APIRouter()
VALID_ROLES = {"user", "model"}


class Message(BaseModel):
    role: str
    content: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"role must be 'user' or 'model', got '{v}'")
        return v


class ChatRequest(BaseModel):
    messages: List[Message]


class ChatResponse(BaseModel):
    reply: str


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    current_user: UserPublic = Depends(get_current_user),
) -> ChatResponse:
    client = _get_genai_client()

    if not body.messages:
        return ChatResponse(reply="No message received.")

    # Build contents list with system prompt prepended as a user turn
    contents = [{"role": "user", "parts": [{"text": SYSTEM_PROMPT}]},
                {"role": "model", "parts": [{"text": "Understood. I'm JARVIS, ready to help."}]}]

    for m in body.messages:
        contents.append({"role": m.role, "parts": [{"text": m.content}]})

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=contents,
    )
    return ChatResponse(reply=response.text)

