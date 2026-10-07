'use client';

import React from 'react';
import { VariantChip, VariantKind, resolveColorHex } from './xpTheme';

/**
 * Shared lot-identity chips for lot/beam pickers (WO staging, WO completion,
 * bag scanning). A produced lot's number alone doesn't tell an operator what it
 * is — two GRG- lots off the same item differ only by size and combo/shade. The
 * backend resolves those onto every batch (`bom_size_snapshot` on the lot itself,
 * `variant_attributes` + Color Library fields from the producing MO), so every
 * picker labels a lot the same way instead of hand-rolling its own text line.
 */

export interface LotVariantAttr {
    name: string;
    value: string;
    hex?: string | null;
    system_role?: string | null;
}

export interface LotLike {
    bom_size_id?: string | null;
    bom_size_snapshot?: { size_name?: string | null; label?: string | null } | null;
    // Already-resolved size text, for rows that never carry a snapshot: an SO
    // line's size is a live BOMSize row, not a stamped copy, so the server sends
    // the label alone (SalesOrderLineResponse / PickableOrderLine).
    size_label?: string | null;
    variant_attributes?: LotVariantAttr[] | null;
    color_code?: string | null;
    color_name?: string | null;
    color_hex?: string | null;
    labdip_variant_code?: string | null;
    vendor_lot?: string | null;
    location_name?: string | null;
    wo_code?: string | null;
    mo_code?: string | null;
    [k: string]: any;
}

export const lotSizeLabel = (b: LotLike): string | null => {
    const s = b?.bom_size_snapshot;
    if (!s) return (b?.size_label || '').trim() || null;
    return ((s.size_name || s.label || '') as string).trim() || null;
};

/**
 * "72 (70–74) cm" off a BOMSize row or snapshot; '' when unmeasured. Mirror of
 * `stock_service.size_measurement`, which serves the same text on SO lines.
 */
export const sizeMeasurement = (bs: any): string => {
    if (!bs) return '';
    const n = (v: any) => parseFloat(v);
    const range = bs.measurement_min != null && bs.measurement_max != null ? `${n(bs.measurement_min)}–${n(bs.measurement_max)}` : '';
    if (bs.target_measurement != null) return `${n(bs.target_measurement)}${range ? ` (${range})` : ''} cm`;
    return range ? `${range} cm` : '';
};

/**
 * Printed size: the name plus its measurement, "L 72 (70–74) cm". Display only —
 * compare on `lotSizeKey` (or `lotSizeLabel`), never on this.
 */
export const lotSizeText = (b: LotLike): string | null => {
    const name = lotSizeLabel(b) || '';
    const m = sizeMeasurement(b?.bom_size_snapshot);
    // A measurement-only free size is already labelled "157 cm".
    return [name, m && !name.includes(m) ? m : ''].filter(Boolean).join(' ') || null;
};

/**
 * Comparison key for a lot's size — the frontend mirror of `_size_ident` in
 * `services/packing_service.py`. Prefers `bom_size_id`, falls back to the
 * snapshot (a free-mode size, or a BOMSize since deleted) with keys sorted so two
 * equal snapshots stringify alike. Null means UNSIZED, which everywhere means
 * *unknown* — never "a different size".
 *
 * Compare on this, never on `lotSizeLabel`: two BOMSize rows can print the same
 * label, and a picker that pre-selects on the label would hand the packer a
 * selection the server then refuses.
 */
export const lotSizeKey = (b: LotLike): string | null => {
    if (b?.bom_size_id) return String(b.bom_size_id);
    const s = b?.bom_size_snapshot as Record<string, any> | null | undefined;
    if (!s) return null;
    return JSON.stringify(Object.keys(s).sort().reduce((o: any, k) => (o[k] = s[k], o), {}));
};

export const lotComboLabel = (b: LotLike): string | null => {
    const hit = (b?.variant_attributes || []).find(a => a.system_role === 'combo');
    return hit?.value || null;
};

/**
 * Shade identity as one chip: shade code + shade name. The code can come from the
 * Color Library (`color_code`) or from the mirrored `Color Code` attribute value,
 * the name from the Color Library or the `Colors` variant attribute — the floor
 * reads them together, so they never split into two chips. A lot ordered against
 * an unapproved lab dip has only `labdip_variant_code`; that shows as pending.
 */
