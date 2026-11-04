// Alt (selling) unit conversion, shared by every screen that packs or prints a
// packed carton. Mirrors `backend/app/services/packing_service.py` — the chain is
// stated once there and once here, and nowhere else.
//
// A customer counts in Pic (a roll) or Pcs (a cut piece) while the item may be
// stocked in kg, so alt -> base is up to two hops:
//
//     alt --(uom2_factor, in uom2LengthUom)--> length --(item g/y or g/m)--> kg
//
// `uom2_factor` is the qty of ONE alt unit as the UOM master states it, the same
// meaning it carries on a sales order line, so a packing order snapshotted off
// the line needs no translation. That unit is usually a length (`1 Pic = 50 m`)
// but not always — `1 Box = 10 kg` is a seeded row too, and a factor already in
// the item's stock UOM skips the second hop entirely.

export const YARDS_PER_METER = 1 / 0.9144;

const LENGTH_ALIASES: Record<string, 'yard' | 'meter'> = {
    yard: 'yard', yards: 'yard', yd: 'yard', yds: 'yard', y: 'yard',
    meter: 'meter', meters: 'meter', metre: 'meter', metres: 'meter', m: 'meter',
};

// Mirrors `packing_service.KG_UOMS`. Kept here rather than imported from
// packingBoxes so this module stands alone; the two lists must not diverge.
const KG_UOMS = ['kg', 'kgs', 'kilogram', 'kilograms'];

export const normalizeLengthUom = (uom?: string | null): 'yard' | 'meter' | null =>
    LENGTH_ALIASES[String(uom || '').trim().toLowerCase()] ?? null;

export const uomIsKg = (uom?: string | null) =>
    KG_UOMS.includes(String(uom || '').trim().toLowerCase());

export const convertLength = (qty: number, from?: string | null, to?: string | null): number | null => {
    const f = normalizeLengthUom(from);
    const t = normalizeLengthUom(to);
    if (!f || !t) return null;
    if (f === t) return qty;
    return qty * (t === 'yard' ? YARDS_PER_METER : 0.9144);
};

export type AltUnitSpec = {
    /** Qty of one alt unit as the UOM master states it — 5 for "1 Pcs = 5 yard". */
    factor?: number | null;
    /** The unit that factor is quoted in ('Yard' / 'm' / 'kg'). A length is
     *  converted onward; the stock unit is used as it stands; anything
     *  unresolvable falls back to yard. */
    lengthUom?: string | null;
    /** The item's own stock UOM — what qty_target and every stock row are in. */
    itemUom?: string | null;
    /** Item.weight_per_unit + Item.weight_unit, only used for a kg-stocked item. */
    weightPerUnit?: number | null;
    weightUnit?: string | null;
};

/** Base-UOM qty in one alt unit, or null when the chain can't be resolved.
 *
 *  `lengthUom` is what the factor is quoted in, and on the real UOM master that is
 *  not always a length — the seeded rows include `1 Pic = 50 m` but also
 *  `1 Box = 10 kg`. A factor already quoted in the item's stock UOM is taken as it
 *  stands; only a genuine length is converted.
 *
 *  Only `g/y` and `g/m` turn a length into a weight; `gsm` / `g/m²` need the
 *  fabric width, so those give null rather than a figure wrong by the width —
 *  the same refusal the sales order form's own kg auto-calc makes. */
export const basePerAlt = (spec: AltUnitSpec): number | null => {
    const factor = Number(spec.factor) || 0;
    if (factor <= 0) return null;

    const quoted = String(spec.lengthUom || '').trim().toLowerCase();
    const stocked = String(spec.itemUom || '').trim().toLowerCase();
    // Already the stock unit: `1 Box = 10 kg` on a kg item is the whole
    // conversion, and the length path would read that 10 as yards.
    if (quoted && (quoted === stocked || (uomIsKg(quoted) && uomIsKg(stocked)))) {
        return Math.round(factor * 1e6) / 1e6;
    }
    const resolved = normalizeLengthUom(spec.lengthUom);
    // A real unit that is neither a length nor the stock unit — nothing bridges it.
    if (quoted && !resolved) return null;
    // Legacy factors were all entered against yard, which is also the SO view's
    // own fallback, so an unresolved unit must not become a null factor.
    const src = resolved || 'yard';

    if (uomIsKg(spec.itemUom)) {
        const gpu = Number(spec.weightPerUnit) || 0;
        const unit = String(spec.weightUnit || '').trim().toLowerCase();
        if (gpu <= 0 || (unit !== 'g/y' && unit !== 'g/m')) return null;
        const length = convertLength(factor, src, unit === 'g/y' ? 'yard' : 'meter');
        if (length === null) return null;
        return Math.round(length * gpu / 1000 * 1e6) / 1e6;
    }

    const dest = normalizeLengthUom(spec.itemUom);
    if (dest) {
        const converted = convertLength(factor, src, dest);
        return converted === null ? null : Math.round(converted * 1e6) / 1e6;
    }
    // A counted base UOM (pcs, roll): nothing here can establish that one alt
    // unit is one base unit, so the caller falls back to base-only entry.
    return null;
};

