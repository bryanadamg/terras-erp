/**
 * BOM sheet — data side of the template: fields, row sources, and the builder that
 * shapes a BOM into the render context. Layout: defaults/bomSheet.ts.
 *
 * Prefix is `bs.`, not `bom.`: `bom.*` belongs to the Kartu Kerja WO fields (the
 * card reads its MO's BOM), and dispatch is by prefix.
 *
 * Numbers are pre-formatted exactly as the old hand-built BOMPrintModal printed
 * them (2 decimals for measurements, 4 for weights) so any surface that places a
 * field prints the same string.
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import { txt, type PrintContext } from '../renderContext';
import { STATIC_BASE } from '../../apiBase';

export const BOM_SHEET_DOC = 'bom_sheet';

export const BS_FIELDS: FieldDef[] = [
    { key: 'bs.code', label: 'BOM Code', kind: 'text', mono: true, group: 'BOM' },
    { key: 'bs.item', label: 'Item (name + code)', kind: 'text', group: 'BOM' },
    { key: 'bs.item_name', label: 'Item Name', kind: 'text', group: 'BOM' },
    { key: 'bs.item_code', label: 'Item Code', kind: 'text', mono: true, group: 'BOM' },
    { key: 'bs.batch_output', label: 'Batch Output (qty + tolerance)', kind: 'text', group: 'BOM' },
    { key: 'bs.variant', label: 'Variant', kind: 'text', group: 'BOM' },
    // Paired with Variant: the old sheet printed Status only on the Variant line.
    { key: 'bs.status', label: 'Status (printed with Variant)', kind: 'text', group: 'BOM' },
    { key: 'bs.active', label: 'Status', kind: 'text', group: 'BOM' },
    // Customer / Machine share one line that prints when either is set.
    { key: 'bs.customer', label: 'Customer (line with Machine)', kind: 'text', group: 'BOM' },
    { key: 'bs.machine', label: 'Machine (line with Customer)', kind: 'text', group: 'BOM' },
    { key: 'bs.description', label: 'Description', kind: 'text', group: 'BOM' },
    { key: 'bs.component_count', label: 'Component count ("N komponen")', kind: 'text', group: 'BOM' },

    { key: 'bs.kerapatan', label: 'Kerapatan / Picks', kind: 'text', group: 'Detail Teknis' },
    { key: 'bs.sisir_no', label: 'Sisir No.', kind: 'text', group: 'Detail Teknis' },
    { key: 'bs.pemakaian_obat', label: 'Pemakaian Obat', kind: 'text', group: 'Detail Teknis' },
    { key: 'bs.sample_oleh', label: 'Sample Oleh', kind: 'text', group: 'Detail Teknis' },
    { key: 'bs.berat_mateng', label: 'Berat Mateng', kind: 'text', group: 'Detail Teknis' },
    { key: 'bs.berat_mentah', label: 'Berat Mentah (Pelesan)', kind: 'text', group: 'Detail Teknis' },

    { key: 'bs.sample_photo', label: 'Sample Photo', kind: 'image', group: 'Attachments' },
    { key: 'bs.design_image', label: 'Design / Rumusan (image file)', kind: 'image', group: 'Attachments' },
    { key: 'bs.design_pdf_note', label: 'Design / Rumusan (PDF file note)', kind: 'text', group: 'Attachments' },

    { key: 'bs.company_name_fallback', label: 'Company Name (when no logo)', kind: 'text', group: 'Header' },
    { key: 'bs.company_contact', label: 'Company Phone · Email', kind: 'text', group: 'Header' },
    { key: 'bs.print_date', label: 'Printed date (dd Mon yyyy)', kind: 'date', group: 'Header' },
    { key: 'bs.header_note', label: 'Print note (typed at print)', kind: 'text', group: 'Header' },
    { key: 'bs.footer_ref', label: 'Footer "BOM: … · Item: …"', kind: 'text', group: 'Footer' },
    { key: 'bs.printed_at', label: 'Printed date + time', kind: 'text', group: 'Footer' },
    // Both empty unless "Signature Line" is ticked at print time.
    { key: 'bs.signature_line', label: 'Signature line (ticked at print)', kind: 'blank', group: 'Footer' },
    { key: 'bs.signature_caption', label: 'Signature caption (ticked at print)', kind: 'text', group: 'Footer' },
];

const EMPTY: ResolvedField = { text: '', empty: true };

/** The old sheet's `fmt`: dash for nothing, else fixed decimals. */
function fmt(v: any, decimals = 2): string {
    if (v == null || v === '') return '—';
    return Number(v).toFixed(decimals);
}

