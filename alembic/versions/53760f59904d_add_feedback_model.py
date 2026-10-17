"""add feedback model

Revision ID: 53760f59904d
Revises: 018_add_verification_codes
Create Date: 2026-10-15 11:52:45.565008

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "53760f59904d"
down_revision: Union[str, None] = "018_add_verification_codes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _indexes(conn, table_name):
    inspector = inspect(conn)
    return {i["name"] for i in inspector.get_indexes(table_name)}


def upgrade() -> None:
    conn = op.get_bind()
    # Single-column indexes on verification_codes. ``018_add_verification_codes``
    # already creates the composite ``ix_verification_codes_email_purpose``; these
    # extras are a convenience for the lookups the auth flow performs. Each is
    # guarded so the migration is idempotent and can be re-run safely.
    idx = _indexes(conn, "verification_codes")
    if "ix_verification_codes_email" not in idx:
        op.create_index(op.f("ix_verification_codes_email"), "verification_codes", ["email"], unique=False)
    if "ix_verification_codes_expires_at" not in idx:
        op.create_index(op.f("ix_verification_codes_expires_at"), "verification_codes", ["expires_at"], unique=False)
    if "ix_verification_codes_id" not in idx:
        op.create_index(op.f("ix_verification_codes_id"), "verification_codes", ["id"], unique=False)
    if "ix_verification_codes_purpose" not in idx:
        op.create_index(op.f("ix_verification_codes_purpose"), "verification_codes", ["purpose"], unique=False)


def downgrade() -> None:
    conn = op.get_bind()
    idx = _indexes(conn, "verification_codes")
    if "ix_verification_codes_purpose" in idx:
        op.drop_index(op.f("ix_verification_codes_purpose"), table_name="verification_codes")
    if "ix_verification_codes_id" in idx:
        op.drop_index(op.f("ix_verification_codes_id"), table_name="verification_codes")
    if "ix_verification_codes_expires_at" in idx:
        op.drop_index(op.f("ix_verification_codes_expires_at"), table_name="verification_codes")
    if "ix_verification_codes_email" in idx:
        op.drop_index(op.f("ix_verification_codes_email"), table_name="verification_codes")