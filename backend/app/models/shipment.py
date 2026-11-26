import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, ForeignKey, DateTime, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Shipment(Base):
    """One Surat Jalan = one loading-deck handover, grouping 1..n pick lists.

    The outbound chain mirrors standard WMS practice and each tier is a different
    person doing a different job:

        PackingOrder  -> pack bulk FG into cartons          (packer)
        PickList      -> pull named cartons for an SO       (picker)
        Shipment      -> stage on the deck, check, hand over (loader + checker)

    A pick list is an internal instruction and ends at PICKED. The Surat Jalan is
    the external, signed, legally-kept document, and the facts it carries — SJ
    number, vehicle, driver, delivery date — are loading-deck facts that do not
    exist while picking. Keeping them on PickList meant the picker typed their own
    delivery note and then confirmed their own dispatch; the four-eyes gate this
    entity exists for was unenforceable.

    Status flow: DRAFT -> STAGED -> VERIFIED -> DISPATCHED (or CANCELLED).
      DRAFT      pick lists being gathered onto the deck
      STAGED     goods physically on the loading deck, Surat Jalan printed
      VERIFIED   a *second* person counted the cartons against that printout
      DISPATCHED goods issue posted, truck gone

    Staging deliberately moves no stock. This plant nets material availability
    location-agnostically (see CLAUDE.md), so shunting cartons into a "deck" bin
    would write ledger rows that change nothing anyone reads, and would have to be
    unwound on every cancel. Stock leaves once, at goods issue.

    Scope: one shipment carries one customer, because one Surat Jalan addresses one
    `Kepada Yth`. A truck doing several drops is several shipments.
    """
    __tablename__ = "shipments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)  # SHP-00001

    # The printed Surat Jalan number. Auto-allocated in the client's format at
    # creation but editable — their paper series predates this system.
    delivery_note_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    delivery_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Snapshot of the single customer this note addresses; every member pick list
    # must agree with it (enforced on add).
    customer_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)

    carrier: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    vehicle_plate: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    driver: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    # DRAFT, STAGED, VERIFIED, DISPATCHED, CANCELLED
    status: Mapped[str] = mapped_column(String(16), default="DRAFT", index=True)

    staged_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    staged_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    # The deck check. `verified_by_id` is the whole point of this table, so it is a
    # real FK to a user, not a typed-in name — a name proves nothing.
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    verified_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    verification_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Set when the checker found a discrepancy and passed it anyway (short/over
    # load agreed with the customer). Keeps a clean count distinguishable from a
    # waved-through one in the audit trail.
    verified_with_discrepancy: Mapped[bool] = mapped_column(Boolean, default=False)

    dispatched_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Last time the Surat Jalan was printed from the ERP — lets the deck see which
    # loads still have no paper, since staging no longer opens the print itself.
    delivery_note_printed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    created_by = relationship("User", foreign_keys=[created_by_id])
    staged_by = relationship("User", foreign_keys=[staged_by_id])
    verified_by = relationship("User", foreign_keys=[verified_by_id])
    # Removing a pick list from a shipment must not delete it — it goes back on the
    # stageable board — so this is SET NULL on the child, never a cascade.
    pick_lists = relationship("PickList", back_populates="shipment")
