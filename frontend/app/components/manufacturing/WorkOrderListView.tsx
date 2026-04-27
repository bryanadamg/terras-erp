'use client';
import React, { useState, useMemo } from 'react';
import { useTheme } from '../../context/ThemeContext';

const STATUS_COLORS: Record<string, string> = {
    PENDING: '#888',
    IN_PROGRESS: '#0058e6',
    COMPLETED: '#008000',
    CANCELLED: '#a00',
};

const STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

interface Props {
    manufacturingOrders: any[];
    workCenters: any[];
    onUpdate: (id: string, payload: any) => Promise<any>;
    onUpdateStatus: (id: string, status: string) => Promise<any>;
    onDelete: (id: string) => Promise<any>;
}

interface FlatWO {
    id: string;
    sequence: number;
    name: string;
    work_center_id?: string;
    work_center_name?: string;
    status: string;
    planned_duration_hours?: number;
    actual_duration_hours?: number;
    actual_start_date?: string;
    actual_end_date?: string;
    mo_id: string;
    mo_code: string;
    item_name: string;
}

export default function WorkOrderListView({ manufacturingOrders, workCenters, onUpdate, onUpdateStatus, onDelete }: Props) {
    const { uiStyle } = useTheme();
    const classic = uiStyle === 'classic';

    const [editId, setEditId] = useState<string | null>(null);
    const [form, setForm] = useState({ sequence: '', name: '', work_center_id: '', planned_duration_hours: '' });
    const [isSaving, setIsSaving] = useState(false);
    const [filterStatus, setFilterStatus] = useState('');
    const [filterWC, setFilterWC] = useState('');
    const [filterMO, setFilterMO] = useState('');

    const flatWOs = useMemo<FlatWO[]>(() => {
        const result: FlatWO[] = [];
        for (const mo of manufacturingOrders) {
            for (const wo of (mo.work_orders || [])) {
                result.push({
                    ...wo,
                    mo_id: mo.id,
                    mo_code: mo.code,
                    item_name: mo.item_name || '',
                });
            }
        }
        result.sort((a, b) => a.mo_code.localeCompare(b.mo_code) || a.sequence - b.sequence);
        return result;
    }, [manufacturingOrders]);

    const filtered = useMemo(() => flatWOs.filter(wo => {
        if (filterStatus && wo.status !== filterStatus) return false;
        if (filterWC && wo.work_center_id !== filterWC) return false;
        if (filterMO && wo.mo_id !== filterMO) return false;
        return true;
    }), [flatWOs, filterStatus, filterWC, filterMO]);

    const startEdit = (wo: FlatWO) => {
        setEditId(wo.id);
        setForm({
            sequence: String(wo.sequence),
            name: wo.name,
            work_center_id: wo.work_center_id || '',
            planned_duration_hours: wo.planned_duration_hours != null ? String(wo.planned_duration_hours) : '',
        });
    };

    const handleSave = async (wo: FlatWO) => {
        if (!form.name.trim()) return;
        setIsSaving(true);
        try {
            await onUpdate(wo.id, {
                manufacturing_order_id: wo.mo_id,
                sequence: parseInt(form.sequence) || wo.sequence,
                name: form.name.trim(),
                work_center_id: form.work_center_id || undefined,
                planned_duration_hours: form.planned_duration_hours ? parseFloat(form.planned_duration_hours) : undefined,
            });
            setEditId(null);
        } finally {
            setIsSaving(false);
        }
    };

    const xpInput: React.CSSProperties = {
        fontFamily: 'Tahoma, "Segoe UI", sans-serif', fontSize: 11,
        border: '1px solid #7f9db9', background: 'white', height: 20, padding: '0 4px', outline: 'none',
    };

    const statusChip = (status: string) => {
        if (!classic) return <span className={`badge extra-small ${
            status === 'COMPLETED' ? 'bg-success' :
            status === 'IN_PROGRESS' ? 'bg-warning text-dark' :
            status === 'CANCELLED' ? 'bg-danger' : 'bg-secondary'
        }`}>{status.replace('_', ' ')}</span>;

        const chipStyle: React.CSSProperties = {
            display: 'inline-block', fontSize: 9, fontWeight: 'bold',
            padding: '1px 6px', borderRadius: 0, border: '1px solid',
            fontFamily: 'Tahoma, Arial, sans-serif',
        };
        switch (status) {
            case 'COMPLETED':  return <span style={{ ...chipStyle, background: '#2d7a2d', borderColor: '#1a5e1a', color: '#fff' }}>COMPLETED</span>;
            case 'IN_PROGRESS': return <span style={{ ...chipStyle, background: '#0058e6', borderColor: '#003080', color: '#fff' }}>IN PROGRESS</span>;
            case 'CANCELLED':  return <span style={{ ...chipStyle, background: '#c00000', borderColor: '#800000', color: '#fff' }}>CANCELLED</span>;
            default:           return <span style={{ ...chipStyle, background: '#d4d0c8', borderColor: '#808080', color: '#333' }}>PENDING</span>;
        }
    };

    const formatDateTime = (d?: string) => d ? new Date(d).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—';

    const moOptions = useMemo(() =>
        manufacturingOrders.map(mo => ({ id: mo.id, label: `${mo.code} — ${mo.item_name || ''}` })),
        [manufacturingOrders]
    );

    const containerStyle: React.CSSProperties = classic ? {
        border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
        background: '#ece9d8', fontFamily: 'Tahoma, Arial, sans-serif',
    } : {};

    const titleBarStyle: React.CSSProperties = classic ? {
        background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)',
        borderBottom: '1px solid #003080',
        padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8,
    } : {
        background: '#fff', borderBottom: '1px solid #dee2e6',
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8,
    };

    const filterBarStyle: React.CSSProperties = classic ? {
        background: '#d4d0c8', borderBottom: '1px solid #808080',
        padding: '4px 8px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
    } : {
        background: '#f8f9fa', borderBottom: '1px solid #dee2e6',
        padding: '6px 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
    };

    const thStyle: React.CSSProperties = classic ? {
        border: '1px solid #808080', padding: '3px 8px', color: '#000', fontWeight: 'bold',
        background: 'linear-gradient(to bottom,#fff 0%,#d4d0c8 100%)', fontSize: 10, whiteSpace: 'nowrap',
    } : { fontSize: '9pt', fontWeight: 'bold', whiteSpace: 'nowrap' };

    const tdBase: React.CSSProperties = classic ? {
        border: '1px solid #c0bdb5', padding: '3px 8px', color: '#000', verticalAlign: 'middle',
    } : { verticalAlign: 'middle' };

    return (
        <div className="row g-4 fade-in">
            <div className="col-12">
                <div style={containerStyle} className={classic ? '' : 'card h-100 border-0 shadow-sm'}>

                    {/* Title bar */}
                    <div style={titleBarStyle}>
                        <i className="bi bi-list-task" style={{ color: classic ? '#fff' : '#000', fontSize: 14 }}></i>
                        <span style={{ fontWeight: 'bold', fontSize: classic ? 12 : 14, color: classic ? '#fff' : '#000', textShadow: classic ? '1px 1px 1px rgba(0,0,0,0.4)' : undefined }}>
                            Work Orders
                        </span>
                        <span style={{ fontSize: classic ? 10 : 11, color: classic ? '#cce0ff' : '#888', marginLeft: 4 }}>
                            {filtered.length} of {flatWOs.length} steps
                        </span>
                    </div>

                    {/* Filter bar */}
                    <div style={filterBarStyle}>
                        <label style={{ fontSize: classic ? 10 : 11, color: classic ? '#000' : '#555', whiteSpace: 'nowrap' }}>Filter:</label>

                        <select
                            value={filterStatus}
                            onChange={e => setFilterStatus(e.target.value)}
                            style={classic ? { ...xpInput, width: 110 } : { width: 130 }}
                            className={classic ? '' : 'form-select form-select-sm'}
                        >
                            <option value="">All Statuses</option>
                            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                        </select>

                        <select
                            value={filterWC}
                            onChange={e => setFilterWC(e.target.value)}
                            style={classic ? { ...xpInput, width: 130 } : { width: 150 }}
                            className={classic ? '' : 'form-select form-select-sm'}
                        >
                            <option value="">All Work Centers</option>
                            {workCenters.map((wc: any) => <option key={wc.id} value={wc.id}>{wc.name}</option>)}
                        </select>

                        <select
                            value={filterMO}
                            onChange={e => setFilterMO(e.target.value)}
                            style={classic ? { ...xpInput, width: 160 } : { width: 180 }}
                            className={classic ? '' : 'form-select form-select-sm'}
                        >
                            <option value="">All MOs</option>
                            {moOptions.map(mo => <option key={mo.id} value={mo.id}>{mo.label}</option>)}
                        </select>

                        {(filterStatus || filterWC || filterMO) && (
                            <button
                                onClick={() => { setFilterStatus(''); setFilterWC(''); setFilterMO(''); }}
                                style={classic ? { ...xpInput, width: 'auto', cursor: 'pointer', height: 20 } : undefined}
                                className={classic ? '' : 'btn btn-sm btn-outline-secondary'}
                            >
                                Clear
                            </button>
                        )}
                    </div>

                    {/* Table */}
                    <div className="table-responsive" style={{ background: classic ? '#fff' : undefined }}>
                        <table
                            style={{ width: '100%', borderCollapse: 'collapse', fontSize: classic ? 11 : undefined, fontFamily: classic ? 'Tahoma, Arial, sans-serif' : undefined, background: classic ? '#fff' : undefined }}
                            className={classic ? '' : 'table table-hover align-middle mb-0'}
                        >
                            <thead>
                                <tr className={classic ? '' : 'table-light'}>
                                    {['#', 'Name', 'MO', 'Product', 'Work Center', 'Planned', 'Actual', 'Start', 'End', 'Status', ''].map(h => (
                                        <th key={h} style={{ ...thStyle, textAlign: h === '' ? 'right' : 'left' }}
                                            className={classic ? '' : 'ps-3'}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={11} style={{ padding: 24, textAlign: 'center', color: '#888', fontSize: classic ? 11 : undefined }}>
                                            No work orders found.
                                        </td>
                                    </tr>
                                )}
                                {filtered.map((wo, idx) => {
                                    const rowBg = classic ? (idx % 2 === 0 ? '#fff' : '#f5f3ee') : undefined;
                                    const isEditing = editId === wo.id;

                                    if (isEditing) {
                                        return (
                                            <tr key={wo.id} style={{ background: classic ? '#fffbe6' : undefined }}
                                                className={classic ? '' : 'table-warning'}>
                                                <td style={tdBase} className={classic ? '' : 'ps-3'}>
                                                    <input style={{ ...xpInput, width: 32 }} value={form.sequence}
                                                        onChange={e => setForm(f => ({ ...f, sequence: e.target.value }))} />
                                                </td>
                                                <td style={tdBase}>
                                                    <input style={{ ...xpInput, width: '100%', minWidth: 140 }} value={form.name} autoFocus
                                                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                                        onKeyDown={e => { if (e.key === 'Enter') handleSave(wo); if (e.key === 'Escape') setEditId(null); }}
                                                    />
                                                </td>
                                                <td style={tdBase} colSpan={2}>
                                                    <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#555' }}>{wo.mo_code}</span>
                                                </td>
                                                <td style={tdBase}>
                                                    <select style={{ ...xpInput, width: '100%' }} value={form.work_center_id}
                                                        onChange={e => setForm(f => ({ ...f, work_center_id: e.target.value }))}>
                                                        <option value="">—</option>
                                                        {workCenters.map((wc: any) => <option key={wc.id} value={wc.id}>{wc.name}</option>)}
                                                    </select>
                                                </td>
                                                <td style={tdBase}>
                                                    <input type="number" min="0" step="0.5" style={{ ...xpInput, width: 56 }}
                                                        value={form.planned_duration_hours}
                                                        onChange={e => setForm(f => ({ ...f, planned_duration_hours: e.target.value }))} />
                                                </td>
                                                <td style={tdBase} colSpan={3} />
                                                <td style={tdBase} />
                                                <td style={{ ...tdBase, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                    <button onClick={() => handleSave(wo)} disabled={isSaving}
                                                        style={classic ? { fontFamily: 'Tahoma', fontSize: 10, padding: '1px 8px', background: 'linear-gradient(to bottom,#b0e8b0,#70c870)', border: '1px solid #0a3e0a', cursor: 'pointer', marginRight: 4 } : undefined}
                                                        className={classic ? '' : 'btn btn-sm btn-success me-1'}>
                                                        {isSaving ? '...' : 'Save'}
                                                    </button>
                                                    <button onClick={() => setEditId(null)}
                                                        style={classic ? { fontFamily: 'Tahoma', fontSize: 10, padding: '1px 6px', background: 'linear-gradient(to bottom,#f0efe6,#dddbd0)', border: '1px solid #808080', cursor: 'pointer' } : undefined}
                                                        className={classic ? '' : 'btn btn-sm btn-outline-secondary'}>
                                                        Cancel
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    }

                                    return (
                                        <tr key={wo.id} style={{ background: rowBg }}>
                                            <td style={{ ...tdBase, color: '#888', width: 36 }} className={classic ? '' : 'ps-3'}>{wo.sequence}</td>
                                            <td style={{ ...tdBase, fontWeight: 500 }}>{wo.name}</td>
                                            <td style={{ ...tdBase, fontFamily: 'monospace', fontSize: classic ? 10 : 11, whiteSpace: 'nowrap' }}>{wo.mo_code}</td>
                                            <td style={{ ...tdBase, fontSize: classic ? 10 : 11, color: '#444' }}>{wo.item_name || '—'}</td>
                                            <td style={{ ...tdBase, fontSize: classic ? 10 : 11, color: '#555' }}>{wo.work_center_name || '—'}</td>
                                            <td style={{ ...tdBase, fontSize: classic ? 10 : 11 }}>{wo.planned_duration_hours != null ? `${wo.planned_duration_hours}h` : '—'}</td>
                                            <td style={{ ...tdBase, fontSize: classic ? 10 : 11 }}>{wo.actual_duration_hours != null ? `${wo.actual_duration_hours}h` : '—'}</td>
                                            <td style={{ ...tdBase, fontSize: classic ? 10 : 11 }}>{formatDateTime(wo.actual_start_date)}</td>
                                            <td style={{ ...tdBase, fontSize: classic ? 10 : 11 }}>{formatDateTime(wo.actual_end_date)}</td>
                                            <td style={tdBase}>
                                                {classic ? (
                                                    <select
                                                        value={wo.status}
                                                        onChange={e => onUpdateStatus(wo.id, e.target.value)}
                                                        style={{ fontFamily: 'Tahoma', fontSize: 10, border: '1px solid #aca899', background: '#ece9d8', color: STATUS_COLORS[wo.status] || '#000', height: 18, padding: '0 2px' }}
                                                    >
                                                        {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                                                    </select>
                                                ) : (
                                                    statusChip(wo.status)
                                                )}
                                            </td>
                                            <td style={{ ...tdBase, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                {classic ? (
                                                    <>
                                                        <button onClick={() => startEdit(wo)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#0058e6', marginRight: 4 }}>
                                                            <i className="bi bi-pencil" />
                                                        </button>
                                                        <button onClick={() => onDelete(wo.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#a00' }}>
                                                            <i className="bi bi-trash" />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        {wo.status === 'PENDING' && (
                                                            <button className="btn btn-sm btn-primary py-0 px-2 me-1" style={{ fontSize: '0.72rem' }} onClick={() => onUpdateStatus(wo.id, 'IN_PROGRESS')}>Start</button>
                                                        )}
                                                        {wo.status === 'IN_PROGRESS' && (
                                                            <button className="btn btn-sm btn-success py-0 px-2 me-1" style={{ fontSize: '0.72rem' }} onClick={() => onUpdateStatus(wo.id, 'COMPLETED')}>Finish</button>
                                                        )}
                                                        <button className="btn btn-sm btn-link text-primary p-0 me-1" onClick={() => startEdit(wo)}><i className="bi bi-pencil fs-6" /></button>
                                                        <button className="btn btn-sm btn-link text-danger p-0" onClick={() => onDelete(wo.id)}><i className="bi bi-trash fs-6" /></button>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
