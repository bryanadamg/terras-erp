/**
 * Output-unit labels — the A6 sticker on each bag (`bag_label`) or warp beam
 * (`beam_label`) off a machine. Layouts: defaults/outputLabel.ts.
 *
 * One record = one MOCompletion: each unit is one completion and one output lot,
 * so the lot number IS the unit's identity. The QR and the Code 128 both encode
 * that lot number (never the WO id) — it is the string `GET /batches/resolve`
 * takes, so staging, consumption and the loom's mount scan all read the label.
 *
 * Bag and beam share this field set (and so the `outlabel.` prefix); they differ
 * only in what their default layouts put on the sticker.
 */

import JsBarcode from 'jsbarcode';
import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import type { PrintContext } from '../renderContext';
import { lotSizeLabel } from '../../LotChips';

export const BAG_LABEL_DOC = 'bag_label';
export const BEAM_LABEL_DOC = 'beam_label';

export const OUTLABEL_FIELDS: FieldDef[] = [
    { key: 'outlabel.lot_no', label: 'Lot Number', kind: 'text', mono: true, group: 'Lot' },
    { key: 'outlabel.qr', label: 'QR Code (lot number)', kind: 'qr', group: 'Lot' },
    { key: 'outlabel.barcode', label: 'Barcode (Code 128, lot number)', kind: 'image', group: 'Lot' },
    { key: 'outlabel.weight', label: 'Berat (live lot kg)', kind: 'number', unit: 'kg', group: 'Lot' },
    { key: 'outlabel.bag_seq', label: 'Bag No. (#)', kind: 'text', group: 'Lot' },
    { key: 'outlabel.ends', label: 'Warp Ends (utas)', kind: 'number', group: 'Lot' },
    { key: 'outlabel.date', label: 'Production Date', kind: 'date', group: 'Lot' },
    { key: 'outlabel.notes', label: 'Catatan (operator note)', kind: 'text', group: 'Lot' },
    { key: 'outlabel.item_name', label: 'Artikel', kind: 'text', group: 'Identity' },
    { key: 'outlabel.size', label: 'Size / Ukuran', kind: 'text', group: 'Identity' },
    { key: 'outlabel.color', label: 'Warna', kind: 'text', group: 'Identity' },
    { key: 'outlabel.width', label: 'Lebar (mesin)', kind: 'number', unit: 'cm', group: 'Identity' },
    { key: 'outlabel.machine', label: 'No. Mesin', kind: 'text', group: 'Identity' },
    { key: 'outlabel.operator', label: 'Operator', kind: 'text', group: 'Identity' },
    { key: 'outlabel.wo_code', label: 'SPK / WO Code', kind: 'text', mono: true, group: 'Identity' },
    { key: 'outlabel.mo_code', label: 'MO Code', kind: 'text', mono: true, group: 'Identity' },
    { key: 'outlabel.putaway', label: 'Simpan di Rak', kind: 'text', group: 'Identity' },
    { key: 'outlabel.footer_trace', label: 'Traceability Footer (MO + Lot ID)', kind: 'text', group: 'Identity' },
];

const EM_DASH = '—';

function txt(v: any): ResolvedField {
    const s = v == null || v === '' ? '' : String(v);
    return { text: s || EM_DASH, empty: s === '' };
}

export function resolveOutputLabelField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    switch (key) {
        case 'outlabel.lot_no': return txt(d.lotNo);
        case 'outlabel.qr': return { text: '', empty: !ctx.qrDataUrl, qrDataUrl: ctx.qrDataUrl };
        case 'outlabel.barcode': return { text: '', empty: !d.barcodeDataUrl, imageUrl: d.barcodeDataUrl || undefined };
        case 'outlabel.weight':
            return d.weight > 0 ? { text: Number(d.weight).toFixed(2), empty: false } : { text: EM_DASH, empty: true };
        case 'outlabel.bag_seq': return d.bagSeq == null ? { text: EM_DASH, empty: true } : { text: `#${d.bagSeq}`, empty: false };
        case 'outlabel.ends': return txt(d.ends);
        case 'outlabel.date': return txt(d.date);
        case 'outlabel.notes': return txt(d.notes);
        case 'outlabel.item_name': return txt(d.itemName);
        case 'outlabel.size': return txt(d.size);
        case 'outlabel.color': return txt(d.color);
        case 'outlabel.width': return txt(d.width);
        case 'outlabel.machine': return txt(d.machine);
        case 'outlabel.operator': return txt(d.operator);
        case 'outlabel.wo_code': return txt(d.woCode);
        case 'outlabel.mo_code': return txt(d.moCode);
        case 'outlabel.putaway': return txt(d.putaway);
        case 'outlabel.footer_trace': return { text: `${d.moCode || ''}\nLot ID: ${d.lotId || ''}`, empty: false };
        default: return { text: '', empty: true };
    }
}

/**
 * "Komponen Terpakai" — the completion's own `actual_items`, i.e. what went into
 * THIS unit, substitutes included. The SUB mark is derived: an actual item absent
 * from the MO's BOM lines and creation-time snapshot was not planned. What it
 * stood in for is not recoverable (mo_completion_items has no orig_item_id).
 */
const OUTLABEL_COMPONENTS: RowSourceDef = {
    id: 'outlabel_components',
    label: 'Components used (this unit)',
    docTypes: [BAG_LABEL_DOC, BEAM_LABEL_DOC],
    seedColumns: ['item', 'qty'],
    columns: [
        { field: 'item', label: 'Komponen' },
        { field: 'item_code', label: 'Item Code' },
        { field: 'item_name', label: 'Item Name' },
        { field: 'sub', label: 'SUB (not on BOM)' },
        { field: 'qty', label: 'Qty', numeric: true },
    ],
    resolve: (ctx) => ({
        rows: (ctx.doc?.components || []).map((r: any, i: number) => ({
            _key: r.id || r.item_id || i,
            // No boxed tag in a table cell — the SUB mark rides on the name.
            item: { code: r.item_code || '', name: `${r.item_name || r.item_code || r.item_id}${r.isSub ? '  [SUB]' : ''}` },
            item_code: r.item_code || '',
            item_name: r.item_name || '',
            sub: r.isSub ? 'SUB' : '',
            qty: r.qty > 0 ? r.qty : null,
        })),
    }),
};

export const OUTLABEL_ROW_SOURCES: RowSourceDef[] = [OUTLABEL_COMPONENTS];

// Code 128 (1D) so the factory's laser scanners read the lot too — not everyone
// has a phone/2D imager. Same payload as the QR. Synchronous, so the designer
// preview gets a real one without a fetch.
export function makeLotBarcodeDataUrl(text: string): string {
    if (!text || typeof document === 'undefined') return '';
    try {
        const canvas = document.createElement('canvas');
        JsBarcode(canvas, text, { format: 'CODE128', displayValue: false, margin: 0, height: 70, width: 2 });
        return canvas.toDataURL('image/png');
    } catch {
        return '';
    }
}

const DMY: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

/**
 * Which label a completion gets. Read off the lot's own `BM-` prefix first: a
 * reprint from the Lot page may hand over a WO that is null or stale, and the lot
 * number is always present and always right (prefixes: BM / GRG / DYE / SET / LOT).
 */
export function isBeamLot(completion: any, workOrder?: any): boolean {
    return /^BM[-_]/i.test(String(completion?.output_batch_number || ''))
        || String(workOrder?.work_center_type || '').toUpperCase() === 'BEAMING';
}

export function buildOutputLabelContext({
    completion, workOrder, parentMO, bagSeq, lotRemaining, qrDataUrl, barcodeDataUrl, attributes = [],
    companyName, companyLogoUrl, companyProfile, tzFormatCustom,
}: {
    completion: any;
    workOrder: any;
    parentMO: any;
    bagSeq?: number | null;
    /** Live StockBalance kg of the lot (see /batches/resolve); null = unresolved. */
    lotRemaining?: number | null;
    qrDataUrl?: string;
    /** Generated here from the lot number when omitted. */
    barcodeDataUrl?: string;
    attributes?: any[];
    companyName?: string;
    companyLogoUrl?: string;
    companyProfile?: any;
    tzFormatCustom: (iso: string, opts: Intl.DateTimeFormatOptions, locale?: string) => string;
}): PrintContext {
    const c = completion || {};
    const wo = workOrder || {};
    const mo = parentMO || {};
    const lotNo = c.output_batch_number || '';

    // WARNA — the system Colors attribute value the MO carries.
    const colorAttr = attributes.find((a: any) => (a.system_role || '').toLowerCase() === 'color');
    const moValueIds: string[] = mo.attribute_value_ids || [];
    const color = colorAttr?.values?.find((v: any) => moValueIds.includes(v.id))?.value || '';

    // Planned item ids — BOM lines, plus the creation-time snapshot so a BOM edited
    // after the fact doesn't retro-flag every row as SUB.
    const plannedIds = new Set<string>([
        ...(mo.bom?.lines || []).map((l: any) => String(l.item_id)),
        ...(mo.planned_components || []).map((p: any) => String(p.item_id)),
    ]);

    // The operator's remark: the lot's own clean copy, else the completion note with
    // the machine-appended "[Greige GRG-…]" / "[Beam BM-…]" brackets stripped.
    const rawNote: string = c.output_batch_notes || c.notes || '';

    return {
        workOrder: null,
        parentMO: null,
        doc: {
            lotNo,
            lotId: c.output_batch_id || c.id || '',
            barcodeDataUrl: barcodeDataUrl ?? makeLotBarcodeDataUrl(lotNo || String(c.id || '')),
            // BERAT is the lot's CURRENT weight: `qty_completed` is frozen at the
            // completion, so a split or partly staged unit kept printing its birth kg.
            weight: Number(lotRemaining ?? c.qty_completed ?? 0),
            bagSeq: bagSeq ?? null,
            // Per-WO planned ends, falling back to the beam item's own — the same
            // precedence add_mo_completion stamps onto the lot.
            ends: wo.ends ?? mo.item?.ends ?? null,
            date: tzFormatCustom(c.created_at || new Date().toISOString(), DMY, 'id-ID'),
            notes: rawNote.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim(),
            itemName: mo.item_name || wo.item_name || '',
            // The MO's size is what add_mo_completion stamps onto the lot.
            size: lotSizeLabel(mo) || '',
            color,
            width: mo.bom?.mesin_lebar ?? null,
            machine: c.work_center_name || wo.work_center_name || '',
            operator: c.operator_name || '',
            woCode: wo.code || '',
            moCode: mo.code || '',
            putaway: mo.planned_putaway_location_name || '',
            components: (c.actual_items || []).map((r: any) => ({
                ...r, qty: Number(r.qty_used ?? 0), isSub: !plannedIds.has(String(r.item_id)),
            })),
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

/**
 * Designer preview records: every lotted, non-rejected completion across the MO
 * list (all_levels, so beam MOs are in it), with its MO, WO and bag number riding
 * along. `beams` picks which kind.
 */
export function outputLabelSampleRecords(body: any, beams: boolean): any[] {
    const mos: any[] = body?.items ?? (body?.id ? [body] : []);
    const out: any[] = [];
    for (const mo of mos) {
        const lotted = (mo.completions || []).filter((c: any) => !c.rejected && c.output_batch_number);
        for (const c of lotted) {
            const wo = (mo.work_orders || []).find((w: any) => String(w.id) === String(c.work_order_id || '')) || null;
            if (isBeamLot(c, wo) !== beams) continue;
            const sameWo = lotted
                .filter((x: any) => String(x.work_order_id || '') === String(c.work_order_id || ''))
                .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
            out.push({ ...c, _mo: mo, _wo: wo, _seq: sameWo.indexOf(c) + 1 });
        }
    }
    return out;
}
