import { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';

interface QRScannerViewProps {
    workOrders: any[];
    items: any[];
    boms: any[];
    locations: any[];
    attributes: any[];
    stockBalance: any[];
    onUpdateStatus: (id: string, status: string) => Promise<boolean>;
    onClose: () => void;
}

export default function QRScannerView({
    workOrders,
    items,
    boms,
    locations,
    attributes,
    stockBalance,
    onUpdateStatus,
    onClose
}: QRScannerViewProps) {
    const { t } = useLanguage();
    const { uiStyle: currentStyle } = useTheme();
    const classic = currentStyle === 'classic';

    const [scannedWO, setScannedWO] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const scannerRef = useRef<Html5QrcodeScanner | null>(null);

    // --- XP Style Constants ---
    const xpBevel: React.CSSProperties = {
        border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
        boxShadow: '2px 2px 4px rgba(0,0,0,0.3)', background: '#ece9d8', borderRadius: 0,
    };
    const xpTitleBar: React.CSSProperties = {
        background: 'linear-gradient(to right, #1a1a2e 0%, #3a3a5e 100%)',
        color: '#ffffff', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '12px', fontWeight: 'bold',
        padding: '4px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
        borderBottom: '1px solid #0a0a1e', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', minHeight: '26px',
    };
    const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
        fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', padding: '2px 10px',
        cursor: 'pointer', background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
        border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
        color: '#000000', borderRadius: 0, ...extra,
    });

    // --- Validation Logic ---
    const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
    const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || id;

    const calculateRequiredQty = (baseQty: number, line: any, bom: any) => {
        let required = parseFloat(line.qty);
        if (line.is_percentage) {
            required = (baseQty * required) / 100;
        } else {
            required = baseQty * required;
        }
        const tolerance = parseFloat(bom?.tolerance_percentage || 0);
        if (tolerance > 0) {
            required = required * (1 + (tolerance / 100));
        }
        return required;
    };

    const checkStockAvailability = (item_id: string, location_id: string, attribute_value_ids: string[] = [], required_qty: number) => {
        const targetIds = attribute_value_ids || [];
        const matchingEntries = stockBalance.filter((s: any) =>
            s.item_id === item_id && s.location_id === location_id &&
            (s.attribute_value_ids || []).length === targetIds.length &&
            (s.attribute_value_ids || []).every((id: string) => targetIds.includes(id))
        );
        const available = matchingEntries.reduce((sum: number, e: any) => sum + parseFloat(e.qty), 0);
        return { available, isEnough: available >= required_qty };
    };

    const validateMaterials = (wo: any) => {
        const bom = boms.find(b => b.id === wo.bom_id);
        if (!bom) return { ok: false, missing: [] };

        const missing: any[] = [];
        for (const line of bom.lines) {
            const required = calculateRequiredQty(wo.qty, line, bom);
            const checkLocId = line.source_location_id || wo.source_location_id || wo.location_id;
            const { isEnough } = checkStockAvailability(line.item_id, checkLocId, line.attribute_value_ids, required);
            if (!isEnough) {
                missing.push({
                    name: getItemName(line.item_id),
                    location: getLocationName(checkLocId)
                });
            }
        }
        return { ok: missing.length === 0, missing };
    };

    // --- Scanner Lifecycle ---
    useEffect(() => {
        let scanner: Html5QrcodeScanner | null = null;

        // Delay init to ensure DOM element exists
        const initTimer = setTimeout(() => {
            if (!document.getElementById("reader")) return;

            scanner = new Html5QrcodeScanner(
                "reader",
                { fps: 10, qrbox: { width: 250, height: 250 } },
                false
            );
            scannerRef.current = scanner;

            const findByCode = (nodes: any[], code: string): any => {
                for (const wo of nodes) {
                    if (wo.code === code) return wo;
                    const child = findByCode(wo.child_wos || [], code);
                    if (child) return child;
                }
                return null;
            };

            const onScanSuccess = (decodedText: string) => {
                const found = findByCode(workOrders, decodedText);
                if (found) {
                    setScannedWO(found);
                    setError(null);
                    scanner?.clear().catch(console.error);
                } else {
                    setError(`Work Order "${decodedText}" not found.`);
                }
            };

            scanner.render(onScanSuccess, (e) => {});
        }, 100);

        return () => {
            clearTimeout(initTimer);
            if (scannerRef.current) {
                scannerRef.current.clear().catch(e => console.error("Cleanup error", e));
            }
        };
    }, [workOrders, scannedWO]); // Re-run if scannedWO changes (to re-init scanner when resetting)

    const handleUpdate = async (status: string) => {
        if (!scannedWO) return;

        // Perform Material Check if starting
        if (status === 'IN_PROGRESS') {
            const { ok, missing } = validateMaterials(scannedWO);
            if (!ok && missing.length > 0) {
                setError(`INSUFFICIENT STOCK: Cannot start production. Missing ${missing.map(m => m.name).join(', ')} at ${missing[0].location}.`);
                return;
            }
        }

        const success = await onUpdateStatus(scannedWO.id, status);
        if (success) {
            setScannedWO({ ...scannedWO, status });
            setError(null);
        } else {
            // Error is handled by toast in parent
        }
    };

    const xpStatusBadge = (status: string): React.CSSProperties => {
        if (status === 'COMPLETED') return { background: '#2e7d32', color: '#ffffff', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '9px', fontWeight: 'bold', padding: '1px 6px', display: 'inline-block' };
        if (status === 'IN_PROGRESS') return { background: '#1a4a8a', color: '#ffffff', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '9px', fontWeight: 'bold', padding: '1px 6px', display: 'inline-block' };
        return { background: '#b8860b', color: '#ffffff', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '9px', fontWeight: 'bold', padding: '1px 6px', display: 'inline-block' };
    };

    const terminalId = useRef(Math.random().toString(36).substr(2, 6).toUpperCase());

    if (classic) {
        return (
            <div style={xpBevel} className="fade-in">
                {/* XP Title Bar */}
                <div style={xpTitleBar}>
                    <span>
                        <i className="bi bi-qr-code-scan" style={{ marginRight: 6, color: '#aaccff' }}></i>
                        Operator Scan Terminal
                    </span>
                    <button style={xpBtn({ padding: '0 6px', height: 20 })} type="button" onClick={onClose}>✕</button>
                </div>

                {/* XP Body */}
                <div style={{ background: '#ece9d8', padding: '12px 14px' }}>
                    {!scannedWO ? (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                <div id="reader" style={{ border: '2px solid #7f9db9', background: '#ffffff', width: '100%', maxWidth: '500px', overflow: 'hidden' }}></div>
                            </div>
                            <div style={{ textAlign: 'center', marginTop: 12 }}>
                                <p style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '13px', fontWeight: 'bold', color: '#333', margin: '0 0 4px 0' }}>Ready to Scan</p>
                                <span style={{ fontSize: '11px', color: '#666', fontFamily: 'Tahoma, Arial, sans-serif' }}>Point your camera at a Work Order QR Code</span>
                                {error && (
                                    <div style={{ background: '#fce8e8', border: '1px solid #cc0000', borderLeft: '4px solid #cc0000', padding: '6px 10px', marginTop: 10, fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#6b0000' }}>
                                        <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 4 }}></i>{error}
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div>
                            {/* Active WO sub-panel */}
                            <div style={{ background: '#f5f4ef', border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', padding: '8px 10px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                    <div style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#666' }}>Active Work Order</div>
                                    <div style={{ fontFamily: "'Courier New', monospace", fontSize: '20px', fontWeight: 'bold', color: '#0058e6' }}>{scannedWO.code}</div>
                                    <div style={{ marginTop: 4 }}>
                                        <span style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#444', marginRight: 6 }}>{getItemName(scannedWO.item_id)}</span>
                                        <span style={xpStatusBadge(scannedWO.status)}>{scannedWO.status}</span>
                                    </div>
                                </div>
                                <button style={xpBtn()} type="button" onClick={() => { setScannedWO(null); window.location.reload(); }}>
                                    <i className="bi bi-arrow-repeat" style={{ marginRight: 4 }}></i>Reset
                                </button>
                            </div>

                            {error && (
                                <div style={{ background: '#fce8e8', border: '1px solid #cc0000', borderLeft: '4px solid #cc0000', padding: '6px 10px', marginBottom: 10, fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#6b0000' }}>
                                    <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 4 }}></i>{error}
                                </div>
                            )}

                            {/* Section label */}
                            <div style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#555', borderBottom: '1px solid #c0bdb5', paddingBottom: 3, marginBottom: 10 }}>
                                Factory Floor Actions
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {scannedWO.status === 'PENDING' && (
                                    <button
                                        style={xpBtn({ background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)', borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a', color: '#ffffff', fontWeight: 'bold', padding: '10px 20px', fontSize: '14px', width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8 })}
                                        type="button"
                                        onClick={() => handleUpdate('IN_PROGRESS')}
                                    >
                                        <i className="bi bi-play-fill" style={{ fontSize: 18 }}></i> START PRODUCTION
                                    </button>
                                )}
                                {scannedWO.status === 'IN_PROGRESS' && (
                                    <button
                                        style={xpBtn({ background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', fontWeight: 'bold', padding: '10px 20px', fontSize: '14px', width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8 })}
                                        type="button"
                                        onClick={() => handleUpdate('COMPLETED')}
                                    >
                                        <i className="bi bi-check-lg" style={{ fontSize: 18 }}></i> MARK AS COMPLETED
                                    </button>
                                )}
                                {scannedWO.status === 'COMPLETED' && (
                                    <div style={{ background: '#e8f5e9', border: '1px solid #2e7d32', padding: '20px', textAlign: 'center' }}>
                                        <i className="bi bi-check-circle-fill" style={{ color: '#2e7d32', fontSize: 32, display: 'block', marginBottom: 8 }}></i>
                                        <span style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '13px', fontWeight: 'bold', color: '#2e7d32' }}>PRODUCTION COMPLETE</span>
                                        <br />
                                        <span style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#2e7d32', opacity: 0.85 }}>This order has been received into inventory.</span>
                                    </div>
                                )}
                                <div style={{ textAlign: 'center', marginTop: 4 }}>
                                    <button
                                        style={{ background: 'none', border: 'none', color: '#cc0000', cursor: 'pointer', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', textDecoration: 'underline', marginTop: 8 }}
                                        type="button"
                                        onClick={() => handleUpdate('CANCELLED')}
                                    >
                                        Cancel This Order
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* XP Footer */}
                <div style={{ background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898', padding: '2px 8px', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '10px', color: '#666', textAlign: 'center' }}>
                    Terminal ID: {terminalId.current} | Secured by Terras Auth
                </div>
            </div>
        );
    }

    return (
        <div className="card border-0 shadow-lg fade-in">
            <div className="card-header bg-dark text-white d-flex justify-content-between align-items-center">
                <h5 className="mb-0 small fw-bold text-uppercase"><i className="bi bi-qr-code-scan me-2 text-info"></i>Operator Scan Terminal</h5>
                <button className="btn btn-sm btn-outline-light py-0 border-0" type="button" onClick={onClose}><i className="bi bi-x-lg"></i></button>
            </div>
            <div className="card-body bg-light bg-opacity-50">
                {!scannedWO ? (
                    <div className="text-center py-4">
                        <div id="reader" className="overflow-hidden rounded border bg-white" style={{ width: '100%', maxWidth: '500px', margin: '0 auto' }}></div>
                        <div className="mt-4">
                            <p className="lead text-muted mb-2">Ready to Scan</p>
                            <small className="text-muted">Point your camera at a Work Order QR Code</small>
                            {error && <div className="alert alert-danger py-2 mt-3 small shadow-sm border-0 border-start border-4 border-danger">{error}</div>}
                        </div>
                    </div>
                ) : (
                    <div className="py-2">
                        <div className="d-flex align-items-center justify-content-between mb-4 bg-white p-3 rounded border shadow-sm">
                            <div>
                                <div className="extra-small text-muted text-uppercase fw-bold">Active Work Order</div>
                                <h2 className="fw-bold mb-0 font-monospace text-primary">{scannedWO.code}</h2>
                                <div className="mt-1">
                                    <span className="small text-muted me-2">{getItemName(scannedWO.item_id)}</span>
                                    <span className={`badge ${scannedWO.status === 'COMPLETED' ? 'bg-success' : 'bg-warning text-dark'} extra-small`}>{scannedWO.status}</span>
                                </div>
                            </div>
                            <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => { setScannedWO(null); window.location.reload(); }}>
                                <i className="bi bi-arrow-repeat me-1"></i>Reset
                            </button>
                        </div>

                        {error && <div className="alert alert-danger py-3 mb-4 shadow-sm border-0 border-start border-4 border-danger fw-bold"><i className="bi bi-exclamation-octagon-fill me-2"></i>{error}</div>}

                        <div className="row g-3">
                            <div className="col-12">
                                <h6 className="small text-uppercase text-muted fw-bold mb-3 letter-spacing-1">Factory Floor Actions</h6>
                                <div className="d-grid gap-3">
                                    {scannedWO.status === 'PENDING' && (
                                        <button className="btn btn-lg btn-primary shadow py-3 fw-bold" type="button" onClick={() => handleUpdate('IN_PROGRESS')}>
                                            <i className="bi bi-play-fill me-2 fs-4"></i> START PRODUCTION
                                        </button>
                                    )}
                                    {scannedWO.status === 'IN_PROGRESS' && (
                                        <button className="btn btn-lg btn-success shadow py-3 fw-bold" type="button" onClick={() => handleUpdate('COMPLETED')}>
                                            <i className="bi bi-check-lg me-2 fs-4"></i> MARK AS COMPLETED
                                        </button>
                                    )}
                                    {scannedWO.status === 'COMPLETED' && (
                                        <div className="card border-success border-opacity-25 bg-success bg-opacity-10 py-4 px-3 text-center">
                                            <i className="bi bi-check-circle-fill text-success fs-1 mb-2"></i>
                                            <h5 className="mb-0 fw-bold text-success">PRODUCTION COMPLETE</h5>
                                            <small className="text-success opacity-75">This order has been received into inventory.</small>
                                        </div>
                                    )}
                                    <button className="btn btn-sm btn-link text-danger mt-2" type="button" onClick={() => handleUpdate('CANCELLED')}>
                                        Cancel This Order
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            <div className="card-footer bg-white extra-small text-muted text-center py-2 border-top-0 opacity-75">
                Terminal ID: {terminalId.current} | Secured by Terras Auth
            </div>
        </div>
    );
}
