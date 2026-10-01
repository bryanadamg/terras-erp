/**
 * Built-in lot sticker layout — transcription of the hand-built card that lived in
 * LotLabelPrintModal. Same chrome as the bag/beam labels (defaults/outputLabel.ts).
 */

import type { PrintLayout } from '../types';
import { PRINT_FONT } from '../../typography';
import { LABEL_PAPER, labelHeader, labelLotHero, labelSignature } from './outputLabel';

export const LOT_LABEL_DEFAULT: PrintLayout = {
    version: 1, paper: LABEL_PAPER, fontFamily: PRINT_FONT, paddingMm: 0,
    bands: [
        // The heading is the printing screen's ("LABEL SISA / LEFTOVER" off a split).
        labelHeader('lotlabel', { field: 'lotlabel.heading' }, 'Scan = Lot'),
        labelLotHero('lotlabel', 'NO. LOT (KANTONG)'),
        {
            id: 'label_metrics', type: 'grid', gap: 6, cellBox: '1px solid #999', marginBottom: 6,
            items: [{ field: 'lotlabel.weight', col: 1, span: 12, row: 1, fontSize: 24, bold: true, showLabel: true, label: 'BERAT / WEIGHT' }],
        },
        {
            id: 'label_identity', type: 'keyvalue', labelWidth: '26%', marginBottom: 6,
            rows: [
                { field: 'lotlabel.item_name', label: 'Artikel', span: 3, bold: true },
                { field: 'lotlabel.item_code', label: 'Kode', span: 3, fontSize: 10, mono: true },
                { field: 'lotlabel.size', label: 'Size', span: 3, bold: true, hideWhenEmpty: true },
                { field: 'lotlabel.location', label: 'Lokasi', span: 3 },
                { field: 'lotlabel.notes', label: 'Catatan', span: 3, fontSize: 9, hideWhenEmpty: true },
            ],
        },
        ...labelSignature('lotlabel'),
    ],
};
