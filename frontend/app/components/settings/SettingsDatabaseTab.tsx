'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../shared/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { useData } from '../../context/DataContext';
import { useTimezone, AVAILABLE_TIMEZONES } from '../../context/TimezoneContext';
import { xpBtn, xpInput, CodeChip, StatusChip, CODE_FONT, FieldLabel, xpFont, CHIP_RADIUS, BTN_TONES, XP_BTN, XPActionButton, ProgressBar } from '../shared/xpTheme';
import {
    xpTableHeader, xpThCell, tdBase,
    settingsStack, settingsActions, settingsHint, SETTINGS_FIELD_GAP,
    settingsCol, settingsColumns,
} from './settingsStyles';
import SettingsPanel from './SettingsPanel';
import ModalWrapper from '../shared/ModalWrapper';
import { lvZebra } from '../shared/listViewTheme';

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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';

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

const fmtMs = (ms: number | null | undefined) => (ms == null ? '—' : `${ms} ms`);

function fmtUptime(seconds: number | null | undefined): string {
    if (seconds == null) return '—';
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m`;
    return `${Math.round(seconds)}s`;
}

/** One number from the live-event bus. Same card shell as StatusTile, but these
 *  are counters rather than up/down states, so there is no status dot to show —
 *  `warn` tints the ones where any value above zero is worth a look. */
function EventStat({ label, value, warn }: { label: string; value: number | string | null | undefined; warn?: boolean;
}) {
    return (
        <div style={{
            background: '#fff', border: '1px solid #b0a898', padding: '6px 8px',
        }}>
            <div style={{
                fontFamily: xpFont, fontSize: 14,
                fontWeight: 700, color: warn ? '#c62828' : ('#333'),
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
    const { wsStatus } = useData();

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
            const res = await fetch(`${API_BASE}/admin/database/status`, { headers: auth });
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
                const ev = await fetch(`${API_BASE}/health/events`, { headers: auth });
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
            const res = await fetch(`${API_BASE}/admin/database/current`, {
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
            const res = await fetch(`${API_BASE}/admin/database/snapshots`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
            });
            if (res.ok) setSnapshots(await res.json());
        } catch (e) { console.error("Snapshot fetch failed", e); }
    }, []);

    const fetchSchedule = useCallback(async () => {
        setIsScheduleLoading(true);
        try {
            const res = await fetch(`${API_BASE}/admin/database/backup-schedule`, {
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
            const res = await fetch(`${API_BASE}/admin/database/backup-schedule`, {
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
            const res = await fetch(`${API_BASE}/admin/database/backup-schedule/run-now`, {
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
            const res = await fetch(`${API_BASE}/admin/database/switch`, {
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
            const res = await fetch(`${API_BASE}/admin/database/snapshots`, {
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
            const res = await fetch(`${API_BASE}/admin/database/snapshots/${filename}/download`, {
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
                const res = await fetch(`${API_BASE}/admin/database/snapshots/restore-status`, {
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
            const res = await fetch(`${API_BASE}/admin/database/snapshots/${filename}/restore`, {
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
            const res = await fetch(`${API_BASE}/admin/database/snapshots/upload`, {
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
            const res = await fetch(`${API_BASE}/admin/database/snapshots/${encodeURIComponent(filename)}`, {
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
            const res = await fetch(`${API_BASE}/admin/database/wipe`, {
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

    return (
        <div style={settingsStack}>
            <SettingsPanel icon="bi-activity" title="System Status" right={refreshButton}>
                {/* Five tiles: auto-fit shares the row evenly instead of leaving
                    a 2-tile orphan row at intermediate widths. */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                    <StatusTile label="WebSocket" icon="bi-broadcast"
                        ok={wsStatus === 'open' ? true : wsStatus === 'closed' ? false : null}
                        detail={wsStatus === 'connecting' ? 'Connecting…' : 'Live event feed'} />
                    <StatusTile label="Backend API" icon="bi-hdd-network"
                        ok={beOnline}
                        detail={beOnline === false ? 'Unreachable' : 'REST API'} />
                    <StatusTile label="Database" icon="bi-database"
                        ok={dbPing?.ok ?? (beOnline === false ? false : null)}
                        detail={dbPing?.ok ? `${dbPing.latency_ms} ms` : 'PostgreSQL'} />
                    <StatusTile label="Redis" icon="bi-lightning-charge"
                        ok={redisPing?.ok ?? (beOnline === false ? false : null)}
                        detail={redisPing?.ok ? `${redisPing.latency_ms} ms` : 'Event bus'} />
                    <StatusTile label="DB Storage" icon="bi-hdd-stack"
                        ok={dbSizeBytes != null ? true : null}
                        detail={prettyBytes(dbSizeBytes)} />
                </div>
                {statusCheckedAt && (
                    <div style={{ ...settingsHint(), marginTop: 6, textAlign: 'right' }}>
                        Last checked {statusCheckedAt.toLocaleTimeString()}
                    </div>
                )}
            </SettingsPanel>

            {eventStats && (
                <SettingsPanel icon="bi-broadcast-pin" title="Live Event Feed">
                    {/* Counters reset when the API process restarts — they answer
                        "is the feed healthy right now", not "how much has ever
                        happened". Backlog is the one to watch: anything above zero
                        for more than a few seconds means events aren't reaching the
                        bus. */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                        <EventStat label="Connected clients" value={eventStats.connections?.current} />
                        <EventStat label="Events published" value={eventStats.publish?.published} />
                        <EventStat label="Events delivered" value={eventStats.delivery?.delivered} />
                        <EventStat label="Unpublished backlog" value={eventStats.unpublished_backlog}
                            warn={(eventStats.unpublished_backlog ?? 0) > 0} />
                        <EventStat label="Publish failures" value={eventStats.publish?.failures}
                            warn={(eventStats.publish?.failures ?? 0) > 0} />
                        <EventStat label="Relayed after failure" value={eventStats.publish?.relayed} />
                        <EventStat label="Dropped (slow client)" value={eventStats.connections?.closed_backpressure}
                            warn={(eventStats.connections?.closed_backpressure ?? 0) > 0} />
                        <EventStat label="Rejected handshakes" value={eventStats.connections?.rejected} />
                        <EventStat label="Resumes replayed" value={eventStats.resume?.events_replayed} />
                        <EventStat label="Full resyncs" value={eventStats.resume?.resync_required} />
                        <EventStat label="Publish time" value={fmtMs(eventStats.publish?.time?.avg_ms)} />
                        <EventStat label="Delivery lag" value={fmtMs(eventStats.delivery?.lag?.avg_ms)} />
                    </div>
                    <div style={{ ...settingsHint(), marginTop: 6 }}>
                        Since the API last restarted ({fmtUptime(eventStats.uptime_seconds)} ago).
                    </div>
                </SettingsPanel>
            )}

            {/* System Status above and Danger Zone below stay full-bleed — five
                live cards genuinely use the width, and a destructive action wants
                its own band. In between, the schedule form is the narrow column and
                the two things that grow — the connection panel's URL fields and the
                snapshot list — share the wider one. */}
            <div style={settingsColumns}>
                <div style={settingsCol(420, 1)}>
                    <SettingsPanel icon="bi-clock-history" title="Scheduled Backups">
                        <form onSubmit={handleSaveSchedule}>
                            {/* One field per row, not `settingsGrid`'s auto-fit columns.
                                This panel is the narrow column of the band, so auto-fit
                                landed on two or three tracks depending on the viewport and
                                left the last row half-empty — six fields that each read as
                                a different width and sat in a different place per screen.
                                A stack also keeps Keep Last's hint under its own field. */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: SETTINGS_FIELD_GAP }}>
                                <div>
                                    <FieldLabel>Enabled</FieldLabel>
                                    {<label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: xpFont, fontSize: 11 }}>
                                            <input type="checkbox" checked={scheduleForm.enabled} onChange={e => setScheduleForm({ ...scheduleForm, enabled: e.target.checked })} />
                                            Run automatic backups
                                        </label>}
                                </div>
                                <div>
                                    <FieldLabel>Frequency</FieldLabel>
                                    <select
                                        style={xpInput({ height: 'auto', padding: '2px 4px', width: '100%' })}
                                        value={scheduleForm.frequency}
                                        onChange={e => setScheduleForm({ ...scheduleForm, frequency: e.target.value })}
                                    >
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                    </select>
                                </div>
                                {scheduleForm.frequency === 'weekly' && (
                                    <div>
                                        <FieldLabel>Day of Week</FieldLabel>
                                        <select
                                            style={xpInput({ height: 'auto', padding: '2px 4px', width: '100%' })}
                                            value={scheduleForm.day_of_week}
                                            onChange={e => setScheduleForm({ ...scheduleForm, day_of_week: Number(e.target.value) })}
                                        >
                                            {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                                        </select>
                                    </div>
                                )}
                                <div>
                                    <FieldLabel>Time</FieldLabel>
                                    <input
                                        type="time"
                                        style={xpInput({ width: '100%' })}
                                        value={`${pad2(scheduleForm.hour)}:${pad2(scheduleForm.minute)}`}
                                        onChange={e => {
                                            const [h, m] = e.target.value.split(':').map(Number);
                                            if (!Number.isNaN(h) && !Number.isNaN(m)) setScheduleForm({ ...scheduleForm, hour: h, minute: m });
                                        }}
                                    />
                                </div>
                                <div>
                                    <FieldLabel>Timezone</FieldLabel>
                                    <select
                                        style={xpInput({ height: 'auto', padding: '2px 4px', width: '100%' })}
                                        value={scheduleForm.timezone}
                                        onChange={e => setScheduleForm({ ...scheduleForm, timezone: e.target.value })}
                                    >
                                        {AVAILABLE_TIMEZONES.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <FieldLabel>Keep Last</FieldLabel>
                                    <input
                                        type="number"
                                        min={1}
                                        style={xpInput({ width: '100%' })}
                                        value={scheduleForm.retain_count}
                                        onChange={e => setScheduleForm({ ...scheduleForm, retain_count: Math.max(1, Number(e.target.value)) })}
                                    />
                                    <div style={settingsHint()}>Oldest scheduled snapshots beyond this count are pruned automatically. Manual snapshots are never deleted.</div>
                                </div>
                            </div>

                            {schedule && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: SETTINGS_FIELD_GAP }}>
                                    {schedule.last_run_at && (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <StatusChip status={schedule.last_run_status === 'failed' ? 'FAILED' : 'SUCCESS'} title={schedule.last_run_error || undefined} />
                                            <span style={settingsHint()}>Last run {tzDateTime(schedule.last_run_at)}</span>
                                        </span>
                                    )}
                                    {schedule.next_run_at && (
                                        <span style={settingsHint()}>Next run {tzDateTime(schedule.next_run_at)}</span>
                                    )}
                                </div>
                            )}

                            <div style={settingsActions()}>
                                <button
                                    type="button"
                                    style={xpBtn({ padding: '3px 14px' })}
                                    className={XP_BTN}
                                    onClick={handleRunNow}
                                    disabled={isRunningNow || isScheduleLoading}
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
                    </SettingsPanel>
                </div>

                <div style={settingsCol(560, 1)}>
                    <SettingsPanel
                        icon="bi-database-fill-gear"
                        title={<span data-testid="db-infrastructure-header">Database Infrastructure</span>}
                        right="Admin only"
                    >
                        <div style={{ marginBottom: SETTINGS_FIELD_GAP }}>
                            <FieldLabel>Current Connection</FieldLabel>
                            {<div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ borderRadius: CHIP_RADIUS, background: '#e0dfd8', border: '1px solid #b0a898', padding: '1px 6px', fontFamily: xpFont, fontSize: '11px', color: '#333' }}>
                                        <i className="bi bi-link-45deg"></i>
                                    </span>
                                    <input style={xpInput({ flex: 1, fontFamily: CODE_FONT, background: '#f0ede6', boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)' })} value={currentDbUrl} readOnly />
                                </div>}
                        </div>

                        {/* Stacked, not a 7/5 split. This panel now shares its row with
                            the snapshot list, so there is no width left to split: a
                            connection URL and a profile list side by side both end in an
                            ellipsis. Reading order is the action, then the shortcut into it. */}
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
                    </SettingsPanel>

                    <SettingsPanel
                        icon="bi-camera-fill"
                        title="Snapshots"
                        flush
                        right={
                            <span style={{ display: 'flex', gap: 4 }}>
                                <label
                                    style={xpBtn({ padding: '1px 8px', marginBottom: 0 })}
                                >
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
                                    {isSnapshotLoading ? <span className="spinner-border spinner-border-sm" style={{ marginRight: 4 }}></span> : <i className="bi bi-plus-lg" style={{ marginRight: 4 }}></i>}
                                    New Snapshot
                                </button>
                            </span>
                        }
                    >
                        <div className="table-responsive">
                                <table
                                    style={{ width: '100%', borderCollapse: 'collapse' as const, background: '#fff' }}
                                >
                                    <thead style={xpTableHeader}>
                                        <tr>
                                            <th style={{ ...xpThCell }}>Snapshot Filename</th>
                                            <th style={xpThCell}>Origin</th>
                                            <th style={xpThCell}>Created At</th>
                                            <th style={xpThCell}>Size</th>
                                            <th style={{ ...xpThCell, textAlign: 'right' as const, borderRight: 'none' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {snapshots.map((s, i) => (
                                            <tr
                                                key={i}
                                                style={{ background: lvZebra(i), borderBottom: '1px solid #c0bdb5' }}
                                            >
                                                <td style={tdBase}><CodeChip code={s.name} /></td>
                                                <td style={tdBase}><StatusChip status={(s.label || 'manual').toUpperCase()} /></td>
                                                <td style={tdBase}>{tzDateTime(s.created_at)}</td>
                                                <td style={tdBase}>{(s.size / 1024 / 1024).toFixed(2)} MB</td>
                                                <td style={{ ...tdBase, borderRight: 'none', textAlign: 'right' as const }}>
                                                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                                        <XPActionButton tone="primary" icon="bi-download" title="Export/Download"
                                                            onClick={() => handleDownloadSnapshot(s.name)}
                                                        />
                                                        <XPActionButton tone="success" icon="bi-arrow-counterclockwise" title="Restore/Rollback"
                                                            onClick={() => handleRestoreSnapshot(s.name)}
                                                            disabled={isSnapshotLoading}
                                                        />
                                                        <XPActionButton tone="danger" icon="bi-trash" title="Delete snapshot file"
                                                            onClick={() => handleDeleteSnapshot(s.name)}
                                                            disabled={isSnapshotLoading}
                                                        />
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {snapshots.length === 0 && (
                                            <tr>
                                                <td
                                                    colSpan={5}
                                                    style={{ ...tdBase, borderRight: 'none', textAlign: 'center', padding: '20px 8px', color: '#888', fontStyle: 'italic' }}
                                                >No snapshots found. Create one to begin.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                    </SettingsPanel>
                </div>
            </div>

            <SettingsPanel icon="bi-exclamation-octagon-fill" title="Danger Zone">
                {/* Severity is carried by the copy and the button, not by a red
                    window bar — the panel is a peer of the others, its action
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
            </SettingsPanel>

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
