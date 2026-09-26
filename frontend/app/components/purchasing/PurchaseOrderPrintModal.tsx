'use client';
import React, { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { STATIC_BASE } from '../shared/apiBase';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import TemplatePrintPortal from '../shared/printTemplate/TemplatePrintPortal';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { paperDimsMm } from '../shared/printTemplate/paper';
import { buildPurchaseOrderContext, PURCHASE_ORDER_DOC } from '../shared/printTemplate/doctypes/purchaseOrder';

// The document is a print template (defaults/purchaseOrder.ts, editable in Print
// Layouts). PO fields (SSN, rate, kurs, code, payment, category, VAT, discount,
// notes) live on the PurchaseOrder record; only the signature names and the
// footer-notes toggle are print-time preferences.
interface POPrintSettings {
    preparedBy: string;
    examinedBy: string;
    approvedBy: string;
    showFooterNotes: boolean;
}

const DEFAULT_SETTINGS: POPrintSettings = {
    preparedBy: '',
    examinedBy: '',
    approvedBy: '',
    showFooterNotes: true,
};

const SETTINGS_KEY = 'po_print_settings';

export default function PurchaseOrderPrintModal({
    po, onClose, companyProfile, attributes, partners,
}: {
    po: any;
    onClose: () => void;
    companyProfile: any;
    attributes: any[];
    partners: any[];
}) {

    const [settings, setSettings] = useState<POPrintSettings>(() => {
        try {
            const saved = localStorage.getItem(SETTINGS_KEY);
            return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
        } catch { return DEFAULT_SETTINGS; }
    });

    const update = (patch: Partial<POPrintSettings>) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
    };

    const { itemIndex, printTemplates } = useData() as any;
    const layout = resolveLayout(PURCHASE_ORDER_DOC, printTemplates)!;
    const ctx = useMemo(() => buildPurchaseOrderContext({
        po, partners, itemIndex, attributes, companyProfile,
        companyName: companyProfile?.name,
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
        overrides: settings,
    }), [po, partners, itemIndex, attributes, companyProfile, settings]);
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);
    // The Footer Notes checkbox can only drop the band for this print; when the
    // saved layout already hides it, the checkbox says so instead of lying.
    const footerInLayout = layout.bands.some(b => b.id === 'po_footer_notes' && b.show !== false);
    const bandOverrides = { po_footer_notes: settings.showFooterNotes };

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
                title={`Print Purchase Order — ${po.po_number}`}
                onClose={onClose}
                width="calc(var(--app-vw) * 92 / 100)"
                maxWidth={1120}
                height="calc(var(--app-vh) * 90 / 100)"
                bevel={false}
                modeless
                layoutDocType={PURCHASE_ORDER_DOC}
                layoutSample={{ sample: po.id, q: po.po_number }}
            >
                    {/* Body */}
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                        {/* LEFT — settings panel */}
                        <div style={{ width: 230, minWidth: 230, borderRight: '1px solid #dee2e6', background: '#f8f9fa', padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>

                            <div style={{ fontSize: 10, color: '#555', background: '#eef4ff', border: '1px solid #cfe0ff', padding: '6px 8px' }}>
                                Document fields (SSN, rate, kurs, code, payment, category, VAT, discount, prices &amp; notes) are set on the Purchase Order at creation. Supplier details come from the supplier record.
                            </div>

                            <div>
                                <div style={sectionLabel}>Signatures</div>
                                {([
                                    ['Prepared by', 'preparedBy'],
                                    ['Examined by', 'examinedBy'],
                                    ['Approved by', 'approvedBy'],
                                ] as [string, keyof POPrintSettings][]).map(([label, key]) => (
                                    <div key={key} style={{ marginBottom: 6 }}>
                                        <div style={fieldLabel}>{label}</div>
                                        <input style={fieldInput} value={settings[key] as string} onChange={e => update({ [key]: e.target.value } as any)} />
                                    </div>
                                ))}
                            </div>

                            <hr style={{ margin: 0, borderColor: '#dee2e6' }} />

                            <div>
                                <div style={sectionLabel}>Footer</div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: footerInLayout ? '#111' : '#999', cursor: footerInLayout ? 'pointer' : 'default' }}
                                    title={footerInLayout ? undefined : 'Hidden by the saved print layout — change it in Print Layouts.'}>
                                    <input type="checkbox" disabled={!footerInLayout} checked={footerInLayout && settings.showFooterNotes} onChange={e => update({ showFooterNotes: e.target.checked })} />
                                    Footer Notes
                                </label>
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
                                <TemplateRenderer layout={layout} ctx={ctx} docType={PURCHASE_ORDER_DOC} bandOverrides={bandOverrides} />
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <PrintModalFooter note="Settings saved automatically" onClose={onClose} onPrint={handlePrint} />
            </PrintModalShell>

            <TemplatePrintPortal layout={layout} ctx={ctx} docType={PURCHASE_ORDER_DOC} bandOverrides={bandOverrides} />
        </>
    );
}
