/**
 * Built-in Kartu Picking layout — a transcription of the hand-built card in
 * pickLists/PickListPrintModal.tsx. Applies until the client saves their own.
 */

import type { PrintLayout, Band, FieldSpec, GridItem } from '../types';
import { PRINT_FONT } from '../../typography';

const BASE = 10;
const RULE = '#555';
const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, fontSize: BASE, ...extra });
const text = (t: string, extra: Partial<FieldSpec> = {}): FieldSpec => f('__text', { text: t, ...extra });

/** One "Label : value" line of the facts block; labels bold, values after ': '. */
const fact = (row: number, label: string, value: string): GridItem[] => [
    { ...text(label, { bold: true }), col: 1, span: 6, row },
    { ...f(value, { prefix: ': ' }), col: 7, span: 6, row },
];

const FACTS: [string, string][] = [
    ['No. SO', 'plist.so_code'],
    ['Pelanggan / Customer', 'plist.customer'],
    ['Jml koli / Cartons', 'plist.carton_count'],
    ['No. Pengiriman / Shipment', 'plist.shipment'],
];

const BANDS: Band[] = [
    {
        id: 'plist_header', type: 'grid', gap: 8, marginBottom: 8,
        borderBottom: '2px solid #000', padding: '0 0 6px',
        items: [
            {
                col: 1, span: 9, row: 1, stackGap: 0, stack: [
                    f('plist.company_name', { fontSize: 12, bold: true, hideWhenEmpty: true }),
                    text('KARTU PICKING', { fontSize: 15, bold: true, serif: true }),
                    text('Pick List Card', { fontSize: 9, color: '#555' }),
                ],
            },
            {
                col: 11, span: 2, row: 1, align: 'right', stackGap: 0, stack: [
                    f('plist.qr', { qrSize: 96, qrCaption: '', qrFrame: false }),
                    f('plist.code', { fontSize: 12, bold: true, letterSpacing: 1, align: 'center' }),
                ],
            },
        ],
    },
    {
        id: 'plist_facts', type: 'grid', gap: 1, marginBottom: 10,
        items: FACTS.flatMap(([label, value], i) => fact(i + 1, label, value)),
    },
    {
        id: 'plist_summary_heading', type: 'grid', marginBottom: 3,
        items: [{ ...f('plist.summary_heading', { bold: true, hideWhenEmpty: true }), col: 1, span: 12, row: 1 }],
    },
    {
        id: 'plist_summary', type: 'table', source: 'plist_summary', fontSize: BASE, ruleColor: RULE,
        hideWhenEmpty: true, marginBottom: 10,
        columns: [
            { field: 'no', label: 'No', width: '8%', align: 'center' },
            { field: 'item', label: 'Barang / Item', width: '30%' },
            { field: 'size', label: 'Size', width: '10%', align: 'center', emptyText: '' },
            { field: 'warna', label: 'Warna', width: '12%', emptyText: '' },
            { field: 'combo', label: 'Combo', width: '10%', emptyText: '' },
            { field: 'cartons', label: 'Koli', width: '12%', align: 'right', headerAlign: 'center' },
            { field: 'qty', label: 'Qty', width: '18%', align: 'right', headerAlign: 'center' },
        ],
    },
    {
        id: 'plist_cartons_heading', type: 'grid', marginBottom: 3,
        items: [{ ...text('Daftar Koli / Carton Checklist:', { bold: true }), col: 1, span: 12, row: 1 }],
    },
    {
        // Paper fallback for the scan loop: the picker ticks boxes here when a phone
        // is unavailable, then keys the list from the desktop.
        id: 'plist_cartons', type: 'table', source: 'plist_cartons', fontSize: BASE, ruleColor: RULE,
        // No gross weight on any carton -> no total row, rather than a blank one.
        hideWhenEmpty: false, hideBlankFooter: true, marginBottom: 10,
        emptyMessage: 'Belum ada koli / no cartons allocated',
        columns: [
            { field: 'no', label: 'No', width: '7%', align: 'center' },
            { field: 'carton', label: 'No. Koli / Carton', width: '19%', mono: true },
            { field: 'item_code', label: 'Barang / Item', width: '13%' },
            { field: 'size', label: 'Size', width: '7%', align: 'center', emptyText: '' },
            { field: 'warna', label: 'Warna', width: '11%', emptyText: '' },
            { field: 'combo', label: 'Combo', width: '8%', emptyText: '' },
            { field: 'packaging', label: 'Kemasan / Packaging', width: '8%' },
            {
                field: 'qty', label: 'Qty', width: '12%', align: 'right', headerAlign: 'center',
                footer: { field: 'plist.gross_total_label', bold: true, align: 'right' },
            },
            // The figure the loader and the carrier both check the load against.
            {
                field: 'gross', label: 'Bruto', width: '10%', align: 'right', headerAlign: 'center',
                footer: { field: 'plist.gross_total', bold: true, align: 'right' },
            },
            { field: 'check', label: '✓', width: '5%', align: 'center', emptyText: '' },
        ],
    },
    {
        id: 'plist_notes', type: 'grid', gap: 4, marginBottom: 8,
        items: [
            { ...f('plist.notes', { prefix: 'Catatan / Notes: ', prefixBold: true, hideWhenEmpty: true }), col: 1, span: 12, row: 1 },
        ],
    },
    {
        id: 'plist_signatures', type: 'signature', variant: 'block', fontSize: BASE, align: 'center',
        boldFirstLine: false, padding: '20px 0 0', marginBottom: 0,
        boxes: [
            { caption: 'Dibuat oleh / Issued by', height: 40, fields: ['plist.sign_line'] },
            { caption: 'Picker', height: 40, fields: ['plist.sign_line'] },
            { caption: 'QC / Checked by', height: 40, fields: ['plist.sign_line'] },
        ],
    },
];

export const PICK_LIST_DEFAULT: PrintLayout = {
    version: 1,
    paper: { size: 'A4', orientation: 'portrait', marginMm: 8 },
    fontFamily: PRINT_FONT,
    paddingMm: 5,
    bands: BANDS,
};
