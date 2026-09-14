'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../shared/Toast';
import ModalWrapper from '../shared/ModalWrapper';
import CameraScanner from '../shared/CameraScanner';
import LotLabelPrintModal from './LotLabelPrintModal';
import { LotChips, LotChip } from '../shared/LotChips';
import { CodeChip, xpFont, xpInput as xpInputBase, xpBtn as xpBtnBase, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import type { StagedLot } from './WOStagingModal';

const xpInput: React.CSSProperties = xpInputBase({ fontSize: 13, height: 28, padding: '0 6px', width: '100%', boxSizing: 'border-box' });
const xpBtn = (primary?: boolean): React.CSSProperties => xpBtnBase(primary ? { ...BTN_TONES.success, padding: '2px 14px' } : {});

interface RequiredMaterial {
    item_id: string;
    item_code: string | null;
    item_name: string | null;
    attribute_value_ids: string[];
    required_qty: number;
    source_location_id: string | null;
    source_location_name: string | null;
    staged: number;
    shortfall: number;
    lot_tracked: boolean;
    // Warp beams: mounted on the loom rather than staged to this WO, counted in
    // whole pieces against the machine's beam positions. `staged` on a beam row is
    // the kg mounted on the MACHINE, shared with every other WO running there.
    is_beam: boolean;
    mounted_pcs: number;
    required_pcs: number;
    staged_lots: StagedLot[];
}

interface BeamMount {
    id: string;
    batch_id: string;
    beam_number: string | null;
    ends: number | null;
    remaining: number;
    mounted_at: string | null;
}

interface LoomBeamStatus {
    work_center_code: string | null;
    beam_slots: number;
    mounted_pcs: number;
    total_remaining: number;
    mounts: BeamMount[];
}

interface Props {
    wo: any;
    onClose: () => void;
    onStaged: (updatedWO: any) => void;
    onManualMode?: () => void;   // switch to the manual (pick/qty) staging modal
}

/**
 * Scan-to-stage: the floor scans printed lot QRs to feed a WO's step instead of
 * typing lot numbers. One camera, one cart, one commit through the standard
 * POST /work-orders/{id}/stage.
 *
 * Two kinds of unit land in that cart, and the difference is physical, not
 * cosmetic — the step row's `is_beam` decides which:
 *
 *  - **Bag / cone lot** (greige into dyeing, dyed into setting, weft into
 *    weaving). A weighed bag, staged in kg to the WO's input location. Whole
 *    lots move; lowering the kg peels the remainder into a new leftover lot
 *    (relabel prompt after), and staging past the step's requirement is a
 *    warning, never clipped — the backend does not clip either.
 *  - **Warp beam** (weaving). Mounted on the MACHINE, never staged to the WO:
 *    one warp feeds every WO that runs on that loom, so there is no kg entry,
 *    no split, and no per-WO peg. Readiness is whole beams against the loom's
 *    `beam_slots`. The commit still goes through /stage, which routes a beam
 *    line to `beam_service.mount_beam` — see the is_beam branch there.
 *
 * Every scannable unit here already carried a lot number: `BM-` beams are born
 * at BEAMING completion the same way `GRG-` bags are born at weaving. Beams were
 * absent from this modal because it had no mount branch, not because the label
 * was missing.
 */
export default function BagScanStageModal({ wo, onClose, onStaged, onManualMode }: Props) {
    const { authFetch } = useData() as any;
    const { showToast } = useToast();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    // A partial bag splits, and the leftover label must say what the remnant IS:
    // a dyeing WO peels greige, a setting WO peels dyed fabric.
    const wcType = String(wo.work_center_type || '').toUpperCase();
    const leftoverHeading = wcType === 'SETTING'
        ? 'SISA CELUP / LEFTOVER'
        : wcType === 'DYEING' || wcType === 'CELUP'
            ? 'SISA GREIGE / LEFTOVER'
            : 'SISA / LEFTOVER';

    const [rows, setRows] = useState<RequiredMaterial[]>([]);
    const [loom, setLoom] = useState<LoomBeamStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [cart, setCart] = useState<any[]>([]);       // resolved batch objects
    const [stageQtys, setStageQtys] = useState<Record<string, string>>({});  // batch id -> kg to stage (blank = full)
    const [scanValue, setScanValue] = useState('');
    const [cameraOn, setCameraOn] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [labelLots, setLabelLots] = useState<any[] | null>(null);  // leftover lots to relabel after a split

    const inputRef = useRef<HTMLInputElement | null>(null);
    const recentRef = useRef<Record<string, number>>({});   // code -> last-seen ms, debounce repeats
    const cartIdsRef = useRef<Set<string>>(new Set());       // resolved batch ids in cart (dedupe)

    const reqByItem = useMemo(() => {
        const m: Record<string, RequiredMaterial> = {};
        rows.forEach(r => { m[String(r.item_id)] = r; });
        return m;
    }, [rows]);

    const hasBeamRows = useMemo(() => rows.some(r => r.is_beam), [rows]);
    /** Is this scanned/carted batch a warp beam? Decided by its item's step row. */
    const isBeam = (b: any) => !!reqByItem[String(b.item_id)]?.is_beam;

    const beamCart = useMemo(() => cart.filter(b => !!reqByItem[String(b.item_id)]?.is_beam), [cart, reqByItem]);
    const bagCart = useMemo(() => cart.filter(b => !reqByItem[String(b.item_id)]?.is_beam), [cart, reqByItem]);

    // kg to stage for a bag: the edited value, or the full remaining if untouched.
    // Beams never take a qty — the whole warp goes up.
    const stagedOf = (b: any) => {
        const raw = stageQtys[b.id];
        if (raw === undefined || raw === '') return Number(b.remaining || 0);
        const n = parseFloat(raw);
        return isNaN(n) ? 0 : n;
    };

    // Required reference = remaining shortfall summed across this step's BAG
    // materials. Beam rows are excluded: their requirement is in pieces against
    // the loom's positions, and folding their kg into a kg total would fire the
    // "over required" warning on a warp that is merely heavy.
    const totalShortfall = useMemo(
        () => rows.filter(r => !r.is_beam).reduce((s, r) => s + Math.max(0, r.shortfall), 0),
        [rows],
    );
    const cartKg = bagCart.reduce((s, b) => s + stagedOf(b), 0);
    const overRequired = totalShortfall > 0 && cartKg > totalShortfall + 1e-6;

    // Beam readiness: what is up on the loom now, plus what this cart will mount,
    // against the machine's positions. Over-filling is a warning only — beam_slots
    // is a readiness target and `mount_beam` enforces no cap.
    const beamSlots = Math.max(1, Number(loom?.beam_slots || 1));
    const mountedPcs = Number(loom?.mounted_pcs || 0);
    const beamPcsAfter = mountedPcs + beamCart.length;
    const overSlots = beamPcsAfter > beamSlots;

    // Lots already on the line, flattened across this step's BAG materials. A beam
    // row's staged_lots is the machine's warp, which the loom block above shows.
    const alreadyStaged = useMemo(
        () => rows.filter(r => !r.is_beam).flatMap(r => r.staged_lots || []),
        [rows],
    );
    const stagedKg = useMemo(
        () => alreadyStaged.reduce((s, l) => s + (l.qty || 0), 0),
        [alreadyStaged],
    );

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/work-orders/${wo.id}/required-materials`);
                const data: RequiredMaterial[] = res.ok ? await res.json() : [];
                if (!alive) return;
                setRows(data);
                // What warp is already up on this machine. Mounted beams belong to the
                // loom, not to this WO, so they are context — and a beam already up is
                // rejected at the scan rather than at submit.
                if (data.some(r => r.is_beam)) {
                    const lres = await authFetch(`${API_BASE}/work-orders/${wo.id}/beam-mounts`);
                    if (!alive) return;
                    setLoom(lres.ok ? await lres.json() : null);
                }
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [wo.id]);

    // Keep the scan input focused so a keyboard-wedge scanner always lands here.
    useEffect(() => {
        if (!cameraOn && !loading) inputRef.current?.focus();
    }, [cameraOn, loading, cart.length]);

    const beep = () => {
        try {
            const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = 880; gain.gain.value = 0.08;
            osc.start(); osc.stop(ctx.currentTime + 0.08);
        } catch { /* noop */ }
    };

    const addScan = async (raw: string) => {
        const code = (raw || '').trim();
        if (!code) return;
        // Debounce identical reads (camera fires many frames of one bag).
        const now = Date.now();
        if (recentRef.current[code] && now - recentRef.current[code] < 1500) return;
        recentRef.current[code] = now;

        try {
            const res = await authFetch(`${API_BASE}/batches/resolve?number=${encodeURIComponent(code)}`);
            if (!res.ok) { showToast(`Lot "${code}" not found`, 'danger'); return; }
            const b = await res.json();
            if (cartIdsRef.current.has(b.id)) { showToast(`${b.batch_number} already scanned`, 'warning'); return; }
            if (b.quality_status === 'REJECTED' || b.quality_status === 'DISPOSED') {
                showToast(`${b.batch_number} is ${String(b.quality_status).toLowerCase()} — skipped`, 'danger');
                return;
            }
            const rr = reqByItem[String(b.item_id)];
            if (!rr) {
                showToast(`${b.batch_number} (${b.item_code || 'item'}) is not a material for this WO`, 'danger');
                return;
            }
            if (rr.is_beam) {
                // Already gaited somewhere: `mount_beam` refuses to double-mount, so
                // catch it at the beam rather than at the end of a three-beam cart.
                // Mounted on THIS loom is the common read — the operator scanned a warp
                // that is already up — and says so instead of naming the machine back.
                if (b.mounted_wc_id) {
                    const here = String(b.mounted_wc_id) === String(wo.work_center_id);
                    showToast(
                        here
                            ? `${b.batch_number} is already up on this loom`
                            : `${b.batch_number} is mounted on ${b.mounted_wc_code || 'another machine'} — dismount it first`,
                        here ? 'warning' : 'danger',
                    );
                    return;
                }
            } else if (b.reserved_wo_id && String(b.reserved_wo_id) !== String(wo.id)) {
                // Already on another WO's line: that WO's stager put it there and its
                // operator is going to consume it. Blocked here as well as server-side so
                // the scan fails at the bag, not at the end of a 30-bag cart. Beams skip
                // this — a beam is never staged to a WO, only mounted on a machine.
                showToast(`${b.batch_number} is staged to ${b.reserved_wo_code || 'another work order'} — it must leave that line first`, 'danger');
                return;
            }
            if (Number(b.remaining || 0) <= 0) { showToast(`${b.batch_number} has no stock remaining`, 'danger'); return; }
            cartIdsRef.current.add(b.id);
            setCart(prev => [...prev, b]);
            beep();
        } catch {
            showToast('Scan lookup failed', 'danger');
        }
    };

    const removeFromCart = (id: string) => {
        cartIdsRef.current.delete(id);
        setCart(prev => prev.filter(b => b.id !== id));
        setStageQtys(prev => { const n = { ...prev }; delete n[id]; return n; });
    };

    const submit = async () => {
        if (!cart.length) { showToast('Scan at least one lot first', 'danger'); return; }

        // Validate each BAG's stage qty (0 < qty <= remaining). Beams carry no qty.
        for (const b of bagCart) {
            const rem = Number(b.remaining || 0);
            const q = stagedOf(b);
            if (q <= 0) { showToast(`${b.batch_number}: stage qty must be positive`, 'warning'); return; }
            if (q > rem + 1e-6) { showToast(`${b.batch_number}: stage qty exceeds ${rem.toFixed(2)} kg`, 'warning'); return; }
        }

        const missingSrc = bagCart.find(b => !(b.location_id || reqByItem[String(b.item_id)]?.source_location_id));
        if (missingSrc) { showToast(`${missingSrc.batch_number || 'A lot'} has no source location`, 'danger'); return; }

        setSubmitting(true);
        try {
            // Partial bags: peel the leftover into a new GOOD lot first, so the
            // original is reduced to exactly the staged qty before we move it.
            // Beams are never split here — a partial warp makes no sense, and a
            // beam's remnant is weighed off at dismount instead (beam_service).
            const leftovers: any[] = [];
            for (const b of bagCart) {
                const rem = Number(b.remaining || 0);
                const q = stagedOf(b);
                if (q < rem - 1e-6) {
                    const res = await authFetch(`${API_BASE}/batches/${b.id}/split`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ qty: rem - q, reason: `Leftover staging ${wo.code || ''}`.trim() }),
                    });
                    if (!res.ok) {
                        const err = await res.json().catch(() => null);
                        showToast(`Split failed for ${b.batch_number}: ${err?.detail || ''}`, 'danger');
                        return;
                    }
                    leftovers.push(await res.json());
                }
            }

            const lines = cart.map(b => {
                const rr = reqByItem[String(b.item_id)];
                // qty 0 on a beam line means "the whole beam": /stage passes
                // `qty if qty > 0 else None` into mount_beam, and a warp is atomic.
                const qty = rr?.is_beam ? 0 : stagedOf(b);
                return {
                    item_id: b.item_id,
                    qty,
                    source_location_id: b.location_id || rr?.source_location_id || null,
                    batch_id: b.id,
                    attribute_value_ids: rr?.attribute_value_ids || [],
                };
            });
            const res = await authFetch(`${API_BASE}/work-orders/${wo.id}/stage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lines }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                showToast(err?.detail || 'Staging failed', 'danger');
                return;
            }
            const updated = await res.json().catch(() => null);
            const parts: string[] = [];
            if (beamCart.length) parts.push(`Mounted ${beamCart.length} beam${beamCart.length === 1 ? '' : 's'} on the loom`);
            if (bagCart.length) parts.push(`staged ${bagCart.length} bag${bagCart.length === 1 ? '' : 's'} (${cartKg.toFixed(2)} kg) to the line`);
            showToast(parts.join(' · ') || 'Staged', 'success');
            onStaged(updated);
            // Relabel any leftover bags before closing; else close straight away.
            if (leftovers.length) setLabelLots(leftovers);
            else onClose();
        } finally {
            setSubmitting(false);
        }
    };

    // Footer verb follows what is actually in the cart, so a weaving WO doesn't
    // say "bags" over a warp and a dyeing WO doesn't say "units" over bags.
    const submitLabel = cart.length === 0
        ? `Stage ${hasBeamRows ? 'Materials' : 'Bags'}`
        : beamCart.length && !bagCart.length
            ? `Mount ${beamCart.length} Beam${beamCart.length === 1 ? '' : 's'}`
            : !beamCart.length
                ? `Stage ${bagCart.length} Bag${bagCart.length === 1 ? '' : 's'}`
                : `Stage ${cart.length} Lot${cart.length === 1 ? '' : 's'}`;

    return (
      <>
        <ModalWrapper
            isOpen
            onClose={onClose}
            title={`Scan ${hasBeamRows ? 'Materials' : 'Bags'} to Stage — ${wo.code || wo.name}`}
            modeless
            size="lg"
            footer={
                <>
                    <button className={XP_BTN} style={xpBtn(false)} onClick={onClose} disabled={submitting}>Cancel</button>
                    <button className={XP_BTN} style={xpBtn(true)} onClick={submit} disabled={submitting || loading || cart.length === 0}>
                        {submitting ? 'Staging...' : submitLabel}
                    </button>
                </>
            }
        >
            <div style={{ fontFamily: xpFont, fontSize: 11 }}>
                {onManualMode && (
                    <div style={{ display: 'flex', gap: 0, marginBottom: 8, border: '1px solid #7f9db9', width: 'fit-content' }}>
                        <button className={XP_BTN} onClick={onManualMode} style={{ ...xpBtn(false), border: 'none', borderRight: '1px solid #7f9db9', padding: '3px 12px' }}>Manual</button>
                        <span style={{ padding: '3px 12px', fontWeight: 'bold', background: 'linear-gradient(to bottom,#cfe0ff,#8fb3e8)', color: '#0a2a66' }}>Scan</span>
                    </div>
                )}
                <div style={{ fontSize: 10, color: '#555', marginBottom: 8 }}>
                    Scan each label to feed this step — the lot number is captured automatically.
                    {hasBeamRows && (
                        <>
                            {' '}A <b>warp beam</b> mounts on the machine
                            (<b>{loom?.work_center_code || wo.work_center_name || 'this loom'}</b>) in whole pieces:
                            it is shared by every work order that runs there, so there is no quantity to enter and no split.
                        </>
                    )}
                    {' '}A <b>bag</b> stages into this WO&apos;s input location
                    (<b>{wo.input_location?.code || wo.input_location_id || 'no input location'}</b>);
                    lower its kg to stage only part of it and the remainder splits off as a new leftover lot
                    (relabel prompt after).
                </div>

                {loading ? (
                    <div style={{ color: '#888', padding: 12 }}>Loading required materials...</div>
                ) : rows.length === 0 ? (
                    <div style={{ color: '#b00', padding: 12 }}>
                        This WO has no materials to stage (no routing step assigned, or step has no materials).
                    </div>
                ) : (
                    <>
                        {/* What warp is up on the loom right now — the beam counterpart of
                            the "already staged" block below, but keyed to the MACHINE,
                            because that is what a mount is pegged to. */}
                        {hasBeamRows && (
                            <div style={{ border: '1px solid #a8bcd0', background: '#f2f6fa', padding: '4px 6px', marginBottom: 8 }}>
                                <div style={{ fontSize: 10, color: '#0a3f6e', fontWeight: 'bold', marginBottom: 3 }}>
                                    <i className="bi bi-arrow-bar-up" /> On the loom{loom?.work_center_code ? ` — ${loom.work_center_code}` : ''}
                                    {' '}({mountedPcs} / {beamSlots} beam position{beamSlots === 1 ? '' : 's'}
                                    {loom ? `, ${Number(loom.total_remaining || 0).toFixed(1)} kg` : ''})
                                </div>
                                {(loom?.mounts || []).length === 0 ? (
                                    <div style={{ fontSize: 10, color: '#888', fontStyle: 'italic' }}>No warp mounted — scan a beam to gait it.</div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        {(loom?.mounts || []).map(m => (
                                            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                <CodeChip code={m.beam_number || '—'} />
                                                {m.ends ? <LotChip tone="pending" title="Warp ends (utas)">{m.ends} utas</LotChip> : null}
                                                <LotChip tone="qty" title="Warp remaining on this beam">{Number(m.remaining || 0).toFixed(1)} kg</LotChip>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* What is already on the line. Without this the operator
                            re-scans bags that are in fact staged already — the total
                            alone doesn't say which lots it came from. */}
                        {alreadyStaged.length > 0 && (
                            <div style={{ border: '1px solid #a8d0a8', background: '#f2f9f2', padding: '4px 6px', marginBottom: 8 }}>
                                <div style={{ fontSize: 10, color: '#1a5e1a', fontWeight: 'bold', marginBottom: 3 }}>
                                    <i className="bi bi-box-seam" /> Already staged to this WO ({stagedKg.toFixed(2)} kg)
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {alreadyStaged.map(sl => {
                                        const gone = sl.on_line + 1e-6 < sl.qty;
                                        return (
                                            <div key={sl.batch_id} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                <CodeChip code={sl.batch_number || '—'} />
                                                <LotChip tone="qty" title="Quantity staged to this WO">{sl.qty.toFixed(1)}</LotChip>
                                                {gone ? (
                                                    <LotChip tone="pending" title="Still at the input location — the rest was consumed or moved">
                                                        {sl.on_line.toFixed(1)} left
                                                    </LotChip>
                                                ) : null}
                                                <LotChips batch={sl} showOrder />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Scan input + camera toggle */}
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                            <input
                                ref={inputRef}
                                style={xpInput}
                                value={scanValue}
                                placeholder="Scan or type a lot number, then Enter…"
                                onChange={e => setScanValue(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        addScan(scanValue);
                                        setScanValue('');
                                    }
                                }}
                                disabled={cameraOn}
                            />
                            <button className={XP_BTN} style={{ ...xpBtn(false), whiteSpace: 'nowrap' }} onClick={() => setCameraOn(v => !v)}>
                                {cameraOn ? 'Stop Camera' : 'Use Camera'}
                            </button>
                        </div>

                        {cameraOn && (
                            <div style={{ marginBottom: 8 }}>
                                {/* ui-scale-exempt: html5-qrcode measures its own viewfinder — keep it 1:1. */}
                                <div className="ui-scale-exempt" style={{ width: '100%', maxWidth: 360, margin: '0 auto' }}>
                                    <CameraScanner id="bag-scan-reader" onDecode={addScan} />
                                </div>
                            </div>
                        )}

                        {/* Totals + over-load warnings. Beams count in pieces against the
                            loom's positions, bags in kg against the step's shortfall —
                            two readouts because they are two different limits. */}
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                            {hasBeamRows && (
                                <span>Beams: <b>{beamCart.length}</b>
                                    <span style={{ color: '#555' }}> ({beamPcsAfter} / {beamSlots} up after mount)</span>
                                </span>
                            )}
                            <span>Bags: <b>{bagCart.length}</b></span>
                            <span>Total: <b>{cartKg.toFixed(2)} kg</b></span>
                            <span style={{ color: '#555' }}>Required: {totalShortfall.toFixed(2)} kg</span>
                        </div>
                        {overSlots && (
                            <div style={{ background: '#fff3cd', border: '1px solid #b8860b', color: '#7a5000', padding: '4px 8px', marginBottom: 8, fontSize: 10 }}>
                                That would put <b>{beamPcsAfter}</b> beams on a loom with <b>{beamSlots}</b> position{beamSlots === 1 ? '' : 's'}.
                                Beam positions are a readiness target, not a cap — the mount will still go through.
                            </div>
                        )}
                        {overRequired && (
                            <div style={{ background: '#fff3cd', border: '1px solid #b8860b', color: '#7a5000', padding: '4px 8px', marginBottom: 8, fontSize: 10 }}>
                                Staged load ({cartKg.toFixed(2)} kg) exceeds the WO&apos;s required {totalShortfall.toFixed(2)} kg by{' '}
                                <b>{(cartKg - totalShortfall).toFixed(2)} kg</b>. All scanned bags will still be staged.
                            </div>
                        )}

                        {/* Cart */}
                        <div style={{ border: '1px solid #7f9db9', maxHeight: 300, overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                                <thead>
                                    <tr style={{ background: '#d4d0c8', textAlign: 'left', position: 'sticky', top: 0 }}>
                                        <th style={{ padding: '3px 5px', width: 34 }}>#</th>
                                        <th style={{ padding: '3px 5px' }}>Lot</th>
                                        <th style={{ padding: '3px 5px' }}>Item</th>
                                        <th style={{ padding: '3px 5px' }}>Location</th>
                                        <th style={{ padding: '3px 5px', textAlign: 'right' }}>Kg</th>
                                        <th style={{ padding: '3px 5px', width: 30 }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cart.length === 0 ? (
                                        <tr><td colSpan={6} style={{ padding: 10, color: '#aaa', textAlign: 'center' }}>
                                            No {hasBeamRows ? 'lots' : 'bags'} scanned yet.
                                        </td></tr>
                                    ) : cart.map((b, i) => {
                                        const beam = isBeam(b);
                                        return (
                                            <tr key={b.id} style={{ borderBottom: '1px solid #cfccc4' }}>
                                                <td style={{ padding: '3px 5px', color: '#888' }}>{i + 1}</td>
                                                <td style={{ padding: '3px 5px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                        <CodeChip code={b.batch_number} />
                                                        {beam && (
                                                            <LotChip tone="location" icon="bi-arrow-bar-up" title="Mounts on the machine, not on this work order">
                                                                BEAM
                                                            </LotChip>
                                                        )}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '3px 5px' }}>
                                                    <div>{b.item_code || b.item_name || '—'}</div>
                                                    {/* Size / combo / shade of the scanned lot — same chips as the
                                                        manual staging picker, so a wrong-variant lot is visible. */}
                                                    <LotChips batch={b} />
                                                    {beam && b.ends ? (
                                                        <div style={{ color: '#555', fontSize: 9 }}>{b.ends} utas</div>
                                                    ) : null}
                                                </td>
                                                <td style={{ padding: '3px 5px', color: '#0058e6' }}>{b.location_name || '—'}</td>
                                                <td style={{ padding: '3px 5px', textAlign: 'right' }}>
                                                    {beam ? (
                                                        // A warp is atomic: the whole beam goes up, so there is nothing
                                                        // to type. Its kg is a readout of what the loom will draw down.
                                                        <>
                                                            <b>{Number(b.remaining || 0).toFixed(2)}</b>
                                                            <div style={{ color: '#0a3f6e', fontSize: 9 }}>whole beam</div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                max={Number(b.remaining || 0)}
                                                                step="any"
                                                                value={stageQtys[b.id] ?? String(Number(b.remaining || 0))}
                                                                onChange={e => setStageQtys(prev => ({ ...prev, [b.id]: e.target.value }))}
                                                                style={{ width: 62, textAlign: 'right', fontFamily: xpFont, fontSize: 10, border: '1px solid #7f9db9', padding: '1px 4px', fontWeight: 'bold' }}
                                                            />
                                                            <span style={{ color: '#888', marginLeft: 3 }}>/ {Number(b.remaining || 0).toFixed(2)}</span>
                                                            {stagedOf(b) < Number(b.remaining || 0) - 1e-6 && (
                                                                <div style={{ color: '#7a5000', fontSize: 9 }}>
                                                                    splits {(Number(b.remaining || 0) - stagedOf(b)).toFixed(2)} leftover
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                </td>
                                                <td style={{ padding: '3px 5px', textAlign: 'center' }}>
                                                    <button
                                                        className={XP_BTN}
                                                        onClick={() => removeFromCart(b.id)}
                                                        style={{ ...xpBtn(false), padding: '0 5px', color: '#900' }}
                                                        title="Remove"
                                                    >×</button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </ModalWrapper>

        {labelLots && (
            <LotLabelPrintModal
                lots={labelLots}
                heading={leftoverHeading}
                onClose={() => { setLabelLots(null); onClose(); }}
            />
        )}
      </>
    );
}
