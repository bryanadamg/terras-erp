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
import { buildDyeRecipeContext, DYE_RECIPE_DOC } from '../shared/printTemplate/doctypes/dyeRecipe';

// The Kartu Celup is a print template (defaults/dyeRecipe.ts, editable in Print
// Layouts). The section checkboxes drop a band for this one print only.

interface RecipeLine {
    id: string;
    chemical_type: string;
    item_name: string | null;
    qty_per_liter: number | null;
    qty_per_100kg: number | null;
    uom_name: string | null;
    sort_order: number;
}

interface WashBath {
    bath_number: number;
    description: string;
}

interface FinishingStep {
    description: string;
    sort_order: number;
}

interface DyeRecipeForPrint {
    id: string;
    code: string;
    name: string;
    color_standard: string | null;
    substrate_type: string | null;
    notes: string | null;
    lines: RecipeLine[];
    wash_baths: WashBath[];
    finishing_steps: FinishingStep[];
}

interface Props {
    recipe: DyeRecipeForPrint;
    onClose: () => void;
}

const HIDDEN_BY_LAYOUT = 'Hidden by the saved print layout — change it in Print Layouts.';

export default function DyeRecipePrintView({ recipe, onClose }: Props) {
    const { companyProfile, printTemplates } = useData() as any;
    const { formatCustom: tzFmt } = useTimezone();

    const [showWashBaths, setShowWashBaths] = useState(true);
    const [showFinishing, setShowFinishing] = useState(true);
    const [showSignature, setShowSignature] = useState(true);

    const layout = resolveLayout(DYE_RECIPE_DOC, printTemplates)!;
    const ctx = useMemo(() => buildDyeRecipeContext({
        recipe, companyProfile, tzFormatCustom: tzFmt,
        companyName: companyProfile?.name,
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
    }), [recipe, companyProfile, tzFmt]);
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);

    const inLayout = (id: string) => layout.bands.some(b => b.id === id && b.show !== false);
    const washInLayout = inLayout('dr_wash_baths');
    const finishingInLayout = inLayout('dr_finishing');
    const signatureInLayout = inLayout('dr_signature');
    const hasWash = recipe.wash_baths.length > 0;
    const hasFinishing = recipe.finishing_steps.length > 0;
    const bandOverrides = {
        dr_wash_baths: showWashBaths && hasWash,
        dr_finishing: showFinishing && hasFinishing,
        dr_signature: showSignature,
    };

    // ── Theme-aware chrome styles ─────────────────────────────────────────────
    const sectionLabelStyle: React.CSSProperties = { fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#212529', letterSpacing: '0.5px', marginBottom: '6px' };
    const toggleLabelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#212529', cursor: 'pointer' };

    return (
        <>
            <PrintModalShell
                modeless
                title={`Kartu Celup — ${recipe.code} ${recipe.name}`}
                onClose={onClose}
                width="calc(var(--app-vw) * 92 / 100)"
                maxWidth={1100}
                height="calc(var(--app-vh) * 90 / 100)"
                layoutDocType={DYE_RECIPE_DOC}
                layoutSample={{ sample: recipe.id, q: recipe.code }}
            >
                    {/* Body: settings + preview */}
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                        {/* LEFT: settings panel */}
                        <div style={{ width: 200, minWidth: 200, borderRight: '1px solid #dee2e6', background: '#f8f9fa', padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <div>
                                <div style={sectionLabelStyle}>Sections</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    <label style={{ ...toggleLabelStyle, opacity: 0.5 }}>
                                        <input type="checkbox" checked disabled />
                                        Header <span style={{ fontSize: 10, color: '#555' }}>(always on)</span>
                                    </label>
                                    <label style={{ ...toggleLabelStyle, opacity: 0.5 }}>
                                        <input type="checkbox" checked disabled />
                                        Chemicals <span style={{ fontSize: 10, color: '#555' }}>(always on)</span>
                                    </label>
                                    <label style={{ ...toggleLabelStyle, opacity: hasWash && washInLayout ? 1 : 0.4 }} title={washInLayout ? undefined : HIDDEN_BY_LAYOUT}>
                                        <input type="checkbox" checked={showWashBaths && washInLayout} disabled={!hasWash || !washInLayout} onChange={e => setShowWashBaths(e.target.checked)} />
                                        Bak Cuci
                                    </label>
                                    <label style={{ ...toggleLabelStyle, opacity: hasFinishing && finishingInLayout ? 1 : 0.4 }} title={finishingInLayout ? undefined : HIDDEN_BY_LAYOUT}>
                                        <input type="checkbox" checked={showFinishing && finishingInLayout} disabled={!hasFinishing || !finishingInLayout} onChange={e => setShowFinishing(e.target.checked)} />
                                        Finishing
                                    </label>
                                    <label style={{ ...toggleLabelStyle, opacity: signatureInLayout ? 1 : 0.4 }} title={signatureInLayout ? undefined : HIDDEN_BY_LAYOUT}>
                                        <input type="checkbox" checked={showSignature && signatureInLayout} disabled={!signatureInLayout} onChange={e => setShowSignature(e.target.checked)} />
                                        Signature Lines
                                    </label>
                                </div>
                            </div>
                            <div style={{ fontSize: 10, color: '#555', marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #dee2e6' }}>
                                Paper size, margins and layout are set in Print Layouts.
                            </div>
                        </div>

                        {/* RIGHT: live preview */}
                        <div style={{ flex: 1, background: '#e0e0e0', overflow: 'auto', padding: 16, display: 'flex', alignItems: 'flex-start' }}>
                            {/* True size; auto margins centre it without clipping when wider than the pane. */}
                            <div style={{
                                background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                                width: `${paperW}mm`, minHeight: `${paperH}mm`, padding: `${layout.paper.marginMm}mm`,
                                boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                            }}>
                                <TemplateRenderer layout={layout} ctx={ctx} docType={DYE_RECIPE_DOC} bandOverrides={bandOverrides} />
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <PrintModalFooter onClose={onClose} onPrint={() => { window.addEventListener('afterprint', onClose, { once: true }); window.print(); }} />
            </PrintModalShell>

            <TemplatePrintPortal layout={layout} ctx={ctx} docType={DYE_RECIPE_DOC} bandOverrides={bandOverrides} />
        </>
    );
}
