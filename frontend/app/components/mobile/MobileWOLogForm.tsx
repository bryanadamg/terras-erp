'use client';

/**
 * The tablet/phone production log for one work order — the touch layout of the
 * desktop WOCompletionModal. Every rule (which materials, which lots, multi-lot
 * draw, caps, validation, POST body) comes from useWOLogForm, the same hook the
 * desktop uses, so a desktop log feature is a mobile one by construction. Only
 * the drawing lives here.
 */

import { useState } from 'react';
import { xpFont as XP_FONT, CHIP_RADIUS, CodeChip } from '../shared/xpTheme';
import { field as xpInputBase } from '@bryanadamg/terras-ui/styles';
import { MobilePanel, MobileButton, MobileNotice, MobileSearchField } from './mobileTheme';
import { LotChips } from '../shared/LotChips';
import { rejectTitle } from '../shared/rejectDisplay';
import { API_BASE } from '../shared/apiBase';
import { useData } from '../../context/DataContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useUser } from '../../context/UserContext';
import { useWOLogForm } from '../manufacturing/useWOLogForm';
import BagLabelPrintModal from '../manufacturing/BagLabelPrintModal';

const xpInput: React.CSSProperties = xpInputBase({ fontSize: 13, height: 'auto', padding: '6px 8px', width: '100%', boxSizing: 'border-box' });
const fieldLabel: React.CSSProperties = { fontFamily: XP_FONT, fontSize: 11, fontWeight: 'bold', marginBottom: 4 };
const smallLabel: React.CSSProperties = { fontFamily: XP_FONT, fontSize: 10, marginBottom: 3 };
const subLabel: React.CSSProperties = {
    fontFamily: XP_FONT, fontSize: 10, fontWeight: 'bold',
    textTransform: 'uppercase', letterSpacing: 0.5, color: '#555',
    borderBottom: '1px solid #c0bdb5', paddingBottom: 3, marginBottom: 8,
};
const chip = (bg: string, border: string, color: string): React.CSSProperties => ({
    borderRadius: CHIP_RADIUS, fontSize: 10, fontWeight: 'bold', padding: '0 5px',
    background: bg, border: `1px solid ${border}`, color, whiteSpace: 'nowrap',
});
const rowBtn = (color: string, active = false): React.CSSProperties => ({
    fontFamily: XP_FONT, fontSize: 11, padding: '4px 10px', cursor: 'pointer',
    background: active ? '#c8d8f0' : 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid #808080', color,
});

