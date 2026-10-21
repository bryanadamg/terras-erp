"""In-app feedback, forwarded to GitHub Issues.

The form is terras-ui's `FeedbackDialog`, shared with terras-sku, whose
`POST /api/v1/feedback` keeps the same contract in its own copy of this route.

Anonymous by default: the issue carries no user identity unless the submitter
ticks `include_name`. Login is still required, so only real users can post. For
the same reason this route deliberately skips `audit_service.log_activity` —
an audit row would record who sent what and undo the anonymity for anyone with
audit access. Context is kept coarse (page path, version, day — no time,
role or user agent): on a small shop floor those alone can name the sender.

Screenshots arrive as base64 in the JSON body (the dialog has already stripped
their metadata and baked in any black-out) and are stored as assets of the
inbox repo's `screenshots` release, then shown inline in the issue. Release
assets rather than committed files: each can be deleted on its own without
rewriting git history, and in a private repo they render only for people with
access to it. The token therefore needs Contents: write as well as Issues.
"""
import base64
import binascii
import logging
import os
import uuid
from datetime import date
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.auth import get_current_user
from app.models.auth import User

router = APIRouter()
logger = logging.getLogger(__name__)

APP_NAME = "terras-erp"
GITHUB_API = "https://api.github.com"
SCREENSHOT_RELEASE = "screenshots"
# Mirrors the dialog's own limits (terras-ui FeedbackDialog).
MAX_SHOTS = 3
MAX_SHOT_BYTES = 4 * 1024 * 1024
_MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}

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


def decode_screenshot(b64: str) -> tuple[bytes, str]:
    """The image bytes and their file extension; ValueError for anything else."""
    try:
        data = base64.b64decode(b64, validate=True)
    except binascii.Error:
        raise ValueError("Screenshot is not valid base64")
    if len(data) > MAX_SHOT_BYTES:
        raise ValueError("Screenshot is larger than 4 MB")
    # Sniffed from the bytes, never taken from the client.
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return data, "png"
    if data.startswith(b"\xff\xd8\xff"):
        return data, "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return data, "webp"
    raise ValueError("Screenshot must be a PNG, JPEG or WebP image")


def build_issue(
    payload: FeedbackCreate, user: User, app_version: str, today: date, screenshot_urls: list[str] = ()
) -> dict:
    message = payload.message.strip()
    first_line = message.splitlines()[0] if message else ""
    title = first_line if len(first_line) <= 80 else first_line[:79] + "…"
    images = "".join(f"\n\n![screenshot {i}]({url})" for i, url in enumerate(screenshot_urls, 1))
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
        "body": message + images + "\n\n---\n" + "  \n".join(context),
        "labels": ["feedback", APP_NAME],
    }


def _expect(res: httpx.Response, codes: tuple[int, ...], what: str) -> None:
    if res.status_code not in codes:
        logger.warning("Feedback could not %s: %s %s", what, res.status_code, res.text[:300])
        raise HTTPException(status_code=502, detail="The feedback service rejected the report")


async def upload_screenshots(
    client: httpx.AsyncClient, repo: str, headers: dict, shots: list[tuple[bytes, str]], today: date
) -> list[str]:
    """Upload each image as an asset of the `screenshots` release; return their URLs."""
    res = await client.get(f"{GITHUB_API}/repos/{repo}/releases/tags/{SCREENSHOT_RELEASE}", headers=headers)
    if res.status_code == 404:
        res = await client.post(f"{GITHUB_API}/repos/{repo}/releases", headers=headers, json={
            "tag_name": SCREENSHOT_RELEASE,
            "name": SCREENSHOT_RELEASE,
            "body": "Storage for feedback screenshots. Delete an asset to remove its image from the issue.",
            "prerelease": True,
        })
    _expect(res, (200, 201), "find the screenshot release")
    release_id = res.json()["id"]

    urls = []
    for data, ext in shots:
        # Random name with the day only — the same coarseness as the issue body.
        name = f"{today.isoformat()}-{uuid.uuid4().hex[:12]}.{ext}"
        res = await client.post(
            f"https://uploads.github.com/repos/{repo}/releases/{release_id}/assets",
            params={"name": name},
            content=data,
            headers={**headers, "Content-Type": _MIME[ext]},
        )
        _expect(res, (201,), "upload a screenshot")
        urls.append(res.json()["browser_download_url"])
    return urls


@router.post("/feedback", status_code=201)
async def submit_feedback(payload: FeedbackCreate, current_user: User = Depends(get_current_user)):
    if not payload.message.strip():
        raise HTTPException(status_code=422, detail="Message is empty")
    try:
        shots = [decode_screenshot(s) for s in payload.screenshots]
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    token = os.getenv("FEEDBACK_GITHUB_TOKEN")
    repo = os.getenv("FEEDBACK_GITHUB_REPO")
    if not token or not repo:
        raise HTTPException(status_code=503, detail="Feedback is not configured on this server")

    from app.main import APP_VERSION  # deferred: app.main imports this module

    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    today = date.today()
    try:
        # Generous: up to 3 × 4 MB goes up over the client's own uplink.
        async with httpx.AsyncClient(timeout=60) as client:
            # ponytail: if the issue POST fails after the uploads, their assets
            # are orphaned in the release; prune unlinked ones if that ever matters.
            urls = await upload_screenshots(client, repo, headers, shots, today) if shots else []
            issue = build_issue(payload, current_user, APP_VERSION, today, urls)
            res = await client.post(f"{GITHUB_API}/repos/{repo}/issues", json=issue, headers=headers)
    except httpx.HTTPError as e:
        logger.warning("Feedback forward failed: %s", e)
        raise HTTPException(status_code=502, detail="Could not reach the feedback service")
    _expect(res, (201,), "file the issue")
    return {"ok": True}
