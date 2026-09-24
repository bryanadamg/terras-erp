'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { useTimezone } from '../../context/TimezoneContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { xpFont, PRINT_FONT } from '../shared/xpTheme';
import { orderBasePerAlt, baseToAlt, lengthPerAlt } from '../shared/altUnit';
import { lotSizeLabel, lotComboLabel, lotColorLabel } from '../shared/LotChips';
import { API_BASE } from '../shared/apiBase';

// Code 128 (1D) alongside the QR so the factory's existing laser scanners can
// read the carton number too — same payload as the QR, matching the bag label.
function makeBarcodeDataUrl(text: string): string {
    if (!text) return '';
    try {
        const canvas = document.createElement('canvas');
        JsBarcode(canvas, text, { format: 'CODE128', displayValue: false, margin: 0, height: 70, width: 2 });
        return canvas.toDataURL('image/png');
    } catch {
        return '';
    }
}


/**
 * Carton label — one A6 sticker per PackedUnit, laid out to match the customer-
 * facing BIE sticker: a headline of style + colour, then a CONTENT / PO. NO /
 * LOT. NO / N.W. grid with a Code 128 barcode against every line so the
 * customer's goods-in can scan any field directly off the box.
 *
 * The PU- QR is kept (small, bottom-right) because that is what our own picker
 * scans onto a pick list — the barcodes are for the receiving end, the QR for us.
 *
 * Field sources, none of them re-entered on this screen:
 *   CONTENT  the carton's own `alt_qty` — the count the packer put in the box, in
 *            the order's `uom2` — with the base qty in brackets, and the length
 *            those pieces make up when the factor says so; `ket_stock` rides
 *            underneath. Read off the carton rather than divided out of its qty:
 *            for a kg item that qty is the scale reading, and 10.62 kg over
 *            0.9 kg/Pcs prints 11.8 pieces for a box holding 12. Cartons packed
 *            before the count was recorded still fall back to that division.
 *   HEADLINE style code + the CARTON's own shade, not the order's: shade travels
 *            in the carton's stock key and is resolved onto it by the API, so a
 *            label can never claim a colour the box isn't. Size and combo (and any
 *            other variant attribute) print on the line beneath — size is stamped
 *            on the carton itself at packing, off the lot it was packed from.
 *   PO. NO   the customer's own `customer_po_ref`, our SO number under it.
 *   LOT. NO  the source lot this carton was packed from (via its completion).
 *   G W      `Batch.gross_weight_kg` — net plus the empty box, both snapshotted on
 *            the carton at pack time. The carrier bills on this figure and the
 *            Surat Jalan totals it, so it prints beside the net rather than
 *            instead of it. Blank on a carton packed before packaging was
 *            recorded — an unknown tare must read as unknown, not as zero.
 *   N W      `Batch.weight_kg` — the packer's scale reading at pack time. For a
 *            kg-based item there is nothing separate to read: the carton qty is
 *            that weight, so the server derives it and this line matches the base
 *            qty in CONTENT. They differ only when CONTENT is a count (pieces),
 *            where N.W. is what those pieces weigh.
 *
 * Reuses the bag-label print CSS (`bag-label-*` in globals.css): same A6
 * one-per-sheet geometry, so there is no second set of print rules to keep in
 * sync with it.
 */
