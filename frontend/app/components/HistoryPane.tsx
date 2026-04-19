import { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';

interface HistoryPaneProps {
    entityType: 'Item' | 'SampleRequest' | 'BOM' | 'WorkOrder';
    entityId: string;
    onClose: () => void;
}

const ACTION_META: Record<string, { icon: string; color: string; bg: string; label: string }> = {
    CREATE:        { icon: '●', color: '#006400', bg: '#e6f4ea', label: 'Create'  },
    UPDATE:        { icon: '●', color: '#1a4a8a', bg: '#dce8f8', label: 'Update'  },
    DELETE:        { icon: '●', color: '#8b0000', bg: '#fde8e8', label: 'Delete'  },
    STATUS_CHANGE: { icon: '●', color: '#7a5200', bg: '#fff5d6', label: 'Status'  },
};
const DEFAULT_META = { icon: '●', color: '#444', bg: '#f0f0f0', label: 'Event' };

const S = {
    wrap: {
        position: 'fixed' as const,
        top: 0,
        right: 0,
        bottom: 0,
        width: 460,
        display: 'flex',
        flexDirection: 'column' as const,
        fontFamily: 'Tahoma, Arial, sans-serif',
        fontSize: 11,
        background: '#ece9d8',
        border: '2px solid',
        borderColor: '#ffffff #808080 #808080 #ffffff',
        boxShadow: '-4px 0 12px rgba(0,0,0,0.35)',
        zIndex: 1050,
    },
    titleBar: {
        background: 'linear-gradient(180deg, #4d9be6 0%, #2b72c5 40%, #1a58aa 100%)',
        padding: '3px 6px 4px 8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        userSelect: 'none' as const,
        flexShrink: 0,
    },
    titleText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 12,
        fontFamily: 'Tahoma, Arial, sans-serif',
        textShadow: '1px 1px 1px rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
    },
    closeBtn: {
        width: 21,
        height: 21,
        background: 'linear-gradient(180deg, #f9a03b 0%, #e8700d 50%, #c85000 100%)',
        border: '1px solid',
        borderColor: '#ffd080 #7a3000 #7a3000 #ffd080',
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 10,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        lineHeight: 1,
        fontFamily: 'Tahoma, Arial, sans-serif',
    },
    toolbar: {
        background: '#ece9d8',
        borderBottom: '1px solid #808080',
        padding: '4px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
    },
    toolbarLabel: {
        color: '#000',
        fontSize: 11,
    },
    entityTag: {
        background: 'linear-gradient(180deg, #fff 0%, #ece9d8 100%)',
        border: '1px solid',
        borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
        padding: '0 6px',
        fontSize: 11,
        fontWeight: 'bold',
        color: '#1a4a8a',
        height: 20,
        display: 'inline-flex',
        alignItems: 'center',
    },
    columnHeader: {
        display: 'grid',
        gridTemplateColumns: '22px 130px 72px 1fr',
        gap: 0,
        background: 'linear-gradient(180deg, #f5f4ec 0%, #e0ddd0 100%)',
        borderBottom: '2px solid #808080',
        flexShrink: 0,
    },
    colCell: {
        padding: '3px 6px',
        fontWeight: 'bold',
        fontSize: 11,
        color: '#000',
        borderRight: '1px solid #b0aea0',
        whiteSpace: 'nowrap' as const,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
    listArea: {
        flex: 1,
        overflowY: 'auto' as const,
        background: '#fff',
        borderTop: '1px solid #dfdfdf',
    },
    row: (selected: boolean, idx: number): React.CSSProperties => ({
        display: 'grid',
        gridTemplateColumns: '22px 130px 72px 1fr',
        gap: 0,
        background: selected ? '#316ac5' : idx % 2 === 0 ? '#ffffff' : '#f5f4ec',
        borderBottom: '1px solid #e0ddd0',
        cursor: 'pointer',
        minHeight: 20,
    }),
    rowCell: (selected: boolean): React.CSSProperties => ({
        padding: '2px 6px',
        fontSize: 11,
        color: selected ? '#fff' : '#000',
        borderRight: selected ? '1px solid #5080c8' : '1px solid #e0ddd0',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap' as const,
        display: 'flex',
        alignItems: 'center',
    }),
    iconDot: (meta: typeof DEFAULT_META, selected: boolean): React.CSSProperties => ({
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: selected ? '#fff' : meta.color,
        flexShrink: 0,
        margin: 'auto',
        boxShadow: selected ? 'none' : `0 0 0 1px ${meta.color}44`,
    }),
    detailPanel: {
        flexShrink: 0,
        background: '#ece9d8',
        borderTop: '2px solid #808080',
        display: 'flex',
        flexDirection: 'column' as const,
    },
    detailHeader: {
        background: 'linear-gradient(180deg, #f5f4ec 0%, #e0ddd0 100%)',
        borderBottom: '1px solid #b0aea0',
        padding: '3px 8px',
        fontWeight: 'bold',
        fontSize: 11,
        color: '#000',
        flexShrink: 0,
    },
    detailBody: {
        padding: '6px 8px',
        overflowY: 'auto' as const,
        maxHeight: 190,
        fontSize: 11,
        color: '#000',
    },
    sunken: {
        background: '#fff',
        border: '1px solid',
        borderColor: '#808080 #dfdfdf #dfdfdf #808080',
        padding: '4px 6px',
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: 10,
        marginTop: 4,
        overflowX: 'auto' as const,
    },
    statusBar: {
        background: '#ece9d8',
        borderTop: '1px solid #808080',
        padding: '2px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
    },
    statusSegment: {
        border: '1px solid',
        borderColor: '#808080 #dfdfdf #dfdfdf #808080',
        padding: '1px 6px',
        fontSize: 11,
        color: '#000',
    },
    emptyState: {
        textAlign: 'center' as const,
        padding: '32px 16px',
        color: '#808080',
        fontSize: 11,
    },
    spinner: {
        width: 16,
        height: 16,
        border: '2px solid #d4d0c8',
        borderTop: '2px solid #316ac5',
        borderRadius: '50%',
        animation: 'xp-spin 0.8s linear infinite',
    },
};

export default function HistoryPane({ entityType, entityId, onClose }: HistoryPaneProps) {
    const { t } = useLanguage();
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';

    useEffect(() => {
        const fetchHistory = async () => {
            setLoading(true);
            try {
                const token = localStorage.getItem('access_token');
                const res = await fetch(`${API_BASE}/audit-logs?entity_type=${entityType}&entity_id=${entityId}&limit=50`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setLogs(data.items);
                    if (data.items.length > 0) setSelectedIdx(0);
                }
            } catch (e) {
                console.error('Failed to fetch entity history', e);
            } finally {
                setLoading(false);
            }
        };
        if (entityId) fetchHistory();
    }, [entityId, entityType]);

    const selected = selectedIdx !== null ? logs[selectedIdx] : null;

    const renderChangeDetail = (changes: any) => {
        if (!changes || typeof changes !== 'object') return null;
        const entries = Object.entries(changes);
        if (entries.length === 0) return null;
        return (
            <div style={S.sunken}>
                {entries.map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 1 }}>
                        <span style={{ color: '#1a4a8a', fontWeight: 'bold' }}>{k}</span>
                        <span style={{ color: '#808080' }}> = </span>
                        <span style={{ color: '#000' }}>{JSON.stringify(v)}</span>
                    </div>
                ))}
            </div>
        );
    };

    const fmt = (ts: string) => {
        const d = new Date(ts);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
            + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    return (
        <>
            <style>{`@keyframes xp-spin { to { transform: rotate(360deg); } }`}</style>
            <div style={S.wrap}>
                {/* Title bar */}
                <div style={S.titleBar}>
                    <span style={S.titleText}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="7" fill="#fff" fillOpacity="0.25" stroke="#fff" strokeWidth="1"/>
                            <path d="M8 4v4l3 2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                        Event Log — {entityType}
                    </span>
                    <button style={S.closeBtn} onClick={onClose} title="Close">✕</button>
                </div>

                {/* Toolbar */}
                <div style={S.toolbar}>
                    <span style={S.toolbarLabel}>Audit trail for:</span>
                    <span style={S.entityTag}>{entityType} #{entityId.slice(0, 8)}</span>
                    {!loading && <span style={{ ...S.toolbarLabel, marginLeft: 'auto', color: '#808080' }}>{logs.length} event{logs.length !== 1 ? 's' : ''}</span>}
                </div>

                {/* Column headers */}
                <div style={S.columnHeader}>
                    <div style={{ ...S.colCell, textAlign: 'center' as const, padding: '3px 0' }}> </div>
                    <div style={S.colCell}>Date / Time</div>
                    <div style={S.colCell}>Action</div>
                    <div style={{ ...S.colCell, borderRight: 'none' }}>Description</div>
                </div>

                {/* Event list */}
                <div style={S.listArea}>
                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80, gap: 8 }}>
                            <div style={S.spinner} />
                            <span style={{ fontSize: 11, color: '#808080' }}>Loading events…</span>
                        </div>
                    ) : logs.length === 0 ? (
                        <div style={S.emptyState}>
                            <div style={{ fontSize: 24, marginBottom: 6 }}>📋</div>
                            No events recorded for this record.
                        </div>
                    ) : (
                        logs.map((log, idx) => {
                            const meta = ACTION_META[log.action] ?? DEFAULT_META;
                            const sel = idx === selectedIdx;
                            return (
                                <div
                                    key={log.id}
                                    style={S.row(sel, idx)}
                                    onClick={() => setSelectedIdx(idx === selectedIdx ? null : idx)}
                                >
                                    <div style={{ ...S.rowCell(sel), justifyContent: 'center', padding: '2px 0' }}>
                                        <div style={S.iconDot(meta, sel)} />
                                    </div>
                                    <div style={S.rowCell(sel)}>{fmt(log.timestamp)}</div>
                                    <div style={S.rowCell(sel)}>{meta.label}</div>
                                    <div style={{ ...S.rowCell(sel), borderRight: 'none' }}>
                                        {log.details || 'System activity'}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Detail panel */}
                <div style={S.detailPanel}>
                    <div style={S.detailHeader}>Event Detail</div>
                    <div style={S.detailBody}>
                        {selected ? (
                            <>
                                <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', rowGap: 3 }}>
                                    <span style={{ color: '#808080' }}>Date:</span>
                                    <span>{fmt(selected.timestamp)}</span>
                                    <span style={{ color: '#808080' }}>Action:</span>
                                    <span style={{ color: (ACTION_META[selected.action] ?? DEFAULT_META).color, fontWeight: 'bold' }}>
                                        {(ACTION_META[selected.action] ?? DEFAULT_META).label}
                                    </span>
                                    <span style={{ color: '#808080' }}>Description:</span>
                                    <span>{selected.details || 'System activity'}</span>
                                    <span style={{ color: '#808080' }}>Performed by:</span>
                                    <span>{selected.user_id ? `User #${selected.user_id}` : 'System'}</span>
                                </div>
                                {renderChangeDetail(selected.changes)}
                            </>
                        ) : (
                            <span style={{ color: '#808080', fontStyle: 'italic' }}>
                                {logs.length > 0 ? 'Select an event to view details.' : 'No events to display.'}
                            </span>
                        )}
                    </div>
                </div>

                {/* Status bar */}
                <div style={S.statusBar}>
                    <span style={S.statusSegment}>
                        {selectedIdx !== null ? `Event ${selectedIdx + 1} of ${logs.length}` : `${logs.length} event${logs.length !== 1 ? 's' : ''}`}
                    </span>
                    <span style={{ ...S.statusSegment, color: '#808080', fontStyle: 'italic' }}>
                        Tracking since system init
                    </span>
                </div>
            </div>
        </>
    );
}
