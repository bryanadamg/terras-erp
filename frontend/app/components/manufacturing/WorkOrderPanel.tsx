'use client';
import React, { useState } from 'react';

const xpFont = 'Tahoma, "Segoe UI", sans-serif';
const xpInput: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11, border: '1px solid #7f9db9',
    background: 'white', height: 20, padding: '0 4px', outline: 'none',
};

const STATUS_COLORS: Record<string, string> = {
    PENDING: '#888',
    IN_PROGRESS: '#0058e6',
    COMPLETED: '#008000',
    CANCELLED: '#a00',
};

interface WO {
    id: string;
    sequence: number;
    name: string;
    work_center_name?: string;
    work_center_id?: string;
    status: string;
    planned_duration_hours?: number;
    actual_duration_hours?: number;
    notes?: string;
}

interface Props {
    manufacturingOrderId: string;
    workOrders: WO[];
    workCenters: any[];
    onAdd: (payload: any) => Promise<any>;
    onUpdate: (id: string, payload: any) => Promise<any>;
    onUpdateStatus: (id: string, status: string) => Promise<any>;
    onDelete: (id: string) => Promise<any>;
}

export default function WorkOrderPanel({
    manufacturingOrderId, workOrders, workCenters,
    onAdd, onUpdate, onUpdateStatus, onDelete,
}: Props) {
    const [addingRow, setAddingRow] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [form, setForm] = useState({ sequence: '', name: '', work_center_id: '', planned_duration_hours: '' });
    const [isSaving, setIsSaving] = useState(false);

    const resetForm = () => {
        setForm({ sequence: '', name: '', work_center_id: '', planned_duration_hours: '' });
        setAddingRow(false);
        setEditId(null);
    };

    const handleSave = async () => {
        if (!form.name.trim()) return;
        setIsSaving(true);
        try {
            const payload = {
                manufacturing_order_id: manufacturingOrderId,
                sequence: parseInt(form.sequence) || (workOrders.length + 1),
                name: form.name.trim(),
                work_center_id: form.work_center_id || undefined,
                planned_duration_hours: form.planned_duration_hours ? parseFloat(form.planned_duration_hours) : undefined,
            };
            if (editId) {
                await onUpdate(editId, payload);
            } else {
                await onAdd(payload);
            }
            resetForm();
        } finally {
            setIsSaving(false);
        }
    };

    const startEdit = (wo: WO) => {
        setEditId(wo.id);
        setForm({
            sequence: String(wo.sequence),
            name: wo.name,
            work_center_id: wo.work_center_id || '',
            planned_duration_hours: wo.planned_duration_hours ? String(wo.planned_duration_hours) : '',
        });
        setAddingRow(false);
    };

    return (
        <div style={{ fontFamily: xpFont, fontSize: 11 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontWeight: 'bold', fontSize: 11, color: '#000080' }}>Work Orders (Operation Steps)</span>
                {!addingRow && !editId && (
                    <button
                        onClick={() => { setAddingRow(true); setEditId(null); }}
                        style={{ fontFamily: xpFont, fontSize: 10, padding: '1px 8px', background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', cursor: 'pointer' }}
                    >
                        + Add Step
                    </button>
                )}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                    <tr style={{ background: 'linear-gradient(to bottom, #ece9d8, #d4d0c8)', borderBottom: '1px solid #aca899' }}>
                        <th style={{ padding: '2px 6px', textAlign: 'left', width: 40 }}>#</th>
                        <th style={{ padding: '2px 6px', textAlign: 'left' }}>Name</th>
                        <th style={{ padding: '2px 6px', textAlign: 'left', width: 110 }}>Work Center</th>
                        <th style={{ padding: '2px 6px', textAlign: 'left', width: 80 }}>Planned hrs</th>
                        <th style={{ padding: '2px 6px', textAlign: 'left', width: 80 }}>Status</th>
                        <th style={{ padding: '2px 6px', width: 70 }} />
                    </tr>
                </thead>
                <tbody>
                    {workOrders.map(wo => (
                        editId === wo.id ? (
                            <tr key={wo.id} style={{ background: '#fffbe6' }}>
                                <td style={{ padding: '2px 4px' }}>
                                    <input style={{ ...xpInput, width: 32 }} value={form.sequence} onChange={e => setForm(f => ({ ...f, sequence: e.target.value }))} />
                                </td>
                                <td style={{ padding: '2px 4px' }}>
                                    <input style={{ ...xpInput, width: '100%' }} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
                                </td>
                                <td style={{ padding: '2px 4px' }}>
                                    <select style={{ ...xpInput, width: '100%' }} value={form.work_center_id} onChange={e => setForm(f => ({ ...f, work_center_id: e.target.value }))}>
                                        <option value="">—</option>
                                        {workCenters.map((wc: any) => <option key={wc.id} value={wc.id}>{wc.name}</option>)}
                                    </select>
                                </td>
                                <td style={{ padding: '2px 4px' }}>
                                    <input type="number" min="0" step="0.5" style={{ ...xpInput, width: 56 }} value={form.planned_duration_hours} onChange={e => setForm(f => ({ ...f, planned_duration_hours: e.target.value }))} />
                                </td>
                                <td />
                                <td style={{ padding: '2px 4px', whiteSpace: 'nowrap' }}>
                                    <button onClick={handleSave} disabled={isSaving} style={{ fontFamily: xpFont, fontSize: 10, padding: '1px 6px', background: 'linear-gradient(to bottom, #b0e8b0, #70c870)', border: '1px solid #0a3e0a', cursor: 'pointer', marginRight: 2 }}>Save</button>
                                    <button onClick={resetForm} style={{ fontFamily: xpFont, fontSize: 10, padding: '1px 6px', background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)', border: '1px solid #808080', cursor: 'pointer' }}>Cancel</button>
                                </td>
                            </tr>
                        ) : (
                            <tr key={wo.id} style={{ borderBottom: '1px solid #e4e1d8' }}>
                                <td style={{ padding: '2px 6px', color: '#888' }}>{wo.sequence}</td>
                                <td style={{ padding: '2px 6px', fontWeight: 500 }}>{wo.name}</td>
                                <td style={{ padding: '2px 6px', color: '#555', fontSize: 10 }}>{wo.work_center_name || '—'}</td>
                                <td style={{ padding: '2px 6px', fontSize: 10 }}>
                                    {wo.planned_duration_hours != null ? `${wo.planned_duration_hours}h` : '—'}
                                    {wo.actual_duration_hours != null ? ` / ${wo.actual_duration_hours}h actual` : ''}
                                </td>
                                <td style={{ padding: '2px 6px' }}>
                                    <select
                                        value={wo.status}
                                        onChange={e => onUpdateStatus(wo.id, e.target.value)}
                                        style={{ fontFamily: xpFont, fontSize: 10, border: '1px solid #aca899', background: '#ece9d8', color: STATUS_COLORS[wo.status] || '#000', height: 18, padding: '0 2px' }}
                                    >
                                        {['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(s => (
                                            <option key={s} value={s}>{s.replace('_', ' ')}</option>
                                        ))}
                                    </select>
                                </td>
                                <td style={{ padding: '2px 4px', whiteSpace: 'nowrap' }}>
                                    <button onClick={() => startEdit(wo)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#0058e6', marginRight: 4 }}>
                                        <i className="bi bi-pencil" />
                                    </button>
                                    <button onClick={() => onDelete(wo.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#a00' }}>
                                        <i className="bi bi-trash" />
                                    </button>
                                </td>
                            </tr>
                        )
                    ))}

                    {addingRow && (
                        <tr style={{ background: '#fffbe6' }}>
                            <td style={{ padding: '2px 4px' }}>
                                <input style={{ ...xpInput, width: 32 }} value={form.sequence} onChange={e => setForm(f => ({ ...f, sequence: e.target.value }))} placeholder={String(workOrders.length + 1)} />
                            </td>
                            <td style={{ padding: '2px 4px' }}>
                                <input style={{ ...xpInput, width: '100%' }} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Operation name" autoFocus />
                            </td>
                            <td style={{ padding: '2px 4px' }}>
                                <select style={{ ...xpInput, width: '100%' }} value={form.work_center_id} onChange={e => setForm(f => ({ ...f, work_center_id: e.target.value }))}>
                                    <option value="">—</option>
                                    {workCenters.map((wc: any) => <option key={wc.id} value={wc.id}>{wc.name}</option>)}
                                </select>
                            </td>
                            <td style={{ padding: '2px 4px' }}>
                                <input type="number" min="0" step="0.5" style={{ ...xpInput, width: 56 }} value={form.planned_duration_hours} onChange={e => setForm(f => ({ ...f, planned_duration_hours: e.target.value }))} placeholder="0" />
                            </td>
                            <td />
                            <td style={{ padding: '2px 4px', whiteSpace: 'nowrap' }}>
                                <button onClick={handleSave} disabled={isSaving} style={{ fontFamily: xpFont, fontSize: 10, padding: '1px 6px', background: 'linear-gradient(to bottom, #b0e8b0, #70c870)', border: '1px solid #0a3e0a', cursor: 'pointer', marginRight: 2 }}>Add</button>
                                <button onClick={resetForm} style={{ fontFamily: xpFont, fontSize: 10, padding: '1px 6px', background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)', border: '1px solid #808080', cursor: 'pointer' }}>Cancel</button>
                            </td>
                        </tr>
                    )}

                    {workOrders.length === 0 && !addingRow && (
                        <tr>
                            <td colSpan={6} style={{ padding: '6px 8px', color: '#888', fontStyle: 'italic', textAlign: 'center' }}>
                                No operation steps yet. Click + Add Step to add one.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
