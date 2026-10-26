"""add rotated_refresh_tokens table for refresh-rotation idempotency

Revision ID: 021_add_rotated_refresh_tokens
Revises: 020_comprehensive_exercise_catalog_seed
Create Date: 2026-10-26

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "021_add_rotated_refresh_tokens"
down_revision = "020_comprehensive_exercise_catalog_seed"
branch_labels = None
depends_on = None


def _tables(conn):
    inspector = inspect(conn)
    return set(inspector.get_table_names())


def _indexes(conn, table_name):
    inspector = inspect(conn)
    return {i["name"] for i in inspector.get_indexes(table_name)}


def upgrade() -> None:
    conn = op.get_bind()

    if "rotated_refresh_tokens" not in _tables(conn):
        op.create_table(
            "rotated_refresh_tokens",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("old_token_hash", sa.String(255), nullable=False, index=True),
            sa.Column("new_access_token", sa.String(1024), nullable=False),
            sa.Column("new_refresh_token", sa.String(1024), nullable=False),
            sa.Column("rotated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False, index=True),
        )
        op.create_index(
            "ix_rotated_refresh_tokens_user_rotated",
            "rotated_refresh_tokens",
            ["user_id", "rotated_at"],
        )
        op.create_index(
            "ux_rotated_refresh_tokens_old_token_hash",
            "rotated_refresh_tokens",
            ["old_token_hash"],
            unique=True,
        )


def downgrade() -> None:
    conn = op.get_bind()
    if "rotated_refresh_tokens" in _tables(conn):
        op.drop_table("rotated_refresh_tokens")
