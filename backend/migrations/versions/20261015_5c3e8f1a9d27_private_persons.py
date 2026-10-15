"""private persons

Revision ID: 5c3e8f1a9d27
Revises: a2a2a41e0664
Create Date: 2026-10-15 20:00:00.000000

A client registers as a private person (a first and a last name, no organization) and buys as one, at the retail
prices, until they choose an organization of theirs: the user's last name and the cart's choice.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '5c3e8f1a9d27'
down_revision: str | None = 'a2a2a41e0664'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('last_name', sa.String(length=255), nullable=True))
    with op.batch_alter_table('carts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('as_person', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table('carts', schema=None) as batch_op:
        batch_op.drop_column('as_person')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('last_name')
