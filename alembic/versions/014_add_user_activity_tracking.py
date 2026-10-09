"""add last_seen_at and total_ai_requests to users

Revision ID: 014_add_user_activity_tracking
Revises: aeb9de67dac1
Create Date: 2026-10-09 10:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "014_add_user_activity_tracking"
down_revision = "aeb9de67dac1"
branch_labels = None
depends_on = None


def _columns(conn, table_name):
    inspector = inspect(conn)
    return {c["name"] for c in inspector.get_columns(table_name)}


def upgrade() -> None:
    conn = op.get_bind()

    # `last_seen_at` stamps the most recent login so the admin panel can
    # show when a user was last active; `total_ai_requests` is the
    # lifetime counter of AI interactions (meal, workout, day recap).
    cols = _columns(conn, "users")
    if "last_seen_at" not in cols:
        op.add_column(
            "users",
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "total_ai_requests" not in cols:
        op.add_column(
            "users",
            sa.Column("total_ai_requests", sa.Integer(), server_default="0", nullable=False),
        )


def downgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "users")
    if "last_seen_at" in cols:
        op.drop_column("users", "last_seen_at")
    if "total_ai_requests" in cols:
        op.drop_column("users", "total_ai_requests")
