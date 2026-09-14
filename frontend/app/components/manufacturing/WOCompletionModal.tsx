'use client';

import React, { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useToast } from '../shared/Toast';
import SearchableSelect from '../shared/SearchableSelect';
import { useItemSearch, itemToOption } from '../shared/useEntitySearch';
import ModalWrapper from '../shared/ModalWrapper';
import BagLabelPrintModal from './BagLabelPrintModal';
import { ProgressBar, LegendPanel, CodeChip, xpFont, CHIP_RADIUS, xpInput as xpInputBase, xpBtn as xpBtnBase, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { RowCheckbox, LV_STICKY_THEAD, lvPickerRow } from '../shared/listViewTheme';
import { LotChips } from '../shared/LotChips';
import { centerTypeOfWC, isContainerWC, isMachineWC, machinesUnderWC, toMachineOptions } from '../shared/workCenterTree';
import { rejectTitle } from '../shared/rejectDisplay';
import DoseSheet, { fmtDose } from '../shared/DoseSheet';
import { useDyeingBath } from '../shared/useDyeingBath';

const xpInput: React.CSSProperties = xpInputBase({ padding: '0 4px', width: '100%', boxSizing: 'border-box' });
const xpLabel: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11, display: 'block', marginBottom: 2,
};
const xpBtn = (primary?: boolean): React.CSSProperties => xpBtnBase(primary ? { ...BTN_TONES.success, padding: '2px 14px' } : {});

interface ActualItem {
    item_id: string;
    qty_used: string;
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

interface WOCompletionModalProps {
    mo: any;
    onClose: () => void;
    onSaved: (updatedMO: any) => void;
    workOrder?: any;
}

export default function WOCompletionModal({ mo, onClose, onSaved, workOrder }: WOCompletionModalProps) {
    const { authFetch, workCenters, items } = useData() as any;
    const { showToast } = useToast();
    const { formatDateTime: tzDateTime } = useTimezone();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const [qtyCompleted, setQtyCompleted] = useState('');
    const [qtyCones, setQtyCones] = useState('');
    const [qtyBoxes, setQtyBoxes] = useState('');
    const [operatorName, setOperatorName] = useState('');
    const [notes, setNotes] = useState('');
    const [workCenterId, setWorkCenterId] = useState('');
    const [actualItems, setActualItems] = useState<ActualItem[]>([]);
    const [materialRows, setMaterialRows] = useState<MaterialRow[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [subPickerIdx, setSubPickerIdx] = useState<number | null>(null);
    const [beamNumber, setBeamNumber] = useState('');
    const [batchesByItem, setBatchesByItem] = useState<Record<string, any[]>>({});
    // Lots on this line that are staged to a DIFFERENT WO. Held apart from
    // batchesByItem — not merged and disabled — because every consumption rule
    // here counts that array (isMultiLot's >= 2, the All button, the shortfall
    // check), and a neighbour's bags must not tip any of them. Shown read-only so
    // the operator sees why a bag they can see on the floor isn't selectable.
    const [reservedByItem, setReservedByItem] = useState<Record<string, any[]>>({});
    const [consumedBatches, setConsumedBatches] = useState<Record<string, string>>({});
    // Dyeing: greige substrate arrives as many scanned lots → draw from several of
    // them (item_id → selected batch ids). Single-lot materials keep the <select>.
    const [selectedLots, setSelectedLots] = useState<Record<string, string[]>>({});
    // Bag labels: one sticker per weighed bag (= one lotted completion on this WO)
    const [labelBags, setLabelBags] = useState<any[] | null>(null);
    const [labelSeqStart, setLabelSeqStart] = useState(1);

    // Substitute picker: server typeahead, not a filter over DataContext's `items`
    // (only a 50-row, newest-first page — a candidate outside it was unreachable no
    // matter what was typed). `resolve` covers items seen in any page so far, so a
    // BOM line or an already-picked substitute keeps its name/code once the result
    // window moves past it.
    const { results: itemResults, onSearch: onSearchItems, resolve: resolveItem } = useItemSearch({ seed: items });

    const findItem = (itemId: string) => resolveItem(itemId) || (items || []).find((i: any) => i.id === itemId);
    const isBeamItem = (itemId: string) => {
        const it = findItem(itemId);
        return (it?.category_path || []).some((p: string) => (p || '').toLowerCase() === 'beam');
    };
    // WOs created without a machine have no input/output location — stock
    // movement would silently be skipped. Force a machine pick here so the
    // backend can assign locations onto the WO before consuming/producing stock.
    const woInputLocId = workOrder?.input_location_id || workOrder?.input_location?.id;
    const woOutputLocId = workOrder?.output_location_id || workOrder?.output_location?.id;
    const woWc = (workCenters || []).find((wc: any) => wc.id === workOrder?.work_center_id);
    // A WO cut before its group carried locations has blank ones, but its work
    // center still resolves them (own value, else group's/type's) — the backend
    // backfills on log, so don't demand a machine pick in that case.
    const needsMachine = !!workOrder && (
        !(woInputLocId || woWc?.effective_input_location_id || woWc?.input_location_id)
        || !(woOutputLocId || woWc?.effective_output_location_id || woWc?.output_location_id)
    );

    // Lot output: WO produces a beam (Beam category / BEAM- code / BEAMING work center) or a lot-tracked item
    const woWcType = (woWc?.center_type || '').toUpperCase();
    const isBeamOutput = !!workOrder
        && (isBeamItem(mo.item_id) || (mo.item_code || '').startsWith('BEAM-') || woWcType === 'BEAMING');
    // Greige (weaving), dyed (dyeing) and set (setting) output are always traceable
    // lots on the backend too — surface the same lot-number field for them here.
    const isLotOutput = isBeamOutput || (!!workOrder && !!findItem(mo.item_id)?.lot_tracked)
        || ['WEAVING', 'TENUN', 'DYEING', 'CELUP', 'SETTING'].includes(woWcType);
    const isWeavingWO = woWcType === 'WEAVING' || woWcType === 'TENUN';
    const isDyeingWO = woWcType === 'DYEING' || woWcType === 'CELUP';
    // Bag-fed steps: substrate arrives as many weighed, scanned bags — greige into
    // dyeing, dyed lots into setting. Same shape on the way out, so both consume
    // the same way. Mirrors SCAN_STAGE_WC_TYPES on the staging side.
    const isSettingWO = woWcType === 'SETTING';
    const isBagFedWO = isDyeingWO || isSettingWO;
    // Multi-lot consume: substrate staged as several bags (≥2 lots at the input
    // location). One picker can't select 30 bags — use checkboxes. The checked
    // lots are the SOURCE POOL; the qty deducted is the logged draw, not each
    // lot's whole remaining. Single-lot materials (e.g. chemicals) keep the
    // single <select> + BOM% deduction.
    const isMultiLot = (itemId: string) => isBagFedWO && (batchesByItem[itemId]?.length || 0) >= 2;
    // Mirrors the backend's prefix choice in manufacturing.py's log-completion route.
    const lotLabel = isBeamOutput ? 'Beam' : isWeavingWO ? 'Greige' : isDyeingWO ? 'Dyed Lot' : isSettingWO ? 'Set Lot' : 'Lot';
    const lotPrefix = isBeamOutput ? 'BM' : isWeavingWO ? 'GRG' : isDyeingWO ? 'DYE' : isSettingWO ? 'SET' : 'LOT';

    // The dye bath, recorded here rather than on the Dyeing Orders tab: the bath and
    // the output it produced are one act by one operator, and splitting them across
    // two screens is what let a WO be finished with its bath never recorded (and its
    // status say the opposite). The hook finds the WO's open DyeingRun, weighs the
    // recipe against the typed volume, and writes bath + actuals on submit.
    const dyeBath = useDyeingBath({
        workOrderId: workOrder?.id,
        enabled: isDyeingWO,
        authFetch,
        apiBase: API_BASE,
    });

    // How much of a multi-lot material this log actually uses: the Material
    // Consumption row's actual qty (defaults to output qty x BOM%, operator can
    // override). The checked lots are the SOURCE, not the amount — a GRG- lot
    // gives up only what this dyeing run drew and keeps its remainder for the
    // next run.
    const lotNeed = (itemId: string) => {
        const row = materialRows.find(r => r.item_id === itemId);
        const v = row ? parseFloat(row.actual_qty) : parseFloat(qtyCompleted);
        return isNaN(v) ? 0 : v;
    };
    // Spread that draw FIFO across the checked lots — oldest first, each capped
    // at its own remaining. /batches returns newest-first, hence the reverse.
    const lotAllocation = (itemId: string): { batch_id: string; qty: number }[] => {
        const sel = new Set(selectedLots[itemId] || []);
        if (!sel.size) return [];
        let need = lotNeed(itemId);
        if (need <= 0) return [];
        const lots = (batchesByItem[itemId] || []).filter((b: any) => sel.has(b.id)).slice().reverse();
        const out: { batch_id: string; qty: number }[] = [];
        for (const b of lots) {
            if (need <= 1e-9) break;
            const take = Math.min(need, Number(b.remaining || 0));
            if (take <= 0) continue;
            out.push({ batch_id: b.id, qty: Number(take.toFixed(4)) });
            need -= take;
        }
        return out;
    };

    // Lot input: each material line with batch stock at the input location gets a lot picker
    const materialItemIds = workOrder ? Array.from(new Set(materialRows.map(r => r.item_id))) : [];
    useEffect(() => {
        if (!materialItemIds.length) { setBatchesByItem({}); setReservedByItem({}); setConsumedBatches({}); return; }
        const loc = woInputLocId;
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
                // A lot staged to another WO is that WO's material: the backend
                // rejects consuming it, so it is not an option here either.
                const mine = list.filter((b: any) => !b.reserved_wo_id || String(b.reserved_wo_id) === String(workOrder?.id));
                const theirs = list.filter((b: any) => b.reserved_wo_id && String(b.reserved_wo_id) !== String(workOrder?.id));
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
            // Bag-fed steps: start with NOTHING checked. A pre-ticked list reads as
            // confirmed and gets logged as-is — the operator must positively pick
            // the lots that physically went into the bath. "All" is one click away.
            setSelectedLots(prev => {
                const next: Record<string, string[]> = {};
                for (const id of Object.keys(map)) {
                    if (isBagFedWO && map[id].length >= 2) next[id] = prev[id] || [];
                }
                return next;
            });
        });
    }, [JSON.stringify(materialItemIds), workOrder?.id, isWeavingWO, isBagFedWO]);