export default function MobileWOLogForm({ mo, wo, onRefresh }: {
    mo: any;
    wo: any;
    onRefresh: () => Promise<void> | void;
}) {
    const { authFetch } = useData() as any;
    const { formatDateTime } = useTimezone();
    const canPrintLabel = useUser().hasPermission('work_order.print_label');
    const f = useWOLogForm(mo, wo);

    const [submitting, setSubmitting] = useState(false);
    const [logSuccess, setLogSuccess] = useState('');
    const [logError, setLogError] = useState('');
    const [subQuery, setSubQuery] = useState('');
    // Labels to print: the bag just logged, one reprinted from history, or all of them.
    const [labels, setLabels] = useState<{ bags: any[]; seq: number; mo: any } | null>(null);

    const handleLog = async () => {
        setLogError('');
        setLogSuccess('');
        const problem = f.validate();
        if (problem) { setLogError(problem); return; }
        setSubmitting(true);
        try {
            const res = await authFetch(`${API_BASE}/manufacturing-orders/${mo.id}/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(f.payload()),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to log');
            }
            const updated = await res.json();
            setLogSuccess(`Logged ${f.qtyCompleted} — MO total: ${(updated.qty_completed_total ?? 0).toFixed(2)} / ${mo.qty}`);
            const made = f.newBag(updated);
            f.resetAfterLog();
            if (made && canPrintLabel) setLabels({ bags: [made.bag], seq: made.seq, mo: updated });
            await onRefresh();
        } catch (err: any) {
            setLogError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (labels) {
        return (
            <BagLabelPrintModal
                bags={labels.bags}
                workOrder={wo}
                parentMO={labels.mo}
                seqStart={labels.seq}
                onClose={() => setLabels(null)}
            />
        );
    }

    const uom = f.findItem(mo.item_id)?.uom;
    const lotIds = Array.from(new Set([...Object.keys(f.batchesByItem), ...Object.keys(f.reservedByItem)]));
    const codeOf = (itemId: string) => f.materialRows.find(r => r.item_id === itemId)?.item_code || f.findItem(itemId)?.code || 'material';
    const completions = mo.completions ? [...mo.completions].reverse() : [];

    return (
        <>
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

            <MobilePanel icon="bi-pencil-square" title="Log Hasil Produksi">

                {/* Qty */}
                <div style={{ marginBottom: 10 }}>
                    <div style={{ ...fieldLabel, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>Qty Aktual Diproduksi</span>
                        {uom && <span style={chip('#e8f0fe', '#a8c0f0', '#31569e')}>{uom}</span>}
                    </div>
                    <input
                        type="number" inputMode="decimal" min="0.0001" step="any" autoFocus
                        value={f.qtyCompleted} onChange={e => f.setQtyCompleted(e.target.value)}
                        placeholder="Masukkan qty aktual..."
                        style={{ ...xpInput, fontSize: 20, padding: '8px 10px', border: '2px solid #7f9db9' }}
                    />
                </div>

                {/* Lot/beam number (lot output) */}
                {f.isLotOutput && (
                    <div style={{ marginBottom: 10 }}>
                        <div style={fieldLabel}>Nomor {f.lotLabel}</div>
                        <input
                            type="text"
                            value={f.beamNumber} onChange={e => f.setBeamNumber(e.target.value)}
                            placeholder={`Kosongkan untuk nomor otomatis (${f.lotPrefix}-...)`}
                            style={{ ...xpInput, fontSize: 16, padding: '6px 10px', border: '2px solid #7f9db9' }}
                        />
                        <div style={{ fontFamily: XP_FONT, fontSize: 9, color: '#888', marginTop: 2 }}>
                            Hasil produksi dicatat sebagai lot stok. Nomor otomatis muncul di catatan entri.
                        </div>
                    </div>
                )}

                {/* Putaway destination — assigned by planning, read-only for operator */}
                {f.putawayDest && (
                    <MobileNotice tone="green">
                        <span style={{ fontWeight: 'bold' }}>Simpan ke: {f.putawayDest}</span>
                        <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>
                            {mo.planned_putaway_location_name ? 'Bin ditentukan oleh planning.' : 'Lokasi output WO (belum ada bin dari planning).'}
                        </div>
                    </MobileNotice>
                )}

                {/* Lots consumed: one dropdown, or a tick list when the material sits as several lots */}
                {lotIds.map(itemId => {
                    const held = f.reservedByItem[itemId] || [];
                    const heldNote = held.length > 0 && (
                        <MobileNotice tone="amber" style={{ marginTop: 4, marginBottom: 0 }}>
                            <div style={{ fontWeight: 'bold', marginBottom: 3 }}>
                                Lot ini sudah di-stage ke WO lain — tidak bisa dipakai di sini:
                            </div>
                            {held.map((b: any) => (
                                <div key={b.id}>
                                    {b.batch_number} — {Number(b.remaining ?? 0).toFixed(2)} kg &rarr; {b.reserved_wo_code || 'WO lain'}
                                </div>
                            ))}
                        </MobileNotice>
                    );
                    const lots = f.batchesByItem[itemId] || [];
                    if (!lots.length) {
                        return (
                            <div key={itemId} style={{ marginBottom: 10 }}>
                                <div style={fieldLabel}>Lot yang Dipakai — {codeOf(itemId)}</div>
                                {heldNote}
                            </div>
                        );
                    }
                    if (f.isMultiLot(itemId)) {
                        const g = f.lotGroup(itemId);
                        const shown = [...g.fitLots, ...(g.otherOpen ? g.otherLots : [])];
                        return (
                            <div key={itemId} style={{ marginBottom: 10 }}>
                                <div style={{ ...fieldLabel, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                                    <span>Lot yang Dipakai — {codeOf(itemId)}</span>
                                    <button type="button" onClick={g.toggleAll} style={rowBtn('#000040')}>
                                        {g.allSelected ? 'None' : 'All'}
                                    </button>
                                </div>
                                <div style={{ fontFamily: XP_FONT, fontSize: 11, color: g.short ? '#900' : '#555', marginBottom: 4 }}>
                                    {g.sel.length} lot · {g.selKg.toFixed(2)} tersedia · diambil <strong>{g.drawn.toFixed(2)}</strong>
                                    {g.short ? ` dari ${g.need.toFixed(2)} — pilih lot lagi` : ''}
                                </div>
                                <div style={{ border: '1px solid #7f9db9', background: '#fff', maxHeight: 320, overflowY: 'auto' }}>
                                    {shown.map((b: any, i: number) => {
                                        const on = g.selSet.has(b.id);
                                        return (
                                            <div key={b.id}>
                                                {i === g.fitLots.length && (
                                                    <div style={{ fontFamily: XP_FONT, fontSize: 10, fontWeight: 'bold', color: '#7a5000', background: '#fff3cd', borderTop: '1px solid #b8860b', padding: '3px 8px' }}>
                                                        Ukuran lain — bukan {f.moSizeLabel} order ini
                                                    </div>
                                                )}
                                                <label style={{
                                                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', cursor: 'pointer',
                                                    borderBottom: '1px solid #e0ded6', background: on ? '#e8f0fe' : '#fff', fontFamily: XP_FONT, fontSize: 12,
                                                }}>
                                                    <input type="checkbox" checked={on} onChange={() => g.toggle(b.id)}
                                                        style={{ width: 22, height: 22, flexShrink: 0, marginTop: 1 }} />
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                            <CodeChip code={b.batch_number} />
                                                            <span style={{ color: '#555' }}>{Number(b.remaining ?? 0).toFixed(2)} kg</span>
                                                            {/* What this log takes off the lot — FIFO, so later lots may take 0. */}
                                                            {on && (
                                                                <span style={g.drawByBatch[b.id] ? chip('#d0f0d0', '#9cc79c', '#0a3e0a') : chip('#eceae2', '#d6d3ce', '#777')}>
                                                                    ambil {(g.drawByBatch[b.id] || 0).toFixed(2)}
                                                                </span>
                                                            )}
                                                            {b.location_name && <span style={{ color: '#0058e6' }}>@ {b.location_name}</span>}
                                                            {b.reserved_wo_id && (
                                                                <span style={chip('#dce8ff', '#7f9db9', '#002080')}><i className="bi bi-upc-scan" /> staged</span>
                                                            )}
                                                        </div>
                                                        <LotChips batch={b} showOrder />
                                                    </div>
                                                </label>
                                            </div>
                                        );
                                    })}
                                </div>
                                {g.otherLots.length > 0 && !g.otherLots.some((b: any) => g.selSet.has(b.id)) && (
                                    <button type="button" onClick={g.toggleOtherSizes} style={{ ...rowBtn('#000040'), marginTop: 4 }}>
                                        <i className={`bi bi-chevron-${g.otherOpen ? 'up' : 'down'}`} /> {g.otherOpen ? 'Sembunyikan' : 'Tampilkan'} {g.otherLots.length} lot ukuran lain
                                    </button>
                                )}
                                {heldNote}
                            </div>
                        );
                    }
                    return (
                        <div key={itemId} style={{ marginBottom: 10 }}>
                            <div style={fieldLabel}>Lot yang Dipakai — {codeOf(itemId)}</div>
                            <select
                                value={f.consumedBatches[itemId] || ''}
                                onChange={e => f.setConsumedBatches(prev => ({ ...prev, [itemId]: e.target.value }))}
                                style={{ ...xpInput, appearance: 'auto' }}
                            >
                                <option value="">— pilih lot —</option>
                                {lots.map((b: any) => (
                                    <option key={b.id} value={b.id}>
                                        {b.batch_number}{b.vendor_lot ? ` (supplier: ${b.vendor_lot})` : ''} — {Number(b.remaining ?? 0).toFixed(2)} sisa{b.ends ? `, ${b.ends} ends` : ''}
                                    </option>
                                ))}
                            </select>
                            {heldNote}
                        </div>
                    );
                })}

                {/* Cones + Boxes — optional output packaging tally */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                        <div style={smallLabel}>Cones</div>
                        <input type="number" inputMode="numeric" min="0" step="1" value={f.qtyCones}
                            onChange={e => f.setQtyCones(e.target.value)} placeholder="Opsional" style={xpInput} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={smallLabel}>Boxes</div>
                        <input type="number" inputMode="numeric" min="0" step="1" value={f.qtyBoxes}
                            onChange={e => f.setQtyBoxes(e.target.value)} placeholder="Opsional" style={xpInput} />
                    </div>
                </div>

                {/* Operator + Notes */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                        <div style={smallLabel}>Operator</div>
                        <input type="text" value={f.operatorName} onChange={e => f.setOperatorName(e.target.value)}
                            placeholder="Nama (opsional)" style={xpInput} />
                    </div>
                    <div style={{ flex: 2 }}>
                        <div style={smallLabel}>Catatan</div>
                        <input type="text" value={f.notes} onChange={e => f.setNotes(e.target.value)}
                            placeholder="Lot, shift, keterangan..." style={xpInput} />
                    </div>
                </div>

                {/* Work Center / Machine — required when the WO has no stock locations yet */}
                <div style={{ marginBottom: 10 }}>
                    <div style={{ ...smallLabel, ...(f.needsMachine ? { fontWeight: 'bold', color: '#900' } : {}), display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span>Work Center / Machine{f.needsMachine ? ' (wajib — menentukan lokasi stok)' : ''}</span>
                        {f.machineScopeLabel && <span style={chip('#dce8ff', '#7f9db9', '#002080')}>{f.machineScopeLabel}</span>}
                    </div>
                    <select
                        value={f.workCenterId}
                        onChange={e => f.setWorkCenterId(e.target.value)}
                        style={{ ...xpInput, appearance: 'auto' }}
                    >
                        <option value="">{f.needsMachine ? '— pilih mesin —' : '— pilih mesin (opsional) —'}</option>
                        {f.wcOptions.map(o => (
                            <option key={o.value} value={o.value}>{o.label}{o.subLabel ? ` (${o.subLabel})` : ''}</option>
                        ))}
                    </select>
                    {f.needsMachine && (
                        <div style={{ fontFamily: XP_FONT, fontSize: 10, color: '#900', marginTop: 2 }}>
                            WO ini belum punya lokasi input/output. Pilih mesin untuk menentukannya.
                        </div>
                    )}
                </div>

                {/* Material Consumption */}
                {f.materialRows.length > 0 && (
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
                                    <th style={{ padding: '3px 4px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 84 }}>Actual</th>
                                    <th style={{ padding: '3px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 50 }}>Var</th>
                                </tr>
                            </thead>
                            <tbody>
                                {f.materialRows.map((row, idx) => {
                                    const qty = parseFloat(f.qtyCompleted) || 0;
                                    const planned = (qty * row.planned_pct) / 100;
                                    const variance = (parseFloat(row.actual_qty) || 0) - planned;
                                    const picking = f.subPickerIdx === idx;
                                    const avail = f.sourceAvailable(row.item_id);
                                    return (
                                        <tr key={idx} style={{ background: idx % 2 === 0 ? '#fff' : '#f5f4ee', verticalAlign: 'top' }}>
                                            <td style={{ padding: '3px 4px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                    <span style={{ fontWeight: 500 }}>{row.item_code}</span>
                                                    {row.is_substitute && <span style={chip('#fff3cd', '#b8860b', '#7a5000')}>SUB</span>}
                                                    {row.is_substitute && (
                                                        <span style={{ fontSize: 9, color: '#999', textDecoration: 'line-through' }}>{row.orig_item_code}</span>
                                                    )}
                                                </div>
                                                {row.item_name && row.item_name !== row.item_code && (
                                                    <div style={{ color: '#666', fontSize: 10 }}>{row.item_name}</div>
                                                )}
                                                <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                                                    <button type="button" style={rowBtn('#000040', picking)}
                                                        onClick={() => { f.setSubPickerIdx(picking ? null : idx); setSubQuery(''); f.onSearchItems(''); }}>
                                                        {picking ? 'Cancel' : 'Sub'}
                                                    </button>
                                                    {row.is_substitute && (
                                                        <button type="button" style={rowBtn('#900')} onClick={() => f.clearSubstitute(idx)}>Clear</button>
                                                    )}
                                                </div>
                                            </td>
                                            <td style={{ padding: '3px 6px', textAlign: 'right', color: '#555' }}>
                                                {qty > 0 ? planned.toFixed(3) : '—'}
                                            </td>
                                            <td style={{ padding: '3px 4px' }}>
                                                <input
                                                    type="number" inputMode="decimal" min="0" step="any"
                                                    value={row.actual_qty}
                                                    onChange={e => f.setActualQty(idx, e.target.value)}
                                                    placeholder="0"
                                                    style={{ ...xpInput, textAlign: 'right', padding: '4px', fontSize: 12 }}
                                                />
                                                {!row.is_custom && avail !== null && avail + 1e-6 < planned && (
                                                    <div style={{ fontSize: 9, color: '#7a4a00', textAlign: 'right' }}>
                                                        maks. stage {avail.toFixed(3)}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '3px 6px', textAlign: 'right', fontSize: 10, color: variance > 0.0001 ? '#900' : variance < -0.0001 ? '#007000' : '#888' }}>
                                                {qty > 0 && row.actual_qty ? (variance > 0 ? '+' : '') + variance.toFixed(3) : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        {/* Substitute picker — server search, so any item is reachable */}
                        {f.subPickerIdx !== null && (
                            <div style={{ marginTop: 8, border: '2px solid #1a4a8a', background: '#f0f4ff', padding: 8 }}>
                                <div style={{ fontFamily: XP_FONT, fontSize: 10, fontWeight: 'bold', color: '#000080', marginBottom: 6 }}>
                                    Substitute for: {f.materialRows[f.subPickerIdx]?.orig_item_code}
                                </div>
                                <div style={{ display: 'flex', marginBottom: 6 }}>
                                    <MobileSearchField value={subQuery} autoFocus
                                        onChange={v => { setSubQuery(v); f.onSearchItems(v); }}
                                        placeholder="Cari kode atau nama item..." />
                                </div>
                                {f.itemResults.length === 0 && (
                                    <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#888', padding: '4px 0' }}>No items found.</div>
                                )}
                                {f.itemResults.slice(0, 15).map((it: any) => (
                                    <button
                                        key={it.id}
                                        type="button"
                                        onClick={() => { f.setSubstitute(f.subPickerIdx!, it.id); setSubQuery(''); }}
                                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 2, fontFamily: XP_FONT, fontSize: 12, cursor: 'pointer', background: '#fff', border: '1px solid #7f9db9', borderRadius: 3 }}
                                    >
                                        <span style={{ fontWeight: 'bold' }}>{it.code}</span>
                                        {it.name && it.name !== it.code && <span style={{ color: '#555', marginLeft: 8, fontSize: 11 }}>{it.name}</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <MobileButton
                    tone="create"
                    icon="bi-save"
                    onClick={handleLog}
                    disabled={submitting}
                    style={{ width: '100%', fontSize: 14, padding: '12px 14px' }}
                >
                    {submitting ? 'Menyimpan...' : 'Simpan Log'}
                </MobileButton>
            </MobilePanel>

            {/* Previous entries — reprint any bag's label, same as the desktop log */}
            {completions.length > 0 && (
                <MobilePanel
                    icon="bi-clock-history"
                    title="Riwayat Log"
                    right={canPrintLabel && f.woBags.length > 0 ? (
                        <MobileButton compact icon="bi-printer" onClick={() => setLabels({ bags: f.woBags, seq: 1, mo })}>
                            Semua Label ({f.woBags.length})
                        </MobileButton>
                    ) : undefined}
                >
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                        {completions.map((c: any) => {
                            const seq = f.bagSeqById[String(c.id)];
                            const pkg = [c.qty_cones ? `${c.qty_cones} cones` : null, c.qty_boxes ? `${c.qty_boxes} box` : null].filter(Boolean).join(', ');
                            return (
                                <div key={c.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px',
                                    borderBottom: '1px solid #e0ded6', fontFamily: XP_FONT, fontSize: 11,
                                    background: c.rejected ? '#fbe4e4' : undefined,
                                }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 'bold', textDecoration: c.rejected ? 'line-through' : 'none', color: c.rejected ? '#900' : undefined }}>
                                            {parseFloat(c.qty_completed).toFixed(2)}
                                            {!c.rejected && (c.qty_rejected ?? 0) > 0 && (
                                                <span title={rejectTitle(c, 'Partially rejected')} style={{ marginLeft: 4, fontSize: 10, color: '#900' }}>
                                                    (-{Number(c.qty_rejected).toFixed(2)})
                                                </span>
                                            )}
                                            {c.output_batch_number && <span style={{ fontWeight: 'normal', color: '#555', marginLeft: 6 }}>{c.output_batch_number}</span>}
                                        </div>
                                        <div style={{ color: '#666', fontSize: 10 }}>
                                            {[pkg, c.operator_name, c.work_center_name, formatDateTime(c.created_at)].filter(Boolean).join(' · ')}
                                        </div>
                                    </div>
                                    {c.rejected ? (
                                        <span style={{ fontSize: 10, fontWeight: 'bold', color: '#900' }} title={rejectTitle(c, 'Rejected')}>REJECTED</span>
                                    ) : canPrintLabel && seq ? (
                                        <MobileButton compact icon="bi-tag" onClick={() => setLabels({ bags: [c], seq, mo })}>Label</MobileButton>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </MobilePanel>
            )}
        </>
    );
}
