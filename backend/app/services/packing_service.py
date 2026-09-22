"""Packing / PackedUnit domain logic.

A PackedUnit is a physical carton. It is stored as a `Batch` row — the same
modelling choice already made for warp beams — so its quantity lives in the
normal `StockBalance` row keyed by `batch_key = <batch id>` at the packed
location, and there is no second qty record to drift. `Batch.packing_order_id`
is the discriminator: non-null means "this batch is a carton".
"""
import json
import uuid
from collections import Counter, deque
from datetime import datetime
from typing import NamedTuple, Optional

from sqlalchemy import select, func, cast, String, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.batch import Batch, BatchConsumption
from app.models.packing import PackingOrder, PackingCompletion
from app.models.packaging_type import PackagingType
from app.models.pick_list import PickList, PickListLine
from app.models.stock_balance import StockBalance
from app.services import stock_service, numbering_service
from app.services.stock_service import _generate_variant_key
from app.api.batches import generate_batch_number


PACKED_UNIT_PREFIX = "PU"


def is_packed_unit(batch: Batch) -> bool:
    return batch is not None and batch.packing_order_id is not None


# --- Lot locks (quarantine-sourced orders) ---------------------------------
# A lot handed to a packing order off the Quarantine Packing desk belongs to
# that order alone (`Batch.locked_packing_order_id`), and the order cannot close
# until the lot is drawn down to nothing. The lock is never unwound: it is in
# force only while its order is open, so closing or cancelling releases every
# lot it held in one status write.

CLOSED_STATUSES = ("COMPLETED", "CANCELLED")


def open_order_ids():
    """Subquery of the packing orders whose lot locks are still in force."""
    return select(PackingOrder.id).filter(PackingOrder.status.notin_(CLOSED_STATUSES))


def lock_free_condition(po_id):
    """SQL predicate: this lot may be drawn by packing order `po_id`.

    Free (never claimed), already ours, or claimed by an order that has since
    closed. Written as a condition rather than a service call because the lot
    picker in `api/batches.py` applies it inside its own query.
    """
    return or_(
        Batch.locked_packing_order_id.is_(None),
        Batch.locked_packing_order_id == po_id,
        Batch.locked_packing_order_id.notin_(open_order_ids()),
    )


async def assert_lots_unlocked(db: AsyncSession, po_id, batch_ids) -> None:
    """Raise ValueError if any of these lots belongs to another open order.

    The picker filter is UI; this is the gate. Runs before any stock moves, for
    the whole submission, so a multi-lot pack cannot get halfway in.
    """
    ids = [b for b in batch_ids if b]
    if not ids:
        return
    rows = (await db.execute(
        select(Batch.batch_number, PackingOrder.code)
        .join(PackingOrder, PackingOrder.id == Batch.locked_packing_order_id)
        .filter(
            Batch.id.in_(ids),
            Batch.locked_packing_order_id != po_id,
            PackingOrder.status.notin_(CLOSED_STATUSES),
        )
    )).all()
    if rows:
        detail = ", ".join(f"{bn} (held by {code})" for bn, code in rows)
        raise ValueError(f"These lots are held by another packing order: {detail}")


async def claim_lots(db: AsyncSession, po: PackingOrder, batch_ids) -> list[str]:
    """Lock lots onto this order. Returns the lot numbers actually claimed.

    Scoped to the order's own item: a deep link carrying an id from another
    group would otherwise pin a lot this order can never pack.
    """
    ids = [b for b in batch_ids if b]
    if not ids:
        return []
    await assert_lots_unlocked(db, po.id, ids)
    batches = (await db.execute(
        select(Batch).filter(Batch.id.in_(ids), Batch.item_id == po.item_id)
    )).scalars().all()
    for b in batches:
        b.locked_packing_order_id = po.id
    return [b.batch_number for b in batches]


async def undrained_locked_lots(db: AsyncSession, po: PackingOrder) -> list[tuple[str, float]]:
    """Lots locked to this order still holding stock at its source location.

    Scoped to the source location on purpose: the rule is "the pile on the hold
    desk is gone", not "this lot no longer exists anywhere". Scrap moved to the
    defect store keeps the lot number (the batch is not re-graded — see the pack
    endpoint), and counting that would leave the order unclosable forever.
    """
    if not po.source_location_id:
        return []
    rows = (await db.execute(
        select(Batch.batch_number, func.sum(StockBalance.qty))
        .join(StockBalance, StockBalance.batch_key == cast(Batch.id, String))
        .filter(
            Batch.locked_packing_order_id == po.id,
            StockBalance.location_id == po.source_location_id,
            StockBalance.qty > 0,
        )
        .group_by(Batch.batch_number)
    )).all()
    return [(bn, float(q or 0)) for bn, q in rows if float(q or 0) > 1e-6]


def packed_unit_filter():
    """SQL filter selecting only PackedUnit batches — the single definition,
    mirroring `beam_service.beam_item_ids()`. Never inline the column test."""
    return Batch.packing_order_id.isnot(None)


class Carton(NamedTuple):
    """One physical box: its base-UOM qty, its scale reading, its packed count.

    Three separate measurements of the same box, which is why they travel
    together rather than as parallel lists that a lot-seam split could silently
    knock out of alignment:

    * `qty` — base UOM, what actually moves in stock (kg / yard / pcs).
    * `weight_kg` — the packer's scale reading. Derived from `qty` only when the
      item is stocked in kg (then they are the same measurement).
    * `alt_qty` — count in the packing order's alt selling unit (12 Pcs, 4 Pic).
    """
    qty: float
    weight_kg: Optional[float] = None
    alt_qty: Optional[float] = None
    # Which entry of the caller's `boxes` list this piece belongs to. Set only by
    # `allocate_boxes_to_lots` — a box split at a lot seam yields two Cartons that
    # share the same `box_index`, which is how the caller re-merges them into one
    # physical carton. None on every other path (box-size split never crosses a
    # lot boundary, so there is nothing to re-merge).
    box_index: Optional[int] = None
    # --- Packaging (the physical box) ---------------------------------------
    # Which `PackagingType` this box is, and what the empty box weighs. Tare is
    # the master's for a standard box and the packer's hand-weighing for a
    # custom one — `resolve_carton_tares` decides which and fills it in, so
    # everything downstream reads one field. They ride in the tuple for the same
    # reason `weight_kg` does: a lot-seam split must not knock them out of
    # alignment with the qty they describe.
    packaging_type_id: Optional[uuid.UUID] = None
    tare_kg: Optional[float] = None


