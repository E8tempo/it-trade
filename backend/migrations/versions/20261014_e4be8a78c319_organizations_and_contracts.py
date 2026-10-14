"""organizations and contracts

Revision ID: e4be8a78c319
Revises: bfdb9acb8aef
Create Date: 2026-10-14 12:27:27.885064

Organizations customers buy for (checked by a manager, wholesale prices once approved) and their contracts with
the shop; the cart remembers who its user buys for, the order keeps the organization's requisites and contract.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import app.models.base

revision: str = 'e4be8a78c319'
down_revision: str | None = 'bfdb9acb8aef'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('organizations',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('inn', sa.String(length=12), nullable=False),
    sa.Column('kpp', sa.String(length=9), nullable=True),
    sa.Column('ogrn', sa.String(length=15), nullable=True),
    sa.Column('address', sa.String(length=512), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('review_note', sa.Text(), nullable=True),
    sa.Column('reviewed_at', app.models.base.UTCDateTime(timezone=True), nullable=True),
    sa.Column('reviewed_by', sa.String(length=255), nullable=True),
    sa.Column('created_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('updated_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_organizations_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_organizations'))
    )
    with op.batch_alter_table('organizations', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_organizations_inn'), ['inn'], unique=False)
        batch_op.create_index(batch_op.f('ix_organizations_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_organizations_user_id'), ['user_id'], unique=False)

    op.create_table('contracts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('organization_id', sa.Integer(), nullable=False),
    sa.Column('number', sa.String(length=64), nullable=False),
    sa.Column('signed_on', sa.Date(), nullable=False),
    sa.Column('terms', sa.String(length=16), nullable=False),
    sa.Column('deferral_days', sa.Integer(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.Column('updated_at', app.models.base.UTCDateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_contracts_organization_id_organizations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_contracts'))
    )
    with op.batch_alter_table('contracts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_contracts_organization_id'), ['organization_id'], unique=False)

    with op.batch_alter_table('carts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('organization_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(batch_op.f('fk_carts_organization_id_organizations'), 'organizations', ['organization_id'], ['id'], ondelete='SET NULL')

    with op.batch_alter_table('orders', schema=None) as batch_op:
        batch_op.add_column(sa.Column('organization_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('contract_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('buyer', sa.JSON(none_as_null=True), nullable=True))
        batch_op.create_index(batch_op.f('ix_orders_organization_id'), ['organization_id'], unique=False)
        batch_op.create_foreign_key(batch_op.f('fk_orders_contract_id_contracts'), 'contracts', ['contract_id'], ['id'], ondelete='SET NULL')
        batch_op.create_foreign_key(batch_op.f('fk_orders_organization_id_organizations'), 'organizations', ['organization_id'], ['id'], ondelete='SET NULL')



def downgrade() -> None:
    with op.batch_alter_table('orders', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_orders_organization_id_organizations'), type_='foreignkey')
        batch_op.drop_constraint(batch_op.f('fk_orders_contract_id_contracts'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_orders_organization_id'))
        batch_op.drop_column('buyer')
        batch_op.drop_column('contract_id')
        batch_op.drop_column('organization_id')

    with op.batch_alter_table('carts', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_carts_organization_id_organizations'), type_='foreignkey')
        batch_op.drop_column('organization_id')

    with op.batch_alter_table('contracts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_contracts_organization_id'))

    op.drop_table('contracts')
    with op.batch_alter_table('organizations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_organizations_user_id'))
        batch_op.drop_index(batch_op.f('ix_organizations_status'))
        batch_op.drop_index(batch_op.f('ix_organizations_inn'))

    op.drop_table('organizations')
