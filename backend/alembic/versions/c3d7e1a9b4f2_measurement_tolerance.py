"""company_profile.measurement_tolerance_pct — weighing tolerance for scale-vs-book gaps

Revision ID: c3d7e1a9b4f2
Revises: ebbd972bd84b
Create Date: 2026-10-12
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c3d7e1a9b4f2'
down_revision: Union[str, None] = 'ebbd972bd84b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'company_profile',
        sa.Column('measurement_tolerance_pct', sa.Float(), server_default='2', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('company_profile', 'measurement_tolerance_pct')
