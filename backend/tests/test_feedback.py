"""Feedback is anonymous unless the sender opts in — the issue body is the only
place identity could leak to GitHub, so that is what these pin down."""
from datetime import date
from types import SimpleNamespace

from app.api.feedback import FeedbackCreate, build_issue

USER = SimpleNamespace(full_name="Siti Rahma", username="siti")


def _issue(include_name):
    payload = FeedbackCreate(message="MO tab freezes\nwhen filtering", page="/manufacturing", include_name=include_name)
    return build_issue(payload, USER, "0.43.0", date(2026, 10, 20))


def test_anonymous_issue_carries_no_identity():
    issue = _issue(False)
    assert "Siti" not in issue["body"] and "siti" not in issue["body"]
    assert issue["title"] == "MO tab freezes"
    assert issue["labels"] == ["feedback", "terras-erp"]
    assert "/manufacturing" in issue["body"] and "0.43.0" in issue["body"]


def test_opt_in_names_sender_without_github_mention():
    body = _issue(True)["body"]
    assert "Siti Rahma (`siti`)" in body
    assert "@siti" not in body


def test_long_first_line_is_cut_for_the_title():
    payload = FeedbackCreate(message="x" * 200)
    title = build_issue(payload, USER, "0.43.0", date(2026, 10, 20))["title"]
    assert len(title) == 80 and title.endswith("…")


def test_unconfigured_server_returns_503(client, auth_headers, monkeypatch):
    monkeypatch.delenv("FEEDBACK_GITHUB_TOKEN", raising=False)
    # A stale tab still sends the old `kind` field; it must not be a 422.
    res = client.post("/api/feedback", json={"kind": "idea", "message": "hi"}, headers=auth_headers)
    assert res.status_code == 503, res.text


def test_requires_login(client):
    res = client.post("/api/feedback", json={"message": "hi"})
    assert res.status_code == 401


# --- Screenshots -------------------------------------------------------------
import asyncio
import base64

import httpx
import pytest

from app.api.feedback import MAX_SHOT_BYTES, decode_screenshot, upload_screenshots

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
JPG = b"\xff\xd8\xff\xe0" + b"\0" * 32


def _b64(data):
    return base64.b64encode(data).decode()


def test_screenshot_type_is_sniffed_from_the_bytes():
    assert decode_screenshot(_b64(PNG))[1] == "png"
    assert decode_screenshot(_b64(JPG))[1] == "jpg"
    for bad in (_b64(b"<svg onload=alert(1)>"), "not base64!", _b64(b"\x89PNG" + b"\0" * MAX_SHOT_BYTES)):
        with pytest.raises(ValueError):
            decode_screenshot(bad)


def test_screenshots_show_inline_above_the_context():
    payload = FeedbackCreate(message="Save fails")
    body = build_issue(payload, USER, "0.43.0", date(2026, 10, 20), ["https://x/a.png", "https://x/b.png"])["body"]
    assert "![screenshot 1](https://x/a.png)" in body and "![screenshot 2](https://x/b.png)" in body
    assert body.index("![screenshot 2]") < body.index("---")


def test_too_many_or_bad_screenshots_are_rejected(client, auth_headers, monkeypatch):
    monkeypatch.delenv("FEEDBACK_GITHUB_TOKEN", raising=False)
    four = {"message": "hi", "screenshots": [_b64(PNG)] * 4}
    assert client.post("/api/feedback", json=four, headers=auth_headers).status_code == 422
    # Checked before the configuration, so a bad file is a 422, not a 503.
    bad = {"message": "hi", "screenshots": [_b64(b"GIF89a")]}
    res = client.post("/api/feedback", json=bad, headers=auth_headers)
    assert res.status_code == 422 and "PNG" in res.text


def test_upload_creates_the_release_once_then_uploads_each_asset():
    calls = []

    def github(request):
        calls.append((request.method, request.url.host, request.url.path))
        if request.url.path.endswith("/releases/tags/screenshots"):
            return httpx.Response(404)
        if request.url.path.endswith("/releases"):
            return httpx.Response(201, json={"id": 7})
        name = request.url.params["name"]
        assert request.headers["content-type"] == "image/png" and request.content == PNG
        return httpx.Response(201, json={"browser_download_url": f"https://github.com/o/r/releases/download/screenshots/{name}"})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(github)) as c:
            return await upload_screenshots(c, "o/r", {}, [(PNG, "png"), (PNG, "png")], date(2026, 10, 21))

    urls = asyncio.run(run())
    assert len(urls) == 2 and all(u.startswith("https://github.com/o/r/releases/download/screenshots/2026-10-21-") for u in urls)
    assert [c[0] for c in calls] == ["GET", "POST", "POST", "POST"]
    assert calls[2][1] == "uploads.github.com" and calls[2][2] == "/repos/o/r/releases/7/assets"
