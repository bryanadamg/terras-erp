'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';

import KartuKerjaTemplateCard from '../manufacturing/KartuKerjaTemplateCard';
import { docTypeForWorkCenter } from '../shared/printTemplate/defaults/kartuKerja';
import { paperCssSize, paperDimsMm } from '../shared/printTemplate/paper';
import type { PrintLayout, PrintTemplateRecord } from '../shared/printTemplate/types';
import type { DyeingPrintData } from '../shared/printTemplate/dyeingPrintData';
import { PRINT_FONT } from '../shared/xpTheme';

/**
 * Test print of the layout being edited — the unsaved draft, on real paper.
 *
 * The designer's canvas is already the true-size renderer, but a printer applies
 * its own margins and page box, and until this existed the only way to see that was
 * to save the layout (pushing it to every workstation) and find a real work order
 * to print. So: same card component, same print CSS as the floor's own print path.
 *
 * The draft is handed over as a synthetic template record keyed by the SAMPLE work
 * order's doc type, not by the doc type being edited. `KartuKerjaTemplateCard`
 * resolves the layout from the work order's work centre, so keying it any other way
 * would silently print the *saved* layout whenever the preview fell back to a work
 * order that routes elsewhere.
 *
 * Nothing is marked as printed: this is the designer's proof, not a floor document.
 */
export default function DesignerTestPrint({
    draft, workOrder, parentMO, companyName, attributes, dyeing, onDone,
}: {
    draft: PrintLayout;
    workOrder: any;
    parentMO: any;
    companyName?: string;
    attributes?: any[];
    dyeing?: DyeingPrintData | null;
    onDone: () => void;
}) {
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

    // ECC 'M' and a 512px raster, matching the floor's print path — a test print has
    // to be scannable, or it proves nothing about the QR's size on paper.
    useEffect(() => {
        let cancelled = false;
        QRCode.toDataURL(String(workOrder?.id || ''), { margin: 4, width: 512, errorCorrectionLevel: 'M' })
            .then(url => { if (!cancelled) setQrDataUrl(url); })
            .catch(() => { if (!cancelled) setQrDataUrl(''); });
        return () => { cancelled = true; };
    }, [workOrder?.id]);

    const { heightMm } = paperDimsMm(draft.paper);
    const marginMm = draft.paper.marginMm ?? 6;
    const cssSize = paperCssSize(draft.paper);

    // globals.css hardcodes `@page wostepcard` as A6/6mm. This rule lands in <head>
    // after that stylesheet, so document order lets the draft's paper win — the same
    // trick WOBulkPrintModal uses for a saved template.
    useEffect(() => {
        const el = document.createElement('style');
        el.setAttribute('data-designer-test-paper', '');
        el.textContent = `@media print {
  @page wostepcard { size: ${cssSize}; margin: ${marginMm}mm; }
  body.wo-step-print-active .wo-print-paper-portal .wo-step-card {
    min-height: ${Math.max(0, heightMm - marginMm * 2)}mm !important;
  }
}`;
        document.head.appendChild(el);
        return () => { el.remove(); };
    }, [cssSize, marginMm, heightMm]);

    // Print once the QR is rendered, and hand control back on the way out —
    // `afterprint` fires for both the print and the cancel, which is what we want:
    // either way the designer is done with the portal.
    useEffect(() => {
        if (qrDataUrl == null) return;
        document.body.classList.add('wo-step-print-active');
        const finish = () => onDone();
        window.addEventListener('afterprint', finish, { once: true });
        // One frame, so the portal is painted before the print dialog snapshots it.
        const t = window.setTimeout(() => window.print(), 60);
        return () => {
            window.clearTimeout(t);
            window.removeEventListener('afterprint', finish);
            document.body.classList.remove('wo-step-print-active');
        };
    }, [qrDataUrl, onDone]);

    const templates: PrintTemplateRecord[] = [{
        id: 'draft',
        doc_type: docTypeForWorkCenter(workOrder?.work_center_type),
        layout: draft,
        paper: draft.paper,
        updated_by_id: null,
        updated_at: '',
    }];

    return createPortal(
        <div className="wo-print-paper-portal" style={{ display: 'none' }}>
            <div
                className="wo-print-paper wo-step-card"
                style={{
                    background: '#fff', width: '100%', color: '#000',
                    fontFamily: PRINT_FONT, display: 'flex', flexDirection: 'column',
                }}
            >
                <KartuKerjaTemplateCard
                    workOrder={workOrder}
                    parentMO={parentMO}
                    qrDataUrl={qrDataUrl || ''}
                    settings={{ showMaterials: true, showFillFields: true, showSignature: true, headerDepartment: '' }}
                    companyName={companyName}
                    attributes={attributes}
                    templates={templates}
                    dyeing={dyeing ?? null}
                />
            </div>
        </div>,
        document.body,
    );
}
