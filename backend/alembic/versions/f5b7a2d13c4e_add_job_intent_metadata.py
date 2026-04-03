"""add_job_intent_metadata

Revision ID: f5b7a2d13c4e
Revises: e1f7c6a8d921
Create Date: 2026-04-03 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = "f5b7a2d13c4e"
down_revision: Union[str, Sequence[str], None] = "e1f7c6a8d921"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("intent_status", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default="included"),
    )
    op.add_column(
        "jobs",
        sa.Column("intent_reason", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=""),
    )
    op.add_column(
        "jobs",
        sa.Column("matched_keywords", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "jobs",
        sa.Column("blocked_keywords", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "jobs",
        sa.Column("inferred_seniority", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default="unknown"),
    )
    op.add_column(
        "jobs",
        sa.Column("source_confidence", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default="medium"),
    )

    op.alter_column("jobs", "intent_status", server_default=None)
    op.alter_column("jobs", "intent_reason", server_default=None)
    op.alter_column("jobs", "matched_keywords", server_default=None)
    op.alter_column("jobs", "blocked_keywords", server_default=None)
    op.alter_column("jobs", "inferred_seniority", server_default=None)
    op.alter_column("jobs", "source_confidence", server_default=None)


def downgrade() -> None:
    op.drop_column("jobs", "source_confidence")
    op.drop_column("jobs", "inferred_seniority")
    op.drop_column("jobs", "blocked_keywords")
    op.drop_column("jobs", "matched_keywords")
    op.drop_column("jobs", "intent_reason")
    op.drop_column("jobs", "intent_status")
