import { baseToAlt } from './altUnit';

// Carton split shared by every pack-logging screen.
//
// Mirrors `packing_service.split_qty` on the backend: a carton is a physical box
// of a known size, so the packer expects floor(total / size) full boxes with only
// the leftover in a smaller final box — never all boxes shrunk to absorb it.
// Both the desktop pack modal and the mobile packing scanner seed their editable
// box rows from this, so the two screens can never disagree about the split.

export type BoxRow = {
    /** Base-UOM qty in this carton. */
    qty: string;
    /** The packer's scale reading for this carton, in kg. Required at log time —
     *  logging happens after the boxes are physically packed and weighed, so a
     *  blank here would print a carton label with no N.W. line. */
    kg: string;
    /** Count in the order's alt selling unit (12 Pcs, 4 Pic). Empty when the
     *  order has no alt unit. On an alt-unit order this is what the packer types
     *  and `qty` derives from it — the count is the thing actually counted, and
     *  for a kg item `qty` ends up being the scale reading, which no longer
     *  divides back into a whole number of pieces. */
    alt: string;
    /** Which `PackagingType` this carton is packed in. Required at log time — the
     *  label prints brutto and the delivery note totals it, and a carton with no
     *  box has no tare to add (`packing_service.assert_all_boxed`). */
    packagingTypeId: string;
    /** Hand-weighed tare of the EMPTY box, in kg. Only meaningful for a type
     *  flagged `is_custom`: a standard box's tare comes off the master and the
     *  server ignores anything sent here for one. */
    tare: string;
    /** Free-text note printed on this carton's label. Optional. */
    note?: string;
};

/** One row of the packaging master (`GET /packaging-types`). */
export type PackagingType = {
    id: string;
    code: string;
    name: string;
    tare_kg: number | null;
    is_custom: boolean;
};

export const findPackagingType = (id: string, types: PackagingType[]) =>
    types.find(t => String(t.id) === String(id));

export const isCustomType = (id: string, types: PackagingType[]) =>
    !!findPackagingType(id, types)?.is_custom;

/** The tare that will actually be used for a carton: the packer's weighing for a
 *  custom box, the master's figure for every other type. Mirrors
 *  `packing_service.resolve_carton_tares` so the footer's brutto preview and the
 *  printed label can never disagree. */
export const effectiveTare = (row: { packagingTypeId: string; tare: string }, types: PackagingType[]): number => {
    const t = findPackagingType(row.packagingTypeId, types);
    if (!t) return 0;
    return t.is_custom ? n(row.tare) : Number(t.tare_kg) || 0;
};

// Parsed the same way the pack screens parse every other numeric field
// (`parseFloat`, not `Number`): the two disagree on a comma decimal and on
// trailing text, so a row could total as weighed in the footer while still
// counting as unweighed in the submit gate — a button dead for no visible reason.
const n = (v: string) => { const parsed = parseFloat(v); return isNaN(parsed) ? 0 : parsed; };

export const splitBoxQtys = (total: number, size: number): number[] => {
    if (total <= 0) return [];
    if (!(size > 0)) return [Number(total.toFixed(4))];
    const full = Math.floor(total / size + 1e-9);
    const remainder = Number((total - full * size).toFixed(4));
    const parts = Array(full).fill(Number(size.toFixed(4)));
    if (remainder > 1e-6) parts.push(remainder);
    return parts.length ? parts : [Number(total.toFixed(4))];
};

// --- Carton groups ---------------------------------------------------------
//
// The pack screens edit cartons as `count × qty each`, not as one row per box:
// a 17 kg pack in 5 kg boxes reads "3 × 5 kg, 1 × 2 kg = 17 kg" rather than a
// four-row list the packer has to add up in their head. Groups are the edited
// shape; `expandBoxGroups` flattens them back to the per-carton rows the server
// is sent, so every downstream helper (totals, alt payload, weight gate) keeps
// working on one carton per entry and nothing about the wire format changes.

export type BoxGroup = {
    /** How many identical cartons this line stands for. */
    count: string;
    /** Base-UOM qty in each carton of the group. */
    qty: string;
    /** Alt-unit count per carton. Empty when the order has no alt unit. */
    alt: string;
    /** Per-carton scale readings, positional inside the group — cartons of the
     *  same qty still weigh differently, so a group holds a weight per box
     *  rather than one for all of them. Unused for a kg item, where the qty in
     *  the box already IS its net weight. May be shorter than `count`; a
     *  missing entry is an unweighed carton. */
    kg: string[];
    /** Packaging type for every carton in the group. Group-level, not per box:
     *  a "3 × 5 kg" line is three identical boxes, and picking the box three
     *  times is the kind of repetition the group shape exists to remove. */
    packagingTypeId: string;
    /** Hand-weighed tare for a custom box, in kg — also group-level, so a group
     *  of custom boxes is one weighing. Split the line if two custom boxes
     *  really differ. Ignored for a standard type. */
    tare: string;
    /** Free-text note printed on the label of every carton in the group —
     *  split the line for a note that only fits one box. */
    note?: string;
};

