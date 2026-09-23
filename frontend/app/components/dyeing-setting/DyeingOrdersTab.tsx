'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    xpFont, CODE_FONT, CHIP_RADIUS, XP_BTN, colorLabel, rowStateBg,
    CodeChip, StatusChip, ProgressBar, ExpandedRowPanel, XPEmptyState,
    TableSkeleton, useTableSkeletonMetrics, useSortable, XPActionButton,
    xpInput as xpInputBase, FORM_SECTION_BLUE,
} from '../shared/xpTheme';
import {
    SortableTh, ExpanderCell, LV_EXPANDER_COL_W, lvThSticky, lvTd, lvZebra,
    lvSubTable, lvSubTh, lvSubTd, lvSubRow, Dash, lvBtn, lvInput, ResizableTable,
} from '../shared/listViewTheme';
import { SearchField } from '../shared/shellTheme';
import { getChipStyle } from '../manufacturing/WorkOrderPanel';
import VariantChips from '../shared/VariantChips';
import ModalWrapper from '../shared/ModalWrapper';
import Pager from '../shared/Pager';
import { useData } from '../../context/DataContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import { useUser } from '../../context/UserContext';
import { useTimezone } from '../../context/TimezoneContext';
import { isMachineWC } from '../shared/workCenterTree';
import DoseSheet, { fmtDose, doseUnitFor, type DosePreview } from '../shared/DoseSheet';
import { speedPresets, presetFor } from '../shared/dyeingSpeed';
import { API_BASE } from '../shared/apiBase';

const modernFont = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';


const WO_PAGE_SIZE = 25;
const STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
/** 15 columns: chevron + select + 12 data + actions. */
const COLS = 15;

const SHADE_COLORS: Record<string, { bg: string; color: string }> = {
    PASS: { bg: '#d4edda', color: '#155724' },
    FAIL: { bg: '#f8d7da', color: '#721c24' },
    REWORK: { bg: '#ffeeba', color: '#856404' },
};
/** Worst-first: a WO with one FAIL bath is a FAIL row, whatever the others say. */
const SHADE_RANK = ['FAIL', 'REWORK', 'PASS'];

const makeInput = (): React.CSSProperties =>
    lvInput({ padding: '1px 4px', width: 'auto' });
const makeBtn = (): React.CSSProperties =>
    lvBtn('default', { fontSize: 10, padding: '2px 8px' });
const makePrimaryBtn = (): React.CSSProperties =>
    lvBtn('primary', { fontSize: 10, padding: '2px 8px' });

/** Cutting an extra bath by hand. Runs are normally auto-created with the WO.
 *
 *  No customer / artikel / PO / order-qty / colour / lot / machine fields: those
 *  columns are gone (migration a7c9e1b3d5f8). Every one of them restated the
 *  SO -> MO -> WO chain the run hangs off, or the MO's colour attributes, or the
 *  output lot — and in 12 runs of real use not one was ever filled in. The machine
 *  is the WO's work center. */
interface CreateForm {
    recipe_id: string;
    substrate_qty: string;
    input_batch_id: string;
    liquor_ratio: string;
    volume_air_liters: string;
    /** Ropes this load runs on, and yards per minute per rope. Half the dyeing
     *  monitor's rate each. Typed here because the whole bath setup is configured
     *  on the run — the WO form carries no dyeing fields at all. */
    lines: string;
    yards_per_min: string;
    machine_speed: string;
    machine_pressure: string;
    temperature_c: string;
    duration_min: string;
    operator_name: string;
    notes: string;
}

/** The QC entry, and nothing else.
 *
 *  The bath lives here: volume, rope count, speed, load and the chemicals actually
 *  weighed are all configured on the run, on this tab. The work order log records
 *  kg of output and nothing else — a dyeing WO is cut with the same fields as any
 *  other. The shade result is separate again, a different person at a later moment.
 *
 *  No output lot field either: the dyed lot is minted once, by that production log,
 *  and the run adopts it (backend `add_mo_completion`).
 */
interface CompleteForm {
    shade_result: string;
    shade_notes: string;
}

interface DyeingOrdersTabProps {
    items: any[];
    recipes: any[];
    /** Typed rather than bare `Function` so usePaginatedFetch accepts it. */
    authFetch: (url: string, options?: any) => Promise<Response>;
}

const emptyCreateForm: CreateForm = {
    recipe_id: '', substrate_qty: '', input_batch_id: '', liquor_ratio: '',
    volume_air_liters: '', lines: '', yards_per_min: '', machine_speed: '',
    machine_pressure: '', temperature_c: '', duration_min: '', operator_name: '',
    notes: '',
};

/** The run's dose sheet, as typed. Rows come from the run's frozen
 *  `DyeingRunChemical` snapshot — the weights the operator was told — and only the
 *  actual moves. A run with no bath yet has no sheet to weigh against. */
interface ChemRow {
    item_id: string;
    item_name: string;
    planned_qty: string;
    actual_qty: string;
    dose_unit: string | null;
}

const emptyCompleteForm: CompleteForm = { shade_result: '', shade_notes: '' };

/** One WO's baths, rolled up for its list row. */
interface RunSummary {
    runs: any[];
    /** The bath the floor is on: the first nobody closed, else the last one cut. */
    current: any | null;
    open: any | null;
    closed: number;
    shade: string | null;
}

const EMPTY_SUMMARY: RunSummary = { runs: [], current: null, open: null, closed: 0, shade: null };

function summarize(runs: any[]): RunSummary {
    if (!runs.length) return EMPTY_SUMMARY;
    const open = runs.find(r => !r.completed_at) ?? null;
    const shade = SHADE_RANK.find(s => runs.some(r => r.shade_result === s)) ?? null;
    return {
        runs,
        current: open ?? runs[runs.length - 1],
        open,
        closed: runs.filter(r => r.completed_at).length,
        shade,
    };
}

function ShadeChip({ shade }: { shade: string }) {
    const c = SHADE_COLORS[shade] ?? { bg: '#eee', color: '#333' };
    return (
        <span style={{
            padding: '0 5px',
            borderRadius: CHIP_RADIUS,
            fontSize: 9,
            fontWeight: 700,
            background: c.bg,
            color: c.color,
            border: '1px solid #ccc',
            whiteSpace: 'nowrap',
        }}>{shade}</span>
    );
}

// Column widths for the dyeing WO grid. Order matches the `<thead>` cells exactly —
// the resize grips index into this array.
const DY_COL_W: (number | string)[] = [
    LV_EXPANDER_COL_W,  // chevron
    26,                 // select
    '13%',              // WO
    170,                // MO
    '14%',              // Product
    '15%',              // Variant
    '10%',              // Vessel
    '12%',              // Recipe
    74,                 // Substrate
    74,                 // Bath (L)
    86,                 // Target / Done
    58,                 // Baths
    74,                 // Shade
    104,                // Status
    52,                 // Actions
];

