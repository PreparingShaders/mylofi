"""add daily_summaries table

Revision ID: 009_add_daily_summaries
Revises: 008_add_user_ai_persona
Create Date: 2026-10-04 12:40:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "009_add_daily_summaries"
down_revision = "008_add_user_ai_persona"
branch_labels = None
depends_on = None


def _tables(conn):
    inspector = inspect(conn)
    return set(inspector.get_table_names())


def upgrade() -> None:
    conn = op.get_bind()

    # One recap per user per calendar day: the endpoint rewrites the row in place,
    # so the pair is unique rather than just indexed.
    if "daily_summaries" not in _tables(conn):
        op.create_table(
            "daily_summaries",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("date", sa.Date(), nullable=False),
            sa.Column("summary_text", sa.Text(), nullable=False),
            sa.Column("overall_score", sa.Float(), nullable=True),
            sa.Column("ai_persona", sa.String(length=20), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_daily_summaries")),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
                name=op.f("fk_daily_summaries_user_id_users"),
                ondelete="CASCADE",
            ),
            sa.UniqueConstraint("user_id", "date", name="uq_daily_summaries_user_date"),
        )
        op.create_index("ix_daily_summaries_date", "daily_summaries", ["date"])


def downgrade() -> None:
    conn = op.get_bind()
    if "daily_summaries" in _tables(conn):
        op.drop_index("ix_daily_summaries_date", table_name="daily_summaries")
        op.drop_table("daily_summaries")