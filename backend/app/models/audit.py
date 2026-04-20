import uuid
from datetime import datetime, timezone
from sqlalchemy import String, ForeignKey, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(32)) # CREATE, UPDATE, DELETE
    entity_type: Mapped[str] = mapped_column(String(64), index=True) # Item, BOM, WorkOrder
    entity_id: Mapped[str] = mapped_column(String(64), index=True) # UUID string
    details: Mapped[str | None] = mapped_column(Text, nullable=True) # Human readable summary
    changes: Mapped[dict | None] = mapped_column(JSONB, nullable=True) # Technical diff
    
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), index=True)

    # Relationships
    user = relationship("User")
