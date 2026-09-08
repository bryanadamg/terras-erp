'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../shared/Toast';
import TreeSelect, { buildLocationPickerTree } from '../shared/TreeSelect';
import ModalWrapper from '../shared/ModalWrapper';
import { LotChips, LotChip } from '../shared/LotChips';
import { CodeChip, xpFont, xpInput as xpInputBase, xpBtn as xpBtnBase, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { RowCheckbox, lvPickerRow } from '../shared/listViewTheme';

const xpInput: React.CSSProperties = xpInputBase({ padding: '0 4px', boxSizing: 'border-box' });
const xpBtn = (primary?: boolean): React.CSSProperties => xpBtnBase(primary ? { ...BTN_TONES.success, padding: '2px 14px' } : {});

// One lot already sitting in this WO's input location, as the backend resolves it
// (identity fields mirror what LotChips renders on the picker rows below).
export interface StagedLot {
    batch_id: string;
    batch_number: string | null;
    qty: number;
    on_line: number;
    staged_at: string | null;
    [k: string]: any;
}

interface RequiredMaterial {
    item_id: string;
    item_code: string | null;
    item_name: string | null;
    attribute_value_ids: string[];
    uom: string | null;
    required_qty: number;
    source_location_id: string | null;
    source_location_name: string | null;
    on_hand: number;
    staged: number;
    shortfall: number;
    lot_tracked: boolean;
    suggested_batch_id: string | null;
    // Warp beams are mounted on the loom, not staged to this WO: `staged` is the kg
    // mounted on the machine (shared by every WO running there) and readiness is
    // counted in whole beams against the machine's beam positions.
    is_beam: boolean;
    mounted_pcs: number;
    required_pcs: number;
    staged_lots: StagedLot[];
}

interface BeamMount {
    id: string;
    batch_id: string;
    beam_number: string | null;
    item_id: string;
    ends: number | null;
    remaining: number;
    mounted_at: string | null;
    mounted_by: string | null;
}

interface LoomBeamStatus {
    work_center_id: string;
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
    onScanMode?: () => void;   // switch to the scan-bags staging modal (dyeing)
}

export default function WOStagingModal({ wo, onClose, onStaged, onScanMode }: Props) {
    const { authFetch, locations, manufacturingOrders, attributes } = useData() as any;
    const { showToast } = useToast();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const [rows, setRows] = useState<RequiredMaterial[]>([]);
    const [qtyToStage, setQtyToStage] = useState<Record<string, string>>({});
    const [sourceByItem, setSourceByItem] = useState<Record<string, string>>({});
    const [batchByItem, setBatchByItem] = useState<Record<string, string[]>>({});
    const [batchesByItem, setBatchesByItem] = useState<Record<string, any[]>>({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [loom, setLoom] = useState<LoomBeamStatus | null>(null);
    const locPickerTreeOptions = useMemo(() => buildLocationPickerTree(locations || []), [locations]);

    // Order identity for the header strip: what this WO is actually making — size
    // and combo/shade live on the MO, not on the WO, so the stager otherwise has
    // only a code to go on when several sizes of the same item are on the floor.
    const mo = useMemo(
        () => (manufacturingOrders || []).find((m: any) => String(m.id) === String(wo.manufacturing_order_id)),
        [manufacturingOrders, wo.manufacturing_order_id],
    );
    const attrValueIndex = useMemo(() => {
        const idx: Record<string, { name: string; value: string; hex?: string | null; system_role?: string | null }> = {};
        (attributes || []).forEach((a: any) => (a.values || []).forEach((v: any) => {
            idx[String(v.id)] = { name: a.name, value: v.value, hex: v.hex, system_role: a.system_role };
        }));
        return idx;
    }, [attributes]);
    // Shape the MO into the same lot-like object LotChips renders, so the order
    // header and every lot row below it read with one visual vocabulary.
    const moIdentity = useMemo(() => {
        if (!mo) return null;
        return {
            bom_size_snapshot: mo.bom_size_snapshot,
            variant_attributes: (mo.attribute_value_ids || [])
                .map((id: string) => attrValueIndex[String(id)])
                .filter(Boolean),
            color_code: mo.color_code,
            color_name: mo.color_name,
            labdip_variant_code: mo.labdip_variant_code,
        };
    }, [mo, attrValueIndex]);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/work-orders/${wo.id}/required-materials`);
                const data: RequiredMaterial[] = res.ok ? await res.json() : [];
                if (!alive) return;
                setRows(data);
                // What warp is already up on this machine — mounted beams belong to the
                // loom, so they're shown as context and kept out of the mount picker.
                let mountedIds = new Set<string>();
                if (data.some(r => r.is_beam)) {
                    const lres = await authFetch(`${API_BASE}/work-orders/${wo.id}/beam-mounts`);
                    const ls: LoomBeamStatus | null = lres.ok ? await lres.json() : null;
                    if (!alive) return;
                    setLoom(ls);
                    mountedIds = new Set((ls?.mounts || []).map(m => m.batch_id));
                }
                // default qty-to-stage = remaining shortfall
                const q: Record<string, string> = {};
                data.forEach(r => { q[r.item_id] = r.shortfall > 0 ? String(r.shortfall) : ''; });
                setQtyToStage(q);
                // Fetch lots/beams for lot-tracked rows plant-wide, not scoped to one
                // resolved location — a beam from another machine/MO is still valid stock.
                const lotRows = data.filter(r => r.lot_tracked);
                const entries = await Promise.all(lotRows.map(async r => {
                    const b = await authFetch(`${API_BASE}/batches?item_id=${r.item_id}&limit=200&with_source_lots=true`);
                    const list = b.ok ? await b.json() : [];
                    // A lot this WO already staged is not a candidate to stage again —
                    // it sits in the input location, so it still has remaining stock and
                    // would otherwise list (and pre-check, when it's also the traced
                    // suggestion). It's shown in the "Staged on line" block instead.
                    const stagedIds = new Set((r.staged_lots || []).map(l => l.batch_id));
                    const avail = (list || []).filter((x: any) =>
                        (x.remaining ?? 0) > 0 && x.quality_status !== 'REJECTED'
                        // A beam already up on this loom isn't a candidate to mount again.
                        && !(r.is_beam && mountedIds.has(x.id))
                        && !stagedIds.has(x.id)
                        // Sitting on another WO's line: staging it here would take that
                        // WO's material, and the backend rejects it (staging_service.py).
                        && !(x.reserved_wo_id && String(x.reserved_wo_id) !== String(wo.id))
                    );
                    return [r.item_id, avail] as const;
                }));
                if (!alive) return;
                const byItem = Object.fromEntries(entries);
                setBatchesByItem(byItem);
                // Default-select the traced beam batch when it's still available; still overridable.
                const defaults: Record<string, string[]> = {};
                lotRows.forEach(r => {
                    const available = (byItem[r.item_id] || []) as any[];
                    if (r.suggested_batch_id && available.some(b => b.id === r.suggested_batch_id)) {
                        defaults[r.item_id] = [r.suggested_batch_id];
                    }
                });
                if (Object.keys(defaults).length) setBatchByItem(prev => ({ ...defaults, ...prev }));
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [wo.id]);

    const hasBeams = rows.some(r => r.is_beam);

    // Every lot this WO already staged, flattened across the step's materials —
    // shown as one panel above the table (the material it belongs to rides along
    // as a chip), so what's on the line reads before what's still to pick.
    const allStagedLots = useMemo(
        () => rows.flatMap(r => (r.staged_lots || []).map(l => ({ ...l, item_code: r.item_code, item_id: r.item_id }))),
        [rows],
    );
    const stagedKg = useMemo(
        () => allStagedLots.reduce((s, l) => s + (l.qty || 0), 0),
        [allStagedLots],
    );
    const multiItem = rows.length > 1;

    // Sum of remaining qty across the beams/lots selected for this item.
    const selectedLotQty = (itemId: string) => {
        const selected = new Set(batchByItem[itemId] || []);
        return (batchesByItem[itemId] || [])
            .filter((b: any) => selected.has(b.id))
            .reduce((sum: number, b: any) => sum + (b.remaining ?? 0), 0);
    };

    // Staging never clips a picked qty (the backend moves whole lots — a 12.5 kg bag
    // against a 12.4 kg step puts 12.5 kg on the line, not 12.4 with 0.1 kg orphaned
    // in the store). So the excess is shown here, the same warning Scan bags gives.
    const overKg = useMemo(
        () => rows
            .filter(r => !r.is_beam)
            .reduce((sum, r) => {
                const pick = r.lot_tracked ? selectedLotQty(r.item_id) : parseFloat(qtyToStage[r.item_id] || '0');
                if (!pick || pick <= 0) return sum;
                return sum + Math.max(0, r.staged + pick - r.required_qty);
            }, 0),
        [rows, batchByItem, batchesByItem, qtyToStage],
    );

    const submit = async () => {
        const lotLines = rows
            .filter(r => r.lot_tracked)
            .flatMap(r => {
                const selected = new Set(batchByItem[r.item_id] || []);
                return (batchesByItem[r.item_id] || [])
                    .filter((b: any) => selected.has(b.id))
                    .map((b: any) => ({
                        item_id: r.item_id,
                        qty: b.remaining ?? 0,
                        // Each beam/lot carries its own actual location — may differ from
                        // the row's default-resolved source if it sits at another machine.
                        source_location_id: b.location_id || r.source_location_id || sourceByItem[r.item_id] || null,
                        batch_id: b.id,
                        attribute_value_ids: r.attribute_value_ids || [],
                    }));
            });
        const plainLines = rows
            .filter(r => !r.lot_tracked)
            .map(r => ({ r, qty: parseFloat(qtyToStage[r.item_id] || '0') }))
            .filter(({ qty }) => qty > 0)
            .map(({ r, qty }) => ({
                item_id: r.item_id,
                qty,
                source_location_id: r.source_location_id || sourceByItem[r.item_id] || null,
                batch_id: null,
                attribute_value_ids: r.attribute_value_ids || [],
            }));
        const lines = [...lotLines, ...plainLines];
        if (!lines.length) { showToast('Select beams/lots or enter a quantity to stage.', 'danger'); return; }
        const missingSrc = lines.find(l => !l.source_location_id);
        if (missingSrc) {
            const r = rows.find(x => x.item_id === missingSrc.item_id);
            showToast(`Pick a source location for ${r?.item_code || r?.item_name}.`, 'danger'); return;
        }
        // lot-tracked rows with a shortfall must have at least one beam/lot selected.
        // Beams are counted in pieces against the loom's positions, not in kg —
        // a warp that's already up needs nothing selected.
        const missingLot = rows.find(r => r.lot_tracked
            && (r.is_beam ? r.mounted_pcs < Math.max(1, r.required_pcs) : r.shortfall > 0)
            && !(batchByItem[r.item_id] || []).length);
        if (missingLot) {
            showToast(
                missingLot.is_beam
                    ? `Select a beam to mount for ${missingLot.item_code || missingLot.item_name}.`
                    : `Select a beam/lot for ${missingLot.item_code || missingLot.item_name}.`,
                'danger',
            ); return;
        }

        setSubmitting(true);
        try {
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
            showToast(hasBeams ? 'Beam mounted on machine.' : 'Materials staged to line.', 'success');
            onStaged(updated);
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    // Send a lot back to its store — the mirror of `submit` for one row. Returns
    // whatever is still physically on the line (`on_line`), never the original
    // staged qty, so a partly-consumed lot gives back only its remnant. Beams are
    // absent from this list on purpose: a warp comes off through unmount.
    const unstage = async (lot: { batch_id: string; item_id: string; batch_number: string | null; on_line: number }) => {
        if (lot.on_line <= 1e-6) {
            showToast('Nothing left of that lot on the line.', 'danger'); return;
        }
        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/work-orders/${wo.id}/unstage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lines: [{ item_id: lot.item_id, qty: lot.on_line, batch_id: lot.batch_id }],
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                showToast(err?.detail || 'Return failed', 'danger');
                return;
            }
            const updated = await res.json().catch(() => null);
            showToast(`Lot ${lot.batch_number || ''} returned to store.`, 'success');
            onStaged(updated);
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ModalWrapper
            isOpen
            onClose={onClose}
            title={`${hasBeams ? 'Mount Beam' : 'Stage Materials'} — ${wo.code || wo.name}`}
            modeless
            size="xxl"
            footer={
                <>
                    <button className={XP_BTN} style={xpBtn(false)} onClick={onClose} disabled={submitting}>Cancel</button>
                    <button className={XP_BTN} style={xpBtn(true)} onClick={submit} disabled={submitting || loading || rows.length === 0}>
                        {submitting
                            ? (hasBeams ? 'Mounting...' : 'Staging...')
                            : (hasBeams ? 'Mount Beam' : 'Stage Materials')}
                    </button>
                </>
            }
        >
            <div style={{ fontFamily: xpFont, fontSize: 11 }}>
                {onScanMode && (
                    <div style={{ display: 'flex', gap: 0, marginBottom: 8, border: '1px solid #7f9db9', width: 'fit-content' }}>
                        <span style={{ padding: '3px 12px', fontWeight: 'bold', background: 'linear-gradient(to bottom,#cfe0ff,#8fb3e8)', color: '#0a2a66' }}>Manual</span>
                        {/* "bags" only when there is nothing to mount: on a loom the scan
                            branch puts a warp up, and calling that a bag misreads it. */}
                        <button className={XP_BTN} onClick={onScanMode} style={{ ...xpBtn(false), border: 'none', borderLeft: '1px solid #7f9db9', padding: '3px 12px' }}>
                            {hasBeams ? 'Scan' : 'Scan bags'}
                        </button>
                    </div>
                )}
                {moIdentity && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                        border: '1px solid #cfccc4', background: '#f7f6f2',
                        padding: '4px 6px', marginBottom: 8,
                    }}>
                        <span style={{ fontWeight: 'bold' }}>{mo?.item_code || mo?.code || ''}</span>
                        {mo?.code ? (
                            <LotChip tone="order" mono title="Manufacturing order">{mo.code}</LotChip>
                        ) : null}
                        <LotChips batch={moIdentity} />
                        {wo.work_center_name ? (
                            <LotChip tone="location" title="Work center">
                                <i className="bi bi-gear" />{wo.work_center_name}
                            </LotChip>
                        ) : null}
                    </div>
                )}
                <div style={{ fontSize: 10, color: '#555', marginBottom: 8 }}>
                    Moves each material from its source store into this work order&apos;s input location
                    (<b>{wo.input_location?.code || wo.input_location_id || 'no input location'}</b>).
                </div>

                {hasBeams && (
                    <div style={{
                        border: '1px solid #7f9db9', background: '#f4f8ff',
                        padding: '5px 7px', marginBottom: 8, fontSize: 10, color: '#243a5e',
                    }}>
                        <b>Beams belong to the machine, not this work order.</b> A mounted warp stays up
                        and feeds every WO that runs on{' '}
                        <b>{loom?.work_center_code || wo.work_center?.code || 'this machine'}</b> — size S,
                        then M, then L — so it is mounted once and never re-staged per size.
                        {loom ? (
                            <>
                                {' '}Currently <b>{loom.mounted_pcs} of {loom.beam_slots}</b> beam
                                position{loom.beam_slots === 1 ? '' : 's'} filled
                                ({loom.total_remaining.toFixed(1)} kg warp up).
                            </>
                        ) : null}
                        {loom && loom.mounts.length > 0 && (
                            <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid #c8d8ef' }}>
                                {loom.mounts.map(m => (
                                    <div key={m.id}>
                                        <b>{m.beam_number}</b>
                                        {m.ends ? <span style={{ color: '#666' }}> — {m.ends} ends</span> : null}
                                        <span style={{ color: '#0058e6' }}> {m.remaining.toFixed(1)} kg left</span>
                                        {m.mounted_by ? <span style={{ color: '#777' }}> · by {m.mounted_by}</span> : null}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* What this WO already put on the line, above the table. These lots
                    are filtered out of the pickers below, so the two lists never
                    disagree; `on_line` is live, so a consumed lot reads 0 left. */}
                {!loading && allStagedLots.length > 0 && (
                    <div style={{
                        border: '1px solid #a8d0a8', background: '#f2f9f2',
                        padding: '4px 6px', marginBottom: 8,
                    }}>
                        <div style={{ fontSize: 10, color: '#1a5e1a', fontWeight: 'bold', marginBottom: 3 }}>
                            <i className="bi bi-box-seam" /> Staged on line ({stagedKg.toFixed(2)})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {allStagedLots.map(sl => {
                                const gone = sl.on_line + 1e-6 < sl.qty;
                                return (
                                    <div key={sl.batch_id} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                        {multiItem && sl.item_code ? (
                                            <span style={{ fontWeight: 'bold', fontSize: 10 }}>{sl.item_code}</span>
                                        ) : null}
                                        <CodeChip code={sl.batch_number || '—'} classic />
                                        <LotChip tone="qty" title="Quantity staged to this WO">
                                            {sl.qty.toFixed(1)}
                                        </LotChip>
                                        {gone ? (
                                            <LotChip tone="pending" title="Still at the input location — the rest was consumed or moved">
                                                {sl.on_line.toFixed(1)} left
                                            </LotChip>
                                        ) : null}
                                        <LotChips batch={sl} showOrder />
                                        {sl.staged_at ? (
                                            <span style={{ color: '#888', fontSize: 9 }}>
                                                {new Date(sl.staged_at).toLocaleString()}
                                            </span>
                                        ) : null}
                                        {sl.on_line > 1e-6 ? (
                                            <button
                                                className={XP_BTN}
                                                style={xpBtnBase({ ...BTN_TONES.danger, padding: '0 6px', fontSize: 9, marginLeft: 'auto' })}
                                                onClick={() => unstage(sl as any)}
                                                disabled={submitting}
                                                title="Return what is left of this lot to its store"
                                            >
                                                <i className="bi bi-arrow-return-left" /> Return
                                            </button>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {!loading && overKg > 1e-6 && (
                    <div style={{
                        background: '#fff3cd', border: '1px solid #b8860b', color: '#7a5000',
                        padding: '4px 8px', marginBottom: 8, fontSize: 10,
                    }}>
                        This stage puts <b>{overKg.toFixed(2)}</b> past what the step requires.
                        Whole lots move — nothing is clipped, and the surplus can be reassigned
                        off the line afterwards.
                    </div>
                )}

                    {loading ? (
                        <div style={{ color: '#888', padding: 12 }}>Loading required materials...</div>
                    ) : rows.length === 0 ? (
                        <div style={{ color: '#888', padding: 12 }}>
                            No materials for this step. Assign a routing step with materials on the WO/BOM.
                        </div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                                <thead>
                                    <tr style={{ background: '#d4d0c8', textAlign: 'left' }}>
                                        <th style={{ padding: '3px 5px' }}>Material</th>
                                        <th style={{ padding: '3px 5px' }}>Source</th>
                                        <th style={{ padding: '3px 5px', textAlign: 'right' }}>Required</th>
                                        <th style={{ padding: '3px 5px', textAlign: 'right' }}>On hand</th>
                                        <th style={{ padding: '3px 5px', textAlign: 'right' }}>
                                            {hasBeams ? 'Staged / Mounted' : 'Staged'}
                                        </th>
                                        <th style={{ padding: '3px 5px', textAlign: 'right' }}>Stage now</th>
                                        <th style={{ padding: '3px 5px' }}>{hasBeams ? 'Beam / Lot' : 'Lot'}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(r => {
                                        const stageQty = r.lot_tracked ? selectedLotQty(r.item_id) : parseFloat(qtyToStage[r.item_id] || '0');
                                        const short = r.on_hand + 1e-9 < stageQty;
                                        const stagedLots = r.staged_lots || [];
                                        return (
                                            <React.Fragment key={r.item_id}>
                                            <tr style={{ borderBottom: '1px solid #cfccc4' }}>
                                                <td style={{ padding: '3px 5px' }}>
                                                    <div style={{ fontWeight: 'bold' }}>{r.item_code || '—'}</div>
                                                    <div style={{ color: '#777' }}>{r.item_name}</div>
                                                    {/* The variant the BOM line calls for — a material row can be
                                                        variant-specific (combo/colour) even when the lot rows aren't. */}
                                                    <LotChips
                                                        batch={{
                                                            variant_attributes: (r.attribute_value_ids || [])
                                                                .map((id: string) => attrValueIndex[String(id)])
                                                                .filter(Boolean),
                                                        }}
                                                    />
                                                </td>
                                                <td style={{ padding: '3px 5px' }}>
                                                    {r.source_location_id ? (r.source_location_name || '—') : (
                                                        <TreeSelect
                                                            options={locPickerTreeOptions}
                                                            value={sourceByItem[r.item_id] || ''}
                                                            onChange={id => setSourceByItem(p => ({ ...p, [r.item_id]: id }))}
                                                            placeholder="— pick source —"
                                                            style={{ minWidth: 140 }}
                                                            size="sm"
                                                        />
                                                    )}
                                                </td>
                                                <td style={{ padding: '3px 5px', textAlign: 'right' }}>
                                                    {r.is_beam ? (
                                                        <>
                                                            <div style={{ fontWeight: 'bold' }}>
                                                                {Math.max(1, r.required_pcs)} pcs
                                                            </div>
                                                            <div style={{ color: '#777' }}>
                                                                {r.required_qty.toFixed(1)}{r.uom ? ` ${r.uom}` : ''}
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            {r.required_qty.toFixed(2)}
                                                            {r.uom && <span style={{ color: '#888', marginLeft: 3, fontSize: 9 }}>{r.uom}</span>}
                                                        </>
                                                    )}
                                                </td>
                                                <td style={{ padding: '3px 5px', textAlign: 'right', color: short ? '#b00' : '#333' }}>
                                                    {r.on_hand.toFixed(2)}
                                                </td>
                                                <td style={{ padding: '3px 5px', textAlign: 'right' }}>
                                                    {r.is_beam ? (
                                                        <>
                                                            <div style={{
                                                                fontWeight: 'bold',
                                                                color: r.mounted_pcs >= Math.max(1, r.required_pcs) ? '#0a6b0a' : '#b06000',
                                                            }}>
                                                                {r.mounted_pcs} / {Math.max(1, r.required_pcs)} pcs
                                                            </div>
                                                            <div style={{ color: '#777' }}>{r.staged.toFixed(1)} kg up</div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div>{r.staged.toFixed(2)}</div>
                                                            {stagedLots.length ? (
                                                                <div style={{ color: '#777', fontSize: 9 }}>
                                                                    {stagedLots.length} lot{stagedLots.length === 1 ? '' : 's'}
                                                                </div>
                                                            ) : null}
                                                        </>
                                                    )}
                                                </td>
                                                <td style={{ padding: '3px 5px', textAlign: 'right' }}>
                                                    {r.is_beam ? (
                                                        <span style={{ fontWeight: 'bold' }}>
                                                            {(batchByItem[r.item_id] || []).length
                                                                ? `+${(batchByItem[r.item_id] || []).length} pcs`
                                                                : '—'}
                                                        </span>
                                                    ) : r.lot_tracked ? (
                                                        <span style={{ fontWeight: 'bold' }}>{stageQty.toFixed(2)}</span>
                                                    ) : (
                                                        <input
                                                            type="number" min="0" step="any"
                                                            style={{ ...xpInput, width: 70, textAlign: 'right' }}
                                                            value={qtyToStage[r.item_id] || ''}
                                                            onChange={e => setQtyToStage(p => ({ ...p, [r.item_id]: e.target.value }))}
                                                        />
                                                    )}
                                                </td>
                                                <td style={{ padding: '3px 5px', width: '46%' }}>
                                                    {r.lot_tracked ? (
                                                        <div style={{
                                                            border: '1px solid #7f9db9', background: 'white',
                                                            maxHeight: 260, overflowY: 'auto', minWidth: 320,
                                                        }}>
                                                            {(batchesByItem[r.item_id] || []).length === 0 ? (
                                                                <div style={{ color: '#aaa', padding: '2px 4px' }}>
                                                                    {r.is_beam ? '— no free beams to mount —' : '— no beams/lots available —'}
                                                                </div>
                                                            ) : (batchesByItem[r.item_id] || []).map((b: any) => {
                                                                const checked = (batchByItem[r.item_id] || []).includes(b.id);
                                                                return (
                                                                    <label key={b.id} style={lvPickerRow(true, checked)}>
                                                                        <RowCheckbox
                                                                            classic
                                                                            checked={checked}
                                                                            label={b.batch_number || 'lot'}
                                                                            onChange={() => setBatchByItem(p => {
                                                                                const cur = p[r.item_id] || [];
                                                                                const next = !checked
                                                                                    ? [...cur, b.id]
                                                                                    : cur.filter(id => id !== b.id);
                                                                                return { ...p, [r.item_id]: next };
                                                                            })}
                                                                        />
                                                                        {/* Lot number on line 1; what the lot IS (size, combo,
                                                                            shade) as chips on line 2 — a stager picking greige
                                                                            for a dyeing WO can't tell two GRG- lots apart from
                                                                            the number alone. RM provenance stays last. */}
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                                                <CodeChip code={b.batch_number} classic />
                                                                                <LotChip tone="qty" title="Quantity remaining">
                                                                                    {(b.remaining ?? 0).toFixed(1)}
                                                                                </LotChip>
                                                                                {b.location_name ? (
                                                                                    <LotChip tone="location" title="Current location">
                                                                                        <i className="bi bi-geo-alt" />{b.location_name}
                                                                                    </LotChip>
                                                                                ) : null}
                                                                                {b.ends ? (
                                                                                    <LotChip tone="order" title="Warp ends">{b.ends} ends</LotChip>
                                                                                ) : null}
                                                                            </div>
                                                                            <LotChips batch={b} showOrder />
                                                                            {Array.isArray(b.source_lots) && b.source_lots.length > 0 ? (
                                                                                <span style={{ color: '#777', fontSize: 9 }}>
                                                                                    RM lot: {b.source_lots.join(', ')}
                                                                                </span>
                                                                            ) : null}
                                                                        </div>
                                                                    </label>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : <span style={{ color: '#bbb' }}>—</span>}
                                                </td>
                                            </tr>
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
            </div>
        </ModalWrapper>
    );
}
