'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useData } from '../../context/DataContext';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { ProgressBar, StatusChip, XPEmptyState, XPActionButton, TableSkeleton, CodeChip, ExpandedRowPanel, WorkCenterChip, familyColor, rowStateBg, xpFont } from '../shared/xpTheme';
import { ShellWindow, ShellTitleBar, SearchField, FilterChipBar, ToolbarCount, xpToolbar } from '../shared/shellTheme';
import { lvTd, lvThSticky, lvZebra, ExpanderCell, ResizableTable, LV_EXPANDER_COL_W } from '../shared/listViewTheme';
import VariantChips from '../shared/VariantChips';
import { useToast } from '../shared/Toast';
import Pager from '../shared/Pager';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import DyeingRateModal from './DyeingRateModal';
import DyeingWOHistory, { useFmtStamp } from './DyeingWOHistory';
import { fmtQty, fmtMinutes, orDash } from '../shared/format';
import { API_BASE } from '../shared/apiBase';

const AMBER = familyColor('amber');
const COLS = 14;
const PAGE_SIZE = 50;
// Column widths for ResizableTable; order matches the <thead> cells exactly —
// the resize grips index into this array.
const COL_W: (number | string)[] = [
    LV_EXPANDER_COL_W, // chevron
    150,               // MO
    '15%',             // Work Order
    '12%',             // Item
    '12%',             // Variant
    80,                // Vessel
    96,                // Status
    110,               // Speed
    64,                // Run
    190,               // Output vs WO
    118,               // Color matching
    118,               // Start
    118,               // Complete
    104,               // Actions
];

const fmt = (n: any, d = 1): string => orDash(n, v => fmtQty(v, d));

