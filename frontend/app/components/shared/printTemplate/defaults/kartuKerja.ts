/**
 * Built-in default layouts for the four Kartu Kerja (WO step card) doc types.
 *
 * These are a faithful transcription of the KartuKerjaCard*.tsx components they
 * replace — an untouched default must print exactly what the floor gets today.
 * They apply whenever `print_templates` has no row for the doc type, so
 * "Reset to default" in the designer is a DELETE.
 *
 * Built from one factory rather than four hand-written copies. The four cards were
 * near-identical clones and had already drifted from each other in small ways
 * (which code the header leads with, whether a second metric box exists); a single
 * skeleton with per-variant overrides stops that recurring.
 */

import type { PrintLayout, Band, GridItem, KeyValueRow, TallyBand } from '../types';
import { PRINT_FONT } from '../../typography';

const A6: PrintLayout['paper'] = { size: 'A6', orientation: 'portrait', marginMm: 6 };

interface VariantSpec {
    /** Field the header code line leads with. */
    headerCodeField: string;
    /** Mini-label over the operation name, e.g. 'TENUN / WEAVING'. */
    operationLabel: string;
    /** Mini-label over the work centre name, e.g. 'NO. MESIN'. */
    workCenterLabel: string;
    /** Metric boxes across the top. One or two. */
    metrics: { field: string; label: string; fontSize?: number; unit?: string }[];
    /** Rows of the label/value identity grid. */
    identityRows: KeyValueRow[];
    /** The hand-fill tally band. */
    tally: TallyBand;
    /**
     * Extra bands inserted straight after the identity grid — the dyeing card's
     * dose sheet. Kept as a spec hook rather than a fifth hand-written layout: the
     * four variants drifting apart is exactly what the factory function prevents.
     */
    extraBands?: Band[];
}

/** Numbered write-in boxes — the "Cek / 10 mnt" grid shared by beaming/dyeing/general. */
const CEK_10_MNT: TallyBand = {
    id: 'tally',
    type: 'tally',
    title: 'Cek / 10 mnt',
    marginBottom: 6,
    columns: [],
    rows: 0,
    boxes: 12,
    boxesPerRow: 6,
    fontSize: 8,
    cellHeight: 22,
};

/** The weaving bag/weight tally the factory fills in by hand. */
const KANTONG_BERAT: TallyBand = {
    id: 'tally',
    type: 'tally',
    title: 'Jumlah Kantong/Box & Berat',
    marginBottom: 6,
    fontSize: 9,
    columns: [
        { label: 'No.', width: '14%', autoNumber: true },
        { label: 'Berat (kg)' },
        { label: 'No.', width: '14%', autoNumber: true },
        { label: 'Berat (kg)' },
    ],
    rows: 3,
    totalRow: { label: 'Jumlah', totalLabel: 'Total' },
};

/** Identity rows every variant carries. */
const BASE_IDENTITY = (productLabel: string): KeyValueRow[] => [
    { field: 'mo.item_name', label: productLabel, span: 3, bold: true },
    { field: 'mo.size', label: 'Size', span: 3, bold: true, hideWhenEmpty: true },
    // Both halves drop together on an uncoloured (greige / warp) order.
    { field: 'attr.color', label: 'Warna', span: 1, hideWhenEmpty: true },
    { field: 'mo.color_code', label: 'Kode Warna', span: 1, bold: true, hideWhenEmpty: true },
    { field: 'wo.status', label: 'Status', span: 1 },
    { field: 'wo.target_end_date', label: 'Target Selesai', span: 1 },
    { field: 'wo.next_destination', label: 'Tujuan', span: 3, bold: true, hideWhenEmpty: true },
];