# --- Alt (selling) unit conversion -----------------------------------------
# A packing order may be counted in a unit the item is not stocked in: the
# customer orders 2880 Pcs of 5 yard each, the item is stocked in kg. That is
# two hops, and both live here so the pack screens, the labels and the API can
# never each derive it their own way:
#
#     alt --(uom2_factor, in uom2_length_uom)--> length --(item g/y or g/m)--> kg
#
# `SalesOrderLine.uom2_factor` means exactly the same thing (length per one alt
# unit), so a snapshot off the SO line needs no translation.

_LENGTH_ALIASES = {
    "yard": "yard", "yards": "yard", "yd": "yard", "yds": "yard", "y": "yard",
    "meter": "meter", "meters": "meter", "metre": "meter", "metres": "meter", "m": "meter",
}
YARDS_PER_METER = 1.0 / 0.9144


def normalize_length_uom(uom: Optional[str]) -> Optional[str]:
    """'Yard'/'yd'/'y' -> 'yard', 'm'/'meter' -> 'meter', anything else None."""
    return _LENGTH_ALIASES.get((uom or "").strip().lower())


def convert_length(qty: float, from_uom: Optional[str], to_uom: Optional[str]) -> Optional[float]:
    frm, to = normalize_length_uom(from_uom), normalize_length_uom(to_uom)
    if not frm or not to:
        return None
    if frm == to:
        return float(qty)
    return float(qty) * (YARDS_PER_METER if to == "yard" else 0.9144)


def base_per_alt(
    uom2_factor: Optional[float],
    length_uom: Optional[str],
    item_uom: Optional[str],
    weight_per_unit: Optional[float] = None,
    weight_unit: Optional[str] = None,
) -> Optional[float]:
    """Base-UOM qty in one alt unit, or None when the chain can't be resolved.

    `length_uom` is what the factor is quoted in, and on the real UOM master that
    is NOT always a length: the seeded rows include `1 Pic = 50 m` but also
    `1 Box = 10 kg`. So a factor already quoted in the item's own stock UOM is
    taken as it stands, and only a genuine length needs converting.

    `weight_per_unit`/`weight_unit` come off the Item and are only consulted when
    a length has to become a weight. Only `g/y` and `g/m` are convertible from a
    length alone — `gsm` / `g/m²` need the fabric width, so those return None
    rather than a figure wrong by the width, exactly as the SO form's own kg
    auto-calc refuses them.
    """
    try:
        factor = float(uom2_factor or 0)
    except (TypeError, ValueError):
        return None
    if factor <= 0:
        return None

    quoted = (length_uom or "").strip().lower()
    stocked = (item_uom or "").strip().lower()
    # Already in the stock unit — `1 Box = 10 kg` on a kg item is the whole
    # conversion, and routing it through the length code would silently read the
    # 10 as yards.
    if quoted and (quoted == stocked or (uom_is_kg(quoted) and uom_is_kg(stocked))):
        return round(factor, 6)

    src = normalize_length_uom(length_uom)
    if quoted and not src:
        # A real unit that is neither a length nor the stock unit (a factor into
        # cones while the item is stocked in kg). Nothing here bridges it.
        return None
    # Nothing resolvable: assume yard, the unit every legacy factor was entered
    # against and the SO view's own fallback.
    src = src or "yard"

    if uom_is_kg(item_uom):
        try:
            gpu = float(weight_per_unit or 0)
        except (TypeError, ValueError):
            return None
        unit = (weight_unit or "").strip().lower()
        if gpu <= 0 or unit not in ("g/y", "g/m"):
            return None
        length = convert_length(factor, src, "yard" if unit == "g/y" else "meter")
        if length is None:
            return None
        return round(length * gpu / 1000.0, 6)

    dest = normalize_length_uom(item_uom)
    if dest:
        converted = convert_length(factor, src, dest)
        return None if converted is None else round(converted, 6)

    # A counted base UOM (pcs, roll): one alt unit is one base unit only if the
    # two are the same thing, which nothing here can establish. Caller falls back
    # to base-only entry.
    return None


def to_yards(
    qty: float,
    item_uom: Optional[str],
    weight_per_unit: Optional[float] = None,
    weight_unit: Optional[str] = None,
) -> Optional[float]:
    """A base-UOM qty restated in yards, or None when the chain can't be resolved.

    The inverse of the weight hop `base_per_alt` makes, and it lives here for that
    reason: the dyeing monitor measures output in yards while production is logged
    in the item's stock UOM, and a second copy of the g/y rule elsewhere is how the
    two would drift apart.

    Same refusal as `base_per_alt`: only `g/y` and `g/m` bridge weight to length.
    `gsm` / `g/m²` need the fabric width, so they return None — a caller must show
    nothing rather than a figure wrong by the width.
    """
    try:
        q = float(qty)
    except (TypeError, ValueError):
        return None

    # Already a length: yard as-is, metre converted.
    src = normalize_length_uom(item_uom)
    if src:
        return convert_length(q, src, "yard")

    if not uom_is_kg(item_uom):
        # A counted base UOM (pcs, roll). Nothing here bridges it to a length.
        return None

    try:
        gpu = float(weight_per_unit or 0)
    except (TypeError, ValueError):
        return None
    unit = (weight_unit or "").strip().lower()
    if gpu <= 0 or unit not in ("g/y", "g/m"):
        return None
    # kg -> grams -> the length one gram-per-unit buys -> yards.
    length = q * 1000.0 / gpu
    return convert_length(length, "yard" if unit == "g/y" else "meter", "yard")


def alt_to_base(qty_alt: float, base_factor: Optional[float]) -> Optional[float]:
    if not base_factor or float(base_factor) <= 0:
        return None
    return round(float(qty_alt) * float(base_factor), 4)


