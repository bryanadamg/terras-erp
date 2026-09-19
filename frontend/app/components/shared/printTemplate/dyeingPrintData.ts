/**
 * Bath + weighed doses for a dyeing Kartu Kerja.
 *
 * The paper card is what actually reaches the vessel, so it has to carry the
 * grams the operator weighs out — not just the recipe's g/L rates, which are
 * meaningless until a bath volume exists. Doses are fetched, never computed:
 * `GET /dye-recipes/{id}/doses` is the only formula (backend
 * services/dyeing_dose_service.py), shared with the screen dose sheet.
 *
 * Fetched by the print surfaces (WOBulkPrintModal, and the print designer for its
 * preview) and passed into the render context, because the renderer is
 * deliberately hook-free and synchronous — it runs inside a hidden print portal
 * and 4-up in a bulk grid.
 */

import type { DosePreview } from '../DoseSheet';

export interface DyeingPrintData {
    /** The WO's dyeing run (the open bath, else the last one). */
    run: any;
    /** The recipe weighed against that run's bath. Null when the run has no recipe. */
    doses: DosePreview | null;
}

const DYEING_TYPES = ['DYEING', 'CELUP'];

export function isDyeingWorkOrder(workOrder: any): boolean {
    return DYEING_TYPES.includes(String(workOrder?.work_center_type || '').toUpperCase());
}

/**
 * Load one WO's bath and dose sheet. Resolves to null for a non-dyeing WO, a WO
 * with no run, or any failure — a card that cannot get its doses prints without
 * the band rather than not printing.
 *
 * The doses call is made even when the bath volume is unset: the response still
 * carries every line's rate and basis (with `dose` null for the g/L lines), which
 * is what lets the card print the recipe with a "bath not set" note instead of
 * nothing at all.
 */
export async function fetchDyeingPrintData(
    authFetch: (url: string, options?: any) => Promise<Response>,
    apiBase: string,
    workOrder: any,
): Promise<DyeingPrintData | null> {
    if (!workOrder?.id || !isDyeingWorkOrder(workOrder)) return null;
    try {
        const res = await authFetch(`${apiBase}/dyeing-runs?work_order_id=${workOrder.id}`);
        if (!res.ok) return null;
        const data = await res.json();
        const list: any[] = Array.isArray(data) ? data : (data.items ?? []);
        // Same choice the Dyeing Orders tab makes: the bath nobody has closed, else
        // the last one, so a finished WO still prints what went in.
        const run = list.find(r => !r.completed_at) ?? list[list.length - 1] ?? null;
        if (!run) return null;
        if (!run.recipe_id) return { run, doses: null };

        const qs = new URLSearchParams();
        if (run.substrate_qty != null) qs.set('substrate_qty', String(run.substrate_qty));
        // The bath the card must print against (`effective_bath_liters`: the actual,
        // falling back to a plan on runs cut before the bath moved onto the run).
        // A card printed before the run is configured carries the recipe's g/L rates
        // instead of grams — the bath is the vessel's number, and the vessel is where
        // it is now typed.
        const bath = run.effective_bath_liters ?? run.volume_air_liters;
        if (bath != null) qs.set('bath_volume_liters', String(bath));
        const dres = await authFetch(`${apiBase}/dye-recipes/${run.recipe_id}/doses?${qs.toString()}`);
        return { run, doses: dres.ok ? await dres.json() : null };
    } catch {
        return null;
    }
}

/** Load for many WOs at once, keyed by WO id. Non-dyeing WOs are simply absent. */
export async function fetchDyeingPrintDataMap(
    authFetch: (url: string, options?: any) => Promise<Response>,
    apiBase: string,
    workOrders: any[],
): Promise<Record<string, DyeingPrintData>> {
    const dyeing = (workOrders || []).filter(isDyeingWorkOrder);
    if (!dyeing.length) return {};
    const entries = await Promise.all(
        dyeing.map(async wo => [wo.id, await fetchDyeingPrintData(authFetch, apiBase, wo)] as const)
    );
    const out: Record<string, DyeingPrintData> = {};
    for (const [id, data] of entries) if (data) out[String(id)] = data;
    return out;
}
