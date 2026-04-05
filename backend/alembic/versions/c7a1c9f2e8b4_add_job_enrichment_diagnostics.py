"""add_job_enrichment_diagnostics

Revision ID: c7a1c9f2e8b4
Revises: f5b7a2d13c4e
Create Date: 2026-04-03 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = "c7a1c9f2e8b4"
down_revision: Union[str, Sequence[str], None] = "f5b7a2d13c4e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("enrichment_method", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=""),
    )
    op.add_column(
        "jobs",
        sa.Column("enrichment_duration_ms", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "jobs",
        sa.Column("enrichment_retryable", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.alter_column("jobs", "enrichment_method", server_default=None)
    op.alter_column("jobs", "enrichment_duration_ms", server_default=None)
    op.alter_column("jobs", "enrichment_retryable", server_default=None)


def downgrade() -> None:
    op.drop_column("jobs", "enrichment_retryable")
    op.drop_column("jobs", "enrichment_duration_ms")
    op.drop_column("jobs", "enrichment_method")
