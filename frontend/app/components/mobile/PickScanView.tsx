'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { StatusChip, xpFont as XP_FONT, xpInput as xpInputBase } from '../shared/xpTheme';
import { MOBILE_BG, MobilePanel, MobileScreenBar, MobileButton, MobileNotice } from './mobileTheme';
import { LotChips } from '../shared/LotChips';
import { API_BASE } from '../shared/apiBase';

const xpInput: React.CSSProperties = xpInputBase({ fontSize: 13, height: 'auto', padding: '6px 8px', width: '100%', boxSizing: 'border-box' });

// Heading for a second group INSIDE a panel — a panel's own heading is its blue
// title bar; this is the tier below it.
const subLabel: React.CSSProperties = {
    fontFamily: XP_FONT, fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase',
    letterSpacing: 0.5, color: '#555', borderBottom: '1px solid #c0bdb5',
    paddingBottom: 3, marginBottom: 6, marginTop: 12,
};

const num = (v: any) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

function playBeep(ok = true) {
    try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        // A rejected scan must not sound like an accepted one — the picker is
        // watching the carton, not the screen.
        osc.frequency.value = ok ? 880 : 220;
        osc.connect(ctx.destination);
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, ok ? 120 : 260);
    } catch { /* no audio on this device */ }
}

/**
 * Mobile pick scanner — the floor half of a pick list.
 *
 * Separate from both the WO ScannerView (built around BOM material rows) and
 * PackingScanView (built around a qty form): the picker's loop is scan-scan-scan
 * with no data entry, so the camera comes straight back after every carton
 * instead of staying down for a form.
 *
 * All the rules live server-side in POST /pick-lists/{id}/scan — already on
 * another list, wrong quality, not on this SO, not a carton. This screen renders
 * the server's own `detail` string rather than re-deciding any of it, so the
 * floor and the API can never disagree about why a box was refused.
 */
