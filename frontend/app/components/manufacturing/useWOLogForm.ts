'use client';

/**
 * Everything a work order production log does — state, lot pickers, consumption
 * math, validation and the POST body — shared by the desktop log
 * (WOCompletionModal) and the tablet/phone log (mobile/ScannerView). They used to
 * be two hand-kept copies, and every desktop fix (multi-lot draw, routing-step
 * materials, staged pre-tick, cones/boxes, ...) had to be rediscovered on the
 * floor. Each screen now only draws this; add a log rule HERE, never in one view.
 */

import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { useItemSearch } from '../shared/useEntitySearch';
import { lotSizeLabel } from '../shared/LotChips';
import { machineScopeForWO, toMachineOptions } from '../shared/workCenterTree';
import { API_BASE } from '../shared/apiBase';
import { isBeamItemRecord } from '../shared/beamItem';

export interface MaterialRow {
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

export function useWOLogForm(mo: any, workOrder?: any) {
    const { authFetch, workCenters, items } = useData() as any;

    const [qtyCompleted, setQtyCompleted] = useState('');
    const [qtyCones, setQtyCones] = useState('');
    const [qtyBoxes, setQtyBoxes] = useState('');
    const [operatorName, setOperatorName] = useState('');
    const [notes, setNotes] = useState('');
    const [workCenterId, setWorkCenterId] = useState('');
    const [materialRows, setMaterialRows] = useState<MaterialRow[]>([]);
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
    // A material held as several lots → draw from several of them
    // (item_id → selected batch ids). Single-lot materials keep the <select>.
    const [selectedLots, setSelectedLots] = useState<Record<string, string[]>>({});
    // item_id → "other sizes" group unfolded. Size token = case-folded size name,
    // same as netting_service; "" = unsized MO, which accepts every lot.
    const [showOtherSizes, setShowOtherSizes] = useState<Record<string, boolean>>({});
    // Bumped after each log so the lot pickers re-read what's left on each lot.
    const [lotsTick, setLotsTick] = useState(0);
    const moSizeLabel = lotSizeLabel(mo) || '';
    const moSizeToken = moSizeLabel.toLowerCase();

    // Substitute picker: server typeahead, not a filter over DataContext's `items`
    // (only a 50-row, newest-first page — a candidate outside it was unreachable no
    // matter what was typed). `resolve` covers items seen in any page so far, so a
    // BOM line or an already-picked substitute keeps its name/code once the result
    // window moves past it.
    const { results: itemResults, onSearch: onSearchItems, resolve: resolveItem } = useItemSearch({ seed: items });

    const findItem = (itemId: string) => resolveItem(itemId) || (items || []).find((i: any) => i.id === itemId);
    const isBeamItem = (itemId: string) => isBeamItemRecord(findItem(itemId));
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
    const isSettingWO = woWcType === 'SETTING';
    // Multi-lot consume: a material sitting as several lots at the input location
    // (≥2) — greige bags into dyeing, dyed lots into setting, and a covering WO's
    // per-box lots into warping (80 cones needed, 20 per lot). One picker can't
    // select them, so checkboxes. The checked lots are the SOURCE POOL; the qty
    // deducted is the logged draw, not each lot's whole remaining. Single-lot
    // materials keep the single <select> + BOM% deduction. Weaving's mounted
    // beams never reach batchesByItem (drawn FIFO from the loom's mounts).
    const isMultiLot = (itemId: string) => (batchesByItem[itemId]?.length || 0) >= 2;
    // Mirrors the backend's prefix choice in manufacturing.py's log-completion route.
    const lotLabel = isBeamOutput ? 'Beam' : isWeavingWO ? 'Greige' : isDyeingWO ? 'Dyed Lot' : isSettingWO ? 'Set Lot' : 'Lot';
    const lotPrefix = isBeamOutput ? 'BM' : isWeavingWO ? 'GRG' : isDyeingWO ? 'DYE' : isSettingWO ? 'SET' : 'LOT';

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

    // What the lots this log draws from hold for an item — the most it can consume.
    // The picked lot (single) or the ticked lots (multi); null when none is picked
    // or the item isn't lot-fed, so there is nothing to cap against.
    const sourceAvailable = (itemId: string): number | null => {
        const lots = batchesByItem[itemId];
        if (!lots?.length) return null;
        const ids = isMultiLot(itemId)
            ? (selectedLots[itemId] || [])
            : (consumedBatches[itemId] ? [consumedBatches[itemId]] : []);
        if (!ids.length) return null;
        const set = new Set(ids.map(String));
        return lots.filter((b: any) => set.has(String(b.id))).reduce((s: number, b: any) => s + Number(b.remaining || 0), 0);
    };

    // Everything a multi-lot picker draws: the size split (mirroring
    // netting_service's eligible_tokens — a sized MO takes its own size, then
    // unsized ("") lots; an unsized MO takes anything; other sizes stay reachable
    // but folded away, and "All" never reaches into them) plus the live draw.
    const lotGroup = (itemId: string) => {
        const sel = selectedLots[itemId] || [];
        const selSet = new Set(sel);
        const lotsHere = batchesByItem[itemId] || [];
        const fitsSize = (b: any) => {
            const t = (lotSizeLabel(b) || '').toLowerCase();
            return !moSizeToken || !t || t === moSizeToken;
        };
        const fitLots = lotsHere.filter(fitsSize);
        const otherLots = lotsHere.filter((b: any) => !fitsSize(b));
        const allIds = fitLots.map((b: any) => b.id);
        const alloc = lotAllocation(itemId);
        const drawByBatch: Record<string, number> = {};
        for (const l of alloc) drawByBatch[l.batch_id] = l.qty;
        const drawn = alloc.reduce((s, l) => s + l.qty, 0);
        const need = lotNeed(itemId);
        return {
            sel, selSet, fitLots, otherLots,
            otherOpen: !!showOtherSizes[itemId] || otherLots.some((b: any) => selSet.has(b.id)),
            allSelected: allIds.length > 0 && allIds.every((id: string) => selSet.has(id)),
            selKg: lotsHere.filter((b: any) => selSet.has(b.id)).reduce((s: number, b: any) => s + Number(b.remaining || 0), 0),
            need, drawByBatch, drawn,
            short: need > 0 && drawn + 1e-6 < need,
            toggle: (bid: string) => setSelectedLots(prev => {
                const cur = prev[itemId] || [];
                return { ...prev, [itemId]: cur.includes(bid) ? cur.filter(id => id !== bid) : [...cur, bid] };
            }),
            toggleAll: () => setSelectedLots(prev => {
                const otherSel = (prev[itemId] || []).filter(id => !allIds.includes(id));
                const all = allIds.length > 0 && allIds.every((id: string) => (prev[itemId] || []).includes(id));
                return { ...prev, [itemId]: all ? otherSel : [...otherSel, ...allIds] };
            }),
            toggleOtherSizes: () => setShowOtherSizes(prev => ({ ...prev, [itemId]: !prev[itemId] })),
        };
    };

    // Lot input: each material line with batch stock at the input location gets a lot picker
    const materialItemIds = workOrder ? Array.from(new Set(materialRows.map(r => r.item_id))) : [];
    useEffect(() => {
        if (!materialItemIds.length) { setBatchesByItem({}); setReservedByItem({}); setConsumedBatches({}); return; }
        const loc = woInputLocId;
        // Adding a substitute re-runs this; an older response landing last would
        // drop the newer item's picker and its pick.
        let cancelled = false;
        Promise.all(materialItemIds.map(id =>
            authFetch(`${API_BASE}/batches?item_id=${id}${loc ? `&location_id=${loc}` : ''}&limit=200`)
                .then((r: Response) => (r.ok ? r.json() : []))
                .catch(() => [])
                .then((data: any[]) => [id, (data || []).filter((b: any) => (b.remaining ?? 0) > 0 && b.quality_status !== 'REJECTED')] as const)
        )).then(pairs => {
            if (cancelled) return;
            const map: Record<string, any[]> = {};
            const held: Record<string, any[]> = {};
            for (const [id, list] of pairs) {
                if (!list.length) continue;
                // Warp beams are loom resources: the backend draws them FIFO from the
                // machine's mounts (beam_service.consume_from_mounts), so no per-beam pick here.
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
            // Lots scanned onto THIS WO (scan-to-stage) were already positively picked
            // at the moment the bag went in — pre-tick those. Unclaimed lots on the
            // line stay unticked: a pre-ticked guess reads as confirmed and gets
            // logged as-is, so the operator must pick those themselves.
            const stagedHere = (id: string) => map[id]
                .filter((b: any) => b.reserved_wo_id && String(b.reserved_wo_id) === String(workOrder?.id))
                .map((b: any) => b.id);
            setConsumedBatches(prev => {
                const next: Record<string, string> = {};
                for (const id of Object.keys(map)) {
                    if (prev[id]) next[id] = prev[id];
                    else if (map[id].length === 1 && stagedHere(id).length) next[id] = map[id][0].id;
                }
                return next;
            });
            setSelectedLots(prev => {
                const next: Record<string, string[]> = {};
                for (const id of Object.keys(map)) {
                    if (map[id].length >= 2) next[id] = prev[id] || stagedHere(id);
                }
                return next;
            });
        });
        return () => { cancelled = true; };
        // A log re-reads the lots (bumped by resetAfterLog): what it drew is gone.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(materialItemIds), workOrder?.id, isWeavingWO, lotsTick]);

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
    const toRows = () => {
        const allLines: any[] = mo.bom?.lines || [];
        const bomLines: any[] = workOrder?.bom_operation_id
            ? allLines.filter((l: any) => l.bom_operation_id && String(l.bom_operation_id) === String(workOrder.bom_operation_id))
            : allLines;
        return bomLines.map((line: any) => ({
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
        }));
    };
    useEffect(() => {
        if (!workOrder || !mo.bom?.lines?.length) return;
        setMaterialRows(toRows());
        setSubPickerIdx(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workOrder?.id]);

    // Recalculate uncustomized actuals when output qty or the source lots change.
    // Default = output x BOM%, capped at what the picked lots hold: output weighed
    // heavier than the staged substrate (dye/finish adds weight) is normal, and
    // consuming past the lot's book qty is a stock error the operator could only
    // clear by knowing to edit this row down.
    useEffect(() => {
        if (!workOrder) return;
        const qty = parseFloat(qtyCompleted);
        if (!qty || qty <= 0) return;
        setMaterialRows(prev => prev.map(row => {
            if (row.is_custom) return row;
            const planned = (qty * row.planned_pct) / 100;
            const avail = sourceAvailable(row.item_id);
            return { ...row, actual_qty: (avail !== null && avail < planned ? avail : planned).toFixed(4) };
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [qtyCompleted, batchesByItem, selectedLots, consumedBatches]);

    // Material consumption row edits.
    const setActualQty = (idx: number, val: string) =>
        setMaterialRows(prev => prev.map((r, i) => i === idx ? { ...r, actual_qty: val, is_custom: true } : r));
    const setSubstitute = (idx: number, itemId: string) => {
        const chosen = resolveItem(itemId);
        setMaterialRows(prev => prev.map((r, i) => i === idx ? {
            ...r,
            item_id: chosen?.id || r.orig_item_id,
            item_name: chosen?.name || r.orig_item_name,
            item_code: chosen?.code || r.orig_item_code,
            is_substitute: !!chosen,
            is_custom: true,
        } : r));
        if (chosen) setSubPickerIdx(null);
    };
    const clearSubstitute = (idx: number) => {
        setMaterialRows(prev => prev.map((r, i) => i === idx ? {
            ...r,
            item_id: r.orig_item_id,
            item_name: r.orig_item_name,
            item_code: r.orig_item_code,
            is_substitute: false,
            is_custom: false,
        } : r));
        if (subPickerIdx === idx) setSubPickerIdx(null);
    };

    // Progress: the whole order, and this step's own target.
    const totalCompleted = mo.qty_completed_total ?? 0;
    const target = mo.qty ?? 0;
    const remaining = Math.max(0, target - totalCompleted);
    const pct = target > 0 ? Math.min(100, Math.round((totalCompleted / target) * 100)) : 0;
    const woTarget = workOrder?.qty ?? 0;
    const woDone = workOrder?.qty_completed_total ?? 0;
    const woRemaining = Math.max(0, woTarget - woDone);
    const woPct = woTarget > 0 ? Math.min(100, Math.round((woDone / woTarget) * 100)) : 0;

    // Bags = this WO's non-rejected, lotted completions in chronological order.
    // Each is one weighed bag; its output lot is the bag's identity. Sequence
    // number (bag #N) is assigned by log order and mapped back onto each row.
    const bagsOf = (m: any) => workOrder
        ? (m?.completions || [])
            .filter((c: any) => String(c.work_order_id || '') === String(workOrder.id) && !c.rejected && c.output_batch_number)
            .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        : [];
    const woBags = bagsOf(mo);
    const bagSeqById: Record<string, number> = {};
    woBags.forEach((c: any, i: number) => { bagSeqById[String(c.id)] = i + 1; });
    // The entry a log just made = the one this WO didn't have before. If it made a
    // lot, its label (with its real bag number) is what the operator prints next.
    const newBag = (updated: any): { bag: any; seq: number } | null => {
        const seen = new Set((mo.completions || []).map((c: any) => String(c.id)));
        const bags = bagsOf(updated);
        const idx = bags.findIndex((c: any) => !seen.has(String(c.id)));
        return idx >= 0 ? { bag: bags[idx], seq: idx + 1 } : null;
    };

    const { list: machineScope, label: machineScopeLabel } = useMemo(
        () => machineScopeForWO(workCenters || [], woWc, woWcType || String(workOrder?.work_center_type || '').toUpperCase()),
        [workCenters, woWc, woWcType, workOrder?.work_center_type]);
    const wcOptions = toMachineOptions(machineScope);

    /** The first reason this WO log can't be saved, or null. */
    const validate = (): string | null => {
        const qty = parseFloat(qtyCompleted);
        if (!qty || qty <= 0) return 'Enter a positive quantity';
        if (!workOrder) return null;
        if (needsMachine && !workCenterId) {
            return 'This work order has no input/output location — select a Machine to assign one before logging.';
        }
        for (const row of materialRows) {
            const v = parseFloat(row.actual_qty);
            if (isNaN(v) || v < 0) return `Invalid quantity for ${row.item_code || row.item_name}`;
        }
        for (const itemId of Object.keys(batchesByItem)) {
            const code = findItem(itemId)?.code || 'material';
            if (isMultiLot(itemId)) {
                if (!(selectedLots[itemId]?.length)) return `Select at least one lot to consume for ${code}`;
                const need = lotNeed(itemId);
                if (need <= 0) return `Enter the qty used for ${code} in Material Consumption`;
                // Draw is capped per lot at its remaining — short selection would
                // silently under-consume, so make the operator pick more lots.
                const drawn = lotAllocation(itemId).reduce((s, l) => s + l.qty, 0);
                if (drawn + 1e-6 < need) {
                    return `Selected lots hold only ${drawn.toFixed(2)} of the ${need.toFixed(2)} needed for ${code} — select more lots`;
                }
            } else if (!consumedBatches[itemId]) {
                return `Select the lot/beam to consume for ${code}`;
            }
        }
        return null;
    };

    /** POST body for /manufacturing-orders/{mo}/completions. `actualItems` only
     *  for the desktop's no-WO (whole MO) log, which has its own item rows. */
    const payload = (actualItems?: { item_id: string; qty_used: number }[]) => {
        // Multi-lot items are consumed explicitly via consumed_lots (the logged
        // draw, FIFO across the selected lots) — exclude them from the
        // BOM%/actual_items path and the single-lot consumed_batches so the qty is
        // never deducted twice.
        const woActualItems = workOrder
            ? materialRows
                .filter(row => parseFloat(row.actual_qty) > 0 && !isMultiLot(row.item_id))
                .map(row => ({ item_id: row.item_id, qty_used: parseFloat(row.actual_qty) }))
            : (actualItems || []);
        return {
            qty_completed: parseFloat(qtyCompleted),
            qty_cones: qtyCones.trim() ? parseInt(qtyCones, 10) : null,
            qty_boxes: qtyBoxes.trim() ? parseInt(qtyBoxes, 10) : null,
            operator_name: operatorName || null,
            notes: notes || null,
            work_center_id: workCenterId || null,
            work_order_id: workOrder?.id || null,
            actual_items: woActualItems,
            beam_number: isLotOutput ? (beamNumber.trim() || null) : null,
            consumed_batches: Object.entries(consumedBatches)
                .filter(([itemId, bid]) => bid && !isMultiLot(itemId))
                .map(([, bid]) => bid),
            consumed_lots: Object.keys(selectedLots).flatMap(itemId => isMultiLot(itemId) ? lotAllocation(itemId) : []),
        };
    };

    /** Clear the per-entry fields for the next log on the same WO (the scanner
     *  stays on the WO; operator and machine carry over). */
    const resetAfterLog = () => {
        setQtyCompleted('');
        setQtyCones('');
        setQtyBoxes('');
        setNotes('');
        setBeamNumber('');
        setConsumedBatches({});
        setSelectedLots({});
        setShowOtherSizes({});
        setSubPickerIdx(null);
        setMaterialRows(toRows());
        setLotsTick(t => t + 1);
    };

    return {
        // fields
        qtyCompleted, setQtyCompleted, qtyCones, setQtyCones, qtyBoxes, setQtyBoxes,
        operatorName, setOperatorName, notes, setNotes, workCenterId, setWorkCenterId,
        beamNumber, setBeamNumber,
        // materials
        materialRows, setActualQty, setSubstitute, clearSubstitute, subPickerIdx, setSubPickerIdx,
        itemResults, onSearchItems, resolveItem, findItem, sourceAvailable,
        // lots
        batchesByItem, reservedByItem, consumedBatches, setConsumedBatches, isMultiLot, lotGroup,
        moSizeLabel,
        // output
        isLotOutput, isBeamOutput, lotLabel, lotPrefix, putawayDest, needsMachine,
        machineScopeLabel, wcOptions,
        // progress + history
        totalCompleted, target, remaining, pct, woTarget, woDone, woRemaining, woPct,
        woBags, bagSeqById, newBag,
        // submit
        validate, payload, resetAfterLog,
    };
}
