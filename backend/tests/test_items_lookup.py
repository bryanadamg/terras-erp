"""/items/lookup is the whole-catalog index screens fall back to for off-page items."""
import uuid


def test_lookup_carries_sample_lineage_and_keeps_items_without_one(client, auth_headers):
    client.post("/api/uoms", json={"name": "pcs"}, headers=auth_headers)
    code = f"LK-{uuid.uuid4().hex[:6]}"
    client.post("/api/items", json={"code": code, "name": "Lk", "uom": "pcs"}, headers=auth_headers)

    res = client.get("/api/items/lookup", headers=auth_headers)
    assert res.status_code == 200, res.text
    row = next(r for r in res.json() if r["code"] == code)  # outer joins keep sample-less items
    assert row["source_sample_code"] is None
    assert row["source_color_name"] is None
