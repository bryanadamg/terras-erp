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


# ------------------------------------------------ Task 5: colours, recipes, stock
ART5 = {a["Art_nr"]: a for a in [
    _art("0000001388", " 10346A-1 ", group="LABDIP", Art_flds11="Cuci dingin", Art_flds12="AIR PANAS SIRKULASI",
         Art_flds13="Fixing 20 g/l tanacid AB 2g/l ", Art_flds19="Chromafix FRD 20g/l"),
    _art("0000002785", "14368A-1", group="LABDIP"),
    _art("LABOLATORI", "OVEN MEMRT UN 55", group="LABDIP"),
    _art("DYN0006", "LEVASET BORDEAUX B", group="ACIDDYES"), _art("DYN0004", "LEVASET RED G", group="ACIDDYES"),
    _art("DYN0009", "LEVASET NAVY R", group="ACIDDYES"), _art("CHE0039", "CHROMALEV ACD 01", group="CHEMICAL"),
    _art("CHE0001", "CHROMALEV LPA", group="CHEMICAL"),
]}


def _edge(p, c, slot, qty):
    return {"set_artnr_h": p, "set_artnr_u": c, "set_nr": slot, "set_stck": qty, "set_stckproz": 0}


SET_1388 = [_edge("0000001388", "CHE0001", "5. Chem 2", 10), _edge("0000001388", "DYN0006", "1. Dyes 1", 9.0),
            _edge("0000001388", "CHE0039", "4. Chem 1", 10), _edge("0000001388", "DYN0009", "3. Dyes 3", 0.8),
            _edge("0000001388", "DYN0004", "2. Dyes 2", 2.1), _edge("0000001388", "GONE", "6. Chem 3", 1)]
XW5 = Crosswalks(wash_finish={"Cuci dingin": ("WASH", "Cuci dingin"), "AIR PANAS SIRKULASI": ("WASH", ""),
                              "Fixing 20 g/l tanacid AB 2g/l": ("FINISH", "Fixing")},
                 fg_colour={"FG1": ("9649/16 NS", "14368A-1")})


def test_build_colors_from_recipes_and_fg_links():
    colors = transform.build_colors(ART5, SET_1388, dict(SNAP, colors=["99999-A-1"]), XW5)
    assert [(c["code"], c["status"], c["legacy_code"]) for c in colors] == [
        ("10346A-1", "NEW", "0000001388"), ("14368A-1", "NEW", "0000002785")]   # the oven is not a colour
    assert transform.build_colors(ART5, SET_1388, dict(SNAP, colors=["10346A-1"]), Crosswalks())[0]["status"] == "MATCHED"


def test_recipe_lines_follow_slot_order_and_kinds():
    recipes, rejects = transform.build_recipes(ART5, SET_1388, XW5)
    r = recipes[0]
    assert (r["color_code"], r["name"], r["notes"]) == ("10346A-1", "10346A-1", "legacy:0000001388")
    assert [(l["item_code"], l["chemical_type"], l["sort_order"]) for l in r["lines"]] == [
        ("DYN0006", "DYE", 0), ("DYN0004", "DYE", 1), ("DYN0009", "DYE", 2), ("CHE0039", "OTHER", 3), ("CHE0001", "OTHER", 4)]
    assert r["lines"][0]["qty_per_liter"] == 9.0
    assert rejects == [{"entity": "recipe_line", "key": "0000001388/GONE", "reason": "component not in item master"}]


def test_recipe_wash_and_finishing_steps_follow_crosswalk():
    r = transform.build_recipes(ART5, SET_1388, XW5)[0][0]
    assert r["wash_baths"] == [{"bath_number": 1, "value": "Cuci dingin"}, {"bath_number": 2, "value": "AIR PANAS SIRKULASI"}]
    assert r["finishing"] == [{"sort_order": 0, "value": "Fixing"}, {"sort_order": 1, "value": "Chromafix FRD 20g/l"}]


def test_batch_number_collisions():
    assert transform.batch_number_for("A", "123", set(), set()) == "123"
    assert transform.batch_number_for("A", "123", set(), {"123"}) == "123-A"     # serial shared by two legacy items
    assert transform.batch_number_for("A", "123", {"123"}, set()) == "123-A"     # already a bie-prod batch
    long = transform.batch_number_for("X" * 30, "9" * 60, set(), {"9" * 60})
    assert len(long) <= 64 and long != transform.batch_number_for("Y" * 30, "9" * 60, set(), {"9" * 60})


