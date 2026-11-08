"""beam mount warp prep (drawing-in / tying-in operator and ends)

Revision ID: c3e7a9d1b5f2
Revises: 475b3914a8f9
Create Date: 2026-11-08 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c3e7a9d1b5f2'
down_revision: Union[str, None] = '475b3914a8f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('beam_mounts', sa.Column('prep_type', sa.String(length=16), nullable=True))
    op.add_column('beam_mounts', sa.Column('prep_ends', sa.Integer(), nullable=True))
    op.add_column('beam_mounts', sa.Column('prep_operator_user_id', sa.UUID(), nullable=True))
    op.add_column('beam_mounts', sa.Column('prep_operator', sa.String(length=128), nullable=True))
    op.create_foreign_key(
        op.f('fk_beam_mounts_prep_operator_user_id_users'), 'beam_mounts', 'users',
        ['prep_operator_user_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint(op.f('fk_beam_mounts_prep_operator_user_id_users'), 'beam_mounts', type_='foreignkey')
    op.drop_column('beam_mounts', 'prep_operator')
    op.drop_column('beam_mounts', 'prep_operator_user_id')
    op.drop_column('beam_mounts', 'prep_ends')
    op.drop_column('beam_mounts', 'prep_type')
