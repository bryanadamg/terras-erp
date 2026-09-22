from sqlalchemy import String, ForeignKey, Numeric, DateTime, Table, Column, Boolean, JSON, Index, Integer, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
import uuid
from datetime import datetime
from typing import Optional, List, TYPE_CHECKING
from sqlalchemy.sql import func

if TYPE_CHECKING:
    from app.models.production_run import ProductionRun
    from app.models.work_order import WorkOrder
    from app.models.routing import WorkCenter
    from app.models.item import Item

# Statuses that STOP an order accepting work — the set every gate actually asks
# about. DELIVERED is deliberately NOT one of them: it means "planned qty met, order
# still open" (SAP DLV vs TECO), so the floor keeps logging spare beams and extra
# bags until someone closes the order explicitly. See `status` on
# ManufacturingOrder below.
#
# Lives on the model, not in api/manufacturing, so api/production_runs can use it
# too — that module can only import api/manufacturing lazily inside a function.
# Work orders share the set: their lifecycle is the same minus DELIVERED.
CLOSED_ORDER_STATUSES = ("COMPLETED", "CANCELLED")

# Association table for ManufacturingOrder <-> AttributeValue
manufacturing_order_values = Table(
    "manufacturing_order_values",
    Base.metadata,
    Column("manufacturing_order_id", UUID(as_uuid=True), ForeignKey("manufacturing_orders.id"), primary_key=True),
    Column("attribute_value_id", UUID(as_uuid=True), ForeignKey("attribute_values.id"), primary_key=True),
)


class MODependency(Base):
    """Pegging record: an MO (dependent — root, or a shared component one level up)
    requires a shared component MO (required) one level deeper.
    qty = how much of the required MO's output this dependent MO contributes."""
    __tablename__ = "mo_dependencies"

    dependent_mo_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("manufacturing_orders.id", ondelete="CASCADE"), primary_key=True
    )
    required_mo_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("manufacturing_orders.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    qty: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)

    dependent_mo = relationship("ManufacturingOrder", foreign_keys=[dependent_mo_id], back_populates="required_dependencies")
    required_mo = relationship("ManufacturingOrder", foreign_keys=[required_mo_id], back_populates="dependent_dependencies")


class ManufacturingOrder(Base):
    __tablename__ = "manufacturing_orders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Composed (PR code + line index + size, or item name), never sequential — so it
    # matches work_orders.code's 128, which is derived from it as {mo.code}-WO-NN.
    code: Mapped[str] = mapped_column(String(128), unique=True, index=True)

    # Link to the Recipe (BOM)
    bom_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("boms.id"), index=True
    )

    # Produced Item
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), index=True
    )

    # Destination Warehouse — optional. FG lands at the WO output location; the MO
    # no longer needs a planning location (industry: receipt loc follows routing).
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True, index=True
    )

    # Raw Material Source
    source_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True
    )

    # Planned putaway bin — assigned by planning/store BEFORE production finishes
    # (the output "carries" its destination); completions book output here.
    # Operator does not choose — the WO output location is only the fallback.
    planned_putaway_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )

    # Traceability
    sales_order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sales_orders.id"), nullable=True, index=True
    )

    parent_mo_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("manufacturing_orders.id"), nullable=True, index=True
    )
    size_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sizes.id"), nullable=True
    )
    # Color-type FG shade (Color Library). Set on root MOs from the SO/PR; the
    # DYEING WO gate auto-matches the active DyeRecipe by this color_id.
    color_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("colors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Pending shade: root MO ordered against a lab dip variant_code still awaiting
    # approval. color_id stays null until the lab dip is approved (auto-backfill by
    # matching this code) or a user confirms an approved Color via MO edit. The
    # DYEING WO gate stays blocked while color_id is null — greige MOs are unaffected.
    labdip_variant_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    qty: Mapped[float] = mapped_column(Numeric(14, 4))
    # PENDING -> IN_PROGRESS -> DELIVERED -> COMPLETED (or CANCELLED).
    # DELIVERED = planned qty reached, order still OPEN: completions may still be
    # logged (within tolerance). COMPLETED = explicitly closed by a user; only
    # then does logging stop. Industry split (SAP DLV vs TECO, Oracle Complete vs
    # Closed) — an order must never auto-close itself on qty.
    status: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)

    # Overdelivery allowance, snapshotted from BOM.overdelivery_tolerance_percentage
    # at creation and overridable per order. Null = fall back to the BOM (legacy rows).
    overdelivery_tolerance_pct: Mapped[float | None] = mapped_column(
        Numeric(5, 2), nullable=True
    )
    # No output ceiling at all. Default for warp-beam MOs: a beam is planned in
    # pcs against loom demand and its kg varies by yarn, so a kg cap is meaningless.
    allow_unlimited_overdelivery: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )

    # True for consolidated component MOs shared across multiple root MOs in a PR
    is_shared_component: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    # Lifecycle Timestamps
    target_start_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    target_end_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actual_start_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actual_end_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    # Print tracking (set to now() each time SPK Produksi is printed from the ERP).
    card_printed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Production Run link
    production_run_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("production_runs.id"), nullable=True, index=True
    )
    bom_size_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bom_sizes.id", ondelete="SET NULL"), nullable=True
    )
    bom_size_snapshot: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Relationships
    bom = relationship("BOM", back_populates="manufacturing_orders")
    item = relationship("Item")
    # lazy=joined: to-one, always available for serialization in async routes
    planned_putaway_location = relationship(
        "Location", foreign_keys=[planned_putaway_location_id], lazy="joined"
    )
    planned_components: Mapped[List["MOPlannedComponent"]] = relationship(
        "MOPlannedComponent",
        back_populates="mo",
        cascade="all, delete-orphan",
        lazy="noload",
    )
    attribute_values = relationship("AttributeValue", secondary=manufacturing_order_values)
    color = relationship("Color", foreign_keys=[color_id], lazy="joined")
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
    # Dependency relationships (MRP pegging)
    required_dependencies: Mapped[List["MODependency"]] = relationship(
        "MODependency",
        foreign_keys="MODependency.dependent_mo_id",
        back_populates="dependent_mo",
        lazy="noload",
    )
    dependent_dependencies: Mapped[List["MODependency"]] = relationship(
        "MODependency",
        foreign_keys="MODependency.required_mo_id",
        back_populates="required_mo",
        lazy="noload",
    )

    @property
    def item_code(self) -> str | None:
        return self.item.code if self.item else None

    @property
    def item_name(self) -> str | None:
        return self.item.name if self.item else None

    @property
    def item_ends(self) -> int | None:
        return self.item.ends if self.item else None

    @property
    def planned_putaway_location_name(self) -> str | None:
        loc = self.planned_putaway_location
        if not loc:
            return None
        pn = loc.parent_name
        return f"{pn} / {loc.name}" if pn else (loc.name or loc.code)


