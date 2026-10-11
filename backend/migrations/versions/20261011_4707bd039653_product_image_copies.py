"""product image copies

Revision ID: 4707bd039653
Revises: e63dfb095a74
Create Date: 2026-10-11 20:11:57.035255
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import app.models.base

revision: str = '4707bd039653'
down_revision: str | None = 'e63dfb095a74'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('product_images', schema=None) as batch_op:
        batch_op.add_column(sa.Column('duplicate_of', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('product_images', schema=None) as batch_op:
        batch_op.drop_column('duplicate_of')
