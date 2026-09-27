/**
 * Kartu Packing — data side of the template. Layout: defaults/packingCard.ts.
 *
 * The floor document for a packing order, in the same spirit as the Kartu Kerja:
 * header facts, a packaging-materials checklist, a blank log, and a QR the packer
 * scans to log cartons. The QR encodes the packing order CODE (`PCK-…`) — the
 * scanner routes on that prefix, so its payload never changes. Carton QRs live
 * on the A6 carton labels.
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import type { PrintContext } from '../renderContext';
import { orderBasePerAlt, baseToAlt, uomIsKg } from '../../altUnit';
import { orderBoxSizeAlt } from '../../packingBoxes';

export const PACKING_CARD_DOC = 'packing_card';

export const PCARD_FIELDS: FieldDef[] = [
    { key: 'pcard.code', label: 'Packing Order No', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.qr', label: 'QR Code (order code, scan to log)', kind: 'qr', group: 'Packing Order' },
    { key: 'pcard.company_name', label: 'Company name', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.item', label: 'Barang / Item "name (code)"', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.color', label: 'Warna / Colour', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.variant', label: 'Varian', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.target', label: 'Target (base + selling unit)', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.box_size', label: 'Isi per koli', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.sample_weight_caption', label: '"Berat contoh" caption (kg orders with a selling unit)', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.sample_weight', label: 'Berat contoh (kg orders with a selling unit)', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.selling_unit', label: 'Satuan jual', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.package_label', label: 'Jenis kemasan', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.machine', label: 'Mesin / Machine', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.so_code', label: 'No. SO', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.customer', label: 'Pelanggan', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.target_end_date', label: 'Target selesai', kind: 'date', group: 'Packing Order' },
    { key: 'pcard.status', label: 'Status', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.materials_heading', label: 'Materials heading (only when materials are planned)', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.notes', label: 'Notes', kind: 'text', group: 'Packing Order' },
    { key: 'pcard.sign_line', label: 'Signature "(____)" line', kind: 'text', group: 'Signatures' },
];

function txt(v: any): ResolvedField {
    const s = v == null || v === '' ? '' : String(v);
    return { text: s || '—', empty: s === '' };
}
const NA: ResolvedField = { text: '', empty: true };

export function resolvePackingCardField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const po = d.po || {};
    switch (key) {
        case 'pcard.code': return txt(po.code);
        case 'pcard.qr': return { text: '', empty: !ctx.qrDataUrl, qrDataUrl: ctx.qrDataUrl };
        case 'pcard.company_name': return txt(ctx.companyName);
        case 'pcard.item': return txt(d.item);
        case 'pcard.color': return txt(po.color_name);
        case 'pcard.variant': return txt(d.variant);
        case 'pcard.target': return txt(d.target);
        case 'pcard.box_size': return txt(d.boxSize);
        // Only kg orders sold in another unit say which g/y their kilos came from.
        case 'pcard.sample_weight_caption': return d.sampleWeight ? { text: 'Berat contoh', empty: false } : NA;
        case 'pcard.sample_weight': return d.sampleWeight ? { text: d.sampleWeight, empty: false } : NA;
        case 'pcard.selling_unit': return txt(d.sellingUnit);
        case 'pcard.package_label': return txt(po.package_label || 'Carton');
        case 'pcard.machine': return txt(po.work_center_name);
        case 'pcard.so_code': return txt(po.sales_order_code || '— (pack to stock)');
        case 'pcard.customer': return txt(po.customer_name);
        case 'pcard.target_end_date': return txt(d.targetEnd);
        case 'pcard.status': return txt(po.status);
        case 'pcard.materials_heading':
            return (po.materials || []).length ? { text: 'Bahan Kemasan / Packaging Materials:', empty: false } : NA;
        case 'pcard.notes': return txt(po.notes);
        case 'pcard.sign_line': return { text: '(________________)', empty: false };
        default: return NA;
    }
}

const PCARD_MATERIALS: RowSourceDef = {
    id: 'pcard_materials',
    label: 'Packaging materials (planned)',
    docTypes: [PACKING_CARD_DOC],
    seedColumns: ['no', 'item', 'planned', 'used'],
    columns: [
        { field: 'no', label: 'No' },
        { field: 'item', label: 'Bahan / Material (name + muted code)' },
        { field: 'item_name', label: 'Material name' },
        { field: 'item_code', label: 'Material code' },
        { field: 'planned', label: 'Rencana' },
        // Hand-filled on the floor — no data behind it on purpose.
        { field: 'used', label: 'Dipakai' },
    ],
    resolve: (ctx) => ({
        rows: (ctx.doc?.po?.materials || []).map((m: any, i: number) => ({
            _key: m.id ?? i,
            no: String(i + 1),
            item: { code: m.item_code || '', name: m.item_name || m.item_id || '' },
            item_name: m.item_name || m.item_id || '',
            item_code: m.item_code || '',
            planned: `${Number(m.qty_planned || 0).toLocaleString()} ${m.item_uom || ''}`.trim(),
            used: null,
        })),
    }),
};

/** No rows: the packing log is hand-filled, drawn as the table's padding rows. */
const PCARD_LOG: RowSourceDef = {
    id: 'pcard_log',
    label: 'Packing log (blank, hand-filled)',
    docTypes: [PACKING_CARD_DOC],
    seedColumns: ['date', 'qty', 'koli', 'lot', 'operator'],
    columns: [
        { field: 'date', label: 'Tanggal' },
        { field: 'qty', label: 'Qty' },
        { field: 'koli', label: 'Jml Koli' },
        { field: 'lot', label: 'Lot Asal' },
        { field: 'operator', label: 'Operator' },
    ],
    resolve: () => ({ rows: [] }),
};

