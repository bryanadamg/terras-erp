'use client';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

const TABLE_SETTINGS_KEY = 'so_table_print_settings';

function SOTableDocument({
    salesOrders, items, attributes, partners, companyProfile,
}: {
    salesOrders: any[];
    items: any[];
    attributes: any[];
    partners: any[];
    companyProfile: any;
}) {
    const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace(/\/api$/, '');

    const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
    const getAttributeValues = (ids: string[]) =>
        ids.map(vid => {
            for (const attr of attributes) {
                const val = attr.values?.find((v: any) => v.id === vid);
                if (val) return val.value;
            }
            return '';
        }).filter(Boolean).join(', ');

    const formatDate = (d: string | null | undefined) => {
        if (!d) return '';
        try {
            const dt = new Date(d);
            return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
        } catch { return ''; }
    };

    const formatDateTime = (d: string | null | undefined) => {
        if (!d) return '';
        try {
            const dt = new Date(d);
            return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()} 00.00`;
        } catch { return ''; }
    };

    const formatNum = (v: number | null | undefined) => {
        if (v == null) return '';
        return Number(v).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
    };

    // Expand each SO into flat line-item rows
    const rows: any[] = [];
    for (const so of salesOrders) {
        if (!so.lines || so.lines.length === 0) {
            rows.push({ so, line: null });
        } else {
            for (const line of so.lines) {
                rows.push({ so, line });
            }
        }
    }

    const border = '1px solid #777';
    const th: React.CSSProperties = { border, padding: '3px 4px', background: '#e8e8e8', fontWeight: 'bold', textAlign: 'center' as const, verticalAlign: 'middle', fontSize: '7.5px', lineHeight: 1.2 };
    const td: React.CSSProperties = { border, padding: '3px 4px', verticalAlign: 'top', fontSize: '7.5px', lineHeight: 1.3 };

    const today = new Date();
    const monthNames = ['JANUARI','FEBRUARI','MARET','APRIL','MEI','JUNI','JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER'];
    const dateHeader = `${String(today.getDate()).padStart(2,'0')} ${monthNames[today.getMonth()]} ${today.getFullYear()}`;

    return (
        <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '7.5px', color: '#000', lineHeight: 1.3 }}>
            {/* Company header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingBottom: 4, borderBottom: '2px solid #000' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {companyProfile?.logo_url ? (
                        <img src={`${API_BASE}${companyProfile.logo_url}`} alt="Logo"
                            style={{ maxHeight: 36, maxWidth: 52, objectFit: 'contain', display: 'block' }} />
                    ) : (
                        <div style={{ width: 40, height: 30, border: '2px solid #003080', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 9, color: '#003080' }}>BIE</div>
                    )}
                    <div>
                        <div style={{ fontWeight: 'bold', fontSize: 9 }}>{companyProfile?.name || 'PT. BOLA INTAN ELASTIC'}</div>
                        {companyProfile?.address && <div style={{ fontSize: 7 }}>{companyProfile.address}</div>}
                    </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 'bold', fontSize: 11 }}>{dateHeader}</div>
                    <div style={{ fontSize: 7, color: '#555' }}>Sales Order List — {rows.length} line(s)</div>
                </div>
            </div>

            {/* Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                    <tr>
                        <th style={{ ...th, width: '2%' }}>No</th>
                        <th style={{ ...th, width: '7%' }}>Date</th>
                        <th style={{ ...th, width: '7%' }}>Ref No. (PO#)</th>
                        <th style={{ ...th, width: '7%' }}>Customer PO Ref</th>
                        <th style={{ ...th, width: '12%' }}>Customer</th>
                        <th style={{ ...th, width: '7%' }}>Del. Request</th>
                        <th style={{ ...th, width: '7%' }}>Del. Confirmation</th>
                        <th style={{ ...th, width: '9%' }}>Stock Notes</th>
                        <th style={{ ...th, width: '13%' }}>Item</th>
                        <th style={{ ...th, width: '6%' }}>Size</th>
                        <th style={{ ...th, width: '5%' }}>Qty (Yd)</th>
                        <th style={{ ...th, width: '5%' }}>Qty (m)</th>
                        <th style={{ ...th, width: '5%' }}>Qty (KG)</th>
                        <th style={{ ...th, width: '7%' }}>Qty 3</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(({ so, line }, idx) => (
                        <tr key={`${so.id}-${line?.id ?? 'empty'}`} style={{ background: idx % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                            <td style={{ ...td, textAlign: 'center' }}>{idx + 1}</td>
                            <td style={{ ...td, textAlign: 'center' }}>{formatDate(so.order_date)}</td>
                            <td style={{ ...td, fontWeight: 'bold', wordBreak: 'break-all' }}>{so.po_number}</td>
                            <td style={{ ...td, wordBreak: 'break-all' }}>{so.customer_po_ref || ''}</td>
                            <td style={{ ...td }}>{so.customer_name}</td>
                            <td style={{ ...td, textAlign: 'center' }}>{line ? formatDate(line.due_date) : ''}</td>
                            <td style={{ ...td, textAlign: 'center' }}>{line ? formatDate(line.internal_confirmation_date) : ''}</td>
                            <td style={{ ...td }}>{line?.ket_stock || ''}</td>
                            <td style={{ ...td }}>{line ? getItemName(line.item_id) : ''}</td>
                            <td style={{ ...td, textAlign: 'center' }}>
                                {line ? getAttributeValues(line.attribute_value_ids || []) : ''}
                            </td>
                            <td style={{ ...td, textAlign: 'right' }}>{line ? formatNum(line.qty) : ''}</td>
                            <td style={{ ...td, textAlign: 'right' }}>
                                {line && line.qty ? formatNum(Math.round(line.qty * 0.9144 * 100) / 100) : ''}
                            </td>
                            <td style={{ ...td, textAlign: 'right' }}>{line ? formatNum(line.qty_kg) : ''}</td>
                            <td style={{ ...td, textAlign: 'right' }}>
                                {line && line.qty2 != null && line.qty2 !== ''
                                    ? `${formatNum(line.qty2)}${line.uom2 ? ' ' + line.uom2 : ''}`
                                    : ''}
                            </td>
                        </tr>
                    ))}
                    {rows.length === 0 && (
                        <tr>
                            <td colSpan={14} style={{ ...td, textAlign: 'center', padding: '12px', color: '#888', fontStyle: 'italic' }}>No sales orders to display.</td>
                        </tr>
                    )}
                </tbody>
            </table>

            <div style={{ marginTop: 8, fontSize: '7px', color: '#555', display: 'flex', justifyContent: 'space-between' }}>
                <span>Printed: {new Date().toLocaleString('id-ID')}</span>
                <span>Total rows: {rows.length}</span>
            </div>
        </div>
    );
}

export default function SOTablePrintModal({
    salesOrders, onClose, currentStyle, companyProfile, items, attributes, partners,
}: {
    salesOrders: any[];
    onClose: () => void;
    currentStyle: string;
    companyProfile: any;
    items: any[];
    attributes: any[];
    partners: any[];
}) {
    const isClassic = currentStyle === 'classic';

    useEffect(() => {
        document.body.classList.add('so-table-print-active');
        return () => { document.body.classList.remove('so-table-print-active'); };
    }, []);

    const handlePrint = () => {
        const pageStyle = document.createElement('style');
        pageStyle.id = '__so-table-page';
        pageStyle.textContent = '@page { size: A4 landscape; margin: 10mm; }';
        document.head.appendChild(pageStyle);
        const handler = () => {
            onClose();
            document.getElementById('__so-table-page')?.remove();
        };
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

    const docContent = (
        <SOTableDocument
            salesOrders={salesOrders}
            items={items}
            attributes={attributes}
            partners={partners}
            companyProfile={companyProfile}
        />
    );

    return (
        <>
            <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={onClose}
            >
                <div
                    style={{ background: '#fff', width: '96vw', maxWidth: 1300, height: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div style={headerStyle} className={headerClass}>
                        <span>Print Sales Order Table — {salesOrders.length} order(s)</span>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'inherit', fontSize: 16, cursor: 'pointer', lineHeight: 1, fontWeight: 'bold' }}>X</button>
                    </div>

                    {/* Preview — A4 landscape: 297mm × 210mm ≈ 1122px × 794px at 96dpi */}
                    <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', overflowX: 'auto', padding: 16 }}>
                        <div
                            className="so-table-print-paper"
                            style={{ background: '#fff', width: 1090, minWidth: 1090, padding: '12px 16px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', fontSize: '7.5px', lineHeight: 1.4, color: '#000', fontFamily: 'Arial, sans-serif' }}
                        >
                            {docContent}
                        </div>
                    </div>

                    {/* Footer */}
                    <div style={{ padding: '8px 12px', borderTop: '1px solid #dee2e6', background: '#f8f9fa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 10, color: '#555' }}>
                            Landscape orientation is set automatically — no need to change the browser print dialog.
                        </span>
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

            {/* Print portal */}
            {createPortal(
                <div className="so-table-print-portal" style={{ position: 'fixed', left: '-9999px', top: 0 }}>
                    <div className="so-table-print-paper" style={{ background: '#fff', width: '100%', boxSizing: 'border-box', padding: '0', fontSize: '7.5px', lineHeight: 1.4, color: '#000', fontFamily: 'Arial, sans-serif' }}>
                        {docContent}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
