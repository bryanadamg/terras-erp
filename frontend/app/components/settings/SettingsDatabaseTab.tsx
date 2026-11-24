'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../shared/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { useData } from '../../context/DataContext';
import { useTimezone, AVAILABLE_TIMEZONES } from '../../context/TimezoneContext';
import { xpBtn, StatusChip, CODE_FONT, xpFont, CHIP_RADIUS, XP_BTN, XPActionButton, ProgressBar } from '../shared/xpTheme';
import { field as xpInput, BTN_TONES } from '@bryanadamg/terras-ui/styles';
import { FieldLabel } from '@bryanadamg/terras-ui/components/Field';
import {
    settingsActions, settingsHint, SETTINGS_FIELD_GAP,
} from './settingsStyles';
import { MasterDetail, ListRow, DetailSection, Flag, StatusDot, relativeTime } from './settingsParts';
import { useRememberedTab } from '../../hooks/useRememberedTab';
import ModalWrapper from '../shared/ModalWrapper';
import { API_BASE } from '../shared/apiBase';

const xpDangerBtn: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11, padding: '3px 20px',
    cursor: 'pointer', borderRadius: 3, border: '1px solid',
    background: 'linear-gradient(to bottom, #e08080, #c03030)',
    borderColor: '#e04040 #801010 #801010 #e04040',
    color: '#fff', fontWeight: 'bold',
};

const xpCancelBtn: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11, padding: '3px 16px',
    cursor: 'pointer', borderRadius: 3, border: '1px solid',
    borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    background: 'linear-gradient(to bottom, #fff, #d4d0c8)', color: '#000',
};


function prettyBytes(bytes: number | null): string {
    if (bytes == null) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let val = bytes, i = 0;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// Python/APScheduler weekday convention: 0=Monday .. 6=Sunday.
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const pad2 = (n: number) => String(n).padStart(2, '0');

type PingState = { ok: boolean; latency_ms: number | null } | null;

/** One timeline row: when · origin · file · size · actions. */
const snapRow: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: '170px 96px minmax(0, 1fr) 70px auto', alignItems: 'center', gap: 10,
    padding: '6px 8px', borderBottom: '1px solid #f0eee6',
};

type DbSection = 'overview' | 'backups' | 'events' | 'connection' | 'danger';
const DB_SECTIONS: DbSection[] = ['overview', 'backups', 'events', 'connection', 'danger'];

/** Overview card that jumps to its section. */
function SummaryCard({ icon, title, headline, sub, onClick }: {
    icon: string; title: string; headline: React.ReactNode; sub: React.ReactNode; onClick: () => void;
}) {
    return (
        <button type="button" onClick={onClick} className="settings-list-row" style={{
            textAlign: 'left', border: '1px solid #c8c4b6', background: '#faf9f4', padding: '10px 12px', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', gap: 5, fontFamily: xpFont, fontSize: 11, color: '#333',
        }}>
            <span style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 6 }}>
                <i className={`bi ${icon}`} />{title}
                <i className="bi bi-chevron-right" style={{ marginLeft: 'auto', fontSize: 10, color: '#888' }} />
            </span>
            <span style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>{headline}</span>
            <span style={{ fontSize: 10, color: '#666' }}>{sub}</span>
        </button>
    );
}

const fmtMs = (ms: number | null | undefined) => (ms == null ? '—' : `${ms} ms`);

