'use client';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';

const STATIC_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000').replace(/\/api$/, '');

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

const renderPrintBOMLines = (
    wo: any,
    lines: any[],
    level: number,
    currentParentQty: number,
    currentBOM: any,
    helpers: {
        boms: any[];
        getItemName: (id: any) => string;
        getItemCode: (id: any) => string;
        getLocationName: (id: any) => string;
        getAttributeValueName: (id: any) => string;
    }
): any => {
    const { boms, getItemName, getItemCode, getLocationName, getAttributeValueName } = helpers;
    return lines.map((line: any) => {
        const subBOM = boms.find((b: any) => b.item_id === line.item_id);
        let scaledQty = parseFloat(line.qty);
        if (line.is_percentage) {
            scaledQty = (currentParentQty * scaledQty) / 100;
        } else {
            scaledQty = currentParentQty * scaledQty;
        }
        const tolerance = parseFloat(currentBOM?.tolerance_percentage || 0);
        if (tolerance > 0) {
            scaledQty = scaledQty * (1 + (tolerance / 100));
        }
        const reqQty = scaledQty * wo.qty;

        return (
            <React.Fragment key={line.id}>
                <tr>
                    <td style={{ paddingLeft: `${level * 12 + 4}px`, fontWeight: 'bold', fontSize: '8px' }}>
                        {reqQty.toFixed(3)}
                    </td>
                    <td style={{ paddingLeft: '6px', fontSize: '8px' }}>
                        {level > 0 && <span style={{ color: '#888', marginRight: '3px' }}>↳</span>}
                        <span style={{ fontFamily: 'monospace', color: '#555', marginRight: '4px', fontSize: '7px' }}>
                            {line.item_code || getItemCode(line.item_id)}
                        </span>
                        {line.item_name || getItemName(line.item_id)}
                        {(line.attribute_value_ids || []).length > 0 && (
                            <span style={{ color: '#666', marginLeft: '4px', fontSize: '7px' }}>
                                [{(line.attribute_value_ids || []).map(getAttributeValueName).join(', ')}]
                            </span>
                        )}
                    </td>
                    <td style={{ fontSize: '8px', color: '#555', textAlign: 'center' }}>
                        {getLocationName(line.source_location_id || wo.source_location_id || wo.location_id)}
                    </td>
                </tr>
                {subBOM && subBOM.lines && renderPrintBOMLines(wo, subBOM.lines, level + 1, scaledQty, subBOM, helpers)}
            </React.Fragment>
        );
    });
};

