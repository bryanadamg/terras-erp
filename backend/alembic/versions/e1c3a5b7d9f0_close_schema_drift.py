"""close the gap between the models and the database

`alembic check` failed with ~120 operations, which made `revision --autogenerate`
unusable: a real change arrived buried in fifty unrelated ops, and genuine drift
(a column the model had and the database did not) was invisible in the noise.

Most of that diff was the models under-describing the database, and it is fixed on
the model side in the same commit — the raw-SQL indexes (trigram GIN on `colors`,
the partial indexes, the partial uniques on `work_orders.code` and one open pause
per weaving run) are now declared in `__table_args__`, so autogenerate stops
proposing to DROP them. That was the dangerous part: applying that generated
migration unreviewed would have silently removed the colour search indexes and two
uniqueness guarantees.

What is left is real, and is what this migration applies:

1. FOUR MISSING INDEXES. The models declare them, the database never got them —
   audit-log filtering by entity and the sample request's two FKs.

2. TWO REDUNDANT INDEXES DROPPED. `dye_recipes.code` and `print_templates.doc_type`
   are already uniquely constrained, and a unique constraint carries its own index;
   the extra plain index was a second copy of it.

3. FOUR DEAD COLUMNS DROPPED. `stock_ledger.variant_id`, and the `attribute_value_id`
   on `stock_ledger`, `bom_lines` and `boms`. Leftovers from the variant refactor.
   Each `attribute_value_id` carried TWO foreign keys — one to `attribute_values` and
   a misnamed one to `variants` — so a non-null value had to exist in both tables at
   once. Unsurprisingly all four columns are 100% NULL; nothing can ever have used
   them. Their constraints and indexes go with the columns.

4. EIGHT FOREIGN KEYS RENAMED onto the project's naming convention (`fk_<table>_<col>_<ref>`),
   the last stragglers from before the convention existed. Done with RENAME CONSTRAINT
   rather than the drop-and-recreate autogenerate proposes: renaming is a catalogue
   update, recreating re-validates the whole table.

5. ELEVEN COLUMNS SET NOT NULL to match what the models already promise (and what the
   code already assumes) — `users.hashed_password` among them. Verified zero NULLs in
   every one before writing this.

Revision ID: e1c3a5b7d9f0
Revises: f6b8d0a2c4e7
"""
from alembic import op
import sqlalchemy as sa


revision = "e1c3a5b7d9f0"
down_revision = "f6b8d0a2c4e7"
branch_labels = None
depends_on = None


# (table, column) pairs the models declare NOT NULL and the database left nullable.
_NOT_NULL = [
    ("beam_mounts", "qty_mounted"),
    ("boms", "tolerance_percentage"),
    ("combos", "created_at"),
    ("lab_dip_rejections", "rejected_at"),
    ("packaging_types", "created_at"),
    ("shipments", "created_at"),
    ("stock_reservations", "attribute_value_ids"),
    ("stock_reservations", "created_at"),
    ("users", "hashed_password"),
    ("weaving_run_pauses", "created_at"),
    ("work_centers", "working_weekdays"),
]

# (table, old constraint name, convention name)
_FK_RENAMES = [
    ("bom_line_values", "bom_line_values_bom_line_id_fkey", "fk_bom_line_values_bom_line_id_bom_lines"),
    ("bom_line_values", "bom_line_values_attribute_value_id_fkey", "fk_bom_line_values_attribute_value_id_attribute_values"),
    ("bom_values", "bom_values_bom_id_fkey", "fk_bom_values_bom_id_boms"),
    ("bom_values", "bom_values_attribute_value_id_fkey", "fk_bom_values_attribute_value_id_attribute_values"),
    ("item_attributes", "item_attributes_item_id_fkey", "fk_item_attributes_item_id_items"),
    ("item_attributes", "item_attributes_attribute_id_fkey", "fk_item_attributes_attribute_id_attributes"),
    ("stock_ledger_values", "stock_ledger_values_stock_ledger_id_fkey", "fk_stock_ledger_values_stock_ledger_id_stock_ledger"),
    ("stock_ledger_values", "stock_ledger_values_attribute_value_id_fkey", "fk_stock_ledger_values_attribute_value_id_attribute_values"),
]

_DEAD_COLUMNS = [
    ("stock_ledger", "variant_id"),
    ("stock_ledger", "attribute_value_id"),
    ("bom_lines", "attribute_value_id"),
    ("boms", "attribute_value_id"),
]


def upgrade() -> None:
    op.create_index("ix_audit_logs_entity_id", "audit_logs", ["entity_id"], unique=False)
    op.create_index("ix_audit_logs_entity_type", "audit_logs", ["entity_type"], unique=False)
    op.create_index("ix_sample_requests_base_item_id", "sample_requests", ["base_item_id"], unique=False)
    op.create_index("ix_sample_requests_sales_order_id", "sample_requests", ["sales_order_id"], unique=False)

    op.drop_index("ix_dye_recipes_code", table_name="dye_recipes")
    op.drop_index("ix_print_templates_doc_type", table_name="print_templates")

    for table, column in _DEAD_COLUMNS:
        op.drop_column(table, column)

    for table, old, new in _FK_RENAMES:
        op.execute(f'ALTER TABLE {table} RENAME CONSTRAINT "{old}" TO "{new}"')

    for table, column in _NOT_NULL:
        op.alter_column(table, column, nullable=False)


def downgrade() -> None:
    for table, column in _NOT_NULL:
        op.alter_column(table, column, nullable=True)

    for table, old, new in _FK_RENAMES:
        op.execute(f'ALTER TABLE {table} RENAME CONSTRAINT "{new}" TO "{old}"')

    # The dead columns come back bare: they held no data (every row was NULL, since
    # each one answered to two mutually exclusive foreign keys), so the pair of
    # contradictory constraints is not worth restoring.
    op.add_column("boms", sa.Column("attribute_value_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("bom_lines", sa.Column("attribute_value_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("stock_ledger", sa.Column("attribute_value_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("stock_ledger", sa.Column("variant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_stock_ledger_variant_id", "stock_ledger", ["variant_id"], unique=False)

    op.create_index("ix_print_templates_doc_type", "print_templates", ["doc_type"], unique=False)
    op.create_index("ix_dye_recipes_code", "dye_recipes", ["code"], unique=False)

    op.drop_index("ix_sample_requests_sales_order_id", table_name="sample_requests")
    op.drop_index("ix_sample_requests_base_item_id", table_name="sample_requests")
    op.drop_index("ix_audit_logs_entity_type", table_name="audit_logs")
    op.drop_index("ix_audit_logs_entity_id", table_name="audit_logs")
