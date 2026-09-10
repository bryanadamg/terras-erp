'use client';

import { Fragment, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { StatusChip, xpFont as XP_FONT, xpInput as xpInputBase } from '../shared/xpTheme';
import { toNum } from '../shared/format';
import { MOBILE_BG, MobilePanel, MobileScreenBar, MobileButton, MobileNotice } from './mobileTheme';
import { LotChips } from '../shared/LotChips';
import { machinesOfCenterType, toMachineOptions } from '../shared/workCenterTree';
import {
    BoxGroup, emptyBoxGroup, seedBoxGroups, expandBoxGroups, groupCount, groupTotal,
    filledBoxRows, hasUnweighedBox, uomIsKg, boxAltTotal, boxAltPayload, orderBoxSizeAlt,
    hasUnboxedBox, hasUnweighedTare, boxPackagingPayload, boxTarePayload,
    findPackagingType, isCustomType, effectiveTare,
} from '../shared/packingBoxes';
import { usePackagingTypes } from '../shared/usePackagingTypes';
import { orderBasePerAlt, altToBase, baseToAlt } from '../shared/altUnit';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace(/\/api$/, '') + '/api';

const xpInput: React.CSSProperties = xpInputBase({ fontSize: 13, height: 'auto', padding: '6px 8px', width: '100%', boxSizing: 'border-box' });
const xpLabel: React.CSSProperties = { fontFamily: XP_FONT, fontSize: 11, color: '#333', display: 'block', marginBottom: 3 };

const num = toNum;

function playBeep() {
    try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        osc.frequency.value = 880;
        osc.connect(ctx.destination);
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, 120);
    } catch { /* no audio on this device */ }
}

/**
 * Mobile packing scanner — the floor half of a packing order.
 *
 * Deliberately separate from the WO ScannerView: that screen is built around
 * BOM material rows and WO completions, and a packing order has neither. Here a
 * PCK- code opens the pack-logging form; a PU- code just reports what that
 * carton is, so a packer can identify a box without opening the desktop app.
 */
