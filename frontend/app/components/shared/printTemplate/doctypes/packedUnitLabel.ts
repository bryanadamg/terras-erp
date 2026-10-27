/**
 * Carton label — data side of the template. Layout: defaults/packedUnitLabel.ts.
 *
 * One A6 sticker per PackedUnit, printed as one sheet per carton (the modal hands
 * TemplatePrintPortal one context per carton). Field sources, none re-entered at
 * print time:
 *   CONTENT  the carton's own `alt_qty` — the count the packer put in the box, in
 *            the order's `uom2` — with the length those pieces make up in
 *            brackets when the factor says so. Read off the carton
 *            rather than divided out of its qty: for a kg item that qty is the
 *            scale reading, and 10.62 kg over 0.9 kg/Pcs prints 11.8 pieces for a
 *            box holding 12. Cartons packed before the count was recorded fall
 *            back to that division.
 *   HEADLINE style code; any other variant attributes print on the line beneath.
 *   COLOR CODE / COLOR / COMBO / SIZE  each on its own row, off the CARTON's own
 *            stock key (resolved by the API), so a label can never claim a colour
 *            the box isn't.
 *   PO. NO   the customer's own `customer_po_ref`, our SO number under it.
 *   LOT. NO  the source lot the carton was packed from (via its completion).
 *   N W/G W  `Batch.weight_kg` / `Batch.gross_weight_kg`, snapshotted at pack time.
 *            Blank means unknown, never zero — the blank fields print a write-on line.
 *
 * The carton's `PU-…` number is the only code on the label: the QR (phone
 * cameras) and one Code 128 (handheld scanners) both carry it, and that is what the
 * picker scans onto a pick list (the scanner routes on the prefix — never change
 * the payload). The per-field Code 128s (content, PO, lot, N W, G W) were dropped:
 * nothing scans them, and squeezed into a quarter of the label the PU- barcode
 * beside them had no quiet zone and would not scan.
 */

import JsBarcode from 'jsbarcode';
import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import { txt, type PrintContext } from '../renderContext';
import { orderBasePerAlt, baseToAlt, lengthPerAlt } from '../../altUnit';
import { lotSizeText, lotComboLabel, lotColorLabel } from '../../LotChips';

export const PACKED_UNIT_LABEL_DOC = 'packed_unit_label';

export const CARTON_FIELDS: FieldDef[] = [
    { key: 'carton.headline', label: 'Style code headline', kind: 'text', group: 'Carton' },
    { key: 'carton.identity', label: 'Other variant attributes line', kind: 'text', group: 'Carton' },
    { key: 'carton.color_code', label: 'Color code', kind: 'text', group: 'Carton' },
    { key: 'carton.color_name', label: 'Color (variant name)', kind: 'text', group: 'Carton' },
    { key: 'carton.combo', label: 'Combo', kind: 'text', group: 'Carton' },
    { key: 'carton.size', label: 'Size', kind: 'text', group: 'Carton' },
    { key: 'carton.number', label: 'Carton number (PU-)', kind: 'text', mono: true, group: 'Carton' },
    { key: 'carton.number_tilde', label: 'Carton number "~PU-…"', kind: 'text', group: 'Carton' },
    { key: 'carton.package_line', label: 'Order code + package no', kind: 'text', group: 'Carton' },
    { key: 'carton.packed_date', label: 'Packed date', kind: 'date', group: 'Carton' },
    { key: 'carton.qr', label: 'QR Code (carton number, scan to pick)', kind: 'qr', group: 'Carton' },
    { key: 'carton.number_barcode', label: 'Carton number barcode (Code 128)', kind: 'image', group: 'Carton' },

    { key: 'carton.content', label: 'Content (count + length)', kind: 'text', group: 'Content' },
    { key: 'carton.ket_stock', label: 'Ket. stock', kind: 'text', group: 'Content' },

    { key: 'carton.po_ref', label: 'PO No (customer, else SO)', kind: 'text', group: 'Order' },
    { key: 'carton.so_code', label: 'Our SO No (under a customer PO)', kind: 'text', group: 'Order' },
    { key: 'carton.lot', label: 'Source Lot No', kind: 'text', group: 'Order' },

    { key: 'carton.nw', label: 'Net weight', kind: 'text', group: 'Weight' },
    { key: 'carton.nw_blank', label: 'Net weight write-on line (when unknown)', kind: 'text', group: 'Weight' },
    { key: 'carton.gw', label: 'Gross weight', kind: 'text', group: 'Weight' },
    { key: 'carton.gw_blank', label: 'Gross weight write-on line (when unknown)', kind: 'text', group: 'Weight' },
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
        case 'carton.color_code': return txt(d.colorCode);
        case 'carton.color_name': return txt(d.colorName);
        case 'carton.combo': return txt(d.combo);
        case 'carton.size': return txt(d.size);
        case 'carton.number': return txt(d.unitNumber);
        case 'carton.number_tilde': return d.unitNumber ? { text: `~${d.unitNumber}`, empty: false } : txt('');
        case 'carton.package_line': return txt(d.packageLine);
        case 'carton.packed_date': return txt(d.packedDate);
        case 'carton.qr': return { text: '', empty: !ctx.qrDataUrl, qrDataUrl: ctx.qrDataUrl };
        case 'carton.number_barcode': return img(bc.unit);
        case 'carton.content': return txt(d.content);
        case 'carton.ket_stock': return txt(d.ketStock);
        case 'carton.po_ref': return txt(d.poRef);
        case 'carton.so_code': return txt(d.soUnderPo);
        case 'carton.lot': return txt(d.lot);
        case 'carton.nw': return txt(d.nw);
        case 'carton.nw_blank': return d.nw ? txt('') : { text: '__________ KG', empty: false };
        case 'carton.gw': return txt(d.gw);
        case 'carton.gw_blank': return d.gw ? txt('') : { text: '__________ KG', empty: false };
        case 'carton.packaging_type': return d.packagingType ? { text: `(${d.packagingType})`, empty: false } : txt('');
        case 'carton.company_name': return txt(ctx.companyName);
        case 'carton.logo_fallback': return ctx.companyLogoUrl ? txt('') : { text: 'BIE', empty: false };
        default: return { text: '', empty: true };
    }
}

