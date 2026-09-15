"""The work queue's on-hand pool buckets by size, like every other netting surface.

It used to key on (item, variant) alone, so 28.5 kg of 77 cm XL greige was offered
to a 72 cm L dyeing order — which read READY on stock it can never dye — and the XL
order behind it was then told it was short of its own pile. Sizes are a physical
difference; the MRP ledger, /stock/availability and the PR material requirements all
already agree on it, and this made the queue the fourth surface that didn't.

Pure functions over a literal pool: no DB, so this stays a guard on the RULE rather
than on one fixture's data.
"""
import uuid

import app.db.base  # noqa: F401  (registers models before the service imports them)
from app.services.work_queue_service import _take_from_pool


ITEM = "greige"
# Variant keys are comma-joined attribute-value UUIDs, and `variant_matches` parses
# them as such — a word like "NAVY" would not survive the round trip.
NAVY = str(uuid.uuid4())
BLACK = str(uuid.uuid4())


def test_sized_demand_cannot_take_another_size():
    pool = {(ITEM, "", "xl"): 28.5}
    available, got = _take_from_pool(dict(pool), ITEM, "", 22.6, "l")
    assert (available, got) == (0, 0)


def test_sized_demand_takes_its_own_size():
    pool = {(ITEM, "", "xl"): 28.5, (ITEM, "", "l"): 10.0}
    available, got = _take_from_pool(pool, ITEM, "", 27.1, "xl")
    assert (available, round(got, 2)) == (28.5, 27.1)
    # The L pile is untouched — it was never eligible.
    assert pool[(ITEM, "", "l")] == 10.0


def test_sized_demand_falls_back_to_the_generic_pile():
    """A lot whose size was never recorded is not evidence of a DIFFERENT size."""
    pool = {(ITEM, "", "xl"): 28.5, (ITEM, "", ""): 5.0}
    available, got = _take_from_pool(pool, ITEM, "", 22.6, "l")
    assert (available, got) == (5.0, 5.0)


def test_unsized_demand_may_take_any_size():
    pool = {(ITEM, "", "xl"): 28.5}
    _available, got = _take_from_pool(pool, ITEM, "", 10.0, "")
    assert got == 10.0


def test_size_never_overrides_the_variant_rule():
    """Colour is a hard identity: matching sizes must not bridge two variants."""
    pool = {(ITEM, BLACK, "l"): 50.0}
    available, got = _take_from_pool(pool, ITEM, NAVY, 22.6, "l")
    assert (available, got) == (0, 0)
