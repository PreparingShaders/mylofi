"""merge multiple heads

Revision ID: 01d8e5ef3a20
Revises: 66f53b7c44dc, 021_add_rotated_refresh_tokens
Create Date: 2026-10-26 10:18:24.128056

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '01d8e5ef3a20'
down_revision: Union[str, None] = ('66f53b7c44dc', '021_add_rotated_refresh_tokens')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass