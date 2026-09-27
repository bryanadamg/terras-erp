/**
 * Field registry + resolver.
 *
 * This is the layer that replaces hardcoded reads like `parentMO?.item_name ||
 * workOrder.item_name` scattered through the old KartuKerjaCard*.tsx files. Each
 * doc type declares which fields are placeable; `resolveField` turns a field key
 * plus a render context into display text.
 *
 * Adding a field to what the client can drag onto a card = one entry in the
 * manifest + one case in the resolver. Nothing else changes.
 */

import type { PrintContext } from './renderContext';
import { SJ_FIELDS, SURAT_JALAN_DOC, resolveSuratJalanField } from './doctypes/suratJalan';
import { PO_FIELDS, PURCHASE_ORDER_DOC, resolvePurchaseOrderField } from './doctypes/purchaseOrder';
import { SO_FIELDS, SALES_ORDER_DOC, resolveSalesOrderField } from './doctypes/salesOrder';

export type FieldKind = 'text' | 'number' | 'date' | 'qr' | 'blank' | 'static' | 'image' | 'barcode';

export interface FieldDef {
    key: string;
    /** Default label. Overridable per placement. */
    label: string;
    kind: FieldKind;
    /** Rendered after the value in smaller, lighter type ("12 kg"). */
    unit?: string;
    /** Default to monospace (codes/IDs). */
    mono?: boolean;
    /** Grouping in the designer's field palette. */
    group?: string;
}

const EM_DASH = '—';

/**
 * Letterhead fields every document can place. `__text` prints the placement's own
 * `text` — titles, captions and boilerplate sentences are layout, not data.
 */
export const DOC_CHROME_FIELDS: FieldDef[] = [
    { key: 'company.name', label: 'Company Name', kind: 'text', group: 'Document' },
    { key: 'company.logo', label: 'Company Logo', kind: 'image', group: 'Document' },
    { key: 'company.address', label: 'Company Address', kind: 'text', group: 'Document' },
    { key: 'company.phone', label: 'Company Phone', kind: 'text', group: 'Document' },
    { key: 'company.fax', label: 'Company Fax', kind: 'text', group: 'Document' },
    { key: 'company.phone_fax', label: 'Company Telp + Fax line', kind: 'text', group: 'Document' },
    { key: 'company.email', label: 'Company Email', kind: 'text', group: 'Document' },
    { key: 'print.date', label: 'Print Date', kind: 'date', group: 'Document' },
    { key: '__text', label: 'Text (type your own)', kind: 'static', group: 'Document' },
    { key: '__blank', label: 'Blank (hand fill-in)', kind: 'blank', group: 'Document' },
];