ITEMS5 = [
    {"code": "0000000070", "uom": "yard", "legacy_codes": ["0000000070 L", "0000000070 XL"]},
    {"code": "9649/16 NS", "uom": "yard", "legacy_codes": ["FG1"]},
    {"code": "Y1", "uom": "kg", "legacy_codes": ["Y1"]},
]
XW5S = Crosswalks(sizes={"L": ("L", True), "XL": ("XL", True)}, fg_colour={"FG1": ("9649/16 NS", "14368A-1")})
MAP5 = {("GJ01", "PIC-2"): "FG-A1", ("GW01", ""): None, ("GM01", ""): "GM01"}


def _stock(li):
    return transform.build_opening_stock(li, MAP5, ITEMS5, XW5S, dict(SNAP, batch_numbers=["777"]))


def test_nonpositive_balance_rejected():
    rows, rejects = _stock([_li("GM01", "Y1", "S1", qty=0), _li("GM01", "Y1", "S2", qty=-5)])
    assert rows == [] and [r["reason"] for r in rejects] == ["non-positive qty", "non-positive qty"]


def test_skipped_store_produces_no_stock():
    rows, rejects = _stock([_li("GW01", "Y1", "S1", qty=3), _li("GM01", "NOPE", "S1", qty=3)])
    assert rows == []
    assert [r["reason"] for r in rejects] == ["store already live in Terras", "item not migrated"]


def test_sized_item_stock_lands_on_base_with_size():
    rows, _ = _stock([_li("GJ01", "0000000070 XL", "2602131321130471", "PIC-2", 720),
                      _li("GJ01", "0000000070 L", "2602131321130471", "PIC-2", 10)])
    assert [(r["item_code"], r["size"], r["batch_number"], r["location_code"], r["qty"], r["uom"]) for r in rows] == [
        ("0000000070", "XL", "2602131321130471-0000000070 XL", "FG-A1", 720, "yard"),
        ("0000000070", "L", "2602131321130471-0000000070 L", "FG-A1", 10, "yard")]
    assert rows[0]["ref"] == "GJ01|PIC-2|0000000070 XL|2602131321130471"


def test_fg_colour_item_stock_lands_on_base_with_colour():
    rows, _ = _stock([_li("GM01", "FG1", "777", qty=4), _li("GM01", "Y1", "", qty=2)])
    assert [(r["item_code"], r["color_code"], r["batch_number"]) for r in rows] == [
        ("9649/16 NS", "14368A-1", "777-FG1"), ("Y1", None, None)]


# ------------------------------------------------------------------ Task 6: BOMs
ART6 = {a["Art_nr"]: a for a in [
    _art("T70 L", group="FG"), _art("T70 XL", group="FG"), _art("GR", group="RM"), _art("YN", group="RM"),
    _art("LD", "10346A-1", group="LABDIP"), _art("FGC", group="FG"), _art("OLDFG", group="FG"), _art("P2", group="FG"),
]}
IT6 = {"T70 L": {"code": "T70"}, "T70 XL": {"code": "T70"}, "GR": {"code": "GR"}, "YN": {"code": "YN"},
       "FGC": {"code": "FGC BASE"}, "OLDFG": {"code": "OLDFG"}, "P2": {"code": "P2"}}
XW6 = Crosswalks(sizes={"L": ("L", True), "XL": ("XL", True)}, fg_colour={"FGC": ("FGC BASE", "10346A-1")})


def _boms(edges, prod=()):
    return transform.build_boms(edges, IT6, XW6, set(prod), ART6)


def test_bom_takes_plain_slot_only():
    boms, rejects = _boms([_edge("P2", "GR", "", 3), _edge("P2", "YN", "2", 1), _edge("P2", "YN", "WEFT", 1)])
    assert [(b["code"], [l["item_code"] for l in b["lines"]]) for b in boms] == [("LEG-P2", ["GR"])]
    assert sorted(r["reason"] for r in rejects) == ["alternative slot 2", "alternative slot WEFT"]


