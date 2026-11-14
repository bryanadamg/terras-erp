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


# ---------------------------------------------------------------- Task 3: items
from app.legacy.crosswalk import Crosswalks
from app.legacy import transform

XW = Crosswalks(
    categories={"ACIDDYES": "Dye > ACID DYES", "FG": "Finished Goods", "RM": "Raw Material"},
    uoms={"KG": "kg", "Yard": "yard"},
    materials={"NS (NYLON SPANDEX)": "", "P (POLYESTER)": "Polyester"},
    sizes={"XXL": ("2XL", True), "L": ("L", True), "XL": ("XL", True), "115": ("115", False)},
    fg_colour={"FG1": ("9649/16 NS", "10346A-1")},
)
ART3 = {a["Art_nr"]: a for a in [
    _art("DYN0006", "LEVASET BORDEAUX", group="ACIDDYES"),
    _art("0000000070", "TAPE 70", group="FG", unit="Yard"),
    _art("0000000070 L", "TAPE 70 L", group="FG", unit="Yard", Art_flds00="NS (NYLON SPANDEX)"),
    _art("0000000070 XL", "TAPE 70 XL", group="FG", unit="Yard"),
    _art("0000000070 115", "TAPE 70 115", group="FG", unit="Yard"),
    _art("SOMETHING BRN-1901", "X", group="FG", unit="Yard"),
    _art("Y1", "YARN", group="RM", Art_flds00="P (POLYESTER)"),
    _art("Y2", "ODD", group="NOPE"),
    _art("Y3", "ODD UNIT", group="RM", unit="Unt"),
    _art("FG1", "9649/16 NS 10346A-1 PNK", group="FG", unit="Yard"),
]}
SNAP3 = dict(SNAP, items={"DYN0006": {"name": "LEVASET BORDEAUX B", "uom": "kg", "category": "ACID DYES"}})


def test_size_family_collapses_only_crosswalked_suffixes():
    assert transform.size_family("0000000070 XXL", XW) == ("0000000070", "2XL")
    assert transform.size_family("0000000070 115", XW) == ("0000000070 115", None)   # numeric not approved


def test_size_suffix_only_from_crosswalk():
    assert transform.size_family("SOMETHING BRN-1901", XW) == ("SOMETHING BRN-1901", None)
    assert transform.size_family("0000000070 M", XW) == ("0000000070 M", None)       # M not in this crosswalk


def test_build_items_marks_existing_codes_matched_and_never_changes_them():
    items, _ = transform.build_items({"DYN0006"}, ART3, XW, SNAP3)
    assert items[0]["status"] == "MATCHED" and items[0]["name"] == "LEVASET BORDEAUX B" and items[0]["uom"] == "kg"


def test_build_items_collapses_sizes_into_one_base():
    items, _ = transform.build_items({"0000000070 L", "0000000070 XL"}, ART3, XW, SNAP3, lotted={"0000000070 XL"})
    assert [(i["code"], i["name"], i["sizes"], i["legacy_codes"]) for i in items] == [
        ("0000000070", "TAPE 70", ["L", "XL"], ["0000000070 L", "0000000070 XL"])]
    assert items[0]["lot_tracked"] is True and items[0]["uom"] == "yard" and items[0]["category"] == "Finished Goods"
    assert items[0]["material"] == "NS (NYLON SPANDEX)"   # blank crosswalk value = create the legacy text as-is


def test_build_items_material_and_colour_base():
    items, _ = transform.build_items({"Y1", "FG1"}, ART3, XW, SNAP3)
    by = {i["code"]: i for i in items}
    assert by["Y1"]["material"] == "Polyester" and by["Y1"]["variant_type"] is None
    assert by["9649/16 NS"]["variant_type"] == "color" and by["9649/16 NS"]["legacy_codes"] == ["FG1"]


def test_unmapped_category_or_uom_is_rejected():
    items, rejects = transform.build_items({"Y2", "Y3"}, ART3, XW, SNAP3)
    assert items == []
    assert sorted((r["key"], r["reason"]) for r in rejects) == [
        ("Y2", "no category crosswalk for group NOPE"), ("Y3", "no uom crosswalk for unit Unt")]


