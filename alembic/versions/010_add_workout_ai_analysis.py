"""add the AI coach verdict to workout_sessions

Revision ID: 010_add_workout_ai_analysis
Revises: 009_add_daily_summaries
Create Date: 2026-10-05 04:20:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "010_add_workout_ai_analysis"
down_revision = "009_add_daily_summaries"
branch_labels = None
depends_on = None


def _columns(conn, table_name):
    inspector = inspect(conn)
    return {c["name"] for c in inspector.get_columns(table_name)}


def upgrade() -> None:
    conn = op.get_bind()

    # The coach verdict of one session: the headline text, the JSON-encoded
    # breakdown under it and the moment it was written. All nullable, so the
    # sessions that were never analysed are unaffected and existing rows keep
    # reading as "no analysis".
    cols = _columns(conn, "workout_sessions")
    if "ai_summary" not in cols:
        op.add_column("workout_sessions", sa.Column("ai_summary", sa.Text(), nullable=True))
    if "ai_recommendations_json" not in cols:
        op.add_column("workout_sessions", sa.Column("ai_recommendations_json", sa.Text(), nullable=True))
    if "analyzed_at" not in cols:
        op.add_column(
            "workout_sessions",
            sa.Column("analyzed_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "ai_persona" not in cols:
        op.add_column("workout_sessions", sa.Column("ai_persona", sa.String(length=20), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()

    cols = _columns(conn, "workout_sessions")
    if "ai_persona" in cols:
        op.drop_column("workout_sessions", "ai_persona")
    if "analyzed_at" in cols:
        op.drop_column("workout_sessions", "analyzed_at")
    if "ai_recommendations_json" in cols:
        op.drop_column("workout_sessions", "ai_recommendations_json")
    if "ai_summary" in cols:
        op.drop_column("workout_sessions", "ai_summary")