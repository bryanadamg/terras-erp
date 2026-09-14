'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { xpFont, familyColor, StatusChip, XPEmptyState, XPActionButton, BUTTON_RADIUS, XP_BTN } from '../shared/xpTheme';
import VariantChips from '../shared/VariantChips';
import { useToast } from '../shared/Toast';
import WorkCenterMonitorModal from './WorkCenterMonitorModal';
import GroupCalendarModal from './GroupCalendarModal';
import { useMonitorSections } from './machineMonitor/useMonitorSections';
import {
    EffBar, CardGrid, MachineCard, GroupHeader, MonitorChipBar,
} from './machineMonitor/MonitorParts';
import { MonitorShell, MonitorGridSkeleton } from './machineMonitor/MonitorShell';

// Measurement accents come from the shared five-family palette (DESIGN.md's one
// semantic layer) — never a per-view hex.
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
function fmtDate(s: any): string {
    if (!s) return '—';
    return String(s).slice(0, 10);
}

// Every RUNNING run on a loom. A loom weaving one item for two combos carries one
// run per WO, so the card is a list — `active_run` is only the first of them and is
// read here as the fallback for an older API response.
function runsOf(m: any): any[] {
    if (Array.isArray(m?.active_runs)) return m.active_runs;
    return m?.active_run ? [m.active_run] : [];
}

