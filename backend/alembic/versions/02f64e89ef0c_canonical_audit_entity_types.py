"""canonical PascalCase audit_logs entity_type

Second pass of d5b7f9a1c3e6: the sync routers (attributes, locations, routing,
partners, uoms) and a handful of async ones wrote snake_case or SCREAMING_CASE
entity types while everything else wrote the model name. `StockEntry` and
`stock_entry` even both existed, so a per-entity history or an entity filter saw
half the rows. Call sites now write the model name; this rewrites existing rows.

Hand-written: data backfill, not schema.

Revision ID: 02f64e89ef0c
Revises: e1c3a5b7d9f0
Create Date: 2026-10-05
"""
from typing import Sequence, Union

from alembic import op

revision: str = '02f64e89ef0c'
down_revision: Union[str, None] = 'e1c3a5b7d9f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# old spelling -> canonical spelling
RENAMES = (
    ("BEAM_MOUNT", "BeamMount"),
    ("PRODUCTION_RUN", "ProductionRun"),
    ("attribute", "Attribute"),
    ("attribute_value", "AttributeValue"),
    ("location", "Location"),
    ("operation", "Operation"),
    ("partner", "Partner"),
    ("purchase_order", "PurchaseOrder"),
    ("sales_order", "SalesOrder"),
    ("stock_entry", "StockEntry"),
    ("uom", "UOM"),
    ("uom_factor", "UOMFactor"),
    ("weaving_run", "WeavingRun"),
    ("work_center", "WorkCenter"),
    ("work_center_calendar", "WorkCenterCalendar"),
    ("work_center_holiday", "WorkCenterHoliday"),
    ("work_center_loom_prep", "WorkCenterLoomPrep"),
)


def upgrade() -> None:
    for old, new in RENAMES:
        op.execute(f"UPDATE audit_logs SET entity_type = '{new}' WHERE entity_type = '{old}'")


def downgrade() -> None:
    # Not exact (SalesOrder/StockEntry rows that were always canonical move too);
    # recorded as a reversal path, not something to run.
    for old, new in RENAMES:
        op.execute(f"UPDATE audit_logs SET entity_type = '{old}' WHERE entity_type = '{new}'")