def test_bom_labdip_child_is_not_a_line():
    boms, rejects = _boms([_edge("FGC", "GR", "", 1), _edge("FGC", "LD", "", 1)])
    assert [(b["item_code"], [l["item_code"] for l in b["lines"]]) for b in boms] == [("FGC BASE", ["GR"])]
    assert rejects == []


def test_bom_percentages_derived_from_qty():
    boms, _ = _boms([_edge("P2", "GR", "", 1), _edge("P2", "YN", "", 2)])
    lines = boms[0]["lines"]
    assert [l["percentage"] for l in lines] == [33.33, 66.67] and sum(l["percentage"] for l in lines) == 100.0
    given = [dict(_edge("P2", "GR", "", 1), set_stckproz=40), dict(_edge("P2", "YN", "", 2), set_stckproz=60)]
    assert [l["percentage"] for l in _boms(given)[0][0]["lines"]] == [40.0, 60.0]


def test_bom_sized_family_is_one_sized_bom():
    boms, rejects = _boms([_edge("T70 L", "GR", "", 1), _edge("T70 XL", "GR", "", 1.2)])
    assert [(b["code"], b["item_code"], b["size_mode"], b["sizes"]) for b in boms] == [("LEG-T70", "T70", "sized", ["L", "XL"])]
    assert rejects == []
    _, rejects = _boms([_edge("T70 L", "GR", "", 1), _edge("T70 XL", "YN", "", 1)])
    assert [r["reason"] for r in rejects] == ["size-specific lines"]


def test_bom_skipped_when_prod_has_one():
    boms, _ = _boms([_edge("P2", "GR", "", 1)], prod=["P2"])
    assert [(b["code"], b["status"]) for b in boms] == [("LEG-P2", "MATCHED")]


def test_bom_orphans_rejected():
    boms, rejects = _boms([_edge("P2", "GR", "", 1), _edge("P2", "MISSING", "", 1), _edge("GHOST", "GR", "", 1)])
    assert boms == []
    assert sorted((r["key"], r["reason"]) for r in rejects) == [
        ("GHOST", "parent not in item master"), ("P2", "component MISSING not migrated")]


def test_select_items_follows_the_whole_bom_tree():
    art = {k: _art(k, group="RM") for k in ["FG", "WIP", "GREIGE", "YARN", "STALE", "STALEC"]}
    set_rows = [{"set_artnr_h": "FG", "set_artnr_u": "WIP", "set_nr": ""},
                {"set_artnr_h": "WIP", "set_artnr_u": "GREIGE", "set_nr": ""},
                {"set_artnr_h": "GREIGE", "set_artnr_u": "YARN", "set_nr": ""},
                {"set_artnr_h": "STALE", "set_artnr_u": "STALEC", "set_nr": ""}]
    got = crosswalk.select_items(art, [_li("GJ01", "FG", qty=1)], set_rows, {}, "2025-03")
    assert got == {"FG", "WIP", "GREIGE", "YARN"}   # a WIP child must bring its own components, all the way down


def test_build_items_ignores_padding_on_legacy_group_and_unit():
    art = {"P1": _art("P1", "PADDED", group="RM ", unit=" KG")}
    items, rejects = transform.build_items({"P1"}, art, XW, SNAP3)
    assert rejects == [] and (items[0]["category"], items[0]["uom"]) == ("Raw Material", "kg")


def test_partner_without_a_name_is_not_created():
    xw = Crosswalks(partners={"K9": ("CREATE", "", "CUSTOMER")})
    assert transform.build_partners([{"Adr_nr": "K9", "Adr_name": "  "}], xw) == []


def test_serials_that_differ_only_by_padding_still_count_as_shared():
    rows, _ = _stock([_li("GM01", "Y1", "A2", qty=1), _li("GM01", "FG1", "A2 ", qty=1)])
    assert sorted(r["batch_number"] for r in rows) == ["A2-FG1", "A2-Y1"]


def test_stock_qty_is_rounded_to_ledger_precision():
    rows, _ = _stock([_li("GM01", "Y1", "S1", qty=3043.4782609)])
    assert rows[0]["qty"] == 3043.4783          # stock_ledger.qty_change is Numeric(14, 4)
