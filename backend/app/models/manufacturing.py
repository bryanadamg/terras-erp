from sqlalchemy import String, ForeignKey, Numeric, DateTime, Table, Column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
import uuid
from datetime import datetime
from typing import Optional, List, TYPE_CHECKING
from sqlalchemy.sql import func

if TYPE_CHECKING:
    from app.models.production_run import ProductionRun
    from app.models.work_order import WorkOrder

# Association table for ManufacturingOrder <-> AttributeValue
manufacturing_order_values = Table(
    "manufacturing_order_values",
    Base.metadata,
    Column("manufacturing_order_id", UUID(as_uuid=True), ForeignKey("manufacturing_orders.id"), primary_key=True),
    Column("attribute_value_id", UUID(as_uuid=True), ForeignKey("attribute_values.id"), primary_key=True),
)

class ManufacturingOrder(Base):
    __tablename__ = "manufacturing_orders"

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

    parent_mo_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("manufacturing_orders.id"), nullable=True, index=True
    )
    size_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sizes.id"), nullable=True
    )

    qty: Mapped[float] = mapped_column(Numeric(14, 4))
    status: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)

    # Lifecycle Timestamps
    target_start_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    target_end_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actual_start_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actual_end_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    # Production Run link
    production_run_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("production_runs.id"), nullable=True, index=True
    )
    bom_size_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bom_sizes.id"), nullable=True
    )

    # Relationships
    bom = relationship("BOM", back_populates="manufacturing_orders")
    item = relationship("Item")
    attribute_values = relationship("AttributeValue", secondary=manufacturing_order_values)
    parent_mo = relationship("ManufacturingOrder", remote_side=[id], backref="child_mos")
    sales_order = relationship("SalesOrder", foreign_keys=[sales_order_id], lazy="noload")
    production_run: Mapped[Optional["ProductionRun"]] = relationship(
        "ProductionRun",
        back_populates="manufacturing_orders",
        foreign_keys=[production_run_id],
    )
    work_orders: Mapped[List["WorkOrder"]] = relationship(
        "WorkOrder",
        back_populates="manufacturing_order",
        order_by="WorkOrder.sequence",
        cascade="all, delete-orphan",
    )
    batch_consumptions = relationship(
        "BatchConsumption",
        primaryjoin="ManufacturingOrder.id == foreign(BatchConsumption.manufacturing_order_id)",
        lazy="noload",
    )

    completions: Mapped[List["MOCompletion"]] = relationship(
        "MOCompletion",
        back_populates="mo",
        order_by="MOCompletion.created_at",
        cascade="all, delete-orphan",
        lazy="noload",
    )

    @property
    def item_code(self) -> str | None:
        return self.item.code if self.item else None

    @property
    def item_name(self) -> str | None:
        return self.item.name if self.item else None


class MOCompletion(Base):
    __tablename__ = "mo_completions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mo_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("manufacturing_orders.id"), index=True)
    qty_completed: Mapped[float] = mapped_column(Numeric(14, 4))
    operator_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    mo = relationship("ManufacturingOrder", back_populates="completions")
