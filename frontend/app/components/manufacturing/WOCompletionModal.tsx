'use client';

import React, { useState } from 'react';
import { useData } from '../../context/DataContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useToast } from '../shared/Toast';
import SearchableSelect from '@bryanadamg/terras-ui/components/Combobox';
import { itemToOption } from '../shared/useEntitySearch';
import { useWOLogForm } from './useWOLogForm';
import ModalWrapper from '../shared/ModalWrapper';
import BagLabelPrintModal from './BagLabelPrintModal';
import { ProgressBar, LegendPanel, CodeChip, xpFont, CHIP_RADIUS, xpBtn as xpBtnBase, XP_BTN } from '../shared/xpTheme';
import { field as xpInputBase, BTN_TONES } from '@bryanadamg/terras-ui/styles';
import { LV_STICKY_THEAD, lvPickerRow } from '../shared/listViewTheme';
import { RowCheckbox } from '@bryanadamg/terras-ui/components/Table';
import { LotChips } from '../shared/LotChips';
import { rejectTitle } from '../shared/rejectDisplay';
import { API_BASE } from '../shared/apiBase';
import { useUser } from '../../context/UserContext';

// Small in-row action (Sub / Clear on a material line): an outlined theme chip.
const rowChipBtn = (f: 'blue' | 'red'): React.CSSProperties => ({
    fontFamily: xpFont, fontSize: 9, padding: '0 5px', cursor: 'pointer', borderRadius: CHIP_RADIUS,
    background: 'var(--terras-table-bg, #fff)', border: `1px solid var(--terras-chip-${f}-border)`, color: `var(--terras-chip-${f}-text)`,
});


const xpInput: React.CSSProperties = xpInputBase({ padding: '0 4px', width: '100%', boxSizing: 'border-box' });
const xpLabel: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11, display: 'block', marginBottom: 2,
};
const xpBtn = (primary?: boolean): React.CSSProperties => xpBtnBase(primary ? { ...BTN_TONES.success, padding: '2px 14px' } : {});

interface ActualItem {
    item_id: string;
    qty_used: string;
}


interface WOCompletionModalProps {
    mo: any;
    onClose: () => void;
    onSaved: (updatedMO: any) => void;
    workOrder?: any;
}

