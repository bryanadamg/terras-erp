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

// ── XP style constants ────────────────────────────────────────────────────────
const XP_BEIGE = '#ece9d8';
const XP_FONT  = 'Tahoma, "Segoe UI", Arial, sans-serif';

const xpWindow: React.CSSProperties = {
    border: '2px solid',
    borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    boxShadow: '2px 2px 6px rgba(0,0,0,0.35)',
    background: XP_BEIGE,
    borderRadius: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100%',
};

const xpTitleBar: React.CSSProperties = {
    background: 'linear-gradient(to right, #1a1a2e 0%, #3a3a5e 100%)',
    color: '#ffffff',
    fontFamily: XP_FONT,
    fontSize: 13,
    fontWeight: 'bold',
    padding: '5px 8px',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
    borderBottom: '1px solid #0a0a1e',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 30,
    flexShrink: 0,
};

const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily: XP_FONT,
    fontSize: 13,
    padding: '6px 14px',
    cursor: 'pointer',
    background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
    border: '1px solid',
    borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    color: '#000000',
    borderRadius: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    ...extra,
});

const xpInset: React.CSSProperties = {
    border: '2px solid',
    borderColor: '#808080 #dfdfdf #dfdfdf #808080',
    background: '#ffffff',
    borderRadius: 0,
};

