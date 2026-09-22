import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, ForeignKey, DateTime, Numeric, Integer, JSON, Index, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Batch(Base):
    __tablename__ = "batches"
    __table_args__ = (Index("ix_batches_created_at", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_number: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    vendor_lot: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Beam fields: set when the batch represents a physical warp beam
    ends: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_wo_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_orders.id", ondelete="SET NULL"), nullable=True
    )
    # Leftover warp: the beam this lot was split off from when its parent came off
    # the loom with warp still on it. Set => this batch is a leftover beam, and its
    # parent is retired at 0 kg. Lineage is ALSO written as a BatchConsumption row
    # (input = parent, output = this) so the genealogy endpoint traces it like any
    # other lot; this column is the cheap "is a leftover / whose remnant" answer the
    # beam pickers need without walking consumptions.
    parent_batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("batches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Size identity of this produced lot, copied from the source MO at WO-completion
    # (e.g. a sized greige GRG- lot woven for size L). bom_size_id is the joinable
    # FK; bom_size_snapshot is the immutable label ({size_name, label, ...}) so a
    # later BOMSize edit/delete can't corrupt an already-produced physical lot.
    bom_size_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bom_sizes.id", ondelete="SET NULL"), nullable=True
    )
    bom_size_snapshot: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    # PackedUnit fields: set when the batch represents a physical packed carton.
    # `packing_order_id` is the discriminator, exactly as `source_wo_id`+`ends`
    # discriminate a warp beam. Carton qty is never stored here — it lives in the
    # StockBalance row keyed by this batch at the packed location.
    packing_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("packing_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    packing_completion_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("packing_completions.id", ondelete="SET NULL"), nullable=True
    )
    package_no: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    package_label: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)  # Carton / Roll / Bag
    weight_kg: Mapped[Optional[float]] = mapped_column(Numeric(14, 4), nullable=True)
    # Count of the packing order's alt selling unit in this carton (12 Pcs, 4 Pic).
    # Stored, not derived: for a kg-stocked item the carton's qty is the packer's
    # SCALE reading, so dividing it by the alt factor yields 11.8 Pcs on a box that
    # holds 12 — a printed count has to be the count that was packed. Null for
    # every batch that is not a carton, and for cartons packed with no alt unit.
    alt_qty: Mapped[Optional[float]] = mapped_column(Numeric(14, 4), nullable=True)
    # --- Packaging / brutto ---------------------------------------------------
    # Which physical box this carton is packed in, and what that box weighs.
    # `tare_kg` is SNAPSHOTTED off the master (or typed by the packer on a custom
    # box) rather than read through the FK at display time: editing Box L's tare
    # next month must not rewrite the labels and delivery notes already printed
    # for cartons packed this month. Same reasoning as MOPlannedComponent.
    #
    # `gross_weight_kg` is stored for the same reason its parts are — net is a
    # scale reading and tare is a snapshot, so brutto is a fact about one physical
    # box at one moment, not a formula to re-run. Null on every non-carton batch
    # and on cartons packed before this feature.
    packaging_type_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("packaging_types.id", ondelete="SET NULL"), nullable=True, index=True
    )
    tare_kg: Mapped[Optional[float]] = mapped_column(Numeric(14, 4), nullable=True)
    gross_weight_kg: Mapped[Optional[float]] = mapped_column(Numeric(14, 4), nullable=True)
    # Soft SO tag — records what the carton was packed for; does NOT reserve it.
    # Any pick list may still take this carton.
    #
    # NOT named sales_order_id: the batches endpoints already setattr a *derived*
    # `sales_order_id` onto Batch instances for origin lineage (_resolve_batch_origins).
    # Reusing that name would turn a harmless response decoration into a dirty
    # column write and silently persist lineage over this tag.
    packed_for_so_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # QC status: GOOD | REJECTED. Rejected lots stay physically in stock but are
    # excluded from netting/availability and from consumption/staging pickers.
    quality_status: Mapped[str] = mapped_column(String(16), default="GOOD", server_default="GOOD")

    # --- Quarantine disposition (separate axis from quality_status) ------------
    # quality_status is the binary scrap decision; this is the pre-packing QC
    # disposition of a lot sitting in a quarantine location — an open, client-
    # extensible list (OK / Bulk Sample / Waiting Approval / ...). It is a value
    # of the `Quarantine Status` system attribute, with `quarantine_status` kept
    # as the immutable display snapshot, exactly like sample category and dye
    # recipe wash-bath steps. Null = not yet dispositioned; packing treats that
    # as "not released" while the lot is in a quarantine location.
    quarantine_status_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("attribute_values.id", ondelete="SET NULL"), nullable=True, index=True
    )
    quarantine_status: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    quarantine_status_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    quarantine_status_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    quarantine_notes: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    # --- Packing lock ----------------------------------------------------------
    # The packing order this lot was handed to off the Quarantine Packing desk.
    # A held lot is a physical pile: the order that claimed it owns it outright,
    # so no other order may draw from it, and that order cannot be COMPLETED
    # until the pile is gone — even when the draw runs past `qty_target`, which
    # is only a snapshot of what was free when the deep link was followed.
    #
    # NOT `packing_order_id`, which is the carton discriminator on the OUTPUT
    # side of packing (non-null means "this batch IS a carton"). This is the
    # INPUT side: the bulk lot being consumed. A lot has at most one owner, so
    # the lock is a column here rather than a join table — two owners cannot be
    # written in the first place.
    #
    # The lock is only in force while its order is open: `locked_by_other()` in
    # services/packing_service.py joins on status, so a COMPLETED or CANCELLED
    # order releases every lot it held without any unwind step.
    locked_packing_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("packing_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )

    item = relationship("Item")
    # Eager by default: the master is a handful of rows and every carton list,
    # label and delivery note wants its name — a lazy load would MissingGreenlet
    # in the async routes that serve them.
    packaging_type = relationship("PackagingType", foreign_keys=[packaging_type_id], lazy="joined")
    consumptions_as_input = relationship("BatchConsumption", foreign_keys="BatchConsumption.input_batch_id", back_populates="input_batch")
    consumptions_as_output = relationship("BatchConsumption", foreign_keys="BatchConsumption.output_batch_id", back_populates="output_batch")


class BeamMount(Base):
    """A warp beam physically mounted (gaited) on a loom.

    A beam is a MACHINE resource, not order material: one warp feeds every WO
    that runs on that loom while it is up — all size variants sharing the warp
    (S, then M, then L). So the mount is pegged to the work center and never to
    a WorkOrder; `source_wo_id` records only which WO's screen triggered it.

    Active mount = `dismounted_at IS NULL`. Remaining kg is never stored here —
    it is read live from the beam batch's StockBalance row at `location_id`,
    because the beam stays lotted for its entire life on the loom. That is what
    replaced the old merge-into-batch-less-pool step: there is no merge, so no
    per-beam pick at completion either — consumption draws FIFO across the
    loom's active mounts (see services/beam_service.py).
    """
    __tablename__ = "beam_mounts"
    # Partial: the only question ever asked of this table is "what is on this loom
    # right now", and an open mount is a small slice of its history.
    __table_args__ = (
        Index(
            "ix_beam_mounts_active",
            "work_center_id",
            "item_id",
            postgresql_where=text("dismounted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("batches.id", ondelete="CASCADE"), index=True
    )
    work_center_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_centers.id", ondelete="CASCADE"), index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)
    # Loom input location the beam physically sits at while mounted.
    location_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True
    )
    qty_mounted: Mapped[float] = mapped_column(Numeric(14, 4), default=0)
    source_wo_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_orders.id", ondelete="SET NULL"), nullable=True
    )
    mounted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    mounted_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    dismounted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    dismounted_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    batch = relationship("Batch", foreign_keys=[batch_id])
    item = relationship("Item")
    work_center = relationship("WorkCenter", lazy="joined")


class BatchConsumption(Base):
    __tablename__ = "batch_consumptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Nullable since packing: a carton's genealogy is pegged to a packing order,
    # not an MO. Exactly one of manufacturing_order_id / packing_order_id is set.
    manufacturing_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("manufacturing_orders.id", ondelete="CASCADE"), nullable=True, index=True
    )
    packing_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("packing_orders.id", ondelete="CASCADE"), nullable=True, index=True
    )
    input_batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("batches.id", ondelete="CASCADE"), index=True
    )
    output_batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("batches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    qty_consumed: Mapped[float] = mapped_column(Numeric(14, 4))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    input_batch = relationship("Batch", foreign_keys=[input_batch_id], back_populates="consumptions_as_input")
    output_batch = relationship("Batch", foreign_keys=[output_batch_id], back_populates="consumptions_as_output")
