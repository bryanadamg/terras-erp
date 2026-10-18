"""Moving a location keeps the 3-level tree honest.

The move endpoint never re-derived location_type, and its depth guard only
looked one level down: a zone moved to the top stayed typed 'zone' (and fell out
of every picker, which roots on 'warehouse'), and a whole warehouse could be
nested under another one, making a 4-level chain every fixed walk mis-reads.
"""
import uuid


def _mk(client, h, code, parent_id=None):
    r = client.post("/api/locations", json={"code": code, "name": code, "parent_id": parent_id}, headers=h)
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_moves_retype_and_respect_depth(client, auth_headers):
    t = uuid.uuid4().hex[:6].upper()
    wh_a = _mk(client, auth_headers, f"MV-A-{t}")
    wh_b = _mk(client, auth_headers, f"MV-B-{t}")
    zone = _mk(client, auth_headers, f"MV-Z-{t}", wh_a["id"])
    bin_ = _mk(client, auth_headers, f"MV-BIN-{t}", zone["id"])

    # A whole warehouse > zone > bin can't go under another warehouse (4 levels).
    r = client.patch(f"/api/locations/{wh_a['id']}", json={"parent_id": wh_b["id"]}, headers=auth_headers)
    assert r.status_code == 400, r.text

    # A zone with a bin moved to the top becomes a warehouse; its bin becomes a zone.
    r = client.patch(f"/api/locations/{zone['id']}", json={"parent_id": None}, headers=auth_headers)
    assert r.status_code == 200, r.text
    types = {l["id"]: l["location_type"] for l in client.get("/api/locations", headers=auth_headers).json()}
    assert types[zone["id"]] == "warehouse"
    assert types[bin_["id"]] == "zone"