export const PCARD_ROW_SOURCES: RowSourceDef[] = [PCARD_MATERIALS, PCARD_LOG];

export function buildPackingCardContext({
    po, attributes = [], companyName, companyLogoUrl, companyProfile, qrDataUrl, tzFormatCustom,
}: {
    po: any;
    attributes?: any[];
    companyName?: string;
    companyLogoUrl?: string;
    companyProfile?: any;
    qrDataUrl?: string;
    tzFormatCustom: (iso: string, opts: Intl.DateTimeFormatOptions, locale?: string) => string;
}): PrintContext {
    const p = po || {};
    // Base qty per alt selling unit (Pic = a roll, Pcs = a cut piece). Null when
    // the order has no alt unit.
    const altBaseFactor = orderBasePerAlt(p);
    const altCount = (base: any) => {
        const c = altBaseFactor ? baseToAlt(Number(base || 0), altBaseFactor) : null;
        return c ? c.toLocaleString() : '';
    };
    // Pieces per carton — the stated count where there is one, the stored weight
    // divided back out for an order made before it was stored.
    const boxSizeAlt = p.uom2 ? orderBoxSizeAlt(p, altBaseFactor) : null;
    const attrName = (vid: string) => {
        for (const a of attributes) { const v = a.values?.find((x: any) => x.id === vid); if (v) return v.value; }
        return '';
    };
    const fmt = (iso: any) => {
        if (!iso) return '';
        try { return tzFormatCustom(iso, { day: '2-digit', month: '2-digit', year: 'numeric' }, 'en-GB').replace(/\//g, '.'); } catch { return ''; }
    };

    return {
        workOrder: null,
        parentMO: null,
        doc: {
            po: p,
            item: `${p.item_name || ''} (${p.item_code || ''})`,
            variant: (p.attribute_value_ids || []).map(attrName).filter(Boolean).join(', '),
            // Both units: the packer counts in the selling unit the order was taken
            // in, while stock moves in the item's own.
            target: [
                `${Number(p.qty_target || 0).toLocaleString()} ${p.item_uom || ''}`,
                altCount(p.qty_target) ? `(${altCount(p.qty_target)} ${p.uom2})` : '',
            ].filter(Boolean).join(' '),
            // The count leads: it is the instruction the packer follows box by box;
            // the kilos are what the pieces weigh in theory.
            boxSize: boxSizeAlt
                ? `${boxSizeAlt.toLocaleString()} ${p.uom2}`
                  + (p.pack_size ? ` (± ${Number(p.pack_size).toLocaleString()} ${p.item_uom || ''})` : '')
                : (p.pack_size ? `${Number(p.pack_size).toLocaleString()} ${p.item_uom || ''}` : ''),
            // Which g/y the kilos were worked out from: the order's own sampling
            // when it has one, else the item master's estimate, said out loud.
            sampleWeight: uomIsKg(p.item_uom) && p.uom2
                ? (p.sample_weight_per_unit != null
                    ? `${Number(p.sample_weight_per_unit).toLocaleString()} ${p.sample_weight_unit || 'g/y'} (contoh order ini)`
                    : '— (estimasi master barang)')
                : '',
            sellingUnit: p.uom2
                ? `1 ${p.uom2} = ${Number(p.uom2_factor || 0)} ${p.uom2_length_uom || 'Yard'}`
                  + (altBaseFactor ? ` = ${altBaseFactor} ${p.item_uom || ''}` : '')
                : '',
            targetEnd: fmt(p.target_end_date),
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
