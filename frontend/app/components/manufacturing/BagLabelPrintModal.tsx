'use client';
import React, { useState, useEffect, useMemo } from 'react';
import QRCode from 'qrcode';
import { useData } from '../../context/DataContext';
import { useTimezone } from '../../context/TimezoneContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { xpFont } from '../shared/xpTheme';
import { API_BASE, STATIC_BASE } from '../shared/apiBase';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import TemplatePrintPortal from '../shared/printTemplate/TemplatePrintPortal';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { paperDimsMm } from '../shared/printTemplate/paper';
import {
    BAG_LABEL_DOC, BEAM_LABEL_DOC, buildOutputLabelContext, isBeamLot,
} from '../shared/printTemplate/doctypes/outputLabel';

/**
 * Output-unit label print — one A6 sticker per MOCompletion (each unit off the
 * machine is one completion / one lot). Reused for a single unit and for
 * reprinting every unit on a WO. The QR on each label encodes that unit's LOT
 * number, not the WO id.
 *
 * Two documents come out of here, chosen per completion by `isBeamLot`: the bag
 * label (greige, dyed, set) and the warp-beam label, both print templates
 * (defaults/outputLabel.ts, editable in Print Layouts). The plumbing — QR, live
 * lot weight, the labels_printed_at stamp — is identical for both, which is why
 * they share this modal; only what the floor reads differs.
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
    const { companyProfile, attributes, authFetch, printTemplates } = useData() as any;
    const { formatCustom } = useTimezone();

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

    const bagLayout = resolveLayout(BAG_LABEL_DOC, printTemplates)!;
    const beamLayout = resolveLayout(BEAM_LABEL_DOC, printTemplates)!;
    const logoUrl = companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined;

    // One page per completion, each with the document its lot calls for.
    const pages = useMemo(() => bags.map((bag, idx) => {
        const beam = isBeamLot(bag, workOrder);
        const n = String(bag.output_batch_number || '');
        return {
            key: String(bag.id),
            docType: beam ? BEAM_LABEL_DOC : BAG_LABEL_DOC,
            ctx: buildOutputLabelContext({
                completion: bag, workOrder, parentMO,
                bagSeq: beam ? null : seqStart + idx,
                lotRemaining: n && lotKg[n] != null ? lotKg[n] : null,
                qrDataUrl: qrUrls[bag.id] || '',
                attributes, tzFormatCustom: formatCustom,
                companyName: companyProfile?.name, companyLogoUrl: logoUrl, companyProfile,
            }),
        };
    }), [bags, workOrder, parentMO, seqStart, lotKg, qrUrls, attributes, formatCustom, companyProfile, logoUrl]);

    const bagPages = pages.filter(p => p.docType === BAG_LABEL_DOC);
    const beamPages = pages.filter(p => p.docType === BEAM_LABEL_DOC);
    const allBeams = bags.length > 0 && beamPages.length === bags.length;
    const unitNoun = (n: number) =>
        allBeams ? (n === 1 ? 'beam' : 'beams') : (n === 1 ? 'bag' : 'bags');
    const layoutDoc = allBeams ? BEAM_LABEL_DOC : BAG_LABEL_DOC;

    return (
        <>
            <PrintModalShell
                title={`Print ${allBeams ? 'Beam' : 'Bag'} Labels — ${bags.length} ${unitNoun(bags.length)} (${parentMO?.code})`}
                onClose={onClose}
                width="calc(var(--app-vw) * 90 / 100)"
                maxWidth={880}
                height="calc(var(--app-vh) * 88 / 100)"
                modeless
                layoutDocType={layoutDoc}
                layoutSample={bags[0] && parentMO?.id ? { sample: bags[0].id, q: parentMO.id } : undefined}
            >
                    <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {bags.length === 0 && (
                            <div style={{ color: '#555', fontSize: '12px', marginTop: '40px', fontFamily: xpFont, textAlign: 'center' }}>
                                No {allBeams ? 'beams' : 'weighed bags'} to label yet. Log a completion (one per {allBeams ? 'beam' : 'bag'}) first.
                            </div>
                        )}
                        {pages.map(p => {
                            const layout = p.docType === BEAM_LABEL_DOC ? beamLayout : bagLayout;
                            const { widthMm, heightMm } = paperDimsMm(layout.paper);
                            return (
                                <div key={p.key} style={{
                                    background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                                    width: `${widthMm}mm`, minHeight: `${heightMm}mm`, padding: `${layout.paper.marginMm}mm`,
                                    boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                                }}>
                                    <TemplateRenderer layout={layout} ctx={p.ctx} docType={p.docType} />
                                </div>
                            );
                        })}
                    </div>

                    <PrintModalFooter onClose={onClose} onPrint={doPrint} printDisabled={!bags.length} />
            </PrintModalShell>

            {/* A run is normally all bags or all beams; a mixed one prints each kind
                as its own run of sheets. */}
            {bagPages.length > 0 && (
                <TemplatePrintPortal layout={bagLayout} pages={bagPages.map(p => p.ctx)} docType={BAG_LABEL_DOC} />
            )}
            {beamPages.length > 0 && (
                <TemplatePrintPortal layout={beamLayout} pages={beamPages.map(p => p.ctx)} docType={BEAM_LABEL_DOC} />
            )}
        </>
    );
}
