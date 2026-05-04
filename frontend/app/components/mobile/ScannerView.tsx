'use client';

import { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

interface MobileScannerViewProps {
    manufacturingOrders: any[];
    items: any[];
    boms: any[];
    locations: any[];
    stockBalance: any[];
    workCenters: any[];
    authFetch: (url: string, options?: any) => Promise<Response>;
    onRefresh: () => Promise<void> | void;
    onClose: () => void;
}

const XP_BEIGE = '#ece9d8';
const XP_FONT  = 'Tahoma, "Segoe UI", Arial, sans-serif';

const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily: XP_FONT, fontSize: 13, padding: '6px 14px', cursor: 'pointer',
    background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
    border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    color: '#000000', borderRadius: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
    ...extra,
});

const xpInset: React.CSSProperties = {
    border: '2px solid', borderColor: '#808080 #dfdfdf #dfdfdf #808080',
    background: '#ffffff', borderRadius: 0,
};

const xpPanel: React.CSSProperties = {
    border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    background: '#f5f4ef', borderRadius: 0, padding: '10px 12px',
};

const xpSectionLabel: React.CSSProperties = {
    fontFamily: XP_FONT, fontSize: 10, fontWeight: 'bold',
    textTransform: 'uppercase', letterSpacing: 0.5, color: '#555',
    borderBottom: '1px solid #c0bdb5', paddingBottom: 3, marginBottom: 8,
};

const xpStatusBadge = (status: string): React.CSSProperties => {
    const base: React.CSSProperties = {
        fontFamily: XP_FONT, fontSize: 10, fontWeight: 'bold',
        padding: '2px 8px', display: 'inline-block',
    };
    if (status === 'COMPLETED')   return { ...base, background: '#2e7d32', color: '#fff' };
    if (status === 'IN_PROGRESS') return { ...base, background: '#1a4a8a', color: '#fff' };
    if (status === 'CANCELLED')   return { ...base, background: '#666',    color: '#fff' };
    return { ...base, background: '#b8860b', color: '#fff' };
};