export function resolveBomSheetField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const b = d.bom || {};
    switch (key) {
        case 'bs.code': return txt(b.code);
        case 'bs.item': return txt([b.item_name || b.item_code, b.item_code].filter(Boolean).join('   '));
        case 'bs.item_name': return txt(b.item_name || b.item_code);
        case 'bs.item_code': return txt(b.item_code);
        case 'bs.batch_output':
            return { text: `${fmt(b.qty, 2)} pcs${b.tolerance_percentage > 0 ? ` ±${b.tolerance_percentage}%` : ''}`, empty: false };
        case 'bs.variant': return txt(d.variant);
        case 'bs.status': return d.variant ? txt(b.active ? 'Active' : 'Inactive') : EMPTY;
        case 'bs.active': return txt(b.active ? 'Active' : 'Inactive');
        // Either set → both print (the unset one as a dash); neither → the line drops.
        case 'bs.customer':
        case 'bs.machine': {
            if (!b.customer_name && !b.work_center_name) return EMPTY;
            const v = key === 'bs.customer' ? b.customer_name : b.work_center_name;
            return { text: v || '—', empty: false };
        }
        case 'bs.description': return txt(b.description);
        case 'bs.component_count': return { text: `${(b.lines || []).length} komponen`, empty: false };

        case 'bs.kerapatan':
            return b.kerapatan_picks != null ? txt(`${b.kerapatan_picks} ${b.kerapatan_unit || '/cm'}`) : EMPTY;
        case 'bs.sisir_no': return txt(b.sisir_no);
        case 'bs.pemakaian_obat': return txt(b.pemakaian_obat);
        case 'bs.sample_oleh': return txt(b.pembuatan_sample_oleh);
        case 'bs.berat_mateng':
            return b.berat_bahan_mateng != null ? txt(`${fmt(b.berat_bahan_mateng, 4)} gr/yard`) : EMPTY;
        case 'bs.berat_mentah':
            return b.berat_bahan_mentah_pelesan != null ? txt(`${fmt(b.berat_bahan_mentah_pelesan, 4)} gr/yard`) : EMPTY;

        case 'bs.sample_photo':
            return { text: '', empty: !d.samplePhotoUrl, imageUrl: d.samplePhotoUrl };
        case 'bs.design_image':
            return { text: '', empty: !d.designImageUrl, imageUrl: d.designImageUrl };
        case 'bs.design_pdf_note':
            return d.designPdfName ? txt(`[Design file attached as PDF — see: ${d.designPdfName}]`) : EMPTY;

        case 'bs.company_name_fallback': return ctx.companyLogoUrl ? EMPTY : txt(ctx.companyName);
        case 'bs.company_contact': {
            const cp = ctx.companyProfile || {};
            return txt([cp.phone, cp.email].filter(Boolean).join(' · '));
        }
        case 'bs.print_date': return txt(d.printDate);
        case 'bs.header_note': return txt(d.headerNote);
        case 'bs.footer_ref': return { text: `BOM: ${b.code || ''} · Item: ${b.item_code || ''}`, empty: false };
        case 'bs.printed_at': return txt(d.printedAt);
        case 'bs.signature_line': return d.showSignatureLine ? { text: '', empty: false } : EMPTY;
        case 'bs.signature_caption': return d.showSignatureLine ? txt('Authorized Signature') : EMPTY;
        default: return EMPTY;
    }
}

const BS_LINES: RowSourceDef = {
    id: 'bs_lines',
    label: 'Components (BOM lines)',
    docTypes: [BOM_SHEET_DOC],
    seedColumns: ['no', 'item_code', 'item_name', 'percentage', 'attributes'],
    columns: [
        { field: 'no', label: '#' },
        { field: 'item', label: 'Item (code + name)' },
        { field: 'item_code', label: 'Kode' },
        { field: 'item_name', label: 'Nama Item' },
        { field: 'percentage', label: '%' },
        { field: 'percentage_value', label: '% (number)', numeric: true },
        { field: 'attributes', label: 'Atribut' },
    ],
    // Direct lines only, as the old sheet printed them: a sub-assembly is a line
    // here and prints on its own BOM sheet.
    resolve: (ctx) => ({
        rows: (ctx.doc?.bom?.lines || []).map((l: any, i: number) => ({
            _key: l.id ?? i,
            no: String(i + 1),
            item: { code: l.item_code, name: l.item_name },
            item_code: l.item_code,
            item_name: l.item_name,
            percentage: (l.percentage || 0) > 0 ? `${l.percentage}%` : null,
            percentage_value: l.percentage,
            attributes: (l.attribute_value_ids || []).map(ctx.doc.attrName).filter(Boolean).join(', ') || null,
        })),
    }),
};

const MEASUREMENT_ROWS: [string, string, string][] = [
    ['Lebar', 'lebar', 'mm'],
    ['P. Tulisan', 'panjang_tulisan', 'cm'],
    ['P. Tarikan', 'panjang_tarikan', 'cm'],
    ['Bandul 1kg', 'panjang_tarikan_bandul_1kg', 'cm'],
    ['Bandul 9kg', 'panjang_tarikan_bandul_9kg', 'cm'],
];

