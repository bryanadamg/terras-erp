import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, ForeignKey, DateTime, Numeric, Boolean, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class PickList(Base):
    """Outbound pick / dispatch order. Bridges SO READY -> SENT.

    Renamed from the old `PackingOrder`: this was always the *delivery* document
    (SO-bound, QC gate, Surat Jalan, stock OUT), never the pack-into-cartons step.
    Packing now has its own WO-shaped entity (`PackingOrder` in models/packing.py)
    which produces PackedUnit cartons; a pick list draws those cartons back out.

    One SO may have several pick lists (partial shipments). Confirming dispatch
    posts finished-goods stock OUT and (when fully shipped) flips the SO to SENT.
    The printable document is a Surat Jalan (delivery note).
    """
    __tablename__ = "pick_lists"
    __table_args__ = (
        UniqueConstraint("code", name="uq_pick_lists_code"),
        Index("ix_pick_lists_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32))  # PL-00001 (legacy rows: PK-); unique via __table_args__
    sales_order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sales_orders.id", ondelete="CASCADE"), index=True
    )
    # Default ship-from warehouse; each line may override.
    source_location_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    # DRAFT, PICKING, PICKED, DISPATCHED, CANCELLED
    status: Mapped[str] = mapped_column(String(16), default="DRAFT", index=True)

    # The loading-deck handover this pick list was loaded onto. Null while the
    # pick list is still on the floor; set when a Shipment stages it. Dispatch is
    # driven from there, never from here — see models/shipment.py.
    shipment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("shipments.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # QC / inspection gate (must pass before dispatch)
    qc_passed: Mapped[bool] = mapped_column(Boolean, default=False)
    qc_inspector: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    qc_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # LEGACY Surat Jalan fields. The delivery note moved to `Shipment` — these are
    # kept read-only for rows dispatched before that split (and are mirrored onto a
    # backfilled Shipment), so nothing writes them any more. Read the note through
    # `shipment`, never from here.
    delivery_note_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    delivery_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    carrier: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    vehicle_plate: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    driver: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    dispatched_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    sales_order = relationship("SalesOrder")
    source_location = relationship("Location")
    created_by = relationship("User")
    shipment = relationship("Shipment", back_populates="pick_lists")
    lines = relationship("PickListLine", backref="pick_list", cascade="all, delete-orphan")


class PickListLine(Base):
    """One line to pick. Grain is (SO line, carton): the suggestion engine emits
    one row per PackedUnit it proposes, so `batch_id` identifies the physical
    carton and `qty_picked` is that carton's qty. Bulk (uncartonised) ship lines
    are still supported — `batch_id` null, free qty.
    """
    __tablename__ = "pick_list_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pick_list_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pick_lists.id", ondelete="CASCADE"), index=True
    )
    sales_order_line_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sales_order_lines.id", ondelete="CASCADE"), index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)
    qty_picked: Mapped[float] = mapped_column(Numeric(14, 4), default=0)
    # Per-line ship-from override (falls back to the pick list's source_location)
    source_location_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    # The picked carton (a PackedUnit Batch row) or, for bulk lines, a plain lot.
    batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("batches.id", ondelete="SET NULL"), nullable=True
    )
    # Scan confirmation: null until the picker scans this carton's QR.
    picked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    picked_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    item = relationship("Item")
    sales_order_line = relationship("SalesOrderLine")
    batch = relationship("Batch")

    @property
    def item_name(self):
        return self.item.name if self.item else None

    @property
    def item_code(self):
        return self.item.code if self.item else None

    @property
    def item_uom(self):
        return self.item.uom if self.item else None

    @property
    def batch_number(self):
        return self.batch.batch_number if self.batch else None

    @property
    def package_no(self):
        return self.batch.package_no if self.batch else None
