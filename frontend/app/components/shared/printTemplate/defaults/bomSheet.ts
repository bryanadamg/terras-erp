/**
 * Built-in BOM sheet layout — a transcription of the hand-built document it
 * replaced in bom/BOMPrintModal.tsx. Applies until the client saves their own.
 *
 * The old sheet set its type in pt; bands take px, so 9pt → 12, 8pt → 10.7,
 * 7.5pt → 10. Its two side-by-side section pairs (Detail Teknis | Pengukuran,
 * Sizes | Components) stack here: bands flow top to bottom.
 */

import type { PrintLayout, Band, FieldSpec, GridItem } from '../types';
import { PRINT_FONT } from '../../typography';

const TABLE = 10.7;
const SMALL = 10;
const RULE = '#ccc';
/** The old section heading's underline, drawn under the band title. */
const SECTION = { titleUppercase: true, borderTop: '1.5px solid #333', padding: '6px 0 0' } as const;

const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, fontSize: SMALL, ...extra });
const stack = (col: number, span: number, fields: FieldSpec[], extra: Partial<GridItem> = {}): GridItem =>
    ({ col, span, row: 1, stackGap: 2, stack: fields, ...extra });

const BANDS: Band[] = [
    {
        id: 'bs_header', type: 'grid', gap: 8, marginBottom: 10,
        borderBottom: '2px solid #000', padding: '0 0 8px',
        items: [
            stack(1, 7, [
                f('company.logo', { imageHeight: 52, hideWhenEmpty: true }),
                f('bs.company_name_fallback', { fontSize: 13, bold: true, color: '#003080', hideWhenEmpty: true }),
                f('company.address', { color: '#555', hideWhenEmpty: true }),
                f('bs.company_contact', { color: '#555', hideWhenEmpty: true }),
            ], { stackGap: 0 }),
            stack(8, 5, [
                f('__text', { text: 'Bill of Materials', fontSize: 15, bold: true, uppercase: true, align: 'right' }),
                f('bs.code', { fontSize: 11, mono: true, color: '#0000cc', align: 'right' }),
                f('bs.print_date', { prefix: 'Printed: ', color: '#555', align: 'right' }),
                f('bs.header_note', { color: '#333', align: 'right', hideWhenEmpty: true }),
            ]),
        ],
    },
    {
        id: 'bs_identity', type: 'keyvalue', marginBottom: 8,
        labelWidth: '15%', labelFontSize: TABLE, valueFontSize: TABLE, ruleColor: RULE, labelBackground: '#f5f5f5',
        rows: [
            { field: 'bs.item', label: 'Item' },
            { field: 'bs.batch_output', label: 'Batch Output' },
            { field: 'bs.variant', label: 'Variant', hideWhenEmpty: true },
            { field: 'bs.status', label: 'Status', hideWhenEmpty: true },
            { field: 'bs.customer', label: 'Customer', hideWhenEmpty: true },
            { field: 'bs.machine', label: 'Machine', hideWhenEmpty: true },
            { field: 'bs.description', label: 'Description', span: 3, hideWhenEmpty: true },
        ],
    },
    {
        id: 'bs_teknis', type: 'keyvalue', title: 'Detail Teknis', ...SECTION, marginBottom: 8,
        width: '44%', blockAlign: 'left',
        labelWidth: '48%', labelFontSize: TABLE, valueFontSize: TABLE, ruleColor: RULE, labelBackground: '#f5f5f5',
        rows: [
            { field: 'bs.kerapatan', label: 'Kerapatan / Picks', span: 3, hideWhenEmpty: true },
            { field: 'bs.sisir_no', label: 'Sisir No.', span: 3, hideWhenEmpty: true },
            { field: 'bs.pemakaian_obat', label: 'Pemakaian Obat', span: 3, hideWhenEmpty: true },
            { field: 'bs.sample_oleh', label: 'Sample Oleh', span: 3, hideWhenEmpty: true },
            { field: 'bs.berat_mateng', label: 'Berat Mateng', span: 3, hideWhenEmpty: true },
            { field: 'bs.berat_mentah', label: 'Berat Mentah (Pelesan)', span: 3, hideWhenEmpty: true },
        ],
    },
    {
        id: 'bs_measurements', type: 'table', source: 'bs_measurements', title: 'Pengukuran Bahan', ...SECTION,
        marginBottom: 8, fontSize: TABLE, ruleColor: RULE, headerBackground: '#e8e8e8',
        columns: [
            { field: 'ukuran', label: 'Ukuran', width: '40%' },
            { field: 'mesin', label: 'Keluar Mesin', width: '25%', align: 'right', decimals: 2 },
            { field: 'celup', label: 'Celup / Setting', width: '25%', align: 'right', decimals: 2 },
            { field: 'unit', label: 'Sat.', width: '10%' },
        ],
    },
    {
        id: 'bs_sizes', type: 'table', source: 'bs_sizes', title: '{auto}', ...SECTION,
        marginBottom: 8, fontSize: TABLE, ruleColor: RULE, headerBackground: '#e8e8e8',
        columns: [
            { field: 'size', label: 'Size', bold: true },
            { field: 'target', label: 'Target', align: 'right', decimals: 2 },
            { field: 'min', label: 'Min', align: 'right', decimals: 2 },
            { field: 'max', label: 'Max', align: 'right', decimals: 2 },
        ],
    },
    {
        id: 'bs_components', type: 'table', source: 'bs_lines', title: 'Komponen / Materials', ...SECTION,
        marginBottom: 16, fontSize: TABLE, ruleColor: RULE, headerBackground: '#e8e8e8',
        columns: [
            { field: 'no', label: '#', width: '5%', align: 'center' },
            { field: 'item_code', label: 'Kode', width: '22%' },
            { field: 'item_name', label: 'Nama Item', width: '35%' },
            { field: 'percentage', label: '%', width: '10%', align: 'right' },
            { field: 'attributes', label: 'Atribut', width: '28%', footer: { field: 'bs.component_count', align: 'right' } },
        ],
    },
    {
        id: 'bs_photo', type: 'grid', title: 'Sample Photo', ...SECTION, marginBottom: 16,
        items: [{ ...f('bs.sample_photo', { imageHeight: 200, hideWhenEmpty: true }), col: 1, span: 12, row: 1 }],
    },
    {
        id: 'bs_design', type: 'grid', title: 'Design / Susunan Rumusan', ...SECTION, marginBottom: 16,
        items: [
            { ...f('bs.design_image', { imageHeight: 900, hideWhenEmpty: true }), col: 1, span: 12, row: 1 },
            { ...f('bs.design_pdf_note', { fontSize: TABLE, color: '#555', hideWhenEmpty: true }), col: 1, span: 12, row: 2 },
        ],
    },
    {
        id: 'bs_footer', type: 'grid', gap: 8, marginBottom: 0, alignItems: 'end',
        borderTop: '1px solid #ccc', padding: '8px 0 0',
        items: [
            stack(1, 8, [f('bs.footer_ref', { color: '#555' }), f('bs.printed_at', { prefix: 'Printed: ', color: '#555' })], { stackGap: 0 }),
            stack(10, 3, [
                f('bs.signature_line', { hideWhenEmpty: true }),
                f('bs.signature_caption', { color: '#555', align: 'center', hideWhenEmpty: true }),
            ]),
        ],
    },
];

export const BOM_SHEET_DEFAULT: PrintLayout = {
    version: 1,
    paper: { size: 'A4', orientation: 'portrait', marginMm: 8 },
    fontFamily: PRINT_FONT,
    paddingMm: 5,
    bands: BANDS,
};
