/**
 * Built-in Sales Order table report layout — a transcription of the hand-built
 * SOTableDocument it replaced in sales/SOTablePrintModal.tsx. Applies until the
 * client saves their own.
 */

import type { PrintLayout, Band, FieldSpec, GridItem } from '../types';
import { PRINT_FONT } from '../../typography';

const BASE = 7.5;
const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, fontSize: BASE, ...extra });
const cell = (col: number, span: number, spec: FieldSpec): GridItem => ({ ...spec, col, span, row: 1 });
const stack = (col: number, span: number, fields: FieldSpec[], extra: Partial<GridItem> = {}): GridItem =>
    ({ col, span, row: 1, stackGap: 0, stack: fields, ...extra });

const BANDS: Band[] = [
    {
        id: 'st_header', type: 'grid', gap: 8, marginBottom: 6, alignItems: 'center',
        borderBottom: '2px solid #000', padding: '0 0 4px',
        items: [
            cell(1, 1, f('company.logo', { imageHeight: 36, hideWhenEmpty: true })),
            stack(2, 6, [
                f('company.name', { fontSize: 9, bold: true, hideWhenEmpty: true }),
                f('company.address', { fontSize: 7, hideWhenEmpty: true }),
            ]),
            stack(10, 3, [
                f('st.date_header', { fontSize: 11, bold: true, align: 'center' }),
                f('st.subtitle', { fontSize: 7, color: '#555', align: 'center' }),
            ]),
        ],
    },
    {
        id: 'st_table', type: 'table', source: 'st_rows', fontSize: BASE, marginBottom: 8,
        hideWhenEmpty: false, ruleColor: '#777', headerBackground: '#e8e8e8', stripe: '#f9f9f9',
        emptyMessage: 'No sales orders to display.',
        columns: [
            { field: 'no', label: 'No', width: '2%', align: 'center' },
            { field: 'date', label: 'Date', width: '7%', align: 'center', emptyText: '' },
            { field: 'po_number', label: 'Ref No. (PO#)', width: '7%', headerAlign: 'center', bold: true, emptyText: '' },
            { field: 'customer_po_ref', label: 'Customer PO Ref', width: '7%', headerAlign: 'center', emptyText: '' },
            { field: 'customer', label: 'Customer', width: '12%', headerAlign: 'center', emptyText: '' },
            { field: 'del_request', label: 'Del. Request', width: '7%', align: 'center', emptyText: '' },
            { field: 'del_confirmation', label: 'Del. Confirmation', width: '7%', align: 'center', emptyText: '' },
            { field: 'stock_notes', label: 'Stock Notes', width: '9%', headerAlign: 'center', emptyText: '' },
            { field: 'item_name', label: 'Item', width: '13%', headerAlign: 'center', emptyText: '' },
            { field: 'size', label: 'Size', width: '6%', align: 'center', emptyText: '' },
            { field: 'qty_yd', label: 'Qty (Yd)', width: '5%', align: 'right', headerAlign: 'center', emptyText: '' },
            { field: 'qty_m', label: 'Qty (m)', width: '5%', align: 'right', headerAlign: 'center', emptyText: '' },
            { field: 'qty_kg', label: 'Qty (KG)', width: '5%', align: 'right', headerAlign: 'center', emptyText: '' },
            { field: 'qty3', label: 'Qty 3', width: '7%', align: 'right', headerAlign: 'center', emptyText: '' },
        ],
    },
    {
        id: 'st_footer', type: 'grid', marginBottom: 0,
        items: [
            cell(1, 6, f('st.printed', { fontSize: 7, color: '#555', prefix: 'Printed: ' })),
            cell(7, 6, f('st.row_count', { fontSize: 7, color: '#555', prefix: 'Total rows: ', align: 'right' })),
        ],
    },
];

export const SO_TABLE_DEFAULT: PrintLayout = {
    version: 1,
    // The old print set `@page { size: landscape; margin: 10mm }` and forced the
    // paper's padding to 0, so the page margin is the whole inset.
    paper: { size: 'A4', orientation: 'landscape', marginMm: 10 },
    fontFamily: PRINT_FONT,
    paddingMm: 0,
    bands: BANDS,
};
