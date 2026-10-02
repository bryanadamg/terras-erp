/**
 * SPK Produksi (MO sheet) — data side of the template: fields, row sources, and the
 * builder that shapes a manufacturing order into the render context. Layout:
 * defaults/moSheet.ts.
 *
 * Prefix is `ms.`, not `mo.`: `mo.*` belongs to the Kartu Kerja WO fields.
 * Supervisory document — no QR field on purpose (QR codes live on the WO's
 * Kartu Kerja, never on an MO print).
 *
 * Several fields come in pairs that share one line of the identity grid. Each
 * half resolves empty only when the WHOLE line should drop, so a `hideWhenEmpty`
 * pair never leaves an orphan half that slides into the next line's slot.
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import { attrValueByRole, moShade, type PrintContext } from '../renderContext';
import { lotSizeLabel } from '../../LotChips';
import { STATIC_BASE } from '../../apiBase';

export const MO_SHEET_DOC = 'mo_sheet';

export const MS_FIELDS: FieldDef[] = [
    { key: 'ms.code', label: 'No. SPK (MO code)', kind: 'text', mono: true, group: 'Order' },
    { key: 'ms.article', label: 'Article (item)', kind: 'text', group: 'Order' },
    { key: 'ms.item_code', label: 'Item Code', kind: 'text', mono: true, group: 'Order' },
    { key: 'ms.size', label: 'Size / Ukuran', kind: 'text', group: 'Order' },
    { key: 'ms.color', label: 'Warna', kind: 'text', group: 'Order' },
    { key: 'ms.color_code', label: 'Kode Warna (colour code)', kind: 'text', group: 'Order' },
    { key: 'ms.combo', label: 'Combo', kind: 'text', group: 'Order' },
    { key: 'ms.qty', label: 'Jml Order', kind: 'number', unit: 'pcs', group: 'Order' },
    { key: 'ms.status', label: 'Status', kind: 'text', group: 'Order' },
    { key: 'ms.output_location', label: 'Output Location', kind: 'text', group: 'Order' },
    { key: 'ms.target_start', label: 'Target Start', kind: 'date', group: 'Order' },
    { key: 'ms.target_end', label: 'Target End', kind: 'date', group: 'Order' },
    // Printed only when the order has started and "Actual Timeline" is ticked.
    { key: 'ms.actual_start', label: 'Actual Start (timeline ticked)', kind: 'date', group: 'Order' },
    { key: 'ms.actual_end', label: 'Actual End (timeline ticked)', kind: 'date', group: 'Order' },
    { key: 'ms.machine', label: 'No Mesin (BOM machine)', kind: 'text', group: 'Order' },
    { key: 'ms.tolerance', label: 'Toleransi (BOM wastage)', kind: 'text', group: 'Order' },

    { key: 'ms.sales_order', label: 'Sales Order (SO-linked orders)', kind: 'text', mono: true, group: 'Customer' },
    { key: 'ms.so_customer', label: 'Customer (beside Sales Order)', kind: 'text', group: 'Customer' },
    { key: 'ms.customer_no_so', label: 'Customer (orders without SO)', kind: 'text', group: 'Customer' },
    { key: 'ms.customer', label: 'Customer', kind: 'text', group: 'Customer' },

    { key: 'ms.berat_mateng', label: 'Berat Mateng', kind: 'text', group: 'Spesifikasi Teknis' },
    { key: 'ms.berat_mentah', label: 'Berat Mentah', kind: 'text', group: 'Spesifikasi Teknis' },
    { key: 'ms.lebar_mesin', label: 'Lebar Mesin', kind: 'text', group: 'Spesifikasi Teknis' },
    { key: 'ms.tarikan_mentah', label: 'Tarikan Mentah', kind: 'text', group: 'Spesifikasi Teknis' },
    { key: 'ms.p_tulisan', label: 'P. Tulisan', kind: 'text', group: 'Spesifikasi Teknis' },
    { key: 'ms.bandul_1kg', label: 'Bandul 1kg', kind: 'text', group: 'Spesifikasi Teknis' },
    { key: 'ms.kerapatan', label: 'Kerapatan', kind: 'text', group: 'Spesifikasi Teknis' },
    { key: 'ms.sisir_no', label: 'Sisir No.', kind: 'text', group: 'Spesifikasi Teknis' },
    { key: 'ms.pemakaian_obat', label: 'Pemakaian Obat', kind: 'text', group: 'Spesifikasi Teknis' },
    { key: 'ms.sample_photo', label: 'Sample Photo (BOM)', kind: 'image', group: 'Spesifikasi Teknis' },

    { key: 'ms.company_name_fallback', label: 'Company Name (when no logo)', kind: 'text', group: 'Header' },
    { key: 'ms.company_contact', label: 'Company Phone · Email', kind: 'text', group: 'Header' },
    { key: 'ms.print_date', label: 'Tanggal (print date)', kind: 'date', group: 'Header' },
    { key: 'ms.header_meta', label: 'Dept · Approved · Ref (typed at print)', kind: 'text', group: 'Header' },
    { key: 'ms.footer_ref', label: 'Footer "No. SPK: …"', kind: 'text', group: 'Footer' },
    { key: 'ms.printed_at', label: 'Printed date + time', kind: 'text', group: 'Footer' },
    // Both empty unless "ACC QC Signature" is ticked at print time.
    { key: 'ms.qc_line', label: 'ACC QC signing line (ticked at print)', kind: 'blank', group: 'Footer' },
    { key: 'ms.qc_caption', label: 'ACC QC caption (ticked at print)', kind: 'text', group: 'Footer' },
];

const EMPTY: ResolvedField = { text: '', empty: true };

function txt(v: any): ResolvedField {
    const s = v == null || v === '' ? '' : String(v);
    return { text: s || '—', empty: s === '' };
}

/** A value whose line prints: a dash when unset, but never empty (never hides the line). */
const present = (v: any): ResolvedField => ({ text: v == null || v === '' ? '—' : String(v), empty: false });

