'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '../../context/DataContext';
import { useToast } from '../shared/Toast';

const xpFont = 'Tahoma, "Segoe UI", sans-serif';
const xpInput: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11, border: '1px solid #7f9db9',
    background: 'white', height: 20, padding: '0 4px', outline: 'none', width: '100%',
    borderRadius: 0, boxSizing: 'border-box',
};
const xpLabel: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11, display: 'block', marginBottom: 2,
};
const xpBtn = (primary?: boolean): React.CSSProperties => primary ? {
    fontFamily: xpFont, fontSize: 11, padding: '2px 14px',
    background: 'linear-gradient(to bottom, #b0e8b0, #70c870)',
    border: '1px solid', borderColor: '#d0f0d0 #0a3e0a #0a3e0a #1a5e1a',
    cursor: 'pointer', fontWeight: 'bold', color: '#004000',
} : {
    fontFamily: xpFont, fontSize: 11, padding: '2px 10px',
    background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)',
    border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    cursor: 'pointer',
};

interface MOCompletionModalProps {
    mo: any;
    onClose: () => void;
    onSaved: (updatedMO: any) => void;
}

export default function MOCompletionModal({ mo, onClose, onSaved }: MOCompletionModalProps) {
    const { authFetch } = useData();
    const { showToast } = useToast();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const [qtyCompleted, setQtyCompleted] = useState('');
    const [operatorName, setOperatorName] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const totalCompleted = mo.qty_completed_total ?? 0;
    const target = mo.qty ?? 0;
    const remaining = Math.max(0, target - totalCompleted);
    const pct = target > 0 ? Math.min(100, Math.round((totalCompleted / target) * 100)) : 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const qty = parseFloat(qtyCompleted);
        if (!qty || qty <= 0) {
            showToast('Enter a positive quantity', 'danger');
            return;
        }
        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/manufacturing-orders/${mo.id}/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    qty_completed: qty,
                    operator_name: operatorName || null,
                    notes: notes || null,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to log completion');
            }
            const updated = await res.json();
            showToast(`Logged ${qty} — total ${(updated.qty_completed_total ?? 0).toFixed(2)} / ${target}`, 'success');
            onSaved(updated);
            onClose();
        } catch (err: any) {
            showToast(err.message, 'danger');
        } finally {
            setSubmitting(false);
        }
    };

    const completions = mo.completions ? [...mo.completions].reverse() : [];

    return createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 420, background: '#ece9d8', border: '2px solid #0a246a', fontFamily: xpFont, borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

                {/* Title bar */}
                <div style={{ background: 'linear-gradient(to right, #0a246a, #a6caf0, #0a246a)', padding: '3px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none' }}>
                    <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 12, textShadow: '1px 1px 2px rgba(0,0,0,0.6)' }}>
                        Log Completion — {mo.code}
                    </span>
                    <button onClick={onClose} style={{ width: 21, height: 21, background: 'linear-gradient(to bottom, #e06060, #b03030)', border: '1px solid #800', borderRadius: 2, cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 'bold', lineHeight: 1 }}>x</button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit}>
                    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

                        {/* Product info + progress */}
                        <div style={{ border: '1px solid #aca899', padding: '8px 10px', background: '#f5f4ee', display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                <span style={{ fontSize: 11, fontWeight: 'bold', color: '#000080' }}>{mo.item_name || mo.item_code}</span>
                                <span style={{ fontSize: 10, color: '#555' }}>{mo.code}</span>
                            </div>
                            {/* XP-style progress bar */}
                            <div style={{ border: '1px solid #7f9db9', height: 14, background: '#fff', position: 'relative', overflow: 'hidden' }}>
                                <div style={{
                                    height: '100%',
                                    width: `${pct}%`,
                                    background: pct >= 100
                                        ? 'repeating-linear-gradient(45deg, #2e7d32, #2e7d32 4px, #4caf50 4px, #4caf50 8px)'
                                        : 'repeating-linear-gradient(45deg, #000080, #000080 4px, #1565c0 4px, #1565c0 8px)',
                                    transition: 'width 0.2s',
                                }} />
                                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 'bold', color: pct > 50 ? '#fff' : '#000080', textShadow: pct > 50 ? '0 0 3px rgba(0,0,0,0.8)' : 'none' }}>
                                    {totalCompleted.toFixed(2)} / {target} ({pct}%)
                                </span>
                            </div>
                            <div style={{ fontSize: 10, color: '#555' }}>Remaining: <strong>{remaining.toFixed(2)}</strong></div>
                        </div>

                        {/* Entry fields */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div>
                                <label style={{ ...xpLabel, fontWeight: 'bold' }}>Qty Completed</label>
                                <input
                                    type="number"
                                    style={{ ...xpInput, fontSize: 13, height: 22 }}
                                    value={qtyCompleted}
                                    onChange={e => setQtyCompleted(e.target.value)}
                                    min="0.0001"
                                    step="any"
                                    placeholder={remaining > 0 ? remaining.toFixed(2) : String(target)}
                                    autoFocus
                                    required
                                />
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                    <label style={xpLabel}>Operator</label>
                                    <input type="text" style={xpInput} value={operatorName} onChange={e => setOperatorName(e.target.value)} placeholder="Name (optional)" />
                                </div>
                                <div style={{ flex: 2 }}>
                                    <label style={xpLabel}>Notes</label>
                                    <input type="text" style={xpInput} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Batch, shift, remarks..." />
                                </div>
                            </div>
                        </div>

                        {/* History */}
                        {completions.length > 0 && (
                            <div style={{ border: '1px solid #aca899', background: '#f5f4ee', position: 'relative', paddingTop: 10 }}>
                                <span style={{ position: 'absolute', top: -7, left: 8, background: '#f5f4ee', padding: '0 4px', fontSize: 10, fontWeight: 'bold', color: '#000080' }}>
                                    Previous Entries
                                </span>
                                <div style={{ maxHeight: 120, overflowY: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, fontFamily: xpFont }}>
                                        <thead>
                                            <tr style={{ background: '#dddbd0' }}>
                                                <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899' }}>Qty</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Operator</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Time</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {completions.map((c: any, i: number) => (
                                                <tr key={c.id} style={{ background: i % 2 === 0 ? '#fff' : '#f5f4ee' }}>
                                                    <td style={{ padding: '2px 6px', textAlign: 'right', fontWeight: 'bold' }}>{parseFloat(c.qty_completed).toFixed(2)}</td>
                                                    <td style={{ padding: '2px 6px', color: '#555' }}>{c.operator_name || '—'}</td>
                                                    <td style={{ padding: '2px 6px', color: '#555' }}>{new Date(c.created_at).toLocaleString()}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div style={{ borderTop: '1px solid #aca899', padding: '6px 10px', display: 'flex', justifyContent: 'flex-end', gap: 6, background: '#ece9d8' }}>
                        <button type="button" onClick={onClose} style={xpBtn()}>Cancel</button>
                        <button type="submit" disabled={submitting} style={{ ...xpBtn(true), opacity: submitting ? 0.6 : 1 }}>
                            {submitting ? 'Saving...' : 'Log Completion'}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
