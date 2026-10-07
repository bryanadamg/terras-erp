/**
 * Surat Jalan (delivery note) — data side of the template: the fields and row
 * sources it offers, and the builder that shapes a shipment into the render
 * context. The layout lives in defaults/suratJalan.ts.
 *
 * The client's paper form is one row per item + colour + customer PO on the note,
 * with the per-carton breakdown in the Perincian band under it. Our pick-list
 * lines are carton-grain, so they are collapsed here, once, and both tables read
 * the same groups — the note's qty and the Perincian total can never disagree.
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import { txt, attrValueByRole, type PrintContext } from '../renderContext';
import { lotSizeText, lotComboLabel } from '../../LotChips';
import { qtyFmt } from '../../format';

export const SURAT_JALAN_DOC = 'surat_jalan';

/** Indonesian decimal comma, no trailing ",0" — the client's sheet reads "37" and "36,7". */
const num = qtyFmt(2, 'id-ID');

export const SJ_FIELDS: FieldDef[] = [
    { key: 'sj.number', label: 'Surat Jalan No', kind: 'text', group: 'Surat Jalan' },
    { key: 'sj.date', label: 'Tanggal', kind: 'date', group: 'Surat Jalan' },
    { key: 'sj.page', label: 'Hal (page)', kind: 'text', group: 'Surat Jalan' },
    { key: 'sj.shipment_code', label: 'Shipment Code', kind: 'text', mono: true, group: 'Surat Jalan' },
    { key: 'sj.notes', label: 'Catatan', kind: 'text', group: 'Surat Jalan' },
    { key: 'sj.prepared_by', label: 'Prepared By', kind: 'text', group: 'Surat Jalan' },

    { key: 'sj.customer_name', label: 'Customer (Kepada Yth)', kind: 'text', group: 'Customer' },
    { key: 'sj.customer_address', label: 'Customer Address', kind: 'text', group: 'Customer' },

    { key: 'sj.vehicle', label: 'Kendaraan No.', kind: 'text', group: 'Transport' },
    { key: 'sj.driver', label: 'Supir', kind: 'text', group: 'Transport' },
    { key: 'sj.carrier', label: 'Carrier', kind: 'text', group: 'Transport' },

    { key: 'sj.total_dus', label: 'Total Dus (cartons)', kind: 'number', group: 'Totals' },
    { key: 'sj.total_qty', label: 'Total Qty', kind: 'number', group: 'Totals' },
    { key: 'sj.total_brutto', label: 'Bruto (kg)', kind: 'number', unit: 'KG', group: 'Totals' },
    { key: 'sj.total_brutto_line', label: 'Bruto line ("Bruto : x KG")', kind: 'text', group: 'Totals' },
];

export function resolveSuratJalanField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    switch (key) {
        case 'sj.number': return txt(d.sjNo);
        case 'sj.date': return txt(d.date);
        case 'sj.page': return { text: '1', empty: false };
        case 'sj.shipment_code': return txt(d.shipmentCode);
        case 'sj.notes': return txt(d.notes);
        case 'sj.prepared_by': return txt(d.preparedBy);
        case 'sj.customer_name': return txt(d.customerName);
        case 'sj.customer_address': return txt(d.customerAddress);
        case 'sj.vehicle': return txt(d.vehicle);
        case 'sj.driver': return txt(d.driver);
        case 'sj.carrier': return txt(d.carrier);
        case 'sj.total_dus': return { text: String(d.totalDus ?? 0), empty: false };
        case 'sj.total_qty': return { text: num(d.totalQty ?? 0), empty: false };
        case 'sj.total_brutto':
            return d.totalBrutto > 0 ? { text: num(d.totalBrutto), empty: false } : { text: '—', empty: true };
        case 'sj.total_brutto_line':
            // Carriers bill on this; blank rather than "Bruto : 0 KG" when no carton carries a weight.
            return d.totalBrutto > 0 ? { text: `Bruto : ${num(d.totalBrutto)} KG`, empty: false } : { text: '', empty: true };
        default:
            return { text: '', empty: true };
    }
}

