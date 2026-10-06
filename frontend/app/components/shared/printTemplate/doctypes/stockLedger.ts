/**
 * Stock Ledger report — data side of the template. Layout: defaults/stockLedger.ts.
 *
 * The "record" is the filtered set of ledger rows the Reports view hands the
 * print modal, plus its period / filter caption and the server's whole-set
 * aggregates (the in/out totals cover every filtered row, not just the printed ones).
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import { txt, type PrintContext } from '../renderContext';
import { qtyFmt } from '../../format';
import { refMeta, shortRef } from '../../../dashboard/ledgerRef';
import { lotSizeLabel, lotComboLabel, lotColorLabel } from '../../LotChips';

export const STOCK_LEDGER_DOC = 'stock_ledger_report';

export const SL_FIELDS: FieldDef[] = [
    { key: 'sl.period', label: 'Period', kind: 'text', group: 'Report' },
    { key: 'sl.filters', label: 'Filter summary', kind: 'text', group: 'Report' },
    { key: 'sl.printed', label: 'Printed (date + time)', kind: 'text', group: 'Report' },
    { key: 'sl.truncated_note', label: '"Showing first N" warning (only when cut)', kind: 'text', group: 'Report' },
    { key: 'sl.count', label: 'Movements (count)', kind: 'text', group: 'Totals' },
    { key: 'sl.printed_count', label: 'Movements printed', kind: 'text', group: 'Totals' },
    { key: 'sl.total_in', label: 'Total in', kind: 'text', group: 'Totals' },
    { key: 'sl.total_out', label: 'Total out', kind: 'text', group: 'Totals' },
    { key: 'sl.net', label: 'Net', kind: 'text', group: 'Totals' },
];

const fmtQty = qtyFmt(4);   // matches ReportsView, which this prints

export function resolveStockLedgerField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const t = d.totals || { total: 0, totalIn: 0, totalOut: 0 };
    const printed = (d.rows || []).length;
    const hidden = Math.max(0, t.total - printed);
    switch (key) {
        case 'sl.period': return txt(d.periodLabel);
        case 'sl.filters': return txt(d.filtersSummary);
        case 'sl.printed': return txt(d.printedAt);
        case 'sl.truncated_note': return txt(hidden > 0
            ? `Showing first ${printed.toLocaleString()} of ${t.total.toLocaleString()} movements — narrow the filters to print the rest (${hidden.toLocaleString()} not shown).`
            : '');
        case 'sl.count': return txt(t.total.toLocaleString());
        case 'sl.printed_count': return txt(printed.toLocaleString());
        case 'sl.total_in': return txt(`+${fmtQty(t.totalIn)}`);
        case 'sl.total_out': return txt(fmtQty(t.totalOut));
        case 'sl.net': return txt(fmtQty(t.totalIn + t.totalOut));
        default: return { text: '', empty: true };
    }
}

const signed = (n: number, unit: string) => (n ? `${n > 0 ? '+' : ''}${n} ${unit}` : '');

const SL_ROWS: RowSourceDef = {
    id: 'sl_rows',
    label: 'Ledger movements',
    docTypes: [STOCK_LEDGER_DOC],
    seedColumns: ['no', 'date', 'item_block', 'movement'],
    columns: [
        { field: 'no', label: 'No' },
        { field: 'date', label: 'Date' },
        { field: 'item_block', label: 'Item (name over code)' },
        { field: 'item_name', label: 'Item Name' },
        { field: 'item_code', label: 'Item Code' },
        { field: 'attributes', label: 'Variant (size / combo / shade / attributes)' },
        { field: 'location', label: 'Location (warehouse / bin)' },
        { field: 'lot', label: 'Lot' },
        { field: 'movement', label: 'Movement (+qty uom)' },
        { field: 'qty', label: 'Qty change (number)', numeric: true },
        { field: 'uom', label: 'UOM' },
        { field: 'packaging', label: 'Packaging' },
        { field: 'source', label: 'Source' },
        { field: 'ref', label: 'Ref #' },
    ],
    resolve: (ctx) => ({
        rows: (ctx.doc?.rows || []).map((e: any, i: number) => ({
            _key: e.id ?? i,
            // In green, out red — the colour the old report drew the movement in.
            _style: { movement: { color: e.qty_change >= 0 ? '#1a5e1a' : '#c00000' } },
            no: String(i + 1),
            date: e.date,
            // Composite: bold name over the code, as the old report drew it.
            item_block: { title: e.item_name, lines: e.item_code ? [e.item_code] : [] },
            item_name: e.item_name,
            item_code: e.item_code,
            attributes: e.attrs,
            location: e.warehouse ? `${e.warehouse} / ${e.location_name || ''}` : e.location_name,
            lot: e.vendor_lot ? `${e.batch_number || '—'} (Supplier: ${e.vendor_lot})` : (e.batch_number || '—'),
            movement: `${e.qty_change >= 0 ? '+' : ''}${fmtQty(e.qty_change)} ${e.item_uom || ''}`.trim(),
            qty: Number(e.qty_change),
            uom: e.item_uom,
            packaging: [signed(e.qty_cones_change || 0, 'cones'), signed(e.qty_boxes_change || 0, 'boxes'), signed(e.qty_drums_change || 0, 'drums')]
                .filter(Boolean).join(', ') || '—',
            source: refMeta(e.reference_type).label,
            ref: e.reference_label || shortRef(e.reference_id),
        })),
    }),
};

export const SL_ROW_SOURCES: RowSourceDef[] = [SL_ROWS];

export function buildStockLedgerContext({
    entries, locations = [], periodLabel, filtersSummary, totals, formatDateTime,
    companyProfile, companyName, companyLogoUrl,
}: {
    entries: any[];
    locations?: any[];
    periodLabel: string;
    filtersSummary?: string;
    totals: { total: number; totalIn: number; totalOut: number };
    /** TimezoneContext's `formatDateTime`, for each movement's timestamp. */
    formatDateTime: (iso: string) => string;
    companyProfile?: any;
    companyName?: string;
    companyLogoUrl?: string;
}): PrintContext {
    const locMap: Record<string, any> = {};
    for (const l of locations) locMap[l.id] = l;
    // Same identity, same order as the on-screen LotChips: size, combo, shade, rest.
    const variantText = (e: any) => {
        const color = lotColorLabel(e);
        const others = (e.variant_attributes || [])
            .filter((a: any) => !['combo', 'color', 'labdip_color'].includes(a.system_role || ''))
            .map((a: any) => a.value);
        return [lotSizeLabel(e), lotComboLabel(e), color && `${color.label}${color.pending ? ' (pending)' : ''}`, ...others]
            .filter(Boolean).join(', ');
    };
    const now = new Date();
    return {
        workOrder: null,
        parentMO: null,
        doc: {
            rows: (entries || []).map((e: any) => ({
                ...e,
                date: e.created_at ? formatDateTime(e.created_at) : '',
                warehouse: locMap[e.location_id]?.parent_name || '',
                attrs: variantText(e),
            })),
            periodLabel,
            filtersSummary: filtersSummary || '',
            totals,
            printedAt: now.toLocaleString(),
        },
        companyName,
        companyLogoUrl,
        companyProfile,
        printDate: now.toLocaleDateString(),
        formatDate: (iso: string) => (iso ? new Date(iso).toLocaleDateString() : ''),
        moAttributeValue: () => '',
    };
}
