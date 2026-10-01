/**
 * Built-in SPK Produksi (MO sheet) layout — a transcription of the hand-built
 * document it replaced in manufacturing/MOPrintModal.tsx. Applies until the client
 * saves their own. No QR anywhere: an MO print is supervisory.
 */

import type { PrintLayout, Band, FieldSpec, GridItem } from '../types';
import { PRINT_FONT } from '../../typography';

const BASE = 8;
const RULE = '#ccc';
/** Section caption with the old thin rule. */
const SECTION = { titleUppercase: true, borderTop: `1px solid ${RULE}`, padding: '4px 0 0' } as const;

const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, fontSize: BASE, ...extra });
const text = (t: string, extra: Partial<FieldSpec> = {}): FieldSpec => f('__text', { text: t, ...extra });
const stack = (col: number, span: number, fields: FieldSpec[], extra: Partial<GridItem> = {}): GridItem =>
    ({ col, span, row: 1, stackGap: 2, stack: fields, ...extra });

const BANDS: Band[] = [
    {
        id: 'ms_header', type: 'grid', gap: 8, marginBottom: 8,
        borderBottom: '2px solid #000', padding: '0 0 6px',
        items: [
            stack(1, 4, [
                f('company.logo', { imageHeight: 44, hideWhenEmpty: true }),
                f('ms.company_name_fallback', { fontSize: 13, bold: true, color: '#003080', hideWhenEmpty: true }),
                f('company.address', { fontSize: 7, color: '#555', hideWhenEmpty: true }),
                f('ms.company_contact', { fontSize: 7, color: '#555', hideWhenEmpty: true }),
            ], { stackGap: 0 }),
            stack(5, 4, [
                text('SPK PRODUKSI', { fontSize: 16, bold: true, letterSpacing: 1, align: 'center' }),
                f('ms.print_date', { prefix: 'Tanggal: ', color: '#333', align: 'center' }),
                f('ms.header_meta', { fontSize: 7, color: '#555', align: 'center', hideWhenEmpty: true }),
            ]),
            { ...f('ms.code', { bold: true, mono: true, align: 'right' }), col: 9, span: 4, row: 1 },
        ],
    },
    {
        id: 'ms_identity', type: 'keyvalue', marginBottom: 8,
        labelWidth: '18%', labelFontSize: BASE, valueFontSize: BASE, ruleColor: RULE, labelBackground: '#f0f0f0',
        rows: [
            { field: 'ms.article', label: 'ARTICLE', span: 3, bold: true, fontSize: 9 },
            { field: 'ms.size', label: 'Size', span: 3, bold: true, hideWhenEmpty: true },
            { field: 'ms.color', label: 'Warna', hideWhenEmpty: true },
            { field: 'ms.color_code', label: 'Kode Warna', bold: true, hideWhenEmpty: true },
            { field: 'ms.code', label: 'No. SPK', mono: true },
            { field: 'ms.qty', label: 'Jml Order', bold: true },
            { field: 'ms.sales_order', label: 'Sales Order', mono: true, hideWhenEmpty: true },
            { field: 'ms.so_customer', label: 'Customer', hideWhenEmpty: true },
            { field: 'ms.customer_no_so', label: 'Customer', span: 3, hideWhenEmpty: true },
            { field: 'ms.target_start', label: 'Target Start' },
            { field: 'ms.machine', label: 'No Mesin' },
            { field: 'ms.target_end', label: 'Target End' },
            { field: 'ms.tolerance', label: 'Toleransi' },
            { field: 'ms.actual_start', label: 'Actual Start', hideWhenEmpty: true },
            { field: 'ms.actual_end', label: 'Actual End', hideWhenEmpty: true },
            { field: 'ms.status', label: 'Status' },
            { field: 'ms.output_location', label: 'Output Loc', emptyText: '' },
        ],
    },
    {
        id: 'ms_tech', type: 'keyvalue', title: 'Spesifikasi Teknis', ...SECTION, marginBottom: 8,
        labelWidth: '18%', labelFontSize: BASE, valueFontSize: BASE, ruleColor: RULE, labelBackground: '#f0f0f0',
        rows: [
            { field: 'ms.berat_mateng', label: 'Berat Mateng', hideWhenEmpty: true },
            { field: 'ms.berat_mentah', label: 'Berat Mentah', hideWhenEmpty: true },
            { field: 'ms.lebar_mesin', label: 'Lebar Mesin', hideWhenEmpty: true },
            { field: 'ms.tarikan_mentah', label: 'Tarikan Mentah', hideWhenEmpty: true },
            { field: 'ms.p_tulisan', label: 'P. Tulisan', hideWhenEmpty: true },
            { field: 'ms.bandul_1kg', label: 'Bandul 1kg', hideWhenEmpty: true },
            { field: 'ms.kerapatan', label: 'Kerapatan', hideWhenEmpty: true },
            { field: 'ms.sisir_no', label: 'Sisir No.', hideWhenEmpty: true },
            { field: 'ms.pemakaian_obat', label: 'Pemakaian Obat', span: 3, hideWhenEmpty: true },
        ],
    },
    {
        id: 'ms_materials', type: 'table', source: 'ms_materials', title: 'Material', ...SECTION,
        // White rules: the old material list drew no cell borders.
        marginBottom: 8, fontSize: BASE, ruleColor: '#fff', hideWhenEmpty: false,
        columns: [
            { field: 'req_qty', label: 'Req. Qty', width: '14%', headerAlign: 'right', bold: true, emptyText: '' },
            { field: 'item', label: 'Component', width: '70%' },
            { field: 'source', label: 'Source', width: '16%', align: 'center', emptyText: '' },
        ],
    },
    {
        id: 'ms_child_mos', type: 'table', source: 'ms_child_mos', title: 'Child Manufacturing Orders', ...SECTION,
        marginBottom: 8, fontSize: BASE, ruleColor: '#ddd', headerBackground: 'none',
        columns: [{ field: 'summary', label: 'Order', mutedDetail: true }],
    },
    {
        id: 'ms_photo', type: 'grid', title: 'Sample Produk', ...SECTION, marginBottom: 16,
        items: [{ ...f('ms.sample_photo', { imageHeight: 160, hideWhenEmpty: true }), col: 1, span: 12, row: 1 }],
    },
    {
        id: 'ms_footer', type: 'grid', gap: 8, marginBottom: 0, alignItems: 'end',
        borderTop: `1px solid ${RULE}`, padding: '8px 0 0',
        items: [
            stack(1, 8, [f('ms.footer_ref', { fontSize: 7, color: '#555' }), f('ms.printed_at', { fontSize: 7, color: '#555', prefix: 'Printed: ' })], { stackGap: 0 }),
            stack(9, 2, [f('__blank'), text('ACC TEKNISI', { fontSize: 7, bold: true, align: 'center' })]),
            stack(11, 2, [
                f('ms.qc_line', { hideWhenEmpty: true }),
                f('ms.qc_caption', { fontSize: 7, bold: true, align: 'center', hideWhenEmpty: true }),
            ]),
        ],
    },
];

export const MO_SHEET_DEFAULT: PrintLayout = {
    version: 1,
    paper: { size: 'A4', orientation: 'portrait', marginMm: 8 },
    fontFamily: PRINT_FONT,
    paddingMm: 5,
    bands: BANDS,
};
