"""batch alt_uom

A hand-made lot can carry an alt count (12 Pcs) beside its kg, but unlike a carton
it has no packing order to read the unit off, so the lot stores its own.

Revision ID: b7d3e9a1c5f2
Revises: d4e8f2b6a1c3
Create Date: 2026-10-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b7d3e9a1c5f2"
down_revision: Union[str, None] = "d4e8f2b6a1c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("batches", sa.Column("alt_uom", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("batches", "alt_uom")
