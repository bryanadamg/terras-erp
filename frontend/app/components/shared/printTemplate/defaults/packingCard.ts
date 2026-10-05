/**
 * Built-in Kartu Packing layout — a transcription of the hand-built card in
 * packing/PackingCardPrintModal.tsx. Applies until the client saves their own.
 */

import type { PrintLayout, Band, FieldSpec, GridItem } from '../types';
import { PRINT_FONT } from '../../typography';

const BASE = 10;
const RULE = '#555';
const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, fontSize: BASE, ...extra });
const text = (t: string, extra: Partial<FieldSpec> = {}): FieldSpec => f('__text', { text: t, ...extra });

/** One "Label : value" line of the facts block; labels bold, values after ': '. */
const fact = (row: number, label: string | FieldSpec, value: string, extra: Partial<FieldSpec> = {}): GridItem[] => [
    { ...(typeof label === 'string' ? text(label, { bold: true }) : label), col: 1, span: 4, row },
    { ...f(value, { prefix: ': ', ...extra }), col: 5, span: 8, row },
];

const FACTS: [string | FieldSpec, string, Partial<FieldSpec>?][] = [
    ['Barang / Item', 'pcard.item'],
    ['Warna / Colour', 'pcard.color'],
    ['Kode Warna', 'pcard.color_code'],
    ['Size / Ukuran', 'pcard.size'],
    ['Varian', 'pcard.variant'],
    ['Target', 'pcard.target'],
    ['Isi per koli', 'pcard.box_size'],
    // Kg orders sold in another unit only — both halves drop together.
    [f('pcard.sample_weight_caption', { bold: true, hideWhenEmpty: true }), 'pcard.sample_weight', { hideWhenEmpty: true }],
    ['Satuan jual', 'pcard.selling_unit'],
    ['Jenis kemasan', 'pcard.package_label'],
    ['Mesin / Machine', 'pcard.machine'],
    ['No. SO', 'pcard.so_code'],
    ['Pelanggan', 'pcard.customer'],
    ['Target selesai', 'pcard.target_end_date'],
];

const BANDS: Band[] = [
    {
        id: 'pcard_header', type: 'grid', gap: 8, marginBottom: 8,
        borderBottom: '2px solid #000', padding: '0 0 6px',
        items: [
            {
                col: 1, span: 9, row: 1, stackGap: 0, stack: [
                    f('pcard.company_name', { fontSize: 12, bold: true, hideWhenEmpty: true }),
                    text('KARTU PACKING', { fontSize: 15, bold: true, serif: true }),
                    text('Packing Order Card', { fontSize: 9, color: '#555' }),
                ],
            },
            {
                col: 11, span: 2, row: 1, align: 'right', stackGap: 0, stack: [
                    f('pcard.qr', { qrSize: 96, qrCaption: '', qrFrame: false }),
                    f('pcard.code', { fontSize: 12, bold: true, letterSpacing: 1, align: 'center' }),
                ],
            },
        ],
    },
    {
        id: 'pcard_facts', type: 'grid', gap: 1, marginBottom: 10,
        items: FACTS.flatMap(([label, value, extra], i) => fact(i + 1, label, value, extra)),
    },
    {
        id: 'pcard_materials_heading', type: 'grid', marginBottom: 3,
        items: [{ ...f('pcard.materials_heading', { bold: true, hideWhenEmpty: true }), col: 1, span: 12, row: 1 }],
    },
    {
        id: 'pcard_materials', type: 'table', source: 'pcard_materials', fontSize: BASE, ruleColor: RULE,
        hideWhenEmpty: true, marginBottom: 10,
        columns: [
            { field: 'no', label: 'No', width: '8%', align: 'center' },
            { field: 'item', label: 'Bahan / Material', width: '52%' },
            { field: 'planned', label: 'Rencana', width: '20%', align: 'right', headerAlign: 'center' },
            { field: 'used', label: 'Dipakai', width: '20%', headerAlign: 'center', emptyText: '' },
        ],
    },
    {
        id: 'pcard_log_heading', type: 'grid', marginBottom: 3,
        items: [{ ...text('Catatan Packing / Packing Log:', { bold: true }), col: 1, span: 12, row: 1 }],
    },
    {
        // Blank grid the packer fills in by hand, then keys against the QR.
        id: 'pcard_log', type: 'table', source: 'pcard_log', fontSize: BASE, ruleColor: RULE,
        hideWhenEmpty: false, minRows: 8, padRowHeight: 18, marginBottom: 10,
        columns: [
            { field: 'date', label: 'Tanggal', width: '20%', align: 'center' },
            { field: 'qty', label: 'Qty', width: '20%', align: 'center' },
            { field: 'koli', label: 'Jml Koli', width: '20%', align: 'center' },
            { field: 'lot', label: 'Lot Asal', width: '20%', align: 'center' },
            { field: 'operator', label: 'Operator', width: '20%', align: 'center' },
        ],
    },
    {
        id: 'pcard_notes', type: 'grid', gap: 4, marginBottom: 8,
        items: [
            { ...f('pcard.notes', { prefix: 'Catatan / Notes: ', prefixBold: true, hideWhenEmpty: true }), col: 1, span: 12, row: 1 },
        ],
    },
    {
        id: 'pcard_signatures', type: 'signature', variant: 'block', fontSize: BASE, align: 'center',
        boldFirstLine: false, padding: '20px 0 0', marginBottom: 0,
        boxes: [
            { caption: 'Dibuat oleh / Issued by', height: 40, fields: ['pcard.sign_line'] },
            { caption: 'Packer', height: 40, fields: ['pcard.sign_line'] },
            { caption: 'Diperiksa / Checked by', height: 40, fields: ['pcard.sign_line'] },
        ],
    },
];

export const PACKING_CARD_DEFAULT: PrintLayout = {
    version: 1,
    paper: { size: 'A4', orientation: 'portrait', marginMm: 8 },
    fontFamily: PRINT_FONT,
    paddingMm: 5,
    bands: BANDS,
};
