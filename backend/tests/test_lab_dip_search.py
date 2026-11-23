"""Lab dip list search reaches past the request header: dip colours, items and variant codes."""
import uuid


def test_lab_dip_search_matches_colour_item_and_variant(client, auth_headers):
    sfx = uuid.uuid4().hex[:6].upper()
    items = [client.post("/api/items", json={"code": f"LDS{i}-{sfx}", "name": f"Lds {i}", "uom": "KG"},
                         headers=auth_headers).json()["id"] for i in range(2)]
    req = client.post("/api/lab-dips", json={"kind": "FG", "items": [
        {"item_id": items[0], "order": 0, "dips": [{"color_name": f"NAVY-{sfx}"}]},
        {"item_id": items[1], "order": 1},
    ]}, headers=auth_headers)
    assert req.status_code == 200, req.text
    code = req.json()["code"]
    seq = code.rsplit("-", 1)[-1]

    def hits(term):
        r = client.get("/api/lab-dips", params={"search": term}, headers=auth_headers)
        assert r.status_code == 200, r.text
        return [x["code"] for x in r.json()["items"]]

    assert code in hits(f"navy-{sfx}")        # dip colour name
    assert code in hits(f"LDS1-{sfx}")        # second item's code
    assert code in hits(f"{seq}-B")           # derived variant code of the second item
    assert code not in hits(f"{seq}-C")       # no third variant
