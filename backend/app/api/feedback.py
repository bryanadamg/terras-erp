"""In-app feedback, forwarded to GitHub Issues.

The form is terras-ui's `FeedbackDialog`, shared with terras-sku, whose
`POST /api/v1/feedback` keeps the same contract in its own copy of this route.

Anonymous by default: the issue carries no user identity unless the submitter
ticks `include_name`. Login is still required, so only real users can post. For
the same reason this route deliberately skips `audit_service.log_activity` —
an audit row would record who sent what and undo the anonymity for anyone with
audit access. Context is kept coarse (page path, version, day — no time,
role or user agent): on a small shop floor those alone can name the sender.
"""
import logging
import os
from datetime import date

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.auth import get_current_user
from app.models.auth import User

router = APIRouter()
logger = logging.getLogger(__name__)

APP_NAME = "terras-erp"


# No type/category field: the form is one text box on purpose, and whoever
# triages the inbox labels the issue. A stale browser tab still posting the old
# `kind` field is fine — pydantic ignores unknown fields.
class FeedbackCreate(BaseModel):
    message: str = Field(min_length=1, max_length=5000)
    page: str = Field(default="", max_length=300)
    include_name: bool = False


def build_issue(payload: FeedbackCreate, user: User, app_version: str, today: date) -> dict:
    message = payload.message.strip()
    first_line = message.splitlines()[0] if message else ""
    title = first_line if len(first_line) <= 80 else first_line[:79] + "…"
    context = [
        f"**App:** {APP_NAME} {app_version}",
        f"**Page:** `{payload.page or '-'}`",
        f"**Date:** {today.isoformat()}",
    ]
    if payload.include_name:
        # Backticks, not "@username": an @ in an issue body pings whichever
        # GitHub account happens to share the ERP username.
        context.append(f"**From:** {user.full_name} (`{user.username}`)")
    return {
        "title": title,
        "body": message + "\n\n---\n" + "  \n".join(context),
        "labels": ["feedback", APP_NAME],
    }


@router.post("/feedback", status_code=201)
async def submit_feedback(payload: FeedbackCreate, current_user: User = Depends(get_current_user)):
    if not payload.message.strip():
        raise HTTPException(status_code=422, detail="Message is empty")
    token = os.getenv("FEEDBACK_GITHUB_TOKEN")
    repo = os.getenv("FEEDBACK_GITHUB_REPO")
    if not token or not repo:
        raise HTTPException(status_code=503, detail="Feedback is not configured on this server")

    from app.main import APP_VERSION  # deferred: app.main imports this module

    issue = build_issue(payload, current_user, APP_VERSION, date.today())
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                f"https://api.github.com/repos/{repo}/issues",
                json=issue,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                },
            )
    except httpx.HTTPError as e:
        logger.warning("Feedback forward failed: %s", e)
        raise HTTPException(status_code=502, detail="Could not reach the feedback service")
    if res.status_code != 201:
        logger.warning("Feedback forward rejected: %s %s", res.status_code, res.text[:300])
        raise HTTPException(status_code=502, detail="The feedback service rejected the report")
    return {"ok": True}