const xpPanel: React.CSSProperties = {
    border: '2px solid',
    borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    background: '#f5f4ef',
    borderRadius: 0,
    padding: '10px 12px',
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

const xpSectionLabel: React.CSSProperties = {
    fontFamily: XP_FONT, fontSize: 10, fontWeight: 'bold',
    textTransform: 'uppercase', letterSpacing: 0.5, color: '#555',
    borderBottom: '1px solid #c0bdb5', paddingBottom: 3, marginBottom: 10,
};

// ─────────────────────────────────────────────────────────────────────────────

export default function MobileScannerView({
    workOrders,
    items,
    boms,
    locations,
    stockBalance,
    onUpdateStatus,
    onClose,
}: MobileScannerViewProps) {
    const [scannedWO, setScannedWO]     = useState<any>(null);
    const [error, setError]             = useState<string | null>(null);
    const [manualCode, setManualCode]   = useState('');
    const [updating, setUpdating]       = useState(false);
    const scannerRef  = useRef<Html5QrcodeScanner | null>(null);
    const terminalId  = useRef(Math.random().toString(36).substr(2, 6).toUpperCase());

    // ── Helpers ───────────────────────────────────────────────────────────────
    const getItemName     = (id: string) => items.find((i: any) => i.id === id)?.name || id;
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
        if (scannedWO) return;

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
                setError(`INSUFFICIENT STOCK: Missing ${missing.map((m: any) => m.name).join(', ')}.`);
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

    const materialCheck = scannedWO ? validateMaterials(scannedWO) : null;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div style={xpWindow}>

            {/* ── XP Title Bar ── */}
            <div style={xpTitleBar}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <i className="bi bi-qr-code-scan" style={{ color: '#aaccff', fontSize: 14 }}></i>
                    Operator Scan Terminal
                </span>
                <button style={xpBtn({ padding: '1px 8px', fontSize: 12, minHeight: 22 })} type="button" onClick={onClose}>✕</button>
            </div>

            {/* ── Body ── */}
            <div style={{ background: XP_BEIGE, padding: '12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>

                {!scannedWO ? (
                    <>
                        {/* Camera viewfinder — XP inset border */}
                        <div style={{ ...xpInset, overflow: 'hidden' }}>
                            <div id="mobile-reader" style={{ width: '100%' }} />
                        </div>

                        {/* Ready label */}
                        <div style={{ textAlign: 'center', fontFamily: XP_FONT, fontSize: 12, color: '#333' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: 2 }}>Ready to Scan</div>
                            <div style={{ fontSize: 11, color: '#666' }}>Point your camera at a Work Order QR Code</div>
                        </div>

                        {/* Error */}
                        {error && (
                            <div style={{ background: '#fce8e8', border: '1px solid #cc0000', borderLeft: '4px solid #cc0000', padding: '8px 10px', fontFamily: XP_FONT, fontSize: 12, color: '#6b0000' }}>
                                <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 5 }}></i>{error}
                            </div>
                        )}

                        {/* Manual entry */}
                        <div style={{ ...xpPanel, marginTop: 4 }}>
                            <div style={xpSectionLabel}>Or enter WO code manually</div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <input
                                    type="text"
                                    value={manualCode}
                                    onChange={e => setManualCode(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleManualLookup()}
                                    placeholder="e.g. WO-2024-0042"
                                    style={{
                                        ...xpInset,
                                        flex: 1, padding: '8px 10px',
                                        fontFamily: XP_FONT, fontSize: 14,
                                        outline: 'none', minHeight: 40,
                                    }}
                                />
                                <button
                                    onClick={handleManualLookup}
                                    style={xpBtn({ padding: '8px 14px', fontSize: 14, fontWeight: 'bold', minHeight: 40, minWidth: 48 })}
                                >
                                    →
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        {/* ── WO identity panel ── */}
                        <div style={{ ...xpPanel, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontFamily: XP_FONT, fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', color: '#666', marginBottom: 2 }}>
                                    Active Work Order
                                </div>
                                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 22, fontWeight: 'bold', color: '#0058e6', lineHeight: 1.1 }}>
                                    {scannedWO.code}
                                </div>
                                <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: XP_FONT, fontSize: 12, color: '#333' }}>{getItemName(scannedWO.item_id)}</span>
                                    <span style={xpStatusBadge(scannedWO.status)}>{scannedWO.status}</span>
                                </div>
                                <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#555', marginTop: 3 }}>
                                    Qty: {parseFloat(scannedWO.qty)}
                                </div>
                            </div>
                            <button style={xpBtn({ flexShrink: 0, padding: '6px 12px' })} type="button" onClick={handleReset}>
                                <i className="bi bi-arrow-repeat"></i> Reset
                            </button>
                        </div>

                        {/* ── Material check ── */}
                        {materialCheck && (
                            <div style={{
                                border: '1px solid',
                                borderColor: materialCheck.ok ? '#2e7d32' : '#cc0000',
                                borderLeft: `4px solid ${materialCheck.ok ? '#2e7d32' : '#cc0000'}`,
                                background: materialCheck.ok ? '#e8f5e9' : '#fce8e8',
                                padding: '8px 10px',
                                fontFamily: XP_FONT,
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

                        {/* ── Error ── */}
                        {error && (
                            <div style={{ background: '#fce8e8', border: '1px solid #cc0000', borderLeft: '4px solid #cc0000', padding: '8px 10px', fontFamily: XP_FONT, fontSize: 12, color: '#6b0000' }}>
                                <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 5 }}></i>{error}
                            </div>
                        )}

                        {/* ── Factory floor actions ── */}
                        <div style={xpPanel}>
                            <div style={xpSectionLabel}>Factory Floor Actions</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

                                {scannedWO.status === 'PENDING' && (
                                    <button
                                        type="button"
                                        disabled={updating}
                                        onClick={() => handleUpdate('IN_PROGRESS')}
                                        style={xpBtn({
                                            background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)',
                                            borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a',
                                            color: '#fff', fontWeight: 'bold',
                                            padding: '14px 20px', fontSize: 15,
                                            width: '100%', justifyContent: 'center',
                                            opacity: updating ? 0.7 : 1,
                                        })}
                                    >
                                        <i className="bi bi-play-fill" style={{ fontSize: 18 }}></i>
                                        {updating ? 'Starting...' : 'START PRODUCTION'}
                                    </button>
                                )}

                                {scannedWO.status === 'IN_PROGRESS' && (
                                    <>
                                        <button
                                            type="button"
                                            disabled={updating}
                                            onClick={() => handleUpdate('COMPLETED')}
                                            style={xpBtn({
                                                background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)',
                                                borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a',
                                                color: '#fff', fontWeight: 'bold',
                                                padding: '14px 20px', fontSize: 15,
                                                width: '100%', justifyContent: 'center',
                                                opacity: updating ? 0.7 : 1,
                                            })}
                                        >
                                            <i className="bi bi-check-lg" style={{ fontSize: 18 }}></i>
                                            {updating ? 'Finishing...' : 'MARK AS COMPLETED'}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={updating}
                                            onClick={() => handleUpdate('CANCELLED')}
                                            style={{ background: 'none', border: 'none', color: '#cc0000', cursor: updating ? 'not-allowed' : 'pointer', fontFamily: XP_FONT, fontSize: 12, textDecoration: 'underline', padding: '4px 0', textAlign: 'center' as const }}
                                        >
                                            Cancel This Order
                                        </button>
                                    </>
                                )}

                                {scannedWO.status === 'COMPLETED' && (
                                    <div style={{ background: '#e8f5e9', border: '1px solid #2e7d32', padding: '18px', textAlign: 'center' as const }}>
                                        <i className="bi bi-check-circle-fill" style={{ color: '#2e7d32', fontSize: 32, display: 'block', marginBottom: 8 }}></i>
                                        <div style={{ fontFamily: XP_FONT, fontSize: 14, fontWeight: 'bold', color: '#2e7d32' }}>PRODUCTION COMPLETE</div>
                                        <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#2e7d32', opacity: 0.85, marginTop: 4 }}>This order has been received into inventory.</div>
                                    </div>
                                )}

                                {scannedWO.status === 'CANCELLED' && (
                                    <div style={{ background: '#f5f5f5', border: '1px solid #808080', padding: '18px', textAlign: 'center' as const }}>
                                        <div style={{ fontFamily: XP_FONT, fontSize: 13, fontWeight: 'bold', color: '#444' }}>This work order has been cancelled.</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* ── XP Status Bar ── */}
            <div style={{
                background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)',
                borderTop: '1px solid #b0a898',
                padding: '3px 10px',
                fontFamily: XP_FONT, fontSize: 10, color: '#666',
                textAlign: 'center',
                flexShrink: 0,
            }}>
                Terminal ID: {terminalId.current} | Secured by Teras Auth
            </div>
        </div>
    );
}
