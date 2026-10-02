/**
 * Kartu Celup (dye recipe card) — data side of the template. Layout: defaults/dyeRecipe.ts.
 *
 * Printed two ways. From the recipe master (Dye Recipes tab) no run exists, so the
 * job block is hand-filled on paper and the Total column is blank. From a bath on
 * the Dyeing Orders tab the context carries `bath` — the WOs in the vessel, the
 * machine, the load, the water — and `doses` (GET /dye-recipes/{id}/doses weighed
 * against the whole vessel), so the same card prints filled in. Every `dr.bath_*`
 * field resolves empty without a bath and the layout's emptyText keeps the blank.
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
    { key: 'dr.bath_wo_codes', label: 'No WO (every WO in the bath)', kind: 'text', group: 'Bath' },
    { key: 'dr.bath_item_names', label: 'Nama Item (every item in the bath)', kind: 'text', group: 'Bath' },
    { key: 'dr.bath_mo_codes', label: 'MO (root MOs in the bath)', kind: 'text', group: 'Bath' },
    { key: 'dr.color_code', label: 'Kode Warna (bath, else recipe)', kind: 'text', group: 'Bath' },
    { key: 'dr.bath_sizes', label: 'Size (every size in the bath)', kind: 'text', group: 'Bath' },
    { key: 'dr.bath_combos', label: 'Combo (every combo in the bath)', kind: 'text', group: 'Bath' },
    { key: 'dr.bath_qty', label: 'Qty Order (vessel load, kg)', kind: 'text', group: 'Bath' },
    { key: 'dr.bath_volume', label: 'Volume Air (vessel, L)', kind: 'text', group: 'Bath' },
    { key: 'dr.bath_liquor_ratio', label: 'Liquor Ratio (vessel)', kind: 'text', group: 'Bath' },
    { key: 'dr.bath_machine', label: 'Mesin Celup', kind: 'text', group: 'Bath' },
    { key: 'dr.bath_speed', label: 'Tekanan / Speed', kind: 'text', group: 'Bath' },
    { key: 'dr.bath_ropes', label: 'Jumlah Tali (ropes)', kind: 'text', group: 'Bath' },
    { key: 'dr.bath_lots', label: 'LOT (input lots)', kind: 'text', group: 'Bath' },
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

const fmt = (v: any) => Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const num = (v: any, unit: string) => (v == null || v === '' || !Number(v) ? '' : `${fmt(v)}${unit}`);
const uniq = (xs: any[] | undefined) => Array.from(new Set((xs || []).filter(Boolean)));

export function resolveDyeRecipeField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const r = d.recipe || {};
    const cp = ctx.companyProfile || {};
    const b = d.bath || {};
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
        case 'dr.bath_wo_codes': return txt((b.wo_codes || []).join(', '));
        case 'dr.bath_item_names': return txt(uniq(b.item_names).join('\n'));
        case 'dr.bath_mo_codes': return txt(uniq(b.mo_codes).join(', '));
        case 'dr.color_code': return txt(uniq(b.color_codes).join(', ') || r.color_code);
        case 'dr.bath_sizes': return txt(uniq(b.sizes).join(', '));
        case 'dr.bath_combos': return txt(uniq(b.combos).join(', '));
        case 'dr.bath_qty': return txt(num(b.substrate_qty, ' KG'));
        case 'dr.bath_volume': return txt(num(b.volume_liters, ' Liter'));
        case 'dr.bath_liquor_ratio': return txt(b.liquor_ratio ? `1 : ${fmt(b.liquor_ratio)}` : '');
        case 'dr.bath_machine': return txt(b.machine);
        case 'dr.bath_speed': return txt(b.pressure || b.speed
            ? `${b.pressure || ''} / ${b.speed ? `${fmt(b.speed)} yd/min` : ''}` : '');
        case 'dr.bath_ropes': return txt(b.ropes);
        case 'dr.bath_lots': return txt(uniq(b.lots).join(', '));
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
        // The vessel's dose when printed from a bath; hand-filled from the recipe.
        { field: 'total', label: 'Total (bath dose, else hand-filled)' },
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

/** The vessel a card is printed for. One bath = one shade on one machine, shared
 *  by every WO in it, so the load is the sum and the water is counted once. */
export interface KartuCelupBath {
    wo_codes: string[];
    item_names: string[];
    mo_codes: string[];
    color_codes?: string[];
    sizes?: string[];
    combos?: string[];
    substrate_qty: number | null;
    volume_liters: number | null;
    liquor_ratio: number | null;
    machine: string | null;
    speed: number | null;
    pressure: string | null;
    ropes: number | null;
    lots: string[];
}

export function buildDyeRecipeContext({
    recipe, bath, doses, companyProfile, companyName, companyLogoUrl, tzFormatCustom,
}: {
    recipe: any;
    bath?: KartuCelupBath | null;
    /** DyeDoseResponse for the vessel; `lines[].line_id` keys onto recipe lines. */
    doses?: { lines?: any[] } | null;
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
    const doseByLine = new Map((doses?.lines || []).map((l: any) => [String(l.line_id), l]));
    return {
        workOrder: null,
        parentMO: null,
        doc: {
            recipe: r,
            bath: bath || null,
            lines: [...dyes, ...chems].map((l: any, i: number) => {
                const rate = l.qty_per_liter ?? l.qty_per_100kg ?? null;
                const dose = doseByLine.get(String(l.id));
                return {
                    _key: l.id ?? i,
                    no: String(i + 1),
                    label: l.chemical_type === 'DYE' ? `Dyes ${dyes.indexOf(l) + 1}` : `Chem ${chems.indexOf(l) + 1}`,
                    bahan: l.item_name ?? null,
                    chemical_type: l.chemical_type,
                    rate: rate !== null ? String(rate) : '',
                    satuan: l.uom_name ?? (l.qty_per_liter != null ? 'g/L' : l.qty_per_100kg != null ? 'g/100kg' : ''),
                    eq: '=',
                    total: dose?.dose != null ? `${fmt(dose.dose)} ${dose.dose_unit || ''}`.trim() : '',
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
