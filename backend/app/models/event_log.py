from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EventLogEntry(Base):
    """One broadcast live event, durably recorded and ordered.

    Live events were fire-and-forget: `manager.broadcast()` published to Redis and
    kept no record. Two consequences, both silent. If Redis was unreachable the
    publish fell back to this worker's own sockets, so everyone connected to a
    different worker simply never heard. And a client that dropped its connection
    had no way to learn what it missed — reconnecting could only re-pull the whole
    current route and hope.

    Writing the event here first gives both: `published_at IS NULL` is a retry
    queue the relay drains when Redis comes back, and `seq` is a monotonic cursor a
    reconnecting client can resume from.

    NOT a full transactional outbox yet. The row is written by `broadcast()` in its
    own short transaction, which runs *after* the mutation's commit — so a process
    that dies in the gap between the two still loses the event. Closing that means
    moving each emit inside its caller's transaction, one domain at a time, and the
    ~117 call sites broadcast after commit today. This buys the Redis and reconnect
    halves without that refactor.

    Retention is short by design (see EVENT_RETENTION in event_log_service): this is
    a delivery buffer, not an audit trail — `audit_logs` is the durable record of
    what happened.
    """

    __tablename__ = "event_log"
    # The publisher only ever reads the unpublished tail, which stays tiny next
    # to the log itself.
    __table_args__ = (
        Index("ix_event_log_unpublished", "seq", postgresql_where=text("published_at IS NULL")),
    )

    # BIGSERIAL: the resume cursor. Postgres hands out sequence values at INSERT,
    # so two concurrent inserts can become visible out of order for an instant —
    # a reader could see seq 5 before 4 commits and resume past it. Events here
    # are human-paced (someone logs a bag, someone saves an order), so the window
    # is negligible; a high-throughput emitter would need a commit-ordered cursor.
    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, server_default=func.now(), index=True
    )
    # NULL = never made it onto the bus; the relay retries these.
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