function buildLayout(spec: VariantSpec): PrintLayout {
    // Code / company / date are ONE stacked cell beside the QR, not three grid rows:
    // a row-spanning QR distributes its height across the rows it spans and pulls the
    // text lines ~50px apart. Stacking keeps the 1px spacing the paper ticket has.
    const headerItems: GridItem[] = [
        {
            col: 1, span: 7, row: 1, stackGap: 1,
            stack: [
                { field: spec.headerCodeField, fontSize: 12, bold: true, mono: true },
                // Omitted rather than dashed when the company profile has no name.
                { field: 'company.name', fontSize: 8, bold: true, color: '#555', hideWhenEmpty: true },
                { field: 'print.date_department', fontSize: 8, color: '#666' },
            ],
        },
        { field: 'wo.qr', col: 8, span: 5, row: 1, align: 'right', qrSize: 140 },
    ];

    const heroItems: GridItem[] = [
        {
            field: 'wo.name', col: 1, span: 7, row: 1,
            fontSize: 20, bold: true, showLabel: true, label: spec.operationLabel,
        },
        {
            col: 8, span: 5, row: 1, align: 'right', stackGap: 0,
            stack: [
                { field: 'wo.work_center_name', fontSize: 13, bold: true, align: 'right', showLabel: true, label: spec.workCenterLabel },
                { field: 'wo.step_label', fontSize: 9, color: '#555', align: 'right' },
            ],
        },
    ];

    const metricSpan = Math.floor(12 / spec.metrics.length);
    const metricItems: GridItem[] = spec.metrics.map((m, i) => ({
        field: m.field,
        col: i * metricSpan + 1,
        span: metricSpan,
        row: 1,
        fontSize: m.fontSize ?? 17,
        bold: true,
        showLabel: true,
        label: m.label,
        ...(m.unit !== undefined ? { unit: m.unit } : {}),
    }));

    const bands: Band[] = [
        {
            id: 'header', type: 'grid', items: headerItems,
            gap: 8, borderBottom: '2px solid #000', padding: '0 0 5px', marginBottom: 6,
        },
        {
            id: 'hero', type: 'grid', items: heroItems,
            gap: 4, box: '2px solid #000', padding: '4px 8px', marginBottom: 6, alignItems: 'center',
        },
        {
            id: 'metrics', type: 'grid', items: metricItems,
            gap: 6, cellBox: '1px solid #999', marginBottom: 6,
        },
        {
            id: 'identity', type: 'keyvalue', rows: spec.identityRows,
            labelWidth: '24%', marginBottom: 6,
        },
        ...(spec.extraBands ?? []),
        spec.tally,
        {
            id: 'materials', type: 'table', source: 'bom_step_lines',
            // '{auto}' keeps the old "Komponen Operasi Ini" vs "Material (berdasarkan
            // BOM)" switch; replace with fixed text to pin one wording.
            title: '{auto}', titleUppercase: true, marginBottom: 6, fontSize: 9,
            hideWhenEmpty: true,
            columns: [
                { field: 'item', label: 'Komponen', align: 'left' },
                { field: 'required_qty', label: 'Perlu', width: '22%', align: 'right', bold: true, decimals: 2 },
                // Blank, not dashed — the operator writes the actual in by hand.
                { field: 'actual_qty', label: 'Aktual', width: '22%', align: 'right', bold: true, decimals: 2, emptyText: '' },
            ],
        },
        { id: 'spacer', type: 'spacer', minHeight: 6, marginBottom: 0 },
        {
            id: 'signature', type: 'signature',
            borderTop: '1px solid #ccc', padding: '6px 0 0', marginBottom: 0,
            footerFields: [{ field: 'wo.footer_trace', fontSize: 6 }],
            boxes: [{ caption: 'ACC TEKNISI', width: 100, height: 26 }],
        },
    ];

    // 3mm inset on top of the 6mm page margin. The old cards ran content to the very
    // edge of the paper element, which read as "margins gone" against the printed
    // ticket. Client-adjustable in the designer.
    return { version: 1, paper: A6, fontFamily: PRINT_FONT, paddingMm: 3, bands };
}

export const KARTU_KERJA_WEAVING: PrintLayout = buildLayout({
    headerCodeField: 'wo.code_or_mo',
    operationLabel: 'TENUN / WEAVING',
    workCenterLabel: 'NO. MESIN',
    metrics: [
        { field: 'wo.qty', label: 'QTY (KG)', unit: 'kg' },
        { field: 'wo.ends', label: 'WARP ENDS', unit: 'utas' },
    ],
    // Weaving's grid is the "kartu tenun" paper ticket: artikel/warna/lebar plus the
    // pre/post-dye stretch pair and a hand-written operator line.
    identityRows: [
        { field: 'mo.item_name', label: 'Artikel', span: 3, bold: true },
        { field: 'mo.size', label: 'Size', span: 3, bold: true, hideWhenEmpty: true },
        { field: 'attr.color', label: 'Warna', span: 1 },
        { field: 'mo.color_code', label: 'Kode Warna', span: 1, bold: true },
        { field: 'bom.mesin_lebar', label: 'Lebar', span: 3, unit: 'cm' },
        // These two pair onto one line. If only one is set the survivor pairs with the
        // next half-row instead — the old card printed both cells dashed.
        { field: 'bom.mesin_panjang_tarikan', label: 'Tarikan Sblm Celup/Setting', span: 1, hideWhenEmpty: true },
        { field: 'bom.celup_panjang_tarikan', label: 'Tarikan Ssdh Celup/Setting', span: 1, hideWhenEmpty: true },
        { field: 'wo.status', label: 'Status', span: 1 },
        { field: 'wo.target_end_date', label: 'Target Selesai', span: 1 },
        { field: 'wo.next_destination', label: 'Tujuan', span: 3, bold: true, hideWhenEmpty: true },
        { field: 'mo.putaway_location', label: 'Simpan di Rak', span: 3, bold: true, hideWhenEmpty: true },
        { field: '__blank', label: 'Operator', span: 3, fill: true },
    ],
    tally: KANTONG_BERAT,
});

