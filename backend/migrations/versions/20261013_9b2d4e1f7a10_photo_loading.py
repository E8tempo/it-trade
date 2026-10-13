"""photo loading: processing version and mark left of every photo

Revision ID: 9b2d4e1f7a10
Revises: 4707bd039653
Create Date: 2026-10-13 20:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '9b2d4e1f7a10'
down_revision: str | None = '4707bd039653'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('product_images', schema=None) as batch_op:
        batch_op.add_column(sa.Column('wm_left', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('algo_version', sa.Integer(), nullable=True))
        batch_op.create_index('ix_product_images_algo_version', ['algo_version'], unique=False)
        batch_op.create_index('ix_product_images_processed_at', ['processed_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('product_images', schema=None) as batch_op:
        batch_op.drop_index('ix_product_images_processed_at')
        batch_op.drop_index('ix_product_images_algo_version')
        batch_op.drop_column('algo_version')
        batch_op.drop_column('wm_left')
