"""expand exercise catalog with DDX Fitness equipment

Revision ID: 019_expand_exercise_catalog_ddx
Revises: 018_add_verification_codes
Create Date: 2026-10-17 12:00:00.000000

"""
from alembic import op
from sqlalchemy import inspect, text
from app.services.exercise_data import EXERCISE_SEED

# revision identifiers, used by Alembic.
revision = "019_expand_exercise_catalog_ddx"
down_revision = "018_add_verification_codes"
branch_labels = None
depends_on = None


def _indexes(conn):
    inspector = inspect(conn)
    return {i["name"] for i in inspector.get_indexes("exercise_catalog")}


def upgrade() -> None:
    conn = op.get_bind()

    # `ON CONFLICT (name)` requires a unique index on exercise_catalog.name.
    existing_indexes = _indexes(conn)
    if "ix_exercise_catalog_name" not in existing_indexes:
        op.create_index(
            "ix_exercise_catalog_name", "exercise_catalog", ["name"], unique=True
        )

    # Insert seed exercises idempotently. Existing rows are left untouched.
    for item in EXERCISE_SEED:
        conn.execute(
            text(
                """
                INSERT INTO exercise_catalog (name, muscle_group, equipment, is_compound, created_at, updated_at)
                VALUES (:name, :muscle_group, :equipment, :is_compound, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (name) DO NOTHING
                """
            ),
            {
                "name": item["name"],
                "muscle_group": item["muscle_group"],
                "equipment": item["equipment"],
                "is_compound": item.get("is_compound", False),
            },
        )


def downgrade() -> None:
    # No-op: seed exercises are preserved to avoid deleting user data.
    pass
