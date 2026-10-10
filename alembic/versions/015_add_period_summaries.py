"""add period_summaries table

Revision ID: 015_add_period_summaries
Revises: aeb9de67dac1_add_premium_expires_at_to_users
Create Date: 2026-10-09 22:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "015_add_period_summaries"
down_revision = "aeb9de67dac1_add_premium_expires_at_to_users"
branch_labels = None
depends_on = None


def _tables(conn):
    inspector = inspect(conn)
    return set(inspector.get_table_names())


def upgrade() -> None:
    conn = op.get_bind()

    # One recap per user per period range: the endpoint rewrites the row in place,
    # so the (user, period_type, start, end) tuple is unique rather than just
    # indexed.
    if "period_summaries" not in _tables(conn):
        op.create_table(
            "period_summaries",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("period_type", sa.String(length=20), nullable=False),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
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
            sa.PrimaryKeyConstraint("id", name=op.f("pk_period_summaries")),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
                name=op.f("fk_period_summaries_user_id_users"),
                ondelete="CASCADE",
            ),
            sa.UniqueConstraint(
                "user_id",
                "period_type",
                "start_date",
                "end_date",
                name="uq_period_summaries_user_range",
            ),
        )
        op.create_index(
            "ix_period_summaries_user_range",
            "period_summaries",
            ["user_id", "period_type", "start_date", "end_date"],
        )
        op.create_index("ix_period_summaries_start_date", "period_summaries", ["start_date"])
        op.create_index("ix_period_summaries_end_date", "period_summaries", ["end_date"])


def downgrade() -> None:
    conn = op.get_bind()
    if "period_summaries" in _tables(conn):
        op.drop_index("ix_period_summaries_end_date", table_name="period_summaries")
        op.drop_index("ix_period_summaries_start_date", table_name="period_summaries")
        op.drop_index("ix_period_summaries_user_range", table_name="period_summaries")
        op.drop_table("period_summaries")