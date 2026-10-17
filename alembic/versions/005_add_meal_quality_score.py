"""add quality_score and quality_reason to meals

Revision ID: 005_add_meal_quality_score
Revises: 004_add_anthropometrics
Create Date: 2026-10-03 11:21:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "005_add_meal_quality_score"
down_revision = "004_add_anthropometrics"
branch_labels = None
depends_on = None


def _columns(conn, table_name):
    inspector = inspect(conn)
    return {c["name"] for c in inspector.get_columns(table_name)}


def upgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "meals")

    if "quality_score" not in cols:
        op.add_column("meals", sa.Column("quality_score", sa.Float(), nullable=True))

    if "quality_reason" not in cols:
        op.add_column("meals", sa.Column("quality_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "meals")

    for name in ("quality_reason", "quality_score"):
        if name in cols:
            op.drop_column("meals", name)