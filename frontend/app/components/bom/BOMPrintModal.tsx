'use client';
import React, { useState, useMemo } from 'react';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { useTimezone } from '../../context/TimezoneContext';
import { useData } from '../../context/DataContext';
import { STATIC_BASE } from '../shared/apiBase';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import TemplatePrintPortal from '../shared/printTemplate/TemplatePrintPortal';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { paperDimsMm } from '../shared/printTemplate/paper';
import { buildBomSheetContext, bomSheetPresence, BOM_SHEET_DOC } from '../shared/printTemplate/doctypes/bomSheet';

// The document is a print template (defaults/bomSheet.ts, editable in Print
// Layouts). The toggles and the header note here are print-time only.

interface BOMPrintSettings {
    showComponents: boolean;
    showMeasurements: boolean;
    showSizes: boolean;
    showDetailTeknis: boolean;
    showSamplePhoto: boolean;
    showDesignFile: boolean;
    showSignatureLine: boolean;
    headerNote: string;
}

const DEFAULT_SETTINGS: BOMPrintSettings = {
    showComponents: true,
    showMeasurements: true,
    showSizes: true,
    showDetailTeknis: true,
    showSamplePhoto: true,
    showDesignFile: true,
    showSignatureLine: false,
    headerNote: '',
};

const HIDDEN_TIP = 'Hidden by the saved print layout — change it in Print Layouts.';

interface Props {
    bom: any;
    companyProfile: any;
    getAttributeValueName: (id: string) => string;
    onClose: () => void;
}

