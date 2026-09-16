'use client';
import React from 'react';
import { useTimezone } from '../../context/TimezoneContext';
import { CODE_FONT, PRINT_FONT } from '../shared/xpTheme';
import LabelComponentsBand from './LabelComponentsBand';

/**
 * Bag output label — one physical sticker per bag produced at a WEAVING WO.
 * Each bag = one MOCompletion, so this renders per-completion: the completion's
 * output lot number IS the bag identity, qty_completed is the weighed kg.
 * The QR encodes the bag's LOT number (scannable downstream for consumption),
 * NOT the WO id. Printed by ./BagLabelPrintModal, one label per A6 sheet.
 */
export default function BagLabelCard({
    completion,
    workOrder,
    parentMO,
    qrDataUrl,
    barcodeDataUrl,
    bagSeq,
    companyName,
    attributes = [],
    lotRemaining,
}: {
    completion: any;
    workOrder: any;
    parentMO: any;
    qrDataUrl: string;
    barcodeDataUrl?: string;
    bagSeq: number;
    companyName?: string;
    attributes?: any[];
    lotRemaining?: number | null;
}) {
    const { formatCustom: tzFmt } = useTimezone();
    const bom = parentMO?.bom;
    const lotNo = completion?.output_batch_number || '—';
    // BERAT is the lot's CURRENT weight, not the weight it was born with:
    // `qty_completed` is frozen at the completion, so a bag that was split
    // (or partly staged) kept printing its pre-split kg on every reprint.
    // `lotRemaining` is the live StockBalance sum resolved by BagLabelPrintModal;
    // fall back to the completion only when the lot could not be resolved.
    const berat = Number(lotRemaining ?? completion?.qty_completed ?? 0);

    // WARNA — resolve the system Colors attribute value carried by the MO.
    const colorAttr = (attributes || []).find((a: any) => (a.system_role || '').toLowerCase() === 'color');
    const moValueIds: string[] = parentMO?.attribute_value_ids || [];
    const colorValue = colorAttr?.values?.find((v: any) => moValueIds.includes(v.id));
    const colorName = colorValue?.value || null;

    const lebar = bom?.mesin_lebar;
    // CATATAN — the operator's remark from the completion that produced this bag.
    // Prefer the lot's own copy (already clean); fall back to the completion note with
    // the machine-appended "[Greige GRG-…]" brackets stripped, so lots produced before
    // the note was carried onto the batch still print theirs.
    const rawNote: string = completion?.output_batch_notes || completion?.notes || '';
    const catatan = rawNote.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim() || null;
    const rak = parentMO?.planned_putaway_location_name || null;
    const operator = completion?.operator_name || null;
    const mesin = completion?.work_center_name || workOrder?.work_center_name || null;
    const tgl = completion?.created_at
        ? tzFmt(completion.created_at, { day: '2-digit', month: '2-digit', year: 'numeric' }, 'id-ID')
        : tzFmt(new Date(), { day: '2-digit', month: '2-digit', year: 'numeric' }, 'id-ID');

    const gridLbl: React.CSSProperties = { background: '#f0f0f0', border: '1px solid #bbb', padding: '3px 6px', fontSize: '9px', color: '#333', fontWeight: 'bold', whiteSpace: 'nowrap' };
    const gridVal: React.CSSProperties = { border: '1px solid #bbb', padding: '3px 6px', fontSize: '11px', color: '#000' };
    const heroLbl: React.CSSProperties = { fontSize: '8px', color: '#555', fontWeight: 'bold', letterSpacing: '0.5px' };

    return (
        <div style={{ fontFamily: PRINT_FONT, color: '#000', lineHeight: 1.3, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

            {/* Header: identity + QR(lot) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #000', paddingBottom: '5px', marginBottom: '6px', gap: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
                    {companyName && <div style={{ fontSize: '10px', fontWeight: 'bold' }}>{companyName}</div>}
                    <div style={heroLbl}>LABEL KANTONG / BAG LABEL</div>
                    <div style={{ fontSize: '8px', color: '#666' }}>{tgl}</div>
                </div>
                <div style={{ border: '2px solid #000', padding: '4px', flexShrink: 0, textAlign: 'center' }}>
                    {qrDataUrl
                        ? <img src={qrDataUrl} alt="QR" style={{ width: '96px', height: '96px', display: 'block' }} />
                        : <div style={{ width: '96px', height: '96px', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', color: '#888' }}>...</div>
                    }
                    <div style={{ fontSize: '6px', color: '#555', marginTop: '1px' }}>Scan = Lot</div>
                </div>
            </div>

            {/* Lot number hero — the bag's unique identity. QR (2D) + Code 128 (1D)
                so both phone/imager and old laser scanners can read the lot. */}
            <div style={{ border: '2px solid #000', padding: '4px 8px', marginBottom: '6px' }}>
                <div style={heroLbl}>NO. LOT (KANTONG)</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', lineHeight: 1.05, fontFamily: CODE_FONT, wordBreak: 'break-all' }}>{lotNo}</div>
                {barcodeDataUrl && (
                    <img src={barcodeDataUrl} alt={`barcode ${lotNo}`} style={{ width: '100%', height: '40px', objectFit: 'contain', display: 'block', marginTop: '3px' }} />
                )}
            </div>

            {/* Berat + Bag sequence hero */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <div style={{ flex: 2, border: '1px solid #999', padding: '3px 8px' }}>
                    <div style={heroLbl}>BERAT / WEIGHT</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
                        {berat > 0 ? berat.toFixed(2) : '—'}<span style={{ fontSize: '11px', color: '#666', fontWeight: 'normal' }}>{berat > 0 ? ' kg' : ''}</span>
                    </div>
                </div>
                <div style={{ flex: 1, border: '1px solid #999', padding: '3px 8px', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={heroLbl}>KANTONG</div>
                    <div style={{ fontSize: '22px', fontWeight: 'bold' }}>#{bagSeq}</div>
                </div>
            </div>

            {/* Identity grid */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6px' }}>
                <tbody>
                    <tr>
                        <td style={{ ...gridLbl, width: '24%' }}>Artikel</td>
                        <td colSpan={3} style={{ ...gridVal, fontWeight: 'bold' }}>{parentMO?.item_name || workOrder?.item_name || '—'}</td>
                    </tr>
                    <tr>
                        <td style={{ ...gridLbl, width: '24%' }}>Warna</td>
                        <td style={{ ...gridVal, width: '26%' }}>{colorName || '—'}</td>
                        <td style={{ ...gridLbl, width: '22%' }}>Lebar</td>
                        <td style={gridVal}>{lebar != null ? `${lebar} cm` : '—'}</td>
                    </tr>
                    <tr>
                        <td style={gridLbl}>No. Mesin</td>
                        <td style={gridVal}>{mesin || '—'}</td>
                        <td style={gridLbl}>SPK / WO</td>
                        <td style={{ ...gridVal, fontFamily: CODE_FONT, fontSize: '9px' }}>{workOrder?.code || '—'}</td>
                    </tr>
                    <tr>
                        <td style={gridLbl}>Operator</td>
                        <td style={gridVal}>{operator || '—'}</td>
                        <td style={gridLbl}>Simpan di Rak</td>
                        <td style={{ ...gridVal, fontWeight: 'bold' }}>{rak || '—'}</td>
                    </tr>
                    <tr>
                        <td style={gridLbl}>Catatan</td>
                        <td colSpan={3} style={{ ...gridVal, fontSize: '9px', wordBreak: 'break-word' }}>{catatan || '—'}</td>
                    </tr>
                </tbody>
            </table>

            {/* What actually went into this bag, substitutes included. */}
            <LabelComponentsBand completion={completion} parentMO={parentMO} />

            <div style={{ flexGrow: 1, minHeight: '4px' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid #ccc', paddingTop: '6px' }}>
                <div style={{ fontSize: '6px', color: '#999', lineHeight: 1.3 }}>
                    {parentMO?.code || ''}<br />Lot ID: {completion?.output_batch_id || completion?.id}
                </div>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ borderBottom: '1px solid #000', height: '22px', width: '90px', marginBottom: '2px' }} />
                    <div style={{ fontSize: '8px', fontWeight: 'bold' }}>PARAF</div>
                </div>
            </div>
        </div>
    );
}
