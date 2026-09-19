"""dyeing run bath group

One physical bath can hold several work orders of the same shade on the same
vessel. Those are recorded as one DyeingRun per WO (each keeps its own kg, its own
clock and its own monitor card); `bath_group_id` is what says they were the same
water, so their dose sheets can be collapsed back to a single bath.

Revision ID: b4e6c8a0d2f9
Revises: f3b5d7a9c1e8
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'b4e6c8a0d2f9'
down_revision = 'f3b5d7a9c1e8'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('dyeing_runs', sa.Column('bath_group_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index('ix_dyeing_runs_bath_group_id', 'dyeing_runs', ['bath_group_id'])


def downgrade():
    op.drop_index('ix_dyeing_runs_bath_group_id', table_name='dyeing_runs')
    op.drop_column('dyeing_runs', 'bath_group_id')
