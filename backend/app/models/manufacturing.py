from sqlalchemy import String, ForeignKey, Numeric, DateTime, Table, Column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
import uuid
from datetime import datetime

# Association table for WorkOrder <-> AttributeValue
work_order_values = Table(
    "work_order_values",
    Base.metadata,
    Column("work_order_id", UUID(as_uuid=True), ForeignKey("work_orders.id"), primary_key=True),
    Column("attribute_value_id", UUID(as_uuid=True), ForeignKey("attribute_values.id"), primary_key=True),
)

class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    
    # Link to the Recipe (BOM)
    bom_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("boms.id"), index=True
    )
    
    # Produced Item
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), index=True
    )

    # Destination Warehouse
    location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id"), index=True
    )
    
    # Raw Material Source
    source_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True
    )
    
    # Traceability
    sales_order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sales_orders.id"), nullable=True
    )

    qty: Mapped[float] = mapped_column(Numeric(14, 4))
    status: Mapped[str] = mapped_column(String(32), default="PENDING")
    
    # Lifecycle Timestamps
    target_start_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    target_end_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actual_start_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actual_end_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    bom = relationship("BOM", back_populates="work_orders")
    item = relationship("Item")
    attribute_values = relationship("AttributeValue", secondary=work_order_values)

    @property
    def item_code(self) -> str | None:
        return self.item.code if self.item else None

    @property
    def item_name(self) -> str | None:
        return self.item.name if self.item else None
