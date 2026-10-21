"""In-app feedback: anonymous unless the sender opts in, never lost when GitHub
can't be reached, and screenshots checked by their bytes.

The issue body and the queued `feedback_outbox` row are the only places
identity could reach, so both are pinned. Delivery runs against a fake GitHub
(httpx.MockTransport), never the network.
"""
import base64
from datetime import date

import httpx
import pytest
from sqlalchemy import select

from app.models.feedback import FeedbackOutbox
from app.services import feedback_service
from app.services.feedback_service import (
    MAX_SHOT_BYTES,
    build_issue,
    decode_screenshot,
    send_pending,
    upload_screenshots,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
JPG = b"\xff\xd8\xff\xe0" + b"\0" * 32
DAY = date(2026, 10, 20)


def _b64(data):
    return base64.b64encode(data).decode()


def _payload(message="MO tab freezes\nwhen filtering", **extra):
    return {"message": message, "page": "/manufacturing", "include_name": False, "screenshots": [], **extra}


def fake_github(calls=None, fail_issue=False):
    """A handler for httpx.MockTransport: release lookup 404 → create, uploads, issues."""
    def handle(request):
        if calls is not None:
            calls.append((request.method, request.url.host, request.url.path))
        path = request.url.path
        if path.endswith("/releases/tags/screenshots"):
            return httpx.Response(404)
        if path.endswith("/releases"):
            return httpx.Response(201, json={"id": 7})
        if request.url.host == "uploads.github.com":
            name = request.url.params["name"]
            return httpx.Response(201, json={"browser_download_url": f"https://github.com/o/r/releases/download/screenshots/{name}"})
        if path.endswith("/issues"):
            return httpx.Response(500 if fail_issue else 201, json={})
        return httpx.Response(404)
    return handle


# --- Issue body -----------------------------------------------------------------

def test_anonymous_issue_carries_no_identity():
    issue = build_issue(_payload(), None, "0.43.0", DAY)
    assert "From" not in issue["body"]
    assert issue["title"] == "MO tab freezes"
    assert issue["labels"] == ["feedback", "terras-erp"]
    assert "/manufacturing" in issue["body"] and "0.43.0" in issue["body"] and "2026-10-20" in issue["body"]


def test_opt_in_sender_is_attached():
    body = build_issue(_payload(), "Siti Rahma (`siti`)", "0.43.0", DAY)["body"]
    assert "**From:** Siti Rahma (`siti`)" in body


def test_long_first_line_is_cut_for_the_title():
    title = build_issue(_payload("x" * 200), None, "0.43.0", DAY)["title"]
    assert len(title) == 80 and title.endswith("…")


def test_screenshots_show_inline_above_the_context():
    body = build_issue(_payload("Save fails"), None, "0.43.0", DAY, ["https://x/a.png", "https://x/b.png"])["body"]
    assert "![screenshot 1](https://x/a.png)" in body and "![screenshot 2](https://x/b.png)" in body
    assert body.index("![screenshot 2]") < body.index("---")


# --- Screenshots ----------------------------------------------------------------

def test_screenshot_type_is_sniffed_from_the_bytes():
    assert decode_screenshot(_b64(PNG))[1] == "png"
    assert decode_screenshot(_b64(JPG))[1] == "jpg"
    for bad in (_b64(b"<svg onload=alert(1)>"), "not base64!", _b64(b"\x89PNG" + b"\0" * MAX_SHOT_BYTES)):
        with pytest.raises(ValueError):
            decode_screenshot(bad)


def test_upload_creates_the_release_once_then_uploads_each_asset(client):
    calls = []

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(fake_github(calls))) as c:
            return await upload_screenshots(c, "o/r", {}, [(PNG, "png"), (PNG, "png")], date(2026, 10, 21))

    urls = client.portal.call(run)
    assert len(urls) == 2 and all(u.startswith("https://github.com/o/r/releases/download/screenshots/2026-10-21-") for u in urls)
    assert [c[0] for c in calls] == ["GET", "POST", "POST", "POST"]
    assert calls[2][1:] == ("uploads.github.com", "/repos/o/r/releases/7/assets")


# --- The route ------------------------------------------------------------------

