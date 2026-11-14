"""Legacy migration: crosswalks and transform (pure, no DB unless noted)."""
import csv
import json

import pytest

from app.legacy import crosswalk


def _write_work(tmp_path, tables: dict, last_move=None, last_doc=None):
    t = tmp_path / "tables"
    t.mkdir(parents=True, exist_ok=True)
    for name, rows in tables.items():
        with open(t / f"{name}.jsonl", "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
    (tmp_path / "item_last_move.json").write_text(json.dumps(last_move or {}))
    (tmp_path / "partner_last_doc.json").write_text(json.dumps(last_doc or {}))
    return str(tmp_path)


def _art(code, name="x", group="RM", unit="KG", **kw):
    r = {"Art_nr": code, "Art_name": name, "Art_gruppe": group, "Art_einheit": unit, "Art_adrnr": ""}
    r.update({f"Art_flds{i:02d}": "" for i in range(20)})
    r.update(kw)
    return r


def _li(wh, art, ser="", bin_="", qty=1.0):
    return {"Li_lagnr": wh, "Li_lagfnr": bin_, "Li_artnr": art, "Li_sernr": ser, "Li_stck": qty}


SNAP = {
    "items": {}, "categories": [{"name": "Dye", "parent": ""}, {"name": "ACID DYES", "parent": "Dye"}],
    "locations": {"GM01": {"name": "GUDANG MATERIAL 1", "type": "warehouse", "parent": ""}},
    "partners": ["ABADI JAYA"], "colors": [], "materials": ["NS (NYLON SPANDEX)"],
    "sizes": ["S", "M", "L", "XL", "2XL"], "wash_baths": ["Cuci dingin"], "finishing_steps": [],
    "batch_numbers": [], "uoms": ["kg", "yard", "Pcs"], "bom_items": [],
}


def _csv(work, name):
    with open(f"{work}/crosswalk/{name}") as f:
        return list(csv.DictReader(f))


@pytest.fixture
def work(tmp_path):
    return _write_work(tmp_path, {
        "ww_art": [
            _art("DYN1", "LEVASET RED", group="ACIDDYES"),
            _art("Y1", "YARN", Art_flds00="NS (NYLON SPANDEX)"),
            _art("0070 XXL", "TAPE XXL", group="FG", unit="Yard"),
            _art("LD1", "10346A-1", group="LABDIP", Art_flds11="Cuci dingin", Art_flds19="Chromafix FRD 20g/l"),
            _art("FG1", "9649/16 NS 10346A-1 PNK", group="FG", unit="Yard"),
        ],
        "ww_artg": [{"Artg_nr": "ACIDDYES", "Artg_parent": "DYESTUFF", "Artg_name": "Acid Dyes"},
                    {"Artg_nr": "FG", "Artg_parent": "", "Artg_name": "Finish Good"}],
        "ww_adr": [{"Adr_nr": "K1", "Adr_name": "PT. Abadi Jaya"}, {"Adr_nr": "K2", "Adr_name": "CV Lama"},
                   {"Adr_nr": "K3", "Adr_name": "Baru Sentosa"}],
        "ww_li": [_li("GM01", "Y1", "S1", qty=5), _li("GJ01", "0070 XXL", "S2", "GJ01L3-PIC-2", 3)],
        "ww_set": [{"set_artnr_h": "LD1", "set_artnr_u": "DYN1", "set_nr": "1. Dyes 1", "set_stck": 0.2, "set_stckproz": 0},
                   {"set_artnr_h": "FG1", "set_artnr_u": "LD1", "set_nr": "", "set_stck": 1, "set_stckproz": 0}],
    }, last_move={"DYN1": "2025-06", "FG1": "2025-10"}, last_doc={"K1": "2020-01", "K3": "2025-01"})


def test_suggest_prefills_exact_location_codes(work):
    crosswalk.suggest(work, SNAP, since="2025-03", partner_since="2024-03")
    rows = {(r["legacy_wh"], r["legacy_bin"]): r for r in _csv(work, "locations.csv")}
    assert (rows[("GM01", "")]["action"], rows[("GM01", "")]["terras_location_code"]) == ("MAP", "GM01")
    assert (rows[("GJ01", "GJ01L3-PIC-2")]["action"], rows[("GJ01", "GJ01L3-PIC-2")]["terras_location_code"]) == ("", "")
    assert rows[("GJ01", "GJ01L3-PIC-2")]["lots"] == "1"


def test_suggest_partners_by_normalised_name(work):
    crosswalk.suggest(work, SNAP, since="2025-03", partner_since="2024-03")
    rows = {r["adr_nr"]: r for r in _csv(work, "partners.csv")}
    assert (rows["K1"]["action"], rows["K1"]["terras_partner"]) == ("MAP", "ABADI JAYA")
    assert rows["K2"]["action"] == "SKIP"            # no documents in the window
    assert rows["K3"]["action"] == "CREATE"


def test_suggest_lookup_crosswalks(work):
    crosswalk.suggest(work, SNAP, since="2025-03", partner_since="2024-03")
    assert {r["legacy_group"]: r["terras_category"] for r in _csv(work, "categories.csv")}["ACIDDYES"] == "Dye > ACID DYES"
    assert {r["legacy_unit"]: r["terras_uom"] for r in _csv(work, "uoms.csv")} == {"KG": "kg", "Yard": "yard"}
    assert {r["legacy_suffix"]: (r["terras_size"], r["collapse"]) for r in _csv(work, "sizes.csv")} == {"XXL": ("2XL", "yes")}
    wf = {r["legacy_text"]: (r["kind"], r["terras_value"]) for r in _csv(work, "wash_finish.csv")}
    assert wf == {"Cuci dingin": ("WASH", "Cuci dingin"), "Chromafix FRD 20g/l": ("FINISH", "")}
    fg = _csv(work, "fg_colour.csv")
    assert [(r["legacy_code"], r["base_code"], r["colour_code"]) for r in fg] == [("FG1", "9649/16 NS", "10346A-1")]


def test_load_crosswalks_round_trips_reviewed_csvs(work):
    crosswalk.suggest(work, SNAP, since="2025-03", partner_since="2024-03")
    xw = crosswalk.load_crosswalks(work)
    assert xw.locations[("GM01", "")] == ("MAP", "GM01", "")
    assert xw.categories["ACIDDYES"] == "Dye > ACID DYES"
    assert xw.sizes["XXL"] == ("2XL", True)
    assert xw.partners["K3"] == ("CREATE", "", "CUSTOMER")
    assert xw.fg_colour["FG1"] == ("9649/16 NS", "10346A-1")
    assert xw.wash_finish["Cuci dingin"] == ("WASH", "Cuci dingin")


def test_snapshot_reads_masters_without_writing(db_session):
    import uuid
    from app.legacy.snapshot import build_snapshot
    from app.models.item import Item
    from app.models.location import Location
    tag = uuid.uuid4().hex[:6]
    db_session.add(Location(code=f"SNAP-{tag}", name="Snap WH", location_type="warehouse"))
    db_session.add(Item(code=f"SNAP-{tag}", name="Snap item", uom="kg"))
    db_session.flush()
    snap = build_snapshot(db_session)
    assert set(snap) == set(SNAP)
    assert snap["items"][f"SNAP-{tag}"]["uom"] == "kg"
    assert snap["locations"][f"SNAP-{tag}"]["type"] == "warehouse"
    assert not db_session.new and not db_session.dirty


def test_select_items_counts_on_fixture():
    art = {k: _art(k, group=g) for k, g in [("A", "FG"), ("B", "RM"), ("C", "RM"), ("LD", "LABDIP"), ("DY", "ACIDDYES"),
                                             ("OLD", "FG"), ("OLDC", "RM")]}
    li = [_li("GJ01", "A", qty=1), _li("GJ01", "ZZ", qty=1), _li("GJ01", "OLD", qty=0)]
    set_rows = [{"set_artnr_h": "A", "set_artnr_u": "B", "set_nr": ""},
                {"set_artnr_h": "A", "set_artnr_u": "LD", "set_nr": ""},
                {"set_artnr_h": "LD", "set_artnr_u": "DY", "set_nr": "1. Dyes 1"},
                {"set_artnr_h": "OLD", "set_artnr_u": "OLDC", "set_nr": ""}]
    got = crosswalk.select_items(art, li, set_rows, {"C": "2025-04", "OLD": "2024-01"}, "2025-03")
    assert got == {"A", "B", "C", "DY"}   # stocked, its child, recently moved, recipe child; no lab dip, no unknown, no stale
