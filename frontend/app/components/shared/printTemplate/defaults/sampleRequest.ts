/**
 * Built-in SPK Sample layout — a transcription of the hand-built SPKDocument it
 * replaced in samples/SamplePrintModal.tsx. Applies until the client saves their own.
 */

import type { PrintLayout, Band, FieldSpec, GridItem, KeyValueBand, KeyValueRow } from '../types';
import { PRINT_FONT } from '../../typography';
import { SR_COLOR_ROWS } from '../doctypes/sampleRequest';

const BASE = 13;
const f = (field: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ field, fontSize: BASE, ...extra });
const text = (t: string, extra: Partial<FieldSpec> = {}): FieldSpec => f('__text', { text: t, ...extra });
const stack = (col: number, span: number, fields: FieldSpec[], extra: Partial<GridItem> = {}): GridItem =>
    ({ col, span, row: 1, stackGap: 0, stack: fields, ...extra });
// Empty values print blank on this form, never dashed.
const row = (label: string, field: string, extra: Partial<KeyValueRow> = {}): KeyValueRow =>
    ({ label, field, span: 3, emptyText: '', ...extra });

const RULE = '#555';
const BOX = `1px solid ${RULE}`;

// The ruled label/value form every block of the SPK uses.
const form = (id: string, rows: KeyValueRow[], marginBottom = 0): KeyValueBand => ({
    id, type: 'keyvalue', marginBottom, rows,
    labelWidth: '38%', labelFontSize: BASE, valueFontSize: BASE, ruleColor: RULE, labelBackground: 'none',
});

const BANDS: Band[] = [
    {
        id: 'sr_header', type: 'grid', gap: 10, marginBottom: 8,
        borderBottom: '2px solid #000', padding: '0 0 6px',
        items: [
            { ...f('company.logo', { imageHeight: 52, hideWhenEmpty: true }), col: 1, span: 2, row: 1 },
            stack(3, 10, [
                f('company.name', { fontSize: 16, bold: true, hideWhenEmpty: true }),
                f('company.address', { hideWhenEmpty: true }),
                f('company.phone_fax', { hideWhenEmpty: true }),
                f('company.email', { prefix: 'Email : ', color: '#0000cc', hideWhenEmpty: true }),
            ]),
        ],
    },
    {
        id: 'sr_title', type: 'grid', marginBottom: 0, box: BOX, padding: '4px 0',
        items: [{ ...text('SPK Sample', { fontSize: 15, bold: true, align: 'center' }), col: 1, span: 12, row: 1 }],
    },
    form('sr_fields', [
        row('TGL TURUN SPK', 'sr.request_date'),
        row('KODE SPK', 'sr.code'),
        row('PROJECT', 'sr.project'),
        row('NAMA CUSTOMER', 'sr.customer_name'),
        row('KODE ARTIKEL SAMPLE', 'sr.customer_article_code'),
        row('KODE ARTIKEL BOLA INTAN', 'sr.internal_article_code'),
        row('LEBAR', 'sr.width'),
        // Rows past the colours + one spare (min five) resolve empty and drop out.
        ...Array.from({ length: SR_COLOR_ROWS }, (_, i) =>
            row(i === 0 ? 'WARNA' : '', `sr.color_${i + 1}`, { hideWhenEmpty: true })),
    ]),
    {
        id: 'sr_quality_heading', type: 'table', source: 'sr_heading', fontSize: 14, marginBottom: 0,
        hideWhenEmpty: false, ruleColor: RULE, headerBackground: '#bdd7ee',
        columns: [{ field: 'heading', label: 'DETAIL QUALITY', align: 'center' }],
    },
    form('sr_quality', [
        row('LAPIS ATAS', 'sr.main_material'),
        row('LAPIS TENGAH', 'sr.middle_material'),
        row('LAPIS BAWAH', 'sr.bottom_material'),
        row('WEFT', 'sr.weft'),
        row('KARET', 'sr.warp'),
        row('BERAT ORIGINAL SAMPEL', 'sr.original_weight'),
        row('BERAT BIE SAMPEL', 'sr.production_weight'),
        row('INFORMASI TAMBAHAN', 'sr.additional_info'),
    ]),
    form('sr_logistics', [
        row('JUMLAH/ BANYAK SAMPEL', 'sr.quantity'),
        row('Est Tgl Selesai Sample (Req cust)', 'sr.est_completion_date'),
        row('Est tgl Selesai Sample (div sample)', '__blank'),
    ], 8),
    {
        id: 'sr_sample_box_caption', type: 'grid', marginBottom: 2,
        items: [{ ...text('Contoh Original Sample'), col: 1, span: 12, row: 1 }],
    },
    {
        id: 'sr_sample_box', type: 'grid', marginBottom: 8, box: BOX, padding: '6px 8px',
        items: [stack(1, 12, [
            f('sr.completion_description', { hideWhenEmpty: true }),
            f('sr.completion_image', { imageHeight: 140, hideWhenEmpty: true }),
            f('sr.sample_box_space', { hideWhenEmpty: true }),
        ], { stackGap: 6 })],
    },
    {
        id: 'sr_checklist', type: 'grid', gap: 6, marginBottom: 12, box: BOX, padding: '6px 10px',
        items: [
            { ...text('PRIORITAS', { fontSize: 15, bold: true, color: '#c00', align: 'center' }), col: 1, span: 12, row: 1 },
            { ...text('CHECKLIST:', { bold: true }), col: 1, span: 6, row: 2 },
            { ...f('sr.checklist_ok', { emptyText: '' }), col: 10, span: 1, row: 2 },
            { ...f('sr.checklist_not_ok', { emptyText: '' }), col: 11, span: 2, row: 2 },
        ],
    },
    {
        id: 'sr_footer', type: 'grid', gap: 6, marginBottom: 0, alignItems: 'center',
        items: [
            stack(1, 2, [
                text('Disiapkan oleh :'),
                text(' \n '),
                f('__blank'),
                f('sr.prepared_by', { bold: true, hideWhenEmpty: true }),
                f('sr.prepared_role', { hideWhenEmpty: true }),
            ]),
            { ...f('sr.internal_report_stamp', { imageHeight: 42, align: 'right' }), col: 9, span: 4, row: 1 },
        ],
    },
];

export const SAMPLE_REQUEST_DEFAULT: PrintLayout = {
    version: 1,
    paper: { size: 'A4', orientation: 'portrait', marginMm: 10 },
    fontFamily: PRINT_FONT,
    paddingMm: 4,
    bands: BANDS,
};
