'use client';
import React, { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { STATIC_BASE } from '../shared/apiBase';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import TemplatePrintPortal from '../shared/printTemplate/TemplatePrintPortal';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { paperDimsMm } from '../shared/printTemplate/paper';
import { buildSalesOrderContext, SALES_ORDER_DOC } from '../shared/printTemplate/doctypes/salesOrder';

// The document is a print template (defaults/salesOrder.ts, editable in Print
// Layouts). The names typed here and the Attention toggle are print-time only.

interface SOPrintSettings {
    preparedBy: string;
    attn: string;
    attnRole: string;
    showAttentionNotes: boolean;
}

const DEFAULT_SETTINGS: SOPrintSettings = {
    preparedBy: '',
    attn: '',
    attnRole: '',
    showAttentionNotes: true,
};

const SETTINGS_KEY = 'so_print_settings';

export default function SalesPrintModal({
    so, onClose, companyProfile, attributes, partners,
}: {
    so: any;
    onClose: () => void;
    companyProfile: any;
    attributes: any[];
    partners: any[];
}) {

    const [settings, setSettings] = useState<SOPrintSettings>(() => {
        try {
            const saved = localStorage.getItem(SETTINGS_KEY);
            return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
        } catch { return DEFAULT_SETTINGS; }
    });

    const update = (patch: Partial<SOPrintSettings>) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
    };

    const { itemIndex, printTemplates } = useData() as any;
    const layout = resolveLayout(SALES_ORDER_DOC, printTemplates)!;
    const ctx = useMemo(() => buildSalesOrderContext({
        so, partners, itemIndex, attributes, companyProfile,
        companyName: companyProfile?.name,
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
        overrides: settings,
    }), [so, partners, itemIndex, attributes, companyProfile, settings]);
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);
    // The checkbox can only drop the band for this print; when the saved layout
    // already hides it, the checkbox says so instead of lying.
    const attentionInLayout = layout.bands.some(b => b.id === 'so_attention' && b.show !== false);
    const bandOverrides = { so_attention: settings.showAttentionNotes };

    const handlePrint = () => {
        const handler = () => onClose();
        window.addEventListener('afterprint', handler, { once: true });
        window.print();
    };

    const sectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase' as const, color: '#111', letterSpacing: '0.5px', marginBottom: 6 };
    const fieldLabel: React.CSSProperties = { fontSize: 10, color: '#111', marginBottom: 3, fontWeight: 500 };
    const fieldInput: React.CSSProperties = { width: '100%', fontSize: 11, padding: '3px 6px', border: '1px solid #ced4da', boxSizing: 'border-box' as const, color: '#000' };

    return (
        <>
            <PrintModalShell
                title={`Print Sales Order Confirmation — ${so.po_number}`}
                onClose={onClose}
                width="calc(var(--app-vw) * 92 / 100)"
                maxWidth={1100}
                height="calc(var(--app-vh) * 90 / 100)"
                bevel={false}
                modeless
                layoutDocType={SALES_ORDER_DOC}
                layoutSample={{ sample: so.id, q: so.po_number }}
            >
                    {/* Body */}
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                        {/* LEFT — settings panel */}
                        <div style={{ width: 210, minWidth: 210, borderRight: '1px solid #dee2e6', background: '#f8f9fa', padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

                            <div>
                                <div style={sectionLabel}>Sections</div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: attentionInLayout ? '#111' : '#999', cursor: attentionInLayout ? 'pointer' : 'default' }}
                                    title={attentionInLayout ? undefined : 'Hidden by the saved print layout — change it in Print Layouts.'}>
                                    <input type="checkbox" disabled={!attentionInLayout} checked={attentionInLayout && settings.showAttentionNotes} onChange={e => update({ showAttentionNotes: e.target.checked })} />
                                    Attention Notes
                                </label>
                            </div>

                            <hr style={{ margin: 0, borderColor: '#dee2e6' }} />

                            <div>
                                <div style={sectionLabel}>Prepared By</div>
                                <div style={fieldLabel}>Name</div>
                                <input style={fieldInput} value={settings.preparedBy} onChange={e => update({ preparedBy: e.target.value })} placeholder="e.g. Firman" />
                            </div>

                            <hr style={{ margin: 0, borderColor: '#dee2e6' }} />

                            <div>
                                <div style={sectionLabel}>Attention (Customer)</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div>
                                        <div style={fieldLabel}>Name</div>
                                        <input style={fieldInput} value={settings.attn} onChange={e => update({ attn: e.target.value })} placeholder="e.g. AMIAO" />
                                    </div>
                                    <div>
                                        <div style={fieldLabel}>Title / Role</div>
                                        <input style={fieldInput} value={settings.attnRole} onChange={e => update({ attnRole: e.target.value })} placeholder="e.g. OWNER" />
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
                                <TemplateRenderer layout={layout} ctx={ctx} docType={SALES_ORDER_DOC} bandOverrides={bandOverrides} />
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <PrintModalFooter note="Settings saved automatically" onClose={onClose} onPrint={handlePrint} />
            </PrintModalShell>

            <TemplatePrintPortal layout={layout} ctx={ctx} docType={SALES_ORDER_DOC} bandOverrides={bandOverrides} />
        </>
    );
}
