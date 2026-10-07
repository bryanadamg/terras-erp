"""A hand-made lot carries the identity a produced one gets: ends, size, variant."""
import uuid

from app.db.session import engine as _engine
from sqlalchemy.orm import Session as _SASession
from app.models.location import Location
from app.models.attribute import Attribute, AttributeValue


def test_lot_create_with_ends_size_and_variant(client, auth_headers):
    sfx = uuid.uuid4().hex[:6].upper()
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    with _engine.connect() as conn, _SASession(conn) as sess:
        loc = Location(code=f"LCI-{sfx}", name="lci")
        attr = Attribute(name=f"LCI-{sfx}")
        sess.add_all([loc, attr])
        sess.flush()
        val = AttributeValue(attribute_id=attr.id, value="Navy")
        sess.add(val)
        sess.commit()
        loc_id, val_id = str(loc.id), str(val.id)
    item = client.post("/api/items", json={
        "code": f"LCI-{sfx}", "name": "Lci", "uom": "kg", "lot_tracked": True,
    }, headers=auth_headers).json()
    size = client.get("/api/sizes", headers=auth_headers).json()[0]

    body = {"item_id": item["id"], "ends": 4200, "size_id": size["id"],
            "attribute_value_ids": [val_id], "qty": 7, "location_id": loc_id}
    r = client.post("/api/batches", json=body, headers=auth_headers)
    assert r.status_code == 200, r.text
    lot = r.json()
    assert lot["ends"] == 4200
    assert lot["bom_size_snapshot"]["size_name"] == size["name"]
    assert lot["variant_key"] == val_id
    assert lot["remaining"] == 7

    # Variant without qty has no balance row to live on.
    r = client.post("/api/batches", json={"item_id": item["id"], "attribute_value_ids": [val_id]},
                    headers=auth_headers)
    assert r.status_code == 400


def test_stock_entry_books_onto_lot_of_same_item_only(client, auth_headers):
    sfx = uuid.uuid4().hex[:6].upper()
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    with _engine.connect() as conn, _SASession(conn) as sess:
        loc = Location(code=f"LSE-{sfx}", name="lse")
        sess.add(loc)
        sess.commit()
        loc_id = str(loc.id)
    a = client.post("/api/items", json={"code": f"LSE-A-{sfx}", "name": "A", "uom": "kg"}, headers=auth_headers).json()
    b = client.post("/api/items", json={"code": f"LSE-B-{sfx}", "name": "B", "uom": "kg"}, headers=auth_headers).json()
    lot = client.post("/api/batches", json={"item_id": a["id"]}, headers=auth_headers).json()

    entry = {"item_code": a["code"], "location_code": f"LSE-{sfx}", "qty": 3, "batch_id": lot["id"]}
    r = client.post("/api/stock", json=entry, headers=auth_headers)
    assert r.status_code == 201, r.text
    lots = client.get(f"/api/batches?item_id={a['id']}", headers=auth_headers).json()
    assert [l["remaining"] for l in lots if l["id"] == lot["id"]] == [3]

    r = client.post("/api/stock", json={**entry, "item_code": b["code"]}, headers=auth_headers)
    assert r.status_code == 400
