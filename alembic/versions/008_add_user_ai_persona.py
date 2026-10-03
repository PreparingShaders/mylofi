"""add AI nutritionist persona to users, and the persona used to meals

Revision ID: 008_add_user_ai_persona
Revises: 007_fix_meal_eaten_at_timezone
Create Date: 2026-10-04 02:10:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "008_add_user_ai_persona"
down_revision = "007_fix_meal_eaten_at_timezone"
branch_labels = None
depends_on = None


def _columns(conn, table_name):
    inspector = inspect(conn)
    return {c["name"] for c in inspector.get_columns(table_name)}


def upgrade() -> None:
    conn = op.get_bind()

    # The persona the nutritionist speaks with, plus the free text behind the
    # "custom" one. Both are nullable: a row without them falls back to the
    # default persona at analysis time.
    user_cols = _columns(conn, "users")
    if "ai_persona" not in user_cols:
        op.add_column("users", sa.Column("ai_persona", sa.String(length=20), nullable=True))
    if "ai_persona_custom_text" not in user_cols:
        op.add_column("users", sa.Column("ai_persona_custom_text", sa.Text(), nullable=True))

    # Which persona wrote a given verdict. Stored per meal rather than read from
    # the profile on render, so switching persona does not relabel old cards.
    meal_cols = _columns(conn, "meals")
    if "ai_persona" not in meal_cols:
        op.add_column("meals", sa.Column("ai_persona", sa.String(length=20), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()

    meal_cols = _columns(conn, "meals")
    if "ai_persona" in meal_cols:
        op.drop_column("meals", "ai_persona")

    user_cols = _columns(conn, "users")
    if "ai_persona_custom_text" in user_cols:
        op.drop_column("users", "ai_persona_custom_text")
    if "ai_persona" in user_cols:
        op.drop_column("users", "ai_persona")