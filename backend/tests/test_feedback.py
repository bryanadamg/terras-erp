"""Feedback is anonymous unless the sender opts in — the issue body is the only
place identity could leak to GitHub, so that is what these pin down."""
from datetime import date
from types import SimpleNamespace

from app.api.feedback import FeedbackCreate, build_issue

USER = SimpleNamespace(full_name="Siti Rahma", username="siti")


def _issue(include_name):
    payload = FeedbackCreate(kind="bug", message="MO tab freezes\nwhen filtering", page="/manufacturing", include_name=include_name)
    return build_issue(payload, USER, "0.43.0", date(2026, 10, 20))


def test_anonymous_issue_carries_no_identity():
    issue = _issue(False)
    assert "Siti" not in issue["body"] and "siti" not in issue["body"]
    assert issue["title"] == "[bug] MO tab freezes"
    assert issue["labels"] == ["feedback", "bug"]
    assert "/manufacturing" in issue["body"] and "0.43.0" in issue["body"]


def test_opt_in_names_sender_without_github_mention():
    body = _issue(True)["body"]
    assert "Siti Rahma (`siti`)" in body
    assert "@siti" not in body


def test_unconfigured_server_returns_503(client, auth_headers, monkeypatch):
    monkeypatch.delenv("FEEDBACK_GITHUB_TOKEN", raising=False)
    res = client.post("/api/feedback", json={"kind": "idea", "message": "hi"}, headers=auth_headers)
    assert res.status_code == 503, res.text


def test_requires_login(client):
    res = client.post("/api/feedback", json={"kind": "idea", "message": "hi"})
    assert res.status_code == 401
