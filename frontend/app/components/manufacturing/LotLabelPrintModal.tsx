'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { useData } from '../../context/DataContext';
import { useTimezone } from '../../context/TimezoneContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { CODE_FONT, xpFont, PRINT_FONT } from '../shared/xpTheme';

// Code 128 (1D) alongside the QR so old laser scanners can read the lot too.
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
 * Generic lot sticker — one A6 label per Batch (lot). Unlike BagLabelCard (which
 * is tied to a weaving MOCompletion), this prints straight off a Batch row, so it
 * works for any lot: split leftovers, manually-created lots, relabels. The QR +
 * Code 128 both encode the lot number (scannable downstream). Reuses the shared
 * bag-label print stylesheet (A6 portrait, one per page).
 */
export default function LotLabelPrintModal({
    lots,
    heading = 'LABEL LOT / LOT LABEL',
    onClose,
}: {
    lots: any[];
    heading?: string;
    onClose: () => void;
}) {
    const { companyProfile } = useData() as any;
    const { formatCustom: tzFmt } = useTimezone();

    const doPrint = () => {
        window.addEventListener('afterprint', onClose, { once: true });
        window.print();
    };

    const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
    const barcodeUrls = useMemo(() => {
        const map: Record<string, string> = {};
        lots.forEach(l => { map[l.id] = makeBarcodeDataUrl(l.batch_number || String(l.id)); });
        return map;
    }, [lots]);

    useEffect(() => {
        document.body.classList.add('bag-label-print-active');
        return () => { document.body.classList.remove('bag-label-print-active'); };
    }, []);

    useEffect(() => {
        Promise.all(
            lots.map(l => QRCode.toDataURL(l.batch_number || String(l.id), { margin: 4, width: 280, errorCorrectionLevel: 'H' })
                .then(url => [l.id, url] as [string, string])
                .catch(() => [l.id, ''] as [string, string]))
        ).then(entries => setQrUrls(Object.fromEntries(entries)));
    }, [lots]);

    const heroLbl: React.CSSProperties = { fontSize: '8px', color: '#555', fontWeight: 'bold', letterSpacing: '0.5px' };
    const gridLbl: React.CSSProperties = { background: '#f0f0f0', border: '1px solid #bbb', padding: '3px 6px', fontSize: '9px', color: '#333', fontWeight: 'bold', whiteSpace: 'nowrap' };
    const gridVal: React.CSSProperties = { border: '1px solid #bbb', padding: '3px 6px', fontSize: '11px', color: '#000' };

    const renderLabel = (lot: any) => {
        const kg = Number(lot.remaining ?? 0);
        const tgl = lot.created_at
            ? tzFmt(lot.created_at, { day: '2-digit', month: '2-digit', year: 'numeric' }, 'id-ID')
            : tzFmt(new Date(), { day: '2-digit', month: '2-digit', year: 'numeric' }, 'id-ID');
        return (
            <div key={lot.id} className="bag-label-card" style={{ background: '#fff', color: '#000', fontFamily: PRINT_FONT, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontFamily: PRINT_FONT, color: '#000', lineHeight: 1.3, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    {/* Header + QR */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #000', paddingBottom: '5px', marginBottom: '6px', gap: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
                            {companyProfile?.name && <div style={{ fontSize: '10px', fontWeight: 'bold' }}>{companyProfile.name}</div>}
                            <div style={heroLbl}>{heading}</div>
                            <div style={{ fontSize: '8px', color: '#666' }}>{tgl}</div>
                        </div>
                        <div style={{ border: '2px solid #000', padding: '4px', flexShrink: 0, textAlign: 'center' }}>
                            {qrUrls[lot.id]
                                ? <img src={qrUrls[lot.id]} alt="QR" style={{ width: '96px', height: '96px', display: 'block' }} />
                                : <div style={{ width: '96px', height: '96px', background: '#eee' }} />}
                            <div style={{ fontSize: '6px', color: '#555', marginTop: '1px' }}>Scan = Lot</div>
                        </div>
                    </div>

                    {/* Lot number hero */}
                    <div style={{ border: '2px solid #000', padding: '4px 8px', marginBottom: '6px' }}>
                        <div style={heroLbl}>NO. LOT (KANTONG)</div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', lineHeight: 1.05, fontFamily: CODE_FONT, wordBreak: 'break-all' }}>{lot.batch_number || '—'}</div>
                        {barcodeUrls[lot.id] && (
                            <img src={barcodeUrls[lot.id]} alt="barcode" style={{ width: '100%', height: '40px', objectFit: 'contain', display: 'block', marginTop: '3px' }} />
                        )}
                    </div>

                    {/* Weight */}
                    <div style={{ border: '1px solid #999', padding: '3px 8px', marginBottom: '6px' }}>
                        <div style={heroLbl}>BERAT / WEIGHT</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
                            {kg > 0 ? kg.toFixed(2) : '—'}<span style={{ fontSize: '11px', color: '#666', fontWeight: 'normal' }}>{kg > 0 ? ' kg' : ''}</span>
                        </div>
                    </div>

                    {/* Identity grid */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6px' }}>
                        <tbody>
                            <tr>
                                <td style={{ ...gridLbl, width: '26%' }}>Artikel</td>
                                <td style={{ ...gridVal, fontWeight: 'bold' }}>{lot.item_name || '—'}</td>
                            </tr>
                            <tr>
                                <td style={gridLbl}>Kode</td>
                                <td style={{ ...gridVal, fontFamily: CODE_FONT, fontSize: '10px' }}>{lot.item_code || '—'}</td>
                            </tr>
                            <tr>
                                <td style={gridLbl}>Lokasi</td>
                                <td style={gridVal}>{lot.location_name || '—'}</td>
                            </tr>
                            {lot.notes && (
                                <tr>
                                    <td style={gridLbl}>Catatan</td>
                                    <td style={{ ...gridVal, fontSize: '9px' }}>{lot.notes}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>

                    <div style={{ flexGrow: 1, minHeight: '4px' }} />

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid #ccc', paddingTop: '6px' }}>
                        <div style={{ fontSize: '6px', color: '#999', lineHeight: 1.3 }}>Lot ID: {lot.id}</div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ borderBottom: '1px solid #000', height: '22px', width: '90px', marginBottom: '2px' }} />
                            <div style={{ fontSize: '8px', fontWeight: 'bold' }}>PARAF</div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            <PrintModalShell
                title={`Print Lot Label — ${lots.length} ${lots.length === 1 ? 'lot' : 'lots'}`}
                onClose={onClose}
                width="calc(var(--app-vw) * 90 / 100)"
                maxWidth={880}
                height="calc(var(--app-vh) * 88 / 100)"
                modeless
            >
                <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                    {lots.length === 0 && (
                        <div style={{ color: '#555', fontSize: '12px', marginTop: '40px', fontFamily: xpFont }}>No lots to label.</div>
                    )}
                    {lots.map(lot => (
                        <div key={lot.id} className="bag-label-paper" style={{ background: '#fff', width: '378px', minHeight: '535px', padding: '18px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
                            {renderLabel(lot)}
                        </div>
                    ))}
                </div>

                <PrintModalFooter onClose={onClose} onPrint={doPrint} printDisabled={!lots.length} />
            </PrintModalShell>

            {createPortal(
                <div className="bag-label-print-portal" style={{ display: 'none' }}>
                    {lots.map(lot => renderLabel(lot))}
                </div>,
                document.body
            )}
        </>
    );
}
