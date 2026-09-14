'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '../../context/DataContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { PRINT_FONT } from '../shared/xpTheme';

import { fmtMoney } from '../shared/format';

// PO document fields (SSN, rate, kurs, code, payment, category, VAT, discount, notes)
// now live on the PurchaseOrder record — entered at PO creation, read here from `po`.
// Only signatures and the footer-notes toggle remain print-time preferences.
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

const FOOTER_NOTES = [
    'Please confirm before delivery',
    'Please sign and fax back to confirm the order',
    'Please fill in PO Number in your delivery note. If not, goods will be rejected.',
    'Please deliver the goods based on delivery schedule or special request',
    'Goods are accepted from Monday to Friday at 09:00 AM - 03:00 PM',
];

const MIN_TABLE_ROWS = 8;

const money = fmtMoney;

const formatDate = (d: string | null | undefined) => {
    if (!d) return '';
    try {
        const dt = new Date(d);
        return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
    } catch { return ''; }
};

// Deterministic decorative barcode strip derived from the PO number (not a scannable symbology).
function Barcode({ value }: { value: string }) {
    const bars: { w: number; on: boolean }[] = [];
    const seed = value || 'PO';
    for (let i = 0; i < seed.length; i++) {
        const c = seed.charCodeAt(i);
        bars.push({ w: (c % 3) + 1, on: true });
        bars.push({ w: (c % 2) + 1, on: false });
        bars.push({ w: ((c >> 2) % 3) + 1, on: true });
        bars.push({ w: 1, on: false });
    }
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', height: 42, gap: 0 }}>
            {bars.map((b, i) => (
                <div key={i} style={{ width: b.w * 1.4, height: '100%', background: b.on ? '#000' : 'transparent' }} />
            ))}
        </div>
    );
}

