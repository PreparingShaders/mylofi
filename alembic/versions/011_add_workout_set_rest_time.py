"""record the measured rest on workout_sets

Revision ID: 011_add_workout_set_rest_time
Revises: 010_add_workout_ai_analysis
Create Date: 2026-10-05 14:10:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "011_add_workout_set_rest_time"
down_revision = "010_add_workout_ai_analysis"
branch_labels = None
depends_on = None


def _columns(conn, table_name):
    inspector = inspect(conn)
    return {c["name"] for c in inspector.get_columns(table_name)}


def upgrade() -> None:
    conn = op.get_bind()

    # How long the break after a set actually lasted, as opposed to
    # `rest_seconds`, which is what the plan asked for. Nullable, so every row
    # written before the timer existed keeps reading as "no measured rest"
    # instead of as a zero-second break.
    cols = _columns(conn, "workout_sets")
    if "rest_time_seconds" not in cols:
        op.add_column("workout_sets", sa.Column("rest_time_seconds", sa.Integer(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()

    cols = _columns(conn, "workout_sets")
    if "rest_time_seconds" in cols:
        op.drop_column("workout_sets", "rest_time_seconds")