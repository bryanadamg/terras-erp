"""The bath is configured on the dyeing run, and nowhere else.

A dyeing WO is cut with the same fields as any other — no volume, no rope count.
It seeds run #1 carrying only the recipe its gate matched, and everything that
describes the bath (litres, ropes, speed, load) is typed on that run in Dyeing
Orders, by the operator standing at the vessel. The work order log records kg of
output and nothing else.

Two invariants this file exists to hold:

- filling in a volume IS filling the bath: `PATCH /dyeing-runs/{id}` moves the run
  to IN_PROGRESS and freezes its dose sheet, the same act `/start` performs from the
  monitor's phase button.
- the frozen sheet is not a ceiling: a corrected bath re-prices every row nobody has
  weighed against yet, and none of the rows they have.
"""
import uuid


def _setup(client, auth_headers, session, *, liquor_ratio, wo_qty=100.0):
    """A DYEING work order created through the real recipe gate. Returns (wo_id, run)."""
    from app.models.location import Location
    from app.models.routing import WorkCenter

    tag = str(uuid.uuid4())[:8]
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)

    loc = Location(code=f"WH-BP-{tag}", name="Dyehouse Store")
    wc = WorkCenter(code=f"DYE-BP-{tag}", name="Jet BP", center_type="DYEING", node_type="MACHINE")

    async def _seed():
        session.add_all([loc, wc])
        await session.flush()
        return str(loc.id), str(wc.id)

    loc_id, wc_id = client.portal.call(_seed)

    # A Color Library shade is the modern match path: recipe.color_id == mo.color_id.
    color = client.post("/api/colors", json={"code": f"CLR-{tag}", "name": "Navy BP"}, headers=auth_headers)
    assert color.status_code == 200, color.text
    color_id = color.json()["id"]

    # One g/L line (dose follows the bath) and one owf line (dose follows the load),
    # so the test can tell which basis moved when the bath changes.
    chem = client.post("/api/items", json={"code": f"CHEM-GL-{tag}", "name": "Levelling Agent", "uom": "kg"}, headers=auth_headers)
    owf = client.post("/api/items", json={"code": f"CHEM-OWF-{tag}", "name": "Navy Dyestuff", "uom": "kg"}, headers=auth_headers)
    recipe = client.post("/api/dye-recipes", json={
        "code": f"DR-{tag}", "name": "Navy BP", "color_id": color_id,
        "liquor_ratio": liquor_ratio,
        "lines": [
            {"item_id": chem.json()["id"], "qty_per_liter": 2.0, "qty_per_100kg": None, "sort_order": 1},
            {"item_id": owf.json()["id"], "qty_per_100kg": 3.0, "qty_per_liter": None, "sort_order": 2},
        ],
    }, headers=auth_headers)
    assert recipe.status_code == 200, recipe.text

    client.post("/api/items", json={"code": f"BP-FG-{tag}", "name": "Dyed Fabric", "uom": "kg"}, headers=auth_headers)
    client.post("/api/items", json={"code": f"BP-RM-{tag}", "name": "Greige", "uom": "kg"}, headers=auth_headers)
    client.post("/api/boms", json={
        "code": f"BOM-BP-{tag}", "item_code": f"BP-FG-{tag}", "qty": 1,
        "lines": [{"item_code": f"BP-RM-{tag}", "qty": 1, "percentage": 100.0}],
    }, headers=auth_headers)
    bom = next(b for b in client.get("/api/boms", headers=auth_headers).json() if b["code"] == f"BOM-BP-{tag}")

    mo = client.post("/api/manufacturing-orders", json={
        "code": f"MO-BP-{tag}", "bom_id": bom["id"], "qty": wo_qty,
        "location_code": f"WH-BP-{tag}", "source_location_code": f"WH-BP-{tag}",
    }, headers=auth_headers)
    assert mo.status_code == 200, mo.text
    mo_id = mo.json()["id"]
    res = client.patch(f"/api/manufacturing-orders/{mo_id}/color", json={"color_id": color_id}, headers=auth_headers)
    assert res.status_code == 200, res.text

    wo = client.post("/api/work-orders", json={
        "manufacturing_order_id": mo_id, "qty": wo_qty, "work_center_id": wc_id,
        "input_location_id": loc_id, "output_location_id": loc_id,
    }, headers=auth_headers)
    assert wo.status_code == 200, wo.text
    wo_id = wo.json()["id"]

    runs = client.get(f"/api/dyeing-runs?work_order_id={wo_id}", headers=auth_headers)
    assert runs.status_code == 200, runs.text
    rows = runs.json()
    assert len(rows) == 1
    return wo_id, rows[0]