// ── Work Order card fields ─────────────────────────────────────────────────────
// Shared by all four kartu_kerja_* doc types: one manifest, four default layouts.
export const WO_CARD_FIELDS: FieldDef[] = [
    // Identity
    { key: 'wo.code', label: 'WO Code', kind: 'text', mono: true, group: 'Identity' },
    { key: 'wo.code_or_mo', label: 'WO Code (fall back to MO)', kind: 'text', mono: true, group: 'Identity' },
    { key: 'mo.code', label: 'MO Code', kind: 'text', mono: true, group: 'Identity' },
    { key: 'wo.name', label: 'Operation Name', kind: 'text', group: 'Identity' },
    { key: 'wo.step_label', label: 'Step No.', kind: 'text', group: 'Identity' },
    { key: 'wo.work_center_name', label: 'Work Center / Machine', kind: 'text', group: 'Identity' },
    { key: 'wo.status', label: 'Status', kind: 'text', group: 'Identity' },
    { key: 'mo.item_name', label: 'Product / Artikel', kind: 'text', group: 'Identity' },

    // Quantities
    { key: 'wo.qty', label: 'Qty', kind: 'number', unit: 'kg', group: 'Quantity' },
    { key: 'wo.ends', label: 'Warp Ends', kind: 'number', unit: 'utas', group: 'Quantity' },
    { key: 'wo.qty_completed', label: 'Qty Logged', kind: 'number', unit: 'kg', group: 'Quantity' },
    { key: 'wo.qty_remaining', label: 'Qty Remaining', kind: 'number', unit: 'kg', group: 'Quantity' },

    // Routing / destination
    { key: 'wo.target_end_date', label: 'Target Selesai', kind: 'date', group: 'Routing' },
    { key: 'wo.next_destination', label: 'Tujuan', kind: 'text', group: 'Routing' },
    { key: 'mo.putaway_location', label: 'Simpan di Rak', kind: 'text', group: 'Routing' },
    { key: 'wo.recipe_status', label: 'Recipe', kind: 'text', group: 'Routing' },

    // Variant / spec (from the MO's attributes and the BOM)
    { key: 'attr.color', label: 'Warna', kind: 'text', group: 'Spec' },
    { key: 'attr.combo', label: 'Combo', kind: 'text', group: 'Spec' },
    { key: 'bom.mesin_lebar', label: 'Lebar (mesin)', kind: 'number', unit: 'cm', group: 'Spec' },
    { key: 'bom.mesin_panjang_tarikan', label: 'Tarikan Sblm Celup/Setting', kind: 'number', group: 'Spec' },
    { key: 'bom.celup_panjang_tarikan', label: 'Tarikan Ssdh Celup/Setting', kind: 'number', group: 'Spec' },
    { key: 'bom.kerapatan_picks', label: 'Kerapatan (picks)', kind: 'number', group: 'Spec' },
    { key: 'bom.sisir_no', label: 'Sisir No.', kind: 'text', group: 'Spec' },

    // Dyeing bath (the WO's DyeingRun — empty on every other work centre type)
    { key: 'dye.bath_volume', label: 'Volume Air', kind: 'number', unit: 'L', group: 'Dyeing' },
    { key: 'dye.liquor_ratio', label: 'Perbandingan Larutan', kind: 'text', group: 'Dyeing' },
    { key: 'dye.substrate_qty', label: 'Substrat (run)', kind: 'number', unit: 'kg', group: 'Dyeing' },
    { key: 'dye.recipe_name', label: 'Resep Celup', kind: 'text', group: 'Dyeing' },
    { key: 'dye.run_label', label: 'Run No.', kind: 'text', group: 'Dyeing' },

    // Document chrome
    { key: 'company.name', label: 'Company Name', kind: 'text', group: 'Document' },
    { key: 'print.date', label: 'Print Date', kind: 'date', group: 'Document' },
    { key: 'print.department', label: 'Department', kind: 'text', group: 'Document' },
    { key: 'print.date_department', label: 'Print Date + Department', kind: 'text', group: 'Document' },
    { key: 'wo.footer_trace', label: 'Traceability Footer (code + ID)', kind: 'text', group: 'Document' },
    { key: 'wo.qr', label: 'QR Code (scan to log)', kind: 'qr', group: 'Document' },
    { key: '__blank', label: 'Blank (hand fill-in)', kind: 'blank', group: 'Document' },
    // No company.logo: the Kartu Kerja print path carries no logo URL, so a placed
    // logo would show in the designer and vanish on paper.
    { key: '__text', label: 'Text (type your own)', kind: 'static', group: 'Document' },
];

/** Field manifest per doc type. */
export const FIELD_MANIFESTS: Record<string, FieldDef[]> = {
    kartu_kerja_weaving: WO_CARD_FIELDS,
    kartu_kerja_beaming: WO_CARD_FIELDS,
    kartu_kerja_dyeing: WO_CARD_FIELDS,
    kartu_kerja_general: WO_CARD_FIELDS,
    [SURAT_JALAN_DOC]: [...SJ_FIELDS, ...DOC_CHROME_FIELDS],
    [PURCHASE_ORDER_DOC]: [...PO_FIELDS, ...DOC_CHROME_FIELDS],
    [SALES_ORDER_DOC]: [...SO_FIELDS, ...DOC_CHROME_FIELDS],
};

export function fieldDef(docType: string, key: string): FieldDef | undefined {
    return (FIELD_MANIFESTS[docType] || []).find(f => f.key === key);
}

/** Resolved field value. `empty` drives `hideWhenEmpty` on conditional rows. */
export interface ResolvedField {
    text: string;
    empty: boolean;
    /** Data URL for `qr` fields. */
    qrDataUrl?: string;
    /** URL for `image` fields. */
    imageUrl?: string;
    /** Label the value suggests for itself ("VAT 11%"), used by a row labelled '{auto}'. */
    label?: string;
}

function txt(v: any): ResolvedField {
    const s = v == null || v === '' ? '' : String(v);
    return { text: s || EM_DASH, empty: s === '' };
}

function num(v: any): ResolvedField {
    if (v == null || v === '' || Number.isNaN(Number(v))) return { text: EM_DASH, empty: true };
    return { text: String(v), empty: false };
}

/**
 * Resolve one field key against the render context.
 *
 * Fallback chains here are lifted verbatim from the old cards so the default
 * layouts reproduce today's output — e.g. weaving's header code fell back from
 * WO code to MO code, while dyeing/general led with the MO code.
 */
