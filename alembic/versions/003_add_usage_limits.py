"""add subscription and usage tracking columns to users

Revision ID: 003_add_usage_limits
Revises: 002_add_personal_exercises
Create Date: 2026-09-30 09:10:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "003_add_usage_limits"
down_revision = "002_add_personal_exercises"
branch_labels = None
depends_on = None


def _columns(conn, table_name):
    inspector = inspect(conn)
    return {c["name"] for c in inspector.get_columns(table_name)}


def upgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "users")

    if "is_premium" not in cols:
        op.add_column(
            "users",
            sa.Column(
                "is_premium",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )

    if "meal_ai_daily_count" not in cols:
        op.add_column(
            "users",
            sa.Column(
                "meal_ai_daily_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        )

    if "last_meal_ai_date" not in cols:
        op.add_column(
            "users",
            sa.Column("last_meal_ai_date", sa.Date(), nullable=True),
        )

    if "last_workout_ai_analysis_at" not in cols:
        op.add_column(
            "users",
            sa.Column("last_workout_ai_analysis_at", sa.DateTime(timezone=True), nullable=True),
        )

    if "last_nutrition_ai_analysis_at" not in cols:
        op.add_column(
            "users",
            sa.Column("last_nutrition_ai_analysis_at", sa.DateTime(timezone=True), nullable=True),
        )

    if "created_workouts_count" not in cols:
        op.add_column(
            "users",
            sa.Column(
                "created_workouts_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        )


def downgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "users")

    for name in (
        "created_workouts_count",
        "last_nutrition_ai_analysis_at",
        "last_workout_ai_analysis_at",
        "last_meal_ai_date",
        "meal_ai_daily_count",
        "is_premium",
    ):
        if name in cols:
            op.drop_column("users", name)
