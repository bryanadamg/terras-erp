import uuid
from sqlalchemy import String, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base

class Attribute(Base):
    __tablename__ = "attributes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    is_system: Mapped[bool] = mapped_column(default=False)

    values = relationship("AttributeValue", backref="attribute", cascade="all, delete-orphan")

class AttributeValue(Base):
    __tablename__ = "attribute_values"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    attribute_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("attributes.id"), index=True
    )
    value: Mapped[str] = mapped_column(String(255)) # e.g. "Red"