export default function PickScanView({ authFetch, initialCode, onClose }: { authFetch: (url: string, options?: any) => Promise<Response>; initialCode?: string; onClose: () => void }) {
    const [pl, setPl] = useState<any | null>(null);
    const [unit, setUnit] = useState<any | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const [manualCode, setManualCode] = useState('');
    const [busy, setBusy] = useState(false);
    const scannerRef = useRef<Html5QrcodeScanner | null>(null);
    const scanLockRef = useRef(false);
    // Latest pick list, readable from the scan callback without re-registering
    // the camera on every state change (which would tear the stream down between
    // cartons and make the loop unusable).
    const plRef = useRef<any | null>(null);
    useEffect(() => { plRef.current = pl; }, [pl]);

    const scanCarton = useCallback(async (code: string, target: any) => {
        setBusy(true);
        try {
            const res = await authFetch(`${API_BASE}/pick-lists/${target.id}/scan`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            });
            if (res.ok) {
                const fresh = await res.json();
                setPl(fresh);
                setError(null);
                setFlash(code.toUpperCase());
                playBeep(true);
            } else {
                const e = await res.json().catch(() => ({}));
                setFlash(null);
                setError(e.detail || `Could not pick ${code}.`);
                playBeep(false);
            }
        } finally { setBusy(false); }
    }, [authFetch]);

    const resolveCode = useCallback(async (raw: string) => {
        const code = raw.trim();
        if (!code) return;
        const upper = code.toUpperCase();
        const open = plRef.current;

        // A carton scanned with a list open is a pick. The same code with no list
        // open is a question — "what is this box?" — so it reports instead.
        if (upper.startsWith('PU-')) {
            if (open) { await scanCarton(code, open); return; }
            const res = await authFetch(`${API_BASE}/packing/packed-units/resolve?code=${encodeURIComponent(code)}`);
            if (res.ok) { setUnit(await res.json()); setError(null); playBeep(true); }
            else { const e = await res.json().catch(() => ({})); setError(e.detail || `Carton "${code}" not found.`); playBeep(false); }
            return;
        }

        // PK- is the legacy prefix these rows carried when the table was
        // packing_orders; the codes still exist on old lists, so accept both.
        if (upper.startsWith('PL-') || upper.startsWith('PK-')) {
            const res = await authFetch(`${API_BASE}/pick-lists/resolve?code=${encodeURIComponent(code)}`);
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                setError(e.detail || `Pick list "${code}" not found.`);
                playBeep(false);
                return;
            }
            const found = await res.json();
            if (found.status === 'DISPATCHED' || found.status === 'CANCELLED') {
                setError(`Pick list ${found.code} is ${found.status}.`);
                playBeep(false);
                return;
            }
            setPl(found);
            setUnit(null);
            setError(null);
            setFlash(null);
            playBeep(true);
            return;
        }

        if (upper.startsWith('PCK-')) {
            setError('That is a packing order — tap Back, then scan it again to open Packing.');
            playBeep(false);
            return;
        }
        setError('Not a pick QR code. Expected PL- (pick list) or PU- (carton).');
        playBeep(false);
    }, [authFetch, scanCarton]);

    // Opened from the shared scanner: that screen already decoded the label, so
    // act on it here instead of making the floor scan the same box twice.
    const seededRef = useRef(false);
    useEffect(() => {
        if (!initialCode || seededRef.current) return;
        seededRef.current = true;
        resolveCode(initialCode);
    }, [initialCode, resolveCode]);

    // Camera runs whenever a carton report is not on screen. Unlike the packing
    // scanner it stays up while a pick list is open — that is the scan loop.
    useEffect(() => {
        if (unit) return;
        const timer = setTimeout(() => {
            const qrbox = (vw: number, vh: number) => {
                const size = Math.floor(Math.min(vw, vh) * 0.7);
                return { width: size, height: size };
            };
            const scanner = new Html5QrcodeScanner('pick-reader', {
                fps: 10,
                qrbox,
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
                    // Without the lock the decoder fires the same frame several
                    // times and the same carton posts two or three scans.
                    if (scanLockRef.current) return;
                    scanLockRef.current = true;
                    resolveCode(decodedText).finally(() => {
                        // 900ms is roughly how long it takes to move the phone off
                        // one label and onto the next — short enough not to be felt,
                        // long enough that the old label cannot re-trigger.
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
    }, [unit, resolveCode]);

    const lines: any[] = pl?.lines || [];
    const cartons = useMemo(() => lines.filter((l: any) => l.batch_id), [lines]);
    const pending = useMemo(() => cartons.filter((l: any) => !l.picked_at), [cartons]);
    const picked = useMemo(
        () => cartons.filter((l: any) => l.picked_at).sort((a, b) => String(b.picked_at).localeCompare(String(a.picked_at))),
        [cartons],
    );
    const pct = cartons.length ? Math.round(picked.length / cartons.length * 100) : 0;
    const done = cartons.length > 0 && pending.length === 0;

    const reset = () => { setPl(null); setUnit(null); setError(null); setFlash(null); setManualCode(''); };

    return (
        <div style={{ fontFamily: XP_FONT, background: MOBILE_BG, minHeight: 'var(--app-vh)', padding: 10 }}>
            <MobileScreenBar
                icon="bi-upc-scan"
                title="Pick Scanner"
                right={<MobileButton compact icon="bi-arrow-left" onClick={onClose}>Back</MobileButton>}
            />

            {error && (
                <MobileNotice tone="red" strong>{error}</MobileNotice>
            )}
            {!error && flash && (
                <MobileNotice tone="green" strong>Picked {flash}</MobileNotice>
            )}

            {pl && (
                <MobilePanel
                    icon="bi-list-check"
                    title={pl.code}
                    right={<StatusChip status={pl.status} />}
                    style={{ marginBottom: 10 }}
                >
                    <div style={{ fontSize: 12, color: '#333' }}>
                        {pl.sales_order_code || '—'} · {pl.customer_name || '—'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <div style={{ flex: 1, height: 14, background: '#e6e4dc', border: '1px solid #aca899' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: done ? '#4caf50' : '#5b8dd6' }} />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                            {picked.length} / {cartons.length}
                        </span>
                    </div>
                    {done && (
                        <MobileNotice tone="green" style={{ marginTop: 8, marginBottom: 0 }}>
                            All cartons scanned. Hand to QC — dispatch and the Surat Jalan are done on the desktop.
                        </MobileNotice>
                    )}
                    <MobileButton icon="bi-x-lg" onClick={reset} style={{ marginTop: 10 }}>Close list</MobileButton>
                </MobilePanel>
            )}

            {unit ? (
                <MobilePanel icon="bi-box2-fill" title={`Carton ${unit.batch_number}`}>
                    <Row label="Item" value={`${unit.item_name || ''} (${unit.item_code || ''})`} />
                    {/* What is actually in the box: shade/combo off the carton's stock
                        key, size stamped on it at packing. The whole point of the
                        report is telling two same-item cartons apart. */}
                    <div style={{ margin: '2px 0 6px' }}><LotChips batch={unit} /></div>
                    <Row label="Carton no." value={String(unit.package_no ?? '—')} />
                    <Row label="Qty in stock" value={num(unit.qty).toLocaleString()} />
                    <Row label="Location" value={unit.location_name || '—'} />
                    <Row label="Packing order" value={unit.packing_order_code || '—'} />
                    <Row label="Quality" value={unit.quality_status} />
                    <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
                        Scan a pick list first to pick this carton onto an order.
                    </div>
                    <MobileButton icon="bi-upc-scan" onClick={reset} style={{ marginTop: 10 }}>Scan another</MobileButton>
                </MobilePanel>
            ) : (
                <>
                    <MobilePanel
                        icon="bi-camera-fill"
                        title={pl ? 'Scan cartons' : 'Scan'}
                        style={{ marginBottom: 10, opacity: busy ? 0.6 : 1 }}
                    >
                        <div id="pick-reader" style={{ width: '100%' }} />
                    </MobilePanel>
                    <MobilePanel icon="bi-keyboard-fill" title="Or type a code" style={{ marginBottom: 10 }}>
                        {/* Also the USB-wedge path: a keyboard-emulating scanner types
                            the code here and submits with Enter. */}
                        <input
                            style={xpInput}
                            placeholder={pl ? 'PU-20260802-0001' : 'PL-00001 or PU-20260802-0001'}
                            value={manualCode}
                            onChange={e => setManualCode(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { resolveCode(manualCode); setManualCode(''); } }}
                        />
                        <MobileButton
                            tone="launch"
                            icon="bi-arrow-return-left"
                            onClick={() => { resolveCode(manualCode); setManualCode(''); }}
                            style={{ marginTop: 8 }}
                        >
                            {pl ? 'Pick' : 'Open'}
                        </MobileButton>
                    </MobilePanel>
                </>
            )}

            {pl && cartons.length > 0 && (
                <MobilePanel
                    icon="bi-box-seam"
                    title={`Pending (${pending.length})`}
                    tone={pending.length === 0 ? 'green' : 'blue'}
                    right={<span style={{ fontFamily: XP_FONT, fontSize: 11 }}>{picked.length}/{cartons.length} scanned</span>}
                >
                    {pending.length === 0
                        ? <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic' }}>Nothing left to scan.</div>
                        : pending.map((l: any) => (
                            <CartonRow key={l.id} line={l} />
                        ))}
                    {picked.length > 0 && (
                        <>
                            <div style={subLabel}>Scanned ({picked.length})</div>
                            {picked.map((l: any) => (
                                <CartonRow key={l.id} line={l} done />
                            ))}
                        </>
                    )}
                </MobilePanel>
            )}
        </div>
    );
}

function CartonRow({ line, done }: { line: any; done?: boolean }) {
    return (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8,
            padding: '5px 6px', marginBottom: 3, fontSize: 12,
            background: done ? '#eef7ee' : '#fff',
            border: `1px solid ${done ? '#b6d7b6' : '#ddd9d0'}`,
        }}>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 'bold', color: done ? '#0a3e0a' : '#00309c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {done ? '✓ ' : ''}{line.batch_number || 'bulk line'}
                </div>
                <div style={{ fontSize: 11, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {line.item_code || ''}{line.picked_by ? ` · ${line.picked_by}` : ''}
                </div>
            </div>
            <div style={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                {num(line.qty_picked).toLocaleString()} {line.item_uom || ''}
            </div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '2px 0' }}>
            <span style={{ color: '#555' }}>{label}</span>
            <span style={{ fontWeight: 'bold', textAlign: 'right' }}>{value}</span>
        </div>
    );
}
