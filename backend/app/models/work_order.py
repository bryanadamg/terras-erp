import uuid
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from sqlalchemy import String, Text, ForeignKey, DateTime, Integer, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.manufacturing import ManufacturingOrder
    from app.models.routing import WorkCenter

class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    manufacturing_order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("manufacturing_orders.id", ondelete="CASCADE"), index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, default=1)
    name: Mapped[str] = mapped_column(String(128))
    work_center_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_centers.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)
    planned_duration_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    actual_duration_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    target_start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    target_end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    actual_start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    actual_end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    manufacturing_order: Mapped["ManufacturingOrder"] = relationship(
        "ManufacturingOrder", back_populates="work_orders"
    )
    work_center: Mapped[Optional["WorkCenter"]] = relationship(
        "WorkCenter", foreign_keys=[work_center_id]
    )

    @property
    def work_center_name(self) -> Optional[str]:
        return self.work_center.name if self.work_center else None