export default function WeavingMonitorView() {
    const { authFetch, subscribeLiveEvents } = useData();
    const { t } = useLanguage();
    const { hasPermission } = useUser();
    const { showToast } = useToast();
    const canManage = hasPermission('calendar.edit');
    // Prep steps are floor dispatch decisions, same gate as starting a run.
    const canPrep = hasPermission('weaving_monitor.start');

    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<any>(null);
    const [calGroup, setCalGroup] = useState<any>(null);
    // Group focus. null = every group (the default): a monitor must open showing the
    // whole plant, so this narrows on request and never hides a bank by default.
    const [groupFilter, setGroupFilter] = useState<string | null>(null);
    // Which run each multi-WO loom card is showing, keyed by machine id. It lives up
    // here and not in the card because `card`/`RunCarousel` are declared inside this
    // render: a component identity that changes every render remounts and would drop
    // the slide on every live refresh.
    const [runSlide, setRunSlide] = useState<Record<string, number>>({});
    // "Running only" — hides looms with no active run. Same rule as groupFilter: it
    // hides CARDS, never measurements, so every count/badge on the strip and the
    // group bands stays plant-wide while it is on.
    const [runningOnly, setRunningOnly] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/weaving/monitor`);
            if (res.ok) setData(await res.json());
        } finally {
            setLoading(false);
        }
    }, [API_BASE, authFetch]);

    useEffect(() => { load(); }, [load]);

    // Live: a run start/update/stop/delete re-loads this monitor — and so does a
    // production log ('production'), because a WO completion on any of these looms
    // moves actual_kg/efficiency. Completions broadcast MANUFACTURING_ORDER_UPDATE,
    // not weaving_run, so listening for 'weaving' alone left the grid stale until a
    // manual refresh.
    useEffect(() => {
        const unsubscribe = subscribeLiveEvents(['weaving', 'production'], () => load());
        return unsubscribe;
    }, [subscribeLiveEvents, load]);

    const closeModal = () => { setSelected(null); load(); };
    const machines: any[] = data?.machines || [];

    // Loom prep walk: IDLE → STAGED (warp up) → DRAW_IN → TUNING → RUNNING. The
    // backend derives the state (see weaving_service.derive_loom_status) — this view
    // only names it, so the card can never invent a state the API wouldn't accept a
    // transition from. Colour comes from the shared machineStatus map.
    const loomLabel = (s: string): string => ({
        RUNNING: t('running'), STAGED: t('staged'), DRAW_IN: t('draw_in'), TUNING: t('tuning'),
    } as Record<string, string>)[s] || t('idle');

    const [prepBusy, setPrepBusy] = useState<string | null>(null);
    const setPrep = async (m: any, step: string | null) => {
        setPrepBusy(m.id);
        try {
            const res = await authFetch(`${API_BASE}/work-centers/${m.id}/loom-prep`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: step }),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => null);
                showToast(d?.detail || t('prep_failed'), 'danger');
                return;
            }
            await load();
        } finally {
            setPrepBusy(null);
        }
    };

    // Looms are shown per work-center GROUP so a whole group's calendar can be set in
    // one go. Machines that sit straight under their TYPE node (the pre-group shape)
    // collect in a trailing Ungrouped section — no group, so no batch action.
    const { sections, visibleSections, isGrouped, plantBelowTarget, plantLate } =
        useMonitorSections({ machines, runsOf, groupFilter });

    const shown = (list: any[]) => (runningOnly ? list.filter((m: any) => runsOf(m).length > 0) : list);
    const runningCount = useMemo(() => machines.filter((m: any) => runsOf(m).length > 0).length, [machines]);

    // loom_status rides along so the window that opens wears the same title-bar
    // colour as the card that opened it — green for a running loom, not the generic
    // dialog blue. A modal that doesn't match the tile it came from reads as a
    // different screen rather than that tile, zoomed in.
    const openCard = (m: any) => setSelected({
        id: m.id, code: m.code, name: m.name, center_type: m.center_type,
        loom_status: m.loom_status || (runsOf(m).length ? 'RUNNING' : 'IDLE'),
    });

    // What variant the loom is running right now. The MO alone doesn't say it — a
    // supervisor on the floor reads combo/size off the card to match the loom against
    // the physical warp and the WO ticket.
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

    // Warp on the loom. A beam belongs to the machine, not to a work order — every
    // WO that runs here draws from it — so its readiness reads in whole beams
    // against the machine's beam positions, and lives on the machine card.
    const BeamStrip = ({ m }: { m: any }) => {
        const beams: any[] = m.mounted_beams || [];
        const slots = m.beam_slots ?? 1;
        const pcs = m.mounted_pcs ?? 0;
        const full = pcs >= slots;
        const border = '#c8c4b8';
        return (
            <div style={{ marginTop: 5, paddingTop: 4, borderTop: `1px solid ${border}`, fontSize: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ color: '#888' }}>{t('warp_mounted')}</span>
                    <span style={{ fontWeight: 'bold', color: full ? GREEN : pcs > 0 ? AMBER : '#999' }}>
                        {pcs} / {slots} {t('pcs')}
                        {pcs > 0 ? <span style={{ color: '#666', fontWeight: 'normal' }}> · {fmt(m.mounted_kg, 1)} kg</span> : null}
                    </span>
                </div>
                {beams.length > 0 && (
                    <div style={{ marginTop: 2, color: '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {beams.map((b, i) => (
                            <span key={b.mount_id}>
                                {i > 0 ? ', ' : ''}
                                <b style={{ color: BLUE }}>{b.beam_number}</b>
                                <span style={{ color: '#888' }}> {fmt(b.remaining, 1)}kg</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const modal = (
        <>
            <WorkCenterMonitorModal
                isOpen={!!selected}
                onClose={closeModal}
                workCenter={selected}
                authFetch={authFetch}
                apiBase={API_BASE}
            />
            <GroupCalendarModal
                isOpen={!!calGroup}
                onClose={() => setCalGroup(null)}
                group={calGroup}
                authFetch={authFetch}
                apiBase={API_BASE}
                onApplied={load}
            />
        </>
    );

    const summaryText = data ? (
        <>
            <span><b>{data.total}</b> {t('machines')}</span>
            <span style={{ marginLeft: 12 }}><b style={{ color: '#9effa0'}}>{data.running}</b> {t('running')}</span>
            {data.avg_efficiency_pct !== null && data.avg_efficiency_pct !== undefined && (
                <span style={{ marginLeft: 12 }}>{t('avg_efficiency')}: <b>{fmt(data.avg_efficiency_pct, 1)}%</b></span>
            )}
            {/* Plant-wide alarm counts, always visible regardless of the group filter. */}
            {plantBelowTarget > 0 && (
                <span style={{ marginLeft: 12 }}>
                    <b style={{ color: '#ffc9c9'}}>{plantBelowTarget}</b> {t('below_target')}
                </span>
            )}
            {plantLate > 0 && (
                <span style={{ marginLeft: 12 }}>
                    <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 4 }} />
                    <b style={{ color: '#ffc9c9'}}>{plantLate}</b> {t('behind_schedule')}
                </span>
            )}
        </>
    ) : null;

    // Run readout — ONE copy for both themes. This block used to be duplicated in
    // the classic and modern card renderers, which is how they drifted (a field
    // added to one went missing from the other). Only the chrome around it branches.
    // The two completion dates side by side, plus the warning. `wo_target_end_date`
    // is the date entered when the WO was created (the promise); `reality_...` is
    // where today's actual rate lands. The gap between them is the decision — add a
    // machine, or add working days.
    const DueLine = ({ run }: { run: any }) => {
        if (!run.wo_target_end_date && !run.reality_completion_date && !run.reality_unreachable) return null;
        const late = !!run.is_late;
        return (
            <div style={{ marginTop: 4, fontSize: 10, lineHeight: 1.35 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ color: '#888' }}>{t('wo_due')}</span>
                    <b>{fmtDate(run.wo_target_end_date || run.target_completion_date)}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ color: '#888' }}>{t('projected_completion')}</span>
                    <b style={{ color: late ? RED : GREEN }}>
                        {run.reality_unreachable ? t('not_achievable') : fmtDate(run.reality_completion_date)}
                    </b>
                </div>
                {late && (
                    <div style={{
                        marginTop: 3, padding: '1px 5px', background: '#ffe6e6',
                        border: `1px solid ${RED}`, color: RED, fontWeight: 'bold',
                        display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                        <i className="bi bi-exclamation-triangle-fill" />
                        <span>
                            {run.reality_unreachable
                                ? t('no_output_yet')
                                : `${t('late_by')} ${run.days_late} ${t('days')}`}
                        </span>
                    </div>
                )}
            </div>
        );
    };

    const RunBody = ({ run }: { run: any }) => {
        // A parked run's % is a record of days already woven, not a live reading, so it
        // drops out of the green/red judgement instead of sitting there accusing a loom
        // of underperforming on work nobody asked it to do.
        const effColor = run.is_paused ? '#888' : run.on_target ? GREEN : RED;
        return (
            <>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {/* WO first: with several runs on one loom the WO is what tells them
                        apart on the floor — the MO is shared by every combo. */}
                    {run.wo_code && <b style={{ color: BLUE }}>{run.wo_code} · </b>}
                    <b>{run.mo_code}</b>{run.item_code ? ` · ${run.item_code}` : ''}
                </div>
                {/* Parked, not finished. The badge has to be on the card and not just
                    in the modal: the whole point of pausing is that the reader stops
                    reading this run's efficiency as a live judgement of the loom. */}
                {run.is_paused && (
                    <div style={{ marginBottom: 4 }}>
                        <StatusChip
                            status="PAUSED"
                            label={run.paused_on ? `${t('paused')} · ${fmtDate(run.paused_on)}` : t('paused')}
                            title={`${t('paused_days_excluded')}: ${run.paused_working_days ?? 0}`}
                            tint
                        />
                    </div>
                )}
                <div style={{ marginBottom: 4 }}><RunVariant run={run} /></div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 24, fontWeight: 'bold', color: effColor, lineHeight: 1 }}>
                        {fmt(run.efficiency_pct, 1)}<span style={{ fontSize: 12}}>%</span>
                    </span>
                    <span style={{ fontSize: 10, color: '#888' }}>{t('target')} {fmt(run.target_efficiency_pct, 0)}%</span>
                    <span style={{ fontSize: 10, color: '#888', marginLeft: 'auto' }}>
                        {run.lines} {t('lines')}
                    </span>
                </div>
                <div style={{ margin: '4px 0' }}>
                    <EffBar eff={run.efficiency_pct} target={run.target_efficiency_pct}
                        label={`${t('target')} ${fmt(run.target_efficiency_pct, 0)}%`} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10}}>
                    <span><span style={{ color: '#888' }}>{t('actual')}:</span> <b>{fmt(run.actual_kg, 1)}</b> / {fmt(run.target_qty, 0)} kg</span>
                    <span style={{ color: '#666' }}>{fmt(run.actual_daily_rate_kg, 1)} kg/d</span>
                </div>
                <DueLine run={run} />
            </>
        );
    };

    // Several WOs on one loom: ONE run on screen at a time, paged like a slide deck.
    // They used to stack, which made a 3-WO card three times the height of every
    // other tile in the grid and broke the one thing a monitor grid is for — scanning
    // looms against each other. A run's readout is not summarisable (own lines, own
    // dates, own late warning), so the fix is paging, not merging.
    //
    // The dot rail is why paging is safe here: a late run stays visible as a red dot
    // even while another slide is up, and one click goes to it. Without that, hiding
    // runs would hide alarms.
    const RunCarousel = ({ m, runs }: { m: any; runs: any[] }) => {
        const total = runs.length;
        if (total === 1) return <RunBody run={runs[0]} />;
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
                    <span style={{ display: 'flex', gap: 3, marginLeft: 'auto', alignItems: 'center' }}>
                        {runs.map((r: any, i: number) => (
                            <span key={r.id} onClick={go(i)}
                                title={`${r.wo_code || r.mo_code}${r.is_late ? ` · ${t('behind_schedule')}` : ''}`}
                                style={{
                                    width: 7, height: 7, borderRadius: '50%', cursor: 'pointer',
                                    background: i === idx ? (r.is_late ? RED : BLUE) : (r.is_late ? '#f3b0b0' : '#c8c4b8'),
                                    border: i === idx ? '1px solid #00000055' : '1px solid transparent',
                                }} />
                        ))}
                    </span>
                </div>
                <RunBody run={runs[idx]} />
            </>
        );
    };

    // No run yet. Which prep step the loom is waiting on is the useful line here —
    // "no active run" alone couldn't tell a supervisor whether the loom is dead or
    // two clicks from producing.
    const IdleBody = ({ status }: { status: string }) => {
        const prep = status !== 'IDLE';
        return (
            <div style={{ fontSize: 11, color: prep ? '#555' : '#888', display: 'flex', flexDirection: 'column', gap: 3, justifyContent: 'center', flex: 1, minHeight: 64}}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <i className={`bi ${prep ? 'bi-tools' : 'bi-pause-circle'}`} style={{ fontSize: 16}} />
                    {prep ? loomLabel(status) : t('no_active_run')}
                </span>
                {prep && <span style={{ fontSize: 10, color: '#888' }}>{t('loom_prep_hint')}</span>}
            </div>
        );
    };

    // Prep actions on the card. The floor confirms Draw-in, then Tuning, before a
    // run may be started — so the button that moves the loom forward sits on the
    // loom's own tile, not two clicks deep in the modal. The card itself opens the
    // modal, hence stopPropagation on every control here.
    const PrepRow = ({ m }: { m: any }) => {
        const status: string = m.loom_status || 'IDLE';
        const next: string | null = m.next_loom_step || null;
        if (!canPrep || status === 'RUNNING' || status === 'IDLE') return null;
        const busy = prepBusy === m.id;
        const border = '#c8c4b8';
        const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
        return (
            <div style={{ marginTop: 5, paddingTop: 5, borderTop: `1px solid ${border}`, display: 'flex', gap: 4, alignItems: 'center' }}>
                {next && (
                    <XPActionButton
                        tone={next === 'TUNING' ? 'warning' : 'primary'}
                        icon={next === 'TUNING' ? 'bi-sliders' : 'bi-arrows-collapse-vertical'}
                        label={next === 'TUNING' ? t('tuning') : t('draw_in')}
                        disabled={busy}
                        onClick={stop(() => setPrep(m, next))}
                    />
                )}
                {status !== 'STAGED' && (
                    <XPActionButton
                        tone="neutral"
                        icon="bi-arrow-counterclockwise"
                        title={t('prep_reset')}
                        disabled={busy}
                        onClick={stop(() => setPrep(m, null))}
                    />
                )}
                {/* TUNING is the last prep step: nothing left to click here, the run is
                    started from the machine modal's Start form. */}
                {status === 'TUNING' && !next && (
                    <span style={{ fontSize: 10, color: '#666', marginLeft: 'auto' }}>
                        <i className="bi bi-play-circle" style={{ marginRight: 3 }} />{t('start_run')}
                    </span>
                )}
            </div>
        );
    };

    const card = (m: any) => {
        const runs = runsOf(m);
        const loomStatus: string = m.loom_status || (runs.length ? 'RUNNING' : 'IDLE');
        return (
            <MachineCard
                key={m.id}
                classic
                code={m.code}
                name={m.name}
                status={loomStatus}
                statusLabel={loomLabel(loomStatus)}
                alarm={runs.some((r: any) => r.is_late)}
                alarmTitle={t('behind_schedule')}
                badge={runs.length > 1 ? `${runs.length} ${t('wo_short')}` : undefined}
                onClick={() => openCard(m)}
                title={t('click_for_detail')}
                footer={<><BeamStrip m={m} /><PrepRow m={m} /></>}
            >
                {runs.length ? <RunCarousel m={m} runs={runs} /> : <IdleBody status={loomStatus} />}
            </MachineCard>
        );
    };

    const cardGrid = (list: any[]) => <CardGrid classic>{list.map(card)}</CardGrid>;

    const chipBar = (
        <MonitorChipBar
            classic
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
        <MonitorGridSkeleton classic />
    ) : machines.length === 0 ? (
        <XPEmptyState icon="bi-cpu" message={t('no_weaving_machines')} />
    ) : runningOnly && runningCount === 0 ? (
        <XPEmptyState icon="bi-pause-circle" message={t('no_running_machines')} />
    ) : !isGrouped ? (
        cardGrid(shown(machines))
    ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10}}>
            {/* A group with nothing running drops out entirely while the filter is on —
                its band alone would read as a bank with a missing grid. Its alarms are
                still on the chip bar, which is why hiding it is safe. */}
            {visibleSections.filter(sec => shown(sec.machines).length > 0).map(sec => (
                <div key={sec.id || 'ungrouped'}>
                    <GroupHeader
                        classic
                        sec={sec}
                        labels={{
                            machines: t('machines'), running: t('running'),
                            avgEfficiency: t('avg_efficiency'), belowTarget: t('below_target'),
                            late: t('behind_schedule'),
                        }}
                        action={sec.id && canManage ? (
                            <XPActionButton tone="neutral" icon="bi-calendar3"
                                label={t('work_calendar')} onClick={() => setCalGroup(sec)} />
                        ) : null}
                    />
                    {cardGrid(shown(sec.machines))}
                </div>
            ))}
        </div>
    );

    return (
        <>
            <MonitorShell
                classic
                icon="bi-speedometer2"
                title={t('weaving_monitor')}
                summary={summaryText}
                onRefresh={load}
                refreshTitle={t('refresh')}
                loading={loading}
                hasMachines={machines.length > 0}
                chipBar={chipBar}
            >
                {body}
            </MonitorShell>
            {modal}
        </>
    );
}
