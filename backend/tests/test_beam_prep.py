"""Warp prep (drawing-in / tying-in) is recorded on every beam mount and summed per
operator — it is paid per end, so a mount that skips it drops someone's pay."""
import uuid


def _seed_beam(client, async_db_session):
    from app.models.batch import Batch
    from app.models.item import Item
    from app.models.location import Location
    from app.models.routing import WorkCenter
    from app.models.stock_balance import StockBalance

    tag = str(uuid.uuid4())[:8]

    async def _seed():
        item = Item(code=f"BEAM-{tag}", name="Warp beam", uom="kg", ends=3200)
        store = Location(code=f"ST-{tag}", name="Beam store")
        line = Location(code=f"LN-{tag}", name="Loom supply")
        async_db_session.add_all([item, store, line])
        await async_db_session.flush()
        loom = WorkCenter(code=f"LM-{tag}", name="Loom", center_type="WEAVING",
                          node_type="MACHINE", input_location_id=line.id)
        beam = Batch(batch_number=f"BM-{tag}", item_id=item.id, ends=3200)
        async_db_session.add_all([loom, beam])
        await async_db_session.flush()
        async_db_session.add(StockBalance(item_id=item.id, location_id=store.id, variant_key="",
                                          batch_key=str(beam.id), qty=50))
        await async_db_session.flush()
        return str(loom.id), str(beam.id)

    return client.portal.call(_seed)


def _report_row(client, headers, key):
    rows = client.get("/api/reports/beam-prep-output", headers=headers).json()["rows"]
    return next(r for r in rows if r["operator_key"] == key)


def test_mount_requires_prep_and_report_sums_it_per_operator(client, auth_headers, async_db_session):
    loom_id, beam_id = _seed_beam(client, async_db_session)
    url = f"/api/work-centers/{loom_id}/beam-mounts"

    res = client.post(url, json={"batch_id": beam_id}, headers=auth_headers)
    assert res.status_code == 422, res.text

    # A floor worker with no login: typed name only.
    res = client.post(url, json={"batch_id": beam_id, "prep": {
        "prep_type": "TYING_IN", "ends": 3100, "operator": "Pak Udin",
    }}, headers=auth_headers)
    assert res.status_code == 200, res.text
    mount = res.json()
    assert (mount["prep_type"], mount["prep_ends"], mount["prep_operator"]) == ("TYING_IN", 3100, "Pak Udin")

    row = _report_row(client, auth_headers, "name:pak udin")
    assert row["has_account"] is False
    assert (row["tying_in_ends"], row["draw_in_ends"], row["beams"]) == (3100, 0, 1)

    # Supervisor correction: re-pegged to an account, as drawing-in.
    op = client.get("/api/users/operators", headers=auth_headers).json()[0]
    res = client.patch(f"/api/beam-mounts/{mount['id']}/prep", json={
        "prep_type": "DRAW_IN", "ends": 3200, "operator_user_id": op["id"],
    }, headers=auth_headers)
    assert res.status_code == 200, res.text
    assert res.json()["prep_operator"] == (op["full_name"] or op["username"])

    row = _report_row(client, auth_headers, op["id"])
    assert row["has_account"] is True
    assert row["draw_in_ends"] >= 3200
    rows = client.get("/api/reports/beam-prep-output", headers=auth_headers).json()["rows"]
    assert not any(r["operator_key"] == "name:pak udin" for r in rows)


def test_prep_rejects_zero_ends_and_unknown_type(client, auth_headers, async_db_session):
    loom_id, beam_id = _seed_beam(client, async_db_session)
    url = f"/api/work-centers/{loom_id}/beam-mounts"
    for prep in ({"prep_type": "DRAW_IN", "ends": 0, "operator": "A"},
                 {"prep_type": "KNOT", "ends": 10, "operator": "A"},
                 {"prep_type": "DRAW_IN", "ends": 10}):
        res = client.post(url, json={"batch_id": beam_id, "prep": prep}, headers=auth_headers)
        assert res.status_code == 422, (prep, res.text)
