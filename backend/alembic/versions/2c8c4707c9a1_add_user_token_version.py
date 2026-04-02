"""add user token version

Revision ID: 2c8c4707c9a1
Revises: 6a6d59d0d4f2
Create Date: 2026-04-02 21:45:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "2c8c4707c9a1"
down_revision = "6a6d59d0d4f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("users", "token_version", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "token_version")