/** One half of a paired line: dash when only the partner is set, empty when neither is. */
function pair(v: any, partner: any, show: (x: any) => string): ResolvedField {
    if (v == null && partner == null) return EMPTY;
    return { text: v != null ? show(v) : '—', empty: false };
}

export function resolveMoSheetField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const mo = d.mo || {};
    const bom = d.bom || null;
    const b = bom || {};
    const actualShown = d.showTimeline && (mo.actual_start_date || mo.actual_end_date);
    switch (key) {
        case 'ms.code': return txt(mo.code);
        case 'ms.article': return txt(d.itemName);
        case 'ms.item_code': return txt(mo.item_code);
        case 'ms.size': return txt(lotSizeLabel(mo));
        // Paired on one line: empty only when the order carries no shade at all.
        case 'ms.color': return d.shade.name || d.shade.code ? present(d.shade.name) : EMPTY;
        case 'ms.color_code': return d.shade.name || d.shade.code ? present(d.shade.code) : EMPTY;
        case 'ms.combo': return txt(d.combo);
        case 'ms.qty': return mo.qty == null ? EMPTY : { text: String(mo.qty), empty: false };
        case 'ms.status': return txt(mo.status);
        case 'ms.output_location': return txt(d.outputLocation);
        // The caller's formatter prints '-' for a missing date, as the old sheet did.
        case 'ms.target_start': return txt(d.fmtDate(mo.target_start_date));
        case 'ms.target_end': return txt(d.fmtDate(mo.target_end_date));
        case 'ms.actual_start':
            return actualShown ? present(mo.actual_start_date ? d.fmtDate(mo.actual_start_date) : '') : EMPTY;
        case 'ms.actual_end':
            return actualShown ? present(mo.actual_end_date ? d.fmtDate(mo.actual_end_date) : '') : EMPTY;
        case 'ms.machine': return txt(b.work_center_name);
        case 'ms.tolerance': return txt(b.tolerance_percentage != null ? `±${b.tolerance_percentage}%` : '');

        case 'ms.sales_order': return mo.sales_order_id ? present(mo.sales_order_code) : EMPTY;
        case 'ms.so_customer': return mo.sales_order_id ? present(b.customer_name) : EMPTY;
        case 'ms.customer_no_so': return mo.sales_order_id ? EMPTY : txt(b.customer_name);
        case 'ms.customer': return txt(b.customer_name);

        case 'ms.berat_mateng': return pair(b.berat_bahan_mateng, b.berat_bahan_mentah_pelesan, v => `${v} gr/yard`);
        case 'ms.berat_mentah': return pair(b.berat_bahan_mentah_pelesan, b.berat_bahan_mateng, v => `${v} gr/yard`);
        case 'ms.lebar_mesin': return pair(b.mesin_lebar, b.mesin_panjang_tarikan, v => `${v} mm`);
        case 'ms.tarikan_mentah': return pair(b.mesin_panjang_tarikan, b.mesin_lebar, v => `${v} cm`);
        case 'ms.p_tulisan': return pair(b.mesin_panjang_tulisan, b.mesin_panjang_tarikan_bandul_1kg, v => `${v} cm`);
        case 'ms.bandul_1kg': return pair(b.mesin_panjang_tarikan_bandul_1kg, b.mesin_panjang_tulisan, v => `${v} cm`);
        case 'ms.kerapatan':
            return pair(b.kerapatan_picks, b.sisir_no, v => `${v} ${b.kerapatan_unit || '/cm'}`);
        case 'ms.sisir_no': return pair(b.sisir_no, b.kerapatan_picks, v => String(v));
        case 'ms.pemakaian_obat': return txt(b.pemakaian_obat);
        case 'ms.sample_photo': return { text: '', empty: !d.samplePhotoUrl, imageUrl: d.samplePhotoUrl };

        case 'ms.company_name_fallback': return ctx.companyLogoUrl ? EMPTY : txt(ctx.companyName);
        case 'ms.company_contact': {
            const cp = ctx.companyProfile || {};
            return txt([cp.phone, cp.email].filter(Boolean).join(' · '));
        }
        case 'ms.print_date': return txt(d.printDate);
        case 'ms.header_meta': return txt(d.headerMeta);
        case 'ms.footer_ref': return { text: `No. SPK: ${mo.code || ''}`, empty: false };
        case 'ms.printed_at': return txt(d.printedAt);
        case 'ms.qc_line': return d.showSignatureLine ? { text: '', empty: false } : EMPTY;
        case 'ms.qc_caption': return d.showSignatureLine ? txt('ACC QC') : EMPTY;
        default: return EMPTY;
    }
}

