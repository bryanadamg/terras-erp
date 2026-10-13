"""stock_reservations.batch_id

"Allocate from stock" pins named packed cartons to an SO line instead of an
anonymous qty. The partial unique index is the guard against two orders (or
two clicks) pinning the same physical box.

Revision ID: a6c2e8f4d1b9
Revises: e5a9c1d3f7b2
Create Date: 2026-10-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a6c2e8f4d1b9"
down_revision: Union[str, None] = "e5a9c1d3f7b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("stock_reservations", sa.Column(
        "batch_id", postgresql.UUID(as_uuid=True),
        sa.ForeignKey("batches.id", ondelete="CASCADE"), nullable=True,
    ))
    op.create_index(
        "uq_stock_reservations_active_batch", "stock_reservations", ["batch_id"], unique=True,
        postgresql_where=sa.text("status = 'ACTIVE' AND batch_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_stock_reservations_active_batch", table_name="stock_reservations")
    op.drop_column("stock_reservations", "batch_id")
