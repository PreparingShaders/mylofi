"""align meals.eaten_at with the instant it stands for

Every datetime in this app is written as a naive UTC stamp, but PostgreSQL reads
a naive `timestamptz` literal in the *session* timezone. Until the session was
pinned to UTC (app/db/session.py) that silently shifted every write by the
server's offset: on a Europe/Moscow database a meal logged at 00:30 local was
stored three hours early, which also put it on the previous day.

The skew is measured from the rows themselves rather than hardcoded - it is the
largest gap between a row's own `created_at` (written by the database, so always
a true instant) and its `eaten_at` - and rows that are already aligned are left
alone, so this is a no-op on data that is already right.

Revision ID: 007_fix_meal_eaten_at_timezone
Revises: 006_add_meal_ai_insight
Create Date: 2026-10-04 00:55:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = "007_fix_meal_eaten_at_timezone"
down_revision = "006_add_meal_ai_insight"
branch_labels = None
depends_on = None

# eaten_at and created_at are written microseconds apart by the same request, so
# anything beyond a couple of minutes between them is a timezone offset rather
# than execution time.
SKEWED = "eaten_at < created_at - interval '2 minutes'"

CORRECT = sa.text(
    f"""
    UPDATE meals AS m
    SET eaten_at = m.eaten_at + make_interval(secs => s.skew)
    FROM (
        SELECT round(extract(epoch FROM max(created_at - eaten_at))) AS skew
        FROM meals
        WHERE {SKEWED}
    ) AS s
    WHERE s.skew IS NOT NULL AND m.eaten_at < m.created_at - interval '2 minutes'
    """
)


def upgrade() -> None:
    op.get_bind().execute(CORRECT)


def downgrade() -> None:
    """Intentionally empty.

    The offset is not recoverable from the data once it has been corrected, and
    subtracting a guess would put the wrong instants back. Re-introducing the
    behaviour means reverting the session timezone in app/db/session.py, which
    is a code change, not a schema one.
    """