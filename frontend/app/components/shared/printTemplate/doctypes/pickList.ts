/**
 * Kartu Picking (pick list card) — data side of the template. Layout: defaults/pickList.ts.
 *
 * The floor document for a pick list, sibling of the Kartu Packing. The QR encodes
 * the pick list CODE (`PL-…`), which the picker scans at /scanner to open the list.
 * The carton checklist is the paper fallback for the scan loop, so the pick can be
 * walked when a phone is flat and keyed afterwards.
 *
 * Deliberately not the Surat Jalan: that is the delivery note, printed at the
 * loading deck after picking, and carries no QR.
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import { txt, type PrintContext } from '../renderContext';
import { lotSizeText, lotColorLabel, lotComboLabel } from '../../LotChips';

export const PICK_LIST_DOC = 'pick_list';

export const PLIST_FIELDS: FieldDef[] = [
    { key: 'plist.code', label: 'Pick List No', kind: 'text', group: 'Pick List' },
    { key: 'plist.qr', label: 'QR Code (pick list code, scan to open)', kind: 'qr', group: 'Pick List' },
    { key: 'plist.company_name', label: 'Company name', kind: 'text', group: 'Pick List' },
    { key: 'plist.so_code', label: 'No. SO', kind: 'text', group: 'Pick List' },
    { key: 'plist.customer', label: 'Pelanggan / Customer', kind: 'text', group: 'Pick List' },
    { key: 'plist.carton_count', label: 'Jml koli / Cartons', kind: 'number', group: 'Pick List' },
    // Delivery date / carrier / vehicle / driver are loading-deck facts that live on
    // the Shipment (its Surat Jalan prints them); the pick list's own columns are legacy.
    { key: 'plist.shipment', label: 'Shipment No (once staged)', kind: 'text', group: 'Pick List' },
    { key: 'plist.status', label: 'Status', kind: 'text', group: 'Pick List' },
    { key: 'plist.gross_total_label', label: '"Total bruto" caption (only with a gross total)', kind: 'text', group: 'Totals' },
    { key: 'plist.gross_total', label: 'Total bruto (kg)', kind: 'text', group: 'Totals' },
    { key: 'plist.summary_heading', label: 'Shipping summary heading (only with lines)', kind: 'text', group: 'Pick List' },
    { key: 'plist.notes', label: 'Notes', kind: 'text', group: 'Pick List' },
    { key: 'plist.sign_line', label: 'Signature "(____)" line', kind: 'text', group: 'Signatures' },
];

const NA: ResolvedField = { text: '', empty: true };

export function resolvePickListField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const pl = d.pl || {};
    switch (key) {
        case 'plist.code': return txt(pl.code);
        case 'plist.qr': return { text: '', empty: !ctx.qrDataUrl, qrDataUrl: ctx.qrDataUrl };
        case 'plist.company_name': return txt(ctx.companyName);
        case 'plist.so_code': return txt(pl.sales_order_code);
        case 'plist.customer': return txt(pl.customer_name);
        case 'plist.carton_count': return { text: String(d.cartons.length), empty: false };
        case 'plist.shipment': return txt(pl.shipment_code);
        case 'plist.status': return txt(pl.status);
        // Cartons packed before packaging was recorded contribute nothing rather
        // than a guessed zero-tare figure; no gross at all prints no total.
        case 'plist.gross_total_label': return d.grossTotal > 0 ? { text: 'Total bruto', empty: false } : NA;
        case 'plist.gross_total': return d.grossTotal > 0 ? { text: `${d.grossTotal.toFixed(2)} kg`, empty: false } : NA;
        case 'plist.summary_heading':
            return d.itemRows.length ? { text: 'Ringkasan Kirim / Shipping Summary:', empty: false } : NA;
        case 'plist.notes': return txt(pl.notes);
        case 'plist.sign_line': return { text: '(________________)', empty: false };
        default: return NA;
    }
}

/**
 * The shade code a picker checks against the box: the carton's own (its lot's
 * shade), falling back to the ordered shade on a bulk line with no carton.
 */
function lineShade(l: any): string {
    const own = l.carton_identity ? lotColorLabel(l.carton_identity)?.label : null;
    return own || l.color_code || l.color_name || '';
}

const n = (v: any) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };

/** A carton's qty in the unit the customer ordered in (its packed count — Gross,
 *  Pcs), falling back to stock UoM for a bulk line or a box packed without one. */
const lineQty = (l: any): { qty: number; uom: string } =>
    l.alt_qty != null && l.alt_uom
        ? { qty: n(l.alt_qty), uom: l.alt_uom }
        : { qty: n(l.qty_picked), uom: l.item_uom || '' };

