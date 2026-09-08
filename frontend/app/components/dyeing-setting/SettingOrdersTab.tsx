'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useData } from '../../context/DataContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import { useUser } from '../../context/UserContext';
import { useTimezone } from '../../context/TimezoneContext';
import Pager from '../shared/Pager';
import ModalWrapper from '../shared/ModalWrapper';
import { API_BASE } from '../shared/apiBase';
import {
    CodeChip, xpFont, CODE_FONT, StatusChip, XP_BTN, CHIP_RADIUS, colorLabel, rowStateBg,
    ProgressBar, ExpandedRowPanel, XPEmptyState, TableSkeleton, useTableSkeletonMetrics,
    useSortable, XPActionButton, xpInput as xpInputBase,
} from '../shared/xpTheme';
import { orDash, fmtQtyFixed } from '../shared/format';
import {
    SortableTh, ExpanderCell, LV_EXPANDER_COL_W, lvThSticky, lvTd, lvZebra,
    lvSubTable, lvSubTh, lvSubTd, lvSubRow, Dash, lvBtn, lvInput,
} from '../shared/listViewTheme';
import { SearchField } from '../shared/shellTheme';
import { getChipStyle } from '../manufacturing/WorkOrderPanel';
import VariantChips from '../shared/VariantChips';
import { isMachineWC } from '../shared/workCenterTree';

// ── Fonts ─────────────────────────────────────────────────────────────────────
const modernFont = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const SO_WO_PAGE_SIZE = 25;
const STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
/** 13 columns: chevron + 11 data + actions. */
const COLS = 13;

// ── Style helpers (theme-aware) ───────────────────────────────────────────────
const xpInput = (classic: boolean): React.CSSProperties => lvInput(classic, classic ? { padding: '1px 4px', width: 'auto' } : { height: 'auto' });
const xpBtn = (classic: boolean): React.CSSProperties => lvBtn(classic, 'default', classic ? { fontSize: 10, padding: '2px 8px' } : {});
const xpBtnPrimary = (classic: boolean): React.CSSProperties => lvBtn(classic, 'primary', classic ? { fontSize: 10, padding: '2px 8px' } : {});

// ── Types ─────────────────────────────────────────────────────────────────────
interface CreateForm {
    substrate_qty: string;
    machine_name: string;
    temperature_c: string;
    speed_mpm: string;
    width_cm: string;
    overfeed_pct: string;
    operator_name: string;
    notes: string;
    input_batch_id_text: string;
}

interface CompleteForm {
    output_batch_number: string;
    actual_width_cm: string;
    actual_gsm: string;
    actual_shrinkage_pct: string;
}

interface Props {
    items: any[];
    /** Typed rather than bare `Function` so usePaginatedFetch accepts it. */
    authFetch: (url: string, options?: any) => Promise<Response>;
}

const EMPTY_CREATE: CreateForm = {
    substrate_qty: '', machine_name: '', temperature_c: '', speed_mpm: '',
    width_cm: '', overfeed_pct: '', operator_name: '', notes: '', input_batch_id_text: '',
};

const EMPTY_COMPLETE: CompleteForm = {
    output_batch_number: '', actual_width_cm: '', actual_gsm: '', actual_shrinkage_pct: '',
};

const fmtNum = (v: any, decimals = 2) => orDash(v, x => fmtQtyFixed(x, decimals));

/** One WO's setting runs, rolled up for its list row. */
interface RunSummary {
    runs: any[];
    /** The run the floor is on: the first not closed, else the last one cut. */
    current: any | null;
    open: any | null;
    completed: number;
    /** The lot the last completed run put out — this WO's visible output. */
    outputLot: string | null;
}

const EMPTY_SUMMARY: RunSummary = { runs: [], current: null, open: null, completed: 0, outputLot: null };

