from sqlalchemy import String, Boolean, Float, ForeignKey, Table, Column, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
import uuid
from datetime import datetime

# Association table for Item <-> Attribute
item_attributes = Table(
    "item_attributes",
    Base.metadata,
    Column("item_id", UUID(as_uuid=True), ForeignKey("items.id"), primary_key=True),
    Column("attribute_id", UUID(as_uuid=True), ForeignKey("attributes.id"), primary_key=True),
)

class Item(Base):
    __tablename__ = "items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    code: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    uom: Mapped[str] = mapped_column(String(32))
    category: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    # Lineage: which SampleRequest + SampleColor this item was derived from
    source_sample_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sample_requests.id", ondelete="SET NULL"), nullable=True
    )
    source_color_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sample_colors.id", ondelete="SET NULL"), nullable=True
    )

    weight_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_unit: Mapped[str | None] = mapped_column(String(16), nullable=True)  # e.g. gsm, g/m², oz/yd²

    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    attributes = relationship("Attribute", secondary=item_attributes, backref="items")
    source_sample = relationship("SampleRequest", foreign_keys=[source_sample_id])
    source_color = relationship("SampleColor", foreign_keys=[source_color_id])
