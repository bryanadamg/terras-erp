'use client';

import React, { useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../shared/Toast';

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

    return (
        <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1055 }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="modal-header py-2">
                        <h6 className="modal-title mb-0">Log Completion — {mo.code}</h6>
                        <button type="button" className="btn-close" onClick={onClose}></button>
                    </div>
                    <div className="modal-body">
                        <div className="mb-3">
                            <div className="d-flex justify-content-between extra-small text-muted mb-1">
                                <span>{mo.item_name || mo.item_code}</span>
                                <span>{totalCompleted.toFixed(2)} / {target} ({pct}%)</span>
                            </div>
                            <div className="progress" style={{ height: '8px' }}>
                                <div
                                    className={`progress-bar ${pct >= 100 ? 'bg-success' : 'bg-primary'}`}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            <div className="extra-small text-muted mt-1">Remaining: {remaining.toFixed(2)}</div>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div className="mb-2">
                                <label className="form-label form-label-sm mb-1">Qty Completed</label>
                                <input
                                    type="number"
                                    className="form-control form-control-sm"
                                    value={qtyCompleted}
                                    onChange={e => setQtyCompleted(e.target.value)}
                                    min="0.0001"
                                    step="any"
                                    placeholder={`e.g. ${remaining > 0 ? remaining.toFixed(2) : target}`}
                                    autoFocus
                                    required
                                />
                            </div>
                            <div className="mb-2">
                                <label className="form-label form-label-sm mb-1">Operator (optional)</label>
                                <input
                                    type="text"
                                    className="form-control form-control-sm"
                                    value={operatorName}
                                    onChange={e => setOperatorName(e.target.value)}
                                    placeholder="Name"
                                />
                            </div>
                            <div className="mb-3">
                                <label className="form-label form-label-sm mb-1">Notes (optional)</label>
                                <input
                                    type="text"
                                    className="form-control form-control-sm"
                                    value={notes}
                                    onChange={e => setNotes(e.target.value)}
                                    placeholder="Batch, shift, remarks..."
                                />
                            </div>
                            <div className="d-flex gap-2">
                                <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
                                    {submitting ? 'Saving...' : 'Log Completion'}
                                </button>
                                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onClose}>
                                    Cancel
                                </button>
                            </div>
                        </form>

                        {mo.completions && mo.completions.length > 0 && (
                            <div className="mt-3 border-top pt-2">
                                <div className="extra-small text-muted mb-1">Previous entries</div>
                                <table className="table table-sm extra-small mb-0">
                                    <thead>
                                        <tr>
                                            <th>Qty</th>
                                            <th>Operator</th>
                                            <th>Time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...mo.completions].reverse().map((c: any) => (
                                            <tr key={c.id}>
                                                <td>{parseFloat(c.qty_completed).toFixed(2)}</td>
                                                <td>{c.operator_name || '—'}</td>
                                                <td>{new Date(c.created_at).toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
