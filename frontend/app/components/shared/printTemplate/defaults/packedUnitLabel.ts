/**
 * Built-in carton label layout — a transcription of the hand-built A6 sticker in
 * packing/PackedUnitLabelPrintModal.tsx: headline row, then CONTENT / PO. NO /
 * LOT. NO / N W / G W, each with its Code 128 barcode, then our own footer + the
 * PU- QR. Applies until the client saves their own.
 *
 * The ruled table is a grid band whose cells each draw a half-width rule
 * (`cellBox`), inside a half-width band box: touching cells add up to one full
 * rule, so inner and outer lines print the same weight.
 */

import type { PrintLayout, Band, FieldSpec, GridItem } from '../types';
import { PRINT_FONT } from '../../typography';

const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, ...extra });
const text = (t: string, extra: Partial<FieldSpec> = {}): FieldSpec => f('__text', { text: t, ...extra });
const cell = (row: number, col: number, span: number, spec: FieldSpec | FieldSpec[], extra: Partial<GridItem> = {}): GridItem =>
    Array.isArray(spec)
        ? { col, span, row, stack: spec, stackGap: 1, ...extra }
        : { ...spec, col, span, row, ...extra };

const HALF_RULE = '0.5px solid #000';
const LBL = { fontSize: 11, bold: true };
const VAL = { fontSize: 13, bold: true };
const BAR = { imageHeight: 26, align: 'center' as const };
const BLANK = { fontSize: 13, color: '#666', hideWhenEmpty: true };

const row = (r: number, label: string, value: FieldSpec | FieldSpec[], barcode: string): GridItem[] => [
    cell(r, 1, 3, text(label, LBL)),
    cell(r, 4, 6, value),
    cell(r, 10, 3, f(barcode, BAR)),
];

const BANDS: Band[] = [
    {
        id: 'carton_table', type: 'grid', gap: 0, alignItems: 'stretch', cellBox: HALF_RULE, box: HALF_RULE,
        marginBottom: 6,
        items: [
            // Headline: house mark + style/colour, the carton's own PU- number barcoded beside it.
            cell(1, 1, 3, [
                f('company.logo', { imageHeight: 30, align: 'center', hideWhenEmpty: true }),
                f('carton.logo_fallback', { fontSize: 16, bold: true, align: 'center', hideWhenEmpty: true }),
            ]),
            cell(1, 4, 6, [
                f('carton.headline', { fontSize: 19, bold: true }),
                f('carton.identity', { fontSize: 10, bold: true, hideWhenEmpty: true }),
                f('carton.number_tilde', { fontSize: 10 }),
            ], { stackGap: 2 }),
            cell(1, 10, 3, f('carton.number_barcode', BAR)),

            ...row(2, 'CONTENT', [f('carton.content', VAL), f('carton.ket_stock', { fontSize: 10, hideWhenEmpty: true })], 'carton.content_barcode'),
            ...row(3, 'PO. NO', [f('carton.po_ref', VAL), f('carton.so_code', { fontSize: 9, color: '#333', hideWhenEmpty: true })], 'carton.po_barcode'),
            ...row(4, 'LOT. NO', f('carton.lot', VAL), 'carton.lot_barcode'),
            ...row(5, 'N W', [f('carton.nw', { ...VAL, hideWhenEmpty: true }), f('carton.nw_blank', BLANK)], 'carton.nw_barcode'),
            ...row(6, 'G W', [
                f('carton.gw', { ...VAL, hideWhenEmpty: true }),
                f('carton.gw_blank', BLANK),
                f('carton.packaging_type', { fontSize: 8, color: '#555', hideWhenEmpty: true }),
            ], 'carton.gw_barcode'),
        ],
    },
    {
        // Our handle, not the customer's: the picker scans this QR onto a pick list.
        id: 'carton_footer', type: 'grid', gap: 6, alignItems: 'end', marginBottom: 0,
        items: [
            cell(1, 1, 8, [
                f('carton.company_name', { fontSize: 9, color: '#333', hideWhenEmpty: true }),
                f('carton.package_line', { fontSize: 9, color: '#333' }),
                f('carton.packed_date', { fontSize: 9, color: '#333', emptyText: '' }),
            ], { stackGap: 0 }),
            cell(1, 9, 4, f('carton.qr', { qrSize: 72, qrCaption: '' }), { align: 'right' }),
        ],
    },
];

export const PACKED_UNIT_LABEL_DEFAULT: PrintLayout = {
    version: 1,
    paper: { size: 'A6', orientation: 'portrait', marginMm: 6 },
    fontFamily: PRINT_FONT,
    bands: BANDS,
};
