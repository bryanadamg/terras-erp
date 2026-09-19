"""Lock a quarantine lot to the packing order that claimed it.

A lot handed to a packing order off the Quarantine Packing desk belongs to that
order alone: no other order may draw from it, and the order cannot be COMPLETED
until the lot is drained. Distinct from `batches.packing_order_id`, which marks
a batch as a packed CARTON (the output side of packing) — this is the input side.

Revision ID: d5f7b9c1e3a6
Revises: b4e6c8a0d2f9
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'd5f7b9c1e3a6'
down_revision = 'b4e6c8a0d2f9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('batches', sa.Column(
        'locked_packing_order_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index(
        'ix_batches_locked_packing_order_id', 'batches', ['locked_packing_order_id'])
    op.create_foreign_key(
        'fk_batches_locked_packing_order_id', 'batches', 'packing_orders',
        ['locked_packing_order_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_batches_locked_packing_order_id', 'batches', type_='foreignkey')
    op.drop_index('ix_batches_locked_packing_order_id', table_name='batches')
    op.drop_column('batches', 'locked_packing_order_id')
