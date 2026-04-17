'use client';

import { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

interface MobileScannerViewProps {
    workOrders: any[];
    items: any[];
    boms: any[];
    locations: any[];
    attributes: any[];
    stockBalance: any[];
    onUpdateStatus: (id: string, status: string) => Promise<boolean>;
    onClose: () => void;
}

export default function MobileScannerView({
    workOrders,
    items,
    boms,
    locations,
    stockBalance,
    onUpdateStatus,
    onClose,
}: MobileScannerViewProps) {
    const [scannedWO, setScannedWO] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [manualCode, setManualCode] = useState('');
    const [updating, setUpdating] = useState(false);
    const scannerRef = useRef<Html5QrcodeScanner | null>(null);

    // ── Helpers (same logic as QRScannerView) ────────────────────────────────
    const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
    const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || id;

    const calculateRequiredQty = (baseQty: number, line: any, bom: any) => {
        let required = parseFloat(line.qty);
        if (line.is_percentage) required = (baseQty * required) / 100;
        else required = baseQty * required;
        const tolerance = parseFloat(bom?.tolerance_percentage || 0);
        if (tolerance > 0) required = required * (1 + tolerance / 100);
        return required;
    };

    const checkStockAvailability = (item_id: string, location_id: string, attribute_value_ids: string[] = [], required_qty: number) => {
        const targetIds = attribute_value_ids || [];
        const matching = stockBalance.filter((s: any) =>
            s.item_id === item_id && s.location_id === location_id &&
            (s.attribute_value_ids || []).length === targetIds.length &&
            (s.attribute_value_ids || []).every((id: string) => targetIds.includes(id))
        );
        const available = matching.reduce((sum: number, e: any) => sum + parseFloat(e.qty), 0);
        return { available, isEnough: available >= required_qty };
    };

    const validateMaterials = (wo: any) => {
        const bom = boms.find((b: any) => b.id === wo.bom_id);
        if (!bom) return { ok: false, missing: [] as any[] };
        const missing: any[] = [];
        for (const line of bom.lines) {
            const required = calculateRequiredQty(wo.qty, line, bom);
            const checkLocId = line.source_location_id || wo.source_location_id || wo.location_id;
            const { isEnough } = checkStockAvailability(line.item_id, checkLocId, line.attribute_value_ids, required);
            if (!isEnough) missing.push({ name: getItemName(line.item_id), location: getLocationName(checkLocId) });
        }
        return { ok: missing.length === 0, missing };
    };

    const findByCode = (nodes: any[], code: string): any => {
        for (const wo of nodes) {
            if (wo.code === code) return wo;
            const child = findByCode(wo.child_wos || [], code);
            if (child) return child;
        }
        return null;
    };

    // ── Scanner lifecycle ─────────────────────────────────────────────────────
    useEffect(() => {
        if (scannedWO) return; // don't init when a WO is already loaded

        const timer = setTimeout(() => {
            if (!document.getElementById('mobile-reader')) return;

            const scanner = new Html5QrcodeScanner(
                'mobile-reader',
                { fps: 10, qrbox: { width: 220, height: 220 } },
                false
            );
            scannerRef.current = scanner;

            scanner.render(
                (decodedText: string) => {
                    const found = findByCode(workOrders, decodedText);
                    if (found) { setScannedWO(found); setError(null); scanner.clear().catch(() => {}); }
                    else setError(`Work order "${decodedText}" not found.`);
                },
                () => {}
            );
        }, 100);

        return () => {
            clearTimeout(timer);
            scannerRef.current?.clear().catch(() => {});
        };
    }, [workOrders, scannedWO]);

    // ── Actions ───────────────────────────────────────────────────────────────
    const handleUpdate = async (status: string) => {
        if (!scannedWO || updating) return;
        if (status === 'IN_PROGRESS') {
            const { ok, missing } = validateMaterials(scannedWO);
            if (!ok && missing.length > 0) {
                setError(`Insufficient stock: ${missing.map((m: any) => m.name).join(', ')} not available.`);
                return;
            }
        }
        setUpdating(true);
        const success = await onUpdateStatus(scannedWO.id, status);
        if (success) setScannedWO({ ...scannedWO, status });
        setUpdating(false);
    };

    const handleManualLookup = () => {
        const found = findByCode(workOrders, manualCode.trim().toUpperCase());
        if (found) { setScannedWO(found); setError(null); setManualCode(''); }
        else setError(`Work order "${manualCode}" not found.`);
    };

    const handleReset = () => {
        setScannedWO(null);
        setError(null);
        setManualCode('');
    };

    // ── Status helpers ────────────────────────────────────────────────────────
    const statusColor: Record<string, string> = {
        PENDING: '#f59e0b',
        IN_PROGRESS: '#3b82f6',
        COMPLETED: '#10b981',
        CANCELLED: '#6b7280',
    };

    const materialCheck = scannedWO ? validateMaterials(scannedWO) : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: '#111' }}>

            {/* ── Header ── */}
            <div style={{ background: '#1a1a2e', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #333' }}>
                <button
                    onClick={onClose}
                    style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 20, padding: 0, lineHeight: 1, cursor: 'pointer' }}
                >
                    ←
                </button>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, letterSpacing: 1 }}>
                    SCAN TERMINAL
                </span>
            </div>

            {!scannedWO ? (
                <>
                    {/* ── Camera viewfinder ── */}
                    <div style={{ background: '#000', flex: '0 0 auto' }}>
                        <div id="mobile-reader" style={{ width: '100%' }} />
                    </div>

                    {/* ── Error ── */}
                    {error && (
                        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '10px 16px', fontSize: 13 }}>
                            ⚠ {error}
                        </div>
                    )}

                    {/* ── Manual entry ── */}
                    <div style={{ background: '#1a1a2e', padding: '16px', borderTop: '1px solid #333' }}>
                        <div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                            Or enter WO code manually
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <input
                                type="text"
                                value={manualCode}
                                onChange={e => setManualCode(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleManualLookup()}
                                placeholder="e.g. WO-2024-0042"
                                style={{
                                    flex: 1, background: '#0f0f1a', border: '1px solid #444',
                                    color: '#fff', borderRadius: 8, padding: '12px 14px',
                                    fontSize: 15, outline: 'none',
                                }}
                            />
                            <button
                                onClick={handleManualLookup}
                                style={{
                                    background: '#3b82f6', color: '#fff', border: 'none',
                                    borderRadius: 8, padding: '0 18px', fontSize: 15,
                                    fontWeight: 700, cursor: 'pointer', minWidth: 56,
                                }}
                            >
                                →
                            </button>
                        </div>
                    </div>
                </>
            ) : (
                <>
                    {/* ── WO Result Card ── */}
                    <div style={{ background: '#1c1c2e', flex: 1, padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                        {/* WO identity */}
                        <div style={{ background: '#0f0f1a', borderRadius: 12, padding: '16px 18px', border: '1px solid #333' }}>
                            <div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Work Order</div>
                            <div style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{scannedWO.code}</div>
                            <div style={{ color: '#e2e8f0', fontSize: 16, marginBottom: 8 }}>{getItemName(scannedWO.item_id)}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <span style={{
                                    background: statusColor[scannedWO.status] || '#555',
                                    color: '#fff', borderRadius: 6, padding: '3px 10px',
                                    fontSize: 12, fontWeight: 700,
                                }}>
                                    {scannedWO.status}
                                </span>
                                <span style={{ color: '#94a3b8', fontSize: 14 }}>Qty: {parseFloat(scannedWO.qty)}</span>
                            </div>
                        </div>

                        {/* Material check */}
                        {materialCheck && (
                            <div style={{
                                background: materialCheck.ok ? '#052e16' : '#450a0a',
                                border: `1px solid ${materialCheck.ok ? '#166534' : '#991b1b'}`,
                                borderRadius: 10, padding: '12px 14px',
                            }}>
                                <div style={{ color: materialCheck.ok ? '#86efac' : '#fca5a5', fontSize: 13, fontWeight: 600, marginBottom: materialCheck.ok ? 0 : 6 }}>
                                    {materialCheck.ok ? '✓ All materials available' : `⚠ Missing materials`}
                                </div>
                                {!materialCheck.ok && materialCheck.missing.map((m: any, i: number) => (
                                    <div key={i} style={{ color: '#fca5a5', fontSize: 12, marginTop: 2 }}>
                                        • {m.name} at {m.location}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Error */}
                        {error && (
                            <div style={{ background: '#7f1d1d', color: '#fca5a5', borderRadius: 10, padding: '12px 14px', fontSize: 13 }}>
                                ⚠ {error}
                            </div>
                        )}

                        {/* Action buttons */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
                            {scannedWO.status === 'PENDING' && (
                                <button
                                    onClick={() => handleUpdate('IN_PROGRESS')}
                                    disabled={updating}
                                    style={{
                                        background: updating ? '#1e40af' : '#2563eb',
                                        color: '#fff', border: 'none', borderRadius: 12,
                                        padding: '18px', fontSize: 17, fontWeight: 700,
                                        cursor: updating ? 'not-allowed' : 'pointer',
                                        letterSpacing: 0.5,
                                    }}
                                >
                                    {updating ? '...' : '▶  START PRODUCTION'}
                                </button>
                            )}
                            {scannedWO.status === 'IN_PROGRESS' && (
                                <>
                                    <button
                                        onClick={() => handleUpdate('COMPLETED')}
                                        disabled={updating}
                                        style={{
                                            background: updating ? '#065f46' : '#059669',
                                            color: '#fff', border: 'none', borderRadius: 12,
                                            padding: '18px', fontSize: 17, fontWeight: 700,
                                            cursor: updating ? 'not-allowed' : 'pointer',
                                        }}
                                    >
                                        {updating ? '...' : '✓  FINISH'}
                                    </button>
                                    <button
                                        onClick={() => handleUpdate('CANCELLED')}
                                        disabled={updating}
                                        style={{
                                            background: 'transparent', color: '#f87171',
                                            border: '1px solid #f87171', borderRadius: 12,
                                            padding: '14px', fontSize: 15, fontWeight: 600,
                                            cursor: updating ? 'not-allowed' : 'pointer',
                                        }}
                                    >
                                        Cancel WO
                                    </button>
                                </>
                            )}
                            {(scannedWO.status === 'COMPLETED' || scannedWO.status === 'CANCELLED') && (
                                <div style={{ color: '#94a3b8', textAlign: 'center', fontSize: 14, padding: '10px 0' }}>
                                    This work order is {scannedWO.status.toLowerCase()}.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Reset button ── */}
                    <div style={{ background: '#111', padding: '14px 16px', borderTop: '1px solid #222' }}>
                        <button
                            onClick={handleReset}
                            style={{
                                width: '100%', background: 'none', color: '#60a5fa',
                                border: '1px solid #334', borderRadius: 10, padding: '12px',
                                fontSize: 14, cursor: 'pointer',
                            }}
                        >
                            ↩ Scan another work order
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
