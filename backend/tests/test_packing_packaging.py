"""Packaging type on a carton, and the brutto it makes.

The packer states which physical box each carton went into. A standard box's tare
comes off the master; a `is_custom` box has none and is weighed by hand at log
time. Brutto is the packer's net reading plus that tare, and all three figures are
snapshotted onto the carton so a later edit of the master never rewrites a printed
label or a dispatched delivery note.

Fixture-free: none of these touch the database — `resolve_carton_tares` is fed a
stub session so the resolution rule can be tested without a live master table.
"""
import asyncio
import uuid
from types import SimpleNamespace

import pytest

from app.services import packing_service as ps
from app.services.packing_service import Carton as C


BOX_L = uuid.uuid4()
BOX_S = uuid.uuid4()
CUSTOM = uuid.uuid4()


class _StubResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _StubDb:
    """Just enough AsyncSession to answer the one SELECT the resolver makes."""

    def __init__(self, rows):
        self._rows = rows

    async def execute(self, _stmt):
        return _StubResult(self._rows)


def _master():
    return [
        SimpleNamespace(id=BOX_L, code="BOX-L", name="Box L", tare_kg=0.85, is_custom=False),
        SimpleNamespace(id=BOX_S, code="BOX-S", name="Box S", tare_kg=0.4, is_custom=False),
        SimpleNamespace(id=CUSTOM, code="CUSTOM", name="Custom Box", tare_kg=None, is_custom=True),
    ]


def _resolve(db, cartons):
    """Run the resolver to completion. The project has no pytest-asyncio, and the
    function only awaits its own stubbed SELECT here, so a plain event loop per
    call is enough."""
    return asyncio.run(ps.resolve_carton_tares(db, cartons, "Carton"))


# --- the gate ---------------------------------------------------------------

def test_assert_all_boxed_names_how_many_cartons_are_missing_a_box():
    cartons = [C(5, 5.1, None, 0, BOX_L), C(5, 5.0, None, 1), C(3, 3.1, None, 2)]
    with pytest.raises(ValueError) as e:
        ps.assert_all_boxed(cartons, "Carton")
    assert "2 of 3" in str(e.value)


def test_assert_all_boxed_passes_when_every_carton_names_one():
    ps.assert_all_boxed([C(5, 5.1, None, 0, BOX_L), C(5, 5.0, None, 1, BOX_S)], "Carton")


# --- tare resolution --------------------------------------------------------

def test_standard_box_takes_the_masters_tare():
    out = _resolve(_StubDb(_master()), [C(5, 5.1, None, 0, BOX_L)])
    assert out[0].tare_kg == 0.85


def test_a_tare_sent_for_a_standard_box_is_ignored():
    # A re-picked row can leave a stale custom tare in the form. Trusting it would
    # ship one box of Box L weighing something different from every other Box L.
    out = _resolve(_StubDb(_master()), [C(5, 5.1, None, 0, BOX_L, 9.99)])
    assert out[0].tare_kg == 0.85


def test_custom_box_takes_the_packers_weighing():
    out = _resolve(_StubDb(_master()), [C(5, 5.1, None, 0, CUSTOM, 1.25)])
    assert out[0].tare_kg == 1.25


def test_custom_box_without_a_weighing_is_refused_by_carton_number():
    with pytest.raises(ValueError) as e:
        _resolve(_StubDb(_master()), [C(5, 5.1, None, 0, BOX_L), C(5, 5.0, None, 1, CUSTOM)])
    # Names the carton the packer has to go weigh, not just "a tare is missing".
    assert "Carton 2" in str(e.value)


def test_unknown_packaging_type_is_refused():
    with pytest.raises(ValueError) as e:
        _resolve(_StubDb([]), [C(5, 5.1, None, 0, BOX_L)])
    assert "Unknown packaging type" in str(e.value)


# --- brutto -----------------------------------------------------------------

def test_gross_is_net_plus_tare():
    assert ps.gross_weight(10.62, 0.85) == 11.47


def test_gross_with_no_tare_is_the_net_reading():
    assert ps.gross_weight(10.62, None) == 10.62


def test_gross_is_unknown_when_the_carton_was_never_weighed():
    # Not zero: a historic carton with no scale reading has an UNKNOWN brutto, and
    # the label prints a blank G.W. line rather than a figure nobody measured.
    assert ps.gross_weight(None, 0.85) is None


# --- the allocator carries packaging across a lot seam ----------------------

def test_a_box_split_at_a_lot_seam_keeps_one_packaging_type_on_both_halves():
    # 8 kg drawn from a 5 kg lot and a 3 kg lot, packed as one 8 kg box. The
    # allocator splits it so each piece pegs to a truthful lot; both pieces are
    # the SAME physical box, so both must carry its packaging — the merge step
    # then mints one carton from them.
    allocated = ps.allocate_boxes_to_lots(
        [5, 3], [8],
        weights=[8.2],
        packaging_type_ids=[BOX_L],
        tares=[None],
    )
    assert [c.packaging_type_id for lot in allocated for c in lot] == [BOX_L, BOX_L]
    # And they stay one box for the caller's re-merge.
    assert [c.box_index for lot in allocated for c in lot] == [0, 0]


def test_each_box_keeps_its_own_packaging_type():
    allocated = ps.allocate_boxes_to_lots(
        [10], [5, 5],
        weights=[5.1, 5.0],
        packaging_type_ids=[BOX_L, BOX_S],
        tares=[None, None],
    )
    assert [c.packaging_type_id for c in allocated[0]] == [BOX_L, BOX_S]


def test_a_custom_boxs_hand_weighed_tare_rides_with_its_box():
    allocated = ps.allocate_boxes_to_lots(
        [10], [5, 5],
        weights=[5.1, 5.0],
        packaging_type_ids=[BOX_L, CUSTOM],
        tares=[None, 1.25],
    )
    assert [c.tare_kg for c in allocated[0]] == [None, 1.25]


def test_packaging_is_optional_to_the_allocator_itself():
    # The allocator is a splitter, not a gate: a caller that sends no packaging
    # gets cartons with none, and `assert_all_boxed` is what refuses them. Keeping
    # the two separate is what lets the error name the cartons.
    allocated = ps.allocate_boxes_to_lots([5], [5], weights=[5.1])
    assert allocated[0][0].packaging_type_id is None


def test_a_carton_note_rides_with_its_box_across_a_lot_seam():
    # The note prints on the label, so both halves of a seam-split box (one
    # physical carton) carry it whole, and an unnoted box stays None.
    allocated = ps.allocate_boxes_to_lots(
        [5, 5], [8, 2],
        weights=[8.2, 2.0],
        packaging_type_ids=[BOX_L, BOX_S],
        notes=["Sambungan 2x", None],
    )
    assert [c.note for lot in allocated for c in lot] == ["Sambungan 2x", "Sambungan 2x", None]