/**
 * BOM explosion as the old sheet printed it: each line scaled by its percentage
 * (or legacy absolute qty) and the BOM's wastage %, times the order qty, then the
 * line's own sub-BOM (looked up by item in the caller's BOM list) indented under it.
 */
function explode(d: any): Record<string, any>[] {
    const mo = d.mo || {};
    const rows: Record<string, any>[] = [];
    const walk = (lines: any[], level: number, parentQty: number, currentBOM: any) => {
        // ponytail: depth cap only guards a cyclic BOM; the old sheet had none.
        if (level > 12) return;
        for (const line of lines || []) {
            const subBOM = (d.boms || []).find((x: any) => x.item_id === line.item_id);
            let scaled = parseFloat(line.percentage) > 0
                ? (parentQty * parseFloat(line.percentage)) / 100
                : parentQty * parseFloat(line.qty || 0);
            const tol = parseFloat(currentBOM?.tolerance_percentage || 0);
            if (tol > 0) scaled *= 1 + tol / 100;
            const attrs = (line.attribute_value_ids || []).map(d.attrName).filter(Boolean);
            // The old sheet indented the qty cell 12px a level; ~5 spaces at this size.
            const indent = ' '.repeat(level * 5);
            const name = line.item_name || d.getItemName(line.item_id);
            rows.push({
                _key: `${level}:${rows.length}:${line.id}`,
                level,
                req_qty: `${indent}${(scaled * Number(mo.qty || 0)).toFixed(3)}`,
                item: {
                    code: `${level > 0 ? '↳ ' : ''}${line.item_code || d.getItemCode(line.item_id) || ''}`,
                    name: attrs.length ? `${name} [${attrs.join(', ')}]` : name,
                },
                item_code: line.item_code || d.getItemCode(line.item_id),
                item_name: name,
                attributes: attrs.join(', ') || null,
                source: d.getLocationName(line.source_location_id || mo.source_location_id || mo.location_id) || null,
            });
            if (subBOM?.lines) walk(subBOM.lines, level + 1, scaled, subBOM);
        }
    };
    walk(d.bom?.lines || [], 0, 1, d.bom);
    return rows;
}

const MS_MATERIALS: RowSourceDef = {
    id: 'ms_materials',
    label: 'Material (BOM explosion x order qty)',
    docTypes: [MO_SHEET_DOC],
    seedColumns: ['req_qty', 'item', 'source'],
    columns: [
        { field: 'req_qty', label: 'Req. Qty' },
        { field: 'item', label: 'Component (code + name)' },
        { field: 'item_code', label: 'Item Code' },
        { field: 'item_name', label: 'Item Name' },
        { field: 'attributes', label: 'Attributes' },
        { field: 'level', label: 'Level', numeric: true },
        { field: 'source', label: 'Source' },
    ],
    resolve: (ctx) => {
        const d = ctx.doc || {};
        if (!d.bom) return { rows: [{ _key: 'none', req_qty: '', item: 'No BOM found', source: '' }] };
        return { rows: explode(d) };
    },
};

const MS_CHILD_MOS: RowSourceDef = {
    id: 'ms_child_mos',
    label: 'Child Manufacturing Orders',
    docTypes: [MO_SHEET_DOC],
    seedColumns: ['summary'],
    columns: [
        { field: 'summary', label: 'Order (code, item, qty / loc / status / due)' },
        { field: 'code', label: 'MO Code' },
        { field: 'item_name', label: 'Item' },
        { field: 'qty', label: 'Qty', numeric: true },
        { field: 'location', label: 'Location' },
        { field: 'status', label: 'Status' },
        { field: 'due', label: 'Due' },
    ],
    resolve: (ctx) => {
        const d = ctx.doc || {};
        return {
            rows: (d.mo?.child_mos || []).map((c: any) => {
                const item = c.item_name || d.getItemName(c.item_id);
                const loc = d.getLocationName(c.location_id) || '';
                const due = d.fmtDate(c.target_end_date);
                return {
                    _key: c.id,
                    summary: { title: c.code, lines: [item, `Qty: ${c.qty} · Loc: ${loc} · Status: ${c.status} · Due: ${due}`] },
                    code: c.code, item_name: item, qty: c.qty, location: loc || null, status: c.status, due,
                };
            }),
        };
    },
};

