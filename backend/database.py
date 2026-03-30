import os
from collections.abc import Generator

from sqlmodel import Session, create_engine

from config import load_environment

load_environment()

def _get_database_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if url.startswith("postgres://"):
        # Accept legacy postgres URL format often used by hosting and compose configs.
        url = url.replace("postgres://", "postgresql://", 1)
    return url


DATABASE_URL = _get_database_url()
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set; application cannot start")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


def init_db():
    # Schema lifecycle is managed by Alembic migrations.
    return None