// `clock` is the backend's read of the Start/Complete stamps (never `status`):
// PENDING = not started, IN_PROGRESS = clock running, COMPLETED = clock stopped,
// NO_RUN = the dyeing WO closed without its bath ever being clocked (greyed out).
const RUNNING = 'IN_PROGRESS';
const DONE = 'COMPLETED';
const NO_RUN = 'NO_RUN';

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

    const [rateRun, setRateRun] = useState<any>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const fmtStamp = useFmtStamp();
    const [clockFilter, setClockFilter] = useState<string>('ALL');
    // The run whose Start/Complete is in flight, so a double-press cannot stamp twice.
    const [stamping, setStamping] = useState<string | null>(null);

    // Paged, filtered and searched on the server: every finished batch stays listed,
    // so the set has no bound and neither the rows nor the chip counts can come from one page.
    const {
        rows: runs, total, meta, loading, page, setPage, searchInput, setSearch, refetch: load,
    } = usePaginatedFetch<any>({
        endpoint: `${API_BASE}/dyeing/monitor`,
        authFetch,
        pageSize: PAGE_SIZE,
        params: {
            clock: clockFilter === 'ALL' ? undefined : clockFilter,
        },
    });

    useEffect(() => {
        const unsubscribe = subscribeLiveEvents(['dyeing', 'production'], () => load());
        return unsubscribe;
    }, [subscribeLiveEvents, load]);

    // A running output figure grows with the clock; re-read it once a minute.
    useEffect(() => {
        const id = setInterval(load, 60_000);
        return () => clearInterval(id);
    }, [load]);

    const stamp = useCallback(async (run: any, path: 'color-matching' | 'start' | 'complete', labelKey: string) => {
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
            load();
        } finally {
            setStamping(null);
        }
    }, [authFetch, showToast, t, load]);

    const counts: Record<string, number> = meta.counts || {};
    const allCount = Object.values(counts).reduce((a, n) => a + (n || 0), 0);
    const shown = runs;

    const clockLabel = (c: string) =>
        c === RUNNING ? t('running') : c === DONE ? t('completed') : c === NO_RUN ? t('no_bath_run') : t('loaded');

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

    // Same grid as the WO list: full cell borders, because the verticals are what
    // keep 14 columns of codes, times and quantities readable.
    const thStyle: React.CSSProperties = lvThSticky({ border: '1px solid #808080' });
    const tdBase: React.CSSProperties = { ...lvTd(), border: '1px solid #c0bdb5' };

    const Toolbar = (
        <div style={xpToolbar()}>
            <SearchField value={searchInput} onChange={setSearch} placeholder={t('search') || 'Search...'} />
            <FilterChipBar
                value={clockFilter}
                onChange={setClockFilter}
                options={[
                    { value: 'ALL', label: t('all'), count: allCount },
                    { value: RUNNING, label: t('running'), count: counts[RUNNING] || 0 },
                    { value: 'PENDING', label: t('loaded'), count: counts.PENDING || 0 },
                    { value: DONE, label: t('completed'), count: counts[DONE] || 0 },
                    { value: NO_RUN, label: t('no_bath_run'), count: counts[NO_RUN] || 0 },
                ]}
            />
            {meta.needs_setup > 0 && (
                <span title={t('no_speed_picked_hint')} style={{ fontSize: 11, color: '#8a6100' }}>
                    <i className="bi bi-gear" style={{ marginRight: 4, color: AMBER }} />
                    <b>{meta.needs_setup}</b> {t('needs_setup')}
                </span>
            )}
            <ToolbarCount right>{total}</ToolbarCount>
            <XPActionButton tone="neutral" icon="bi-arrow-clockwise" title={t('refresh')} onClick={load} />
        </div>
    );

    return (
        <>
            <ShellWindow fill="page" className="fade-in">
                <ShellTitleBar icon="bi-droplet-half" title={t('dyeing_monitor')} />
                {Toolbar}
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#ffffff' }}>
                    <ResizableTable defaults={COL_W}
                        style={{ width: '100%', minWidth: 1500, borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: xpFont, fontSize: 11, background: '#fff' }}>
                        <thead>
                            <tr>
                                <th style={thStyle} />
                                <th style={thStyle}>MO</th>
                                <th style={thStyle}>{t('work_order')}</th>
                                <th style={thStyle}>{t('item')}</th>
                                <th style={thStyle}>{t('variant')}</th>
                                <th style={thStyle}>{t('vessel')}</th>
                                <th style={thStyle}>{t('status')}</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>{t('speed')} ({t('yd_per_min')})</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>{t('run_time')}</th>
                                <th style={thStyle} title={t('time_output_hint')}>{t('time_output_vs_wo')}</th>
                                <th style={thStyle}>{t('start_color_matching')}</th>
                                <th style={thStyle}>{t('start_batch')}</th>
                                <th style={thStyle}>{t('complete_batch')}</th>
                                <th style={thStyle} />
                            </tr>
                        </thead>
                        <tbody>
                            {loading && runs.length === 0 && <TableSkeleton rows={8} cols={COLS} tdStyle={tdBase} />}
                            {!loading && shown.length === 0 && (
                                <tr><td colSpan={COLS} style={{ padding: 0 }}>
                                    <XPEmptyState icon="bi-droplet" message={t('no_dye_batches')} />
                                </td></tr>
                            )}
                            {shown.map((r, i) => {
                                const isExpanded = expandedId === r.id;
                                const noRun = r.clock === NO_RUN;
                                const toggle = () => setExpandedId(prev => prev === r.id ? null : r.id);
                                return (
                                    <React.Fragment key={r.id}>
                                        <tr
                                            onClick={toggle}
                                            title={noRun ? t('no_bath_run_hint') : undefined}
                                            style={{
                                                background: isExpanded ? rowStateBg('expanded') : noRun ? '#f1f1f1' : lvZebra(i),
                                                color: noRun ? '#8a8a8a' : undefined,
                                                // Greyed, not hidden: the WO list shows every dyeing WO, and a
                                                // closed WO nobody clocked is a fact the supervisor should see.
                                                opacity: noRun ? 0.65 : undefined,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            <ExpanderCell expanded={isExpanded} onToggle={toggle} tdStyle={tdBase} label="dye batch history" />
                                            <td style={{ ...tdBase, overflow: 'hidden' }}>
                                                {r.mo_code ? <CodeChip code={r.mo_code} tier={2} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }} /> : '—'}
                                            </td>
                                            <td style={{ ...tdBase, overflow: 'hidden' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                                                    {r.wo_code && <CodeChip code={r.wo_code} tone="accent" style={{ fontWeight: 'bold', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} />}
                                                    {r.run_number != null && (
                                                        <span style={{ fontSize: 10, color: '#666', flexShrink: 0 }}>#{r.run_number}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td style={{ ...tdBase, fontSize: 10, color: noRun ? undefined : '#444', overflow: 'hidden' }} title={r.item_name || ''}>
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                                                    {r.item_name || r.item_code || '—'}
                                                </span>
                                            </td>
                                            <td style={{ ...tdBase, fontSize: 10, overflow: 'hidden', whiteSpace: 'normal' }}>
                                                <VariantChips
                                                    combo={r.combo_label} size={r.size_label}
                                                    colorVariant={r.color_label} colorCode={r.color_code}
                                                    colorName={r.color_name} colorHex={r.color_hex}
                                                    labdipCode={r.labdip_variant_code}
                                                    style={{ flexWrap: 'wrap', rowGap: 2 }}
                                                />
                                            </td>
                                            <td style={{ ...tdBase, fontSize: 10, overflow: 'hidden' }} title={r.work_center_name || ''}>
                                                {r.work_center_code
                                                    ? <WorkCenterChip type={r.work_center_type} name={r.work_center_name} label={r.work_center_code} />
                                                    : '—'}
                                            </td>
                                            <td style={tdBase}>
                                                <StatusChip status={r.clock} label={clockLabel(r.clock)} />
                                            </td>
                                            <td style={{ ...tdBase, textAlign: 'right' }}>
                                                {r.rate_yd_per_min != null
                                                    ? <>{fmt(r.yards_per_min, 0)} × {r.lines} = <b>{fmt(r.rate_yd_per_min, 0)}</b></>
                                                    : '—'}
                                            </td>
                                            <td style={{ ...tdBase, textAlign: 'right' }}>{fmtMinutes(r.run_minutes)}</td>
                                            <td style={tdBase}>{noRun ? '—' : <OutputCell r={r} />}</td>
                                            <td style={{ ...tdBase, fontSize: 10 }}>{fmtStamp(r.color_matching_at)}</td>
                                            <td style={{ ...tdBase, fontSize: 10 }}>{fmtStamp(r.started_at)}</td>
                                            <td style={{ ...tdBase, fontSize: 10 }}>{fmtStamp(r.completed_at)}</td>
                                            <td style={{ ...tdBase, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                                                {canSetRate && !noRun && (
                                                    <span style={{ display: 'inline-flex', gap: 3 }}>
                                                        {!r.color_matching_at && !r.started_at && !r.completed_at && (
                                                            <XPActionButton tone="neutral" icon="bi-eyedropper"
                                                                title={`${t('start_color_matching')} — ${t('batch_matching_hint')}`}
                                                                disabled={stamping === r.id}
                                                                onClick={() => stamp(r, 'color-matching', 'start_color_matching')} />
                                                        )}
                                                        {!r.started_at && (
                                                            <XPActionButton tone="primary" icon="bi-play-fill" title={t('start_batch')}
                                                                disabled={stamping === r.id}
                                                                onClick={() => stamp(r, 'start', 'start_batch')} />
                                                        )}
                                                        {r.clock === RUNNING && (
                                                            <XPActionButton tone="primary" icon="bi-check2-circle" title={t('complete_batch')}
                                                                disabled={stamping === r.id}
                                                                onClick={() => stamp(r, 'complete', 'complete_batch')} />
                                                        )}
                                                        <XPActionButton tone="neutral" icon="bi-sliders" title={t('set_rate')}
                                                            onClick={() => setRateRun(r)} />
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                        {isExpanded && r.work_order_id && (
                                            <tr>
                                                <td colSpan={COLS} style={{ padding: 0 }}>
                                                    <ExpandedRowPanel>
                                                        <DyeingWOHistory workOrderId={r.work_order_id} authFetch={authFetch} apiBase={API_BASE} />
                                                    </ExpandedRowPanel>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </ResizableTable>
                </div>
                <Pager page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />
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
