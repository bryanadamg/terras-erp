'use client';
import React, { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { useTimezone } from '../../context/TimezoneContext';
import { STATIC_BASE } from '../shared/apiBase';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import TemplatePrintPortal from '../shared/printTemplate/TemplatePrintPortal';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { paperDimsMm } from '../shared/printTemplate/paper';
import { buildSampleRequestContext, SAMPLE_REQUEST_DOC } from '../shared/printTemplate/doctypes/sampleRequest';

// The SPK is a print template (defaults/sampleRequest.ts, editable in Print
// Layouts). The prepared-by name and the section toggles are print-time only.

interface SamplePrintSettings {
    preparedBy: string;
    preparedRole: string;
    showSampleBox: boolean;
    showChecklist: boolean;
}

const DEFAULT_SETTINGS: SamplePrintSettings = {
    preparedBy: '',
    preparedRole: 'Marketing',
    showSampleBox: true,
    showChecklist: true,
};

const SETTINGS_KEY = 'smp_print_settings';
const HIDDEN_BY_LAYOUT = 'Hidden by the saved print layout — change it in Print Layouts.';

export default function SamplePrintModal({
    sample,
    onClose,
    companyProfile,
    getCustomerName,
}: {
    sample: any;
    onClose: () => void;
    companyProfile: any;
    getCustomerName: (id: string) => string;
}) {

    const [settings, setSettings] = useState<SamplePrintSettings>(() => {
        let saved: Partial<SamplePrintSettings> = {};
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) saved = JSON.parse(raw);
        } catch {}
        return {
            ...DEFAULT_SETTINGS,
            ...saved,
            preparedBy: sample?.created_by_name || DEFAULT_SETTINGS.preparedBy,
            preparedRole: sample?.created_by_role || DEFAULT_SETTINGS.preparedRole,
        };
    });

    const update = (patch: Partial<SamplePrintSettings>) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
    };

    const { printTemplates } = useData() as any;
    const { formatCustom: tzFmt } = useTimezone();
    const layout = resolveLayout(SAMPLE_REQUEST_DOC, printTemplates)!;
    const ctx = useMemo(() => buildSampleRequestContext({
        sample,
        customerName: sample.customer_id ? getCustomerName(sample.customer_id) : '',
        companyProfile, tzFormatCustom: tzFmt,
        companyName: companyProfile?.name,
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
        overrides: { preparedBy: settings.preparedBy, preparedRole: settings.preparedRole },
    }), [sample, getCustomerName, companyProfile, tzFmt, settings.preparedBy, settings.preparedRole]);
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);

    // A checkbox can only drop a band for this print; when the saved layout already
    // hides it, the checkbox says so instead of lying.
    const inLayout = (id: string) => layout.bands.some(b => b.id === id && b.show !== false);
    const sampleBoxInLayout = inLayout('sr_sample_box');
    const checklistInLayout = inLayout('sr_checklist');
    const bandOverrides = {
        sr_sample_box_caption: settings.showSampleBox,
        sr_sample_box: settings.showSampleBox,
        // One checklist line per colour — nothing to tick on a colourless request.
        sr_checklist: settings.showChecklist && (sample.colors || []).length > 0,
    };

    // Shared style tokens
    const sectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', color: '#111', letterSpacing: '0.5px', marginBottom: 6 };
    const toggleLabel = (on: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: on ? '#111' : '#999', cursor: on ? 'pointer' : 'default' });
    const fieldLabel: React.CSSProperties = { fontSize: 10, color: '#111', marginBottom: 3, fontWeight: 500 };
    const fieldInput: React.CSSProperties = { width: '100%', fontSize: 11, padding: '3px 6px', border: '1px solid #ced4da', boxSizing: 'border-box' as const, color: '#000' };

    const handlePrint = () => {
        const handler = () => onClose();
        window.addEventListener('afterprint', handler, { once: true });
        window.print();
    };

    return (
        <>
            <PrintModalShell
                title={<><i className="bi bi-printer" style={{ marginRight: 4 }} />Print SPK Sample — {sample.code}</>}
                onClose={onClose}
                modeless
                width="calc(var(--app-vw) * 92 / 100)"
                maxWidth={1100}
                height="calc(var(--app-vh) * 90 / 100)"
                layoutDocType={SAMPLE_REQUEST_DOC}
                layoutSample={{ sample: sample.id, q: sample.code }}
            >
                    {/* Body */}
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                        {/* LEFT — settings */}
                        <div style={{ width: 210, minWidth: 210, borderRight: '1px solid #dee2e6', background: '#f8f9fa', padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

                            <div>
                                <div style={sectionLabel}>Sections</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    <label style={toggleLabel(sampleBoxInLayout)} title={sampleBoxInLayout ? undefined : HIDDEN_BY_LAYOUT}>
                                        <input type="checkbox" disabled={!sampleBoxInLayout} checked={sampleBoxInLayout && settings.showSampleBox} onChange={e => update({ showSampleBox: e.target.checked })} />
                                        Sample Attachment Box
                                    </label>
                                    <label style={toggleLabel(checklistInLayout)} title={checklistInLayout ? undefined : HIDDEN_BY_LAYOUT}>
                                        <input type="checkbox" disabled={!checklistInLayout} checked={checklistInLayout && settings.showChecklist} onChange={e => update({ showChecklist: e.target.checked })} />
                                        Prioritas / Checklist
                                    </label>
                                </div>
                            </div>

                            <hr style={{ margin: 0, borderColor: '#dee2e6' }} />

                            <div>
                                <div style={sectionLabel}>Prepared By</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div>
                                        <div style={fieldLabel}>Name</div>
                                        <input style={fieldInput} value={settings.preparedBy} onChange={e => update({ preparedBy: e.target.value })} placeholder="e.g. Lolita" />
                                    </div>
                                    <div>
                                        <div style={fieldLabel}>Title / Role</div>
                                        <input style={fieldInput} value={settings.preparedRole} onChange={e => update({ preparedRole: e.target.value })} placeholder="e.g. Marketing" />
                                    </div>
                                </div>
                            </div>

                            <div style={{ fontSize: 10, color: '#555', marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #dee2e6' }}>
                                Settings saved automatically. Paper size, margins and layout are set in Print Layouts.
                            </div>
                        </div>

                        {/* RIGHT — live preview */}
                        <div style={{ flex: 1, background: '#e0e0e0', overflow: 'auto', padding: 16, display: 'flex', alignItems: 'flex-start' }}>
                            {/* True size; auto margins centre it without clipping when wider than the pane. */}
                            <div style={{
                                background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                                width: `${paperW}mm`, minHeight: `${paperH}mm`, padding: `${layout.paper.marginMm}mm`,
                                boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                            }}>
                                <TemplateRenderer layout={layout} ctx={ctx} docType={SAMPLE_REQUEST_DOC} bandOverrides={bandOverrides} />
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <PrintModalFooter note="Settings saved automatically" onClose={onClose} onPrint={handlePrint} />

            </PrintModalShell>

            <TemplatePrintPortal layout={layout} ctx={ctx} docType={SAMPLE_REQUEST_DOC} bandOverrides={bandOverrides} />
        </>
    );
}