def _configure(client, auth_headers, run_id, **fields):
    res = client.patch(f"/api/dyeing-runs/{run_id}", json=fields, headers=auth_headers)
    assert res.status_code == 200, res.text
    return res.json()


def test_wo_creation_cuts_a_bare_run(client, auth_headers, async_db_session):
    """The WO knows the recipe and the load. It knows nothing about the bath."""
    _wo_id, run = _setup(client, auth_headers, async_db_session, liquor_ratio=8)

    assert run["recipe_id"] is not None
    assert float(run["substrate_qty"]) == 100.0
    assert run["volume_air_liters"] is None
    assert run["planned_volume_air_liters"] is None
    assert run["effective_bath_liters"] is None
    assert run["chemicals"] == []
    assert run["started_at"] is None
    assert run["status"] == "PENDING"


def test_configuring_the_bath_freezes_the_sheet_and_runs_the_vessel(client, auth_headers, async_db_session):
    """One call from the setup screen: the bath is filled, both bases are weighed."""
    _wo_id, run = _setup(client, auth_headers, async_db_session, liquor_ratio=8)

    body = _configure(client, auth_headers, run["id"], volume_air_liters=800, lines=3, yards_per_min=250)

    assert float(body["volume_air_liters"]) == 800.0
    assert float(body["effective_bath_liters"]) == 800.0
    assert body["status"] == "IN_PROGRESS"
    # Ropes and speed are the monitor's rate, typed here with the rest of the setup.
    assert body["lines"] == 3
    assert float(body["yards_per_min"]) == 250.0
    doses = {c["item_name"]: float(c["planned_qty"]) for c in body["chemicals"]}
    assert doses["Levelling Agent"] == 1600.0   # 2 g/L x 800 L
    assert doses["Navy Dyestuff"] == 3.0        # 3 per 100 kg x 100 kg
    assert all(float(c["actual_qty"]) == 0 for c in body["chemicals"])


def test_a_liquor_ratio_resolves_the_volume(client, auth_headers, async_db_session):
    """Ratio and volume are one fact twice — sending either settles the pair."""
    _wo_id, run = _setup(client, auth_headers, async_db_session, liquor_ratio=8)

    body = _configure(client, auth_headers, run["id"], liquor_ratio=5)

    assert float(body["volume_air_liters"]) == 500.0   # 5 L/kg x 100 kg
    assert float(body["liquor_ratio"]) == 5.0
    doses = {c["item_name"]: float(c["planned_qty"]) for c in body["chemicals"]}
    assert doses["Levelling Agent"] == 1000.0
    assert doses["Navy Dyestuff"] == 3.0


def test_a_run_with_no_bath_has_nothing_to_weigh(client, auth_headers, async_db_session):
    """Configuring the ropes alone is not filling the bath."""
    _wo_id, run = _setup(client, auth_headers, async_db_session, liquor_ratio=None)

    body = _configure(client, auth_headers, run["id"], lines=2)

    assert body["lines"] == 2
    assert body["volume_air_liters"] is None
    assert body["chemicals"] == []
    assert body["status"] == "PENDING"


def test_a_corrected_bath_reprices_the_sheet(client, auth_headers, async_db_session):
    """The vessel took 900 L, not the 800 that was set up. Every g/L row follows the
    water; the owf row does not."""
    _wo_id, run = _setup(client, auth_headers, async_db_session, liquor_ratio=8)
    _configure(client, auth_headers, run["id"], volume_air_liters=800)

    body = _configure(client, auth_headers, run["id"], volume_air_liters=900)

    assert float(body["volume_air_liters"]) == 900.0
    doses = {c["item_name"]: float(c["planned_qty"]) for c in body["chemicals"]}
    assert doses["Levelling Agent"] == 1800.0   # 2 g/L x 900 L
    assert doses["Navy Dyestuff"] == 3.0


def test_a_recorded_dose_is_never_repriced(client, auth_headers, async_db_session):
    """Once a chemical is in the vessel, rewriting its plan would erase the variance."""
    _wo_id, run = _setup(client, auth_headers, async_db_session, liquor_ratio=8)
    body = _configure(client, auth_headers, run["id"], volume_air_liters=800)
    gl_row = next(c for c in body["chemicals"] if c["item_name"] == "Levelling Agent")

    res = client.patch(f"/api/dyeing-runs/{run['id']}/chemicals", json={
        "chemicals": [{"item_id": gl_row["item_id"], "actual_qty": 1550}],
    }, headers=auth_headers)
    assert res.status_code == 200, res.text

    body = _configure(client, auth_headers, run["id"], volume_air_liters=900)
    row = next(c for c in body["chemicals"] if c["item_name"] == "Levelling Agent")
    assert float(row["actual_qty"]) == 1550.0
    assert float(row["planned_qty"]) == 1600.0   # still the 800 L bath it was weighed against
