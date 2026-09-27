/**
 * Built-in Kartu Celup layout — a transcription of the hand-built document it
 * replaced in dyeing-setting/DyeRecipePrintView.tsx. Applies until the client
 * saves their own.
 */

import type { PrintLayout, Band, FieldSpec, GridItem, KeyValueRow } from '../types';
import { PRINT_FONT } from '../../typography';

const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, fontSize: 8, ...extra });
const text = (t: string, extra: Partial<FieldSpec> = {}): FieldSpec => f('__text', { text: t, ...extra });
const stack = (col: number, span: number, fields: FieldSpec[], extra: Partial<GridItem> = {}): GridItem =>
    ({ col, span, row: 1, stackGap: 0, stack: fields, ...extra });
const kv = (label: string, field: string, extra: Partial<KeyValueRow> = {}): KeyValueRow => ({ label, field, span: 1, ...extra });
// Hand-filled cells keep their printed unit ("___ KG").
const fill = (label: string, t: string): KeyValueRow => kv(label, '__text', { text: t });

const RULE = '#ccc';

const BANDS: Band[] = [
    {
        id: 'dr_header', type: 'grid', gap: 8, marginBottom: 10,
        borderBottom: '2px solid #000', padding: '0 0 6px',
        items: [
            stack(1, 4, [
                f('company.logo', { imageHeight: 44, hideWhenEmpty: true }),
                f('dr.letterhead_name', { fontSize: 13, bold: true, color: '#003080', hideWhenEmpty: true }),
                f('company.address', { fontSize: 7, color: '#555', hideWhenEmpty: true }),
                f('dr.company_contact', { fontSize: 7, color: '#555', hideWhenEmpty: true }),
            ]),
            stack(5, 4, [
                text('KARTU CELUP', { fontSize: 14, bold: true, align: 'center' }),
                f('dr.date', { fontSize: 7, color: '#555', align: 'center', prefix: 'Tanggal: ' }),
            ], { stackGap: 2 }),
            stack(9, 4, [
                f('dr.code', { bold: true, align: 'right' }),
                f('dr.substrate_type', { fontSize: 7, color: '#555', align: 'right', hideWhenEmpty: true }),
            ], { align: 'right' }),
        ],
    },
    {
        id: 'dr_job', type: 'keyvalue', marginBottom: 8,
        labelWidth: '16%', labelFontSize: 8, valueFontSize: 8, ruleColor: RULE,
        rows: [
            kv('Warna', 'dr.name', { bold: true }),
            kv('Color Matching', 'dr.color_standard'),
            fill('Nomor PO', ' '),
            fill('LOT', ' '),
            kv('Artikel', 'dr.code'),
            fill('Qty Order', '  KG'),
            fill('Volume Air', '  Liter'),
            fill('Customer', ' '),
            fill('Mesin Celup', ' '),
            fill('Tekanan / Speed', '  /  '),
        ],
    },
    {
        id: 'dr_lines', type: 'table', source: 'dr_lines', fontSize: 8, marginBottom: 12,
        hideWhenEmpty: false, ruleColor: RULE,
        columns: [
            { field: 'no', label: 'No', width: '20px', align: 'center' },
            { field: 'label', label: 'Label', width: '60px' },
            { field: 'bahan', label: 'Bahan' },
            { field: 'rate', label: 'Rate', width: '60px', align: 'right', emptyText: '' },
            { field: 'satuan', label: 'Satuan', width: '44px', align: 'center', emptyText: '' },
            { field: 'eq', label: '=', width: '14px', align: 'center' },
            { field: 'total', label: 'Total', width: '70px', align: 'right', emptyText: '' },
        ],
    },
    {
        id: 'dr_no_lines', type: 'grid', marginBottom: 0,
        items: [{ ...f('dr.no_lines_note', { color: '#888', align: 'center', hideWhenEmpty: true }), col: 1, span: 12, row: 1 }],
    },
    {
        id: 'dr_wash_baths', type: 'grid', gap: 2, marginBottom: 10,
        borderTop: `1px solid ${RULE}`, padding: '4px 0 0',
        items: [
            { ...text('BAK CUCI', { bold: true }), col: 1, span: 12, row: 1 },
            { ...f('dr.wash_baths_left', { emptyText: '' }), col: 1, span: 6, row: 2 },
            { ...f('dr.wash_baths_right', { emptyText: '' }), col: 7, span: 6, row: 2 },
        ],
    },
    {
        id: 'dr_finishing', type: 'grid', gap: 2, marginBottom: 10,
        borderTop: `1px solid ${RULE}`, padding: '4px 0 0',
        items: [
            { ...text('FINISHING', { bold: true }), col: 1, span: 12, row: 1 },
            { ...f('dr.finishing_steps', { emptyText: '' }), col: 1, span: 12, row: 2 },
        ],
    },
    {
        id: 'dr_signature', type: 'signature', marginBottom: 0,
        borderTop: `1px solid ${RULE}`, padding: '8px 0 0',
        footerFields: [{ field: 'dr.footer', fontSize: 7 }],
        boxes: [
            { caption: 'Div Celup', width: 100, height: 28 },
            { caption: 'QC / Approved', width: 100, height: 28 },
        ],
    },
];

export const DYE_RECIPE_DEFAULT: PrintLayout = {
    version: 1,
    paper: { size: 'A4', orientation: 'portrait', marginMm: 8 },
    fontFamily: PRINT_FONT,
    paddingMm: 5,
    bands: BANDS,
};
