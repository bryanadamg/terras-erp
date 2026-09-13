'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ModalWrapper from '../shared/ModalWrapper';

// Loom status → window chrome. Exported so the monitor grid can paint a card's
// status strip with the very gradient the window it opens will wear (see
// `loomStrip` in WeavingMonitorView) — one map, so the two can't drift.
// Re-exported, not redefined: the card strip and this window's title bar must
// come from ONE table or a green tile can open a slightly different green window.
// See machineMonitor/machineStatus.ts, which also covers the dye vessel states.
export { MACHINE_TITLE_VARIANT as LOOM_TITLE_VARIANT } from './machineMonitor/machineStatus';
import { MACHINE_TITLE_VARIANT } from './machineMonitor/machineStatus';
import SearchableSelect from '../shared/SearchableSelect';
import CameraScanner from '../shared/CameraScanner';
import VariantChips from '../shared/VariantChips';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { useData } from '../../context/DataContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useToast } from '../shared/Toast';
import {
    xpFont, familyColor, StatusChip, XPActionButton, PanelSkeleton, XPEmptyState,
    ExpandedRowPanel, ExpandedRowPanelBody, FormSection, FieldLabel, ProgressBar,
    xpSelect, xpPanel, SectionTitle, CodeChip, Chip, statusTint, CHIP_RADIUS,
    LegendPanel,
} from '../shared/xpTheme';
import { SearchField } from '../shared/shellTheme';
import { lvInput, lvTh, lvTd, lvRow } from '../shared/listViewTheme';
import { Tabs, TabDef } from '../shared/Tabs';
import { LotChips } from '../shared/LotChips';
import { WorkingDaysSection, HolidayCalendarSection, useNationalHolidays } from '../shared/productionCalendar';
import LotLabelPrintModal from './LotLabelPrintModal';

// Measurement accents from the shared five-family palette — see DESIGN.md's one
// semantic layer rule; the weaving grid resolves the same three.
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

interface Props {
    isOpen: boolean;
    onClose: () => void;
    workCenter: any;
    authFetch: (url: string, opts?: any) => Promise<Response>;
    apiBase: string;
}

