import uuid
from datetime import datetime, date
from typing import Optional, TYPE_CHECKING
from sqlalchemy import String, ForeignKey, Numeric, Integer, DateTime, Date, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.routing import WorkCenter
    from app.models.manufacturing import ManufacturingOrder
    from app.models.work_order import WorkOrder


class WeavingRun(Base):
    """A tracked production run of one WO/MO on one machine (work center).

    Performance monitoring: faithful to the client's loom-efficiency formula.
    target_100_per_day_kg = (24*60) * rate_per_line_g_min * lines / 1000
    efficiency = actual_kg / (target_100_per_day_kg * elapsed_working_days)
    elapsed_working_days counts only FULLY elapsed days — the current day of a running
    run, and the end_date of a closed one, are excluded (weaving_service).

    A loom may carry SEVERAL concurrent runs: the same item is commonly woven for
    two combos at once, each on its own WO with its own line count. So `lines` is a
    per-run number and `work_order_id` says which WO the run belongs to. It stays
    nullable — pre-WO runs and machines with no WO dispatched keep working, and the
    run then reports at MO grain as it always did.
    """
    __tablename__ = "weaving_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    work_center_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_centers.id", ondelete="CASCADE"), index=True
    )
    mo_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("manufacturing_orders.id", ondelete="CASCADE"), index=True
    )
    work_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    lines: Mapped[int] = mapped_column(Integer, default=1)
    rate_per_line_g_min: Mapped[float] = mapped_column(Numeric(10, 3), default=5)
    target_efficiency_pct: Mapped[float] = mapped_column(Numeric(6, 2), default=50)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # RUNNING / PAUSED / STOPPED / DONE. PAUSED is still an *active* run — the warp is
    # up and the order is open, it is only parked while another WO on the same loom is
    # prioritised, so it keeps its card and its efficiency (see WeavingRunPause).
    status: Mapped[str] = mapped_column(String(16), default="RUNNING", index=True)
    actual_qty_override: Mapped[Optional[float]] = mapped_column(Numeric(14, 4), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    work_center: Mapped["WorkCenter"] = relationship("WorkCenter", lazy="noload")
    mo: Mapped["ManufacturingOrder"] = relationship("ManufacturingOrder", lazy="noload")
    work_order: Mapped[Optional["WorkOrder"]] = relationship("WorkOrder", lazy="noload")
    pauses: Mapped[list["WeavingRunPause"]] = relationship(
        "WeavingRunPause", lazy="noload", cascade="all, delete-orphan",
        order_by="WeavingRunPause.paused_on",
    )


class WeavingRunPause(Base):
    """One stretch of calendar during which a run was parked, not woven.

    A loom carries several WOs at once and the floor reprioritises: push one order,
    park the others. Those parked days must not count against the parked run's
    efficiency, so each pause is stored as an interval and its working days are
    subtracted from elapsed (weaving_service.paused_working_days).

    Intervals rather than a running counter on the run: a run is parked and resumed
    many times over its life, a mis-clicked resume is undone by deleting the row, and
    the floor gets a real answer to "why did this WO slip" — which day, and why.
    `resumed_on` NULL means still parked.
    """
    __tablename__ = "weaving_run_pauses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("weaving_runs.id", ondelete="CASCADE"), index=True
    )
    paused_on: Mapped[date] = mapped_column(Date)
    resumed_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    paused_by: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    resumed_by: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class WorkCenterHoliday(Base):
    """A non-working calendar day for a specific machine (work center).

    Combined with WorkCenter.working_weekdays to count elapsed working days
    and project completion dates per the machine's production calendar.
    """
    __tablename__ = "work_center_holidays"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    work_center_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_centers.id", ondelete="CASCADE"), index=True
    )
    holiday_date: Mapped[date] = mapped_column(Date)
    note: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
