/**
 * Generic lot sticker (`lot_label`) — one A6 label per Batch row. Layout:
 * defaults/lotLabel.ts.
 *
 * Unlike the bag/beam labels (doctypes/outputLabel.ts), which need the MOCompletion
 * that produced the unit, this prints straight off a lot, so it covers split
 * leftovers, weighed beam remnants, goods-receipt and manual lots. QR and Code 128
 * both encode the lot number.
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import { moShade, type PrintContext } from '../renderContext';
import { makeLotBarcodeDataUrl } from './outputLabel';
import { lotSizeLabel } from '../../LotChips';

export const LOT_LABEL_DOC = 'lot_label';

export const LOT_LABEL_HEADING = 'LABEL LOT / LOT LABEL';

export const LOTLABEL_FIELDS: FieldDef[] = [
    { key: 'lotlabel.heading', label: 'Heading (set by the printing screen)', kind: 'text', group: 'Lot' },
    { key: 'lotlabel.lot_no', label: 'Lot Number', kind: 'text', mono: true, group: 'Lot' },
    { key: 'lotlabel.qr', label: 'QR Code (lot number)', kind: 'qr', group: 'Lot' },
    { key: 'lotlabel.barcode', label: 'Barcode (Code 128, lot number)', kind: 'image', group: 'Lot' },
    { key: 'lotlabel.weight', label: 'Berat (remaining kg)', kind: 'number', unit: 'kg', group: 'Lot' },
    { key: 'lotlabel.date', label: 'Lot Created Date', kind: 'date', group: 'Lot' },
    { key: 'lotlabel.notes', label: 'Catatan (lot notes)', kind: 'text', group: 'Lot' },
    { key: 'lotlabel.status', label: 'Quality Status', kind: 'text', group: 'Lot' },
    { key: 'lotlabel.item_name', label: 'Artikel', kind: 'text', group: 'Identity' },
    { key: 'lotlabel.item_code', label: 'Kode (item code)', kind: 'text', mono: true, group: 'Identity' },
    { key: 'lotlabel.size', label: 'Size / Ukuran', kind: 'text', group: 'Identity' },
    { key: 'lotlabel.color', label: 'Warna', kind: 'text', group: 'Identity' },
    { key: 'lotlabel.color_code', label: 'Kode Warna (colour code)', kind: 'text', group: 'Identity' },
    { key: 'lotlabel.location', label: 'Lokasi', kind: 'text', group: 'Identity' },
    { key: 'lotlabel.footer_trace', label: 'Traceability Footer (Lot ID)', kind: 'text', group: 'Identity' },
];

const EM_DASH = '—';

function txt(v: any): ResolvedField {
    const s = v == null || v === '' ? '' : String(v);
    return { text: s || EM_DASH, empty: s === '' };
}

export function resolveLotLabelField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const lot = d.lot || {};
    switch (key) {
        case 'lotlabel.heading': return txt(d.heading);
        case 'lotlabel.lot_no': return txt(lot.batch_number);
        case 'lotlabel.qr': return { text: '', empty: !ctx.qrDataUrl, qrDataUrl: ctx.qrDataUrl };
        case 'lotlabel.barcode': return { text: '', empty: !d.barcodeDataUrl, imageUrl: d.barcodeDataUrl || undefined };
        case 'lotlabel.weight': {
            const kg = Number(lot.remaining ?? 0);
            return kg > 0 ? { text: kg.toFixed(2), empty: false } : { text: EM_DASH, empty: true };
        }
        case 'lotlabel.date': return txt(d.date);
        case 'lotlabel.notes': return txt(lot.notes);
        case 'lotlabel.status': return txt(lot.quality_status);
        case 'lotlabel.item_name': return txt(lot.item_name);
        case 'lotlabel.item_code': return txt(lot.item_code);
        case 'lotlabel.size': return txt(lotSizeLabel(lot));
        case 'lotlabel.color': return txt(lotShade(lot).name);
        case 'lotlabel.color_code': return txt(lotShade(lot).code);
        case 'lotlabel.location': return txt(lot.location_name);
        case 'lotlabel.footer_trace': return { text: `Lot ID: ${lot.id || ''}`, empty: false };
        default: return { text: '', empty: true };
    }
}

/** Same WARNA / KODE WARNA split as `moShade`, read off the lot's resolved identity. */
function lotShade(lot: any): { name: string; code: string } {
    const attrs: any[] = lot?.variant_attributes || [];
    return moShade(lot, (r: string) => attrs.find(a => a.system_role === r)?.value || '');
}

const DMY: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

export function buildLotLabelContext({
    lot, heading, qrDataUrl, barcodeDataUrl, companyName, companyLogoUrl, companyProfile, tzFormatCustom,
}: {
    lot: any;
    heading?: string;
    qrDataUrl?: string;
    /** Generated here from the lot number when omitted. */
    barcodeDataUrl?: string;
    companyName?: string;
    companyLogoUrl?: string;
    companyProfile?: any;
    tzFormatCustom: (iso: string, opts: Intl.DateTimeFormatOptions, locale?: string) => string;
}): PrintContext {
    const l = lot || {};
    return {
        workOrder: null,
        parentMO: null,
        doc: {
            lot: l,
            heading: heading || LOT_LABEL_HEADING,
            barcodeDataUrl: barcodeDataUrl ?? makeLotBarcodeDataUrl(l.batch_number || String(l.id || '')),
            date: tzFormatCustom(l.created_at || new Date().toISOString(), DMY, 'id-ID'),
        },
        qrDataUrl,
        companyName,
        companyLogoUrl,
        companyProfile,
        printDate: tzFormatCustom(new Date().toISOString(), DMY, 'id-ID'),
        formatDate: (iso: string) => tzFormatCustom(iso, DMY, 'id-ID'),
        moAttributeValue: () => '',
    };
}