export default function BOMPrintModal({ bom, companyProfile, getAttributeValueName, onClose }: Props) {
    const [settings, setSettings] = useState<BOMPrintSettings>(() => {
        try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('bom_print_settings') || '{}') }; }
        catch { return DEFAULT_SETTINGS; }
    });

    const update = (patch: Partial<BOMPrintSettings>) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        try { localStorage.setItem('bom_print_settings', JSON.stringify(next)); } catch {}
    };

    const { printTemplates } = useData() as any;
    const { formatCustom: tzFmt } = useTimezone();
    const layout = resolveLayout(BOM_SHEET_DOC, printTemplates)!;
    const ctx = useMemo(() => buildBomSheetContext({
        bom, getAttributeValueName, companyProfile, tzFormatCustom: tzFmt,
        companyName: companyProfile?.name,
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
        overrides: { headerNote: settings.headerNote, showSignatureLine: settings.showSignatureLine },
    }), [bom, getAttributeValueName, companyProfile, tzFmt, settings.headerNote, settings.showSignatureLine]);
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);

    const has = bomSheetPresence(bom);
    // A checkbox can only drop its band for this print; when the saved layout
    // already hides the band, the checkbox says so instead of lying. Sections the
    // BOM has no data for drop out, as they did on the hand-built sheet.
    const inLayout = (id: string) => layout.bands.some(b => b.id === id && b.show !== false);
    const bandOverrides = {
        bs_teknis: settings.showDetailTeknis && has.teknis,
        bs_measurements: settings.showMeasurements,
        bs_sizes: settings.showSizes,
        bs_components: settings.showComponents,
        bs_photo: settings.showSamplePhoto && has.samplePhoto,
        bs_design: settings.showDesignFile && has.designFile,
    };

    const handlePrint = () => {
        window.addEventListener('afterprint', onClose, { once: true });
        window.print();
    };

    // ── Styles ──────────────────────────────────────────────────────────────────
    const sectionLabelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', color: '#212529', letterSpacing: '0.5px', marginBottom: 6 };
    const toggleLabelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#212529', cursor: 'pointer' };
    const fieldLabelStyle: React.CSSProperties = { fontSize: 10, color: '#212529', marginBottom: 3, fontWeight: 500 };
    const fieldInputStyle: React.CSSProperties = { width: '100%', fontSize: 11, padding: '3px 6px', border: '1px solid #ced4da', boxSizing: 'border-box' };

    // Disabled when the BOM has nothing for the section, or the saved layout hides it.
    const sectionToggle = (label: string, band: string, hasData: boolean, key: keyof BOMPrintSettings, suffix?: React.ReactNode) => {
        const shown = inLayout(band);
        const enabled = hasData && shown;
        return (
            <label key={key} style={{ ...toggleLabelStyle, opacity: enabled ? 1 : 0.4, cursor: enabled ? 'pointer' : 'default' }}
                title={shown ? undefined : HIDDEN_TIP}>
                <input type="checkbox" checked={shown && (settings[key] as boolean)} disabled={!enabled}
                    onChange={e => update({ [key]: e.target.checked })} />
                {label}
                {suffix}
            </label>
        );
    };

    return (
        <>
            <PrintModalShell
                modeless
                title={`Print BOM — ${bom.code}`}
                onClose={onClose}
                width="calc(var(--app-vw) * 92 / 100)"
                maxWidth={1100}
                height="calc(var(--app-vh) * 88 / 100)"
                layoutDocType={BOM_SHEET_DOC}
                layoutSample={{ sample: bom.id, q: bom.code }}
            >
                    {/* Body */}
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                        {/* LEFT: settings */}
                        <div style={{ width: 210, minWidth: 210, borderRight: '1px solid #dee2e6', background: '#f8f9fa', padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

                            <div>
                                <div style={sectionLabelStyle}>Sections</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    <label style={{ ...toggleLabelStyle, opacity: 0.5 }}>
                                        <input type="checkbox" checked disabled />
                                        BOM Identity <span style={{ fontSize: 10, color: '#555' }}>(always on)</span>
                                    </label>
                                    {sectionToggle('Detail Teknis', 'bs_teknis', has.teknis, 'showDetailTeknis')}
                                    {sectionToggle('Measurements', 'bs_measurements', has.measurements, 'showMeasurements')}
                                    {sectionToggle('Size Measurements', 'bs_sizes', has.sizes, 'showSizes')}
                                    {sectionToggle('Components', 'bs_components', has.components, 'showComponents')}
                                </div>
                            </div>

                            <hr style={{ margin: 0, borderColor: '#dee2e6' }} />

                            <div>
                                <div style={sectionLabelStyle}>Attachments</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    {sectionToggle('Sample Photo', 'bs_photo', has.samplePhoto, 'showSamplePhoto')}
                                    {sectionToggle('Design / Rumusan', 'bs_design', has.designFile, 'showDesignFile',
                                        has.designPdf ? <span style={{ fontSize: 9, color: '#888' }}>(PDF note)</span> : null)}
                                    <label style={toggleLabelStyle}>
                                        <input type="checkbox" checked={settings.showSignatureLine}
                                            onChange={e => update({ showSignatureLine: e.target.checked })} />
                                        Signature Line
                                    </label>
                                </div>
                            </div>

                            <hr style={{ margin: 0, borderColor: '#dee2e6' }} />

                            <div>
                                <div style={sectionLabelStyle}>Print Note</div>
                                <div style={fieldLabelStyle}>Optional note on header</div>
                                <textarea
                                    value={settings.headerNote}
                                    onChange={e => update({ headerNote: e.target.value })}
                                    rows={3}
                                    style={{ ...fieldInputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                                    placeholder="e.g. Rev. 2 / For approval..."
                                />
                            </div>

                            <div style={{ fontSize: 10, color: '#555', marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #dee2e6' }}>
                                Settings saved automatically. Paper size, margins and layout are set in Print Layouts.
                            </div>
                        </div>

                        {/* RIGHT: live preview */}
                        <div style={{ flex: 1, background: '#d8d8d8', overflow: 'auto', padding: 16, display: 'flex', alignItems: 'flex-start' }}>
                            {/* True size; auto margins centre it without clipping when wider than the pane. */}
                            <div style={{
                                background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                                width: `${paperW}mm`, minHeight: `${paperH}mm`, padding: `${layout.paper.marginMm}mm`,
                                boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                            }}>
                                <TemplateRenderer layout={layout} ctx={ctx} docType={BOM_SHEET_DOC} bandOverrides={bandOverrides} />
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <PrintModalFooter note="Settings saved automatically." onClose={onClose} onPrint={handlePrint} />

            </PrintModalShell>

            <TemplatePrintPortal layout={layout} ctx={ctx} docType={BOM_SHEET_DOC} bandOverrides={bandOverrides} />
        </>
    );
}
