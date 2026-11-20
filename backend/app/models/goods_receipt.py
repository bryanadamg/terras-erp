import uuid
from sqlalchemy import String, ForeignKey, Numeric, DateTime, Text, Integer, Date
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from datetime import datetime, date


class GoodsReceipt(Base):
    __tablename__ = "goods_receipts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    po_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("purchase_orders.id"), index=True)
    # Receiving warehouse for THIS receipt — chosen at receipt time, defaults to the PO's target location
    location_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True)
    receipt_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Supplier delivery note (Surat Jalan) — supplier's shipment document.
    delivery_note_number: Mapped[str | None] = mapped_column(String(64), nullable=True)  # free-text, supplier's own number
    delivery_note_date: Mapped[date | None] = mapped_column(Date, nullable=True)  # date printed on the DN (ship date)
    delivery_note_url: Mapped[str | None] = mapped_column(String(255), nullable=True)  # scanned DN attachment (PDF)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    lines = relationship("GoodsReceiptLine", backref="receipt", cascade="all, delete-orphan")
    created_by = relationship("User")


class GoodsReceiptLine(Base):
    __tablename__ = "goods_receipt_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    receipt_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("goods_receipts.id"), index=True)
    po_line_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("purchase_order_lines.id"), index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)
    qty_received: Mapped[float] = mapped_column(Numeric(14, 4))
    qty_boxes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    qty_cones: Mapped[int | None] = mapped_column(Integer, nullable=True)  # raw material packaging
    qty_drums: Mapped[int | None] = mapped_column(Integer, nullable=True)  # chemical/dye packaging
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("batches.id"), nullable=True)
    # Where THIS line was put away — set when the line went to a different
    # warehouse than the receipt's; null = the receipt's location_id.
    location_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True)

    item = relationship("Item")
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
    def vendor_lot(self):
        return self.batch.vendor_lot if self.batch else None

    @property
    def internal_lot(self):
        return self.batch.batch_number if self.batch else None
