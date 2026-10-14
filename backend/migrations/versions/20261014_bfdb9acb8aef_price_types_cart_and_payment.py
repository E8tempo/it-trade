"""price types, cart and payment method

Revision ID: bfdb9acb8aef
Revises: 9b2d4e1f7a10
Create Date: 2026-10-14 12:00:00.000000

Every product gets 4 prices (retail / wholesale, cash / cashless), each by its own markup rules, kept per
supplier. Nothing changes for the shop: the new prices start equal to today's price, every type gets
today's rules, and a price the admin fixed stays fixed for every type.
"""

from collections.abc import Sequence
from decimal import Decimal

import sqlalchemy as sa
from alembic import op

import app.models.base

revision: str = 'bfdb9acb8aef'
down_revision: str | None = '9b2d4e1f7a10'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PRICE_TYPES = ('retail_cash', 'retail_cashless', 'wholesale_cash', 'wholesale_cashless')
NEW_PRICES = ('price_retail_cashless', 'price_wholesale_cash', 'price_wholesale_cashless')  # retail cash is `price`

# the tables as the data steps see them: JSON values are serialised by SQLAlchemy on both dialects
products = sa.table(
    'products',
    sa.column('sku', sa.Integer),
    sa.column('price', sa.Numeric(12, 2)),
    sa.column('price_override', sa.Numeric(12, 2)),
    sa.column('price_overrides', sa.JSON(none_as_null=True)),
    *(sa.column(c, sa.Numeric(12, 2)) for c in NEW_PRICES),
)
site_settings = sa.table(
    'site_settings',
    sa.column('key', sa.String),
    sa.column('value', sa.JSON),
    sa.column('updated_at', app.models.base.UTCDateTime(timezone=True)),
)


def _move_setting(old_key: str, new_key: str, convert) -> None:
    """Replaces the site_settings row `old_key` with `new_key` = convert(old value)."""
    conn = op.get_bind()
    row = conn.execute(sa.select(site_settings.c.value, site_settings.c.updated_at).where(site_settings.c.key == old_key)).first()
    if row is None:
        return  # never saved: the defaults apply
    if conn.execute(sa.select(site_settings.c.key).where(site_settings.c.key == new_key)).first() is None:
        conn.execute(site_settings.insert().values(key=new_key, value=convert(row.value), updated_at=row.updated_at))
    conn.execute(site_settings.delete().where(site_settings.c.key == old_key))


def upgrade() -> None:
    conn = op.get_bind()

    # 1. products: 3 more prices, equal to today's one; a fixed price stays fixed for every type
    with op.batch_alter_table('products', schema=None) as batch_op:
        for column in NEW_PRICES:
            batch_op.add_column(sa.Column(column, sa.Numeric(precision=12, scale=2), nullable=True))
        batch_op.add_column(sa.Column('price_overrides', sa.JSON(none_as_null=True), nullable=True))

    op.execute(products.update().values({column: products.c.price for column in NEW_PRICES}))
    fixed = conn.execute(sa.select(products.c.sku, products.c.price_override).where(products.c.price_override.is_not(None)))
    for sku, price in fixed.all():
        overrides = dict.fromkeys(PRICE_TYPES, str(price))
        conn.execute(products.update().where(products.c.sku == sku).values(price_overrides=overrides))

    with op.batch_alter_table('products', schema=None) as batch_op:
        batch_op.drop_column('price_override')

    # 2. markup rules: per supplier (every product is IT Partner's), today's rules for every price type
    _move_setting('pricing', 'pricing:itp', lambda rules: dict.fromkeys(PRICE_TYPES, rules))

    # 3. orders: the payment method and the price type of the lines
    with op.batch_alter_table('orders', schema=None) as batch_op:
        batch_op.add_column(sa.Column('payment_method', sa.String(length=16), nullable=False, server_default='cash'))
        batch_op.add_column(sa.Column('price_type', sa.String(length=24), nullable=False, server_default='retail_cash'))

    # 4. carts of guests (cookie) and users
    op.create_table('carts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('token', sa.String(length=64), nullable=True),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('created_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('updated_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_carts_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_carts')),
    sa.UniqueConstraint('token', name=op.f('uq_carts_token')),
    sa.UniqueConstraint('user_id', name=op.f('uq_carts_user_id'))
    )
    op.create_table('cart_items',
    sa.Column('cart_id', sa.Integer(), nullable=False),
    sa.Column('sku', sa.Integer(), autoincrement=False, nullable=False),
    sa.Column('qty', sa.Integer(), nullable=False),
    sa.Column('added_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['cart_id'], ['carts.id'], name=op.f('fk_cart_items_cart_id_carts'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('cart_id', 'sku', name=op.f('pk_cart_items'))
    )

    # 5. 9b2d4e1f7a10 created wm_left as FLOAT, the model has Double: the same type on Postgres, but on SQLite
    # `alembic check` reported the difference
    with op.batch_alter_table('product_images', schema=None) as batch_op:
        batch_op.alter_column('wm_left', existing_type=sa.Float(), type_=sa.Double(), existing_nullable=True)


def downgrade() -> None:
    conn = op.get_bind()

    with op.batch_alter_table('product_images', schema=None) as batch_op:
        batch_op.alter_column('wm_left', existing_type=sa.Double(), type_=sa.Float(), existing_nullable=True)

    op.drop_table('cart_items')
    op.drop_table('carts')

    with op.batch_alter_table('orders', schema=None) as batch_op:
        batch_op.drop_column('price_type')
        batch_op.drop_column('payment_method')

    _move_setting('pricing:itp', 'pricing', lambda pricing: pricing.get('retail_cash') or {})

    # the fixed retail cash prices stay fixed; prices fixed only for the other types are lost
    with op.batch_alter_table('products', schema=None) as batch_op:
        batch_op.add_column(sa.Column('price_override', sa.Numeric(precision=12, scale=2), nullable=True))

    fixed = conn.execute(sa.select(products.c.sku, products.c.price_overrides).where(products.c.price_overrides.is_not(None)))
    for sku, overrides in fixed.all():
        if overrides and overrides.get('retail_cash'):
            conn.execute(products.update().where(products.c.sku == sku).values(price_override=Decimal(overrides['retail_cash'])))

    with op.batch_alter_table('products', schema=None) as batch_op:
        batch_op.drop_column('price_overrides')
        for column in reversed(NEW_PRICES):
            batch_op.drop_column(column)
