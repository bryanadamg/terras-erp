'use client';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

const STATIC_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000').replace(/\/api$/, '');

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

function fmt(v: any, decimals = 2) {
    if (v == null || v === '') return '—';
    return Number(v).toFixed(decimals);
}

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
        localStorage.setItem('bom_print_settings', JSON.stringify(next));
    };

    useEffect(() => {
        document.body.classList.add('bom-print-preview-active');
        return () => { document.body.classList.remove('bom-print-preview-active'); };
    }, []);

    const lines: any[] = bom.lines || [];
    const sizes: any[] = (bom.sizes || []).slice().sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const hasMesin = [bom.mesin_lebar, bom.mesin_panjang_tulisan, bom.mesin_panjang_tarikan, bom.mesin_panjang_tarikan_bandul_1kg, bom.mesin_panjang_tarikan_bandul_9kg].some(v => v != null);
    const hasCelup = [bom.celup_lebar, bom.celup_panjang_tulisan, bom.celup_panjang_tarikan, bom.celup_panjang_tarikan_bandul_1kg, bom.celup_panjang_tarikan_bandul_9kg].some(v => v != null);
    const hasMeasurements = hasMesin || hasCelup;
    const hasTeknis = bom.kerapatan_picks != null || bom.sisir_no != null || bom.pemakaian_obat || bom.pembuatan_sample_oleh || bom.berat_bahan_mateng != null || bom.berat_bahan_mentah_pelesan != null;
    const isDesignImage = bom.design_file_url && /\.(jpg|jpeg|png|gif|webp)$/i.test(bom.design_file_url);
    const isDesignPdf = bom.design_file_url && /\.pdf$/i.test(bom.design_file_url);

    const printTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', marginBottom: 10, fontSize: '8pt' };
    const th: React.CSSProperties = { border: '1px solid #aaa', padding: '3px 6px', background: '#e8e8e8', fontWeight: 'bold', textAlign: 'left', whiteSpace: 'nowrap' };
    const td: React.CSSProperties = { border: '1px solid #ccc', padding: '3px 6px', verticalAlign: 'top' };
    const secTitle: React.CSSProperties = { fontSize: '8pt', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1.5px solid #333', paddingBottom: 2, marginBottom: 6, marginTop: 10, color: '#000' };

    const mRow = (label: string, mesinVal: any, celupVal: any, unit: string) => (
        <tr key={label}>
            <td style={td}>{label}</td>
            {hasMesin && <td style={{ ...td, textAlign: 'right' }}>{fmt(mesinVal)}</td>}
            {hasCelup && <td style={{ ...td, textAlign: 'right' }}>{fmt(celupVal)}</td>}
            <td style={{ ...td, color: '#666', fontSize: '7pt' }}>{unit}</td>
        </tr>
    );

    const documentContent = (
        <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '9pt', color: '#000', lineHeight: 1.4 }}>

            {/* Company header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 10 }}>
                <div>
                    {companyProfile?.logo_url
                        ? <img src={`${STATIC_BASE}${companyProfile.logo_url}`} alt="Logo" style={{ maxHeight: 52, maxWidth: 180, objectFit: 'contain', display: 'block', marginBottom: 3 }} />
                        : <div style={{ fontSize: 13, fontWeight: 'bold', color: '#003080' }}>{companyProfile?.name || ''}</div>
                    }
                    {companyProfile?.address && <div style={{ fontSize: '7.5pt', color: '#555' }}>{companyProfile.address}</div>}
                    {(companyProfile?.phone || companyProfile?.email) && (
                        <div style={{ fontSize: '7.5pt', color: '#555' }}>{[companyProfile.phone, companyProfile.email].filter(Boolean).join(' · ')}</div>
                    )}
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 15, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>Bill of Materials</div>
                    <div style={{ fontFamily: 'Courier New, monospace', fontSize: 11, color: '#0000cc', marginTop: 2 }}>{bom.code}</div>
                    <div style={{ fontSize: '7.5pt', color: '#555', marginTop: 2 }}>Printed: {new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                    {settings.headerNote && <div style={{ fontSize: '7.5pt', color: '#333', marginTop: 2, fontStyle: 'italic' }}>{settings.headerNote}</div>}
                </div>
            </div>

            {/* BOM identity grid */}
            <table style={{ ...printTable, marginBottom: 8 }}>
                <tbody>
                    <tr>
                        <td style={{ ...td, background: '#f5f5f5', fontWeight: 'bold', width: '15%', whiteSpace: 'nowrap' }}>Item</td>
                        <td style={{ ...td, width: '35%' }}>
                            <span style={{ fontWeight: 'bold' }}>{bom.item_name || bom.item_code}</span>
                            <span style={{ fontFamily: 'Courier New, monospace', fontSize: '7.5pt', color: '#555', marginLeft: 6 }}>{bom.item_code}</span>
                        </td>
                        <td style={{ ...td, background: '#f5f5f5', fontWeight: 'bold', width: '15%', whiteSpace: 'nowrap' }}>Batch Output</td>
                        <td style={{ ...td, width: '35%' }}>{fmt(bom.qty, 2)} pcs{bom.tolerance_percentage > 0 ? ` ±${bom.tolerance_percentage}%` : ''}</td>
                    </tr>
                    {((bom.attribute_value_ids || []).length > 0) && (
                        <tr>
                            <td style={{ ...td, background: '#f5f5f5', fontWeight: 'bold' }}>Variant</td>
                            <td style={td}>{(bom.attribute_value_ids || []).map(getAttributeValueName).join(', ')}</td>
                            <td style={{ ...td, background: '#f5f5f5', fontWeight: 'bold' }}>Status</td>
                            <td style={td}>{bom.active ? 'Active' : 'Inactive'}</td>
                        </tr>
                    )}
                    {(bom.customer_name || bom.work_center_name) && (
                        <tr>
                            <td style={{ ...td, background: '#f5f5f5', fontWeight: 'bold' }}>Customer</td>
                            <td style={td}>{bom.customer_name || '—'}</td>
                            <td style={{ ...td, background: '#f5f5f5', fontWeight: 'bold' }}>Machine</td>
                            <td style={td}>{bom.work_center_name || '—'}</td>
                        </tr>
                    )}
                    {bom.description && (
                        <tr>
                            <td style={{ ...td, background: '#f5f5f5', fontWeight: 'bold' }}>Description</td>
                            <td style={{ ...td }} colSpan={3}>{bom.description}</td>
                        </tr>
                    )}
                </tbody>
            </table>

            {/* Row: Detail Teknis (left) + Pengukuran Bahan (right) */}
            {((settings.showDetailTeknis && hasTeknis) || (settings.showMeasurements && hasMeasurements)) && (
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginTop: 2 }}>

                    {settings.showDetailTeknis && hasTeknis && (
                        <div style={{ flex: '0 0 44%' }}>
                            <div style={secTitle}>Detail Teknis</div>
                            <table style={{ ...printTable, marginBottom: 0 }}>
                                <tbody>
                                    {(bom.kerapatan_picks != null || bom.sisir_no != null) && (
                                        <tr>
                                            <td style={{ ...td, background: '#f5f5f5', fontWeight: 'bold', width: '48%' }}>
                                                {bom.kerapatan_picks != null ? 'Kerapatan / Picks' : 'Sisir No.'}
                                            </td>
                                            <td style={td}>
                                                {bom.kerapatan_picks != null
                                                    ? `${bom.kerapatan_picks} ${bom.kerapatan_unit || '/cm'}`
                                                    : bom.sisir_no}
                                            </td>
                                        </tr>
                                    )}
                                    {bom.kerapatan_picks != null && bom.sisir_no != null && (
                                        <tr>
                                            <td style={{ ...td, background: '#f5f5f5', fontWeight: 'bold' }}>Sisir No.</td>
                                            <td style={td}>{bom.sisir_no}</td>
                                        </tr>
                                    )}
                                    {bom.pemakaian_obat && (
                                        <tr>
                                            <td style={{ ...td, background: '#f5f5f5', fontWeight: 'bold' }}>Pemakaian Obat</td>
                                            <td style={td}>{bom.pemakaian_obat}</td>
                                        </tr>
                                    )}
                                    {bom.pembuatan_sample_oleh && (
                                        <tr>
                                            <td style={{ ...td, background: '#f5f5f5', fontWeight: 'bold' }}>Sample Oleh</td>
                                            <td style={td}>{bom.pembuatan_sample_oleh}</td>
                                        </tr>
                                    )}
                                    {bom.berat_bahan_mateng != null && (
                                        <tr>
                                            <td style={{ ...td, background: '#f5f5f5', fontWeight: 'bold' }}>Berat Mateng</td>
                                            <td style={td}>{fmt(bom.berat_bahan_mateng, 4)} gr/yard</td>
                                        </tr>
                                    )}
                                    {bom.berat_bahan_mentah_pelesan != null && (
                                        <tr>
                                            <td style={{ ...td, background: '#f5f5f5', fontWeight: 'bold' }}>Berat Mentah (Pelesan)</td>
                                            <td style={td}>{fmt(bom.berat_bahan_mentah_pelesan, 4)} gr/yard</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {settings.showMeasurements && hasMeasurements && (
                        <div style={{ flex: 1 }}>
                            <div style={secTitle}>Pengukuran Bahan</div>
                            <table style={{ ...printTable, marginBottom: 0 }}>
                                <thead>
                                    <tr>
                                        <th style={th}>Ukuran</th>
                                        {hasMesin && <th style={{ ...th, textAlign: 'right' }}>Keluar Mesin</th>}
                                        {hasCelup && <th style={{ ...th, textAlign: 'right' }}>Celup / Setting</th>}
                                        <th style={{ ...th, width: 28 }}>Sat.</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {mRow('Lebar', bom.mesin_lebar, bom.celup_lebar, 'mm')}
                                    {mRow('P. Tulisan', bom.mesin_panjang_tulisan, bom.celup_panjang_tulisan, 'cm')}
                                    {mRow('P. Tarikan', bom.mesin_panjang_tarikan, bom.celup_panjang_tarikan, 'cm')}
                                    {mRow('Bandul 1kg', bom.mesin_panjang_tarikan_bandul_1kg, bom.celup_panjang_tarikan_bandul_1kg, 'cm')}
                                    {mRow('Bandul 9kg', bom.mesin_panjang_tarikan_bandul_9kg, bom.celup_panjang_tarikan_bandul_9kg, 'cm')}
                                </tbody>
                            </table>
                        </div>
                    )}

                </div>
            )}

            {/* Row: Size Measurements (left) + Components (right) */}
            {((settings.showSizes && sizes.length > 0) || (settings.showComponents && lines.length > 0)) && (
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginTop: 8 }}>

                    {settings.showSizes && sizes.length > 0 && (
                        <div style={{ flex: '0 0 36%' }}>
                            <div style={secTitle}>{bom.size_mode === 'free' ? 'Measurements' : 'Size Measurements'}</div>
                            <table style={{ ...printTable, marginBottom: 0 }}>
                                <thead>
                                    <tr>
                                        <th style={th}>{bom.size_mode === 'free' ? 'Label' : 'Size'}</th>
                                        <th style={{ ...th, textAlign: 'right' }}>Target</th>
                                        <th style={{ ...th, textAlign: 'right' }}>Min</th>
                                        <th style={{ ...th, textAlign: 'right' }}>Max</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sizes.map((s: any, i: number) => (
                                        <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                                            <td style={{ ...td, fontWeight: 'bold' }}>{s.size_name || s.label || `Row ${i + 1}`}</td>
                                            <td style={{ ...td, textAlign: 'right' }}>{fmt(s.target_measurement)}</td>
                                            <td style={{ ...td, textAlign: 'right' }}>{fmt(s.measurement_min)}</td>
                                            <td style={{ ...td, textAlign: 'right' }}>{fmt(s.measurement_max)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {settings.showComponents && lines.length > 0 && (
                        <div style={{ flex: 1 }}>
                            <div style={secTitle}>Komponen / Materials</div>
                            <table style={{ ...printTable, marginBottom: 0 }}>
                                <thead>
                                    <tr>
                                        <th style={{ ...th, width: '5%' }}>#</th>
                                        <th style={th}>Kode</th>
                                        <th style={th}>Nama Item</th>
                                        <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                                        <th style={{ ...th, textAlign: 'right' }}>%</th>
                                        <th style={th}>Atribut</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lines.map((line: any, i: number) => (
                                        <tr key={line.id} style={{ background: i % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                                            <td style={{ ...td, textAlign: 'center', color: '#666' }}>{i + 1}</td>
                                            <td style={{ ...td, fontFamily: 'Courier New, monospace', fontSize: '7.5pt', color: '#0000cc' }}>{line.item_code}</td>
                                            <td style={td}>{line.item_name}</td>
                                            <td style={{ ...td, textAlign: 'right', fontWeight: 'bold' }}>{fmt(line.qty)}</td>
                                            <td style={{ ...td, textAlign: 'right' }}>{(line.percentage || 0) > 0 ? `${line.percentage}%` : '—'}</td>
                                            <td style={{ ...td, fontSize: '7.5pt', color: '#444' }}>{(line.attribute_value_ids || []).map(getAttributeValueName).filter(Boolean).join(', ') || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <td colSpan={6} style={{ ...td, background: '#f0f0f0', fontSize: '7.5pt', color: '#555', textAlign: 'right' }}>
                                            {lines.length} komponen
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}

                </div>
            )}

            {/* Sample Photo */}
            {settings.showSamplePhoto && bom.sample_photo_url && (
                <div style={{ marginTop: 10 }}>
                    <div style={secTitle}>Sample Photo</div>
                    <img
                        src={`${STATIC_BASE}${bom.sample_photo_url}`}
                        alt="Sample"
                        style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain', border: '1px solid #ccc', display: 'block' }}
                    />
                </div>
            )}

            {/* Design / Susunan Rumusan — full width */}
            {settings.showDesignFile && bom.design_file_url && (
                <div style={{ marginTop: 10 }}>
                    <div style={secTitle}>Design / Susunan Rumusan</div>
                    {isDesignImage
                        ? <img
                            src={`${STATIC_BASE}${bom.design_file_url}`}
                            alt="Design"
                            style={{ maxWidth: '100%', objectFit: 'contain', border: '1px solid #ccc', display: 'block' }}
                          />
                        : isDesignPdf
                        ? <div style={{ fontSize: '8pt', color: '#555', border: '1px solid #ccc', padding: '8px 10px', background: '#fafafa' }}>
                            [Design file attached as PDF — see: {bom.design_file_url.split('/').pop()}]
                          </div>
                        : null
                    }
                </div>
            )}

            {/* Signature / footer */}
            <div style={{ marginTop: 16, borderTop: '1px solid #ccc', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: '7.5pt', color: '#555' }}>
                <div>
                    <div>BOM: {bom.code} · Item: {bom.item_code}</div>
                    <div>Printed: {new Date().toLocaleString('id-ID')}</div>
                </div>
                {settings.showSignatureLine && (
                    <div style={{ textAlign: 'center', width: 150 }}>
                        <div style={{ borderBottom: '1px solid #000', height: 32, marginBottom: 2 }} />
                        <div>Authorized Signature</div>
                    </div>
                )}
            </div>
        </div>
    );

    // ── Styles ──────────────────────────────────────────────────────────────────
    const sectionLabelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', color: '#212529', letterSpacing: '0.5px', marginBottom: 6 };
    const toggleLabelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#212529', cursor: 'pointer' };
    const fieldLabelStyle: React.CSSProperties = { fontSize: 10, color: '#212529', marginBottom: 3, fontWeight: 500 };
    const fieldInputStyle: React.CSSProperties = { width: '100%', fontSize: 11, padding: '3px 6px', border: '1px solid #ced4da', boxSizing: 'border-box' };

    return (
        <>
            {/* Backdrop + modal */}
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
                <div style={{ background: '#fff', width: '90vw', maxWidth: 980, height: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf' }} onClick={e => e.stopPropagation()}>

                    {/* Header */}
                    <div style={{ background: 'linear-gradient(to right, #0058e6, #08a5ff)', color: '#fff', font: 'bold 12px Tahoma', padding: '5px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                        <span>Print BOM — {bom.code}</span>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 'bold' }}>X</button>
                    </div>

                    {/* Body */}
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                        {/* LEFT: settings */}
                        <div style={{ width: 210, minWidth: 210, borderRight: '1px solid #dee2e6', background: '#f8f9fa', padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

                            <div>
                                <div style={sectionLabelStyle}>Sections</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    {[
                                        { label: 'BOM Identity', key: null },
                                        { label: 'Detail Teknis', key: 'showDetailTeknis', disabled: !hasTeknis },
                                        { label: 'Measurements', key: 'showMeasurements', disabled: !hasMeasurements },
                                        { label: 'Size Measurements', key: 'showSizes', disabled: sizes.length === 0 },
                                        { label: 'Components', key: 'showComponents', disabled: lines.length === 0 },
                                    ].map(({ label, key, disabled }) =>
                                        key === null ? (
                                            <label key={label} style={{ ...toggleLabelStyle, opacity: 0.5 }}>
                                                <input type="checkbox" checked disabled />
                                                {label} <span style={{ fontSize: 10, color: '#555' }}>(always on)</span>
                                            </label>
                                        ) : (
                                            <label key={label} style={{ ...toggleLabelStyle, opacity: disabled ? 0.4 : 1 }}>
                                                <input type="checkbox" checked={settings[key as keyof BOMPrintSettings] as boolean} disabled={!!disabled}
                                                    onChange={e => update({ [key]: e.target.checked })} />
                                                {label}
                                            </label>
                                        )
                                    )}
                                </div>
                            </div>

                            <hr style={{ margin: 0, borderColor: '#dee2e6' }} />

                            <div>
                                <div style={sectionLabelStyle}>Attachments</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    <label style={{ ...toggleLabelStyle, opacity: bom.sample_photo_url ? 1 : 0.4 }}>
                                        <input type="checkbox" checked={settings.showSamplePhoto} disabled={!bom.sample_photo_url}
                                            onChange={e => update({ showSamplePhoto: e.target.checked })} />
                                        Sample Photo
                                    </label>
                                    <label style={{ ...toggleLabelStyle, opacity: bom.design_file_url ? 1 : 0.4 }}>
                                        <input type="checkbox" checked={settings.showDesignFile} disabled={!bom.design_file_url}
                                            onChange={e => update({ showDesignFile: e.target.checked })} />
                                        Design / Rumusan
                                        {isDesignPdf && <span style={{ fontSize: 9, color: '#888' }}>(PDF note)</span>}
                                    </label>
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
                                Paper size &amp; margins set in browser print dialog.
                            </div>
                        </div>

                        {/* RIGHT: preview */}
                        <div style={{ flex: 1, background: '#d8d8d8', overflowY: 'auto', padding: 20, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                            <div className="bom-print-paper" style={{ background: '#fff', width: '100%', maxWidth: 600, padding: '24px 28px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', fontSize: '9pt', lineHeight: 1.5, color: '#000', fontFamily: 'Arial, sans-serif' }}>
                                {documentContent}
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <div style={{ padding: '8px 12px', borderTop: '1px solid #dee2e6', background: '#f8f9fa', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: 10, color: '#666' }}>Settings saved automatically.</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button style={{ fontFamily: 'Tahoma', fontSize: 11, padding: '3px 12px', background: 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', cursor: 'pointer' }} onClick={onClose}>Close</button>
                            <button style={{ fontFamily: 'Tahoma', fontSize: 11, padding: '3px 14px', background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)', border: '1px solid', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}
                                onClick={() => { window.addEventListener('afterprint', onClose, { once: true }); window.print(); }}>
                                Print
                            </button>
                        </div>
                    </div>

                </div>
            </div>

            {/* Print portal — print CSS makes this the only visible element */}
            {createPortal(
                <div className="bom-print-paper-portal" style={{ display: 'none' }}>
                    <div className="bom-print-paper" style={{ background: '#fff', width: '100%', padding: '20px 24px', fontSize: '9pt', lineHeight: 1.5, color: '#000', fontFamily: 'Arial, sans-serif' }}>
                        {documentContent}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
