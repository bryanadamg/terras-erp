/**
 * Purchase Report — two documents over one data shape: PO lines (what was ordered,
 * at what price) and goods received (what came in, where, when). Layouts:
 * defaults/purchaseReport.ts. The record is the filtered set the Purchase Report
 * view (or the Purchase Orders list) hands the print modal.
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import { txt, type PrintContext } from '../renderContext';
import { fmtMoney, qtyFmt } from '../../format';

export const PO_LINES_REPORT_DOC = 'po_lines_report';
export const GOODS_RECEIVED_REPORT_DOC = 'goods_received_report';

export const PRP_FIELDS: FieldDef[] = [
    { key: 'prp.period', label: 'Period', kind: 'text', group: 'Report' },
    { key: 'prp.filters', label: 'Filter summary', kind: 'text', group: 'Report' },
    { key: 'prp.printed', label: 'Printed (date + time)', kind: 'text', group: 'Report' },
    { key: 'prp.count', label: 'Rows (count)', kind: 'text', group: 'Totals' },
    { key: 'prp.amount', label: 'Total amount', kind: 'text', group: 'Totals' },
];

const fmtQty = qtyFmt(3);

export function resolvePurchaseReportField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    switch (key) {
        case 'prp.period': return txt(d.periodLabel);
        case 'prp.filters': return txt(d.filtersSummary);
        case 'prp.printed': return txt(d.printedAt);
        case 'prp.count': return txt((d.rows || []).length.toLocaleString());
        case 'prp.amount': return txt(`Rp ${fmtMoney(d.amount || 0)}`);
        default: return { text: '', empty: true };
    }
}

const money = (n: any) => (n == null ? '' : fmtMoney(Number(n)));
const qty = (n: any, uom: string) => `${fmtQty(Number(n) || 0)} ${uom || ''}`.trim();

const LINE_COLUMNS = [
    { field: 'no', label: 'No' },
    { field: 'date', label: 'Date' },
    { field: 'po_number', label: 'PO Number' },
    { field: 'supplier', label: 'Supplier' },
    { field: 'item_block', label: 'Item (name over code)' },
    { field: 'item_code', label: 'Item Code' },
    { field: 'item_name', label: 'Item Name' },
    { field: 'category', label: 'Category' },
    { field: 'variant', label: 'Variant' },
    { field: 'qty', label: 'Qty' },
    { field: 'unit_price', label: 'Unit Price' },
    { field: 'unit_price_excl_vat', label: 'Unit Price excl. VAT' },
    { field: 'amount', label: 'Amount' },
];

const rowOf = (r: any, i: number, qtyText: string) => ({
    _key: `${r.po_number}-${i}`,
    no: String(i + 1),
    date: r.dateText,
    po_number: r.po_number,
    supplier: r.supplier || '',
    item_block: { title: r.item_name, lines: [[r.item_code, r.variant].filter(Boolean).join(' · ')] },
    item_code: r.item_code,
    item_name: r.item_name,
    category: r.category || '',
    variant: r.variant || '',
    qty: qtyText,
    unit_price: money(r.unit_price),
    unit_price_excl_vat: money(r.unit_price_excl_vat),
    amount: money(r.amount),
});

const LINES_ROWS: RowSourceDef = {
    id: 'prp_lines',
    label: 'PO lines',
    docTypes: [PO_LINES_REPORT_DOC],
    seedColumns: ['no', 'date', 'po_number', 'item_block', 'qty', 'amount'],
    columns: [...LINE_COLUMNS, { field: 'received', label: 'Received' }, { field: 'status', label: 'Status' }],
    resolve: (ctx) => ({
        rows: (ctx.doc?.rows || []).map((r: any, i: number) => ({
            ...rowOf(r, i, qty(r.qty, r.uom)),
            received: qty(r.qty_received, r.uom),
            status: r.status,
        })),
    }),
};

const RECEIPT_ROWS: RowSourceDef = {
    id: 'prp_receipts',
    label: 'Goods received',
    docTypes: [GOODS_RECEIVED_REPORT_DOC],
    seedColumns: ['no', 'date', 'po_number', 'item_block', 'warehouse', 'qty'],
    columns: [...LINE_COLUMNS, { field: 'warehouse', label: 'Warehouse' }, { field: 'delivery_note', label: 'Delivery Note' },
        { field: 'lot', label: 'Lot' }, { field: 'packaging', label: 'Packaging' }],
    resolve: (ctx) => ({
        rows: (ctx.doc?.rows || []).map((r: any, i: number) => ({
            ...rowOf(r, i, qty(r.qty, r.uom)),
            warehouse: r.warehouse || '',
            delivery_note: r.delivery_note || '',
            lot: r.supplier_lot ? `${r.lot || '—'} (Sup: ${r.supplier_lot})` : (r.lot || ''),
            packaging: [r.boxes && `${r.boxes} boxes`, r.cones && `${r.cones} cones`, r.drums && `${r.drums} drums`].filter(Boolean).join(', '),
        })),
    }),
};

export const PRP_LINES_ROW_SOURCES: RowSourceDef[] = [LINES_ROWS];
export const PRP_RECEIPT_ROW_SOURCES: RowSourceDef[] = [RECEIPT_ROWS];

export function buildPurchaseReportContext({
    rows, amount, periodLabel, filtersSummary, formatDate, companyProfile, companyName, companyLogoUrl,
}: {
    rows: any[];
    amount: number;
    periodLabel: string;
    filtersSummary?: string;
    formatDate: (iso: string) => string;
    companyProfile?: any;
    companyName?: string;
    companyLogoUrl?: string;
}): PrintContext {
    const now = new Date();
    return {
        workOrder: null,
        parentMO: null,
        doc: {
            rows: (rows || []).map((r: any) => ({ ...r, dateText: r.date ? formatDate(r.date) : '' })),
            amount,
            periodLabel,
            filtersSummary: filtersSummary || '',
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
