"""canonical audit_logs action for status changes

Status moves were logged under five verbs — STATUS_CHANGE, UPDATE_STATUS,
UPDATE_ITEM_STATUS, UPDATE_COLOR_STATUS, UPDATE_DIP_STATUS — where entity_type
already says which thing moved. One verb now; plus the lone lowercase "create"
from manual stock entries.

Hand-written: data backfill, not schema. No downgrade: the five old verbs are
indistinguishable once merged.

Revision ID: 9a848367f6e3
Revises: 02f64e89ef0c
Create Date: 2026-10-05
"""
from typing import Sequence, Union

from alembic import op

revision: str = '9a848367f6e3'
down_revision: Union[str, None] = '02f64e89ef0c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE audit_logs SET action = 'STATUS_CHANGE' WHERE action IN "
        "('UPDATE_STATUS', 'UPDATE_ITEM_STATUS', 'UPDATE_COLOR_STATUS', 'UPDATE_DIP_STATUS')"
    )
    op.execute("UPDATE audit_logs SET action = 'CREATE' WHERE action = 'create'")


def downgrade() -> None:
    pass