export function resolveField(key: string, ctx: PrintContext): ResolvedField {
    const wo = ctx.workOrder || {};
    const mo = ctx.parentMO || {};
    const bom = mo.bom || {};

    switch (key) {
        case 'wo.code':
            return txt(wo.code);
        case 'wo.code_or_mo':
            return txt(wo.code || mo.code);
        case 'mo.code':
            return txt(mo.code || wo.mo_code);
        case 'wo.name':
            return txt(wo.name);
        case 'wo.step_label':
            return wo.sequence == null ? { text: '', empty: true } : { text: `Step ${wo.sequence}`, empty: false };
        case 'wo.work_center_name':
            return txt(wo.work_center_name);
        case 'wo.status':
            return txt(wo.status);
        case 'mo.item_name':
            return txt(mo.item_name || wo.item_name);

        case 'wo.qty': {
            const q = Number(wo.qty ?? 0);
            return q > 0 ? { text: String(wo.qty), empty: false } : { text: EM_DASH, empty: true };
        }
        case 'wo.ends':
            return num(wo.ends);
        case 'wo.qty_completed':
            return num(wo.qty_completed_total ?? 0);
        case 'wo.qty_remaining': {
            const target = Number(wo.qty ?? 0);
            const done = Number(wo.qty_completed_total ?? 0);
            if (!(target > 0)) return { text: EM_DASH, empty: true };
            return { text: String(Math.max(0, target - done)), empty: false };
        }

        case 'wo.target_end_date':
            return wo.target_end_date
                ? { text: ctx.formatDate(wo.target_end_date), empty: false }
                : { text: EM_DASH, empty: true };
        case 'wo.next_destination': {
            const s = [wo.next_destination_work_center_name, wo.next_destination_location_name]
                .filter(Boolean).join(' — ');
            return { text: s || EM_DASH, empty: !s };
        }
        case 'mo.putaway_location':
            return txt(mo.planned_putaway_location_name);
        case 'wo.recipe_status':
            return wo.planned_recipe_id
                ? { text: 'Assigned', empty: false }
                : { text: EM_DASH, empty: true };

        // The bath is the run's, not the WO's: a multi-bath WO splits its load across
        // runs, so `wo.qty` is the whole order and only the run knows this vessel.
        // Actual bath once the floor filled one, the planner's until then — the same
        // `effective_bath_liters` the doses on this card were weighed from, so the
        // printed volume and the printed grams always agree.
        case 'dye.bath_volume':
            return num(ctx.dyeing?.run?.effective_bath_liters ?? ctx.dyeing?.run?.volume_air_liters);
        case 'dye.liquor_ratio': {
            const r = ctx.dyeing?.run?.liquor_ratio;
            return r == null ? { text: EM_DASH, empty: true } : { text: `1 : ${Number(r).toFixed(2)}`, empty: false };
        }
        case 'dye.substrate_qty':
            return num(ctx.dyeing?.run?.substrate_qty);
        case 'dye.recipe_name':
            return txt(ctx.dyeing?.run?.recipe_name);
        case 'dye.run_label': {
            const n = ctx.dyeing?.run?.run_number;
            return n == null ? { text: '', empty: true } : { text: `Run ${n}`, empty: false };
        }

        case 'attr.color':
            return txt(ctx.moAttributeValue('color'));
        case 'attr.combo':
            return txt(ctx.moAttributeValue('combo'));

        case 'bom.mesin_lebar':
            return num(bom.mesin_lebar);
        case 'bom.mesin_panjang_tarikan':
            return num(bom.mesin_panjang_tarikan);
        case 'bom.celup_panjang_tarikan':
            return num(bom.celup_panjang_tarikan);
        case 'bom.kerapatan_picks':
            return num(bom.kerapatan_picks);
        case 'bom.sisir_no':
            return txt(bom.sisir_no);

        case 'company.name':
            return txt(ctx.companyName);
        case 'print.date':
            return { text: ctx.printDate, empty: false };
        case 'print.department':
            return txt(ctx.department);
        case 'print.date_department':
            return {
                text: ctx.printDate + (ctx.department ? ` · ${ctx.department}` : ''),
                empty: false,
            };
        case 'wo.footer_trace':
            return {
                text: `${wo.code || `Step ${wo.sequence ?? ''}`}\nID: ${wo.id || ''}`,
                empty: false,
            };

        case 'wo.qr':
            return { text: '', empty: !ctx.qrDataUrl, qrDataUrl: ctx.qrDataUrl };

        case 'company.logo':
            return { text: '', empty: !ctx.companyLogoUrl, imageUrl: ctx.companyLogoUrl };
        case 'company.address':
            return txt(ctx.companyProfile?.address);
        case 'company.phone':
            return txt(ctx.companyProfile?.phone);
        case 'company.fax':
            return txt(ctx.companyProfile?.fax);
        case 'company.phone_fax': {
            const cp = ctx.companyProfile || {};
            return txt([cp.phone && `Telp: ${cp.phone}`, cp.fax && `FAX: ${cp.fax}`].filter(Boolean).join('  '));
        }
        case 'company.email':
            return txt(ctx.companyProfile?.email);

        case '__blank':
        case '__text':
            return { text: '', empty: false };

        default:
            if (key.startsWith('sj.')) return resolveSuratJalanField(key, ctx);
            if (key.startsWith('po.')) return resolvePurchaseOrderField(key, ctx);
            if (key.startsWith('so.')) return resolveSalesOrderField(key, ctx);
            // Unknown key: render nothing rather than crash the printout. Happens when
            // a saved layout references a field removed from the manifest.
            return { text: '', empty: true };
    }
}
