"""Backfill blank measurements in MO/lot size snapshots from their live BOM size

Ranges entered on a BOM size after its MOs were cut never reached those MOs' lots,
so their size chips read "L-72" instead of "L-72 (70-74)". Fills only blank keys —
a value already in a snapshot is left as it is. Mirrors
stock_service.fill_size_snapshot_gaps, minus the per-BOM filter.

Revision ID: d4e8f2b6a1c3
Revises: 9608ac7c7e1d
Create Date: 2026-10-13
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'd4e8f2b6a1c3'
down_revision: Union[str, None] = '9608ac7c7e1d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL = """
UPDATE {table} t SET bom_size_snapshot = (t.bom_size_snapshot::jsonb || jsonb_strip_nulls(jsonb_build_object(
    'target_measurement', CASE WHEN t.bom_size_snapshot->>'target_measurement' IS NULL THEN bs.target_measurement::float8 END,
    'measurement_min', CASE WHEN t.bom_size_snapshot->>'measurement_min' IS NULL THEN bs.measurement_min::float8 END,
    'measurement_max', CASE WHEN t.bom_size_snapshot->>'measurement_max' IS NULL THEN bs.measurement_max::float8 END
)))::{cast}
FROM bom_sizes bs
WHERE bs.id = t.bom_size_id AND t.bom_size_snapshot IS NOT NULL
  AND ((t.bom_size_snapshot->>'target_measurement' IS NULL AND bs.target_measurement IS NOT NULL)
    OR (t.bom_size_snapshot->>'measurement_min' IS NULL AND bs.measurement_min IS NOT NULL)
    OR (t.bom_size_snapshot->>'measurement_max' IS NULL AND bs.measurement_max IS NOT NULL))
"""


def upgrade() -> None:
    for table, cast in (("manufacturing_orders", "jsonb"), ("batches", "json")):
        op.execute(SQL.format(table=table, cast=cast))


def downgrade() -> None:
    # Data-only backfill of blank keys; nothing to undo.
    pass
