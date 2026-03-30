import os
from collections.abc import Generator

from sqlmodel import Session, SQLModel, create_engine

from config import load_environment

load_environment()

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set; application cannot start")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


def init_db():
    SQLModel.metadata.create_all(engine)
    print("Database schema ensured")
