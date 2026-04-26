'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

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

const ATTENTION_NOTES = [
    'Price is excluded VAT.',
    "Claim only accepted within 15 days up on receiving goods date.\nClaim can't be accepted if goods had been cut or lost",
    'We do not accept changing color or cancelation if elastic has been processed or dyed.',
    'Color tolerance between lot to lot are within 5% tolerance must be accepted by customer',
    'Delivery cost outside JABODETABEK area will be on customer cost.',
];

const MIN_TABLE_ROWS = 12;

function SODocument({
    so, companyProfile, items, attributes, partners, settings,
}: {
    so: any;
    companyProfile: any;
    items: any[];
    attributes: any[];
    partners: any[];
    settings: SOPrintSettings;
}) {
    const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace(/\/api$/, '');

    const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
    const getItemUOM = (id: string) => items.find((i: any) => i.id === id)?.uom || '';
    const getCustomerAddress = (name: string) => partners.find((p: any) => p.name === name)?.address || '';
    const getAttributeValueName = (valId: string) => {
        for (const attr of attributes) {
            const val = attr.values?.find((v: any) => v.id === valId);
            if (val) return val.value;
        }
        return '';
    };

    const formatDate = (d: string | null | undefined) => {
        if (!d) return '';
        try {
            const dt = new Date(d);
            return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
        } catch { return ''; }
    };

    const paddedLines = [
        ...so.lines,
        ...Array(Math.max(0, MIN_TABLE_ROWS - so.lines.length)).fill(null),
    ];

    const border = '1px solid #555';
    const cell: React.CSSProperties = { border, padding: '3px 5px', verticalAlign: 'top' };
    const hCell: React.CSSProperties = { ...cell, background: '#f0f0f0', fontWeight: 'bold', textAlign: 'center' as const };

    return (
        <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8.5px', color: '#000', lineHeight: 1.4 }}>

            {/* Company Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6, paddingBottom: 5, borderBottom: '2px solid #000' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flexShrink: 0 }}>
                        {companyProfile?.logo_url ? (
                            <img src={`${API_BASE}${companyProfile.logo_url}`} alt="Logo"
                                style={{ maxHeight: 52, maxWidth: 72, objectFit: 'contain', display: 'block' }} />
                        ) : (
                            <div style={{ width: 56, height: 44, border: '2px solid #003080', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 11, color: '#003080' }}>BIE</div>
                        )}
                    </div>
                    <div>
                        <div style={{ fontWeight: 'bold', fontSize: 11 }}>{companyProfile?.name || 'PT. BOLA INTAN ELASTIC'}</div>
                        {companyProfile?.address && <div>{companyProfile.address}</div>}
                        <div>
                            {companyProfile?.phone && <span>Telp: {companyProfile.phone}</span>}
                            {companyProfile?.phone && companyProfile?.fax && <span> - {companyProfile.fax}</span>}
                            {!companyProfile?.phone && companyProfile?.fax && <span>Fax: {companyProfile.fax}</span>}
                        </div>
                        {companyProfile?.email && <div>Email: {companyProfile.email}</div>}
                    </div>
                </div>
                <div style={{ alignSelf: 'flex-end' }}>
                    <div style={{ fontSize: 16, fontWeight: 'bold', fontFamily: 'Georgia, serif' }}>Sales Order Confirmation</div>
                </div>
            </div>

            {/* Info Block */}
            <div style={{ display: 'flex', marginBottom: 6, paddingBottom: 5, borderBottom: border }}>
                {/* Order fields */}
                <div style={{ width: '22%', minWidth: 110 }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '8.5px' }}>
                        <tbody>
                            {([
                                ['No', so.po_number],
                                ['Date', formatDate(so.order_date)],
                                ['PO No', ''],
                                ['Payment Term', ''],
                            ] as [string, string][]).map(([label, value]) => (
                                <tr key={label}>
                                    <td style={{ fontWeight: 'bold', paddingRight: 3, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{label}</td>
                                    <td style={{ verticalAlign: 'top' }}>: {value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Consignee */}
                <div style={{ flex: 1, padding: '0 10px', borderLeft: '1px solid #ccc', borderRight: '1px solid #ccc' }}>
                    <div style={{ fontWeight: 'bold' }}>Consignee :</div>
                    <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 'bold' }}>{so.customer_name}</div>
                        <div style={{ whiteSpace: 'pre-line' }}>{getCustomerAddress(so.customer_name)}</div>
                    </div>
                </div>

                {/* Attn */}
                <div style={{ width: '18%', minWidth: 80, paddingLeft: 8 }}>
                    <div style={{ fontWeight: 'bold' }}>Attn :</div>
                    {settings.attn && <div>{settings.attn}</div>}
                    {settings.attnRole && <div>{settings.attnRole}</div>}
                </div>
            </div>

            {/* Items Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5px' }}>
                <thead>
                    <tr>
                        <th style={{ ...hCell, width: '4%' }}>No</th>
                        <th style={{ ...hCell, width: '30%', textAlign: 'left' as const }}>Article</th>
                        <th style={{ ...hCell, width: '12%' }}>Qty/Unit</th>
                        <th style={{ ...hCell, width: '12%' }}>Del. Request</th>
                        <th style={{ ...hCell, width: '12%' }}>Del. Confirmation</th>
                        <th style={{ ...hCell, width: '15%' }}>Price</th>
                        <th style={{ ...hCell, width: '15%' }}>Total</th>
                    </tr>
                </thead>
                <tbody>
                    {paddedLines.map((line: any, idx: number) => (
                        <tr key={idx} style={{ minHeight: 22 }}>
                            <td style={{ ...cell, textAlign: 'center', minHeight: 22 }}>{line ? idx + 1 : ' '}</td>
                            <td style={{ ...cell, minHeight: 22 }}>
                                {line && (
                                    <>
                                        <div style={{ fontWeight: 'bold' }}>{getItemName(line.item_id)}</div>
                                        {(line.attribute_value_ids || []).map((vid: string) => (
                                            <div key={vid}>{getAttributeValueName(vid)}</div>
                                        ))}
                                    </>
                                )}
                                {!line && <span>&nbsp;</span>}
                            </td>
                            <td style={{ ...cell, textAlign: 'center' }}>
                                {line ? `${Number(line.qty).toLocaleString()} ${getItemUOM(line.item_id)}`.trim() : ''}
                            </td>
                            <td style={{ ...cell, textAlign: 'center' }}>{line ? formatDate(line.due_date) : ''}</td>
                            <td style={{ ...cell, textAlign: 'center' }}>&nbsp;</td>
                            <td style={{ ...cell }}>&nbsp;</td>
                            <td style={{ ...cell }}>&nbsp;</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Notes + Totals */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5px' }}>
                <tbody>
                    <tr>
                        <td rowSpan={2} style={{ ...cell, width: '60%', verticalAlign: 'top' }}>Notes:</td>
                        <td style={{ ...cell, width: '20%', fontWeight: 'bold', textAlign: 'right' as const }}>VAT</td>
                        <td style={{ ...cell, width: '20%' }}>Rp</td>
                    </tr>
                    <tr>
                        <td style={{ ...cell, fontWeight: 'bold', textAlign: 'right' as const }}>Total Ammount</td>
                        <td style={{ ...cell }}>Rp</td>
                    </tr>
                </tbody>
            </table>

            {/* Signatures */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18, fontSize: '8.5px' }}>
                <div>
                    <div>Prepared by,</div>
                    <div style={{ height: 42 }}></div>
                    <div>
                        <span style={{ marginRight: 6 }}>(</span>
                        {settings.preparedBy || '_________________'}
                        <span style={{ marginLeft: 6 }}>)</span>
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div>Approved by,</div>
                    <div style={{ height: 42 }}></div>
                    <div>
                        <span style={{ marginRight: 6 }}>(</span>
                        {so.customer_name}
                        <span style={{ marginLeft: 6 }}>)</span>
                    </div>
                </div>
            </div>

            {/* Attention Notes */}
            {settings.showAttentionNotes && (
                <div style={{ marginTop: 14, fontSize: '8px', borderTop: '1px solid #bbb', paddingTop: 6 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 2 }}>Attention:</div>
                    {ATTENTION_NOTES.map((note, i) => (
                        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 1 }}>
                            <span style={{ flexShrink: 0 }}>{i + 1}.</span>
                            <span style={{ whiteSpace: 'pre-line' }}>{note}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function SalesPrintModal({
    so, onClose, currentStyle, companyProfile, items, attributes, partners,
}: {
    so: any;
    onClose: () => void;
    currentStyle: string;
    companyProfile: any;
    items: any[];
    attributes: any[];
    partners: any[];
}) {
    const isClassic = currentStyle === 'classic';

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

    useEffect(() => {
        document.body.classList.add('so-print-preview-active');
        return () => { document.body.classList.remove('so-print-preview-active'); };
    }, []);

    const handlePrint = () => {
        const handler = () => onClose();
        window.addEventListener('afterprint', handler, { once: true });
        window.print();
    };

    const headerStyle: React.CSSProperties = isClassic
        ? { background: 'linear-gradient(to right, #0058e6, #08a5ff)', color: '#fff', fontFamily: 'Tahoma', fontWeight: 'bold', fontSize: 12, padding: '5px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
        : {};
    const headerClass = isClassic ? '' : 'bg-primary text-white px-3 py-2 d-flex justify-content-between align-items-center';

    const xpBtnGrey: React.CSSProperties = isClassic
        ? { fontFamily: 'Tahoma', fontSize: 11, padding: '3px 12px', background: 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', cursor: 'pointer', color: '#000' }
        : {};
    const xpBtnGreen: React.CSSProperties = isClassic
        ? { fontFamily: 'Tahoma', fontSize: 11, padding: '3px 14px', background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)', border: '1px solid', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }
        : {};

    const sectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase' as const, color: '#111', letterSpacing: '0.5px', marginBottom: 6 };
    const fieldLabel: React.CSSProperties = { fontSize: 10, color: '#111', marginBottom: 3, fontWeight: 500 };
    const fieldInput: React.CSSProperties = { width: '100%', fontSize: 11, padding: '3px 6px', border: '1px solid #ced4da', boxSizing: 'border-box' as const, color: '#000' };

    const docContent = (
        <SODocument
            so={so}
            companyProfile={companyProfile}
            items={items}
            attributes={attributes}
            partners={partners}
            settings={settings}
        />
    );

    return (
        <>
            <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={onClose}
            >
                <div
                    style={{ background: '#fff', width: '92vw', maxWidth: 1020, height: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div style={headerStyle} className={headerClass}>
                        <span>Print Sales Order Confirmation — {so.po_number}</span>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'inherit', fontSize: 16, cursor: 'pointer', lineHeight: 1, fontWeight: 'bold' }}>X</button>
                    </div>

                    {/* Body */}
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                        {/* LEFT — settings panel */}
                        <div style={{ width: 210, minWidth: 210, borderRight: '1px solid #dee2e6', background: '#f8f9fa', padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

                            <div>
                                <div style={sectionLabel}>Sections</div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#111', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={settings.showAttentionNotes} onChange={e => update({ showAttentionNotes: e.target.checked })} />
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
                                Settings saved automatically. Paper size &amp; margins set in browser print dialog.
                            </div>
                        </div>

                        {/* RIGHT — live preview */}
                        <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                            <div className="so-print-paper" style={{ background: '#fff', width: '100%', maxWidth: 640, padding: '20px 24px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', fontSize: '8.5px', lineHeight: 1.5, color: '#000', fontFamily: 'Arial, sans-serif' }}>
                                {docContent}
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <div style={{ padding: '8px 12px', borderTop: '1px solid #dee2e6', background: '#f8f9fa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 10, color: '#555' }}>Settings saved automatically</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                            {isClassic ? (
                                <>
                                    <button style={xpBtnGrey} onClick={onClose}>Close</button>
                                    <button style={xpBtnGreen} onClick={handlePrint}>Print</button>
                                </>
                            ) : (
                                <>
                                    <button className="btn btn-sm btn-secondary" onClick={onClose}>Close</button>
                                    <button className="btn btn-sm btn-success" onClick={handlePrint}>
                                        <i className="bi bi-printer me-1"></i>Print
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Print portal — rendered into body, shown only during actual print */}
            {createPortal(
                <div className="so-print-paper-portal" style={{ position: 'fixed', left: '-9999px', top: 0 }}>
                    <div className="so-print-paper" style={{ background: '#fff', width: '100%', padding: '20px 24px', fontSize: '8.5px', lineHeight: 1.5, color: '#000', fontFamily: 'Arial, sans-serif' }}>
                        {docContent}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