export const KARTU_KERJA_BEAMING: PrintLayout = buildLayout({
    headerCodeField: 'wo.code',
    operationLabel: 'OPERASI',
    workCenterLabel: 'WORK CENTER',
    metrics: [
        { field: 'wo.qty', label: 'QTY (KG)', unit: 'kg' },
        { field: 'wo.ends', label: 'QTY (ENDS / UTAS)', unit: 'utas' },
    ],
    identityRows: BASE_IDENTITY('Produk'),
    tally: CEK_10_MNT,
});

/** The dose sheet the operator weighs from at the vessel.
 *
 *  Hidden when the run or its dose calc could not be loaded (`hideWhenEmpty`), so a
 *  card still prints. The title carries the bath volume — or says it is missing —
 *  because a g/L rate with no bath is not a weight, and printing one in a "Timbang"
 *  column would be read as one. */
const DOSIS_KIMIA: Band = {
    id: 'doses', type: 'table', source: 'dye_doses',
    title: '{auto}', titleUppercase: true, marginBottom: 6, fontSize: 9,
    hideWhenEmpty: true,
    columns: [
        { field: 'item', label: 'Kimia', align: 'left' },
        { field: 'rate', label: 'Rate', width: '20%', align: 'right' },
        { field: 'weigh_out', label: 'Timbang', width: '22%', align: 'right', bold: true },
        // Blank, not dashed — the operator writes in what actually went into the
        // vessel, the same way the materials band's Aktual column works.
        { field: 'actual_qty', label: 'Aktual', width: '18%', align: 'right', decimals: 2, emptyText: '' },
    ],
};

export const KARTU_KERJA_DYEING: PrintLayout = buildLayout({
    headerCodeField: 'mo.code',
    operationLabel: 'CELUP / DYEING',
    workCenterLabel: 'MESIN CELUP',
    metrics: [
        { field: 'wo.qty', label: 'SUBSTRATE QTY (KG)', unit: 'kg' },
        { field: 'wo.recipe_status', label: 'RECIPE', fontSize: 13, unit: '' },
    ],
    // The bath pair rides on the identity grid: the doses below are all calculated
    // from it, so the operator can check the number the weights came from.
    identityRows: [
        ...BASE_IDENTITY('Produk'),
        { field: 'dye.bath_volume', label: 'Volume Air', span: 1, unit: 'L' },
        { field: 'dye.liquor_ratio', label: 'Perbandingan', span: 1 },
    ],
    extraBands: [DOSIS_KIMIA],
    tally: CEK_10_MNT,
});

export const KARTU_KERJA_GENERAL: PrintLayout = buildLayout({
    headerCodeField: 'mo.code',
    operationLabel: 'OPERASI',
    workCenterLabel: 'WORK CENTER',
    // Single metric box spanning the full width, as the general card had.
    metrics: [{ field: 'wo.qty', label: 'QTY (KG)', unit: 'kg' }],
    identityRows: BASE_IDENTITY('Produk'),
    tally: CEK_10_MNT,
});

/**
 * doc_type → built-in default. `docTypeForWorkCenter` maps a WO's work centre type
 * onto its doc type, mirroring the dispatcher in the old KartuKerjaCard.tsx
 * (including the Indonesian TENUN/CELUP aliases used by
 * `list_work_orders_flat`'s alias_map).
 */
export const KARTU_KERJA_DEFAULTS: Record<string, PrintLayout> = {
    kartu_kerja_weaving: KARTU_KERJA_WEAVING,
    kartu_kerja_beaming: KARTU_KERJA_BEAMING,
    kartu_kerja_dyeing: KARTU_KERJA_DYEING,
    kartu_kerja_general: KARTU_KERJA_GENERAL,
};

export const KARTU_KERJA_DOC_TYPE_LABELS: Record<string, string> = {
    kartu_kerja_weaving: 'Kartu Kerja — Weaving / Tenun',
    kartu_kerja_beaming: 'Kartu Kerja — Beaming',
    kartu_kerja_dyeing: 'Kartu Kerja — Dyeing / Celup',
    kartu_kerja_general: 'Kartu Kerja — General (Warping / Setting / Finishing)',
};

export function docTypeForWorkCenter(workCenterType: any): string {
    const raw = String(workCenterType || '').toUpperCase();
    const aliasMap: Record<string, string> = { TENUN: 'WEAVING', CELUP: 'DYEING' };
    const centerType = aliasMap[raw] || raw;
    switch (centerType) {
        case 'BEAMING': return 'kartu_kerja_beaming';
        case 'WEAVING': return 'kartu_kerja_weaving';
        case 'DYEING': return 'kartu_kerja_dyeing';
        default: return 'kartu_kerja_general';
    }
}
