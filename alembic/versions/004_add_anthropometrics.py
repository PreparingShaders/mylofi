"""add anthropometrics and goal columns to users

Revision ID: 004_add_anthropometrics
Revises: 003_add_usage_limits
Create Date: 2026-09-30 10:20:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "004_add_anthropometrics"
down_revision = "003_add_usage_limits"
branch_labels = None
depends_on = None


def _columns(conn, table_name):
    inspector = inspect(conn)
    return {c["name"] for c in inspector.get_columns(table_name)}


def upgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "users")

    if "age" not in cols:
        op.add_column("users", sa.Column("age", sa.Integer(), nullable=True))

    if "goal" not in cols:
        op.add_column("users", sa.Column("goal", sa.String(20), nullable=True))

    if "target_weight_kg" not in cols:
        op.add_column("users", sa.Column("target_weight_kg", sa.Float(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    cols = _columns(conn, "users")

    for name in ("target_weight_kg", "goal", "age"):
        if name in cols:
            op.drop_column("users", name)
