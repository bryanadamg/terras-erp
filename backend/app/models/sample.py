import uuid
from datetime import datetime, date
from sqlalchemy import String, ForeignKey, Integer, Text, DateTime, Table, Column, Boolean, Float, Date
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base

# Kept for backward compatibility — not actively used after this change
sample_attribute_values = Table(
    "sample_attribute_values",
    Base.metadata,
    Column("sample_request_id", UUID(as_uuid=True), ForeignKey("sample_requests.id"), primary_key=True),
    Column("attribute_value_id", UUID(as_uuid=True), ForeignKey("attribute_values.id"), primary_key=True),
)


class SampleColor(Base):
    __tablename__ = "sample_colors"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sample_request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sample_requests.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    is_repeat: Mapped[bool] = mapped_column(Boolean, default=False)
    order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="PENDING")


class SampleRequest(Base):
    __tablename__ = "sample_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)

    sales_order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sales_orders.id"), nullable=True, index=True
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("partners.id"), nullable=True, index=True
    )
    base_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), nullable=True, index=True
    )

    request_date: Mapped[date] = mapped_column(Date, default=date.today)
    project: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_article_code: Mapped[str | None] = mapped_column(String(255), nullable=True)
    internal_article_code: Mapped[str | None] = mapped_column(String(255), nullable=True)
    width: Mapped[str | None] = mapped_column(String(64), nullable=True)
    main_material: Mapped[str | None] = mapped_column(String(255), nullable=True)
    middle_material: Mapped[str | None] = mapped_column(String(255), nullable=True)
    bottom_material: Mapped[str | None] = mapped_column(String(255), nullable=True)
    weft: Mapped[str | None] = mapped_column(String(255), nullable=True)
    warp: Mapped[str | None] = mapped_column(String(255), nullable=True)
    original_weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    original_weight_unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    production_weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    production_weight_unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    additional_info: Mapped[str | None] = mapped_column(Text, nullable=True)
    quantity: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sample_size: Mapped[str | None] = mapped_column(String(255), nullable=True)
    estimated_completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completion_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="DRAFT", index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    sales_order = relationship("SalesOrder", backref="samples")
    customer = relationship("Partner", foreign_keys=[customer_id])
    colors = relationship("SampleColor", order_by="SampleColor.order", cascade="all, delete-orphan")


class SampleRequestRead(Base):
    __tablename__ = "sample_request_reads"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    sample_request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sample_requests.id", ondelete="CASCADE"), primary_key=True
    )
    read_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
