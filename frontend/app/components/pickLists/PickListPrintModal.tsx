'use client';
import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useTimezone } from '../../context/TimezoneContext';
import { useData } from '../../context/DataContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { STATIC_BASE } from '../shared/apiBase';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import TemplatePrintPortal from '../shared/printTemplate/TemplatePrintPortal';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { paperDimsMm } from '../shared/printTemplate/paper';
import { PICK_LIST_DOC, buildPickListContext } from '../shared/printTemplate/doctypes/pickList';

/**
 * Pick list shop card — the floor document for a pick list, sibling of the
 * Kartu Packing. The document is a print template (defaults/pickList.ts, editable
 * in Print Layouts).
 *
 * The QR encodes the pick list CODE (PL-…), which the picker scans at /scanner
 * to open the list. Deliberately not the Surat Jalan: that is the delivery note,
 * printed at dispatch, after picking, and carries no QR.
 */
export default function PickListPrintModal({ pl, companyProfile, onClose }: any) {
    const { formatCustom: tzFmt } = useTimezone();
    const { printTemplates } = useData() as any;
    const layout = resolveLayout(PICK_LIST_DOC, printTemplates)!;
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);
    const [qrUrl, setQrUrl] = useState('');

    useEffect(() => {
        QRCode.toDataURL(pl.code, { margin: 4, width: 260, errorCorrectionLevel: 'H' })
            .then(setQrUrl)
            .catch(() => setQrUrl(''));
    }, [pl.code]);

    const ctx = useMemo(() => buildPickListContext({
        pl, qrDataUrl: qrUrl || undefined, tzFormatCustom: tzFmt,
        companyProfile, companyName: companyProfile?.name,
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
    }), [pl, qrUrl, tzFmt, companyProfile]);

    const doPrint = () => {
        window.addEventListener('afterprint', onClose, { once: true });
        window.print();
    };

    return (
        <>
            <PrintModalShell
                title={`Kartu Picking — ${pl.code}`}
                onClose={onClose}
                width="calc(var(--app-vw) * 92 / 100)"
                maxWidth={900}
                height="calc(var(--app-vh) * 90 / 100)"
                modeless
                layoutDocType={PICK_LIST_DOC}
                layoutSample={{ sample: pl.id, q: pl.code }}
            >
                <div style={{ flex: 1, background: '#808080', overflow: 'auto', padding: 16, display: 'flex', alignItems: 'flex-start' }}>
                    {/* True size; auto margins centre it without clipping when wider than the pane. */}
                    <div style={{
                        background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                        width: `${paperW}mm`, minHeight: `${paperH}mm`, padding: `${layout.paper.marginMm}mm`,
                        boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                    }}>
                        <TemplateRenderer layout={layout} ctx={ctx} docType={PICK_LIST_DOC} />
                    </div>
                </div>
                <PrintModalFooter onClose={onClose} onPrint={doPrint} />
            </PrintModalShell>

            <TemplatePrintPortal layout={layout} ctx={ctx} docType={PICK_LIST_DOC} />
        </>
    );
}
