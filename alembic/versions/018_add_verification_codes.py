"""add verification_codes table and is_verified flag to users

Revision ID: 018_add_verification_codes
Revises: 017_add_period_summaries_user_created_index
Create Date: 2026-10-14

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "018_add_verification_codes"
down_revision = "017_add_period_summaries_idx"
branch_labels = None
depends_on = None


def _tables(conn):
    inspector = inspect(conn)
    return set(inspector.get_table_names())


def _columns(conn, table_name):
    inspector = inspect(conn)
    return {c["name"] for c in inspector.get_columns(table_name)}


def _indexes(conn, table_name):
    inspector = inspect(conn)
    return {i["name"] for i in inspector.get_indexes(table_name)}


def upgrade() -> None:
    conn = op.get_bind()

    # `is_verified` marks accounts that have confirmed their email. Defaults to
    # true so existing rows are not locked out after the migration.
    if "users" in _tables(conn):
        cols = _columns(conn, "users")
        if "is_verified" not in cols:
            op.add_column(
                "users",
                sa.Column("is_verified", sa.Boolean(), server_default="1", nullable=False),
            )

    # `verification_codes` stores one-time 6-digit codes for registration and
    # password-reset flows.
    if "verification_codes" not in _tables(conn):
        op.create_table(
            "verification_codes",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("email", sa.String(255), nullable=False),
            sa.Column("code", sa.String(6), nullable=False),
            sa.Column("purpose", sa.String(50), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("password_hash", sa.String(255), nullable=True),
            sa.Column("full_name", sa.String(255), nullable=True),
        )

    if "verification_codes" in _tables(conn):
        idx = _indexes(conn, "verification_codes")
        if "ix_verification_codes_email_purpose" not in idx:
            op.create_index(
                "ix_verification_codes_email_purpose",
                "verification_codes",
                ["email", "purpose"],
            )


def downgrade() -> None:
    conn = op.get_bind()

    if "verification_codes" in _tables(conn):
        op.drop_table("verification_codes")
    if "users" in _tables(conn):
        cols = _columns(conn, "users")
        if "is_verified" in cols:
            op.drop_column("users", "is_verified")
