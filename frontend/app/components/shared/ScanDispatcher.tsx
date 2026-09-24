'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useData } from '../../context/DataContext';
import { useUser } from '../../context/UserContext';
import { useToast } from './Toast';
import { useIsMobile } from '../../hooks/useIsMobile';
import { xpFont as XP_FONT, XPLoading, xpInput as xpInputBase } from './xpTheme';
import { MOBILE_BG, MobilePanel, MobileScreenBar, MobileButton, MobileNotice } from '../mobile/mobileTheme';
import { API_BASE } from './apiBase';

// One camera per session: the branch views are only mounted after a code has
// already been decoded here, so their own readers never race this one.
const MobileScannerView = dynamic(() => import('../mobile/ScannerView'), { ssr: false });
const QRScannerView = dynamic(() => import('./QRScannerView'), { ssr: false });
const PickScanView = dynamic(() => import('../mobile/PickScanView'), { ssr: false });
const PackingScanView = dynamic(() => import('../mobile/PackingScanView'), { ssr: false });


// Same local shape PickScanView/PackingScanView/MobileScannerView each keep —
// mobileTheme doesn't centralize the raw input face, only the panel/button chrome.
const xpInput: React.CSSProperties = xpInputBase({ fontSize: 13, height: 'auto', padding: '6px 8px', width: '100%', boxSizing: 'border-box' });

const isUUID = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

type ScanMode = 'wo' | 'pick' | 'packing';

interface Branch {
    mode: ScanMode;
    /** ANY of these opens the branch; empty = open to any authenticated user. */
    permissions: string[];
    /** Shown when the scan is valid but the user is not allowed to act on it. */
    denied: string;
}

/**
 * Which screen a decoded code belongs to. The prefixes are already disjoint —
 * a WO QR is a bare UUID, everything else is a typed document code — so the
 * routing is total and needs no user choice.
 *
 * PU- (a carton) goes to the pick screen rather than packing: with a pick list
 * open it picks the carton, and with nothing open both screens do the identical
 * "what is this box" report, so pick is the strictly larger behaviour.
 */
const BRANCHES: Record<ScanMode, Branch> = {
    wo: { mode: 'wo', permissions: [], denied: '' },
    pick: {
        mode: 'pick',
        permissions: ['pick_list.scan', 'sales.manage'],
        denied: 'That is a pick code, but your account cannot pick.',
    },
    packing: {
        mode: 'packing',
        permissions: ['sales.manage'],
        denied: 'That is a packing code, but your account cannot pack.',
    },
};

function classify(raw: string): { mode: ScanMode; code: string } | null {
    const code = raw.trim();
    if (!code) return null;
    const upper = code.toUpperCase();
    if (isUUID(code)) return { mode: 'wo', code };
    // PK- is the legacy pick-list prefix from when the table was packing_orders.
    if (upper.startsWith('PL-') || upper.startsWith('PK-')) return { mode: 'pick', code };
    if (upper.startsWith('PU-')) return { mode: 'pick', code };
    if (upper.startsWith('PCK-')) return { mode: 'packing', code };
    return null;
}

/**
 * The single scan entry point for the whole app.
 *
 * Every floor code — WO QR (UUID), PL-/PK- pick list, PU- carton, PCK- packing
 * order — is decoded here and handed to whichever screen owns it. Before this
 * existed there were three camera pages and the floor had to know which one a
 * label belonged to; each page could already *recognise* the other two's codes,
 * it just refused them with a "go to /pick-scan" string instead of going there.
 *
 * The branch screens keep their own post-scan loops (WO: material form; pick:
 * scan-scan-scan with the camera never leaving; packing: qty form) — those are
 * genuinely different jobs. Only the entry is shared.
 *
 * Nothing is prefetched here on purpose. The WO screen needs the whole MO tree
 * plus BOMs and stock balances, which used to load before the camera opened and
 * made a picker wait on manufacturing data to scan a carton. That fetch now runs
 * only after a UUID actually lands.
 */