function summarize(runs: any[]): RunSummary {
    if (!runs.length) return EMPTY_SUMMARY;
    const open = runs.find(r => r.status !== 'COMPLETED' && r.status !== 'CANCELLED') ?? null;
    const done = runs.filter(r => r.status === 'COMPLETED');
    return {
        runs,
        current: open ?? runs[runs.length - 1],
        open,
        completed: done.length,
        outputLot: done.length ? (done[done.length - 1].output_batch_number ?? null) : null,
    };
}

export default function SettingOrdersTab({ items, authFetch }: Props) {
    const { uiStyle } = useTheme();
    const { workCenters } = useData();
    const { formatCustom: tzFmt } = useTimezone();
    const classic = uiStyle === 'classic';
    const { hasPermission } = useUser();
    const canManage = hasPermission('work_order.log');

    const formInput: React.CSSProperties = xpInputBase({ padding: '1px 4px' });

    const [filterStatus, setFilterStatus] = useState('');
    const [filterWC, setFilterWC] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const [createWo, setCreateWo] = useState<any | null>(null);
    const [showCompleteModal, setShowCompleteModal] = useState<any | null>(null);
    const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
    const [completeForm, setCompleteForm] = useState<CompleteForm>(EMPTY_COMPLETE);
    const [saving, setSaving] = useState(false);
    const [completing, setCompleting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // ── WOs (server-paginated) ────────────────────────────────────────────────
    // The same endpoint the Work Orders page reads: this list is the WO table
    // filtered to setting, so it must not re-derive its own shape.
    const {
        rows: workOrders, total: woTotal, loading,
        page, setPage, searchInput, setSearch,
    } = usePaginatedFetch<any>({
        endpoint: `${API_BASE}/work-orders`,
        authFetch,
        pageSize: SO_WO_PAGE_SIZE,
        params: { center_type: 'SETTING', status: filterStatus, work_center_id: filterWC },
    });

    // ── Runs for the visible page, in one call ────────────────────────────────
    // Keyed by WO id. Fetched for the whole page rather than per expanded row: the
    // machine, the setting parameters and the measured output are list columns
    // here, and a request per row is 25 round trips for a screen the supervisor is
    // scanning, not drilling.
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
                const res = await authFetch(`${API_BASE}/setting-runs?work_order_ids=${encodeURIComponent(woIdsKey)}`);
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
                /* the rows degrade to "no run recorded" rather than blocking the list */
            } finally {
                if (gen === runsGen.current) setRunsLoading(false);
            }
        })();
    }, [woIdsKey, runsNonce, authFetch]);

    const reloadRuns = useCallback(() => setRunsNonce(n => n + 1), []);

    // ── Setting machines for the filter ───────────────────────────────────────
    const setMachines = useMemo(() => (workCenters || [])
        .filter((wc: any) => isMachineWC(wc) && String(wc.center_type || '').toUpperCase() === 'SETTING')
        .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true })),
        [workCenters]);

    // ── Sorting (the loaded page, same as the Work Orders list) ───────────────
    const { sorted: sortedWOs, sort, toggle: toggleSort } = useSortable(workOrders, {
        code: (w: any) => w.code || w.name,
        mo: (w: any) => w.root_mo_code || w.mo_code,
        product: (w: any) => w.item_name,
        wc: (w: any) => w.work_center_name,
        done: (w: any) => (w.qty ? (w.qty_completed_total ?? 0) / w.qty : null),
        lot: (w: any) => summarize(runsByWo[String(w.id)] || []).outputLot,
        status: (w: any) => w.status,
    });

    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('setting-orders', listBodyRef, workOrders.length > 0);

    // ── Create Run ────────────────────────────────────────────────────────────
    const handleOpenCreateRun = (wo: any) => {
        setCreateWo(wo);
        setCreateForm(EMPTY_CREATE);
        setErrorMsg(null);
    };

    const handleCreateRun = async () => {
        if (!createWo) return;
        setSaving(true);
        setErrorMsg(null);
        try {
            const payload: any = {
                work_order_id: String(createWo.id),
                machine_name: createForm.machine_name.trim() || undefined,
                operator_name: createForm.operator_name.trim() || undefined,
                notes: createForm.notes.trim() || undefined,
                input_batch_id_text: createForm.input_batch_id_text.trim() || undefined,
            };
            // `substrate_qty` is required by the payload schema — fall back to the
            // WO's own qty, the way the dyeing side defaults it server-side.
            payload.substrate_qty = createForm.substrate_qty !== ''
                ? parseFloat(createForm.substrate_qty)
                : (createWo.qty ?? 0);
            if (createForm.temperature_c !== '') payload.temperature_c = parseFloat(createForm.temperature_c);
            if (createForm.speed_mpm !== '') payload.speed_mpm = parseFloat(createForm.speed_mpm);
            if (createForm.width_cm !== '') payload.width_cm = parseFloat(createForm.width_cm);
            if (createForm.overfeed_pct !== '') payload.overfeed_pct = parseFloat(createForm.overfeed_pct);

            const res = await authFetch(`${API_BASE}/setting-runs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                setErrorMsg(err.detail || 'Failed to create run.');
            } else {
                setCreateWo(null);
                setCreateForm(EMPTY_CREATE);
                reloadRuns();
            }
        } catch {
            setErrorMsg('Network error creating run.');
        } finally {
            setSaving(false);
        }
    };

    // ── Start Run ─────────────────────────────────────────────────────────────
    const handleStartRun = async (run: any) => {
        try {
            const res = await authFetch(`${API_BASE}/setting-runs/${run.id}/start`, { method: 'POST' });
            if (res.ok) reloadRuns();
        } catch {
            // silent
        }
    };

    // ── Complete Run ──────────────────────────────────────────────────────────
    const handleCompleteRun = async () => {
        if (!showCompleteModal) return;
        if (!completeForm.output_batch_number.trim()) return;
        setCompleting(true);
        setErrorMsg(null);
        try {
            const payload: any = { output_batch_number: completeForm.output_batch_number.trim() };
            if (completeForm.actual_width_cm !== '') payload.actual_width_cm = parseFloat(completeForm.actual_width_cm);
            if (completeForm.actual_gsm !== '') payload.actual_gsm = parseFloat(completeForm.actual_gsm);
            if (completeForm.actual_shrinkage_pct !== '') payload.actual_shrinkage_pct = parseFloat(completeForm.actual_shrinkage_pct);

            const res = await authFetch(`${API_BASE}/setting-runs/${showCompleteModal.id}/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                setErrorMsg(err.detail || 'Failed to complete the run.');
            } else {
                setShowCompleteModal(null);
                setCompleteForm(EMPTY_COMPLETE);
                reloadRuns();
            }
        } catch {
            setErrorMsg('Network error completing the run.');
        } finally {
            setCompleting(false);
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

    // ── Styles ────────────────────────────────────────────────────────────────
    // Full cell borders rather than lvTd's single rule — same call the Work Orders
    // list makes, and these rows carry the same density of numbers.
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

    const labelStyle: React.CSSProperties = classic ? {
        fontFamily: xpFont, fontSize: 10, color: '#000', display: 'block', marginBottom: 1,
    } : {
        fontFamily: modernFont, fontSize: 12, color: '#64748b', display: 'block', marginBottom: 3, fontWeight: 500,
    };

    const fieldRow = (label: string, field: keyof CreateForm, type = 'text', placeholder?: string) => (
        <div style={{ marginBottom: 6 }}>
            <label style={labelStyle}>{label}</label>
            <input
                type={type}
                style={{ ...xpInput(classic), width: '100%' }}
                value={createForm[field]}
                placeholder={placeholder}
                onChange={e => setCreateForm(f => ({ ...f, [field]: e.target.value }))}
            />
        </div>
    );

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
                            {/* Order — the chain this run hangs off, so the measured
                                output can be judged against the order it belongs to. */}
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
                                {infoRow('Work Center', wo.work_center_name || '—')}
                                <div style={{ borderTop: '1px solid #e0ddd8', margin: '3px 0' }} />
                                {infoRow('Target Start', fmtDate(wo.target_start_date))}
                                {infoRow('Target End', fmtDate(wo.target_end_date))}
                                {infoRow('Actual Start', fmtDateTime(wo.actual_start_date))}
                                {infoRow('Actual End', fmtDateTime(wo.actual_end_date))}
                                {infoRow('Created', fmtDateTime(wo.created_at))}
                                <div style={{ borderTop: '1px solid #e0ddd8', margin: '3px 0' }} />
                                {infoRow('Logged', `${(wo.qty_completed_total ?? 0).toFixed(2)}${wo.qty != null ? ` / ${wo.qty}` : ''}`)}
                                {(wo.qty_rejected_total ?? 0) > 0 && infoRow('Rejected', (wo.qty_rejected_total ?? 0).toFixed(2))}
                                {infoRow('Runs', `${sum.runs.length} (${sum.completed} completed)`)}
                                {wo.notes && (
                                    <div style={{ marginTop: 4, padding: '2px 5px', background: '#fffbe6', border: '1px solid #e0d080', fontSize: 9, fontStyle: 'italic', color: '#666' }}>
                                        {wo.notes}
                                    </div>
                                )}
                            </div>

                            {/* Runs — set parameters against what came off the machine.
                                Set vs actual width/GSM/shrinkage is the whole point of
                                the panel: it is the only place the two sit side by side. */}
                            <div style={{ padding: '6px 8px', background: '#f5f4ef', overflow: 'hidden' }}>
                                <div style={{ ...colHeaderStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                                    <span>Runs ({sum.runs.length})</span>
                                    {canManage && (
                                        <button
                                            type="button"
                                            onClick={() => handleOpenCreateRun(wo)}
                                            style={{ fontFamily: xpFont, fontSize: 8, padding: '0 6px', cursor: 'pointer', background: 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid #808080', color: '#000040', textTransform: 'none', letterSpacing: 0 }}
                                            title="Cut a setting run on this work order"
                                        >
                                            + Create Run
                                        </button>
                                    )}
                                </div>
                                {runsLoading && !sum.runs.length ? (
                                    <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: 9 }}>Loading...</div>
                                ) : sum.runs.length === 0 ? (
                                    <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: 9 }}>No runs on this work order.</div>
                                ) : (
                                    <div style={{ maxHeight: 240, overflow: 'auto' }}>
                                        <table style={{ ...lvSubTable(classic), border: 'none', minWidth: 940 }}>
                                            <thead>
                                                <tr>
                                                    <th style={{ ...subTh, width: 34 }}>Run</th>
                                                    <th style={{ ...subTh, width: 92 }}>Machine</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 62 }}>Substrate</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 52 }}>Temp</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 56 }}>Speed</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 62 }} title="Width the machine was set to">Set W</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 56 }}>Overfeed</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 62 }} title="Width measured off the machine">Act. W</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 56 }}>Act. GSM</th>
                                                    <th style={{ ...subTh, textAlign: 'right', width: 62 }}>Shrink %</th>
                                                    <th style={{ ...subTh, width: 78 }}>Status</th>
                                                    <th style={{ ...subTh, width: 110 }}>Output Lot</th>
                                                    <th style={{ ...subTh, width: 96 }}>Started</th>
                                                    <th style={{ ...subTh, width: 96 }}>Completed</th>
                                                    <th style={{ ...subTh, width: 30 }} />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {sum.runs.map((run: any, ri: number) => (
                                                    <tr key={run.id} style={lvSubRow(classic, ri)}>
                                                        <td style={{ ...subTd, fontWeight: 'bold' }}>#{run.run_number}</td>
                                                        <td style={{ ...subTd, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={run.machine_name || undefined}>
                                                            {run.machine_name || <Dash classic={classic} />}
                                                        </td>
                                                        <td style={{ ...subTd, textAlign: 'right' }}>{fmtNum(run.substrate_qty)}</td>
                                                        <td style={{ ...subTd, textAlign: 'right' }}>{fmtNum(run.temperature_c, 1)}</td>
                                                        <td style={{ ...subTd, textAlign: 'right' }}>{fmtNum(run.speed_mpm, 1)}</td>
                                                        <td style={{ ...subTd, textAlign: 'right', color: '#666' }}>{fmtNum(run.width_cm, 1)}</td>
                                                        <td style={{ ...subTd, textAlign: 'right', color: '#666' }}>{fmtNum(run.overfeed_pct, 2)}</td>
                                                        <td style={{ ...subTd, textAlign: 'right', fontWeight: 'bold' }}>{fmtNum(run.actual_width_cm, 1)}</td>
                                                        <td style={{ ...subTd, textAlign: 'right', fontWeight: 'bold' }}>{fmtNum(run.actual_gsm, 2)}</td>
                                                        <td style={{ ...subTd, textAlign: 'right', fontWeight: 'bold' }}>{fmtNum(run.actual_shrinkage_pct, 2)}</td>
                                                        <td style={subTd}><StatusChip status={run.status || 'PENDING'} tint /></td>
                                                        <td style={{ ...subTd, fontFamily: CODE_FONT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={run.output_batch_number || undefined}>
                                                            {run.output_batch_number || <Dash classic={classic} />}
                                                        </td>
                                                        <td style={{ ...subTd, color: '#666', whiteSpace: 'nowrap' }}>{fmtDateTime(run.started_at)}</td>
                                                        <td style={{ ...subTd, color: '#666', whiteSpace: 'nowrap' }}>{fmtDateTime(run.completed_at)}</td>
                                                        <td style={{ ...subTd, textAlign: 'right' }}>
                                                            {canManage && (!run.status || run.status === 'PENDING') && (
                                                                <XPActionButton
                                                                    classic={classic} tone="primary" icon="bi-play-fill"
                                                                    title="Start this setting run"
                                                                    onClick={() => handleStartRun(run)}
                                                                />
                                                            )}
                                                            {canManage && run.status === 'IN_PROGRESS' && (
                                                                <XPActionButton
                                                                    classic={classic} tone="success" icon="bi-check-lg"
                                                                    title="Complete this run and record the output lot"
                                                                    onClick={() => { setShowCompleteModal(run); setCompleteForm(EMPTY_COMPLETE); setErrorMsg(null); }}
                                                                />
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
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

    // ── Render ────────────────────────────────────────────────────────────────
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
                    <option value="">All Machines</option>
                    {setMachines.map((wc: any) => <option key={wc.id} value={wc.id}>{wc.name}</option>)}
                </select>
                {(filterStatus || filterWC || searchInput) && (
                    <button onClick={() => { setFilterStatus(''); setFilterWC(''); setSearch(''); }}
                        style={classic ? { ...formInput, width: 'auto', cursor: 'pointer', height: 20 } : undefined}
                        className={classic ? '' : 'btn btn-sm btn-outline-secondary'}>
                        Clear
                    </button>
                )}
                <span style={{ marginLeft: 'auto', fontSize: classic ? 10 : 11, color: classic ? '#333' : '#888', whiteSpace: 'nowrap' }}>
                    {loading ? 'Loading...' : `${woTotal} setting work order${woTotal === 1 ? '' : 's'}`}
                </span>
            </div>

            {/* Table */}
            <div className="table-responsive" style={{ flex: 1, overflow: 'auto', minHeight: 0, background: '#fff' }}>
                <table
                    style={{ width: '100%', minWidth: 1520, borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: classic ? 11 : undefined, fontFamily: classic ? xpFont : undefined, background: classic ? '#fff' : undefined }}
                    className={classic ? '' : 'table table-hover align-middle mb-0'}
                >
                    <colgroup>
                        <col style={{ width: LV_EXPANDER_COL_W }} /> {/* chevron */}
                        <col style={{ width: '13%' }} />  {/* WO */}
                        <col style={{ width: 170 }} />    {/* MO */}
                        <col style={{ width: '15%' }} />  {/* Product */}
                        <col style={{ width: '15%' }} />  {/* Variant */}
                        <col style={{ width: '11%' }} />  {/* Machine */}
                        <col style={{ width: 108 }} />    {/* Setting */}
                        <col style={{ width: 92 }} />     {/* Width */}
                        <col style={{ width: 86 }} />     {/* Target/Done */}
                        <col style={{ width: 58 }} />     {/* Runs */}
                        <col style={{ width: 120 }} />    {/* Output Lot */}
                        <col style={{ width: 104 }} />    {/* Status */}
                        <col style={{ width: 52 }} />     {/* Actions */}
                    </colgroup>
                    <thead>
                        <tr className={classic ? '' : 'table-light'}>
                            <th style={{ ...thStyle, width: 22, padding: '3px 4px' }} className={classic ? '' : 'ps-3'} />
                            {([
                                ['WO', 'code'], ['MO', 'mo'], ['Product', 'product'], ['Variant', ''],
                                ['Machine', 'wc'], ['Setting', ''], ['Width set / act', ''],
                                ['Target / Done', 'done'], ['Runs', ''], ['Output Lot', 'lot'],
                                ['Status', 'status'], ['', ''],
                            ] as [string, string][]).map(([h, key], i) => (
                                <SortableTh key={`${h}-${i}`}
                                    sort={sort} colKey={key || null} onSort={toggleSort}
                                    style={{ ...thStyle, textAlign: h === '' ? 'right' : 'left' }}
                                    className={classic ? '' : 'ps-3'}>
                                    {h}
                                </SortableTh>
                            ))}
                        </tr>
                    </thead>
                    <tbody ref={listBodyRef}>
                        {workOrders.length === 0 && (loading ? (
                            <TableSkeleton rows={8} cols={skel.cols ?? COLS} classic={classic} tdStyle={tdBase} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                        ) : (
                            <tr>
                                <td colSpan={COLS} style={classic ? { padding: 0 } : { padding: 24, textAlign: 'center', color: '#888' }}>
                                    {classic
                                        ? <XPEmptyState message="No setting work orders found." icon="bi-thermometer-half" />
                                        : 'No setting work orders found.'}
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
                                        <ExpanderCell classic={classic} expanded={isExpanded} onToggle={toggleRow} tdStyle={tdBase} tdClassName={classic ? '' : 'ps-2'} label="setting order detail" />
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
                                        {/* The work center the WO was dispatched to. The run's own
                                            free-text `machine_name` is a per-run note and lives in the
                                            expanded panel — the two are not the same field. */}
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
                                        {/* Heat and speed off the current run — the two numbers that say
                                            what the machine is actually doing to the cloth. */}
                                        <td style={{ ...tdBase, fontSize: classic ? 10 : 11, whiteSpace: 'nowrap' }}>
                                            {cur && (cur.temperature_c != null || cur.speed_mpm != null) ? (
                                                <span title="Set temperature and speed of the current run">
                                                    {cur.temperature_c != null ? `${fmtNum(cur.temperature_c, 0)}°C` : '—'}
                                                    <span style={{ color: '#aaa' }}> · </span>
                                                    {cur.speed_mpm != null ? `${fmtNum(cur.speed_mpm, 1)} m/min` : '—'}
                                                </span>
                                            ) : <span style={{ color: '#bbb' }}>—</span>}
                                        </td>
                                        {/* Set width against measured width — the variance the setting
                                            step exists to control. */}
                                        <td style={{ ...tdBase, fontSize: classic ? 10 : 11, whiteSpace: 'nowrap' }}>
                                            {cur && (cur.width_cm != null || cur.actual_width_cm != null) ? (
                                                <span title="Width the machine was set to, then the width measured off it">
                                                    <span style={{ color: '#666' }}>{fmtNum(cur.width_cm, 1)}</span>
                                                    <span style={{ color: '#aaa' }}> → </span>
                                                    <strong>{fmtNum(cur.actual_width_cm, 1)}</strong>
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
                                                        title={`${sum.runs.length} run${sum.runs.length === 1 ? '' : 's'}, ${sum.completed} completed`}
                                                        style={{ fontFamily: CODE_FONT, fontSize: classic ? 10 : 11, color: sum.open ? '#0058e6' : '#555' }}
                                                    >
                                                        {sum.completed}/{sum.runs.length}
                                                    </span>
                                                )}
                                        </td>
                                        <td style={{ ...tdBase, fontSize: classic ? 10 : 11, overflow: 'hidden' }} title={sum.outputLot || undefined}>
                                            {sum.outputLot
                                                ? <CodeChip code={sum.outputLot} classic={classic} tier={2} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} />
                                                : <span style={{ color: '#bbb' }}>—</span>}
                                        </td>
                                        <td style={tdBase}>
                                            <StatusChip status={wo.status || 'PENDING'} />
                                        </td>
                                        <td style={{ ...tdBase, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                                            {/* Acts on the WO's open run; every run is reachable in the
                                                expanded panel. Nothing shows when there is no run yet —
                                                cutting one is a deliberate act, from the panel. */}
                                            {canManage && sum.open && (!sum.open.status || sum.open.status === 'PENDING') && (
                                                <XPActionButton
                                                    classic={classic} tone="primary" icon="bi-play-fill"
                                                    title={`Start run #${sum.open.run_number}`}
                                                    onClick={() => handleStartRun(sum.open)}
                                                />
                                            )}
                                            {canManage && sum.open?.status === 'IN_PROGRESS' && (
                                                <XPActionButton
                                                    classic={classic} tone="success" icon="bi-check-lg"
                                                    title={`Complete run #${sum.open.run_number} and record the output lot`}
                                                    onClick={() => { setShowCompleteModal(sum.open); setCompleteForm(EMPTY_COMPLETE); setErrorMsg(null); }}
                                                />
                                            )}
                                        </td>
                                    </tr>
                                    {isExpanded && renderDetailPanel(wo, sum)}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <Pager page={page} total={woTotal} pageSize={SO_WO_PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />

            {/* Create Run — modal rather than an inline strip: the list is one
                full-width table now, and a form wedged above it pushed every row
                off screen. */}
            {createWo && (
                <ModalWrapper
                    isOpen={!!createWo}
                    onClose={() => { setCreateWo(null); setCreateForm(EMPTY_CREATE); setErrorMsg(null); }}
                    title={`New Setting Run — ${createWo.code || createWo.name}`}
                    size="lg"
                    footer={<>
                        <button
                            className={XP_BTN}
                            onClick={handleCreateRun}
                            disabled={saving}
                            style={classic ? { ...xpBtn(classic), padding: '3px 16px' } : { ...xpBtnPrimary(classic), padding: '6px 18px' }}
                        >
                            {saving ? 'Saving...' : 'Create Run'}
                        </button>
                        <button
                            className={XP_BTN}
                            onClick={() => { setCreateWo(null); setCreateForm(EMPTY_CREATE); setErrorMsg(null); }}
                            disabled={saving}
                            style={classic ? { ...xpBtn(classic), padding: '3px 16px' } : { ...xpBtn(classic), padding: '6px 18px' }}
                        >
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
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 12px' }}>
                            <div>
                                {fieldRow('Input Lot', 'input_batch_id_text')}
                                {fieldRow('Substrate Qty', 'substrate_qty', 'number', createWo.qty != null ? `WO qty ${createWo.qty}` : undefined)}
                                {fieldRow('Machine Name', 'machine_name', 'text', createWo.work_center_name || undefined)}
                            </div>
                            <div>
                                {fieldRow('Temperature (C)', 'temperature_c', 'number')}
                                {fieldRow('Speed (m/min)', 'speed_mpm', 'number')}
                                {fieldRow('Width (cm)', 'width_cm', 'number')}
                            </div>
                            <div>
                                {fieldRow('Overfeed (%)', 'overfeed_pct', 'number')}
                                {fieldRow('Operator Name', 'operator_name')}
                                <div style={{ marginBottom: 6 }}>
                                    <label style={labelStyle}>Notes</label>
                                    <textarea
                                        style={{ ...xpInput(classic), height: 38, width: '100%', resize: 'vertical', padding: classic ? '2px 4px' : '4px 8px' }}
                                        value={createForm.notes}
                                        onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </ModalWrapper>
            )}

            {/* Complete Modal — the output lot and what was measured off the machine. */}
            {showCompleteModal && (
                <ModalWrapper
                    isOpen={!!showCompleteModal}
                    onClose={() => { setShowCompleteModal(null); setErrorMsg(null); }}
                    title={`Complete Setting Run #${showCompleteModal.run_number ?? showCompleteModal.id}`}
                    size="sm"
                    modeless
                    footer={
                        <>
                            <button
                                className={XP_BTN}
                                onClick={handleCompleteRun}
                                disabled={completing || !completeForm.output_batch_number.trim()}
                                style={classic ? {
                                    ...xpBtn(classic),
                                    background: !completeForm.output_batch_number.trim()
                                        ? '#d4d0c8'
                                        : 'linear-gradient(to bottom, #b0e8b0, #70c870)',
                                    borderColor: '#0a3e0a #1a5e1a #1a5e1a #0a3e0a',
                                    color: !completeForm.output_batch_number.trim() ? '#888' : '#004000',
                                    opacity: completing ? 0.7 : 1,
                                } : {
                                    ...xpBtnPrimary(classic),
                                    background: !completeForm.output_batch_number.trim() ? '#cbd5e1' : '#2563eb',
                                    color: !completeForm.output_batch_number.trim() ? '#94a3b8' : '#fff',
                                    cursor: !completeForm.output_batch_number.trim() ? 'default' : 'pointer',
                                    opacity: completing ? 0.7 : 1,
                                }}
                            >
                                {completing ? 'Completing...' : 'Complete Run'}
                            </button>
                            <button className={XP_BTN} onClick={() => { setShowCompleteModal(null); setErrorMsg(null); }} style={xpBtn(classic)}>
                                Cancel
                            </button>
                        </>
                    }
                >
                    {errorMsg && (
                        <div style={classic
                            ? { background: '#fff3cd', border: '1px solid #ffc107', padding: '3px 8px', fontSize: 11, color: '#664d03', marginBottom: 6 }
                            : { background: '#fef3cd', border: '1px solid #f0d98a', borderRadius: 7, padding: '6px 10px', fontSize: 13, color: '#854d0e', marginBottom: 10 }}>
                            {errorMsg}
                        </div>
                    )}
                    {/* Output lot number — required */}
                    <div style={{ marginBottom: 8 }}>
                        <label style={labelStyle}>
                            Output Lot Number <span style={{ color: classic ? '#c00' : '#dc2626' }}>*</span>
                        </label>
                        <input
                            type="text"
                            autoFocus
                            style={{ ...xpInput(classic), width: '100%' }}
                            value={completeForm.output_batch_number}
                            onChange={e => setCompleteForm(f => ({ ...f, output_batch_number: e.target.value }))}
                        />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 8px' }}>
                        <div>
                            <label style={labelStyle}>Actual Width (cm)</label>
                            <input
                                type="number"
                                style={{ ...xpInput(classic), width: '100%' }}
                                value={completeForm.actual_width_cm}
                                onChange={e => setCompleteForm(f => ({ ...f, actual_width_cm: e.target.value }))}
                            />
                        </div>
                        <div>
                            <label style={labelStyle}>Actual GSM</label>
                            <input
                                type="number"
                                style={{ ...xpInput(classic), width: '100%' }}
                                value={completeForm.actual_gsm}
                                onChange={e => setCompleteForm(f => ({ ...f, actual_gsm: e.target.value }))}
                            />
                        </div>
                        <div>
                            <label style={labelStyle}>Actual Shrinkage (%)</label>
                            <input
                                type="number"
                                style={{ ...xpInput(classic), width: '100%' }}
                                value={completeForm.actual_shrinkage_pct}
                                onChange={e => setCompleteForm(f => ({ ...f, actual_shrinkage_pct: e.target.value }))}
                            />
                        </div>
                    </div>
                </ModalWrapper>
            )}
        </div>
    );
}
