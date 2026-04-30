import uuid
from sqlalchemy import String, Numeric, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base

class UOM(Base):
    __tablename__ = "uoms"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    factors: Mapped[list["UOMFactor"]] = relationship("UOMFactor", back_populates="uom", cascade="all, delete-orphan", order_by="UOMFactor.value")


class UOMFactor(Base):
    __tablename__ = "uom_factors"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    uom_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("uoms.id", ondelete="CASCADE"), index=True
    )
    value: Mapped[float] = mapped_column(Numeric(14, 4))  # yards per unit
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)

    uom: Mapped["UOM"] = relationship("UOM", back_populates="factors")
