"""add is_admin flag to users

Revision ID: 013_add_user_admin_flags
Revises: 012_add_workout_ai_plan
Create Date: 2026-10-07 06:16:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "013_add_user_admin_flags"
down_revision = "012_add_workout_ai_plan"
branch_labels = None
depends_on = None


def _columns(conn, table_name):
    inspector = inspect(conn)
    return {c["name"] for c in inspector.get_columns(table_name)}


def upgrade() -> None:
    conn = op.get_bind()

    # `is_admin` is the authorization flag the admin panel reads. It is separate
    # from `role` (which stays a soft label) so an admin can never be locked out
    # of the panel by a role rename, and so the first registered user can be
    # bootstrapped onto it without touching the enum.
    cols = _columns(conn, "users")
    if "is_admin" not in cols:
        op.add_column(
            "users",
            sa.Column("is_admin", sa.Boolean(), server_default="0", nullable=False),
        )


def downgrade() -> None:
    conn = op.get_bind()

    cols = _columns(conn, "users")
    if "is_admin" in cols:
        op.drop_column("users", "is_admin")