def base_to_alt(qty_base: float, base_factor: Optional[float], snap: bool = True) -> Optional[float]:
    """Alt count implied by a base qty. Only ever a fallback — see `Carton.alt_qty`.

    `snap` rounds to a whole count when the figure is within 5% of one, because
    for a kg item the base qty is a SCALE reading: a box holding 12 Pcs weighs
    10.62 kg against a theoretical 10.80, which divides out to 11.8 Pcs. A label
    printing 11.8 pieces is simply wrong about a discrete count. Outside that
    band the raw figure is kept, since it then means the box genuinely doesn't
    hold a whole number of pieces.
    """
    if not base_factor or float(base_factor) <= 0:
        return None
    raw = float(qty_base) / float(base_factor)
    if snap:
        nearest = round(raw)
        if nearest >= 1 and abs(raw - nearest) <= 0.05 * nearest:
            return float(nearest)
    return round(raw, 2)


def order_weight_spec(po: PackingOrder, item=None) -> tuple[Optional[float], Optional[str]]:
    """The (weight per unit, unit) this order converts a length to a weight with.

    The operator's own sampling of THIS cloth wins over the item master, which
    holds the estimate taken when the style was developed. Both halves must be
    present to count — a figure with no unit is unusable, and a unit with no
    figure states nothing — so a half-filled pair falls back rather than being
    read against the wrong basis.
    """
    per_unit = getattr(po, "sample_weight_per_unit", None)
    unit = getattr(po, "sample_weight_unit", None)
    try:
        sampled = float(per_unit or 0)
    except (TypeError, ValueError):
        sampled = 0.0
    if sampled > 0 and unit:
        return sampled, unit
    it = item if item is not None else getattr(po, "item", None)
    return getattr(it, "weight_per_unit", None), getattr(it, "weight_unit", None)


def order_base_per_alt(po: PackingOrder, item=None) -> Optional[float]:
    """`base_per_alt` for one packing order — the one call sites should use.

    Keeps the (factor, length unit, item UOM, weight spec) tuple in a single
    place so an endpoint, a label and a pack screen can't each assemble it
    slightly differently. Returns None when the order carries no alt unit, or
    when the weight spec can't convert a length to its stock UOM.

    The weight half comes from `order_weight_spec`, so an order that was sampled
    converts through what its own cloth weighs and not through the item's
    development estimate.
    """
    it = item if item is not None else getattr(po, "item", None)
    if not po.uom2 or not po.uom2_factor:
        return None
    weight_per_unit, weight_unit = order_weight_spec(po, it)
    return base_per_alt(
        po.uom2_factor,
        po.uom2_length_uom,
        getattr(it, "uom", None),
        weight_per_unit,
        weight_unit,
    )


def order_alt_target(po: PackingOrder, item=None) -> Optional[float]:
    """The alt-unit count an order is FOR — what `qty_packed_alt` is measured against.

    The count stated on the order when there is one — that is the figure the customer
    ordered, and the one `qty_target` is itself derived from (`_sync_target_to_alt`).
    Otherwise the base target converted, which is all a hand-entered order has to go on.
    """
    if not po.uom2:
        return None
    if po.qty2 and float(po.qty2) > 0:
        return float(po.qty2)
    factor = order_base_per_alt(po, item)
    if not factor or float(factor) <= 0:
        return None
    return round(float(po.qty_target or 0) / float(factor), 2)


def is_target_met(po: PackingOrder, item=None, tol: float = 1e-6) -> bool:
    """Has this order packed what it was for?

    Measured in whatever the order is COUNTED in: pieces on an alt-unit order, the
    stock UOM otherwise. This is the DELIVERED gate, the reopen-on-reject test and
    the input to quarantine's open-quantity claim, and all of them have to ask the
    same question — an order for 2880 Pcs is fulfilled when 2880 pieces are boxed,
    whatever they weighed. Judged in kg against a target derived from the item's
    g/y, a physically complete run of elastic cloth never reached DELIVERED, because
    the boxes are reweighed and the cloth does not hold its estimate.

    Falls back to the base comparison whenever the piece count is unavailable (no alt
    unit, or `cartons` not eager-loaded), so it is never *less* correct than the kg
    test it replaces. Never inline either comparison again — four call sites drifting
    apart on "is it done" is what this exists to prevent.
    """
    packed_alt = po.qty_packed_alt
    ordered_alt = order_alt_target(po, item)
    if packed_alt is not None and ordered_alt is not None and ordered_alt > 0:
        return packed_alt + tol >= ordered_alt
    return po.qty_packed + tol >= float(po.qty_target or 0) > 0


async def is_fulfilled(db: AsyncSession, po: PackingOrder, item=None) -> bool:
    """Does this order still owe work? Target met, OR its held lots are packed out.

    The second half is what holding lots means: the order was cut for one physical
    pile (claimed off the Quarantine Packing desk, or ticked on the New Packing
    Order form), the pile is gone, and nothing is left for it to log. Its target is
    a snapshot of what was free when it was planned — cloth that came in light
    would otherwise leave a fully packed-out order IN_PROGRESS for good.

    Fulfilled is DELIVERED, never COMPLETED: logging stays allowed, so a packer who
    does want to finish a short order off free stock still can. The qty comparison
    itself stays in `is_target_met` — the single definition of "did we pack what was
    ordered" — and this only adds the lot half, for the status transitions.
    """
    if is_target_met(po, item):
        return True
    if not po.source_location_id:
        return False
    held = (await db.execute(
        select(func.count()).select_from(Batch)
        .filter(Batch.locked_packing_order_id == po.id)
    )).scalar() or 0
    if not held:
        return False
    return not await undrained_locked_lots(db, po)


def open_qty(po: PackingOrder, item=None) -> float:
    """What this order still owes, in the item's stock UOM.

    Quarantine claims this against released lots, and stock is claimed in kg however
    the order is counted — so the figure stays in the base unit. Only the *decision*
    that an order owes nothing moves to the counting unit: a fulfilled 2880 Pcs order
    that came in light must stop claiming hold stock, which a raw `qty_target -
    qty_packed` subtraction would keep it doing forever.
    """
    if is_target_met(po, item):
        return 0.0
    return max(0.0, float(po.qty_target or 0) - po.qty_packed)


