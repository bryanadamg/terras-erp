"""stock_reservations.sales_order_line_id

An SO-level "Allocate from stock" reservation is made against one order line,
not a Production Run entry, so it needs the line to count toward that line's
fulfilment and to be subtracted when the order is later handed to a PR.

Revision ID: e5a9c1d3f7b2
Revises: b7d3e9a1c5f2
Create Date: 2026-10-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "e5a9c1d3f7b2"
down_revision: Union[str, None] = "b7d3e9a1c5f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("stock_reservations", sa.Column(
        "sales_order_line_id", postgresql.UUID(as_uuid=True),
        sa.ForeignKey("sales_order_lines.id", ondelete="SET NULL"), nullable=True,
    ))
    op.create_index("ix_stock_reservations_sales_order_line_id", "stock_reservations", ["sales_order_line_id"])


def downgrade() -> None:
    op.drop_index("ix_stock_reservations_sales_order_line_id", table_name="stock_reservations")
    op.drop_column("stock_reservations", "sales_order_line_id")
