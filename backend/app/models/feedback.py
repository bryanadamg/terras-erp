from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FeedbackOutbox(Base):
    """An in-app feedback report on its way to the GitHub inbox.

    Written before any attempt to send, so a report survives GitHub (or this
    server's internet) being down, or the token not being configured yet. The
    row is deleted the moment its issue exists — this is a delivery buffer, not
    a record of feedback; the inbox repo is that.

    Holds no user id on purpose: `sender` is the opted-in "name (username)"
    text, or NULL, so the row is exactly as anonymous as the issue it becomes.
    """

    __tablename__ = "feedback_outbox"

    # Ordered by id, oldest report first.
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # The validated request: message, page, include_name and base64 screenshots
    # (up to 3 × 4 MB — they leave with the row once delivered).
    payload: Mapped[dict] = mapped_column(JSONB)
    sender: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # The version the user was on when they wrote it, not when it got sent.
    app_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
