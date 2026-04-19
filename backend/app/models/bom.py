from sqlalchemy import String, ForeignKey, Numeric, Boolean, Table, Column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
import uuid

# Association tables
bom_values = Table(
    "bom_values",
    Base.metadata,
    Column("bom_id", UUID(as_uuid=True), ForeignKey("boms.id"), primary_key=True),
    Column("attribute_value_id", UUID(as_uuid=True), ForeignKey("attribute_values.id"), primary_key=True),
)

bom_line_values = Table(
    "bom_line_values",
    Base.metadata,
    Column("bom_line_id", UUID(as_uuid=True), ForeignKey("bom_lines.id"), primary_key=True),
    Column("attribute_value_id", UUID(as_uuid=True), ForeignKey("attribute_values.id"), primary_key=True),
)

class BOM(Base):
    __tablename__ = "boms"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    code: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    
    # Produced Item
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), index=True
    )
    qty: Mapped[float] = mapped_column(Numeric(14, 4), default=1.0)
    tolerance_percentage: Mapped[float] = mapped_column(Numeric(5, 2), default=0.0) # e.g. 10.0 for 10%
    
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    item = relationship("Item")
    attribute_values = relationship("AttributeValue", secondary=bom_values)
    lines = relationship("BOMLine", back_populates="bom", cascade="all, delete-orphan")
    operations = relationship("BOMOperation", back_populates="bom", cascade="all, delete-orphan")
    work_orders = relationship("WorkOrder", back_populates="bom")

    @property
    def item_code(self) -> str | None:
        return self.item.code if self.item else None

    @property
    def item_name(self) -> str | None:
        return self.item.name if self.item else None


class BOMLine(Base):
    __tablename__ = "bom_lines"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    bom_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("boms.id"), index=True
    )
    
    # Material Item
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), index=True
    )
    
    # Specific Source Location for this material (overrides WO default)
    source_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True
    )

    qty: Mapped[float] = mapped_column(Numeric(14, 4))
    is_percentage: Mapped[bool] = mapped_column(Boolean, default=False)
    percentage: Mapped[float] = mapped_column(Numeric(6, 2), default=0.0)

    # Relationships
    bom = relationship("BOM", back_populates="lines")
    item = relationship("Item")
    attribute_values = relationship("AttributeValue", secondary=bom_line_values)

    @property
    def item_code(self) -> str | None:
        return self.item.code if self.item else None

    @property
    def item_name(self) -> str | None:
        return self.item.name if self.item else None


class BOMOperation(Base):
    __tablename__ = "bom_operations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    bom_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("boms.id"), index=True
    )
    
    # Relationships
    bom = relationship("BOM", back_populates="operations")
    
    operation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("operations.id")
    )
    work_center_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_centers.id"), nullable=True
    )
    
    sequence: Mapped[int] = mapped_column(Numeric(4, 0), default=10) # e.g. 10, 20, 30
    time_minutes: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0) # Estimated time
