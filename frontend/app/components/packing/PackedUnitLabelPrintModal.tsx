'use client';
import React, { useState, useEffect, useMemo } from 'react';
import QRCode from 'qrcode';
import { useTimezone } from '../../context/TimezoneContext';
import { useData } from '../../context/DataContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { xpFont } from '../shared/xpTheme';
import { STATIC_BASE } from '../shared/apiBase';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import TemplatePrintPortal from '../shared/printTemplate/TemplatePrintPortal';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { paperDimsMm } from '../shared/printTemplate/paper';
import {
    PACKED_UNIT_LABEL_DOC, buildCartonLabelContext, cartonBarcodes, cartonQrPayload,
} from '../shared/printTemplate/doctypes/packedUnitLabel';

/**
 * Carton label — one A6 sticker per PackedUnit, laid out to match the customer-
 * facing BIE sticker. The document is a print template (defaults/packedUnitLabel.ts,
 * editable in Print Layouts); field sources are documented in
 * doctypes/packedUnitLabel.ts.
 *
 * The PU- QR is what our own picker scans onto a pick list; the Code 128 barcodes
 * are for the customer's goods-in. One sheet per carton via TemplatePrintPortal.
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
    const { printTemplates } = useData() as any;
    const layout = resolveLayout(PACKED_UNIT_LABEL_DOC, printTemplates)!;
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);

    const [qrUrls, setQrUrls] = useState<Record<string, string>>({});

    useEffect(() => {
        Promise.all(
            units.map(u => QRCode.toDataURL(cartonQrPayload(u), { margin: 4, width: 280, errorCorrectionLevel: 'H' })
                .then(url => [u.id, url] as [string, string])
                .catch(() => [u.id, ''] as [string, string]))
        ).then(entries => setQrUrls(Object.fromEntries(entries)));
    }, [units]);

    // JsBarcode renders to a canvas, far too slow to redo on every paint — built
    // once per unit list, apart from the QRs that land later.
    const barcodes = useMemo(
        () => Object.fromEntries(units.map(u => [u.id, cartonBarcodes(po, u)])),
        [units, po],
    );

    const pages = useMemo(() => units.map(u => buildCartonLabelContext({
        po, unit: u, qrDataUrl: qrUrls[u.id], barcodes: barcodes[u.id],
        companyProfile, companyName: companyProfile?.name,
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
        tzFormatCustom: tzFmt,
    })), [units, po, qrUrls, barcodes, companyProfile, tzFmt]);

    const doPrint = () => {
        window.addEventListener('afterprint', onClose, { once: true });
        window.print();
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
                layoutDocType={PACKED_UNIT_LABEL_DOC}
                layoutSample={{ sample: units[0]?.id, q: po.id }}
            >
                <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {units.length === 0 && (
                        <div style={{ color: '#555', fontSize: '12px', marginTop: '40px', fontFamily: xpFont, textAlign: 'center' }}>
                            No cartons packed yet. Log a packing event first.
                        </div>
                    )}
                    {pages.map((ctx, i) => (
                        <div key={units[i].id} style={{
                            background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                            width: `${paperW}mm`, minHeight: `${paperH}mm`, padding: `${layout.paper.marginMm}mm`,
                            boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                        }}>
                            <TemplateRenderer layout={layout} ctx={ctx} docType={PACKED_UNIT_LABEL_DOC} />
                        </div>
                    ))}
                </div>

                <PrintModalFooter onClose={onClose} onPrint={doPrint} printDisabled={!units.length} />
            </PrintModalShell>

            <TemplatePrintPortal layout={layout} pages={pages} docType={PACKED_UNIT_LABEL_DOC} />
        </>
    );
}