    // Putaway destination is a planning decision carried by the MO — operator
    // only sees where the output goes; the backend books stock there.
    const putawayDest = mo.planned_putaway_location_name
        || workOrder?.output_location?.name
        || workOrder?.output_location_name
        || null;

    // Build material rows from BOM lines when in WO mode.
    // L2: a WO only consumes the materials allocated to its routing step
    // (line.bom_operation_id == workOrder.bom_operation_id). Legacy WOs with no
    // step fall back to the whole recipe.
    useEffect(() => {
        if (!workOrder || !mo.bom?.lines?.length) return;
        const allLines: any[] = mo.bom.lines;
        const bomLines: any[] = workOrder?.bom_operation_id
            ? allLines.filter((l: any) => l.bom_operation_id && String(l.bom_operation_id) === String(workOrder.bom_operation_id))
            : allLines;
        setMaterialRows(bomLines.map((line: any) => ({
            item_id: line.item_id,
            item_name: line.item_name || '',
            item_code: line.item_code || '',
            planned_pct: line.percentage ?? 0,
            actual_qty: '',
            is_custom: false,
            is_substitute: false,
            orig_item_id: line.item_id,
            orig_item_name: line.item_name || '',
            orig_item_code: line.item_code || '',
        })));
        setSubPickerIdx(null);
    }, [workOrder?.id]);

    // Recalculate planned qty column and update uncustomized actuals when output qty changes
    useEffect(() => {
        if (!workOrder) return;
        const qty = parseFloat(qtyCompleted);
        if (!qty || qty <= 0) return;
        setMaterialRows(prev => prev.map(row => {
            const planned = (qty * row.planned_pct) / 100;
            return row.is_custom ? row : { ...row, actual_qty: planned.toFixed(4) };
        }));
    }, [qtyCompleted]);

