"""Editing an item back to None/blank must actually clear the field.

update_item used to skip every null, so Color/Combo -> None (and clearing a
default location or min stock) silently kept the old value.
"""
import uuid


def test_item_edit_clears_variant_type_and_nullable_fields(client, auth_headers):
    tag = uuid.uuid4().hex[:8]
    res = client.post(
        "/api/items",
        json={"code": f"FG-CLR-{tag}", "name": f"Clear {tag}", "uom": "pcs",
              "variant_type": "combo", "min_stock_level": 5},
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    item = res.json()
    assert item["variant_type"] == "combo"
    combo_attr_ids = item["attribute_ids"]
    assert combo_attr_ids, "combo items are bound to the Combo system attribute"

    # The edit form re-sends the attribute_ids it loaded, combo attr included.
    res = client.put(
        f"/api/items/{item['id']}",
        json={"variant_type": None, "min_stock_level": None, "attribute_ids": combo_attr_ids},
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["variant_type"] is None
    assert body["min_stock_level"] is None
    assert body["attribute_ids"] == [], "leaving combo must unbind the Combo attribute"

    # A null on a NOT NULL column is ignored rather than 500ing the update.
    res = client.put(f"/api/items/{item['id']}", json={"name": None}, headers=auth_headers)
    assert res.status_code == 200, res.text
    assert res.json()["name"] == f"Clear {tag}"
