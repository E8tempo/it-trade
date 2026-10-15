"""commercial offers

Revision ID: a2a2a41e0664
Revises: d62212b0eae3
Create Date: 2026-10-15 14:56:45.030356

Commercial offers (КП) clients make for their own customers, and what an organization prints on them.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import app.models.base

revision: str = 'a2a2a41e0664'
down_revision: str | None = 'd62212b0eae3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('quotes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('organization_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=True),
    sa.Column('customer', sa.String(length=255), nullable=True),
    sa.Column('customer_contact', sa.String(length=255), nullable=True),
    sa.Column('payment', sa.String(length=16), nullable=False),
    sa.Column('markup_percent', sa.Numeric(precision=7, scale=2), nullable=False),
    sa.Column('use_rrp', sa.Boolean(), nullable=False),
    sa.Column('round_to', sa.Integer(), nullable=False),
    sa.Column('vat_rate', sa.Integer(), nullable=True),
    sa.Column('valid_until', sa.Date(), nullable=True),
    sa.Column('terms', sa.Text(), nullable=True),
    sa.Column('show_photos', sa.Boolean(), nullable=False),
    sa.Column('created_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('updated_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_quotes_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_quotes_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_quotes')),
    sa.UniqueConstraint('organization_id', 'number', name=op.f('uq_quotes_organization_id_number'))
    )
    with op.batch_alter_table('quotes', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_quotes_organization_id'), ['organization_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_quotes_user_id'), ['user_id'], unique=False)

    op.create_table('quote_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('quote_id', sa.Integer(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('sku', sa.Integer(), nullable=True),
    sa.Column('name', sa.String(length=1024), nullable=False),
    sa.Column('vendor', sa.String(length=255), nullable=True),
    sa.Column('part', sa.String(length=255), nullable=True),
    sa.Column('unit', sa.String(length=16), nullable=False),
    sa.Column('qty', sa.Integer(), nullable=False),
    sa.Column('cost', sa.Numeric(precision=12, scale=2), nullable=True),
    sa.Column('rrp', sa.Numeric(precision=12, scale=2), nullable=True),
    sa.Column('markup_percent', sa.Numeric(precision=7, scale=2), nullable=True),
    sa.Column('price', sa.Numeric(precision=12, scale=2), nullable=True),
    sa.ForeignKeyConstraint(['quote_id'], ['quotes.id'], name=op.f('fk_quote_items_quote_id_quotes'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_quote_items'))
    )
    with op.batch_alter_table('quote_items', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_quote_items_quote_id'), ['quote_id'], unique=False)

    with op.batch_alter_table('organizations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('quote_profile', sa.JSON(none_as_null=True), nullable=True))



def downgrade() -> None:
    with op.batch_alter_table('organizations', schema=None) as batch_op:
        batch_op.drop_column('quote_profile')

    with op.batch_alter_table('quote_items', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_quote_items_quote_id'))

    op.drop_table('quote_items')
    with op.batch_alter_table('quotes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_quotes_user_id'))
        batch_op.drop_index(batch_op.f('ix_quotes_organization_id'))

    op.drop_table('quotes')
