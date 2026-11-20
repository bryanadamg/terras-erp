/**
 * Built-in Purchase Report layouts (PO lines / goods received). Apply until the
 * client saves their own in Print Layouts.
 */

import type { PrintLayout, Band, FieldSpec, GridItem, TableColumn } from '../types';
import { PRINT_FONT } from '../../typography';

const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, fontSize: 8, ...extra });
const text = (t: string, extra: Partial<FieldSpec> = {}): FieldSpec => f('__text', { text: t, ...extra });
const cell = (col: number, span: number, spec: FieldSpec): GridItem => ({ ...spec, col, span, row: 1 });
const stack = (col: number, span: number, fields: FieldSpec[], extra: Partial<GridItem> = {}): GridItem =>
    ({ col, span, row: 1, stackGap: 0, stack: fields, ...extra });

const layout = (title: string, source: string, columns: TableColumn[]): PrintLayout => {
    const bands: Band[] = [
        {
            id: 'prp_header', type: 'grid', gap: 8, marginBottom: 6, alignItems: 'center',
            borderBottom: '2px solid #000', padding: '0 0 5px',
            items: [
                cell(1, 1, f('company.logo', { imageHeight: 40, hideWhenEmpty: true })),
                stack(2, 6, [
                    f('company.name', { fontSize: 10, bold: true, hideWhenEmpty: true }),
                    f('company.address', { fontSize: 7, hideWhenEmpty: true }),
                ]),
                stack(8, 5, [
                    text(title, { fontSize: 14, bold: true, align: 'right' }),
                    f('prp.period', { prefix: 'Period: ', color: '#555', align: 'right' }),
                    f('prp.filters', { fontSize: 7, color: '#777', align: 'right', hideWhenEmpty: true }),
                ], { align: 'right' }),
            ],
        },
        {
            id: 'prp_table', type: 'table', source, fontSize: 8, marginBottom: 6,
            hideWhenEmpty: false, ruleColor: '#777', headerBackground: '#e8e8e8', stripe: '#f9f9f9',
            emptyMessage: 'No rows match these filters.',
            columns,
        },
        {
            id: 'prp_totals', type: 'grid', gap: 8, marginBottom: 4,
            items: [
                cell(1, 6, f('prp.count', { prefix: 'Rows: ', prefixBold: true, bold: true })),
                cell(7, 6, f('prp.amount', { prefix: 'Total amount: ', prefixBold: true, bold: true, align: 'right' })),
            ],
        },
        {
            id: 'prp_footer', type: 'grid', marginBottom: 0,
            items: [cell(1, 12, f('prp.printed', { fontSize: 7, color: '#555', prefix: 'Printed: ' }))],
        },
    ];
    return { version: 1, paper: { size: 'A4', orientation: 'landscape', marginMm: 10 }, fontFamily: PRINT_FONT, paddingMm: 0, bands };
};

const c = (field: string, label: string, width: string, extra: Partial<TableColumn> = {}): TableColumn =>
    ({ field, label, width, headerAlign: 'center', ...extra } as TableColumn);

export const PO_LINES_REPORT_DEFAULT = layout('PURCHASE ORDER LINES', 'prp_lines', [
    c('no', 'No', '3%', { align: 'center' }),
    c('date', 'Date', '8%'),
    c('po_number', 'PO Number', '11%'),
    c('supplier', 'Supplier', '13%'),
    c('item_block', 'Item', '20%', { mutedDetail: true }),
    c('qty', 'Ordered', '9%', { align: 'right' }),
    c('received', 'Received', '9%', { align: 'right' }),
    c('unit_price', 'Unit Price', '9%', { align: 'right' }),
    c('amount', 'Amount', '10%', { align: 'right', bold: true }),
    c('status', 'Status', '8%'),
]);

export const GOODS_RECEIVED_REPORT_DEFAULT = layout('GOODS RECEIVED', 'prp_receipts', [
    c('no', 'No', '3%', { align: 'center' }),
    c('date', 'Date', '8%'),
    c('po_number', 'PO Number', '11%'),
    c('supplier', 'Supplier', '12%'),
    c('delivery_note', 'Delivery Note', '9%'),
    c('item_block', 'Item', '19%', { mutedDetail: true }),
    c('warehouse', 'Warehouse', '12%'),
    c('qty', 'Qty', '9%', { align: 'right', bold: true }),
    c('unit_price', 'Unit Price', '8%', { align: 'right' }),
    c('amount', 'Amount', '9%', { align: 'right' }),
]);
