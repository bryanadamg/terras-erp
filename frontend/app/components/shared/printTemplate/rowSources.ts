/**
 * Row sources for `table` bands.
 *
 * A source turns the render context into a flat row list plus the columns it can
 * offer. The step-material filter below is lifted verbatim from the old
 * KartuKerjaCard*.tsx bodies (all four had an identical copy): BOM lines tied to
 * an operation on this WO's work center, falling back to *all* BOM lines when the
 * step has no material mapped.
 */

import type { PrintContext } from './renderContext';
import type { TableBand } from './types';
import { DOC_MODULES } from './doctypes';

const KARTU_KERJA_DOCS = ['kartu_kerja_weaving', 'kartu_kerja_beaming', 'kartu_kerja_dyeing', 'kartu_kerja_general'];

export interface SourceColumnDef {
    field: string;
    label: string;
    /** Right-align and honour `decimals` in the renderer. */
    numeric?: boolean;
}

export interface SourceResult {
    rows: Record<string, any>[];
    /**
     * Title the source suggests for the band. Bands whose `title` is the literal
     * `'{auto}'` render this instead — that keeps the old
     * "Komponen Operasi Ini" vs "Material (berdasarkan BOM)" switch working while
     * still letting the client pin a fixed title.
     */
    autoTitle?: string;
}

export interface RowSourceDef {
    id: string;
    label: string;
    /** Doc types whose tables may draw from this source. */
    docTypes: string[];
    columns: SourceColumnDef[];
    /** Columns a newly added table starts with. Default: the first three. */
    seedColumns?: string[];
    /**
     * `band` is passed when rendering, for sources whose row shape depends on the
     * columns placed (a slot grid wraps at however many slot columns the band has).
     */
    resolve: (ctx: PrintContext, band?: TableBand) => SourceResult;
}

const BOM_STEP_LINES: RowSourceDef = {
    id: 'bom_step_lines',
    label: 'Step Materials (BOM lines for this WO)',
    docTypes: KARTU_KERJA_DOCS,
    seedColumns: ['item', 'required_qty', 'actual_qty'],
    columns: [
        { field: 'item', label: 'Komponen' },
        { field: 'item_code', label: 'Item Code' },
        { field: 'item_name', label: 'Item Name' },
        { field: 'required_qty', label: 'Perlu', numeric: true },
        { field: 'actual_qty', label: 'Aktual', numeric: true },
        { field: 'variance', label: 'Selisih', numeric: true },
        { field: 'percentage', label: '%', numeric: true },
    ],
    resolve: (ctx) => {
        const wo = ctx.workOrder || {};
        const mo = ctx.parentMO || {};
        const woQty = Number(wo.qty ?? 0);

        const allBomLines: any[] = mo?.bom?.lines || [];
        const bomOps: any[] = mo?.bom?.operations || [];
        const woWcId = String(wo.work_center_id || '');
        const stepOpIds = new Set(
            bomOps
                .filter((op: any) => woWcId && String(op.work_center_id || '') === woWcId)
                .map((op: any) => String(op.id))
        );
        const stepLines = allBomLines.filter(
            (l: any) => l.bom_operation_id && stepOpIds.has(String(l.bom_operation_id))
        );
        const usedAllLines = stepLines.length === 0;
        const bomLines = usedAllLines ? allBomLines : stepLines;

        // Actual consumed materials logged against this WO, summed across completions.
        const actualByItem: Record<string, number> = {};
        (mo?.completions || [])
            .filter((c: any) => String(c.work_order_id || '') === String(wo.id))
            .forEach((c: any) =>
                (c.actual_items || []).forEach((ai: any) => {
                    const k = String(ai.item_id);
                    actualByItem[k] = (actualByItem[k] || 0) + Number(ai.qty_used || 0);
                })
            );

        const rows = bomLines.map((line: any) => {
            const pct = parseFloat(line.percentage);
            const required = woQty > 0
                ? (pct > 0 ? (woQty * pct) / 100 : woQty * parseFloat(line.qty || 0))
                : null;
            const actual = actualByItem[String(line.item_id)];
            // Same "name [attrs]" the SPK prints, so a yarn's colour/combo shows here too.
            const attrs = (line.attribute_value_ids || []).map((v: string) => ctx.attrName?.(v) || '').filter(Boolean);
            const name = line.item_name || line.item_id;
            return {
                _key: line.id,
                item_code: line.item_code || '',
                item_name: name,
                // Composite cell: mono code then name, as the old card rendered it.
                item: { code: line.item_code || '', name: attrs.length ? `${name} [${attrs.join(', ')}]` : name },
                required_qty: required,
                actual_qty: actual ?? null,
                variance: required != null && actual != null ? actual - required : null,
                percentage: Number.isNaN(pct) ? null : pct,
            };
        });

        return {
            rows,
            autoTitle: usedAllLines ? 'Material (berdasarkan BOM)' : 'Komponen Operasi Ini',
        };
    },
};