export default function MobileScannerView({
    manufacturingOrders, items, boms, locations, stockBalance,
    workCenters, authFetch, onRefresh, onClose,
}: MobileScannerViewProps) {
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const [scannedMOId, setScannedMOId]     = useState<string | null>(null);
    const [error, setError]                 = useState<string | null>(null);
    const [manualCode, setManualCode]       = useState('');
    const [updatingRunId, setUpdatingRunId] = useState<string | null>(null);
    const [addingRun, setAddingRun]         = useState(false);
    const [runWcId, setRunWcId]             = useState('');
    const [runQty, setRunQty]               = useState('');
    const [submittingRun, setSubmittingRun] = useState(false);
    const scannerRef = useRef<Html5QrcodeScanner | null>(null);
    const terminalId = useRef(Math.random().toString(36).substr(2, 6).toUpperCase());

    // Derive reactively — auto-updates when manufacturingOrders prop refreshes
    const scannedMO = scannedMOId ? (manufacturingOrders.find((mo: any) => mo.id === scannedMOId) || null) : null;

    const getItemName     = (id: string) => items.find((i: any) => i.id === id)?.name || id;
    const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || id;

    const getRuns       = (mo: any) => (mo.work_orders || []).filter((wo: any) => wo.qty != null);
    const getRunQtySum  = (mo: any) => getRuns(mo).reduce((s: number, wo: any) => s + parseFloat(wo.qty || 0), 0);
    const getToleranceMax = (mo: any) => {
        const bom = mo.bom || boms.find((b: any) => b.id === mo.bom_id);
        const tol = parseFloat(bom?.tolerance_percentage || 0);
        return mo.qty * (1 + tol / 100);
    };
    const getRemaining  = (mo: any) => Math.max(0, mo.qty - getRunQtySum(mo));

    const validateMaterials = (mo: any) => {
        const bom = mo.bom || boms.find((b: any) => b.id === mo.bom_id);
        if (!bom) return { ok: true, missing: [] as any[] };
        const missing: any[] = [];
        for (const line of (bom.lines || [])) {
            let required = mo.qty * parseFloat(line.qty);
            if (parseFloat(line.percentage) > 0) required = (mo.qty * parseFloat(line.percentage)) / 100;
            const tol = parseFloat(bom.tolerance_percentage || 0);
            if (tol > 0) required *= (1 + tol / 100);
            const checkLocId = line.source_location_id || mo.source_location_id || mo.location_id;
            const targetIds = line.attribute_value_ids || [];
            const matching = stockBalance.filter((s: any) =>
                s.item_id === line.item_id && s.location_id === checkLocId &&
                (s.attribute_value_ids || []).length === targetIds.length &&
                (s.attribute_value_ids || []).every((id: string) => targetIds.includes(id))
            );
            const available = matching.reduce((sum: number, e: any) => sum + parseFloat(e.qty), 0);
            if (available < required) missing.push({ name: getItemName(line.item_id), location: getLocationName(checkLocId) });
        }
        return { ok: missing.length === 0, missing };
    };

    // Scanner lifecycle
    useEffect(() => {
        if (scannedMOId) return;

        const timer = setTimeout(() => {
            if (!document.getElementById('mobile-reader')) return;
            const scanner = new Html5QrcodeScanner('mobile-reader', { fps: 10, qrbox: { width: 220, height: 220 } }, false);
            scannerRef.current = scanner;
            scanner.render(
                (decodedText: string) => {
                    const found = manufacturingOrders.find((mo: any) => mo.code === decodedText);
                    if (found) { setScannedMOId(found.id); setError(null); scanner.clear().catch(() => {}); }
                    else setError(`MO "${decodedText}" not found.`);
                },
                () => {}
            );
        }, 100);

        return () => {
            clearTimeout(timer);
            scannerRef.current?.clear().catch(() => {});
        };
    }, [manufacturingOrders, scannedMOId]);

    const handleManualLookup = () => {
        const code = manualCode.trim().toUpperCase();
        const found = manufacturingOrders.find((mo: any) => mo.code === code);
        if (found) { setScannedMOId(found.id); setError(null); setManualCode(''); }
        else setError(`MO "${manualCode}" not found.`);
    };

    const handleReset = () => {
        setScannedMOId(null);
        setError(null);
        setManualCode('');
        setAddingRun(false);
    };

    const handleRunStatus = async (runId: string, status: string) => {
        setUpdatingRunId(runId);
        try {
            const res = await authFetch(`${API_BASE}/work-orders/${runId}/status?status=${status}`, { method: 'PUT' });
            if (res.ok) await onRefresh();
        } finally {
            setUpdatingRunId(null);
        }
    };

    const handleOpenAddRun = () => {
        if (!scannedMO) return;
        setRunQty(getRemaining(scannedMO).toFixed(2));
        setRunWcId('');
        setAddingRun(true);
    };

    const handleAddRun = async () => {
        if (!scannedMO) return;
        const qty = parseFloat(runQty);
        if (!qty || qty <= 0) return;
        setSubmittingRun(true);
        try {
            const runs = getRuns(scannedMO);
            const res = await authFetch(`${API_BASE}/work-orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    manufacturing_order_id: scannedMO.id,
                    name: `Run ${runs.length + 1}`,
                    sequence: runs.length + 1,
                    work_center_id: runWcId || null,
                    qty,
                }),
            });
            if (res.ok) {
                await onRefresh();
                setAddingRun(false);
                setRunWcId('');
                setRunQty('');
            }
        } finally {
            setSubmittingRun(false);
        }
    };

    const runs        = scannedMO ? getRuns(scannedMO) : [];
    const runQtySum   = scannedMO ? getRunQtySum(scannedMO) : 0;
    const remaining   = scannedMO ? getRemaining(scannedMO) : 0;
    const maxQty      = scannedMO ? getToleranceMax(scannedMO) : 0;
    const newRunQtyNum = parseFloat(runQty) || 0;
    const wouldExceed  = addingRun && scannedMO && (runQtySum + newRunQtyNum) > maxQty;
    const materialCheck = scannedMO ? validateMaterials(scannedMO) : null;
    const target    = scannedMO?.qty || 0;
    const completed = scannedMO?.qty_completed_total || 0;
    const pct       = target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0;

    return (
        <div style={{ background: XP_BEIGE, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Terminal header */}
            <div style={{ fontFamily: XP_FONT, fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5, color: '#555', borderBottom: '1px solid #c0bdb5', paddingBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                <i className="bi bi-qr-code-scan" style={{ color: '#1a4a8a' }} />
                Operator Scan Terminal
                <span style={{ marginLeft: 'auto', fontWeight: 'normal', fontSize: 10, color: '#888' }}>ID: {terminalId.current}</span>
            </div>

            {!scannedMO ? (
                <>
                    {/* Camera viewfinder */}
                    <div style={{ ...xpInset, overflow: 'hidden' }}>
                        <div id="mobile-reader" style={{ width: '100%' }} />
                    </div>

                    <div style={{ textAlign: 'center', fontFamily: XP_FONT, fontSize: 12, color: '#333' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: 2 }}>Ready to Scan</div>
                        <div style={{ fontSize: 11, color: '#666' }}>Point camera at a Manufacturing Order QR code</div>
                    </div>

                    {error && (
                        <div style={{ background: '#fce8e8', border: '1px solid #cc0000', borderLeft: '4px solid #cc0000', padding: '8px 10px', fontFamily: XP_FONT, fontSize: 12, color: '#6b0000' }}>
                            <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 5 }}></i>{error}
                        </div>
                    )}

                    {/* Manual entry */}
                    <div style={{ ...xpPanel, marginTop: 4 }}>
                        <div style={xpSectionLabel}>Or enter MO code manually</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <input
                                type="text"
                                value={manualCode}
                                onChange={e => setManualCode(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleManualLookup()}
                                placeholder="e.g. MO-2024-0042"
                                style={{
                                    ...xpInset, flex: 1, padding: '8px 10px',
                                    fontFamily: XP_FONT, fontSize: 14,
                                    outline: 'none', minHeight: 40,
                                }}
                            />
                            <button onClick={handleManualLookup} style={xpBtn({ padding: '8px 14px', fontSize: 14, fontWeight: 'bold', minHeight: 40, minWidth: 48 })}>
                                →
                            </button>
                        </div>
                    </div>
                </>
            ) : (
                <>
                    {/* MO identity panel */}
                    <div style={{ ...xpPanel, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontFamily: XP_FONT, fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', color: '#666', marginBottom: 2 }}>
                                Manufacturing Order
                            </div>
                            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 22, fontWeight: 'bold', color: '#0058e6', lineHeight: 1.1 }}>
                                {scannedMO.code}
                            </div>
                            <div style={{ marginTop: 4, fontFamily: XP_FONT, fontSize: 12, color: '#333' }}>
                                {scannedMO.item_name || getItemName(scannedMO.item_id)}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                                <span style={xpStatusBadge(scannedMO.status)}>{scannedMO.status === 'IN_PROGRESS' ? 'IN PROGRESS' : scannedMO.status}</span>
                                <span style={{ fontFamily: XP_FONT, fontSize: 11, color: '#555' }}>Target: {parseFloat(scannedMO.qty)}</span>
                            </div>
                            {/* Progress bar */}
                            {target > 0 && (
                                <div style={{ marginTop: 6 }}>
                                    <div style={{ border: '1px solid #7f9db9', height: 12, background: '#fff', position: 'relative', overflow: 'hidden' }}>
                                        <div style={{
                                            height: '100%', width: `${pct}%`,
                                            background: pct >= 100
                                                ? 'repeating-linear-gradient(45deg, #2e7d32, #2e7d32 4px, #4caf50 4px, #4caf50 8px)'
                                                : 'repeating-linear-gradient(45deg, #000080, #000080 4px, #1565c0 4px, #1565c0 8px)',
                                            transition: 'width 0.2s',
                                        }} />
                                        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 'bold', color: pct > 50 ? '#fff' : '#000080', textShadow: pct > 50 ? '0 0 3px rgba(0,0,0,0.8)' : 'none' }}>
                                            {completed.toFixed(2)} / {target} ({pct}%)
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                        <button style={xpBtn({ flexShrink: 0, padding: '6px 12px' })} type="button" onClick={handleReset}>
                            <i className="bi bi-arrow-repeat"></i> Reset
                        </button>
                    </div>

                    {/* Material check */}
                    {materialCheck && (
                        <div style={{
                            border: '1px solid', padding: '8px 10px', fontFamily: XP_FONT,
                            borderColor: materialCheck.ok ? '#2e7d32' : '#cc0000',
                            borderLeft: `4px solid ${materialCheck.ok ? '#2e7d32' : '#cc0000'}`,
                            background: materialCheck.ok ? '#e8f5e9' : '#fce8e8',
                        }}>
                            <div style={{ fontSize: 12, fontWeight: 'bold', color: materialCheck.ok ? '#1b5e20' : '#6b0000', marginBottom: materialCheck.ok ? 0 : 4 }}>
                                {materialCheck.ok
                                    ? <><i className="bi bi-check-circle-fill" style={{ marginRight: 5 }}></i>All materials available</>
                                    : <><i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 5 }}></i>Missing materials</>
                                }
                            </div>
                            {!materialCheck.ok && materialCheck.missing.map((m: any, i: number) => (
                                <div key={i} style={{ fontSize: 11, color: '#6b0000', marginTop: 2 }}>• {m.name} at {m.location}</div>
                            ))}
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div style={{ background: '#fce8e8', border: '1px solid #cc0000', borderLeft: '4px solid #cc0000', padding: '8px 10px', fontFamily: XP_FONT, fontSize: 12, color: '#6b0000' }}>
                            <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 5 }}></i>{error}
                        </div>
                    )}

                    {/* Runs panel */}
                    <div style={xpPanel}>
                        <div style={xpSectionLabel}>
                            Runs
                            <span style={{ marginLeft: 6, fontWeight: 'normal', textTransform: 'none', letterSpacing: 0 }}>
                                — Target: {parseFloat(scannedMO.qty)} | Assigned: {runQtySum.toFixed(2)} | Remaining: {remaining.toFixed(2)}
                            </span>
                        </div>

                        {runs.length === 0 ? (
                            <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#888', textAlign: 'center', padding: '6px 0 10px' }}>
                                No runs assigned yet.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
                                {runs.map((run: any) => (
                                    <div key={run.id} style={{ border: '1px solid #c0bdb5', background: '#f5f4ef', padding: '7px 10px', borderLeft: `3px solid ${run.status === 'COMPLETED' ? '#2e7d32' : run.status === 'IN_PROGRESS' ? '#1a4a8a' : '#b8860b'}` }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                                            <div>
                                                <div style={{ fontFamily: XP_FONT, fontSize: 12, fontWeight: 'bold', color: '#333' }}>
                                                    {run.name}
                                                    {run.work_center_name && (
                                                        <span style={{ fontWeight: 'normal', color: '#666', marginLeft: 5 }}>@ {run.work_center_name}</span>
                                                    )}
                                                </div>
                                                <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#555' }}>Qty: {parseFloat(run.qty)}</div>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                                                <span style={xpStatusBadge(run.status)}>{run.status === 'IN_PROGRESS' ? 'IN PROGRESS' : run.status}</span>
                                                {run.status === 'PENDING' && (
                                                    <button
                                                        disabled={updatingRunId === run.id}
                                                        onClick={() => handleRunStatus(run.id, 'IN_PROGRESS')}
                                                        style={xpBtn({ fontSize: 11, padding: '4px 10px', background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)', borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a', color: '#fff', fontWeight: 'bold', opacity: updatingRunId === run.id ? 0.6 : 1 })}
                                                    >
                                                        <i className="bi bi-play-fill"></i>
                                                        {updatingRunId === run.id ? 'Starting...' : 'START'}
                                                    </button>
                                                )}
                                                {run.status === 'IN_PROGRESS' && (
                                                    <button
                                                        disabled={updatingRunId === run.id}
                                                        onClick={() => handleRunStatus(run.id, 'COMPLETED')}
                                                        style={xpBtn({ fontSize: 11, padding: '4px 10px', background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#fff', fontWeight: 'bold', opacity: updatingRunId === run.id ? 0.6 : 1 })}
                                                    >
                                                        <i className="bi bi-check-lg"></i>
                                                        {updatingRunId === run.id ? 'Finishing...' : 'DONE'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Add Run form */}
                        {!addingRun ? (
                            <button onClick={handleOpenAddRun} style={xpBtn({ fontSize: 12, padding: '8px 14px', width: '100%', justifyContent: 'center' })}>
                                + Add Run
                            </button>
                        ) : (
                            <div style={{ border: '1px solid #aca899', padding: '10px', background: '#f5f4ee', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ fontFamily: XP_FONT, fontSize: 10, fontWeight: 'bold', color: '#000080', textTransform: 'uppercase' }}>New Run</div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontFamily: XP_FONT, fontSize: 10, marginBottom: 3 }}>Work Center</div>
                                        <select
                                            value={runWcId}
                                            onChange={e => setRunWcId(e.target.value)}
                                            style={{ width: '100%', fontFamily: XP_FONT, fontSize: 13, border: '1px solid #7f9db9', padding: '6px 8px', background: '#fff' }}
                                        >
                                            <option value="">— any —</option>
                                            {workCenters.map((wc: any) => (
                                                <option key={wc.id} value={wc.id}>{wc.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontFamily: XP_FONT, fontSize: 10, marginBottom: 3 }}>Qty</div>
                                        <input
                                            type="number"
                                            value={runQty}
                                            onChange={e => setRunQty(e.target.value)}
                                            min="0.0001"
                                            step="any"
                                            autoFocus
                                            style={{ width: '100%', fontFamily: XP_FONT, fontSize: 14, border: '1px solid #7f9db9', padding: '6px 8px' }}
                                        />
                                    </div>
                                </div>
                                {wouldExceed && (
                                    <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#8a3c00', background: '#fff3cd', border: '1px solid #b8860b', padding: '5px 8px' }}>
                                        Exceeds target + tolerance ({maxQty.toFixed(2)}). Override allowed.
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                    <button onClick={() => setAddingRun(false)} style={xpBtn({ fontSize: 12, padding: '6px 12px' })}>
                                        Cancel
                                    </button>
                                    <button
                                        disabled={submittingRun || !runQty || parseFloat(runQty) <= 0}
                                        onClick={handleAddRun}
                                        style={xpBtn({
                                            fontSize: 12, padding: '6px 14px', fontWeight: 'bold',
                                            background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)',
                                            borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a',
                                            color: '#fff',
                                            opacity: (submittingRun || !runQty || parseFloat(runQty) <= 0) ? 0.6 : 1,
                                        })}
                                    >
                                        {submittingRun ? 'Saving...' : 'Add Run'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
