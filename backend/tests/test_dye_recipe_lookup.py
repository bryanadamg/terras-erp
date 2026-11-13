"""Recipe lookups for pickers: a lean summary view, an id filter to resolve a picked
value's label, and the full recipe by id for the Kartu Celup print."""
import uuid


def _recipe(client, auth_headers, tag, suffix):
    chem = client.post("/api/items", json={"code": f"RL-CHEM-{tag}{suffix}", "name": "Levelling", "uom": "kg"},
                       headers=auth_headers).json()
    color = client.post("/api/colors", json={"code": f"RL-{tag}{suffix}", "name": f"Shade {suffix}"},
                        headers=auth_headers).json()
    r = client.post("/api/dye-recipes", json={
        "code": f"DR-RL-{tag}{suffix}", "name": f"Recipe {tag}{suffix}", "color_id": color["id"],
        "lines": [{"item_id": chem["id"], "qty_per_liter": 2.0, "qty_per_100kg": None, "sort_order": 1}],
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_summary_view_carries_only_picker_fields(client, auth_headers):
    tag = uuid.uuid4().hex[:6].upper()
    a = _recipe(client, auth_headers, tag, "A")
    res = client.get(f"/api/dye-recipes?view=summary&search=DR-RL-{tag}A&size=20", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["items"] == [{"id": a["id"], "code": f"DR-RL-{tag}A", "name": f"Recipe {tag}A",
                              "color_id": a["color_id"], "color_code": f"RL-{tag}A", "is_active": True}]


def test_ids_filter_resolves_just_the_asked_recipes(client, auth_headers):
    tag = uuid.uuid4().hex[:6].upper()
    a, b = _recipe(client, auth_headers, tag, "A"), _recipe(client, auth_headers, tag, "B")
    _recipe(client, auth_headers, tag, "C")
    res = client.get(f"/api/dye-recipes?view=summary&size=0&ids={a['id']},{b['id']},not-a-uuid", headers=auth_headers)
    assert sorted(r["code"] for r in res.json()["items"]) == [f"DR-RL-{tag}A", f"DR-RL-{tag}B"]


def test_get_one_recipe_returns_it_whole(client, auth_headers):
    tag = uuid.uuid4().hex[:6].upper()
    a = _recipe(client, auth_headers, tag, "A")
    res = client.get(f"/api/dye-recipes/{a['id']}", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["code"] == f"DR-RL-{tag}A" and len(res.json()["lines"]) == 1
    assert client.get(f"/api/dye-recipes/{uuid.uuid4()}", headers=auth_headers).status_code == 404
