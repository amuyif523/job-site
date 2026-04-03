"""add_job_score_label

Revision ID: 9f4cb6c2b11f
Revises: 6a6d59d0d4f2
Create Date: 2026-04-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = "9f4cb6c2b11f"
down_revision: Union[str, Sequence[str], None] = "6a6d59d0d4f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("score_label", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("jobs", "score_label")
