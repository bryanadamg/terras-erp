/**
 * Built-in Surat Jalan layout — a transcription of the client's paper form (see
 * the hand-built SJDocument it replaced in dispatch/SuratJalanPrintModal.tsx): the
 * legal note on top, a dashed tear line, then the Perincian carton breakdown under
 * the same SJ number. Applies until the client saves their own.
 */

import type { PrintLayout, Band, GridBand, GridItem, FieldSpec, SignatureBand, TableColumn } from '../types';
import { PRINT_FONT } from '../../typography';

const BASE = 9;
const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, fontSize: BASE, ...extra });
const text = (t: string, extra: Partial<FieldSpec> = {}): FieldSpec => f('__text', { text: t, ...extra });
const cell = (spec: FieldSpec, col: number, span: number, row: number): GridItem => ({ ...spec, col, span, row });

const RULE = '#555';

/**
 * Both bands open with the same letterhead — one factory, so the two headers on
 * one sheet cannot drift apart.
 */
function header(id: string, title: string, titleSize: number, numberPrefix: string, withDate: boolean, extra: Partial<GridBand> = {}): GridBand {
    return {
        id, type: 'grid', gap: 4, marginBottom: 6, alignItems: 'center', ...extra,
        items: [
            cell(text(title, { fontSize: titleSize, bold: true, align: 'center' }), 1, 6, 1),
            cell(f('sj.number', { prefix: numberPrefix, bold: true }), 7, 6, 1),
            cell(f('company.logo', { imageHeight: 34, hideWhenEmpty: true }), 1, 1, 2),
            cell(f('company.name', { fontSize: 12, bold: true, uppercase: true, hideWhenEmpty: true }), 2, 5, 2),
            {
                col: 7, span: 6, row: 2, stackGap: 1,
                stack: [
                    text('Kepada Yth :'),
                    f('sj.customer_name', { bold: true }),
                    f('sj.customer_address', { hideWhenEmpty: true }),
                ],
            },
            ...(withDate ? [cell(f('sj.date', { prefix: 'Tanggal : ', emptyText: '' }), 1, 6, 3)] : []),
            cell(f('sj.page', { prefix: 'Hal : ' }), 7, 6, 3),
        ],
    };
}

const signatures = (id: string): SignatureBand => ({
    id, type: 'signature', variant: 'block', marginBottom: 6, padding: '12px 0 0',
    boxes: [
        { caption: 'Tanda Terima dan Cap Perusahaan', height: 40 },
        { caption: 'Nama Supir', height: 40 },
        { caption: 'Gudang', height: 40 },
        { caption: 'Hormat Kami', height: 40, fields: ['company.name', 'sj.prepared_by'] },
    ],
});

const slot = (n: number): TableColumn => ({
    field: `carton_${n}`, label: '', width: '5.5%', align: 'center', dotted: true, emptyText: '',
});

const BANDS: Band[] = [
    header('sj_header', 'SURAT JALAN', 15, 'No : ', false),
    {
        id: 'sj_transport', type: 'keyvalue', variant: 'plain', marginBottom: 6,
        labelFontSize: BASE, valueFontSize: BASE,
        rows: [
            { field: 'sj.date', label: 'Tanggal', span: 3, emptyText: '' },
            { field: 'sj.vehicle', label: 'Kendaraan No.', span: 3, emptyText: '' },
            { field: 'sj.driver', label: 'Supir', span: 3, hideWhenEmpty: true },
        ],
    },
    {
        id: 'sj_intro', type: 'grid', gap: 4, marginBottom: 4,
        items: [cell(text('Bersama ini kami kirimkan barang-barang tersebut dibawah ini :'), 1, 12, 1)],
    },
    {
        id: 'sj_lines', type: 'table', source: 'sj_lines', fontSize: BASE, marginBottom: 6,
        hideWhenEmpty: false, minRows: 4, ruleColor: RULE, headerBackground: 'none',
        columns: [
            { field: 'qty', label: 'QTY', width: '8%', align: 'right', headerAlign: 'center' },
            { field: 'unit', label: 'Unit', width: '7%', align: 'center' },
            { field: 'item_name', label: 'NAMA BARANG', width: '24%' },
            { field: 'size', label: 'SIZE', width: '8%', align: 'center', emptyText: '' },
            { field: 'warna', label: 'WARNA', width: '20%', emptyText: '' },
            { field: 'po_ref', label: 'NO PO', width: '18%', align: 'center', emptyText: '' },
            { field: 'no_ref', label: 'NO REF', width: '15%', emptyText: '' },
        ],
    },
    {
        id: 'sj_notes', type: 'grid', gap: 4, marginBottom: 6,
        items: [cell(f('sj.notes', { prefix: 'Catatan : ', hideWhenEmpty: true }), 1, 12, 1)],
    },
    { ...signatures('sj_sign'), marginBottom: 22 },
    header('sj_perincian_header', 'PERINCIAN', 14, 'SJ No : ', true, {
        borderTop: '1px dashed #000', padding: '14px 0 0', marginBottom: 8,
    }),
    {
        id: 'sj_cartons', type: 'table', source: 'sj_cartons', fontSize: BASE, marginBottom: 6,
        hideWhenEmpty: false, minRows: 6, ruleColor: RULE, headerBackground: 'none',
        columns: [
            { field: 'name', label: 'Nama Barang :', emptyText: '' },
            slot(1), slot(2), slot(3), slot(4), slot(5), slot(6), slot(7),
            { ...slot(8), footer: { text: 'Total :', bold: true, align: 'right' } },
            { field: 'dus', label: 'Dus', width: '7%', align: 'center', emptyText: '', footer: { field: 'sj.total_dus', bold: true, align: 'center' } },
            { field: 'total', label: 'Total', width: '9%', align: 'right', headerAlign: 'center', emptyText: '', footer: { field: 'sj.total_brutto_line', bold: true, align: 'right', border: false } },
        ],
    },
    signatures('sj_sign_perincian'),
];

export const SURAT_JALAN_DEFAULT: PrintLayout = {
    version: 1,
    // A4 at 8mm matches the app-wide `@page` the hand-built note printed under.
    paper: { size: 'A4', orientation: 'portrait', marginMm: 8 },
    fontFamily: PRINT_FONT,
    paddingMm: 5,
    bands: BANDS,
};

