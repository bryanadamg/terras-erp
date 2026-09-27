/**
 * Kartu Celup (dye recipe card) — data side of the template. Layout: defaults/dyeRecipe.ts.
 *
 * The card is printed from the recipe master, before any run exists, so the job
 * block (PO, lot, bath, machine) is hand-filled on paper; only the recipe's own
 * fields carry data. Rates print as stored — g/L lines and per-100kg lines keep
 * their own basis, the floor weighs the Total column by hand.
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import type { PrintContext } from '../renderContext';

export const DYE_RECIPE_DOC = 'dye_recipe';

export const DR_FIELDS: FieldDef[] = [
    { key: 'dr.code', label: 'Recipe Code', kind: 'text', group: 'Recipe', mono: true },
    { key: 'dr.name', label: 'Recipe Name (Warna)', kind: 'text', group: 'Recipe' },
    { key: 'dr.color_standard', label: 'Color Matching', kind: 'text', group: 'Recipe' },
    { key: 'dr.substrate_type', label: 'Substrate', kind: 'text', group: 'Recipe' },
    { key: 'dr.liquor_ratio', label: 'Liquor Ratio', kind: 'text', group: 'Recipe' },
    { key: 'dr.notes', label: 'Notes (Catatan)', kind: 'text', group: 'Recipe' },
    { key: 'dr.no_lines_note', label: '"No chemical lines" note', kind: 'text', group: 'Recipe' },
    { key: 'dr.wash_baths', label: 'Bak Cuci (all, one per line)', kind: 'text', group: 'Steps' },
    { key: 'dr.wash_baths_left', label: 'Bak Cuci — left column (1, 3, 5 ...)', kind: 'text', group: 'Steps' },
    { key: 'dr.wash_baths_right', label: 'Bak Cuci — right column (2, 4, 6 ...)', kind: 'text', group: 'Steps' },
    { key: 'dr.finishing_steps', label: 'Finishing steps (one per line)', kind: 'text', group: 'Steps' },
    { key: 'dr.date', label: 'Tanggal (dd.mm.yyyy)', kind: 'date', group: 'Document' },
    { key: 'dr.printed', label: 'Printed (date + time)', kind: 'text', group: 'Document' },
    { key: 'dr.footer', label: 'Footer small print (Kode / Catatan / Printed)', kind: 'text', group: 'Document' },
    { key: 'dr.letterhead_name', label: 'Company name (only when no logo)', kind: 'text', group: 'Document' },
    { key: 'dr.company_contact', label: 'Company phone · email', kind: 'text', group: 'Document' },
];

function txt(v: any): ResolvedField {
    const s = v == null || v === '' ? '' : String(v);
    return { text: s || '—', empty: s === '' };
}

export function resolveDyeRecipeField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const r = d.recipe || {};
    const cp = ctx.companyProfile || {};
    switch (key) {
        case 'dr.code': return txt(r.code);
        case 'dr.name': return txt(r.name);
        case 'dr.color_standard': return txt(r.color_standard);
        case 'dr.substrate_type': return txt(r.substrate_type);
        case 'dr.liquor_ratio': return txt(r.liquor_ratio != null ? `1 : ${r.liquor_ratio}` : '');
        case 'dr.notes': return txt(r.notes);
        case 'dr.no_lines_note': return txt(d.lines.length === 0 ? 'No chemical lines' : '');
        case 'dr.wash_baths': return txt(d.washLines.join('\n'));
        case 'dr.wash_baths_left': return txt(d.washLines.filter((_: any, i: number) => i % 2 === 0).join('\n'));
        case 'dr.wash_baths_right': return txt(d.washLines.filter((_: any, i: number) => i % 2 === 1).join('\n'));
        case 'dr.finishing_steps': return txt(d.finishingLines.join('\n'));
        case 'dr.date': return txt(ctx.printDate);
        case 'dr.printed': return txt(d.printed);
        case 'dr.footer': return txt([
            `Kode: ${r.code || ''}`,
            r.notes ? `Catatan: ${r.notes}` : '',
            `Printed: ${d.printed}`,
        ].filter(Boolean).join('\n'));
        // The old card printed the name in place of the logo, never beside it.
        case 'dr.letterhead_name': return txt(ctx.companyLogoUrl ? '' : ctx.companyName);
        case 'dr.company_contact': return txt([cp.phone, cp.email].filter(Boolean).join(' · '));
        default: return { text: '', empty: true };
    }
}

const DR_LINES: RowSourceDef = {
    id: 'dr_lines',
    label: 'Recipe chemical lines (dyes first)',
    docTypes: [DYE_RECIPE_DOC],
    seedColumns: ['no', 'bahan', 'rate'],
    columns: [
        { field: 'no', label: 'No' },
        { field: 'label', label: 'Label (Dyes n / Chem n)' },
        { field: 'bahan', label: 'Bahan' },
        { field: 'chemical_type', label: 'Type' },
        { field: 'rate', label: 'Rate' },
        { field: 'satuan', label: 'Satuan' },
        { field: 'eq', label: '"=" column' },
        // Weighed by hand against the bath on the floor.
        { field: 'total', label: 'Total (hand-filled)' },
    ],
    resolve: (ctx) => ({ rows: ctx.doc?.lines || [] }),
};

const DR_WASH: RowSourceDef = {
    id: 'dr_wash_baths',
    label: 'Bak Cuci (wash baths, in order)',
    docTypes: [DYE_RECIPE_DOC],
    seedColumns: ['bath_number', 'description'],
    columns: [
        { field: 'bath_number', label: 'No' },
        { field: 'description', label: 'Bak Cuci' },
    ],
    resolve: (ctx) => ({
        rows: (ctx.doc?.recipe?.wash_baths || []).map((w: any, i: number) => ({
            _key: w.id ?? i, bath_number: String(w.bath_number), description: w.description,
        })),
    }),
};

const DR_FINISHING: RowSourceDef = {
    id: 'dr_finishing_steps',
    label: 'Finishing steps (in order)',
    docTypes: [DYE_RECIPE_DOC],
    seedColumns: ['no', 'description'],
    columns: [
        { field: 'no', label: 'No' },
        { field: 'description', label: 'Finishing' },
    ],
    resolve: (ctx) => ({
        rows: (ctx.doc?.finishing || []).map((f: any, i: number) => ({
            _key: f.id ?? i, no: String(i + 1), description: f.description,
        })),
    }),
};

export const DR_ROW_SOURCES: RowSourceDef[] = [DR_LINES, DR_WASH, DR_FINISHING];

export function buildDyeRecipeContext({
    recipe, companyProfile, companyName, companyLogoUrl, tzFormatCustom,
}: {
    recipe: any;
    companyProfile?: any;
    companyName?: string;
    companyLogoUrl?: string;
    tzFormatCustom: (iso: string, opts: Intl.DateTimeFormatOptions, locale?: string) => string;
}): PrintContext {
    const r = recipe || {};
    const sorted = [...(r.lines || [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
    const dyes = sorted.filter((l: any) => l.chemical_type === 'DYE');
    const chems = sorted.filter((l: any) => l.chemical_type !== 'DYE');
    const now = new Date().toISOString();
    const finishing = [...(r.finishing_steps || [])];
    return {
        workOrder: null,
        parentMO: null,
        doc: {
            recipe: r,
            lines: [...dyes, ...chems].map((l: any, i: number) => {
                const rate = l.qty_per_liter ?? l.qty_per_100kg ?? null;
                return {
                    _key: l.id ?? i,
                    no: String(i + 1),
                    label: l.chemical_type === 'DYE' ? `Dyes ${dyes.indexOf(l) + 1}` : `Chem ${chems.indexOf(l) + 1}`,
                    bahan: l.item_name ?? null,
                    chemical_type: l.chemical_type,
                    rate: rate !== null ? String(rate) : '',
                    satuan: l.uom_name ?? (l.qty_per_liter != null ? 'g/L' : l.qty_per_100kg != null ? 'g/100kg' : ''),
                    eq: '=',
                    total: '',
                };
            }),
            washLines: (r.wash_baths || []).map((w: any) => `${w.bath_number} : ${w.description}`),
            finishing,
            finishingLines: finishing.map((f: any) => f.description),
            printed: tzFormatCustom(now, { dateStyle: 'short', timeStyle: 'short' }, 'id-ID'),
        },
        companyName,
        companyLogoUrl,
        companyProfile,
        printDate: tzFormatCustom(now, { day: '2-digit', month: '2-digit', year: 'numeric' }, 'id-ID').replace(/\//g, '.'),
        formatDate: (iso: string) => tzFormatCustom(iso, { day: '2-digit', month: '2-digit', year: 'numeric' }, 'id-ID'),
        moAttributeValue: () => '',
    };
}
