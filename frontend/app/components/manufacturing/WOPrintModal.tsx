'use client';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';

export interface PrintSettings {
    showBOMTable: boolean;
    showTimeline: boolean;
    showChildMOs: boolean;
    showSignatureLine: boolean;
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

        return (
            <React.Fragment key={line.id}>
                <tr>
                    <td style={{ paddingLeft: `${level * 12 + 8}px` }}>
                        <span className="font-monospace extra-small">{line.item_code || getItemCode(line.item_id)}</span>
                    </td>
                    <td>
                        <div style={{ fontSize: '9pt' }}>
                            {level > 0 && <span className="text-muted me-1 small">↳</span>}
                            {line.item_name || getItemName(line.item_id)}
                        </div>
                    </td>
                    <td className="extra-small fst-italic">
                        {line.qty}{line.is_percentage ? '%' : ''}
                        {(line.attribute_value_ids || []).length > 0 && ` • ${(line.attribute_value_ids || []).map(getAttributeValueName).join(', ')}`}
                    </td>
                    <td><span className="extra-small">{getLocationName(line.source_location_id || wo.source_location_id || wo.location_id)}</span></td>
                    <td className="text-end fw-bold small">{(scaledQty * wo.qty).toFixed(3)}</td>
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
        <div className="mt-5 pt-4 border-top">
            <h6 className="fw-bold text-uppercase text-muted extra-small mb-3"><i className="bi bi-diagram-3-fill me-2"></i>Child Manufacturing Orders (Nested Chain)</h6>
            <div className="row g-3">
                {children.map(child => (
                    <div key={child.id} className="col-12 border rounded p-2 bg-light bg-opacity-10 d-flex justify-content-between align-items-center">
                        <div className="d-flex align-items-center gap-3">
                            <img
                                src={qrUrls[child.code] || ''}
                                alt="QR"
                                style={{ width: '60px', height: '60px' }}
                            />
                            <div>
                                <div className="font-monospace extra-small fw-bold text-primary">{child.code}</div>
                                <div className="fw-bold small">{child.item_name || getItemName(child.item_id)}</div>
                                <div className="extra-small text-muted">Qty: {child.qty} &bull; Loc: {getLocationName(child.location_id)}</div>
                            </div>
                        </div>
                        <div className="text-end pe-2">
                            <div className="extra-small text-muted">Status: {child.status}</div>
                            <div className="extra-small text-muted">Due: {formatDate(child.target_end_date)}</div>
                        </div>
                    </div>
                ))}
            </div>
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
}) {
    const { showBOMTable, showTimeline, showChildMOs, showSignatureLine,
        headerCompanyName, headerDepartment, headerApprovedBy, headerReference } = printSettings;

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

    const sectionLabelStyle: React.CSSProperties = {
        fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase',
        color: '#212529', letterSpacing: '0.5px', marginBottom: '6px',
    };
    const toggleLabelStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', gap: '8px',
        fontSize: '12px', color: '#212529', cursor: 'pointer',
    };
    const fieldLabelStyle: React.CSSProperties = {
        fontSize: '10px', color: '#212529', marginBottom: '3px', fontWeight: '500',
    };
    const fieldInputStyle: React.CSSProperties = {
        width: '100%', fontSize: '11px', padding: '3px 6px',
        border: '1px solid #ced4da', boxSizing: 'border-box', color: '#000',
    };

    const displayCompanyName = headerCompanyName || companyProfile?.name || '';

    const documentContent = (
        <>
            {/* Company header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #000', paddingBottom: '8px', marginBottom: '10px' }}>
                <div>
                    {companyProfile?.logo_url ? (
                        <img src={companyProfile.logo_url} alt="Logo" style={{ maxHeight: '64px', maxWidth: '200px', objectFit: 'contain', display: 'block', marginBottom: '4px' }} />
                    ) : (
                        <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#0058e6' }}>{displayCompanyName}</div>
                    )}
                    {companyProfile?.address && <div style={{ color: '#555' }}>{companyProfile.address}</div>}
                    {(companyProfile?.phone || companyProfile?.email) && (
                        <div style={{ color: '#555' }}>{[companyProfile?.phone, companyProfile?.email].filter(Boolean).join(' \xb7 ')}</div>
                    )}
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>Manufacturing Order</div>
                    {headerDepartment && <div style={{ color: '#555' }}>Dept: <strong>{headerDepartment}</strong></div>}
                    {headerApprovedBy && <div style={{ color: '#555' }}>Approved By: <strong>{headerApprovedBy}</strong></div>}
                    {headerReference && <div style={{ color: '#555' }}>Ref: <strong>{headerReference}</strong></div>}
                </div>
            </div>

            {/* WO identity row */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '10px' }}>
                <div style={{ border: '2px solid #000', padding: '3px', flexShrink: 0 }}>
                    {qrDataUrl
                        ? <img src={qrDataUrl} alt="QR" style={{ width: '84px', height: '84px', display: 'block' }} />
                        : <div style={{ width: '84px', height: '84px', background: '#eee' }} />
                    }
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: 'bold', color: '#0058e6' }}>{wo.code}</div>
                    <div style={{ fontSize: '8px', background: '#f0ad4e', display: 'inline-block', padding: '1px 5px', color: '#000', fontWeight: 'bold', margin: '2px 0' }}>{wo.status}</div>
                    <div style={{ marginTop: '4px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
                        <div><span style={{ color: '#666' }}>Item:</span> <strong>{wo.item_name || getItemName(wo.item_id)}</strong></div>
                        <div><span style={{ color: '#666' }}>Qty:</span> <strong>{wo.qty}</strong></div>
                        {showTimeline && (
                            <>
                                <div><span style={{ color: '#666' }}>Target Start:</span> <strong>{formatDate(wo.target_start_date) || '—'}</strong></div>
                                <div><span style={{ color: '#666' }}>Target End:</span> <strong>{formatDate(wo.target_end_date) || '—'}</strong></div>
                                <div><span style={{ color: '#666' }}>Actual Start:</span> <strong>{wo.actual_start_date ? formatDate(wo.actual_start_date) : '—'}</strong></div>
                                <div><span style={{ color: '#666' }}>Actual End:</span> <strong>{wo.actual_end_date ? formatDate(wo.actual_end_date) : '—'}</strong></div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* BOM / Materials Table */}
            {showBOMTable && (() => {
                const bom = boms.find((b: any) => b.id === wo.bom_id);
                return (
                    <>
                        <div style={{ fontSize: '8px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.3px', marginBottom: '3px', borderTop: '1px solid #ccc', paddingTop: '6px' }}>
                            Bill of Materials
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8px', marginBottom: '10px' }}>
                            <thead>
                                <tr style={{ background: '#f0f0f0' }}>
                                    <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'left' }}>Code</th>
                                    <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'left' }}>Component</th>
                                    <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'left' }}>Specs</th>
                                    <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'left' }}>Source</th>
                                    <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'right' }}>Req. Qty</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bom ? renderPrintBOMLines(wo, bom.lines, 0, 1, bom, { boms, getItemName, getItemCode, getLocationName, getAttributeValueName }) : (
                                    <tr><td colSpan={5} style={{ border: '1px solid #ccc', padding: '4px', color: '#888' }}>No BOM found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </>
                );
            })()}

            {/* Child Manufacturing Orders */}
            {showChildMOs && renderChildWOsPrint(wo.child_mos || [], childQrUrls, { getItemName, getLocationName, formatDate })}

            {/* Signature / footer */}
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#555', borderTop: '1px solid #ccc', paddingTop: '8px' }}>
                <div>Printed: {new Date().toLocaleString()}</div>
                {showSignatureLine && (
                    <div style={{ textAlign: 'center', width: '140px' }}>
                        <div style={{ borderBottom: '1px solid #000', height: '28px', marginBottom: '2px' }}></div>
                        Authorized Signature
                    </div>
                )}
            </div>
        </>
    );

    return (
        <>
            {/* Backdrop + modal box */}
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
                        <span>Print Manufacturing Order &mdash; {wo.code}</span>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'inherit', fontSize: '14px', cursor: 'pointer', lineHeight: '1', fontWeight: 'bold' }}>X</button>
                    </div>

                    {/* Body row: left panel + right panel */}
                    <div style={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden' }}>

                        {/* LEFT PANEL */}
                        <div style={{ width: '230px', minWidth: '230px', borderRight: '1px solid #dee2e6', background: '#f8f9fa', padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>

                            {/* Section toggles */}
                            <div>
                                <div style={sectionLabelStyle}>Sections</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                    <label style={{ ...toggleLabelStyle, opacity: 0.5 }}>
                                        <input type="checkbox" checked disabled />
                                        QR Code <span style={{ fontSize: '10px', color: '#555' }}>(always on)</span>
                                    </label>
                                    <label style={toggleLabelStyle}>
                                        <input type="checkbox" checked={showBOMTable} onChange={e => update({ showBOMTable: e.target.checked })} />
                                        BOM / Materials Table
                                    </label>
                                    <label style={toggleLabelStyle}>
                                        <input type="checkbox" checked={showTimeline} onChange={e => update({ showTimeline: e.target.checked })} />
                                        Timeline
                                    </label>
                                    <label style={toggleLabelStyle}>
                                        <input type="checkbox" checked={showChildMOs} onChange={e => update({ showChildMOs: e.target.checked })} />
                                        Child Manufacturing Orders
                                    </label>
                                    <label style={toggleLabelStyle}>
                                        <input type="checkbox" checked={showSignatureLine} onChange={e => update({ showSignatureLine: e.target.checked })} />
                                        Signature Line
                                    </label>
                                </div>
                            </div>

                            <hr style={{ margin: '0', borderColor: '#dee2e6' }} />

                            {/* Header fields */}
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
                                            <input
                                                type="text"
                                                value={value}
                                                onChange={e => update({ [key]: e.target.value } as Partial<PrintSettings>)}
                                                style={fieldInputStyle}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Footer note */}
                            <div style={{ fontSize: '10px', color: '#555', marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid #dee2e6' }}>
                                Paper size &amp; margins set in browser print dialog.
                            </div>
                        </div>

                        {/* RIGHT PANEL — preview */}
                        <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: '16px', display: 'flex', justifyContent: 'center' }}>
                            <div className="wo-print-paper" style={{ background: '#fff', width: '100%', maxWidth: '560px', padding: '24px 28px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', fontSize: '9px', lineHeight: '1.5', color: '#000', fontFamily: 'Arial, sans-serif' }}>
                                {documentContent}
                            </div>
                        </div>

                    </div>

                    {/* Modal footer */}
                    <div style={{ padding: '8px 12px', borderTop: '1px solid #dee2e6', background: '#f8f9fa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', color: '#666' }}>Settings saved automatically</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            {isClassic ? (
                                <>
                                    <button style={xpBtnGrey} onClick={onClose}>Close</button>
                                    <button style={xpBtnGreen} onClick={() => { const handler = () => onClose(); window.addEventListener('afterprint', handler, { once: true }); window.print(); }}>Print</button>
                                </>
                            ) : (
                                <>
                                    <button className="btn btn-sm btn-secondary" onClick={onClose}>Close</button>
                                    <button className="btn btn-sm btn-success" onClick={() => { const handler = () => onClose(); window.addEventListener('afterprint', handler, { once: true }); window.print(); }}>
                                        <i className="bi bi-printer me-1"></i>Print
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                </div>
            </div>

            {/* Print portal — hidden off-screen; print CSS makes it the only visible element */}
            {createPortal(
                <div className="wo-print-paper-portal" style={{ display: 'none' }}>
                    <div className="wo-print-paper" style={{ background: '#fff', width: '100%', maxWidth: '560px', padding: '24px 28px', fontSize: '9px', lineHeight: '1.5', color: '#000', fontFamily: 'Arial, sans-serif' }}>
                        {documentContent}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