export default function DyeingOrdersTab({ items, recipes, authFetch }: DyeingOrdersTabProps) {
    const { formatCustom: tzFmt } = useTimezone();
    const { workCenters, attributes } = useData();
    const { hasPermission } = useUser();
    const canManage = hasPermission('work_order.log');

    const xpInput = makeInput();
    const xpBtn = makeBtn();
    const xpPrimaryBtn = makePrimaryBtn();
    const formInput: React.CSSProperties = xpInputBase({ padding: '1px 4px' });

    const [filterStatus, setFilterStatus] = useState('');
    const [filterWC, setFilterWC] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const [createWo, setCreateWo] = useState<any | null>(null);
    // The run the modal is configuring, or null when it is cutting a new one. Held
    // as the row object rather than an id: paging away from it must not strip the
    // form (the retained-selection trap in CLAUDE.md).
    const [editRun, setEditRun] = useState<any | null>(null);
    // The work orders going into ONE bath. Non-null puts the run panel in bulk mode:
    // the fields that describe the vessel are typed once and every selected order's
    // run takes them (POST /dyeing-runs/bulk).
    const [bulkWos, setBulkWos] = useState<any[] | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [chemRows, setChemRows] = useState<ChemRow[]>([]);
    const [showCompleteModal, setShowCompleteModal] = useState<any | null>(null);
    const [createForm, setCreateForm] = useState<CreateForm>(emptyCreateForm);
    const [completeForm, setCompleteForm] = useState<CompleteForm>(emptyCompleteForm);
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Live dose preview under the create form, and the read-only sheet the shade
    // screen shows so QC can see what the bath was dosed at.
    const [dosePreview, setDosePreview] = useState<DosePreview | null>(null);
    const [completeDoses, setCompleteDoses] = useState<DosePreview | null>(null);
    // Generation counter: the preview refires on every keystroke of substrate/volume,
    // so without it a slow earlier response lands after a newer one and shows doses
    // for a bath the operator has already changed.
    const doseGen = useRef(0);

    // Server-paginated, and the same endpoint the Work Orders page reads — this list
    // is the WO table filtered to dyeing, so it must not re-derive its own shape.
    const {
        rows: workOrders, total: woTotal, loading: woLoading,
        page, setPage, searchInput, setSearch,
    } = usePaginatedFetch<any>({
        endpoint: `${API_BASE}/work-orders`,
        authFetch,
        pageSize: WO_PAGE_SIZE,
        // `order_by: 'color'` is what makes grouping possible at all: the list is
        // windowed, so a shade with 30 work orders would otherwise group as 25 on
        // this page and 5 on the next, and a bath set up from the group would
        // silently cover only the loaded half.
        params: { center_type: 'DYEING', status: filterStatus, work_center_id: filterWC, order_by: 'color' },
    });

    // ── Baths for the visible page, in one call ───────────────────────────────
    // Keyed by WO id. Fetched for the whole page rather than per expanded row: the
    // recipe, bath and shade are list columns here, and a request per row is 25
    // round trips for a screen the supervisor is scanning, not drilling.
    const [runsByWo, setRunsByWo] = useState<Record<string, any[]>>({});
    const [runsLoading, setRunsLoading] = useState(false);
    const [runsNonce, setRunsNonce] = useState(0);
    const runsGen = useRef(0);
    const woIdsKey = useMemo(() => workOrders.map((w: any) => String(w.id)).join(','), [workOrders]);

    useEffect(() => {
        if (!woIdsKey) { setRunsByWo({}); return; }
        const gen = ++runsGen.current;
        setRunsLoading(true);
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/dyeing-runs?work_order_ids=${encodeURIComponent(woIdsKey)}`);
                if (gen !== runsGen.current) return;
                if (!res.ok) return;
                const data = await res.json();
                const list: any[] = Array.isArray(data) ? data : (data.items ?? []);
                const grouped: Record<string, any[]> = {};
                for (const r of list) {
                    const k = String(r.work_order_id);
                    (grouped[k] ||= []).push(r);
                }
                if (gen !== runsGen.current) return;
                setRunsByWo(grouped);
            } catch {
                /* the rows degrade to "no bath recorded" rather than blocking the list */
            } finally {
                if (gen === runsGen.current) setRunsLoading(false);
            }
        })();
    }, [woIdsKey, runsNonce, authFetch]);

    const reloadRuns = useCallback(() => setRunsNonce(n => n + 1), []);

    // How many runs share each bath, across every WO on this page. A shared bath is
    // one vessel of water recorded once per order, so a dose sheet read on its own
    // is one Nth of a story — the chip is what says so.
    const bathSizes = useMemo(() => {
        const counts: Record<string, number> = {};
        Object.values(runsByWo).flat().forEach((r: any) => {
            if (r?.bath_group_id) counts[String(r.bath_group_id)] = (counts[String(r.bath_group_id)] || 0) + 1;
        });
        return counts;
    }, [runsByWo]);

    // ── Rope speed presets ────────────────────────────────────────────────────
    // The same `Dyeing Speed` system attribute the monitor's rate modal picks off, so
    // a bath set up here and a rate set at the vessel come from one list. A value
    // names the shade depth and carries its yd/min ("Tua (3)"); the number is parsed
    // out in shared/dyeingSpeed, which is also why a pre-label bare "60" still works.
    const speedOptions = useMemo(() => speedPresets(attributes), [attributes]);
    // The preset the typed value corresponds to, matched numerically — the stored
    // column is Numeric(10,3), so "3" and "3.000" are the same speed and must not
    // fall out of the picker as a custom one.
    const speedPreset = useMemo(
        () => presetFor(speedOptions, createForm.yards_per_min),
        [speedOptions, createForm.yards_per_min],
    );

    // ── Vessels (dyeing machines) for the filter ──────────────────────────────
    const dyeVessels = useMemo(() => (workCenters || [])
        .filter((wc: any) => isMachineWC(wc) && ['DYEING', 'CELUP'].includes(String(wc.center_type || '').toUpperCase()))
        .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true })),
        [workCenters]);

    // ── Sorting (the loaded page, same as the Work Orders list) ───────────────
    const { sorted: sortedWOs, sort, toggle: toggleSort } = useSortable(workOrders, {
        code: (w: any) => w.code || w.name,
        mo: (w: any) => w.root_mo_code || w.mo_code,
        product: (w: any) => w.item_name,
        wc: (w: any) => w.work_center_name,
        recipe: (w: any) => summarize(runsByWo[String(w.id)] || []).current?.recipe_name,
        done: (w: any) => (w.qty ? (w.qty_completed_total ?? 0) / w.qty : null),
        shade: (w: any) => summarize(runsByWo[String(w.id)] || []).shade,
        status: (w: any) => w.status,
        created: (w: any) => w.created_at,
    });

    // One bath = one shade on one vessel, so that pair is the group key. Orders with
    // no shade yet (greige, or a lab dip still pending) key on their lab dip code so
    // they at least group with each other rather than forming one bucket of
    // everything unshaded.
    const groupKeyOf = (wo: any) =>
        `${wo.color_code || wo.labdip_variant_code || ''}|${wo.work_center_id || ''}`;

    // Grouping follows the server's own ordering, so it is switched off the moment a
    // column sort re-orders the page — a group header over rows that are no longer
    // contiguous would be a lie.
    const grouped = !sort?.key;

    /** The rows of the group `wo` belongs to, on this page. Server-ordered, so they
     *  are contiguous; the count is still page-local and the header says so. */
    const groupRows = useCallback((key: string) =>
        sortedWOs.filter((w: any) => groupKeyOf(w) === key), [sortedWOs]);

    // A selection that outlives the page it was made on would set up a bath from
    // orders nobody can see.
    useEffect(() => { setSelected(new Set()); }, [page, filterStatus, filterWC, searchInput]);

    const toggleSelected = (id: string) => setSelected(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('dyeing-orders', listBodyRef, workOrders.length > 0);

    /** Weigh a recipe against a bath, server-side. Volume wins over ratio; the
     *  backend derives whichever is missing (dyeing_dose_service.solve_bath). */
    const fetchDoses = useCallback(async (
        recipeId: string,
        substrateQty: string | number | null | undefined,
        volumeLiters: string | number | null | undefined,
        liquorRatio?: string | number | null,
    ): Promise<DosePreview | null> => {
        if (!recipeId) return null;
        const qs = new URLSearchParams();
        if (substrateQty) qs.set('substrate_qty', String(substrateQty));
        if (volumeLiters) qs.set('bath_volume_liters', String(volumeLiters));
        else if (liquorRatio) qs.set('liquor_ratio', String(liquorRatio));
        try {
            const res = await authFetch(`${API_BASE}/dye-recipes/${recipeId}/doses?${qs.toString()}`);
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }, [authFetch]);

    // Debounced so typing a substrate weight doesn't fire a request per keystroke —
    // same 350ms the item search uses.
    useEffect(() => {
        if (!createWo || !createForm.recipe_id) { setDosePreview(null); return; }
        const gen = ++doseGen.current;
        const timer = setTimeout(async () => {
            const data = await fetchDoses(
                createForm.recipe_id, createForm.substrate_qty,
                createForm.volume_air_liters, createForm.liquor_ratio,
            );
            if (gen === doseGen.current) setDosePreview(data);
        }, 350);
        return () => clearTimeout(timer);
    }, [
        createWo, createForm.recipe_id, createForm.substrate_qty,
        createForm.volume_air_liters, createForm.liquor_ratio, fetchDoses,
    ]);

    /** Open the run panel: configuring `run` when one is passed, cutting a new bath
     *  otherwise. WO creation cuts run #1 empty, so configuring is the normal case
     *  and creating is the multi-bath exception. */
    const handleOpenCreateRun = async (wo: any, run?: any) => {
        setCreateWo(wo);
        setEditRun(run ?? null);
        setDosePreview(null);
        setErrorMsg(null);
        if (run) {
            setCreateForm({
                recipe_id: run.recipe_id ? String(run.recipe_id) : '',
                substrate_qty: run.substrate_qty != null ? String(run.substrate_qty) : '',
                input_batch_id: run.input_batch_id ? String(run.input_batch_id) : '',
                liquor_ratio: run.liquor_ratio != null ? String(run.liquor_ratio) : '',
                volume_air_liters: run.volume_air_liters != null ? String(run.volume_air_liters) : '',
                lines: run.lines != null ? String(run.lines) : '',
                yards_per_min: run.yards_per_min != null ? String(run.yards_per_min) : '',
                machine_speed: run.machine_speed != null ? String(run.machine_speed) : '',
                machine_pressure: run.machine_pressure ?? '',
                temperature_c: run.temperature_c != null ? String(run.temperature_c) : '',
                duration_min: run.duration_min != null ? String(run.duration_min) : '',
                operator_name: run.operator_name ?? '',
                notes: run.notes ?? '',
            });
            setChemRows((run.chemicals ?? []).map((c: any) => ({
                item_id: String(c.item_id ?? ''),
                item_name: c.item_name ?? String(c.item_id ?? ''),
                planned_qty: c.planned_qty != null ? String(c.planned_qty) : '',
                actual_qty: c.actual_qty ? String(c.actual_qty) : '',
                dose_unit: c.dose_unit ?? null,
            })));
            return;
        }
        setCreateForm(emptyCreateForm);
        setChemRows([]);
        try {
            const res = await authFetch(`${API_BASE}/dye-recipes/match?work_order_id=${wo.id}`);
            if (res.ok) {
                const data = await res.json();
                if (data.match?.id) setCreateForm(f => ({ ...f, recipe_id: String(data.match.id) }));
            }
        } catch {
            // silently fail — user can still select manually
        }
    };

    /** Set one bath up across several orders. The recipe is matched off the first —
     *  they are one shade by construction, so any of them answers the same. */
    const handleOpenBulk = async (wos: any[]) => {
        setCreateWo(wos[0]);
        setBulkWos(wos);
        setEditRun(null);
        setChemRows([]);
        setDosePreview(null);
        setErrorMsg(null);
        setCreateForm(emptyCreateForm);
        try {
            const res = await authFetch(`${API_BASE}/dye-recipes/match?work_order_id=${wos[0].id}`);
            if (res.ok) {
                const data = await res.json();
                if (data.match?.id) setCreateForm(f => ({ ...f, recipe_id: String(data.match.id) }));
            }
        } catch {
            // silently fail — user can still select manually
        }
    };

    const setChemActual = (itemId: string, value: string) =>
        setChemRows(prev => prev.map(r => r.item_id === itemId ? { ...r, actual_qty: value } : r));

    const handleCreateFormChange = (field: keyof CreateForm, value: string) =>
        setCreateForm(prev => ({ ...prev, [field]: value }));

    /** Write the run's setup, and the chemical actuals if any were typed.
     *
     *  Configuring an existing run PATCHes it; the volume is what fills the bath, so
     *  that call is also what moves the run to IN_PROGRESS and freezes its dose
     *  sheet (backend update_dyeing_run). Actuals go in a second call because they
     *  are a different act on a different route — the bath must land even if nobody
     *  has weighed anything yet. */
    const handleSaveRun = async () => {
        if (!createWo) return;
        setSaving(true);
        setErrorMsg(null);
        try {
            const fields: any = {
                recipe_id: createForm.recipe_id || null,
                // Null = take the WO's own qty (backend create_dyeing_run).
                substrate_qty: createForm.substrate_qty ? parseFloat(createForm.substrate_qty) : null,
                liquor_ratio: createForm.liquor_ratio ? parseFloat(createForm.liquor_ratio) : null,
                volume_air_liters: createForm.volume_air_liters ? parseFloat(createForm.volume_air_liters) : null,
                lines: createForm.lines ? parseInt(createForm.lines, 10) : null,
                yards_per_min: createForm.yards_per_min ? parseFloat(createForm.yards_per_min) : null,
                machine_speed: createForm.machine_speed ? parseFloat(createForm.machine_speed) : null,
                machine_pressure: createForm.machine_pressure || null,
                temperature_c: createForm.temperature_c ? parseFloat(createForm.temperature_c) : null,
                duration_min: createForm.duration_min ? parseInt(createForm.duration_min, 10) : null,
                operator_name: createForm.operator_name || null,
                notes: createForm.notes || null,
                input_batch_id: createForm.input_batch_id || null,
            };
            if (bulkWos) {
                const res = await authFetch(`${API_BASE}/dyeing-runs/bulk`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // No substrate and no input lot: those are per-order, and the
                    // backend defaults each run's load to its own work order's qty.
                    body: JSON.stringify({
                        work_order_ids: bulkWos.map(w => String(w.id)),
                        recipe_id: fields.recipe_id,
                        liquor_ratio: fields.liquor_ratio,
                        volume_air_liters: fields.volume_air_liters,
                        lines: fields.lines,
                        yards_per_min: fields.yards_per_min,
                        machine_speed: fields.machine_speed,
                        machine_pressure: fields.machine_pressure,
                        temperature_c: fields.temperature_c,
                        duration_min: fields.duration_min,
                        operator_name: fields.operator_name,
                        notes: fields.notes,
                    }),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    setErrorMsg(err.detail || 'Failed to set the bath up.');
                    return;
                }
                setCreateWo(null);
                setBulkWos(null);
                setCreateForm(emptyCreateForm);
                setSelected(new Set());
                reloadRuns();
                return;
            }
            const res = editRun
                ? await authFetch(`${API_BASE}/dyeing-runs/${editRun.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(fields),
                })
                : await authFetch(`${API_BASE}/dyeing-runs`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...fields, work_order_id: String(createWo.id) }),
                });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                setErrorMsg(err.detail || (editRun ? 'Failed to save the run.' : 'Failed to create run.'));
                return;
            }
            const entered = chemRows.filter(r => r.item_id && r.actual_qty !== '' && !isNaN(parseFloat(r.actual_qty)));
            if (editRun && entered.length) {
                const chemRes = await authFetch(`${API_BASE}/dyeing-runs/${editRun.id}/chemicals`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        // planned_qty is never sent: the snapshot is what the operator
                        // was told to weigh, and recording what they weighed must not
                        // rewrite it — that difference is the only variance signal.
                        chemicals: entered.map(r => ({ item_id: r.item_id, actual_qty: parseFloat(r.actual_qty) })),
                    }),
                });
                if (!chemRes.ok) {
                    const err = await chemRes.json().catch(() => ({}));
                    setErrorMsg(err.detail || 'Bath saved, but the chemicals used were not recorded.');
                    reloadRuns();
                    return;
                }
            }
            setCreateWo(null);
            setEditRun(null);
            setCreateForm(emptyCreateForm);
            setChemRows([]);
            reloadRuns();
        } catch {
            setErrorMsg(editRun ? 'Network error saving the run.' : 'Network error creating run.');
        } finally {
            setSaving(false);
        }
    };

    const handleOpenShade = async (run: any) => {
        setCompleteForm({
            shade_result: run.shade_result ?? '',
            shade_notes: run.shade_notes ?? '',
        });
        setCompleteDoses(null);
        setShowCompleteModal(run);
        setErrorMsg(null);

        if (!run.recipe_id) return;
        // Reference only, and read-only: it labels each row's basis and unit so the
        // recorded quantities below are legible. The numbers QC is looking at were
        // snapshotted when the bath was filled — recomputing them here would show
        // what the recipe says today instead of what the operator weighed.
        setCompleteDoses(await fetchDoses(run.recipe_id, run.substrate_qty, run.volume_air_liters));
    };

    const handleCompleteFormChange = (field: keyof CompleteForm, value: string) =>
        setCompleteForm(prev => ({ ...prev, [field]: value }));

    /** Record the shade and close the bath.
     *
     *  `chemicals` is deliberately absent from the payload: omitting it means "leave
     *  the recorded doses alone" (backend DyeingRunCompletePayload). The actuals were
     *  recorded from the WO flow, and a QC entry must not wipe them.
     */
    const handleSaveShade = async () => {
        if (!showCompleteModal) return;
        setSaving(true);
        setErrorMsg(null);
        try {
            const res = await authFetch(`${API_BASE}/dyeing-runs/${showCompleteModal.id}/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    shade_result: completeForm.shade_result || null,
                    shade_notes: completeForm.shade_notes || null,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                setErrorMsg(err.detail || 'Failed to record the shade result.');
            } else {
                setShowCompleteModal(null);
                setCompleteForm(emptyCompleteForm);
                setCompleteDoses(null);
                reloadRuns();
            }
        } catch {
            setErrorMsg('Network error recording the shade result.');
        } finally {
            setSaving(false);
        }
    };

    const fmtDateTime = (dt: string | null | undefined) => {
        if (!dt) return '—';
        try {
            return tzFmt(dt, { dateStyle: 'short', timeStyle: 'short' } as Intl.DateTimeFormatOptions, 'en-GB');
        } catch {
            return dt;
        }
    };
    const fmtDate = (dt: string | null | undefined) => {
        if (!dt) return '—';
        try {
            return tzFmt(dt, { dateStyle: 'short' } as Intl.DateTimeFormatOptions, 'en-GB');
        } catch {
            return dt;
        }
    };

    // Full cell borders rather than lvTd's single rule — same call the Work Orders
    // list makes, and these rows carry the same density of dates and quantities.
    const thStyle: React.CSSProperties = lvThSticky({ border: '1px solid #808080' });
    const tdBase: React.CSSProperties = { ...lvTd(), border: '1px solid #c0bdb5' };

    const filterBarStyle: React.CSSProperties = {
        background: '#d4d0c8', borderBottom: '1px solid #808080',
        padding: '4px 8px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
    };

    const subTh = lvSubTh();
    const subTd = lvSubTd();

    // ── Expanded row: the supervisory detail ──────────────────────────────────
    const renderDetailPanel = (wo: any, sum: RunSummary) => {
        const colHeaderStyle: React.CSSProperties = {
            fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', color: '#555',
            letterSpacing: 0.5, borderBottom: '1px solid #c0bdb5', paddingBottom: 2, marginBottom: 4, width: '100%',
        };
        const infoRow = (label: string, val: React.ReactNode) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 1, fontSize: 9 }}>
                <span style={{ color: '#888' }}>{label}</span>
                <span style={{ fontWeight: 'bold', color: '#222', textAlign: 'right', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
            </div>
        );

        return (
            <tr key={`${wo.id}-detail`}>
                <td colSpan={COLS} style={{ padding: 0 }}>
                    <ExpandedRowPanel>
                        <div style={{
                            display: 'grid', gridTemplateColumns: '270px minmax(0, 1fr)',
                            border: '1px solid #7f9db9',
                            fontFamily: xpFont, fontSize: 10,
                        }}>
                            {/* Order — the chain this bath hangs off, so QC can judge the
                                colour against the order it belongs to without leaving. */}
                            <div style={{ borderRight: '1px solid #c0bdb5', padding: '6px 8px', background: '#f5f4ef' }}>
                                <div style={colHeaderStyle}>Order</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, fontSize: 9 }}>
                                    <span style={{ color: '#888' }}>MO</span>
                                    <CodeChip code={wo.mo_code} style={{ fontSize: 9 }} />
                                </div>
                                {wo.root_mo_code && wo.root_mo_code !== wo.mo_code && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, fontSize: 9 }}>
                                        <span style={{ color: '#888' }}>Root MO</span>
                                        <CodeChip code={wo.root_mo_code} tier={2} style={{ fontSize: 9 }} />
                                    </div>
                                )}
                                {infoRow('Product', wo.item_name || '—')}
                                {wo.color_label && infoRow('Variant', wo.color_label)}
                                {(wo.color_code || wo.labdip_variant_code) && infoRow(
                                    'Color',
                                    wo.color_code
                                        ? colorLabel(wo.color_code, wo.color_name)
                                        : `${wo.labdip_variant_code} (lab dip pending)`
                                )}
                                {infoRow('Vessel', wo.work_center_name || '—')}
                                <div style={{ borderTop: '1px solid #e0ddd8', margin: '3px 0' }} />
                                {infoRow('Target Start', fmtDate(wo.target_start_date))}
                                {infoRow('Target End', fmtDate(wo.target_end_date))}
                                {infoRow('Actual Start', fmtDateTime(wo.actual_start_date))}
                                {infoRow('Actual End', fmtDateTime(wo.actual_end_date))}
                                {infoRow('Created', fmtDateTime(wo.created_at))}
                                <div style={{ borderTop: '1px solid #e0ddd8', margin: '3px 0' }} />
                                {infoRow('Logged', `${(wo.qty_completed_total ?? 0).toFixed(2)}${wo.qty != null ? ` / ${wo.qty}` : ''}`)}
                                {(wo.qty_rejected_total ?? 0) > 0 && infoRow('Rejected', (wo.qty_rejected_total ?? 0).toFixed(2))}
                                {infoRow('Baths', `${sum.runs.length} (${sum.closed} closed)`)}
                                {wo.notes && (
                                    <div style={{ marginTop: 4, padding: '2px 5px', background: '#fffbe6', border: '1px solid #e0d080', fontSize: 9, fontStyle: 'italic', color: '#666' }}>
                                        {wo.notes}
                                    </div>
                                )}
                            </div>

                            {/* Baths — one row per DyeingRun. Everything here is read-only
                                except the shade: the bath itself is filled from the WO log,
                                where the operator is standing. */}
                            <div style={{ padding: '6px 8px', background: '#f5f4ef', overflow: 'hidden' }}>
                                <div style={{ ...colHeaderStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                                    <span>Baths ({sum.runs.length})</span>
                                    {canManage && (
                                        <XPActionButton
                                            tone="success"
                                            icon="bi-plus-lg"
                                            label="Create Run"
                                            title="Cut an extra bath. Run #1 is created with the work order — configure it from its own row instead"
                                            onClick={() => handleOpenCreateRun(wo)}
                                        />
                                    )}
                                </div>
                                {runsLoading && !sum.runs.length ? (
                                    <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: 9 }}>Loading...</div>
                                ) : sum.runs.length === 0 ? (
                                    <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: 9 }}>No baths on this work order.</div>
                                ) : (
                                    <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                                        <table style={{ ...lvSubTable(), border: 'none' }}>
                                            <thead>
                                                <tr>
                                                    <th style={{ ...subTh, width: 34 }}>Run</th>
                                                    <th style={subTh}>Recipe</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 62 }}>Substrate</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 62 }} title="Bath planned at WO creation. Only on runs cut before the bath moved onto the run itself.">Plan L</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 62 }} title="Water the floor actually filled">Actual L</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 52 }}>L:R</th>
                                                    <th style={{ ...subTh, width: 78 }}>Status</th>
                                                    <th style={{ ...subTh, width: 62 }}>Shade</th>
                                                    <th style={{ ...subTh, width: 96 }} title="When the shade started being matched at the vessel">Matching</th>
                                                    <th style={{ ...subTh, width: 96 }}>Started</th>
                                                    <th style={{ ...subTh, width: 96 }}>Completed</th>
                                                    <th style={{ ...subTh, width: 30 }} />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {sum.runs.map((run: any, ri: number) => {
                                                    const recipeName = run.recipe_name
                                                        ?? recipes.find(r => String(r.id) === String(run.recipe_id))?.name
                                                        ?? null;
                                                    // Gate the action on the SHADE, not on `status` and not on
                                                    // the close: status is derived from the WO too (backend
                                                    // services/dyeing_run_service), and closing the bath is now
                                                    // its own floor act on the vessel card. The shade is QC at a
                                                    // later moment and must stay recordable after both.
                                                    const bathClosed = !!run.shade_result;
                                                    const bathFilled = !!run.started_at || run.volume_air_liters != null;
                                                    return (
                                                        <tr key={run.id} style={lvSubRow(ri)}>
                                                            <td style={{ ...subTd, fontWeight: 'bold' }}>
                                                                #{run.run_number}
                                                                {run.bath_group_id && (bathSizes[String(run.bath_group_id)] || 0) > 1 && (
                                                                    <span
                                                                        title={`One bath shared with ${(bathSizes[String(run.bath_group_id)] || 1) - 1} other work order(s) — the volume and every dose below are the whole vessel's, counted once per order`}
                                                                        style={{ marginLeft: 3, borderRadius: CHIP_RADIUS, fontSize: 8, fontWeight: 'bold', color: '#1d4f7c', background: '#dbeafe', border: '1px solid #8fb6d9', padding: '0 3px', whiteSpace: 'nowrap' }}
                                                                    >x{bathSizes[String(run.bath_group_id)]}</span>
                                                                )}
                                                            </td>
                                                            <td style={{ ...subTd, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={recipeName || undefined}>
                                                                {recipeName ?? <Dash />}
                                                            </td>
                                                            <td style={{ ...subTd, textAlign: 'right' }}>{fmtDose(run.substrate_qty, 2)}</td>
                                                            <td style={{ ...subTd, textAlign: 'right', color: '#666' }}>{fmtDose(run.planned_volume_air_liters, 1)}</td>
                                                            <td style={{ ...subTd, textAlign: 'right', fontWeight: 'bold' }}>{fmtDose(run.volume_air_liters, 1)}</td>
                                                            <td style={{ ...subTd, textAlign: 'right', color: '#666' }}>
                                                                {run.liquor_ratio != null ? `1:${fmtDose(run.liquor_ratio, 2)}` : '—'}
                                                            </td>
                                                            <td style={subTd}><StatusChip status={run.status || 'PENDING'} tint /></td>
                                                            <td style={subTd}>
                                                                {run.shade_result
                                                                    ? <ShadeChip shade={run.shade_result} />
                                                                    : <Dash />}
                                                            </td>
                                                            <td style={{ ...subTd, color: '#666', whiteSpace: 'nowrap' }}>{fmtDateTime(run.color_matching_at)}</td>
                                                            <td style={{ ...subTd, color: '#666', whiteSpace: 'nowrap' }}>{fmtDateTime(run.started_at)}</td>
                                                            <td style={{ ...subTd, color: '#666', whiteSpace: 'nowrap' }}>{fmtDateTime(run.completed_at)}</td>
                                                            <td style={{ ...subTd, textAlign: 'right' }}>
                                                                {/* Two actions. Setup: the bath, the ropes, the speed and the
                                                                    chemicals actually weighed — this is where a run is
                                                                    configured, since the WO form carries no dyeing fields and
                                                                    the WO log records only kg out. Shade: QC, a different
                                                                    person at a later moment, which is why it stays its own
                                                                    panel. */}
                                                                {canManage && !run.completed_at && (
                                                                    <XPActionButton
                                                                        tone={bathFilled ? 'neutral' : 'primary'}
                                                                        icon="bi-sliders"
                                                                        title={bathFilled
                                                                            ? 'Correct the bath, or record the chemicals actually used'
                                                                            : 'Configure this bath — volume, ropes, speed and load'}
                                                                        onClick={() => handleOpenCreateRun(wo, run)}
                                                                    />
                                                                )}
                                                                <XPActionButton
                                                                    tone={!bathClosed && bathFilled && canManage ? 'primary' : 'neutral'}
                                                                    icon={bathClosed || !canManage ? 'bi-eye' : 'bi-eyedropper'}
                                                                    title={bathClosed || !canManage
                                                                        ? 'View the bath, its dose sheet and the chemicals used'
                                                                        : bathFilled
                                                                            ? 'Record the shade result and close this bath'
                                                                            : 'No bath recorded yet — configure the run first'}
                                                                    onClick={() => handleOpenShade(run)}
                                                                />
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    </ExpandedRowPanel>
                </td>
            </tr>
        );
    };

    // Read-only once the SHADE is recorded, not once the bath is closed: a batch
    // completed at the vessel is still waiting for QC to look at it.
    const shadeModalClosed = !!showCompleteModal?.shade_result;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, fontFamily: xpFont}}>
            {/* Filter bar */}
            <div style={filterBarStyle}>
                <label style={{ fontSize: 10, color: '#000', whiteSpace: 'nowrap' }}>Filter:</label>
                <SearchField value={searchInput} onChange={setSearch} placeholder="Search WO / MO..." width={160} />
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    style={{ ...formInput, width: 110 }}>
                    <option value="">All Statuses</option>
                    {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <select value={filterWC} onChange={e => setFilterWC(e.target.value)}
                    style={{ ...formInput, width: 150 }}>
                    <option value="">All Vessels</option>
                    {dyeVessels.map((wc: any) => <option key={wc.id} value={wc.id}>{wc.name}</option>)}
                </select>
                {(filterStatus || filterWC || searchInput) && (
                    <button onClick={() => { setFilterStatus(''); setFilterWC(''); setSearch(''); }}
                        style={{ ...formInput, width: 'auto', cursor: 'pointer', height: 20 }}>
                        Clear
                    </button>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#333', whiteSpace: 'nowrap' }}>
                    {woLoading ? 'Loading...' : `${woTotal} dyeing work order${woTotal === 1 ? '' : 's'}`}
                </span>
            </div>

            {/* Table */}
            <div className="table-responsive" style={{ flex: 1, overflow: 'auto', minHeight: 0, background: '#fff' }}>
                <ResizableTable colKey="dyeing-orders" defaults={DY_COL_W}
                    style={{ width: '100%', minWidth: 1560, borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 11, fontFamily: xpFont, background: '#fff' }}
                >
                    <thead>
                        <tr>
                            <th style={{ ...thStyle, width: 22, padding: '3px 4px' }} />
                            <th style={{ ...thStyle, width: 26, padding: '3px 4px' }} />
                            {([
                                ['WO', 'code'], ['MO', 'mo'], ['Product', 'product'], ['Variant', ''],
                                ['Vessel', 'wc'], ['Recipe', 'recipe'], ['Substrate', ''], ['Bath (L)', ''],
                                ['Target / Done', 'done'], ['Baths', ''], ['Shade', 'shade'],
                                ['Status', 'status'], ['', ''],
                            ] as [string, string][]).map(([h, key], i) => (
                                <SortableTh key={`${h}-${i}`}
                                    sort={sort} colKey={key || null} onSort={toggleSort}
                                    style={{ ...thStyle, textAlign: ['Substrate', 'Bath (L)'].includes(h) ? 'right' : h === '' ? 'right' : 'left' }}>
                                    {h}
                                </SortableTh>
                            ))}
                        </tr>
                    </thead>
                    <tbody ref={listBodyRef}>
                        {workOrders.length === 0 && (woLoading ? (
                            <TableSkeleton rows={8} cols={skel.cols ?? COLS} tdStyle={tdBase} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                        ) : (
                            <tr>
                                <td colSpan={COLS} style={{ padding: 0 }}>
                                    <XPEmptyState message="No dyeing work orders found." icon="bi-droplet-half" />
                                </td>
                            </tr>
                        ))}
                        {sortedWOs.map((wo: any, idx: number) => {
                            const id = String(wo.id);
                            const isExpanded = expandedId === id;
                            const sum = summarize(runsByWo[id] || []);
                            const cur = sum.current;
                            const toggleRow = () => setExpandedId(prev => prev === id ? null : id);
                            // The first row of a shade-on-a-vessel carries the group header:
                            // the server orders by exactly this pair, so equal keys are
                            // adjacent and one comparison with the row above is enough.
                            const gKey = groupKeyOf(wo);
                            const isGroupHead = grouped && (idx === 0 || groupKeyOf(sortedWOs[idx - 1]) !== gKey);
                            const rowsInGroup = isGroupHead ? groupRows(gKey) : [];
                            const pickedInGroup = rowsInGroup.filter((w: any) => selected.has(String(w.id)));
                            // The group IS the bath, so ticking nothing means "all of it".
                            // Ticking is for leaving an order OUT — which is the rarer act,
                            // and making it the precondition left the button dead on arrival.
                            const bathWos = pickedInGroup.length ? pickedInGroup : rowsInGroup;
                            return (
                                <React.Fragment key={id}>
                                    {isGroupHead && (
                                        <tr style={{ background: '#ece9d8' }}>
                                            <td style={{ ...tdBase, padding: '2px 4px', textAlign: 'center' }}>
                                                <input
                                                    type="checkbox"
                                                    title="Select every order in this group that is on this page"
                                                    checked={rowsInGroup.length > 0 && pickedInGroup.length === rowsInGroup.length}
                                                    onChange={() => setSelected(prev => {
                                                        const next = new Set(prev);
                                                        const all = pickedInGroup.length === rowsInGroup.length;
                                                        rowsInGroup.forEach((w: any) => all ? next.delete(String(w.id)) : next.add(String(w.id)));
                                                        return next;
                                                    })}
                                                />
                                            </td>
                                            <td colSpan={COLS - 1} style={{ ...tdBase, padding: '2px 6px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                    <VariantChips
                                                        colorVariant={wo.color_label}
                                                        colorCode={wo.color_code}
                                                        colorName={wo.color_name}
                                                        colorHex={wo.color_hex}
                                                        labdipCode={wo.labdip_variant_code}
                                                    />
                                                    <span style={{ fontWeight: 'bold', color: '#333' }}>
                                                        {wo.work_center_name || 'No vessel'}
                                                    </span>
                                                    <span style={{ color: '#666' }}>
                                                        {rowsInGroup.length} order{rowsInGroup.length === 1 ? '' : 's'} on this page
                                                        {' · '}
                                                        {fmtDose(rowsInGroup.reduce((t: number, w: any) => t + (Number(w.qty) || 0), 0), 2)} total
                                                    </span>
                                                    <span style={{ marginLeft: 'auto' }} />
                                                    {canManage && (
                                                        <XPActionButton
                                                            tone="primary"
                                                            icon="bi-droplet-half"
                                                            label={`Set Up Bath (${bathWos.length})`}
                                                            title={pickedInGroup.length
                                                                ? 'One vessel, one setup — every ticked order takes this bath'
                                                                : 'One vessel, one setup — every order in this group takes this bath. Tick rows to leave some out.'}
                                                            onClick={() => {
                                                                // A group of one has no bath to share: hand it to the
                                                                // single-run panel rather than refusing (the bulk route
                                                                // wants two, and one order in a vessel is just a run).
                                                                if (bathWos.length < 2) {
                                                                    const only = bathWos[0];
                                                                    handleOpenCreateRun(only, summarize(runsByWo[String(only.id)] || []).open ?? undefined);
                                                                    return;
                                                                }
                                                                handleOpenBulk(bathWos);
                                                            }}
                                                        />
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    <tr
                                        style={{
                                            background: isExpanded ? rowStateBg('expanded') : (lvZebra(idx)),
                                            cursor: 'pointer',
                                        }}
                                        onClick={toggleRow}
                                    >
                                        <ExpanderCell expanded={isExpanded} onToggle={toggleRow} tdStyle={tdBase} tdClassName={''} label="dyeing order detail" />
                                        <td style={{ ...tdBase, padding: '2px 4px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                aria-label={`Select ${wo.code || wo.name} for a shared bath`}
                                                checked={selected.has(id)}
                                                onChange={() => toggleSelected(id)}
                                            />
                                        </td>
                                        <td style={{ ...tdBase, overflow: 'hidden' }} title={wo.code || wo.name}>
                                            <CodeChip
                                                code={wo.code || wo.name}
                                                tone="accent"
                                                style={{ fontWeight: 'bold', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                                            />
                                        </td>
                                        {/* Root MO — top of the pegging chain, not this WO's own MO. A
                                            shared component MO feeds several roots; the first is shown
                                            and the rest sit behind a +N marker. */}
                                        <td style={{ ...tdBase, overflow: 'hidden' }}>
                                            {wo.root_mo_code ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden' }}>
                                                    <CodeChip code={wo.root_mo_code} tier={2} style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis' }} />
                                                    {(wo.root_mo_count ?? 0) > 1 && (
                                                        <span
                                                            title={`Shared component — feeds ${wo.root_mo_count} root MOs: ${(wo.root_mo_codes || []).join(', ')}`}
                                                            style={{ borderRadius: CHIP_RADIUS, fontSize: 9, fontWeight: 'bold', color: '#7a5000', background: '#fff3cd', border: '1px solid #b8860b', padding: '0 3px', flexShrink: 0 }}
                                                        >+{(wo.root_mo_count ?? 1) - 1}</span>
                                                    )}
                                                </div>
                                            ) : <span style={{ color: '#bbb' }}>—</span>}
                                        </td>
                                        <td style={{ ...tdBase, fontSize: 10, color: '#444', overflow: 'hidden' }} title={wo.item_name || ''}>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{wo.item_name || '—'}</span>
                                        </td>
                                        {/* Colour is the point of a dyeing order, so the variant chips get
                                            their own column rather than the right edge of Product. */}
                                        <td style={{ ...tdBase, fontSize: 10, overflow: 'hidden', whiteSpace: 'normal' }}>
                                            <VariantChips
                                                combo={wo.combo_label}
                                                size={wo.size_label}
                                                colorVariant={wo.color_label}
                                                colorCode={wo.color_code}
                                                colorName={wo.color_name}
                                                colorHex={wo.color_hex}
                                                labdipCode={wo.labdip_variant_code}
                                                style={{ flexWrap: 'wrap', rowGap: 2 }}
                                            />
                                        </td>
                                        <td style={{ ...tdBase, fontSize: 10, overflow: 'hidden' }}>
                                            {wo.work_center_name ? (() => {
                                                const cs = getChipStyle(wo.work_center_type);
                                                return (
                                                    <span style={{
                                                        padding: '1px 5px',
                                                        borderRadius: CHIP_RADIUS,
                                                        border: `1px solid ${cs.borderColor as string}`,
                                                        background: cs.background as string,
                                                        color: cs.color as string,
                                                        whiteSpace: 'nowrap',
                                                        fontSize: 'inherit',
                                                    }}>{wo.work_center_name}</span>
                                                );
                                            })() : <span style={{ color: '#bbb' }}>—</span>}
                                        </td>
                                        {/* Recipe / substrate / bath come from the WO's current bath — the
                                            first one nobody closed, else the last one cut. */}
                                        <td style={{ ...tdBase, fontSize: 10, overflow: 'hidden' }}
                                            title={cur?.recipe_name || undefined}>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                                                {cur?.recipe_name
                                                    ?? recipes.find(r => String(r.id) === String(cur?.recipe_id))?.name
                                                    ?? <span style={{ color: '#bbb' }}>—</span>}
                                            </span>
                                        </td>
                                        <td style={{ ...tdBase, fontSize: 10, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            {cur ? fmtDose(cur.substrate_qty, 2) : <span style={{ color: '#bbb' }}>—</span>}
                                        </td>
                                        {/* The bath every dose is weighed from: the actual once the floor
                                            filled it, the plan until then (backend effective_bath_liters).
                                            A plan is greyed so a supervisor can tell a proposal from a fact. */}
                                        <td style={{ ...tdBase, fontSize: 10, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            {cur ? (
                                                <span
                                                    style={{ color: cur.volume_air_liters != null ? undefined : '#888', fontStyle: cur.volume_air_liters != null ? undefined : 'italic' }}
                                                    title={cur.volume_air_liters != null ? 'Bath the floor filled' : 'Planned bath — the floor has not recorded one yet'}
                                                >
                                                    {fmtDose(cur.effective_bath_liters ?? cur.volume_air_liters ?? cur.planned_volume_air_liters, 1)}
                                                </span>
                                            ) : <span style={{ color: '#bbb' }}>—</span>}
                                        </td>
                                        <td style={{ ...tdBase, fontSize: 10}}>
                                            {wo.qty != null ? (() => {
                                                const done = (wo.qty_completed_total ?? 0) >= wo.qty;
                                                const pct = Math.min(100, ((wo.qty_completed_total ?? 0) / wo.qty) * 100);
                                                return (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
                                                        <ProgressBar pct={pct} tone={done ? 'green' : 'blue'} hatched width={72} height={8} />
                                                        <span style={{ fontSize: 9, color: done ? '#007000' : '#555', whiteSpace: 'nowrap' }}>
                                                            {(wo.qty_completed_total ?? 0).toFixed(1)}/{wo.qty}
                                                        </span>
                                                    </div>
                                                );
                                            })() : <span style={{ color: '#bbb' }}>—</span>}
                                        </td>
                                        <td style={{ ...tdBase, fontSize: 10, textAlign: 'center', whiteSpace: 'nowrap' }}>
                                            {sum.runs.length === 0
                                                ? <span style={{ color: '#bbb' }}>—</span>
                                                : (
                                                    <span
                                                        title={`${sum.runs.length} bath${sum.runs.length === 1 ? '' : 'es'}, ${sum.closed} closed`}
                                                        style={{ fontFamily: CODE_FONT, fontSize: 10, color: sum.open ? '#0058e6' : '#555' }}
                                                    >
                                                        {sum.closed}/{sum.runs.length}
                                                    </span>
                                                )}
                                        </td>
                                        <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>
                                            {sum.shade
                                                ? <ShadeChip shade={sum.shade} />
                                                : <span style={{ color: '#bbb' }}>—</span>}
                                        </td>
                                        <td style={tdBase}>
                                            <StatusChip status={wo.status || 'PENDING'} />
                                        </td>
                                        <td style={{ ...tdBase, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                                            {/* The shade is the only thing this tab writes. It acts on the
                                                WO's open bath; every bath is reachable in the expanded row. */}
                                            {sum.open ? (
                                                <XPActionButton
                                                    tone={canManage ? 'primary' : 'neutral'}
                                                    icon={canManage ? 'bi-eyedropper' : 'bi-eye'}
                                                    title={canManage
                                                        ? `Record the shade result for bath #${sum.open.run_number}`
                                                        : 'View the bath and the chemicals used'}
                                                    onClick={() => handleOpenShade(sum.open)}
                                                />
                                            ) : sum.current ? (
                                                <XPActionButton
                                                    icon="bi-eye"
                                                    title={`View bath #${sum.current.run_number}`}
                                                    onClick={() => handleOpenShade(sum.current)}
                                                />
                                            ) : null}
                                        </td>
                                    </tr>
                                    {isExpanded && renderDetailPanel(wo, sum)}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </ResizableTable>
            </div>

            <Pager page={page} total={woTotal} pageSize={WO_PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />

            {/* The run panel — where a bath is configured, and the only place it is.
                WO creation cuts run #1 carrying just the recipe its gate matched; the
                volume, the ropes, the speed and the load are typed here, by the
                operator at the vessel. The work order log records kg of output and
                nothing else. Cutting a second bath by hand uses the same form. */}
            {createWo && (
                <ModalWrapper
                    isOpen={!!createWo}
                    onClose={() => { setCreateWo(null); setEditRun(null); setBulkWos(null); setCreateForm(emptyCreateForm); setChemRows([]); setErrorMsg(null); }}
                    title={bulkWos
                        ? `Set Up Bath — ${bulkWos.length} work orders on ${createWo.work_center_name || 'one vessel'}`
                        : editRun
                            ? `Dyeing Run #${editRun.run_number} — ${createWo.code || createWo.name}`
                            : `New Dyeing Run — ${createWo.code || createWo.name}`}
                    size="lg"
                    modeless
                    footer={<>
                        <button className={XP_BTN} style={{ ...xpPrimaryBtn, padding: '3px 16px' }} onClick={handleSaveRun} disabled={saving}>
                            {saving ? 'Saving...' : bulkWos ? `Set Up ${bulkWos.length} Runs` : editRun ? 'Save Bath' : 'Save Run'}
                        </button>
                        <button className={XP_BTN} style={{ ...xpBtn, padding: '3px 16px' }} onClick={() => { setCreateWo(null); setEditRun(null); setBulkWos(null); setCreateForm(emptyCreateForm); setChemRows([]); setErrorMsg(null); }} disabled={saving}>
                            Cancel
                        </button>
                    </>}
                >
                    <div>
                        {errorMsg && (
                            <div style={{ background: '#fff3cd', border: '1px solid #ffc107', padding: '3px 8px', fontSize: 11, color: '#664d03', marginBottom: 6 }}>
                                {errorMsg}
                            </div>
                        )}
                        {/* What is going in the vessel. Named rather than counted: a
                            planner about to commit 900 L to four orders should see
                            which four, and how much cloth that is in total. */}
                        {bulkWos && (
                            <div style={{ border: '1px solid #aca899', background: '#f5f4ee', padding: '4px 6px', marginBottom: 6, fontSize: 10 }}>
                                <div style={{ fontWeight: 'bold', color: '#444', marginBottom: 2 }}>
                                    In this bath — {bulkWos.length} orders,{' '}
                                    {fmtDose(bulkWos.reduce((t, w) => t + (Number(w.qty) || 0), 0), 2)} total
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {bulkWos.map(w => (
                                        <CodeChip key={String(w.id)} code={`${w.code || w.name} · ${fmtDose(w.qty, 2)}`} tone="accent" />
                                    ))}
                                </div>
                                <div style={{ color: '#888', marginTop: 2 }}>
                                    The bath below is the vessel's, and is recorded whole on every run —
                                    not split between them. Each run keeps its own load, kg and clock.
                                </div>
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 12px' }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={{ fontSize: 10, color: '#444' }}>Recipe</span>
                                <select
                                    style={{ ...xpInput, height: 22 }}
                                    value={createForm.recipe_id}
                                    onChange={e => handleCreateFormChange('recipe_id', e.target.value)}
                                >
                                    <option value="">-- select recipe --</option>
                                    {recipes.map(r => (
                                        <option key={r.id} value={r.id}>{r.name ?? r.recipe_code ?? `Recipe ${r.id}`}</option>
                                    ))}
                                </select>
                            </label>
                            {/* Both are per-ORDER, so a shared bath has no single answer
                                for either: each run takes its own work order's qty. */}
                            {!bulkWos && (
                                <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <span style={{ fontSize: 10, color: '#444' }}>Substrate Qty</span>
                                    <input type="number" style={xpInput} value={createForm.substrate_qty}
                                        onChange={e => handleCreateFormChange('substrate_qty', e.target.value)}
                                        placeholder={createWo.qty != null ? `WO qty ${createWo.qty}` : 'e.g. 100'} />
                                </label>
                            )}
                            {!bulkWos && (
                                <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <span style={{ fontSize: 10, color: '#444' }}>Input Lot</span>
                                    <input type="text" style={xpInput} value={createForm.input_batch_id}
                                        onChange={e => handleCreateFormChange('input_batch_id', e.target.value)} placeholder="lot number" />
                                </label>
                            )}
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span
                                    style={{ fontSize: 10, color: '#444' }}
                                    title="Litres of water per kg of substrate. Used to derive the bath volume when Volume Air is left blank; an entered Volume Air always wins."
                                >Liquor Ratio (1:x)</span>
                                <input type="number" style={xpInput} value={createForm.liquor_ratio}
                                    onChange={e => handleCreateFormChange('liquor_ratio', e.target.value)} placeholder="e.g. 10" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span
                                    style={{ fontSize: 10, color: '#444' }}
                                    title="Water volume of the bath, in litres. Every g/L chemical is weighed out against this. Leave blank to have it derived from the liquor ratio."
                                >Volume Air (L)</span>
                                <input type="number" step="0.1" style={xpInput} value={createForm.volume_air_liters}
                                    onChange={e => handleCreateFormChange('volume_air_liters', e.target.value)} placeholder="e.g. 190" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span
                                    style={{ fontSize: 10, color: '#444' }}
                                    title="How many ropes the vessel runs this load on. The dyeing monitor's rate is yd/min per rope x this."
                                >Line (ropes)</span>
                                <input type="number" min="1" step="1" style={xpInput} value={createForm.lines}
                                    onChange={e => handleCreateFormChange('lines', e.target.value)} placeholder="1" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span
                                    style={{ fontSize: 10, color: '#444' }}
                                    title="Rope speed for this bath, picked by shade depth off the Dyeing Speed attribute. Times the rope count, this is the vessel's rate on the dyeing monitor."
                                >Speed (yd/min per rope)</span>
                                <select
                                    style={{ ...xpInput, height: 22 }}
                                    value={createForm.yards_per_min === '' ? '' : (speedPreset ? String(speedPreset.n) : '__custom')}
                                    onChange={e => { if (e.target.value !== '__custom') handleCreateFormChange('yards_per_min', e.target.value); }}
                                >
                                    <option value="">-- select --</option>
                                    {speedOptions.map(p => (
                                        <option key={p.id} value={String(p.n)}>{p.label}</option>
                                    ))}
                                    {/* A speed the floor typed, or one curated away since, still has to
                                        read as the current value instead of snapping to a preset. */}
                                    {createForm.yards_per_min !== '' && !speedPreset && (
                                        <option value="__custom">{createForm.yards_per_min} (custom)</option>
                                    )}
                                </select>
                                {/* The escape hatch, under the picker and narrower than it: a vessel run
                                    at a speed nobody has added to the list must still be recordable, but
                                    the list is the path. Same shape as the monitor's rate modal. */}
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#777' }}>
                                    or type
                                    <input type="number" min="0" step="any"
                                        style={{ ...xpInput, width: 58 }}
                                        value={createForm.yards_per_min}
                                        onChange={e => handleCreateFormChange('yards_per_min', e.target.value)} />
                                    {speedOptions.length === 0 && (
                                        <span style={{ color: '#a06000' }}>none curated yet</span>
                                    )}
                                </span>
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={{ fontSize: 10, color: '#444' }}>Speed</span>
                                <input type="number" step="0.1" style={xpInput} value={createForm.machine_speed}
                                    onChange={e => handleCreateFormChange('machine_speed', e.target.value)} placeholder="e.g. 7" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={{ fontSize: 10, color: '#444' }}>Tekanan (Pressure)</span>
                                <input type="text" style={xpInput} value={createForm.machine_pressure}
                                    onChange={e => handleCreateFormChange('machine_pressure', e.target.value)} placeholder="pressure" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={{ fontSize: 10, color: '#444' }}>Temperature (C)</span>
                                <input type="number" style={xpInput} value={createForm.temperature_c}
                                    onChange={e => handleCreateFormChange('temperature_c', e.target.value)} placeholder="e.g. 60" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={{ fontSize: 10, color: '#444' }}>Duration (min)</span>
                                <input type="number" style={xpInput} value={createForm.duration_min}
                                    onChange={e => handleCreateFormChange('duration_min', e.target.value)} placeholder="e.g. 45" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={{ fontSize: 10, color: '#444' }}>Operator Name</span>
                                <input type="text" style={xpInput} value={createForm.operator_name}
                                    onChange={e => handleCreateFormChange('operator_name', e.target.value)} placeholder="operator" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1, gridColumn: 'span 2' }}>
                                <span style={{ fontSize: 10, color: '#444' }}>Notes</span>
                                <input type="text" style={xpInput} value={createForm.notes}
                                    onChange={e => handleCreateFormChange('notes', e.target.value)} placeholder="optional" />
                            </label>
                        </div>
                        {createForm.recipe_id && (
                            <DoseSheet
                                doses={dosePreview}
                                emptyHint="This recipe has no chemical lines to weigh out."
                                style={{ marginTop: 6}}
                            />
                        )}

                        {/* What actually went into the vessel. Only on a run whose sheet
                            has been frozen — before the bath is filled there is nothing
                            to weigh against, and the preview above is still a proposal.
                            Planned is the snapshot the operator was handed; only the
                            actual is typed, and the gap between them is the only dosing
                            variance the system has. */}
                        {editRun && chemRows.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                                <div style={{ fontSize: 10, fontWeight: 'bold', color: '#444', marginBottom: 2 }}>
                                    Chemicals Used
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                                    <thead>
                                        <tr style={{ background: '#dddbd0' }}>
                                            <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Chemical</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 90 }}>Weigh Out</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 90 }}>Actual</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 70 }}>Variance</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {chemRows.map((row, idx) => {
                                            const planned = parseFloat(row.planned_qty);
                                            const actual = parseFloat(row.actual_qty);
                                            const variance = (isNaN(actual) ? 0 : actual) - (isNaN(planned) ? 0 : planned);
                                            return (
                                                <tr key={row.item_id || idx} style={{ background: idx % 2 === 0 ? '#fff' : '#f5f4ee' }}>
                                                    <td style={{ padding: '2px 6px' }}>{row.item_name}</td>
                                                    <td style={{ padding: '2px 6px', textAlign: 'right', color: '#555', whiteSpace: 'nowrap' }}>
                                                        {isNaN(planned) ? '—' : `${fmtDose(planned, 3)}${row.dose_unit ? ` ${row.dose_unit}` : ''}`}
                                                    </td>
                                                    <td style={{ padding: '2px 4px' }}>
                                                        <input
                                                            type="number" min="0" step="any"
                                                            style={{ ...xpInput, textAlign: 'right' }}
                                                            value={row.actual_qty}
                                                            onChange={e => setChemActual(row.item_id, e.target.value)}
                                                            placeholder={row.dose_unit || ''}
                                                            disabled={!canManage}
                                                        />
                                                    </td>
                                                    <td style={{ padding: '2px 6px', textAlign: 'right', whiteSpace: 'nowrap', color: Math.abs(variance) < 1e-9 ? '#555' : variance > 0 ? '#900' : '#1a5e1a' }}>
                                                        {isNaN(actual) ? '—' : `${variance > 0 ? '+' : ''}${fmtDose(variance, 3)}`}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>
                                    Chemicals are still deducted from stock by BOM percentage, not from these
                                    figures — this records what the vessel actually took.
                                </div>
                            </div>
                        )}
                    </div>
                </ModalWrapper>
            )}

            {/* Shade Result Modal — the QC gate, and the one thing this tab writes.
                The bath, the dose sheet and the chemicals actually used are recorded
                in the work order flow (WOCompletionModal / the mobile scan terminal):
                the bath and the output it produced are one act by one operator, and
                recording them on two screens is what let a WO be finished with its
                bath never recorded. What is left here is genuinely a different
                person at a later moment, judging the colour — so everything below
                the shade fields is read-only context for that judgement. A bath that
                is already closed opens the same panel with the fields locked. */}
            {showCompleteModal && (
                <ModalWrapper
                    isOpen={!!showCompleteModal}
                    onClose={() => { setShowCompleteModal(null); setErrorMsg(null); }}
                    title={`${shadeModalClosed ? 'Bath' : 'Shade Result'} — Dyeing Run #${showCompleteModal.run_number ?? showCompleteModal.id}`}
                    size="lg"
                    modeless
                    footer={<>
                        {!shadeModalClosed && canManage && (
                            <button
                                className={XP_BTN}
                                style={{ ...xpBtn, padding: '3px 16px' }}
                                onClick={handleSaveShade}
                                disabled={saving}
                            >
                                {saving ? 'Saving...' : 'Save & Close Bath'}
                            </button>
                        )}
                        <button
                            className={XP_BTN}
                            style={{ ...xpBtn, padding: '3px 16px' }}
                            onClick={() => { setShowCompleteModal(null); setErrorMsg(null); }}
                            disabled={saving}
                        >
                            {shadeModalClosed || !canManage ? 'Close' : 'Cancel'}
                        </button>
                    </>}
                >
                    <div>
                        {errorMsg && (
                            <div style={{ background: '#fff3cd', border: '1px solid #ffc107', padding: '3px 8px', fontSize: 11, color: '#664d03', marginBottom: 6 }}>
                                {errorMsg}
                            </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginBottom: 8 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={{ fontSize: 10, color: '#444' }}>Shade Result</span>
                                <select
                                    style={{ ...xpInput, height: 22 }}
                                    value={completeForm.shade_result}
                                    onChange={e => handleCompleteFormChange('shade_result', e.target.value)}
                                    disabled={shadeModalClosed || !canManage}
                                    autoFocus
                                >
                                    <option value="">-- select --</option>
                                    <option value="PASS">PASS</option>
                                    <option value="FAIL">FAIL</option>
                                    <option value="REWORK">REWORK</option>
                                </select>
                            </label>
                            {/* Read-only: the dyed lot is minted by the WO production log
                                (one lot per physical dye batch) and this run adopts it. */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={{ fontSize: 10, color: '#444' }}>Output Lot</span>
                                <span
                                    style={{ fontSize: 11, padding: '2px 4px', color: showCompleteModal.output_batch_number ? '#333' : '#888' }}
                                    title="The dyed lot is created when the work order's output is logged, and this run picks it up automatically — one lot per physical dye batch."
                                >
                                    {showCompleteModal.output_batch_number || 'set when the WO output is logged'}
                                </span>
                            </div>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1, gridColumn: '1 / -1' }}>
                                <span style={{ fontSize: 10, color: '#444' }}>Shade Notes</span>
                                <textarea
                                    style={{ ...xpInput, height: 48, resize: 'vertical' }}
                                    value={completeForm.shade_notes}
                                    onChange={e => handleCompleteFormChange('shade_notes', e.target.value)}
                                    disabled={shadeModalClosed || !canManage}
                                    placeholder="optional notes"
                                />
                            </label>
                        </div>

                        {/* The bath as the floor recorded it. Read-only here: it is
                            corrected in the WO log, where the operator is standing. */}
                        <div style={{
                            ...({ border: '1px solid #7f9db9', background: 'white' }),
                            marginBottom: 6,
                        }}>
                            <div style={{
                                background: FORM_SECTION_BLUE, color: 'white', padding: '3px 8px',
                                fontFamily: xpFont, fontSize: 11, fontWeight: 'bold',
                            }}>Bath as Recorded</div>
                            <div style={{ padding: '5px 8px', display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11}}>
                                <span>Volume Air: <strong>{showCompleteModal.volume_air_liters != null ? `${fmtDose(showCompleteModal.volume_air_liters, 1)} L` : '—'}</strong></span>
                                <span>Planned: <strong>{showCompleteModal.planned_volume_air_liters != null ? `${fmtDose(showCompleteModal.planned_volume_air_liters, 1)} L` : '—'}</strong></span>
                                <span>Substrate: <strong>{showCompleteModal.substrate_qty != null ? `${fmtDose(showCompleteModal.substrate_qty, 2)} kg` : '—'}</strong></span>
                                <span>Liquor Ratio: <strong>{showCompleteModal.liquor_ratio != null ? `1 : ${fmtDose(showCompleteModal.liquor_ratio, 2)}` : '—'}</strong></span>
                            </div>
                        </div>

                        {showCompleteModal.recipe_id && (
                            <DoseSheet
                                doses={completeDoses}
                                emptyHint={completeDoses
                                    ? 'This recipe has no chemical lines to weigh out.'
                                    : 'Loading the recipe...'}
                            />
                        )}

                        {/* What the vessel actually took, recorded with the output log.
                            Planned vs actual is the only dosing variance signal there
                            is, which is why it sits in front of QC. */}
                        <div style={{
                            ...({ border: '1px solid #7f9db9', background: 'white' }),
                            marginTop: 6,
                        }}>
                            <div style={{
                                background: FORM_SECTION_BLUE, color: 'white', padding: '3px 8px',
                                fontFamily: xpFont, fontSize: 11, fontWeight: 'bold',
                            }}>Chemicals Used</div>
                            {(showCompleteModal.chemicals ?? []).length === 0 ? (
                                <div style={{ padding: '6px 8px', color: '#888', fontSize: 11}}>
                                    Nothing recorded yet — the operator enters what went in with the
                                    work order&apos;s production log.
                                </div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11}}>
                                    <thead>
                                        <tr style={{ background: '#ece9d8', borderBottom: '1px solid #7f9db9' }}>
                                            <th style={{ ...subTh, textAlign: 'left' }}>Item</th>
                                            <th style={{ ...subTh, textAlign: 'right' }}>Planned</th>
                                            <th style={{ ...subTh, textAlign: 'right' }}>Actual</th>
                                            <th style={{ ...subTh, textAlign: 'right' }}>Variance</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(showCompleteModal.chemicals ?? []).map((c: any, idx: number) => {
                                            const unit = doseUnitFor(completeDoses, String(c.item_id)) ?? '';
                                            const planned = Number(c.planned_qty ?? 0);
                                            const actual = Number(c.actual_qty ?? 0);
                                            const variance = actual - planned;
                                            return (
                                                <tr key={c.id ?? idx} style={lvSubRow(idx)}>
                                                    <td style={subTd}>
                                                        {c.item_name ?? items.find(it => String(it.id) === String(c.item_id))?.name ?? <Dash />}
                                                    </td>
                                                    <td style={{ ...subTd, textAlign: 'right', whiteSpace: 'nowrap', color: '#666' }}>
                                                        {fmtDose(planned, 3)}{unit ? ` ${unit}` : ''}
                                                    </td>
                                                    <td style={{ ...subTd, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
                                                        {actual > 0 ? `${fmtDose(actual, 3)}${unit ? ` ${unit}` : ''}` : <Dash />}
                                                    </td>
                                                    <td style={{
                                                        ...subTd, textAlign: 'right', whiteSpace: 'nowrap',
                                                        color: actual <= 0 ? '#888' : Math.abs(variance) < 1e-9 ? '#666' : variance > 0 ? '#900' : '#1a5e1a',
                                                    }}>
                                                        {actual > 0 ? `${variance > 0 ? '+' : ''}${fmtDose(variance, 3)}` : '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </ModalWrapper>
            )}
        </div>
    );
}
