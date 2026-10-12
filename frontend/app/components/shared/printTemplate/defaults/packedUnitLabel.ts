/**
 * Built-in carton label layout, A6 landscape: the ruled table (headline, CONTENT /
 * PO. NO / LOT. NO / N W / G W) with the PU- QR and our footer boxed beside it,
 * then the carton's PU- number as a Code 128 underneath. Only the PU- number is
 * coded — it is the one code the floor scans; the QR is for phone cameras, the
 * barcode for handheld scanners. Applies until the client saves their own.
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
const LBL = { fontSize: 11, bold: true, letterSpacing: 0.5 };
const VAL = { fontSize: 13, bold: true };
const BLANK = { fontSize: 13, color: '#666', hideWhenEmpty: true };

// A6 landscape: the ruled table on the left two-thirds, the QR + our footer boxed
// in the right third beside it, the PU- barcode centred underneath.
const row = (r: number, label: string, value: FieldSpec | FieldSpec[]): GridItem[] => [
    cell(r, 1, 2, text(label, LBL)),
    cell(r, 3, 6, value),
];

const BANDS: Band[] = [
    {
        id: 'carton_table', type: 'grid', gap: 0, alignItems: 'stretch', cellBox: HALF_RULE, box: HALF_RULE,
        marginBottom: 6,
        items: [
            // Headline: house mark + style/colour.
            cell(1, 1, 2, [
                f('company.logo', { imageHeight: 30, align: 'center', hideWhenEmpty: true }),
                f('carton.logo_fallback', { fontSize: 16, bold: true, letterSpacing: 2, align: 'center', hideWhenEmpty: true }),
            ]),
            cell(1, 3, 6, [
                f('carton.headline', { fontSize: 19, bold: true, letterSpacing: 0.5 }),
                f('carton.identity', { fontSize: 10, bold: true, letterSpacing: 0.5, hideWhenEmpty: true }),
            ], { stackGap: 2 }),

            ...row(2, 'CONTENT', [f('carton.content', VAL), f('carton.ket_stock', { fontSize: 10, hideWhenEmpty: true })]),
            ...row(3, 'PO. NO', [f('carton.po_ref', VAL), f('carton.so_code', { fontSize: 9, color: '#333', hideWhenEmpty: true })]),
            ...row(4, 'LOT. NO', f('carton.lot', VAL)),
            ...row(5, 'N W', [f('carton.nw', { ...VAL, hideWhenEmpty: true }), f('carton.nw_blank', BLANK)]),
            ...row(6, 'G W', [
                f('carton.gw', { ...VAL, hideWhenEmpty: true }),
                f('carton.gw_blank', BLANK),
                f('carton.packaging_type', { fontSize: 8, color: '#555', hideWhenEmpty: true }),
            ]),

            // Our handle, not the customer's: the picker's phone scans this QR onto
            // a pick list. Spans every table row so the box runs the table's height.
            cell(1, 9, 4, [
                f('carton.qr', { qrSize: 104, qrCaption: '', qrFrame: false, align: 'center' }),
                f('carton.company_name', { fontSize: 9, color: '#333', align: 'center', hideWhenEmpty: true }),
                f('carton.package_line', { fontSize: 9, color: '#333', align: 'center' }),
                f('carton.packed_date', { fontSize: 9, color: '#333', align: 'center', emptyText: '' }),
            ], { rowSpan: 6, stackGap: 3 }),
        ],
    },
    {
        // The carton number for handheld scanners, ~63 x 13 mm: bars of ~0.3 mm,
        // comfortably above what a handheld or phone reads. The number is printed
        // under it for a hand-keyed fallback.
        id: 'carton_barcode', type: 'grid', gap: 0, marginBottom: 0,
        items: [
            cell(1, 1, 12, [
                f('carton.number_barcode', { imageHeight: 48, align: 'center' }),
                f('carton.number', { fontSize: 12, bold: true, letterSpacing: 1, align: 'center' }),
            ], { stackGap: 2 }),
        ],
    },
];

export const PACKED_UNIT_LABEL_DEFAULT: PrintLayout = {
    version: 1,
    paper: { size: 'A6', orientation: 'landscape', marginMm: 6 },
    fontFamily: PRINT_FONT,
    bands: BANDS,
};
