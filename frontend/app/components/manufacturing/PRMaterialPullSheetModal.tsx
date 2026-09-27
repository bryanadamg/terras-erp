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
import { buildPRPullSheetContext, PR_PULL_SHEET_DOC } from '../shared/printTemplate/doctypes/prPullSheet';


/**
 * Kickoff-time store request: aggregated material demand for one Production Run,
 * sectioned by source location so each store sees only the lines it fulfills.
 * Data is the same PRMaterialRequirementItem list backing the "Materials" expand
 * row — this just prints it, through the print template (defaults/prPullSheet.ts).
 */
export default function PRMaterialPullSheetModal({
    pr,
    reqs,
    isLoading,
    companyProfile,
    getLocationName,
    getAttributeValueName,
    formatDate,
    onClose,
}: {
    pr: any;
    reqs: any[];
    isLoading: boolean;
    companyProfile: any;
    getLocationName: (id: any) => string;
    getAttributeValueName: (id: any) => string;
    formatDate: (d: any) => string;
    onClose: () => void;
}) {
    const { printTemplates } = useData() as any;
    const { formatCustom: tzFmt } = useTimezone();

    const layout = resolveLayout(PR_PULL_SHEET_DOC, printTemplates)!;
    const ctx = useMemo(() => buildPRPullSheetContext({
        pr, reqs: reqs || [], isLoading, getLocationName, getAttributeValueName, formatDate,
        companyProfile, tzFormatCustom: tzFmt,
        companyName: companyProfile?.name,
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
    }), [pr, reqs, isLoading, getLocationName, getAttributeValueName, formatDate, companyProfile, tzFmt]);
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);

    // The Ends column only when this run has beam lines, so a garment run keeps
    // the width of an already-tight table for the material name.
    const bandOverrides = { pr_materials: !ctx.doc.showEnds, pr_materials_ends: ctx.doc.showEnds };

    const doPrint = () => {
        window.addEventListener('afterprint', onClose, { once: true });
        window.print();
    };

    return (
        <>
            <PrintModalShell
                title={`Print Material Pull Sheet — ${pr.code}`}
                onClose={onClose}
                modeless
                width="calc(var(--app-vw) * 92 / 100)"
                maxWidth={900}
                height="calc(var(--app-vh) * 90 / 100)"
                layoutDocType={PR_PULL_SHEET_DOC}
                layoutSample={{ sample: pr.id, q: pr.code }}
            >
                <div style={{ flex: 1, background: '#e0e0e0', overflow: 'auto', padding: '16px', display: 'flex', alignItems: 'flex-start' }}>
                    {/* True size; auto margins centre it without clipping when wider than the pane. */}
                    <div style={{
                        background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                        width: `${paperW}mm`, minHeight: `${paperH}mm`, padding: `${layout.paper.marginMm}mm`,
                        boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                    }}>
                        <TemplateRenderer layout={layout} ctx={ctx} docType={PR_PULL_SHEET_DOC} bandOverrides={bandOverrides} />
                    </div>
                </div>

                <PrintModalFooter onClose={onClose} onPrint={doPrint} />
            </PrintModalShell>

            <TemplatePrintPortal layout={layout} ctx={ctx} docType={PR_PULL_SHEET_DOC} bandOverrides={bandOverrides} />
        </>
    );
}
