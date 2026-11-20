import uuid
from sqlalchemy import String, ForeignKey, Numeric, DateTime, Text, Table, Column, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from datetime import datetime

# Association table for PurchaseOrderLine <-> AttributeValue
purchase_order_line_values = Table(
    "purchase_order_line_values",
    Base.metadata,
    Column("purchase_order_line_id", UUID(as_uuid=True), ForeignKey("purchase_order_lines.id"), primary_key=True),
    Column("attribute_value_id", UUID(as_uuid=True), ForeignKey("attribute_values.id"), primary_key=True),
)

class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    po_number: Mapped[str] = mapped_column(String(64), unique=True, index=True) # Our internal PO number
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("partners.id"), nullable=True, index=True
    )
    target_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True
    )
    order_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String(32), default="DRAFT") # DRAFT, SENT, RECEIVED, CANCELLED
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # PO document fields — captured at creation, rendered on the printed PO
    ssn: Mapped[str | None] = mapped_column(String(128), nullable=True)
    rate_mode: Mapped[str | None] = mapped_column(String(16), nullable=True, default="kurs_pajak")  # kurs_pajak | ktbi
    kurs_pajak: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ktbi: Mapped[str | None] = mapped_column(String(64), nullable=True)
    code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payment_term: Mapped[str | None] = mapped_column(String(128), nullable=True)
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vat_percent: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True, default=11)
    discount: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True, default=0)
    # True = line unit prices were entered VAT-inclusive (gross). The pre-VAT price
    # and the VAT are backed out of the gross on print, so the total stays exactly
    # qty × the price the supplier quoted — no rounding drift.
    prices_include_vat: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    supplier = relationship("Partner")
    lines = relationship("PurchaseOrderLine", backref="order", cascade="all, delete-orphan")
    receipts = relationship("GoodsReceipt", backref="po", cascade="all, delete-orphan", foreign_keys="GoodsReceipt.po_id")

class PurchaseOrderLine(Base):
    __tablename__ = "purchase_order_lines"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    purchase_order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("purchase_orders.id"), index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), index=True
    )
    qty: Mapped[float] = mapped_column(Numeric(14, 4))
    qty_received: Mapped[float] = mapped_column(Numeric(14, 4), default=0, server_default="0")
    unit_price: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)

    due_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Relationships
    item = relationship("Item")
    attribute_values = relationship("AttributeValue", secondary=purchase_order_line_values)

    # Embedded item info — avoids frontend UUID fallback when items list is paginated
    @property
    def item_name(self):
        return self.item.name if self.item else None

    @property
    def item_code(self):
        return self.item.code if self.item else None

    @property
    def item_uom(self):
        return self.item.uom if self.item else None
