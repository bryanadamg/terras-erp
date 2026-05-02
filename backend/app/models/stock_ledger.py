from sqlalchemy import ForeignKey, Numeric, String, DateTime, Table, Column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
import uuid
from datetime import datetime

# Association table for StockLedger <-> AttributeValue
stock_ledger_values = Table(
    "stock_ledger_values",
    Base.metadata,
    Column("stock_ledger_id", UUID(as_uuid=True), ForeignKey("stock_ledger.id"), primary_key=True),
    Column("attribute_value_id", UUID(as_uuid=True), ForeignKey("attribute_values.id"), primary_key=True),
)

class StockLedger(Base):
    __tablename__ = "stock_ledger"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), index=True
    )

    location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id"), index=True
    )

    qty_change: Mapped[float] = mapped_column(
        Numeric(14, 4)  # precision for manufacturing
    )

    reference_type: Mapped[str] = mapped_column(String(32))
    reference_id: Mapped[str] = mapped_column(String(64))

    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("batches.id", ondelete="SET NULL"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, index=True
    )

    # Relationships
    attribute_values = relationship("AttributeValue", secondary=stock_ledger_values)
    batch = relationship("Batch", foreign_keys=[batch_id])
