import uuid
from sqlalchemy import ForeignKey, Numeric, Table, Column, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base

# Association for many-to-many variants in the balance
stock_balance_values = Table(
    "stock_balance_values",
    Base.metadata,
    Column("balance_id", UUID(as_uuid=True), ForeignKey("stock_balances.id"), primary_key=True),
    Column("attribute_value_id", UUID(as_uuid=True), ForeignKey("attribute_values.id"), primary_key=True),
)

class StockBalance(Base):
    __tablename__ = "stock_balances"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), index=True
    )

    location_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id"), index=True
    )

    # The actual cached total
    qty: Mapped[float] = mapped_column(
        Numeric(14, 4), default=0.0
    )

    # For unique indexing of variants
    # Store sorted attribute value IDs as a string for easy matching
    variant_key: Mapped[str] = mapped_column(String(255), default="", index=True)

    # Batch tracking: empty string = no batch, UUID string = specific batch
    batch_key: Mapped[str] = mapped_column(String(64), default="", index=True)

    # Relationships
    item = relationship("Item")
    location = relationship("Location")
    attribute_values = relationship("AttributeValue", secondary=stock_balance_values)

    # Ensure we only have one row per unique combination
    __table_args__ = (
        UniqueConstraint('item_id', 'location_id', 'variant_key', 'batch_key', name='_item_loc_variant_batch_uc'),
    )
