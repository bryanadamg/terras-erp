import uuid
from datetime import datetime
from typing import Optional, List, TYPE_CHECKING
from sqlalchemy import String, Text, ForeignKey, DateTime, Integer, Float, Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.manufacturing import ManufacturingOrder, MOCompletion
    from app.models.routing import WorkCenter
    from app.models.dyeing_setting import DyeRecipe
    from app.models.location import Location

class WorkOrder(Base):
    __tablename__ = "work_orders"
    __table_args__ = (
        Index("ix_work_orders_code", "code", unique=True, postgresql_where=text("code IS NOT NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    manufacturing_order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("manufacturing_orders.id", ondelete="CASCADE"), index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, default=1)
    # Unique among the WOs that have a code; older rows predate codes entirely.
    code: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    name: Mapped[str] = mapped_column(String(128))
    work_center_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_centers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Which routing step (BOM operation) this WO executes. Drives per-operation
    # material staging/consumption: a WO only handles materials allocated to its step.
    bom_operation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bom_operations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Line-side staging state: NOT_STAGED / PARTIAL / STAGED. Recomputed on each
    # stage action from the "Staging" ledger rows booked to this WO's input loc.
    staging_status: Mapped[str] = mapped_column(String(16), default="NOT_STAGED", server_default="NOT_STAGED")
    planned_recipe_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dye_recipes.id", ondelete="SET NULL"), nullable=True
    )
    input_location_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    output_location_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    qty: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ends: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # warp ends (utas) per beam; overrides item.ends at beam birth
    status: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)
    planned_duration_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    actual_duration_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    target_start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    target_end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    actual_start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    actual_end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Print tracking (set to now() each time the operator prints from the ERP).
    # Presence => "printed"; the labels timestamp is compared against the newest
    # bag completion time to detect bags logged since the last label print.
    card_printed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    labels_printed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    manufacturing_order: Mapped["ManufacturingOrder"] = relationship(
        "ManufacturingOrder", back_populates="work_orders"
    )
    work_center: Mapped[Optional["WorkCenter"]] = relationship(
        "WorkCenter", foreign_keys=[work_center_id]
    )
    planned_recipe: Mapped[Optional["DyeRecipe"]] = relationship(
        "DyeRecipe", foreign_keys=[planned_recipe_id]
    )
    input_location: Mapped[Optional["Location"]] = relationship(
        "Location", foreign_keys=[input_location_id], lazy="joined"
    )
    output_location: Mapped[Optional["Location"]] = relationship(
        "Location", foreign_keys=[output_location_id], lazy="joined"
    )
    next_destination_location_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    next_destination_work_center_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_centers.id", ondelete="SET NULL"), nullable=True
    )
    next_destination_location: Mapped[Optional["Location"]] = relationship(
        "Location", foreign_keys=[next_destination_location_id], lazy="joined"
    )
    next_destination_work_center: Mapped[Optional["WorkCenter"]] = relationship(
        "WorkCenter", foreign_keys=[next_destination_work_center_id], lazy="joined"
    )
    completions: Mapped[List["MOCompletion"]] = relationship(
        "MOCompletion", back_populates="work_order", lazy="select"
    )

    @property
    def work_center_name(self) -> Optional[str]:
        return self.work_center.name if self.work_center else None

    @property
    def work_center_type(self) -> Optional[str]:
        return self.work_center.center_type if self.work_center else None

    @property
    def next_destination_location_name(self) -> Optional[str]:
        return self.next_destination_location.name if self.next_destination_location else None

    @property
    def next_destination_work_center_name(self) -> Optional[str]:
        return self.next_destination_work_center.name if self.next_destination_work_center else None

    @property
    def qty_completed_total(self) -> float:
        return sum(float(c.qty_completed) for c in self.completions if not c.rejected)

    @property
    def qty_rejected_total(self) -> float:
        """Scrap logged against this routing step — includes partial rejects, whose
        qty was subtracted from qty_completed. Counts every completion (rejected or
        not) because a partially rejected log stays active."""
        return sum(float(c.qty_rejected or 0) for c in self.completions)