export default function ScanDispatcher({ onClose }: { onClose: () => void }) {
    const { items, boms, locations, attributes, stockBalance, workCenters, fetchData, authFetch } = useData() as any;
    const { hasAnyPermission } = useUser();
    const { showToast } = useToast();
    const isMobile = useIsMobile();

    const [mode, setMode] = useState<ScanMode | null>(null);
    const [seedCode, setSeedCode] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [manualCode, setManualCode] = useState('');

    // WO payload — fetched lazily, only once a WO code has been scanned.
    const [woLoading, setWoLoading] = useState(false);
    const [localMOs, setLocalMOs] = useState<any[]>([]);
    const [localBoms, setLocalBoms] = useState<any[]>([]);
    const [localStockBalance, setLocalStockBalance] = useState<any[]>([]);

    const scannerRef = useRef<Html5QrcodeScanner | null>(null);
    const scanLockRef = useRef(false);

    const loadWOData = useCallback(async () => {
        const [moRes, bomsRes, balanceRes] = await Promise.all([
            // all_levels=true so consolidated shared-component MOs (parent_mo_id=None,
            // is_shared_component=True, linked via MODependency) are returned too — their
            // WO QR codes are scanned on the floor but they're absent from the root tree.
            authFetch(`${API_BASE}/manufacturing-orders?skip=0&limit=9999&all_levels=true`),
            authFetch(`${API_BASE}/boms`),
            authFetch(`${API_BASE}/stock/balance`),
        ]);
        if (moRes.ok) { const d = await moRes.json(); setLocalMOs(Array.isArray(d) ? d : (d.items || [])); }
        if (bomsRes.ok) { setLocalBoms(await bomsRes.json()); }
        if (balanceRes.ok) { setLocalStockBalance(await balanceRes.json()); }
    }, [authFetch]);

    const route = useCallback(async (raw: string) => {
        const hit = classify(raw);
        if (!hit) {
            setError(`"${raw.trim().slice(0, 24)}" is not a code this app prints. Expected a Work Order QR, PL- (pick list), PU- (carton) or PCK- (packing order).`);
            return;
        }
        const branch = BRANCHES[hit.mode];
        if (branch.permissions.length && !hasAnyPermission(...branch.permissions)) {
            setError(branch.denied);
            return;
        }
        setError(null);
        setSeedCode(hit.code);
        if (hit.mode === 'wo') {
            // Tear the camera down first: the WO screen opens its own once the
            // data lands, and two live streams on one page fight for the device.
            setWoLoading(true);
            await scannerRef.current?.clear().catch(() => {});
            scannerRef.current = null;
            try { await loadWOData(); } finally { setWoLoading(false); }
        }
        setMode(hit.mode);
    }, [hasAnyPermission, loadWOData]);

    // Camera runs only while no branch has taken over.
    useEffect(() => {
        if (mode || woLoading) return;
        const timer = setTimeout(() => {
            if (!document.getElementById('scan-dispatch-reader')) return;
            const qrbox = (vw: number, vh: number) => {
                const size = Math.max(180, Math.floor(Math.min(vw, vh) * 0.7));
                return { width: size, height: size };
            };
            const scanner = new Html5QrcodeScanner('scan-dispatch-reader', {
                fps: 10,
                qrbox,
                // Native BarcodeDetector (Android Chrome) beats the JS decoder;
                // torch matters in a dark dye-house; continuous focus at 720p
                // stops the library opening a blurry fixed-focus stream.
                useBarCodeDetectorIfSupported: true,
                showTorchButtonIfSupported: true,
                videoConstraints: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    focusMode: 'continuous',
                    advanced: [{ focusMode: 'continuous' } as any],
                } as MediaTrackConstraints,
            }, false);
            scannerRef.current = scanner;
            scanLockRef.current = false;
            scanner.render(
                (decodedText: string) => {
                    if (scanLockRef.current) return;   // decoder repeats the same frame
                    scanLockRef.current = true;
                    route(decodedText).finally(() => {
                        setTimeout(() => { scanLockRef.current = false; }, 900);
                    });
                },
                () => {}
            );
        }, 100);
        return () => {
            clearTimeout(timer);
            scannerRef.current?.clear().catch(() => {});
        };
    }, [mode, woLoading, route]);

    const back = useCallback(() => {
        setMode(null);
        setSeedCode(null);
        setError(null);
        setManualCode('');
    }, []);

    const handleUpdateWOStatus = async (woId: string, status: string) => {
        const res = await authFetch(`${API_BASE}/work-orders/${woId}/status?status=${status}`, { method: 'PUT' });
        if (res.ok) { fetchData(); return true; }
        const err = await res.json().catch(() => ({}));
        showToast(`Error: ${err.detail}`, 'danger');
        return false;
    };

    if (mode === 'pick') {
        return <PickScanView authFetch={authFetch} initialCode={seedCode || undefined} onClose={back} />;
    }
    if (mode === 'packing') {
        return <PackingScanView authFetch={authFetch} initialCode={seedCode || undefined} onClose={back} />;
    }
    if (mode === 'wo') {
        if (isMobile) {
            return (
                <MobileScannerView
                    manufacturingOrders={localMOs}
                    workCenters={workCenters}
                    items={items || []}
                    authFetch={authFetch}
                    initialWOId={seedCode || undefined}
                    onRefresh={loadWOData}
                    onClose={back}
                />
            );
        }
        return (
            // ui-scale-exempt: html5-qrcode sizes the camera viewfinder and its scan
            // overlay from its own element measurements, which the interface zoom
            // would skew. A camera view wants 1:1 anyway.
            <div className="container-fluid py-2 h-100 ui-scale-exempt">
                <div className="row justify-content-center">
                    <div className="col-md-8 col-lg-6">
                        <QRScannerView
                            workOrders={localMOs}
                            items={items}
                            boms={localBoms}
                            locations={locations}
                            attributes={attributes}
                            stockBalance={localStockBalance}
                            initialWOId={seedCode || undefined}
                            onUpdateStatus={handleUpdateWOStatus}
                            onClose={back}
                        />
                    </div>
                </div>
            </div>
        );
    }

    if (woLoading) return <XPLoading label="Loading work order..." />;

    return (
        <div className="ui-scale-exempt" style={{ fontFamily: XP_FONT, background: MOBILE_BG, minHeight: 'var(--app-vh)', padding: 10 }}>
            <div style={{ maxWidth: 520, margin: '0 auto' }}>
                <MobileScreenBar
                    icon="bi-qr-code-scan"
                    title="Scanner"
                    right={<MobileButton compact icon="bi-x-lg" onClick={onClose}>Close</MobileButton>}
                />

                {error && <MobileNotice tone="red" strong>{error}</MobileNotice>}

                <MobilePanel icon="bi-camera-fill" title="Scan" style={{ marginBottom: 10 }}>
                    <div id="scan-dispatch-reader" style={{ width: '100%' }} />
                </MobilePanel>

                <MobilePanel icon="bi-keyboard-fill" title="Or type a code" style={{ marginBottom: 10 }}>
                    {/* Also the USB-wedge path: a keyboard-emulating scanner types
                        the code here and submits with Enter. */}
                    <input
                        style={xpInput}
                        placeholder="PL-00001, PU-20260802-0001, PCK-00001"
                        value={manualCode}
                        onChange={e => setManualCode(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { route(manualCode); setManualCode(''); } }}
                    />
                    <MobileButton
                        tone="launch"
                        icon="bi-arrow-return-left"
                        onClick={() => { route(manualCode); setManualCode(''); }}
                        style={{ marginTop: 8 }}
                    >
                        Open
                    </MobileButton>
                </MobilePanel>

                <MobilePanel icon="bi-info-circle" title="This scanner opens" tone="grey">
                    <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#555', lineHeight: 1.7 }}>
                        <div><strong>Kartu Kerja QR</strong> — log production on a work order</div>
                        <div><strong>PL-</strong> pick list — pick cartons onto an order</div>
                        <div><strong>PU-</strong> carton label — pick it, or identify it</div>
                        <div><strong>PCK-</strong> packing order — log cartons packed</div>
                    </div>
                </MobilePanel>
            </div>
        </div>
    );
}
