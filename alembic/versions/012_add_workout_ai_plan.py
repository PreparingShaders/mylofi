"""add the AI workout plan cache to workout_sessions

Revision ID: 012_add_workout_ai_plan
Revises: 011_add_workout_set_rest_time
Create Date: 2026-10-06 03:42:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "012_add_workout_ai_plan"
down_revision = "011_add_workout_set_rest_time"
branch_labels = None
depends_on = None


def _columns(conn, table_name):
    inspector = inspect(conn)
    return {c["name"] for c in inspector.get_columns(table_name)}


def upgrade() -> None:
    conn = op.get_bind()

    # The AI plan cache: a JSON-encoded preview stored when a session is started
    # with `with_ai_plan=true`, plus a status column so the client can show
    # "coach is thinking" without hitting the model again. Both nullable, so
    # existing sessions read as "no plan" until one is generated.
    cols = _columns(conn, "workout_sessions")
    if "ai_plan_json" not in cols:
        op.add_column("workout_sessions", sa.Column("ai_plan_json", sa.Text(), nullable=True))
    if "ai_plan_status" not in cols:
        op.add_column(
            "workout_sessions",
            sa.Column("ai_plan_status", sa.String(length=20), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()

    cols = _columns(conn, "workout_sessions")
    if "ai_plan_status" in cols:
        op.drop_column("workout_sessions", "ai_plan_status")
    if "ai_plan_json" in cols:
        op.drop_column("workout_sessions", "ai_plan_json")
