'use client';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

const xpFont = 'Tahoma, "Segoe UI", sans-serif';
const xpInput: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11, border: '1px solid #7f9db9',
    background: 'white', height: 20, padding: '0 4px', outline: 'none', width: '100%',
    borderRadius: 0, boxSizing: 'border-box',
};
const xpLabel: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11, display: 'block', marginBottom: 2,
};

interface Props {
    bom?: any;
    boms: any[];
    locations: any[];
    onSave: (payload: any) => Promise<any>;
    onClose: () => void;
    initialSizes?: Record<string, string>;
    salesOrderId?: string;
}

export default function ProductionRunModal({ bom: initialBom, boms, locations, onSave, onClose, initialSizes, salesOrderId }: Props) {
    const [code, setCode] = useState('');
    const [selectedBom, setSelectedBom] = useState<any>(initialBom || null);
    const [locationCode, setLocationCode] = useState('');
    const [sourceLocationCode, setSourceLocationCode] = useState('');
    const [targetStart, setTargetStart] = useState('');
    const [targetEnd, setTargetEnd] = useState('');
    const [sizeQtys, setSizeQtys] = useState<Record<string, string>>(initialSizes || {});
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (selectedBom) {
            const item = selectedBom.item_name || selectedBom.item_code || 'ITEM';
            setCode(`PR-${item.toUpperCase().replace(/\s+/g, '-').slice(0, 12)}-001`);
        }
    }, [selectedBom]);

    useEffect(() => {
        if (initialSizes) setSizeQtys(initialSizes);
    }, [initialSizes]);

    const sizes = selectedBom?.sizes || [];

    const handleSave = async () => {
        if (!code || !selectedBom || !locationCode) {
            setError('Code, BOM, and Location are required.');
            return;
        }
        setError('');
        setIsSaving(true);
        try {
            const sizeEntries = sizes
                .filter((s: any) => parseFloat(sizeQtys[s.id] || '0') > 0)
                .map((s: any) => ({ bom_size_id: s.id, qty: parseFloat(sizeQtys[s.id]) }));

            const res = await onSave({
                code,
                bom_id: selectedBom.id,
                location_code: locationCode,
                source_location_code: sourceLocationCode || undefined,
                target_start_date: targetStart || undefined,
                target_end_date: targetEnd || undefined,
                sizes: sizeEntries,
                sales_order_id: salesOrderId || undefined,
            });
            if (res && !res.ok) {
                const err = await res.json().catch(() => ({}));
                setError(err.detail || 'Failed to create Production Run');
                return;
            }
            onClose();
        } catch (e: any) {
            setError(e.message || 'Failed to create Production Run');
        } finally {
            setIsSaving(false);
        }
    };

    return createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 520, background: '#ece9d8', border: '2px solid #0a246a', fontFamily: xpFont, borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ background: 'linear-gradient(to right, #0a246a, #a6caf0, #0a246a)', padding: '3px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 12, textShadow: '1px 1px 2px rgba(0,0,0,0.6)' }}>
                        New Production Run
                    </span>
                    <button onClick={onClose} style={{ width: 21, height: 21, background: 'linear-gradient(to bottom, #e06060, #b03030)', border: '1px solid #800', borderRadius: 2, cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 'bold' }}>x</button>
                </div>

                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', maxHeight: '80vh' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                            <label style={xpLabel}>Run Code</label>
                            <input style={xpInput} value={code} onChange={e => setCode(e.target.value)} />
                        </div>
                        <div style={{ flex: 2 }}>
                            <label style={xpLabel}>Product Recipe (BOM)</label>
                            <select style={{ ...xpInput, height: 20 }}
                                value={selectedBom?.id || ''}
                                onChange={e => setSelectedBom(boms.find((b: any) => b.id === e.target.value) || null)}
                                disabled={!!initialBom}
                            >
                                <option value="">-- Select a BOM --</option>
                                {boms.map((b: any) => (
                                    <option key={b.id} value={b.id}>[{b.code}]  {b.item_name || b.item_code}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                            <label style={xpLabel}>Output Location</label>
                            <select style={{ ...xpInput, height: 20 }} value={locationCode} onChange={e => setLocationCode(e.target.value)}>
                                <option value="">Select...</option>
                                {locations.map((l: any) => <option key={l.id} value={l.code}>{l.name}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={xpLabel}>Source Location</label>
                            <select style={{ ...xpInput, height: 20 }} value={sourceLocationCode} onChange={e => setSourceLocationCode(e.target.value)}>
                                <option value="">Same as output</option>
                                {locations.map((l: any) => <option key={l.id} value={l.code}>{l.name}</option>)}
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                            <label style={xpLabel}>Target Start</label>
                            <input type="date" style={xpInput} value={targetStart} onChange={e => setTargetStart(e.target.value)} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={xpLabel}>Target End</label>
                            <input type="date" style={xpInput} value={targetEnd} onChange={e => setTargetEnd(e.target.value)} />
                        </div>
                    </div>

                    {sizes.length > 0 && (
                        <div style={{ border: '1px solid #aca899', borderRadius: 3, padding: '10px 8px 8px', background: '#f5f4ee', position: 'relative' }}>
                            <span style={{ position: 'absolute', top: -8, left: 8, background: '#f5f4ee', padding: '0 4px', fontSize: 10, fontWeight: 'bold', color: '#000080' }}>
                                Production Qty per Size
                            </span>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6 }}>
                                {sizes.map((s: any) => (
                                    <div key={s.id}>
                                        <label style={{ ...xpLabel, fontWeight: 'bold', fontSize: 10 }}>
                                            {s.size_name || s.label || s.size?.name || `Size ${s.id.slice(0, 4)}`}
                                        </label>
                                        <input
                                            type="number" min="0" style={xpInput}
                                            placeholder="0"
                                            value={sizeQtys[s.id] || ''}
                                            onChange={e => setSizeQtys(prev => ({ ...prev, [s.id]: e.target.value }))}
                                        />
                                    </div>
                                ))}
                            </div>
                            <div style={{ fontSize: 9, color: '#666', marginTop: 4 }}>
                                Leave 0 to skip a size. One Manufacturing Order will be created per size with qty &gt; 0.
                            </div>
                        </div>
                    )}

                    {sizes.length === 0 && selectedBom && (
                        <div style={{ fontSize: 10, color: '#888', fontStyle: 'italic', padding: 4 }}>
                            This BOM has no size entries. A single Manufacturing Order will be created.
                        </div>
                    )}

                    {error && <div style={{ fontSize: 10, color: '#a00', background: '#fff0f0', border: '1px solid #f0a0a0', padding: '4px 8px' }}>{error}</div>}
                </div>

                <div style={{ borderTop: '1px solid #aca899', padding: '6px 10px', display: 'flex', justifyContent: 'flex-end', gap: 6, background: '#ece9d8' }}>
                    <button onClick={onClose} style={{ fontFamily: xpFont, fontSize: 11, padding: '2px 10px', background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', cursor: 'pointer' }}>
                        Cancel
                    </button>
                    <button onClick={handleSave} disabled={isSaving}
                        style={{ fontFamily: xpFont, fontSize: 11, padding: '2px 12px', background: 'linear-gradient(to bottom, #b0e8b0, #70c870)', border: '1px solid', borderColor: '#d0f0d0 #0a3e0a #0a3e0a #1a5e1a', cursor: 'pointer', fontWeight: 'bold', color: '#004000', opacity: isSaving ? 0.6 : 1 }}>
                        {isSaving ? 'Creating...' : 'Create Production Run'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
