'use client';
import React from 'react';
import { useTimezone } from '../../context/TimezoneContext';
import { CODE_FONT, PRINT_FONT } from '../shared/xpTheme';
import LabelComponentsBand from './LabelComponentsBand';

/**
 * Warp-beam label — one sticker per beam produced at a BEAMING WO.
 *
 * Same shape and props as ./BagLabelCard, and printed by the same
 * ./BagLabelPrintModal, because a beam is born exactly the way a bag is: one
 * MOCompletion, one `BM-` output lot, one physical unit off the machine. What
 * differs is what the floor reads off it, which is why this is a separate card
 * rather than a flag on the bag one:
 *
 *  - a beam's defining spec is **utas (warp ends)**, not colour and width — a
 *    beam is greige warp, so BagLabelCard's WARNA row was always blank on one;
 *  - a beam is a loom resource: the next thing that happens to it is being
 *    *mounted*, so the card names the beam and its ends, not a bag sequence
 *    within a WO (beams are not counted off in bags);
 *  - the QR is the mount scan. It encodes the `BM-` lot number, the same string
 *    `GET /batches/resolve` takes, so the weaving staging modal and the weaving
 *    monitor's Beams tab both read this label directly.
 *
 * Code 128 rides alongside the QR for the plant's older laser scanners, same
 * payload — see BagLabelPrintModal for why both exist.
 */
export default function BeamLabelCard({
    completion,
    workOrder,
    parentMO,
    qrDataUrl,
    barcodeDataUrl,
    companyName,
    lotRemaining,
}: {
    completion: any;
    workOrder: any;
    parentMO: any;
    qrDataUrl: string;
    barcodeDataUrl?: string;
    companyName?: string;
    lotRemaining?: number | null;
}) {
    const { formatCustom: tzFmt } = useTimezone();

    const beamNo = completion?.output_batch_number || '—';
    // Live kg off the beam's own lot, not the frozen completion — a beam is drawn
    // down as it weaves, so a reprint must say what is left on it. See BagLabelCard.
    const berat = Number(lotRemaining ?? completion?.qty_completed ?? 0);
    // Ends are planned per-WO (utas on the beaming order) and fall back to the
    // beam item's own default — the same precedence add_mo_completion stamps onto
    // the Batch, so the sticker cannot disagree with the lot it is stuck to.
    const utas = workOrder?.ends ?? parentMO?.item?.ends ?? null;

    const operator = completion?.operator_name || null;
    const mesin = completion?.work_center_name || workOrder?.work_center_name || null;
    // Operator's own remark, preferring the lot's clean copy over the completion
    // note with its machine-appended "[Beam BM-…]" brackets.
    const rawNote: string = completion?.output_batch_notes || completion?.notes || '';
    const catatan = rawNote.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim() || null;
    const rak = parentMO?.planned_putaway_location_name || null;
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
                    <div style={heroLbl}>LABEL BOOM / BEAM LABEL</div>
                    <div style={{ fontSize: '8px', color: '#666' }}>{tgl}</div>
                </div>
                <div style={{ border: '2px solid #000', padding: '4px', flexShrink: 0, textAlign: 'center' }}>
                    {qrDataUrl
                        ? <img src={qrDataUrl} alt="QR" style={{ width: '96px', height: '96px', display: 'block' }} />
                        : <div style={{ width: '96px', height: '96px', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', color: '#888' }}>...</div>
                    }
                    <div style={{ fontSize: '6px', color: '#555', marginTop: '1px' }}>Scan = Pasang / Mount</div>
                </div>
            </div>

            {/* Beam number hero — the warp's unique identity, and the string the
                loom scanner resolves. QR (2D) + Code 128 (1D) carry the same text. */}
            <div style={{ border: '2px solid #000', padding: '4px 8px', marginBottom: '6px' }}>
                <div style={heroLbl}>NO. BOOM / BEAM No.</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', lineHeight: 1.05, fontFamily: CODE_FONT, wordBreak: 'break-all' }}>{beamNo}</div>
                {barcodeDataUrl && (
                    <img src={barcodeDataUrl} alt={`barcode ${beamNo}`} style={{ width: '100%', height: '40px', objectFit: 'contain', display: 'block', marginTop: '3px' }} />
                )}
            </div>

            {/* Utas + berat hero — a beam's two numbers. Ends lead: it is the spec
                that decides which article the warp can weave at all. */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <div style={{ flex: 1, border: '1px solid #999', padding: '3px 8px' }}>
                    <div style={heroLbl}>UTAS / ENDS</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{utas != null ? utas : '—'}</div>
                </div>
                <div style={{ flex: 1, border: '1px solid #999', padding: '3px 8px' }}>
                    <div style={heroLbl}>BERAT / WEIGHT</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
                        {berat > 0 ? berat.toFixed(2) : '—'}<span style={{ fontSize: '11px', color: '#666', fontWeight: 'normal' }}>{berat > 0 ? ' kg' : ''}</span>
                    </div>
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
                        <td style={gridLbl}>No. Mesin</td>
                        <td style={{ ...gridVal, width: '26%' }}>{mesin || '—'}</td>
                        <td style={{ ...gridLbl, width: '22%' }}>SPK / WO</td>
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

            {/* What actually went onto this beam, substitutes included. Sits above
                the mount log: this is what the beam IS, the log is what happens next. */}
            <LabelComponentsBand completion={completion} parentMO={parentMO} />

            {/* Mount log — the beam goes up on a loom next, and the floor writes
                which one by hand when it does. Blank on purpose: the ERP records
                the mount, this is the physical tag on the rack. */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6px' }}>
                <tbody>
                    <tr>
                        <td style={{ ...gridLbl, width: '24%' }}>Dipasang di</td>
                        <td style={{ ...gridVal, height: '18px' }} />
                        <td style={{ ...gridLbl, width: '22%' }}>Tgl. Pasang</td>
                        <td style={{ ...gridVal, height: '18px' }} />
                    </tr>
                </tbody>
            </table>

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
