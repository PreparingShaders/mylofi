"""add ai_insight to meals

Revision ID: 006_add_meal_ai_insight
Revises: 005_add_meal_quality_score
Create Date: 2026-10-03 19:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "006_add_meal_ai_insight"
down_revision = "005_add_meal_quality_score"
branch_labels = None
depends_on = None


def _columns(conn, table_name):
    inspector = inspect(conn)
    return {c["name"] for c in inspector.get_columns(table_name)}


def upgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "meals")

    if "ai_insight" not in cols:
        op.add_column("meals", sa.Column("ai_insight", sa.Text(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "meals")

    if "ai_insight" in cols:
        op.drop_column("meals", "ai_insight")