export default function PackingScanView({ authFetch, initialCode, onClose }: { authFetch: (url: string, options?: any) => Promise<Response>; initialCode?: string; onClose: () => void }) {
    const [po, setPo] = useState<any | null>(null);
    const [unit, setUnit] = useState<any | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [manualCode, setManualCode] = useState('');
    const scannerRef = useRef<Html5QrcodeScanner | null>(null);
    const scanLockRef = useRef(false);

    const [qty, setQty] = useState('');
    // Count in the order's alt selling unit, when it has one. The base qty above
    // stays the canonical figure — this only drives it.
    const [qtyAlt, setQtyAlt] = useState('');
    // One row per physical carton, seeded from the order's pack size. The packer
    // logs after the boxes are packed and weighed, so each row's scale reading is
    // required — it is the N.W. line on that carton's label, and the server
    // refuses to mint an unweighed carton.
    // Cartons are entered as `count x qty each` groups, flattened to one row per
    // physical carton for the payload — same shape and same helpers as the desktop
    // pack modal (see shared/packingBoxes).
    const [boxGroups, setBoxGroups] = useState<BoxGroup[]>([]);
    // The box master — its tare is what makes each carton's brutto.
    const { packagingTypes } = usePackagingTypes();
    const [openGroups, setOpenGroups] = useState<Set<number>>(new Set());
    const [sourceBatch, setSourceBatch] = useState('');
    const [operator, setOperator] = useState('');
    const [notes, setNotes] = useState('');
    const [lots, setLots] = useState<any[]>([]);
    // Machine this shift is packing on. Seeded from the order, so the packer only
    // touches it when they have moved to a different machine.
    const [workCenterId, setWorkCenterId] = useState('');
    const [machines, setMachines] = useState<any[]>([]);
    const [logging, setLogging] = useState(false);
    const [lastCartons, setLastCartons] = useState<any[]>([]);

    const resolveCode = useCallback(async (raw: string) => {
        const code = raw.trim();
        if (!code) return;
        setError(null);
        const upper = code.toUpperCase();

        if (upper.startsWith('PU-')) {
            const res = await authFetch(`${API_BASE}/packing/packed-units/resolve?code=${encodeURIComponent(code)}`);
            if (res.ok) { setUnit(await res.json()); setPo(null); playBeep(); }
            else { const e = await res.json().catch(() => ({})); setError(e.detail || `Carton "${code}" not found.`); }
            return;
        }

        if (upper.startsWith('PCK-')) {
            // No code lookup endpoint — the list is already filtered and small.
            const res = await authFetch(`${API_BASE}/packing?size=200`);
            if (!res.ok) { setError('Could not load packing orders.'); return; }
            const d = await res.json();
            const found = (d.items || []).find((o: any) => String(o.code).toUpperCase() === upper);
            if (!found) { setError(`Packing order "${code}" not found.`); return; }
            if (found.status === 'COMPLETED' || found.status === 'CANCELLED') {
                setError(`Packing order ${found.code} is ${found.status}.`);
                return;
            }
            playBeep();
            setPo(found);
            setUnit(null);
            const rem = Math.max(0, num(found.qty_target) - num(found.qty_packed));
            setQty(rem ? String(rem) : '');
            // Seed the lines the remaining qty implies (n full boxes plus the
            // remainder); the packer corrects the split and fills in each reading.
            // Split in the unit the order is COUNTED in — 12 Pcs a box, not the
            // 10.8 kg those weigh in theory (see packingBoxes.seedBoxGroups).
            const factor = orderBasePerAlt(found);
            const altSize = orderBoxSizeAlt(found, factor);
            setBoxGroups(seedBoxGroups(
                rem, altSize ? 0 : num(found.pack_size), [], factor, altSize,
            ));
            setOpenGroups(new Set());
            return;
        }

        setError('Not a packing QR code. Expected PCK- (packing order) or PU- (carton).');
    }, [authFetch]);

    // Opened from the shared scanner: that screen already decoded the label, so
    // act on it here instead of making the packer scan the same card twice.
    const seededRef = useRef(false);
    useEffect(() => {
        if (!initialCode || seededRef.current) return;
        seededRef.current = true;
        resolveCode(initialCode);
    }, [initialCode, resolveCode]);

    // Camera stays mounted only while nothing is resolved — same lifecycle as the
    // WO scanner, so the stream is released as soon as a form takes over.
    useEffect(() => {
        if (po || unit) return;
        const timer = setTimeout(() => {
            const qrbox = (vw: number, vh: number) => {
                const size = Math.floor(Math.min(vw, vh) * 0.7);
                return { width: size, height: size };
            };
            const scanner = new Html5QrcodeScanner('packing-reader', {
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
                    if (scanLockRef.current) return;
                    scanLockRef.current = true;
                    resolveCode(decodedText).finally(() => {
                        scanner.clear().catch(() => {});
                        scanLockRef.current = false;
                    });
                },
                () => {}
            );
        }, 100);
        return () => {
            clearTimeout(timer);
            scannerRef.current?.clear().catch(() => {});
        };
    }, [po, unit, resolveCode]);

    useEffect(() => {
        (async () => {
            if (!po) return;
            // Same variant scoping as the desktop picker: a hold bin carries every
            // colour of this FG, and a lot of another shade is refused by the pack
            // endpoint — offering it here would only be a 400 waiting to happen.
            const vq = po.variant_key ? `&variant_key=${encodeURIComponent(po.variant_key)}` : '';
            const res = await authFetch(`${API_BASE}/batches?item_id=${po.item_id}${vq}`);
            if (res.ok) setLots(await res.json() || []);
        })();
    }, [po, authFetch]);

    // Work centers are not in scope on this screen (the mobile shell mounts no
    // DataContext domain load for them), so fetch the bounded list once a packing
    // order is open — same scoping rule as the desktop picker.
    useEffect(() => {
        if (!po) return;
        setWorkCenterId(String(po.work_center_id || ''));
        if (machines.length) return;
        (async () => {
            const res = await authFetch(`${API_BASE}/work-centers?limit=2000`);
            if (!res.ok) return;
            const d = await res.json();
            setMachines(Array.isArray(d) ? d : (d.items || []));
        })();
    }, [po, authFetch]); // eslint-disable-line react-hooks/exhaustive-deps

    // Alt selling unit of this order (Pic = a roll, Pcs = a cut piece). When the
    // order carries one the packer counts in it and every base figure follows —
    // same rule and same shared conversion as the desktop pack modal.
    const altUom = po?.uom2 || '';
    const altFactor = orderBasePerAlt(po);
    const hasAlt = !!(altUom && altFactor);

    // Cut-to-weight order: the packer weighs the box and the count is derived
    // from this order's sampled g/y. Same rule and same one-way conversion as the
    // desktop pack modal — the two screens log the same document, so a basis the
    // floor screen ignored would put a counted figure on half the cartons.
    const weighBasis = hasAlt && String(po?.pack_basis || '').toUpperCase() === 'WEIGHED';
    // Whole pieces: a piece is a cut length, so a carton holds an integer of them.
    const altFromBase = (kg: number) =>
        (altFactor && altFactor > 0 && kg > 0 ? Math.round(kg / altFactor) : 0);

    // Box size in the counting unit; see the seed in `resolveCode`. A weighed
    // order splits by kilos instead — that is what the scale is set to.
    const boxSizeAlt = hasAlt && !weighBasis ? orderBoxSizeAlt(po, altFactor) : null;

    const onQtyChange = (v: string) => {
        setQty(v);
        setBoxGroups(prev => {
            const seeded = seedBoxGroups(
                num(v), boxSizeAlt ? 0 : num(po?.pack_size), prev,
                hasAlt && !weighBasis ? altFactor : null, boxSizeAlt,
            );
            return weighBasis
                ? seeded.map(g => ({ ...g, alt: num(g.qty) > 0 ? String(altFromBase(num(g.qty))) : '' }))
                : seeded;
        });
    };
    // Counting in the alt unit: the base qty follows the count, not the reverse.
    const onQtyAltChange = (v: string) => {
        setQtyAlt(v);
        const derived = altToBase(num(v), altFactor);
        if (derived !== null && num(v) > 0) onQtyChange(String(derived));
    };
    const updateGroup = (i: number, patch: Partial<BoxGroup>) =>
        setBoxGroups(prev => prev.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
    const addGroup = () => setBoxGroups(prev => [...prev, emptyBoxGroup()]);
    const removeGroup = (i: number) => setBoxGroups(prev => prev.filter((_, idx) => idx !== i));
    const toggleGroup = (i: number) => setOpenGroups(prev => {
        const next = new Set(prev);
        next.has(i) ? next.delete(i) : next.add(i);
        return next;
    });
    // One carton's scale reading inside a group. Sparse by design — a group of 3
    // with only #2 weighed keeps ['', '4.95'] rather than inventing the other two.
    const setGroupWeight = (i: number, box: number, val: string) =>
        setBoxGroups(prev => prev.map((g, idx) => {
            if (idx !== i) return g;
            const kg = [...g.kg];
            while (kg.length <= box) kg.push('');
            kg[box] = val;
            return { ...g, kg };
        }));

    // A typed count fills the box's base qty; a typed base qty only back-fills a
    // count that isn't there yet — on a kg item the qty ends up being the scale
    // reading, which must not turn a box of 12 pieces into 11.8.
    const setGroupAlt = (i: number, val: string) => {
        // Weighed: the count is derived and correctable, but correcting it never
        // rewrites the scale reading it came from.
        if (weighBasis) { updateGroup(i, { alt: val }); return; }
        const derived = altToBase(num(val), altFactor);
        updateGroup(i, { alt: val, ...(derived !== null && num(val) > 0 ? { qty: String(derived) } : {}) });
    };
    const setGroupQty = (i: number, val: string) => {
        if (weighBasis) {
            updateGroup(i, { qty: val, alt: num(val) > 0 ? String(altFromBase(num(val))) : '' });
            return;
        }
        const backfill = hasAlt && !(num(boxGroups[i]?.alt) > 0) ? baseToAlt(num(val), altFactor) : null;
        updateGroup(i, { qty: val, ...(backfill !== null ? { alt: String(backfill) } : {}) });
    };
    // Switching to a standard box drops a tare typed for a custom one: the master's
    // figure is what the server will apply, so leaving the old number on screen
    // would promise a brutto that is not going to be printed.
    const setGroupPackaging = (i: number, val: string) =>
        updateGroup(i, {
            packagingTypeId: val,
            ...(isCustomType(val, packagingTypes) ? {} : { tare: '' }),
        });

    const boxRows = useMemo(() => expandBoxGroups(boxGroups), [boxGroups]);
    const boxes = filledBoxRows(boxRows);
    const boxTotal = boxes.reduce((s, b) => s + num(b.qty), 0);
    const boxMismatch = num(qty) > 0 && Math.abs(boxTotal - num(qty)) > 1e-3;
    // Weighed in kg already — the carton qty is its net weight, so there is one
    // input, not two that could disagree on the label. See shared/packingBoxes.
    const qtyIsWeight = uomIsKg(po?.item_uom);
    const weightsMissing = !qtyIsWeight && hasUnweighedBox(boxRows);
    const weightTotal = boxes.reduce((s, b) => s + (qtyIsWeight ? num(b.qty) : num(b.kg)), 0);
    const altTotal = hasAlt ? boxAltTotal(boxRows) : 0;
    // Which box each line is packed in. The master's tare (or, on a custom box,
    // the packer's own weighing) is what turns each net reading into the brutto
    // printed on the label — so it is required here exactly as the weight is.
    const packagingMissing = hasUnboxedBox(boxRows);
    const taresMissing = hasUnweighedTare(boxRows, packagingTypes);
    const tareTotal = boxes.reduce((s, b) => s + effectiveTare(b, packagingTypes), 0);
    const grossTotal = weightTotal + tareTotal;

    const logPack = async () => {
        const label = (po?.package_label || 'carton').toLowerCase();
        if (num(qty) <= 0) { setError('Enter a quantity to pack.'); return; }
        if (!boxes.length) { setError(`At least one ${label} is required.`); return; }
        if (boxMismatch) {
            setError(`${po.package_label}s total ${boxTotal.toFixed(2)} but ${num(qty).toFixed(2)} is being packed.`);
            return;
        }
        if (weightsMissing) { setError(`Weigh every ${label} — the label prints its net weight.`); return; }
        if (packagingMissing) { setError(`Pick the box for every ${label} — its tare makes up the brutto.`); return; }
        if (taresMissing) { setError(`Weigh the empty box on every custom ${label} line.`); return; }
        setLogging(true);
        setError(null);
        try {
            const res = await authFetch(`${API_BASE}/packing/${po.id}/complete`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    qty: num(qty),
                    boxes: boxes.map(b => num(b.qty)),
                    box_weights: boxes.map(b => (qtyIsWeight ? num(b.qty) : num(b.kg))),
                    // Null per carton where no count was typed — the server derives
                    // just that one rather than every carton's.
                    box_alt_qtys: hasAlt ? boxAltPayload(boxRows) : null,
                    box_packaging_type_ids: boxPackagingPayload(boxRows),
                    // Custom boxes only — a standard box's tare is the master's.
                    box_tares: boxTarePayload(boxRows, packagingTypes),
                    source_batch_id: sourceBatch || null,
                    work_center_id: workCenterId || null,
                    operator: operator || null,
                    notes: notes || null,
                }),
            });
            if (res.ok) {
                const fresh = await res.json();
                const before = new Set((po.packed_units || []).map((u: any) => String(u.id)));
                setLastCartons((fresh.packed_units || []).filter((u: any) => !before.has(String(u.id))));
                setPo(fresh);
                setQty(''); setQtyAlt(''); setNotes(''); setBoxGroups([]); setOpenGroups(new Set());
                playBeep();
            } else {
                const e = await res.json().catch(() => ({}));
                setError(e.detail || 'Packing failed.');
            }
        } finally { setLogging(false); }
    };

    const machineOptions = toMachineOptions(machinesOfCenterType(machines, 'PACKING'));

    const reset = () => { setPo(null); setUnit(null); setError(null); setLastCartons([]); setManualCode(''); };

    return (
        <div style={{ fontFamily: XP_FONT, background: MOBILE_BG, minHeight: 'var(--app-vh)', padding: 10 }}>
            <MobileScreenBar
                icon="bi-box2-fill"
                title="Packing Scanner"
                right={<MobileButton compact icon="bi-arrow-left" onClick={onClose}>Back</MobileButton>}
            />

            {error && (
                <MobileNotice tone="red">{error}</MobileNotice>
            )}

            {!po && !unit && (
                <>
                    <MobilePanel icon="bi-camera-fill" title="Scan" style={{ marginBottom: 10 }}>
                        <div id="packing-reader" style={{ width: '100%' }} />
                    </MobilePanel>
                    <MobilePanel icon="bi-keyboard-fill" title="Or type a code">
                        <input
                            style={xpInput}
                            placeholder="PCK-00001 or PU-20260802-0001"
                            value={manualCode}
                            onChange={e => setManualCode(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') resolveCode(manualCode); }}
                        />
                        <MobileButton tone="launch" icon="bi-arrow-return-left" onClick={() => resolveCode(manualCode)} style={{ marginTop: 8 }}>
                            Open
                        </MobileButton>
                    </MobilePanel>
                </>
            )}

            {unit && (
                <MobilePanel icon="bi-box2-fill" title={`Carton ${unit.batch_number}`}>
                    <Row label="Item" value={`${unit.item_name || ''} (${unit.item_code || ''})`} />
                    {/* What is actually in the box: shade/combo off the carton's stock
                        key, size stamped on it at packing. The whole point of the
                        report is telling two same-item cartons apart. */}
                    <div style={{ margin: '2px 0 6px' }}><LotChips batch={unit} /></div>
                    <Row label="Carton no." value={String(unit.package_no ?? '—')} />
                    <Row label="Qty in stock" value={num(unit.qty).toLocaleString()} />
                    {/* The box and its brutto — what a packer holding the carton can
                        check against the label in front of them. */}
                    <Row label="Packaging" value={unit.packaging_type_name || '—'} />
                    <Row label="Weight" value={unit.gross_weight_kg != null
                        ? `${num(unit.gross_weight_kg).toFixed(2)} kg gross (${num(unit.weight_kg).toFixed(2)} net)`
                        : unit.weight_kg != null ? `${num(unit.weight_kg).toFixed(2)} kg net` : '—'} />
                    <Row label="Location" value={unit.location_name || '—'} />
                    <Row label="Packing order" value={unit.packing_order_code || '—'} />
                    <Row label="Quality" value={unit.quality_status} />
                    <MobileButton icon="bi-upc-scan" onClick={reset} style={{ marginTop: 10 }}>Scan another</MobileButton>
                </MobilePanel>
            )}

            {po && (
                <>
                    <MobilePanel
                        icon="bi-clipboard-check-fill"
                        title={po.code}
                        right={<StatusChip status={po.status} />}
                        style={{ marginBottom: 10 }}
                    >
                        <Row label="Item" value={`${po.item_name || ''} (${po.item_code || ''})`} />
                        <Row label="Colour" value={po.color_name || '—'} />
                        <Row label="Sales order" value={po.sales_order_code || 'to stock'} />
                        {/* On an alt-unit order the packer counts pieces into the box, so
                            these lead in that unit with the stock figure in brackets —
                            same rule as the desktop pack modal. Both are COUNTED: the
                            target is the count stated on the order, and packed is summed
                            from the cartons' own counts server-side. Neither divides the
                            kilos by g/y — the boxes are reweighed and an elastic cloth
                            does not hold its estimate. */}
                        <Row label="Target" value={hasAlt
                            ? `${(num(po.qty2) > 0 ? num(po.qty2) : baseToAlt(num(po.qty_target), altFactor) ?? 0).toLocaleString()} ${altUom} (${num(po.qty_target).toLocaleString()} ${po.item_uom || ''})`
                            : `${num(po.qty_target).toLocaleString()} ${po.item_uom || ''}`} />
                        {/* Both figures, like Target above: the boxes are weighed and the
                            piece count is what that weight works out to through this
                            order's sampled unit weight, so the kg stays in brackets rather
                            than being dropped. */}
                        <Row label="Packed" value={hasAlt && po.qty_packed_alt != null
                            ? `${num(po.qty_packed_alt).toLocaleString()} ${altUom} (${num(po.qty_packed).toFixed(2)} ${po.item_uom || ''}) · ${po.package_count || 0} ${(po.package_label || 'carton').toLowerCase()}s`
                            : `${num(po.qty_packed).toLocaleString()} · ${po.package_count || 0} ${(po.package_label || 'carton').toLowerCase()}s`} />
                        <Row label="Machine" value={po.work_center_name || 'not assigned'} />
                    </MobilePanel>

                    {lastCartons.length > 0 && (
                        <MobileNotice tone="green">
                            <strong>Packed:</strong>
                            {lastCartons.map((u: any) => (
                                <div key={u.id}>
                                    #{u.package_no} · {u.batch_number} ·{' '}
                                    {u.alt_qty != null && altUom ? `${num(u.alt_qty)} ${altUom} · ` : ''}
                                    {num(u.qty).toLocaleString()}
                                    {u.packaging_type_name ? ` · ${u.packaging_type_name}` : ''}
                                    {u.gross_weight_kg != null ? ` · ${num(u.gross_weight_kg).toFixed(2)} kg gross` : ''}
                                </div>
                            ))}
                            <div style={{ marginTop: 4, fontSize: 11 }}>Print these labels from the desktop Packing Orders screen.</div>
                        </MobileNotice>
                    )}

                    <MobilePanel icon="bi-pencil-square" title="Log packing">
                        {hasAlt && !weighBasis && (
                            <>
                                <label style={xpLabel}>
                                    Qty packed ({altUom})
                                    <span style={{ fontWeight: 'normal', color: '#777' }}>
                                        {' '}— 1 {altUom} = {altFactor} {po.item_uom || ''}
                                    </span>
                                </label>
                                <input type="number" min={0} style={xpInput} value={qtyAlt}
                                    onChange={e => onQtyAltChange(e.target.value)} />
                            </>
                        )}
                        {weighBasis && (
                            <MobileNotice tone="blue">
                                Weigh only — type kilos, the {altUom} count follows at
                                1 {altUom} = {altFactor} {po.item_uom || ''}.
                            </MobileNotice>
                        )}
                        <label style={{ ...xpLabel, marginTop: hasAlt ? 8 : 0 }}>
                            Qty packed{hasAlt ? ` (${po.item_uom || 'base'})` : ''}
                        </label>
                        <input type="number" min={0} style={xpInput} value={qty} onChange={e => onQtyChange(e.target.value)} />
                        <label style={{ ...xpLabel, marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>
                                {po.package_label || 'Carton'}s packed &amp; weighed
                                <span style={{ fontWeight: 'normal', color: '#777' }}>
                                    {' '}— count × qty each
                                </span>
                                {qtyIsWeight && (
                                    <span style={{ fontWeight: 'normal', color: '#777' }}>
                                        {' '}(qty is the net weight)
                                    </span>
                                )}
                            </span>
                            <MobileButton
                                compact
                                icon="bi-plus-lg"
                                title={`Add another ${(po.package_label || 'carton').toLowerCase()} line`}
                                onClick={addGroup}
                            />
                        </label>
                        {boxGroups.length === 0 && (
                            <div style={{ fontSize: 11, color: '#777', padding: '2px 0' }}>
                                Enter a quantity to generate {(po.package_label || 'carton').toLowerCase()}s.
                            </div>
                        )}
                        {boxGroups.map((g, i) => {
                            const count = groupCount(g);
                            const lineTotal = groupTotal(g);
                            // Cartons before this line, so the expanded weights are
                            // numbered the way the printed labels will be.
                            const offset = boxGroups.slice(0, i).reduce((s, p) => s + groupCount(p), 0);
                            const weighed = Array.from({ length: count }, (_, k) => num(g.kg[k]) > 0).filter(Boolean).length;
                            const open = openGroups.has(i);
                            return (
                                <Fragment key={i}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                        {/* Spinner suppressed and the box widened for the same reason as
                                            the desktop row: a pack run is hundreds of cartons, and the
                                            native chrome was eating the digits rather than the padding. */}
                                        <input type="number" min={0} step={1} className="xp-nospin"
                                            style={{ ...xpInput, width: 60, textAlign: 'right', fontWeight: 'bold' }}
                                            value={g.count} onChange={e => updateGroup(i, { count: e.target.value })} />
                                        <span style={{ fontSize: 13, color: '#777' }}>×</span>
                                        {hasAlt && !weighBasis && (
                                            <input type="number" min={0} step="any" className="xp-nospin" style={{ ...xpInput, flex: 1, minWidth: 0 }}
                                                placeholder={altUom} value={g.alt}
                                                onChange={e => setGroupAlt(i, e.target.value)} />
                                        )}
                                        <input type="number" min={0} step="any" className="xp-nospin"
                                            style={{ ...xpInput, flex: 1, minWidth: 0, ...(weighBasis ? { fontWeight: 'bold' } : {}) }}
                                            placeholder={weighBasis ? (po.item_uom || 'kg') : undefined}
                                            value={g.qty} onChange={e => setGroupQty(i, e.target.value)} />
                                        {hasAlt && weighBasis && (
                                            <input type="number" min={0} step="any" className="xp-nospin"
                                                style={{ ...xpInput, flex: 1, minWidth: 0, color: '#555', background: '#faf9f4' }}
                                                placeholder={altUom} value={g.alt}
                                                onChange={e => setGroupAlt(i, e.target.value)} />
                                        )}
                                        <span style={{
                                            fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap',
                                            color: lineTotal > 0 ? '#0a3e0a' : '#aaa',
                                        }}>= {lineTotal.toFixed(2)}</span>
                                        {/* Scale readings are per carton even inside a line — the
                                            label prints each box's own N.W. A kg item has none:
                                            its qty already IS that weight. */}
                                        {!qtyIsWeight && (
                                            <MobileButton
                                                compact
                                                icon={open ? 'bi-chevron-down' : 'bi-chevron-right'}
                                                title={count > 0 && weighed < count
                                                    ? `${count - weighed} of ${count} still to weigh`
                                                    : `All ${count} weighed`}
                                                onClick={() => toggleGroup(i)}
                                            >{count > 0 && weighed < count ? `${weighed}/${count}` : ''}</MobileButton>
                                        )}
                                        <MobileButton compact tone="danger" icon="bi-x-lg" onClick={() => removeGroup(i)} />
                                    </div>
                                    {/* The box itself, on its own line: a phone row already
                                        carries count × qty and the picker needs a readable
                                        target. Group-level — every carton on this line is the
                                        same box, so it is picked once. */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                        <select
                                            style={{ ...xpInput, flex: 1, minWidth: 0, background: g.packagingTypeId ? '#fff' : '#fffbe6' }}
                                            value={g.packagingTypeId}
                                            onChange={e => setGroupPackaging(i, e.target.value)}
                                        >
                                            <option value="">— pick box —</option>
                                            {packagingTypes.map(t => (
                                                <option key={t.id} value={t.id}>
                                                    {t.name}{!t.is_custom && Number(t.tare_kg) > 0 ? ` (${Number(t.tare_kg)} kg)` : ''}
                                                </option>
                                            ))}
                                        </select>
                                        {isCustomType(g.packagingTypeId, packagingTypes) ? (
                                            <input type="number" min={0} step="any" className="xp-nospin"
                                                style={{ ...xpInput, width: 96, background: num(g.tare) > 0 ? '#fff' : '#fffbe6' }}
                                                placeholder="tare kg" value={g.tare}
                                                onChange={e => updateGroup(i, { tare: e.target.value })} />
                                        ) : (
                                            <span style={{ fontSize: 11, color: '#777', width: 96, textAlign: 'right' }}>
                                                {(() => {
                                                    const t = findPackagingType(g.packagingTypeId, packagingTypes);
                                                    return t && Number(t.tare_kg) > 0 ? `+${Number(t.tare_kg)} kg` : '';
                                                })()}
                                            </span>
                                        )}
                                    </div>
                                    {open && !qtyIsWeight && (
                                        <div style={{ paddingLeft: 14, marginBottom: 4 }}>
                                            {count === 0 && (
                                                <div style={{ fontSize: 11, color: '#777' }}>
                                                    Set a {(po.package_label || 'carton').toLowerCase()} count to weigh.
                                                </div>
                                            )}
                                            {Array.from({ length: count }, (_, k) => (
                                                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                                    <span style={{ fontSize: 11, color: '#777', width: 30 }}>#{offset + k + 1}</span>
                                                    <input type="number" min={0} step="any" required
                                                        style={{ ...xpInput, flex: 1, background: num(g.kg[k]) > 0 ? '#fff' : '#fffbe6' }}
                                                        placeholder="net wt kg" value={g.kg[k] || ''}
                                                        onChange={e => setGroupWeight(i, k, e.target.value)} />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </Fragment>
                            );
                        })}
                        {boxGroups.length > 0 && (
                            <div style={{ fontSize: 11, color: boxMismatch || weightsMissing || packagingMissing || taresMissing ? '#7a4a00' : '#0a3e0a', marginTop: 2 }}>
                                {boxMismatch
                                    ? `Boxed ${boxTotal.toFixed(2)} of ${num(qty).toFixed(2)}`
                                    : weightsMissing
                                        ? `Weigh every ${(po.package_label || 'carton').toLowerCase()}`
                                        : packagingMissing
                                            ? `Pick a box on every line`
                                            : taresMissing
                                                ? `Weigh every custom box`
                                                // Net and gross both: the label prints the pair, and the
                                                // packer should see the tare land before they log.
                                                : `${boxes.length} ${(po.package_label || 'carton').toLowerCase()}s${hasAlt ? ` · ${altTotal.toLocaleString()} ${altUom}` : ''} · ${weightTotal.toFixed(2)} kg net · ${grossTotal.toFixed(2)} kg gross`}
                            </div>
                        )}
                        {lots.length > 0 && (
                            <>
                                <label style={{ ...xpLabel, marginTop: 8 }}>Source lot</label>
                                <select style={xpInput} value={sourceBatch} onChange={e => setSourceBatch(e.target.value)}>
                                    <option value="">— select lot —</option>
                                    {lots.map((b: any) => (
                                        <option key={b.id} value={b.id}>
                                            {b.batch_number}{b.remaining != null ? ` (${Number(b.remaining).toFixed(2)} sisa)` : ''}
                                        </option>
                                    ))}
                                </select>
                            </>
                        )}
                        {machineOptions.length > 0 && (
                            <>
                                <label style={{ ...xpLabel, marginTop: 8 }}>Machine</label>
                                <select style={xpInput} value={workCenterId} onChange={e => setWorkCenterId(e.target.value)}>
                                    <option value="">— none —</option>
                                    {machineOptions.map(o => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                            </>
                        )}
                        <label style={{ ...xpLabel, marginTop: 8 }}>Operator</label>
                        <input style={xpInput} value={operator} onChange={e => setOperator(e.target.value)} />
                        <label style={{ ...xpLabel, marginTop: 8 }}>Notes</label>
                        <input style={xpInput} value={notes} onChange={e => setNotes(e.target.value)} />
                        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                            <MobileButton icon="bi-upc-scan" onClick={reset}>Scan another</MobileButton>
                            <MobileButton tone="create" icon="bi-box-seam" disabled={logging} onClick={logPack} style={{ flex: 1 }}>
                                {logging ? 'Packing...' : 'Pack'}
                            </MobileButton>
                        </div>
                    </MobilePanel>
                </>
            )}
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
