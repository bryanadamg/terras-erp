/**
 * Layout edits that create structure: new sections, copies of sections, and
 * placing a field into one.
 *
 * Pure functions over plain layout JSON, kept out of the designer view so the
 * seeds live next to the defaults they have to stay consistent with (see
 * defaults/kartuKerja.ts) and so the "what is a valid empty band of this type"
 * question has one answer. Every function returns new objects; callers hand them
 * to the designer's `mutate`, which makes each one undo step.
 */

import type {
    Band, BandType, GridBand, KeyValueBand, TableBand, TallyBand, SignatureBand, SpacerBand,
} from './types';
import { FIELD_MANIFESTS } from './fieldRegistry';

/** Section types offerable in the designer's "add section" menu, in menu order. */
export const ADDABLE_BAND_TYPES: { type: BandType; label: string; hint: string }[] = [
    { type: 'grid', label: 'Grid', hint: 'Fields placed across a 12-column row' },
    { type: 'keyvalue', label: 'Label / value', hint: 'Rows of label + value, like Artikel / Combo' },
    { type: 'table', label: 'Data table', hint: 'Grows with the data (materials, dye doses)' },
    { type: 'tally', label: 'Hand fill-in', hint: 'Empty boxes or a grid the operator writes in' },
    { type: 'signature', label: 'Signatures', hint: 'Sign-off boxes along the bottom' },
    { type: 'spacer', label: 'Flexible space', hint: 'Pushes whatever follows to the bottom of the page' },
];

/** Ids only have to be unique within one layout; they are never stored separately. */
function newBandId(type: string): string {
    return `${type}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Which of a doc type's fields to seed a new section with. */
function seedField(docType: string): string {
    return FIELD_MANIFESTS[docType]?.[0]?.key || '__blank';
}

/**
 * A new, valid, *visible* section of `type`.
 *
 * Every seed carries at least one row/cell/box: an empty band renders zero-height,
 * which cannot be hovered to reveal its handles and reads as "adding did nothing".
 * For the same reason a new table seeds `hideWhenEmpty: false` even though the
 * built-in materials band sets it true — a table hiding itself the instant it is
 * added is indistinguishable from a broken button. Turn it back on in the
 * inspector once the table has its columns.
 */
export function newBand(type: BandType, docType: string): Band {
    const id = newBandId(type);
    const base = { id, marginBottom: 6 };

    switch (type) {
        case 'grid':
            return {
                ...base, type: 'grid', gap: 6,
                items: [{ field: seedField(docType), col: 1, span: 12, row: 1 }],
            } as GridBand;
        case 'keyvalue':
            return {
                ...base, type: 'keyvalue', labelWidth: '24%',
                rows: [{ field: seedField(docType), span: 1 }],
            } as KeyValueBand;
        case 'table':
            return {
                ...base, type: 'table', source: 'bom_step_lines', fontSize: 9,
                hideWhenEmpty: false,
                columns: [
                    { field: 'item', label: 'Komponen', align: 'left' },
                    { field: 'required_qty', label: 'Perlu', width: '22%', align: 'right', decimals: 2 },
                    { field: 'actual_qty', label: 'Aktual', width: '22%', align: 'right', decimals: 2, emptyText: '' },
                ],
            } as TableBand;
        case 'tally':
            return {
                ...base, type: 'tally', fontSize: 9, rows: 3,
                columns: [
                    { label: 'No.', width: '14%', autoNumber: true },
                    { label: 'Value' },
                ],
            } as TallyBand;
        case 'signature':
            return {
                ...base, type: 'signature',
                boxes: [{ caption: 'DIBUAT', width: 100, height: 26 }],
            } as SignatureBand;
        case 'spacer':
            return { ...base, type: 'spacer', minHeight: 6 } as SpacerBand;
    }
}

/** Deep copy of `band` under a fresh id. */
export function duplicateBand(band: Band): Band {
    const copy: Band = JSON.parse(JSON.stringify(band));
    copy.id = newBandId(band.type);
    return copy;
}

/** True when a field can be appended to this section at all. */
export function bandAcceptsFields(band: Band | null | undefined): boolean {
    return band?.type === 'grid' || band?.type === 'keyvalue';
}

/**
 * Append `fieldKey` to `band`, mutating it (the caller works on a draft clone).
 * Returns the index it landed at, so the caller can select it — placing a field
 * you then have to hunt for is half a feature.
 *
 * A grid takes a full-width cell on a new bottom row: the row is free by
 * definition, whereas guessing a gap in an existing row lands fields on top of
 * each other.
 */
export function appendField(band: Band, fieldKey: string): number | null {
    if (band.type === 'grid') {
        const g = band as GridBand;
        const maxRow = g.items.reduce((m, it) => Math.max(m, it.row), 0);
        g.items.push({ field: fieldKey, col: 1, span: 12, row: maxRow + 1 });
        return g.items.length - 1;
    }
    if (band.type === 'keyvalue') {
        const kv = band as KeyValueBand;
        kv.rows.push({ field: fieldKey, span: 1 });
        return kv.rows.length - 1;
    }
    return null;
}

/** Every field key placed anywhere in the layout, for marking the palette. */
export function placedFieldKeys(bands: Band[]): Set<string> {
    const keys = new Set<string>();
    bands.forEach(band => {
        if (band.type === 'grid') {
            (band as GridBand).items.forEach(it => {
                if (it.field) keys.add(it.field);
                it.stack?.forEach(sf => keys.add(sf.field));
            });
        } else if (band.type === 'keyvalue') {
            (band as KeyValueBand).rows.forEach(r => keys.add(r.field));
        } else if (band.type === 'signature') {
            (band as SignatureBand).footerFields?.forEach(f => keys.add(f.field));
        }
    });
    return keys;
}