export const CARTON_ROW_SOURCES: RowSourceDef[] = [];

/**
 * Code 128 as an SVG data URL at its natural proportions, with the quiet zone the
 * symbology needs (10+ modules each side). SVG so it prints crisp at any paper
 * size; never stretched to a fixed canvas — a fixed 384 px canvas made the module
 * widths uneven and, with no margin, the scanner could not find the start bar.
 */
function makeBarcodeDataUrl(text: string): string {
    if (!text || typeof document === 'undefined') return '';
    try {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        // Quiet zone left/right only (10 modules); the placement's imageHeight then
        // sets the printed size and the width follows the bars' ratio. The viewBox
        // is what lets the image scale instead of clipping.
        JsBarcode(svg, text, {
            format: 'CODE128', displayValue: false, height: 120, width: 3,
            margin: 0, marginLeft: 30, marginRight: 30,
        });
        const w = svg.getAttribute('width')?.replace('px', '');
        const h = svg.getAttribute('height')?.replace('px', '');
        if (w && h && !svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        const xml = new XMLSerializer().serializeToString(svg);
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
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

/** The carton number as a Code 128 — the only barcode the label carries. */
export function cartonBarcodes(_po: any, u: any): CartonBarcodes {
    return { unit: makeBarcodeDataUrl(u.batch_number || String(u.id)) };
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
    // "12 Pic ( 600 Yd )" — pieces lead because that is what the receiving side
    // counts; the bracket carries the length when the order's factor gives one. No
    // base qty: `u.qty` is the live balance, so a reprint after picking read 0 kg.
    const altLength = lengthPerAlt({ factor: o.uom2_factor, lengthUom: o.uom2_length_uom });
    const pcsText = pcs !== null ? `${Number(pcs.toFixed(2)).toLocaleString()}  ${o.uom2 || 'Pcs'}` : '';
    const content = pcs === null
        ? `${qty.toLocaleString()}  ${o.item_uom || ''}`
        : altLength
            ? `${pcsText}   ( ${(pcs * altLength.qty).toLocaleString()}  ${altLength.uom} )`
            : pcsText;
    const attrs = (u.variant_attributes || []) as any[];
    // An unapproved lab dip has no code yet; its variant code stands in (lotColorLabel's pending case).
    const colorCode = u.color_code || attrs.find(a => a.system_role === 'labdip_color')?.value || u.labdip_variant_code || '';
    const colorName = lotColorLabel(u)?.name || (o.color_name !== colorCode ? o.color_name : '') || '';
    const identity = attrs
        .filter(a => !['combo', 'color', 'labdip_color'].includes(a.system_role || ''))
        .map(a => a.value)
        .filter(Boolean).join('  ·  ');
    const dmy = (iso: string) => (iso ? tzFormatCustom(iso, { day: '2-digit', month: '2-digit', year: 'numeric' }, 'id-ID') : '');

    return {
        workOrder: null,
        parentMO: null,
        doc: {
            headline: u.item_code || o.item_code || u.item_name || o.item_name || '',
            identity,
            colorCode,
            colorName,
            combo: lotComboLabel(u) || '',
            size: lotSizeText(u) || '',
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
