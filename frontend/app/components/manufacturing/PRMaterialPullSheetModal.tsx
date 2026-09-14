'use client';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { CODE_FONT, PRINT_FONT } from '../shared/xpTheme';
import { useTimezone } from '../../context/TimezoneContext';

const STATIC_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000').replace(/\/api$/, '');

/**
 * Kickoff-time store request: aggregated material demand for one Production Run,
 * sectioned by source location so each store sees only the lines it fulfills.
 * Data is the same PRMaterialRequirementItem list backing the "Materials" expand
 * row — this just prints it.
 */
export default function PRMaterialPullSheetModal({
    pr,
    reqs,
    isLoading,
    companyProfile,
    getLocationName,
    getAttributeValueName,
    formatDate,
    onClose,
}: {
    pr: any;
    reqs: any[];
    isLoading: boolean;
    companyProfile: any;
    getLocationName: (id: any) => string;
    getAttributeValueName: (id: any) => string;
    formatDate: (d: any) => string;
    onClose: () => void;
}) {
    useEffect(() => {
        document.body.classList.add('pr-pull-sheet-print-active');
        return () => { document.body.classList.remove('pr-pull-sheet-print-active'); };
    }, []);

    const displayCompanyName = companyProfile?.name || '';

    const doPrint = () => {
        window.addEventListener('afterprint', onClose, { once: true });
        window.print();
    };

    const gridLbl: React.CSSProperties = { background: '#f0f0f0', border: '1px solid #ccc', padding: '2px 6px', fontSize: '8px', color: '#444', fontWeight: 'bold', whiteSpace: 'nowrap' };
    const gridVal: React.CSSProperties = { border: '1px solid #ccc', padding: '2px 6px', fontSize: '8px', color: '#000' };

    // Group requirements by resolved source location — one table section per store.
    const groups: { key: string; label: string; rows: any[] }[] = [];
    {
        const byKey = new Map<string, any[]>();
        for (const r of (reqs || [])) {
            const key = r.location_id || '__unassigned__';
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key)!.push(r);
        }
        for (const [key, rows] of byKey.entries()) {
            groups.push({
                key,
                label: key === '__unassigned__' ? 'Unassigned Location' : getLocationName(key),
                rows,
            });
        }
        groups.sort((a, b) => a.label.localeCompare(b.label));
    }

    const bomEntryNames = (pr.bom_entries?.length > 0
        ? pr.bom_entries.map((e: any) => e.bom?.item_name || e.bom?.item_code || e.bom?.code).filter(Boolean).join(' / ')
        : (pr.bom?.item_name || pr.bom?.item_code || pr.bom?.code || ''));

    // Beam lines carry a warp-ends spec; nothing else does. Rendered as a column
    // only when this run actually has one, so a garment PR keeps the full width of
    // an already-tight six-column table for the material name.
    const showEnds = (reqs || []).some((r: any) => r.ends != null);

    const renderMaterialsTable = (rows: any[]) => (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8px', marginBottom: '10px' }}>
            <thead>
                <tr style={{ background: '#f0f0f0' }}>
                    <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'left', width: '12%' }}>Code</th>
                    <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'left' }}>Material</th>
                    <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'center', width: '8%' }}>UOM</th>
                    {showEnds && <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'right', width: '8%' }}>Ends (Utas)</th>}
                    {/* Net of what this run has already been issued — never ask the store
                        to pull material the floor has already consumed. */}
                    <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'right', width: '13%' }}>Still Required</th>
                    <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'right', width: '13%' }}>Available</th>
                    <th style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'right', width: '13%' }}>Shortfall</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((r: any) => {
                    const attrNames: string[] = (r.attribute_value_ids || []).map(getAttributeValueName).filter(Boolean);
                    const hasShort = r.shortfall > 0;
                    return (
                        <tr key={`${r.item_id}-${(r.attribute_value_ids || []).join(',')}-${r.size_label || ''}`}>
                            <td style={{ border: '1px solid #ccc', padding: '2px 4px', fontFamily: CODE_FONT, color: '#555' }}>{r.item_code}</td>
                            <td style={{ border: '1px solid #ccc', padding: '2px 4px' }}>
                                {r.item_name}
                                {/* Sizes net separately, so the sheet lists one line per size —
                                    the picker has to be told which pile to pull. */}
                                {r.size_label && <span style={{ fontWeight: 'bold', marginLeft: '4px' }}>({r.size_label})</span>}
                                {attrNames.length > 0 && <span style={{ color: '#666', marginLeft: '4px', fontSize: '7px' }}>[{attrNames.join(', ')}]</span>}
                            </td>
                            <td style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'center', color: '#555' }}>{r.uom}</td>
                            {showEnds && <td style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'right', color: r.ends != null ? '#000' : '#888' }}>{r.ends != null ? r.ends : '—'}</td>}
                            <td style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'right', fontWeight: 'bold' }}>{r.total_required.toFixed(3)}</td>
                            <td style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'right' }}>{r.qty_available.toFixed(3)}</td>
                            <td style={{ border: '1px solid #ccc', padding: '2px 4px', textAlign: 'right', fontWeight: hasShort ? 'bold' : undefined, color: hasShort ? '#c00000' : '#000', background: hasShort ? '#fdecea' : undefined }}>
                                {hasShort ? r.shortfall.toFixed(3) : '—'}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );

    const { formatCustom: tzFmt } = useTimezone();

    const documentContent = (
        <div style={{ fontFamily: PRINT_FONT, fontSize: '9px', color: '#000', lineHeight: 1.4 }}>

            {/* ── Title row ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #000', paddingBottom: '6px', marginBottom: '8px' }}>
                <div>
                    {companyProfile?.logo_url ? (
                        <img src={`${STATIC_BASE}${companyProfile.logo_url}`} alt="Logo" style={{ maxHeight: '44px', maxWidth: '160px', objectFit: 'contain', display: 'block', marginBottom: '2px' }} />
                    ) : (
                        <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#003080' }}>{displayCompanyName}</div>
                    )}
                    {companyProfile?.address && <div style={{ fontSize: '7px', color: '#555' }}>{companyProfile.address}</div>}
                </div>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', color: '#000' }}>MATERIAL PULL SHEET</div>
                    <div style={{ fontSize: '8px', color: '#333', marginTop: '2px' }}>
                        Tanggal: {tzFmt(new Date(), { day: '2-digit', month: '2-digit', year: 'numeric' }, 'id-ID')}
                    </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '8px', color: '#555' }}>
                    <div style={{ fontFamily: CODE_FONT, fontWeight: 'bold', color: '#000' }}>{pr.code}</div>
                </div>
            </div>

            {/* ── Identity grid ── */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
                <tbody>
                    <tr>
                        <td style={{ ...gridLbl, width: '18%' }}>Production Run</td>
                        <td colSpan={3} style={{ ...gridVal, fontWeight: 'bold', fontSize: '9px' }}>{bomEntryNames || '—'}</td>
                    </tr>
                    {pr.sales_order_id && (
                        <tr>
                            <td style={gridLbl}>Sales Order</td>
                            <td style={{ ...gridVal, fontFamily: CODE_FONT, color: '#0058e6' }}>{pr.sales_order_code || '—'}</td>
                            <td style={gridLbl}>Due Date</td>
                            <td style={gridVal}>{formatDate(pr.target_end_date) || '—'}</td>
                        </tr>
                    )}
                    {!pr.sales_order_id && (
                        <tr>
                            <td style={gridLbl}>Due Date</td>
                            <td colSpan={3} style={gridVal}>{formatDate(pr.target_end_date) || '—'}</td>
                        </tr>
                    )}
                </tbody>
            </table>

            {/* ── Materials, grouped by source location ── */}
            {isLoading ? (
                <div style={{ color: '#666', fontSize: '10px', padding: '12px 0' }}>Loading material requirements...</div>
            ) : groups.length === 0 ? (
                <div style={{ color: '#888', fontSize: '10px', padding: '12px 0' }}>No component requirements found for this Production Run.</div>
            ) : (
                groups.map(g => (
                    <div key={g.key}>
                        <div style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#003080', letterSpacing: '0.3px', marginBottom: '3px', borderTop: '1px solid #ccc', paddingTop: '5px' }}>
                            <i className="bi bi-geo-alt me-1"></i>{g.label}
                        </div>
                        {renderMaterialsTable(g.rows)}
                    </div>
                ))
            )}

            {/* ── Signature / footer ── */}
            <div style={{ marginTop: '16px', borderTop: '1px solid #ccc', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div style={{ fontSize: '7px', color: '#555' }}>
                    <div>No. PR: {pr.code}</div>
                    <div>Printed: {tzFmt(new Date(), { dateStyle: 'short', timeStyle: 'short' }, 'id-ID')}</div>
                </div>
                <div style={{ display: 'flex', gap: '40px' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ borderBottom: '1px solid #000', height: '28px', width: '100px', marginBottom: '2px' }} />
                        <div style={{ fontSize: '7px', fontWeight: 'bold' }}>DIMINTA OLEH</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ borderBottom: '1px solid #000', height: '28px', width: '100px', marginBottom: '2px' }} />
                        <div style={{ fontSize: '7px', fontWeight: 'bold' }}>DISERAHKAN OLEH</div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <>
            <PrintModalShell title={`Print Material Pull Sheet — ${pr.code}`} onClose={onClose} modeless>
                <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: '16px', display: 'flex', justifyContent: 'center' }}>
                    <div className="pr-pull-sheet-paper" style={{ background: '#fff', width: '100%', maxWidth: '560px', padding: '20px 24px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', fontSize: '9px', lineHeight: '1.5', color: '#000', fontFamily: PRINT_FONT }}>
                        {documentContent}
                    </div>
                </div>

                <PrintModalFooter onClose={onClose} onPrint={doPrint} />
            </PrintModalShell>

            {createPortal(
                <div className="pr-pull-sheet-print-portal" style={{ display: 'none' }}>
                    <div className="pr-pull-sheet-paper" style={{ background: '#fff', width: '100%', padding: '20px 24px', fontSize: '9px', lineHeight: '1.5', color: '#000', fontFamily: PRINT_FONT }}>
                        {documentContent}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
