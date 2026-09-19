'use client';

import { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { StatusChip, xpFont as XP_FONT, CHIP_RADIUS, xpInput as xpInputBase } from '../shared/xpTheme';
import { MOBILE_BG, MobilePanel, MobileScreenBar, MobileButton, MobileNotice } from './mobileTheme';

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

interface MaterialRow {
    item_id: string;
    item_name: string;
    item_code: string;
    planned_pct: number;
    actual_qty: string;
    is_custom: boolean;
    is_substitute: boolean;
    orig_item_id: string;
    orig_item_name: string;
    orig_item_code: string;
}

const xpInset: React.CSSProperties = {
    border: '2px solid', borderColor: '#808080 #dfdfdf #dfdfdf #808080',
    background: '#ffffff', borderRadius: 0,
};

// Heading for a second group INSIDE a panel — a panel's own heading is its blue
// title bar; this is the tier below it.
const subLabel: React.CSSProperties = {
    fontFamily: XP_FONT, fontSize: 10, fontWeight: 'bold',
    textTransform: 'uppercase', letterSpacing: 0.5, color: '#555',
    borderBottom: '1px solid #c0bdb5', paddingBottom: 3, marginBottom: 8,
};

const xpInput: React.CSSProperties = xpInputBase({ fontSize: 13, height: 'auto', padding: '6px 8px', width: '100%', boxSizing: 'border-box' });

const isUUID = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export default function MobileScannerView({
    manufacturingOrders, workCenters, items, authFetch, initialWOId, onRefresh, onClose,
}: MobileScannerViewProps) {
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const [scannedWOId, setScannedWOId]         = useState<string | null>(initialWOId || null);
    const [logQty, setLogQty]                   = useState('');
    const [logOperator, setLogOperator]         = useState('');
    const [logNotes, setLogNotes]               = useState('');
    const [logWorkCenterId, setLogWorkCenterId] = useState('');
    const [materialRows, setMaterialRows]       = useState<MaterialRow[]>([]);
    const [submittingLog, setSubmittingLog]     = useState(false);
    const [logSuccess, setLogSuccess]           = useState('');
    const [logError, setLogError]               = useState('');
    const [error, setError]                     = useState<string | null>(null);
    const [subPickerIdx, setSubPickerIdx]       = useState<number | null>(null);
    const [subQuery, setSubQuery]               = useState('');
    const [beamNumber, setBeamNumber]           = useState('');
    const [batchesByItem, setBatchesByItem]     = useState<Record<string, any[]>>({});
    // Lots on this line staged to a DIFFERENT WO — kept out of batchesByItem so the
    // consumption checks never count a neighbour's bags, shown read-only so the
    // operator learns why a bag in the rack isn't in the list.
    const [reservedByItem, setReservedByItem]   = useState<Record<string, any[]>>({});
    const [consumedBatches, setConsumedBatches] = useState<Record<string, string>>({});

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

    const findItem = (itemId: string) => (items || []).find((i: any) => i.id === itemId);
    const isBeamItem = (itemId: string) => {
        const it = findItem(itemId);
        return (it?.category_path || []).some((p: string) => (p || '').toLowerCase() === 'beam');
    };
    // Lot output: WO produces a beam (Beam category / BEAM- code / BEAMING work center) or a lot-tracked item
    const woWcType = ((workCenters || []).find((wc: any) => wc.id === scannedWO?.work_center_id)?.center_type || '').toUpperCase();
    const isBeamOutput = !!scannedWO && !!scannedWOParentMO
        && (isBeamItem(scannedWOParentMO.item_id) || (scannedWOParentMO.item_code || '').startsWith('BEAM-') || woWcType === 'BEAMING');
    const isLotOutput = isBeamOutput || (!!scannedWO && !!scannedWOParentMO && !!findItem(scannedWOParentMO.item_id)?.lot_tracked);
    const isWeavingWO = woWcType === 'WEAVING' || woWcType === 'TENUN';
    const isDyeingWO = woWcType === 'DYEING' || woWcType === 'CELUP';

    // Lot input: each material line with batch stock at the input location gets a lot picker
    const materialItemIds = scannedWO ? Array.from(new Set(materialRows.map(r => r.item_id))) : [];
    useEffect(() => {
        if (!materialItemIds.length) { setBatchesByItem({}); setReservedByItem({}); setConsumedBatches({}); return; }
        const loc = scannedWO?.input_location_id;
        Promise.all(materialItemIds.map(id =>
            authFetch(`${API_BASE}/batches?item_id=${id}${loc ? `&location_id=${loc}` : ''}&limit=200`)
                .then((r: Response) => (r.ok ? r.json() : []))
                .catch(() => [])
                .then((data: any[]) => [id, (data || []).filter((b: any) => (b.remaining ?? 0) > 0 && b.quality_status !== 'REJECTED')] as const)
        )).then(pairs => {
            const map: Record<string, any[]> = {};
            const held: Record<string, any[]> = {};
            for (const [id, list] of pairs) {
                if (!list.length) continue;
                // Weaving consumes from the merged kg pool — staged beams are
                // consumed at WO start, so no per-beam pick here.
                if (isWeavingWO && (isBeamItem(id) || list.every((b: any) => b.ends != null))) continue;
                // Staged to another WO = that WO's material. The backend rejects it,
                // so it is listed read-only rather than offered (see staging_service).
                const mine = list.filter((b: any) => !b.reserved_wo_id || String(b.reserved_wo_id) === String(scannedWO?.id));
                const theirs = list.filter((b: any) => b.reserved_wo_id && String(b.reserved_wo_id) !== String(scannedWO?.id));
                if (theirs.length) held[id] = theirs;
                if (mine.length) map[id] = mine;
            }
            setBatchesByItem(map);
            setReservedByItem(held);
            setConsumedBatches(prev => {
                const next: Record<string, string> = {};
                for (const id of Object.keys(map)) { if (prev[id]) next[id] = prev[id]; }
                return next;
            });
        });
    }, [JSON.stringify(materialItemIds), scannedWOId, isWeavingWO]);

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

    // Build material rows from BOM when WO scanned
    useEffect(() => {
        if (!scannedWOId || !scannedWOParentMO) return;
        const bomLines: any[] = scannedWOParentMO.bom?.lines || [];
        setMaterialRows(bomLines.map((line: any) => ({
            item_id: line.item_id,
            item_name: line.item_name || '',
            item_code: line.item_code || '',
            planned_pct: parseFloat(line.percentage) || 0,
            actual_qty: '',
            is_custom: false,
            is_substitute: false,
            orig_item_id: line.item_id,
            orig_item_name: line.item_name || '',
            orig_item_code: line.item_code || '',
        })));
        setLogQty('');
        setLogOperator('');
        setLogNotes('');
        setLogWorkCenterId('');
        setLogSuccess('');
        setLogError('');
        setSubPickerIdx(null);
        setSubQuery('');
        setBeamNumber('');
        setConsumedBatches({});
    }, [scannedWOId]);

    // Recalculate planned actuals when output qty changes
    useEffect(() => {
        const qty = parseFloat(logQty);
        if (!qty || qty <= 0) return;
        setMaterialRows(prev => prev.map(row => {
            if (row.is_custom) return row;
            const planned = (qty * row.planned_pct) / 100;
            return { ...row, actual_qty: planned.toFixed(4) };
        }));
    }, [logQty]);

    const handleReset = () => {
        scanLockRef.current = false;
        setScannedWOId(null);
        setError(null);
        setLogSuccess('');
        setLogError('');
    };

    const handleLogWO = async () => {
        setLogError('');
        setLogSuccess('');
        const qty = parseFloat(logQty);
        if (!qty || qty <= 0) { setLogError('Enter a positive quantity'); return; }
        if (!scannedWO || !scannedWOParentMO) return;

        for (const row of materialRows) {
            const v = parseFloat(row.actual_qty);
            if (isNaN(v) || v < 0) {
                setLogError(`Invalid quantity for ${row.item_code || row.item_name}`);
                return;
            }
        }
        for (const itemId of Object.keys(batchesByItem)) {
            if (!consumedBatches[itemId]) {
                setLogError(`Pilih lot/beam untuk ${findItem(itemId)?.code || 'material'}`);
                return;
            }
        }

        setSubmittingLog(true);
        try {
            const actualItems = materialRows
                .filter(row => parseFloat(row.actual_qty) > 0)
                .map(row => ({ item_id: row.item_id, qty_used: parseFloat(row.actual_qty) }));

            const res = await authFetch(`${API_BASE}/manufacturing-orders/${scannedWOParentMO.id}/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    qty_completed: qty,
                    operator_name: logOperator || null,
                    notes: logNotes || null,
                    work_center_id: logWorkCenterId || null,
                    work_order_id: scannedWO.id,
                    actual_items: actualItems,
                    beam_number: isLotOutput ? (beamNumber.trim() || null) : null,
                    consumed_batches: Object.values(consumedBatches).filter(Boolean),
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to log');
            }
            const updated = await res.json();
            const newTotal = (updated.qty_completed_total ?? 0).toFixed(2);
            setLogSuccess(`Logged ${qty} — MO total: ${newTotal} / ${scannedWOParentMO.qty}`);
            setLogQty('');
            setLogNotes('');
            setBeamNumber('');
            setConsumedBatches({});
            setMaterialRows(prev => prev.map(r => ({ ...r, actual_qty: '', is_custom: false })));
            await onRefresh();
        } catch (err: any) {
            setLogError(err.message);
        } finally {
            setSubmittingLog(false);
        }
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

                    {logSuccess && (
                        <MobileNotice tone="green" style={{ borderLeftWidth: 4, marginBottom: 0 }}>
                            <i className="bi bi-check-circle-fill" style={{ marginRight: 5 }}></i>{logSuccess}
                        </MobileNotice>
                    )}
                    {logError && (
                        <MobileNotice tone="red" style={{ borderLeftWidth: 4, marginBottom: 0 }}>
                            <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 5 }}></i>{logError}
                        </MobileNotice>
                    )}

                    {/* Log form */}
                    <MobilePanel icon="bi-pencil-square" title="Log Hasil Produksi">

                        {/* Qty */}
                        <div style={{ marginBottom: 10 }}>
                            <div style={{ fontFamily: XP_FONT, fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>Qty Aktual Diproduksi</div>
                            <input
                                type="number" inputMode="decimal" min="0.0001" step="any" autoFocus
                                value={logQty} onChange={e => setLogQty(e.target.value)}
                                placeholder="Masukkan qty aktual..."
                                style={{ ...xpInput, fontSize: 20, padding: '8px 10px', border: '2px solid #7f9db9' }}
                            />
                        </div>

                        {/* Lot/beam number (lot-tracked output) */}
                        {isLotOutput && (
                            <div style={{ marginBottom: 10 }}>
                                <div style={{ fontFamily: XP_FONT, fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>{isBeamOutput ? 'Nomor Beam' : 'Nomor Lot'}</div>
                                <input
                                    type="text"
                                    value={beamNumber} onChange={e => setBeamNumber(e.target.value)}
                                    placeholder={isBeamOutput ? 'Kosongkan untuk nomor otomatis (BM-...)' : 'Kosongkan untuk nomor otomatis (LOT-...)'}
                                    style={{ ...xpInput, fontSize: 16, padding: '6px 10px', border: '2px solid #7f9db9' }}
                                />
                                <div style={{ fontFamily: XP_FONT, fontSize: 9, color: '#888', marginTop: 2 }}>
                                    Hasil produksi dicatat sebagai lot stok. Nomor otomatis muncul di catatan entri.
                                </div>
                            </div>
                        )}

                        {/* Putaway destination — assigned by planning, read-only for operator */}
                        {(() => {
                            const dest = scannedWOParentMO?.planned_putaway_location_name
                                || scannedWO?.output_location?.name
                                || scannedWO?.output_location_name
                                || null;
                            return dest ? (
                                <MobileNotice tone="green">
                                    <span style={{ fontWeight: 'bold' }}>Simpan ke: {dest}</span>
                                    <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>
                                        {scannedWOParentMO?.planned_putaway_location_name
                                            ? 'Bin ditentukan oleh planning.'
                                            : 'Lokasi output WO (belum ada bin dari planning).'}
                                    </div>
                                </MobileNotice>
                            ) : null;
                        })()}

                        {/* Lot pickers (consumption) */}
                        {Array.from(new Set([...Object.keys(batchesByItem), ...Object.keys(reservedByItem)])).map(itemId => (
                            <div key={itemId} style={{ marginBottom: 10 }}>
                                <div style={{ fontFamily: XP_FONT, fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>
                                    Lot yang Dipakai — {materialRows.find(r => r.item_id === itemId)?.item_code || findItem(itemId)?.code || 'material'}
                                </div>
                                {(batchesByItem[itemId]?.length || 0) > 0 && (
                                    <select
                                        value={consumedBatches[itemId] || ''}
                                        onChange={e => setConsumedBatches(prev => ({ ...prev, [itemId]: e.target.value }))}
                                        style={{ ...xpInput, appearance: 'auto' }}
                                    >
                                        <option value="">— pilih lot —</option>
                                        {batchesByItem[itemId].map((b: any) => (
                                            <option key={b.id} value={b.id}>
                                                {b.batch_number}{b.vendor_lot ? ` (supplier: ${b.vendor_lot})` : ''} — {Number(b.remaining ?? 0).toFixed(2)} sisa{b.ends ? `, ${b.ends} ends` : ''}
                                            </option>
                                        ))}
                                    </select>
                                )}
                                {/* Bags in the rack that belong to another WO's line — named, because
                                    a bag the operator can see but not select reads as a broken list. */}
                                {(reservedByItem[itemId] || []).length > 0 && (
                                    <MobileNotice tone="amber" style={{ marginTop: 4, marginBottom: 0 }}>
                                        <div style={{ fontWeight: 'bold', marginBottom: 3 }}>
                                            Lot ini sudah di-stage ke WO lain — tidak bisa dipakai di sini:
                                        </div>
                                        {(reservedByItem[itemId] || []).map((b: any) => (
                                            <div key={b.id}>
                                                {b.batch_number} — {Number(b.remaining ?? 0).toFixed(2)} kg &rarr; {b.reserved_wo_code || 'WO lain'}
                                            </div>
                                        ))}
                                    </MobileNotice>
                                )}
                            </div>
                        ))}

                        {/* Operator + Notes */}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontFamily: XP_FONT, fontSize: 10, marginBottom: 3 }}>Operator</div>
                                <input type="text" value={logOperator} onChange={e => setLogOperator(e.target.value)}
                                    placeholder="Nama (opsional)" style={xpInput} />
                            </div>
                            <div style={{ flex: 2 }}>
                                <div style={{ fontFamily: XP_FONT, fontSize: 10, marginBottom: 3 }}>Catatan</div>
                                <input type="text" value={logNotes} onChange={e => setLogNotes(e.target.value)}
                                    placeholder="Lot, shift, keterangan..." style={xpInput} />
                            </div>
                        </div>

                        {/* Work Center / Machine */}
                        <div style={{ marginBottom: 10 }}>
                            <div style={{ fontFamily: XP_FONT, fontSize: 10, marginBottom: 3 }}>Work Center / Machine</div>
                            <select
                                value={logWorkCenterId}
                                onChange={e => setLogWorkCenterId(e.target.value)}
                                style={{ ...xpInput, appearance: 'auto' }}
                            >
                                <option value="">— pilih mesin (opsional) —</option>
                                {workCenters.map((wc: any) => (
                                    <option key={wc.id} value={wc.id}>{wc.name}{wc.code ? ` (${wc.code})` : ''}</option>
                                ))}
                            </select>
                        </div>

                        {/* Material Consumption */}
                        {materialRows.length > 0 && (() => {
                            const filteredItems = subQuery.length >= 2
                                ? items.filter((it: any) =>
                                    (it.code || '').toLowerCase().includes(subQuery.toLowerCase()) ||
                                    (it.name || '').toLowerCase().includes(subQuery.toLowerCase())
                                  ).slice(0, 10)
                                : [];
                            return (
                            <div style={{ marginBottom: 10 }}>
                                <div style={{ ...subLabel, marginTop: 4 }}>Material Consumption</div>
                                <div style={{ fontSize: 9, color: '#888', marginBottom: 6, fontFamily: XP_FONT }}>
                                    Planned = BOM% x output. Tap Sub to use a substitute item if stock is unavailable.
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: XP_FONT }}>
                                    <thead>
                                        <tr style={{ background: '#dddbd0' }}>
                                            <th style={{ padding: '3px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Material</th>
                                            <th style={{ padding: '3px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 54 }}>Planned</th>
                                            <th style={{ padding: '3px 4px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 76 }}>Actual</th>
                                            <th style={{ padding: '3px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 50 }}>Var</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {materialRows.map((row, idx) => {
                                            const qty = parseFloat(logQty) || 0;
                                            const planned = (qty * row.planned_pct) / 100;
                                            const actual = parseFloat(row.actual_qty) || 0;
                                            const variance = actual - planned;
                                            const isPickingThis = subPickerIdx === idx;
                                            return (
                                                <tr key={idx} style={{ background: idx % 2 === 0 ? '#fff' : '#f5f4ee', verticalAlign: 'top' }}>
                                                    <td style={{ padding: '3px 4px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                            <span style={{ fontWeight: 500 }}>{row.item_code}</span>
                                                            {row.is_substitute && (
                                                                <span style={{ borderRadius: CHIP_RADIUS, fontSize: 9, background: '#fff3cd', border: '1px solid #b8860b', color: '#7a5000', padding: '0 3px', whiteSpace: 'nowrap' }}>
                                                                    SUB
                                                                </span>
                                                            )}
                                                            {row.is_substitute && (
                                                                <span style={{ fontSize: 9, color: '#999', textDecoration: 'line-through', whiteSpace: 'nowrap' }}>
                                                                    {row.orig_item_code}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    if (isPickingThis) { setSubPickerIdx(null); setSubQuery(''); }
                                                                    else { setSubPickerIdx(idx); setSubQuery(''); }
                                                                }}
                                                                style={{ fontFamily: XP_FONT, fontSize: 9, padding: '1px 5px', cursor: 'pointer', background: isPickingThis ? '#c8d8f0' : 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid #808080', color: '#000040' }}
                                                            >
                                                                {isPickingThis ? 'Cancel' : 'Sub'}
                                                            </button>
                                                            {row.is_substitute && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setMaterialRows(prev => prev.map((r, i) => i === idx ? {
                                                                            ...r,
                                                                            item_id: r.orig_item_id,
                                                                            item_name: r.orig_item_name,
                                                                            item_code: r.orig_item_code,
                                                                            is_substitute: false,
                                                                            is_custom: false,
                                                                        } : r));
                                                                        if (isPickingThis) { setSubPickerIdx(null); setSubQuery(''); }
                                                                    }}
                                                                    style={{ fontFamily: XP_FONT, fontSize: 9, padding: '1px 5px', cursor: 'pointer', background: 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid #808080', color: '#900' }}
                                                                >
                                                                    Clear
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '3px 6px', textAlign: 'right', color: '#555' }}>
                                                        {qty > 0 ? planned.toFixed(3) : '—'}
                                                    </td>
                                                    <td style={{ padding: '3px 4px' }}>
                                                        <input
                                                            type="number" min="0" step="any"
                                                            value={row.actual_qty}
                                                            onChange={e => {
                                                                const val = e.target.value;
                                                                setMaterialRows(prev => prev.map((r, i) =>
                                                                    i === idx ? { ...r, actual_qty: val, is_custom: true } : r
                                                                ));
                                                            }}
                                                            placeholder="0"
                                                            style={{ ...xpInput, textAlign: 'right', padding: '2px 4px', fontSize: 12 }}
                                                        />
                                                    </td>
                                                    <td style={{ padding: '3px 6px', textAlign: 'right', fontSize: 10, color: variance > 0.0001 ? '#900' : variance < -0.0001 ? '#007000' : '#888' }}>
                                                        {qty > 0 && row.actual_qty ? (variance > 0 ? '+' : '') + variance.toFixed(3) : '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>

                                {/* Substitute item picker */}
                                {subPickerIdx !== null && (
                                    <div style={{ marginTop: 8, border: '2px solid #1a4a8a', background: '#f0f4ff', padding: 8 }}>
                                        <div style={{ fontFamily: XP_FONT, fontSize: 10, fontWeight: 'bold', color: '#000080', marginBottom: 6 }}>
                                            Select substitute for: {materialRows[subPickerIdx]?.orig_item_code}
                                        </div>
                                        <input
                                            type="text"
                                            autoFocus
                                            placeholder="Type item code or name (min 2 chars)..."
                                            value={subQuery}
                                            onChange={e => setSubQuery(e.target.value)}
                                            style={{ ...xpInput, marginBottom: 6 }}
                                        />
                                        {subQuery.length >= 2 && filteredItems.length === 0 && (
                                            <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#888', padding: '4px 0' }}>No items found.</div>
                                        )}
                                        {filteredItems.map((it: any) => (
                                            <button
                                                key={it.id}
                                                type="button"
                                                onClick={() => {
                                                    const idx = subPickerIdx;
                                                    setMaterialRows(prev => prev.map((r, i) => i === idx ? {
                                                        ...r,
                                                        item_id: it.id,
                                                        item_name: it.name || '',
                                                        item_code: it.code || '',
                                                        is_substitute: true,
                                                        is_custom: true,
                                                    } : r));
                                                    setSubPickerIdx(null);
                                                    setSubQuery('');
                                                }}
                                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 2, fontFamily: XP_FONT, fontSize: 12, cursor: 'pointer', background: '#fff', border: '1px solid #7f9db9', borderRadius: 3 }}
                                            >
                                                <span style={{ fontWeight: 'bold' }}>{it.code}</span>
                                                {it.name && it.name !== it.code && (
                                                    <span style={{ color: '#555', marginLeft: 8, fontSize: 11 }}>{it.name}</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            );
                        })()}

                        <MobileButton
                            tone="create"
                            icon="bi-save"
                            onClick={handleLogWO}
                            disabled={submittingLog}
                            style={{ width: '100%', fontSize: 14, padding: '12px 14px' }}
                        >
                            {submittingLog ? 'Menyimpan...' : 'Simpan Log'}
                        </MobileButton>
                    </MobilePanel>
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
