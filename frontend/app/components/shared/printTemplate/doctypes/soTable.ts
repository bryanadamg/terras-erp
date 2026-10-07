/**
 * Sales Order table report — data side of the template. Layout: defaults/soTable.ts.
 *
 * The "record" is the set of sales orders the Sales Orders view hands the print
 * modal, flattened to one row per order line (an order with no lines still gets
 * one row, so it is not silently dropped from the list).
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import { txt, type PrintContext } from '../renderContext';

export const SO_TABLE_DOC = 'so_table_report';

export const ST_FIELDS: FieldDef[] = [
    { key: 'st.date_header', label: 'Print date (17 SEPTEMBER 2026)', kind: 'text', group: 'Report' },
    { key: 'st.subtitle', label: '"Sales Order List — N line(s)"', kind: 'text', group: 'Report' },
    { key: 'st.printed', label: 'Printed (date + time)', kind: 'text', group: 'Report' },
    { key: 'st.row_count', label: 'Total rows', kind: 'text', group: 'Totals' },
    { key: 'st.order_count', label: 'Total orders', kind: 'text', group: 'Totals' },
];

export function resolveSoTableField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const n = (d.rows || []).length;
    switch (key) {
        case 'st.date_header': return txt(d.dateHeader);
        case 'st.subtitle': return txt(`Sales Order List — ${n} line(s)`);
        case 'st.printed': return txt(d.printedAt);
        case 'st.row_count': return txt(String(n));
        case 'st.order_count': return txt(String(d.orderCount ?? 0));
        default: return { text: '', empty: true };
    }
}

const ST_ROWS: RowSourceDef = {
    id: 'st_rows',
    label: 'Sales order lines',
    docTypes: [SO_TABLE_DOC],
    seedColumns: ['no', 'po_number', 'customer', 'item'],
    columns: [
        { field: 'no', label: 'No' },
        { field: 'date', label: 'Date' },
        { field: 'po_number', label: 'Ref No. (PO#)' },
        { field: 'customer_po_ref', label: 'Customer PO Ref' },
        { field: 'customer', label: 'Customer' },
        { field: 'status', label: 'Status' },
        { field: 'del_request', label: 'Del. Request' },
        { field: 'del_confirmation', label: 'Del. Confirmation' },
        { field: 'stock_notes', label: 'Stock Notes' },
        { field: 'item_name', label: 'Item' },
        { field: 'size', label: 'Size (attributes)' },
        { field: 'qty_yd', label: 'Qty (Yd)' },
        { field: 'qty_m', label: 'Qty (m)' },
        { field: 'qty_kg', label: 'Qty (KG)' },
        { field: 'qty3', label: 'Qty 3' },
    ],
    resolve: (ctx) => ({ rows: ctx.doc?.rows || [] }),
};

export const ST_ROW_SOURCES: RowSourceDef[] = [ST_ROWS];

const MONTHS = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];

const dmy = (d: string | null | undefined) => {
    if (!d) return '';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
};

const num = (v: number | null | undefined) =>
    v == null ? '' : Number(v).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

export function buildSoTableContext({
    salesOrders, items = [], itemIndex, attributes = [], tzFormatCustom, companyProfile, companyName, companyLogoUrl,
}: {
    salesOrders: any[];
    items?: any[];
    itemIndex?: Record<string, any> | null;
    attributes?: any[];
    /** TimezoneContext's `formatCustom`, for the "Printed" stamp. */
    tzFormatCustom: (iso: string, opts: Intl.DateTimeFormatOptions, locale?: string) => string;
    companyProfile?: any;
    companyName?: string;
    companyLogoUrl?: string;
}): PrintContext {
    const itemName = (id: string) => items.find((i: any) => i.id === id)?.name || itemIndex?.[String(id)]?.name || id;
    const attrValues = (ids: string[]) => ids.map(vid => {
        for (const a of attributes) { const v = a.values?.find((x: any) => x.id === vid); if (v) return v.value; }
        return '';
    }).filter(Boolean).join(', ');

    const rows: Record<string, any>[] = [];
    for (const so of salesOrders || []) {
        const lines = so.lines?.length ? so.lines : [null];
        for (const line of lines) {
            rows.push({
                _key: `${so.id}-${line?.id ?? 'empty'}`,
                no: String(rows.length + 1),
                date: dmy(so.order_date),
                po_number: so.po_number,
                customer_po_ref: so.customer_po_ref || '',
                customer: so.customer_name,
                status: so.status,
                del_request: line ? dmy(line.due_date) : '',
                del_confirmation: line ? dmy(line.internal_confirmation_date) : '',
                stock_notes: line?.ket_stock || '',
                item_name: line ? itemName(line.item_id) : '',
                size: line ? attrValues(line.attribute_value_ids || []) : '',
                qty_yd: line ? num(line.qty) : '',
                qty_m: line && line.qty ? num(Math.round(line.qty * 0.9144 * 100) / 100) : '',
                qty_kg: line ? num(line.qty_kg) : '',
                qty3: line && line.qty2 != null && line.qty2 !== '' ? `${num(line.qty2)}${line.uom2 ? ' ' + line.uom2 : ''}` : '',
            });
        }
    }

    const today = new Date();
    return {
        workOrder: null,
        parentMO: null,
        doc: {
            rows,
            orderCount: (salesOrders || []).length,
            dateHeader: `${String(today.getDate()).padStart(2, '0')} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`,
            printedAt: tzFormatCustom(today.toISOString(), { dateStyle: 'short', timeStyle: 'short' }, 'id-ID'),
        },
        companyName,
        companyLogoUrl,
        companyProfile,
        printDate: dmy(today.toISOString()),
        formatDate: dmy,
        moAttributeValue: () => '',
    };
}
