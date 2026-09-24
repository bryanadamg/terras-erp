'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '../../context/DataContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { PRINT_FONT, PRINT_SERIF_FONT } from '../shared/xpTheme';
import { STATIC_BASE } from '../shared/apiBase';

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
    const { itemIndex } = useData();

    const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || itemIndex?.[String(id)]?.name || id;
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
        <div style={{ fontFamily: PRINT_FONT, fontSize: '8.5px', color: '#000', lineHeight: 1.4 }}>

            {/* Company Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6, paddingBottom: 5, borderBottom: '2px solid #000' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flexShrink: 0 }}>
                        {companyProfile?.logo_url ? (
                            <img src={`${STATIC_BASE}${companyProfile.logo_url}`} alt="Logo"
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
                    <div style={{ fontSize: 16, fontWeight: 'bold', fontFamily: PRINT_SERIF_FONT }}>Sales Order Confirmation</div>
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
    so, onClose, companyProfile, items, attributes, partners,
}: {
    so: any;
    onClose: () => void;
    companyProfile: any;
    items: any[];
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

    useEffect(() => {
        document.body.classList.add('so-print-preview-active');
        return () => { document.body.classList.remove('so-print-preview-active'); };
    }, []);

    const handlePrint = () => {
        const handler = () => onClose();
        window.addEventListener('afterprint', handler, { once: true });
        window.print();
    };

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
            <PrintModalShell
                title={`Print Sales Order Confirmation — ${so.po_number}`}
                onClose={onClose}
                width="calc(var(--app-vw) * 92 / 100)"
                maxWidth={1020}
                height="calc(var(--app-vh) * 90 / 100)"
                bevel={false}
                modeless
            >
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
                            <div className="so-print-paper" style={{ background: '#fff', width: '100%', maxWidth: 640, padding: '20px 24px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', fontSize: '8.5px', lineHeight: 1.5, color: '#000', fontFamily: PRINT_FONT }}>
                                {docContent}
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <PrintModalFooter note="Settings saved automatically" onClose={onClose} onPrint={handlePrint} />
            </PrintModalShell>

            {/* Print portal — rendered into body, shown only during actual print */}
            {createPortal(
                <div className="so-print-paper-portal" style={{ position: 'fixed', left: '-9999px', top: 0 }}>
                    <div className="so-print-paper" style={{ background: '#fff', width: '100%', padding: '20px 24px', fontSize: '8.5px', lineHeight: 1.5, color: '#000', fontFamily: PRINT_FONT }}>
                        {docContent}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
