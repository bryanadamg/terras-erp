'use client';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { useData } from '../../context/DataContext';
import { useTheme } from '../../context/ThemeContext';
import KartuKerjaTemplateCard from './KartuKerjaTemplateCard';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { docTypeForWorkCenter } from '../shared/printTemplate/defaults/kartuKerja';
import { paperDimsMm, paperCssSize, paperSizeLabel } from '../shared/printTemplate/paper';
import { fetchDyeingPrintDataMap, isDyeingWorkOrder, type DyeingPrintData } from '../shared/printTemplate/dyeingPrintData';
import { PRINT_FONT } from '../shared/xpTheme';

interface PrintSettings {
    showMaterials: boolean;
    showFillFields: boolean;
    showSignature: boolean;
    headerDepartment: string;
}

const defaultSettings: PrintSettings = {
    showMaterials: true,
    showFillFields: true,
    showSignature: true,
    headerDepartment: '',
};

export default function WOBulkPrintModal({
    selectedWOs,
    manufacturingOrders,
    onClose,
}: {
    selectedWOs: any[];
    manufacturingOrders: any[];
    onClose: () => void;
}) {
    const { companyProfile, attributes, authFetch, printTemplates } = useData() as any;
    const { uiStyle } = useTheme();
    const isClassic = uiStyle === 'classic';

    const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace(/\/api$/, '') + '/api';
    // Bulk print marks every included WO's card in one call.
    const doPrint = () => {
        const ids = selectedWOs.map(w => w.id).filter(Boolean);
        if (ids.length) {
            try {
                authFetch(`${API_BASE}/work-orders/mark-printed-bulk`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids, kind: 'card' }),
                }).catch(() => {});
            } catch { /* noop */ }
        }
        window.addEventListener('afterprint', onClose, { once: true });
        window.print();
    };

    const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
    const [settings, setSettings] = useState<PrintSettings>(() => {
        try {
            const saved = localStorage.getItem('wo_step_print_settings');
            return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
        } catch { return defaultSettings; }
    });

    // n=1 prints as a single A6 card (reusing the wo-step print path); n>=2 as the
    // A4 4-up grid. Keeps one modal for both instead of a separate single-WO modal.
    const isSingle = selectedWOs.length === 1;

    useEffect(() => {
        const cls = isSingle ? 'wo-step-print-active' : 'wo-bulk-print-active';
        document.body.classList.add(cls);
        return () => { document.body.classList.remove(cls); };
    }, [isSingle]);

    // Sheet for the single-card path: whatever the WO's own Kartu Kerja template says,
    // so a custom paper size configured in the print designer is what the printer is
    // actually told to load. The 4-up path is deliberately excluded — that sheet is an
    // A4 carrier holding four cards, not the card's own page.
    const singlePaper = isSingle
        ? resolveLayout(docTypeForWorkCenter(selectedWOs[0]?.work_center_type), printTemplates)?.paper
        : undefined;
    const { widthMm: sheetW, heightMm: sheetH } = paperDimsMm(singlePaper);
    const sheetMargin = singlePaper?.marginMm ?? 6;
    const sheetCss = paperCssSize(singlePaper);

    // globals.css hardcodes `@page wostepcard` as A6/6mm — the factory default. This
    // rule lands in <head> after that stylesheet, so document order lets the template's
    // paper win without the static default having to know about templates at all.
    useEffect(() => {
        if (!isSingle) return;
        const el = document.createElement('style');
        el.setAttribute('data-wo-step-paper', '');
        el.textContent = `@media print {
  @page wostepcard { size: ${sheetCss}; margin: ${sheetMargin}mm; }
  body.wo-step-print-active .wo-step-card,
  body.wo-step-print-active .wo-print-paper-portal .wo-step-card {
    min-height: ${Math.max(0, sheetH - sheetMargin * 2)}mm !important;
  }
}`;
        document.head.appendChild(el);
        return () => { el.remove(); };
    }, [isSingle, sheetCss, sheetH, sheetMargin]);

    useEffect(() => {
        Promise.all(
            selectedWOs.map(wo =>
                // ECC 'M' (not 'H') keeps the module count low (29×29 for a UUID) so each
                // module prints large enough to survive impact/dot-matrix output; width 512
                // gives a crisp raster. Displayed pixelated at 140px in the card (~1mm modules).
                QRCode.toDataURL(wo.id, { margin: 4, width: 512, errorCorrectionLevel: 'M' })
                    .then(url => [wo.id, url] as [string, string])
                    .catch(() => [wo.id, ''] as [string, string])
            )
        ).then(entries => setQrUrls(Object.fromEntries(entries)));
    }, [selectedWOs]);

    // Dyeing cards carry the weighed dose sheet, which needs the WO's bath — one
    // fetch per dyeing WO in the selection (see printTemplate/dyeingPrintData.ts).
    // `dyeLoading` gates the Print button: the band hides itself when the data has
    // not landed, so printing early would silently hand the vessel a card with no
    // weights on it.
    const [dyeData, setDyeData] = useState<Record<string, DyeingPrintData>>({});
    const [dyeLoading, setDyeLoading] = useState(false);
    const hasDyeingWO = selectedWOs.some(isDyeingWorkOrder);

    useEffect(() => {
        if (!hasDyeingWO) { setDyeData({}); setDyeLoading(false); return; }
        let cancelled = false;
        setDyeLoading(true);
        fetchDyeingPrintDataMap(authFetch, API_BASE, selectedWOs)
            .then(map => { if (!cancelled) setDyeData(map); })
            .finally(() => { if (!cancelled) setDyeLoading(false); });
        return () => { cancelled = true; };
    }, [selectedWOs, hasDyeingWO, authFetch, API_BASE]);

    // Which of the sidebar's band checkboxes actually do anything for this selection.
    // A checkbox can only *drop* a band, never add one back (see TemplateRenderer), so
    // one pointing at a band the saved layout already hides is a dead control — and a
    // ticked dead control is indistinguishable from "the designer's change was ignored".
    const bandVisibleInTemplate = (bandId: string) => selectedWOs.some(wo => {
        const layout = resolveLayout(docTypeForWorkCenter(wo?.work_center_type), printTemplates);
        return !!layout?.bands.some(b => b.id === bandId && b.show !== false);
    });
    const materialsInTemplate = bandVisibleInTemplate('materials');
    const signatureInTemplate = bandVisibleInTemplate('signature');

    const update = (patch: Partial<PrintSettings>) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        try { localStorage.setItem('wo_step_print_settings', JSON.stringify(next)); } catch {}
    };

    const renderCard = (wo: any, forPortal: boolean) => {
        const parentMO = manufacturingOrders.find(m => m.id === wo.mo_id);
        return (
            <div key={wo.id} style={{
                border: '1px solid #888',
                padding: '4mm',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                background: '#fff',
                breakInside: 'avoid' as any,
            }}>
                <KartuKerjaTemplateCard
                    workOrder={wo}
                    parentMO={parentMO}
                    qrDataUrl={qrUrls[wo.id] || ''}
                    settings={settings}
                    companyName={companyProfile?.name}
                    attributes={attributes}
                    templates={printTemplates}
                    dyeing={dyeData[String(wo.id)] || null}
                />
            </div>
        );
    };

    // Group into pages of 4
    const pages: any[][] = [];
    for (let i = 0; i < selectedWOs.length; i += 4) {
        pages.push(selectedWOs.slice(i, i + 4));
    }

    return (
        <>
            <PrintModalShell modeless title={isSingle ? `Print Kartu Kerja — ${selectedWOs[0].name}` : `Bulk Print Kartu Kerja — ${selectedWOs.length} WO`} onClose={onClose} width={isSingle ? 'calc(var(--app-vw) * 90 / 100)' : 'calc(var(--app-vw) * 92 / 100)'} maxWidth={isSingle ? 880 : undefined} height={isSingle ? 'calc(var(--app-vh) * 88 / 100)' : 'calc(var(--app-vh) * 90 / 100)'}>
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                        {/* Settings panel */}
                        <div style={{ width: '200px', minWidth: '200px', borderRight: '1px solid #dee2e6', background: '#f8f9fa', padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <div>
                                <div style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#212529', letterSpacing: '0.5px', marginBottom: '6px' }}>Sections</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                    <label
                                        title={materialsInTemplate ? undefined : 'Hidden by the saved print layout — change it in Print Layouts.'}
                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: materialsInTemplate ? '#212529' : '#adb5bd', cursor: materialsInTemplate ? 'pointer' : 'default' }}
                                    >
                                        <input type="checkbox" disabled={!materialsInTemplate} checked={materialsInTemplate && settings.showMaterials} onChange={e => update({ showMaterials: e.target.checked })} />
                                        Step Materials
                                    </label>
                                    <label
                                        title={signatureInTemplate ? undefined : 'Hidden by the saved print layout — change it in Print Layouts.'}
                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: signatureInTemplate ? '#212529' : '#adb5bd', cursor: signatureInTemplate ? 'pointer' : 'default' }}
                                    >
                                        <input type="checkbox" disabled={!signatureInTemplate} checked={signatureInTemplate && settings.showSignature} onChange={e => update({ showSignature: e.target.checked })} />
                                        Signature Line
                                    </label>
                                </div>
                            </div>
                            <hr style={{ margin: '0', borderColor: '#dee2e6' }} />
                            <div>
                                <div style={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#212529', letterSpacing: '0.5px', marginBottom: '6px' }}>Header</div>
                                <div style={{ fontSize: '10px', color: '#212529', marginBottom: '3px', fontWeight: '500' }}>Department</div>
                                <input
                                    type="text"
                                    value={settings.headerDepartment}
                                    onChange={e => update({ headerDepartment: e.target.value })}
                                    style={{ width: '100%', fontSize: '11px', padding: '3px 6px', border: '1px solid #ced4da', boxSizing: 'border-box', color: '#000' }}
                                    placeholder="e.g. Produksi"
                                />
                            </div>
                            <div style={{ fontSize: '10px', color: '#888', marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid #dee2e6' }}>
                                {isSingle
                                    ? `One ${paperSizeLabel(singlePaper)} card (${sheetW} x ${sheetH}mm).`
                                    : '4 cards per A4.'} Materials show only lines assigned to each WO's routing step.
                            </div>
                        </div>

                        {/* Preview */}
                        {isSingle ? (
                            /* Single WO — the template's own sheet at true size, page margin drawn
                               as padding so the preview matches the printout millimetre for
                               millimetre; one WO never wastes 3/4 of an A4 sheet. */
                            <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: '16px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                                <div className="wo-print-paper wo-step-card" style={{ background: '#fff', width: `${sheetW}mm`, minHeight: `${sheetH}mm`, padding: `${sheetMargin}mm`, boxShadow: '0 2px 10px rgba(0,0,0,0.25)', color: '#000', fontFamily: PRINT_FONT, display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
                                    <KartuKerjaTemplateCard
                                        workOrder={selectedWOs[0]}
                                        parentMO={manufacturingOrders.find(m => m.id === selectedWOs[0].mo_id)}
                                        qrDataUrl={qrUrls[selectedWOs[0].id] || ''}
                                        settings={settings}
                                        companyName={companyProfile?.name}
                                        attributes={attributes}
                                        templates={printTemplates}
                                        dyeing={dyeData[String(selectedWOs[0].id)] || null}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div style={{ flex: 1, background: '#ccc', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
                                {pages.map((pageWOs, pi) => (
                                    <div key={pi}>
                                        <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px', textAlign: 'center' }}>
                                            Page {pi + 1} of {pages.length}
                                        </div>
                                        {/* Real A4 portrait page (210×297mm → 794×1123px @96dpi) with the
                                            same 8mm margin / 4mm gutter / 2×2 grid as @page print CSS, so the
                                            preview is geometrically identical to the printout — cards sit in the
                                            top half and content fits the A6 quarter without cropping. */}
                                        <div style={{ background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.3)', width: '210mm', height: '297mm', padding: '8mm', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: '4mm', flex: 1, minHeight: 0 }}>
                                                {pageWOs.map(wo => renderCard(wo, false))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Held while the dye bath loads: the dose band hides itself until
                        the data lands, and a card printed in that window would reach
                        the vessel with no weights on it. */}
                    <PrintModalFooter
                        onClose={onClose}
                        onPrint={doPrint}
                        printDisabled={dyeLoading}
                        printLabel={dyeLoading ? 'Loading doses...' : 'Print'}
                        note={dyeLoading ? 'Weighing the dye recipe against each bath...' : undefined}
                    />
            </PrintModalShell>

            {isSingle
                ? createPortal(
                    /* Single WO — A6 portal (wo-step CSS), no A4 4-up grouping. */
                    <div className="wo-print-paper-portal" style={{ display: 'none' }}>
                        <div className="wo-print-paper wo-step-card" style={{ background: '#fff', width: '100%', color: '#000', fontFamily: PRINT_FONT, display: 'flex', flexDirection: 'column' }}>
                            <KartuKerjaTemplateCard
                                workOrder={selectedWOs[0]}
                                parentMO={manufacturingOrders.find(m => m.id === selectedWOs[0].mo_id)}
                                qrDataUrl={qrUrls[selectedWOs[0].id] || ''}
                                settings={settings}
                                companyName={companyProfile?.name}
                                attributes={attributes}
                                templates={printTemplates}
                                dyeing={dyeData[String(selectedWOs[0].id)] || null}
                            />
                        </div>
                    </div>,
                    document.body
                )
                : createPortal(
                    <div className="wo-bulk-print-portal" style={{ display: 'none' }}>
                        {pages.map((pageWOs, pi) => (
                            <div key={pi} className="wo-bulk-page-group">
                                {pageWOs.map(wo => renderCard(wo, true))}
                            </div>
                        ))}
                    </div>,
                    document.body
                )}
        </>
    );
}
