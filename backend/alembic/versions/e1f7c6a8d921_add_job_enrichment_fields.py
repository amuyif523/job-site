"""add_job_enrichment_fields

Revision ID: e1f7c6a8d921
Revises: 9f4cb6c2b11f
Create Date: 2026-04-03 00:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = "e1f7c6a8d921"
down_revision: Union[str, Sequence[str], None] = "9f4cb6c2b11f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column(
            "enrichment_status",
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=False,
            server_default="pending",
        ),
    )
    op.add_column(
        "jobs",
        sa.Column(
            "enrichment_error",
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=False,
            server_default="",
        ),
    )
    op.add_column(
        "jobs",
        sa.Column(
            "scoring_ready",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.alter_column("jobs", "enrichment_status", server_default=None)
    op.alter_column("jobs", "enrichment_error", server_default=None)
    op.alter_column("jobs", "scoring_ready", server_default=None)


def downgrade() -> None:
    op.drop_column("jobs", "scoring_ready")
    op.drop_column("jobs", "enrichment_error")
    op.drop_column("jobs", "enrichment_status")