function PODocument({
    po, companyProfile, items, attributes, partners, settings,
}: {
    po: any;
    companyProfile: any;
    items: any[];
    attributes: any[];
    partners: any[];
    settings: POPrintSettings;
}) {
    const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace(/\/api$/, '');
    const { itemIndex } = useData();

    const getItemName = (line: any) => line.item_name || items.find((i: any) => i.id === line.item_id)?.name || itemIndex?.[String(line.item_id)]?.name || line.item_id;
    const getItemUOM = (line: any) => line.item_uom || items.find((i: any) => i.id === line.item_id)?.uom || '';
    const supplier = partners.find((p: any) => p.id === po.supplier_id);
    const getAttributeValueName = (valId: string) => {
        for (const attr of attributes) {
            const val = attr.values?.find((v: any) => v.id === valId);
            if (val) return val.value;
        }
        return '';
    };

    const lineTotal = (line: any) => (Number(line.qty) || 0) * (Number(line.unit_price) || 0);
    const subtotal = po.lines.reduce((s: number, l: any) => s + lineTotal(l), 0);
    // vat_percent === null means the PO was saved with the VAT checkbox off — no VAT
    // row on the document at all. An explicit 0 is still a VAT line (rate 0%).
    const hasVat = po.vat_percent != null;
    const vatPercent = Number(po.vat_percent) || 0;
    const discount = Number(po.discount) || 0;
    const vat = hasVat ? (subtotal - discount) * vatPercent / 100 : 0;
    const total = subtotal - discount + vat;

    const paddedLines = [
        ...po.lines,
        ...Array(Math.max(0, MIN_TABLE_ROWS - po.lines.length)).fill(null),
    ];

    const border = '1px solid #000';
    const cell: React.CSSProperties = { border, padding: '2px 5px', verticalAlign: 'top' };
    const labelCell: React.CSSProperties = { whiteSpace: 'nowrap', verticalAlign: 'top', paddingRight: 4 };

    return (
        <div style={{ fontFamily: PRINT_FONT, fontSize: '9px', color: '#000', lineHeight: 1.35 }}>

            {/* Company Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4, paddingBottom: 6, borderBottom: '1.5px solid #000' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flexShrink: 0 }}>
                        {companyProfile?.logo_url ? (
                            <img src={`${API_BASE}${companyProfile.logo_url}`} alt="Logo"
                                style={{ maxHeight: 56, maxWidth: 64, objectFit: 'contain', display: 'block' }} />
                        ) : (
                            <div style={{ width: 52, height: 52, borderRadius: '50%', border: '2px solid #000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 13 }}>BIE</div>
                        )}
                    </div>
                    <div>
                        <div style={{ fontWeight: 'bold', fontSize: 15, letterSpacing: '0.3px' }}>{companyProfile?.name || 'PT BOLA INTAN ELASTIC'}</div>
                        {companyProfile?.address && <div style={{ whiteSpace: 'pre-line' }}>{companyProfile.address}</div>}
                        <div>
                            {companyProfile?.phone && <span>Telp: {companyProfile.phone}</span>}
                            {companyProfile?.fax && <span>{companyProfile?.phone ? '  ' : ''}FAX: {companyProfile.fax}</span>}
                        </div>
                        {companyProfile?.email && <div>Email: {companyProfile.email}</div>}
                    </div>
                </div>
                <div style={{ textAlign: 'right' as const }}>
                    <Barcode value={po.po_number} />
                    <div style={{ fontSize: 22, fontWeight: 'bold', marginTop: 2 }}>PURCHASE ORDER</div>
                </div>
            </div>

            {/* Supplier / Contact / PO meta block */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px' }}>
                <tbody>
                    <tr>
                        {/* Supplier */}
                        <td style={{ ...cell, width: '46%' }}>
                            <div style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: 4 }}>SUPPLIER</div>
                            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                                <tbody>
                                    <tr><td style={labelCell}>Attn</td><td>: {supplier?.contact_person || ''}</td></tr>
                                    <tr><td style={labelCell}>Company</td><td>: {supplier?.name || ''}</td></tr>
                                    <tr><td style={labelCell}>Address</td><td style={{ whiteSpace: 'pre-line' }}>: {supplier?.address || ''}</td></tr>
                                </tbody>
                            </table>
                        </td>
                        {/* Contact Person */}
                        <td style={{ ...cell, width: '27%' }}>
                            <div style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: 4 }}>CONTACT PERSON</div>
                            <div>Telp : {supplier?.phone || ''}</div>
                            <div style={{ marginTop: 10 }}>Fax : {supplier?.fax || ''}</div>
                        </td>
                        {/* PO meta */}
                        <td style={{ ...cell, width: '27%', padding: 0 }}>
                            <table style={{ borderCollapse: 'collapse', width: '100%', height: '100%' }}>
                                <tbody>
                                    <tr><td style={{ ...cell, fontWeight: 'bold' }}>PO NUMBER :</td><td style={{ ...cell, textAlign: 'right' as const, fontWeight: 'bold' }}>{po.po_number}</td></tr>
                                    <tr><td style={{ ...cell, fontWeight: 'bold' }}>SSN :</td><td style={{ ...cell, textAlign: 'right' as const }}>{po.ssn || ''}</td></tr>
                                    <tr><td style={{ ...cell, fontWeight: 'bold' }}>PO DATE :</td><td style={{ ...cell, textAlign: 'right' as const }}>{formatDate(po.order_date)}</td></tr>
                                </tbody>
                            </table>
                        </td>
                    </tr>
                </tbody>
            </table>

            {/* Left meta strip */}
            <table style={{ width: '100%', borderCollapse: 'collapse', borderLeft: border, borderRight: border, borderBottom: border, fontSize: '9px' }}>
                <tbody>
                    {([
                        ['Email', supplier?.email || companyProfile?.email || ''],
                        po.rate_mode === 'ktbi' ? ['KTBI', po.ktbi || ''] : ['Kurs Pajak', po.kurs_pajak || ''],
                        ['Code', po.code || ''],
                        ['Payment', po.payment_term || ''],
                        ['Category', po.category || ''],
                    ] as [string, string][]).map(([label, value]) => (
                        <tr key={label}>
                            <td style={{ width: 80, paddingLeft: 5, fontWeight: 500 }}>{label}</td>
                            <td>: {value}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Items table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px', marginTop: -1 }}>
                <thead>
                    <tr>
                        <th style={{ ...cell, textAlign: 'center', width: '5%' }} rowSpan={2}>No</th>
                        <th style={{ ...cell, textAlign: 'center', width: '37%' }}>DESCRIPTION</th>
                        <th style={{ ...cell, textAlign: 'center', width: '13%' }} rowSpan={2}>Qty</th>
                        <th style={{ ...cell, textAlign: 'center', width: '15%' }}>Price<br />( Rp )</th>
                        <th style={{ ...cell, textAlign: 'center', width: '17%' }}>Total<br />( Rp )</th>
                        <th style={{ ...cell, textAlign: 'center', width: '13%' }} rowSpan={2}>Deadline</th>
                    </tr>
                    <tr>
                        <th style={{ ...cell, textAlign: 'center' }}>Item Description</th>
                        <th style={{ ...cell }}>&nbsp;</th>
                        <th style={{ ...cell }}>&nbsp;</th>
                    </tr>
                </thead>
                <tbody>
                    {paddedLines.map((line: any, idx: number) => (
                        <tr key={idx}>
                            <td style={{ ...cell, textAlign: 'center', height: line ? 'auto' : 26 }}>{line ? idx + 1 : ''}</td>
                            <td style={{ ...cell }}>
                                {line && (
                                    <>
                                        <div style={{ fontWeight: 'bold' }}>{getItemName(line)}</div>
                                        {(line.attribute_value_ids || []).map((vid: string) => (
                                            <div key={vid} style={{ marginTop: 6 }}>{getAttributeValueName(vid)}</div>
                                        ))}
                                    </>
                                )}
                                {!line && <span>&nbsp;</span>}
                            </td>
                            <td style={{ ...cell, textAlign: 'center' }}>{line ? `${Number(line.qty).toLocaleString('en-US')}  ${getItemUOM(line)}`.trim() : ''}</td>
                            <td style={{ ...cell, textAlign: 'right' as const }}>{line && line.unit_price != null ? money(Number(line.unit_price)) : ''}</td>
                            <td style={{ ...cell, textAlign: 'right' as const }}>{line && line.unit_price != null ? money(lineTotal(line)) : ''}</td>
                            <td style={{ ...cell, textAlign: 'center' }}>{line ? formatDate(line.due_date) : ''}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Notes + totals */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px', marginTop: -1 }}>
                <tbody>
                    <tr>
                        <td style={{ ...cell, width: '58%', verticalAlign: 'top' }} rowSpan={hasVat ? 4 : 3}>
                            <div style={{ fontWeight: 'bold' }}>Notes</div>
                            <div style={{ whiteSpace: 'pre-line', marginTop: 2 }}>{po.notes || ''}</div>
                        </td>
                        <td style={{ ...cell, width: '20%', fontWeight: 'bold' }}>Subtotal</td>
                        <td style={{ ...cell, textAlign: 'right' as const }}>Rp&nbsp;&nbsp;{money(subtotal)}</td>
                    </tr>
                    <tr>
                        <td style={{ ...cell, fontWeight: 'bold' }}>Discount</td>
                        <td style={{ ...cell, textAlign: 'right' as const }}>Rp&nbsp;&nbsp;{discount ? money(discount) : ''}</td>
                    </tr>
                    {hasVat && (
                        <tr>
                            <td style={{ ...cell, fontWeight: 'bold' }}>VAT {vatPercent}%</td>
                            <td style={{ ...cell, textAlign: 'right' as const }}>Rp&nbsp;&nbsp;{money(vat)}</td>
                        </tr>
                    )}
                    <tr>
                        <td style={{ ...cell, fontWeight: 'bold' }}>Total</td>
                        <td style={{ ...cell, textAlign: 'right' as const, fontWeight: 'bold' }}>Rp&nbsp;&nbsp;{money(total)}</td>
                    </tr>
                </tbody>
            </table>

            {/* Signatures */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px', marginTop: 8 }}>
                <tbody>
                    <tr>
                        {[
                            ['Prepared by', settings.preparedBy],
                            ['Examined by', settings.examinedBy],
                            ['Approved by', settings.approvedBy],
                            ['Supplier', supplier?.name || ''],
                        ].map(([label, name], i) => (
                            <td key={i} style={{ width: '25%', textAlign: 'center', verticalAlign: 'top', padding: '0 6px' }}>
                                <div style={{ marginBottom: 38 }}>{label}</div>
                                <div style={{ fontWeight: 'bold' }}>{name}</div>
                            </td>
                        ))}
                    </tr>
                </tbody>
            </table>

            {/* Footer notes */}
            {settings.showFooterNotes && (
                <div style={{ marginTop: 14, fontSize: '8.5px' }}>
                    {FOOTER_NOTES.map((note, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 1 }}>
                            <span style={{ width: 28, flexShrink: 0 }}>{i === 0 ? 'Note' : '-'}</span>
                            <span style={{ flexShrink: 0 }}>:</span>
                            <span>{note}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function PurchaseOrderPrintModal({
    po, onClose, companyProfile, items, attributes, partners,
}: {
    po: any;
    onClose: () => void;
    companyProfile: any;
    items: any[];
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

    useEffect(() => {
        document.body.classList.add('po-print-preview-active');
        return () => { document.body.classList.remove('po-print-preview-active'); };
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
        <PODocument
            po={po}
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
                title={`Print Purchase Order — ${po.po_number}`}
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
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#111', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={settings.showFooterNotes} onChange={e => update({ showFooterNotes: e.target.checked })} />
                                    Footer Notes
                                </label>
                            </div>

                            <div style={{ fontSize: 10, color: '#555', marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #dee2e6' }}>
                                Settings saved automatically. Paper size &amp; margins set in browser print dialog.
                            </div>
                        </div>

                        {/* RIGHT — live preview */}
                        <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                            <div className="po-print-paper" style={{ background: '#fff', width: '100%', maxWidth: 720, padding: '20px 24px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', fontSize: '9px', lineHeight: 1.4, color: '#000', fontFamily: PRINT_FONT }}>
                                {docContent}
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <PrintModalFooter note="Settings saved automatically" onClose={onClose} onPrint={handlePrint} />
            </PrintModalShell>

            {/* Print portal — rendered into body, shown only during actual print */}
            {createPortal(
                <div className="po-print-paper-portal" style={{ position: 'fixed', left: '-9999px', top: 0 }}>
                    <div className="po-print-paper" style={{ background: '#fff', width: '100%', padding: '12px 16px', fontSize: '9px', lineHeight: 1.4, color: '#000', fontFamily: PRINT_FONT }}>
                        {docContent}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