const PLIST_SUMMARY: RowSourceDef = {
    id: 'plist_summary',
    label: 'Shipping summary (per item)',
    docTypes: [PICK_LIST_DOC],
    seedColumns: ['no', 'item', 'cartons', 'qty'],
    columns: [
        { field: 'no', label: 'No' },
        { field: 'item', label: 'Barang / Item (name + muted code)' },
        { field: 'item_name', label: 'Item name' },
        { field: 'item_code', label: 'Item code' },
        { field: 'size', label: 'Size' },
        { field: 'warna', label: 'Warna (code)' },
        { field: 'combo', label: 'Combo' },
        { field: 'cartons', label: 'Koli' },
        { field: 'qty', label: 'Qty' },
    ],
    resolve: (ctx) => ({
        rows: (ctx.doc?.itemRows || []).map((r: any, i: number) => ({
            _key: r.key,
            no: String(i + 1),
            item: { code: r.code, name: r.name },
            item_name: r.name,
            item_code: r.code,
            size: r.size || null,
            warna: r.warna || null,
            combo: r.combo || null,
            cartons: String(r.cartons),
            qty: `${r.qty.toLocaleString()} ${r.uom}`.trim(),
        })),
    }),
};

const PLIST_CARTONS: RowSourceDef = {
    id: 'plist_cartons',
    label: 'Carton checklist',
    docTypes: [PICK_LIST_DOC],
    seedColumns: ['no', 'carton', 'item_code', 'qty', 'check'],
    columns: [
        { field: 'no', label: 'No' },
        { field: 'carton', label: 'No. Koli / Carton' },
        { field: 'item_code', label: 'Barang / Item' },
        { field: 'item_name', label: 'Item name' },
        { field: 'size', label: 'Size' },
        { field: 'warna', label: 'Warna (code)' },
        { field: 'combo', label: 'Combo' },
        { field: 'packaging', label: 'Kemasan / Packaging' },
        { field: 'qty', label: 'Qty' },
        { field: 'gross', label: 'Bruto' },
        // The picker's tick — blank on purpose.
        { field: 'check', label: '✓' },
    ],
    resolve: (ctx) => ({
        rows: (ctx.doc?.cartons || []).map((l: any, i: number) => ({
            _key: l.id ?? i,
            no: String(l.package_no ?? i + 1),
            carton: l.batch_number || null,
            item_code: l.item_code || null,
            item_name: l.item_name || null,
            size: lotSizeText(l),
            warna: lineShade(l) || null,
            combo: lotComboLabel(l.carton_identity || {}),
            packaging: l.packaging_type_name || null,
            qty: (({ qty, uom }) => `${qty.toLocaleString()} ${uom}`.trim())(lineQty(l)),
            gross: l.gross_weight_kg != null ? `${n(l.gross_weight_kg).toFixed(2)} kg` : null,
            check: null,
        })),
    }),
};

export const PLIST_ROW_SOURCES: RowSourceDef[] = [PLIST_SUMMARY, PLIST_CARTONS];

export function buildPickListContext({
    pl, companyName, companyLogoUrl, companyProfile, qrDataUrl, tzFormatCustom,
}: {
    pl: any;
    companyName?: string;
    companyLogoUrl?: string;
    companyProfile?: any;
    qrDataUrl?: string;
    tzFormatCustom: (iso: string, opts: Intl.DateTimeFormatOptions, locale?: string) => string;
}): PrintContext {
    const p = pl || {};
    const fmt = (iso: any) => {
        if (!iso) return '';
        try { return tzFormatCustom(iso, { day: '2-digit', month: '2-digit', year: 'numeric' }, 'en-GB').replace(/\//g, '.'); } catch { return ''; }
    };
    const lines: any[] = p.lines || [];
    const cartons = lines.filter((l: any) => l.batch_id);
    // What actually ships, per item and size — an order running several sizes of
    // one article ships them as separate quantities, so they never sum together.
    // Summed in the alt unit while every line agrees on it; one line without a
    // count (or in another unit) drops the row back to stock UoM so two unlike
    // units never add into one figure.
    const byItem: Record<string, { key: string; code: string; name: string; size: string; warna: string; combo: string; qty: number; cartons: number; uom: string; baseQty: number; baseUom: string; altOk: boolean }> = {};
    for (const l of lines) {
        const size = lotSizeText(l) || '';
        const warna = lineShade(l);
        const combo = lotComboLabel(l.carton_identity || {}) || '';
        const key = `${l.item_id}|${size}|${warna}|${combo}`;
        const row = byItem[key] || (byItem[key] = {
            key, code: l.item_code || String(l.item_id), name: l.item_name || '', size, warna, combo, qty: 0, cartons: 0,
            uom: l.alt_uom || '', baseQty: 0, baseUom: l.item_uom || '', altOk: true,
        });
        row.baseQty += n(l.qty_picked);
        row.altOk = row.altOk && l.alt_qty != null && !!l.alt_uom && l.alt_uom === row.uom;
        row.qty += n(l.alt_qty);
        if (l.batch_id) row.cartons += 1;
    }
    for (const r of Object.values(byItem)) {
        if (!r.altOk) { r.qty = r.baseQty; r.uom = r.baseUom; }
    }

    return {
        workOrder: null,
        parentMO: null,
        doc: {
            pl: p,
            cartons,
            itemRows: Object.values(byItem),
            // Brutto across the picked cartons — net plus the boxes, snapshotted at pack time.
            grossTotal: cartons.reduce((s: number, l: any) => s + (Number(l.gross_weight_kg) || 0), 0),
        },
        companyName,
        companyLogoUrl,
        companyProfile,
        qrDataUrl,
        printDate: fmt(new Date().toISOString()),
        formatDate: fmt,
        moAttributeValue: () => '',
    };
}
