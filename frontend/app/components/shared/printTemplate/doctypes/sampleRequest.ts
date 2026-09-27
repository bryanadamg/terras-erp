/**
 * SPK Sample (sample request work order) — data side of the template. Layout:
 * defaults/sampleRequest.ts.
 *
 * The paper form has a fixed shape the sample division fills in by hand: at least
 * five WARNA rows (one spare below the last colour), Repeat/New tick boxes, an
 * OK / NOT OK checklist per colour. Tick boxes print as the ■ / □ glyphs (Arial
 * carries both), so a colour row is one text value.
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import type { PrintContext } from '../renderContext';
import { STATIC_BASE } from '../../apiBase';

export const SAMPLE_REQUEST_DOC = 'sample_request';

// ponytail: fixed pool of WARNA row fields; a sample with more colours than this
// prints the rest only through `sr.colors` / the colour table source.
export const SR_COLOR_ROWS = 20;

const ON = '■';
const OFF = '□';

export const SR_FIELDS: FieldDef[] = [
    { key: 'sr.code', label: 'Kode SPK', kind: 'text', group: 'Sample' },
    { key: 'sr.request_date', label: 'Tgl Turun SPK', kind: 'date', group: 'Sample' },
    { key: 'sr.project', label: 'Project', kind: 'text', group: 'Sample' },
    { key: 'sr.customer_name', label: 'Nama Customer', kind: 'text', group: 'Sample' },
    { key: 'sr.category', label: 'Category', kind: 'text', group: 'Sample' },
    { key: 'sr.status', label: 'Status', kind: 'text', group: 'Sample' },
    { key: 'sr.customer_article_code', label: 'Kode Artikel Sample', kind: 'text', group: 'Sample' },
    { key: 'sr.internal_article_code', label: 'Kode Artikel Bola Intan', kind: 'text', group: 'Sample' },
    { key: 'sr.width', label: 'Lebar', kind: 'text', group: 'Sample' },
    { key: 'sr.quantity', label: 'Jumlah / Banyak Sampel', kind: 'text', group: 'Sample' },
    { key: 'sr.est_completion_date', label: 'Est Tgl Selesai (Req cust)', kind: 'date', group: 'Sample' },
    { key: 'sr.notes', label: 'Notes', kind: 'text', group: 'Sample' },
    { key: 'sr.colors', label: 'Colours (all, one per line)', kind: 'text', group: 'Colours' },
    ...Array.from({ length: SR_COLOR_ROWS }, (_, i): FieldDef => ({
        key: `sr.color_${i + 1}`,
        label: `WARNA row ${i + 1} (name + Repeat/New boxes)`,
        kind: 'text',
        group: 'Colours',
    })),
    { key: 'sr.checklist_ok', label: 'Checklist OK boxes (one per colour)', kind: 'text', group: 'Colours' },
    { key: 'sr.checklist_not_ok', label: 'Checklist NOT OK boxes (one per colour)', kind: 'text', group: 'Colours' },
    { key: 'sr.main_material', label: 'Lapis Atas', kind: 'text', group: 'Detail Quality' },
    { key: 'sr.middle_material', label: 'Lapis Tengah', kind: 'text', group: 'Detail Quality' },
    { key: 'sr.bottom_material', label: 'Lapis Bawah', kind: 'text', group: 'Detail Quality' },
    { key: 'sr.weft', label: 'Weft', kind: 'text', group: 'Detail Quality' },
    { key: 'sr.warp', label: 'Karet', kind: 'text', group: 'Detail Quality' },
    { key: 'sr.original_weight', label: 'Berat Original Sampel', kind: 'text', group: 'Detail Quality' },
    { key: 'sr.production_weight', label: 'Berat BIE Sampel', kind: 'text', group: 'Detail Quality' },
    { key: 'sr.additional_info', label: 'Informasi Tambahan (min 3 lines)', kind: 'text', group: 'Detail Quality' },
    { key: 'sr.completion_description', label: 'Original sample description', kind: 'text', group: 'Original Sample' },
    { key: 'sr.completion_image', label: 'Original sample photo', kind: 'image', group: 'Original Sample' },
    { key: 'sr.sample_box_space', label: 'Blank space (fills an empty sample box)', kind: 'text', group: 'Original Sample' },
    { key: 'sr.prepared_by', label: 'Prepared by (name)', kind: 'text', group: 'Signatures' },
    { key: 'sr.prepared_role', label: 'Prepared by (title)', kind: 'text', group: 'Signatures' },
    { key: 'sr.internal_report_stamp', label: 'INTERNAL REPORT stamp', kind: 'image', group: 'Signatures' },
];

function txt(v: any): ResolvedField {
    const s = v == null || v === '' ? '' : String(v);
    return { text: s || '—', empty: s === '' };
}

function colorRow(c: any): string {
    const boxes = `${c?.is_repeat ? ON : OFF} Repeat / ${c && !c.is_repeat ? ON : OFF} New ${OFF}`;
    return c?.name ? `${c.name}  ${boxes}` : boxes;
}

const STAMP_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="42" viewBox="0 0 200 42">'
    + '<rect x="1" y="1" width="198" height="40" fill="none" stroke="#c00" stroke-width="2"/>'
    + '<text x="100" y="27" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" '
    + 'font-weight="bold" letter-spacing="1" fill="#c00">INTERNAL REPORT</text></svg>',
);

export function resolveSampleRequestField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const s = d.sample || {};
    const colors: any[] = s.colors || [];

    if (key.startsWith('sr.color_')) {
        const n = Number(key.slice('sr.color_'.length));
        // Always at least five rows, and one spare below the last colour.
        if (!(n >= 1 && n <= Math.max(5, colors.length + 1))) return txt('');
        return { text: colorRow(colors[n - 1]), empty: false };
    }

    switch (key) {
        case 'sr.code': return txt(s.code);
        case 'sr.request_date': return txt(d.requestDate);
        case 'sr.project': return txt(s.project);
        case 'sr.customer_name': return txt(d.customerName);
        case 'sr.category': return txt(s.category);
        case 'sr.status': return txt(s.status);
        case 'sr.customer_article_code': return txt(s.customer_article_code);
        case 'sr.internal_article_code': return txt(s.internal_article_code);
        case 'sr.width': return txt(s.width);
        case 'sr.quantity': return txt(s.quantity);
        case 'sr.est_completion_date': return txt(d.estCompletionDate);
        case 'sr.notes': return txt(s.notes);
        case 'sr.colors': return txt(colors.map(c => c.name).filter(Boolean).join('\n'));
        case 'sr.checklist_ok': return txt(colors.length ? [...colors.map(() => `${OFF} OK`), OFF].join('\n') : '');
        case 'sr.checklist_not_ok': return txt(colors.length ? [...colors.map(() => `${OFF} NOT OK`), OFF].join('\n') : '');
        case 'sr.main_material': return txt(s.main_material);
        case 'sr.middle_material': return txt(s.middle_material);
        case 'sr.bottom_material': return txt(s.bottom_material);
        case 'sr.weft': return txt(s.weft);
        case 'sr.warp': return txt(s.warp);
        case 'sr.original_weight': return txt(s.original_weight != null ? `${s.original_weight} Gr/Yard` : '');
        case 'sr.production_weight': return txt(s.production_weight != null ? `${s.production_weight} Gr/Yard` : '');
        case 'sr.additional_info': {
            // The form keeps room for about three written lines even when empty.
            const lines = s.additional_info ? String(s.additional_info).split('\n') : [];
            while (lines.length < 3) lines.push(' ');
            return { text: lines.join('\n'), empty: false };
        }
        case 'sr.completion_description': return txt(s.completion_description);
        case 'sr.completion_image':
            return d.imageUrl ? { text: '', empty: false, imageUrl: d.imageUrl } : { text: '', empty: true };
        case 'sr.sample_box_space': {
            // Keeps an unfilled box tall enough to staple the original sample into.
            if (d.imageUrl) return txt('');
            const used = s.completion_description ? String(s.completion_description).split('\n').length + 1 : 0;
            const n = Math.max(0, 7 - used);
            return n ? { text: Array(n).fill(' ').join('\n'), empty: false } : txt('');
        }
        case 'sr.prepared_by': return txt(d.preparedBy);
        case 'sr.prepared_role': return txt(d.preparedRole);
        case 'sr.internal_report_stamp': return { text: '', empty: false, imageUrl: STAMP_SVG };
        default: return { text: '', empty: true };
    }
}

const SR_COLORS: RowSourceDef = {
    id: 'sr_colors',
    label: 'Sample colours',
    docTypes: [SAMPLE_REQUEST_DOC],
    seedColumns: ['no', 'name', 'repeat_new'],
    columns: [
        { field: 'no', label: 'No' },
        { field: 'name', label: 'Warna' },
        { field: 'repeat_new', label: 'Repeat / New' },
        { field: 'status', label: 'Status' },
    ],
    resolve: (ctx) => ({
        rows: (ctx.doc?.sample?.colors || []).map((c: any, i: number) => ({
            _key: c.id ?? i, no: String(i + 1), name: c.name, repeat_new: c.is_repeat ? 'Repeat' : 'New', status: c.status,
        })),
    }),
};

// A table band with no rows draws only its heading row: the shaded, centred
// "DETAIL QUALITY" bar across the form.
const SR_HEADING: RowSourceDef = {
    id: 'sr_heading',
    label: 'Heading bar (no rows — the column label is the heading)',
    docTypes: [SAMPLE_REQUEST_DOC],
    seedColumns: ['heading'],
    columns: [{ field: 'heading', label: 'Heading' }],
    resolve: () => ({ rows: [] }),
};

export const SR_ROW_SOURCES: RowSourceDef[] = [SR_COLORS, SR_HEADING];

export interface SampleRequestOverrides {
    preparedBy?: string;
    preparedRole?: string;
}

export function buildSampleRequestContext({
    sample, customerName, companyProfile, companyName, companyLogoUrl, tzFormatCustom, overrides = {},
}: {
    sample: any;
    customerName: string;
    companyProfile?: any;
    companyName?: string;
    companyLogoUrl?: string;
    tzFormatCustom: (iso: string, opts: Intl.DateTimeFormatOptions, locale?: string) => string;
    overrides?: SampleRequestOverrides;
}): PrintContext {
    const s = sample || {};
    const fmt = (d: string | null | undefined) => {
        if (!d) return '';
        try { return tzFormatCustom(d, { day: '2-digit', month: 'short', year: '2-digit' }, 'id-ID'); }
        catch { return d; }
    };
    return {
        workOrder: null,
        parentMO: null,
        doc: {
            sample: s,
            customerName,
            requestDate: fmt(s.request_date || s.created_at),
            estCompletionDate: fmt(s.estimated_completion_date),
            imageUrl: s.completion_image_url ? `${STATIC_BASE}${s.completion_image_url}` : '',
            preparedBy: overrides.preparedBy ?? s.created_by_name ?? '',
            preparedRole: overrides.preparedRole ?? s.created_by_role ?? 'Marketing',
        },
        companyName,
        companyLogoUrl,
        companyProfile,
        printDate: fmt(new Date().toISOString()),
        formatDate: fmt,
        moAttributeValue: () => '',
    };
}
