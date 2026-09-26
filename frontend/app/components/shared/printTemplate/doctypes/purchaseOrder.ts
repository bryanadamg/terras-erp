/**
 * Purchase Order — data side of the template: fields, the lines row source, and
 * the builder that shapes a PO into the render context. Layout: defaults/purchaseOrder.ts.
 *
 * Money is pre-formatted here (`Rp` prefix on the totals, as the document has always
 * printed it) so every surface that places a total prints the same string.
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import type { PrintContext } from '../renderContext';
import { fmtMoney } from '../../format';

export const PURCHASE_ORDER_DOC = 'purchase_order';

export const PO_FIELDS: FieldDef[] = [
    { key: 'po.number', label: 'PO Number', kind: 'text', group: 'Purchase Order' },
    { key: 'po.barcode', label: 'PO Number barcode (decorative)', kind: 'barcode', group: 'Purchase Order' },
    { key: 'po.date', label: 'PO Date', kind: 'date', group: 'Purchase Order' },
    { key: 'po.ssn', label: 'SSN', kind: 'text', group: 'Purchase Order' },
    { key: 'po.status', label: 'Status', kind: 'text', group: 'Purchase Order' },
    { key: 'po.email', label: 'Email (supplier, else company)', kind: 'text', group: 'Purchase Order' },
    { key: 'po.kurs_pajak', label: 'Kurs Pajak (hidden on KTBI POs)', kind: 'text', group: 'Purchase Order' },
    { key: 'po.ktbi', label: 'KTBI (hidden on Kurs Pajak POs)', kind: 'text', group: 'Purchase Order' },
    { key: 'po.code', label: 'Code', kind: 'text', group: 'Purchase Order' },
    { key: 'po.payment_term', label: 'Payment', kind: 'text', group: 'Purchase Order' },
    { key: 'po.category', label: 'Category', kind: 'text', group: 'Purchase Order' },
    { key: 'po.notes', label: 'Notes', kind: 'text', group: 'Purchase Order' },

    { key: 'po.supplier_name', label: 'Supplier Company', kind: 'text', group: 'Supplier' },
    { key: 'po.supplier_attn', label: 'Supplier Attn (contact person)', kind: 'text', group: 'Supplier' },
    { key: 'po.supplier_address', label: 'Supplier Address', kind: 'text', group: 'Supplier' },
    { key: 'po.supplier_phone', label: 'Supplier Telp', kind: 'text', group: 'Supplier' },
    { key: 'po.supplier_fax', label: 'Supplier Fax', kind: 'text', group: 'Supplier' },
    { key: 'po.supplier_email', label: 'Supplier Email', kind: 'text', group: 'Supplier' },

    { key: 'po.subtotal', label: 'Subtotal', kind: 'text', group: 'Totals' },
    { key: 'po.discount', label: 'Discount', kind: 'text', group: 'Totals' },
    { key: 'po.vat', label: 'VAT (hidden when the PO has none)', kind: 'text', group: 'Totals' },
    { key: 'po.total', label: 'Total', kind: 'text', group: 'Totals' },

    { key: 'po.prepared_by', label: 'Prepared by (name)', kind: 'text', group: 'Signatures' },
    { key: 'po.examined_by', label: 'Examined by (name)', kind: 'text', group: 'Signatures' },
    { key: 'po.approved_by', label: 'Approved by (name)', kind: 'text', group: 'Signatures' },
];

function txt(v: any): ResolvedField {
    const s = v == null || v === '' ? '' : String(v);
    return { text: s || '—', empty: s === '' };
}
/** A value that applies to this PO but may be blank: prints blank, never hides its row. */
const present = (v: any): ResolvedField => ({ text: v == null ? '' : String(v), empty: false });
const NA: ResolvedField = { text: '', empty: true };
const rp = (n: number) => `Rp  ${fmtMoney(n)}`;

export function resolvePurchaseOrderField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const po = d.po || {};
    const sup = d.supplier || {};
    switch (key) {
        case 'po.number': return txt(po.po_number);
        case 'po.barcode': return txt(po.po_number);
        case 'po.date': return txt(d.date);
        case 'po.ssn': return txt(po.ssn);
        case 'po.status': return txt(po.status);
        case 'po.email': return txt(sup.email || ctx.companyProfile?.email);
        // "Empty" here means "not this PO's rate mode", so hideWhenEmpty drops the
        // other mode's row while a blank rate on the right mode still prints its label.
        case 'po.kurs_pajak': return po.rate_mode === 'ktbi' ? NA : present(po.kurs_pajak);
        case 'po.ktbi': return po.rate_mode === 'ktbi' ? present(po.ktbi) : NA;
        case 'po.code': return txt(po.code);
        case 'po.payment_term': return txt(po.payment_term);
        case 'po.category': return txt(po.category);
        case 'po.notes': return txt(po.notes);

        case 'po.supplier_name': return txt(sup.name);
        case 'po.supplier_attn': return txt(sup.contact_person);
        case 'po.supplier_address': return txt(sup.address);
        case 'po.supplier_phone': return txt(sup.phone);
        case 'po.supplier_fax': return txt(sup.fax);
        case 'po.supplier_email': return txt(sup.email);

        case 'po.subtotal': return present(rp(d.subtotal || 0));
        case 'po.discount': return present(d.discount ? rp(d.discount) : 'Rp');
        // vat_percent null = the PO was saved with VAT off: no VAT row at all. An
        // explicit 0 is still a VAT line (rate 0%). `label` feeds a '{auto}' row label.
        case 'po.vat':
            return d.hasVat ? { text: rp(d.vat), empty: false, label: `VAT ${d.vatPercent}%` } : NA;
        case 'po.total': return present(rp(d.total || 0));

        case 'po.prepared_by': return txt(d.preparedBy);
        case 'po.examined_by': return txt(d.examinedBy);
        case 'po.approved_by': return txt(d.approvedBy);
        default: return NA;
    }
}

