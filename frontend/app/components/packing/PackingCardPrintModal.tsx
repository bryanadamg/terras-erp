'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { useTimezone } from '../../context/TimezoneContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { PRINT_FONT, PRINT_SERIF_FONT } from '../shared/xpTheme';
import { orderBasePerAlt, baseToAlt, uomIsKg } from '../shared/altUnit';
import { orderBoxSizeAlt } from '../shared/packingBoxes';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace(/\/api$/, '') + '/api';

/**
 * Packing order shop card — the floor document for a packing order, in the same
 * spirit as the Kartu Kerja: header facts, a materials checklist, and a QR the
 * packer scans to log cartons.
 *
 * The QR encodes the packing order CODE (PCK-…), not the carton — a carton does
 * not exist until the packer logs it. Carton QRs live on the A6 labels printed
 * by PackedUnitLabelPrintModal.
 */
export default function PackingCardPrintModal({ po, attributes, companyProfile, authFetch, onClose }: any) {
    // Base qty per alt selling unit (Pic = a roll, Pcs = a cut piece), and the
    // count a base figure works out to. Null when the order has no alt unit.
    const altBaseFactor = orderBasePerAlt(po);
    const altCount = (base: any) => {
        const c = altBaseFactor ? baseToAlt(Number(base || 0), altBaseFactor) : null;
        return c ? c.toLocaleString() : '';
    };
    // Pieces per carton — the stated count where there is one, the stored weight
    // divided back out for an order made before it was stored.
    const boxSizeAlt = po.uom2 ? orderBoxSizeAlt(po, altBaseFactor) : null;
    const { formatCustom: tzFmt } = useTimezone();
    const [qrUrl, setQrUrl] = useState('');

    useEffect(() => {
        document.body.classList.add('so-print-preview-active');
        return () => { document.body.classList.remove('so-print-preview-active'); };
    }, []);

    useEffect(() => {
        QRCode.toDataURL(po.code, { margin: 4, width: 260, errorCorrectionLevel: 'H' })
            .then(setQrUrl)
            .catch(() => setQrUrl(''));
    }, [po.code]);

    const doPrint = () => {
        // Stamp card_printed_at so the list can flag orders whose card was never
        // issued to the floor. Fire-and-forget: a failed stamp must not block print.
        try { authFetch?.(`${API_BASE}/packing/${po.id}/card-printed`, { method: 'POST' }).catch(() => {}); } catch { /* noop */ }
        window.addEventListener('afterprint', onClose, { once: true });
        window.print();
    };

    const attrName = (vid: string) => {
        for (const attr of (attributes || [])) { const v = attr.values?.find((x: any) => x.id === vid); if (v) return v.value; }
        return '';
    };
    const fmt = (d: any) => { if (!d) return ''; try { return tzFmt(d, { day: '2-digit', month: '2-digit', year: 'numeric' }, 'en-GB').replace(/\//g, '.'); } catch { return ''; } };

    const border = '1px solid #555';
    const cell: React.CSSProperties = { border, padding: '3px 5px', verticalAlign: 'top' };
    const hCell: React.CSSProperties = { ...cell, background: '#f0f0f0', fontWeight: 'bold', textAlign: 'center' };
    const gridLbl: React.CSSProperties = { fontWeight: 'bold', paddingRight: 6, whiteSpace: 'nowrap', verticalAlign: 'top' };

    const doc = (
        <div style={{ fontFamily: PRINT_FONT, fontSize: '10px', color: '#000', lineHeight: 1.45 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 6, borderBottom: '2px solid #000' }}>
                <div>
                    <div style={{ fontWeight: 'bold', fontSize: 12 }}>{companyProfile?.name || 'PT. BOLA INTAN ELASTIC'}</div>
                    <div style={{ fontSize: 15, fontWeight: 'bold', fontFamily: PRINT_SERIF_FONT, marginTop: 2 }}>KARTU PACKING</div>
                    <div style={{ fontSize: 9, color: '#555' }}>Packing Order Card</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                    {qrUrl && <img src={qrUrl} alt="QR" style={{ width: 96, height: 96 }} />}
                    <div style={{ fontWeight: 'bold', fontSize: 12, letterSpacing: 1 }}>{po.code}</div>
                </div>
            </div>

            <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 10 }}>
                <tbody>
                    {([
                        ['Barang / Item', `${po.item_name || ''} (${po.item_code || ''})`],
                        ['Warna / Colour', po.color_name || '—'],
                        ['Varian', (po.attribute_value_ids || []).map(attrName).filter(Boolean).join(', ') || '—'],
                        // Both units on the card: the packer counts in the selling unit
                        // the order was taken in, while stock moves in the item's own.
                        ['Target', [
                            `${Number(po.qty_target || 0).toLocaleString()} ${po.item_uom || ''}`,
                            altCount(po.qty_target) ? `(${altCount(po.qty_target)} ${po.uom2})` : '',
                        ].filter(Boolean).join(' ')],
                        // The count leads here, unlike Target above: this is the
                        // instruction the packer follows box by box, and it is a count
                        // of pieces — the kilos are what they weigh in theory, which
                        // the scale then contradicts on every box.
                        ['Isi per koli', boxSizeAlt
                            ? `${boxSizeAlt.toLocaleString()} ${po.uom2}`
                              + (po.pack_size ? ` (± ${Number(po.pack_size).toLocaleString()} ${po.item_uom || ''})` : '')
                            : (po.pack_size ? `${Number(po.pack_size).toLocaleString()} ${po.item_uom || ''}` : '—')],
                        // Which g/y the kilos on this card were worked out from.
                        // The order's own sampling of THIS cloth when it has one
                        // (`order_weight_spec`); otherwise the item master's
                        // development estimate, said out loud so the floor knows
                        // the weights are theoretical.
                        ...(uomIsKg(po.item_uom) && po.uom2 ? [[
                            'Berat contoh', po.sample_weight_per_unit != null
                                ? `${Number(po.sample_weight_per_unit).toLocaleString()} ${po.sample_weight_unit || 'g/y'} (contoh order ini)`
                                : '— (estimasi master barang)',
                        ]] as [string, string][] : []),
                        ['Satuan jual', po.uom2
                            ? `1 ${po.uom2} = ${Number(po.uom2_factor || 0)} ${po.uom2_length_uom || 'Yard'}`
                              + (altBaseFactor ? ` = ${altBaseFactor} ${po.item_uom || ''}` : '')
                            : '—'],
                        ['Jenis kemasan', po.package_label || 'Carton'],
                        ['Mesin / Machine', po.work_center_name || '—'],
                        ['No. SO', po.sales_order_code || '— (pack to stock)'],
                        ['Pelanggan', po.customer_name || '—'],
                        ['Target selesai', fmt(po.target_end_date) || '—'],
                    ] as [string, string][]).map(([k, v]) => (
                        <tr key={k}>
                            <td style={gridLbl}>{k}</td>
                            <td>: {v}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {(po.materials || []).length > 0 && (
                <>
                    <div style={{ fontWeight: 'bold', marginBottom: 3 }}>Bahan Kemasan / Packaging Materials:</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
                        <thead>
                            <tr>
                                <th style={{ ...hCell, width: '8%' }}>No</th>
                                <th style={{ ...hCell, width: '52%', textAlign: 'left' }}>Bahan / Material</th>
                                <th style={{ ...hCell, width: '20%' }}>Rencana</th>
                                <th style={{ ...hCell, width: '20%' }}>Dipakai</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(po.materials || []).map((m: any, i: number) => (
                                <tr key={m.id || i}>
                                    <td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td>
                                    <td style={cell}>{m.item_name || m.item_id} <span style={{ color: '#777' }}>{m.item_code}</span></td>
                                    <td style={{ ...cell, textAlign: 'right' }}>{Number(m.qty_planned || 0).toLocaleString()} {m.item_uom}</td>
                                    <td style={cell} />
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}

            {/* Blank tally grid the packer fills in by hand, then keys against the QR */}
            <div style={{ fontWeight: 'bold', marginBottom: 3 }}>Catatan Packing / Packing Log:</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
                <thead>
                    <tr>
                        <th style={{ ...hCell, width: '20%' }}>Tanggal</th>
                        <th style={{ ...hCell, width: '20%' }}>Qty</th>
                        <th style={{ ...hCell, width: '20%' }}>Jml Koli</th>
                        <th style={{ ...hCell, width: '20%' }}>Lot Asal</th>
                        <th style={{ ...hCell, width: '20%' }}>Operator</th>
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i}>
                            {Array.from({ length: 5 }).map((__, j) => <td key={j} style={{ ...cell, height: 18 }} />)}
                        </tr>
                    ))}
                </tbody>
            </table>

            {po.notes && <div style={{ marginBottom: 8 }}><strong>Catatan / Notes:</strong> {po.notes}</div>}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, textAlign: 'center' }}>
                {['Dibuat oleh / Issued by', 'Packer', 'Diperiksa / Checked by'].map((role, i) => (
                    <div key={i} style={{ width: '30%' }}>
                        <div>{role}</div>
                        <div style={{ height: 40 }} />
                        <div style={{ borderTop: '1px solid #000', paddingTop: 2 }}>(________________)</div>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <>
            <PrintModalShell title={`Kartu Packing — ${po.code}`} onClose={onClose} width="calc(var(--app-vw) * 92 / 100)" maxWidth={900} height="calc(var(--app-vh) * 90 / 100)" modeless>
                <div style={{ flex: 1, background: '#808080', overflowY: 'auto', padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                    <div className="so-print-paper" style={{ background: '#fff', width: '100%', maxWidth: 680, padding: '20px 24px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)' }}>
                        {doc}
                    </div>
                </div>
                <PrintModalFooter onClose={onClose} onPrint={doPrint} />
            </PrintModalShell>

            {createPortal(
                <div className="so-print-paper-portal" style={{ position: 'fixed', left: '-9999px', top: 0 }}>
                    <div className="so-print-paper" style={{ background: '#fff', width: '100%', padding: '20px 24px' }}>{doc}</div>
                </div>,
                document.body
            )}
        </>
    );
}
