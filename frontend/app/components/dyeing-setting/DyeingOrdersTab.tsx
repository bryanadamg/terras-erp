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
    lvSubTable, lvSubTh, lvSubTd, lvSubRow, Dash, lvBtn, lvInput,
} from '../shared/listViewTheme';
import { SearchField } from '../shared/shellTheme';
import { getChipStyle } from '../manufacturing/WorkOrderPanel';
import VariantChips from '../shared/VariantChips';
import ModalWrapper from '../shared/ModalWrapper';
import Pager from '../shared/Pager';
import { useTheme } from '../../context/ThemeContext';
import { useData } from '../../context/DataContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import { useUser } from '../../context/UserContext';
import { useTimezone } from '../../context/TimezoneContext';
import { isMachineWC } from '../shared/workCenterTree';
import DoseSheet, { fmtDose, doseUnitFor, type DosePreview } from '../shared/DoseSheet';

const modernFont = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api')
    .replace(/\/api$/, '') + '/api';

const WO_PAGE_SIZE = 25;
const STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
/** 14 columns: chevron + 12 data + actions. */
const COLS = 14;

const SHADE_COLORS: Record<string, { bg: string; color: string }> = {
    PASS: { bg: '#d4edda', color: '#155724' },
    FAIL: { bg: '#f8d7da', color: '#721c24' },
    REWORK: { bg: '#ffeeba', color: '#856404' },
};
/** Worst-first: a WO with one FAIL bath is a FAIL row, whatever the others say. */
const SHADE_RANK = ['FAIL', 'REWORK', 'PASS'];

const makeInput = (classic: boolean): React.CSSProperties =>
    lvInput(classic, classic ? { padding: '1px 4px', width: 'auto' } : { height: 'auto' });
const makeBtn = (classic: boolean): React.CSSProperties =>
    lvBtn(classic, 'default', classic ? { fontSize: 10, padding: '2px 8px' } : {});
const makePrimaryBtn = (classic: boolean): React.CSSProperties =>
    lvBtn(classic, 'primary', classic ? { fontSize: 10, padding: '2px 8px' } : {});

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
    machine_speed: string;
    machine_pressure: string;
    temperature_c: string;
    duration_min: string;
    operator_name: string;
    notes: string;
}