const renderChildWOsPrint = (
    children: any[],
    qrUrls: Record<string, string>,
    helpers: {
        getItemName: (id: any) => string;
        getLocationName: (id: any) => string;
        formatDate: (d: any) => string;
    }
) => {
    const { getItemName, getLocationName, formatDate } = helpers;
    if (!children || children.length === 0) return null;
    return (
        <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #ccc' }}>
            <div style={{ fontSize: '8px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.3px', marginBottom: '4px' }}>
                Child Manufacturing Orders
            </div>
            {children.map(child => (
                <div key={child.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', border: '1px solid #ddd', padding: '4px 6px', background: '#fafafa' }}>
                    <img src={qrUrls[child.code] || ''} alt="QR" style={{ width: '40px', height: '40px', flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: '8px' }}>
                        <div style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#0058e6' }}>{child.code}</div>
                        <div style={{ fontWeight: 'bold' }}>{child.item_name || getItemName(child.item_id)}</div>
                        <div style={{ color: '#666' }}>Qty: {child.qty} · Loc: {getLocationName(child.location_id)} · Status: {child.status} · Due: {formatDate(child.target_end_date)}</div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default function WOPrintModal({
    wo,
    onClose,
    printSettings,
    onPrintSettingsChange,
    currentStyle,
    companyProfile,
    boms,
    getItemName,
    getItemCode,
    getLocationName,
    getAttributeValueName,
    formatDate,
    hideChildMOs = false,
}: {
    wo: any;
    onClose: () => void;
    printSettings: PrintSettings;
    onPrintSettingsChange: (updated: PrintSettings) => void;
    currentStyle: string;
    companyProfile: any;
    boms: any[];
    getItemName: (id: any) => string;
    getItemCode: (id: any) => string;
    getLocationName: (id: any) => string;
    getAttributeValueName: (id: any) => string;
    formatDate: (d: any) => string;
    hideChildMOs?: boolean;
}) {
    const {
        showBOMTable, showTimeline, showChildMOs: showChildMOsSetting,
        showSignatureLine, showTechnicalFields, showFillFields, showSamplePhoto,
        headerCompanyName, headerDepartment, headerApprovedBy, headerReference,
    } = printSettings;
    const showChildMOs = hideChildMOs ? false : showChildMOsSetting;

    const [qrDataUrl, setQrDataUrl] = useState('');
    const [childQrUrls, setChildQrUrls] = useState<Record<string, string>>({});

    useEffect(() => {
        document.body.classList.add('wo-print-preview-active');
        return () => { document.body.classList.remove('wo-print-preview-active'); };
    }, []);

    useEffect(() => {
        QRCode.toDataURL(wo.code, { margin: 1, width: 200 })
            .then(setQrDataUrl)
            .catch(() => {});
    }, [wo.code]);

    useEffect(() => {
        if (!showChildMOs) return;
        (wo.child_mos || []).forEach((child: any) => {
            QRCode.toDataURL(child.code, { margin: 1, width: 160 })
                .then(url => setChildQrUrls(prev => prev[child.code] ? prev : { ...prev, [child.code]: url }))
                .catch(() => {});
        });
    }, [showChildMOs, wo.child_mos]);

    const update = (patch: Partial<PrintSettings>) =>
        onPrintSettingsChange({ ...printSettings, ...patch });

    const isClassic = currentStyle === 'classic';

    const xpBevelStyle: React.CSSProperties = isClassic
        ? { border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf' }
        : {};
    const headerStyle = isClassic
        ? { background: 'linear-gradient(to right, #0058e6, #08a5ff)', color: '#fff', font: 'bold 12px Tahoma', padding: '5px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as React.CSSProperties
        : {} as React.CSSProperties;
    const headerClass = isClassic ? '' : 'bg-primary text-white px-3 py-2 d-flex justify-content-between align-items-center';
    const xpBtnGrey: React.CSSProperties = isClassic
        ? { fontFamily: 'Tahoma', fontSize: '11px', padding: '3px 12px', background: 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', cursor: 'pointer' }
        : {};
    const xpBtnGreen: React.CSSProperties = isClassic
        ? { fontFamily: 'Tahoma', fontSize: '11px', padding: '3px 14px', background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)', border: '1px solid', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }
        : {};

    const sectionLabelStyle: React.CSSProperties = { fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', color: '#212529', letterSpacing: '0.5px', marginBottom: '6px' };
    const toggleLabelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#212529', cursor: 'pointer' };
    const fieldLabelStyle: React.CSSProperties = { fontSize: '10px', color: '#212529', marginBottom: '3px', fontWeight: '500' };
    const fieldInputStyle: React.CSSProperties = { width: '100%', fontSize: '11px', padding: '3px 6px', border: '1px solid #ced4da', boxSizing: 'border-box', color: '#000' };

    // Resolve BOM once for use across all sections
    const bom = boms.find((b: any) => b.id === wo.bom_id);
    const displayCompanyName = headerCompanyName || companyProfile?.name || '';

    // Cell styles for the identity grid
    const gridLbl: React.CSSProperties = { background: '#f0f0f0', border: '1px solid #ccc', padding: '2px 6px', fontSize: '8px', color: '#444', fontWeight: 'bold', whiteSpace: 'nowrap' };
    const gridVal: React.CSSProperties = { border: '1px solid #ccc', padding: '2px 6px', fontSize: '8px', color: '#000' };

    const hasTechFields = bom && (
        bom.berat_bahan_mateng != null || bom.berat_bahan_mentah_pelesan != null ||
        bom.mesin_lebar != null || bom.mesin_panjang_tarikan != null ||
        bom.mesin_panjang_tulisan != null || bom.kerapatan_picks != null ||
        bom.sisir_no != null || bom.pemakaian_obat
    );
    const hasSamplePhoto = !!(bom?.sample_photo_url);

    const documentContent = (
        <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '9px', color: '#000', lineHeight: 1.4 }}>

            {/* ── Title row ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #000', paddingBottom: '6px', marginBottom: '8px' }}>
                <div>
                    {companyProfile?.logo_url ? (
                        <img src={`${STATIC_BASE}${companyProfile.logo_url}`} alt="Logo" style={{ maxHeight: '44px', maxWidth: '160px', objectFit: 'contain', display: 'block', marginBottom: '2px' }} />
                    ) : (
                        <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#003080' }}>{displayCompanyName}</div>
                    )}
                    {companyProfile?.address && <div style={{ fontSize: '7px', color: '#555' }}>{companyProfile.address}</div>}
                    {(companyProfile?.phone || companyProfile?.email) && (
                        <div style={{ fontSize: '7px', color: '#555' }}>{[companyProfile.phone, companyProfile.email].filter(Boolean).join(' · ')}</div>
                    )}
                </div>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', color: '#000' }}>SPK PRODUKSI</div>
                    <div style={{ fontSize: '8px', color: '#333', marginTop: '2px' }}>
                        Tanggal: {new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </div>
                    {(headerDepartment || headerApprovedBy || headerReference) && (
                        <div style={{ fontSize: '7px', color: '#555', marginTop: '2px' }}>
                            {[headerDepartment && `Dept: ${headerDepartment}`, headerApprovedBy && `Approved: ${headerApprovedBy}`, headerReference && `Ref: ${headerReference}`].filter(Boolean).join(' · ')}
                        </div>
                    )}
                </div>
                <div style={{ border: '2px solid #000', padding: '2px', flexShrink: 0 }}>
                    {qrDataUrl
                        ? <img src={qrDataUrl} alt="QR" style={{ width: '70px', height: '70px', display: 'block' }} />
                        : <div style={{ width: '70px', height: '70px', background: '#eee' }} />
                    }
                    <div style={{ fontFamily: 'monospace', fontSize: '6px', textAlign: 'center', marginTop: '1px', color: '#000' }}>{wo.code}</div>
                </div>
            </div>

            {/* ── Identity grid ── */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
                <tbody>
                    {/* ARTICLE — full width */}
                    <tr>
                        <td style={{ ...gridLbl, width: '18%' }}>ARTICLE</td>
                        <td colSpan={3} style={{ ...gridVal, fontWeight: 'bold', fontSize: '9px' }}>{wo.item_name || getItemName(wo.item_id)}</td>
                    </tr>
                    <tr>
                        <td style={{ ...gridLbl, width: '18%' }}>No. SPK</td>
                        <td style={{ ...gridVal, fontFamily: 'monospace', width: '32%' }}>{wo.code}</td>
                        <td style={{ ...gridLbl, width: '18%' }}>Jml Order</td>
                        <td style={{ ...gridVal, fontWeight: 'bold' }}>{wo.qty} <span style={{ color: '#666', fontSize: '7px' }}>pcs</span></td>
                    </tr>
                    {wo.sales_order_id && (
                        <tr>
                            <td style={gridLbl}>Sales Order</td>
                            <td style={{ ...gridVal, fontFamily: 'monospace', color: '#0058e6' }}>{wo.sales_order_code || wo.sales_order_id}</td>
                            <td style={gridLbl}>Customer</td>
                            <td style={gridVal}>{bom?.customer_name || '—'}</td>
                        </tr>
                    )}
                    {!wo.sales_order_id && bom?.customer_name && (
                        <tr>
                            <td style={gridLbl}>Customer</td>
                            <td colSpan={3} style={gridVal}>{bom.customer_name}</td>
                        </tr>
                    )}
                    <tr>
                        <td style={gridLbl}>Target Start</td>
                        <td style={gridVal}>{formatDate(wo.target_start_date) || '—'}</td>
                        <td style={gridLbl}>No Mesin</td>
                        <td style={gridVal}>{bom?.work_center_name || '—'}</td>
                    </tr>
                    <tr>
                        <td style={gridLbl}>Target End</td>
                        <td style={gridVal}>{formatDate(wo.target_end_date) || '—'}</td>
                        <td style={gridLbl}>Toleransi</td>
                        <td style={gridVal}>{bom?.tolerance_percentage != null ? `±${bom.tolerance_percentage}%` : '—'}</td>
                    </tr>
                    {showTimeline && (wo.actual_start_date || wo.actual_end_date) && (
                        <tr>
                            <td style={gridLbl}>Actual Start</td>
                            <td style={gridVal}>{wo.actual_start_date ? formatDate(wo.actual_start_date) : '—'}</td>
                            <td style={gridLbl}>Actual End</td>
                            <td style={gridVal}>{wo.actual_end_date ? formatDate(wo.actual_end_date) : '—'}</td>
                        </tr>
                    )}
                    <tr>
                        <td style={gridLbl}>Status</td>
                        <td style={gridVal}>{wo.status}</td>
                        <td style={gridLbl}>Output Loc</td>
                        <td style={gridVal}>{getLocationName(wo.location_id)}</td>
                    </tr>
                </tbody>
            </table>

            {/* ── Technical fields (BOM specs) ── */}
            {showTechnicalFields && hasTechFields && (
                <>
                    <div style={{ fontSize: '7px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.3px', marginBottom: '3px', borderTop: '1px solid #ccc', paddingTop: '5px' }}>
                        Spesifikasi Teknis
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
                        <tbody>
                            {(bom.berat_bahan_mateng != null || bom.berat_bahan_mentah_pelesan != null) && (
                                <tr>
                                    <td style={{ ...gridLbl, width: '18%' }}>Berat Mateng</td>
                                    <td style={{ ...gridVal, width: '32%' }}>{bom.berat_bahan_mateng != null ? `${bom.berat_bahan_mateng} gr/yard` : '—'}</td>
                                    <td style={{ ...gridLbl, width: '18%' }}>Berat Mentah</td>
                                    <td style={gridVal}>{bom.berat_bahan_mentah_pelesan != null ? `${bom.berat_bahan_mentah_pelesan} gr/yard` : '—'}</td>
                                </tr>
                            )}
                            {(bom.mesin_lebar != null || bom.mesin_panjang_tarikan != null) && (
                                <tr>
                                    <td style={gridLbl}>Lebar Mesin</td>
                                    <td style={gridVal}>{bom.mesin_lebar != null ? `${bom.mesin_lebar} mm` : '—'}</td>
                                    <td style={gridLbl}>Tarikan Mentah</td>
                                    <td style={gridVal}>{bom.mesin_panjang_tarikan != null ? `${bom.mesin_panjang_tarikan} cm` : '—'}</td>
                                </tr>
                            )}
                            {(bom.mesin_panjang_tulisan != null || bom.mesin_panjang_tarikan_bandul_1kg != null) && (
                                <tr>
                                    <td style={gridLbl}>P. Tulisan</td>
                                    <td style={gridVal}>{bom.mesin_panjang_tulisan != null ? `${bom.mesin_panjang_tulisan} cm` : '—'}</td>
                                    <td style={gridLbl}>Bandul 1kg</td>
                                    <td style={gridVal}>{bom.mesin_panjang_tarikan_bandul_1kg != null ? `${bom.mesin_panjang_tarikan_bandul_1kg} cm` : '—'}</td>
                                </tr>
                            )}
                            {(bom.kerapatan_picks != null || bom.sisir_no != null) && (
                                <tr>
                                    <td style={gridLbl}>Kerapatan</td>
                                    <td style={gridVal}>{bom.kerapatan_picks != null ? `${bom.kerapatan_picks} ${bom.kerapatan_unit || '/cm'}` : '—'}</td>
                                    <td style={gridLbl}>Sisir No.</td>
                                    <td style={gridVal}>{bom.sisir_no ?? '—'}</td>
                                </tr>
                            )}
                            {bom.pemakaian_obat && (
                                <tr>
                                    <td style={gridLbl}>Pemakaian Obat</td>
                                    <td colSpan={3} style={gridVal}>{bom.pemakaian_obat}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </>
            )}

            {/* ── Materials table ── */}
            {showBOMTable && (
                <>
                    <div style={{ fontSize: '7px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.3px', marginBottom: '3px', borderTop: '1px solid #ccc', paddingTop: '5px' }}>
                        Material
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8px', marginBottom: '8px' }}>
                        <thead>
                            <tr style={{ background: '#f0f0f0' }}>
                                <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'right', width: '14%' }}>Req. Qty</th>
                                <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'left' }}>Component</th>
                                <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'center', width: '16%' }}>Source</th>
                            </tr>
                        </thead>
                        <tbody>
                            {bom ? renderPrintBOMLines(wo, bom.lines, 0, 1, bom, { boms: hideChildMOs ? [] : boms, getItemName, getItemCode, getLocationName, getAttributeValueName }) : (
                                <tr><td colSpan={3} style={{ border: '1px solid #ccc', padding: '4px', color: '#888' }}>No BOM found</td></tr>
                            )}
                        </tbody>
                    </table>
                </>
            )}

            {/* ── Child MOs ── */}
            {showChildMOs && renderChildWOsPrint(wo.child_mos || [], childQrUrls, { getItemName, getLocationName, formatDate })}

            {/* ── Fill-in fields ── */}
            {showFillFields && (
                <>
                    <div style={{ borderTop: '1px solid #ccc', paddingTop: '6px', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {[
                            'Status Material',
                            'Tanggal Selesai',
                            'Bahan dari Mesin',
                        ].map(label => (
                            <div key={label} style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                                <span style={{ fontSize: '8px', fontWeight: 'bold', whiteSpace: 'nowrap', minWidth: '110px' }}>{label}:</span>
                                <div style={{ flex: 1, borderBottom: '1px solid #333', height: '14px' }} />
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* ── Sample photo ── */}
            {showSamplePhoto && hasSamplePhoto && (
                <div style={{ marginTop: '8px', borderTop: '1px solid #ccc', paddingTop: '6px' }}>
                    <div style={{ fontSize: '8px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', marginBottom: '4px' }}>Sample Produk</div>
                    <img
                        src={`${STATIC_BASE}${bom.sample_photo_url}`}
                        alt="Sample"
                        style={{ maxWidth: '100%', maxHeight: '160px', objectFit: 'contain', border: '1px solid #ccc', display: 'block' }}
                    />
                </div>
            )}

            {/* ── Signature / footer ── */}
            <div style={{ marginTop: '16px', borderTop: '1px solid #ccc', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div style={{ fontSize: '7px', color: '#555' }}>
                    <div>No. SPK: {wo.code}</div>
                    <div>Printed: {new Date().toLocaleString('id-ID')}</div>
                </div>
                <div style={{ display: 'flex', gap: '40px' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ borderBottom: '1px solid #000', height: '28px', width: '100px', marginBottom: '2px' }} />
                        <div style={{ fontSize: '7px', fontWeight: 'bold' }}>ACC TEKNISI</div>
                    </div>
                    {showSignatureLine && (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ borderBottom: '1px solid #000', height: '28px', width: '100px', marginBottom: '2px' }} />
                            <div style={{ fontSize: '7px', fontWeight: 'bold' }}>ACC QC</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <>
            {/* Backdrop + modal */}
            <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={onClose}
            >
                <div
                    style={{ background: '#fff', width: '90vw', maxWidth: '960px', height: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', ...xpBevelStyle }}
                    onClick={e => e.stopPropagation()}
                >
                    {/* Modal header */}
                    <div style={headerStyle} className={headerClass}>
                        <span>Print SPK Produksi — {wo.code}</span>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'inherit', fontSize: '14px', cursor: 'pointer', lineHeight: '1', fontWeight: 'bold' }}>X</button>
                    </div>

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
                                    <label style={toggleLabelStyle}>
                                        <input type="checkbox" checked={showBOMTable} onChange={e => update({ showBOMTable: e.target.checked })} />
                                        Materials Table
                                    </label>
                                    <label style={{ ...toggleLabelStyle, opacity: hasTechFields ? 1 : 0.4 }}>
                                        <input type="checkbox" checked={showTechnicalFields} disabled={!hasTechFields} onChange={e => update({ showTechnicalFields: e.target.checked })} />
                                        Technical Specs
                                    </label>
                                    <label style={toggleLabelStyle}>
                                        <input type="checkbox" checked={showTimeline} onChange={e => update({ showTimeline: e.target.checked })} />
                                        Actual Timeline
                                    </label>
                                    <label style={toggleLabelStyle}>
                                        <input type="checkbox" checked={showFillFields} onChange={e => update({ showFillFields: e.target.checked })} />
                                        Fill-in Fields
                                    </label>
                                    <label style={{ ...toggleLabelStyle, opacity: hasSamplePhoto ? 1 : 0.4 }}>
                                        <input type="checkbox" checked={showSamplePhoto} disabled={!hasSamplePhoto} onChange={e => update({ showSamplePhoto: e.target.checked })} />
                                        Sample Photo
                                    </label>
                                    {!hideChildMOs && (
                                        <label style={toggleLabelStyle}>
                                            <input type="checkbox" checked={showChildMOsSetting} onChange={e => update({ showChildMOs: e.target.checked })} />
                                            Child MOs
                                        </label>
                                    )}
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
                                Paper size &amp; margins set in browser print dialog.
                            </div>
                        </div>

                        {/* RIGHT: preview */}
                        <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: '16px', display: 'flex', justifyContent: 'center' }}>
                            <div className="wo-print-paper" style={{ background: '#fff', width: '100%', maxWidth: '560px', padding: '20px 24px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', fontSize: '9px', lineHeight: '1.5', color: '#000', fontFamily: 'Arial, sans-serif' }}>
                                {documentContent}
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <div style={{ padding: '8px 12px', borderTop: '1px solid #dee2e6', background: '#f8f9fa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', color: '#666' }}>Settings saved automatically</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            {isClassic ? (
                                <>
                                    <button style={xpBtnGrey} onClick={onClose}>Close</button>
                                    <button style={xpBtnGreen} onClick={() => { window.addEventListener('afterprint', onClose, { once: true }); window.print(); }}>Print</button>
                                </>
                            ) : (
                                <>
                                    <button className="btn btn-sm btn-secondary" onClick={onClose}>Close</button>
                                    <button className="btn btn-sm btn-success" onClick={() => { window.addEventListener('afterprint', onClose, { once: true }); window.print(); }}>
                                        <i className="bi bi-printer me-1"></i>Print
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                </div>
            </div>

            {/* Print portal */}
            {createPortal(
                <div className="wo-print-paper-portal" style={{ display: 'none' }}>
                    <div className="wo-print-paper" style={{ background: '#fff', width: '100%', padding: '20px 24px', fontSize: '9px', lineHeight: '1.5', color: '#000', fontFamily: 'Arial, sans-serif' }}>
                        {documentContent}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
