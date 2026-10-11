"""A shade lab-dipped outside the system can be linked straight to its item on create,
and the Color Codes list then shows and filters by that item like an approval-minted one."""
import uuid


def test_color_created_with_direct_item_link(client, auth_headers):
    tag = uuid.uuid4().hex[:8]
    item = client.post("/api/items", json={"code": f"FG-EXT-{tag}", "name": f"Polo Ext {tag}", "uom": "pcs"}, headers=auth_headers)
    assert item.status_code == 200, item.text
    item_id = item.json()["id"]

    color = client.post("/api/colors", json={"code": f"EXT-{tag}", "name": "Navy", "item_id": item_id}, headers=auth_headers)
    assert color.status_code == 200, color.text
    assert color.json()["item_id"] == item_id
    assert color.json()["source_item_name"] == f"Polo Ext {tag}"

    rows = client.get("/api/colors", params={"item_search": f"FG-EXT-{tag}", "include_meta": "true"}, headers=auth_headers).json()["items"]
    assert [r["code"] for r in rows] == [f"EXT-{tag}"]

    # Clearing the link on edit drops it from the item filter.
    cleared = client.put(f"/api/colors/{color.json()['id']}", json={"item_id": None}, headers=auth_headers)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["item_id"] is None
    rows = client.get("/api/colors", params={"item_search": f"FG-EXT-{tag}"}, headers=auth_headers).json()["items"]
    assert rows == []