export default function WOCompletionModal({ mo, onClose, onSaved, workOrder }: WOCompletionModalProps) {
    const { authFetch } = useData() as any;
    const { showToast } = useToast();
    const { formatDateTime: tzDateTime } = useTimezone();
    // Every WO-log rule lives in the shared hook, so the tablet scanner logs the same way.
    const {
        qtyCompleted, setQtyCompleted, qtyCones, setQtyCones, qtyBoxes, setQtyBoxes,
        operatorName, setOperatorName, notes, setNotes, workCenterId, setWorkCenterId,
        beamNumber, setBeamNumber,
        materialRows, setActualQty, setSubstitute, clearSubstitute, subPickerIdx, setSubPickerIdx,
        itemResults, onSearchItems, findItem, sourceAvailable,
        batchesByItem, reservedByItem, consumedBatches, setConsumedBatches, isMultiLot, lotGroup,
        moSizeLabel,
        isLotOutput, lotLabel, lotPrefix, putawayDest, needsMachine, machineScopeLabel, wcOptions,
        totalCompleted, target, remaining, pct, woTarget, woDone, woRemaining, woPct,
        woBags, bagSeqById, newBag, validate, payload,
    } = useWOLogForm(mo, workOrder);

    // No-WO (whole MO) log only: substitutes typed in by hand.
    const [actualItems, setActualItems] = useState<ActualItem[]>([]);
    const [submitting, setSubmitting] = useState(false);
    // Bag labels: one sticker per weighed bag (= one lotted completion on this WO)
    const canPrintLabel = useUser().hasPermission('work_order.print_label');
    const [labelBags, setLabelBags] = useState<any[] | null>(null);
    const [labelSeqStart, setLabelSeqStart] = useState(1);
    // Set once a log saves a new bag: the form swaps for that bag's label preview,
    // and onSaved/onClose wait until the preview is closed (or printed).
    const [savedMO, setSavedMO] = useState<any | null>(null);

    const addActualItem = () => setActualItems(prev => [...prev, { item_id: '', qty_used: '' }]);
    const removeActualItem = (idx: number) => setActualItems(prev => prev.filter((_, i) => i !== idx));
    const updateActualItem = (idx: number, field: keyof ActualItem, value: string) =>
        setActualItems(prev => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const problem = validate();
        if (problem) { showToast(problem, 'danger'); return; }
        if (!workOrder) {
            for (const ai of actualItems) {
                if (!ai.item_id || !ai.qty_used || parseFloat(ai.qty_used) <= 0) {
                    showToast('Each actual item row needs an item and a positive quantity', 'danger');
                    return;
                }
            }
        }

        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/manufacturing-orders/${mo.id}/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload(actualItems.map(ai => ({ item_id: ai.item_id, qty_used: parseFloat(ai.qty_used) })))),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to log completion');
            }
            const updated = await res.json();
            showToast(`Logged ${qtyCompleted} — total ${(updated.qty_completed_total ?? 0).toFixed(2)} / ${target}`, 'success');
            // If the log made a lot, go straight to its label for printing.
            const made = newBag(updated);
            if (made && canPrintLabel) {
                setLabelSeqStart(made.seq);
                setLabelBags([made.bag]);
                setSavedMO(updated);
                return;
            }
            onSaved(updated);
            onClose();
        } catch (err: any) {
            showToast(err.message, 'danger');
        } finally {
            setSubmitting(false);
        }
    };

    const completions = mo.completions ? [...mo.completions].reverse() : [];

    const itemOptions = itemResults.map(itemToOption);

    // Just logged a bag: show only its label — the form is gone so it can't be
    // submitted twice — and finish the save when the preview closes.
    if (savedMO && labelBags) {
        return (
            <BagLabelPrintModal
                bags={labelBags}
                workOrder={workOrder}
                parentMO={savedMO}
                seqStart={labelSeqStart}
                onClose={() => { onSaved(savedMO); onClose(); }}
            />
        );
    }

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
                        <div style={{ border: '1px solid var(--terras-table-line, #d6d3ce)', padding: '8px 10px', background: 'var(--terras-toolbar-bg, #f5f4ef)', display: 'flex', flexDirection: 'column', gap: 5 }}>
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
                                    const g = lotGroup(itemId);
                                    const { sel, selSet, selKg, need, drawByBatch, drawn, short, fitLots, otherLots, otherOpen, allSelected } = g;
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
                                                        onClick={g.toggleAll}
                                                        style={{ ...xpBtn(), fontSize: 9, padding: '0 6px', marginLeft: 6 }}
                                                    >{allSelected ? 'None' : 'All'}</button>
                                                </span>
                                            </div>
                                            <div style={{ border: '1px solid #7f9db9', background: '#fff', maxHeight: 150, overflowY: 'auto' }}>
                                                {[...fitLots, ...(otherOpen ? otherLots : [])].map((b: any, i: number) => (
                                                    <React.Fragment key={b.id}>
                                                    {i === fitLots.length && (
                                                        <div style={{ fontSize: 9, fontWeight: 'bold', color: '#7a5000', background: '#fff3cd', borderTop: '1px solid #b8860b', padding: '2px 6px' }}>
                                                            Other sizes — not this order's {moSizeLabel}
                                                        </div>
                                                    )}
                                                    <label key={b.id} style={{ ...lvPickerRow(selSet.has(b.id)), fontSize: 10 }}>
                                                        <RowCheckbox checked={selSet.has(b.id)} label={b.batch_number || 'lot'}
                                                            onChange={() => g.toggle(b.id)} />
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
                                                                        border: '1px solid var(--terras-table-line, #d6d3ce)', padding: '0 4px',
                                                                    }}>
                                                                        take {(drawByBatch[b.id] || 0).toFixed(2)}
                                                                    </span>
                                                                )}
                                                                {b.location_name && <span style={{ color: '#0058e6' }}>@ {b.location_name}</span>}
                                                                {b.reserved_wo_id && (
                                                                    <span title="Scanned onto this work order at staging — pre-ticked" style={{ borderRadius: CHIP_RADIUS,
                                                                        fontSize: 9, fontWeight: 'bold', color: '#002080',
                                                                        background: '#dce8ff', border: '1px solid #7f9db9', padding: '0 4px',
                                                                    }}>
                                                                        <i className="bi bi-upc-scan" /> staged
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <LotChips batch={b} showOrder />
                                                        </div>
                                                    </label>
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                            {otherLots.length > 0 && !otherLots.some((b: any) => selSet.has(b.id)) && (
                                                <button
                                                    type="button"
                                                    className={XP_BTN}
                                                    onClick={g.toggleOtherSizes}
                                                    style={{ ...xpBtn(), fontSize: 9, padding: '0 6px', marginTop: 3 }}
                                                >
                                                    <i className={`bi bi-chevron-${otherOpen ? 'up' : 'down'}`} /> {otherOpen ? 'Hide' : 'Show'} {otherLots.length} lot{otherLots.length === 1 ? '' : 's'} of other sizes
                                                </button>
                                            )}
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

                        {/* Material Consumption (WO mode) */}
                        {workOrder && materialRows.length > 0 && (
                            <LegendPanel title="Material Consumption">
                                <div style={{ padding: '4px 8px 8px' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                                        <thead>
                                            <tr style={{ background: 'var(--terras-toolbar-bg, #f5f4ef)' }}>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid var(--terras-table-line, #d6d3ce)' }}>Material</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid var(--terras-table-line, #d6d3ce)', width: 80 }}>Planned</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid var(--terras-table-line, #d6d3ce)', width: 90 }}>Actual</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid var(--terras-table-line, #d6d3ce)', width: 70 }}>Variance</th>
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
                                                        <tr style={{ background: idx % 2 === 0 ? 'var(--terras-table-bg, #fff)' : 'var(--terras-row-stripe-sub, #fbfaf7)' }}>
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
                                                                        style={{ ...rowChipBtn('blue'), ...(isPickingThis ? { background: 'var(--terras-chip-blue-bg)' } : {}) }}
                                                                    >
                                                                        {isPickingThis ? 'Cancel' : 'Sub'}
                                                                    </button>
                                                                    {row.is_substitute && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => clearSubstitute(idx)}
                                                                            style={rowChipBtn('red')}
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
                                                                    onChange={e => setActualQty(idx, e.target.value)}
                                                                    placeholder="0"
                                                                />
                                                                {(() => {
                                                                    const avail = sourceAvailable(row.item_id);
                                                                    return !row.is_custom && avail !== null && avail + 1e-6 < planned ? (
                                                                        <div style={{ fontSize: 9, color: '#7a4a00', textAlign: 'right' }} title="Output is heavier than the staged lots hold — consumption defaults to what is staged">
                                                                            capped at staged {avail.toFixed(3)}
                                                                        </div>
                                                                    ) : null;
                                                                })()}
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
                                                                        onChange={v => setSubstitute(idx, v)}
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
                                right={canPrintLabel && workOrder && woBags.length > 0 ? (
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
                                            <tr style={{ background: 'var(--terras-toolbar-bg, #f5f4ef)' }}>
                                                <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid var(--terras-table-line, #d6d3ce)' }}>Qty</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid var(--terras-table-line, #d6d3ce)' }}>Pkg</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid var(--terras-table-line, #d6d3ce)' }}>Operator</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid var(--terras-table-line, #d6d3ce)' }}>Machine</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid var(--terras-table-line, #d6d3ce)' }}>Items Used</th>
                                                <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid var(--terras-table-line, #d6d3ce)' }}>Time</th>
                                                <th style={{ padding: '2px 4px', borderBottom: '1px solid var(--terras-table-line, #d6d3ce)', width: 42 }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {completions.map((c: any, i: number) => (
                                                <tr key={c.id} style={{ background: c.rejected ? '#fbe4e4' : i % 2 === 0 ? 'var(--terras-table-bg, #fff)' : 'var(--terras-row-stripe-sub, #fbfaf7)' }}>
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
                                                        ) : canPrintLabel && bagSeqById[String(c.id)] ? (
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
