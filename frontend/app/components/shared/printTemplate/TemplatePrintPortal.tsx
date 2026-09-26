'use client';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import TemplateRenderer, { type BandVisibilityOverrides } from './TemplateRenderer';
import { paperCssSize } from './paper';
import type { PrintLayout } from './types';
import type { PrintContext } from './renderContext';

/**
 * The paper copy of a template document: a body portal that the print CSS
 * (`tpl-print-*` in globals.css) reveals alone, on a named page sized from the
 * layout's own paper. Any doc type that prints from a template uses this, so a new
 * port needs no print CSS of its own.
 *
 * Mounted == armed: the body class sits for the component's whole life, the same
 * way the hand-built print modals keep theirs while open. Pass `onPrinted` to print
 * straight away (the designer's test print); otherwise the caller runs
 * `window.print()` itself.
 */
export default function TemplatePrintPortal({ layout, ctx, docType, bandOverrides, onPrinted }: {
    layout: PrintLayout;
    ctx: PrintContext;
    docType: string;
    bandOverrides?: BandVisibilityOverrides;
    onPrinted?: () => void;
}) {
    const cssSize = paperCssSize(layout.paper);
    const marginMm = layout.paper.marginMm ?? 8;

    useEffect(() => {
        document.body.classList.add('tpl-print-active');
        const el = document.createElement('style');
        el.setAttribute('data-tpl-print-page', '');
        el.textContent = `@media print { @page tplpage { size: ${cssSize}; margin: ${marginMm}mm; } }`;
        document.head.appendChild(el);
        return () => {
            el.remove();
            document.body.classList.remove('tpl-print-active');
        };
    }, [cssSize, marginMm]);

    useEffect(() => {
        if (!onPrinted) return;
        window.addEventListener('afterprint', onPrinted, { once: true });
        // One frame, so the portal is painted before the print dialog snapshots it.
        const t = window.setTimeout(() => window.print(), 60);
        return () => {
            window.clearTimeout(t);
            window.removeEventListener('afterprint', onPrinted);
        };
    }, [onPrinted]);

    return createPortal(
        <div className="tpl-print-portal" style={{ position: 'fixed', left: '-9999px', top: 0 }}>
            <div style={{ background: '#fff', width: '100%', display: 'flex', flexDirection: 'column' }}>
                <TemplateRenderer layout={layout} ctx={ctx} docType={docType} bandOverrides={bandOverrides} />
            </div>
        </div>,
        document.body,
    );
}
