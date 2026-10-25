"""In-app feedback, forwarded to GitHub Issues.

The form is terras-ui's `FeedbackDialog`, shared with terras-sku, whose
`POST /api/v1/feedback` keeps the same contract in its own copy of this route.

Anonymous by default: the issue carries no user identity unless the submitter
ticks `include_name`. Login is still required, so only real users can post. For
the same reason this route deliberately skips `audit_service.log_activity` —
an audit row would record who sent what and undo the anonymity for anyone with
audit access. Context is kept coarse (page path, version, day — no time,
role or user agent): on a small shop floor those alone can name the sender.

Every report is saved to `feedback_outbox` before anything is sent, then sent
straight away if GitHub is reachable: 201 when it got there, 202 with
`queued: true` when it is waiting for the retry loop (no token configured yet,
no internet, GitHub refusing). Either way the user's report is not lost.
Delivery itself lives in `services/feedback_service.py`.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.db.session import get_async_db
from app.models.auth import User
from app.models.feedback import FeedbackOutbox
from app.services import feedback_service
from app.services.feedback_service import MAX_SHOT_BYTES, MAX_SHOTS, decode_screenshot

router = APIRouter()

# base64 is 4/3 the size of the bytes it carries, plus padding.
Screenshot = Annotated[str, Field(max_length=MAX_SHOT_BYTES * 4 // 3 + 4)]


# No type/category field: the form is one text box on purpose, and whoever
# triages the inbox labels the issue. A stale browser tab still posting the old
# `kind` field is fine — pydantic ignores unknown fields.
class FeedbackCreate(BaseModel):
    message: str = Field(min_length=1, max_length=5000)
    page: str = Field(default="", max_length=300)
    include_name: bool = False
    screenshots: list[Screenshot] = Field(default=[], max_length=MAX_SHOTS)


@router.post("/feedback", status_code=201)
async def submit_feedback(
    payload: FeedbackCreate,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    if not payload.message.strip():
        raise HTTPException(status_code=422, detail="Message is empty")
    try:
        for screenshot in payload.screenshots:
            decode_screenshot(screenshot)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    from app.main import APP_VERSION  # deferred: app.main imports this module

    # Resolved now, as text, so the queued row holds no user id. Backticks, not
    # "@username": an @ in an issue body pings whichever GitHub account happens
    # to share the ERP username.
    sender = f"{current_user.full_name} (`{current_user.username}`)" if payload.include_name else None
    row = FeedbackOutbox(payload=payload.model_dump(), sender=sender, app_version=APP_VERSION)
    db.add(row)
    await db.flush()
    row_id = row.id
    await db.commit()

    if await feedback_service.send_pending(db, only_id=row_id):
        return {"queued": False}
    response.status_code = 202
    return {"queued": True}
