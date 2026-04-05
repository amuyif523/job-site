"""add_job_description_quality_and_summary

Revision ID: a8c7f2d1b4e9
Revises: c7a1c9f2e8b4
Create Date: 2026-04-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = "a8c7f2d1b4e9"
down_revision: Union[str, Sequence[str], None] = "c7a1c9f2e8b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("listing_summary", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=""),
    )
    op.add_column(
        "jobs",
        sa.Column("description_quality", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default="summary"),
    )

    op.alter_column("jobs", "listing_summary", server_default=None)
    op.alter_column("jobs", "description_quality", server_default=None)


def downgrade() -> None:
    op.drop_column("jobs", "description_quality")
    op.drop_column("jobs", "listing_summary")
