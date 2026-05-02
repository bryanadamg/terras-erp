import { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';

interface StockOnHandViewProps {
    items: any[];
    locations: any[];
    stockBalance: any[];
    attributes: any[];
    onRefresh: () => void;
    authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
    apiBase: string;
}

export default function StockOnHandView({ items, locations, stockBalance, attributes, onRefresh, authFetch, apiBase }: StockOnHandViewProps) {
    const { uiStyle } = useTheme();
    const { t } = useLanguage();
    const classic = uiStyle === 'classic';

    const [batches, setBatches] = useState<any[]>([]);
    const [search, setSearch] = useState('');
    const [locationFilter, setLocationFilter] = useState('');
    const [itemFilter, setItemFilter] = useState('');

    useEffect(() => {
        authFetch(`${apiBase}/batches?limit=500`)
            .then(r => r.ok ? r.json() : [])
            .then(setBatches)
            .catch(() => {});
    }, [apiBase]);

    const batchMap = useMemo(() => {
        const m: Record<string, string> = {};
        for (const b of batches) m[b.id] = b.batch_number;
        return m;
    }, [batches]);

    const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || '';
    const getItemCode = (id: string) => items.find((i: any) => i.id === id)?.code || '';
    const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || id;
    const getAttrValueName = (valId: string) => {
        for (const attr of attributes) {
            const v = attr.values?.find((v: any) => v.id === valId);
            if (v) return v.value;
        }
        return valId;
    };

    const filtered = useMemo(() => {
        const s = search.toLowerCase();
        return (stockBalance || []).filter((bal: any) => {
            if (locationFilter && bal.location_id !== locationFilter) return false;
            if (itemFilter && bal.item_id !== itemFilter) return false;
            if (!s) return true;
            const name = getItemName(bal.item_id).toLowerCase();
            const code = getItemCode(bal.item_id).toLowerCase();
            const loc = getLocationName(bal.location_id).toLowerCase();
            const batch = bal.batch_key ? (batchMap[bal.batch_key] || bal.batch_key).toLowerCase() : '';
            return name.includes(s) || code.includes(s) || loc.includes(s) || batch.includes(s);
        });
    }, [stockBalance, search, locationFilter, itemFilter, batchMap]);

    const negativeCount = filtered.filter((b: any) => b.qty < 0).length;

    // ── XP style helpers ─────────────────────────────────────────────────────
    const xpFont = 'Tahoma, "Segoe UI", sans-serif';
    const xpBevel: React.CSSProperties = {
        border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
        boxShadow: '2px 2px 4px rgba(0,0,0,0.3)', background: '#ece9d8', borderRadius: 0,
    };
    const xpTitleBar: React.CSSProperties = {
        background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)', color: '#ffffff',
        fontFamily: xpFont, fontSize: '12px', fontWeight: 'bold',
        padding: '4px 8px', borderBottom: '1px solid #003080',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: '26px',
    };
    const xpToolbar: React.CSSProperties = {
        background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898',
        padding: '4px 6px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' as const,
    };
    const xpInput: React.CSSProperties = {
        fontFamily: xpFont, fontSize: '11px', border: '1px solid #7f9db9',
        boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)', padding: '1px 6px',
        background: '#ffffff', color: '#000000', height: '20px', outline: 'none',
    };
    const xpSelect: React.CSSProperties = { ...xpInput, height: '22px' };
    const xpTableHeader: React.CSSProperties = {
        background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)', borderBottom: '2px solid #808080',
        fontSize: '10px', fontWeight: 'bold', color: '#000000', fontFamily: xpFont,
        padding: '3px 8px', position: 'sticky' as const, top: 0,
    };
    const xpBtn = (extra: any = {}): React.CSSProperties => ({
        fontFamily: xpFont, fontSize: '11px', padding: '2px 10px', cursor: 'pointer',
        background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)', border: '1px solid',
        borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#000000', borderRadius: 0, ...extra,
    });
    const xpSep: React.CSSProperties = {
        width: '1px', height: '20px', background: '#a0988c', margin: '0 2px', flexShrink: 0,
    };

    const renderRow = (bal: any, i: number) => {
        const batchLabel = bal.batch_key ? (batchMap[bal.batch_key] || bal.batch_key) : '-';
        const qtyColor = bal.qty < 0 ? '#c00000' : '#00008b';

        if (classic) {
            return (
                <tr key={`${bal.item_id}-${bal.location_id}-${bal.batch_key}-${i}`}
                    style={{ background: i % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' }}>
                    <td style={{ padding: '4px 8px', fontFamily: xpFont }}>
                        <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{getItemName(bal.item_id)}</div>
                        <div style={{ fontSize: '10px', color: '#666', fontVariant: 'all-small-caps' }}>{getItemCode(bal.item_id)}</div>
                    </td>
                    <td style={{ padding: '4px 8px', fontFamily: xpFont, fontSize: '11px', color: '#000' }}>
                        {getLocationName(bal.location_id)}
                    </td>
                    <td style={{ padding: '4px 8px', fontFamily: xpFont, fontSize: '11px' }}>
                        {bal.batch_key ? (
                            <span style={{ background: '#fff8dc', border: '1px solid #c8a000', padding: '0 5px', fontSize: '10px', color: '#5a3c00' }}>
                                {batchLabel}
                            </span>
                        ) : (
                            <span style={{ fontSize: '10px', color: '#999', fontStyle: 'italic' }}>-</span>
                        )}
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {bal.attribute_value_ids?.length > 0 ? (
                                bal.attribute_value_ids.map((vid: string) => (
                                    <span key={vid} style={{ background: '#dde8f5', border: '1px solid #7f9db9', padding: '0 4px', fontFamily: xpFont, fontSize: '10px', color: '#333' }}>
                                        {getAttrValueName(vid)}
                                    </span>
                                ))
                            ) : (
                                <span style={{ fontFamily: xpFont, fontSize: '10px', color: '#888', fontStyle: 'italic' }}>Standard</span>
                            )}
                        </div>
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: xpFont, fontSize: '11px', fontWeight: 'bold', color: qtyColor }}>
                        {bal.qty}
                    </td>
                </tr>
            );
        }

        return (
            <tr key={`${bal.item_id}-${bal.location_id}-${bal.batch_key}-${i}`}>
                <td>
                    <div className="fw-medium">{getItemName(bal.item_id)}</div>
                    <small className="text-muted font-monospace">{getItemCode(bal.item_id)}</small>
                </td>
                <td>{getLocationName(bal.location_id)}</td>
                <td>
                    {bal.batch_key ? (
                        <span className="badge bg-warning text-dark">{batchLabel}</span>
                    ) : (
                        <span className="text-muted">-</span>
                    )}
                </td>
                <td>
                    {bal.attribute_value_ids?.length > 0 ? (
                        bal.attribute_value_ids.map((vid: string) => (
                            <span key={vid} className="badge bg-info text-dark me-1">{getAttrValueName(vid)}</span>
                        ))
                    ) : (
                        <span className="text-muted small">Standard</span>
                    )}
                </td>
                <td className="text-end fw-bold" style={{ color: qtyColor }}>{bal.qty}</td>
            </tr>
        );
    };

    if (classic) {
        return (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ ...xpBevel, display: 'flex', flexDirection: 'column', flex: 1 }}>
                    <div style={xpTitleBar}>
                        <span><i className="bi bi-boxes" style={{ marginRight: 6 }} />{t('stock_on_hand') || 'Stock On-Hand'}</span>
                        <span style={{ fontSize: '10px', opacity: 0.85 }}>{filtered.length} records</span>
                    </div>
                    <div style={xpToolbar}>
                        <i className="bi bi-search" style={{ fontSize: '11px', color: '#666' }} />
                        <input
                            style={{ ...xpInput, width: 180 }}
                            placeholder="Search item, location, batch..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        <div style={xpSep} />
                        <select style={{ ...xpSelect, width: 150 }} value={locationFilter} onChange={e => setLocationFilter(e.target.value)}>
                            <option value="">All Locations</option>
                            {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                        <select style={{ ...xpSelect, width: 180 }} value={itemFilter} onChange={e => setItemFilter(e.target.value)}>
                            <option value="">All Items</option>
                            {items.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                        <div style={xpSep} />
                        <button style={xpBtn()} onClick={onRefresh} title="Refresh">
                            <i className="bi bi-arrow-clockwise" style={{ marginRight: 4 }} />Refresh
                        </button>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', background: '#ffffff', maxHeight: 'calc(100vh - 200px)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={xpTableHeader}>Item</th>
                                    <th style={xpTableHeader}>{t('locations') || 'Location'}</th>
                                    <th style={xpTableHeader}>Batch / Lot</th>
                                    <th style={xpTableHeader}>{t('attributes') || 'Attributes'}</th>
                                    <th style={{ ...xpTableHeader, textAlign: 'right' }}>{t('qty') || 'Qty'}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((bal: any, i: number) => renderRow(bal, i))}
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={5} style={{ textAlign: 'center', padding: '24px', fontFamily: xpFont, fontSize: '11px', color: '#666', fontStyle: 'italic' }}>
                                            No stock records found
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div style={{
                        background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898',
                        padding: '2px 8px', display: 'flex', gap: 16,
                        fontFamily: xpFont, fontSize: '11px', color: '#333',
                    }}>
                        <span><b>{filtered.length}</b> rows</span>
                        {negativeCount > 0 && <span style={{ color: '#c00000' }}><b>{negativeCount}</b> negative</span>}
                        <span style={{ marginLeft: 'auto', color: '#666' }}>Total: {(stockBalance || []).length} SKUs</span>
                    </div>
                </div>
            </div>
        );
    }

    // ── Modern (Bootstrap) mode ───────────────────────────────────────────────
    return (
        <div className="fade-in">
            <div className="card shadow-sm border-0">
                <div className="card-header bg-primary bg-opacity-10 text-primary-emphasis d-flex justify-content-between align-items-center py-3">
                    <h5 className="card-title mb-0"><i className="bi bi-boxes me-2" />{t('stock_on_hand') || 'Stock On-Hand'}</h5>
                    <span className="badge bg-primary bg-opacity-25 text-primary-emphasis">{filtered.length} records</span>
                </div>
                <div className="card-body pb-0">
                    <div className="row g-2 mb-3">
                        <div className="col-md-4">
                            <input
                                className="form-control form-control-sm"
                                placeholder="Search item, location, batch..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                        <div className="col-md-3">
                            <select className="form-select form-select-sm" value={locationFilter} onChange={e => setLocationFilter(e.target.value)}>
                                <option value="">All Locations</option>
                                {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                        </div>
                        <div className="col-md-3">
                            <select className="form-select form-select-sm" value={itemFilter} onChange={e => setItemFilter(e.target.value)}>
                                <option value="">All Items</option>
                                {items.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                        </div>
                        <div className="col-md-2">
                            <button className="btn btn-outline-secondary btn-sm w-100" onClick={onRefresh}>
                                <i className="bi bi-arrow-clockwise me-1" />Refresh
                            </button>
                        </div>
                    </div>
                </div>
                <div className="table-responsive">
                    <table className="table table-hover table-sm mb-0">
                        <thead className="table-light">
                            <tr>
                                <th>Item</th>
                                <th>{t('locations') || 'Location'}</th>
                                <th>Batch / Lot</th>
                                <th>{t('attributes') || 'Attributes'}</th>
                                <th className="text-end">{t('qty') || 'Qty'}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((bal: any, i: number) => renderRow(bal, i))}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="text-center text-muted py-4">No stock records found</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="card-footer text-muted d-flex gap-3 small">
                    <span><b>{filtered.length}</b> rows shown</span>
                    {negativeCount > 0 && <span className="text-danger"><b>{negativeCount}</b> negative</span>}
                    <span className="ms-auto">Total: {(stockBalance || []).length} SKUs</span>
                </div>
            </div>
        </div>
    );
}
