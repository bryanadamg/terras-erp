/**
 * Built-in Material Pull Sheet layout — a transcription of the hand-built document
 * it replaced in manufacturing/PRMaterialPullSheetModal.tsx. Applies until the
 * client saves their own.
 *
 * Two material tables: `pr_materials` and `pr_materials_ends` (with the warp-ends
 * column). The print modal shows exactly one of them per run — the Ends column
 * only when the run has beam lines — so a garment run keeps the width for names.
 */

import type { PrintLayout, Band, FieldSpec, GridItem, TableColumn } from '../types';
import { PRINT_FONT } from '../../typography';

const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, fontSize: 9, ...extra });
const text = (t: string, extra: Partial<FieldSpec> = {}): FieldSpec => f('__text', { text: t, ...extra });
const stack = (col: number, span: number, fields: FieldSpec[], extra: Partial<GridItem> = {}): GridItem =>
    ({ col, span, row: 1, stackGap: 0, stack: fields, ...extra });

const RULE = '#ccc';

const col = (field: string, label: string, extra: Partial<TableColumn> = {}): TableColumn =>
    ({ field, label, emptyText: '', ...extra });
const materialColumns = (withEnds: boolean): TableColumn[] => [
    col('code', 'Code', { width: '12%', mono: true, color: '#555' }),
    col('material', 'Material'),
    col('uom', 'UOM', { width: '8%', align: 'center', color: '#555' }),
    ...(withEnds ? [col('ends', 'Ends (Utas)', { width: '8%', align: 'right' })] : []),
    // Net of what this run has already been issued.
    col('still_required', 'Still Required', { width: '13%', align: 'right', bold: true }),
    col('available', 'Available', { width: '13%', align: 'right' }),
    col('shortfall', 'Shortfall', { width: '13%', align: 'right' }),
];

const BANDS: Band[] = [
    {
        id: 'pr_header', type: 'grid', gap: 8, marginBottom: 8,
        borderBottom: '2px solid #000', padding: '0 0 6px',
        items: [
            stack(1, 4, [
                f('company.logo', { imageHeight: 44, hideWhenEmpty: true }),
                f('pr.letterhead_name', { fontSize: 13, bold: true, color: '#003080', hideWhenEmpty: true }),
                f('company.address', { fontSize: 7, color: '#555', hideWhenEmpty: true }),
            ]),
            stack(5, 4, [
                text('MATERIAL PULL SHEET', { fontSize: 16, bold: true, align: 'center', letterSpacing: 1 }),
                f('pr.date', { fontSize: 8, color: '#333', align: 'center', prefix: 'Tanggal: ' }),
            ], { stackGap: 2 }),
            { ...f('pr.code', { fontSize: 8, bold: true, mono: true, align: 'right' }), col: 9, span: 4, row: 1 },
        ],
    },
    {
        id: 'pr_identity', type: 'keyvalue', marginBottom: 10,
        labelWidth: '18%', labelFontSize: 8, valueFontSize: 8, ruleColor: RULE,
        rows: [
            { field: 'pr.products', label: 'Production Run', span: 3, bold: true, fontSize: 9 },
            { field: 'pr.customer', label: 'Customer', span: 3, hideWhenEmpty: true },
            { field: 'pr.sales_order', label: 'Sales Order', span: 1, hideWhenEmpty: true, mono: true },
            { field: 'pr.due_date_beside_so', label: 'Due Date', span: 1, hideWhenEmpty: true },
            { field: 'pr.due_date_alone', label: 'Due Date', span: 3, hideWhenEmpty: true },
        ],
    },
    {
        id: 'pr_materials_note', type: 'grid', marginBottom: 0,
        items: [{ ...f('pr.materials_note', { fontSize: 10, color: '#666', hideWhenEmpty: true }), col: 1, span: 12, row: 1 }],
    },
    {
        id: 'pr_materials', type: 'table', source: 'pr_pull_lines', fontSize: 8, marginBottom: 10,
        ruleColor: RULE, columns: materialColumns(false),
    },
    {
        id: 'pr_materials_ends', type: 'table', source: 'pr_pull_lines', fontSize: 8, marginBottom: 10,
        ruleColor: RULE, columns: materialColumns(true),
    },
    {
        id: 'pr_signature', type: 'signature', marginBottom: 0,
        borderTop: `1px solid ${RULE}`, padding: '8px 0 0',
        footerFields: [{ field: 'pr.footer', fontSize: 7 }],
        boxes: [
            { caption: 'DIMINTA OLEH', width: 100, height: 28 },
            { caption: 'DISERAHKAN OLEH', width: 100, height: 28 },
        ],
    },
];

export const PR_PULL_SHEET_DEFAULT: PrintLayout = {
    version: 1,
    paper: { size: 'A4', orientation: 'portrait', marginMm: 8 },
    fontFamily: PRINT_FONT,
    paddingMm: 5,
    bands: BANDS,
};