export default function WorkCenterMonitorModal({ isOpen, onClose, workCenter, authFetch, apiBase }: Props) {
    const { t } = useLanguage();
    const { hasPermission, hasAnyPermission } = useUser();
    const { locations } = useData();
    const { showToast } = useToast();
    const canManage = hasAnyPermission('weaving_monitor.start', 'calendar.edit', 'beam.unmount');
    // Mounting is gated on what the endpoint enforces (work_order.edit), not on the
    // unmount permission — putting warp up and taking it down are different calls.
    const canMount = hasPermission('work_order.edit');

    // Stock lives only in leaf locations — same filter/label the PR modal uses.
    const leafLocations = useMemo(
        () => (locations || []).filter((l: any) => !l.has_children && l.location_type !== 'warehouse'),
        [locations],
    );
    const locLabel = (l: any) => l.full_path || (l.parent_name ? `${l.parent_name} / ${l.name}` : l.name);

    const [tab, setTab] = useState<'performance' | 'calendar' | 'beams'>('performance');
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [loom, setLoom] = useState<any>(null);
    const [dismounting, setDismounting] = useState<string | null>(null);
    // Row expanded into its unmount confirm strip, plus the picked return location.
    const [unmountingId, setUnmountingId] = useState<string | null>(null);
    const [returnLoc, setReturnLoc] = useState('');
    // Leftover re-lot, filled in on the same strip: the warp stripped off the beam
    // is weighed, and that weight — not the system's remaining — becomes a lot.
    // Every dismount weighs and re-lots; there is no plain-dismount branch.
    const [leftoverQty, setLeftoverQty] = useState('');
    const [leftoverEnds, setLeftoverEnds] = useState('');
    const [leftoverLotNo, setLeftoverLotNo] = useState('');
    // Newly-minted leftover lot to print right after a successful dismount.
    const [printLot, setPrintLot] = useState<any>(null);
    // Mount picker: beams in stock that are on no loom right now, leftovers included.
    const [mountOpen, setMountOpen] = useState(false);
    const [freeBeams, setFreeBeams] = useState<any[]>([]);
    const [freeLoading, setFreeLoading] = useState(false);
    const [beamSearch, setBeamSearch] = useState('');
    const [mountingId, setMountingId] = useState<string | null>(null);
    // Camera mount: the picker's search box already accepts a keyboard-wedge
    // scanner (Enter -> handleBeamScan), which covers a laser gun at the loom but
    // not a phone. Same decode path either way — the camera just feeds the string.
    const [beamCameraOn, setBeamCameraOn] = useState(false);
    const beamScanSeenRef = useRef<Record<string, number>>({});

    const [moId, setMoId] = useState('');
    // WO candidates: the run is started per WORK ORDER, because a loom weaves the
    // same item for two combos side by side and each combo is its own WO with its
    // own line count and its own promised end date.
    const [woId, setWoId] = useState('');
    const [woCands, setWoCands] = useState<any[]>([]);
    const [woCandsLoading, setWoCandsLoading] = useState(false);
    // MO candidates come from the server scoped to this machine (MOs with a WO
    // dispatched here) — the global manufacturingOrders list is page-1 roots only
    // and misses consolidated component MOs, which is what weaving usually runs.
    // Kept as the escape hatch for a loom with no WO dispatched to it yet.
    const [moMode, setMoMode] = useState(false);
    const [moCands, setMoCands] = useState<any[]>([]);
    const [moCandsAll, setMoCandsAll] = useState(false);
    const [moCandsLoading, setMoCandsLoading] = useState(false);
    const { todayInput } = useTimezone();
    const [startOpen, setStartOpen] = useState(false);
    const [lines, setLines] = useState('1');
    const [rate, setRate] = useState('5');
    const [eff, setEff] = useState('50');
    const [startDate, setStartDate] = useState(todayInput);

    // Both inline editors are keyed by run id, not a boolean: a loom shows several
    // runs at once and a shared flag would open the editor on every one of them.
    const [overrideVal, setOverrideVal] = useState('');
    const [overrideRunId, setOverrideRunId] = useState<string | null>(null);

    const [targetVal, setTargetVal] = useState('');
    const [targetRunId, setTargetRunId] = useState<string | null>(null);

    const [linesVal, setLinesVal] = useState('');
    const [linesRunId, setLinesRunId] = useState<string | null>(null);

    const [rateVal, setRateVal] = useState('');
    const [rateRunId, setRateRunId] = useState<string | null>(null);

    const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4]);
    const [holidays, setHolidays] = useState<any[]>([]);
    const [calRef, setCalRef] = useState<Date>(() => new Date());
    // National holidays for the displayed year — shared hook, same overlay the group
    // calendar renders.
    const national = useNationalHolidays(authFetch, apiBase, calRef.getFullYear(), isOpen);
    // Title bar wears the loom's own status colour — the same gradient the card on
    // the monitor grid paints on its status strip (see `loomStrip` in
    // WeavingMonitorView; success/warning/primary here resolve to those exact
    // gradients). Falls back to `info` when the caller passes no status, so a
    // non-weaving work centre keeps the neutral window chrome.
    const titleVariant = MACHINE_TITLE_VARIANT[workCenter?.loom_status as string] || 'info';


    const wcId = workCenter?.id;

    const load = useCallback(async () => {
        if (!wcId) return;
        setLoading(true);
        try {
            const [res, bres] = await Promise.all([
                authFetch(`${apiBase}/work-centers/${wcId}/performance`),
                authFetch(`${apiBase}/work-centers/${wcId}/beam-mounts`),
            ]);
            if (res.ok) {
                const d = await res.json();
                setData(d);
                setWeekdays(d?.calendar?.working_weekdays || [0, 1, 2, 3, 4]);
                setHolidays(d?.calendar?.holidays || []);
            }
            setLoom(bres.ok ? await bres.json() : null);
        } finally {
            setLoading(false);
        }
    }, [wcId, apiBase, authFetch]);

    // Take a beam off this loom. Every dismount strips and weighs the remnant:
    // it is split into its own LFT- lot (mountable again anywhere, on this loom
    // or any other), the parent beam is retired at 0, and the scale-vs-system
    // difference is written off on the parent.
    const dismount = async (mount: any, toLocationId: string) => {
        const mountId = mount.id;
        const weighed = parseFloat(leftoverQty);
        if (Number.isNaN(weighed) || weighed < 0) {
            showToast(t('leftover_weighed_qty'), 'danger');
            return;
        }
        setDismounting(mountId);
        try {
            const res = await authFetch(`${apiBase}/beam-mounts/${mountId}/dismount`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to_location_id: toLocationId || null,
                    leftover_qty: weighed,
                    leftover_beam_number: leftoverLotNo.trim() || null,
                    leftover_ends: leftoverEnds ? parseInt(leftoverEnds, 10) : null,
                }),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => null);
                showToast(d?.detail || t('unmount_failed'), 'danger');
                return;
            }
            const out = await res.json().catch(() => null);
            if (out?.leftover_beam_number) {
                showToast(
                    t('leftover_created')
                        .replace('{lot}', out.leftover_beam_number)
                        .replace('{qty}', fmt(out.leftover_qty, 2)),
                    'success',
                );
                // Print the new lot label right away — the beam is off the loom
                // now and the remnant needs a physical tag before it moves.
                setPrintLot({
                    id: out.leftover_batch_id,
                    batch_number: out.leftover_beam_number,
                    remaining: out.leftover_qty,
                    item_name: mount.item_name,
                    item_code: mount.item_code,
                });
            } else {
                showToast(t('unmount_done'), 'success');
            }
            closeUnmount();
            if (mountOpen) await loadFreeBeams();
            await load();
        } finally {
            setDismounting(null);
        }
    };

    const closeUnmount = () => {
        setUnmountingId(null);
        setLeftoverQty('');
        setLeftoverEnds('');
        setLeftoverLotNo('');
    };

    // Beams free to go up: in stock, on no loom. Deliberately not item-scoped —
    // this panel has no order context, the planner picks the warp.
    const loadFreeBeams = useCallback(async () => {
        if (!wcId) return;
        setFreeLoading(true);
        try {
            const qs = beamSearch.trim() ? `?search=${encodeURIComponent(beamSearch.trim())}` : '';
            const res = await authFetch(`${apiBase}/work-centers/${wcId}/available-beams${qs}`);
            setFreeBeams(res.ok ? await res.json() : []);
        } finally {
            setFreeLoading(false);
        }
    }, [wcId, apiBase, authFetch, beamSearch]);

    const mount = async (batchId: string) => {
        setMountingId(batchId);
        try {
            const res = await authFetch(`${apiBase}/work-centers/${wcId}/beam-mounts`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ batch_id: batchId }),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => null);
                showToast(d?.detail || t('mount_failed'), 'danger');
                return;
            }
            showToast(t('mount_done'), 'success');
            await Promise.all([load(), loadFreeBeams()]);
        } finally {
            setMountingId(null);
        }
    };

    // Enter in the picker's search — typed, or a barcode scanner firing Enter
    // after the code — bypasses the debounce and mounts straight away on an
    // exact lot-number match. No new endpoint: the same /available-beams search
    // already matches batch_number, this just skips the "click Mount" step.
    const handleBeamScan = async (code: string) => {
        const trimmed = code.trim();
        if (!trimmed) return;
        setFreeLoading(true);
        try {
            const res = await authFetch(`${apiBase}/work-centers/${wcId}/available-beams?search=${encodeURIComponent(trimmed)}`);
            const rows = res.ok ? await res.json() : [];
            setFreeBeams(rows);
            const exact = rows.find((b: any) => (b.beam_number || '').toUpperCase() === trimmed.toUpperCase());
            if (exact) {
                setBeamSearch('');
                await mount(exact.batch_id);
            } else if (rows.length === 0) {
                showToast(t('no_free_beams'), 'danger');
            }
        } finally {
            setFreeLoading(false);
        }
    };

    // A QR in frame fires many frames a second and each read mounts a beam, so the
    // camera path debounces per code — the typed path can't repeat itself this way.
    const handleBeamCameraScan = (decoded: string) => {
        const code = (decoded || '').trim();
        if (!code) return;
        const now = Date.now();
        if (beamScanSeenRef.current[code] && now - beamScanSeenRef.current[code] < 2500) return;
        beamScanSeenRef.current[code] = now;
        handleBeamScan(code);
    };

    // Collapsing the picker takes the camera down with it: the video element lives
    // inside the panel, and CLAUDE.md's one-live-camera rule means a hidden-but-
    // running track is the bug, not a saving.
    useEffect(() => {
        if (!mountOpen) setBeamCameraOn(false);
    }, [mountOpen]);

    // Picker feed: refetch when it opens and on a paused search — same 300ms shape
    // the shared list hooks use, so typing a lot number doesn't fire per keystroke.
    useEffect(() => {
        if (!mountOpen) return;
        const h = setTimeout(() => { loadFreeBeams(); }, beamSearch ? 300 : 0);
        return () => clearTimeout(h);
    }, [mountOpen, beamSearch, loadFreeBeams]);

    useEffect(() => {
        if (isOpen && wcId) {
            setTab('performance');
            setUnmountingId(null);
            setMountOpen(false);
            setBeamSearch('');
            setBeamCameraOn(false);
            setFreeBeams([]);
            setOverrideRunId(null);
            setTargetRunId(null);
            setLinesRunId(null);
            setRateRunId(null);
            setCalRef(new Date());
            setMoCands([]);
            setWoCands([]);
            setMoCandsAll(false);
            setMoMode(false);
            setStartOpen(false);
            setWoId('');
            setMoId('');
            load();
        }
    }, [isOpen, wcId, load]);

    // WOs offered in the start-run picker. Fetched whenever the form can be opened —
    // which is now always for a manager, since a loom already running one WO is
    // exactly where a second one gets added.
    useEffect(() => {
        if (!isOpen || !wcId || !canManage) return;
        let cancelled = false;
        setWoCandsLoading(true);
        authFetch(`${apiBase}/work-centers/${wcId}/candidate-wos`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled) setWoCands(d?.items || []); })
            .catch(() => { if (!cancelled) setWoCands([]); })
            .finally(() => { if (!cancelled) setWoCandsLoading(false); });
        return () => { cancelled = true; };
    }, [isOpen, wcId, canManage, data?.active_runs?.length, apiBase, authFetch]);

    // MOs offered in the fallback picker: scoped to this machine's WOs, widened
    // to every open MO only when the operator asks for it.
    useEffect(() => {
        if (!isOpen || !wcId || !canManage || !moMode) return;
        let cancelled = false;
        setMoCandsLoading(true);
        authFetch(`${apiBase}/work-centers/${wcId}/candidate-mos?include_all=${moCandsAll}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled) setMoCands(d?.items || []); })
            .catch(() => { if (!cancelled) setMoCands([]); })
            .finally(() => { if (!cancelled) setMoCandsLoading(false); });
        return () => { cancelled = true; };
    }, [isOpen, wcId, canManage, moMode, moCandsAll, apiBase, authFetch]);

    // Loom prep walk (STAGED → DRAW_IN → TUNING) — state comes from the beam-mounts
    // call, which derives it server-side, so this panel and the monitor card always
    // agree. Start is the last step and stays blocked until Tuning is confirmed.
    const loomStatus: string = loom?.loom_status || 'IDLE';
    const nextLoomStep: string | null = loom?.next_loom_step || null;
    const prepBlocksStart = loomStatus === 'STAGED' || loomStatus === 'DRAW_IN';
    const [prepBusy, setPrepBusy] = useState(false);
    const stepLabel = (s: string | null): string =>
        s === 'DRAW_IN' ? t('draw_in') : s === 'TUNING' ? t('tuning') : s === 'STAGED' ? t('staged') : t('idle');

    const setPrep = async (step: string | null) => {
        setPrepBusy(true);
        try {
            const res = await authFetch(`${apiBase}/work-centers/${wcId}/loom-prep`, {
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
            setPrepBusy(false);
        }
    };

    const startRun = async () => {
        if (!woId && !moId) return;
        const res = await authFetch(`${apiBase}/weaving-runs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                work_center_id: wcId,
                // WO wins when one is picked — the backend derives the MO from it.
                ...(woId ? { work_order_id: woId } : { mo_id: moId }),
                lines: parseInt(lines) || 1,
                rate_per_line_g_min: parseFloat(rate) || 0,
                target_efficiency_pct: parseFloat(eff) || 0,
                start_date: startDate,
            }),
        });
        if (!res.ok) {
            // 422 = the prep gate (warp staged but Draw-in/Tuning not confirmed);
            // 400 = this WO is already running here. Surfacing both beats the old
            // silent no-op.
            const d = await res.json().catch(() => null);
            showToast(d?.detail || t('prep_blocked_start'), 'danger');
            return;
        }
        setMoId('');
        setWoId('');
        setStartOpen(false);
        load();
    };
    const stopRun = async (runId: string) => {
        const res = await authFetch(`${apiBase}/weaving-runs/${runId}/stop`, { method: 'POST' });
        if (res.ok) load();
    };
    // Park / un-park a run. Pausing keeps the run and its earned efficiency but stops
    // it accruing elapsed working days, so reprioritising the loom onto one WO does
    // not punish the WOs that were set aside.
    const pauseRun = async (runId: string) => {
        const res = await authFetch(`${apiBase}/weaving-runs/${runId}/pause`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: null }),
        });
        if (res.ok) load();
        else showToast((await res.json().catch(() => null))?.detail || t('pause_failed'), 'danger');
    };
    const resumeRun = async (runId: string) => {
        const res = await authFetch(`${apiBase}/weaving-runs/${runId}/resume`, { method: 'POST' });
        if (res.ok) load();
        else showToast((await res.json().catch(() => null))?.detail || t('resume_failed'), 'danger');
    };
    const saveOverride = async (runId: string) => {
        const body: any = { actual_qty_override: overrideVal === '' ? null : parseFloat(overrideVal) };
        const res = await authFetch(`${apiBase}/weaving-runs/${runId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (res.ok) { setOverrideRunId(null); load(); }
    };
    const saveTarget = async (runId: string) => {
        const v = parseFloat(targetVal);
        if (Number.isNaN(v)) return;
        const res = await authFetch(`${apiBase}/weaving-runs/${runId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_efficiency_pct: v }),
        });
        if (res.ok) { setTargetRunId(null); load(); }
    };
    const saveLines = async (runId: string) => {
        const v = parseInt(linesVal, 10);
        if (Number.isNaN(v) || v < 1) return;
        const res = await authFetch(`${apiBase}/weaving-runs/${runId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: v }),
        });
        if (res.ok) { setLinesRunId(null); load(); }
    };
    const saveRate = async (runId: string) => {
        const v = parseFloat(rateVal);
        if (Number.isNaN(v)) return;
        const res = await authFetch(`${apiBase}/weaving-runs/${runId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rate_per_line_g_min: v }),
        });
        if (res.ok) { setRateRunId(null); load(); }
    };
    const toggleWeekday = (d: number) => {
        setWeekdays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b));
    };
    const saveCalendar = async () => {
        const res = await authFetch(`${apiBase}/work-centers/${wcId}/calendar`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ working_weekdays: weekdays }),
        });
        if (res.ok) load();
    };
    const addHolidayDate = async (ds: string, note: string | null) => {
        const res = await authFetch(`${apiBase}/work-centers/${wcId}/holidays`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ holiday_date: ds, note }),
        });
        if (res.ok) load();
    };
    const deleteHoliday = async (hid: string) => {
        const res = await authFetch(`${apiBase}/work-center-holidays/${hid}`, { method: 'DELETE' });
        if (res.ok) load();
    };
    const importNational = async () => {
        const res = await authFetch(`${apiBase}/work-centers/${wcId}/holidays/import-national?year=${calRef.getFullYear()}`, { method: 'POST' });
        if (res.ok) load();
    };

    const moOptions = moCands.map((mo: any) => ({
        value: mo.id,
        label: `${mo.code}${mo.item_code ? ' — ' + mo.item_code : ''}`,
        subLabel: mo.qty ? `${fmt(mo.qty, 2)}` : undefined,
    }));

    // A WO already running here is dropped from the list rather than offered and then
    // rejected by the duplicate guard on submit; the count is reported under the
    // select so the operator can see where their WO went.
    const woRunningHere = woCands.filter((wo: any) => wo.already_running).length;
    const woOptions = woCands
        .filter((wo: any) => !wo.already_running)
        .map((wo: any) => ({
            value: wo.id,
            label: `${wo.code || wo.name}${wo.combo_label ? ' · ' + wo.combo_label : ''}${wo.item_code ? ' — ' + wo.item_code : ''}`,
            subLabel: [
                wo.qty ? `${fmt(wo.qty, 2)} kg` : null,
                wo.target_end_date ? `${t('wo_due')} ${fmtDate(wo.target_end_date)}` : null,
            ].filter(Boolean).join(' · ') || undefined,
        }));

    // Every RUNNING run on this loom, not just the newest.
    const runs: any[] = data?.active_runs || (data?.active_run ? [data.active_run] : []);

    // ── Themed primitives ────────────────────────────────────────────────────
    const SecTitle = SectionTitle;

    // One card shell for the hero tiles and the small stats below them — three
    // separately hand-rolled copies of the same sunken-white box before.
    const CardBox = ({ children, pad = '4px 8px' }: { children: React.ReactNode; pad?: string }) => (
        <div
            style={{ ...xpPanel({ background: '#fff' }), padding: pad }}
        >
            {children}
        </div>
    );

    const Stat = ({ label, value, unit, accent }: any) => <CardBox>
            <div style={{ fontFamily: xpFont, fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }}>{label}</div>
            <div style={{ fontFamily: xpFont, fontSize: 14, fontWeight: 'bold', color: accent || '#000', lineHeight: 1.15 }}>
                {value}{unit && <span style={{ fontSize: 9, fontWeight: 'normal', color: '#888', marginLeft: 2 }}>{unit}</span>}
            </div>
        </CardBox>;

    const grid = (min: number): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 6 });

    // Text/number/date inputs: the shared list-view input in classic, bootstrap in
    // modern. This form was bootstrap-only, so it rendered as rounded modern fields
    // inside XP chrome — the one form in the monitor that ignored the classic theme.
    const inputProps = {
        className: undefined,
        style: lvInput(true),
    };

    // ── Tab bar ──────────────────────────────────────────────────────────────
    const tabs: TabDef[] = [
        { key: 'performance', label: t('performance'), icon: 'bi-graph-up-arrow' },
        { key: 'calendar', label: t('work_calendar'), icon: 'bi-calendar3' },
        // Warp is machine state, so it lives on the machine — not on any WO.
        ...(((workCenter?.center_type || '').toUpperCase() === 'WEAVING'
            || (workCenter?.center_type || '').toUpperCase() === 'TENUN')
            ? [{ key: 'beams', label: t('beams_on_loom'), icon: 'bi-arrow-bar-up' } as TabDef]
            : []),
    ];
    const refreshBtn = (
        <XPActionButton classic tone="neutral" icon="bi-arrow-clockwise" title="Refresh" disabled={loading} onClick={load} />
    );
    const tabBar = (
        <Tabs classic activeKey={tab} onChange={k => setTab(k as any)} tabs={tabs} right={refreshBtn} />
    );
    // Fixed-height body so switching tabs (performance/calendar/beams) never
    // resizes the modal — each pane scrolls internally instead of the panel
    // growing/shrinking to its own content height.
    const TAB_PANEL_HEIGHT = 560;

    // ── Title ────────────────────────────────────────────────────────────────
    const title = (
        <span>
            <i className="bi bi-speedometer2 me-2" />
            {t('performance_monitor')} — {workCenter?.code} {workCenter?.name}
        </span>
    );

    // The three dates the client asked for, side by side: what the WO promised when
    // it was created, where the planned rate lands, and where the rate actually being
    // achieved lands. The warning fires on the third vs the first.
    const CompletionSection = ({ run }: { run: any }) => {
        const proj = run.projection;
        if (!proj) return null;
        const late = !!run.is_late;
        const woBasis = run.baseline_basis === 'WO';
        return (
            <LegendPanel
                title={<><i className="bi bi-flag-fill me-1" />{t('mo_completion')} — {run.wo_code || proj.mo_code}</>}
                right={proj.machines && proj.machines.length > 1 ? (
                    <span style={{ fontFamily: xpFont, fontSize: 9, fontWeight: 'normal', color: '#666' }}>
                        {t('machines_on_mo')}: {proj.machines.map((m: any) => m.work_center_code).join(', ')}
                    </span>
                ) : undefined}
                style={{ marginBottom: 10 }}
            >
              <div style={{ padding: '4px 8px 8px' }}>
                {late && (
                    <div
                        style={{ background: '#ffe6e6', border: `1px solid ${RED}`, color: RED, fontFamily: xpFont, fontSize: 11, fontWeight: 'bold', padding: '4px 8px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                        <i className="bi bi-exclamation-triangle-fill" />
                        <span>
                            {run.reality_unreachable
                                ? <>{t('no_output_yet')}</>
                                : <>{t('late_warning')} <b>{run.days_late} {t('days')}</b></>}
                            {' — '}
                            {woBasis ? t('late_basis_wo') : t('late_basis_plan')} {fmtDate(run.baseline_date)}
                            {'. '}{t('late_action_hint')}
                        </span>
                    </div>
                )}
                <div style={grid(135)}>
                    <Stat label={t('wo_due')} value={fmtDate(run.wo_target_end_date)} accent={BLUE} />
                    <Stat label={t('target_completion')} value={fmtDate(proj.target_completion_date)} accent={GREEN} />
                    <Stat
                        label={t('projected_completion')}
                        value={run.reality_unreachable ? t('not_achievable') : fmtDate(proj.reality_completion_date)}
                        accent={late ? RED : GREEN}
                    />
                    <Stat label={t('target_qty')} value={fmt(proj.target_qty, 2)} unit="kg" />
                    <Stat label={t('total_actual')} value={fmt(proj.total_actual_kg, 2)} unit="kg" />
                    <Stat label={t('combined_target_rate')} value={fmt(proj.total_target_daily_kg, 2)} unit="kg" />
                    <Stat label={t('target_working_days')} value={proj.target_working_days ?? '—'} />
                </div>
              </div>
            </LegendPanel>
        );
    };

    // One active run. A loom carries one of these per WO, so everything inside is
    // keyed by run id — nothing here may read a "the run" singleton any more.
    //
    // Concurrent WOs on one loom are long panels of near-identical stats. A rule
    // between them was not enough separation — the eye read three orders as one long
    // page — so each run is now a BOXED card: its own frame, its own header band
    // carrying "WO 2 of 3", and the whole box is a scroll-snap stop, so scrolling the
    // pane lands on a run boundary instead of halfway through someone else's numbers.
    const RunPanel = ({ run, index = 0, total = 1 }: { run: any; index?: number; total?: number }) => {
        const onTarget = !!run.on_target;
        const effColor = onTarget ? GREEN : RED;
        const editingOverride = overrideRunId === run.id;
        const editingTarget = targetRunId === run.id;
        const editingLines = linesRunId === run.id;
        const editingRate = rateRunId === run.id;
        const multi = total > 1;
        // Header is just "WO n/3" (or "WO" alone for a lone run) — the standard
        // blue FormSection bar, kept minimal. Everything identifying and acting
        // on the run (status, codes, variant, target summary, pause/stop) reads
        // as plain text/chips over the gray/beige body instead, ahead of the
        // Performance subsection.
        const header = <>{t('wo_short')}{multi ? ` ${index + 1}/${total}` : ''}</>;
        const details = (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <StatusChip status={run.status} />
                {run.wo_code && (
                    <span style={{ fontFamily: xpFont, fontWeight: 'bold', color: BLUE }}>{run.wo_code}</span>
                )}
                <span style={{ fontFamily: xpFont, fontWeight: 'bold' }}>{run.mo_code}</span>
                <span><strong>{run.item_code}</strong> <span className="text-muted small">{run.item_name}</span></span>
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
                />
                <span className="text-muted small">
                    {t('target')}: <strong>{fmt(run.target_qty, 2)} kg</strong> · {t('lines')} <strong>{run.lines}</strong> · {t('start_date')} {fmtDate(run.start_date)}
                </span>
                {run.is_late && (
                    <StatusChip status="CANCELLED" label={`${t('behind_schedule')} ${run.days_late}d`} tint />
                )}
                {run.is_paused && (
                    <StatusChip
                        status="PAUSED"
                        label={`${t('paused')}${run.paused_on ? ` · ${fmtDate(run.paused_on)}` : ''}`}
                        title={`${t('paused_days_excluded')}: ${run.paused_working_days ?? 0}`}
                        tint
                    />
                )}
                {canManage && (
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                        {/* Park vs close. Pause keeps the run and its earned efficiency
                            and is the reprioritise action; Stop closes the run for good. */}
                        {run.is_paused ? (
                            <XPActionButton classic tone="primary" icon="bi-play-fill" label={t('resume_run')} onClick={() => resumeRun(run.id)} />
                        ) : (
                            <XPActionButton classic tone="warning" icon="bi-pause-fill" label={t('pause_run')} onClick={() => pauseRun(run.id)} />
                        )}
                        <XPActionButton classic tone="danger" icon="bi-stop-fill" label={t('stop_run')} onClick={() => stopRun(run.id)} />
                    </span>
                )}
            </div>
        );
        return (
            <FormSection
                title={header}
                classic
                style={{
                    marginBottom: 14,
                    // Snap stop per run. `proximity` on the pane, so a run taller than the
                    // viewport still scrolls freely inside itself — `mandatory` would fight
                    // its own content.
                    scrollSnapAlign: 'start', scrollMarginTop: 4,
                }}
                bodyStyle={{ background: '#f4f2ea', padding: 0 }}
            >
                <div style={{ padding: '10px 10px 2px' }}>
                {details}
                {/* Hero: efficiency + actual + rate — same gray/beige LegendPanel
                    subsection chrome as Targets/Completion below. The outer
                    FormSection above is the one blue "section"; these three are
                    subsections nested inside it, so they stay visually lighter
                    rather than repeating that same blue bar three more times. */}
                <LegendPanel title={<><i className="bi bi-speedometer2 me-1" />{t('performance')}</>} style={{ marginBottom: 10 }}>
                <div style={{ padding: '4px 8px 8px', display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 8 }}>
                    {/* Efficiency hero */}
                    <CardBox pad="8px 12px">
                        <div style={{ fontFamily: xpFont, fontSize: 10, color: '#777', textTransform: 'uppercase', letterSpacing: 0.3 }}>{t('efficiency')}</div>
                        <div style={{ fontFamily: xpFont, fontSize: 30, fontWeight: 800, color: effColor, lineHeight: 1.1 }}>
                            {fmt(run.efficiency_pct, 1)}<span style={{ fontSize: 15 }}>%</span>
                        </div>
                        {/* Efficiency vs target tick — same shared ProgressBar call as
                            the loom card on the monitor grid, so the two agree. */}
                        <div style={{ marginTop: 3 }}>
                            <ProgressBar
                                pct={Number(run.efficiency_pct) || 0}
                                tone={onTarget ? 'green' : 'red'}
                                markerPct={Number(run.target_efficiency_pct) || 0}
                                markerTitle={`${t('target')} ${fmt(run.target_efficiency_pct, 0)}%`}
                                height={9}
                            />
                        </div>
                        <div style={{ fontFamily: xpFont, fontSize: 10, color: '#888', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                            {editingTarget ? (
                                <div className="d-flex gap-1 align-items-center">
                                    <input type="number" {...inputProps} style={{ ...(inputProps.style || {}), maxWidth: 70, height: 22, fontSize: 10 }} value={targetVal} onChange={e => setTargetVal(e.target.value)} />
                                    <XPActionButton classic tone="success" icon="bi-check" onClick={() => saveTarget(run.id)} />
                                    <XPActionButton classic tone="neutral" icon="bi-x" onClick={() => setTargetRunId(null)} />
                                </div>
                            ) : (
                                <>
                                    <span>{t('target')} {fmt(run.target_efficiency_pct, 0)}% · <span style={{ color: effColor, fontWeight: 'bold' }}>{onTarget ? t('on_target') : t('below_target')}</span></span>
                                    {canManage && (
                                        <XPActionButton classic tone="neutral" icon="bi-pencil-square" title="Edit target" onClick={() => { setTargetVal(String(run.target_efficiency_pct ?? '')); setTargetRunId(run.id); }} />
                                    )}
                                </>
                            )}
                        </div>
                    </CardBox>

                    {/* Actual produced (with override) */}
                    <CardBox pad="8px 12px">
                        <div style={{ fontFamily: xpFont, fontSize: 10, color: '#777', textTransform: 'uppercase' }}>
                            {t('actual_produced')}
                            {run.actual_qty_override !== null && (
                                <span style={{ marginLeft: 4 }}><StatusChip status="PARTIAL" label={t('manual')} tint /></span>
                            )}
                        </div>
                        {editingOverride ? (
                            <div className="d-flex gap-1 mt-1">
                                <input type="number" {...inputProps} style={{ ...(inputProps.style || {}), maxWidth: 100 }} value={overrideVal} placeholder={String(run.actual_kg)} onChange={e => setOverrideVal(e.target.value)} />
                                <XPActionButton classic tone="success" icon="bi-check" onClick={() => saveOverride(run.id)} />
                                <XPActionButton classic tone="neutral" icon="bi-x" onClick={() => setOverrideRunId(null)} />
                            </div>
                        ) : (
                            <div style={{ fontFamily: xpFont, fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span>{fmt(run.actual_kg, 2)}<span style={{ fontSize: 11, color: '#888' }}> kg</span></span>
                                <XPActionButton classic tone="neutral" icon="bi-pencil-square" title="Override" onClick={() => { setOverrideVal(run.actual_qty_override ?? ''); setOverrideRunId(run.id); }} />
                            </div>
                        )}
                    </CardBox>

                    {/* Actual rate */}
                    <CardBox pad="8px 12px">
                        <div style={{ fontFamily: xpFont, fontSize: 10, color: '#777', textTransform: 'uppercase' }}>{t('actual_rate')}</div>
                        <div style={{ fontFamily: xpFont, fontSize: 22, fontWeight: 700 }}>
                            {fmt(run.actual_daily_rate_kg, 2)}<span style={{ fontSize: 11, color: '#888' }}> kg/day</span>
                        </div>
                    </CardBox>
                </div>
                </LegendPanel>

                {/* Targets */}
                <LegendPanel title={<><i className="bi bi-sliders me-1" />{t('targets') || 'Targets'}</>} style={{ marginBottom: 10 }}>
                    <div style={{ padding: '4px 8px 8px', ...grid(118) }}>
                        <Stat label={t('lines')} value={editingLines ? (
                            <div className="d-flex gap-1 align-items-center">
                                <input type="number" min="1" {...inputProps} style={{ ...(inputProps.style || {}), maxWidth: 55, height: 22, fontSize: 12 }} value={linesVal} onChange={e => setLinesVal(e.target.value)} />
                                <XPActionButton classic tone="success" icon="bi-check" onClick={() => saveLines(run.id)} />
                                <XPActionButton classic tone="neutral" icon="bi-x" onClick={() => setLinesRunId(null)} />
                            </div>
                        ) : (
                            <span className="d-flex align-items-center gap-1">
                                {run.lines}
                                {canManage && <XPActionButton classic tone="neutral" icon="bi-pencil-square" title="Edit lines" onClick={() => { setLinesVal(String(run.lines ?? '')); setLinesRunId(run.id); }} />}
                            </span>
                        )} />
                        <Stat label={t('rate_per_line')} value={editingRate ? (
                            <div className="d-flex gap-1 align-items-center">
                                <input type="number" {...inputProps} style={{ ...(inputProps.style || {}), maxWidth: 65, height: 22, fontSize: 12 }} value={rateVal} onChange={e => setRateVal(e.target.value)} />
                                <XPActionButton classic tone="success" icon="bi-check" onClick={() => saveRate(run.id)} />
                                <XPActionButton classic tone="neutral" icon="bi-x" onClick={() => setRateRunId(null)} />
                            </div>
                        ) : (
                            <span className="d-flex align-items-center gap-1">
                                {fmt(run.rate_per_line_g_min, 2)}<span style={{ fontSize: 9, fontWeight: 'normal', color: '#888' }}>g/min</span>
                                {canManage && <XPActionButton classic tone="neutral" icon="bi-pencil-square" title="Edit rate" onClick={() => { setRateVal(String(run.rate_per_line_g_min ?? '')); setRateRunId(run.id); }} />}
                            </span>
                        )} />
                        <Stat label={t('target_100_day')} value={fmt(run.target_100_per_day_kg, 2)} unit="kg" />
                        <Stat label={`${t('target')} ${fmt(run.target_efficiency_pct, 0)}%/day`} value={fmt(run.target_eff_per_day_kg, 2)} unit="kg" accent={BLUE} />
                        <Stat label={t('elapsed_days')} value={run.elapsed_working_days} />
                        {/* Only worth the tile once days have actually been given back —
                            it is the answer to "why is elapsed lower than the calendar". */}
                        {(run.paused_working_days ?? 0) > 0 && (
                            <Stat label={t('paused_days_excluded')} value={run.paused_working_days} accent={AMBER} />
                        )}
                        <Stat label={t('theoretical_100')} value={fmt(run.theoretical_100_kg, 2)} unit="kg" />
                    </div>
                </LegendPanel>

                <CompletionSection run={run} />
                </div>
            </FormSection>
        );
    };

    return (
        <>
        <ModalWrapper isOpen={isOpen} onClose={onClose} title={title} size="xl" variant={titleVariant} modeless bodyScroll={false} banner={tabBar}>

            {/* `proximity`, not `mandatory`: only the run boxes declare a snap point, so
                every other pane scrolls normally and a run longer than the pane is not
                yanked back to its own top edge. */}
            <div style={{ height: `min(${TAB_PANEL_HEIGHT}px, calc(var(--app-vh) - 220px))`, overflowY: 'auto', scrollSnapType: 'y proximity' }}>

            {tab === 'performance' && (
                <div>
                    {/* First load of this machine: field-shaped placeholders rather than
                        a marquee — what arrives is a block of run/prep fields, so the
                        panel keeps its height and the content fades into it. */}
                    {loading && !data && <PanelSkeleton sections={2} rows={4} classic />}

                    {/* No run: read-only viewers get the shared empty state; managers go
                        straight to the start-run form — no extra click to get there. */}
                    {!loading && !runs.length && !canManage && (
                        <XPEmptyState icon="bi-stoplights" message={t('no_active_run')} />
                    )}

                    {/* Prep walk. Shown only once warp is actually up on the loom
                        (STAGED and later) — a machine with no beams tracked keeps the
                        plain start form it always had. */}
                    {!loading && !runs.length && loomStatus !== 'IDLE' && (
                        <FormSection title={<SecTitle icon="bi-tools">{t('loom_prep')}</SecTitle>} classic>
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                                <StatusChip status={loomStatus} label={stepLabel(loomStatus)} tint />
                                <span style={{ fontSize: 11, color: '#666' }}>
                                    {loom?.mounted_pcs ?? 0} / {loom?.beam_slots ?? 1} {t('pcs')}
                                    {loom?.prep_status_by ? ` · ${loom.prep_status_by}` : ''}
                                    {loom?.prep_status_at ? ` · ${fmtDate(loom.prep_status_at)}` : ''}
                                </span>
                                {canManage && nextLoomStep && (
                                    <XPActionButton
                                        classic
                                        tone={nextLoomStep === 'TUNING' ? 'warning' : 'primary'}
                                        icon={nextLoomStep === 'TUNING' ? 'bi-sliders' : 'bi-arrows-collapse-vertical'}
                                        label={stepLabel(nextLoomStep)}
                                        disabled={prepBusy}
                                        onClick={() => setPrep(nextLoomStep)}
                                    />
                                )}
                                {canManage && loomStatus !== 'STAGED' && (
                                    <XPActionButton
                                        classic
                                        tone="neutral"
                                        icon="bi-arrow-counterclockwise"
                                        label={t('prep_reset')}
                                        disabled={prepBusy}
                                        onClick={() => setPrep(null)}
                                    />
                                )}
                            </div>
                            <div style={{ fontSize: 10, color: '#777', marginTop: 4 }}>{t('loom_prep_hint')}</div>
                        </FormSection>
                    )}

                    {/* Start a run. A loom runs one WO per combo at the same time, so
                        this form stays reachable while runs are active — collapsed
                        behind a button then, so the running WOs read first. */}
                    {!loading && canManage && runs.length > 0 && !startOpen && (
                        <div style={{ marginBottom: 10 }}>
                            <XPActionButton
                                classic
                                tone="success"
                                icon="bi-plus-lg"
                                label={t('start_another_run')}
                                onClick={() => setStartOpen(true)}
                            />
                        </div>
                    )}

                    {!loading && canManage && (runs.length === 0 || startOpen) && (
                        <FormSection
                            title={<SecTitle icon="bi-play-circle">{runs.length ? t('start_another_run') : t('start_run')}</SecTitle>}
                            classic
                        >
                            {/* Top-align, not bottom: the order column carries a helper
                                line under its select, and align-items-end pushed every
                                other input down by that line's height instead of keeping
                                the label/input baselines in a row. */}
                            <div className="row g-2 align-items-start">
                                <div className="col-md-5">
                                    {moMode ? (
                                        <>
                                            <FieldLabel classic>{t('manufacturing_order')}</FieldLabel>
                                            <SearchableSelect
                                                options={moOptions}
                                                value={moId}
                                                onChange={setMoId}
                                                placeholder={moCandsLoading ? 'Loading...' : (moOptions.length ? 'Select MO...' : 'No MO on this machine')}
                                            />
                                            <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                                                {moCandsAll
                                                    ? 'Showing all open MOs.'
                                                    : `On this machine${moCandsLoading ? '' : `: ${moOptions.length}`}`}
                                                {!moCandsAll && (
                                                    <button
                                                        type="button"
                                                        className="btn btn-link p-0 ms-1"
                                                        style={{ fontSize: 10, verticalAlign: 'baseline' }}
                                                        onClick={() => { setMoId(''); setMoCandsAll(true); }}
                                                    >
                                                        show all
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    className="btn btn-link p-0 ms-1"
                                                    style={{ fontSize: 10, verticalAlign: 'baseline' }}
                                                    onClick={() => { setMoId(''); setMoMode(false); }}
                                                >
                                                    {t('pick_wo_instead')}
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            {/* WO, not MO: two combos of one item are two WOs
                                                on this loom, each with its own line count and
                                                its own promised end date. */}
                                            <FieldLabel classic>{t('work_order')}</FieldLabel>
                                            <SearchableSelect
                                                options={woOptions}
                                                value={woId}
                                                onChange={setWoId}
                                                placeholder={woCandsLoading ? 'Loading...' : (woOptions.length ? 'Select WO...' : t('no_wo_on_machine'))}
                                            />
                                            <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                                                {woCandsLoading ? '' : `${woOptions.length} ${t('available')}`}
                                                {woRunningHere > 0 ? ` · ${woRunningHere} ${t('already_running')}` : ''}
                                                <button
                                                    type="button"
                                                    className="btn btn-link p-0 ms-1"
                                                    style={{ fontSize: 10, verticalAlign: 'baseline' }}
                                                    onClick={() => { setWoId(''); setMoMode(true); }}
                                                >
                                                    {t('pick_mo_instead')}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                                <div className="col-md-2 col-4">
                                    <FieldLabel classic>{t('lines')}</FieldLabel>
                                    <input type="number" min="1" {...inputProps} value={lines} onChange={e => setLines(e.target.value)} />
                                </div>
                                <div className="col-md-2 col-4">
                                    <FieldLabel classic>{t('rate_per_line')}</FieldLabel>
                                    <input type="number" {...inputProps} value={rate} onChange={e => setRate(e.target.value)} />
                                </div>
                                <div className="col-md-3 col-4">
                                    <FieldLabel classic>{t('target_efficiency')}</FieldLabel>
                                    <input type="number" {...inputProps} value={eff} onChange={e => setEff(e.target.value)} />
                                </div>
                                <div className="col-md-4 col-6">
                                    <FieldLabel classic>{t('start_date')}</FieldLabel>
                                    <input type="date" {...inputProps} value={startDate} onChange={e => setStartDate(e.target.value)} />
                                </div>
                                <div className="col-md-8">
                                    {/* Empty label so the button lines up with the date
                                        input beside it, not with that input's label. */}
                                    <FieldLabel classic>&nbsp;</FieldLabel>
                                    <XPActionButton
                                        classic
                                        tone="success"
                                        icon="bi-play-fill"
                                        label={t('start')}
                                        title={prepBlocksStart ? t('prep_blocked_start') : undefined}
                                        onClick={startRun}
                                        disabled={(moMode ? !moId : !woId) || prepBlocksStart}
                                    />
                                    {startOpen && (
                                        <span style={{ marginLeft: 6 }}>
                                            <XPActionButton classic tone="neutral" icon="bi-x" label={t('cancel')} onClick={() => setStartOpen(false)} />
                                        </span>
                                    )}
                                    {prepBlocksStart && (
                                        <span style={{ fontSize: 10, color: '#b5530a', marginLeft: 6 }}>
                                            {t('prep_blocked_start')}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </FormSection>
                    )}

                    {/* One panel per RUNNING run — a loom carries one per WO, ruled off
                        from the next so two concurrent orders never read as one. */}
                    {runs.map((r: any, i: number) => <RunPanel key={r.id} run={r} index={i} total={runs.length} />)}

                    {/* History */}
                    {data?.history?.length > 0 && (
                        <FormSection title={<SecTitle icon="bi-clock-history">{t('run_history')}</SecTitle>} classic>
                            {/* Shared list-view table styling (lvTh/lvTd/lvRow) — same chrome as
                                the beams table below and the group calendar's holiday table. */}
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: '#d4d0c8' }}>
                                            <th style={lvTh(true)}>{t('manufacturing_order')}</th>
                                            <th style={lvTh(true)}>{t('item')}</th>
                                            <th style={lvTh(true)}>{t('start')}</th>
                                            <th style={lvTh(true)}>{t('end')}</th>
                                            <th style={{ ...lvTh(true), textAlign: 'right' }}>{t('actual')}</th>
                                            <th style={{ ...lvTh(true), textAlign: 'right' }}>{t('efficiency')}</th>
                                            <th style={{ ...lvTh(true), borderRight: 'none' }}>{t('status')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.history.map((h: any, idx: number) => (
                                            <tr key={h.id} style={lvRow(true, idx)}>
                                                <td style={lvTd(true)}><CodeChip code={h.mo_code} classic /></td>
                                                <td style={lvTd(true)}>
                                                    <div className="d-flex align-items-center gap-2">
                                                        <span>{h.item_code}</span>
                                                        <VariantChips
                                                            combo={h.combo_label}
                                                            size={h.size_label}
                                                            colorVariant={h.color_label}
                                                            colorCode={h.color_code}
                                                            colorName={h.color_name}
                                                            colorHex={h.color_hex}
                                                            labdipCode={h.labdip_variant_code}
                                                            classic
                                                        />
                                                    </div>
                                                </td>
                                                <td style={lvTd(true)}>{fmtDate(h.start_date)}</td>
                                                <td style={lvTd(true)}>{fmtDate(h.end_date)}</td>
                                                <td style={{ ...lvTd(true), textAlign: 'right' }}>{fmt(h.actual_kg, 2)} kg</td>
                                                <td style={{ ...lvTd(true), textAlign: 'right', color: h.on_target ? GREEN : RED, fontWeight: 600 }}>{fmt(h.efficiency_pct, 1)}%</td>
                                                {/* StatusChip in both themes — the modern branch used a
                                                    bootstrap badge, so a DONE run read gray here and green
                                                    everywhere else. */}
                                                <td style={{ ...lvTd(true), borderRight: 'none' }}><StatusChip status={h.status} tint /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </FormSection>
                    )}
                </div>
            )}

            {/* Calendar: the shared production-calendar editor. Identical surface to the
                group batch-apply modal — only persistence differs (each click here is a
                server call; the group form batches into one cascade PUT). */}
            {tab === 'calendar' && (
                <div>
                    <WorkingDaysSection
                        classic
                        weekdays={weekdays}
                        onToggleWeekday={toggleWeekday}
                        canEdit={canManage}
                        onSave={saveCalendar}
                    />
                    <HolidayCalendarSection
                        classic
                        month={calRef}
                        onMonthChange={setCalRef}
                        weekdays={weekdays}
                        holidays={holidays}
                        national={national}
                        canEdit={canManage}
                        onToggleDay={(ds, existing, nat) => {
                            if (existing?.id) deleteHoliday(existing.id);
                            else addHolidayDate(ds, nat || null);
                        }}
                        headerAction={canManage ? (
                            <XPActionButton classic tone="neutral" icon="bi-download"
                                label={`${t('import_id_holidays')} ${calRef.getFullYear()}`} onClick={importNational} />
                        ) : undefined}
                    />
                </div>
            )}

            {tab === 'beams' && (() => {
                const mounts: any[] = loom?.mounts || [];
                const slots = loom?.beam_slots ?? 1;
                const pcs = loom?.mounted_pcs ?? 0;
                return (
                    <div style={{ fontFamily: xpFont, fontSize: 11 }}>
                        <div
                            style={{ fontSize: 10, color: '#555', marginBottom: 8 }}>
                            {t('beam_loom_hint')}
                        </div>

                        <div style={{
                            display: 'flex', alignItems: 'baseline', gap: 8,
                            marginBottom: 8,
                        }}>
                            <span style={{
                                fontSize: 18, fontWeight: 'bold',
                                color: pcs >= slots ? GREEN : pcs > 0 ? AMBER : '#888', lineHeight: 1,
                            }}>{pcs} / {slots}</span>
                            <span style={{ fontSize: 11, color: '#777' }}>
                                {t('beam_positions_filled')} · {fmt(loom?.total_remaining, 1)} kg
                            </span>
                            {canMount && (
                                <span style={{ marginLeft: 'auto', alignSelf: 'center' }}>
                                    <XPActionButton
                                        classic
                                        tone={mountOpen ? 'neutral' : 'primary'}
                                        icon="bi-arrow-bar-up"
                                        label={mountOpen ? t('cancel') : t('mount_beam')}
                                        title={t('mount_beam_hint')}
                                        onClick={() => setMountOpen(o => !o)}
                                    />
                                </span>
                            )}
                        </div>

                        {/* Mount picker — beams free plant-wide, leftovers included. Sits
                            above the mounted table because it reads top-down as one list:
                            what can go up, then what is up. */}
                        {mountOpen && canMount && (
                            <div style={{ marginBottom: 8 }}>
                                <ExpandedRowPanel classic>
                                    <ExpandedRowPanelBody classic>
                                        <div
                                            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleBeamScan(beamSearch); } }}
                                        >
                                            <SearchField
                                                classic
                                                value={beamSearch}
                                                onChange={setBeamSearch}
                                                placeholder={t('mount_beam_search')}
                                                icon="bi-upc-scan"
                                                width={220}
                                            />
                                            <XPActionButton
                                                classic
                                                tone={beamCameraOn ? 'neutral' : 'primary'}
                                                icon="bi-camera-video"
                                                label={beamCameraOn ? t('scan_beam_stop') : t('scan_beam')}
                                                title={t('scan_beam_hint')}
                                                onClick={() => setBeamCameraOn(v => !v)}
                                            />
                                            {pcs >= slots && (
                                                <span style={{ fontSize: 10, color: AMBER }}>{t('beam_slots_full')}</span>
                                            )}
                                        </div>
                                        {/* An exact lot-number hit mounts straight away, same as Enter in
                                            the box — so the floor points the phone at a beam label and the
                                            warp goes up. ui-scale-exempt: html5-qrcode measures its own
                                            viewfinder, so keep it 1:1 with the device pixels. */}
                                        {beamCameraOn && (
                                            <div className="ui-scale-exempt" style={{ width: '100%', maxWidth: 320, margin: '0 auto 8px' }}>
                                                <CameraScanner id="beam-mount-reader" onDecode={handleBeamCameraScan} />
                                            </div>
                                        )}
                                        {freeLoading ? (
                                            <PanelSkeleton classic rows={3} />
                                        ) : freeBeams.length === 0 ? (
                                            <XPEmptyState icon="bi-inboxes" message={t('no_free_beams')} />
                                        ) : (
                                            <div style={{ maxHeight: 190, overflowY: 'auto' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                    <tbody>
                                                        {freeBeams.map((b: any, idx: number) => (
                                                            <tr key={b.batch_id} style={lvRow(true, idx)}>
                                                                <td style={{ ...lvTd(true), fontWeight: 'bold', color: BLUE, whiteSpace: 'nowrap' }}>
                                                                    {b.beam_number}
                                                                    {b.is_leftover && (
                                                                        <Chip
                                                                            classic
                                                                            size="xs"
                                                                            tone={statusTint('PENDING')}
                                                                            title={b.parent_beam_number ? `${t('leftover_tag')} · ${b.parent_beam_number}` : t('leftover_tag')}
                                                                            style={{ marginLeft: 5 }}
                                                                        >{t('leftover_tag')}</Chip>
                                                                    )}
                                                                </td>
                                                                <td style={lvTd(true)} title={b.item_name || undefined}>{b.item_code || '—'}</td>
                                                                <td style={lvTd(true)}>{b.ends ?? '—'}</td>
                                                                <td style={{ ...lvTd(true), textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(b.remaining, 1)} kg</td>
                                                                <td style={{ ...lvTd(true), color: '#666' }}>{b.location_code || '—'}</td>
                                                                <td style={{ ...lvTd(true), borderRight: 'none', textAlign: 'right' }}>
                                                                    <XPActionButton
                                                                        classic
                                                                        tone="primary"
                                                                        icon="bi-arrow-bar-up"
                                                                        label={mountingId === b.batch_id ? '...' : t('mount_confirm')}
                                                                        disabled={mountingId === b.batch_id}
                                                                        onClick={() => mount(b.batch_id)}
                                                                    />
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </ExpandedRowPanelBody>
                                </ExpandedRowPanel>
                            </div>
                        )}

                        {mounts.length === 0 ? (
                            <XPEmptyState icon="bi-arrow-bar-up" message={t('no_beams_mounted')} />
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: '#d4d0c8' }}>
                                            <th style={lvTh(true)}>{t('lot')}</th>
                                            <th style={lvTh(true)}>{t('item')}</th>
                                            <th style={lvTh(true)}>{t('ends')}</th>
                                            <th style={{ ...lvTh(true), textAlign: 'right' }}>{t('remaining')}</th>
                                            <th style={lvTh(true)}>{t('mounted')}</th>
                                            <th style={{ ...lvTh(true), borderRight: 'none' }} />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {mounts.map((m, idx) => (
                                            <React.Fragment key={m.id}>
                                            <tr style={lvRow(true, idx)}>
                                                <td style={{ ...lvTd(true), fontWeight: 'bold', color: BLUE }}>{m.beam_number || '—'}</td>
                                                {/* The article gets its own column: a beam usually carries no
                                                    size, combo or shade at all, so its item code is the only
                                                    thing that says which warp is up. The identity chips ride
                                                    beside it for the beams whose producing MO did carry them
                                                    — same shape as the run-history Item column above. */}
                                                <td style={lvTd(true)}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
                                                        <span title={m.item_name || undefined}>{m.item_code || '—'}</span>
                                                        <LotChips batch={m} />
                                                    </div>
                                                </td>
                                                <td style={lvTd(true)}>{m.ends ?? '—'}</td>
                                                <td style={{ ...lvTd(true), textAlign: 'right' }}>{fmt(m.remaining, 1)} kg</td>
                                                <td style={{ ...lvTd(true), color: '#666' }}>
                                                    {fmtDate(m.mounted_at)}
                                                    {m.mounted_by ? ` · ${m.mounted_by}` : ''}
                                                </td>
                                                <td style={{ ...lvTd(true), borderRight: 'none', textAlign: 'right' }}>
                                                    {canManage && unmountingId !== m.id && (
                                                        <XPActionButton
                                                            classic
                                                            tone="warning"
                                                            icon="bi-box-arrow-up"
                                                            label={t('dismount')}
                                                            title={t('dismount_hint')}
                                                            disabled={dismounting === m.id}
                                                            onClick={() => {
                                                                setUnmountingId(m.id);
                                                                // Pre-pick the beam item's home store so the floor
                                                                // usually just confirms instead of hunting for a bin.
                                                                setReturnLoc(m.default_return_location_id || '');
                                                                // Seed the weigh field with what the system thinks is
                                                                // left: on a beam that ran to plan the scale agrees and
                                                                // the operator only confirms. Ends carry over — a
                                                                // remnant is the same warp, just shorter.
                                                                setLeftoverQty(m.remaining != null ? String(Number(m.remaining).toFixed(2)) : '');
                                                                setLeftoverEnds(m.ends != null ? String(m.ends) : '');
                                                                setLeftoverLotNo('');
                                                            }}
                                                        />
                                                    )}
                                                </td>
                                            </tr>
                                            {unmountingId === m.id && (
                                                <tr>
                                                    <td colSpan={6} style={{ padding: '4px 2px'}}>
                                                        <ExpandedRowPanel classic>
                                                            <ExpandedRowPanelBody classic>
                                                                {(() => {
                                                                    const sysLeft = Number(m.remaining || 0);
                                                                    const weighed = parseFloat(leftoverQty);
                                                                    const variance = !Number.isNaN(weighed) ? weighed - sysLeft : 0;
                                                                    return (
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11}}>
                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                                                                        <span>
                                                                            <b style={{ color: BLUE }}>{m.beam_number || '—'}</b>
                                                                            {' · '}
                                                                            <b>{fmt(m.remaining, 1)} kg</b> {t('unmount_remnant_to')}:
                                                                        </span>
                                                                        <select
                                                                            value={returnLoc}
                                                                            onChange={e => setReturnLoc(e.target.value)}
                                                                            className={undefined}
                                                                            style={xpSelect()}
                                                                        >
                                                                            <option value="">{t('unmount_leave_at_loom')}</option>
                                                                            {leafLocations.map((l: any) => (
                                                                                <option key={l.id} value={l.id}>{locLabel(l)}</option>
                                                                            ))}
                                                                        </select>
                                                                        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                                                                            <XPActionButton
                                                                                classic
                                                                                tone="warning"
                                                                                icon="bi-box-arrow-up"
                                                                                label={dismounting === m.id ? '...' : t('unmount_confirm')}
                                                                                disabled={dismounting === m.id}
                                                                                onClick={() => dismount(m, returnLoc)}
                                                                            />
                                                                            <XPActionButton
                                                                                classic
                                                                                tone="neutral"
                                                                                label={t('cancel')}
                                                                                disabled={dismounting === m.id}
                                                                                onClick={closeUnmount}
                                                                            />
                                                                        </div>
                                                                    </div>

                                                                    {/* Every dismount strips and weighs the remnant — re-lot
                                                                        rides on the unmount, not a second action, because
                                                                        splitting it later would mean guessing which of the
                                                                        loom's beams it came from. */}
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                                                        <div style={{ fontSize: 10, color: '#555' }}>{t('leftover_hint')}</div>
                                                                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                                                                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                                <span>{t('leftover_weighed_qty')}</span>
                                                                                <input
                                                                                    type="number" min="0" step="any"
                                                                                    value={leftoverQty}
                                                                                    onChange={e => setLeftoverQty(e.target.value)}
                                                                                    className={undefined}
                                                                                    style={{ ...lvInput, width: 90, textAlign: 'right' }}
                                                                                />
                                                                            </label>
                                                                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                                <span>{t('ends')}</span>
                                                                                <input
                                                                                    type="number" min="1" step="1"
                                                                                    value={leftoverEnds}
                                                                                    onChange={e => setLeftoverEnds(e.target.value)}
                                                                                    className={undefined}
                                                                                    style={{ ...lvInput, width: 70, textAlign: 'right' }}
                                                                                />
                                                                            </label>
                                                                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                                <span>{t('leftover_lot_no')}</span>
                                                                                <input
                                                                                    type="text"
                                                                                    value={leftoverLotNo}
                                                                                    onChange={e => setLeftoverLotNo(e.target.value)}
                                                                                    placeholder={t('leftover_lot_auto')}
                                                                                    className={undefined}
                                                                                    style={{ ...lvInput, width: 150 }}
                                                                                />
                                                                            </label>
                                                                        </div>
                                                                        <div style={{ fontSize: 10, color: '#666' }}>
                                                                            {t('leftover_system_says')} <b>{fmt(sysLeft, 2)} kg</b>
                                                                            {!Number.isNaN(weighed) && (
                                                                                <>
                                                                                    {' · '}{t('leftover_variance')}{' '}
                                                                                    <b style={{ color: Math.abs(variance) < 0.005 ? '#666' : variance < 0 ? RED : AMBER }}>
                                                                                        {variance > 0 ? '+' : ''}{fmt(variance, 2)} kg
                                                                                    </b>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                    );
                                                                })()}
                                                            </ExpandedRowPanelBody>
                                                        </ExpandedRowPanel>
                                                    </td>
                                                </tr>
                                            )}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                );
            })()}

            </div>
        </ModalWrapper>
        {printLot && (
            <LotLabelPrintModal
                lots={[printLot]}
                onClose={() => setPrintLot(null)}
            />
        )}
        </>
    );
}
