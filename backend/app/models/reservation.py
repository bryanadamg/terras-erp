import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String, Text, ForeignKey, DateTime, Numeric, JSON, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class StockReservation(Base):
    """A qty of on-hand finished goods promised to one sales order.

    Written by `POST /sales-orders/{id}/allocate` (planner reserves on-hand
    stock straight to an SO line — no run, no MO), or by `POST /production-runs`
    when root-FG netting covers part of an entry from stock: the covered qty produces no MO, so without this row nothing
    anywhere records that the pile is spoken for and the NEXT order nets the same
    stock away again (`Availability._demand` is built only from open MOs'
    planned components, so a netted-away root leaves no trace).

    Grain is deliberately (item, variant_key) qty — NOT a pinned batch. Netting is
    plant-level and location-agnostic (see netting_service), the lot that actually
    ships is chosen far later at PackingCompletion, and `Batch.packed_for_so_id`
    is already a soft tag by design; a hard lot pin here would contradict all
    three. `variant_key` is `stock_service._generate_variant_key(attrs, color_id)`
    so it joins StockBalance rows directly.

    Lifecycle has no timer and no sweeper: a row counts against free stock only
    while `status == 'ACTIVE'` AND its sales order is still open, so SENT /
    DELIVERED / CANCELLED orders drop out on their own even if the release write
    below never ran. `qty_released` is drawn down at goods issue (the only point
    the physical stock actually leaves, since packing merely converts bulk into
    cartons of the same item), which stops a partially shipped order from holding
    the whole reservation.

    Deleted with its Production Run (FK CASCADE) — un-planning the run un-promises
    the stock.
    """

    __tablename__ = "stock_reservations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    sales_order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sales_orders.id", ondelete="CASCADE"), index=True
    )
    production_run_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("production_runs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    pr_bom_entry_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pr_bom_entries.id", ondelete="CASCADE"), nullable=True
    )
    # Set only by SO-level "Allocate from stock" (production_run_id is then NULL).
    # SET NULL, not CASCADE: an SO edit rebuilds every line, and update_sales_order
    # re-points these onto the equivalent new line the same way it does packing.
    sales_order_line_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sales_order_lines.id", ondelete="SET NULL"), nullable=True, index=True
    )

    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)
    # The netting key. Matches StockBalance.variant_key exactly.
    variant_key: Mapped[str] = mapped_column(String(512), default="", server_default="")
    # Display only — variant_key is the identity.
    attribute_value_ids: Mapped[list] = mapped_column(JSON, default=list, server_default='[]')
    color_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("colors.id", ondelete="SET NULL"), nullable=True
    )
    # Which size line of the entry this covered, for display on the SO.
    bom_size_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bom_sizes.id", ondelete="SET NULL"), nullable=True
    )

    qty: Mapped[float] = mapped_column(Numeric(14, 4))
    qty_released: Mapped[float] = mapped_column(Numeric(14, 4), default=0, server_default='0')

    # ACTIVE | RELEASED | CANCELLED
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", server_default="ACTIVE", index=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    created_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    released_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    item = relationship("Item", foreign_keys=[item_id], lazy="joined")
    sales_order = relationship("SalesOrder", foreign_keys=[sales_order_id], lazy="noload")
    production_run = relationship("ProductionRun", foreign_keys=[production_run_id], lazy="noload")

    @property
    def qty_remaining(self) -> float:
        return max(0.0, float(self.qty or 0) - float(self.qty_released or 0))


# The netting ledger's hot path: every Availability build scans ACTIVE rows and
# groups them by (item_id, variant_key).
Index("ix_stock_reservations_item_variant", StockReservation.item_id, StockReservation.variant_key)
