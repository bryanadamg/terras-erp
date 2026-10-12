import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, Boolean, DateTime, ForeignKey, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

class CompanyProfile(Base):
    __tablename__ = "company_profile"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), default="My Company")
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(512), nullable=True) # Relative path to static logo
    tax_id: Mapped[str | None] = mapped_column(String(100), nullable=True) # For invoices/POs
    # How far a scale reading may disagree with the book qty and still count as the
    # same material (% of the lot / order qty). Inside it, packing posts the gap as a
    # MEASURE_VAR ledger row and a WO short by it still auto-completes.
    measurement_tolerance_pct: Mapped[float] = mapped_column(Float, default=2.0, server_default="2", nullable=False)


class BackupSchedule(Base):
    """Singleton row (like CompanyProfile) configuring the recurring automated
    database snapshot job. Read/written by services/backup_schedule_service.py
    and driven by the AsyncIOScheduler in core/scheduler.py."""
    __tablename__ = "backup_schedule"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    frequency: Mapped[str] = mapped_column(String(10), default="daily", nullable=False)  # "daily" | "weekly"
    day_of_week: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0=Mon..6=Sun, only for "weekly"
    hour: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    minute: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Jakarta", nullable=False)
    retain_count: Mapped[int] = mapped_column(Integer, default=14, nullable=False)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_run_status: Mapped[str | None] = mapped_column(String(10), nullable=True)  # "success" | "failed"
    last_run_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
