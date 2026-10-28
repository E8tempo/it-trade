"""photo order from the supplier

Revision ID: 2d14d2e54f1e
Revises: 5c3e8f1a9d27
Create Date: 2026-10-28 15:00:00.000000

Photos now keep the supplier order and the first one is the main photo (it used to be the one marked
`is_main`, often the last). The stored order can't be recomputed without the supplier, so the image lists
are read again: the worker refreshes them by itself, in-stock products first.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '2d14d2e54f1e'
down_revision: str | None = '5c3e8f1a9d27'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    products = sa.table('products', sa.column('images_synced_at', sa.DateTime(timezone=True)))
    op.execute(products.update().values(images_synced_at=None))


def downgrade() -> None:
    pass  # nothing to undo: the old code reorders the lists when it reads them again
