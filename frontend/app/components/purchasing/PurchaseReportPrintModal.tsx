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
import { buildPurchaseReportContext, PO_LINES_REPORT_DOC, GOODS_RECEIVED_REPORT_DOC } from '../shared/printTemplate/doctypes/purchaseReport';

// Purchase Report print — PO lines or goods received. The document is a print
// template (defaults/purchaseReport.ts), editable in Print Layouts.
export default function PurchaseReportPrintModal({
    kind, rows, amount, periodLabel, filtersSummary, onClose,
}: {
    kind: 'lines' | 'receipts';
    rows: any[];
    amount: number;
    periodLabel: string;
    filtersSummary: string;
    onClose: () => void;
}) {
    const { formatDate } = useTimezone();
    const { printTemplates, companyProfile } = useData() as any;
    const docType = kind === 'lines' ? PO_LINES_REPORT_DOC : GOODS_RECEIVED_REPORT_DOC;
    const layout = resolveLayout(docType, printTemplates)!;

    const ctx = useMemo(() => buildPurchaseReportContext({
        rows, amount, periodLabel, filtersSummary, formatDate, companyProfile,
        companyName: companyProfile?.name,
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
    }), [rows, amount, periodLabel, filtersSummary, formatDate, companyProfile]);
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);

    const handlePrint = () => {
        window.addEventListener('afterprint', () => onClose(), { once: true });
        window.print();
    };

    return (
        <>
            <PrintModalShell
                title={`Print ${kind === 'lines' ? 'Purchase Order Lines' : 'Goods Received'} — ${rows.length.toLocaleString()} row(s)`}
                onClose={onClose}
                modeless
                width="calc(var(--app-vw) * 96 / 100)"
                maxWidth={1300}
                height="calc(var(--app-vh) * 90 / 100)"
                bevel={false}
                layoutDocType={docType}
            >
                <div style={{ flex: 1, background: '#e0e0e0', overflow: 'auto', padding: 16, display: 'flex', alignItems: 'flex-start' }}>
                    <div style={{
                        background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                        width: `${paperW}mm`, minHeight: `${paperH}mm`, padding: `${layout.paper.marginMm}mm`,
                        boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                    }}>
                        <TemplateRenderer layout={layout} ctx={ctx} docType={docType} />
                    </div>
                </div>
                <PrintModalFooter note="Paper size, orientation and margins come from Print Layouts — no need to change the browser print dialog." onClose={onClose} onPrint={handlePrint} />
            </PrintModalShell>
            <TemplatePrintPortal layout={layout} ctx={ctx} docType={docType} />
        </>
    );
}
