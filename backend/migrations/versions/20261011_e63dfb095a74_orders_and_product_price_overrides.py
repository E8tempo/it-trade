"""orders and product price overrides

Revision ID: e63dfb095a74
Revises: 1580b7c47ce9
Create Date: 2026-10-11 16:17:29.236134
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import app.models.base

revision: str = 'e63dfb095a74'
down_revision: str | None = '1580b7c47ce9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('orders',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('customer_name', sa.String(length=255), nullable=False),
    sa.Column('phone', sa.String(length=32), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=True),
    sa.Column('delivery', sa.String(length=16), nullable=False),
    sa.Column('city', sa.String(length=128), nullable=True),
    sa.Column('address', sa.String(length=512), nullable=True),
    sa.Column('comment', sa.Text(), nullable=True),
    sa.Column('manager_note', sa.Text(), nullable=True),
    sa.Column('items_total', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('delivery_price', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('discount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('total', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('cost_total', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('created_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('updated_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_orders_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_orders'))
    )
    with op.batch_alter_table('orders', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_orders_phone'), ['phone'], unique=False)
        batch_op.create_index(batch_op.f('ix_orders_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_orders_user_id'), ['user_id'], unique=False)

    op.create_table('order_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=False),
    sa.Column('at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('author_id', sa.Integer(), nullable=True),
    sa.Column('author', sa.String(length=255), nullable=True),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], name=op.f('fk_order_events_author_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], name=op.f('fk_order_events_order_id_orders'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_order_events'))
    )
    with op.batch_alter_table('order_events', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_order_events_order_id'), ['order_id'], unique=False)

    op.create_table('order_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('order_id', sa.Integer(), nullable=False),
    sa.Column('sku', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=1024), nullable=False),
    sa.Column('price', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('supplier_price', sa.Numeric(precision=12, scale=2), nullable=True),
    sa.Column('qty', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], name=op.f('fk_order_items_order_id_orders'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_order_items'))
    )
    with op.batch_alter_table('order_items', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_order_items_order_id'), ['order_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_order_items_sku'), ['sku'], unique=False)

    with op.batch_alter_table('products', schema=None) as batch_op:
        batch_op.add_column(sa.Column('price_override', sa.Numeric(precision=12, scale=2), nullable=True))
        batch_op.add_column(sa.Column('is_hidden', sa.Boolean(), nullable=False, server_default=sa.false()))



def downgrade() -> None:
    with op.batch_alter_table('products', schema=None) as batch_op:
        batch_op.drop_column('is_hidden')
        batch_op.drop_column('price_override')

    with op.batch_alter_table('order_items', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_order_items_sku'))
        batch_op.drop_index(batch_op.f('ix_order_items_order_id'))

    op.drop_table('order_items')
    with op.batch_alter_table('order_events', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_order_events_order_id'))

    op.drop_table('order_events')
    with op.batch_alter_table('orders', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_orders_user_id'))
        batch_op.drop_index(batch_op.f('ix_orders_status'))
        batch_op.drop_index(batch_op.f('ix_orders_phone'))

    op.drop_table('orders')
