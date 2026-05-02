from sqlalchemy import String, ForeignKey, Numeric, Boolean, Table, Column, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
import uuid
from typing import Optional
from datetime import datetime

# Association tables
bom_values = Table(
    "bom_values",
    Base.metadata,
    Column("bom_id", UUID(as_uuid=True), ForeignKey("boms.id"), primary_key=True),
    Column("attribute_value_id", UUID(as_uuid=True), ForeignKey("attribute_values.id"), primary_key=True),
)

bom_line_values = Table(
    "bom_line_values",
    Base.metadata,
    Column("bom_line_id", UUID(as_uuid=True), ForeignKey("bom_lines.id"), primary_key=True),
    Column("attribute_value_id", UUID(as_uuid=True), ForeignKey("attribute_values.id"), primary_key=True),
)

class BOM(Base):
    __tablename__ = "boms"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    code: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    
    # Produced Item
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), index=True
    )
    qty: Mapped[float] = mapped_column(Numeric(14, 4), default=1.0)
    tolerance_percentage: Mapped[float] = mapped_column(Numeric(5, 2), default=0.0)

    kerapatan_picks: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    kerapatan_unit: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)  # '/cm' or '/inch'
    sisir_no: Mapped[Optional[int]] = mapped_column(nullable=True)
    pemakaian_obat: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    pembuatan_sample_oleh: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    sample_photo_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    design_file_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    berat_bahan_mateng: Mapped[Optional[float]] = mapped_column(Numeric(10, 4), nullable=True)
    berat_bahan_mentah_pelesan: Mapped[Optional[float]] = mapped_column(Numeric(10, 4), nullable=True)

    # Bahan Keluar Dari Mesin (Machine output measurements)
    mesin_lebar: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    mesin_panjang_tulisan: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    mesin_panjang_tarikan: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    mesin_panjang_tarikan_bandul_1kg: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    mesin_panjang_tarikan_bandul_9kg: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)

    # Bahan Dari Celup / Setting (Post-dye/setting measurements)
    celup_lebar: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    celup_panjang_tulisan: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    celup_panjang_tarikan: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    celup_panjang_tarikan_bandul_1kg: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    celup_panjang_tarikan_bandul_9kg: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)

    active: Mapped[bool] = mapped_column(Boolean, default=True)
    size_mode: Mapped[str] = mapped_column(String(8), default='sized')  # 'sized' | 'free'

    customer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("partners.id"), nullable=True
    )
    work_center_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_centers.id"), nullable=True
    )

    # Relationships
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    item = relationship("Item")
    attribute_values = relationship("AttributeValue", secondary=bom_values)
    lines = relationship("BOMLine", back_populates="bom", cascade="all, delete-orphan")
    operations = relationship("BOMOperation", back_populates="bom", cascade="all, delete-orphan")
    sizes = relationship("BOMSize", back_populates="bom", cascade="all, delete-orphan")
    manufacturing_orders = relationship("ManufacturingOrder", back_populates="bom")
    customer = relationship("Partner", foreign_keys=[customer_id])
    work_center = relationship("WorkCenter", foreign_keys=[work_center_id])

    @property
    def item_code(self) -> str | None:
        return self.item.code if self.item else None

    @property
    def item_name(self) -> str | None:
        return self.item.name if self.item else None

    @property
    def customer_name(self) -> Optional[str]:
        return self.customer.name if self.customer else None

    @property
    def work_center_name(self) -> Optional[str]:
        return self.work_center.name if self.work_center else None


class BOMLine(Base):
    __tablename__ = "bom_lines"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    bom_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("boms.id"), index=True
    )
    
    # Material Item
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), index=True
    )
    
    # Specific Source Location for this material (overrides WO default)
    source_location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True
    )

    qty: Mapped[float] = mapped_column(Numeric(14, 4), default=0.0)
    percentage: Mapped[float] = mapped_column(Numeric(6, 2), default=0.0)

    # Relationships
    bom = relationship("BOM", back_populates="lines")
    item = relationship("Item")
    attribute_values = relationship("AttributeValue", secondary=bom_line_values)

    @property
    def item_code(self) -> str | None:
        return self.item.code if self.item else None

    @property
    def item_name(self) -> str | None:
        return self.item.name if self.item else None


class BOMOperation(Base):
    __tablename__ = "bom_operations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    bom_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("boms.id"), index=True
    )
    
    # Relationships
    bom = relationship("BOM", back_populates="operations")
    
    operation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("operations.id"), nullable=True
    )
    work_center_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("work_centers.id"), nullable=True
    )
    
    sequence: Mapped[int] = mapped_column(Numeric(4, 0), default=10) # e.g. 10, 20, 30
    time_minutes: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0) # Estimated time


class BOMSize(Base):
    __tablename__ = "bom_sizes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bom_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("boms.id"), index=True)
    size_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("sizes.id"), index=True, nullable=True)
    label: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    target_measurement: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    measurement_min: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    measurement_max: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)

    bom = relationship("BOM", back_populates="sizes")
    size = relationship("Size", foreign_keys=[size_id])

    @property
    def size_name(self) -> Optional[str]:
        return self.size.name if self.size else None

    @property
    def sort_order(self) -> int:
        return self.size.sort_order if self.size else 0