const BS_MEASUREMENTS: RowSourceDef = {
    id: 'bs_measurements',
    label: 'Pengukuran Bahan (machine vs dyed)',
    docTypes: [BOM_SHEET_DOC],
    seedColumns: ['ukuran', 'mesin', 'celup', 'unit'],
    columns: [
        { field: 'ukuran', label: 'Ukuran' },
        { field: 'mesin', label: 'Keluar Mesin', numeric: true },
        { field: 'celup', label: 'Celup / Setting', numeric: true },
        { field: 'unit', label: 'Sat.' },
    ],
    // No rows when the BOM has no measurement at all, so the band (and its title)
    // drops the way the old section did.
    resolve: (ctx) => {
        const b = ctx.doc?.bom || {};
        const any = MEASUREMENT_ROWS.some(([, k]) => b[`mesin_${k}`] != null || b[`celup_${k}`] != null);
        return {
            rows: any ? MEASUREMENT_ROWS.map(([label, k, unit]) => ({
                _key: k, ukuran: label, mesin: b[`mesin_${k}`], celup: b[`celup_${k}`], unit,
            })) : [],
        };
    },
};

const BS_SIZES: RowSourceDef = {
    id: 'bs_sizes',
    label: 'Size measurements',
    docTypes: [BOM_SHEET_DOC],
    seedColumns: ['size', 'target', 'min', 'max'],
    columns: [
        { field: 'size', label: 'Size' },
        { field: 'target', label: 'Target', numeric: true },
        { field: 'min', label: 'Min', numeric: true },
        { field: 'max', label: 'Max', numeric: true },
    ],
    resolve: (ctx) => {
        const b = ctx.doc?.bom || {};
        const sizes = (b.sizes || []).slice().sort((x: any, y: any) => (x.sort_order ?? 0) - (y.sort_order ?? 0));
        return {
            autoTitle: b.size_mode === 'free' ? 'Measurements' : 'Size Measurements',
            rows: sizes.map((s: any, i: number) => ({
                _key: s.id ?? i,
                size: s.size_name || s.label || `Row ${i + 1}`,
                target: s.target_measurement,
                min: s.measurement_min,
                max: s.measurement_max,
            })),
        };
    },
};

export const BS_ROW_SOURCES: RowSourceDef[] = [BS_LINES, BS_MEASUREMENTS, BS_SIZES];

/** What the old sheet gated its sections on — the modal disables toggles with it. */
export function bomSheetPresence(bom: any) {
    const b = bom || {};
    return {
        teknis: b.kerapatan_picks != null || b.sisir_no != null || !!b.pemakaian_obat || !!b.pembuatan_sample_oleh
            || b.berat_bahan_mateng != null || b.berat_bahan_mentah_pelesan != null,
        measurements: MEASUREMENT_ROWS.some(([, k]) => b[`mesin_${k}`] != null || b[`celup_${k}`] != null),
        sizes: (b.sizes || []).length > 0,
        components: (b.lines || []).length > 0,
        samplePhoto: !!b.sample_photo_url,
        designFile: !!b.design_file_url && /\.(jpg|jpeg|png|gif|webp|pdf)$/i.test(b.design_file_url),
        designPdf: !!b.design_file_url && /\.pdf$/i.test(b.design_file_url),
    };
}

export interface BomSheetOverrides {
    headerNote?: string;
    showSignatureLine?: boolean;
}

export function buildBomSheetContext({
    bom, getAttributeValueName, attributes = [], companyProfile, companyName, companyLogoUrl,
    tzFormatCustom, overrides = {},
}: {
    bom: any;
    /** The caller's resolver; else looked up in `attributes`. */
    getAttributeValueName?: (id: string) => string;
    attributes?: any[];
    companyProfile?: any;
    companyName?: string;
    companyLogoUrl?: string;
    tzFormatCustom: (iso: string, opts: Intl.DateTimeFormatOptions, locale?: string) => string;
    overrides?: BomSheetOverrides;
}): PrintContext {
    const b = bom || {};
    const attrName = getAttributeValueName || ((vid: string) => {
        for (const a of attributes) { const v = a.values?.find((x: any) => x.id === vid); if (v) return v.value; }
        return '';
    });
    const file = b.design_file_url as string | undefined;
    const now = new Date().toISOString();
    const printDate = tzFormatCustom(now, { day: '2-digit', month: 'short', year: 'numeric' }, 'id-ID');
    return {
        workOrder: null,
        parentMO: null,
        doc: {
            bom: b,
            attrName,
            variant: (b.attribute_value_ids || []).map(attrName).join(', '),
            samplePhotoUrl: b.sample_photo_url ? `${STATIC_BASE}${b.sample_photo_url}` : undefined,
            designImageUrl: file && /\.(jpg|jpeg|png|gif|webp)$/i.test(file) ? `${STATIC_BASE}${file}` : undefined,
            designPdfName: file && /\.pdf$/i.test(file) ? file.split('/').pop() : undefined,
            printDate,
            printedAt: tzFormatCustom(now, { dateStyle: 'short', timeStyle: 'short' }, 'id-ID'),
            headerNote: overrides.headerNote || '',
            showSignatureLine: !!overrides.showSignatureLine,
        },
        companyName,
        companyLogoUrl,
        companyProfile,
        printDate,
        formatDate: (iso: string) => (iso ? tzFormatCustom(iso, { day: '2-digit', month: 'short', year: 'numeric' }, 'id-ID') : ''),
        moAttributeValue: () => '',
    };
}
