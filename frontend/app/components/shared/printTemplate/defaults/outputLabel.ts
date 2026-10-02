/**
 * Built-in bag and warp-beam label layouts — transcriptions of the hand-built
 * BagLabelCard / BeamLabelCard they replaced. The lot sticker (defaults/lotLabel.ts)
 * shares the same chrome, so the header / lot hero / signature pieces live here.
 *
 * A6 portrait on a 6mm page margin with no extra inset: what the old
 * `@page baglabel` sheet printed.
 */

import type { PrintLayout, Band, FieldSpec } from '../types';
import { PRINT_FONT } from '../../typography';

export const LABEL_PAPER: PrintLayout['paper'] = { size: 'A6', orientation: 'portrait', marginMm: 6 };

const HERO_LABEL: Partial<FieldSpec> = { showLabel: true };

/** Company / title / date beside the lot QR. `titleField` is `__text` or a data field. */
export function labelHeader(prefix: string, title: FieldSpec, qrCaption: string): Band {
    return {
        id: 'label_header', type: 'grid', gap: 8, borderBottom: '2px solid #000', padding: '0 0 5px', marginBottom: 6,
        items: [
            {
                col: 1, span: 7, row: 1, stackGap: 1,
                stack: [
                    { field: 'company.name', fontSize: 10, bold: true, hideWhenEmpty: true },
                    { fontSize: 8, bold: true, color: '#555', ...title },
                    { field: `${prefix}.date`, fontSize: 8, color: '#666' },
                ],
            },
            { field: `${prefix}.qr`, col: 8, span: 5, row: 1, align: 'right', qrSize: 96, qrCaption },
        ],
    };
}

/** Lot number hero with the Code 128 under it. */
export function labelLotHero(prefix: string, caption: string): Band {
    return {
        id: 'label_lot', type: 'grid', gap: 0, box: '2px solid #000', padding: '4px 8px', marginBottom: 6,
        items: [{
            col: 1, span: 12, row: 1, stackGap: 3,
            stack: [
                { field: `${prefix}.lot_no`, fontSize: 18, bold: true, mono: true, ...HERO_LABEL, label: caption },
                { field: `${prefix}.barcode`, imageHeight: 40, align: 'center' },
            ],
        }],
    };
}

export function labelSignature(prefix: string): Band[] {
    return [
        { id: 'label_spacer', type: 'spacer', minHeight: 4, marginBottom: 0 },
        {
            id: 'label_signature', type: 'signature', borderTop: '1px solid #ccc', padding: '6px 0 0', marginBottom: 0,
            footerFields: [{ field: `${prefix}.footer_trace`, fontSize: 6 }],
            boxes: [{ caption: 'PARAF', width: 90, height: 22 }],
        },
    ];
}

const WEIGHT: FieldSpec = { field: 'outlabel.weight', fontSize: 24, bold: true, ...HERO_LABEL, label: 'BERAT / WEIGHT' };

const COMPONENTS: Band = {
    id: 'label_components', type: 'table', source: 'outlabel_components',
    title: 'Komponen Terpakai', titleUppercase: true, fontSize: 9, hideWhenEmpty: true, marginBottom: 6,
    columns: [
        { field: 'item', label: 'Komponen' },
        { field: 'qty', label: 'Qty', width: '26%', align: 'right', bold: true, decimals: 2 },
    ],
};

export const BAG_LABEL_DEFAULT: PrintLayout = {
    version: 1, paper: LABEL_PAPER, fontFamily: PRINT_FONT, paddingMm: 0,
    bands: [
        labelHeader('outlabel', { field: '__text', text: 'LABEL KANTONG / BAG LABEL' }, 'Scan = Lot'),
        labelLotHero('outlabel', 'NO. LOT (KANTONG)'),
        {
            id: 'label_metrics', type: 'grid', gap: 6, cellBox: '1px solid #999', alignItems: 'stretch', marginBottom: 6,
            items: [
                { ...WEIGHT, col: 1, span: 8, row: 1 },
                { field: 'outlabel.bag_seq', col: 9, span: 4, row: 1, fontSize: 22, bold: true, align: 'center', ...HERO_LABEL, label: 'KANTONG' },
            ],
        },
        {
            id: 'label_identity', type: 'keyvalue', labelWidth: '24%', marginBottom: 6,
            rows: [
                { field: 'outlabel.item_name', label: 'Artikel', span: 3, bold: true },
                { field: 'outlabel.size', label: 'Size', bold: true },
                { field: 'outlabel.color', label: 'Warna' },
                { field: 'outlabel.color_code', label: 'Kode Warna', bold: true },
                { field: 'outlabel.combo', label: 'Combo', bold: true, hideWhenEmpty: true },
                { field: 'outlabel.width', label: 'Lebar' },
                { field: 'outlabel.machine', label: 'No. Mesin' },
                { field: 'outlabel.wo_code', label: 'SPK / WO', fontSize: 9, mono: true },
                { field: 'outlabel.operator', label: 'Operator' },
                { field: 'outlabel.putaway', label: 'Simpan di Rak', bold: true },
                { field: 'outlabel.notes', label: 'Catatan', span: 3, fontSize: 9 },
            ],
        },
        COMPONENTS,
        ...labelSignature('outlabel'),
    ],
};

export const BEAM_LABEL_DEFAULT: PrintLayout = {
    version: 1, paper: LABEL_PAPER, fontFamily: PRINT_FONT, paddingMm: 0,
    bands: [
        labelHeader('outlabel', { field: '__text', text: 'LABEL BOOM / BEAM LABEL' }, 'Scan = Pasang / Mount'),
        labelLotHero('outlabel', 'NO. BOOM / BEAM No.'),
        {
            // Ends lead: it is the spec that decides which article the warp can weave.
            id: 'label_metrics', type: 'grid', gap: 6, cellBox: '1px solid #999', alignItems: 'stretch', marginBottom: 6,
            items: [
                { field: 'outlabel.ends', col: 1, span: 6, row: 1, fontSize: 24, bold: true, ...HERO_LABEL, label: 'UTAS / ENDS' },
                { ...WEIGHT, col: 7, span: 6, row: 1 },
            ],
        },
        {
            id: 'label_identity', type: 'keyvalue', labelWidth: '24%', marginBottom: 6,
            rows: [
                { field: 'outlabel.item_name', label: 'Artikel', span: 3, bold: true },
                { field: 'outlabel.size', label: 'Size', span: 3, bold: true, hideWhenEmpty: true },
                { field: 'outlabel.machine', label: 'No. Mesin' },
                { field: 'outlabel.wo_code', label: 'SPK / WO', fontSize: 9, mono: true },
                { field: 'outlabel.operator', label: 'Operator' },
                { field: 'outlabel.putaway', label: 'Simpan di Rak', bold: true },
                { field: 'outlabel.notes', label: 'Catatan', span: 3, fontSize: 9 },
            ],
        },
        COMPONENTS,
        {
            // Mount log — written by hand when the beam goes up on a loom. Blank on
            // purpose: the ERP records the mount, this is the tag on the rack. One
            // row each: a paired row squeezes the blank write-in cells to nothing.
            id: 'label_mount_log', type: 'keyvalue', labelWidth: '24%', marginBottom: 6,
            rows: [
                { field: '__blank', label: 'Dipasang di', span: 3 },
                { field: '__blank', label: 'Tgl. Pasang', span: 3 },
            ],
        },
        ...labelSignature('outlabel'),
    ],
};
