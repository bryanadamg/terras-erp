'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../shared/Toast';
import { useTheme } from '../../context/ThemeContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useData } from '../../context/DataContext';
import { useTimezone, AVAILABLE_TIMEZONES } from '../../context/TimezoneContext';
import { xpBtn, xpInput, CodeChip, StatusChip, CODE_FONT, FieldLabel, xpFont, CHIP_RADIUS, BTN_TONES, XP_BTN, XPActionButton } from '../shared/xpTheme';
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
function EventStat({ classic, label, value, warn }: {
    classic: boolean; label: string; value: number | string | null | undefined; warn?: boolean;
}) {
    return (
        <div style={classic ? {
            background: '#fff', border: '1px solid #b0a898', padding: '6px 8px',
        } : {
            background: '#f8f9fa', border: '1px solid #e2e6ea', borderRadius: 6, padding: '8px 10px',
        }}>
            <div style={{
                fontFamily: classic ? xpFont : undefined, fontSize: classic ? 14 : 16,
                fontWeight: 700, color: warn ? '#c62828' : (classic ? '#333' : '#212529'),
            }}>
                {value ?? '—'}
            </div>
            <div style={{ fontFamily: classic ? xpFont : undefined, fontSize: classic ? 10 : 11, color: '#888' }}>
                {label}
            </div>
        </div>
    );
}

function StatusTile({ classic, label, icon, ok, detail }: { classic: boolean; label: string; icon: string; ok: boolean | null; detail: string }) {
    const color = ok === null ? '#888' : ok ? '#2e7d32' : '#c62828';
    const dotBg = ok === null ? '#aaa' : ok ? '#4caf50' : '#e53935';
    return (
        <div style={classic ? {
            background: '#fff', border: '1px solid #b0a898',
            padding: '6px 8px', display: 'flex', flexDirection: 'column' as const, gap: 2,
        } : {
            background: '#f8f9fa', border: '1px solid #e2e6ea',
            borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column' as const, gap: 2,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: classic ? xpFont : undefined, fontSize: classic ? 11 : 12, fontWeight: 'bold', color: classic ? '#333' : '#495057' }}>
                <i className={`bi ${icon}`} />
                <span>{label}</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotBg, marginLeft: 'auto', flexShrink: 0 }} />
            </div>
            <div style={{ fontFamily: classic ? xpFont : undefined, fontSize: classic ? 11 : 12, color, fontWeight: 600 }}>
                {ok === null ? 'Checking…' : ok ? 'Online' : 'Offline'}
            </div>
            <div style={{ fontFamily: classic ? xpFont : undefined, fontSize: classic ? 10 : 11, color: '#888' }}>{detail}</div>
        </div>
    );
}

