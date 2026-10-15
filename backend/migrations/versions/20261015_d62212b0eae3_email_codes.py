"""email codes

Revision ID: d62212b0eae3
Revises: b70488788ab6
Create Date: 2026-10-15 10:53:40.156271

One-time codes sent to e-mail addresses: an account is created only with the code sent to its address.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import app.models.base

revision: str = 'd62212b0eae3'
down_revision: str | None = 'b70488788ab6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('email_codes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('purpose', sa.String(length=16), nullable=False),
    sa.Column('code_hash', sa.String(length=64), nullable=False),
    sa.Column('created_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('expires_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('used_at', app.models.base.UTCDateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_email_codes'))
    )
    with op.batch_alter_table('email_codes', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_email_codes_email'), ['email'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('email_codes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_email_codes_email'))

    op.drop_table('email_codes')
