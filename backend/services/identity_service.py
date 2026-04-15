"""Identity linking helpers for OAuth providers."""

from __future__ import annotations

from sqlmodel import Session, select

from models import AuthIdentity, User


def get_or_create_user_from_oauth(
    session: Session,
    *,
    provider: str,
    provider_user_id: str,
    provider_email: str,
    display_name: str | None = None,
) -> User:
    """Resolve an OAuth identity to a canonical user and create links when needed."""
    normalized_provider = provider.strip().lower()
    normalized_provider_user_id = provider_user_id.strip()
    normalized_email = provider_email.strip().lower()

    if not normalized_provider or not normalized_provider_user_id:
        raise ValueError("OAuth provider and provider user id are required")
    if not normalized_email:
        raise ValueError("Provider email is required for account linking")

    existing_identity = session.exec(
        select(AuthIdentity).where(
            AuthIdentity.provider == normalized_provider,
            AuthIdentity.provider_user_id == normalized_provider_user_id,
        )
    ).first()
    if existing_identity:
        user = session.get(User, existing_identity.user_id)
        if not user:
            raise ValueError("Linked identity references a missing user")
        return user

    user = session.exec(select(User).where(User.email == normalized_email)).first()
    if not user:
        fallback_name = display_name.strip() if display_name and display_name.strip() else normalized_email.split("@")[0]
        user = User(
            name=fallback_name,
            email=normalized_email,
            hashed_pw=None,
            target_role="",
            plan="free",
        )
        session.add(user)
        session.flush()

    identity = AuthIdentity(
        user_id=int(user.id),
        provider=normalized_provider,
        provider_user_id=normalized_provider_user_id,
        provider_email=normalized_email,
    )
    session.add(identity)
    session.commit()
    session.refresh(user)
    return user