def split_qty(total: float, box_size: float) -> list[float]:
    """Fixed-size boxes plus one remainder box, not an even split.

    A carton is a physical box of a known size (e.g. 5kg) — the packer expects
    `floor(total / box_size)` full boxes, with only the leftover in a smaller
    final box, never all boxes shrunk to absorb it. Rounded to 4dp to match
    Numeric(14, 4). `box_size <= 0` means no box size is configured — the whole
    qty goes into a single carton.
    """
    total = float(total)
    box_size = float(box_size)
    if box_size <= 0:
        return [round(total, 4)]
    full = int(total // box_size)
    remainder = round(total - full * box_size, 4)
    parts = [round(box_size, 4)] * full
    if remainder > 1e-6:
        parts.append(remainder)
    return parts or [round(total, 4)]


def cartons_from_alt_split(
    lot_qty: float,
    per_carton_alt: float,
    base_factor: Optional[float],
) -> Optional[list[Carton]]:
    """Split a draw into cartons of a fixed PIECE count, not a fixed weight.

    The counting unit runs the split on an alt-unit order, for the same reason it
    runs `is_target_met`: a carton holds 12 pieces, and the 10.8 kg those work out
    to is an estimate the scale contradicts on every box. Splitting the kilos
    instead produced boxes nobody packed — a 130.1 kg draw against a 10.8 kg box
    is 12 boxes plus a 0.5 kg thirteenth, which is not a carton of anything, and
    each label printed 11.8 Pcs once the real weight went in.

    So the counts are laid out first (`split_qty` in the alt unit, off the count
    the draw implies), then each carton's base qty is that count converted —
    except the LAST, which takes whatever base qty is left over. The cartons must
    sum to exactly what left the source location: this figure is the stock move,
    and 12 rounded 10.8s against a 130.1 kg draw would post a ledger that doesn't
    balance its own line.

    None when the conversion can't be resolved or no count size was given, which
    leaves the caller on the base-qty split.
    """
    factor = float(base_factor or 0)
    per = float(per_carton_alt or 0)
    if factor <= 0 or per <= 0 or float(lot_qty) <= 0:
        return None
    total_alt = base_to_alt(float(lot_qty), factor)
    if total_alt is None or total_alt <= 0:
        return None
    counts = split_qty(total_alt, per)
    out: list[Carton] = []
    running = 0.0
    for i, count in enumerate(counts):
        if i == len(counts) - 1:
            qty = round(float(lot_qty) - running, 4)
        else:
            qty = round(count * factor, 4)
            running = round(running + qty, 4)
        if qty <= 0:
            # The remainder box came out empty (the draw divides exactly into the
            # counts above): drop it rather than mint a zero-qty label.
            continue
        out.append(Carton(qty, None, round(count, 4)))
    return out or None


def describe_box_breakdown(qtys: list[float]) -> str:
    """Human-readable box breakdown for an audit log entry, e.g. "5 × 5 + 1 × 3".

    Groups equal-sized boxes together (largest first) rather than listing every
    carton, since a bulk log event can mint dozens of identically-sized boxes.
    """
    counts = Counter(round(float(q), 4) for q in qtys)
    return " + ".join(
        f"{n} × {q:g}" for q, n in sorted(counts.items(), key=lambda kv: -kv[0])
    )


def allocate_boxes_to_lots(
    lot_qtys: list[float],
    boxes: list[float],
    weights: Optional[list[Optional[float]]] = None,
    alt_qtys: Optional[list[Optional[float]]] = None,
    packaging_type_ids: Optional[list] = None,
    tares: Optional[list[Optional[float]]] = None,
    lot_sizes: Optional[list] = None,
    package_label: str = "Box",
) -> list[list[Carton]]:
    """Assign a user-edited, FIFO-ordered list of box quantities across lots.

    A physical carton can only be pegged to one lot (BatchConsumption is 1:1),
    so a box that doesn't fit in what's left of the current lot splits there —
    the leftover continues into the next lot as its own carton. This is what
    lets the packer edit one flat box list without caring which lot backs each
    box; the split only becomes visible (as one extra carton) at a lot seam.

    `lot_sizes` (a `LotSize | None` per lot, positional) is the one thing the
    packer DOES have to care about. A seam split is invisible when both lots are
    the same goods, but a box straddling an M lot and an L lot is a box with two
    sizes physically inside it — there is no size to print on its label, and the
    carton it mints would go out unlabelled for size. So that split is refused and
    named, rather than silently produced. Packing several sizes in one event stays
    fine; only a single box spanning them is not. Lots with no size stamp are
    unknown, not a disagreement, so they never trigger this.

    `weights` is the packer's scale reading per box and `alt_qtys` the packed
    count in the order's alt selling unit, both positional against `boxes`. A box
    that splits at a lot seam is physically two cartons, so neither figure still
    describes either half:

    * weight is shared out pro-rata by qty;
    * the alt count is shared by qty too, but the running remainder is carried so
      the parts still SUM to the count the packer stated — a discrete count must
      not gain or lose a piece to rounding.

    `packaging_type_ids` and `tares` are the box itself, also positional against
    `boxes`. Unlike weight and count they are NOT shared at a seam — they describe
    one physical box, and both halves of a split are that same box, so each piece
    carries the whole value and the re-merge picks it up unchanged.

    Returns `Carton` rows; a weight is None only where the caller passed none,
    which `assert_all_weighed` then rejects.
    """
    total_lots = round(sum(float(q) for q in lot_qtys), 4)
    total_boxes = round(sum(float(b) for b in boxes), 4)
    if abs(total_lots - total_boxes) > 1e-3:
        raise ValueError(
            f"Boxes total {total_boxes:g} does not match the {total_lots:g} being packed"
        )

    def _at(seq, i):
        if seq is None or i >= len(seq) or seq[i] is None:
            return None
        return float(seq[i])

    # (remaining qty, original qty, original weight, remaining alt count, box
    # index) — the original qty is kept so a split share stays proportional to
    # the whole box, the alt count is drawn down so the shares always sum back
    # to it, and the index (position in the caller's `boxes` list) rides along
    # unchanged across every split so the caller can re-merge a seam-split box.
    queue: deque[tuple[float, float, Optional[float], Optional[float], int]] = deque()
    for i, b in enumerate(boxes):
        qty = round(float(b), 4)
        if qty <= 1e-9:
            continue
        queue.append((qty, qty, _at(weights, i), _at(alt_qtys, i), i))

    def _pkg(i: int):
        if packaging_type_ids is None or i >= len(packaging_type_ids):
            return None
        return packaging_type_ids[i]

    # box index -> (lot index, LotSize) of the first sized lot that fed it, so a
    # later lot of a different size is caught at the seam it crosses.
    box_size_owner: dict[int, tuple[int, LotSize]] = {}

    out: list[list[Carton]] = []
    for lot_idx, lot_qty in enumerate(lot_qtys):
        this_size = lot_sizes[lot_idx] if lot_sizes and lot_idx < len(lot_sizes) else None
        remaining = round(float(lot_qty), 4)
        cartons: list[Carton] = []
        while remaining > 1e-6 and queue:
            box, box_full, box_w, box_alt, box_idx = queue[0]
            if this_size is not None:
                owner = box_size_owner.get(box_idx)
                if owner is not None and owner[1].key != this_size.key:
                    raise ValueError(
                        f"{package_label} {box_idx + 1} would span two sizes "
                        f"({owner[1].label} and {this_size.label}) — a "
                        f"{package_label.lower()} holds one size, so its label can name it. "
                        f"Split it into one {package_label.lower()} per size, or pack the sizes "
                        f"in separate entries."
                    )
                box_size_owner.setdefault(box_idx, (lot_idx, this_size))
            take = round(min(box, remaining), 4)
            share = None if box_w is None else round(box_w * take / box_full, 4)
            whole_box = take >= box - 1e-6
            if box_alt is None:
                alt_share = None
            elif whole_box:
                # Last slice of this box takes whatever count is left, so the
                # parts add up exactly.
                alt_share = round(box_alt, 4)
            else:
                alt_share = round(box_alt * take / box, 4)
            cartons.append(Carton(
                take, share, alt_share, box_idx,
                packaging_type_id=_pkg(box_idx), tare_kg=_at(tares, box_idx),
            ))
            remaining = round(remaining - take, 4)
            if whole_box:
                queue.popleft()
            else:
                rest_alt = None if box_alt is None else round(box_alt - (alt_share or 0), 4)
                queue[0] = (round(box - take, 4), box_full, box_w, rest_alt, box_idx)
        out.append(cartons)
    return out


def fill_alt_qtys(cartons: list[Carton], base_factor: Optional[float]) -> list[Carton]:
    """Back-fill the alt count on cartons the caller didn't state one for.

    The box-size path (mobile scanner, a bulk log with no per-box entry) never
    sends counts, but the carton label still has to print one. Derived via
    `base_to_alt`, so a stated count is always preferred over a computed one.
    """
    if not base_factor or float(base_factor) <= 0:
        return cartons
    return [
        c if c.alt_qty is not None else c._replace(alt_qty=base_to_alt(c.qty, base_factor))
        for c in cartons
    ]


# UOMs whose base qty already IS a weight in kg. For those the carton's qty and
# its net weight are the same measurement, so asking the packer for both invites
# two figures that disagree on the label (CONTENT and N.W. would contradict each
# other). Anything else — pcs, yard, m, l — is a count or a length, and its weight
# is a separate reading off the scale.
KG_UOMS = {"kg", "kgs", "kilogram", "kilograms"}


def uom_is_kg(uom: Optional[str]) -> bool:
    return (uom or "").strip().lower() in KG_UOMS


def derive_weights_from_qty(
    carton_qtys: list[Carton],
    uom: Optional[str],
) -> list[Carton]:
    """For a kg-based item, the carton qty is the net weight — take it from there.

    Derived rather than merely defaulted: a client that sent a *different* weight
    for a kg item would be stating the same carton weighs two things. One
    measurement, one source.
    """
    if not uom_is_kg(uom):
        return carton_qtys
    return [c._replace(weight_kg=float(c.qty)) for c in carton_qtys]


def assert_all_weighed(carton_qtys: list[Carton], package_label: str = "carton") -> None:
    """Every carton must carry the packer's scale reading.

    Packing is logged *after* the boxes are physically packed and weighed, so an
    unweighed carton is a missing measurement rather than one taken later — and
    it would print a carton label with a blank N.W. line and an empty net-weight
    barcode. Enforced here rather than in the form so no caller (desktop modal,
    mobile scanner, a future API client) can mint one.
    """
    missing = [
        i + 1 for i, c in enumerate(carton_qtys)
        if c.weight_kg is None or float(c.weight_kg) <= 0
    ]
    if missing:
        label = (package_label or "carton").lower()
        raise ValueError(
            f"Net weight is required for every {label} — "
            f"{len(missing)} of {len(carton_qtys)} not weighed"
        )


async def resolve_carton_tares(
    db: AsyncSession,
    carton_qtys: list[Carton],
    package_label: str = "carton",
) -> list[Carton]:
    """Fill each carton's `tare_kg` from its packaging type, or from the packer.

    The master's tare is authoritative for a standard box; only a type flagged
    `is_custom` takes the hand-weighed figure the packer typed. Anything the
    caller sent for a standard box is DROPPED rather than trusted — a re-picked
    row can leave a stale custom tare behind in the form, and a box whose brutto
    silently disagreed with every other box of the same type is exactly the kind
    of error a delivery note carries out of the building.

    The value is copied onto the carton (and from there onto the `Batch`) rather
    than read through the FK later: see the snapshot note in models/batch.py.
    """
    ids = {c.packaging_type_id for c in carton_qtys if c.packaging_type_id}
    types: dict = {}
    if ids:
        rows = (await db.execute(
            select(PackagingType).filter(PackagingType.id.in_(list(ids)))
        )).scalars().all()
        types = {row.id: row for row in rows}
        missing = [str(i) for i in ids if i not in types]
        if missing:
            raise ValueError(f"Unknown packaging type: {', '.join(missing)}")

    label = (package_label or "carton").lower()
    out: list[Carton] = []
    for idx, c in enumerate(carton_qtys):
        pt = types.get(c.packaging_type_id) if c.packaging_type_id else None
        if pt is None:
            out.append(c._replace(tare_kg=None))
            continue
        if pt.is_custom:
            if c.tare_kg is None or float(c.tare_kg) <= 0:
                raise ValueError(
                    f"{package_label} {idx + 1} is a {pt.name} — weigh the empty "
                    f"{label} and enter its tare, or pick a standard packaging type"
                )
            out.append(c._replace(tare_kg=round(float(c.tare_kg), 4)))
        else:
            out.append(c._replace(tare_kg=round(float(pt.tare_kg or 0), 4)))
    return out


def gross_weight(net_kg: Optional[float], tare_kg: Optional[float]) -> Optional[float]:
    """Brutto = the packer's net reading plus the empty box.

    None when there is no net reading to add to — a carton with no scale reading
    never reaches minting (`assert_all_weighed`), so this only returns None for
    the historic rows that predate weighing.
    """
    if net_kg is None:
        return None
    return round(float(net_kg) + float(tare_kg or 0), 4)


def assert_all_boxed(carton_qtys: list[Carton], package_label: str = "carton") -> None:
    """Every carton must name the packaging it went into.

    Brutto is printed on the carton label and totalled on the delivery note, and
    a carton with no packaging type has no tare to add — its gross would silently
    equal its net and understate the shipment. Enforced beside
    `assert_all_weighed` and for the same reason: so no caller can mint one.
    """
    missing = [i + 1 for i, c in enumerate(carton_qtys) if not c.packaging_type_id]
    if missing:
        label = (package_label or "carton").lower()
        raise ValueError(
            f"Packaging type is required for every {label} — "
            f"{len(missing)} of {len(carton_qtys)} not set"
        )


async def resolve_lot_variant(db: AsyncSession, po: PackingOrder, batch_id) -> tuple[list, object, float]:
    """Variant identity + available qty of one source lot at the order's source store.

    The picked lot pins an exact `StockBalance` row, and that row's `variant_key`
    already IS the variant the bulk FG is held under — so the variant is read back
    off the stock rather than restated on the packing order. This is why the create
    form asks for a lot instead of a variant: a hand-picked variant that disagreed
    with the stock minted cartons into an empty pool while the real stock sat
    untouched.
    """
    rows = (await db.execute(
        select(StockBalance).filter(
            StockBalance.item_id == po.item_id,
            StockBalance.location_id == po.source_location_id,
            StockBalance.batch_key == str(batch_id),
            StockBalance.qty > 0,
        ).order_by(StockBalance.qty.desc())
    )).scalars().all()
    if not rows:
        raise ValueError("Lot has no stock at the packing order's source location")
    # A lot is one physical thing, so one variant — take the largest row if a
    # legacy split ever produced more than one.
    #
    # When the order *does* declare a variant (created from the quarantine desk's
    # Pack button, or inherited from an SO line), a lot of a different shade is
    # refused rather than silently packed: reading the variant off the lot is what
    # keeps stock honest, but it would otherwise let a black lot be boxed as
    # cartons of an order whose SO line, labels and pick list all say navy.
    want = stock_service._generate_variant_key(
        [str(v.id) for v in (po.attribute_values or [])], po.color_id
    )
    if not stock_service.variant_matches(want, rows[0].variant_key or ""):
        raise ValueError(
            "Lot is a different variant from the one this packing order is packing "
            "— pick a lot of the order's own colour/variant"
        )
    attr_ids, color_id = stock_service._parse_variant_key(rows[0].variant_key)
    return attr_ids, color_id, float(rows[0].qty)


async def resolve_bulk_variant(db: AsyncSession, po: PackingOrder) -> tuple[list, object]:
    """Variant for a pack event with no source lot (non-lot-tracked FG).

    Prefers the order's own attribute values when it has them (SO-line inheritance
    still sets these). Otherwise derives from the un-lotted stock at the source
    location — unambiguous when only one variant is held there, which is the
    normal case for a single FG item in a single bin.
    """
    if po.attribute_values or po.color_id:
        return [str(v.id) for v in (po.attribute_values or [])], po.color_id
    rows = (await db.execute(
        select(StockBalance.variant_key, func.sum(StockBalance.qty))
        .filter(
            StockBalance.item_id == po.item_id,
            StockBalance.location_id == po.source_location_id,
            StockBalance.batch_key == "",
            StockBalance.qty > 0,
        )
        .group_by(StockBalance.variant_key)
    )).all()
    if not rows:
        return [], None
    if len(rows) > 1:
        raise ValueError(
            "Several variants of this item are in stock at the source location — "
            "select a lot so the variant is unambiguous"
        )
    return stock_service._parse_variant_key(rows[0][0])


async def _next_package_no(db: AsyncSession, packing_order_id) -> int:
    """Carton numbering continues across the whole packing order, not per event.

    Allocated off a per-order number range. max(package_no)+1 raced: two packers
    scanning the same Kartu Packing at once both read the same maximum, and
    `package_no` has no unique constraint — so two cartons went out with the same
    number on their labels and the pick list could not tell them apart."""
    async def _seed() -> int:
        return int((await db.execute(
            select(func.max(Batch.package_no)).filter(Batch.packing_order_id == packing_order_id)
        )).scalar() or 0)

    return await numbering_service.allocate(db, f"PACKED_UNIT:{packing_order_id}", seed=_seed)


def _size_ident(bom_size_id, snapshot) -> Optional[str]:
    """Comparison key for one lot's size — the ONE definition of "same size".

    Prefers `bom_size_id`; falls back to the snapshot when a lot has no id (a
    free-mode size, or a BOMSize since deleted). `json.dumps(sort_keys=True)`
    rather than `str(dict)`, because two equal snapshots can stringify differently
    by key order. Returns None for an unsized lot — which everywhere here means
    *unknown*, never "a different size".
    """
    if bom_size_id:
        return str(bom_size_id)
    if snapshot:
        return json.dumps(snapshot, sort_keys=True, default=str)
    return None


class LotSize(NamedTuple):
    """One lot's size: the comparison key, plus the label to say it out loud."""
    key: str
    label: str


async def lot_sizes(db: AsyncSession, batch_ids) -> list:
    """Per-lot sizes, aligned positionally to `batch_ids` (None where unsized).

    Aligned rather than collapsed because the box allocator needs to know WHICH
    lot boundary two sizes meet at, not merely that the draw spans more than one.
    One query for the whole submission.
    """
    from app.services.stock_service import _bom_size_label

    ids = {str(x) for x in batch_ids if x}
    by_id: dict = {}
    if ids:
        rows = (await db.execute(
            select(Batch.id, Batch.bom_size_id, Batch.bom_size_snapshot).filter(Batch.id.in_(ids))
        )).all()
        for bid, sid, snap in rows:
            key = _size_ident(sid, snap)
            if key:
                by_id[str(bid)] = LotSize(key, _bom_size_label(snap) or "unnamed size")
    return [by_id.get(str(x)) if x else None for x in batch_ids]


async def lot_size_identity(db: AsyncSession, batch_ids) -> tuple:
    """The `(bom_size_id, bom_size_snapshot)` a carton inherits from its source lot(s).

    Size is the one part of a lot's identity that is NOT folded into
    `variant_key` — it is stamped on the `Batch` row itself at WO completion — so
    unlike shade/combo it cannot be read back off the carton's StockBalance row.
    It has to be copied forward at mint time or it is simply lost the moment bulk
    FG becomes a carton.

    A box fed by several lots keeps the size only when every contributing lot that
    carries one agrees; a genuinely mixed-size box has no single size and says so
    with None rather than picking whichever lot happened to close it out. Lots with
    no size stamp are unknown, not a disagreement, so they don't veto.

    `allocate_boxes_to_lots` now refuses to build such a box in the first place, so
    on the explicit-box path this disagreement should be unreachable; it stays as
    the honest answer for any path that does not go through the allocator.
    """
    ids = [b for b in dict.fromkeys(str(x) for x in batch_ids if x)]
    if not ids:
        return None, None
    rows = (await db.execute(
        select(Batch.bom_size_id, Batch.bom_size_snapshot).filter(Batch.id.in_(ids))
    )).all()
    sized = [(sid, snap) for sid, snap in rows if sid or snap]
    if not sized:
        return None, None
    if len({_size_ident(sid, snap) for sid, snap in sized}) > 1:
        return None, None
    return sized[0]


async def mint_packed_units(
    db: AsyncSession,
    po: PackingOrder,
    completion: PackingCompletion,
    carton_qtys: list[Carton],
    attribute_value_ids: list[str],
    color_id,
    username: Optional[str] = None,
    source_batch_id=None,
) -> list[tuple[Batch, float]]:
    """Consume bulk FG and mint one carton per `(qty, net_weight_kg)` entry.

    The caller decides the split (a fixed box size via `split_qty`, or an
    explicit user-edited list via `allocate_boxes_to_lots`) — this function
    just mints whatever list it's handed. Net weight is the packer's scale
    reading for that physical carton (None when not weighed); it is a measured
    figure, never derived from qty, which is why it is captured per box at pack
    time rather than computed here. `alt_qty` rides along the same way — the
    count the packer put in the box, in the order's alt selling unit. Stock moves twice per carton: OUT of
    the packing order's source location on the incoming lot, IN at the output
    location keyed by the new carton batch. `BatchConsumption` pegs input lot ->
    carton so lot genealogy survives packing. Returns each minted carton
    alongside its qty, so a caller can render the box breakdown (e.g. for an
    audit log entry) without recomputing the split.
    """
    if not po.output_location_id:
        raise ValueError("Packing order has no output location")
    if not po.source_location_id:
        raise ValueError("Packing order has no source location")

    completion.package_count = len(carton_qtys)
    units: list[tuple[Batch, float]] = []
    # Size rides forward from the source lot; shade/combo/attributes do not need
    # to, because they travel in the stock key written below. See lot_size_identity.
    bom_size_id, bom_size_snapshot = await lot_size_identity(db, [source_batch_id])

    for carton in carton_qtys:
        # Read by name, not by unpacking: `Carton` has already grown a field once
        # (`box_index`) and positional unpacking turned that into a 400 on the
        # floor — "too many values to unpack (expected 3)" — for every pack event
        # on the box-size path.
        carton_qty, net_weight, alt_qty = carton.qty, carton.weight_kg, carton.alt_qty
        pu = Batch(
            batch_number=await generate_batch_number(db, prefix=PACKED_UNIT_PREFIX),
            item_id=po.item_id,
            packing_order_id=po.id,
            packing_completion_id=completion.id,
            bom_size_id=bom_size_id,
            bom_size_snapshot=bom_size_snapshot,
            weight_kg=net_weight,
            alt_qty=alt_qty,
            # The box and its tare, snapshotted, plus net + tare. See models/batch.py.
            packaging_type_id=carton.packaging_type_id,
            tare_kg=carton.tare_kg,
            gross_weight_kg=gross_weight(net_weight, carton.tare_kg),
            # Allocated per carton, not as a pre-reserved block: a block computed
            # up front overlaps a completion posted concurrently on the same order.
            package_no=await _next_package_no(db, po.id),
            package_label=po.package_label or "Carton",
            # Soft tag only — a carton packed for an SO stays pickable by any
            # pick list. See the design note on models/packing.py.
            packed_for_so_id=po.sales_order_id,
            created_by=username,
        )
        db.add(pu)
        await db.flush()

        await stock_service.add_stock_entry(
            db,
            item_id=po.item_id,
            location_id=po.source_location_id,
            qty_change=-float(carton_qty),
            reference_type="PACKING",
            reference_id=po.code,
            attribute_value_ids=attribute_value_ids,
            color_id=color_id,
            batch_id=source_batch_id,
        )
        await stock_service.add_stock_entry(
            db,
            item_id=po.item_id,
            location_id=po.output_location_id,
            qty_change=float(carton_qty),
            reference_type="PACKING",
            reference_id=po.code,
            attribute_value_ids=attribute_value_ids,
            color_id=color_id,
            batch_id=pu.id,
        )

        if source_batch_id:
            db.add(BatchConsumption(
                packing_order_id=po.id,
                input_batch_id=source_batch_id,
                output_batch_id=pu.id,
                qty_consumed=float(carton_qty),
            ))
        units.append((pu, carton_qty))

    return units


async def mint_merged_packed_unit(
    db: AsyncSession,
    po: PackingOrder,
    completion: PackingCompletion,
    pieces: list[dict],
    attribute_value_ids: list[str],
    color_id,
    username: Optional[str] = None,
) -> tuple[Batch, float]:
    """Mint ONE physical carton from pieces drawn off one or more source lots.

    A box the packer weighed as one unit must stay one `Batch`/label/QR even
    when `allocate_boxes_to_lots` had to split it at a lot seam to keep each
    piece pegged to a truthful source lot — merging here is what keeps the
    packed-unit count equal to the boxes actually on the floor, not the number
    of lots that fed them. Each `pieces` entry is
    `{qty, weight_kg, alt_qty, packaging_type_id, tare_kg, source_batch_id}`;
    the OUT stock move for each
    piece already happened against its own lot before this is called — this
    only does the single IN move (mint qty) plus one `BatchConsumption` peg per
    contributing lot, so genealogy still traces every gram to its real source.
    """
    if not po.output_location_id:
        raise ValueError("Packing order has no output location")

    total_qty = round(sum(float(p["qty"]) for p in pieces), 4)
    weights = [p["weight_kg"] for p in pieces if p["weight_kg"] is not None]
    weight_kg = round(sum(float(w) for w in weights), 4) if weights else None
    alts = [p["alt_qty"] for p in pieces]
    alt_qty = round(sum(float(a) for a in alts), 4) if all(a is not None for a in alts) else None
    # The box is ONE physical box however many lots fed it, so its packaging is
    # not summed or shared — it is taken whole from the closing piece, the same
    # piece that already supplies this carton's operator and variant identity.
    packaging_type_id = pieces[-1].get("packaging_type_id")
    tare_kg = pieces[-1].get("tare_kg")

    bom_size_id, bom_size_snapshot = await lot_size_identity(
        db, [p["source_batch_id"] for p in pieces]
    )

    pu = Batch(
        batch_number=await generate_batch_number(db, prefix=PACKED_UNIT_PREFIX),
        item_id=po.item_id,
        packing_order_id=po.id,
        packing_completion_id=completion.id,
        bom_size_id=bom_size_id,
        bom_size_snapshot=bom_size_snapshot,
        weight_kg=weight_kg,
        alt_qty=alt_qty,
        packaging_type_id=packaging_type_id,
        tare_kg=tare_kg,
        gross_weight_kg=gross_weight(weight_kg, tare_kg),
        package_no=await _next_package_no(db, po.id),
        package_label=po.package_label or "Carton",
        packed_for_so_id=po.sales_order_id,
        created_by=username,
    )
    db.add(pu)
    await db.flush()

    await stock_service.add_stock_entry(
        db,
        item_id=po.item_id,
        location_id=po.output_location_id,
        qty_change=total_qty,
        reference_type="PACKING",
        reference_id=po.code,
        attribute_value_ids=attribute_value_ids,
        color_id=color_id,
        batch_id=pu.id,
    )

    for p in pieces:
        if p["source_batch_id"]:
            db.add(BatchConsumption(
                packing_order_id=po.id,
                input_batch_id=p["source_batch_id"],
                output_batch_id=pu.id,
                qty_consumed=float(p["qty"]),
            ))

    return pu, total_qty


async def consume_packaging_materials(
    db: AsyncSession,
    po: PackingOrder,
    materials: list,
    default_location_id=None,
) -> None:
    """Deduct free-entry packaging material (carton, poly bag, label) from stock.

    `materials` are PackingCompletionMaterial rows already attached to the
    completion; each may name its own location, otherwise the packing order's
    source location is used.
    """
    for m in materials:
        loc = m.location_id or default_location_id or po.source_location_id
        if not loc or float(m.qty or 0) <= 0:
            continue
        await stock_service.add_stock_entry(
            db,
            item_id=m.item_id,
            location_id=loc,
            qty_change=-float(m.qty),
            reference_type="PACKING_MATERIAL",
            reference_id=po.code,
            batch_id=m.batch_id,
        )


async def allocated_unit_ids(db: AsyncSession) -> set:
    """Carton batch ids already sitting on a live (non-cancelled) pick list.

    Cartons are soft-reserved, not locked to an SO — but a carton already on
    someone else's open pick list must not be suggested twice.
    """
    result = await db.execute(
        select(PickListLine.batch_id)
        .join(PickList, PickListLine.pick_list_id == PickList.id)
        .filter(PickListLine.batch_id.isnot(None), PickList.status != "CANCELLED")
    )
    return {r[0] for r in result.all() if r[0]}


async def available_packed_units(
    db: AsyncSession,
    item_id,
    location_id=None,
    attribute_value_ids: list[str] = [],
    color_id=None,
    exclude_ids: set = None,
    limit: int = 200,
) -> list[tuple[Batch, StockBalance]]:
    """In-stock cartons for an item/variant, oldest first (FIFO).

    Returns (carton, its balance row) pairs so callers get the carton qty without
    a second lookup. Rejected lots are excluded, matching every other picker.
    """
    v_key = _generate_variant_key(attribute_value_ids, color_id)
    query = (
        select(Batch, StockBalance)
        .join(StockBalance, StockBalance.batch_key == cast(Batch.id, String))
        .filter(
            packed_unit_filter(),
            Batch.item_id == item_id,
            Batch.quality_status == "GOOD",
            StockBalance.item_id == item_id,
            StockBalance.variant_key == v_key,
            StockBalance.qty > 0,
        )
        .order_by(Batch.created_at.asc(), Batch.package_no.asc())
        .limit(limit)
    )
    if location_id:
        query = query.filter(StockBalance.location_id == location_id)

    rows = (await db.execute(query)).all()
    if exclude_ids:
        rows = [r for r in rows if r[0].id not in exclude_ids]
    # A carton is atomic, but nothing in the schema stops it having balance rows at
    # more than one location (e.g. after a manual move that left a zeroed row).
    # Keep one row per carton so a pick suggestion can never list the same physical
    # box twice.
    seen = set()
    out = []
    for batch, bal in rows:
        if batch.id in seen:
            continue
        seen.add(batch.id)
        out.append((batch, bal))
    return out


async def suggest_units_for_line(
    db: AsyncSession,
    item_id,
    remaining_qty: float,
    location_id=None,
    attribute_value_ids: list[str] = [],
    color_id=None,
    exclude_ids: set = None,
) -> list[tuple[Batch, float]]:
    """Pick whole cartons FIFO until `remaining_qty` is covered.

    Cartons are indivisible here on purpose: the picker moves a physical box, so
    the last carton may overshoot the outstanding qty rather than be split.
    """
    units = await available_packed_units(
        db, item_id, location_id=location_id,
        attribute_value_ids=attribute_value_ids, color_id=color_id,
        exclude_ids=exclude_ids,
    )
    picked: list[tuple[Batch, float]] = []
    covered = 0.0
    for pu, bal in units:
        if covered >= float(remaining_qty) - 1e-6:
            break
        qty = float(bal.qty)
        picked.append((pu, qty))
        covered += qty
    return picked
