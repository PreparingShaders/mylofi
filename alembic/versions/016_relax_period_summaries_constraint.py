"""relax period_summaries unique constraint and add payload_json

Revision ID: 016_relax_period_summaries
Revises: 015_add_period_summaries
Create Date: 2026-10-12 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "016_relax_period_summaries"
down_revision = "015_add_period_summaries"
branch_labels = None
depends_on = None


def _tables(conn):
    inspector = inspect(conn)
    return set(inspector.get_table_names())


def _constraints(conn, table_name):
    inspector = inspect(conn)
    return {c["name"] for c in inspector.get_unique_constraints(table_name)}


def upgrade() -> None:
    conn = op.get_bind()

    if "period_summaries" in _tables(conn):
        # Drop the unique constraint so historical reports for the same
        # (user, period_type, start, end) range can be stored without
        # overwriting. The latest report is found by ordering by
        # created_at DESC.
        existing_constraints = _constraints(conn, "period_summaries")
        if "uq_period_summaries_user_range" in existing_constraints:
            op.drop_constraint(
                "uq_period_summaries_user_range",
                "period_summaries",
                type_="unique",
            )

        # Store the full synergy verdict payload as JSON so the widget can
        # re-render historical analyses without a second model call.
        cols = {c["name"] for c in inspect(conn).get_columns("period_summaries")}
        if "payload_json" not in cols:
            op.add_column(
                "period_summaries",
                sa.Column("payload_json", sa.Text(), nullable=True),
            )


def downgrade() -> None:
    conn = op.get_bind()
    if "period_summaries" in _tables(conn):
        cols = {c["name"] for c in inspect(conn).get_columns("period_summaries")}
        if "payload_json" in cols:
            op.drop_column("period_summaries", "payload_json")

        # Recreate the unique constraint that the upgrade removed.
        op.create_unique_constraint(
            "uq_period_summaries_user_range",
            "period_summaries",
            ["user_id", "period_type", "start_date", "end_date"],
        )