'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { familyColor, ProgressBar, StatusChip, XPEmptyState, XPActionButton, BUTTON_RADIUS, XP_BTN } from '../shared/xpTheme';
import VariantChips from '../shared/VariantChips';
import { useToast } from '../shared/Toast';
import WorkCenterMonitorModal from './WorkCenterMonitorModal';
import DyeingRateModal from './DyeingRateModal';
import { useMonitorSections } from './machineMonitor/useMonitorSections';
import { CardGrid, MachineCard, GroupHeader, MonitorChipBar } from './machineMonitor/MonitorParts';
import { MonitorShell, MonitorGridSkeleton } from './machineMonitor/MonitorShell';

const GREEN = familyColor('green');
const BLUE = familyColor('blue');
const AMBER = familyColor('amber');

function fmt(n: any, d = 1): string {
    if (n === null || n === undefined) return '—';
    const v = Number(n);
    if (Number.isNaN(v)) return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d });
}

/** Minutes as the floor reads them: 45m, 3h 20m, 2d 4h. A dye batch spans a shift,
 *  so raw minutes stop being legible about an hour in. */
function fmtElapsed(mins: any): string {
    const v = Number(mins);
    if (!v || Number.isNaN(v) || v <= 0) return '—';
    if (v < 60) return `${Math.round(v)}m`;
    const h = Math.floor(v / 60);
    if (h < 24) return `${h}h ${Math.round(v % 60)}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// Every card-worthy batch on a vessel: the one running plus any being matched or
// loaded and waiting.
function runsOf(m: any): any[] {
    if (Array.isArray(m?.active_runs)) return m.active_runs;
    return m?.active_run ? [m.active_run] : [];
}
const isLive = (r: any) => r?.status === 'IN_PROGRESS';
const isMatching = (r: any) => r?.status === 'COLOR_MATCHING';

/**
 * The three floor acts of a dye batch, and which one this run is up for next.
 *
 * Deliberately one walk rather than a button per phase scattered through the card:
 * the batch is at exactly one point in `match -> start -> complete`, so the card
 * shows exactly one primary action. Returning null (a closed or cancelled bath)
 * means there is nothing left to press.
 *
 * `start` posts the PLANNED bath, because that is the number the Kartu Kerja in the
 * operator's hand was printed from; the backend refuses with its own message when
 * there is no bath to dose. The other two carry no body at all — they are stamps.
 */
type Phase = { key: 'match' | 'start' | 'complete'; path: string; body?: any; icon: string; labelKey: string };
function nextPhase(run: any): Phase | null {
    if (isLive(run)) return { key: 'complete', path: 'complete', body: {}, icon: 'bi-check2-circle', labelKey: 'complete_batch' };
    if (run?.status === 'PENDING') return { key: 'match', path: 'color-matching', icon: 'bi-palette', labelKey: 'start_color_matching' };
    if (isMatching(run)) {
        return {
            key: 'start', path: 'start', icon: 'bi-play-fill', labelKey: 'start_batch',
            body: { volume_air_liters: run.planned_bath_liters ?? null },
        };
    }
    return null;
}

export default function DyeingMonitorView() {
    const { authFetch, subscribeLiveEvents } = useData();
    const { t } = useLanguage();
    const { hasPermission } = useUser();
    const { showToast } = useToast();
    // Same gate the Dyeing Orders tab uses to start and complete a batch. It covers
    // both things this card writes: picking the rate and walking the batch through
    // its three phases are the machine setter's job, not a supervisory act.
    const canSetRate = hasPermission('work_order.log');

    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<any>(null);
    const [rateRun, setRateRun] = useState<any>(null);
    const [groupFilter, setGroupFilter] = useState<string | null>(null);
    // Which batch each multi-batch vessel card is showing. Lives here, not in the
    // card: a component identity declared inside this render remounts on every live
    // refresh and would drop the slide.
    const [runSlide, setRunSlide] = useState<Record<string, number>>({});
    const [runningOnly, setRunningOnly] = useState(false);
    // The run id whose phase button is in flight, so a double-press cannot stamp
    // twice (the second POST 400s, but the first toast would still be a lie).
    const [phasing, setPhasing] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/dyeing/monitor`);
            if (res.ok) setData(await res.json());
        } finally {
            setLoading(false);
        }
    }, [API_BASE, authFetch]);

    useEffect(() => { load(); }, [load]);

    // 'production' is not optional here: a logged completion is the NUMERATOR of
    // every efficiency on this page and it broadcasts MANUFACTURING_ORDER_UPDATE,
    // never a dyeing event. Subscribing to 'dyeing' alone would leave the grid
    // stale exactly when it matters — the same bug the weaving monitor had.
    useEffect(() => {
        const unsubscribe = subscribeLiveEvents(['dyeing', 'production'], () => load());
        return unsubscribe;
    }, [subscribeLiveEvents, load]);

    const machines: any[] = data?.machines || [];

    /** Walk one batch to its next phase. Every stamp goes through here so the grid
     *  reloads, the toast and the audit trail always agree on what happened. */
    const advance = useCallback(async (run: any, phase: Phase) => {
        setPhasing(run.id);
        try {
            const res = await authFetch(`${API_BASE}/dyeing-runs/${run.id}/${phase.path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(phase.body ?? {}),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => null);
                showToast(typeof d?.detail === 'string' ? d.detail : t('phase_failed'), 'danger');
                return;
            }
            showToast(t(phase.labelKey), 'success');
            await load();
        } finally {
            setPhasing(null);
        }
    }, [API_BASE, authFetch, showToast, t, load]);

    const statusLabel = (s: string): string => ({
        RUNNING: t('running'), LOADED: t('loaded'), MATCHING: t('color_matching'),
    } as Record<string, string>)[s] || t('idle');

    // No `plantBelowTarget` read here: a dye card carries no `on_target`, so the
    // shared hook's below-target roll-up falls out at 0 by itself. Nothing is scored.
    const { sections, visibleSections, isGrouped } =
        useMonitorSections({ machines, runsOf, groupFilter });

    // "Running" counts vessels with cloth actually circulating — a LOADED vessel is
    // waiting, not producing, and must not inflate the plant's running count.
    const shown = (list: any[]) => (runningOnly ? list.filter((m: any) => runsOf(m).some(isLive)) : list);
    const runningCount = useMemo(
        () => machines.filter((m: any) => runsOf(m).some(isLive)).length, [machines]);

    const openCard = (m: any) => setSelected({
        id: m.id, code: m.code, name: m.name, center_type: m.center_type,
        loom_status: m.loom_status || 'IDLE',
    });

    const RunVariant = ({ run }: { run: any }) => (
        <VariantChips
            combo={run.combo_label}
            size={run.size_label}
            colorVariant={run.color_label}
            colorCode={run.color_code}
            colorName={run.color_name}
            colorHex={run.color_hex}
            labdipCode={run.labdip_variant_code}
            scale="sm"
            style={{ flexWrap: 'wrap', gap: 3 }}
        />
    );

    /**
     * Why a batch shows no efficiency. Every dash on this page has exactly one
     * cause and the card names it — an unexplained "—" on a monitor is worse than
     * no card at all, because the reader cannot tell a broken machine from an
     * unconfigured one.
     */
    const MissingWhy = ({ run, machine }: { run: any; machine: any }) => {
        const missing: string[] = run.missing_rate_inputs || [];
        const reason = missing.includes('yards_per_min')
            ? { text: t('no_speed_picked'), hint: t('no_speed_picked_hint') }
            : missing.includes('lines')
                ? { text: t('no_lines_set'), hint: undefined }
                : run.missing_gy_factor
                    ? { text: t('no_gy_factor'), hint: t('no_gy_factor_hint') }
                    : null;
        if (!reason) return null;
        return (
            <div title={reason.hint} style={{
                marginTop: 3, padding: '1px 5px', background: '#fff6e0',
                border: `1px solid ${AMBER}`, color: '#8a6100', fontSize: 10,
                display: 'flex', alignItems: 'center', gap: 4,
            }}>
                <i className="bi bi-gear" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reason.text}</span>
            </div>
        );
    };

    /**
     * Match -> Start -> Complete, with the gap each one took under it.
     *
     * The whole point of stamping three phases: prep and run are shown SEPARATELY
     * and never summed into one "elapsed". A batch that waited four hours on a shade
     * and then dyed in forty minutes is a colour problem, not a slow vessel, and one
     * merged figure told the supervisor the opposite.
     *
     * A phase with no stamp renders its dot hollow and its gap as a dash — "nobody
     * pressed it" is a different fact from "it took no time", and the card must not
     * launder one into the other.
     */
    const PhaseTrack = ({ run }: { run: any }) => {
        const steps = [
            { on: !!run.color_matching_at, label: t('phase_match'), gap: run.prep_minutes, gapLabel: t('phase_prep_gap') },
            { on: !!run.started_at, label: t('phase_start'), gap: run.run_minutes, gapLabel: t('phase_run_gap') },
            { on: !!run.completed_at, label: t('phase_complete'), gap: null, gapLabel: '' },
        ];
        return (
            <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 4, marginBottom: 2 }}>
                {steps.map((st, i) => (
                    <div key={st.label} style={{ display: 'flex', alignItems: 'flex-start', flex: i < 2 ? 1 : '0 0 auto' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                            <span style={{
                                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                background: st.on ? BLUE : 'transparent',
                                border: '1px solid ' + (st.on ? BLUE : '#b8b4a8'),
                            }} />
                            <span style={{ fontSize: 8, color: st.on ? '#555' : '#aaa', whiteSpace: 'nowrap' }}>
                                {st.label}
                            </span>
                        </div>
                        {i < 2 && (
                            <div title={st.gapLabel} style={{
                                flex: 1, display: 'flex', flexDirection: 'column',
                                alignItems: 'center', gap: 1, paddingTop: 3,
                            }}>
                                <span style={{ width: '100%', height: 1, background: st.on ? BLUE : '#d8d4c8' }} />
                                <span style={{ fontSize: 8, color: st.gap != null ? '#666' : '#bbb', whiteSpace: 'nowrap' }}>
                                    {st.gap != null ? fmtElapsed(st.gap) : '—'}
                                </span>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    const RunBody = ({ run, machine }: { run: any; machine: any }) => {
        const live = isLive(run);
        // Reported, not scored: with no target there is no pass/fail colour, so the
        // number reads plain while it is live and grey before the machine starts.
        const effColor = live ? '#1a1a1a' : '#888';
        const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
        const phase = nextPhase(run);
        return (
            <>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {/* WO first: a vessel queues several batches and the WO is what tells
                        them apart on the floor. */}
                    {run.wo_code && <b style={{ color: BLUE }}>{run.wo_code} · </b>}
                    <b>{run.mo_code}</b>{run.item_code ? ` · ${run.item_code}` : ''}
                </div>
                {!live && (
                    <div style={{ marginBottom: 4 }}>
                        <StatusChip
                            status={isMatching(run) ? 'COLOR_MATCHING' : 'LOADED'}
                            label={isMatching(run) ? t('color_matching') : t('loaded')}
                            title={isMatching(run) ? t('batch_matching_hint') : t('batch_loaded_hint')}
                            tint
                        />
                    </div>
                )}
                <div style={{ marginBottom: 4 }}><RunVariant run={run} /></div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 24, fontWeight: 'bold', color: effColor, lineHeight: 1 }}>
                        {fmt(run.efficiency_pct, 1)}<span style={{ fontSize: 12}}>%</span>
                    </span>
                    <span style={{ fontSize: 10, color: '#888' }}>{t('efficiency')}</span>
                    <span style={{ fontSize: 10, color: '#888', marginLeft: 'auto' }}>
                        {run.lines} {t('lines')}
                    </span>
                </div>
                {/* No target tick: the bar is the reported figure and nothing else. */}
                <div style={{ margin: '4px 0' }}>
                    <ProgressBar pct={Number(run.efficiency_pct) || 0} tone="blue" height={9} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10}}>
                    <span>
                        <span style={{ color: '#888' }}>{t('yards_dyed')}:</span>{' '}
                        <b>{fmt(run.actual_yards, 0)}</b> {t('yd_short')}
                    </span>
                    <span style={{ color: '#666' }}>{fmt(run.actual_rate_yd_min, 1)} {t('yd_per_min')}</span>
                </div>
                {/* The rate this batch is measured at, and the run window it is divided
                    by. Both are floor inputs, so they sit next to the result. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888', marginTop: 2 }}>
                    <span>
                        {t('yd_per_min')} <b style={{ color: '#555' }}>{fmt(run.yards_per_min, 0)}</b>
                        {run.target_yd_per_min ? ` × ${run.lines} = ${fmt(run.target_yd_per_min, 0)}` : ''}
                    </span>
                    <span>{t('run_time')} <b style={{ color: '#555' }}>{fmtElapsed(run.run_minutes)}</b></span>
                </div>
                <PhaseTrack run={run} />
                <MissingWhy run={run} machine={machine} />
                {canSetRate && (
                    <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {/* The one act this batch is next up for. One button, because the
                            batch is at one point in the walk — offering all three would
                            invite stamping a phase out of order. */}
                        {phase && (
                            <XPActionButton tone="primary" icon={phase.icon}
                                label={t(phase.labelKey)} disabled={phasing === run.id}
                                onClick={stop(() => advance(run, phase))} />
                        )}
                        <XPActionButton tone="neutral" icon="bi-sliders"
                            label={t('set_rate')} onClick={stop(() => setRateRun({ ...run, machine }))} />
                    </div>
                )}
            </>
        );
    };

    // Several batches queued on one vessel: one on screen at a time, paged, for the
    // same reason the loom grid pages its WOs — a stacked card three times the
    // height of its neighbours breaks the one thing a monitor grid is for.
    const RunCarousel = ({ m, runs }: { m: any; runs: any[] }) => {
        const total = runs.length;
        if (total === 1) return <RunBody run={runs[0]} machine={m} />;
        const idx = Math.min(runSlide[m.id] ?? 0, total - 1);
        const go = (n: number) => (e: React.MouseEvent) => {
            e.stopPropagation();
            setRunSlide(prev => ({ ...prev, [m.id]: (n + total) % total }));
        };
        const navBtn = (dir: -1 | 1) => (
            <button type="button" onClick={go(idx + dir)} className={XP_BTN}
                title={dir < 0 ? t('prev_run') : t('next_run')}
                style={{
                    ...({ background: 'linear-gradient(to bottom, #fdfdfd, #e3e1d8)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf' }),
                    borderRadius: BUTTON_RADIUS, width: 18, height: 16, padding: 0, lineHeight: 1,
                    fontSize: 10, color: '#333', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                <i className={`bi bi-chevron-${dir < 0 ? 'left' : 'right'}`} />
            </button>
        );
        return (
            <>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, paddingBottom: 3,
                    borderBottom: '1px solid #c8c4b8',
                }}>
                    {navBtn(-1)}
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#555', minWidth: 26, textAlign: 'center' }}>
                        {idx + 1}/{total}
                    </span>
                    {navBtn(1)}
                    {/* A running batch stays visible as a green dot even while another
                        slide is up, so paging never hides which one is actually on. */}
                    <span style={{ display: 'flex', gap: 3, marginLeft: 'auto', alignItems: 'center' }}>
                        {runs.map((r: any, i: number) => (
                            <span key={r.id} onClick={go(i)}
                                title={`${r.wo_code || r.mo_code} · ${statusLabel(isLive(r) ? 'RUNNING' : isMatching(r) ? 'MATCHING' : 'LOADED')}`}
                                style={{
                                    width: 7, height: 7, borderRadius: '50%', cursor: 'pointer',
                                    background: i === idx
                                        ? (isLive(r) ? GREEN : isMatching(r) ? BLUE : '#8f8b80')
                                        : (isLive(r) ? '#a8dca8' : isMatching(r) ? '#b8cdf0' : '#c8c4b8'),
                                    border: i === idx ? '1px solid #00000055' : '1px solid transparent',
                                }} />
                        ))}
                    </span>
                </div>
                <RunBody run={runs[idx]} machine={m} />
            </>
        );
    };

    const IdleBody = ({ machine }: { machine: any }) => (
        <div style={{ fontSize: 11, color: '#888', display: 'flex', flexDirection: 'column', gap: 3, justifyContent: 'center', flex: 1, minHeight: 64}}>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <i className="bi bi-pause-circle" style={{ fontSize: 16}} />
                {t('no_active_batch')}
            </span>
            {/* Nothing to flag on an idle vessel any more: the speed is picked per
                batch, not measured per machine, so a vessel with no batch in it is
                not missing anything. The warning lives on the run (MissingWhy). */}
        </div>
    );

    const card = (m: any) => {
        const runs = runsOf(m);
        const status: string = m.loom_status || 'IDLE';
        return (
            <MachineCard
                key={m.id}
                code={m.code}
                name={m.name}
                status={status}
                statusLabel={statusLabel(status)}
                // The vessel's one alarm now that nothing is scored: a batch whose
                // rate cannot be reported at all because nobody picked its speed.
                alarm={runs.some((r: any) => (r.missing_rate_inputs || []).length > 0)}
                alarmTitle={t('no_speed_picked')}
                badge={runs.length > 1 ? `${runs.length} ${t('wo_short')}` : undefined}
                onClick={() => openCard(m)}
                title={t('click_for_detail')}
            >
                {runs.length ? <RunCarousel m={m} runs={runs} /> : <IdleBody machine={m} />}
            </MachineCard>
        );
    };

    const cardGrid = (list: any[]) => <CardGrid>{list.map(card)}</CardGrid>;

    const summaryText = data ? (
        <>
            <span><b>{data.total}</b> {t('machines')}</span>
            <span style={{ marginLeft: 12 }}><b style={{ color: '#9effa0'}}>{data.running}</b> {t('running')}</span>
            {data.avg_efficiency_pct !== null && data.avg_efficiency_pct !== undefined && (
                <span style={{ marginLeft: 12 }}>{t('avg_efficiency')}: <b>{fmt(data.avg_efficiency_pct, 1)}%</b></span>
            )}
            {/* Batches sitting on a shade rather than on a machine. The one queue a
                dye plant loses hours to that no production number reveals — which is
                the whole reason the phase is stamped. */}
            {data.matching > 0 && (
                <span style={{ marginLeft: 12 }} title={t('batch_matching_hint')}>
                    <b style={{ color: '#bcd8ff'}}>{data.matching}</b> {t('color_matching')}
                </span>
            )}
            {/* Plant-wide, and deliberately in the header: a batch with no speed
                picked reports no rate at all, and that is a setup task, not a fault. */}
            {data.needs_setup > 0 && (
                <span style={{ marginLeft: 12 }} title={t('no_speed_picked_hint')}>
                    <i className="bi bi-gear" style={{ marginRight: 4 }} />
                    <b style={{ color: '#ffe9b0'}}>{data.needs_setup}</b> {t('needs_setup')}
                </span>
            )}
        </>
    ) : null;

    const chipBar = (
        <MonitorChipBar
            sections={sections}
            isGrouped={isGrouped}
            groupFilter={groupFilter}
            onGroupChange={setGroupFilter}
            machineCount={machines.length}
            runningOnly={runningOnly}
            runningCount={runningCount}
            onRunningOnlyChange={setRunningOnly}
            labels={{
                group: t('group'), all: t('all'), machines: t('machines'), running: t('running'),
                belowTarget: t('below_target'), runningOnly: t('running_only'),
                runningOnlyHint: t('running_only_hint'),
            }}
        />
    );

    const body = loading ? (
        <MonitorGridSkeleton />
    ) : machines.length === 0 ? (
        <XPEmptyState icon="bi-droplet" message={t('no_dyeing_machines')} />
    ) : runningOnly && runningCount === 0 ? (
        <XPEmptyState icon="bi-pause-circle" message={t('no_running_machines')} />
    ) : !isGrouped ? (
        cardGrid(shown(machines))
    ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10}}>
            {visibleSections.filter(sec => shown(sec.machines).length > 0).map(sec => (
                <div key={sec.id || 'ungrouped'}>
                    <GroupHeader
                        sec={sec}
                        labels={{
                            machines: t('machines'), running: t('running'),
                            avgEfficiency: t('avg_efficiency'), belowTarget: t('below_target'),
                            late: t('behind_schedule'),
                        }}
                    />
                    {cardGrid(shown(sec.machines))}
                </div>
            ))}
        </div>
    );

    return (
        <>
            <MonitorShell
                icon="bi-droplet-half"
                title={t('dyeing_monitor')}
                summary={summaryText}
                onRefresh={load}
                refreshTitle={t('refresh')}
                loading={loading}
                hasMachines={machines.length > 0}
                chipBar={chipBar}
            >
                {body}
            </MonitorShell>
            <WorkCenterMonitorModal
                isOpen={!!selected}
                onClose={() => { setSelected(null); load(); }}
                workCenter={selected}
                authFetch={authFetch}
                apiBase={API_BASE}
            />
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
