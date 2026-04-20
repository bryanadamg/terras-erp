import uuid
from sqlalchemy import String, ForeignKey, Numeric, DateTime, Text, Table, Column
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
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    supplier = relationship("Partner")
    lines = relationship("PurchaseOrderLine", backref="order", cascade="all, delete-orphan")

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
    unit_price: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    
    due_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Relationships
    item = relationship("Item")
    attribute_values = relationship("AttributeValue", secondary=purchase_order_line_values)
