/**
 * Carton label — data side of the template. Layout: defaults/packedUnitLabel.ts.
 *
 * One A6 sticker per PackedUnit, printed as one sheet per carton (the modal hands
 * TemplatePrintPortal one context per carton). Field sources, none re-entered at
 * print time:
 *   CONTENT  the carton's own `alt_qty` — the count the packer put in the box, in
 *            the order's `uom2` — with the base qty in brackets, and the length
 *            those pieces make up when the factor says so. Read off the carton
 *            rather than divided out of its qty: for a kg item that qty is the
 *            scale reading, and 10.62 kg over 0.9 kg/Pcs prints 11.8 pieces for a
 *            box holding 12. Cartons packed before the count was recorded fall
 *            back to that division.
 *   HEADLINE style code + the CARTON's own shade (resolved off its stock key by
 *            the API), so a label can never claim a colour the box isn't. Size,
 *            combo and other variant attributes print on the line beneath.
 *   PO. NO   the customer's own `customer_po_ref`, our SO number under it.
 *   LOT. NO  the source lot the carton was packed from (via its completion).
 *   N W/G W  `Batch.weight_kg` / `Batch.gross_weight_kg`, snapshotted at pack time.
 *            Blank means unknown, never zero — the blank fields print a write-on line.
 *
 * The QR encodes the carton's `PU-…` number: that is what the picker scans onto a
 * pick list, and the scanner routes on the prefix — never change its payload. The
 * Code 128 barcodes carry the same values for the customer's goods-in.
 */

import JsBarcode from 'jsbarcode';
import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import { txt, type PrintContext } from '../renderContext';
import { orderBasePerAlt, baseToAlt, lengthPerAlt } from '../../altUnit';
import { lotSizeLabel, lotComboLabel, lotColorLabel } from '../../LotChips';

export const PACKED_UNIT_LABEL_DOC = 'packed_unit_label';

export const CARTON_FIELDS: FieldDef[] = [
    { key: 'carton.headline', label: 'Style + shade headline', kind: 'text', group: 'Carton' },
    { key: 'carton.identity', label: 'Size / combo / variant line', kind: 'text', group: 'Carton' },
    { key: 'carton.number', label: 'Carton number (PU-)', kind: 'text', mono: true, group: 'Carton' },
    { key: 'carton.number_tilde', label: 'Carton number "~PU-…"', kind: 'text', group: 'Carton' },
    { key: 'carton.package_line', label: 'Order code + package no', kind: 'text', group: 'Carton' },
    { key: 'carton.packed_date', label: 'Packed date', kind: 'date', group: 'Carton' },
    { key: 'carton.qr', label: 'QR Code (carton number, scan to pick)', kind: 'qr', group: 'Carton' },
    { key: 'carton.number_barcode', label: 'Carton number barcode (Code 128)', kind: 'image', group: 'Carton' },

    { key: 'carton.content', label: 'Content (count + base qty)', kind: 'text', group: 'Content' },
    { key: 'carton.ket_stock', label: 'Ket. stock', kind: 'text', group: 'Content' },
    { key: 'carton.content_barcode', label: 'Content barcode (Code 128)', kind: 'image', group: 'Content' },

    { key: 'carton.po_ref', label: 'PO No (customer, else SO)', kind: 'text', group: 'Order' },
    { key: 'carton.so_code', label: 'Our SO No (under a customer PO)', kind: 'text', group: 'Order' },
    { key: 'carton.po_barcode', label: 'PO No barcode (Code 128)', kind: 'image', group: 'Order' },
    { key: 'carton.lot', label: 'Source Lot No', kind: 'text', group: 'Order' },
    { key: 'carton.lot_barcode', label: 'Lot No barcode (Code 128)', kind: 'image', group: 'Order' },

    { key: 'carton.nw', label: 'Net weight', kind: 'text', group: 'Weight' },
    { key: 'carton.nw_blank', label: 'Net weight write-on line (when unknown)', kind: 'text', group: 'Weight' },
    { key: 'carton.nw_barcode', label: 'Net weight barcode (Code 128)', kind: 'image', group: 'Weight' },
    { key: 'carton.gw', label: 'Gross weight', kind: 'text', group: 'Weight' },
    { key: 'carton.gw_blank', label: 'Gross weight write-on line (when unknown)', kind: 'text', group: 'Weight' },
    { key: 'carton.gw_barcode', label: 'Gross weight barcode (Code 128)', kind: 'image', group: 'Weight' },
    { key: 'carton.packaging_type', label: 'Box type "(name)"', kind: 'text', group: 'Weight' },

    { key: 'carton.company_name', label: 'Company name', kind: 'text', group: 'Brand' },
    { key: 'carton.logo_fallback', label: 'House mark (only when no logo)', kind: 'text', group: 'Brand' },
];