export const lotColorLabel = (b: LotLike): { label: string; name?: string | null; hex?: string | null; pending: boolean } | null => {
    const attrs = b?.variant_attributes || [];
    const attrCode = attrs.find(a => a.system_role === 'labdip_color');
    const attrName = attrs.find(a => a.system_role === 'color');
    const code = b?.color_code || attrCode?.value || null;
    const name = b?.color_name || attrName?.value || null;
    if (code || name) {
        // Code and name are usually the same text — show the code alone, same as
        // every other page's colour chip, and keep the name only for the tooltip
        // when it actually says something the code doesn't.
        return {
            label: code || name || '',
            name,
            hex: resolveColorHex(b?.color_hex, attrs),
            pending: false,
        };
    }
    if (b?.labdip_variant_code) return { label: b.labdip_variant_code, pending: true };
    return null;
};

// Lot chips are variant chips: the tone map and the badge itself now live in
// xpTheme (`VARIANT_TONE` / `VariantChip`) so the SO table, netting plan, BOM list
// and WO list draw a shade the same pink this file always did. Re-exported here
// because the lot pickers refer to them by these names.
export { VARIANT_TONE, variantChipTone } from './xpTheme';
export type LotChipTone = VariantKind;

/** A lot-identity badge. Kept as a name of its own because the pickers read better
 *  with it, but it is `VariantChip` — no second geometry, no second palette. */
export function LotChip({
    children, tone = 'order', title, mono, swatch, icon,
}: {
    children: React.ReactNode;
    tone?: LotChipTone;
    title?: string;
    mono?: boolean;
    swatch?: string | null;
    icon?: string | null;
}) {
    return (
        <VariantChip kind={tone} title={title} mono={mono} swatch={swatch} icon={icon}>
            {children}
        </VariantChip>
    );
}

export function LotChipRow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', ...style }}>
            {children}
        </div>
    );
}

/**
 * Identity chips for one lot: size, combo, shade, then (optionally) the other
 * variant attributes, location and producing order. Renders nothing when the lot
 * carries no identity at all, so callers can drop it in unconditionally.
 */
export function LotChips({
    batch, showLocation, showOrder, showQty, qtyUnit = 'kg', showOtherAttrs = true,
}: {
    batch: LotLike;
    showLocation?: boolean;
    showOrder?: boolean;
    showQty?: number | null;
    qtyUnit?: string;
    showOtherAttrs?: boolean;
}) {
    const size = lotSizeLabel(batch);
    const combo = lotComboLabel(batch);
    const color = lotColorLabel(batch);
    // color + labdip_color are already folded into the single shade chip above.
    const others = showOtherAttrs
        ? (batch.variant_attributes || []).filter(a => !['combo', 'color', 'labdip_color'].includes(a.system_role || ''))
        : [];

    const chips: React.ReactNode[] = [];
    if (showQty != null) {
        chips.push(
            <LotChip key="qty" tone="qty" title="Quantity remaining">
                {showQty.toFixed(2)} {qtyUnit}
            </LotChip>,
        );
    }
    if (size) {
        chips.push(
            <LotChip key="size" tone="size" title={`Size: ${size}`}>
                {size}
            </LotChip>,
        );
    }
    if (combo) {
        chips.push(
            <LotChip key="combo" tone="combo" title={`Combo: ${combo}`}>
                {combo}
            </LotChip>,
        );
    }
    if (color) {
        const colorFull = color.name && color.name !== color.label ? `${color.label} — ${color.name}` : color.label;
        chips.push(
            <LotChip
                key="color"
                tone={color.pending ? 'pending' : 'color'}
                swatch={color.hex || null}
                title={color.pending ? `Shade pending lab dip approval: ${colorFull}` : `Color: ${colorFull}`}
            >
                {color.label}{color.pending ? ' (pending)' : ''}
            </LotChip>,
        );
    }
    others.forEach((a, i) => chips.push(
        <LotChip key={`a${i}`} tone="material" swatch={a.hex || null} title={`${a.name}: ${a.value}`}>
            {a.value}
        </LotChip>,
    ));
    if (batch.vendor_lot) {
        chips.push(
            <LotChip key="vendor" tone="pending" mono title="Supplier lot">
                {batch.vendor_lot}
            </LotChip>,
        );
    }
    if (showLocation && batch.location_name) {
        chips.push(
            <LotChip key="loc" tone="location" title="Current location">
                {batch.location_name}
            </LotChip>,
        );
    }
    if (showOrder && (batch.wo_code || batch.mo_code)) {
        chips.push(
            <LotChip key="ord" tone="order" mono title="Produced by">
                {batch.wo_code || batch.mo_code}
            </LotChip>,
        );
    }

    if (!chips.length) return null;
    return <LotChipRow>{chips}</LotChipRow>;
}
