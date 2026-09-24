import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PrintTemplate(Base):
    """Client-editable print layout for one document type.

    One row per `doc_type` (e.g. `kartu_kerja_weaving`). **No row means the
    built-in default layout applies** — the defaults ship as frontend constants,
    so "reset to factory design" is a plain DELETE of this row rather than a
    versioning table.

    `layout` is the ordered band list that the frontend `TemplateRenderer` walks.
    The backend never interprets it — it is opaque storage. Keeping the schema
    dumb is deliberate: adding a new band type or field must not require a
    migration.
    """

    __tablename__ = "print_templates"
    __table_args__ = (UniqueConstraint("doc_type", name="uq_print_templates_doc_type"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_type: Mapped[str] = mapped_column(String(64))  # unique via __table_args__
    layout: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # Paper size / orientation / margin. Nullable = inherit the default layout's paper.
    paper: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
