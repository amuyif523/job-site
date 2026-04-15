"""merge_auth_and_job_branches

Revision ID: 1b45ab85df62
Revises: 2c8c4707c9a1, a8c7f2d1b4e9
Create Date: 2026-04-14 07:28:00.032149

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '1b45ab85df62'
down_revision: Union[str, Sequence[str], None] = ('2c8c4707c9a1', 'a8c7f2d1b4e9')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
