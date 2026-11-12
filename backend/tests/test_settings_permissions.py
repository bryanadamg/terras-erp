"""Settings → General is delegated by system_admin.edit, not admin-only."""


def test_company_profile_write_needs_system_admin_edit(user_factory, client, auth_headers):
    _, editor = user_factory(["system_admin.edit"], "settings-editor")
    _, other = user_factory(["item.view"], "no-settings")
    profile = client.get("/api/settings/company", headers=auth_headers).json()
    body = {k: v for k, v in profile.items() if k != "id"}

    assert client.put("/api/settings/company", json=body, headers=other).status_code == 403
    r = client.put("/api/settings/company", json=body, headers=editor)
    assert r.status_code == 200, r.text
