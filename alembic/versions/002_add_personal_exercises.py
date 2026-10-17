"""add user_id and timestamps to exercise_catalog

Revision ID: 002_add_personal_exercises
Revises: 
Create Date: 2026-09-22 09:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "002_add_personal_exercises"
down_revision = None
branch_labels = None
depends_on = None


def _columns(conn, table_name):
    inspector = inspect(conn)
    return {c["name"] for c in inspector.get_columns(table_name)}


def upgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "exercise_catalog")

    if "user_id" not in cols:
        op.add_column(
            "exercise_catalog",
            sa.Column("user_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_exercise_catalog_user_id",
            "exercise_catalog",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_index(
            "ix_exercise_catalog_user_id", "exercise_catalog", ["user_id"]
        )

    if "created_at" not in cols:
        op.add_column(
            "exercise_catalog",
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
        )

    if "updated_at" not in cols:
        op.add_column(
            "exercise_catalog",
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
        )


def downgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "exercise_catalog")

    if "updated_at" in cols:
        op.drop_column("exercise_catalog", "updated_at")
    if "created_at" in cols:
        op.drop_column("exercise_catalog", "created_at")
    if "user_id" in cols:
        op.drop_constraint(
            "fk_exercise_catalog_user_id",
            "exercise_catalog",
            type_="foreignkey",
        )
        op.drop_index(
            "ix_exercise_catalog_user_id", table_name="exercise_catalog"
        )
        op.drop_column("exercise_catalog", "user_id")
