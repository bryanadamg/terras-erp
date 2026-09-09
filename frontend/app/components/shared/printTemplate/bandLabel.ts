/**
 * Human names for bands, for the designer's section list.
 *
 * A band's `type` is a shape ("grid"), not a name — and a Kartu Kerja layout has
 * three grid bands, so a list of types tells the designer nothing about which row
 * is the header and which is the big machine name. This derives a name from what
 * the band actually *contains*: the fields placed in it. The type is returned
 * separately so the list can show it as a quiet suffix instead of doubling up as
 * the name (which is what produced the "Grid Grid" rows this replaces).
 *
 * A band whose `title` is set is already named by the client; that always wins.
 * `'{auto}'` is not a name — it defers to the row source (see rowSources.ts).
 */

import type {
    Band, GridBand, KeyValueBand, TableBand, TallyBand, SignatureBand, SpacerBand, FieldSpec,
} from './types';
import { fieldDef } from './fieldRegistry';
import { rowSource } from './rowSources';

export const BAND_TYPE_LABEL: Record<string, string> = {
    grid: 'Grid',
    keyvalue: 'Label / value',
    table: 'Data table',
    tally: 'Hand fill-in',
    signature: 'Signatures',
    spacer: 'Spacer',
};

/** How many field names a derived label lists before it summarises the rest. */
const MAX_PARTS = 3;

/**
 * Shorter names for fields whose registry label is written for a dropdown, where
 * there is room to disambiguate ("QR Code (scan to log)"). A section row is ~150px
 * wide, so one parenthesised field name would eat the whole line.
 */
const SHORT_FIELD_LABEL: Record<string, string> = {
    'wo.qr': 'QR code',
    'wo.code_or_mo': 'WO code',
    'wo.footer_trace': 'Trace footer',
    'print.date_department': 'Print date',
    'wo.work_center_name': 'Machine',
    'mo.item_name': 'Artikel',
    'wo.qty_completed': 'Qty logged',
    'wo.qty_remaining': 'Qty left',
    'mo.putaway_location': 'Simpan di Rak',
    'bom.mesin_panjang_tarikan': 'Tarikan (sblm)',
    'bom.celup_panjang_tarikan': 'Tarikan (ssdh)',
};

function fieldName(docType: string, key: string | undefined): string | null {
    if (!key || key === '__blank') return null;
    return SHORT_FIELD_LABEL[key] || fieldDef(docType, key)?.label || key;
}

/** Join up to MAX_PARTS names, summarising anything beyond that. */
function summarise(names: string[], separator = ', '): string {
    const shown = names.slice(0, MAX_PARTS).join(separator);
    const rest = names.length - MAX_PARTS;
    return rest > 0 ? `${shown} +${rest}` : shown;
}

function gridName(band: GridBand, docType: string): string {
    // A stacked cell contributes its stacked fields, not the cell — the cell has no
    // field of its own, and "Stack" is as uninformative as "Grid".
    const names: string[] = [];
    band.items.forEach(item => {
        const specs: (FieldSpec | GridBand['items'][number])[] = item.stack ?? [item];
        specs.forEach(s => {
            const n = fieldName(docType, s.field);
            if (n) names.push(n);
        });
    });
    if (names.length === 0) return 'Blank cells';
    return summarise(names);
}

function keyValueName(band: KeyValueBand, docType: string): string {
    const names = band.rows
        .map(r => r.label || fieldName(docType, r.field))
        .filter(Boolean) as string[];
    if (names.length === 0) return 'Empty rows';
    return summarise(names, ' / ');
}

function tallyName(band: TallyBand): string {
    if (band.boxes) return `${band.boxes} numbered boxes`;
    const names = (band.columns || []).map(c => c.label).filter(Boolean);
    if (names.length === 0) return 'Hand fill-in grid';
    return summarise(names);
}

function signatureName(band: SignatureBand): string {
    const names = band.boxes.map(b => b.caption).filter(Boolean);
    if (names.length === 0) return 'Signatures';
    return summarise(names, ' / ');
}

/**
 * Display name for a band. `band.title` when the client named it, otherwise derived
 * from the band's contents.
 */
export function describeBand(band: Band, docType: string): string {
    if (band.title && band.title !== '{auto}') return band.title;

    switch (band.type) {
        case 'grid':
            return gridName(band as GridBand, docType);
        case 'keyvalue':
            return keyValueName(band as KeyValueBand, docType);
        case 'table':
            return rowSource((band as TableBand).source)?.label || 'Data table';
        case 'tally':
            return tallyName(band as TallyBand);
        case 'signature':
            return signatureName(band as SignatureBand);
        case 'spacer':
            return (band as SpacerBand).minHeight
                ? `Flexible space (min ${(band as SpacerBand).minHeight}px)`
                : 'Flexible space';
        default:
            return BAND_TYPE_LABEL[(band as Band).type] || (band as Band).type;
    }
}

/** The band's shape, for the quiet suffix beside the name. */
export function bandTypeLabel(band: Band): string {
    return BAND_TYPE_LABEL[band.type] || band.type;
}
