'use client';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import TemplateRenderer, { type BandVisibilityOverrides } from './TemplateRenderer';
import { paperCssSize, paperDimsMm } from './paper';
import type { PrintLayout } from './types';
import type { PrintContext } from './renderContext';

/**
 * The paper copy of a template document: a body portal that the print CSS
 * (`tpl-print-*` in globals.css) reveals alone, on a named page sized from the
 * layout's own paper. Any doc type that prints from a template uses this, so a new
 * port needs no print CSS of its own.
 *
 * `pages` prints one copy of the layout per context, each on its own sheet — a
 * label run (one card per bag, lot or carton). Each page is held to the sheet's
 * printable height so a card's bottom band (the flexible spacer) lands at the foot.
 *
 * Mounted == armed: the body class sits for the component's whole life, the same
 * way the hand-built print modals keep theirs while open. Pass `onPrinted` to print
 * straight away (the designer's test print); otherwise the caller runs
 * `window.print()` itself.
 */
export default function TemplatePrintPortal({ layout, ctx, pages, docType, bandOverrides, onPrinted }: {
    layout: PrintLayout;
    /** One document. Ignored when `pages` is given. */
    ctx?: PrintContext;
    /** One sheet per context. */
    pages?: PrintContext[];
    docType: string;
    bandOverrides?: BandVisibilityOverrides;
    onPrinted?: () => void;
}) {
    const cssSize = paperCssSize(layout.paper);
    const marginMm = layout.paper.marginMm ?? 8;
    const { widthMm, heightMm } = paperDimsMm(layout.paper);
    const printableMm = widthMm - marginMm * 2;
    const sheets = pages ?? (ctx ? [ctx] : []);

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
        // Parked off-screen at the printable width. Without a width, a fixed box
        // with only `left` set grows until its 100%-wide tables reach back on screen.
        <div className="tpl-print-portal" style={{ position: 'fixed', left: '-9999px', top: 0, width: `${printableMm}mm` }}>
            {sheets.map((c, i) => (
                <div key={i} style={{
                    background: '#fff', width: '100%', display: 'flex', flexDirection: 'column',
                    ...(pages ? {
                        minHeight: `${heightMm - marginMm * 2 - 0.5}mm`,
                        breakAfter: i < sheets.length - 1 ? 'page' as const : 'auto' as const,
                        breakInside: 'avoid' as const,
                    } : {}),
                }}>
                    <TemplateRenderer layout={layout} ctx={c} docType={docType} bandOverrides={bandOverrides} />
                </div>
            ))}
        </div>,
        document.body,
    );
}