const img = (url: string | undefined): ResolvedField => ({ text: '', empty: !url, imageUrl: url || undefined });

export function resolveCartonLabelField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const bc = d.barcodes || {};
    switch (key) {
        case 'carton.headline': return txt(d.headline);
        case 'carton.identity': return txt(d.identity);
        case 'carton.number': return txt(d.unitNumber);
        case 'carton.number_tilde': return d.unitNumber ? { text: `~${d.unitNumber}`, empty: false } : txt('');
        case 'carton.package_line': return txt(d.packageLine);
        case 'carton.packed_date': return txt(d.packedDate);
        case 'carton.qr': return { text: '', empty: !ctx.qrDataUrl, qrDataUrl: ctx.qrDataUrl };
        case 'carton.number_barcode': return img(bc.unit);
        case 'carton.content': return txt(d.content);
        case 'carton.ket_stock': return txt(d.ketStock);
        case 'carton.content_barcode': return img(bc.content);
        case 'carton.po_ref': return txt(d.poRef);
        case 'carton.so_code': return txt(d.soUnderPo);
        case 'carton.po_barcode': return img(bc.po);
        case 'carton.lot': return txt(d.lot);
        case 'carton.lot_barcode': return img(bc.lot);
        case 'carton.nw': return txt(d.nw);
        case 'carton.nw_blank': return d.nw ? txt('') : { text: '__________ KG', empty: false };
        case 'carton.nw_barcode': return img(bc.nw);
        case 'carton.gw': return txt(d.gw);
        case 'carton.gw_blank': return d.gw ? txt('') : { text: '__________ KG', empty: false };
        case 'carton.gw_barcode': return img(bc.gw);
        case 'carton.packaging_type': return d.packagingType ? { text: `(${d.packagingType})`, empty: false } : txt('');
        case 'carton.company_name': return txt(ctx.companyName);
        case 'carton.logo_fallback': return ctx.companyLogoUrl ? txt('') : { text: 'BIE', empty: false };
        default: return { text: '', empty: true };
    }
}

export const CARTON_ROW_SOURCES: RowSourceDef[] = [];

/**
 * Code 128 as a data URL, stretched onto a fixed 96:26 canvas so an `image` field
 * (which keeps aspect ratio) fills the barcode cell the way the old label's
 * `objectFit: fill` did. JsBarcode is synchronous — cheap enough per carton, but
 * the modal still memoizes the set so a repaint never redraws them.
 */
function makeBarcodeDataUrl(text: string): string {
    if (!text || typeof document === 'undefined') return '';
    try {
        const src = document.createElement('canvas');
        JsBarcode(src, text, { format: 'CODE128', displayValue: false, margin: 0, height: 70, width: 2 });
        const out = document.createElement('canvas');
        out.width = 384;
        out.height = 104;
        const g = out.getContext('2d');
        if (!g) return src.toDataURL('image/png');
        g.imageSmoothingEnabled = false;
        g.drawImage(src, 0, 0, out.width, out.height);
        return out.toDataURL('image/png');
    } catch {
        return '';
    }
}

const lotByCompletion = (po: any): Record<string, string> => {
    const m: Record<string, string> = {};
    (po?.completions || []).forEach((c: any) => { if (c.source_batch_number) m[String(c.id)] = c.source_batch_number; });
    return m;
};

// Count in a carton. The packer's own figure wins; `baseToAlt` only covers cartons
// minted before that was recorded. No alt unit on the order -> null (base qty only).
const piecesOf = (po: any, u: any): number | null => {
    if (u.alt_qty != null) return Number(u.alt_qty);
    const f = orderBasePerAlt(po);
    return f ? baseToAlt(Number(u.qty || 0), f) : null;
};

export type CartonBarcodes = Record<string, string>;

