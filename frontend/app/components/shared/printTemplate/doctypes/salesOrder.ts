/**
 * Sales Order Confirmation — data side of the template. Layout: defaults/salesOrder.ts.
 *
 * The confirmation goes to the customer to sign back, so Price / Total / delivery
 * confirmation are hand-filled columns: sales orders carry no price, and the
 * internal confirmation date is not the customer's business unless the client
 * chooses to place that column.
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import { txt, type PrintContext } from '../renderContext';

export const SALES_ORDER_DOC = 'sales_order';

export const SO_FIELDS: FieldDef[] = [
    { key: 'so.number', label: 'SO Number', kind: 'text', group: 'Sales Order' },
    { key: 'so.date', label: 'Order Date', kind: 'date', group: 'Sales Order' },
    { key: 'so.customer_po_ref', label: 'Customer PO No', kind: 'text', group: 'Sales Order' },
    { key: 'so.status', label: 'Status', kind: 'text', group: 'Sales Order' },
    { key: 'so.customer_name', label: 'Customer (Consignee)', kind: 'text', group: 'Customer' },
    { key: 'so.customer_address', label: 'Customer Address', kind: 'text', group: 'Customer' },
    { key: 'so.attn', label: 'Attn name (typed at print)', kind: 'text', group: 'Customer' },
    { key: 'so.attn_role', label: 'Attn title (typed at print)', kind: 'text', group: 'Customer' },
    { key: 'so.prepared_by', label: 'Prepared by (name)', kind: 'text', group: 'Signatures' },
    { key: 'so.prepared_by_signed', label: 'Prepared by "( name )" line', kind: 'text', group: 'Signatures' },
    { key: 'so.customer_signed', label: 'Customer "( name )" line', kind: 'text', group: 'Signatures' },
];

export function resolveSalesOrderField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const so = d.so || {};
    switch (key) {
        case 'so.number': return txt(so.po_number);
        case 'so.date': return txt(d.date);
        case 'so.customer_po_ref': return txt(so.customer_po_ref);
        case 'so.status': return txt(so.status);
        case 'so.customer_name': return txt(so.customer_name);
        case 'so.customer_address': return txt(d.customerAddress);
        case 'so.attn': return txt(d.attn);
        case 'so.attn_role': return txt(d.attnRole);
        case 'so.prepared_by': return txt(d.preparedBy);
        // A blank rule keeps room to sign when nobody typed a name.
        case 'so.prepared_by_signed': return { text: `(  ${d.preparedBy || '_________________'}  )`, empty: false };
        case 'so.customer_signed': return { text: `(  ${so.customer_name || '_________________'}  )`, empty: false };
        default: return { text: '', empty: true };
    }
}

const SO_LINES: RowSourceDef = {
    id: 'so_lines',
    label: 'Order lines',
    docTypes: [SALES_ORDER_DOC],
    seedColumns: ['no', 'article', 'qty_unit'],
    columns: [
        { field: 'no', label: 'No' },
        { field: 'article', label: 'Article' },
        { field: 'item_name', label: 'Item' },
        { field: 'item_code', label: 'Item Code' },
        { field: 'variant', label: 'Variant' },
        { field: 'color', label: 'Colour' },
        { field: 'size', label: 'Size' },
        { field: 'qty_unit', label: 'Qty/Unit' },
        { field: 'qty', label: 'Qty (number)', numeric: true },
        { field: 'del_request', label: 'Del. Request' },
        { field: 'internal_confirmation', label: 'Internal Confirmation' },
        // Hand-filled on the signed copy — no data behind these on purpose.
        { field: 'del_confirmation', label: 'Del. Confirmation' },
        { field: 'price', label: 'Price' },
        { field: 'total', label: 'Total' },
    ],
    resolve: (ctx) => ({
        rows: (ctx.doc?.lines || []).map((l: any, i: number) => ({
            _key: l.id ?? i,
            no: String(i + 1),
            // Size and Color Library shade ride in the Article cell: saved layouts
            // predate those columns, and the article is what every one already prints.
            article: {
                title: l.itemName,
                lines: [[l.size_display, l.size_measurement].filter(Boolean).join(' '), l.color_name && `${l.color_name}${l.color_code ? ` (${l.color_code})` : ''}`, ...l.attrs].filter(Boolean),
            },
            item_name: l.itemName,
            item_code: l.item_code || '',
            variant: l.attrs.join(' / '),
            color: l.color_name ? `${l.color_name}${l.color_code ? ` (${l.color_code})` : ''}` : '',
            size: [l.size_display, l.size_measurement].filter(Boolean).join(' '),
            qty_unit: `${Number(l.qty).toLocaleString()} ${l.uom}`.trim(),
            qty: Number(l.qty),
            del_request: l.delRequest || null,
            internal_confirmation: l.internalConfirmation || null,
            del_confirmation: null,
            price: null,
            total: null,
        })),
    }),
};

export const SO_ROW_SOURCES: RowSourceDef[] = [SO_LINES];

export interface SalesOrderOverrides {
    preparedBy?: string;
    attn?: string;
    attnRole?: string;
}

const dmy = (d: string | null | undefined) => {
    if (!d) return '';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
};

export function buildSalesOrderContext({
    so, partners = [], itemIndex, attributes = [], companyProfile, companyName, companyLogoUrl, overrides = {},
}: {
    so: any;
    partners?: any[];
    itemIndex?: Record<string, any> | null;
    attributes?: any[];
    companyProfile?: any;
    companyName?: string;
    companyLogoUrl?: string;
    overrides?: SalesOrderOverrides;
}): PrintContext {
    const s = so || {};
    const attrName = (vid: string) => {
        for (const a of attributes) { const v = a.values?.find((x: any) => x.id === vid); if (v) return v.value; }
        return '';
    };
    return {
        workOrder: null,
        parentMO: null,
        doc: {
            so: s,
            date: dmy(s.order_date),
            customerAddress: (partners.find((p: any) => p.name === s.customer_name)?.address) || '',
            lines: (s.lines || []).map((l: any) => ({
                ...l,
                itemName: l.item_name || itemIndex?.[String(l.item_id)]?.name || l.item_id,
                uom: itemIndex?.[String(l.item_id)]?.uom || '',
                attrs: (l.attribute_value_ids || []).map(attrName).filter(Boolean),
                delRequest: dmy(l.due_date),
                internalConfirmation: dmy(l.internal_confirmation_date),
            })),
            preparedBy: overrides.preparedBy || '',
            attn: overrides.attn || '',
            attnRole: overrides.attnRole || '',
        },
        companyName,
        companyLogoUrl,
        companyProfile,
        printDate: dmy(new Date().toISOString()),
        formatDate: dmy,
        moAttributeValue: () => '',
    };
}
