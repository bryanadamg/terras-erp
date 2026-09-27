'use client';
import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useTimezone } from '../../context/TimezoneContext';
import { useData } from '../../context/DataContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { API_BASE, STATIC_BASE } from '../shared/apiBase';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import TemplatePrintPortal from '../shared/printTemplate/TemplatePrintPortal';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { paperDimsMm } from '../shared/printTemplate/paper';
import { PACKING_CARD_DOC, buildPackingCardContext } from '../shared/printTemplate/doctypes/packingCard';


/**
 * Packing order shop card — the floor document for a packing order. The document
 * is a print template (defaults/packingCard.ts, editable in Print Layouts).
 *
 * The QR encodes the packing order CODE (PCK-…), not the carton — a carton does
 * not exist until the packer logs it. Carton QRs live on the A6 labels printed
 * by PackedUnitLabelPrintModal.
 */
export default function PackingCardPrintModal({ po, attributes, companyProfile, authFetch, onClose }: any) {
    const { formatCustom: tzFmt } = useTimezone();
    const { printTemplates } = useData() as any;
    const layout = resolveLayout(PACKING_CARD_DOC, printTemplates)!;
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);
    const [qrUrl, setQrUrl] = useState('');

    useEffect(() => {
        QRCode.toDataURL(po.code, { margin: 4, width: 260, errorCorrectionLevel: 'H' })
            .then(setQrUrl)
            .catch(() => setQrUrl(''));
    }, [po.code]);

    const ctx = useMemo(() => buildPackingCardContext({
        po, attributes, qrDataUrl: qrUrl || undefined, tzFormatCustom: tzFmt,
        companyProfile, companyName: companyProfile?.name,
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
    }), [po, attributes, qrUrl, tzFmt, companyProfile]);

    const doPrint = () => {
        // Stamp card_printed_at so the list can flag orders whose card was never
        // issued to the floor. Fire-and-forget: a failed stamp must not block print.
        try { authFetch?.(`${API_BASE}/packing/${po.id}/card-printed`, { method: 'POST' }).catch(() => {}); } catch { /* noop */ }
        window.addEventListener('afterprint', onClose, { once: true });
        window.print();
    };

    return (
        <>
            <PrintModalShell
                title={`Kartu Packing — ${po.code}`}
                onClose={onClose}
                width="calc(var(--app-vw) * 92 / 100)"
                maxWidth={900}
                height="calc(var(--app-vh) * 90 / 100)"
                modeless
                layoutDocType={PACKING_CARD_DOC}
                layoutSample={{ sample: po.id, q: po.code }}
            >
                <div style={{ flex: 1, background: '#808080', overflow: 'auto', padding: 16, display: 'flex', alignItems: 'flex-start' }}>
                    {/* True size; auto margins centre it without clipping when wider than the pane. */}
                    <div style={{
                        background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                        width: `${paperW}mm`, minHeight: `${paperH}mm`, padding: `${layout.paper.marginMm}mm`,
                        boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                    }}>
                        <TemplateRenderer layout={layout} ctx={ctx} docType={PACKING_CARD_DOC} />
                    </div>
                </div>
                <PrintModalFooter onClose={onClose} onPrint={doPrint} />
            </PrintModalShell>

            <TemplatePrintPortal layout={layout} ctx={ctx} docType={PACKING_CARD_DOC} />
        </>
    );
}
