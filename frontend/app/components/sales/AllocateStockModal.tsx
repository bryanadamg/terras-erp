'use client';

import { useEffect, useState } from 'react';
import ModalWrapper from '../shared/ModalWrapper';
import { useToast } from '../shared/Toast';
import { xpBtn, xpInput, XP_BTN, BTN_TONES, CODE_FONT, xpFont, CodeChip, VariantChip } from '../shared/xpTheme';
import { qtyFmt } from '../shared/format';
import { API_BASE } from '../shared/apiBase';

// "Allocate from stock": reserve on-hand finished goods straight to this order's
// lines instead of producing them. The server writes the same StockReservation
// rows Production Run netting writes, so a PR made for this order afterwards
// plans only what is left, and the stock ships through Packing / Pick List /
// Shipment as usual.
export default function AllocateStockModal({ so, authFetch, onClose, onDone }: {
    so: any;
    authFetch: (url: string, init?: RequestInit) => Promise<Response>;
    onClose: () => void;
    onDone: () => void;
}) {
    const { showToast } = useToast();
    const [lines, setLines] = useState<any[] | null>(null);
    const [qty, setQty] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);

    const load = (rows: any[]) => {
        setLines(rows);
        setQty(Object.fromEntries(rows.map(l => [l.sales_order_line_id, l.suggested > 0 ? String(+l.suggested.toFixed(4)) : ''])));
    };

    useEffect(() => {
        authFetch(`${API_BASE}/sales-orders/${so.id}/allocation`)
            .then(r => (r.ok ? r.json() : Promise.reject()))
            .then(load)
            .catch(() => { showToast('Could not load stock for this order', 'danger'); onClose(); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [so.id]);

    const picked = (lines || [])
        .map(l => ({ sales_order_line_id: l.sales_order_line_id, qty: parseFloat(qty[l.sales_order_line_id] || '') || 0 }))
        .filter(l => l.qty > 0);

    const submit = async () => {
        setSaving(true);
        try {
            const res = await authFetch(`${API_BASE}/sales-orders/${so.id}/allocate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: picked }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || 'Allocation failed', 'danger');
                return;
            }
            showToast('Stock allocated to this order', 'success');
            onDone();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    const th: React.CSSProperties = { padding: '3px 8px', fontSize: '0.66rem', fontWeight: 'bold', color: '#555', textAlign: 'left', borderBottom: '1px solid #b8c4de', whiteSpace: 'nowrap' };
    const thNum: React.CSSProperties = { ...th, textAlign: 'right' };
    const td: React.CSSProperties = { padding: '3px 8px', fontSize: '0.7rem' };
    const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: CODE_FONT, whiteSpace: 'nowrap' };

    return (
        <ModalWrapper
            isOpen
            onClose={onClose}
            title={<><i className="bi bi-box-seam me-2"></i>Allocate from stock — {so.po_number}</>}
            size="xl"
            modeless
            footer={<>
                <button className={XP_BTN} style={xpBtn()} onClick={onClose}>Cancel</button>
                <button className={XP_BTN} disabled={saving || picked.length === 0}
                    style={saving || picked.length === 0 ? { ...xpBtn(), opacity: 0.5 } : xpBtn({ ...BTN_TONES.primary, padding: '2px 16px' })}
                    onClick={submit}>
                    <i className="bi bi-lock" style={{ marginRight: 4 }}></i>Allocate
                </button>
            </>}
        >
            <div style={{ fontFamily: xpFont, fontSize: 12 }}>
                <p style={{ color: '#666', fontSize: '0.72rem', marginBottom: 8 }}>
                    Reserves finished goods already on hand to this order — nothing is produced for it.
                    Ship it through Packing → Pick List → Shipment as usual; a Production Run created for
                    this order afterwards only plans what is left. Free stock counts every location and
                    excludes stock other orders or open MOs already claim.
                </p>
                {!lines ? <p className="text-muted">Loading…</p> : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #b8c4de' }}>
                        <thead>
                            <tr style={{ background: '#f1f0eb' }}>
                                <th style={th}>Item</th>
                                <th style={thNum}>Ordered</th>
                                <th style={thNum}>Shipped</th>
                                <th style={thNum}>Allocated</th>
                                <th style={thNum}>Still needed</th>
                                <th style={thNum}>Free in stock</th>
                                <th style={thNum}>Allocate now</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map(l => {
                                const id = l.sales_order_line_id;
                                const max = Math.min(l.needed, l.free);
                                const blocked = l.ordered === null ? 'Item has no weight per unit — ordered qty unknown'
                                    : l.needed <= 0 ? 'Nothing left to cover'
                                    : l.free <= 0 ? 'No free stock' : null;
                                return (
                                    <tr key={id} style={{ borderTop: '1px dashed #d0cdc8' }}>
                                        <td style={td}>
                                            <div style={{ fontWeight: 600 }}>{l.item_name}</div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                                                <CodeChip code={l.item_code} tier={2} />
                                                {l.size && <VariantChip kind="size">{String(l.size).toUpperCase()}</VariantChip>}
                                                {l.color && <VariantChip kind="color">{l.color}</VariantChip>}
                                            </div>
                                        </td>
                                        <td style={tdNum}>{l.ordered === null ? '—' : `${qtyFmt(2)(l.ordered)} ${l.uom}`}</td>
                                        <td style={{ ...tdNum, color: '#777' }}>{qtyFmt(2)(l.dispatched)}</td>
                                        <td style={{ ...tdNum, color: '#777' }}>{qtyFmt(2)(l.allocated)}</td>
                                        <td style={{ ...tdNum, fontWeight: 700 }}>{qtyFmt(2)(l.needed)}</td>
                                        <td style={{ ...tdNum, color: l.free > 0 ? '#1a5e1a' : '#999' }}>{qtyFmt(2)(l.free)}</td>
                                        <td style={{ ...tdNum, width: 130 }}>
                                            {blocked ? <span style={{ color: '#999', fontFamily: xpFont }}>{blocked}</span> : (
                                                <input type="number" min={0} max={max} step="any"
                                                    value={qty[id] ?? ''}
                                                    onChange={e => setQty(q => ({ ...q, [id]: e.target.value }))}
                                                    style={xpInput({ width: 100, textAlign: 'right' })} />
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </ModalWrapper>
    );
}