/** The QC entry, and nothing else.
 *
 *  This tab is supervisory: the bath, the doses and the chemicals actually used
 *  are recorded in the work order flow (`useDyeingBath`, in the WO completion modal
 *  and the mobile scan terminal), because the bath and the output it produced are
 *  one act by one operator. The shade result stays here — it is a different person
 *  at a later moment, which is exactly why it is not folded into the production log.
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
    volume_air_liters: '', machine_speed: '', machine_pressure: '',
    temperature_c: '', duration_min: '', operator_name: '', notes: '',
};

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

function ShadeChip({ shade, classic }: { shade: string; classic: boolean }) {
    const c = SHADE_COLORS[shade] ?? { bg: '#eee', color: '#333' };
    return (
        <span style={{
            padding: classic ? '0 5px' : '1px 7px',
            borderRadius: CHIP_RADIUS,
            fontSize: classic ? 9 : 11,
            fontWeight: 700,
            background: c.bg,
            color: c.color,
            border: '1px solid #ccc',
            whiteSpace: 'nowrap',
        }}>{shade}</span>
    );
}

export default function DyeingOrdersTab({ items, recipes, authFetch }: DyeingOrdersTabProps) {
    const { uiStyle } = useTheme();
    const { formatCustom: tzFmt } = useTimezone();
    const { workCenters } = useData();
    const classic = uiStyle === 'classic';
    const { hasPermission } = useUser();
    const canManage = hasPermission('work_order.log');

    const xpInput = makeInput(classic);
    const xpBtn = makeBtn(classic);
    const xpPrimaryBtn = makePrimaryBtn(classic);
    const formInput: React.CSSProperties = xpInputBase({ padding: '1px 4px' });

    const [filterStatus, setFilterStatus] = useState('');
    const [filterWC, setFilterWC] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const [createWo, setCreateWo] = useState<any | null>(null);
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
        params: { center_type: 'DYEING', status: filterStatus, work_center_id: filterWC },
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

    const handleOpenCreateRun = async (wo: any) => {
        setCreateWo(wo);
        setCreateForm(emptyCreateForm);
        setDosePreview(null);
        setErrorMsg(null);
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

    const handleCreateFormChange = (field: keyof CreateForm, value: string) =>
        setCreateForm(prev => ({ ...prev, [field]: value }));

    const handleSaveRun = async () => {
        if (!createWo) return;
        setSaving(true);
        setErrorMsg(null);
        try {
            const payload: any = {
                work_order_id: String(createWo.id),
                recipe_id: createForm.recipe_id || null,
                // Null = take the WO's own qty (backend create_dyeing_run).
                substrate_qty: createForm.substrate_qty ? parseFloat(createForm.substrate_qty) : null,
                liquor_ratio: createForm.liquor_ratio ? parseFloat(createForm.liquor_ratio) : null,
                volume_air_liters: createForm.volume_air_liters ? parseFloat(createForm.volume_air_liters) : null,
                machine_speed: createForm.machine_speed ? parseFloat(createForm.machine_speed) : null,
                machine_pressure: createForm.machine_pressure || null,
                temperature_c: createForm.temperature_c ? parseFloat(createForm.temperature_c) : null,
                duration_min: createForm.duration_min ? parseInt(createForm.duration_min, 10) : null,
                operator_name: createForm.operator_name || null,
                notes: createForm.notes || null,
                input_batch_id: createForm.input_batch_id || null,
            };
            const res = await authFetch(`${API_BASE}/dyeing-runs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                setErrorMsg(err.detail || 'Failed to create run.');
            } else {
                setCreateWo(null);
                setCreateForm(emptyCreateForm);
                reloadRuns();
            }
        } catch {
            setErrorMsg('Network error creating run.');
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
    const thStyle: React.CSSProperties = classic
        ? lvThSticky(true, { border: '1px solid #808080' })
        : { fontSize: '9pt', fontWeight: 'bold', whiteSpace: 'nowrap' };
    const tdBase: React.CSSProperties = classic
        ? { ...lvTd(true), border: '1px solid #c0bdb5' }
        : { verticalAlign: 'middle' };

    const filterBarStyle: React.CSSProperties = classic ? {
        background: '#d4d0c8', borderBottom: '1px solid #808080',
        padding: '4px 8px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
    } : {
        background: '#f8f9fa', borderBottom: '1px solid #dee2e6',
        padding: '6px 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
    };

    const subTh = lvSubTh(classic, true);
    const subTd = lvSubTd(classic, true);

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
                    <ExpandedRowPanel classic={classic}>
                        <div style={{
                            display: 'grid', gridTemplateColumns: '270px minmax(0, 1fr)',
                            border: classic ? '1px solid #7f9db9' : '1px solid #dee2e6',
                            fontFamily: xpFont, fontSize: 10,
                        }}>
                            {/* Order — the chain this bath hangs off, so QC can judge the
                                colour against the order it belongs to without leaving. */}
                            <div style={{ borderRight: '1px solid #c0bdb5', padding: '6px 8px', background: '#f5f4ef' }}>
                                <div style={colHeaderStyle}>Order</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, fontSize: 9 }}>
                                    <span style={{ color: '#888' }}>MO</span>
                                    <CodeChip code={wo.mo_code} classic={classic} style={{ fontSize: 9 }} />
                                </div>
                                {wo.root_mo_code && wo.root_mo_code !== wo.mo_code && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, fontSize: 9 }}>
                                        <span style={{ color: '#888' }}>Root MO</span>
                                        <CodeChip code={wo.root_mo_code} classic={classic} tier={2} style={{ fontSize: 9 }} />
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
                                        <button
                                            type="button"
                                            onClick={() => handleOpenCreateRun(wo)}
                                            style={{ fontFamily: xpFont, fontSize: 8, padding: '0 6px', cursor: 'pointer', background: 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid #808080', color: '#000040', textTransform: 'none', letterSpacing: 0 }}
                                            title="Cut an extra bath by hand — runs are normally created with the work order"
                                        >
                                            + Create Run
                                        </button>
                                    )}
                                </div>
                                {runsLoading && !sum.runs.length ? (
                                    <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: 9 }}>Loading...</div>
                                ) : sum.runs.length === 0 ? (
                                    <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: 9 }}>No baths on this work order.</div>
                                ) : (
                                    <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                                        <table style={{ ...lvSubTable(classic), border: 'none' }}>
                                            <thead>
                                                <tr>
                                                    <th style={{ ...subTh, width: 34 }}>Run</th>
                                                    <th style={subTh}>Recipe</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 62 }}>Substrate</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 62 }} title="Bath planned when the WO was cut">Plan L</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 62 }} title="Water the floor actually filled">Actual L</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 52 }}>L:R</th>
                                                    <th style={{ ...subTh, width: 78 }}>Status</th>
                                                    <th style={{ ...subTh, width: 62 }}>Shade</th>
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
                                                    // Gate the action on the bath's own facts, not on `status`:
                                                    // status is derived from the WO too (backend
                                                    // services/dyeing_run_service), so a closed WO shows its
                                                    // baths COMPLETED — and the shade is QC at a later moment,
                                                    // which must stay recordable after the WO is finished.
                                                    const bathClosed = !!run.completed_at;
                                                    const bathFilled = !!run.started_at || run.volume_air_liters != null;
                                                    return (
                                                        <tr key={run.id} style={lvSubRow(classic, ri)}>
                                                            <td style={{ ...subTd, fontWeight: 'bold' }}>#{run.run_number}</td>
                                                            <td style={{ ...subTd, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={recipeName || undefined}>
                                                                {recipeName ?? <Dash classic={classic} />}
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
                                                                    ? <ShadeChip shade={run.shade_result} classic={classic} />
                                                                    : <Dash classic={classic} />}
                                                            </td>
                                                            <td style={{ ...subTd, color: '#666', whiteSpace: 'nowrap' }}>{fmtDateTime(run.started_at)}</td>
                                                            <td style={{ ...subTd, color: '#666', whiteSpace: 'nowrap' }}>{fmtDateTime(run.completed_at)}</td>
                                                            <td style={{ ...subTd, textAlign: 'right' }}>
                                                                {/* One action: the shade. There is no Start button —
                                                                    filling the bath is done from the WO, with the
                                                                    output it produced. A closed bath opens the same
                                                                    panel read-only, which is where the dose sheet and
                                                                    the chemicals actually used are shown. */}
                                                                <XPActionButton
                                                                    classic={classic}
                                                                    tone={!bathClosed && bathFilled && canManage ? 'primary' : 'neutral'}
                                                                    icon={bathClosed || !canManage ? 'bi-eye' : 'bi-eyedropper'}
                                                                    title={bathClosed || !canManage
                                                                        ? 'View the bath, its dose sheet and the chemicals used'
                                                                        : bathFilled
                                                                            ? 'Record the shade result and close this bath'
                                                                            : 'No bath recorded yet — the operator fills it from the work order log'}
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

    const shadeModalClosed = !!showCompleteModal?.completed_at;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, fontFamily: classic ? xpFont : modernFont }}>
            {/* Filter bar */}
            <div style={filterBarStyle}>
                <label style={{ fontSize: classic ? 10 : 11, color: classic ? '#000' : '#555', whiteSpace: 'nowrap' }}>Filter:</label>
                <SearchField classic={classic} value={searchInput} onChange={setSearch} placeholder="Search WO / MO..." width={classic ? 160 : 180} />
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    style={classic ? { ...formInput, width: 110 } : { width: 130 }}
                    className={classic ? '' : 'form-select form-select-sm'}>
                    <option value="">All Statuses</option>
                    {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <select value={filterWC} onChange={e => setFilterWC(e.target.value)}
                    style={classic ? { ...formInput, width: 150 } : { width: 170 }}
                    className={classic ? '' : 'form-select form-select-sm'}>
                    <option value="">All Vessels</option>
                    {dyeVessels.map((wc: any) => <option key={wc.id} value={wc.id}>{wc.name}</option>)}
                </select>
                {(filterStatus || filterWC || searchInput) && (
                    <button onClick={() => { setFilterStatus(''); setFilterWC(''); setSearch(''); }}
                        style={classic ? { ...formInput, width: 'auto', cursor: 'pointer', height: 20 } : undefined}
                        className={classic ? '' : 'btn btn-sm btn-outline-secondary'}>
                        Clear
                    </button>
                )}
                <span style={{ marginLeft: 'auto', fontSize: classic ? 10 : 11, color: classic ? '#333' : '#888', whiteSpace: 'nowrap' }}>
                    {woLoading ? 'Loading...' : `${woTotal} dyeing work order${woTotal === 1 ? '' : 's'}`}
                </span>
            </div>

            {/* Table */}
            <div className="table-responsive" style={{ flex: 1, overflow: 'auto', minHeight: 0, background: '#fff' }}>
                <table
                    style={{ width: '100%', minWidth: 1560, borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: classic ? 11 : undefined, fontFamily: classic ? xpFont : undefined, background: classic ? '#fff' : undefined }}
                    className={classic ? '' : 'table table-hover align-middle mb-0'}
                >
                    <colgroup>
                        <col style={{ width: LV_EXPANDER_COL_W }} /> {/* chevron */}
                        <col style={{ width: '13%' }} />  {/* WO */}
                        <col style={{ width: 170 }} />    {/* MO */}
                        <col style={{ width: '14%' }} />  {/* Product */}
                        <col style={{ width: '15%' }} />  {/* Variant */}
                        <col style={{ width: '10%' }} />  {/* Vessel */}
                        <col style={{ width: '12%' }} />  {/* Recipe */}
                        <col style={{ width: 74 }} />     {/* Substrate */}
                        <col style={{ width: 74 }} />     {/* Bath L */}
                        <col style={{ width: 86 }} />     {/* Target/Done */}
                        <col style={{ width: 58 }} />     {/* Baths */}
                        <col style={{ width: 74 }} />     {/* Shade */}
                        <col style={{ width: 104 }} />    {/* Status */}
                        <col style={{ width: 52 }} />     {/* Actions */}
                    </colgroup>
                    <thead>
                        <tr className={classic ? '' : 'table-light'}>
                            <th style={{ ...thStyle, width: 22, padding: '3px 4px' }} className={classic ? '' : 'ps-3'} />
                            {([
                                ['WO', 'code'], ['MO', 'mo'], ['Product', 'product'], ['Variant', ''],
                                ['Vessel', 'wc'], ['Recipe', 'recipe'], ['Substrate', ''], ['Bath (L)', ''],
                                ['Target / Done', 'done'], ['Baths', ''], ['Shade', 'shade'],
                                ['Status', 'status'], ['', ''],
                            ] as [string, string][]).map(([h, key], i) => (
                                <SortableTh key={`${h}-${i}`}
                                    sort={sort} colKey={key || null} onSort={toggleSort}
                                    style={{ ...thStyle, textAlign: ['Substrate', 'Bath (L)'].includes(h) ? 'right' : h === '' ? 'right' : 'left' }}
                                    className={classic ? '' : 'ps-3'}>
                                    {h}
                                </SortableTh>
                            ))}
                        </tr>
                    </thead>
                    <tbody ref={listBodyRef}>
                        {workOrders.length === 0 && (woLoading ? (
                            <TableSkeleton rows={8} cols={skel.cols ?? COLS} classic={classic} tdStyle={tdBase} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                        ) : (
                            <tr>
                                <td colSpan={COLS} style={classic ? { padding: 0 } : { padding: 24, textAlign: 'center', color: '#888' }}>
                                    {classic
                                        ? <XPEmptyState message="No dyeing work orders found." icon="bi-droplet-half" />
                                        : 'No dyeing work orders found.'}
                                </td>
                            </tr>
                        ))}
                        {sortedWOs.map((wo: any, idx: number) => {
                            const id = String(wo.id);
                            const isExpanded = expandedId === id;
                            const sum = summarize(runsByWo[id] || []);
                            const cur = sum.current;
                            const toggleRow = () => setExpandedId(prev => prev === id ? null : id);
                            return (
                                <React.Fragment key={id}>
                                    <tr
                                        style={{
                                            background: isExpanded ? rowStateBg('expanded', classic) : (classic ? lvZebra(true, idx) : undefined),
                                            cursor: 'pointer',
                                        }}
                                        onClick={toggleRow}
                                    >
                                        <ExpanderCell classic={classic} expanded={isExpanded} onToggle={toggleRow} tdStyle={tdBase} tdClassName={classic ? '' : 'ps-2'} label="dyeing order detail" />
                                        <td style={{ ...tdBase, overflow: 'hidden' }} title={wo.code || wo.name}>
                                            <CodeChip
                                                code={wo.code || wo.name}
                                                classic={classic}
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
                                                    <CodeChip code={wo.root_mo_code} classic={classic} tier={2} style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis' }} />
                                                    {(wo.root_mo_count ?? 0) > 1 && (
                                                        <span
                                                            title={`Shared component — feeds ${wo.root_mo_count} root MOs: ${(wo.root_mo_codes || []).join(', ')}`}
                                                            style={{ borderRadius: CHIP_RADIUS, fontSize: 9, fontWeight: 'bold', color: '#7a5000', background: '#fff3cd', border: '1px solid #b8860b', padding: '0 3px', flexShrink: 0 }}
                                                        >+{(wo.root_mo_count ?? 1) - 1}</span>
                                                    )}
                                                </div>
                                            ) : <span style={{ color: '#bbb' }}>—</span>}
                                        </td>
                                        <td style={{ ...tdBase, fontSize: classic ? 10 : 11, color: '#444', overflow: 'hidden' }} title={wo.item_name || ''}>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{wo.item_name || '—'}</span>
                                        </td>
                                        {/* Colour is the point of a dyeing order, so the variant chips get
                                            their own column rather than the right edge of Product. */}
                                        <td style={{ ...tdBase, fontSize: classic ? 10 : 11, overflow: 'hidden', whiteSpace: 'normal' }}>
                                            <VariantChips
                                                combo={wo.combo_label}
                                                size={wo.size_label}
                                                colorVariant={wo.color_label}
                                                colorCode={wo.color_code}
                                                colorName={wo.color_name}
                                                colorHex={wo.color_hex}
                                                labdipCode={wo.labdip_variant_code}
                                                classic={classic}
                                                style={{ flexWrap: 'wrap', rowGap: 2 }}
                                            />
                                        </td>
                                        <td style={{ ...tdBase, fontSize: classic ? 10 : 11, overflow: 'hidden' }}>
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
                                        <td style={{ ...tdBase, fontSize: classic ? 10 : 11, overflow: 'hidden' }}
                                            title={cur?.recipe_name || undefined}>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                                                {cur?.recipe_name
                                                    ?? recipes.find(r => String(r.id) === String(cur?.recipe_id))?.name
                                                    ?? <span style={{ color: '#bbb' }}>—</span>}
                                            </span>
                                        </td>
                                        <td style={{ ...tdBase, fontSize: classic ? 10 : 11, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            {cur ? fmtDose(cur.substrate_qty, 2) : <span style={{ color: '#bbb' }}>—</span>}
                                        </td>
                                        {/* The bath every dose is weighed from: the actual once the floor
                                            filled it, the plan until then (backend effective_bath_liters).
                                            A plan is greyed so a supervisor can tell a proposal from a fact. */}
                                        <td style={{ ...tdBase, fontSize: classic ? 10 : 11, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            {cur ? (
                                                <span
                                                    style={{ color: cur.volume_air_liters != null ? undefined : '#888', fontStyle: cur.volume_air_liters != null ? undefined : 'italic' }}
                                                    title={cur.volume_air_liters != null ? 'Bath the floor filled' : 'Planned bath — the floor has not recorded one yet'}
                                                >
                                                    {fmtDose(cur.effective_bath_liters ?? cur.volume_air_liters ?? cur.planned_volume_air_liters, 1)}
                                                </span>
                                            ) : <span style={{ color: '#bbb' }}>—</span>}
                                        </td>
                                        <td style={{ ...tdBase, fontSize: classic ? 10 : 11 }}>
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
                                        <td style={{ ...tdBase, fontSize: classic ? 10 : 11, textAlign: 'center', whiteSpace: 'nowrap' }}>
                                            {sum.runs.length === 0
                                                ? <span style={{ color: '#bbb' }}>—</span>
                                                : (
                                                    <span
                                                        title={`${sum.runs.length} bath${sum.runs.length === 1 ? '' : 'es'}, ${sum.closed} closed`}
                                                        style={{ fontFamily: CODE_FONT, fontSize: classic ? 10 : 11, color: sum.open ? '#0058e6' : '#555' }}
                                                    >
                                                        {sum.closed}/{sum.runs.length}
                                                    </span>
                                                )}
                                        </td>
                                        <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>
                                            {sum.shade
                                                ? <ShadeChip shade={sum.shade} classic={classic} />
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
                                                    classic={classic}
                                                    tone={canManage ? 'primary' : 'neutral'}
                                                    icon={canManage ? 'bi-eyedropper' : 'bi-eye'}
                                                    title={canManage
                                                        ? `Record the shade result for bath #${sum.open.run_number}`
                                                        : 'View the bath and the chemicals used'}
                                                    onClick={() => handleOpenShade(sum.open)}
                                                />
                                            ) : sum.current ? (
                                                <XPActionButton
                                                    classic={classic}
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
                </table>
            </div>

            <Pager page={page} total={woTotal} pageSize={WO_PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />

            {/* Create Run — a bath cut by hand. Modal rather than an inline strip:
                the list is one full-width table now, and a form wedged above it
                pushed every row off screen. */}
            {createWo && (
                <ModalWrapper
                    isOpen={!!createWo}
                    onClose={() => { setCreateWo(null); setCreateForm(emptyCreateForm); setErrorMsg(null); }}
                    title={`New Dyeing Run — ${createWo.code || createWo.name}`}
                    size="lg"
                    footer={<>
                        <button className={XP_BTN} style={classic ? { ...xpPrimaryBtn, padding: '3px 16px' } : { ...xpPrimaryBtn, padding: '6px 18px' }} onClick={handleSaveRun} disabled={saving}>
                            {saving ? 'Saving...' : 'Save Run'}
                        </button>
                        <button className={XP_BTN} style={classic ? { ...xpBtn, padding: '3px 16px' } : { ...xpBtn, padding: '6px 18px' }} onClick={() => { setCreateWo(null); setCreateForm(emptyCreateForm); setErrorMsg(null); }} disabled={saving}>
                            Cancel
                        </button>
                    </>}
                >
                    <div>
                        {errorMsg && (
                            <div style={classic
                                ? { background: '#fff3cd', border: '1px solid #ffc107', padding: '3px 8px', fontSize: 11, color: '#664d03', marginBottom: 6 }
                                : { background: '#fef3cd', border: '1px solid #f0d98a', borderRadius: 7, padding: '6px 10px', fontSize: 13, color: '#854d0e', marginBottom: 10 }}>
                                {errorMsg}
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 12px' }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}>Recipe</span>
                                <select
                                    style={classic ? { ...xpInput, height: 22 } : { ...xpInput, height: 30 }}
                                    value={createForm.recipe_id}
                                    onChange={e => handleCreateFormChange('recipe_id', e.target.value)}
                                >
                                    <option value="">-- select recipe --</option>
                                    {recipes.map(r => (
                                        <option key={r.id} value={r.id}>{r.name ?? r.recipe_code ?? `Recipe ${r.id}`}</option>
                                    ))}
                                </select>
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}>Substrate Qty</span>
                                <input type="number" style={xpInput} value={createForm.substrate_qty}
                                    onChange={e => handleCreateFormChange('substrate_qty', e.target.value)}
                                    placeholder={createWo.qty != null ? `WO qty ${createWo.qty}` : 'e.g. 100'} />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}>Input Lot</span>
                                <input type="text" style={xpInput} value={createForm.input_batch_id}
                                    onChange={e => handleCreateFormChange('input_batch_id', e.target.value)} placeholder="lot number" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span
                                    style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}
                                    title="Litres of water per kg of substrate. Used to derive the bath volume when Volume Air is left blank; an entered Volume Air always wins."
                                >Liquor Ratio (1:x)</span>
                                <input type="number" style={xpInput} value={createForm.liquor_ratio}
                                    onChange={e => handleCreateFormChange('liquor_ratio', e.target.value)} placeholder="e.g. 10" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span
                                    style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}
                                    title="Water volume of the bath, in litres. Every g/L chemical is weighed out against this. Leave blank to have it derived from the liquor ratio."
                                >Volume Air (L)</span>
                                <input type="number" step="0.1" style={xpInput} value={createForm.volume_air_liters}
                                    onChange={e => handleCreateFormChange('volume_air_liters', e.target.value)} placeholder="e.g. 190" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}>Speed</span>
                                <input type="number" step="0.1" style={xpInput} value={createForm.machine_speed}
                                    onChange={e => handleCreateFormChange('machine_speed', e.target.value)} placeholder="e.g. 7" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}>Tekanan (Pressure)</span>
                                <input type="text" style={xpInput} value={createForm.machine_pressure}
                                    onChange={e => handleCreateFormChange('machine_pressure', e.target.value)} placeholder="pressure" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}>Temperature (C)</span>
                                <input type="number" style={xpInput} value={createForm.temperature_c}
                                    onChange={e => handleCreateFormChange('temperature_c', e.target.value)} placeholder="e.g. 60" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}>Duration (min)</span>
                                <input type="number" style={xpInput} value={createForm.duration_min}
                                    onChange={e => handleCreateFormChange('duration_min', e.target.value)} placeholder="e.g. 45" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}>Operator Name</span>
                                <input type="text" style={xpInput} value={createForm.operator_name}
                                    onChange={e => handleCreateFormChange('operator_name', e.target.value)} placeholder="operator" />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1, gridColumn: 'span 2' }}>
                                <span style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}>Notes</span>
                                <input type="text" style={xpInput} value={createForm.notes}
                                    onChange={e => handleCreateFormChange('notes', e.target.value)} placeholder="optional" />
                            </label>
                        </div>
                        {createForm.recipe_id && (
                            <DoseSheet
                                classic={classic}
                                doses={dosePreview}
                                emptyHint="This recipe has no chemical lines to weigh out."
                                style={{ marginTop: classic ? 6 : 10 }}
                            />
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
                                style={classic ? { ...xpBtn, padding: '3px 16px' } : { ...xpPrimaryBtn, padding: '6px 18px' }}
                                onClick={handleSaveShade}
                                disabled={saving}
                            >
                                {saving ? 'Saving...' : 'Save & Close Bath'}
                            </button>
                        )}
                        <button
                            className={XP_BTN}
                            style={classic ? { ...xpBtn, padding: '3px 16px' } : { ...xpBtn, padding: '6px 18px' }}
                            onClick={() => { setShowCompleteModal(null); setErrorMsg(null); }}
                            disabled={saving}
                        >
                            {shadeModalClosed || !canManage ? 'Close' : 'Cancel'}
                        </button>
                    </>}
                >
                    <div>
                        {errorMsg && (
                            <div style={classic
                                ? { background: '#fff3cd', border: '1px solid #ffc107', padding: '3px 8px', fontSize: 11, color: '#664d03', marginBottom: 6 }
                                : { background: '#fef3cd', border: '1px solid #f0d98a', borderRadius: 7, padding: '6px 10px', fontSize: 13, color: '#854d0e', marginBottom: 10 }}>
                                {errorMsg}
                            </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginBottom: 8 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}>Shade Result</span>
                                <select
                                    style={classic ? { ...xpInput, height: 22 } : { ...xpInput, height: 30 }}
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
                                <span style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}>Output Lot</span>
                                <span
                                    style={classic
                                        ? { fontSize: 11, padding: '2px 4px', color: showCompleteModal.output_batch_number ? '#333' : '#888' }
                                        : { fontSize: 13, padding: '4px 2px', fontFamily: modernFont, color: showCompleteModal.output_batch_number ? '#334155' : '#94a3b8' }}
                                    title="The dyed lot is created when the work order's output is logged, and this run picks it up automatically — one lot per physical dye batch."
                                >
                                    {showCompleteModal.output_batch_number || 'set when the WO output is logged'}
                                </span>
                            </div>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 1, gridColumn: '1 / -1' }}>
                                <span style={classic ? { fontSize: 10, color: '#444' } : { fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 2 }}>Shade Notes</span>
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
                            ...(classic ? { border: '1px solid #7f9db9', background: 'white' } : { background: '#fff', border: '1px solid #dbe1ea', borderRadius: 9, overflow: 'hidden' }),
                            marginBottom: classic ? 6 : 10,
                        }}>
                            <div style={classic ? {
                                background: FORM_SECTION_BLUE, color: 'white', padding: '3px 8px',
                                fontFamily: xpFont, fontSize: 11, fontWeight: 'bold',
                            } : {
                                background: '#eef1f6', color: '#475569', textTransform: 'uppercase',
                                fontWeight: 700, fontSize: 11, letterSpacing: '0.04em', padding: '7px 12px',
                                borderBottom: '1px solid #dbe1ea', fontFamily: modernFont,
                            }}>Bath as Recorded</div>
                            <div style={{ padding: classic ? '5px 8px' : '8px 12px', display: 'flex', gap: classic ? 16 : 24, flexWrap: 'wrap', fontSize: classic ? 11 : 13 }}>
                                <span>Volume Air: <strong>{showCompleteModal.volume_air_liters != null ? `${fmtDose(showCompleteModal.volume_air_liters, 1)} L` : '—'}</strong></span>
                                <span>Planned: <strong>{showCompleteModal.planned_volume_air_liters != null ? `${fmtDose(showCompleteModal.planned_volume_air_liters, 1)} L` : '—'}</strong></span>
                                <span>Substrate: <strong>{showCompleteModal.substrate_qty != null ? `${fmtDose(showCompleteModal.substrate_qty, 2)} kg` : '—'}</strong></span>
                                <span>Liquor Ratio: <strong>{showCompleteModal.liquor_ratio != null ? `1 : ${fmtDose(showCompleteModal.liquor_ratio, 2)}` : '—'}</strong></span>
                            </div>
                        </div>

                        {showCompleteModal.recipe_id && (
                            <DoseSheet
                                classic={classic}
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
                            ...(classic ? { border: '1px solid #7f9db9', background: 'white' } : { background: '#fff', border: '1px solid #dbe1ea', borderRadius: 9, overflow: 'hidden' }),
                            marginTop: classic ? 6 : 10,
                        }}>
                            <div style={classic ? {
                                background: FORM_SECTION_BLUE, color: 'white', padding: '3px 8px',
                                fontFamily: xpFont, fontSize: 11, fontWeight: 'bold',
                            } : {
                                background: '#eef1f6', color: '#475569', textTransform: 'uppercase',
                                fontWeight: 700, fontSize: 11, letterSpacing: '0.04em', padding: '7px 12px',
                                borderBottom: '1px solid #dbe1ea', fontFamily: modernFont,
                            }}>Chemicals Used</div>
                            {(showCompleteModal.chemicals ?? []).length === 0 ? (
                                <div style={{ padding: classic ? '6px 8px' : '8px 12px', color: classic ? '#888' : '#64748b', fontSize: classic ? 11 : 13 }}>
                                    Nothing recorded yet — the operator enters what went in with the
                                    work order&apos;s production log.
                                </div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: classic ? 11 : 13 }}>
                                    <thead>
                                        <tr style={classic ? { background: '#ece9d8', borderBottom: '1px solid #7f9db9' } : {}}>
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
                                                <tr key={c.id ?? idx} style={lvSubRow(classic, idx)}>
                                                    <td style={subTd}>
                                                        {c.item_name ?? items.find(it => String(it.id) === String(c.item_id))?.name ?? <Dash classic={classic} />}
                                                    </td>
                                                    <td style={{ ...subTd, textAlign: 'right', whiteSpace: 'nowrap', color: '#666' }}>
                                                        {fmtDose(planned, 3)}{unit ? ` ${unit}` : ''}
                                                    </td>
                                                    <td style={{ ...subTd, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
                                                        {actual > 0 ? `${fmtDose(actual, 3)}${unit ? ` ${unit}` : ''}` : <Dash classic={classic} />}
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