export default function PackedUnitLabelPrintModal({
    po,
    units,
    companyProfile,
    onClose,
}: {
    po: any;
    units: any[];
    companyProfile?: any;
    onClose: () => void;
}) {
    const { formatCustom: tzFmt } = useTimezone();

    const [qrUrls, setQrUrls] = useState<Record<string, string>>({});

    // Source lot per carton: the completion that minted it carries the lot it
    // drew from, so no extra field is needed on the carton itself.
    const lotByCompletion = useMemo(() => {
        const m: Record<string, string> = {};
        (po.completions || []).forEach((c: any) => {
            if (c.source_batch_number) m[String(c.id)] = c.source_batch_number;
        });
        return m;
    }, [po.completions]);

    const lotOf = (u: any) => lotByCompletion[String(u.packing_completion_id || '')] || '';

    // Shade of the CARTON, falling back to the order's. The API resolves a
    // carton's shade off the stock key it was minted under, so it is the one
    // figure that cannot disagree with what is physically in the box; the order
    // is the fallback for cartons packed before that was served.
    const shadeOf = (u: any) => lotColorLabel(u)?.label || po.color_name || null;

    // Size / combo / any other variant attribute, one compact line. Size comes off
    // the carton's own Batch row (stamped at packing from the source lot); the rest
    // off its stock key. Shade is excluded — it is already in the headline.
    const identityOf = (u: any) => [
        lotSizeLabel(u),
        lotComboLabel(u),
        ...((u.variant_attributes || []) as any[])
            .filter(a => !['combo', 'color', 'labdip_color'].includes(a.system_role || ''))
            .map(a => a.value),
    ].filter(Boolean).join('  ·  ');

    // Count in a carton. The packer's own figure wins; `baseToAlt` only covers
    // cartons minted before that was recorded (and snaps a scale reading back to a
    // whole count). No alt unit on the order -> CONTENT prints base qty only.
    const baseFactor = orderBasePerAlt(po);
    const piecesOf = (u: any) => {
        if (u.alt_qty != null) return Number(u.alt_qty);
        return baseFactor ? baseToAlt(Number(u.qty || 0), baseFactor) : null;
    };
    // Length one alt unit spans ('50 Yd'), for the bracketed CONTENT total.
    const altLength = lengthPerAlt({ factor: po.uom2_factor, lengthUom: po.uom2_length_uom });

    // One barcode per printed field, keyed by carton. Built once per unit list —
    // JsBarcode renders to a canvas, which is far too slow to redo on every paint.
    const barcodeUrls = useMemo(() => {
        const map: Record<string, Record<string, string>> = {};
        units.forEach(u => {
            const pcs = piecesOf(u);
            map[u.id] = {
                unit: makeBarcodeDataUrl(u.batch_number || String(u.id)),
                content: makeBarcodeDataUrl(
                    pcs !== null ? `${pcs.toFixed(1)}` : String(Number(u.qty || 0).toFixed(2))
                ),
                po: makeBarcodeDataUrl(po.customer_po_ref || po.sales_order_code || ''),
                lot: makeBarcodeDataUrl(lotByCompletion[String(u.packing_completion_id || '')] || ''),
                nw: makeBarcodeDataUrl(u.weight_kg != null ? String(u.weight_kg) : ''),
                gw: makeBarcodeDataUrl(u.gross_weight_kg != null ? String(u.gross_weight_kg) : ''),
            };
        });
        return map;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [units, baseFactor, po.customer_po_ref, po.sales_order_code, lotByCompletion]);

    useEffect(() => {
        document.body.classList.add('bag-label-print-active');
        return () => { document.body.classList.remove('bag-label-print-active'); };
    }, []);

    useEffect(() => {
        Promise.all(
            units.map(u => {
                const payload = u.batch_number || String(u.id);
                return QRCode.toDataURL(payload, { margin: 4, width: 280, errorCorrectionLevel: 'H' })
                    .then(url => [u.id, url] as [string, string])
                    .catch(() => [u.id, ''] as [string, string]);
            })
        ).then(entries => setQrUrls(Object.fromEntries(entries)));
    }, [units]);

    const doPrint = () => {
        window.addEventListener('afterprint', onClose, { once: true });
        window.print();
    };

    const cell: React.CSSProperties = { border: '1px solid #000', padding: '4px 6px', verticalAlign: 'middle' };
    const lblCell: React.CSSProperties = { ...cell, fontSize: 11, fontWeight: 'bold', letterSpacing: 0.5, whiteSpace: 'nowrap', width: 74 };
    const valCell: React.CSSProperties = { ...cell, fontSize: 13, fontWeight: 'bold' };
    const barCell: React.CSSProperties = { ...cell, width: 96, padding: '2px 4px' };

    const renderLabel = (u: any) => {
        const bc = barcodeUrls[u.id] || {};
        const pcs = piecesOf(u);
        const qty = Number(u.qty || 0);
        // "12 Pic ( 600 Yd / 10.62 KG )" — pieces lead because that is what the
        // receiving side counts. The bracket carries the length those pieces make
        // up (when the order states a per-unit length) and the measured base qty,
        // which for a kg item is the weighed figure.
        const bracket = [
            pcs !== null && altLength
                ? `${(pcs * altLength.qty).toLocaleString()}  ${altLength.uom}`
                : null,
            `${qty.toLocaleString()}  ${po.item_uom || ''}`.trim(),
        ].filter(Boolean).join('  /  ');
        const content = pcs !== null
            ? `${Number(pcs.toFixed(2)).toLocaleString()}  ${po.uom2 || 'Pcs'}   ( ${bracket} )`
            : `${qty.toLocaleString()}  ${po.item_uom || ''}`;
        const barRow = (src?: string) => (
            <td style={barCell}>
                {src ? <img src={src} alt="" style={{ width: '100%', height: 26, objectFit: 'fill', display: 'block' }} /> : null}
            </td>
        );

        return (
            <div key={u.id} className="bag-label-card" style={{ background: '#fff', color: '#000', fontFamily: PRINT_FONT, display: 'flex', flexDirection: 'column' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <tbody>
                        {/* Headline: house mark + style/colour, with the carton's own
                            PU- number barcoded beside it. */}
                        <tr>
                            <td style={{ ...cell, width: 74, textAlign: 'center' }}>
                                {companyProfile?.logo_url
                                    ? <img src={`${API_BASE}${companyProfile.logo_url}`} alt="" style={{ maxHeight: 30, maxWidth: 60, objectFit: 'contain' }} />
                                    : <div style={{ fontSize: 16, fontWeight: 'bold', letterSpacing: 2 }}>BIE</div>}
                            </td>
                            <td style={{ ...cell, padding: '4px 8px' }}>
                                <div style={{ fontSize: 19, fontWeight: 'bold', lineHeight: 1.1, letterSpacing: 0.5 }}>
                                    {[u.item_code || po.item_code, shadeOf(u)].filter(Boolean).join(' ') || u.item_name || po.item_name || ''}
                                </div>
                                {identityOf(u) && (
                                    <div style={{ fontSize: 10, fontWeight: 'bold', marginTop: 2, letterSpacing: 0.5 }}>{identityOf(u)}</div>
                                )}
                                <div style={{ fontSize: 10, marginTop: 2, letterSpacing: 0.5 }}>~{u.batch_number}</div>
                            </td>
                            {barRow(bc.unit)}
                        </tr>

                        <tr>
                            <td style={lblCell}>CONTENT</td>
                            <td style={valCell}>
                                {content}
                                {po.ket_stock && <div style={{ fontSize: 10, fontWeight: 'normal', marginTop: 1 }}>{po.ket_stock}</div>}
                            </td>
                            {barRow(bc.content)}
                        </tr>

                        <tr>
                            <td style={lblCell}>PO. NO</td>
                            <td style={valCell}>
                                {po.customer_po_ref || po.sales_order_code || '—'}
                                {/* Our own SO number stays under the customer's reference:
                                    the customer reads the top line, we reconcile on the bottom. */}
                                {po.customer_po_ref && po.sales_order_code && (
                                    <div style={{ fontSize: 9, fontWeight: 'normal', color: '#333', marginTop: 1 }}>{po.sales_order_code}</div>
                                )}
                            </td>
                            {barRow(bc.po)}
                        </tr>

                        <tr>
                            <td style={lblCell}>LOT. NO</td>
                            <td style={valCell}>{lotOf(u) || '—'}</td>
                            {barRow(bc.lot)}
                        </tr>

                        <tr>
                            <td style={lblCell}>N W</td>
                            <td style={valCell}>
                                {u.weight_kg != null
                                    ? `${Number(u.weight_kg).toFixed(2)}  KG`
                                    : <span style={{ fontWeight: 'normal', color: '#666' }}>__________ KG</span>}
                            </td>
                            {barRow(bc.nw)}
                        </tr>

                        <tr>
                            <td style={lblCell}>G W</td>
                            <td style={valCell}>
                                {u.gross_weight_kg != null
                                    ? `${Number(u.gross_weight_kg).toFixed(2)}  KG`
                                    : <span style={{ fontWeight: 'normal', color: '#666' }}>__________ KG</span>}
                                {/* Which box that tare came from, small beside the figure —
                                    the receiving end reconciles brutto against the box type,
                                    and reprinting an old carton must show the box it was
                                    actually packed in, not today's master. */}
                                {u.packaging_type_name && (
                                    <span style={{ fontSize: 8, fontWeight: 'normal', color: '#555', marginLeft: 4 }}>
                                        ({u.packaging_type_name})
                                    </span>
                                )}
                            </td>
                            {barRow(bc.gw)}
                        </tr>
                    </tbody>
                </table>

                {/* Our handle, not the customer's: the picker scans this onto a pick
                    list. Small and out of the way of the barcode column. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 6 }}>
                    <div style={{ fontSize: 9, color: '#333' }}>
                        <div>{companyProfile?.name || 'PT. BOLA INTAN ELASTIC'}</div>
                        <div>{po.code} · {(po.package_label || 'Carton').toUpperCase()} #{u.package_no ?? '—'}</div>
                        <div>{u.created_at ? tzFmt(u.created_at, { day: '2-digit', month: '2-digit', year: 'numeric' }, 'id-ID') : ''}</div>
                    </div>
                    {qrUrls[u.id] && <img src={qrUrls[u.id]} alt="QR" style={{ width: 72, height: 72 }} />}
                </div>
            </div>
        );
    };

    return (
        <>
            <PrintModalShell
                title={`Print Carton Labels — ${units.length} ${units.length === 1 ? 'carton' : 'cartons'} (${po.code})`}
                onClose={onClose}
                width="calc(var(--app-vw) * 90 / 100)"
                maxWidth={880}
                height="calc(var(--app-vh) * 88 / 100)"
                modeless
            >
                <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                    {units.length === 0 && (
                        <div style={{ color: '#555', fontSize: '12px', marginTop: '40px', fontFamily: xpFont }}>
                            No cartons packed yet. Log a packing event first.
                        </div>
                    )}
                    {units.map(u => (
                        <div key={u.id} className="bag-label-paper" style={{ background: '#fff', width: '378px', minHeight: '535px', padding: '18px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
                            {renderLabel(u)}
                        </div>
                    ))}
                </div>

                <PrintModalFooter onClose={onClose} onPrint={doPrint} printDisabled={!units.length} />
            </PrintModalShell>

            {createPortal(
                <div className="bag-label-print-portal" style={{ display: 'none' }}>
                    {units.map(u => renderLabel(u))}
                </div>,
                document.body
            )}
        </>
    );
}
