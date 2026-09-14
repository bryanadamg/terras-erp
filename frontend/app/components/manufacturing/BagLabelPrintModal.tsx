'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { useData } from '../../context/DataContext';
import BagLabelCard from './BagLabelCard';
import BeamLabelCard from './BeamLabelCard';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { xpFont, PRINT_FONT } from '../shared/xpTheme';

// Code 128 (1D) so the factory's existing laser barcode scanners can read the
// lot number too — not everyone has a phone/2D imager. Rendered to a PNG data
// URL alongside the QR. Same payload as the QR: the lot number.
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
 * Output-unit label print — one A6 sticker per MOCompletion (each unit off the
 * machine is one completion / one lot). Reused for a single unit and for
 * reprinting every unit on a WO. The QR on each label encodes that unit's LOT
 * number, not the WO id.
 *
 * Two cards come out of here, chosen per completion by `isBeamLot` below:
 * ./BagLabelCard for a weighed bag (greige, dyed, set) and ./BeamLabelCard for a
 * warp beam. The print plumbing — A6 sheet, QR + Code 128, the hidden portal, the
 * labels_printed_at stamp — is identical for both, which is why they share this
 * modal rather than getting a second one; only what the floor reads differs.
 *
 * `bags` are the completion objects to print, already filtered to this WO and
 * to non-rejected rows with an output lot. `seqStart` is the sequence number of
 * the first bag (1-based) so single-bag reprints keep their real bag number.
 * Beams ignore it — a beam is not counted off in bags.
 */
