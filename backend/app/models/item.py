from sqlalchemy import String, Boolean, Float, ForeignKey, Table, Column, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
import uuid
from datetime import datetime
from app.models.category import Category

# Association table for Item <-> Attribute
item_attributes = Table(
    "item_attributes",
    Base.metadata,
    Column("item_id", UUID(as_uuid=True), ForeignKey("items.id", ondelete="CASCADE"), primary_key=True),
    Column("attribute_id", UUID(as_uuid=True), ForeignKey("attributes.id", ondelete="CASCADE"), primary_key=True),
)

# Association table for Item <-> UOMFactor (packaging units)
item_uom_factors = Table(
    "item_uom_factors",
    Base.metadata,
    Column("item_id", UUID(as_uuid=True), ForeignKey("items.id", ondelete="CASCADE"), primary_key=True),
    Column("uom_factor_id", UUID(as_uuid=True), ForeignKey("uom_factors.id", ondelete="CASCADE"), primary_key=True),
)

class Item(Base):
    __tablename__ = "items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    code: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    uom: Mapped[str] = mapped_column(String(32))
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    category: Mapped["Category | None"] = relationship(
        "Category", foreign_keys="[Item.category_id]", lazy="joined"
    )

    # Lineage: which SampleRequest + SampleColor this item was derived from
    source_sample_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sample_requests.id", ondelete="SET NULL"), nullable=True
    )
    source_color_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sample_colors.id", ondelete="SET NULL"), nullable=True
    )

    # Material-master default issue (source) location — where this item is normally
    # pulled from when staging it to a work order. Per-BOM-line source overrides it.
    default_source_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )

    # Material-master default putaway (receiving) location — preferred bin for
    # this item's production output. MO.planned_putaway_location_id overrides it.
    default_putaway_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )

    # Material-master default QC-reject (defect store) location — where scrap of
    # this item is quarantined. Fallback in the reject-location chain, behind the
    # producing work center's own reject_location_id (services/reject_service.py).
    default_reject_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True
    )

    weight_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_unit: Mapped[str | None] = mapped_column(String(16), nullable=True)  # e.g. gsm, g/m², oz/yd²
    ends: Mapped[int | None] = mapped_column(nullable=True)  # warp ends count for beam items
    lot_tracked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")  # enforce lot/batch on all stock moves
    # MRP decoupling point (make-to-stock component). When true, this item is
    # NEVER auto-created as an MO during BOM explosion — its parents still record
    # the demand (MOPlannedComponent snapshot / netting), but it is replenished
    # independently on a pooled standalone MO. A per-BOM-line override wins over
    # this item-level default (BOMLine.is_decoupling_point, null = inherit).
    is_decoupling_point: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    min_stock_level: Mapped[float | None] = mapped_column(Float, nullable=True)  # reorder point; null → default low-stock threshold (10)

    # Finished-goods variant dimension: 'color' | 'combo' | None. Drives the SO
    # variant picker source — 'color' -> Color Library typeahead (writes color_id),
    # 'combo' -> Combo Library values (gates BOM). Null for non-FG / non-variant items.
    variant_type: Mapped[str | None] = mapped_column(String(16), nullable=True)

    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    attributes = relationship("Attribute", secondary=item_attributes, backref="items")
    packaging_factors = relationship("UOMFactor", secondary=item_uom_factors, lazy="selectin")
    source_sample = relationship("SampleRequest", foreign_keys=[source_sample_id])
    source_color = relationship("SampleColor", foreign_keys=[source_color_id])