export default function SettingsDatabaseTab() {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const { uiStyle } = useTheme();
    const { formatDateTime: tzDateTime } = useTimezone();
    const { wsStatus } = useData();
    const classic = uiStyle === 'classic';

    const [currentDbUrl, setCurrentDbUrl] = useState('');
    const [newDbUrl, setNewDbUrl] = useState('');
    const [dbProfiles, setDbProfiles] = useState<any[]>([]);
    const [isDbLoading, setIsDbLoading] = useState(false);
    const [snapshots, setSnapshots] = useState<any[]>([]);
    const [isSnapshotLoading, setIsSnapshotLoading] = useState(false);

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

    const handleRestoreSnapshot = async (filename: string) => {
        const ok = await confirm({
            title: 'Restore Snapshot?',
            message: `Are you sure you want to restore "${filename}"? Current data will be overwritten.`,
            confirmText: 'Restore',
            variant: 'danger',
        });
        if (!ok) return;
        setIsSnapshotLoading(true);
        try {
            const res = await fetch(`${API_BASE}/admin/database/snapshots/${filename}/restore`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
            });
            if (res.ok) {
                showToast('Database restored successfully!', 'success');
                window.location.reload();
            } else {
                const err = await res.json();
                showToast(`Restore failed: ${err.detail}`, 'danger');
            }
        } catch (e) { showToast('Restore failed', 'danger'); }
        finally { setIsSnapshotLoading(false); }
    };

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
            style={classic ? xpBtn({ padding: '1px 8px' }) : undefined}
            className={classic ? XP_BTN : 'btn btn-sm btn-outline-light py-0 px-2'}
            onClick={fetchSystemStatus}
            disabled={isStatusLoading}
        >
            {isStatusLoading ? <span className="spinner-border spinner-border-sm"></span> : <><i className="bi bi-arrow-clockwise" style={{ marginRight: 4 }}></i>Refresh</>}
        </button>
    );

    return (
        <div style={settingsStack}>
            <SettingsPanel classic={classic} icon="bi-activity" title="System Status" right={refreshButton}>
                {/* Five tiles: auto-fit shares the row evenly instead of leaving
                    a 2-tile orphan row at intermediate widths. */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                    <StatusTile classic={classic} label="WebSocket" icon="bi-broadcast"
                        ok={wsStatus === 'open' ? true : wsStatus === 'closed' ? false : null}
                        detail={wsStatus === 'connecting' ? 'Connecting…' : 'Live event feed'} />
                    <StatusTile classic={classic} label="Backend API" icon="bi-hdd-network"
                        ok={beOnline}
                        detail={beOnline === false ? 'Unreachable' : 'REST API'} />
                    <StatusTile classic={classic} label="Database" icon="bi-database"
                        ok={dbPing?.ok ?? (beOnline === false ? false : null)}
                        detail={dbPing?.ok ? `${dbPing.latency_ms} ms` : 'PostgreSQL'} />
                    <StatusTile classic={classic} label="Redis" icon="bi-lightning-charge"
                        ok={redisPing?.ok ?? (beOnline === false ? false : null)}
                        detail={redisPing?.ok ? `${redisPing.latency_ms} ms` : 'Event bus'} />
                    <StatusTile classic={classic} label="DB Storage" icon="bi-hdd-stack"
                        ok={dbSizeBytes != null ? true : null}
                        detail={prettyBytes(dbSizeBytes)} />
                </div>
                {statusCheckedAt && (
                    <div style={{ ...settingsHint(classic), marginTop: 6, textAlign: 'right' }}>
                        Last checked {statusCheckedAt.toLocaleTimeString()}
                    </div>
                )}
            </SettingsPanel>

            {eventStats && (
                <SettingsPanel classic={classic} icon="bi-broadcast-pin" title="Live Event Feed">
                    {/* Counters reset when the API process restarts — they answer
                        "is the feed healthy right now", not "how much has ever
                        happened". Backlog is the one to watch: anything above zero
                        for more than a few seconds means events aren't reaching the
                        bus. */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                        <EventStat classic={classic} label="Connected clients" value={eventStats.connections?.current} />
                        <EventStat classic={classic} label="Events published" value={eventStats.publish?.published} />
                        <EventStat classic={classic} label="Events delivered" value={eventStats.delivery?.delivered} />
                        <EventStat classic={classic} label="Unpublished backlog" value={eventStats.unpublished_backlog}
                            warn={(eventStats.unpublished_backlog ?? 0) > 0} />
                        <EventStat classic={classic} label="Publish failures" value={eventStats.publish?.failures}
                            warn={(eventStats.publish?.failures ?? 0) > 0} />
                        <EventStat classic={classic} label="Relayed after failure" value={eventStats.publish?.relayed} />
                        <EventStat classic={classic} label="Dropped (slow client)" value={eventStats.connections?.closed_backpressure}
                            warn={(eventStats.connections?.closed_backpressure ?? 0) > 0} />
                        <EventStat classic={classic} label="Rejected handshakes" value={eventStats.connections?.rejected} />
                        <EventStat classic={classic} label="Resumes replayed" value={eventStats.resume?.events_replayed} />
                        <EventStat classic={classic} label="Full resyncs" value={eventStats.resume?.resync_required} />
                        <EventStat classic={classic} label="Publish time" value={fmtMs(eventStats.publish?.time?.avg_ms)} />
                        <EventStat classic={classic} label="Delivery lag" value={fmtMs(eventStats.delivery?.lag?.avg_ms)} />
                    </div>
                    <div style={{ ...settingsHint(classic), marginTop: 6 }}>
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
                    <SettingsPanel classic={classic} icon="bi-clock-history" title="Scheduled Backups">
                        <form onSubmit={handleSaveSchedule}>
                            {/* One field per row, not `settingsGrid`'s auto-fit columns.
                                This panel is the narrow column of the band, so auto-fit
                                landed on two or three tracks depending on the viewport and
                                left the last row half-empty — six fields that each read as
                                a different width and sat in a different place per screen.
                                A stack also keeps Keep Last's hint under its own field. */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: SETTINGS_FIELD_GAP }}>
                                <div>
                                    <FieldLabel classic={classic}>Enabled</FieldLabel>
                                    {classic ? (
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: xpFont, fontSize: 11 }}>
                                            <input type="checkbox" checked={scheduleForm.enabled} onChange={e => setScheduleForm({ ...scheduleForm, enabled: e.target.checked })} />
                                            Run automatic backups
                                        </label>
                                    ) : (
                                        <div className="form-check form-switch">
                                            <input className="form-check-input" type="checkbox" role="switch" checked={scheduleForm.enabled} onChange={e => setScheduleForm({ ...scheduleForm, enabled: e.target.checked })} />
                                            <label className="form-check-label small">Run automatic backups</label>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <FieldLabel classic={classic}>Frequency</FieldLabel>
                                    <select
                                        style={classic ? xpInput({ height: 'auto', padding: '2px 4px', width: '100%' }) : undefined}
                                        className={classic ? '' : 'form-select form-select-sm'}
                                        value={scheduleForm.frequency}
                                        onChange={e => setScheduleForm({ ...scheduleForm, frequency: e.target.value })}
                                    >
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                    </select>
                                </div>
                                {scheduleForm.frequency === 'weekly' && (
                                    <div>
                                        <FieldLabel classic={classic}>Day of Week</FieldLabel>
                                        <select
                                            style={classic ? xpInput({ height: 'auto', padding: '2px 4px', width: '100%' }) : undefined}
                                            className={classic ? '' : 'form-select form-select-sm'}
                                            value={scheduleForm.day_of_week}
                                            onChange={e => setScheduleForm({ ...scheduleForm, day_of_week: Number(e.target.value) })}
                                        >
                                            {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                                        </select>
                                    </div>
                                )}
                                <div>
                                    <FieldLabel classic={classic}>Time</FieldLabel>
                                    <input
                                        type="time"
                                        style={classic ? xpInput({ width: '100%' }) : undefined}
                                        className={classic ? '' : 'form-control form-control-sm'}
                                        value={`${pad2(scheduleForm.hour)}:${pad2(scheduleForm.minute)}`}
                                        onChange={e => {
                                            const [h, m] = e.target.value.split(':').map(Number);
                                            if (!Number.isNaN(h) && !Number.isNaN(m)) setScheduleForm({ ...scheduleForm, hour: h, minute: m });
                                        }}
                                    />
                                </div>
                                <div>
                                    <FieldLabel classic={classic}>Timezone</FieldLabel>
                                    <select
                                        style={classic ? xpInput({ height: 'auto', padding: '2px 4px', width: '100%' }) : undefined}
                                        className={classic ? '' : 'form-select form-select-sm'}
                                        value={scheduleForm.timezone}
                                        onChange={e => setScheduleForm({ ...scheduleForm, timezone: e.target.value })}
                                    >
                                        {AVAILABLE_TIMEZONES.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <FieldLabel classic={classic}>Keep Last</FieldLabel>
                                    <input
                                        type="number"
                                        min={1}
                                        style={classic ? xpInput({ width: '100%' }) : undefined}
                                        className={classic ? '' : 'form-control form-control-sm'}
                                        value={scheduleForm.retain_count}
                                        onChange={e => setScheduleForm({ ...scheduleForm, retain_count: Math.max(1, Number(e.target.value)) })}
                                    />
                                    <div style={settingsHint(classic)}>Oldest scheduled snapshots beyond this count are pruned automatically. Manual snapshots are never deleted.</div>
                                </div>
                            </div>

                            {schedule && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: SETTINGS_FIELD_GAP }}>
                                    {schedule.last_run_at && (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <StatusChip status={schedule.last_run_status === 'failed' ? 'FAILED' : 'SUCCESS'} title={schedule.last_run_error || undefined} />
                                            <span style={settingsHint(classic)}>Last run {tzDateTime(schedule.last_run_at)}</span>
                                        </span>
                                    )}
                                    {schedule.next_run_at && (
                                        <span style={settingsHint(classic)}>Next run {tzDateTime(schedule.next_run_at)}</span>
                                    )}
                                </div>
                            )}

                            <div style={settingsActions(classic)}>
                                <button
                                    type="button"
                                    style={classic ? xpBtn({ padding: '3px 14px' }) : undefined}
                                    className={classic ? XP_BTN : 'btn btn-sm btn-outline-secondary px-3'}
                                    onClick={handleRunNow}
                                    disabled={isRunningNow || isScheduleLoading}
                                >
                                    {isRunningNow ? <span className="spinner-border spinner-border-sm" style={{ marginRight: 4 }}></span> : <i className="bi bi-play-fill" style={{ marginRight: 4 }}></i>}
                                    Run Now
                                </button>
                                <button
                                    type="submit"
                                    style={classic ? xpBtn({ ...BTN_TONES.primary, padding: '3px 14px', display: 'flex', alignItems: 'center', gap: 4 }) : undefined}
                                    className={classic ? XP_BTN : 'btn btn-sm btn-primary px-3'}
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
                        classic={classic}
                        icon="bi-database-fill-gear"
                        title={<span data-testid="db-infrastructure-header">Database Infrastructure</span>}
                        right="Admin only"
                    >
                        <div style={{ marginBottom: SETTINGS_FIELD_GAP }}>
                            <FieldLabel classic={classic}>Current Connection</FieldLabel>
                            {classic ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ borderRadius: CHIP_RADIUS, background: '#e0dfd8', border: '1px solid #b0a898', padding: '1px 6px', fontFamily: xpFont, fontSize: '11px', color: '#333' }}>
                                        <i className="bi bi-link-45deg"></i>
                                    </span>
                                    <input style={xpInput({ flex: 1, fontFamily: CODE_FONT, background: '#f0ede6', boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)' })} value={currentDbUrl} readOnly />
                                </div>
                            ) : (
                                <div className="input-group input-group-sm">
                                    <span className="input-group-text bg-light"><i className="bi bi-link-45deg"></i></span>
                                    <input className="form-control bg-light small" style={{ fontFamily: CODE_FONT }} value={currentDbUrl} readOnly />
                                </div>
                            )}
                        </div>

                        {/* Stacked, not a 7/5 split. This panel now shares its row with
                            the snapshot list, so there is no width left to split: a
                            connection URL and a profile list side by side both end in an
                            ellipsis. Reading order is the action, then the shortcut into it. */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: SETTINGS_FIELD_GAP }}>
                            <div>
                                <FieldLabel classic={classic}>Switch to New Database</FieldLabel>
                                {classic ? (
                                    <div style={{ display: 'flex', gap: 4 }}>
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
                                    </div>
                                ) : (
                                    <div className="input-group input-group-sm">
                                        <input
                                            className="form-control small"
                                            style={{ fontFamily: CODE_FONT }}
                                            placeholder="postgresql+psycopg2://user:pass@host:port/db"
                                            value={newDbUrl}
                                            onChange={e => setNewDbUrl(e.target.value)}
                                        />
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => handleSwitchDatabase(newDbUrl)}
                                            disabled={!newDbUrl || isDbLoading}
                                        >
                                            {isDbLoading ? <span className="spinner-border spinner-border-sm"></span> : 'Switch Connection'}
                                        </button>
                                    </div>
                                )}
                                <div style={{ ...settingsHint(classic), color: '#8b0000' }}>
                                    <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 4 }}></i>
                                    Switching databases changes the entire data context.
                                </div>
                            </div>
                            <div>
                                <FieldLabel classic={classic}>Saved Profiles</FieldLabel>
                                {classic ? (
                                    <div style={{ border: '1px solid #b0a898', background: '#ffffff', maxHeight: 118, overflowY: 'auto' as const }}>
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
                                            <div style={{ ...settingsHint(classic), padding: 8, margin: 0, textAlign: 'center', fontStyle: 'italic' }}>No saved profiles</div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="list-group list-group-flush border rounded overflow-auto" style={{ maxHeight: 118 }}>
                                        {dbProfiles.map((p, i) => (
                                            <button
                                                key={i}
                                                className="list-group-item list-group-item-action d-flex justify-content-between align-items-center small"
                                                onClick={() => setNewDbUrl(p.url)}
                                            >
                                                <span className="text-truncate" style={{ maxWidth: '80%' }}>{p.name}: {p.url}</span>
                                                <i className="bi bi-arrow-right-short"></i>
                                            </button>
                                        ))}
                                        {dbProfiles.length === 0 && <div className="p-3 text-center text-muted extra-small">No saved profiles</div>}
                                    </div>
                                )}
                            </div>
                        </div>
                    </SettingsPanel>

                    <SettingsPanel
                        classic={classic}
                        icon="bi-camera-fill"
                        title="Snapshots"
                        flush
                        right={
                            <span style={{ display: 'flex', gap: 4 }}>
                                <label
                                    style={classic ? xpBtn({ padding: '1px 8px', marginBottom: 0 }) : { cursor: 'pointer', marginBottom: 0 }}
                                    className={classic ? '' : 'btn btn-sm btn-outline-light py-0 px-2'}
                                >
                                    <i className="bi bi-cloud-upload" style={{ marginRight: 4 }}></i>Upload
                                    <input type="file" hidden onChange={handleUploadSnapshot} disabled={isSnapshotLoading} />
                                </label>
                                <button
                                    type="button"
                                    style={classic ? xpBtn({ padding: '1px 8px' }) : undefined}
                                    className={classic ? XP_BTN : 'btn btn-sm btn-outline-light py-0 px-2'}
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
                                    style={classic ? { width: '100%', borderCollapse: 'collapse' as const, background: '#fff' } : undefined}
                                    className={classic ? '' : 'table table-hover align-middle mb-0 small'}
                                >
                                    <thead style={classic ? xpTableHeader : undefined} className={classic ? '' : 'table-light'}>
                                        <tr>
                                            <th style={classic ? { ...xpThCell } : undefined} className={classic ? '' : 'ps-4'}>Snapshot Filename</th>
                                            <th style={classic ? xpThCell : undefined}>Origin</th>
                                            <th style={classic ? xpThCell : undefined}>Created At</th>
                                            <th style={classic ? xpThCell : undefined}>Size</th>
                                            <th style={classic ? { ...xpThCell, textAlign: 'right' as const, borderRight: 'none' } : undefined} className={classic ? '' : 'text-end pe-4'}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {snapshots.map((s, i) => (
                                            <tr
                                                key={i}
                                                style={classic ? { background: lvZebra(true, i), borderBottom: '1px solid #c0bdb5' } : undefined}
                                            >
                                                <td style={classic ? tdBase : undefined} className={classic ? '' : 'ps-4'}><CodeChip code={s.name} classic={classic} /></td>
                                                <td style={classic ? tdBase : undefined}><StatusChip status={(s.label || 'manual').toUpperCase()} /></td>
                                                <td style={classic ? tdBase : undefined}>{tzDateTime(s.created_at)}</td>
                                                <td style={classic ? tdBase : undefined}>{(s.size / 1024 / 1024).toFixed(2)} MB</td>
                                                <td style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'right' as const } : undefined} className={classic ? '' : 'text-end pe-4'}>
                                                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                                        <XPActionButton
                                                            classic={classic} tone="primary" icon="bi-download" title="Export/Download"
                                                            onClick={() => handleDownloadSnapshot(s.name)}
                                                        />
                                                        <XPActionButton
                                                            classic={classic} tone="success" icon="bi-arrow-counterclockwise" title="Restore/Rollback"
                                                            onClick={() => handleRestoreSnapshot(s.name)}
                                                            disabled={isSnapshotLoading}
                                                        />
                                                        <XPActionButton
                                                            classic={classic} tone="danger" icon="bi-trash" title="Delete snapshot file"
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
                                                    style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'center', padding: '20px 8px', color: '#888', fontStyle: 'italic' } : undefined}
                                                    className={classic ? '' : 'text-center py-4 text-muted'}
                                                >No snapshots found. Create one to begin.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                    </SettingsPanel>
                </div>
            </div>

            <SettingsPanel classic={classic} icon="bi-exclamation-octagon-fill" title="Danger Zone">
                {/* Severity is carried by the copy and the button, not by a red
                    window bar — the panel is a peer of the others, its action
                    is not. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: '1 1 340px', minWidth: 0 }}>
                            <div style={classic ? { fontFamily: xpFont, fontSize: 12, fontWeight: 'bold', color: '#333' } : undefined} className={classic ? '' : 'fw-bold'}>
                                Wipe &amp; Reset Database
                            </div>
                            <div style={{ ...settingsHint(classic), color: '#8b0000' }}>
                                <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 4 }}></i>
                                Permanently deletes every row in the current database, then rebuilds it blank (migrations + seed data). Use this before importing a snapshot from another environment. Cannot be undone.
                            </div>
                        </div>
                        {classic ? (
                            <button
                                className={XP_BTN}
                                style={xpBtn({ ...BTN_TONES.danger })}
                                onClick={() => setShowWipeModal(true)}
                            >
                                <i className="bi bi-trash3-fill" style={{ marginRight: 4 }}></i>Wipe Database
                            </button>
                        ) : (
                            <button className="btn btn-danger btn-sm" onClick={() => setShowWipeModal(true)}>
                                <i className="bi bi-trash3-fill me-1"></i>Wipe Database
                            </button>
                        )}
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
                        {classic ? (
                            <button type="button" style={xpCancelBtn} onClick={() => { setShowWipeModal(false); setWipePassword(''); }} disabled={isWiping}>Cancel</button>
                        ) : (
                            <button type="button" className="btn btn-sm btn-link text-muted text-decoration-none" onClick={() => { setShowWipeModal(false); setWipePassword(''); }} disabled={isWiping}>Cancel</button>
                        )}
                        {classic ? (
                            <button type="button" style={xpDangerBtn} onClick={handleWipeDatabase} disabled={!wipePassword || isWiping}>
                                {isWiping ? <span className="spinner-border spinner-border-sm"></span> : 'WIPE DATABASE'}
                            </button>
                        ) : (
                            <button type="button" className="btn btn-sm btn-danger px-4 fw-bold shadow-sm" onClick={handleWipeDatabase} disabled={!wipePassword || isWiping}>
                                {isWiping ? <span className="spinner-border spinner-border-sm me-1"></span> : null}
                                WIPE DATABASE
                            </button>
                        )}
                    </>
                }
            >
                <p className={classic ? '' : 'small'} style={classic ? { fontFamily: xpFont, fontSize: 11, color: '#333' } : undefined}>
                    This will <strong>permanently delete every row</strong> in the current database and rebuild it blank. Enter your password to confirm.
                </p>
                <label
                    style={classic ? { fontFamily: xpFont, fontSize: 11, display: 'block', marginBottom: 2, fontWeight: 'bold' } : undefined}
                    className={classic ? '' : 'form-label small fw-bold'}
                >Password</label>
                {classic ? (
                    <input
                        type="password"
                        style={xpInput({ width: '100%', boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)' })}
                        value={wipePassword}
                        onChange={e => setWipePassword(e.target.value)}
                        disabled={isWiping}
                        autoFocus
                    />
                ) : (
                    <input
                        type="password"
                        className="form-control"
                        value={wipePassword}
                        onChange={e => setWipePassword(e.target.value)}
                        disabled={isWiping}
                        autoFocus
                    />
                )}
            </ModalWrapper>
        </div>
    );
}
