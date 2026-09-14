'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../shared/Toast';
import ModalWrapper from '../shared/ModalWrapper';
import {
    xpFont, FieldLabel, FormError, ModalFooterActions, XPEmptyState, XPLoading,
    xpInput as xpInputBase, xpSelect, xpPanel,
} from '../shared/xpTheme';
import LotLabelPrintModal from './LotLabelPrintModal';

const xpInput: React.CSSProperties = xpInputBase({ padding: '0 4px', width: '100%', boxSizing: 'border-box' });

interface Props {
    wo: any;               // weaving WO: id, code/name, work_center_id
    onClose: () => void;
    onDone?: () => void;   // optional parent refresh once the beam is off
}

// Register leftover warp from the loom this WO runs on.
//
// The warp is not this WO's material — it is the machine's (see beam_service):
// so the leftover comes off a BEAM MOUNT, not off the work order, and the same
// call that lots it takes the beam down. That is the physical order of events —
// you strip the remnant because the beam is finished on this loom.
//
// This screen and the weaving monitor's Beams tab post to the identical endpoint;
// this one exists so a weaver already on the WO doesn't have to leave the floor
// screen to close out the warp. It replaced a form that re-lotted the batch-less
// merged pool, which stopped existing when beams became loom-mounted lots.
export default function LeftoverBeamModal({ wo, onClose, onDone }: Props) {
    const { authFetch, locations } = useData() as any;
    const { showToast } = useToast();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const [mounts, setMounts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [mountId, setMountId] = useState('');
    const [qty, setQty] = useState('');
    const [ends, setEnds] = useState('');
    const [beamNumber, setBeamNumber] = useState('');
    const [returnLoc, setReturnLoc] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    // Newly-minted leftover lot to print right after a successful dismount.
    const [printLot, setPrintLot] = useState<any>(null);

    // Stock lives only in leaf locations — same filter the monitor's unmount strip uses.
    const leafLocations = useMemo(
        () => (locations || []).filter((l: any) => !l.has_children && l.location_type !== 'warehouse'),
        [locations],
    );
    const locLabel = (l: any) => l.full_path || (l.parent_name ? `${l.parent_name} / ${l.name}` : l.name);

    const selected = mounts.find((m: any) => String(m.id) === mountId) || null;

    // What warp is up on this WO's machine: beam readiness for a WO IS the
    // readiness of its loom, which is exactly what this endpoint returns.
    useEffect(() => {
        let alive = true;
        authFetch(`${API_BASE}/work-orders/${wo.id}/beam-mounts`)
            .then((r: Response) => (r.ok ? r.json() : null))
            .catch(() => null)
            .then((loom: any) => {
                if (!alive) return;
                const rows = (loom?.mounts || []).filter((m: any) => !m.dismounted_at);
                setMounts(rows);
                if (rows.length === 1) pick(rows[0]);
                setLoading(false);
            });
        return () => { alive = false; };
    }, [wo.id]);

    // Seed from the beam: on a warp that ran to plan the scale agrees with the
    // system and the weaver only confirms, and a remnant is the same warp — same ends.
    const pick = (m: any) => {
        setMountId(String(m.id));
        setQty(m.remaining != null ? String(Number(m.remaining).toFixed(2)) : '');
        setEnds(m.ends != null ? String(m.ends) : '');
        setReturnLoc(m.default_return_location_id ? String(m.default_return_location_id) : '');
    };

    const sysLeft = Number(selected?.remaining || 0);
    const weighed = parseFloat(qty);
    const variance = Number.isNaN(weighed) ? 0 : weighed - sysLeft;

    const handleSubmit = async () => {
        if (!mountId) { setError('Select the beam to take off.'); return; }
        if (Number.isNaN(weighed) || weighed < 0) { setError('Enter the weighed leftover.'); return; }
        setError('');
        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/beam-mounts/${mountId}/dismount`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to_location_id: returnLoc || null,
                    leftover_qty: weighed,
                    leftover_beam_number: beamNumber.trim() || null,
                    leftover_ends: ends ? parseInt(ends, 10) : null,
                    leftover_notes: notes.trim() || null,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to register leftover');
            }
            const out = await res.json();
            if (out?.leftover_beam_number) {
                showToast(`Leftover lot ${out.leftover_beam_number} created (${weighed})`, 'success');
                // Print the new lot label right away — the beam is off the loom
                // now and the remnant needs a physical tag before it moves.
                setPrintLot({
                    id: out.leftover_batch_id,
                    batch_number: out.leftover_beam_number,
                    remaining: out.leftover_qty,
                    item_name: selected?.item_name,
                    item_code: selected?.item_code,
                });
            } else {
                showToast('Beam unmounted.', 'success');
                onDone?.();
                onClose();
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (printLot) {
        return (
            <LotLabelPrintModal
                lots={[printLot]}
                onClose={() => { setPrintLot(null); onDone?.(); onClose(); }}
            />
        );
    }

    return (
        <ModalWrapper
            isOpen
            onClose={onClose}
            title={`Leftover Warp — ${wo.code || wo.name}`}
            modeless
            size="sm"
            footer={
                <ModalFooterActions
                    onCancel={onClose}
                    onSubmit={handleSubmit}
                    submitLabel="Unmount & Create Lot"
                    submitting={submitting}
                    disabled={loading || !mounts.length}
                />
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: xpFont}}>
                <div style={xpPanel({ fontSize: 10, color: '#555', padding: '4px 8px' })}>
                    Weigh the warp stripped off the beam. It becomes its own leftover lot that any
                    loom can mount later; this beam comes off the machine and is closed at 0, and
                    any difference against the system figure is written off on it.
                </div>

                <FormError>{error}</FormError>

                {loading ? (
                    <XPLoading label="Loading beams on this machine..." />
                ) : mounts.length === 0 ? (
                    <XPEmptyState icon="bi-arrow-bar-up" message="No warp is mounted on this machine — nothing to strip." />
                ) : (
                    <>
                        <div>
                            <FieldLabel>Beam on the loom</FieldLabel>
                            <select
                                style={xpSelect({ width: '100%' })}
                                value={mountId}
                                onChange={e => {
                                    const m = mounts.find((x: any) => String(x.id) === e.target.value);
                                    if (m) pick(m); else setMountId('');
                                }}
                            >
                                <option value="">— select beam —</option>
                                {mounts.map((m: any) => (
                                    <option key={m.id} value={m.id}>
                                        {m.beam_number || m.batch_id}
                                        {m.item_code ? ` — ${m.item_code}` : ''}
                                        {` · ${Number(m.remaining || 0).toFixed(1)} kg`}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div style={{ display: 'flex', gap: 8 }}>
                            <div style={{ flex: 1 }}>
                                <FieldLabel
                                    hint={selected
                                        ? `System says ${sysLeft.toFixed(2)} kg · variance ${variance > 0 ? '+' : ''}${variance.toFixed(2)} kg`
                                        : undefined}
                                >
                                    Weighed Leftover (kg)
                                </FieldLabel>
                                <input type="number" style={xpInput} value={qty} onChange={e => setQty(e.target.value)} min="0" step="any" autoFocus />
                            </div>
                            <div style={{ flex: 1 }}>
                                <FieldLabel>Ends (utas)</FieldLabel>
                                <input type="number" style={xpInput} value={ends} onChange={e => setEnds(e.target.value)} min="1" step="1" placeholder="Optional" />
                            </div>
                        </div>

                        <div>
                            <FieldLabel>Leftover goes to</FieldLabel>
                            <select style={xpSelect({ width: '100%' })} value={returnLoc} onChange={e => setReturnLoc(e.target.value)}>
                                <option value="">— leave parked at the machine —</option>
                                {leafLocations.map((l: any) => (
                                    <option key={l.id} value={l.id}>{locLabel(l)}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <FieldLabel>Leftover Lot No.</FieldLabel>
                            <input type="text" style={xpInput} value={beamNumber} onChange={e => setBeamNumber(e.target.value)} placeholder="Leave empty to auto-generate (LFT-YYYYMMDD-NNNN)" />
                        </div>

                        <div>
                            <FieldLabel>Notes</FieldLabel>
                            <input type="text" style={xpInput} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
                        </div>
                    </>
                )}
            </div>
        </ModalWrapper>
    );
}