/**
 * The dye weights for this WO's bath — the grams the operator actually weighs out,
 * which is the whole reason the card is carried to the vessel. Recipe rates alone
 * are unusable there: a g/L line means nothing until a bath volume exists.
 *
 * Nothing is computed here. The rows come straight from
 * `GET /dye-recipes/{id}/doses` (fetched by the print surface, see
 * dyeingPrintData.ts), whose formula lives in backend
 * services/dyeing_dose_service.py — so the card, the screen dose sheet and the
 * snapshotted `DyeingRunChemical.planned_qty` cannot disagree.
 *
 * `weigh_out` is text, not a numeric column: the unit differs per row (grams for a
 * g/L line, the line's own UOM for an owf one), and a bare number in that column is
 * a 1000x mistake waiting to happen.
 */
const DYE_DOSES: RowSourceDef = {
    id: 'dye_doses',
    label: 'Dye Weights (this WO’s bath)',
    docTypes: KARTU_KERJA_DOCS,
    columns: [
        { field: 'item', label: 'Kimia' },
        { field: 'item_code', label: 'Item Code' },
        { field: 'item_name', label: 'Item Name' },
        { field: 'chemical_type', label: 'Jenis' },
        { field: 'rate', label: 'Rate' },
        { field: 'basis', label: 'Basis' },
        { field: 'weigh_out', label: 'Timbang' },
        { field: 'dose', label: 'Dosis', numeric: true },
        { field: 'dose_kg', label: 'kg', numeric: true },
        { field: 'actual_qty', label: 'Aktual', numeric: true },
    ],
    resolve: (ctx) => {
        const doses = ctx.dyeing?.doses;
        const run = ctx.dyeing?.run;
        const lines = doses?.lines ?? [];

        // What the vessel has already been recorded as taking, so a reprinted card
        // carries it. Blank on a first print — the operator writes it in.
        const actualByItem: Record<string, number> = {};
        (run?.chemicals || []).forEach((c: any) => {
            const v = Number(c.actual_qty ?? 0);
            if (v > 0) actualByItem[String(c.item_id)] = v;
        });

        const rows = lines.map((l: any) => ({
            _key: l.line_id,
            item_code: l.item_code || '',
            item_name: l.item_name || l.item_code || '',
            item: { code: l.item_code || '', name: l.item_name || l.item_code || '' },
            chemical_type: l.chemical_type || '',
            rate: l.basis === 'PER_LITER'
                ? `${l.qty_per_liter ?? ''} g/L`
                : l.basis === 'PER_100KG'
                    ? `${l.qty_per_100kg ?? ''} /100kg`
                    : '',
            basis: l.basis === 'PER_LITER' ? 'g/L x bath'
                : l.basis === 'PER_100KG' ? '% owf x kg'
                    : 'no rate set',
            weigh_out: l.dose == null
                ? ''
                : `${Number(l.dose).toFixed(3)}${l.dose_unit ? ` ${l.dose_unit}` : ''}`,
            dose: l.dose ?? null,
            dose_kg: l.dose_kg ?? null,
            actual_qty: actualByItem[String(l.item_id)] ?? null,
        }));

        // The title carries the bath, because every g/L number in the table is
        // meaningless without it — and says so plainly when there is none, rather
        // than printing rates that look like weights.
        const vol = doses?.bath_volume_liters;
        const ratio = doses?.liquor_ratio;
        const autoTitle = vol
            ? `Dosis Kimia — bath ${vol} L${ratio ? ` · 1 : ${Number(ratio).toFixed(2)}` : ''}`
            : 'Dosis Kimia — volume air belum diisi (rate resep saja)';

        return { rows, autoTitle };
    },
};

export const ROW_SOURCES: Record<string, RowSourceDef> = {
    [BOM_STEP_LINES.id]: BOM_STEP_LINES,
    [DYE_DOSES.id]: DYE_DOSES,
    ...Object.fromEntries(DOC_MODULES.flatMap(m => m.rowSources).map(s => [s.id, s])),
};

export function rowSource(id: string): RowSourceDef | undefined {
    return ROW_SOURCES[id];
}

/** Sources a table on this doc type can draw from, in registry order. */
export function sourcesForDoc(docType: string): RowSourceDef[] {
    return Object.values(ROW_SOURCES).filter(s => s.docTypes.includes(docType));
}
