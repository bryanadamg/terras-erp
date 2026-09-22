import uuid
from datetime import datetime
from typing import Optional, List, TYPE_CHECKING
from sqlalchemy import String, Text, ForeignKey, DateTime, Numeric, JSON, Boolean
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.bom import BOM, BOMSize
    from app.models.manufacturing import ManufacturingOrder


class PRBomEntrySize(Base):
    __tablename__ = "pr_bom_entry_sizes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pr_bom_entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pr_bom_entries.id", ondelete="CASCADE"), index=True
    )
    bom_size_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("bom_sizes.id"))
    qty: Mapped[float] = mapped_column(Numeric(14, 4))

    pr_bom_entry: Mapped["PRBomEntry"] = relationship("PRBomEntry", back_populates="sizes")
    bom_size = relationship("BOMSize", foreign_keys=[bom_size_id])


class PRBomEntry(Base):
    __tablename__ = "pr_bom_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pr_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("production_runs.id", ondelete="CASCADE"), index=True
    )
    bom_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("boms.id"))
    total_qty: Mapped[Optional[float]] = mapped_column(Numeric(14, 4), nullable=True)
    attribute_value_ids: Mapped[list] = mapped_column(JSONB, default=list, server_default='[]')
    force_create: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    # Color-type FG shade (Color Library) carried from the SO line into the root MO.
    color_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("colors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Pending shade carried from the SO line: lab dip variant_code awaiting approval.
    # Root MO inherits this; approval backfills the minted color_id by matching it.
    labdip_variant_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    bom = relationship("BOM", foreign_keys=[bom_id])
    sizes: Mapped[List["PRBomEntrySize"]] = relationship(
        "PRBomEntrySize", back_populates="pr_bom_entry", cascade="all, delete-orphan"
    )


class ProductionRun(Base):
    __tablename__ = "production_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    bom_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("boms.id"), nullable=True)
    # Indexed: the sales-order list joins on this for every row's PR chips, and the
    # duplicate-PR guard (GET /sales-orders/{id}/pr-coverage) filters on it per click.
    sales_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("sales_orders.id"), nullable=True, index=True)
    location_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True)
    source_location_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    target_start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    target_end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    actual_start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    actual_end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    bom: Mapped[Optional["BOM"]] = relationship("BOM", foreign_keys=[bom_id])
    sales_order = relationship("SalesOrder", foreign_keys=[sales_order_id], lazy="noload")
    bom_entries: Mapped[List["PRBomEntry"]] = relationship(
        "PRBomEntry", cascade="all, delete-orphan",
        primaryjoin="PRBomEntry.pr_id == ProductionRun.id",
        foreign_keys="PRBomEntry.pr_id",
    )
    manufacturing_orders: Mapped[List["ManufacturingOrder"]] = relationship(
        "ManufacturingOrder",
        back_populates="production_run",
        foreign_keys="ManufacturingOrder.production_run_id",
    )