export const emptyBoxGroup = (): BoxGroup =>
    ({ count: '1', qty: '', alt: '', kg: [], packagingTypeId: '', tare: '' });

/** Cartons the group stands for — a blank or fractional count is floored, since
 *  half a carton is not a thing the floor can pack. */
export const groupCount = (g: BoxGroup): number => Math.max(0, Math.floor(n(g.count)));

/** Base-UOM qty across a whole group. */
export const groupTotal = (g: BoxGroup): number => groupCount(g) * n(g.qty);

/** One row per physical carton — the shape the server is sent. */
export const expandBoxGroups = (groups: BoxGroup[]): BoxRow[] =>
    groups.flatMap(g =>
        Array.from({ length: groupCount(g) }, (_, i) => ({
            qty: g.qty,
            kg: g.kg[i] || '',
            alt: g.alt,
            packagingTypeId: g.packagingTypeId,
            tare: g.tare,
            note: g.note,
        })),
    );

/** The same split run in the alt selling unit — cartons of 12 Pcs, not of 10.8 kg.
 *
 *  A carton holds a whole number of pieces, so on an alt-unit order that count is
 *  what the box size means and the kilos are only what it works out to. Splitting
 *  the kilos instead ends a 130.1 kg draw with a 0.5 kg thirteenth box that is not
 *  a carton of anything. Mirrors `packing_service.cartons_from_alt_split`: the
 *  counts are laid out first, each box's qty is its count converted, and the last
 *  box takes the leftover base qty so the lines still total the draw.
 *
 *  Returns null when there is nothing to split by, which leaves the caller on the
 *  base-qty split. */
const splitBoxesByAlt = (
    total: number,
    altSize: number,
    baseFactor: number,
): { qty: number; alt: number }[] | null => {
    if (!(total > 0) || !(altSize > 0) || !(baseFactor > 0)) return null;
    const totalAlt = baseToAlt(total, baseFactor);
    if (totalAlt === null || totalAlt <= 0) return null;
    const counts = splitBoxQtys(totalAlt, altSize);
    const out: { qty: number; alt: number }[] = [];
    let running = 0;
    counts.forEach((count, i) => {
        const qty = i === counts.length - 1
            ? Number((total - running).toFixed(4))
            : Number((count * baseFactor).toFixed(4));
        if (i < counts.length - 1) running = Number((running + qty).toFixed(4));
        // A remainder box that came out empty (the draw divides exactly) is not a
        // box — dropped rather than shown as a zero-qty line the packer must delete.
        if (qty > 1e-6) out.push({ qty, alt: count });
    });
    return out.length ? out : null;
};

/** The box size an order splits by, in the alt selling unit — null when it has no
 *  alt unit to count in.
 *
 *  The stated count wins; `pack_size` is divided back out only for an order made
 *  before the count was stored (`baseToAlt` snaps to a whole box, which it was
 *  derived from in the first place). Shared so the desktop pack modal and the
 *  mobile scanner can't seed different splits for the same order. */
export const orderBoxSizeAlt = (po: any, baseFactor?: number | null): number | null => {
    if (!baseFactor || baseFactor <= 0) return null;
    const stated = Number(po?.pack_size_alt) || 0;
    if (stated > 0) return stated;
    const derived = baseToAlt(Number(po?.pack_size) || 0, baseFactor);
    return derived && derived > 0 ? derived : null;
};

/** Seed groups for a qty/size, carrying over weights already keyed in.
 *
 *  `altSize` (with `baseFactor`) splits in the counting unit instead and wins when
 *  both are given — see `splitBoxesByAlt`. `size` stays the base-qty fallback for
 *  an order with no alt unit.
 *
 *  Weights are carried positionally across the *flattened* carton list rather
 *  than per group: re-splitting 17 kg from 5 kg boxes into 4 kg boxes changes
 *  how many boxes there are, and carton #2's scale reading still belongs to
 *  carton #2. */
