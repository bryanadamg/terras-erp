/**
 * Built-in Sales Order Confirmation layout — a transcription of the hand-built
 * SODocument it replaced in sales/SalesPrintModal.tsx. Applies until the client
 * saves their own.
 */

import type { PrintLayout, Band, FieldSpec, GridItem } from '../types';
import { PRINT_FONT } from '../../typography';

const BASE = 8.5;
const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, fontSize: BASE, ...extra });
const text = (t: string, extra: Partial<FieldSpec> = {}): FieldSpec => f('__text', { text: t, ...extra });
const stack = (col: number, span: number, fields: FieldSpec[], extra: Partial<GridItem> = {}): GridItem =>
    ({ col, span, row: 1, stackGap: 1, stack: fields, ...extra });

const RULE = '#555';

const ATTENTION_NOTES = [
    'Price is excluded VAT.',
    "Claim only accepted within 15 days up on receiving goods date.\nClaim can't be accepted if goods had been cut or lost",
    'We do not accept changing color or cancelation if elastic has been processed or dyed.',
    'Color tolerance between lot to lot are within 5% tolerance must be accepted by customer',
    'Delivery cost outside JABODETABEK area will be on customer cost.',
];

const BANDS: Band[] = [
    {
        id: 'so_header', type: 'grid', gap: 8, marginBottom: 6,
        borderBottom: '2px solid #000', padding: '0 0 5px',
        items: [
            { ...f('company.logo', { imageHeight: 52, hideWhenEmpty: true }), col: 1, span: 1, row: 1 },
            stack(2, 6, [
                f('company.name', { fontSize: 11, bold: true, hideWhenEmpty: true }),
                f('company.address', { hideWhenEmpty: true }),
                f('company.phone_fax', { hideWhenEmpty: true }),
                f('company.email', { prefix: 'Email: ', hideWhenEmpty: true }),
            ], { stackGap: 0 }),
            { ...text('Sales Order Confirmation', { fontSize: 16, bold: true, align: 'right' }), col: 8, span: 5, row: 1 },
        ],
    },
    {
        id: 'so_info', type: 'grid', gap: 10, marginBottom: 6, borderBottom: `1px solid ${RULE}`, padding: '0 0 5px',
        items: [
            stack(1, 3, [
                f('so.number', { prefix: 'No : ' }),
                f('so.date', { prefix: 'Date : ', emptyText: '' }),
                f('so.customer_po_ref', { prefix: 'PO No : ', emptyText: '' }),
                text('Payment Term : '),
            ]),
            stack(4, 6, [
                text('Consignee :', { bold: true }),
                f('so.customer_name', { bold: true }),
                f('so.customer_address', { hideWhenEmpty: true }),
            ], { stackGap: 2 }),
            stack(10, 3, [
                text('Attn :', { bold: true }),
                f('so.attn', { hideWhenEmpty: true }),
                f('so.attn_role', { hideWhenEmpty: true }),
            ]),
        ],
    },
    {
        id: 'so_lines', type: 'table', source: 'so_lines', fontSize: BASE, marginBottom: 0,
        hideWhenEmpty: false, minRows: 12, padRowHeight: 18, ruleColor: RULE,
        columns: [
            { field: 'no', label: 'No', width: '4%', align: 'center' },
            { field: 'article', label: 'Article', width: '30%' },
            { field: 'qty_unit', label: 'Qty/Unit', width: '12%', align: 'center' },
            { field: 'del_request', label: 'Del. Request', width: '12%', align: 'center', emptyText: '' },
            { field: 'del_confirmation', label: 'Del. Confirmation', width: '12%', align: 'center', emptyText: '' },
            { field: 'price', label: 'Price', width: '15%', headerAlign: 'center', emptyText: '' },
            { field: 'total', label: 'Total', width: '15%', headerAlign: 'center', emptyText: '' },
        ],
    },
    {
        id: 'so_totals', type: 'keyvalue', marginBottom: 0,
        width: '40%', blockAlign: 'right', ruleColor: RULE, labelBackground: 'none',
        labelFontSize: BASE, valueFontSize: BASE, labelWidth: '50%',
        rows: [
            { field: '__text', label: 'VAT', text: 'Rp', span: 3 },
            { field: '__text', label: 'Total Ammount', text: 'Rp', span: 3 },
        ],
    },
    {
        id: 'so_notes', type: 'grid', gap: 2, marginBottom: 6, box: `1px solid ${RULE}`, padding: '3px 5px 20px',
        items: [{ ...text('Notes:'), col: 1, span: 12, row: 1 }],
    },
    {
        id: 'so_signatures', type: 'signature', variant: 'block', fontSize: BASE, boldFirstLine: false,
        marginBottom: 6, padding: '12px 0 8px', borderBottom: '1px solid #bbb',
        boxes: [
            { caption: 'Prepared by,', height: 42, fields: ['so.prepared_by_signed'] },
            { caption: 'Approved by,', height: 42, fields: ['so.customer_signed'], align: 'right' },
        ],
    },
    {
        id: 'so_attention', type: 'keyvalue', variant: 'plain', marginBottom: 0,
        title: 'Attention:',
        labelFontSize: 8, valueFontSize: 8, separator: '',
        rows: ATTENTION_NOTES.map((t, i) => ({ field: '__text', label: `${i + 1}.`, text: t, span: 3 })),
    },
];

export const SALES_ORDER_DEFAULT: PrintLayout = {
    version: 1,
    paper: { size: 'A4', orientation: 'portrait', marginMm: 8 },
    fontFamily: PRINT_FONT,
    paddingMm: 5,
    bands: BANDS,
};

