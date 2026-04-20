'use client';

import { useState, useMemo } from 'react';

const XP_FONT  = 'Tahoma, "Segoe UI", Arial, sans-serif';
const XP_BEIGE = '#ece9d8';

const xpPanel = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    border: '2px solid',
    borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    background: '#f5f4ef',
    borderRadius: 0,
    ...extra,
});

const xpInset = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    border: '2px solid',
    borderColor: '#808080 #dfdfdf #dfdfdf #808080',
    background: '#ffffff',
    borderRadius: 0,
    ...extra,
});

interface StockEntry {
    item_id: string;
    location_id: string;
    qty: string | number;
    attribute_value_ids?: string[];
}

interface MobileStockViewProps {
    items: any[];
    locations: any[];
    stockBalance: StockEntry[];
}

export default function MobileStockView({ items, locations, stockBalance }: MobileStockViewProps) {
    const [search, setSearch] = useState('');
    const [expandedItem, setExpandedItem] = useState<string | null>(null);

    const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || id;

    const stockByItem = useMemo(() => {
        const map = new Map<string, { item: any; total: number; entries: StockEntry[] }>();

        for (const item of (items || [])) {
            const entries = (stockBalance || []).filter((b: StockEntry) => String(b.item_id) === String(item.id));
            const total = entries.reduce((s, e) => s + parseFloat(String(e.qty) || '0'), 0);
            map.set(item.id, { item, total, entries });
        }

        return Array.from(map.values())
            .filter(({ entries }) => entries.length > 0)
            .sort((a, b) => {
                if (a.total <= 0 && b.total > 0) return -1;
                if (a.total > 0 && b.total <= 0) return 1;
                return a.item.name.localeCompare(b.item.name);
            });
    }, [items, stockBalance]);

    const filtered = useMemo(() => {
        if (!search.trim()) return stockByItem;
        const q = search.trim().toUpperCase();
        return stockByItem.filter(({ item }) =>
            item.name.toUpperCase().includes(q) ||
            (item.sku || '').toUpperCase().includes(q)
        );
    }, [stockByItem, search]);

    const qtyColor = (qty: number): string => {
        if (qty <= 0)  return '#cc0000';
        if (qty < 10)  return '#b8860b';
        return '#1a4a8a';
    };

    return (
        <div style={{ background: XP_BEIGE, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Header */}
            <div style={{ fontFamily: XP_FONT, fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5, color: '#555', borderBottom: '1px solid #c0bdb5', paddingBottom: 4 }}>
                <i className="bi bi-box-seam-fill" style={{ marginRight: 5, color: '#1a4a8a' }} />
                Stock Balances
                <span style={{ marginLeft: 8, fontWeight: 'normal', fontSize: 10, color: '#888' }}>
                    {stockByItem.filter(r => r.total <= 0).length > 0 && (
                        <span style={{ color: '#cc0000', fontWeight: 'bold' }}>
                            {stockByItem.filter(r => r.total <= 0).length} out of stock
                        </span>
                    )}
                </span>
            </div>

            {/* Search */}
            <div style={xpInset({ padding: 0, display: 'flex', alignItems: 'center' })}>
                <i className="bi bi-search" style={{ padding: '0 8px', color: '#666', fontSize: 13, flexShrink: 0 }} />
                <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search item or SKU..."
                    style={{
                        flex: 1,
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        fontFamily: XP_FONT,
                        fontSize: 13,
                        padding: '9px 8px 9px 0',
                        color: '#000',
                    }}
                />
                {search && (
                    <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px', color: '#666', fontSize: 14 }}>✕</button>
                )}
            </div>

            {/* Stock list */}
            {filtered.length === 0 ? (
                <div style={xpInset({ padding: '20px', textAlign: 'center', color: '#666', fontFamily: XP_FONT, fontSize: 12 })}>
                    No items found
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {filtered.map(({ item, total, entries }) => {
                        const isExpanded = expandedItem === item.id;
                        return (
                            <div key={item.id}>
                                <div
                                    onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                                    style={xpPanel({
                                        padding: '10px 12px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        borderLeft: `4px solid ${qtyColor(total)}`,
                                        cursor: 'pointer',
                                    })}
                                >
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontFamily: XP_FONT, fontSize: 13, fontWeight: 'bold', color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {item.name}
                                        </div>
                                        {item.sku && (
                                            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#666', marginTop: 1 }}>{item.sku}</div>
                                        )}
                                        {total <= 0 && (
                                            <div style={{ fontFamily: XP_FONT, fontSize: 10, color: '#cc0000', fontWeight: 'bold', marginTop: 1 }}>
                                                <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 3 }} />OUT OF STOCK
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 20, fontWeight: 'bold', color: qtyColor(total), lineHeight: 1 }}>
                                                {total % 1 === 0 ? total : total.toFixed(2)}
                                            </div>
                                            <div style={{ fontFamily: XP_FONT, fontSize: 9, color: '#888', textAlign: 'right' }}>
                                                {item.uom || 'units'}
                                            </div>
                                        </div>
                                        <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'}`} style={{ fontSize: 12, color: '#666' }} />
                                    </div>
                                </div>

                                {/* Location breakdown */}
                                {isExpanded && (
                                    <div style={{ ...xpInset(), marginTop: 2 }}>
                                        {entries.length === 0 ? (
                                            <div style={{ padding: '8px 12px', fontFamily: XP_FONT, fontSize: 11, color: '#888' }}>No location data</div>
                                        ) : (
                                            entries.map((entry, i) => (
                                                <div
                                                    key={i}
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center',
                                                        padding: '7px 12px',
                                                        borderBottom: i < entries.length - 1 ? '1px solid #e8e6df' : 'none',
                                                        background: i % 2 === 0 ? '#fff' : '#fafaf8',
                                                    }}
                                                >
                                                    <div>
                                                        <div style={{ fontFamily: XP_FONT, fontSize: 12, color: '#333' }}>
                                                            <i className="bi bi-geo-alt-fill" style={{ marginRight: 4, color: '#666', fontSize: 10 }} />
                                                            {getLocationName(entry.location_id)}
                                                        </div>
                                                        {(entry.attribute_value_ids || []).length > 0 && (
                                                            <div style={{ fontFamily: XP_FONT, fontSize: 10, color: '#888', marginTop: 1 }}>
                                                                {entry.attribute_value_ids!.length} variant attribute{entry.attribute_value_ids!.length > 1 ? 's' : ''}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div style={{ fontFamily: "'Courier New', monospace", fontSize: 14, fontWeight: 'bold', color: qtyColor(parseFloat(String(entry.qty))) }}>
                                                        {parseFloat(String(entry.qty)) % 1 === 0
                                                            ? parseFloat(String(entry.qty))
                                                            : parseFloat(String(entry.qty)).toFixed(2)}
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