/** One barcode per printed field, the same values the old label barcoded. */
export function cartonBarcodes(po: any, u: any): CartonBarcodes {
    const pcs = piecesOf(po, u);
    return {
        unit: makeBarcodeDataUrl(u.batch_number || String(u.id)),
        content: makeBarcodeDataUrl(pcs !== null ? `${pcs.toFixed(1)}` : String(Number(u.qty || 0).toFixed(2))),
        po: makeBarcodeDataUrl(po.customer_po_ref || po.sales_order_code || ''),
        lot: makeBarcodeDataUrl(lotByCompletion(po)[String(u.packing_completion_id || '')] || ''),
        nw: makeBarcodeDataUrl(u.weight_kg != null ? String(u.weight_kg) : ''),
        gw: makeBarcodeDataUrl(u.gross_weight_kg != null ? String(u.gross_weight_kg) : ''),
    };
}

/** The QR payload — the carton's own number, which the scanner routes on. */
export const cartonQrPayload = (u: any) => u.batch_number || String(u.id);

export function buildCartonLabelContext({
    po, unit, qrDataUrl, barcodes, companyName, companyLogoUrl, companyProfile, tzFormatCustom,
}: {
    po: any;
    unit: any;
    qrDataUrl?: string;
    /** Precomputed by the modal; built here when absent (designer preview). */
    barcodes?: CartonBarcodes;
    companyName?: string;
    companyLogoUrl?: string;
    companyProfile?: any;
    tzFormatCustom: (iso: string, opts: Intl.DateTimeFormatOptions, locale?: string) => string;
}): PrintContext {
    const o = po || {};
    const u = unit || {};
    const pcs = piecesOf(o, u);
    const qty = Number(u.qty || 0);
    // "12 Pic ( 600 Yd / 10.62 KG )" — pieces lead because that is what the
    // receiving side counts; the bracket carries the length and the measured base qty.
    const altLength = lengthPerAlt({ factor: o.uom2_factor, lengthUom: o.uom2_length_uom });
    const bracket = [
        pcs !== null && altLength ? `${(pcs * altLength.qty).toLocaleString()}  ${altLength.uom}` : null,
        `${qty.toLocaleString()}  ${o.item_uom || ''}`.trim(),
    ].filter(Boolean).join('  /  ');
    const content = pcs !== null
        ? `${Number(pcs.toFixed(2)).toLocaleString()}  ${o.uom2 || 'Pcs'}   ( ${bracket} )`
        : `${qty.toLocaleString()}  ${o.item_uom || ''}`;
    const shade = lotColorLabel(u)?.label || o.color_name || null;
    const identity = [
        lotSizeLabel(u),
        lotComboLabel(u),
        ...((u.variant_attributes || []) as any[])
            .filter(a => !['combo', 'color', 'labdip_color'].includes(a.system_role || ''))
            .map(a => a.value),
    ].filter(Boolean).join('  ·  ');
    const dmy = (iso: string) => (iso ? tzFormatCustom(iso, { day: '2-digit', month: '2-digit', year: 'numeric' }, 'id-ID') : '');

    return {
        workOrder: null,
        parentMO: null,
        doc: {
            headline: [u.item_code || o.item_code, shade].filter(Boolean).join(' ') || u.item_name || o.item_name || '',
            identity,
            unitNumber: u.batch_number || '',
            packageLine: `${o.code || ''} · ${(o.package_label || 'Carton').toUpperCase()} #${u.package_no ?? '—'}`,
            packedDate: u.created_at ? dmy(u.created_at) : '',
            content,
            ketStock: o.ket_stock || '',
            poRef: o.customer_po_ref || o.sales_order_code || '',
            // Our own SO number stays under the customer's reference: the customer
            // reads the top line, we reconcile on the bottom.
            soUnderPo: o.customer_po_ref && o.sales_order_code ? o.sales_order_code : '',
            lot: lotByCompletion(o)[String(u.packing_completion_id || '')] || '',
            nw: u.weight_kg != null ? `${Number(u.weight_kg).toFixed(2)}  KG` : '',
            gw: u.gross_weight_kg != null ? `${Number(u.gross_weight_kg).toFixed(2)}  KG` : '',
            // Which box that tare came from — reprinting an old carton must show the
            // box it was actually packed in, not today's master.
            packagingType: u.packaging_type_name || '',
            barcodes: barcodes ?? cartonBarcodes(o, u),
        },
        companyName,
        companyLogoUrl,
        companyProfile,
        qrDataUrl,
        printDate: dmy(new Date().toISOString()),
        formatDate: dmy,
        moAttributeValue: () => '',
    };
}
