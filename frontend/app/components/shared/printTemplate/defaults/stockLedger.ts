/**
 * Built-in Stock Ledger report layout — a transcription of the hand-built
 * LedgerDocument it replaced in dashboard/StockLedgerPrintModal.tsx. Applies
 * until the client saves their own.
 *
 * The modal's column checkboxes act on the `sl_table` band's columns at print
 * time, so whatever columns a saved layout places are the ones offered there.
 */

import type { PrintLayout, Band, FieldSpec, GridItem } from '../types';
import { PRINT_FONT } from '../../typography';

const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, fontSize: 8, ...extra });
const text = (t: string, extra: Partial<FieldSpec> = {}): FieldSpec => f('__text', { text: t, ...extra });
const cell = (col: number, span: number, spec: FieldSpec): GridItem => ({ ...spec, col, span, row: 1 });
const stack = (col: number, span: number, fields: FieldSpec[], extra: Partial<GridItem> = {}): GridItem =>
    ({ col, span, row: 1, stackGap: 0, stack: fields, ...extra });

const BANDS: Band[] = [
    {
        id: 'sl_header', type: 'grid', gap: 8, marginBottom: 6, alignItems: 'center',
        borderBottom: '2px solid #000', padding: '0 0 5px',
        items: [
            cell(1, 1, f('company.logo', { imageHeight: 40, hideWhenEmpty: true })),
            stack(2, 6, [
                f('company.name', { fontSize: 10, bold: true, hideWhenEmpty: true }),
                f('company.address', { fontSize: 7, hideWhenEmpty: true }),
            ]),
            stack(8, 5, [
                text('STOCK LEDGER', { fontSize: 14, bold: true, align: 'right' }),
                f('sl.period', { prefix: 'Period: ', color: '#555', align: 'right' }),
                f('sl.filters', { fontSize: 7, color: '#777', align: 'right', hideWhenEmpty: true }),
            ], { align: 'right' }),
        ],
    },
    {
        id: 'sl_table', type: 'table', source: 'sl_rows', fontSize: 8, marginBottom: 6,
        hideWhenEmpty: false, ruleColor: '#777', headerBackground: '#e8e8e8',
        columns: [
            { field: 'no', label: 'No', width: '3%', align: 'center' },
            { field: 'date', label: 'Date', width: '9%', headerAlign: 'center' },
            { field: 'item_block', label: 'Item', width: '16%', headerAlign: 'center' },
            { field: 'attributes', label: 'Attributes', width: '10%', headerAlign: 'center', emptyText: '' },
            { field: 'location', label: 'Location', width: '13%', headerAlign: 'center', emptyText: '' },
            { field: 'lot', label: 'Lot', width: '9%', headerAlign: 'center' },
            { field: 'movement', label: 'Movement', width: '10%', align: 'right', headerAlign: 'center', bold: true },
            { field: 'packaging', label: 'Packaging', width: '9%', headerAlign: 'center' },
            { field: 'source', label: 'Source', width: '11%', headerAlign: 'center', emptyText: '' },
            { field: 'ref', label: 'Ref #', width: '10%', headerAlign: 'center', emptyText: '' },
        ],
    },
    {
        id: 'sl_empty', type: 'grid', marginBottom: 6,
        items: [cell(1, 12, f('sl.empty_note', { color: '#888', align: 'center', hideWhenEmpty: true }))],
    },
    {
        id: 'sl_totals', type: 'grid', gap: 8, marginBottom: 4,
        items: [
            cell(1, 3, f('sl.count', { prefix: 'Movements: ', bold: true })),
            cell(4, 3, f('sl.total_in', { prefix: 'In: ', bold: true, color: '#1a5e1a', align: 'center' })),
            cell(7, 3, f('sl.total_out', { prefix: 'Out: ', bold: true, color: '#c00000', align: 'center' })),
            cell(10, 3, f('sl.net', { prefix: 'Net: ', bold: true, align: 'right' })),
        ],
    },
    {
        id: 'sl_truncated', type: 'grid', marginBottom: 4,
        items: [cell(1, 12, f('sl.truncated_note', { fontSize: 7, color: '#c00000', hideWhenEmpty: true }))],
    },
    {
        id: 'sl_footer', type: 'grid', marginBottom: 0,
        items: [cell(1, 12, f('sl.printed', { fontSize: 7, color: '#555', prefix: 'Printed: ' }))],
    },
];

export const STOCK_LEDGER_DEFAULT: PrintLayout = {
    version: 1,
    // The old print set `@page { size: landscape; margin: 10mm }` and forced the
    // paper's padding to 0, so the page margin is the whole inset.
    paper: { size: 'A4', orientation: 'landscape', marginMm: 10 },
    fontFamily: PRINT_FONT,
    paddingMm: 0,
    bands: BANDS,
};