    const totalCompleted = mo.qty_completed_total ?? 0;
    const target = mo.qty ?? 0;
    const remaining = Math.max(0, target - totalCompleted);
    const pct = target > 0 ? Math.min(100, Math.round((totalCompleted / target) * 100)) : 0;

    // Current WO progress (this step's own target)
    const woTarget = workOrder?.qty ?? 0;
    const woDone = workOrder?.qty_completed_total ?? 0;
    const woRemaining = Math.max(0, woTarget - woDone);
    const woPct = woTarget > 0 ? Math.min(100, Math.round((woDone / woTarget) * 100)) : 0;

    const addActualItem = () => setActualItems(prev => [...prev, { item_id: '', qty_used: '' }]);
    const removeActualItem = (idx: number) => setActualItems(prev => prev.filter((_, i) => i !== idx));
    const updateActualItem = (idx: number, field: keyof ActualItem, value: string) =>
        setActualItems(prev => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const qty = parseFloat(qtyCompleted);
        if (!qty || qty <= 0) {
            showToast('Enter a positive quantity', 'danger');
            return;
        }

        // WO mode: validate material rows
        if (workOrder) {
            if (needsMachine && !workCenterId) {
                showToast('This work order has no input/output location — select a Machine to assign one before logging.', 'danger');
                return;
            }
            for (const row of materialRows) {
                const v = parseFloat(row.actual_qty);
                if (isNaN(v) || v < 0) {
                    showToast(`Invalid quantity for ${row.item_code || row.item_name}`, 'danger');
                    return;
                }
            }
            for (const itemId of Object.keys(batchesByItem)) {
                const code = findItem(itemId)?.code || 'material';
                if (isMultiLot(itemId)) {
                    if (!(selectedLots[itemId]?.length)) {
                        showToast(`Select at least one lot to consume for ${code}`, 'danger');
                        return;
                    }
                    const need = lotNeed(itemId);
                    if (need <= 0) {
                        showToast(`Enter the qty used for ${code} in Material Consumption`, 'danger');
                        return;
                    }
                    // Draw is capped per lot at its remaining — short selection would
                    // silently under-consume, so make the operator pick more lots.
                    const drawn = lotAllocation(itemId).reduce((s, l) => s + l.qty, 0);
                    if (drawn + 1e-6 < need) {
                        showToast(
                            `Selected lots hold only ${drawn.toFixed(2)} of the ${need.toFixed(2)} needed for ${code} — select more lots`,
                            'danger',
                        );
                        return;
                    }
                } else if (!consumedBatches[itemId]) {
                    showToast(`Select the lot/beam to consume for ${code}`, 'danger');
                    return;
                }
            }
        } else {
            for (const ai of actualItems) {
                if (!ai.item_id || !ai.qty_used || parseFloat(ai.qty_used) <= 0) {
                    showToast('Each actual item row needs an item and a positive quantity', 'danger');
                    return;
                }
            }
        }

        setSubmitting(true);
        try {
            // Bath and chemical actuals go FIRST: a rejected bath (no resolvable
            // volume, a closed run) must stop the log rather than land after stock
            // has already moved. No-op for every non-dyeing WO.
            const bathErr = await dyeBath.flush();
            if (bathErr) {
                showToast(bathErr, 'danger');
                setSubmitting(false);
                return;
            }

            // Multi-lot items (dyeing substrate) are consumed explicitly via
            // consumed_lots (the logged draw, FIFO across the selected lots) —
            // exclude them from the BOM%/actual_items path and the single-lot
            // consumed_batches so the qty is never deducted twice.
            const woActualItems = workOrder
                ? materialRows
                    .filter(row => parseFloat(row.actual_qty) > 0 && !isMultiLot(row.item_id))
                    .map(row => ({ item_id: row.item_id, qty_used: parseFloat(row.actual_qty) }))
                : actualItems.map(ai => ({ item_id: ai.item_id, qty_used: parseFloat(ai.qty_used) }));

            const consumedLots = Object.keys(selectedLots).flatMap(itemId =>
                isMultiLot(itemId) ? lotAllocation(itemId) : []
            );
            const consumedBatchIds = Object.entries(consumedBatches)
                .filter(([itemId, bid]) => bid && !isMultiLot(itemId))
                .map(([, bid]) => bid);

            const res = await authFetch(`${API_BASE}/manufacturing-orders/${mo.id}/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    qty_completed: qty,
                    qty_cones: qtyCones.trim() ? parseInt(qtyCones, 10) : null,
                    qty_boxes: qtyBoxes.trim() ? parseInt(qtyBoxes, 10) : null,
                    operator_name: operatorName || null,
                    notes: notes || null,
                    work_center_id: workCenterId || null,
                    work_order_id: workOrder?.id || null,
                    actual_items: woActualItems,
                    beam_number: isLotOutput ? (beamNumber.trim() || null) : null,
                    consumed_batches: consumedBatchIds,
                    consumed_lots: consumedLots,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to log completion');
            }
            const updated = await res.json();
            showToast(`Logged ${qty} — total ${(updated.qty_completed_total ?? 0).toFixed(2)} / ${target}`, 'success');
            onSaved(updated);
            onClose();
        } catch (err: any) {
            showToast(err.message, 'danger');
        } finally {
            setSubmitting(false);
        }
    };

    const completions = mo.completions ? [...mo.completions].reverse() : [];

    // Bags = this WO's non-rejected, lotted completions in chronological order.
    // Each is one weighed bag; its output lot is the bag's identity. Sequence
    // number (bag #N) is assigned by log order and mapped back onto each row.
    const woBags = workOrder
        ? (mo.completions || [])
            .filter((c: any) => String(c.work_order_id || '') === String(workOrder.id) && !c.rejected && c.output_batch_number)
            .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        : [];
    const bagSeqById: Record<string, number> = {};
    woBags.forEach((c: any, i: number) => { bagSeqById[String(c.id)] = i + 1; });

    // Machine picker is scoped to the WO's process, not the whole plant: a WEAVING WO
    // may only be logged on a loom. Preferred scope is the subtree of the WO's own work
    // center (a TYPE/GROUP row when the WO was cut without a machine) — that's exactly
    // the bank the planner locked it to. Falls back to every machine of the same center
    // type when the WO already names a machine or its row is missing.
    // `label` rides along so the badge always names the scope actually applied, not the
    // one that was tried first.
    const { list: machineScope, label: machineScopeLabel } = React.useMemo(() => {
        const all = (workCenters || []).filter((wc: any) => isMachineWC(wc));
        const type = woWcType || String(workOrder?.work_center_type || '').toUpperCase();
        if (woWc && isContainerWC(woWc)) {
            const under = machinesUnderWC(workCenters || [], woWc.id);
            if (under.length) return { list: under, label: woWc.name || type };
        }
        if (!type) return { list: all, label: '' };
        const matching = all.filter((wc: any) => centerTypeOfWC(workCenters || [], wc) === type);
        // Never hand back an empty list — an unfilterable picker beats an unusable one.
        return matching.length ? { list: matching, label: type } : { list: all, label: '' };
    }, [workCenters, woWc, woWcType, workOrder?.work_center_type]);

    const wcOptions = toMachineOptions(machineScope);
    const itemOptions = itemResults.map(itemToOption);

    return (
        <ModalWrapper
            isOpen
            onClose={onClose}
            title={workOrder ? `Log WO: ${workOrder.code || workOrder.name} — ${mo.code}` : `Log Completion — ${mo.code}`}
            modeless
            size="md"
            footer={
                <>
                    <button type="button" className={XP_BTN} onClick={onClose} style={xpBtn()}>Cancel</button>
                    <button type="submit" form="wo-completion-form" className={XP_BTN} disabled={submitting} style={{ ...xpBtn(true), opacity: submitting ? 0.6 : 1 }}>
                        {submitting ? 'Saving...' : 'Log Completion'}
                    </button>
                </>
            }
        >
                <form id="wo-completion-form" onSubmit={handleSubmit} style={{ fontFamily: xpFont }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                        {/* Product info + progress */}
                        <div style={{ border: '1px solid #aca899', padding: '8px 10px', background: '#f5f4ee', display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                <span style={{ fontSize: 11, fontWeight: 'bold', color: '#000080' }}>{mo.item_name || mo.item_code}</span>
                                <span style={{ fontSize: 10, color: '#555' }}>{mo.code}</span>
                            </div>
                            {/* MO-level progress bar (whole order) */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 9, fontWeight: 'bold', color: '#555', width: 26, flexShrink: 0 }}>MO</span>
                                <ProgressBar pct={pct} tone={pct >= 100 ? 'green' : 'blue'} hatched height={14} label="inside" />
                                <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap', width: 90, flexShrink: 0, textAlign: 'right' }}>{totalCompleted.toFixed(2)} / {target}</span>
                            </div>

                            {/* Current WO progress bar (this step's target) */}
                            {workOrder && woTarget > 0 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: 9, fontWeight: 'bold', color: '#555', width: 26, flexShrink: 0 }}>WO</span>
                                    <ProgressBar pct={woPct} tone={woPct >= 100 ? 'green' : 'amber'} hatched height={14} label="inside" />
                                    <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap', width: 90, flexShrink: 0, textAlign: 'right' }}>{woDone.toFixed(2)} / {woTarget}</span>
                                </div>
                            )}
                            <div style={{ fontSize: 10, color: '#555', display: 'flex', gap: 12 }}>
                                <span>MO remaining: <strong>{remaining.toFixed(2)}</strong></span>
                                {workOrder && woTarget > 0 && <span>WO remaining: <strong style={{ color: '#b46a00' }}>{woRemaining.toFixed(2)}</strong></span>}
                            </div>
                        </div>

                        {/* Entry fields */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {/* WO reference */}
                            {workOrder && (
                                <div style={{ background: '#e8f0fe', border: '1px solid #a8c0f0', padding: '4px 8px', fontSize: 10 }}>
                                    <span style={{ color: '#000080', fontWeight: 'bold' }}>WO: {workOrder.code || workOrder.name}</span>
                                </div>
                            )}
                            <div>
                                <label style={{ ...xpLabel, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span>{workOrder ? 'Actual Qty Produced' : 'Qty Completed'}</span>
                                    {findItem(mo.item_id)?.uom && (
                                        <span style={{
                                            fontSize: 9, fontWeight: 'bold', letterSpacing: 0.3, textTransform: 'uppercase',
                                            color: '#31569e', background: '#e8f0fe', border: '1px solid #a8c0f0',
                                            borderRadius: CHIP_RADIUS, padding: '0 5px', lineHeight: '14px',
                                        }}>
                                            {findItem(mo.item_id).uom}
                                        </span>
                                    )}
                                </label>
                                <input
                                    type="number"
                                    style={{ ...xpInput, fontSize: 13, height: 22 }}
                                    value={qtyCompleted}
                                    onChange={e => setQtyCompleted(e.target.value)}
                                    min="0.0001"
                                    step="any"
                                    placeholder={workOrder ? 'Enter actual qty produced...' : (remaining > 0 ? remaining.toFixed(2) : String(target))}
                                    autoFocus
                                    required
                                />
                            </div>
                            {isLotOutput && (
                                <div>
                                    <label style={{ ...xpLabel, fontWeight: 'bold' }}>{lotLabel} No.</label>
                                    <input
                                        type="text"
                                        style={xpInput}
                                        value={beamNumber}
                                        onChange={e => setBeamNumber(e.target.value)}
                                        placeholder={`Leave empty to auto-generate (${lotPrefix}-YYYYMMDD-NNNN)`}
                                    />
                                    <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>
                                        Output is registered as a stock lot. Auto-generated number is shown in the entry notes.
                                    </div>
                                </div>
                            )}
                            {workOrder && putawayDest && (
                                <div style={{ background: '#eef7ee', border: '1px solid #9cc79c', padding: '4px 8px', fontSize: 10 }}>
                                    <span style={{ color: '#1a5e1a', fontWeight: 'bold' }}>Putaway: {putawayDest}</span>
                                    <span style={{ color: '#555', marginLeft: 6 }}>
                                        {mo.planned_putaway_location_name ? 'assigned by planning' : 'WO output location (no bin assigned)'}
                                    </span>
                                </div>
                            )}
                            {workOrder && Array.from(new Set([...Object.keys(batchesByItem), ...Object.keys(reservedByItem)])).map(itemId => {
                                const rowCode = materialRows.find(r => r.item_id === itemId)?.item_code;
                                const code = rowCode || findItem(itemId)?.code || 'material';
                                // Bags physically on this line but staged to another WO. Named,
                                // not hidden: the operator can see them in the rack, and silence
                                // reads as a broken picker.
                                const heldHere = reservedByItem[itemId] || [];
                                const reservedNote = heldHere.length ? (
                                    <div style={{ background: '#fff3cd', border: '1px solid #b8860b', color: '#7a5000', padding: '3px 6px', fontSize: 9, marginTop: 3 }}>
                                        <div style={{ fontWeight: 'bold', marginBottom: 2 }}>
                                            <i className="bi bi-lock" /> {heldHere.length} lot{heldHere.length === 1 ? '' : 's'} on this line {heldHere.length === 1 ? 'is' : 'are'} staged to another work order
                                        </div>
                                        {heldHere.map((b: any) => (
                                            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                <CodeChip code={b.batch_number} />
                                                <span>{Number(b.remaining ?? 0).toFixed(2)} kg</span>
                                                <span>&rarr; {b.reserved_wo_code || 'other WO'}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : null;
                                if (!batchesByItem[itemId]?.length) {
                                    return (
                                        <div key={itemId}>
                                            <label style={{ ...xpLabel, fontWeight: 'bold' }}>Lot to Consume — {code}</label>
                                            {reservedNote}
                                        </div>
                                    );
                                }
                                if (isMultiLot(itemId)) {
                                    const sel = selectedLots[itemId] || [];
                                    const selSet = new Set(sel);
                                    const selKg = (batchesByItem[itemId] || [])
                                        .filter((b: any) => selSet.has(b.id))
                                        .reduce((s: number, b: any) => s + Number(b.remaining || 0), 0);
                                    const need = lotNeed(itemId);
                                    const alloc = lotAllocation(itemId);
                                    const drawByBatch: Record<string, number> = {};
                                    for (const l of alloc) drawByBatch[l.batch_id] = l.qty;
                                    const drawn = alloc.reduce((s, l) => s + l.qty, 0);
                                    const short = need > 0 && drawn + 1e-6 < need;
                                    const allIds = (batchesByItem[itemId] || []).map((b: any) => b.id);
                                    const allSelected = sel.length === allIds.length;
                                    const toggle = (bid: string, on: boolean) => setSelectedLots(prev => {
                                        const cur = prev[itemId] || [];
                                        return { ...prev, [itemId]: on ? [...cur, bid] : cur.filter(id => id !== bid) };
                                    });
                                    return (
                                        <div key={itemId}>
                                            {/* A div, not a label: a <label> forwards a click
                                                anywhere in it to the first labelable element it
                                                contains, and <button> is labelable — so clicking
                                                this caption fired All/None and selected or cleared
                                                every lot. It labels no control either way; the
                                                picker below is a stack of its own labels. */}
                                            <div style={{ ...xpLabel, fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span>Lots to Consume — {code}</span>
                                                <span style={{ fontWeight: 'normal', color: short ? '#900' : '#555' }}>
                                                    {sel.length} lot{sel.length === 1 ? '' : 's'} · {selKg.toFixed(2)} available · drawing{' '}
                                                    <strong>{drawn.toFixed(2)}</strong>{short ? ` of ${need.toFixed(2)}` : ''}
                                                    <button
                                                        type="button"
                                                        className={XP_BTN}
                                                        onClick={() => setSelectedLots(prev => ({ ...prev, [itemId]: allSelected ? [] : allIds }))}
                                                        style={{ ...xpBtn(), fontSize: 9, padding: '0 6px', marginLeft: 6 }}
                                                    >{allSelected ? 'None' : 'All'}</button>
                                                </span>
                                            </div>
                                            <div style={{ border: '1px solid #7f9db9', background: '#fff', maxHeight: 150, overflowY: 'auto' }}>
                                                {(batchesByItem[itemId] || []).map((b: any) => (
                                                    <label key={b.id} style={{ ...lvPickerRow(selSet.has(b.id)), fontSize: 10 }}>
                                                        <RowCheckbox checked={selSet.has(b.id)} label={b.batch_number || 'lot'}
                                                            onChange={() => toggle(b.id, !selSet.has(b.id))} />
                                                        {/* Same lot identity chips as the staging picker: two lots of the
                                                            same item differ only by size / combo / shade. */}
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                                <CodeChip code={b.batch_number} />
                                                                <span style={{ color: '#555' }}>{Number(b.remaining ?? 0).toFixed(2)} kg</span>
                                                                {/* What this log actually takes off the lot — the rest stays
                                                                    on it for the next run. FIFO, so later lots may draw 0. */}
                                                                {selSet.has(b.id) && (
                                                                    <span style={{ borderRadius: CHIP_RADIUS,
                                                                        fontSize: 9, fontWeight: 'bold', color: drawByBatch[b.id] ? '#0a3e0a' : '#777',
                                                                        background: drawByBatch[b.id] ? '#d0f0d0' : '#eceae2',
                                                                        border: '1px solid #aca899', padding: '0 4px',
                                                                    }}>
                                                                        take {(drawByBatch[b.id] || 0).toFixed(2)}
                                                                    </span>
                                                                )}
                                                                {b.location_name && <span style={{ color: '#0058e6' }}>@ {b.location_name}</span>}
                                                            </div>
                                                            <LotChips batch={b} showOrder />
                                                        </div>
                                                    </label>
                                                ))}
                                            </div>
                                            {reservedNote}
                                        </div>
                                    );
                                }
                                return (
                                    <div key={itemId}>
                                        <label style={{ ...xpLabel, fontWeight: 'bold' }}>
                                            Lot to Consume — {code}
                                        </label>
                                        <select
                                            style={{ ...xpInput, height: 22 }}
                                            value={consumedBatches[itemId] || ''}
                                            onChange={e => setConsumedBatches(prev => ({ ...prev, [itemId]: e.target.value }))}
                                        >
                                            <option value="">— select lot —</option>
                                            {batchesByItem[itemId].map((b: any) => (
                                                <option key={b.id} value={b.id}>
                                                    {b.batch_number}{b.vendor_lot ? ` (supplier: ${b.vendor_lot})` : ''} — {Number(b.remaining ?? 0).toFixed(2)} remaining{b.ends ? `, ${b.ends} ends` : ''}
                                                </option>
                                            ))}
                                        </select>
                                        {reservedNote}
                                    </div>
                                );
                            })}
                            <div style={{ display: 'flex', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                    <label style={xpLabel}>Cones</label>
                                    <input type="number" style={xpInput} value={qtyCones} onChange={e => setQtyCones(e.target.value)} min="0" step="1" placeholder="Optional" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={xpLabel}>Boxes</label>
                                    <input type="number" style={xpInput} value={qtyBoxes} onChange={e => setQtyBoxes(e.target.value)} min="0" step="1" placeholder="Optional" />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                    <label style={xpLabel}>Operator</label>
                                    <input type="text" style={xpInput} value={operatorName} onChange={e => setOperatorName(e.target.value)} placeholder="Name (optional)" />
                                </div>
                                <div style={{ flex: 2 }}>
                                    <label style={xpLabel}>Notes</label>
                                    <input type="text" style={xpInput} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Lot, shift, remarks..." />
                                </div>
                            </div>
                            {/* Work Center */}
                            <div>
                                <label style={{ ...xpLabel, ...(needsMachine ? { fontWeight: 'bold', color: '#900' } : {}) }}>
                                    Work Center / Machine{needsMachine ? ' (required — assigns stock locations)' : ''}
                                    {machineScopeLabel && (
                                        <span style={{ borderRadius: CHIP_RADIUS,
                                            marginLeft: 5, fontSize: 9, fontWeight: 'bold',
                                            background: '#dce8ff', border: '1px solid #7f9db9', color: '#002080',
                                            padding: '0 4px',
                                        }}>
                                            {machineScopeLabel}
                                        </span>
                                    )}
                                </label>
                                <SearchableSelect
                                    options={wcOptions}
                                    value={workCenterId}
                                    onChange={setWorkCenterId}
                                    placeholder={needsMachine ? 'Select machine…' : 'Select machine (optional)…'}
                                />
                                {needsMachine && (
                                    <div style={{ fontSize: 9, color: '#900', marginTop: 2 }}>
                                        This work order has no input/output location yet. Pick a machine to assign one.
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Dye bath — before the material rows: the bath is what the
                            g/L chemicals were weighed against, so the operator reads it
                            (and corrects it) before confirming what went in. Hidden
                            unless the WO actually has a bath record. */}
                        {isDyeingWO && dyeBath.run && (
                            <LegendPanel title={`Dye Bath — run #${dyeBath.run.run_number}${dyeBath.run.recipe_name ? ` · ${dyeBath.run.recipe_name}` : ''}`}>
                                <div style={{ padding: '4px 8px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                        <div style={{ width: 110 }}>
                                            <label style={xpLabel} title="Water volume of the bath, in litres. Every g/L chemical is weighed out against this.">
                                                Volume Air (L)
                                            </label>
                                            <input
                                                type="number" step="0.1" min="0" style={xpInput}
                                                value={dyeBath.bath.volume_air_liters}
                                                onChange={e => dyeBath.setBath(b => ({ ...b, volume_air_liters: e.target.value }))}
                                                placeholder="e.g. 950"
                                            />
                                        </div>
                                        <div style={{ width: 110 }}>
                                            <label style={xpLabel}>Substrate (kg)</label>
                                            <input
                                                type="number" step="0.01" min="0" style={xpInput}
                                                value={dyeBath.bath.substrate_qty}
                                                onChange={e => dyeBath.setBath(b => ({ ...b, substrate_qty: e.target.value }))}
                                                placeholder="e.g. 100"
                                            />
                                        </div>
                                        <div style={{ minWidth: 90 }}>
                                            <label style={xpLabel} title="Derived from the bath volume and substrate weight — never typed separately, so the two can't disagree.">
                                                Liquor Ratio
                                            </label>
                                            <div style={{ fontSize: 11, padding: '2px 0', color: '#333' }}>
                                                {dyeBath.doses?.liquor_ratio != null ? `1 : ${fmtDose(dyeBath.doses.liquor_ratio, 2)}` : '—'}
                                            </div>
                                        </div>
                                        {dyeBath.bathDirty && (
                                            <div style={{ background: '#fff3cd', border: '1px solid #b8860b', color: '#7a5000', padding: '2px 6px', fontSize: 9 }}>
                                                Saved with this log
                                            </div>
                                        )}
                                    </div>

                                    {dyeBath.run.recipe_id ? (
                                        <DoseSheet
                                            doses={dyeBath.doses}
                                            emptyHint={dyeBath.doses ? 'This recipe has no chemical lines to weigh out.' : 'Loading the recipe...'}
                                        />
                                    ) : (
                                        <div style={{ border: '1px solid #aca899', background: '#f5f4ee', padding: '4px 8px', fontSize: 10, color: '#555' }}>
                                            This run carries no recipe, so there is nothing to dose. The bath volume is still recorded.
                                        </div>
                                    )}

                                    {/* Chemicals actually weighed out. Recorded here, with the
                                        output, because it is the same operator at the same
                                        vessel — the Dyeing Orders tab keeps only the shade
                                        result, which is QC at a later moment. */}
                                    {dyeBath.rows.length > 0 && (
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                                            <thead>
                                                <tr style={{ background: '#dddbd0' }}>
                                                    <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Chemical Used</th>
                                                    <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 90 }}>Weigh Out</th>
                                                    <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 90 }}>Actual</th>
                                                    <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 70 }}>Variance</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {dyeBath.rows.map((row, idx) => {
                                                    const planned = parseFloat(row.planned_qty);
                                                    const actual = parseFloat(row.actual_qty);
                                                    const variance = (isNaN(actual) ? 0 : actual) - (isNaN(planned) ? 0 : planned);
                                                    return (
                                                        <tr key={row.item_id || idx} style={{ background: idx % 2 === 0 ? '#fff' : '#f5f4ee' }}>
                                                            <td style={{ padding: '2px 6px' }}>{row.item_name || row.item_id}</td>
                                                            <td style={{ padding: '2px 6px', textAlign: 'right', color: '#555', whiteSpace: 'nowrap' }}>
                                                                {isNaN(planned) ? '—' : `${fmtDose(planned, 3)}${row.dose_unit ? ` ${row.dose_unit}` : ''}`}
                                                            </td>
                                                            <td style={{ padding: '2px 4px' }}>
                                                                <input
                                                                    type="number" min="0" step="any"
                                                                    style={{ ...xpInput, textAlign: 'right', height: 18, fontSize: 10 }}
                                                                    value={row.actual_qty}
                                                                    onChange={e => dyeBath.setActual(row.item_id, e.target.value)}
                                                                    placeholder={row.dose_unit || ''}
                                                                />
                                                            </td>
                                                            <td style={{ padding: '2px 6px', textAlign: 'right', color: Math.abs(variance) < 1e-9 ? '#555' : variance > 0 ? '#900' : '#1a5e1a', whiteSpace: 'nowrap' }}>
                                                                {isNaN(actual) ? '—' : `${variance > 0 ? '+' : ''}${fmtDose(variance, 3)}`}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
                                    <div style={{ fontSize: 9, color: '#888' }}>
                                        Chemicals are still deducted from stock by BOM percentage, not from these
                                        figures — this records what the vessel actually took.
                                    </div>
                                </div>
                            </LegendPanel>
                        )}

                        {/* Material Consumption (WO mode) */}
                        {workOrder && materialRows.length > 0 && (
                            <LegendPanel title="Material Consumption">
                                <div style={{ padding: '4px 8px 8px' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                                        <thead>
                                            <tr style={{ background: '#dddbd0' }}>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Material</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 80 }}>Planned</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 90 }}>Actual</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 70 }}>Variance</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {materialRows.map((row, idx) => {
                                                const qty = parseFloat(qtyCompleted) || 0;
                                                const planned = (qty * row.planned_pct) / 100;
                                                const actual = parseFloat(row.actual_qty) || 0;
                                                const variance = actual - planned;
                                                const isPickingThis = subPickerIdx === idx;
                                                return (
                                                    <React.Fragment key={idx}>
                                                        <tr style={{ background: idx % 2 === 0 ? '#fff' : '#f5f4ee' }}>
                                                            <td style={{ padding: '2px 6px' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                                    <span style={{ fontWeight: 500 }}>{row.item_code}</span>
                                                                    {row.item_name && row.item_name !== row.item_code && (
                                                                        <span style={{ color: '#666', fontSize: 10 }}>{row.item_name}</span>
                                                                    )}
                                                                    {row.is_substitute && (
                                                                        <span style={{ borderRadius: CHIP_RADIUS, fontSize: 9, background: '#fff3cd', border: '1px solid #b8860b', color: '#7a5000', padding: '0 3px' }}>SUB</span>
                                                                    )}
                                                                    {row.is_substitute && (
                                                                        <span style={{ fontSize: 9, color: '#999', textDecoration: 'line-through' }}>{row.orig_item_code}</span>
                                                                    )}
                                                                </div>
                                                                <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setSubPickerIdx(isPickingThis ? null : idx)}
                                                                        style={{ fontFamily: xpFont, fontSize: 9, padding: '0 5px', cursor: 'pointer', background: isPickingThis ? '#c8d8f0' : 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid #808080', color: '#000040' }}
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
                                                                                if (isPickingThis) setSubPickerIdx(null);
                                                                            }}
                                                                            style={{ fontFamily: xpFont, fontSize: 9, padding: '0 5px', cursor: 'pointer', background: 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid #808080', color: '#900' }}
                                                                        >
                                                                            Clear
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td style={{ padding: '2px 6px', textAlign: 'right', color: '#555' }}>
                                                                {qty > 0 ? planned.toFixed(3) : '—'}
                                                            </td>
                                                            <td style={{ padding: '2px 4px' }}>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="any"
                                                                    style={{ ...xpInput, textAlign: 'right', height: 18, fontSize: 10 }}
                                                                    value={row.actual_qty}
                                                                    onChange={e => {
                                                                        const val = e.target.value;
                                                                        setMaterialRows(prev => prev.map((r, i) =>
                                                                            i === idx ? { ...r, actual_qty: val, is_custom: true } : r
                                                                        ));
                                                                    }}
                                                                    placeholder="0"
                                                                />
                                                            </td>
                                                            <td style={{ padding: '2px 6px', textAlign: 'right', color: variance > 0.0001 ? '#900' : variance < -0.0001 ? '#007000' : '#888', fontSize: 10 }}>
                                                                {qty > 0 && row.actual_qty ? (variance > 0 ? '+' : '') + variance.toFixed(3) : '—'}
                                                            </td>
                                                        </tr>
                                                        {isPickingThis && (
                                                            <tr style={{ background: '#eef2ff' }}>
                                                                <td colSpan={4} style={{ padding: '6px 8px', borderTop: '1px solid #a8c0f0', borderBottom: '1px solid #a8c0f0' }}>
                                                                    <div style={{ fontFamily: xpFont, fontSize: 10, fontWeight: 'bold', color: '#000080', marginBottom: 4 }}>
                                                                        Substitute for: {row.orig_item_code}
                                                                    </div>
                                                                    <SearchableSelect
                                                                        options={itemOptions}
                                                                        value={row.is_substitute ? row.item_id : ''}
                                                                        onChange={v => {
                                                                            const chosen = resolveItem(v);
                                                                            setMaterialRows(prev => prev.map((r, i) => i === idx ? {
                                                                                ...r,
                                                                                item_id: chosen?.id || r.orig_item_id,
                                                                                item_name: chosen?.name || r.orig_item_name,
                                                                                item_code: chosen?.code || r.orig_item_code,
                                                                                is_substitute: !!chosen,
                                                                                is_custom: true,
                                                                            } : r));
                                                                            if (chosen) setSubPickerIdx(null);
                                                                        }}
                                                                        onSearch={onSearchItems}
                                                                        placeholder="Search substitute item..."
                                                                    />
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    <div style={{ fontSize: 9, color: '#888', marginTop: 4 }}>
                                        Planned = BOM% x actual output. Edit Actual to record real consumption.
                                    </div>
                                </div>
                            </LegendPanel>
                        )}

                        {/* Actual Items Used (non-WO mode: substitutes) */}
                        {!workOrder && (
                        <LegendPanel title="Actual Items Used">
                            <div style={{ padding: '4px 8px 8px' }}>
                                {actualItems.length === 0 && (
                                    <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>
                                        No substitutes — BOM materials will be deducted automatically.
                                    </div>
                                )}
                                {actualItems.map((row, idx) => (
                                    <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginBottom: 4 }}>
                                        <div style={{ flex: 3 }}>
                                            {idx === 0 && <label style={xpLabel}>Item</label>}
                                            <SearchableSelect
                                                options={itemOptions}
                                                value={row.item_id}
                                                onChange={v => updateActualItem(idx, 'item_id', v)}
                                                onSearch={onSearchItems}
                                                placeholder="Select item…"
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            {idx === 0 && <label style={xpLabel}>Qty Used</label>}
                                            <input
                                                type="number"
                                                style={xpInput}
                                                value={row.qty_used}
                                                onChange={e => updateActualItem(idx, 'qty_used', e.target.value)}
                                                min="0.0001"
                                                step="any"
                                                placeholder="0"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            className={XP_BTN}
                                            onClick={() => removeActualItem(idx)}
                                            style={{ ...xpBtn(), padding: '0 6px', height: 20, lineHeight: '18px', color: '#900', flexShrink: 0 }}
                                        >×</button>
                                    </div>
                                ))}
                                <button type="button" className={XP_BTN} onClick={addActualItem} style={{ ...xpBtn(), fontSize: 10, padding: '1px 8px' }}>
                                    + Add Item
                                </button>
                            </div>
                        </LegendPanel>
                        )}

                        {/* History */}
                        {completions.length > 0 && (
                            <LegendPanel
                                title="Previous Entries"
                                right={workOrder && woBags.length > 0 ? (
                                    <button
                                        type="button"
                                        className={XP_BTN}
                                        onClick={() => { setLabelSeqStart(1); setLabelBags(woBags); }}
                                        style={{ ...xpBtn(), fontSize: 10, padding: '1px 8px' }}
                                    >
                                        Print All Bag Labels ({woBags.length})
                                    </button>
                                ) : undefined}
                            >
                                <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, fontFamily: xpFont }}>
                                        <thead style={LV_STICKY_THEAD}>
                                            <tr style={{ background: '#dddbd0' }}>
                                                <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899' }}>Qty</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Pkg</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Operator</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Machine</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Items Used</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Time</th>
                                                <th style={{ padding: '2px 4px', borderBottom: '1px solid #aca899', width: 42 }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {completions.map((c: any, i: number) => (
                                                <tr key={c.id} style={{ background: c.rejected ? '#fbe4e4' : i % 2 === 0 ? '#fff' : '#f5f4ee' }}>
                                                    <td
                                                        style={{ padding: '2px 6px', textAlign: 'right', fontWeight: 'bold', textDecoration: c.rejected ? 'line-through' : 'none', color: c.rejected ? '#900' : undefined }}
                                                        title={c.output_batch_number ? `Lot ${c.output_batch_number}` : undefined}
                                                    >
                                                        {parseFloat(c.qty_completed).toFixed(2)}
                                                        {/* Partial reject already trimmed qty_completed — show what was scrapped. */}
                                                        {!c.rejected && (c.qty_rejected ?? 0) > 0 && (
                                                            <span
                                                                title={rejectTitle(c, 'Partially rejected')}
                                                                style={{ marginLeft: 4, fontSize: 9, fontWeight: 700, color: '#900' }}
                                                            >
                                                                (-{Number(c.qty_rejected).toFixed(2)})
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '2px 6px', color: '#555' }}>
                                                        {[c.qty_cones ? `${c.qty_cones} cn` : null, c.qty_boxes ? `${c.qty_boxes} bx` : null].filter(Boolean).join(', ') || '—'}
                                                    </td>
                                                    <td style={{ padding: '2px 6px', color: '#555' }}>{c.operator_name || '—'}</td>
                                                    <td style={{ padding: '2px 6px', color: '#555' }}>{c.work_center_name || '—'}</td>
                                                    <td style={{ padding: '2px 6px', color: '#555' }}>
                                                        {c.actual_items && c.actual_items.length > 0
                                                            ? c.actual_items.map((ai: any) => `${ai.item_code || ai.item_id} ×${parseFloat(ai.qty_used).toFixed(2)}`).join(', ')
                                                            : '—'}
                                                    </td>
                                                    <td style={{ padding: '2px 6px', color: '#555' }}>{tzDateTime(c.created_at)}</td>
                                                    <td style={{ padding: '2px 4px', textAlign: 'center' }}>
                                                        {/* QC disposition lives on the Lot Management page — read-only marker here */}
                                                        {c.rejected ? (
                                                            <span style={{ fontSize: 9, fontWeight: 'bold', color: '#900' }} title={rejectTitle(c, 'Rejected')}>
                                                                REJECTED
                                                            </span>
                                                        ) : bagSeqById[String(c.id)] ? (
                                                            <button
                                                                type="button"
                                                                className={XP_BTN}
                                                                onClick={() => { setLabelSeqStart(bagSeqById[String(c.id)]); setLabelBags([c]); }}
                                                                style={{ ...xpBtn(), fontSize: 9, padding: '0 6px' }}
                                                                title={`Print label for bag #${bagSeqById[String(c.id)]} (lot ${c.output_batch_number})`}
                                                            >
                                                                Label
                                                            </button>
                                                        ) : null}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </LegendPanel>
                        )}
                    </div>
                </form>
                {labelBags && (
                    <BagLabelPrintModal
                        bags={labelBags}
                        workOrder={workOrder}
                        parentMO={mo}
                        seqStart={labelSeqStart}
                        onClose={() => setLabelBags(null)}
                    />
                )}
        </ModalWrapper>
    );
}
