import { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { StatusChip, CodeChip, xpFont, xpBtn as xpBtnBase, BTN_TONES, XP_BTN } from './xpTheme';
import { xpBevel as sharedXpBevel, xpTitleBar as sharedXpTitleBar } from './shellTheme';
import { calculateRequiredQty, stockAtLocation } from './moHelpers';

interface QRScannerViewProps {
    workOrders: any[];
    items: any[];
    boms: any[];
    locations: any[];
    attributes: any[];
    stockBalance: any[];
    /** WO id already decoded by the shared scanner — opens straight on that WO. */
    initialWOId?: string;
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
    initialWOId,
    onUpdateStatus,
    onClose
}: QRScannerViewProps) {
    const { t } = useLanguage();
    const { itemIndex } = useData();

    const [scannedWO, setScannedWO] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const scannerRef = useRef<Html5QrcodeScanner | null>(null);

    // `workOrders` prop actually receives the MO tree (root MOs with nested
    // child_mos + work_orders, all_levels=true) — flatten it to the real WOs,
    // same shape the mobile scanner (components/mobile/ScannerView.tsx) uses.
    // QR codes encode WO.id (a UUID), not WO.code — match on id.
    const isUUID = (s: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const flattenMOs = (mos: any[]): any[] =>
        (mos || []).flatMap((mo: any) => [mo, ...flattenMOs(mo.child_mos || [])]);
    const allWOs = flattenMOs(workOrders).flatMap((mo: any) =>
        (mo.work_orders || []).map((wo: any) => ({ ...wo, _mo: mo }))
    );

    // Seeded from the shared scanner: the label was already decoded there, so open
    // that WO rather than asking the floor to scan it twice. A UUID missing from
    // the loaded MO tree falls through to the camera with the reason shown.
    const seededRef = useRef(false);
    useEffect(() => {
        if (!initialWOId || seededRef.current) return;
        const found = allWOs.find((wo: any) => wo.id === initialWOId);
        if (!found) {
            if (!(workOrders || []).length) return;   // tree not in yet
            seededRef.current = true;
            setError(`WO "${initialWOId.slice(0, 8)}..." not found in active orders.`);
            return;
        }
        seededRef.current = true;
        setScannedWO(found);
    }, [initialWOId, workOrders]);

    // --- XP Style Constants ---
    const xpBevel: React.CSSProperties = sharedXpBevel();
    // Dark navy header (not the standard blue) — deliberate for the scanner surface.
    const xpTitleBar: React.CSSProperties = sharedXpTitleBar({
        background: 'linear-gradient(to right, #1a1a2e 0%, #3a3a5e 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)', borderBottom: '1px solid #0a0a1e',
    });
    const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => xpBtnBase(extra);

    // --- Validation Logic ---
    const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || itemIndex?.[String(id)]?.name || id;
    const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || id;

    // Both of these were private copies. The requirement one branched on
    // `line.is_percentage` — a field this schema does not have (BOMLine.percentage is
    // the scaling field; see CLAUDE.md) — so it always fell through to
    // `baseQty * line.qty` and the floor scanner's material check disagreed with the
    // MO page for every percentage-based line. Shared now, so it cannot drift again.
    const checkStockAvailability = (item_id: string, location_id: string, attribute_value_ids: string[] = [], required_qty: number) =>
        stockAtLocation(stockBalance, item_id, location_id, attribute_value_ids, required_qty);

    const validateMaterials = (wo: any) => {
        // WOs don't carry bom_id directly — the recipe lives on the parent MO.
        const bom = wo._mo?.bom || boms.find((b: any) => b.id === wo._mo?.bom_id);
        if (!bom) return { ok: false, missing: [] };
        // A WO tied to a routing step only consumes that step's lines; unassigned WOs use the whole recipe.
        const lines = wo.bom_operation_id
            ? (bom.lines || []).filter((l: any) => l.bom_operation_id === wo.bom_operation_id)
            : (bom.lines || []);

        const missing: any[] = [];
        for (const line of lines) {
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
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                    // Native BarcodeDetector (where available) is far more reliable than the
                    // JS fallback decoder, and a sharp continuous-autofocus 720p stream avoids
                    // the low-res/hunting-focus default the library otherwise opens.
                    useBarCodeDetectorIfSupported: true,
                    videoConstraints: {
                        facingMode: { ideal: 'environment' },
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                        focusMode: 'continuous',
                        advanced: [{ focusMode: 'continuous' } as any],
                    } as MediaTrackConstraints,
                },
                false
            );
            scannerRef.current = scanner;

            const onScanSuccess = (decodedText: string) => {
                if (!isUUID(decodedText)) {
                    setError('Not a valid Work Order QR code.');
                    return;
                }
                const found = allWOs.find((wo: any) => wo.id === decodedText);
                if (found) {
                    setScannedWO(found);
                    setError(null);
                    scanner?.clear().catch(console.error);
                } else {
                    setError(`WO "${decodedText.slice(0, 8)}..." not found in active orders.`);
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

    const terminalId = useRef(Math.random().toString(36).substr(2, 6).toUpperCase());

    return (
        <div style={xpBevel} className="fade-in">
            {/* XP Title Bar */}
            <div style={xpTitleBar}>
                <span>
                    <i className="bi bi-qr-code-scan" style={{ marginRight: 6, color: '#aaccff' }}></i>
                    Operator Scan Terminal
                </span>
                <button className={XP_BTN} style={xpBtn({ padding: '0 6px', height: 20 })} type="button" onClick={onClose}>✕</button>
            </div>

            {/* XP Body */}
            <div style={{ background: '#ece9d8', padding: '12px 14px' }}>
                {!scannedWO ? (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <div id="reader" style={{ border: '2px solid #7f9db9', background: '#ffffff', width: '100%', maxWidth: '500px', overflow: 'hidden' }}></div>
                        </div>
                        <div style={{ textAlign: 'center', marginTop: 12 }}>
                            <p style={{ fontFamily: xpFont, fontSize: '13px', fontWeight: 'bold', color: '#333', margin: '0 0 4px 0' }}>Ready to Scan</p>
                            <span style={{ fontSize: '11px', color: '#666', fontFamily: xpFont }}>Point your camera at a Work Order QR Code</span>
                            {error && (
                                <div style={{ background: '#fce8e8', border: '1px solid #cc0000', borderLeft: '4px solid #cc0000', padding: '6px 10px', marginTop: 10, fontFamily: xpFont, fontSize: '11px', color: '#6b0000' }}>
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
                                <div style={{ fontFamily: xpFont, fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#666' }}>Active Work Order</div>
                                {/* Hero size — an operator reads this across a machine, so
                                    it overrides the tier-1 step while keeping its face/color. */}
                                <CodeChip code={scannedWO.code} tone="accent" style={{ fontSize: 20 }} />
                                <div style={{ marginTop: 4 }}>
                                    <span style={{ fontFamily: xpFont, fontSize: '11px', color: '#444', marginRight: 6 }}>{getItemName(scannedWO._mo?.item_id)}</span>
                                    <StatusChip status={scannedWO.status} />
                                </div>
                            </div>
                            <button className={XP_BTN} style={xpBtn()} type="button" onClick={() => { setScannedWO(null); window.location.reload(); }}>
                                <i className="bi bi-arrow-repeat" style={{ marginRight: 4 }}></i>Reset
                            </button>
                        </div>

                        {error && (
                            <div style={{ background: '#fce8e8', border: '1px solid #cc0000', borderLeft: '4px solid #cc0000', padding: '6px 10px', marginBottom: 10, fontFamily: xpFont, fontSize: '11px', color: '#6b0000' }}>
                                <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 4 }}></i>{error}
                            </div>
                        )}

                        {/* Section label */}
                        <div style={{ fontFamily: xpFont, fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#555', borderBottom: '1px solid #c0bdb5', paddingBottom: 3, marginBottom: 10 }}>
                            Factory Floor Actions
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {scannedWO.status === 'PENDING' && (
                                <button
                                    className={XP_BTN}
                                    style={xpBtn({ ...BTN_TONES.primary, padding: '10px 20px', fontSize: '14px', width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8 })}
                                    type="button"
                                    onClick={() => handleUpdate('IN_PROGRESS')}
                                >
                                    <i className="bi bi-play-fill" style={{ fontSize: 18 }}></i> START PRODUCTION
                                </button>
                            )}
                            {scannedWO.status === 'IN_PROGRESS' && (
                                <button
                                    className={XP_BTN}
                                    style={xpBtn({ ...BTN_TONES.success, padding: '10px 20px', fontSize: '14px', width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8 })}
                                    type="button"
                                    onClick={() => handleUpdate('COMPLETED')}
                                >
                                    <i className="bi bi-check-lg" style={{ fontSize: 18 }}></i> MARK AS COMPLETED
                                </button>
                            )}
                            {scannedWO.status === 'COMPLETED' && (
                                <div style={{ background: '#e8f5e9', border: '1px solid #2e7d32', padding: '20px', textAlign: 'center' }}>
                                    <i className="bi bi-check-circle-fill" style={{ color: '#2e7d32', fontSize: 32, display: 'block', marginBottom: 8 }}></i>
                                    <span style={{ fontFamily: xpFont, fontSize: '13px', fontWeight: 'bold', color: '#2e7d32' }}>PRODUCTION COMPLETE</span>
                                    <br />
                                    <span style={{ fontFamily: xpFont, fontSize: '11px', color: '#2e7d32', opacity: 0.85 }}>This order has been received into inventory.</span>
                                </div>
                            )}
                            <div style={{ textAlign: 'center', marginTop: 4 }}>
                                <button
                                    style={{ background: 'none', border: 'none', color: '#cc0000', cursor: 'pointer', fontFamily: xpFont, fontSize: '11px', textDecoration: 'underline', marginTop: 8 }}
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
            <div style={{ background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898', padding: '2px 8px', fontFamily: xpFont, fontSize: '10px', color: '#666', textAlign: 'center' }}>
                Terminal ID: {terminalId.current} | Secured by Terras Auth
            </div>
        </div>
    );

}
