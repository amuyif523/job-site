import os
import time
from collections.abc import Generator

from sqlalchemy.exc import OperationalError
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
MAX_DB_CONNECT_ATTEMPTS = 20
DB_CONNECT_RETRY_DELAY_SECONDS = 5

for attempt in range(1, MAX_DB_CONNECT_ATTEMPTS + 1):
    try:
        with engine.connect() as conn:
            pass
        print("Successfully connected to the database.")
        break
    except OperationalError as e:
        if attempt < MAX_DB_CONNECT_ATTEMPTS:
            print(
                "Database connection failed. "
                f"Retrying in {DB_CONNECT_RETRY_DELAY_SECONDS} seconds... "
                f"({attempt}/{MAX_DB_CONNECT_ATTEMPTS})"
            )
            time.sleep(DB_CONNECT_RETRY_DELAY_SECONDS)
        else:
            print(f"Failed to connect to the database after {MAX_DB_CONNECT_ATTEMPTS} attempts.")
            raise e


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


def init_db():
    # Schema lifecycle is managed by Alembic migrations.
    return None
