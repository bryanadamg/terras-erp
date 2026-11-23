'use client';
import React, { useState, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import ModalWrapper from '../shared/ModalWrapper';
import SearchableSelect from '@bryanadamg/terras-ui/components/Combobox';
import { xpFont, CHIP_RADIUS, BUTTON_RADIUS, XP_BTN } from '../shared/xpTheme';
import { field as xpInputBase } from '@bryanadamg/terras-ui/styles';
import { TintCard } from '../shared/RequestDetailPanel';
import { API_BASE } from '../shared/apiBase';

const xpInput: React.CSSProperties = xpInputBase({ padding: '0 4px' });

const LINE = 'var(--terras-table-line, #d6d3ce)';
const MUTED = 'var(--terras-win-text-3, #555)';
const chip = (f: 'blue' | 'green' | 'red' | 'gray'): React.CSSProperties => ({
    background: `var(--terras-chip-${f}-bg)`, border: `1px solid var(--terras-chip-${f}-border)`, color: `var(--terras-chip-${f}-text)`,
    borderRadius: CHIP_RADIUS,
});

interface BeamRow {
    localId: string;
    work_center_id: string;
    qty: string;
    ends: string;
    notes: string;
    repeat: string;
    next_destination_work_center_id: string;
    next_destination_location_id: string;
    target_start_date: string;
    target_end_date: string;
}

interface Props {
    mo: { id: string; code: string; qty: number; item_name?: string; uom?: string; ends?: number };
    machines: Array<{ id: string; name: string; code?: string }>;
    /** Work-center group the BOM locks these WOs to — the WO row's blue badge. */
    groupId?: string;
    groupName?: string;
    components?: Array<{ name: string; code?: string; ends: number | null }>;
    centerLabel?: string;
    locations?: Array<{ id: string; code?: string; name: string }>;
    nextWorkCenters?: Array<{ id: string; name: string }>;
    onClose: () => void;
}

let _rowId = 0;
function makeRow(defaultWcId = '', defaultEnds = ''): BeamRow {
    return { localId: `beam-${++_rowId}`, work_center_id: defaultWcId, qty: '', ends: defaultEnds, notes: '', repeat: '1', next_destination_work_center_id: '', next_destination_location_id: '', target_start_date: '', target_end_date: '' };
}

export default function BeamPlanningModal({ mo, machines, groupId, groupName, components = [], centerLabel = 'Beaming', locations = [], nextWorkCenters = [], onClose }: Props) {
    const { authFetch, fetchData } = useData();

    // Machine is optional, same as the WO row: leaving it blank pegs the WO to the
    // group badge instead, so beams can be planned before the loom is decided.
    const defaultWcId = '';
    const defaultEnds = mo.ends != null ? String(mo.ends) : '';
    const machineOptions = useMemo(
        () => machines.map(m => ({ value: String(m.id), label: m.name, subLabel: m.code || undefined })),
        [machines]
    );
    const nextWcOptions = useMemo(
        () => nextWorkCenters.map(wc => ({ value: String(wc.id), label: wc.name })),
        [nextWorkCenters]
    );
    const [rows, setRows] = useState<BeamRow[]>([makeRow(defaultWcId, defaultEnds)]);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const moQty = Number(mo.qty) || 0;
    const validRows = useMemo(() => rows.filter(r => parseFloat(r.qty) > 0), [rows]);
    const totalWoCount = useMemo(() => validRows.reduce((s, r) => s + Math.max(1, parseInt(r.repeat) || 1), 0), [validRows]);
    const totalAssigned = useMemo(
        () => rows.reduce((s, r) => s + (parseFloat(r.qty) || 0) * Math.max(1, parseInt(r.repeat) || 1), 0),
        [rows]
    );
    const isOver = moQty > 0 && totalAssigned > moQty + 0.001;
    const isUnder = moQty > 0 && totalAssigned < moQty - 0.001;

    const addRow = () => setRows(prev => [...prev, makeRow(defaultWcId, defaultEnds)]);
    const removeRow = (id: string) => setRows(prev => prev.filter(r => r.localId !== id));
    const update = (id: string, field: keyof BeamRow, val: string) =>
        setRows(prev => prev.map(r => r.localId === id ? { ...r, [field]: val } : r));

    const handleCreate = async () => {
        if (!validRows.length) { setError('Enter qty for at least one beam.'); return; }
        setIsSaving(true);
        setError(null);
        try {
            const payloads = validRows.flatMap(r => {
                const count = Math.max(1, parseInt(r.repeat) || 1);
                return Array.from({ length: count }, () => ({
                    manufacturing_order_id: mo.id,
                    // No machine picked -> peg to the group. A WO with no work center at
                    // all is invisible to every center-type tab (see WorkOrderPanel).
                    work_center_id: r.work_center_id || groupId || undefined,
                    qty: parseFloat(r.qty),
                    ends: r.ends ? parseInt(r.ends) : undefined,
                    notes: r.notes || undefined,
                    sequence: 1,
                    next_destination_work_center_id: r.next_destination_work_center_id || undefined,
                    next_destination_location_id: r.next_destination_location_id || undefined,
                    target_start_date: r.target_start_date || undefined,
                    target_end_date: r.target_end_date || undefined,
                }));
            });
            const res = await authFetch(`${API_BASE}/work-orders/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloads),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(body.detail || 'Failed to create work orders');
                return;
            }
            await fetchData('work-orders');
            onClose();
        } finally {
            setIsSaving(false);
        }
    };

    const footer = (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span style={{ fontSize: 10, color: MUTED, fontFamily: xpFont }}>
                Will create <strong>{totalWoCount}</strong> Work Order{totalWoCount !== 1 ? 's' : ''} under <strong>{mo.code}</strong>
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
                <button
                    className={XP_BTN}
                    onClick={onClose}
                    style={{
                        borderRadius: BUTTON_RADIUS,
                        fontFamily: xpFont, fontSize: 11, padding: '2px 12px',
                        background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)',
                        border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                        cursor: 'pointer',
                    }}
                >
                    Cancel
                </button>
                <button
                    className={XP_BTN}
                    onClick={handleCreate}
                    disabled={isSaving || totalWoCount === 0}
                    style={{
                        borderRadius: BUTTON_RADIUS,
                        fontFamily: xpFont, fontSize: 11, padding: '2px 14px', fontWeight: 'bold',
                        background: isSaving || totalWoCount === 0
                            ? 'linear-gradient(to bottom, #d0d0c8, #b8b8b0)'
                            : 'linear-gradient(to bottom, #b0e8b0, #70c870)',
                        border: '1px solid', borderColor: '#dfdfdf #0a3e0a #0a3e0a #dfdfdf',
                        cursor: isSaving || totalWoCount === 0 ? 'not-allowed' : 'pointer',
                        color: '#004000',
                    }}
                >
                    {isSaving ? '...' : `Create ${totalWoCount} Beam WO${totalWoCount !== 1 ? 's' : ''}`}
                </button>
            </div>
        </div>
    );

    return (
        <ModalWrapper
            isOpen
            modeless
            onClose={onClose}
            title={`Plan ${centerLabel} Work Orders`}
            size="xxl"
            footer={footer}
        >
            {/* MO info strip */}
            <div style={{
                background: 'var(--terras-toolbar-bg, #f5f4ef)', border: `1px solid ${LINE}`,
                padding: '5px 8px', marginBottom: 8,
                display: 'flex', gap: 16, alignItems: 'center',
            }}>
                {[
                    { label: 'MO', value: mo.code },
                    { label: 'Item', value: mo.item_name || '—' },
                    { label: 'Total Qty', value: moQty > 0 ? `${moQty} ${mo.uom || ''}`.trim() : '—' },
                    ...(mo.ends != null ? [{ label: 'Beam Ends', value: String(mo.ends) }] : []),
                ].map(({ label, value }, i) => (
                    <React.Fragment key={label}>
                        {i > 0 && <div style={{ width: 1, background: LINE, height: 26 }} />}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontSize: 9, color: 'var(--terras-win-text-3, #666)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
                            <span style={{ fontSize: 11, fontWeight: 'bold', color: 'var(--terras-win-text, #222)' }}>{value}</span>
                        </div>
                    </React.Fragment>
                ))}
            </div>

            {/* Yarn components */}
            {components.length > 0 && (
                <TintCard title="Yarn Components — Ends per Yarn" style={{ marginBottom: 8 }} bodyStyle={{ padding: 8 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {components.map((c, i) => (
                            <span key={i} style={{ borderRadius: CHIP_RADIUS, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--terras-table-bg, #fff)', border: `1px solid ${LINE}`, padding: '1px 6px', fontSize: 10 }}>
                                <span style={{ color: 'var(--terras-win-text, #222)', fontWeight: 'bold' }}>{c.name}</span>
                                <span style={{ ...chip('green'), fontWeight: 'bold', padding: '0 4px' }}>
                                    {c.ends != null && c.ends > 0 ? `${Math.round(c.ends)} ends` : '— ends'}
                                </span>
                            </span>
                        ))}
                    </div>
                </TintCard>
            )}

            {/* Section label */}
            <div style={{ fontSize: 10, fontWeight: 'bold', color: 'var(--terras-chip-blue-text, #0d2a6e)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Beam Assignment
            </div>

            {/* Rows table */}
            <div style={{ overflowX: 'auto', border: `1px solid ${LINE}` }}>
            <table style={{ width: '100%', minWidth: 1060, tableLayout: 'fixed', borderCollapse: 'collapse', background: 'var(--terras-table-bg, #fff)', marginBottom: 0 }}>
                <thead>
                    <tr>
                        <th style={{ ...thStyle('#'), width: 26 }}>{'#'}</th>
                        {/* Machine stays optional — the group badge carries the center type
                            when no loom is chosen, mirroring the WO row's locked-group badge. */}
                        <th style={{ ...thStyle('Machine'), width: 170 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                {groupName && (
                                    <span style={{ borderRadius: CHIP_RADIUS,
                                        fontFamily: xpFont, fontSize: 9, padding: '0 5px',
                                        display: 'inline-flex', alignItems: 'center',
                                        ...chip('blue'),
                                        fontWeight: 'bold', whiteSpace: 'nowrap',
                                    }}>
                                        {groupName}
                                    </span>
                                )}
                                <span>Machine (optional)</span>
                            </div>
                        </th>
                        <th style={{ ...thStyle('Qty'), width: 80 }}>Qty / Beam</th>
                        <th style={{ ...thStyle('Ends'), width: 90 }}>Qty / Ends (Utas)</th>
                        <th style={{ ...thStyle('Repeat'), width: 50 }}>Repeat</th>
                        <th style={{ ...thStyle('Start'), width: 120 }}>Target Start</th>
                        <th style={{ ...thStyle('End'), width: 120 }}>Target End</th>
                        <th style={{ ...thStyle('Notes / Beam ID'), width: 160 }}>Notes / Beam ID</th>
                        <th style={{ ...thStyle('Tujuan Berikutnya'), width: 160 }}>Tujuan Berikutnya</th>
                        <th style={{ ...thStyle(''), width: 26 }}></th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, idx) => (
                        <tr key={row.localId} style={{ background: idx % 2 === 1 ? 'var(--terras-row-stripe-sub, #fbfaf7)' : 'var(--terras-table-bg, #fff)' }}>
                            <td style={tdStyle({ width: 28, textAlign: 'center', color: 'var(--terras-win-text-3, #666)', fontWeight: 'bold' })}>{idx + 1}</td>
                            <td style={tdStyle({})}>
                                <SearchableSelect
                                    options={machineOptions}
                                    value={row.work_center_id}
                                    onChange={v => update(row.localId, 'work_center_id', v)}
                                    placeholder="— Machine —"
                                />
                            </td>
                            <td style={tdStyle({ width: 90 })}>
                                <input
                                    type="number" min="0" step="any"
                                    style={{ ...xpInput, width: '100%', background: parseFloat(row.qty) > 0 ? 'white' : '#fffff8' }}
                                    value={row.qty}
                                    placeholder="qty..."
                                    onChange={e => update(row.localId, 'qty', e.target.value)}
                                    autoFocus={idx === 0}
                                />
                            </td>
                            <td style={tdStyle({ width: 100 })}>
                                <input
                                    type="number" min="0" step="1"
                                    style={{ ...xpInput, width: '100%' }}
                                    value={row.ends}
                                    placeholder="ends..."
                                    onChange={e => update(row.localId, 'ends', e.target.value)}
                                />
                            </td>
                            <td style={tdStyle({ width: 56 })}>
                                <input
                                    type="number" min="1" step="1"
                                    style={{ ...xpInput, width: '100%', textAlign: 'center' }}
                                    value={row.repeat}
                                    onChange={e => update(row.localId, 'repeat', e.target.value)}
                                />
                            </td>
                            <td style={tdStyle({ width: 118 })}>
                                <input
                                    type="date"
                                    style={{ ...xpInput, width: '100%' }}
                                    value={row.target_start_date}
                                    onChange={e => update(row.localId, 'target_start_date', e.target.value)}
                                />
                            </td>
                            <td style={tdStyle({ width: 118 })}>
                                <input
                                    type="date"
                                    style={{ ...xpInput, width: '100%' }}
                                    value={row.target_end_date}
                                    onChange={e => update(row.localId, 'target_end_date', e.target.value)}
                                />
                            </td>
                            <td style={tdStyle({})}>
                                <input
                                    type="text"
                                    style={{ ...xpInput, width: '100%' }}
                                    value={row.notes}
                                    placeholder="e.g. Beam #A-01, 60&quot; wide"
                                    onChange={e => update(row.localId, 'notes', e.target.value)}
                                />
                            </td>
                            <td style={tdStyle({ width: 150 })}>
                                {(nextWorkCenters.length > 0 || locations.length > 0) ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        {nextWorkCenters.length > 0 && (
                                            <SearchableSelect
                                                options={nextWcOptions}
                                                value={row.next_destination_work_center_id}
                                                onChange={v => update(row.localId, 'next_destination_work_center_id', v)}
                                                placeholder="— Mesin —"
                                                size="sm"
                                            />
                                        )}
                                        {locations.length > 0 && (
                                            <select
                                                style={{ ...xpInput, width: '100%', fontSize: 10 }}
                                                value={row.next_destination_location_id}
                                                onChange={e => update(row.localId, 'next_destination_location_id', e.target.value)}
                                            >
                                                <option value="">— Lokasi —</option>
                                                {locations.map(l => (
                                                    <option key={l.id} value={l.id}>{l.code || l.name}</option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                ) : <span style={{ color: 'var(--terras-win-text-3, #aaa)', fontSize: 9 }}>—</span>}
                            </td>
                            <td style={tdStyle({ textAlign: 'center' })}>
                                <button
                                    onClick={() => removeRow(row.localId)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--terras-status-red, #aa0000)', fontSize: 13, fontWeight: 'bold', padding: '0 2px' }}
                                    title="Remove"
                                >x</button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            </div>

            {/* Summary bar */}
            <div style={{
                background: 'var(--terras-toolbar-bg, #f5f4ef)', border: `1px solid ${LINE}`, borderTop: 'none',
                padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 10,
                fontSize: 10, marginBottom: 6,
            }}>
                <span style={{
                    width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
                    background: isOver ? 'var(--terras-status-red, #ff6600)' : isUnder ? 'var(--terras-status-amber, #cc8800)' : 'var(--terras-status-green, #4caf50)',
                }} />
                <span style={{ color: MUTED }}>Total assigned:</span>
                <span style={{ fontWeight: 'bold', color: isOver ? 'var(--terras-status-red, #c85000)' : isUnder ? 'var(--terras-status-amber, #886600)' : 'var(--terras-status-green, #2e7d32)' }}>
                    {totalAssigned.toFixed(2)}
                </span>
                <span style={{ color: LINE }}>|</span>
                <span style={{ color: MUTED }}>MO qty:</span>
                <span style={{ fontWeight: 'bold' }}>{moQty > 0 ? moQty : '—'}</span>
                <span style={{ color: LINE }}>|</span>
                <span style={{ color: MUTED }}>Beams:</span>
                <span style={{ fontWeight: 'bold' }}>{totalWoCount}</span>
                {isOver && <span style={{ color: 'var(--terras-status-red, #c85000)', marginLeft: 'auto', fontStyle: 'italic' }}>Over-assigned</span>}
                {isUnder && <span style={{ color: 'var(--terras-status-amber, #886600)', marginLeft: 'auto', fontStyle: 'italic' }}>Partial — unassigned qty remains on MO</span>}
                {!isOver && !isUnder && moQty > 0 && <span style={{ color: 'var(--terras-status-green, #2e7d32)', marginLeft: 'auto' }}>Fully assigned</span>}
            </div>

            <button
                className={XP_BTN}
                onClick={addRow}
                style={{
                    borderRadius: BUTTON_RADIUS,
                    fontFamily: xpFont, fontSize: 11, padding: '2px 10px',
                    background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)',
                    border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                    cursor: 'pointer', color: '#222',
                }}
            >
                + Add Beam
            </button>

            {error && (
                <div style={{
                    marginTop: 6, ...chip('red'),
                    padding: '3px 8px', fontSize: 10,
                }}>
                    {error}
                </div>
            )}
        </ModalWrapper>
    );
}

function thStyle(label: string): React.CSSProperties {
    return {
        background: 'var(--terras-toolbar-bg, #f5f4ef)',
        borderBottom: `1px solid ${LINE}`, borderRight: `1px solid ${LINE}`,
        padding: '3px 6px', fontSize: 10, fontWeight: 'bold', color: 'var(--terras-win-text-2, #333)', textAlign: 'left',
    };
}

function tdStyle(extra: React.CSSProperties): React.CSSProperties {
    return {
        borderBottom: `1px solid ${LINE}`, borderRight: `1px solid ${LINE}`,
        padding: '2px 4px', verticalAlign: 'middle',
        ...extra,
    };
}
