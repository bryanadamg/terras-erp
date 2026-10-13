'use client';

import { useEffect, useState } from 'react';
import ModalWrapper from '../shared/ModalWrapper';
import { useToast } from '../shared/Toast';
import { xpBtn, XP_BTN, BTN_TONES, CODE_FONT, xpFont, CodeChip, VariantChip, XPActionButton } from '../shared/xpTheme';
import { qtyFmt } from '../shared/format';
import { API_BASE } from '../shared/apiBase';

// "Allocate from stock": the planner picks named packed cartons already on hand
// and pins them to this order's lines instead of producing the qty. Each carton
// becomes a StockReservation, so a Production Run made for this order later plans
// only what is left, this order's pick list suggests these boxes first, and no
// other order can allocate or pick them.
export default function AllocateStockModal({ so, authFetch, onClose, onDone }: {
    so: any;
    authFetch: (url: string, init?: RequestInit) => Promise<Response>;
    onClose: () => void;
    onDone: () => void;
}) {
    const { showToast } = useToast();
    const [lines, setLines] = useState<any[] | null>(null);
    const [picked, setPicked] = useState<Record<string, Set<string>>>({});
    const [saving, setSaving] = useState(false);

    const load = () => authFetch(`${API_BASE}/sales-orders/${so.id}/allocation`)
        .then(r => (r.ok ? r.json() : Promise.reject()))
        .then(rows => { setLines(rows); setPicked({}); })
        .catch(() => { showToast('Could not load stock for this order', 'danger'); onClose(); });

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [so.id]);

    const sel = (lineId: string) => picked[lineId] || new Set<string>();
    const toggle = (lineId: string, batchId: string) => setPicked(p => {
        const next = new Set(sel(lineId));
        if (next.has(batchId)) next.delete(batchId); else next.add(batchId);
        return { ...p, [lineId]: next };
    });
    // Oldest cartons first until the line is covered — the server lists them FIFO.
    const fifo = (l: any) => {
        const next = new Set<string>();
        let sum = 0;
        for (const c of l.cartons) {
            if (sum >= l.needed - 1e-6) break;
            next.add(c.batch_id);
            sum += c.qty;
        }
        setPicked(p => ({ ...p, [l.sales_order_line_id]: next }));
    };

    // Mirrors the server's checks so the button can say why it is disabled.
    const problem = (l: any): string | null => {
        const chosen = l.cartons.filter((c: any) => sel(l.sales_order_line_id).has(c.batch_id));
        if (chosen.length === 0) return null;
        const total = chosen.reduce((a: number, c: any) => a + c.qty, 0);
        const smallest = Math.min(...chosen.map((c: any) => c.qty));
        if (total - smallest >= l.needed - 1e-6) return `More cartons than the ${qtyFmt(2)(l.needed)} ${l.uom} still needed`;
        if (total > l.free + 1e-6) return `Only ${qtyFmt(2)(l.free)} ${l.uom} of this stock is free — the rest is promised to open MOs or other orders`;
        return null;
    };

    const payload = (lines || [])
        .map(l => ({ sales_order_line_id: l.sales_order_line_id, batch_ids: [...sel(l.sales_order_line_id)] }))
        .filter(l => l.batch_ids.length > 0);
    const blocked = (lines || []).some(l => problem(l));

    const submit = async () => {
        setSaving(true);
        try {
            const res = await authFetch(`${API_BASE}/sales-orders/${so.id}/allocate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: payload }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || 'Allocation failed', 'danger');
                if (res.status === 409) load();
                return;
            }
            showToast('Cartons allocated to this order', 'success');
            onDone();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    const release = async (reservationId: string) => {
        const res = await authFetch(`${API_BASE}/sales-orders/${so.id}/reservations/${reservationId}/release`, { method: 'POST' });
        if (res.ok) { showToast('Carton released back to stock', 'success'); onDone(); load(); }
        else showToast('Could not release the carton', 'danger');
    };

    const th: React.CSSProperties = { padding: '3px 8px', fontSize: '0.66rem', fontWeight: 'bold', color: '#555', textAlign: 'left', borderBottom: '1px solid #b8c4de', whiteSpace: 'nowrap' };
    const thNum: React.CSSProperties = { ...th, textAlign: 'right' };
    const td: React.CSSProperties = { padding: '3px 8px', fontSize: '0.7rem' };
    const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: CODE_FONT, whiteSpace: 'nowrap' };
    const stat = (label: string, value: string, strong = false) => (
        <span style={{ fontSize: '0.7rem', color: '#555' }}>
            {label} <span style={{ fontFamily: CODE_FONT, fontWeight: strong ? 700 : 400, color: '#000' }}>{value}</span>
        </span>
    );
    const cartonQty = (c: any) => <>{qtyFmt(2)(c.qty)}{c.alt_qty != null && <span style={{ color: '#777' }}> / {qtyFmt(2)(c.alt_qty)} {c.alt_uom || ''}</span>}</>;
    const cartonNo = (c: any) => <><CodeChip code={c.batch_number} tier={2} />{c.package_no != null && <span style={{ color: '#777', marginLeft: 4 }}>#{c.package_no}</span>}</>;

    return (
        <ModalWrapper
            isOpen
            onClose={onClose}
            title={<><i className="bi bi-box-seam me-2"></i>Allocate from stock — {so.po_number}</>}
            size="xl"
            modeless
            footer={<>
                {blocked && <span style={{ color: '#b91c1c', fontSize: '0.72rem', marginRight: 'auto' }}>Fix the highlighted line first</span>}
                <button className={XP_BTN} style={xpBtn()} onClick={onClose}>Cancel</button>
                <button className={XP_BTN} disabled={saving || blocked || payload.length === 0}
                    style={saving || blocked || payload.length === 0 ? { ...xpBtn(), opacity: 0.5 } : xpBtn({ ...BTN_TONES.primary, padding: '2px 16px' })}
                    onClick={submit}>
                    <i className="bi bi-lock" style={{ marginRight: 4 }}></i>Allocate {payload.reduce((a, l) => a + l.batch_ids.length, 0) || ''} carton(s)
                </button>
            </>}
        >
            <div style={{ fontFamily: xpFont, fontSize: 12 }}>
                <p style={{ color: '#666', fontSize: '0.72rem', marginBottom: 8 }}>
                    Pick packed cartons already in stock for each line — nothing is produced for them. They are held for
                    this order and its pick list suggests them first; a Production Run created afterwards only plans what is left.
                    Only cartons packed to stock and not claimed by another order or pick list are listed.
                </p>
                {!lines ? <p className="text-muted">Loading…</p> : lines.map(l => {
                    const id = l.sales_order_line_id;
                    const chosen = l.cartons.filter((c: any) => sel(id).has(c.batch_id));
                    const chosenQty = chosen.reduce((a: number, c: any) => a + c.qty, 0);
                    const err = problem(l);
                    const reason = l.ordered === null ? 'Item has no weight per unit — ordered qty unknown'
                        : l.needed <= 0 ? 'Nothing left to cover'
                        : l.cartons.length === 0 ? 'No free packed cartons match this line' : null;
                    return (
                        <div key={id} style={{ marginBottom: 14, border: `1px solid ${err ? '#e0a0a0' : '#b8c4de'}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '5px 8px', background: '#f1f0eb', borderBottom: '1px solid #b8c4de' }}>
                                <strong style={{ fontSize: '0.75rem' }}>{l.item_name}</strong>
                                <CodeChip code={l.item_code} tier={2} />
                                {l.size && <VariantChip kind="size">{String(l.size).toUpperCase()}</VariantChip>}
                                {/* Same chips as the SO table: the ordered Colors value (NAVY) with its
                                    swatch, then the Color Library code, then combo / material. */}
                                {(l.variant_attributes || [])
                                    .filter((v: any) => v.system_role === 'color')
                                    .map((v: any) => <VariantChip key={v.value} kind="color" swatch={v.hex}>{v.value}</VariantChip>)}
                                {l.color_code && <VariantChip kind="color" swatch={l.color_hex}>{l.color_code}</VariantChip>}
                                {(l.variant_attributes || [])
                                    .filter((v: any) => v.system_role === 'combo' || v.system_role === 'material')
                                    .map((v: any) => <VariantChip key={v.value} kind={v.system_role}>{v.value}</VariantChip>)}
                                <span style={{ flex: 1 }} />
                                {stat('Ordered', l.ordered === null ? '—' : `${qtyFmt(2)(l.ordered)} ${l.uom}`)}
                                {stat('Shipped', qtyFmt(2)(l.dispatched))}
                                {stat('Allocated', qtyFmt(2)(l.allocated))}
                                {stat('Still needed', qtyFmt(2)(l.needed), true)}
                                {stat('Selected', qtyFmt(2)(chosenQty), true)}
                            </div>
                            {err && <div style={{ padding: '3px 8px', color: '#b91c1c', fontSize: '0.7rem', background: '#fdecec' }}>{err}</div>}
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={{ ...th, width: 28 }}>
                                            {!reason && (
                                                <XPActionButton tone="neutral" icon="bi-magic" title="Select the oldest cartons until the line is covered" onClick={() => fifo(l)} />
                                            )}
                                        </th>
                                        <th style={th}>Carton</th>
                                        <th style={th}>Location</th>
                                        <th style={th}>Size</th>
                                        <th style={th}>Packed</th>
                                        <th style={thNum}>Qty ({l.uom})</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {l.allocated_cartons.map((c: any) => (
                                        <tr key={c.batch_id} style={{ borderTop: '1px dashed #d0cdc8', background: '#eef6ee' }}>
                                            <td style={td}>
                                                <XPActionButton tone="danger" icon="bi-unlock" title="Release this carton back to stock"
                                                    onClick={() => release(c.reservation_id)} />
                                            </td>
                                            <td style={td}>{cartonNo(c)} <span style={{ color: '#1a5e1a', marginLeft: 4 }}><i className="bi bi-lock-fill"></i> allocated</span></td>
                                            <td style={td}>{c.location || '—'}</td>
                                            <td style={td}>{c.size || '—'}</td>
                                            <td style={td}>{c.packed_at ? new Date(c.packed_at).toLocaleDateString() : '—'}</td>
                                            <td style={tdNum}>{cartonQty(c)}</td>
                                        </tr>
                                    ))}
                                    {reason ? (
                                        <tr><td colSpan={6} style={{ ...td, color: '#999', fontStyle: 'italic' }}>{reason}</td></tr>
                                    ) : l.cartons.map((c: any) => (
                                        <tr key={c.batch_id} onClick={() => toggle(id, c.batch_id)}
                                            style={{ borderTop: '1px dashed #d0cdc8', cursor: 'pointer', background: sel(id).has(c.batch_id) ? '#dce8ff' : undefined }}>
                                            <td style={td}><input type="checkbox" readOnly checked={sel(id).has(c.batch_id)} /></td>
                                            <td style={td}>{cartonNo(c)}</td>
                                            <td style={td}>{c.location || '—'}</td>
                                            <td style={td}>{c.size || '—'}</td>
                                            <td style={td}>{c.packed_at ? new Date(c.packed_at).toLocaleDateString() : '—'}</td>
                                            <td style={tdNum}>{cartonQty(c)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );
                })}
            </div>
        </ModalWrapper>
    );
}