export default function BagLabelPrintModal({
    bags,
    workOrder,
    parentMO,
    seqStart = 1,
    onClose,
}: {
    bags: any[];
    workOrder: any;
    parentMO: any;
    seqStart?: number;
    onClose: () => void;
}) {
    const { companyProfile, attributes, authFetch } = useData() as any;

    const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace(/\/api$/, '') + '/api';
    // Stamp labels_printed_at when the operator prints. Compared against the newest
    // bag time on the WO row so bags logged after this print re-flag as unprinted.
    const doPrint = () => {
        if (workOrder?.id) {
            try { authFetch(`${API_BASE}/work-orders/${workOrder.id}/mark-printed?kind=labels`, { method: 'POST' }).catch(() => {}); } catch { /* noop */ }
        }
        window.addEventListener('afterprint', onClose, { once: true });
        window.print();
    };

    const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
    // 1D barcodes are synchronous to generate — memoize per bag lot.
    const barcodeUrls = useMemo(() => {
        const map: Record<string, string> = {};
        bags.forEach(b => { map[b.id] = makeBarcodeDataUrl(b.output_batch_number || String(b.id)); });
        return map;
    }, [bags]);

    // Live weight per lot. The completion's `qty_completed` is the weight the bag
    // was BORN with and is never restated, so after a lot split (or a partial
    // stage) a reprint used to carry the original kg while the physical bag held
    // less. Resolve each lot's current StockBalance sum instead; the completion
    // stays the fallback when the lot can't be resolved (offline, deleted, perms).
    const [lotKg, setLotKg] = useState<Record<string, number>>({});
    const lotNumbers = useMemo(
        () => Array.from(new Set(bags.map((b: any) => String(b.output_batch_number || '')).filter(Boolean))),
        [bags],
    );
    useEffect(() => {
        if (!lotNumbers.length) { setLotKg({}); return; }
        let cancelled = false;
        Promise.all(lotNumbers.map(n =>
            authFetch(`${API_BASE}/batches/resolve?number=${encodeURIComponent(n)}`)
                .then((r: Response) => (r.ok ? r.json() : null))
                .then((j: any) => (j && j.remaining != null ? [n, Number(j.remaining)] as [string, number] : null))
                .catch(() => null)
        )).then(entries => {
            if (cancelled) return;
            setLotKg(Object.fromEntries(entries.filter(Boolean) as [string, number][]));
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lotNumbers.join('|')]);

    const lotKgOf = (bag: any): number | null => {
        const n = String(bag?.output_batch_number || '');
        return n && lotKg[n] != null ? lotKg[n] : null;
    };

    useEffect(() => {
        document.body.classList.add('bag-label-print-active');
        return () => { document.body.classList.remove('bag-label-print-active'); };
    }, []);

    useEffect(() => {
        Promise.all(
            bags.map(b => {
                const payload = b.output_batch_number || String(b.id);
                return QRCode.toDataURL(payload, { margin: 4, width: 280, errorCorrectionLevel: 'H' })
                    .then(url => [b.id, url] as [string, string])
                    .catch(() => [b.id, ''] as [string, string]);
            })
        ).then(entries => setQrUrls(Object.fromEntries(entries)));
    }, [bags]);

    // Which card this completion gets. Read off the lot's own `BM-` prefix rather
    // than the WO's work-centre type: a reprint from the Lot page (BatchesView)
    // may hand us a WO object that is null or stale, and the lot number is the one
    // fact that is always present and always right (see the prefix table in
    // add_mo_completion — BM / GRG / DYE / SET / LOT).
    const isBeamLot = (bag: any) =>
        /^BM[-_]/i.test(String(bag?.output_batch_number || ''))
        || String(workOrder?.work_center_type || '').toUpperCase() === 'BEAMING';

    const renderLabel = (bag: any, idx: number) => (
        <div key={bag.id} className="bag-label-card" style={{ background: '#fff', color: '#000', fontFamily: PRINT_FONT, display: 'flex', flexDirection: 'column' }}>
            {isBeamLot(bag) ? (
                <BeamLabelCard
                    completion={bag}
                    workOrder={workOrder}
                    parentMO={parentMO}
                    qrDataUrl={qrUrls[bag.id] || ''}
                    barcodeDataUrl={barcodeUrls[bag.id] || ''}
                    companyName={companyProfile?.name}
                    lotRemaining={lotKgOf(bag)}
                />
            ) : (
                <BagLabelCard
                    completion={bag}
                    workOrder={workOrder}
                    parentMO={parentMO}
                    qrDataUrl={qrUrls[bag.id] || ''}
                    barcodeDataUrl={barcodeUrls[bag.id] || ''}
                    bagSeq={seqStart + idx}
                    companyName={companyProfile?.name}
                    attributes={attributes}
                    lotRemaining={lotKgOf(bag)}
                />
            )}
        </div>
    );

    const allBeams = bags.length > 0 && bags.every(isBeamLot);
    const unitNoun = (n: number) =>
        allBeams ? (n === 1 ? 'beam' : 'beams') : (n === 1 ? 'bag' : 'bags');

    return (
        <>
            <PrintModalShell
                title={`Print ${allBeams ? 'Beam' : 'Bag'} Labels — ${bags.length} ${unitNoun(bags.length)} (${parentMO?.code})`}
                onClose={onClose}
                width="calc(var(--app-vw) * 90 / 100)"
                maxWidth={880}
                height="calc(var(--app-vh) * 88 / 100)"
                modeless
            >
                    <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                        {bags.length === 0 && (
                            <div style={{ color: '#555', fontSize: '12px', marginTop: '40px', fontFamily: xpFont }}>
                                No {allBeams ? 'beams' : 'weighed bags'} to label yet. Log a completion (one per {allBeams ? 'beam' : 'bag'}) first.
                            </div>
                        )}
                        {bags.map((bag, idx) => (
                            <div key={bag.id} className="bag-label-paper" style={{ background: '#fff', width: '378px', minHeight: '535px', padding: '18px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
                                {renderLabel(bag, idx)}
                            </div>
                        ))}
                    </div>

                    <PrintModalFooter onClose={onClose} onPrint={doPrint} printDisabled={!bags.length} />
            </PrintModalShell>

            {createPortal(
                <div className="bag-label-print-portal" style={{ display: 'none' }}>
                    {bags.map((bag, idx) => renderLabel(bag, idx))}
                </div>,
                document.body
            )}
        </>
    );
}