def test_requires_login(client):
    assert client.post("/api/feedback", json={"message": "hi"}).status_code == 401


def test_too_many_or_bad_screenshots_are_rejected(client, auth_headers):
    four = {"message": "hi", "screenshots": [_b64(PNG)] * 4}
    assert client.post("/api/feedback", json=four, headers=auth_headers).status_code == 422
    bad = {"message": "hi", "screenshots": [_b64(b"GIF89a")]}
    res = client.post("/api/feedback", json=bad, headers=auth_headers)
    assert res.status_code == 422 and "PNG" in res.text


def _queued_rows(client, async_db_session):
    async def read():
        return (await async_db_session.execute(select(FeedbackOutbox))).scalars().all()
    return client.portal.call(read)


def test_unconfigured_server_queues_the_report_anonymously(client, async_db_session, auth_headers, monkeypatch):
    monkeypatch.delenv("FEEDBACK_GITHUB_TOKEN", raising=False)
    # A stale tab still sends the old `kind` field; it must not be a 422.
    res = client.post("/api/feedback", json={"kind": "idea", "message": "hi", "screenshots": [_b64(PNG)]}, headers=auth_headers)
    assert res.status_code == 202 and res.json() == {"queued": True}
    [row] = _queued_rows(client, async_db_session)
    assert row.sender is None and row.payload["message"] == "hi" and row.payload["screenshots"] == [_b64(PNG)]
    assert "kind" not in row.payload


def test_opt_in_queues_the_name_as_text_not_a_user_id(client, async_db_session, auth_headers, test_user, monkeypatch):
    monkeypatch.delenv("FEEDBACK_GITHUB_TOKEN", raising=False)
    client.post("/api/feedback", json={"message": "hi", "include_name": True}, headers=auth_headers)
    [row] = _queued_rows(client, async_db_session)
    assert row.sender == f"{test_user.full_name} (`{test_user.username}`)"


def test_reachable_github_files_the_issue_at_once(client, async_db_session, auth_headers, monkeypatch):
    monkeypatch.setenv("FEEDBACK_GITHUB_TOKEN", "t")
    monkeypatch.setenv("FEEDBACK_GITHUB_REPO", "o/r")
    real = feedback_service.send_pending
    monkeypatch.setattr(feedback_service, "send_pending",
                        lambda db, only_id=None: real(db, only_id, transport=httpx.MockTransport(fake_github())))
    res = client.post("/api/feedback", json={"message": "hi"}, headers=auth_headers)
    assert res.status_code == 201 and res.json() == {"queued": False}
    assert _queued_rows(client, async_db_session) == []


# --- Retrying -------------------------------------------------------------------

def _queue(client, async_db_session, **payload):
    async def add():
        row = FeedbackOutbox(payload=_payload(**payload), sender=None, app_version="0.43.0")
        async_db_session.add(row)
        await async_db_session.commit()
    client.portal.call(add)


def test_retry_keeps_a_failed_report_and_sends_it_once_github_is_back(client, async_db_session, monkeypatch):
    monkeypatch.setenv("FEEDBACK_GITHUB_TOKEN", "t")
    monkeypatch.setenv("FEEDBACK_GITHUB_REPO", "o/r")
    _queue(client, async_db_session, screenshots=[_b64(PNG)])

    down = httpx.MockTransport(fake_github(fail_issue=True))
    assert client.portal.call(send_pending, async_db_session, None, down) == 0
    [row] = _queued_rows(client, async_db_session)
    assert row.attempts == 1 and "HTTP 500" in row.last_error

    calls = []
    up = httpx.MockTransport(fake_github(calls))
    assert client.portal.call(send_pending, async_db_session, None, up) == 1
    assert _queued_rows(client, async_db_session) == []
    assert ("POST", "api.github.com", "/repos/o/r/issues") in calls


def test_no_token_leaves_the_queue_alone(client, async_db_session, monkeypatch):
    monkeypatch.delenv("FEEDBACK_GITHUB_TOKEN", raising=False)
    _queue(client, async_db_session)
    assert client.portal.call(send_pending, async_db_session) == 0
    [row] = _queued_rows(client, async_db_session)
    assert row.attempts == 0
