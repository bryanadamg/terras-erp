'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { ProgressBar, StatusChip, XPEmptyState, XPActionButton, TableSkeleton, CodeChip, familyColor, xpFont } from '../shared/xpTheme';
import { ShellWindow, ShellTitleBar, SearchField, FilterChipBar, ToolbarCount, xpToolbar } from '../shared/shellTheme';
import { lvTh, lvThead, lvTd, lvRow } from '../shared/listViewTheme';
import VariantChips from '../shared/VariantChips';
import { useToast } from '../shared/Toast';
import DyeingRateModal from './DyeingRateModal';
import { API_BASE } from '../shared/apiBase';

const AMBER = familyColor('amber');
const COLS = 8;

function fmt(n: any, d = 1): string {
    if (n === null || n === undefined) return '—';
    const v = Number(n);
    if (Number.isNaN(v)) return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d });
}

/** Minutes as the floor reads them: 45m, 3h 20m, 2d 4h. */
function fmtElapsed(mins: any): string {
    const v = Number(mins);
    if (mins === null || mins === undefined || Number.isNaN(v)) return '—';
    if (v < 60) return `${Math.round(v)}m`;
    const h = Math.floor(v / 60);
    if (h < 24) return `${h}h ${Math.round(v % 60)}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// `clock` is the backend's read of the Start/Complete stamps (never `status`):
// PENDING = not started, IN_PROGRESS = clock running, COMPLETED = clock stopped.
const RUNNING = 'IN_PROGRESS';
const DONE = 'COMPLETED';

/**
 * One row per dye batch. The page answers one question: did speed x time on the
 * machine produce the mass the WO was cut for? The bar is time-based output
 * (yd/min x ropes x run window, through the item's g/y) against the WO qty.
 *
 * The monitor is a TIMER: Start when the vessel begins turning, Complete when it
 * stops. The bath, doses and load are configured in Dyeing Orders.
 */
export default function DyeingMonitorView() {
    const { authFetch, subscribeLiveEvents } = useData();
    const { t } = useLanguage();
    const { hasPermission } = useUser();
    const { showToast } = useToast();
    // Same gate the Dyeing Orders tab uses to start and complete a batch.
    const canSetRate = hasPermission('work_order.log');

    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [rateRun, setRateRun] = useState<any>(null);
    const [clockFilter, setClockFilter] = useState<string>('ALL');
    const [search, setSearch] = useState('');
    // The run whose Start/Complete is in flight, so a double-press cannot stamp twice.
    const [stamping, setStamping] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/dyeing/monitor`);
            if (res.ok) setData(await res.json());
        } finally {
            setLoading(false);
        }
    }, [authFetch]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const unsubscribe = subscribeLiveEvents(['dyeing', 'production'], () => load());
        return unsubscribe;
    }, [subscribeLiveEvents, load]);

    // A running output figure grows with the clock; re-read it once a minute.
    useEffect(() => {
        const id = setInterval(load, 60_000);
        return () => clearInterval(id);
    }, [load]);

    const stamp = useCallback(async (run: any, path: 'start' | 'complete', labelKey: string) => {
        setStamping(run.id);
        try {
            const res = await authFetch(`${API_BASE}/dyeing-runs/${run.id}/${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (!res.ok) {
                const d = await res.json().catch(() => null);
                showToast(typeof d?.detail === 'string' ? d.detail : t('phase_failed'), 'danger');
                return;
            }
            showToast(t(labelKey), 'success');
            await load();
        } finally {
            setStamping(null);
        }
    }, [authFetch, showToast, t, load]);

    const runs: any[] = data?.runs || [];
    const counts = useMemo(() => {
        const c: Record<string, number> = { PENDING: 0, [RUNNING]: 0, [DONE]: 0 };
        runs.forEach(r => { c[r.clock] = (c[r.clock] || 0) + 1; });
        return c;
    }, [runs]);

    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        return runs.filter(r =>
            (clockFilter === 'ALL' || r.clock === clockFilter)
            && (!q || [r.work_center_code, r.work_center_name, r.wo_code, r.mo_code, r.item_code, r.item_name]
                .some(v => (v || '').toLowerCase().includes(q))));
    }, [runs, clockFilter, search]);

    const clockLabel = (c: string) =>
        c === RUNNING ? t('running') : c === DONE ? t('completed') : t('loaded');

    /** Why a row shows no output. Every dash names its cause. */
    const missingWhy = (r: any): { text: string; hint?: string } | null => {
        const missing: string[] = r.missing_rate_inputs || [];
        if (missing.includes('yards_per_min')) return { text: t('no_speed_picked'), hint: t('no_speed_picked_hint') };
        if (missing.includes('lines')) return { text: t('no_lines_set') };
        if (r.missing_gy_factor) return { text: t('no_gy_factor'), hint: t('no_gy_factor_hint') };
        return null;
    };

    const OutputCell = ({ r }: { r: any }) => {
        const why = missingWhy(r);
        if (why) {
            return (
                <span title={why.hint} style={{ color: '#8a6100', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <i className="bi bi-gear" style={{ color: AMBER }} />{why.text}
                </span>
            );
        }
        const uom = r.item_uom || '';
        const pct = r.progress_pct;
        // Running = blue (still accruing). Stopped: green once the clock covered the
        // WO's mass, amber when it came off short.
        const tone = r.clock === DONE ? ((pct ?? 0) >= 100 ? 'green' : 'amber') : 'blue';
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <ProgressBar pct={Math.min(Number(pct) || 0, 100)} tone={tone} height={10}
                    title={`${fmt(r.time_yards, 0)} ${t('yd_short')}`} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                    <span>
                        <b>{fmt(r.time_qty, 1)}</b> / {fmt(r.target_qty, 1)} {uom}
                    </span>
                    <b>{pct == null ? '—' : `${fmt(pct, 1)}%`}</b>
                </div>
            </div>
        );
    };

    const Toolbar = (
        <div style={xpToolbar()}>
            <SearchField value={search} onChange={setSearch} placeholder={t('search') || 'Search...'} />
            <FilterChipBar
                value={clockFilter}
                onChange={setClockFilter}
                options={[
                    { value: 'ALL', label: t('all'), count: runs.length },
                    { value: RUNNING, label: t('running'), count: counts[RUNNING] },
                    { value: 'PENDING', label: t('loaded'), count: counts.PENDING },
                    { value: DONE, label: t('completed'), count: counts[DONE] },
                ]}
            />
            {data?.needs_setup > 0 && (
                <span title={t('no_speed_picked_hint')} style={{ fontSize: 11, color: '#8a6100' }}>
                    <i className="bi bi-gear" style={{ marginRight: 4, color: AMBER }} />
                    <b>{data.needs_setup}</b> {t('needs_setup')}
                </span>
            )}
            <ToolbarCount right>{shown.length} / {runs.length}</ToolbarCount>
            <XPActionButton tone="neutral" icon="bi-arrow-clockwise" title={t('refresh')} onClick={load} />
        </div>
    );

    return (
        <>
            <ShellWindow fill="page" className="fade-in">
                <ShellTitleBar icon="bi-droplet-half" title={t('dyeing_monitor')} />
                {Toolbar}
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#ffffff' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: xpFont, fontSize: 11 }}>
                        <thead style={lvThead(true)}>
                            <tr>
                                <th style={{ ...lvTh(), width: 110 }}>{t('vessel')}</th>
                                <th style={lvTh()}>{t('work_order')} / {t('item')}</th>
                                <th style={lvTh()}>{t('variant')}</th>
                                <th style={{ ...lvTh(), width: 90 }}>{t('status')}</th>
                                <th style={{ ...lvTh(), textAlign: 'right', width: 130 }}>{t('speed')} ({t('yd_per_min')})</th>
                                <th style={{ ...lvTh(), textAlign: 'right', width: 80 }}>{t('run_time')}</th>
                                <th style={{ ...lvTh(), width: 240 }}
                                    title={t('time_output_hint')}>{t('time_output_vs_wo')}</th>
                                <th style={{ ...lvTh(), width: 170 }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && runs.length === 0 && <TableSkeleton rows={8} cols={COLS} />}
                            {!loading && shown.length === 0 && (
                                <tr><td colSpan={COLS}>
                                    <XPEmptyState icon="bi-droplet" message={t('no_dye_batches')} />
                                </td></tr>
                            )}
                            {shown.map((r, i) => (
                                <tr key={r.id} style={lvRow(i)}>
                                    <td style={lvTd()}>
                                        <b>{r.work_center_code || '—'}</b>
                                        {r.work_center_name && (
                                            <div style={{ fontSize: 10, color: '#666' }}>{r.work_center_name}</div>
                                        )}
                                    </td>
                                    <td style={lvTd()}>
                                        {r.wo_code && <CodeChip code={r.wo_code} />}
                                        <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
                                            {r.mo_code}{r.item_code ? ` · ${r.item_code}` : ''}
                                        </div>
                                    </td>
                                    <td style={lvTd()}>
                                        <VariantChips
                                            combo={r.combo_label} size={r.size_label}
                                            colorVariant={r.color_label} colorCode={r.color_code}
                                            colorName={r.color_name} colorHex={r.color_hex}
                                            labdipCode={r.labdip_variant_code}
                                            scale="sm" style={{ flexWrap: 'wrap', gap: 3 }}
                                        />
                                    </td>
                                    <td style={lvTd()}>
                                        <StatusChip status={r.clock} label={clockLabel(r.clock)} tint />
                                    </td>
                                    <td style={{ ...lvTd(), textAlign: 'right' }}>
                                        {r.rate_yd_per_min != null
                                            ? <>{fmt(r.yards_per_min, 0)} × {r.lines} = <b>{fmt(r.rate_yd_per_min, 0)}</b></>
                                            : '—'}
                                    </td>
                                    <td style={{ ...lvTd(), textAlign: 'right' }}>{fmtElapsed(r.run_minutes)}</td>
                                    <td style={lvTd()}><OutputCell r={r} /></td>
                                    <td style={{ ...lvTd(), whiteSpace: 'nowrap' }}>
                                        {canSetRate && (
                                            <span style={{ display: 'inline-flex', gap: 4 }}>
                                                {!r.started_at && (
                                                    <XPActionButton tone="primary" icon="bi-play-fill" label={t('start_batch')}
                                                        disabled={stamping === r.id}
                                                        onClick={() => stamp(r, 'start', 'start_batch')} />
                                                )}
                                                {r.clock === RUNNING && (
                                                    <XPActionButton tone="primary" icon="bi-check2-circle" label={t('complete_batch')}
                                                        disabled={stamping === r.id}
                                                        onClick={() => stamp(r, 'complete', 'complete_batch')} />
                                                )}
                                                <XPActionButton tone="neutral" icon="bi-sliders" label={t('set_rate')}
                                                    onClick={() => setRateRun(r)} />
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </ShellWindow>
            <DyeingRateModal
                isOpen={!!rateRun}
                run={rateRun}
                onClose={() => setRateRun(null)}
                onSaved={() => { setRateRun(null); showToast(t('rate_saved'), 'success'); load(); }}
                authFetch={authFetch}
                apiBase={API_BASE}
            />
        </>
    );
}
