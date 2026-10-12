"""A packing order raised against a sized SO line packs that size only.

PCK-00014 on prod: the pack form's FIFO default preselected an older L lot for an
XL order, and the server took it — the L carton counted toward the order's target
yet could never ship on the XL line. Lots with no size, and orders packing to
stock, stay unrestricted.
"""
import uuid

import pytest

from tests.test_packing_lot_lock import _seed_locations, _box


@pytest.fixture
def sized(client, auth_headers):
    sfx = uuid.uuid4().hex[:6].upper()
    _seed_locations("SZG-SRC", "SZG-OUT")
    locs = {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={
        "code": f"SZG-{sfx}", "name": "Size gate FG", "uom": "kg", "lot_tracked": True,
    }, headers=auth_headers).json()
    sizes = client.get("/api/sizes", headers=auth_headers).json()
    assert len(sizes) >= 2, "needs two seeded sizes"
    ordered, other = sizes[0], sizes[1]

    def _lot(size):
        r = client.post("/api/batches", json={
            "item_id": item["id"], "qty": 10, "location_id": locs["SZG-SRC"], "size_id": size["id"],
        }, headers=auth_headers)
        assert r.status_code == 200, r.text
        return r.json()

    so = client.post("/api/sales-orders", json={
        "po_number": f"PO-SZG-{sfx}", "customer_name": "Size Gate",
        "order_date": "2026-10-12T00:00:00",
        "lines": [{"item_id": item["id"], "qty": 20, "qty_kg": 20, "size_id": ordered["id"],
                   "due_date": "2026-11-01T00:00:00", "attribute_value_ids": []}],
    }, headers=auth_headers)
    assert so.status_code == 200, so.text
    so = so.json()

    def _order(locked=()):
        return client.post("/api/packing", json={
            "item_id": item["id"], "qty_target": 20,
            "sales_order_id": so["id"], "sales_order_line_id": so["lines"][0]["id"],
            "source_location_id": locs["SZG-SRC"], "output_location_id": locs["SZG-OUT"],
            "locked_batch_ids": list(locked),
        }, headers=auth_headers)

    return {"right": _lot(ordered), "wrong": _lot(other), "order": _order,
            "box": _box(client, auth_headers), "ordered": ordered, "other": other}


def _pack(client, auth_headers, po, lot, box):
    return client.post(f"/api/packing/{po['id']}/complete", json={
        "lots": [{"batch_id": lot["id"], "qty": 5}],
        "boxes": [5], "box_packaging_type_ids": [box],
    }, headers=auth_headers)


def test_a_lot_of_another_size_is_refused(client, auth_headers, sized):
    po = sized["order"]().json()
    assert po["size_label"] == sized["ordered"]["name"]
    res = _pack(client, auth_headers, po, sized["wrong"], sized["box"])
    assert res.status_code == 400, res.text
    assert sized["wrong"]["batch_number"] in res.json()["detail"]


def test_a_lot_of_the_ordered_size_packs(client, auth_headers, sized):
    po = sized["order"]().json()
    res = _pack(client, auth_headers, po, sized["right"], sized["box"])
    assert res.status_code == 200, res.text


def test_an_order_cannot_claim_a_lot_of_another_size(client, auth_headers, sized):
    res = sized["order"]([sized["wrong"]["id"]])
    assert res.status_code == 400, res.text
    assert "size" in res.json()["detail"]


def test_the_lot_picker_reports_which_order_holds_a_lot(client, auth_headers, sized):
    po = sized["order"]([sized["right"]["id"]]).json()
    lots = client.get(
        f"/api/batches?item_id={sized['right']['item_id']}&for_packing_order_id={po['id']}",
        headers=auth_headers).json()
    held = next(b for b in lots if b["id"] == sized["right"]["id"])
    assert held["locked_packing_order_id"] == po["id"]


# --- pick list → dispatch: a carton only goes out on a line ordering its size --

@pytest.fixture
def cartons(client, auth_headers, sized):
    """One carton of the ordered size (packed against the SO line) and one of the
    other size (packed to stock — no SO line, so the pack gate lets it through)."""
    on_line = sized["order"]().json()
    res = _pack(client, auth_headers, on_line, sized["right"], sized["box"])
    assert res.status_code == 200, res.text
    right = res.json()["packed_units"][0]

    to_stock = client.post("/api/packing", json={
        "item_id": sized["right"]["item_id"], "qty_target": 5,
        "source_location_id": on_line["source_location_id"],
        "output_location_id": on_line["output_location_id"],
    }, headers=auth_headers).json()
    res = _pack(client, auth_headers, to_stock, sized["wrong"], sized["box"])
    assert res.status_code == 200, res.text
    wrong = res.json()["packed_units"][0]
    return {"so_id": on_line["sales_order_id"], "line_id": on_line["sales_order_line_id"],
            "item_id": on_line["item_id"], "right": right, "wrong": wrong}


def test_suggestions_skip_cartons_of_another_size(client, auth_headers, cartons):
    groups = client.get(f"/api/pick-lists/suggest?sales_order_id={cartons['so_id']}",
                        headers=auth_headers).json()
    suggested = {c["batch_id"] for g in groups for c in g["cartons"]}
    assert cartons["right"]["id"] in suggested
    assert cartons["wrong"]["id"] not in suggested


def test_a_pick_list_cannot_put_a_carton_on_a_line_of_another_size(client, auth_headers, cartons):
    res = client.post("/api/pick-lists", json={
        "sales_order_id": cartons["so_id"],
        "lines": [{"sales_order_line_id": cartons["line_id"], "item_id": cartons["item_id"],
                   "qty_picked": 5, "batch_id": cartons["wrong"]["id"]}],
    }, headers=auth_headers)
    assert res.status_code == 400, res.text
    assert cartons["wrong"]["batch_number"] in res.json()["detail"]


def test_scanning_a_carton_of_another_size_is_refused(client, auth_headers, cartons):
    pl = client.post("/api/pick-lists", json={"sales_order_id": cartons["so_id"]}, headers=auth_headers)
    assert pl.status_code == 200, pl.text
    res = client.post(f"/api/pick-lists/{pl.json()['id']}/scan",
                      json={"code": cartons["wrong"]["batch_number"]}, headers=auth_headers)
    assert res.status_code == 400, res.text
    assert "size" in res.json()["detail"]
