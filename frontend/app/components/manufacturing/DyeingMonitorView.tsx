'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { familyColor, StatusChip, XPEmptyState, XPActionButton, BUTTON_RADIUS, XP_BTN } from '../shared/xpTheme';
import VariantChips from '../shared/VariantChips';
import { useToast } from '../shared/Toast';
import WorkCenterMonitorModal from './WorkCenterMonitorModal';
import DyeingRateModal from './DyeingRateModal';
import { useMonitorSections } from './machineMonitor/useMonitorSections';
import { EffBar, CardGrid, MachineCard, GroupHeader, MonitorChipBar } from './machineMonitor/MonitorParts';
import { MonitorShell, MonitorGridSkeleton } from './machineMonitor/MonitorShell';

const GREEN = familyColor('green');
const RED = familyColor('red');
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

// Every card-worthy batch on a vessel: the one running plus any loaded and waiting.
function runsOf(m: any): any[] {
    if (Array.isArray(m?.active_runs)) return m.active_runs;
    return m?.active_run ? [m.active_run] : [];
}
const isLive = (r: any) => r?.status === 'IN_PROGRESS';

export default function DyeingMonitorView() {
    const { authFetch, subscribeLiveEvents } = useData();
    const { t } = useLanguage();
    const { hasPermission } = useUser();
    const { showToast } = useToast();
    // Same gate the Dyeing Orders tab uses to start and complete a batch: entering
    // the rpm is part of setting the machine up, not a supervisory act.
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

    const statusLabel = (s: string): string => ({
        RUNNING: t('running'), LOADED: t('loaded'),
    } as Record<string, string>)[s] || t('idle');

    const { sections, visibleSections, isGrouped, plantBelowTarget } =
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
            classic
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
        const reason = missing.includes('yards_per_rev')
            ? { text: t('no_reel_measured'), hint: t('no_reel_measured_hint') }
            : missing.includes('rpm')
                ? { text: t('no_rpm_entered'), hint: undefined }
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

    const RunBody = ({ run, machine }: { run: any; machine: any }) => {
        const live = isLive(run);
        // A loaded batch has no clock yet, so its % is not a judgement of the vessel.
        const effColor = !live ? '#888' : run.on_target ? GREEN : RED;
        const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
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
                        <StatusChip status="LOADED" label={t('loaded')} title={t('batch_loaded_hint')} tint />
                    </div>
                )}
                <div style={{ marginBottom: 4 }}><RunVariant run={run} /></div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 24, fontWeight: 'bold', color: effColor, lineHeight: 1 }}>
                        {fmt(run.efficiency_pct, 1)}<span style={{ fontSize: 12}}>%</span>
                    </span>
                    <span style={{ fontSize: 10, color: '#888' }}>
                        {t('target')} {fmt(run.target_efficiency_pct, 0)}%
                    </span>
                    <span style={{ fontSize: 10, color: '#888', marginLeft: 'auto' }}>
                        {run.lines} {t('lines')}
                    </span>
                </div>
                <div style={{ margin: '4px 0' }}>
                    <EffBar eff={run.efficiency_pct} target={run.target_efficiency_pct}
                        label={`${t('target')} ${fmt(run.target_efficiency_pct, 0)}%`} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10}}>
                    <span>
                        <span style={{ color: '#888' }}>{t('yards_dyed')}:</span>{' '}
                        <b>{fmt(run.actual_yards, 0)}</b> {t('yd_short')}
                    </span>
                    <span style={{ color: '#666' }}>{fmt(run.actual_rate_yd_min, 1)} {t('yd_per_min')}</span>
                </div>
                {/* The rate the batch is being judged against, and how long it has been
                    on. Both are inputs the floor sets, so they sit next to the result. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888', marginTop: 2 }}>
                    <span>
                        {t('rpm')} <b style={{ color: '#555' }}>{fmt(run.rpm, 0)}</b>
                        {run.target_yd_per_min ? ` · ${fmt(run.target_yd_per_min, 0)} ${t('yd_per_min')}` : ''}
                    </span>
                    <span>{t('elapsed')} <b style={{ color: '#555' }}>{fmtElapsed(run.elapsed_minutes)}</b></span>
                </div>
                <MissingWhy run={run} machine={machine} />
                {canSetRate && (
                    <div style={{ marginTop: 4 }}>
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
                    borderBottom: `1px solid ${'#c8c4b8'}`,
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
                            <span key={r.id} onClick={go(i)} title={`${r.wo_code || r.mo_code} · ${statusLabel(isLive(r) ? 'RUNNING' : 'LOADED')}`}
                                style={{
                                    width: 7, height: 7, borderRadius: '50%', cursor: 'pointer',
                                    background: i === idx
                                        ? (isLive(r) ? GREEN : BLUE)
                                        : (isLive(r) ? '#a8dca8' : '#c8c4b8'),
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
            {/* An idle vessel is the one place there is room to say the machine was
                never measured, before a batch arrives and the card fills up. */}
            {machine.needs_setup && (
                <span title={t('no_reel_measured_hint')} style={{ fontSize: 10, color: '#8a6100' }}>
                    <i className="bi bi-gear" style={{ marginRight: 3 }} />{t('no_reel_measured')}
                </span>
            )}
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
                alarm={runs.some((r: any) => r.on_target === false)}
                alarmTitle={t('below_target')}
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
            {plantBelowTarget > 0 && (
                <span style={{ marginLeft: 12 }}>
                    <b style={{ color: '#ffc9c9'}}>{plantBelowTarget}</b> {t('below_target')}
                </span>
            )}
            {/* Plant-wide, and deliberately in the header: until a reel is measured the
                grid can report nothing at all, and that is a setup task, not a fault. */}
            {data.needs_setup > 0 && (
                <span style={{ marginLeft: 12 }} title={t('no_reel_measured_hint')}>
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