const PO_LINES: RowSourceDef = {
    id: 'po_lines',
    label: 'Order lines',
    docTypes: [PURCHASE_ORDER_DOC],
    seedColumns: ['no', 'description', 'qty'],
    columns: [
        { field: 'no', label: 'No' },
        { field: 'description', label: 'DESCRIPTION' },
        { field: 'item_name', label: 'Item' },
        { field: 'item_code', label: 'Item Code' },
        { field: 'attributes', label: 'Variant' },
        { field: 'qty', label: 'Qty' },
        { field: 'qty_value', label: 'Qty (number)', numeric: true },
        { field: 'uom', label: 'Unit' },
        { field: 'unit_price', label: 'Price ( Rp )' },
        { field: 'line_total', label: 'Total ( Rp )' },
        { field: 'deadline', label: 'Deadline' },
        { field: 'qty_received', label: 'Received', numeric: true },
    ],
    resolve: (ctx) => ({
        rows: (ctx.doc?.lines || []).map((l: any, i: number) => ({
            _key: l.id ?? i,
            no: String(i + 1),
            // Composite: bold item name, one line per variant value under it.
            description: { title: l.itemName, lines: l.attrs },
            item_name: l.itemName,
            item_code: l.item_code || '',
            attributes: l.attrs.join(' / '),
            qty: `${Number(l.qty).toLocaleString('en-US')}  ${l.uom}`.trim(),
            qty_value: Number(l.qty),
            uom: l.uom,
            unit_price: l.unit_price != null ? fmtMoney(Number(l.unit_price)) : null,
            line_total: l.unit_price != null ? fmtMoney(l.lineTotal) : null,
            deadline: l.deadline || null,
            qty_received: l.qty_received ?? null,
        })),
    }),
};

export const PO_ROW_SOURCES: RowSourceDef[] = [PO_LINES];

export interface PurchaseOrderOverrides {
    preparedBy?: string;
    examinedBy?: string;
    approvedBy?: string;
}

const dmy = (d: string | null | undefined) => {
    if (!d) return '';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
};

export function buildPurchaseOrderContext({
    po, partners = [], itemIndex, attributes = [], companyProfile, companyName, companyLogoUrl, overrides = {},
}: {
    po: any;
    partners?: any[];
    itemIndex?: Record<string, any> | null;
    attributes?: any[];
    companyProfile?: any;
    companyName?: string;
    companyLogoUrl?: string;
    overrides?: PurchaseOrderOverrides;
}): PrintContext {
    const p = po || {};
    const attrName = (vid: string) => {
        for (const a of attributes) { const v = a.values?.find((x: any) => x.id === vid); if (v) return v.value; }
        return '';
    };
    const lines = (p.lines || []).map((l: any) => ({
        ...l,
        itemName: l.item_name || itemIndex?.[String(l.item_id)]?.name || l.item_id,
        uom: l.item_uom || itemIndex?.[String(l.item_id)]?.uom || '',
        attrs: (l.attribute_value_ids || []).map(attrName).filter(Boolean),
        lineTotal: (Number(l.qty) || 0) * (Number(l.unit_price) || 0),
        deadline: dmy(l.due_date),
    }));
    const subtotal = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);
    const hasVat = p.vat_percent != null;
    const vatPercent = Number(p.vat_percent) || 0;
    const discount = Number(p.discount) || 0;
    const vat = hasVat ? (subtotal - discount) * vatPercent / 100 : 0;

    return {
        workOrder: null,
        parentMO: null,
        doc: {
            po: p,
            supplier: partners.find((x: any) => x.id === p.supplier_id) || null,
            lines,
            date: dmy(p.order_date),
            subtotal, discount, hasVat, vatPercent, vat,
            total: subtotal - discount + vat,
            preparedBy: overrides.preparedBy || '',
            examinedBy: overrides.examinedBy || '',
            approvedBy: overrides.approvedBy || '',
        },
        companyName,
        companyLogoUrl,
        companyProfile,
        printDate: dmy(new Date().toISOString()),
        formatDate: dmy,
        moAttributeValue: () => '',
    };
}
