'use client';
import React, { useState, useEffect, useMemo } from 'react';
import QRCode from 'qrcode';
import { useData } from '../../context/DataContext';
import { useTimezone } from '../../context/TimezoneContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { xpFont } from '../shared/xpTheme';
import { STATIC_BASE } from '../shared/apiBase';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import TemplatePrintPortal from '../shared/printTemplate/TemplatePrintPortal';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { paperDimsMm } from '../shared/printTemplate/paper';
import { LOT_LABEL_DOC, LOT_LABEL_HEADING, buildLotLabelContext } from '../shared/printTemplate/doctypes/lotLabel';

/**
 * Generic lot sticker — one A6 label per Batch (lot). Unlike the bag label (which
 * is tied to a MOCompletion), this prints straight off a Batch row, so it works
 * for any lot: split leftovers, manually-created lots, relabels. The QR + Code 128
 * both encode the lot number. The document is a print template
 * (defaults/lotLabel.ts, editable in Print Layouts); `heading` fills its
 * `lotlabel.heading` field.
 */
export default function LotLabelPrintModal({
    lots,
    heading = LOT_LABEL_HEADING,
    onClose,
}: {
    lots: any[];
    heading?: string;
    onClose: () => void;
}) {
    const { companyProfile, printTemplates } = useData() as any;
    const { formatCustom } = useTimezone();

    const doPrint = () => {
        window.addEventListener('afterprint', onClose, { once: true });
        window.print();
    };

    const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
    useEffect(() => {
        Promise.all(
            lots.map(l => QRCode.toDataURL(l.batch_number || String(l.id), { margin: 4, width: 280, errorCorrectionLevel: 'H' })
                .then(url => [l.id, url] as [string, string])
                .catch(() => [l.id, ''] as [string, string]))
        ).then(entries => setQrUrls(Object.fromEntries(entries)));
    }, [lots]);

    const layout = resolveLayout(LOT_LABEL_DOC, printTemplates)!;
    const { widthMm, heightMm } = paperDimsMm(layout.paper);
    const logoUrl = companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined;
    const pages = useMemo(() => lots.map(lot => buildLotLabelContext({
        lot, heading, qrDataUrl: qrUrls[lot.id] || '', tzFormatCustom: formatCustom,
        companyName: companyProfile?.name, companyLogoUrl: logoUrl, companyProfile,
    })), [lots, heading, qrUrls, formatCustom, companyProfile, logoUrl]);

    return (
        <>
            <PrintModalShell
                title={`Print Lot Label — ${lots.length} ${lots.length === 1 ? 'lot' : 'lots'}`}
                onClose={onClose}
                width="calc(var(--app-vw) * 90 / 100)"
                maxWidth={880}
                height="calc(var(--app-vh) * 88 / 100)"
                modeless
                layoutDocType={LOT_LABEL_DOC}
                layoutSample={lots[0] ? { sample: lots[0].id, q: lots[0].batch_number } : undefined}
            >
                <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {lots.length === 0 && (
                        <div style={{ color: '#555', fontSize: '12px', marginTop: '40px', fontFamily: xpFont, textAlign: 'center' }}>No lots to label.</div>
                    )}
                    {pages.map((ctx, i) => (
                        <div key={lots[i].id} style={{
                            background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                            width: `${widthMm}mm`, minHeight: `${heightMm}mm`, padding: `${layout.paper.marginMm}mm`,
                            boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                        }}>
                            <TemplateRenderer layout={layout} ctx={ctx} docType={LOT_LABEL_DOC} />
                        </div>
                    ))}
                </div>

                <PrintModalFooter onClose={onClose} onPrint={doPrint} printDisabled={!lots.length} />
            </PrintModalShell>

            {lots.length > 0 && <TemplatePrintPortal layout={layout} pages={pages} docType={LOT_LABEL_DOC} />}
        </>
    );
}
