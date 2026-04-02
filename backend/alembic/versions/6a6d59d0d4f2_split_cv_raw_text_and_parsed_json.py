"""split_cv_raw_text_and_parsed_json

Revision ID: 6a6d59d0d4f2
Revises: 83b8c5de44f1
Create Date: 2026-04-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = "6a6d59d0d4f2"
down_revision: Union[str, Sequence[str], None] = "83b8c5de44f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "cv_data",
        sa.Column("parsed_json", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=""),
    )
    op.execute("UPDATE cv_data SET parsed_json = extracted_text, extracted_text = ''")
    op.alter_column("cv_data", "parsed_json", server_default=None)


def downgrade() -> None:
    op.execute(
        """
        UPDATE cv_data
        SET extracted_text = CASE
            WHEN extracted_text = '' THEN parsed_json
            ELSE extracted_text
        END
        """
    )
    op.drop_column("cv_data", "parsed_json")
