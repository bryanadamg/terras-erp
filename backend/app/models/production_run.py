import uuid
from datetime import datetime
from typing import Optional, List, TYPE_CHECKING
from sqlalchemy import String, Text, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.bom import BOM
    from app.models.manufacturing import ManufacturingOrder


class ProductionRun(Base):
    __tablename__ = "production_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    bom_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("boms.id"))
    sales_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("sales_orders.id"), nullable=True)
    location_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("locations.id"))
    source_location_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    target_start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    target_end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    actual_start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    actual_end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    bom: Mapped["BOM"] = relationship("BOM", foreign_keys=[bom_id])
    manufacturing_orders: Mapped[List["ManufacturingOrder"]] = relationship(
        "ManufacturingOrder",
        back_populates="production_run",
        foreign_keys="ManufacturingOrder.production_run_id",
    )