export const MS_ROW_SOURCES: RowSourceDef[] = [MS_MATERIALS, MS_CHILD_MOS];

/** What the old sheet gated its optional sections on. */
export function moSheetPresence(mo: any, boms: any[] = []) {
    const b = (boms || []).find((x: any) => x.id === mo?.bom_id) || mo?.bom || null;
    return {
        tech: !!b && (
            b.berat_bahan_mateng != null || b.berat_bahan_mentah_pelesan != null ||
            b.mesin_lebar != null || b.mesin_panjang_tarikan != null ||
            b.mesin_panjang_tulisan != null || b.kerapatan_picks != null ||
            b.sisir_no != null || !!b.pemakaian_obat
        ),
        samplePhoto: !!b?.sample_photo_url,
    };
}

export interface MoSheetOverrides {
    headerDepartment?: string;
    headerApprovedBy?: string;
    headerReference?: string;
    showTimeline?: boolean;
    showSignatureLine?: boolean;
}

export function buildMoSheetContext({
    mo, boms = [], getItemName, getItemCode, getLocationName, getAttributeValueName, attributes = [],
    formatDate, tzFormatCustom, companyProfile, companyName, companyLogoUrl, overrides = {},
}: {
    mo: any;
    /** Explosion source. Empty = top-level lines only (the old "hide children" print). */
    boms?: any[];
    getItemName?: (id: any) => string;
    getItemCode?: (id: any) => string;
    getLocationName?: (id: any) => string;
    getAttributeValueName?: (id: any) => string;
    attributes?: any[];
    /** The MO page's formatter; else a short local date. */
    formatDate?: (d: any) => string;
    tzFormatCustom: (iso: string, opts: Intl.DateTimeFormatOptions, locale?: string) => string;
    companyProfile?: any;
    /** Already resolved: the typed header name, else the profile's. */
    companyName?: string;
    companyLogoUrl?: string;
    overrides?: MoSheetOverrides;
}): PrintContext {
    const m = mo || {};
    // The MO list's objects carry their own BOM; the page's BOM list wins as before.
    const bom = (boms || []).find((b: any) => b.id === m.bom_id) || m.bom || null;
    const attrName = getAttributeValueName || ((vid: string) => {
        for (const a of attributes) { const v = a.values?.find((x: any) => x.id === vid); if (v) return v.value; }
        return '';
    });
    const fmtDate = formatDate
        || ((v: any) => (v ? tzFormatCustom(v, { year: 'numeric', month: 'numeric', day: 'numeric' }) : '-'));
    const now = new Date().toISOString();
    const printDate = tzFormatCustom(now, { day: '2-digit', month: '2-digit', year: 'numeric' }, 'id-ID');
    const getName = getItemName || (() => '');
    const loc = getLocationName || (() => '');
    return {
        workOrder: null,
        parentMO: null,
        doc: {
            mo: m,
            bom,
            boms,
            attrName,
            fmtDate,
            getItemName: getName,
            getItemCode: getItemCode || (() => ''),
            getLocationName: loc,
            itemName: m.item_name || getName(m.item_id),
            shade: moShade(m, attrValueByRole(attributes, m.attribute_value_ids)),
            combo: attrValueByRole(attributes, m.attribute_value_ids)('combo'),
            outputLocation: loc(m.location_id),
            samplePhotoUrl: bom?.sample_photo_url ? `${STATIC_BASE}${bom.sample_photo_url}` : undefined,
            printDate,
            printedAt: tzFormatCustom(now, { dateStyle: 'short', timeStyle: 'short' }, 'id-ID'),
            headerMeta: [
                overrides.headerDepartment && `Dept: ${overrides.headerDepartment}`,
                overrides.headerApprovedBy && `Approved: ${overrides.headerApprovedBy}`,
                overrides.headerReference && `Ref: ${overrides.headerReference}`,
            ].filter(Boolean).join(' · '),
            showTimeline: !!overrides.showTimeline,
            showSignatureLine: !!overrides.showSignatureLine,
        },
        companyName,
        companyLogoUrl,
        companyProfile,
        printDate,
        formatDate: fmtDate,
        moAttributeValue: () => '',
    };
}