# ------------------------------------------------------ Task 4: locations, partners
SNAP4 = dict(SNAP, locations={
    "FG": {"name": "Finished Goods", "type": "warehouse", "parent": ""},
    "FG-GD-FINISH-GOODS-1": {"name": "GD FINISH GOODS 1", "type": "zone", "parent": "FG"},
    "FG-GD-FINISH-GOODS-1-A1": {"name": "A1", "type": "bin", "parent": "FG-GD-FINISH-GOODS-1"},
    "GM01": {"name": "GUDANG MATERIAL 1", "type": "warehouse", "parent": ""},
})


def _xw_locs(**locs):
    return Crosswalks(locations=locs)


def test_location_crosswalk_requires_action():
    xw = Crosswalks(locations={("GM01", ""): ("MAP", "GM01", ""), ("GJ01", "PIC-2"): ("", "", "")})
    with pytest.raises(ValueError, match="GJ01/PIC-2"):
        transform.build_locations(xw, SNAP4)


def test_create_bin_needs_a_zone_parent():
    xw = Crosswalks(locations={("GJ01", "PIC-2"): ("CREATE_BIN", "FG-GD-FINISH-GOODS-1-A1", "")})
    with pytest.raises(ValueError, match="zone"):
        transform.build_locations(xw, SNAP4)


def test_map_target_must_exist():
    xw = Crosswalks(locations={("GJ01", ""): ("MAP", "NOPE", "")})
    with pytest.raises(ValueError, match="NOPE"):
        transform.build_locations(xw, SNAP4)


def test_skip_maps_to_none_and_create_bin_defaults_to_legacy_bin_name():
    xw = Crosswalks(locations={
        ("GW01", ""): ("SKIP", "", ""),
        ("GJ01", "GJ01L3-PIC-2"): ("CREATE_BIN", "FG-GD-FINISH-GOODS-1", ""),
        ("GJ01", "GJ01L3-PIC-3"): ("CREATE_BIN", "FG-GD-FINISH-GOODS-1", "Rak 3"),
        ("GJ02", "X"): ("CREATE_BIN", "FG-GD-FINISH-GOODS-1", "rak 3"),
        ("GM01", ""): ("MAP", "GM01", ""),
    })
    new, mapping = transform.build_locations(xw, SNAP4)
    assert new == [
        {"code": "FG-GD-FINISH-GOODS-1-GJ01L3-PIC-2", "name": "GJ01L3-PIC-2", "parent_code": "FG-GD-FINISH-GOODS-1"},
        {"code": "FG-GD-FINISH-GOODS-1-RAK-3", "name": "Rak 3", "parent_code": "FG-GD-FINISH-GOODS-1"},
    ]
    assert mapping[("GW01", "")] is None
    assert mapping[("GJ02", "X")] == "FG-GD-FINISH-GOODS-1-RAK-3"
    assert mapping[("GM01", "")] == "GM01"


def test_partner_create_vs_map():
    adr = [{"Adr_nr": "K1", "Adr_name": "PT. Abadi Jaya"},
           {"Adr_nr": "K2", "Adr_name": "CV Lama"},
           {"Adr_nr": "K3", "Adr_name": " Baru Sentosa ", "Adr_str": "Jl. Raya 1", "Adr_plz": "40123", "Adr_ort": "Bandung",
            "Adr_tel": "022-1", "Adr_fax": "", "Adr_email": "a@b.c", "Adr_parname": "Budi"}]
    xw = Crosswalks(partners={"K1": ("MAP", "ABADI JAYA", "CUSTOMER"), "K2": ("SKIP", "", "CUSTOMER"),
                              "K3": ("CREATE", "", "SUPPLIER")})
    assert transform.build_partners(adr, xw) == [
        {"name": "ABADI JAYA", "status": "MATCHED", "legacy_code": "K1"},
        {"name": "Baru Sentosa", "status": "NEW", "legacy_code": "K3", "type": "SUPPLIER",
         "address": "Jl. Raya 1, 40123 Bandung", "phone": "022-1", "fax": None, "email": "a@b.c", "contact_person": "Budi"},
    ]
