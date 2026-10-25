"""Delivering in-app feedback from `feedback_outbox` to the GitHub inbox.

`api/feedback.py` writes each report to the outbox first and then asks for it
to be sent straight away; main.py's lifespan loop retries whatever is left every
RETRY_SECONDS. So a report survives GitHub being unreachable, the token not
being configured yet, or this server losing its internet — it goes out on the
first pass after that clears.

Rows are claimed with FOR UPDATE SKIP LOCKED, so with several workers each
report is sent by exactly one of them. The one way to send twice is a crash
between GitHub accepting the issue and the row's delete committing; triage
closes the duplicate.

Screenshots are stored as assets of the inbox repo's `screenshots` release and
shown inline in the issue — release assets rather than committed files: each
can be deleted on its own without rewriting git history, and in a private repo
they render only for people with access to it. The token therefore needs
Contents: write as well as Issues.
"""
import base64
import binascii
import logging
import os
import uuid
from datetime import date
from typing import Sequence

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feedback import FeedbackOutbox

logger = logging.getLogger(__name__)

APP_NAME = "terras-erp"
GITHUB_API = "https://api.github.com"
SCREENSHOT_RELEASE = "screenshots"
# Mirrors the dialog's own limits (terras-ui FeedbackDialog).
MAX_SHOTS = 3
MAX_SHOT_BYTES = 4 * 1024 * 1024
RETRY_SECONDS = 5 * 60
_MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


class DeliveryError(Exception):
    """GitHub refused one of the steps; the report stays queued."""


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
    payload: dict, sender: str | None, app_version: str, submitted_on: date, screenshot_urls: Sequence[str] = ()
) -> dict:
    message = payload["message"].strip()
    first_line = message.splitlines()[0] if message else ""
    title = first_line if len(first_line) <= 80 else first_line[:79] + "…"
    images = "".join(f"\n\n![screenshot {i}]({url})" for i, url in enumerate(screenshot_urls, 1))
    context = [
        f"**App:** {APP_NAME} {app_version}",
        f"**Page:** `{payload.get('page') or '-'}`",
        f"**Date:** {submitted_on.isoformat()}",
    ]
    if sender:
        context.append(f"**From:** {sender}")
    return {
        "title": title,
        "body": message + images + "\n\n---\n" + "  \n".join(context),
        "labels": ["feedback", APP_NAME],
    }


def _expect(res: httpx.Response, codes: tuple[int, ...], what: str) -> None:
    if res.status_code not in codes:
        raise DeliveryError(f"GitHub refused to {what}: HTTP {res.status_code} {res.text[:200]}")


async def upload_screenshots(
    client: httpx.AsyncClient, repo: str, headers: dict, shots: Sequence[tuple[bytes, str]], day: date
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
        name = f"{day.isoformat()}-{uuid.uuid4().hex[:12]}.{ext}"
        res = await client.post(
            f"https://uploads.github.com/repos/{repo}/releases/{release_id}/assets",
            params={"name": name},
            content=data,
            headers={**headers, "Content-Type": _MIME[ext]},
        )
        _expect(res, (201,), "upload a screenshot")
        urls.append(res.json()["browser_download_url"])
    return urls


async def _deliver(client: httpx.AsyncClient, repo: str, headers: dict, row: FeedbackOutbox) -> None:
    day = row.created_at.date()
    shots = [decode_screenshot(s) for s in row.payload.get("screenshots", [])]
    # ponytail: a retry after the uploads succeeded but the issue POST failed
    # uploads them again, orphaning the first copies in the release; prune
    # unlinked assets if that ever matters.
    urls = await upload_screenshots(client, repo, headers, shots, day) if shots else []
    issue = build_issue(row.payload, row.sender, row.app_version, day, urls)
    res = await client.post(f"{GITHUB_API}/repos/{repo}/issues", json=issue, headers=headers)
    _expect(res, (201,), "file the issue")


async def send_pending(
    db: AsyncSession, only_id: int | None = None, transport: httpx.AsyncBaseTransport | None = None
) -> int:
    """Send queued reports (or just `only_id`), oldest first; return how many reached GitHub.

    Never raises for a failed delivery: the row keeps its error and attempt
    count and waits for the next pass. `transport` is for tests.
    """
    token = os.getenv("FEEDBACK_GITHUB_TOKEN")
    repo = os.getenv("FEEDBACK_GITHUB_REPO")
    if not token or not repo:
        return 0

    ids_query = select(FeedbackOutbox.id).order_by(FeedbackOutbox.id)
    if only_id is not None:
        ids_query = ids_query.where(FeedbackOutbox.id == only_id)
    ids = (await db.execute(ids_query)).scalars().all()

    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    sent = 0
    # Generous: up to 3 × 4 MB goes up over the client's own uplink.
    async with httpx.AsyncClient(timeout=60, transport=transport) as client:
        for row_id in ids:
            row = (await db.execute(
                select(FeedbackOutbox).where(FeedbackOutbox.id == row_id).with_for_update(skip_locked=True)
            )).scalar_one_or_none()
            if row is None:  # another worker is sending it, or already has
                continue
            try:
                await _deliver(client, repo, headers, row)
            except (DeliveryError, httpx.HTTPError, ValueError) as e:
                row.attempts += 1
                row.last_error = str(e)[:1000]
                logger.warning("Feedback report %s not delivered (attempt %s): %s", row.id, row.attempts, e)
            else:
                await db.delete(row)
                sent += 1
            await db.commit()
    return sent
