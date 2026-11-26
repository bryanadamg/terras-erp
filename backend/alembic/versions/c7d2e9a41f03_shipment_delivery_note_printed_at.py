"""shipment delivery_note_printed_at

Revision ID: c7d2e9a41f03
Revises: b1619e460b75
Create Date: 2026-11-26 10:30:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'c7d2e9a41f03'
down_revision: Union[str, None] = 'b1619e460b75'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('shipments', sa.Column('delivery_note_printed_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('shipments', 'delivery_note_printed_at')
