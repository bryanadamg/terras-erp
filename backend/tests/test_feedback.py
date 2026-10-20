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
