'use client';
import React, { useEffect, useMemo, useState } from 'react';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { useTimezone } from '../../context/TimezoneContext';
import { useData } from '../../context/DataContext';
import { API_BASE, STATIC_BASE } from '../shared/apiBase';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import TemplatePrintPortal from '../shared/printTemplate/TemplatePrintPortal';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { paperDimsMm } from '../shared/printTemplate/paper';
import { buildMoSheetContext, moSheetPresence, MO_SHEET_DOC } from '../shared/printTemplate/doctypes/moSheet';

// The document is a print template (defaults/moSheet.ts, editable in Print
// Layouts). The toggles and header fields here are print-time only; the caller
// owns and persists them.

export interface PrintSettings {
    showBOMTable: boolean;
    showTimeline: boolean;
    showChildMOs: boolean;
    showSignatureLine: boolean;
    showTechnicalFields: boolean;
    showFillFields: boolean;
    showSamplePhoto: boolean;
    headerCompanyName: string;
    headerDepartment: string;
    headerApprovedBy: string;
    headerReference: string;
}

const HIDDEN_TIP = 'Hidden by the saved print layout — change it in Print Layouts.';

export default function MOPrintModal({
    mo: moProp,
    onClose,
    printSettings,
    onPrintSettingsChange,
    companyProfile,
    boms,
    getItemName,
    getItemCode,
    getLocationName,
    getAttributeValueName,
    formatDate,
    hideChildMOs = false,
    onPrint,
}: {
    mo: any;
    onClose: () => void;
    printSettings: PrintSettings;
    onPrintSettingsChange: (updated: PrintSettings) => void;
    companyProfile: any;
    boms: any[];
    getItemName: (id: any) => string;
    getItemCode: (id: any) => string;
    getLocationName: (id: any) => string;
    getAttributeValueName: (id: any) => string;
    formatDate: (d: any) => string;
    hideChildMOs?: boolean;
    onPrint?: () => void;
}) {
    const {
        showBOMTable, showTimeline, showChildMOs: showChildMOsSetting,
        showSignatureLine, showTechnicalFields, showSamplePhoto,
        headerCompanyName, headerDepartment, headerApprovedBy, headerReference,
    } = printSettings;
    const showChildMOs = hideChildMOs ? false : showChildMOsSetting;

    const update = (patch: Partial<PrintSettings>) =>
        onPrintSettingsChange({ ...printSettings, ...patch });

    const { printTemplates, attributes, authFetch } = useData() as any;

    // A shared component MO (the greige) reaches here from the Production Runs
    // list's slim rows, which carry no BOM — the sheet printed "No BOM found" with
    // no machine or specs. Load the full order when the BOM is missing, or when the
    // order has no SO of its own — the single-MO read resolves its roots' SO + customer.
    const [fullMO, setFullMO] = useState<any>(null);
    const needsLoad = !!moProp?.id && (!moProp?.bom || !moProp?.sales_order_id);
    useEffect(() => {
        setFullMO(null);
        if (!needsLoad) return;
        let cancelled = false;
        authFetch(`${API_BASE}/manufacturing-orders/${moProp.id}`)
            .then((r: Response) => (r.ok ? r.json() : null))
            .then((m: any) => { if (!cancelled && m) setFullMO(m); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [moProp?.id, needsLoad, authFetch]);
    const mo = fullMO || moProp;
    const loadingMO = needsLoad && !fullMO;
    const { formatCustom: tzFmt } = useTimezone();
    const layout = resolveLayout(MO_SHEET_DOC, printTemplates)!;
    const ctx = useMemo(() => buildMoSheetContext({
        mo, attributes, getItemName, getItemCode, getLocationName, getAttributeValueName, formatDate,
        // "Hide children" also stops the material list walking into sub-BOMs.
        boms: hideChildMOs ? [] : boms,
        tzFormatCustom: tzFmt, companyProfile,
        companyName: headerCompanyName || companyProfile?.name || '',
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
        overrides: { headerDepartment, headerApprovedBy, headerReference, showTimeline, showSignatureLine },
    }), [mo, attributes, getItemName, getItemCode, getLocationName, getAttributeValueName, formatDate, hideChildMOs, boms, tzFmt,
        companyProfile, headerCompanyName, headerDepartment, headerApprovedBy, headerReference, showTimeline, showSignatureLine]);
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);

    // The BOM lookup was by the page's list; with children hidden it still is.
    const has = moSheetPresence(mo, boms);
    const inLayout = (id: string) => layout.bands.some(b => b.id === id && b.show !== false);
    const bandOverrides = {
        ms_materials: showBOMTable,
        ms_tech: showTechnicalFields && has.tech,
        ms_child_mos: showChildMOs,
        ms_photo: showSamplePhoto && has.samplePhoto,
    };

    const sectionLabelStyle: React.CSSProperties = { fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#212529', letterSpacing: '0.5px', marginBottom: '6px' };
    const toggleLabelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#212529', cursor: 'pointer' };
    const fieldLabelStyle: React.CSSProperties = { fontSize: '10px', color: '#212529', marginBottom: '3px', fontWeight: '500' };
    const fieldInputStyle: React.CSSProperties = { width: '100%', fontSize: '11px', padding: '3px 6px', border: '1px solid #ced4da', boxSizing: 'border-box', color: '#000' };

    // Disabled when the order has nothing for the section, or the saved layout hides it.
    const sectionToggle = (label: string, band: string, hasData: boolean, key: keyof PrintSettings) => {
        const shown = inLayout(band);
        const enabled = hasData && shown;
        return (
            <label style={{ ...toggleLabelStyle, opacity: enabled ? 1 : 0.4, cursor: enabled ? 'pointer' : 'default' }}
                title={shown ? undefined : HIDDEN_TIP}>
                <input type="checkbox" checked={shown && (printSettings[key] as boolean)} disabled={!enabled}
                    onChange={e => update({ [key]: e.target.checked } as Partial<PrintSettings>)} />
                {label}
            </label>
        );
    };

    return (
        <>
            <PrintModalShell
                title={`Print SPK Produksi — ${mo.code}`}
                onClose={onClose}
                modeless
                width="calc(var(--app-vw) * 92 / 100)"
                maxWidth={1100}
                height="calc(var(--app-vh) * 90 / 100)"
                layoutDocType={MO_SHEET_DOC}
                layoutSample={{ sample: mo.id, q: mo.code }}
            >
                    {/* Body */}
                    <div style={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden' }}>

                        {/* LEFT: settings */}
                        <div style={{ width: '210px', minWidth: '210px', borderRight: '1px solid #dee2e6', background: '#f8f9fa', padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>

                            <div>
                                <div style={sectionLabelStyle}>Sections</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                    <label style={{ ...toggleLabelStyle, opacity: 0.5 }}>
                                        <input type="checkbox" checked disabled />
                                        Identity <span style={{ fontSize: '10px', color: '#555' }}>(always on)</span>
                                    </label>
                                    {sectionToggle('Materials Table', 'ms_materials', true, 'showBOMTable')}
                                    {sectionToggle('Technical Specs', 'ms_tech', has.tech, 'showTechnicalFields')}
                                    <label style={toggleLabelStyle}>
                                        <input type="checkbox" checked={showTimeline} onChange={e => update({ showTimeline: e.target.checked })} />
                                        Actual Timeline
                                    </label>
                                    {sectionToggle('Sample Photo', 'ms_photo', has.samplePhoto, 'showSamplePhoto')}
                                    {!hideChildMOs && sectionToggle('Child MOs', 'ms_child_mos', true, 'showChildMOs')}
                                    <label style={toggleLabelStyle}>
                                        <input type="checkbox" checked={showSignatureLine} onChange={e => update({ showSignatureLine: e.target.checked })} />
                                        ACC QC Signature
                                    </label>
                                </div>
                            </div>

                            <hr style={{ margin: '0', borderColor: '#dee2e6' }} />

                            <div>
                                <div style={sectionLabelStyle}>Header Fields</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {[
                                        { label: 'Company Name', key: 'headerCompanyName', value: headerCompanyName },
                                        { label: 'Department', key: 'headerDepartment', value: headerDepartment },
                                        { label: 'Approved By', key: 'headerApprovedBy', value: headerApprovedBy },
                                        { label: 'Reference No.', key: 'headerReference', value: headerReference },
                                    ].map(({ label, key, value }) => (
                                        <div key={key}>
                                            <div style={fieldLabelStyle}>{label}</div>
                                            <input type="text" value={value} onChange={e => update({ [key]: e.target.value } as Partial<PrintSettings>)} style={fieldInputStyle} />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div style={{ fontSize: '10px', color: '#555', marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid #dee2e6' }}>
                                Paper size, margins and layout are set in Print Layouts.
                            </div>
                        </div>

                        {/* RIGHT: live preview */}
                        <div style={{ flex: 1, background: '#e0e0e0', overflow: 'auto', padding: '16px', display: 'flex', alignItems: 'flex-start' }}>
                            {/* True size; auto margins centre it without clipping when wider than the pane. */}
                            <div style={{
                                background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                                width: `${paperW}mm`, minHeight: `${paperH}mm`, padding: `${layout.paper.marginMm}mm`,
                                boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                            }}>
                                <TemplateRenderer layout={layout} ctx={ctx} docType={MO_SHEET_DOC} bandOverrides={bandOverrides} />
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <PrintModalFooter
                        note={loadingMO ? 'Loading the order\'s BOM...' : 'Settings saved automatically'}
                        printDisabled={loadingMO}
                        printLabel={loadingMO ? 'Loading...' : undefined}
                        onClose={onClose}
                        onPrint={() => { onPrint?.(); window.addEventListener('afterprint', onClose, { once: true }); window.print(); }}
                    />

            </PrintModalShell>

            <TemplatePrintPortal layout={layout} ctx={ctx} docType={MO_SHEET_DOC} bandOverrides={bandOverrides} />
        </>
    );
}
