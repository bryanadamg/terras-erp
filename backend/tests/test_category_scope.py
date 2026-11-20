"""Role category scope: a top-level pick covers its sub-categories, and scopes what
the role sees as well as what it may change."""
import uuid


def test_level1_scope_covers_children_and_filters_reads(user_factory, client, auth_headers):
    sfx = uuid.uuid4().hex[:6].upper()
    h = auth_headers
    client.post("/api/uoms", json={"name": "kg"}, headers=h)
    root = client.post("/api/categories", json={"name": f"SC-R-{sfx}"}, headers=h).json()
    child = client.post("/api/categories", json={"name": f"SC-C-{sfx}", "parent_id": root["id"]}, headers=h).json()
    other = client.post("/api/categories", json={"name": f"SC-O-{sfx}"}, headers=h).json()
    mine = client.post("/api/items", json={"code": f"SC-M-{sfx}", "name": "mine", "uom": "kg", "category_id": child["id"]}, headers=h).json()
    theirs = client.post("/api/items", json={"code": f"SC-T-{sfx}", "name": "theirs", "uom": "kg", "category_id": other["id"]}, headers=h).json()

    _, sh = user_factory(["item.view", "item.edit", "stock_on_hand.view"], "scoped", allowed_categories=[root["id"]])

    codes = {i["code"] for i in client.get("/api/items", params={"search": sfx}, headers=sh).json()["items"]}
    assert codes == {mine["code"]}

    ok = client.put(f"/api/items/{mine['id']}", json={"name": "mine 2"}, headers=sh)
    assert ok.status_code == 200, ok.text
    assert client.put(f"/api/items/{theirs['id']}", json={"name": "x"}, headers=sh).status_code == 403
