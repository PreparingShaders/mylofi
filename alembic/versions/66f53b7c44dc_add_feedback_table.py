"""add feedback table

Revision ID: 66f53b7c44dc
Revises: 53760f59904d
Create Date: 2026-10-15 11:53:30.553984

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "66f53b7c44dc"
down_revision: Union[str, None] = "53760f59904d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables(conn):
    inspector = inspect(conn)
    return set(inspector.get_table_names())


def upgrade() -> None:
    conn = op.get_bind()
    # The feedback table holds guest and authenticated support/PRO requests.
    # Guarded so the migration is idempotent: on databases where the table was
    # already created (e.g. by ``Base.metadata.create_all`` during startup) the
    # upgrade is a no-op rather than an error.
    if "feedback" not in _tables(conn):
        op.create_table(
            "feedback",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("email", sa.String(255), nullable=False),
            sa.Column("category", sa.String(50), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("images", sa.Text(), nullable=True),
            sa.Column("status", sa.String(50), nullable=False, server_default="new"),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
        )
        op.create_index(op.f("ix_feedback_id"), "feedback", ["id"], unique=False)
        op.create_index(op.f("ix_feedback_user_id"), "feedback", ["user_id"], unique=False)
        op.create_index(op.f("ix_feedback_status"), "feedback", ["status"], unique=False)
        op.create_index(op.f("ix_feedback_category"), "feedback", ["category"], unique=False)


def downgrade() -> None:
    conn = op.get_bind()
    if "feedback" in _tables(conn):
        op.drop_table("feedback")