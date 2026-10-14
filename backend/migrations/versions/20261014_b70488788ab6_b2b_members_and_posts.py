"""b2b members and posts

Revision ID: b70488788ab6
Revises: e4be8a78c319
Create Date: 2026-10-14 13:39:18.809424

The site sells to businesses only. An organization is one record per company with its people as members (the
customer who added it becomes its owner); carts belong to signed-in users only (guest carts are deleted); news
and promotions for the home page.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import app.models.base

revision: str = 'b70488788ab6'
down_revision: str | None = 'e4be8a78c319'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

organizations = sa.table('organizations', sa.column('id', sa.Integer), sa.column('user_id', sa.Integer), sa.column('created_at', app.models.base.UTCDateTime(timezone=True)))
members = sa.table(
    'organization_members',
    sa.column('organization_id', sa.Integer),
    sa.column('user_id', sa.Integer),
    sa.column('role', sa.String),
    sa.column('created_at', app.models.base.UTCDateTime(timezone=True)),
    sa.column('updated_at', app.models.base.UTCDateTime(timezone=True)),
)
carts = sa.table('carts', sa.column('id', sa.Integer), sa.column('token', sa.String), sa.column('user_id', sa.Integer))
cart_items = sa.table('cart_items', sa.column('cart_id', sa.Integer))


def upgrade() -> None:
    conn = op.get_bind()

    # 1. news and promotions
    op.create_table('posts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('link_url', sa.String(length=512), nullable=True),
    sa.Column('is_published', sa.Boolean(), nullable=False),
    sa.Column('published_at', app.models.base.UTCDateTime(timezone=True), nullable=True),
    sa.Column('pinned', sa.Boolean(), nullable=False),
    sa.Column('ends_on', sa.Date(), nullable=True),
    sa.Column('created_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('updated_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_posts'))
    )
    with op.batch_alter_table('posts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_posts_is_published'), ['is_published'], unique=False)

    # 2. the people of an organization: whoever added it becomes its owner
    op.create_table('organization_members',
    sa.Column('organization_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('created_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('updated_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_organization_members_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_organization_members_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('organization_id', 'user_id', name=op.f('pk_organization_members'))
    )
    with op.batch_alter_table('organization_members', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_organization_members_user_id'), ['user_id'], unique=False)

    rows = conn.execute(sa.select(organizations.c.id, organizations.c.user_id, organizations.c.created_at)).all()
    if rows:
        op.bulk_insert(members, [
            {'organization_id': org_id, 'user_id': user_id, 'role': 'owner', 'created_at': at, 'updated_at': at} for org_id, user_id, at in rows
        ])

    with op.batch_alter_table('organizations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_organizations_user_id'))
        batch_op.drop_constraint(batch_op.f('fk_organizations_user_id_users'), type_='foreignkey')
        batch_op.drop_column('user_id')

    # 3. carts of signed-in users only
    guest = sa.select(carts.c.id).where(carts.c.user_id.is_(None))
    conn.execute(cart_items.delete().where(cart_items.c.cart_id.in_(guest)))
    conn.execute(carts.delete().where(carts.c.user_id.is_(None)))
    with op.batch_alter_table('carts', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=False)
        batch_op.drop_constraint(batch_op.f('uq_carts_token'), type_='unique')
        batch_op.drop_column('token')


def downgrade() -> None:
    conn = op.get_bind()

    with op.batch_alter_table('carts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('token', sa.VARCHAR(length=64), nullable=True))
        batch_op.create_unique_constraint(batch_op.f('uq_carts_token'), ['token'])
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=True)

    # an organization belongs to one customer again: its first owner (an organization without one is dropped)
    with op.batch_alter_table('organizations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.INTEGER(), nullable=True))
    first_owner = (
        sa.select(members.c.user_id)
        .where(members.c.organization_id == organizations.c.id, members.c.role == 'owner')
        .order_by(members.c.created_at, members.c.user_id)
        .limit(1)
        .scalar_subquery()
    )
    conn.execute(organizations.update().values(user_id=first_owner))
    conn.execute(organizations.delete().where(organizations.c.user_id.is_(None)))
    with op.batch_alter_table('organizations', schema=None) as batch_op:
        batch_op.alter_column('user_id', existing_type=sa.INTEGER(), nullable=False)
        batch_op.create_foreign_key(batch_op.f('fk_organizations_user_id_users'), 'users', ['user_id'], ['id'], ondelete='CASCADE')
        batch_op.create_index(batch_op.f('ix_organizations_user_id'), ['user_id'], unique=False)

    with op.batch_alter_table('organization_members', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_organization_members_user_id'))
    op.drop_table('organization_members')

    with op.batch_alter_table('posts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_posts_is_published'))
    op.drop_table('posts')