export const altToBase = (qtyAlt: number, baseFactor?: number | null): number | null => {
    const f = Number(baseFactor) || 0;
    if (f <= 0) return null;
    return Math.round(qtyAlt * f * 1e4) / 1e4;
};

/** Alt count implied by a base qty — a fallback for cartons with no stated count.
 *
 *  Snaps to a whole count within 5%: for a kg item the base qty is a SCALE
 *  reading, so a box holding 12 Pcs weighs 10.62kg against a theoretical 10.80
 *  and divides out to 11.8 pieces. Outside that band the raw figure is kept,
 *  since the box then genuinely doesn't hold a whole number of pieces. */
export const baseToAlt = (qtyBase: number, baseFactor?: number | null, snap = true): number | null => {
    const f = Number(baseFactor) || 0;
    if (f <= 0) return null;
    const raw = qtyBase / f;
    if (snap) {
        const nearest = Math.round(raw);
        if (nearest >= 1 && Math.abs(raw - nearest) <= 0.05 * nearest) return nearest;
    }
    return Math.round(raw * 100) / 100;
};

/** Length in one alt unit, for the label's CONTENT line ("12 Pcs / 60 Yd").
 *
 *  Null when the factor isn't a length at all (`1 Box = 10 kg`) — the label then
 *  brackets the base qty alone rather than printing kilos labelled as yards. */
export const lengthPerAlt = (spec: AltUnitSpec): { qty: number; uom: string } | null => {
    const factor = Number(spec.factor) || 0;
    if (factor <= 0) return null;
    const src = normalizeLengthUom(spec.lengthUom);
    if (!src) return null;
    return { qty: factor, uom: src === 'yard' ? 'Yd' : 'm' };
};

/** The alt-unit spec of a packing order, from its API payload + the item row.
 *
 *  `uom2_base_factor` is served by the API (one server-side conversion, shared by
 *  every screen); the item fields are only needed to recompute it locally while a
 *  create form is still being typed. */
export const orderAltSpec = (po: any, item?: any): AltUnitSpec => {
    // The operator's own sampling of THIS cloth beats the item master, which
    // holds the estimate taken when the style was developed. Both halves must be
    // present to count — mirrors `packing_service.order_weight_spec`, so a screen
    // computing locally and the server's `uom2_base_factor` never disagree.
    const sampled = Number(po?.sample_weight_per_unit) || 0;
    const sampledUnit = po?.sample_weight_unit || null;
    const useSample = sampled > 0 && !!sampledUnit;
    return {
        factor: po?.uom2_factor ?? null,
        lengthUom: po?.uom2_length_uom ?? null,
        itemUom: po?.item_uom || item?.uom || null,
        weightPerUnit: useSample ? sampled : (item?.weight_per_unit ?? null),
        weightUnit: useSample ? sampledUnit : (item?.weight_unit ?? null),
    };
};

/** Base qty per alt unit for an order: the server's figure when it sent one,
 *  else computed from the same inputs. */
export const orderBasePerAlt = (po: any, item?: any): number | null => {
    if (!po?.uom2) return null;
    const served = Number(po?.uom2_base_factor) || 0;
    if (served > 0) return served;
    return basePerAlt(orderAltSpec(po, item));
};

/** "12 Pcs" / "12 Pcs (60 Yd)" for display next to a base figure. */
/** " @ 36 Yd" — what ONE alt unit holds, off a carton's packing order. A non-length
 *  factor (`1 Box = 10 kg`) shows as quoted; '' when there is no factor. */
export const altPerUnit = (factor?: number | null, factorUom?: string | null): string => {
    if (!factor) return '';
    const len = lengthPerAlt({ factor, lengthUom: factorUom });
    return ` @ ${(len?.qty ?? factor).toLocaleString()} ${len?.uom ?? factorUom ?? ''}`.trimEnd();
};

export const formatAlt = (
    qtyAlt: number | null | undefined,
    uom?: string | null,
    opts: { length?: number | null; lengthUom?: string | null } = {},
): string => {
    if (qtyAlt === null || qtyAlt === undefined || !uom) return '';
    const count = Math.round(Number(qtyAlt) * 100) / 100;
    const head = `${count.toLocaleString()} ${uom}`;
    const len = Number(opts.length) || 0;
    if (len > 0) {
        const total = Math.round(count * len * 100) / 100;
        return `${head} (${total.toLocaleString()} ${opts.lengthUom || 'Yd'})`;
    }
    return head;
};