const warna = (g: any) => (g.colorCode ? `${g.colorName || ''} ( ${g.colorCode} )`.trim() : g.colorName || '');

const SJ_LINES: RowSourceDef = {
    id: 'sj_lines',
    label: 'Delivery lines (one per item + colour + PO)',
    docTypes: [SURAT_JALAN_DOC],
    seedColumns: ['qty', 'unit', 'item_name'],
    columns: [
        { field: 'qty', label: 'QTY' },
        { field: 'unit', label: 'Unit' },
        { field: 'item_name', label: 'NAMA BARANG' },
        { field: 'size', label: 'SIZE' },
        { field: 'combo', label: 'COMBO' },
        { field: 'warna', label: 'WARNA' },
        { field: 'color_name', label: 'Colour' },
        { field: 'color_code', label: 'Colour Code' },
        { field: 'po_ref', label: 'NO PO' },
        // Filled in by hand on receipt (over/short marks) — no data behind it on purpose.
        { field: 'no_ref', label: 'NO REF' },
        { field: 'cartons', label: 'Dus' },
    ],
    resolve: (ctx) => ({
        rows: (ctx.doc?.groups || []).map((g: any) => ({
            _key: g.key,
            qty: num(g.qty),
            unit: g.uom,
            item_name: g.itemName,
            size: g.size,
            combo: g.combo,
            warna: warna(g),
            color_name: g.colorName,
            color_code: g.colorCode,
            po_ref: g.poRef,
            no_ref: null,
            cartons: g.cartons.length ? String(g.cartons.length) : '',
        })),
    }),
};

const CARTON_FIELD = /^carton_\d+$/;
const MAX_CARTON_SLOTS = 12;

/**
 * Perincian: each group's cartons spread across the slot columns, spilling onto
 * continuation rows. The row width is however many slot columns the band has, and
 * values go to those columns in the order they are placed — so deleting a slot
 * column narrows the grid instead of silently dropping the cartons it held.
 */
const SJ_CARTONS: RowSourceDef = {
    id: 'sj_cartons',
    label: 'Carton breakdown (Perincian)',
    docTypes: [SURAT_JALAN_DOC],
    seedColumns: ['name', 'carton_1', 'carton_2', 'carton_3', 'carton_4', 'dus', 'total'],
    columns: [
        { field: 'name', label: 'Nama Barang :' },
        ...Array.from({ length: MAX_CARTON_SLOTS }, (_, i) => ({ field: `carton_${i + 1}`, label: '' })),
        { field: 'dus', label: 'Dus' },
        { field: 'total', label: 'Total' },
    ],
    resolve: (ctx, band) => {
        const placed = band ? band.columns.map(c => c.field).filter(f => CARTON_FIELD.test(f)) : [];
        const slots = placed.length ? placed : Array.from({ length: 8 }, (_, i) => `carton_${i + 1}`);
        const rows: Record<string, any>[] = [];
        for (const g of (ctx.doc?.groups || [])) {
            for (let i = 0; i < Math.max(1, g.cartons.length); i += slots.length) {
                const first = i === 0;
                const row: Record<string, any> = {
                    _key: `${g.key}:${i}`,
                    name: first ? [g.itemName, g.size, g.combo, g.colorName].filter(Boolean).join(' ') : '',
                    dus: first ? (g.cartons.length ? String(g.cartons.length) : '') : '',
                    total: first ? num(g.qty) : '',
                };
                g.cartons.slice(i, i + slots.length).forEach((q: number, k: number) => { row[slots[k]] = num(q); });
                rows.push(row);
            }
        }
        return { rows };
    },
};

export const SJ_ROW_SOURCES: RowSourceDef[] = [SJ_LINES, SJ_CARTONS];

export interface SuratJalanOverrides {
    /** Prints on this note only — the shipment keeps its series number. */
    sjNo?: string;
    vehicle?: string;
    driver?: string;
    carrier?: string;
    notes?: string;
    dateIso?: string;
    preparedBy?: string;
}

