"""add ix_period_summaries_user_created index

Revision ID: 017_add_period_summaries_user_created_index
Revises: 016_relax_period_summaries
Create Date: 2026-10-12 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "017_add_period_summaries_idx"
down_revision = "016_relax_period_summaries"
branch_labels = None
depends_on = None


def _tables(conn):
    inspector = inspect(conn)
    return set(inspector.get_table_names())


def _indexes(conn, table_name):
    inspector = inspect(conn)
    return {i["name"] for i in inspector.get_indexes(table_name)}


def upgrade() -> None:
    conn = op.get_bind()
    if "period_summaries" in _tables(conn):
        existing = _indexes(conn, "period_summaries")
        if "ix_period_summaries_user_created" not in existing:
            op.create_index(
                "ix_period_summaries_user_created",
                "period_summaries",
                ["user_id", "period_type", "created_at"],
            )


def downgrade() -> None:
    conn = op.get_bind()
    if "period_summaries" in _tables(conn):
        existing = _indexes(conn, "period_summaries")
        if "ix_period_summaries_user_created" in existing:
            op.drop_index(
                "ix_period_summaries_user_created",
                table_name="period_summaries",
            )