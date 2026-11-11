"""Stock On-Hand restates a greige qty in yards when the item has a g/y, and the
Excel export carries that figure plus the carton's alt unit."""
import io
import uuid

from openpyxl import load_workbook

from tests.test_stock_lot_spill import _seed_location


def test_greige_row_and_export_carry_yards(client, auth_headers):
    t = uuid.uuid4().hex[:6].upper()
    _seed_location("SOHY-LOC")
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    client.post("/api/uoms", json={"name": "pcs"}, headers=auth_headers)
    greige = client.post("/api/items", json={"code": f"SOHY-G-{t}", "name": "Greige", "uom": "kg",
                                             "weight_per_unit": 200, "weight_unit": "g/y"}, headers=auth_headers).json()
    plain = client.post("/api/items", json={"code": f"SOHY-P-{t}", "name": "Plain", "uom": "pcs"},
                        headers=auth_headers).json()
    for code, qty in ((greige["code"], 4), (plain["code"], 3)):
        r = client.post("/api/stock", json={"item_code": code, "location_code": "SOHY-LOC", "qty": qty},
                        headers=auth_headers)
        assert r.status_code == 201, r.text

    rows = client.get("/api/stock/balance/paginated", params={"search": f"SOHY-"}, headers=auth_headers).json()["items"]
    by_code = {r["item_code"]: r for r in rows if r["item_code"].endswith(t)}
    assert by_code[greige["code"]]["qty_yards"] == 20  # 4 kg at 200 g/y
    assert by_code[plain["code"]]["qty_yards"] is None

    res = client.get("/api/stock/balance/export", params={"search": greige["code"]}, headers=auth_headers)
    assert res.status_code == 200, res.text
    ws = load_workbook(io.BytesIO(res.content)).active
    cells = list(ws.iter_rows(values_only=True))
    header = next(r for r in cells if r and "Yards" in r)
    data = next(r for r in cells if r and r[0] == greige["code"])
    assert data[header.index("Yards")] == 20
    assert "Alt UOM" in header and "Per Alt Unit" in header
