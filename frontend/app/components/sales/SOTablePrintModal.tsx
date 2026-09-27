'use client';
import React, { useMemo } from 'react';
import { useData } from '../../context/DataContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { useTimezone } from '../../context/TimezoneContext';
import { STATIC_BASE } from '../shared/apiBase';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import TemplatePrintPortal from '../shared/printTemplate/TemplatePrintPortal';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { paperDimsMm } from '../shared/printTemplate/paper';
import { buildSoTableContext, SO_TABLE_DOC } from '../shared/printTemplate/doctypes/soTable';

// The document is a print template (defaults/soTable.ts, editable in Print Layouts).

export default function SOTablePrintModal({
    salesOrders, onClose, companyProfile, items, attributes, partners: _partners,
}: {
    salesOrders: any[];
    onClose: () => void;
    companyProfile: any;
    items: any[];
    attributes: any[];
    partners: any[];
}) {
    const { formatCustom: tzFmt } = useTimezone();
    const { itemIndex, printTemplates } = useData() as any;
    const layout = resolveLayout(SO_TABLE_DOC, printTemplates)!;
    const ctx = useMemo(() => buildSoTableContext({
        salesOrders, items, itemIndex, attributes, tzFormatCustom: tzFmt, companyProfile,
        companyName: companyProfile?.name,
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
    }), [salesOrders, items, itemIndex, attributes, tzFmt, companyProfile]);
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);

    const handlePrint = () => {
        window.addEventListener('afterprint', () => onClose(), { once: true });
        window.print();
    };

    return (
        <>
            <PrintModalShell
                title={`Print Sales Order Table — ${salesOrders.length} order(s)`}
                onClose={onClose}
                width="calc(var(--app-vw) * 96 / 100)"
                maxWidth={1300}
                height="calc(var(--app-vh) * 90 / 100)"
                bevel={false}
                modeless
                layoutDocType={SO_TABLE_DOC}
            >
                    <div style={{ flex: 1, background: '#e0e0e0', overflow: 'auto', padding: 16, display: 'flex', alignItems: 'flex-start' }}>
                        {/* True size; auto margins centre it without clipping when wider than the pane. */}
                        <div style={{
                            background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                            width: `${paperW}mm`, minHeight: `${paperH}mm`, padding: `${layout.paper.marginMm}mm`,
                            boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                        }}>
                            <TemplateRenderer layout={layout} ctx={ctx} docType={SO_TABLE_DOC} />
                        </div>
                    </div>

                    <PrintModalFooter note="Paper size, orientation and margins come from Print Layouts — no need to change the browser print dialog." onClose={onClose} onPrint={handlePrint} />
            </PrintModalShell>

            <TemplatePrintPortal layout={layout} ctx={ctx} docType={SO_TABLE_DOC} />
        </>
    );
}