class MOCompletion(Base):
    __tablename__ = "mo_completions"
    # Partial: reject reporting scans the few completions that recorded scrap.
    __table_args__ = (
        Index(
            "ix_mo_completions_rejected_qty",
            "qty_rejected",
            postgresql_where=text("qty_rejected > 0"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mo_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("manufacturing_orders.id"), index=True)
    work_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    qty_completed: Mapped[float] = mapped_column(Numeric(14, 4))
    # Optional output packaging tallies logged at completion (also posted to
    # stock_balances packaging counts at the output location; advisory, no UOM conversion)
    qty_cones: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    qty_boxes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    operator_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    work_center_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("work_centers.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    # Output lot produced by this completion (links reject → batch)
    output_batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("batches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Where output was actually booked (putaway bin — may differ from the WO's
    # output location when the operator overrode the suggestion); un-lotted
    # rejects must pull back from here, not the WO default
    output_location_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )
    # QC reject: flagged completions no longer count toward MO/WO progress
    rejected: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Qty scrapped out of this completion — the durable record of rejected output.
    # A partial reject subtracts from qty_completed (so progress sums stay correct)
    # and adds the same amount here, which is the only place it survives once the
    # rejected sub-lot is disposed. Whole-lot reject records the full logged qty.
    # Yield = qty_completed / (qty_completed + qty_rejected).
    qty_rejected: Mapped[float] = mapped_column(Numeric(14, 4), default=0, server_default="0")
    reject_reason: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    rejected_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    rejected_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    # Defect store the scrap was quarantined into (resolved through
    # services/reject_service at reject time). Null = the reject predates routing,
    # or the output was un-lotted and simply posted out of the good bin.
    reject_location_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )

    mo = relationship("ManufacturingOrder", back_populates="completions")
    work_order: Mapped[Optional["WorkOrder"]] = relationship("WorkOrder", back_populates="completions")
    work_center: Mapped[Optional["WorkCenter"]] = relationship("WorkCenter", lazy="joined")
    output_batch = relationship("Batch", foreign_keys=[output_batch_id], lazy="joined")
    reject_location = relationship("Location", foreign_keys=[reject_location_id], lazy="joined")
    actual_items: Mapped[List["MOCompletionItem"]] = relationship(
        "MOCompletionItem", back_populates="completion", cascade="all, delete-orphan", lazy="joined"
    )

    @property
    def work_center_name(self) -> str | None:
        return self.work_center.name if self.work_center else None

    @property
    def output_batch_number(self) -> str | None:
        return self.output_batch.batch_number if self.output_batch else None

    @property
    def output_batch_notes(self) -> str | None:
        """Operator note stamped on the produced lot.

        `notes` on this row also carries machine-appended bookkeeping ("[Greige
        GRG-…]"); the lot's own copy is the clean operator text, so labels and lot
        displays read the same string the Lot table and stock on-hand show.
        """
        return self.output_batch.notes if self.output_batch else None


class MOCompletionItem(Base):
    __tablename__ = "mo_completion_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    completion_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("mo_completions.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"))
    qty_used: Mapped[float] = mapped_column(Numeric(14, 4))

    completion: Mapped["MOCompletion"] = relationship("MOCompletion", back_populates="actual_items")
    item: Mapped["Item"] = relationship("Item", lazy="joined")

    @property
    def item_code(self) -> str | None:
        return self.item.code if self.item else None

    @property
    def item_name(self) -> str | None:
        return self.item.name if self.item else None


class MOPlannedComponent(Base):
    """Snapshot of BOM lines captured at MO creation. Isolates running MOs from BOM edits."""
    __tablename__ = "mo_planned_components"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mo_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("manufacturing_orders.id", ondelete="CASCADE"), index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)
    percentage: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    qty: Mapped[float] = mapped_column(Numeric(14, 4), default=0)
    source_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True, index=True
    )
    bom_line_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bom_lines.id", ondelete="SET NULL"), nullable=True
    )
    bom_operation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bom_operations.id", ondelete="SET NULL"), nullable=True
    )
    attribute_value_ids: Mapped[list] = mapped_column(JSON, default=list)

    mo = relationship("ManufacturingOrder", back_populates="planned_components")
    item = relationship("Item")
