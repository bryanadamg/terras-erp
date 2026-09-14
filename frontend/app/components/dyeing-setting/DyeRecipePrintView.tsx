'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '../../context/DataContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { CODE_FONT, PRINT_FONT } from '../shared/xpTheme';
import { useTimezone } from '../../context/TimezoneContext';

const STATIC_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace(/\/api$/, '');

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

export default function DyeRecipePrintView({ recipe, onClose }: Props) {
    const { companyProfile } = useData();
    const { formatCustom: tzFmt } = useTimezone();

    const [showWashBaths, setShowWashBaths] = useState(true);
    const [showFinishing, setShowFinishing] = useState(true);
    const [showSignature, setShowSignature] = useState(true);

    useEffect(() => {
        document.body.classList.add('wo-print-preview-active');
        return () => { document.body.classList.remove('wo-print-preview-active'); };
    }, []);

    const sortedLines = [...recipe.lines].sort((a, b) => a.sort_order - b.sort_order);
    const dyes = sortedLines.filter(l => l.chemical_type === 'DYE');
    const chems = sortedLines.filter(l => l.chemical_type !== 'DYE');
    const allLines = [...dyes, ...chems];

    const today = tzFmt(new Date(), { day: '2-digit', month: '2-digit', year: 'numeric' }, 'id-ID').replace(/\//g, '.');

    // ── Theme-aware chrome styles ─────────────────────────────────────────────
    const sectionLabelStyle: React.CSSProperties = { fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#212529', letterSpacing: '0.5px', marginBottom: '6px' };
    const toggleLabelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#212529', cursor: 'pointer' };

    // Cell styles
    const gridLbl: React.CSSProperties = { background: '#f0f0f0', border: '1px solid #ccc', padding: '2px 6px', fontSize: '8px', color: '#444', fontWeight: 'bold', whiteSpace: 'nowrap' };
    const gridVal: React.CSSProperties = { border: '1px solid #ccc', padding: '2px 6px', fontSize: '8px', color: '#000' };

    // ── Kartu Celup document content ──────────────────────────────────────────
    const documentContent = (
        <div style={{ fontFamily: PRINT_FONT, fontSize: '9px', color: '#000', lineHeight: 1.5 }}>

            {/* Company header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #000', paddingBottom: '6px', marginBottom: '10px' }}>
                <div>
                    {companyProfile?.logo_url ? (
                        <img src={`${STATIC_BASE}${companyProfile.logo_url}`} alt="Logo" style={{ maxHeight: '44px', maxWidth: '160px', objectFit: 'contain', display: 'block', marginBottom: '2px' }} />
                    ) : (
                        <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#003080' }}>{companyProfile?.name || 'PT BOLA INTAN'}</div>
                    )}
                    {companyProfile?.address && <div style={{ fontSize: '7px', color: '#555' }}>{companyProfile.address}</div>}
                    {(companyProfile?.phone || companyProfile?.email) && (
                        <div style={{ fontSize: '7px', color: '#555' }}>{[companyProfile.phone, companyProfile.email].filter(Boolean).join(' · ')}</div>
                    )}
                </div>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '2px' }}>KARTU CELUP</div>
                    <div style={{ fontSize: '7px', color: '#555', marginTop: 2 }}>Tanggal: {today}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '8px', color: '#555' }}>
                    <div style={{ fontFamily: CODE_FONT, fontWeight: 'bold', color: '#000' }}>{recipe.code}</div>
                    {recipe.substrate_type && <div style={{ fontSize: '7px' }}>{recipe.substrate_type}</div>}
                </div>
            </div>

            {/* Job metadata grid */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
                <tbody>
                    <tr>
                        <td style={{ ...gridLbl, width: '16%' }}>Warna</td>
                        <td style={{ ...gridVal, fontWeight: 'bold', width: '34%' }}>{recipe.name}</td>
                        <td style={{ ...gridLbl, width: '16%' }}>Color Matching</td>
                        <td style={{ ...gridVal, width: '34%' }}>{recipe.color_standard ?? '—'}</td>
                    </tr>
                    <tr>
                        <td style={gridLbl}>Nomor PO</td>
                        <td style={gridVal}>&nbsp;</td>
                        <td style={gridLbl}>LOT</td>
                        <td style={gridVal}>&nbsp;</td>
                    </tr>
                    <tr>
                        <td style={gridLbl}>Artikel</td>
                        <td style={gridVal}>{recipe.code}</td>
                        <td style={gridLbl}>Qty Order</td>
                        <td style={gridVal}>&nbsp; KG</td>
                    </tr>
                    <tr>
                        <td style={gridLbl}>Volume Air</td>
                        <td style={gridVal}>&nbsp; Liter</td>
                        <td style={gridLbl}>Customer</td>
                        <td style={gridVal}>&nbsp;</td>
                    </tr>
                    <tr>
                        <td style={gridLbl}>Mesin Celup</td>
                        <td style={gridVal}>&nbsp;</td>
                        <td style={gridLbl}>Tekanan / Speed</td>
                        <td style={gridVal}>&nbsp; / &nbsp;</td>
                    </tr>
                </tbody>
            </table>

            {/* Chemical lines table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: '8px' }}>
                <thead>
                    <tr style={{ background: '#f0f0f0' }}>
                        <th style={{ border: '1px solid #ccc', padding: '2px 4px', width: 20, textAlign: 'center' }}>No</th>
                        <th style={{ border: '1px solid #ccc', padding: '2px 4px', width: 60 }}>Label</th>
                        <th style={{ border: '1px solid #ccc', padding: '2px 4px' }}>Bahan</th>
                        <th style={{ border: '1px solid #ccc', padding: '2px 4px', width: 60, textAlign: 'right' }}>Rate</th>
                        <th style={{ border: '1px solid #ccc', padding: '2px 4px', width: 44, textAlign: 'center' }}>Satuan</th>
                        <th style={{ border: '1px solid #ccc', padding: '2px 4px', width: 14, textAlign: 'center' }}>=</th>
                        <th style={{ border: '1px solid #ccc', padding: '2px 4px', width: 70, textAlign: 'right' }}>Total</th>
                    </tr>
                </thead>
                <tbody>
                    {allLines.map((line, i) => {
                        const dyeIdx = dyes.indexOf(line);
                        const chemIdx = chems.indexOf(line);
                        const label = dyeIdx >= 0 ? `Dyes ${dyeIdx + 1}` : `Chem ${chemIdx + 1}`;
                        const rate = line.qty_per_liter ?? line.qty_per_100kg ?? null;
                        const unit = line.uom_name ?? (line.qty_per_liter != null ? 'g/L' : line.qty_per_100kg != null ? 'g/100kg' : '');
                        return (
                            <tr key={line.id}>
                                <td style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'center', color: '#555' }}>{i + 1}</td>
                                <td style={{ border: '1px solid #ccc', padding: '2px 4px', color: '#555' }}>{label}</td>
                                <td style={{ border: '1px solid #ccc', padding: '2px 4px', fontWeight: 500 }}>{line.item_name ?? '—'}</td>
                                <td style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'right' }}>{rate !== null ? rate : ''}</td>
                                <td style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'center', color: '#555' }}>{unit}</td>
                                <td style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'center', color: '#888' }}>=</td>
                                <td style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'right' }}>&nbsp;</td>
                            </tr>
                        );
                    })}
                    {allLines.length === 0 && (
                        <tr><td colSpan={7} style={{ border: '1px solid #ccc', padding: '4px', color: '#888', textAlign: 'center' }}>No chemical lines</td></tr>
                    )}
                </tbody>
            </table>

            {/* Bak Cuci */}
            {showWashBaths && recipe.wash_baths.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, borderTop: '1px solid #ccc', paddingTop: 4 }}>Bak Cuci</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 24, rowGap: 2 }}>
                        {recipe.wash_baths.map(wb => (
                            <div key={wb.bath_number} style={{ fontSize: '8px' }}>
                                <span style={{ display: 'inline-block', width: 16, fontWeight: 600 }}>{wb.bath_number}</span>
                                <span style={{ marginRight: 4 }}>:</span>
                                {wb.description}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Finishing */}
            {showFinishing && recipe.finishing_steps.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, borderTop: '1px solid #ccc', paddingTop: 4 }}>Finishing</div>
                    {recipe.finishing_steps.map((fs, i) => (
                        <div key={i} style={{ fontSize: '8px' }}>{fs.description}</div>
                    ))}
                </div>
            )}

            {/* Footer / signature */}
            <div style={{ marginTop: 16, borderTop: '1px solid #ccc', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div style={{ fontSize: '7px', color: '#555' }}>
                    <div>Kode: {recipe.code}</div>
                    {recipe.notes && <div>Catatan: {recipe.notes}</div>}
                    <div>Printed: {tzFmt(new Date(), { dateStyle: 'short', timeStyle: 'short' }, 'id-ID')}</div>
                </div>
                {showSignature && (
                    <div style={{ display: 'flex', gap: 32 }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ borderBottom: '1px solid #000', height: 28, width: 100, marginBottom: 2 }} />
                            <div style={{ fontSize: '7px', fontWeight: 'bold' }}>Div Celup</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ borderBottom: '1px solid #000', height: 28, width: 100, marginBottom: 2 }} />
                            <div style={{ fontSize: '7px', fontWeight: 'bold' }}>QC / Approved</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <>
            <PrintModalShell modeless title={`Kartu Celup — ${recipe.code} ${recipe.name}`} onClose={onClose}>
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
                                    <label style={{ ...toggleLabelStyle, opacity: recipe.wash_baths.length > 0 ? 1 : 0.4 }}>
                                        <input type="checkbox" checked={showWashBaths} disabled={recipe.wash_baths.length === 0} onChange={e => setShowWashBaths(e.target.checked)} />
                                        Bak Cuci
                                    </label>
                                    <label style={{ ...toggleLabelStyle, opacity: recipe.finishing_steps.length > 0 ? 1 : 0.4 }}>
                                        <input type="checkbox" checked={showFinishing} disabled={recipe.finishing_steps.length === 0} onChange={e => setShowFinishing(e.target.checked)} />
                                        Finishing
                                    </label>
                                    <label style={toggleLabelStyle}>
                                        <input type="checkbox" checked={showSignature} onChange={e => setShowSignature(e.target.checked)} />
                                        Signature Lines
                                    </label>
                                </div>
                            </div>
                            <div style={{ fontSize: 10, color: '#555', marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #dee2e6' }}>
                                Paper size &amp; margins set in browser print dialog.
                            </div>
                        </div>

                        {/* RIGHT: preview */}
                        <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: 16, display: 'flex', justifyContent: 'center' }}>
                            <div className="wo-print-paper" style={{ background: '#fff', width: '100%', maxWidth: 560, padding: '20px 24px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', fontSize: '9px', lineHeight: '1.5', color: '#000', fontFamily: PRINT_FONT }}>
                                {documentContent}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <PrintModalFooter onClose={onClose} onPrint={() => { window.addEventListener('afterprint', onClose, { once: true }); window.print(); }} />
            </PrintModalShell>

            {/* Print portal — only this renders when printing */}
            {createPortal(
                <div className="wo-print-paper-portal" style={{ display: 'none' }}>
                    <div className="wo-print-paper" style={{ background: '#fff', width: '100%', padding: '20px 24px', fontSize: '9px', lineHeight: '1.5', color: '#000', fontFamily: PRINT_FONT }}>
                        {documentContent}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
