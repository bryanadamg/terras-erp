import pytest
from app.models.auth import User, Role
from app.core.security import create_access_token, get_password_hash


@pytest.fixture
def admin_user(db_session):
    role = db_session.query(Role).filter(Role.name == "Administrator").first()
    if not role:
        role = Role(name="Administrator")
        db_session.add(role)
        db_session.commit()
        db_session.refresh(role)

    user = User(
        username="admin_test",
        full_name="Admin Test",
        hashed_password=get_password_hash("adminpass"),
        role_id=role.id,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def admin_headers(admin_user):
    token = create_access_token(subject=admin_user.id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def regular_user(db_session):
    user = User(
        username="regular_test",
        full_name="Regular Test",
        hashed_password=get_password_hash("regularpass"),
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def regular_headers(regular_user):
    token = create_access_token(subject=regular_user.id)
    return {"Authorization": f"Bearer {token}"}


def test_admin_can_create_user(client, admin_headers):
    res = client.post("/api/users", json={
        "username": "newbie",
        "full_name": "New Bie",
        "password": "secret123",
        "role_id": None,
    }, headers=admin_headers)
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["username"] == "newbie"
    assert data["is_active"] is True


def test_non_admin_cannot_create_user(client, regular_headers):
    res = client.post("/api/users", json={
        "username": "sneaky",
        "full_name": "Sneaky User",
        "password": "secret123",
    }, headers=regular_headers)
    assert res.status_code == 403


def test_create_user_duplicate_username(client, admin_headers, admin_user):
    res = client.post("/api/users", json={
        "username": admin_user.username,
        "full_name": "Dup",
        "password": "secret123",
    }, headers=admin_headers)
    assert res.status_code == 400


def test_deactivated_user_cannot_login(client, admin_headers, db_session):
    create_res = client.post("/api/users", json={
        "username": "todeactivate",
        "full_name": "To Deactivate",
        "password": "secret123",
    }, headers=admin_headers)
    user_id = create_res.json()["id"]

    deact_res = client.post(f"/api/users/{user_id}/deactivate", headers=admin_headers)
    assert deact_res.status_code == 200
    assert deact_res.json()["is_active"] is False

    login_res = client.post("/api/token", data={"username": "todeactivate", "password": "secret123"})
    assert login_res.status_code == 401

    reactivate_res = client.post(f"/api/users/{user_id}/reactivate", headers=admin_headers)
    assert reactivate_res.status_code == 200
    assert reactivate_res.json()["is_active"] is True


def test_cannot_deactivate_last_active_administrator(client, admin_headers, admin_user):
    res = client.post(f"/api/users/{admin_user.id}/deactivate", headers=admin_headers)
    assert res.status_code == 400


def test_cannot_demote_last_active_administrator(client, admin_headers, admin_user, db_session):
    # Not "Operator" — that name is seeded (see init_db.seed_rbac) and this
    # only needs some non-Administrator role to attempt the demotion into.
    other_role = Role(name="Non-Admin Test Role")
    db_session.add(other_role)
    db_session.commit()
    db_session.refresh(other_role)

    # seed_rbac also seeds a real "admin" user with the Administrator role —
    # deactivate it so admin_user really is the last active admin, matching
    # what this test means to exercise.
    admin_role = db_session.query(Role).filter(Role.name == "Administrator").first()
    (
        db_session.query(User)
        .filter(User.role_id == admin_role.id, User.id != admin_user.id)
        .update({"is_active": False}, synchronize_session=False)
    )
    db_session.commit()

    res = client.put(f"/api/users/{admin_user.id}", json={"role_id": str(other_role.id)}, headers=admin_headers)
    assert res.status_code == 400


def test_non_admin_cannot_edit_other_user(client, regular_headers, admin_user):
    res = client.put(f"/api/users/{admin_user.id}", json={"full_name": "Hacked"}, headers=regular_headers)
    assert res.status_code == 403


def test_non_admin_cannot_self_promote(client, regular_headers, regular_user, admin_user):
    res = client.put(f"/api/users/{regular_user.id}", json={"role_id": str(admin_user.role_id)}, headers=regular_headers)
    assert res.status_code == 403


def test_non_admin_can_update_own_profile(client, regular_headers, regular_user):
    res = client.put(f"/api/users/{regular_user.id}", json={"full_name": "Updated Name"}, headers=regular_headers)
    assert res.status_code == 200
    assert res.json()["full_name"] == "Updated Name"


def test_self_password_change_needs_the_current_password(client, regular_headers, regular_user):
    url = f"/api/users/{regular_user.id}"
    assert client.put(url, json={"password": "newpass1"}, headers=regular_headers).status_code == 400
    assert client.put(url, json={"password": "newpass1", "current_password": "wrong"}, headers=regular_headers).status_code == 400
    ok = client.put(url, json={"password": "newpass1", "current_password": "regularpass"}, headers=regular_headers)
    assert ok.status_code == 200, ok.text
