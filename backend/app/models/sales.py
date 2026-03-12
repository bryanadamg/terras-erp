import uuid
from sqlalchemy import String, ForeignKey, Numeric, DateTime, Text, Table, Column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from datetime import datetime

# Association table for SalesOrderLine <-> AttributeValue
sales_order_line_values = Table(
    "sales_order_line_values",
    Base.metadata,
    Column("sales_order_line_id", UUID(as_uuid=True), ForeignKey("sales_order_lines.id"), primary_key=True),
    Column("attribute_value_id", UUID(as_uuid=True), ForeignKey("attribute_values.id"), primary_key=True),
)

class SalesOrder(Base):
    __tablename__ = "sales_orders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    po_number: Mapped[str] = mapped_column(String(64), unique=True, index=True) # The Customer's PO Number
    customer_name: Mapped[str] = mapped_column(String(255))
    order_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String(32), default="PENDING") # PENDING, READY, SENT, DELIVERED, CANCELLED
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    lines = relationship("SalesOrderLine", backref="order", cascade="all, delete-orphan")

class SalesOrderLine(Base):
    __tablename__ = "sales_order_lines"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    sales_order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sales_orders.id"), index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id")
    )
    qty: Mapped[float] = mapped_column(Numeric(14, 4))
    due_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Relationships
    item = relationship("Item")
    attribute_values = relationship("AttributeValue", secondary=sales_order_line_values)