export interface BuildSuratJalanArgs {
    shipment: any;
    itemIndex?: Record<string, any> | null;
    attributes?: any[];
    customerAddr: (customerName: string) => string;
    companyName?: string;
    companyLogoUrl?: string;
    companyProfile?: any;
    tzFormatCustom: (iso: string, opts: Intl.DateTimeFormatOptions, locale?: string) => string;
    /** The print form's in-progress edits, which win over the saved shipment. */
    overrides?: SuratJalanOverrides;
}

export function buildSuratJalanContext({
    shipment, itemIndex, attributes = [], customerAddr, companyName, companyLogoUrl, companyProfile, tzFormatCustom,
    overrides = {},
}: BuildSuratJalanArgs): PrintContext {
    const shp = shipment || {};
    const attrName = (vid: string) => {
        for (const attr of attributes) { const v = attr.values?.find((x: any) => x.id === vid); if (v) return v.value; }
        return '';
    };
    const fmtDate = (d: any) => {
        if (!d) return '';
        try { return tzFormatCustom(d, { day: '2-digit', month: 'short', year: 'numeric' }, 'en-GB').replace(/ /g, '-'); }
        catch { return ''; }
    };

    // One flat carton list across every pick list on the shipment, each line tagged
    // with the customer PO it shipped against — the note's NO PO column.
    const lines: any[] = (shp.pick_lists || []).flatMap((pl: any) =>
        (pl.lines || []).map((l: any) => ({ ...l, po_ref: pl.customer_po_ref || pl.sales_order_code || '' })));

    // Two orders for the same shade are two rows on the note, so the PO is in the key;
    // so are two sizes, which ship as separate quantities.
    const map = new Map<string, any>();
    for (const l of lines) {
        const itemName = l.item_name || itemIndex?.[String(l.item_id)]?.name || l.item_id;
        const colorName = l.color_name
            || (l.attribute_value_ids || []).map((vid: string) => attrName(vid)).filter(Boolean).join(' / ');
        const size = lotSizeText(l) || '';
        const combo = lotComboLabel(l.carton_identity || {})
            || attrValueByRole(attributes, l.attribute_value_ids)('combo');
        const key = `${l.item_id}|${size}|${combo}|${colorName}|${l.color_code || ''}|${l.po_ref || ''}`;
        let g = map.get(key);
        if (!g) {
            g = {
                key, itemName, size, combo, colorName, colorCode: l.color_code || '', poRef: l.po_ref || '',
                uom: l.item_uom || itemIndex?.[String(l.item_id)]?.uom || '', qty: 0, cartons: [] as number[],
            };
            map.set(key, g);
        }
        const q = Number(l.qty_picked) || 0;
        g.qty += q;
        // Bulk ship lines carry no carton, so they add qty without a Dus tally.
        if (l.batch_number) g.cartons.push(q);
    }
    const groups = Array.from(map.values());

    const customerName = shp.customer_name || '';
    const doc = {
        sjNo: (overrides.sjNo || '').trim() || shp.delivery_note_number || shp.code,
        shipmentCode: shp.code,
        date: fmtDate(overrides.dateIso || shp.delivery_date || shp.dispatched_at || shp.staged_at),
        vehicle: (overrides.vehicle ?? shp.vehicle_plate) || '',
        driver: (overrides.driver ?? shp.driver) || '',
        carrier: (overrides.carrier ?? shp.carrier) || '',
        notes: (overrides.notes ?? shp.notes) || '',
        preparedBy: overrides.preparedBy || '',
        customerName,
        customerAddress: customerName ? customerAddr(customerName) : '',
        groups,
        totalQty: groups.reduce((s, g) => s + g.qty, 0),
        totalDus: groups.reduce((s, g) => s + g.cartons.length, 0),
        // Carton net + empty-box tare, both snapshotted at pack time; bulk lines add nothing.
        totalBrutto: lines.reduce((s, l) => s + (Number(l.gross_weight_kg) || 0), 0),
    };

    return {
        workOrder: null,
        parentMO: null,
        doc,
        companyName,
        companyLogoUrl,
        companyProfile,
        printDate: new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        formatDate: (iso: string) => fmtDate(iso),
        moAttributeValue: () => '',
    };
}