export const seedBoxGroups = (
    total: number,
    size: number,
    prev: BoxGroup[] = [],
    baseFactor?: number | null,
    altSize?: number | null,
): BoxGroup[] => {
    const prevWeights = expandBoxGroups(prev).map(r => r.kg);
    // One carried packaging pick for the whole re-split: the old groups no longer
    // line up with the new ones (a 5 kg split becoming a 4 kg split changes how
    // many boxes there are), so the first group's box is carried rather than
    // matched positionally. Mixed-packaging events are re-picked per line.
    const carriedPackagingTypeId = prev[0]?.packagingTypeId || '';
    const carriedTare = prev[0]?.tare || '';
    const byAlt = baseFactor ? splitBoxesByAlt(total, Number(altSize) || 0, baseFactor) : null;
    if (byAlt) {
        const groups: BoxGroup[] = [];
        for (const box of byAlt) {
            const last = groups[groups.length - 1];
            if (last && n(last.qty) === box.qty && n(last.alt) === box.alt) {
                last.count = String(groupCount(last) + 1);
            } else {
                groups.push({
                    count: '1', qty: String(box.qty), alt: String(box.alt), kg: [],
                    // The box the packer already picked survives a re-split: changing
                    // the split does not change which carton they are packing into,
                    // and re-picking it after every qty edit is pure friction.
                    packagingTypeId: carriedPackagingTypeId, tare: carriedTare,
                });
            }
        }
        let takenAlt = 0;
        for (const g of groups) {
            const size_ = groupCount(g);
            g.kg = prevWeights.slice(takenAlt, takenAlt + size_);
            takenAlt += size_;
        }
        return groups;
    }
    const qtys = splitBoxQtys(total, size);
    // splitBoxQtys emits `full` boxes of `size` then at most one remainder, so
    // the run-length grouping below is at most two lines by construction.
    const groups: BoxGroup[] = [];
    let taken = 0;
    for (const q of qtys) {
        const last = groups[groups.length - 1];
        if (last && n(last.qty) === q) {
            last.count = String(groupCount(last) + 1);
        } else {
            const derived = baseFactor ? baseToAlt(q, baseFactor) : null;
            groups.push({
                count: '1',
                qty: String(q),
                alt: derived !== null ? String(derived) : '',
                kg: [],
                packagingTypeId: carriedPackagingTypeId,
                tare: carriedTare,
            });
        }
    }
    for (const g of groups) {
        const n_ = groupCount(g);
        g.kg = prevWeights.slice(taken, taken + n_);
        taken += n_;
    }
    return groups;
};

// UOMs whose base qty already IS a weight in kg — mirrors `packing_service.KG_UOMS`.
// For those, a carton's qty and its net weight are the same measurement, so the
// pack screens show ONE input and the server derives the weight from the qty;
// asking twice would let the label's CONTENT and N.W. lines contradict. Any other
// UOM (pcs, yard, m, l) is a count or a length whose weight is a separate reading.
// Defined in `altUnit` (the conversion module needs the same test) and re-exported
// here so the pack screens keep importing it from one place.
export { uomIsKg } from './altUnit';

/** Rows that carry a qty — the ones actually sent to the server. */
export const filledBoxRows = (rows: BoxRow[]) => rows.filter(b => n(b.qty) > 0);

/** True when any carton is still unweighed; the server rejects those. */
export const hasUnweighedBox = (rows: BoxRow[]) =>
    filledBoxRows(rows).some(b => !(n(b.kg) > 0));

/** Total alt count across the filled rows, for the pack footer. */
export const boxAltTotal = (rows: BoxRow[]) =>
    filledBoxRows(rows).reduce((s, b) => s + n(b.alt), 0);

/** Alt counts to send, positional against `filledBoxRows` — null where the packer
 *  stated none, so the server derives that one rather than guessing all of them. */
export const boxAltPayload = (rows: BoxRow[]): (number | null)[] =>
    filledBoxRows(rows).map(b => (n(b.alt) > 0 ? n(b.alt) : null));

// --- Packaging -------------------------------------------------------------

/** True when any carton has no packaging type; the server rejects those. */
export const hasUnboxedBox = (rows: BoxRow[]) =>
    filledBoxRows(rows).some(b => !b.packagingTypeId);

/** True when a custom-box carton is missing its hand-weighed tare. Standard
 *  boxes carry their tare on the master, so only the custom ones can be short. */
export const hasUnweighedTare = (rows: BoxRow[], types: PackagingType[]) =>
    filledBoxRows(rows).some(b => isCustomType(b.packagingTypeId, types) && !(n(b.tare) > 0));

/** Packaging types to send, positional against `filledBoxRows`. */
export const boxPackagingPayload = (rows: BoxRow[]): (string | null)[] =>
    filledBoxRows(rows).map(b => b.packagingTypeId || null);

/** Tares to send, positional against `filledBoxRows`. Only a custom box's is
 *  sent: the server takes the master's tare for every other type, and shipping a
 *  stale figure from a re-picked row would just be noise on the wire. */
/** Carton notes to send, positional against `filledBoxRows`. */
export const boxNotePayload = (rows: BoxRow[]): (string | null)[] =>
    filledBoxRows(rows).map(b => b.note?.trim() || null);

export const boxTarePayload = (rows: BoxRow[], types: PackagingType[]): (number | null)[] =>
    filledBoxRows(rows).map(b =>
        isCustomType(b.packagingTypeId, types) && n(b.tare) > 0 ? n(b.tare) : null);
