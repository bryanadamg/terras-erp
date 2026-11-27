'use client';

import { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { StatusChip, xpFont as XP_FONT } from '../shared/xpTheme';
import { MOBILE_BG, MobilePanel, MobileScreenBar, MobileButton, MobileNotice } from './mobileTheme';
import MobileWOLogForm from './MobileWOLogForm';

interface MobileScannerViewProps {
    manufacturingOrders: any[];
    workCenters: any[];
    items: any[];
    authFetch: (url: string, options?: any) => Promise<Response>;
    /** WO id already decoded by the shared scanner — opens straight into the log form. */
    initialWOId?: string;
    onRefresh: () => Promise<void> | void;
    onClose: () => void;
}

const xpInset: React.CSSProperties = {
    border: '2px solid', borderColor: '#808080 #dfdfdf #dfdfdf #808080',
    background: '#ffffff', borderRadius: 0,
};

const isUUID = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export default function MobileScannerView({
    manufacturingOrders, initialWOId, onRefresh, onClose,
}: MobileScannerViewProps) {

    const [scannedWOId, setScannedWOId]         = useState<string | null>(initialWOId || null);
    const [error, setError]                     = useState<string | null>(null);

    const scannerRef = useRef<Html5QrcodeScanner | null>(null);
    const terminalId = useRef(Math.random().toString(36).substr(2, 6).toUpperCase());
    const audioCtxRef = useRef<AudioContext | null>(null);
    const scanLockRef = useRef(false);   // one beep / one transition per successful scan

    // Mobile autoplay policy: an AudioContext must be created/resumed inside a user
    // gesture before it can make sound. Unlock on the first tap (camera-permission tap
    // counts) so the scan beep is audible afterwards.
    useEffect(() => {
        const unlock = () => {
            try {
                const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
                if (!audioCtxRef.current && Ctx) audioCtxRef.current = new Ctx();
                audioCtxRef.current?.resume?.();
            } catch { /* audio unavailable — silent */ }
        };
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('touchstart', unlock);
        return () => {
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('touchstart', unlock);
        };
    }, []);

    const playBeep = () => {
        try {
            const ctx = audioCtxRef.current;
            if (ctx) {
                if (ctx.state === 'suspended') ctx.resume();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                osc.frequency.value = 880;
                gain.gain.setValueAtTime(0.0001, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
                osc.connect(gain).connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.2);
            }
        } catch { /* ignore */ }
        try { (navigator as any).vibrate?.(120); } catch { /* iOS: no-op */ }
    };

    // The MO list endpoint returns ROOT MOs only, with component/sub-assembly MOs nested
    // under `child_mos`. WO QR codes are printed for steps on every MO in the tree (e.g.
    // BEAMING/WEAVING/DYEING often live on consolidated component MOs), so flatten the whole
    // tree — otherwise only root-MO WO codes match and every other scan is silently rejected.
    const flattenMOs = (mos: any[]): any[] =>
        (mos || []).flatMap((mo: any) => [mo, ...flattenMOs(mo.child_mos || [])]);
    const allWOs = flattenMOs(manufacturingOrders).flatMap((mo: any) =>
        (mo.work_orders || []).map((wo: any) => ({ ...wo, _mo: mo }))
    );
    const scannedWO = scannedWOId
        ? (allWOs.find((wo: any) => wo.id === scannedWOId) || null)
        : null;
    const scannedWOParentMO = scannedWO?._mo || null;

    // Seeded from the shared scanner. A UUID that isn't in the loaded MO tree
    // would otherwise leave this screen blank — the camera effect is suppressed
    // while scannedWOId is set — so drop back to the camera with the reason.
    useEffect(() => {
        if (!initialWOId || scannedWOId !== initialWOId) return;
        if (allWOs.some((wo: any) => wo.id === scannedWOId)) return;
        setScannedWOId(null);
        setError(`WO "${initialWOId.slice(0, 8)}..." not found in active orders.`);
    }, [initialWOId, scannedWOId, manufacturingOrders]);

    const woTarget = scannedWO?.qty ?? 0;
    const woDone   = scannedWO?.qty_completed_total ?? 0;
    const woPct    = woTarget > 0 ? Math.min(100, Math.round((woDone / woTarget) * 100)) : 0;

    // Scanner lifecycle — active when no WO selected
    useEffect(() => {
        if (scannedWOId) return;

        const timer = setTimeout(() => {
            if (!document.getElementById('mobile-reader')) return;
            // Responsive box: fill ~70% of the smaller viewfinder side (min 180px) so the
            // target stays large on narrow phone screens — small fixed boxes are hard to fill.
            const qrbox = (vw: number, vh: number) => {
                const size = Math.max(180, Math.floor(Math.min(vw, vh) * 0.7));
                return { width: size, height: size };
            };
            const scanner = new Html5QrcodeScanner('mobile-reader', {
                fps: 10,
                qrbox,
                // Use the native BarcodeDetector where available (Android Chrome) — far more
                // reliable at locking onto a QR than the JS fallback decoder.
                useBarCodeDetectorIfSupported: true,
                // Factory floor: dark dye-houses need the torch.
                showTorchButtonIfSupported: true,
                // Rear camera + continuous autofocus + a sharp frame. Without these the
                // library starts a default low-res, fixed/hunting-focus stream → blurry
                // preview the decoder never reads. focusMode isn't in the TS MediaTrack
                // types but the lib only bans audio keys, so it's passed through verbatim.
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
                    if (scanLockRef.current) return;   // ignore extra frames after a match
                    if (!isUUID(decodedText)) {
                        // The shared scanner routes these prefixes on its own, so
                        // this branch only fires on a WO screen already open —
                        // point back at the entry rather than at a dead route.
                        const upper = decodedText.trim().toUpperCase();
                        if (upper.startsWith('PL-') || upper.startsWith('PK-') || upper.startsWith('PCK-') || upper.startsWith('PU-')) {
                            setError('That is a packing or pick code — tap Back, then scan it again.');
                            return;
                        }
                        setError('Not a valid Work Order QR code.');
                        return;
                    }
                    const found = allWOs.find((wo: any) => wo.id === decodedText);
                    if (found) {
                        scanLockRef.current = true;
                        playBeep();
                        setScannedWOId(found.id);
                        setError(null);
                        scanner.clear().catch(() => {});
                    } else {
                        setError(`WO "${decodedText.slice(0, 8)}..." not found in active orders.`);
                    }
                },
                () => {}
            );
        }, 100);

        return () => {
            clearTimeout(timer);
            scannerRef.current?.clear().catch(() => {});
        };
    }, [manufacturingOrders, scannedWOId]);

    const handleReset = () => {
        scanLockRef.current = false;
        setScannedWOId(null);
        setError(null);
    };

    return (
        <div style={{ background: MOBILE_BG, padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Terminal header — the same window bar every other screen wears.
                The Back action routes to the shared scanner: the only way to reach
                a pick or packing code once this screen owns the camera. */}
            <MobileScreenBar
                icon="bi-qr-code-scan"
                title="Operator Scan Terminal"
                meta={`ID: ${terminalId.current}`}
                right={<MobileButton compact icon="bi-arrow-left" onClick={onClose}>Back</MobileButton>}
            />

            {scannedWO && scannedWOParentMO ? (
                <>
                    {/* WO identity panel */}
                    <MobilePanel
                        icon="bi-clipboard-check-fill"
                        title="Work Order Step"
                        right={
                            <MobileButton compact icon="bi-arrow-repeat" onClick={handleReset}>Reset</MobileButton>
                        }
                        bodyStyle={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}
                    >
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontFamily: XP_FONT, fontSize: 16, fontWeight: 'bold', color: '#000080', lineHeight: 1.2 }}>{scannedWO.name}</div>
                            <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#555', marginTop: 2 }}>
                                {scannedWOParentMO.code} — {scannedWOParentMO.item_name || ''}
                                {scannedWO.work_center_name && <span style={{ marginLeft: 6 }}>| {scannedWO.work_center_name}</span>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                                <StatusChip status={scannedWO.status} />
                                {woTarget > 0 && <span style={{ fontFamily: XP_FONT, fontSize: 11, color: '#555' }}>Target: {woTarget} | Done: {woDone.toFixed(2)}</span>}
                            </div>
                            <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#555', marginTop: 2 }}>
                                MO: {(scannedWOParentMO.qty_completed_total ?? 0).toFixed(2)} / {scannedWOParentMO.qty ?? 0}
                                {' · '}sisa WO <strong style={{ color: '#b46a00' }}>{Math.max(0, woTarget - woDone).toFixed(2)}</strong>
                            </div>
                            {woTarget > 0 && (
                                <div style={{ marginTop: 6 }}>
                                    <div style={{ border: '1px solid #7f9db9', height: 12, background: '#fff', position: 'relative', overflow: 'hidden' }}>
                                        <div style={{
                                            height: '100%', width: `${woPct}%`,
                                            background: woPct >= 100
                                                ? 'repeating-linear-gradient(45deg, #2e7d32, #2e7d32 4px, #4caf50 4px, #4caf50 8px)'
                                                : 'repeating-linear-gradient(45deg, #000080, #000080 4px, #1565c0 4px, #1565c0 8px)',
                                            transition: 'width 0.2s',
                                        }} />
                                        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 'bold', color: woPct > 50 ? '#fff' : '#000080', textShadow: woPct > 50 ? '0 0 3px rgba(0,0,0,0.8)' : 'none' }}>
                                            {woDone.toFixed(2)} / {woTarget} ({woPct}%)
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </MobilePanel>

                    {/* The log itself — same rules as the desktop log (useWOLogForm). Keyed
                        on the WO so a new scan starts a clean form. */}
                    <MobileWOLogForm key={scannedWO.id} mo={scannedWOParentMO} wo={scannedWO} onRefresh={onRefresh} />
                </>

            ) : (
                <>
                    {/* Scanner idle view */}
                    <MobilePanel icon="bi-camera-fill" title="Ready to Scan">
                        <div style={{ ...xpInset, overflow: 'hidden' }}>
                            <div id="mobile-reader" style={{ width: '100%' }} />
                        </div>
                        <div style={{ textAlign: 'center', fontFamily: XP_FONT, fontSize: 11, color: '#666', marginTop: 6 }}>
                            Point camera at a Work Order QR code (Kartu Kerja)
                        </div>
                    </MobilePanel>

                    {error && (
                        <MobileNotice tone="red" style={{ borderLeftWidth: 4, marginBottom: 0 }}>
                            <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 5 }}></i>{error}
                        </MobileNotice>
                    )}
                </>
            )}
        </div>
    );
}
