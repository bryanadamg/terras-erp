"""Per-user UI preferences: one row per (user, key), and one user's row is not
another's.

The route has no permission gate — it is keyed on `current_user` — so the only
thing standing between two users' saved layouts is that WHERE clause.
"""


def test_upsert_creates_then_overwrites_the_same_key(client, auth_headers):
    res = client.put("/api/preferences/table.columns", json={"value": ["a", "b"]}, headers=auth_headers)
    assert res.status_code == 200, res.text
    assert res.json()["value"] == ["a", "b"]

    # Second save is an update, not a second row — a duplicate would make the
    # GET below ambiguous (scalar_one_or_none raises on two matches).
    res = client.put("/api/preferences/table.columns", json={"value": ["c"]}, headers=auth_headers)
    assert res.status_code == 200, res.text

    res = client.get("/api/preferences/table.columns", headers=auth_headers)
    assert res.status_code == 200, res.text
    assert res.json()["value"] == ["c"]


def test_an_unset_key_is_404_not_an_empty_value(client, auth_headers):
    res = client.get("/api/preferences/never.saved.anything", headers=auth_headers)
    assert res.status_code == 404, res.text


def test_one_users_preference_is_not_another_users(client, auth_headers, test_user):
    import uuid as _uuid

    from app.core.security import create_access_token
    from app.db.session import engine
    from app.models.auth import User
    from sqlalchemy.orm import Session

    client.put("/api/preferences/sidebar", json={"value": "wide"}, headers=auth_headers)

    conn = engine.connect()
    sess = Session(conn)
    other = User(
        username=f"prefs-other-{_uuid.uuid4().hex[:6]}",
        full_name="Other",
        hashed_password="hashed_secret",
        role_id=test_user.role_id,
    )
    sess.add(other)
    sess.commit()
    other_headers = {"Authorization": f"Bearer {create_access_token(subject=other.id)}"}
    try:
        res = client.get("/api/preferences/sidebar", headers=other_headers)
        assert res.status_code == 404, res.text
    finally:
        sess.query(User).filter(User.id == other.id).delete(synchronize_session=False)
        sess.commit()
        sess.close()
        conn.close()
