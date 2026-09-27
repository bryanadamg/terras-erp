/**
 * Built-in Purchase Order layout — a transcription of the hand-built PODocument it
 * replaced in purchasing/PurchaseOrderPrintModal.tsx. Applies until the client
 * saves their own.
 */

import type { PrintLayout, Band, FieldSpec, GridItem } from '../types';
import { PRINT_FONT } from '../../typography';

const BASE = 9;
const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, fontSize: BASE, ...extra });
const text = (t: string, extra: Partial<FieldSpec> = {}): FieldSpec => f('__text', { text: t, ...extra });
const heading = (t: string) => text(t, { bold: true, align: 'center' });
const stack = (col: number, span: number, fields: FieldSpec[], extra: Partial<GridItem> = {}): GridItem =>
    ({ col, span, row: 1, stackGap: 2, stack: fields, ...extra });

const LINE = '1px solid #000';

const FOOTER_NOTES = [
    'Please confirm before delivery',
    'Please sign and fax back to confirm the order',
    'Please fill in PO Number in your delivery note. If not, goods will be rejected.',
    'Please deliver the goods based on delivery schedule or special request',
    'Goods are accepted from Monday to Friday at 09:00 AM - 03:00 PM',
];

const BANDS: Band[] = [
    {
        id: 'po_header', type: 'grid', gap: 8, marginBottom: 4,
        borderBottom: '1.5px solid #000', padding: '0 0 6px',
        items: [
            { ...f('company.logo', { imageHeight: 56, hideWhenEmpty: true }), col: 1, span: 1, row: 1 },
            stack(2, 6, [
                f('company.name', { fontSize: 15, bold: true, hideWhenEmpty: true }),
                f('company.address', { hideWhenEmpty: true }),
                f('company.phone_fax', { hideWhenEmpty: true }),
                f('company.email', { prefix: 'Email: ', hideWhenEmpty: true }),
            ], { stackGap: 0 }),
            stack(8, 5, [
                f('po.barcode', { align: 'right', imageHeight: 42 }),
                text('PURCHASE ORDER', { fontSize: 22, bold: true, align: 'right' }),
            ], { align: 'right' }),
        ],
    },
    {
        // Three boxed cells stretched to one height, like the old three-cell table row.
        id: 'po_parties', type: 'grid', gap: 0, cellBox: LINE, alignItems: 'stretch', marginBottom: 0,
        items: [
            stack(1, 6, [
                heading('SUPPLIER'),
                f('po.supplier_attn', { prefix: 'Attn : ', emptyText: '' }),
                f('po.supplier_name', { prefix: 'Company : ', emptyText: '' }),
                f('po.supplier_address', { prefix: 'Address : ', emptyText: '' }),
            ]),
            stack(7, 3, [
                heading('CONTACT PERSON'),
                f('po.supplier_phone', { prefix: 'Telp : ', emptyText: '' }),
                f('po.supplier_fax', { prefix: 'Fax : ', emptyText: '' }),
            ]),
            stack(10, 3, [
                f('po.number', { prefix: 'PO NUMBER : ', bold: true }),
                f('po.ssn', { prefix: 'SSN : ', emptyText: '' }),
                f('po.date', { prefix: 'PO DATE : ', emptyText: '' }),
            ]),
        ],
    },
    {
        id: 'po_terms', type: 'keyvalue', variant: 'plain', marginBottom: 0,
        box: LINE, borderTop: 'none', padding: '2px 5px',
        labelFontSize: BASE, valueFontSize: BASE, labelWidth: '80px',
        rows: [
            { field: 'po.email', label: 'Email', span: 3, emptyText: '' },
            { field: 'po.kurs_pajak', label: 'Kurs Pajak', span: 3, hideWhenEmpty: true },
            { field: 'po.ktbi', label: 'KTBI', span: 3, hideWhenEmpty: true },
            { field: 'po.code', label: 'Code', span: 3, emptyText: '' },
            { field: 'po.payment_term', label: 'Payment', span: 3, emptyText: '' },
            { field: 'po.category', label: 'Category', span: 3, emptyText: '' },
        ],
    },
    {
        id: 'po_lines', type: 'table', source: 'po_lines', fontSize: BASE, marginBottom: 0,
        hideWhenEmpty: false, minRows: 8, padRowHeight: 26, ruleColor: '#000', headerBackground: 'none',
        columns: [
            { field: 'no', label: 'No', width: '5%', align: 'center' },
            { field: 'description', label: 'DESCRIPTION\nItem Description', width: '37%', headerAlign: 'center' },
            { field: 'qty', label: 'Qty', width: '13%', align: 'center' },
            { field: 'unit_price', label: 'Price\n( Rp )', width: '15%', align: 'right', headerAlign: 'center', emptyText: '' },
            { field: 'line_total', label: 'Total\n( Rp )', width: '17%', align: 'right', headerAlign: 'center', emptyText: '' },
            { field: 'deadline', label: 'Deadline', width: '13%', align: 'center', emptyText: '' },
        ],
    },
    {
        id: 'po_totals', type: 'keyvalue', marginBottom: 0,
        width: '42%', blockAlign: 'right', ruleColor: '#000', labelBackground: 'none',
        labelFontSize: BASE, valueFontSize: BASE, labelWidth: '48%',
        rows: [
            { field: 'po.subtotal', label: 'Subtotal', span: 3, align: 'right' },
            { field: 'po.discount', label: 'Discount', span: 3, align: 'right' },
            { field: 'po.vat', label: '{auto}', span: 3, align: 'right', hideWhenEmpty: true },
            { field: 'po.total', label: 'Total', span: 3, align: 'right', bold: true },
        ],
    },
    {
        id: 'po_notes', type: 'grid', gap: 2, marginBottom: 8, box: LINE, padding: '2px 5px',
        items: [stack(1, 12, [text('Notes', { bold: true }), f('po.notes', { emptyText: '' })])],
    },
    {
        id: 'po_signatures', type: 'signature', variant: 'block', align: 'center', fontSize: BASE, marginBottom: 6,
        boxes: [
            { caption: 'Prepared by', height: 38, fields: ['po.prepared_by'] },
            { caption: 'Examined by', height: 38, fields: ['po.examined_by'] },
            { caption: 'Approved by', height: 38, fields: ['po.approved_by'] },
            { caption: 'Supplier', height: 38, fields: ['po.supplier_name'] },
        ],
    },
    {
        id: 'po_footer_notes', type: 'keyvalue', variant: 'plain', marginBottom: 0, padding: '8px 0 0',
        labelFontSize: 8.5, valueFontSize: 8.5, labelWidth: '28px',
        rows: FOOTER_NOTES.map((t, i) => ({ field: '__text', label: i === 0 ? 'Note' : '-', text: t, span: 3 })),
    },
];

export const PURCHASE_ORDER_DEFAULT: PrintLayout = {
    version: 1,
    paper: { size: 'A4', orientation: 'portrait', marginMm: 8 },
    fontFamily: PRINT_FONT,
    paddingMm: 3,
    bands: BANDS,
};

