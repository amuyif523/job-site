"""
database.py — SQLite setup using raw sqlite3 (no ORM needed for this scale)
"""

import sqlite3
import os

DB_PATH = os.getenv("DB_PATH", "jarvis.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            email       TEXT    NOT NULL UNIQUE,
            hashed_pw   TEXT    NOT NULL,
            target_role TEXT    NOT NULL DEFAULT '',
            plan        TEXT    NOT NULL DEFAULT 'free',
            created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS cv_data (
            user_id        INTEGER PRIMARY KEY,
            filename       TEXT    NOT NULL DEFAULT '',
            extracted_text TEXT    NOT NULL DEFAULT '',
            last_updated   DATETIME NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    existing_cols = {
        row[1] for row in conn.execute("PRAGMA table_info(cv_data)").fetchall()
    }
    if "filename" not in existing_cols:
        conn.execute("ALTER TABLE cv_data ADD COLUMN filename TEXT NOT NULL DEFAULT ''")
    if "extracted_text" not in existing_cols:
        conn.execute("ALTER TABLE cv_data ADD COLUMN extracted_text TEXT NOT NULL DEFAULT ''")
    if "last_updated" not in existing_cols:
        conn.execute(
            "ALTER TABLE cv_data ADD COLUMN last_updated DATETIME NOT NULL DEFAULT (datetime('now'))"
        )

    conn.commit()
    conn.close()
    print("✅  Database ready — jarvis.db")