function fmtUptime(seconds: number | null | undefined): string {
    if (seconds == null) return '—';
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m`;
    return `${Math.round(seconds)}s`;
}

/** One number from the live-event bus. Counters, not up/down states, so no status
 *  dot — `warn` tints the ones where any value above zero is worth a look, and a
 *  plain zero greys out so a quiet system reads as quiet instead of twelve "0"s. */
function EventStat({ label, value, warn }: { label: string; value: number | string | null | undefined; warn?: boolean;
}) {
    const idle = value === 0 || value == null || value === '—';
    return (
        <div style={{
            background: warn ? '#fff8e1' : '#fff', border: `1px solid ${warn ? '#e0c080' : '#d6d3c6'}`, padding: '6px 8px',
        }}>
            <div style={{
                fontFamily: xpFont, fontSize: 14,
                fontWeight: idle ? 400 : 700, color: warn ? '#8a5300' : idle ? '#aaa' : '#333',
            }}>
                {value ?? '—'}
            </div>
            <div style={{ fontFamily: xpFont, fontSize: 10, color: '#888' }}>
                {label}
            </div>
        </div>
    );
}

function StatusTile({ label, icon, ok, detail }: { label: string; icon: string; ok: boolean | null; detail: string }) {
    const color = ok === null ? '#888' : ok ? '#2e7d32' : '#c62828';
    const dotBg = ok === null ? '#aaa' : ok ? '#4caf50' : '#e53935';
    return (
        <div style={{
            background: '#fff', border: '1px solid #b0a898',
            padding: '6px 8px', display: 'flex', flexDirection: 'column' as const, gap: 2,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: xpFont, fontSize: 11, fontWeight: 'bold', color: '#333'}}>
                <i className={`bi ${icon}`} />
                <span>{label}</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotBg, marginLeft: 'auto', flexShrink: 0 }} />
            </div>
            <div style={{ fontFamily: xpFont, fontSize: 11, color, fontWeight: 600 }}>
                {ok === null ? 'Checking…' : ok ? 'Online' : 'Offline'}
            </div>
            <div style={{ fontFamily: xpFont, fontSize: 10, color: '#888' }}>{detail}</div>
        </div>
    );
}

export default function SettingsDatabaseTab() {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const { formatDateTime: tzDateTime } = useTimezone();
    const { wsStatus, authFetch } = useData();
    const [section, setSection] = useRememberedTab<DbSection>('settings.database', 'overview', DB_SECTIONS);

    const [currentDbUrl, setCurrentDbUrl] = useState('');
    const [newDbUrl, setNewDbUrl] = useState('');
    const [dbProfiles, setDbProfiles] = useState<any[]>([]);
    const [isDbLoading, setIsDbLoading] = useState(false);
    const [snapshots, setSnapshots] = useState<any[]>([]);
    const [isSnapshotLoading, setIsSnapshotLoading] = useState(false);
    // The running restore, polled from the server. Held as one object so the modal
    // renders phase, percent and outcome off a single source rather than four booleans.
    const [restore, setRestore] = useState<any | null>(null);
    const [restoreElapsed, setRestoreElapsed] = useState(0);
    const restoringRef = useRef(false);

    const [schedule, setSchedule] = useState<any>(null);
    const [isScheduleLoading, setIsScheduleLoading] = useState(false);
    const [isSavingSchedule, setIsSavingSchedule] = useState(false);
    const [isRunningNow, setIsRunningNow] = useState(false);
    const [scheduleForm, setScheduleForm] = useState({
        enabled: false, frequency: 'daily', day_of_week: 0, hour: 3, minute: 0,
        timezone: 'Asia/Jakarta', retain_count: 14,
    });

    const [showWipeModal, setShowWipeModal] = useState(false);
    const [wipePassword, setWipePassword] = useState('');
    const [isWiping, setIsWiping] = useState(false);

    const [beOnline, setBeOnline] = useState<boolean | null>(null);
    const [dbPing, setDbPing] = useState<PingState>(null);
    const [redisPing, setRedisPing] = useState<PingState>(null);
    const [dbSizeBytes, setDbSizeBytes] = useState<number | null>(null);
    const [statusCheckedAt, setStatusCheckedAt] = useState<Date | null>(null);
    const [isStatusLoading, setIsStatusLoading] = useState(false);
    const [eventStats, setEventStats] = useState<any | null>(null);

    const fetchSystemStatus = useCallback(async () => {
        // The schema is dropped for part of a restore, so this poll can only report
        // false outages and add connections the restore then has to fight for locks with.
        if (restoringRef.current) return;
        setIsStatusLoading(true);
        try {
            const auth = { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` };
            const res = await authFetch(`${API_BASE}/admin/database/status`, { headers: auth });
            setBeOnline(res.ok);
            if (res.ok) {
                const data = await res.json();
                setDbPing(data.db);
                setRedisPing(data.redis);
                setDbSizeBytes(data.db_size_bytes);
            }
            // Live-event bus counters. Folded into the same refresh (and the same
            // 30s interval) so the panel below never disagrees with the tiles above.
            try {
                const ev = await authFetch(`${API_BASE}/health/events`, { headers: auth });
                setEventStats(ev.ok ? await ev.json() : null);
            } catch { setEventStats(null); }
        } catch (e) {
            setBeOnline(false);
        } finally {
            setStatusCheckedAt(new Date());
            setIsStatusLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSystemStatus();
        const id = setInterval(fetchSystemStatus, 30000);
        return () => clearInterval(id);
    }, [fetchSystemStatus]);

    const fetchDbInfo = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/admin/database/current`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
            });
            if (res.ok) {
                const data = await res.json();
                setCurrentDbUrl(data.data.url);
            }
        } catch (e) { console.error("DB info fetch failed", e); }
    }, []);

    const fetchSnapshots = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/admin/database/snapshots`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
            });
            if (res.ok) setSnapshots(await res.json());
        } catch (e) { console.error("Snapshot fetch failed", e); }
    }, []);

    const fetchSchedule = useCallback(async () => {
        setIsScheduleLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/database/backup-schedule`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
            });
            if (res.ok) {
                const data = await res.json();
                setSchedule(data);
                setScheduleForm({
                    enabled: data.enabled, frequency: data.frequency,
                    day_of_week: data.day_of_week ?? 0, hour: data.hour, minute: data.minute,
                    timezone: data.timezone, retain_count: data.retain_count,
                });
            }
        } catch (e) { console.error("Backup schedule fetch failed", e); }
        finally { setIsScheduleLoading(false); }
    }, []);

    useEffect(() => {
        fetchDbInfo();
        fetchSnapshots();
        fetchSchedule();
        const savedProfiles = localStorage.getItem('terras_db_profiles');
        if (savedProfiles) setDbProfiles(JSON.parse(savedProfiles));
    }, [fetchDbInfo, fetchSnapshots, fetchSchedule]);

    const handleSaveSchedule = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSavingSchedule(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/database/backup-schedule`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                },
                body: JSON.stringify(scheduleForm)
            });
            if (res.ok) {
                setSchedule(await res.json());
                showToast('Backup schedule saved', 'success');
            } else {
                const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
                showToast(`Save failed: ${err.detail}`, 'danger');
            }
        } catch (e) { showToast('Network error saving schedule', 'danger'); }
        finally { setIsSavingSchedule(false); }
    };

    const handleRunNow = async () => {
        setIsRunningNow(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/database/backup-schedule/run-now`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
            });
            if (res.ok) {
                showToast('Backup ran successfully', 'success');
            } else {
                const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
                showToast(`Backup failed: ${err.detail}`, 'danger');
            }
        } catch (e) { showToast('Network error running backup', 'danger'); }
        finally {
            setIsRunningNow(false);
            fetchSchedule();
            fetchSnapshots();
        }
    };

    const handleSwitchDatabase = async (url: string) => {
        setIsDbLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/database/switch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                },
                body: JSON.stringify({ name: 'Manual Switch', url })
            });
            if (res.ok) {
                showToast('Database switched and initialized!', 'success');
                if (!dbProfiles.some(p => p.url === url)) {
                    const newProfiles = [...dbProfiles, { name: `DB ${dbProfiles.length + 1}`, url }];
                    setDbProfiles(newProfiles);
                    localStorage.setItem('terras_db_profiles', JSON.stringify(newProfiles));
                }
                window.location.reload();
            } else {
                const err = await res.json();
                showToast(`Switch failed: ${err.detail}`, 'danger');
            }
        } catch (e) {
            showToast('Network error during DB switch', 'danger');
        } finally {
            setIsDbLoading(false);
        }
    };

    const handleCreateSnapshot = async () => {
        setIsSnapshotLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/database/snapshots`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
            });
            if (res.ok) {
                showToast('Snapshot created successfully', 'success');
                fetchSnapshots();
            }
        } catch (e) { showToast('Failed to create snapshot', 'danger'); }
        finally { setIsSnapshotLoading(false); }
    };

    const handleDownloadSnapshot = async (filename: string) => {
        try {
            const res = await authFetch(`${API_BASE}/admin/database/snapshots/${filename}/download`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
            });
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (e) { showToast('Download failed', 'danger'); }
    };

    /** Follows a running restore to its end. Blips are expected rather than fatal —
     *  the API drops and re-opens its pool mid-restore — so a failed poll retries;
     *  only a long silence is reported as lost contact. */
    const pollRestoreStatus = useCallback(async () => {
        let misses = 0;
        while (misses < 40) {
            await new Promise(r => setTimeout(r, 700));
            try {
                const res = await authFetch(`${API_BASE}/admin/database/snapshots/restore-status`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
                });
                if (!res.ok) { misses++; continue; }
                misses = 0;
                const st = await res.json();
                setRestore((prev: any) => ({ ...prev, ...st }));
                if (st.status === 'done' || st.status === 'error') return;
            } catch { misses++; }
        }
        setRestore((prev: any) => ({
            ...prev, status: 'error', phase: 'Lost contact',
            message: 'Lost contact with the server while restoring. Check the API logs before retrying — the restore may still have finished.',
        }));
    }, []);

    const handleRestoreSnapshot = async (filename: string) => {
        const ok = await confirm({
            title: 'Restore Snapshot?',
            message: `Are you sure you want to restore "${filename}"? Current data will be overwritten, and any uploaded files the snapshot carries (logos, sample photos, design files, delivery notes) are written back over the ones on disk.`,
            confirmText: 'Restore',
            variant: 'danger',
        });
        if (!ok) return;
        restoringRef.current = true;
        setRestoreElapsed(0);
        setRestore({ filename, status: 'running', phase: 'Starting', pct: 0 });
        try {
            const res = await authFetch(`${API_BASE}/admin/database/snapshots/${filename}/restore`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                setRestore({ filename, status: 'error', phase: 'Failed', pct: 100, message: err.detail || `Restore could not be started (${res.status})` });
                return;
            }
            await pollRestoreStatus();
        } catch (e) {
            setRestore({ filename, status: 'error', phase: 'Failed', pct: 100, message: 'Network error starting the restore' });
        } finally {
            restoringRef.current = false;
        }
    };

    /** The app holds a whole cache of rows that no longer exist. Reloading is the only
     *  honest end to a restore — but on the user's click, so the outcome is read first. */
    const finishRestore = (reload: boolean) => {
        if (reload) {
            // Survives the reload that would otherwise swallow the success toast.
            sessionStorage.setItem('terras_restore_done', restore?.filename || '');
            window.location.reload();
            return;
        }
        setRestore(null);
        fetchSnapshots();
        fetchSystemStatus();
    };

    // Elapsed clock for the running restore — there is no per-row progress to show
    // during the dump load, so the count is what tells the user it is still moving.
    useEffect(() => {
        if (restore?.status !== 'running') return;
        const id = setInterval(() => setRestoreElapsed(s => s + 1), 1000);
        return () => clearInterval(id);
    }, [restore?.status]);

    // Confirmation on the far side of the reload above.
    useEffect(() => {
        const done = sessionStorage.getItem('terras_restore_done');
        if (done === null) return;
        sessionStorage.removeItem('terras_restore_done');
        showToast(`Restored from ${done || 'snapshot'} — you are now on the restored data`, 'success');
    }, [showToast]);

    const handleUploadSnapshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0]) return;
        const file = e.target.files[0];
        const formData = new FormData();
        formData.append('file', file);
        setIsSnapshotLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/database/snapshots/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` },
                body: formData
            });
            if (res.ok) {
                showToast('Snapshot uploaded!', 'success');
                fetchSnapshots();
            }
        } catch (e) { showToast('Upload failed', 'danger'); }
        finally { setIsSnapshotLoading(false); }
    };

    const handleDeleteSnapshot = async (filename: string) => {
        const ok = await confirm({
            title: 'Delete Snapshot?',
            message: `Permanently delete "${filename}"? The snapshot file is removed from disk and cannot be recovered.`,
            confirmText: 'Delete',
            variant: 'danger',
        });
        if (!ok) return;
        setIsSnapshotLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/database/snapshots/${encodeURIComponent(filename)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
            });
            if (res.ok) {
                showToast('Snapshot deleted', 'success');
                fetchSnapshots();
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(`Delete failed: ${err.detail || res.status}`, 'danger');
            }
        } catch (e) { showToast('Delete failed', 'danger'); }
        finally { setIsSnapshotLoading(false); }
    };

    const handleWipeDatabase = async () => {
        if (!wipePassword) return;
        setIsWiping(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/database/wipe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                },
                body: JSON.stringify({ password: wipePassword })
            });
            if (res.ok) {
                showToast('Database wiped and reset to a blank state', 'success');
                setShowWipeModal(false);
                setWipePassword('');
                window.location.reload();
            } else {
                const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
                showToast(`Wipe failed: ${err.detail}`, 'danger');
            }
        } catch (e) {
            showToast('Network error during database wipe', 'danger');
        } finally {
            setIsWiping(false);
        }
    };

    const refreshButton = (
        <button
            type="button"
            style={xpBtn({ padding: '1px 8px' })}
            className={XP_BTN}
            onClick={fetchSystemStatus}
            disabled={isStatusLoading}
        >
            {isStatusLoading ? <span className="spinner-border spinner-border-sm"></span> : <><i className="bi bi-arrow-clockwise" style={{ marginRight: 4 }}></i>Refresh</>}
        </button>
    );

    const wsOk = wsStatus === 'open' ? true : wsStatus === 'closed' ? false : null;
    const services = [
        { label: 'WebSocket', icon: 'bi-broadcast', ok: wsOk, detail: wsStatus === 'connecting' ? 'Connecting…' : 'Live event feed' },
        { label: 'Backend API', icon: 'bi-hdd-network', ok: beOnline, detail: beOnline === false ? 'Unreachable' : 'REST API' },
        { label: 'Database', icon: 'bi-database', ok: dbPing?.ok ?? (beOnline === false ? false : null), detail: dbPing?.ok ? `${dbPing.latency_ms} ms` : 'PostgreSQL' },
        { label: 'Redis', icon: 'bi-lightning-charge', ok: redisPing?.ok ?? (beOnline === false ? false : null), detail: redisPing?.ok ? `${redisPing.latency_ms} ms` : 'Event bus' },
        { label: 'DB Storage', icon: 'bi-hdd-stack', ok: dbSizeBytes != null ? true : null, detail: prettyBytes(dbSizeBytes) },
    ];
    const anyDown = services.some(sv => sv.ok === false);
    const allUp = services.every(sv => sv.ok === true);
    const eventIssues = eventStats
        ? [eventStats.unpublished_backlog, eventStats.publish?.failures, eventStats.connections?.closed_backpressure].filter(v => (v ?? 0) > 0).length
        : 0;
    const backupFailed = schedule?.last_run_status === 'failed';
    const scheduleText = !schedule?.enabled ? 'Automatic backups off'
        : `${schedule.frequency === 'weekly' ? `Weekly, ${DAY_NAMES[schedule.day_of_week ?? 0]}` : 'Daily'} at ${pad2(schedule.hour)}:${pad2(schedule.minute)}`;
    // "erp:***@db:5432/erp" → "db:5432/erp": the host is what tells two databases apart.
    const dbTarget = currentDbUrl.split('@').pop() || currentDbUrl;

    const nav: { key: DbSection; icon: string; label: string; badge?: React.ReactNode }[] = [
        { key: 'overview', icon: 'bi-speedometer2', label: 'Overview', badge: <StatusDot ok={anyDown ? false : allUp ? true : null} /> },
        {
            key: 'backups', icon: 'bi-clock-history', label: 'Backups',
            badge: backupFailed ? <Flag tone="red">FAILED</Flag> : <Flag tone={schedule?.enabled ? 'green' : 'gray'}>{schedule?.enabled ? 'ON' : 'OFF'}</Flag>,
        },
        { key: 'events', icon: 'bi-broadcast-pin', label: 'Live events', badge: eventIssues > 0 ? <Flag tone="amber">{eventIssues}</Flag> : undefined },
        { key: 'connection', icon: 'bi-database-fill-gear', label: 'Connection' },
        { key: 'danger', icon: 'bi-exclamation-octagon-fill', label: 'Danger zone' },
    ];

    const eventGroups = eventStats ? [
        { title: 'Connections', stats: [
            <EventStat key="c" label="Connected clients" value={eventStats.connections?.current} />,
            <EventStat key="r" label="Rejected handshakes" value={eventStats.connections?.rejected} />,
            <EventStat key="d" label="Dropped (slow client)" value={eventStats.connections?.closed_backpressure}
                warn={(eventStats.connections?.closed_backpressure ?? 0) > 0} />,
        ] },
        { title: 'Publishing', stats: [
            <EventStat key="p" label="Events published" value={eventStats.publish?.published} />,
            <EventStat key="f" label="Publish failures" value={eventStats.publish?.failures}
                warn={(eventStats.publish?.failures ?? 0) > 0} />,
            <EventStat key="b" label="Unpublished backlog" value={eventStats.unpublished_backlog}
                warn={(eventStats.unpublished_backlog ?? 0) > 0} />,
            <EventStat key="rl" label="Relayed after failure" value={eventStats.publish?.relayed} />,
            <EventStat key="t" label="Publish time" value={fmtMs(eventStats.publish?.time?.avg_ms)} />,
        ] },
        { title: 'Delivery', stats: [
            <EventStat key="dl" label="Events delivered" value={eventStats.delivery?.delivered} />,
            <EventStat key="lag" label="Delivery lag" value={fmtMs(eventStats.delivery?.lag?.avg_ms)} />,
            <EventStat key="rp" label="Resumes replayed" value={eventStats.resume?.events_replayed} />,
            <EventStat key="rs" label="Full resyncs" value={eventStats.resume?.resync_required} />,
        ] },
    ] : [];

    // Each section is the body of the one Database panel: its title and actions go
    // in the panel header, its content sits beside the menu with no box of its own.
    const sections: Record<DbSection, { title: string; icon: string; right?: React.ReactNode; body: React.ReactNode }> = {
        overview: { title: 'Overview', icon: 'bi-speedometer2', right: refreshButton, body: (
            <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                        <SummaryCard
                            icon="bi-clock-history" title="Backups" onClick={() => setSection('backups')}
                            headline={<>{scheduleText}{backupFailed && <Flag tone="red" title={schedule?.last_run_error || undefined}>Last run failed</Flag>}</>}
                            sub={snapshots[0] ? `Last snapshot ${relativeTime(snapshots[0].created_at)} · ${snapshots.length} snapshot${snapshots.length !== 1 ? 's' : ''}` : 'No snapshots yet'}
                        />
                        <SummaryCard
                            icon="bi-activity" title="System health" onClick={() => setSection('events')}
                            headline={<><StatusDot ok={anyDown ? false : allUp ? true : null} />{anyDown ? 'A service is down' : allUp ? 'All systems online' : 'Checking…'}</>}
                            sub={`${eventIssues ? `${eventIssues} live-event issue${eventIssues !== 1 ? 's' : ''}` : 'No live-event issues'} · ${prettyBytes(dbSizeBytes)} stored`}
                        />
                        <SummaryCard
                            icon="bi-database-fill-gear" title="Connection" onClick={() => setSection('connection')}
                            headline={<span style={{ fontFamily: CODE_FONT, fontSize: 12 }}>{dbTarget || '—'}</span>}
                            sub={`${dbProfiles.length} saved profile${dbProfiles.length !== 1 ? 's' : ''}`}
                        />
                    </div>
                    <DetailSection title="Services">
                        {/* auto-fit shares the row evenly instead of leaving a 2-tile orphan row. */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                            {services.map(sv => <StatusTile key={sv.label} {...sv} />)}
                        </div>
                    </DetailSection>
                    {statusCheckedAt && <div style={settingsHint()}>Last checked {statusCheckedAt.toLocaleTimeString()} · refreshes every 30s</div>}
                </div>
            </>
        ) },
        backups: { title: 'Backups', icon: 'bi-clock-history', body: (
            <>
                <DetailSection title="Schedule">
                    <form onSubmit={handleSaveSchedule}>
                        {/* The schedule reads as one sentence. Six stacked full-width
                            fields made "03:00" and "14" span the screen and kept every
                            field live while automatic backups were off — nothing said
                            that none of it would run. */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontFamily: xpFont, fontSize: 12 }}>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={scheduleForm.enabled}
                                aria-label="Run automatic backups"
                                onClick={() => setScheduleForm({ ...scheduleForm, enabled: !scheduleForm.enabled })}
                                style={{
                                    position: 'relative', width: 36, height: 20, flexShrink: 0, marginTop: 3, cursor: 'pointer',
                                    borderRadius: 10, border: `1px solid ${scheduleForm.enabled ? '#1a5e1a' : '#7a7a7a'}`,
                                    background: scheduleForm.enabled ? '#2d7a2d' : '#b8b4a8', padding: 0,
                                }}
                            >
                                <span style={{
                                    position: 'absolute', top: 2, left: scheduleForm.enabled ? 18 : 2, width: 14, height: 14,
                                    borderRadius: '50%', background: '#fff', border: '1px solid #888', transition: 'left 0.15s',
                                }} />
                            </button>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, lineHeight: '26px',
                                    color: scheduleForm.enabled ? '#222' : '#999',
                                }}>
                                    <b>Automatic backups {scheduleForm.enabled ? 'on' : 'off'}</b> —
                                    <select
                                        aria-label="Frequency"
                                        disabled={!scheduleForm.enabled}
                                        style={xpInput({ height: 'auto', padding: '2px 4px' })}
                                        value={scheduleForm.frequency}
                                        onChange={e => setScheduleForm({ ...scheduleForm, frequency: e.target.value })}
                                    >
                                        <option value="daily">every day</option>
                                        <option value="weekly">every week on</option>
                                    </select>
                                    {scheduleForm.frequency === 'weekly' && (
                                        <select
                                            aria-label="Day of week"
                                            disabled={!scheduleForm.enabled}
                                            style={xpInput({ height: 'auto', padding: '2px 4px' })}
                                            value={scheduleForm.day_of_week}
                                            onChange={e => setScheduleForm({ ...scheduleForm, day_of_week: Number(e.target.value) })}
                                        >
                                            {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                                        </select>
                                    )}
                                    at
                                    <input
                                        type="time"
                                        aria-label="Time"
                                        disabled={!scheduleForm.enabled}
                                        style={xpInput({ width: 100 })}
                                        value={`${pad2(scheduleForm.hour)}:${pad2(scheduleForm.minute)}`}
                                        onChange={e => {
                                            const [h, m] = e.target.value.split(':').map(Number);
                                            if (!Number.isNaN(h) && !Number.isNaN(m)) setScheduleForm({ ...scheduleForm, hour: h, minute: m });
                                        }}
                                    />
                                    <select
                                        aria-label="Timezone"
                                        disabled={!scheduleForm.enabled}
                                        style={xpInput({ height: 'auto', padding: '2px 4px' })}
                                        value={scheduleForm.timezone}
                                        onChange={e => setScheduleForm({ ...scheduleForm, timezone: e.target.value })}
                                    >
                                        {AVAILABLE_TIMEZONES.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                                    </select>
                                    , keeping the last
                                    <input
                                        type="number"
                                        min={1}
                                        aria-label="Scheduled snapshots to keep"
                                        disabled={!scheduleForm.enabled}
                                        style={xpInput({ width: 60 })}
                                        value={scheduleForm.retain_count}
                                        onChange={e => setScheduleForm({ ...scheduleForm, retain_count: Math.max(1, Number(e.target.value)) })}
                                    />
                                    scheduled snapshots.
                                </div>
                                <div style={settingsHint()}>Older scheduled snapshots are pruned automatically. Manual snapshots are never deleted.</div>
                            </div>
                        </div>

                        <div style={{ ...settingsActions(), justifyContent: 'flex-start' }}>
                            {schedule?.last_run_at && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <StatusChip status={backupFailed ? 'FAILED' : 'SUCCESS'} title={schedule.last_run_error || undefined} />
                                    <span style={settingsHint()}>Last run {tzDateTime(schedule.last_run_at)}</span>
                                </span>
                            )}
                            <span style={settingsHint()}>
                                {schedule?.enabled && schedule.next_run_at
                                    ? <>Next run <b style={{ color: '#333' }}>{tzDateTime(schedule.next_run_at)}</b></>
                                    : 'No backups will run until this is switched on and saved.'}
                            </span>
                            <span style={{ flex: 1 }} />
                            <button
                                type="button"
                                style={xpBtn({ padding: '3px 14px' })}
                                className={XP_BTN}
                                onClick={handleRunNow}
                                disabled={isRunningNow || isScheduleLoading}
                                title="Take a scheduled-style backup now (counts toward the keep-last limit)"
                            >
                                {isRunningNow ? <span className="spinner-border spinner-border-sm" style={{ marginRight: 4 }}></span> : <i className="bi bi-play-fill" style={{ marginRight: 4 }}></i>}
                                Run Now
                            </button>
                            <button
                                type="submit"
                                style={xpBtn({ ...BTN_TONES.primary, padding: '3px 14px', display: 'flex', alignItems: 'center', gap: 4 })}
                                className={XP_BTN}
                                disabled={isSavingSchedule}
                            >
                                <i className="bi bi-save" style={{ marginRight: 4 }}></i>
                                Save Schedule
                            </button>
                        </div>
                    </form>
                </DetailSection>

                <div style={{ borderTop: '1px solid #dedbd2' }} />

                <DetailSection
                    title="Snapshots"
                    right={
                        <span style={{ display: 'flex', gap: 4 }}>
                            <label style={xpBtn({ padding: '1px 8px', marginBottom: 0 })}>
                                <i className="bi bi-cloud-upload" style={{ marginRight: 4 }}></i>Upload
                                <input type="file" hidden onChange={handleUploadSnapshot} disabled={isSnapshotLoading} />
                            </label>
                            <button
                                type="button"
                                style={xpBtn({ padding: '1px 8px' })}
                                className={XP_BTN}
                                onClick={handleCreateSnapshot}
                                disabled={isSnapshotLoading}
                            >
                                {isSnapshotLoading ? <span className="spinner-border spinner-border-sm" style={{ marginRight: 4 }}></span> : <i className="bi bi-camera" style={{ marginRight: 4 }}></i>}
                                Snapshot Now
                            </button>
                        </span>
                    }
                >
                    {/* Newest first on a rail, with the next scheduled run as a dashed
                        node on top — the gap between "next" and "last" is the thing an
                        admin checks this list for. */}
                    <div className="snap-tl" style={{ fontFamily: xpFont, fontSize: 11 }}>
                        {schedule?.enabled && schedule.next_run_at && (
                            <div className="snap-node" data-kind="next" style={{ ...snapRow, color: '#888' }}>
                                <span>{tzDateTime(schedule.next_run_at)}</span>
                                <span style={{ gridColumn: '2 / -1' }}>Next scheduled backup</span>
                            </div>
                        )}
                        {snapshots.map(sn => (
                            <div key={sn.name} className="snap-node" data-kind={sn.label === 'manual' ? 'manual' : 'scheduled'} style={snapRow}>
                                <span>
                                    <b>{tzDateTime(sn.created_at)}</b>
                                    <div style={{ fontSize: 10, color: '#888' }}>{relativeTime(sn.created_at)}</div>
                                </span>
                                <span><StatusChip status={(sn.label || 'manual').toUpperCase()} /></span>
                                <span style={{ fontFamily: CODE_FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sn.name}>{sn.name}</span>
                                <span style={{ color: '#666', textAlign: 'right' }}>{prettyBytes(sn.size)}</span>
                                <span className="snap-acts" style={{ display: 'flex', gap: 4 }}>
                                    <XPActionButton tone="primary" icon="bi-download" title="Download"
                                        onClick={() => handleDownloadSnapshot(sn.name)} />
                                    <XPActionButton tone="success" icon="bi-arrow-counterclockwise" title="Restore this snapshot"
                                        onClick={() => handleRestoreSnapshot(sn.name)} disabled={isSnapshotLoading} />
                                    <XPActionButton tone="danger" icon="bi-trash" title="Delete snapshot file"
                                        onClick={() => handleDeleteSnapshot(sn.name)} disabled={isSnapshotLoading} />
                                </span>
                            </div>
                        ))}
                        {snapshots.length === 0 && (
                            <div style={{ padding: '16px 8px', color: '#888', fontStyle: 'italic' }}>No snapshots yet — take one with Snapshot Now.</div>
                        )}
                    </div>
                    {snapshots.length > 0 && (
                        <div style={{ ...settingsHint(), marginTop: 6 }}>
                            {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''} · {prettyBytes(snapshots.reduce((n, sn) => n + (sn.size || 0), 0))} on disk
                        </div>
                    )}
                </DetailSection>
            </>
        ) },
        events: { title: 'Live Events', icon: 'bi-broadcast-pin', right: refreshButton, body: (
            <>
                {/* Counters reset when the API process restarts — they answer "is the
                    feed healthy right now", not "how much has ever happened". Backlog
                    is the one to watch: above zero for more than a few seconds means
                    events aren't reaching the bus. */}
                {eventStats ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {eventGroups.map(g => (
                            <DetailSection key={g.title} title={g.title}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>{g.stats}</div>
                            </DetailSection>
                        ))}
                        <div style={settingsHint()}>
                            Since the API last restarted ({fmtUptime(eventStats.uptime_seconds)} ago). Amber means something went wrong; grey zeros are normal on a quiet system.
                        </div>
                    </div>
                ) : (
                    <div style={settingsHint()}>Live-event counters are unavailable — the API did not answer /health/events.</div>
                )}
            </>
        ) },
        connection: { title: 'Connection', icon: 'bi-database-fill-gear', body: (
            <div data-testid="db-infrastructure-header">
                <div style={{ marginBottom: SETTINGS_FIELD_GAP }}>
                    <FieldLabel>Current Connection</FieldLabel>
                    {<div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ borderRadius: CHIP_RADIUS, background: '#e0dfd8', border: '1px solid #b0a898', padding: '1px 6px', fontFamily: xpFont, fontSize: '11px', color: '#333' }}>
                                <i className="bi bi-link-45deg"></i>
                            </span>
                            <input style={xpInput({ flex: 1, fontFamily: CODE_FONT, background: '#f0ede6', boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)' })} value={currentDbUrl} readOnly />
                        </div>}
                </div>

                {/* Stacked: the action, then the shortcut into it. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: SETTINGS_FIELD_GAP }}>
                    <div>
                        <FieldLabel>Switch to New Database</FieldLabel>
                        {<div style={{ display: 'flex', gap: 4 }}>
                                <input
                                    style={xpInput({ flex: 1, fontFamily: CODE_FONT, boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)' })}
                                    placeholder="postgresql+psycopg2://user:pass@host:port/db"
                                    value={newDbUrl}
                                    onChange={e => setNewDbUrl(e.target.value)}
                                />
                                <button
                                    className={XP_BTN}
                                    style={xpBtn({ background: 'linear-gradient(to bottom, #006e8e, #004a5e)', borderColor: '#004a5e #001a2e #001a2e #004a5e', color: '#ffffff', whiteSpace: 'nowrap' })}
                                    onClick={() => handleSwitchDatabase(newDbUrl)}
                                    disabled={!newDbUrl || isDbLoading}
                                >
                                    {isDbLoading ? <span className="spinner-border spinner-border-sm"></span> : 'Switch Connection'}
                                </button>
                            </div>}
                        <div style={{ ...settingsHint(), color: '#8b0000' }}>
                            <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 4 }}></i>
                            Switching databases changes the entire data context.
                        </div>
                    </div>
                    <div>
                        <FieldLabel>Saved Profiles</FieldLabel>
                        {<div style={{ border: '1px solid #b0a898', background: '#ffffff', maxHeight: 118, overflowY: 'auto' as const }}>
                                {dbProfiles.map((p, i) => (
                                    <button
                                        key={i}
                                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '3px 8px', background: 'none', border: 'none', borderBottom: '1px solid #e0dfd8', cursor: 'pointer', fontFamily: xpFont, fontSize: '11px', textAlign: 'left' as const }}
                                        onClick={() => setNewDbUrl(p.url)}
                                    >
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: '90%' }}>{p.name}: {p.url}</span>
                                        <i className="bi bi-arrow-right-short"></i>
                                    </button>
                                ))}
                                {dbProfiles.length === 0 && (
                                    <div style={{ ...settingsHint(), padding: 8, margin: 0, textAlign: 'center', fontStyle: 'italic' }}>No saved profiles</div>
                                )}
                            </div>}
                    </div>
                </div>
            </div>
        ) },
        danger: { title: 'Danger Zone', icon: 'bi-exclamation-octagon-fill', body: (
            <>
            {/* Severity is carried by the copy and the button, not by a red
                header bar — the section is a peer of the others, its action
                is not. */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 340px', minWidth: 0 }}>
                        <div style={{ fontFamily: xpFont, fontSize: 12, fontWeight: 'bold', color: '#333' }}>
                            Wipe &amp; Reset Database
                        </div>
                        <div style={{ ...settingsHint(), color: '#8b0000' }}>
                            <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 4 }}></i>
                            Permanently deletes every row in the current database, then rebuilds it blank (migrations + seed data). Use this before importing a snapshot from another environment. Cannot be undone.
                        </div>
                    </div>
                    {<button
                            className={XP_BTN}
                            style={xpBtn({ ...BTN_TONES.danger })}
                            onClick={() => setShowWipeModal(true)}
                        >
                            <i className="bi bi-trash3-fill" style={{ marginRight: 4 }}></i>Wipe Database
                        </button>}
            </div>
            </>
        ) },
    };
    const current = sections[section];

    return (
        <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <MasterDetail
                icon={current.icon}
                title={current.title}
                right={current.right}
                listWidth={190}
                list={
                    <nav aria-label="Database sections" style={{ overflow: 'auto' }}>
                        {nav.map(n => (
                            <ListRow key={n.key} selected={section === n.key} onClick={() => setSection(n.key)}>
                                <i className={`bi ${n.icon}`} style={n.key === 'danger' && section !== 'danger' ? { color: '#8e0000' } : undefined} />
                                <span style={{ flex: 1, ...(n.key === 'danger' && section !== 'danger' ? { color: '#8e0000' } : null) }}>{n.label}</span>
                                {n.badge}
                            </ListRow>
                        ))}
                    </nav>
                }
                detail={current.body}
            />

            <ModalWrapper
                isOpen={showWipeModal}
                onClose={() => { if (!isWiping) { setShowWipeModal(false); setWipePassword(''); } }}
                title={<><i className="bi bi-exclamation-octagon-fill me-1"></i>Confirm Database Wipe</>}
                variant="danger"
                size="sm"
                modeless
                footer={
                    <>
                        {<button type="button" style={xpCancelBtn} onClick={() => { setShowWipeModal(false); setWipePassword(''); }} disabled={isWiping}>Cancel</button>}
                        {<button type="button" style={xpDangerBtn} onClick={handleWipeDatabase} disabled={!wipePassword || isWiping}>
                                {isWiping ? <span className="spinner-border spinner-border-sm"></span> : 'WIPE DATABASE'}
                            </button>}
                    </>
                }
            >
                <p style={{ fontFamily: xpFont, fontSize: 11, color: '#333' }}>
                    This will <strong>permanently delete every row</strong> in the current database and rebuild it blank. Enter your password to confirm.
                </p>
                <label
                    style={{ fontFamily: xpFont, fontSize: 11, display: 'block', marginBottom: 2, fontWeight: 'bold' }}
                >Password</label>
                {<input
                        type="password"
                        style={xpInput({ width: '100%', boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)' })}
                        value={wipePassword}
                        onChange={e => setWipePassword(e.target.value)}
                        disabled={isWiping}
                        autoFocus
                    />}
            </ModalWrapper>

            {/* Restore progress. Not dismissable while running: the app is reading a
                database that is being replaced under it, so there is nothing useful to
                go back to until this ends. */}
            <ModalWrapper
                isOpen={!!restore}
                onClose={() => { if (restore?.status !== 'running') finishRestore(false); }}
                title={<><i className={`bi ${restore?.status === 'done' ? 'bi-check-circle-fill' : restore?.status === 'error' ? 'bi-exclamation-octagon-fill' : 'bi-arrow-clockwise'} me-1`}></i>
                    {restore?.status === 'done' ? 'Restore Complete' : restore?.status === 'error' ? 'Restore Failed' : 'Restoring Snapshot'}</>}
                variant={restore?.status === 'error' ? 'danger' : restore?.status === 'done' ? 'success' : 'primary'}
                size="sm"
                modeless
                footer={
                    restore?.status === 'running' ? (
                        <span style={{ fontFamily: xpFont, fontSize: 11, color: '#666' }}>
                            Do not close this window or navigate away.
                        </span>
                    ) : restore?.status === 'done' ? (
                        <>
                            <button type="button" style={xpCancelBtn} onClick={() => finishRestore(false)}>Stay Here</button>
                            <button type="button" style={xpBtn({ ...BTN_TONES.primary, padding: '3px 20px' })} className={XP_BTN} onClick={() => finishRestore(true)} autoFocus>
                                <i className="bi bi-arrow-repeat" style={{ marginRight: 4 }}></i>Reload App
                            </button>
                        </>
                    ) : (
                        <button type="button" style={xpCancelBtn} onClick={() => finishRestore(false)}>Close</button>
                    )
                }
            >
                <div style={{ fontFamily: xpFont, fontSize: 11, color: '#333', display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontWeight: 'bold' }}>{restore?.phase || 'Starting'}</span>
                        <span style={{ color: '#666', fontFamily: CODE_FONT }}>
                            {restore?.status === 'running' ? `${restoreElapsed}s` : `${restore?.elapsed_seconds ?? restoreElapsed}s`}
                        </span>
                    </div>

                    <ProgressBar
                        pct={restore?.pct ?? 0}
                        tone={restore?.status === 'error' ? 'red' : restore?.status === 'done' ? 'green' : 'blue'}
                        height={16}
                        label="inside"
                    />

                    {restore?.files_total > 0 && restore?.status === 'running' && (
                        <div style={{ color: '#666' }}>
                            {restore.files_done} of {restore.files_total} file(s) written
                        </div>
                    )}

                    <div style={{ color: '#666', wordBreak: 'break-all' as const }}>
                        <span style={{ fontFamily: CODE_FONT }}>{restore?.filename}</span>
                    </div>

                    {restore?.status === 'done' && (
                        <div style={{ border: '1px solid #b0a898', background: '#f4fff4', padding: '6px 8px' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: 2 }}>{restore.message}</div>
                            <div style={{ color: '#666' }}>
                                Reload to drop the data this page still holds from before the restore.
                            </div>
                        </div>
                    )}

                    {restore?.status === 'error' && (
                        <div style={{ border: '1px solid #c84040', background: '#fff4f4', padding: '6px 8px', color: '#8e0000' }}>
                            {restore.message}
                        </div>
                    )}
                </div>
            </ModalWrapper>
        </div>
    );
}
