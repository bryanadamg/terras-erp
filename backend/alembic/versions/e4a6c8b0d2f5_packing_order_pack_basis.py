"""packing order pack basis (counted vs weighed)

Revision ID: e4a6c8b0d2f5
Revises: d8f0b2a4c6e9
Create Date: 2026-09-10

Cut-to-weight goods are never measured out yard by yard: the packer weighs the
box and the piece count is that weight run through the order's sampled g/y. This
records which of the two a given order is packed on. Existing rows are COUNTED,
which is exactly what they were doing.
"""
from alembic import op
import sqlalchemy as sa

revision = 'e4a6c8b0d2f5'
down_revision = 'd8f0b2a4c6e9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'packing_orders',
        sa.Column('pack_basis', sa.String(length=16), nullable=False, server_default='COUNTED'),
    )


def downgrade() -> None:
    op.drop_column('packing_orders', 'pack_basis')
