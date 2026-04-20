'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

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

const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily: XP_FONT,
    fontSize: 12,
    padding: '7px 14px',
    cursor: 'pointer',
    background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
    border: '1px solid',
    borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    color: '#000',
    borderRadius: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    ...extra,
});

const STATUS_TABS = ['ALL', 'PENDING', 'IN_PROGRESS'] as const;
type StatusFilter = typeof STATUS_TABS[number];

const xpStatusBadge = (status: string): React.CSSProperties => {
    const base: React.CSSProperties = {
        fontFamily: XP_FONT, fontSize: 9, fontWeight: 'bold',
        padding: '1px 7px', display: 'inline-block', whiteSpace: 'nowrap',
    };
    if (status === 'IN_PROGRESS') return { ...base, background: '#1a4a8a', color: '#fff' };
    if (status === 'COMPLETED')   return { ...base, background: '#2e7d32', color: '#fff' };
    if (status === 'CANCELLED')   return { ...base, background: '#666',    color: '#fff' };
    return { ...base, background: '#b8860b', color: '#fff' };
};

interface MobileManufacturingViewProps {
    workOrders: any[];
    items: any[];
}

export default function MobileManufacturingView({ workOrders, items }: MobileManufacturingViewProps) {
    const router = useRouter();
    const [filter, setFilter] = useState<StatusFilter>('ALL');
    const [search, setSearch] = useState('');
    const today = new Date();

    const filtered = useMemo(() => {
        return (workOrders || [])
            .filter((w: any) => {
                if (filter !== 'ALL' && w.status !== filter) return false;
                if (search.trim()) {
                    const q = search.trim().toUpperCase();
                    const name = (items || []).find((i: any) => i.id === w.item_id)?.name || '';
                    return w.code.toUpperCase().includes(q) || name.toUpperCase().includes(q);
                }
                return true;
            })
            .map((w: any) => ({
                ...w,
                isOverdue: w.target_end_date && new Date(w.target_end_date) < today,
                itemName: (items || []).find((i: any) => i.id === w.item_id)?.name || '—',
            }))
            .sort((a: any, b: any) => {
                if (a.isOverdue && !b.isOverdue) return -1;
                if (!a.isOverdue && b.isOverdue) return 1;
                const order = ['IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED'];
                return order.indexOf(a.status) - order.indexOf(b.status);
            });
    }, [workOrders, items, filter, search]);

    const counts: Record<StatusFilter, number> = useMemo(() => ({
        ALL:         (workOrders || []).length,
        PENDING:     (workOrders || []).filter((w: any) => w.status === 'PENDING').length,
        IN_PROGRESS: (workOrders || []).filter((w: any) => w.status === 'IN_PROGRESS').length,
    }), [workOrders]);

    const tabLabel: Record<StatusFilter, string> = {
        ALL:         'All',
        PENDING:     'Pending',
        IN_PROGRESS: 'In Progress',
    };

    return (
        <div style={{ background: XP_BEIGE, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Header */}
            <div style={{ fontFamily: XP_FONT, fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5, color: '#555', borderBottom: '1px solid #c0bdb5', paddingBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span><i className="bi bi-gear-fill" style={{ marginRight: 5, color: '#1a4a8a' }} />Work Orders</span>
                <button
                    onClick={() => router.push('/scanner')}
                    style={xpBtn({
                        background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)',
                        borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a',
                        color: '#fff',
                        fontWeight: 'bold',
                        fontSize: 11,
                        padding: '5px 10px',
                    })}
                >
                    <i className="bi bi-qr-code-scan" />Scan WO
                </button>
            </div>

            {/* Search */}
            <div style={xpInset({ padding: 0, display: 'flex', alignItems: 'center' })}>
                <i className="bi bi-search" style={{ padding: '0 8px', color: '#666', fontSize: 13, flexShrink: 0 }} />
                <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search WO code or item..."
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

            {/* Status filter tabs */}
            <div style={{ display: 'flex', border: '2px solid', borderColor: '#808080 #dfdfdf #dfdfdf #808080' }}>
                {STATUS_TABS.map((tab, i) => {
                    const isActive = filter === tab;
                    return (
                        <button
                            key={tab}
                            onClick={() => setFilter(tab)}
                            style={{
                                flex: 1,
                                fontFamily: XP_FONT,
                                fontSize: 11,
                                fontWeight: isActive ? 'bold' : 'normal',
                                padding: '7px 4px',
                                border: 'none',
                                borderRight: i < STATUS_TABS.length - 1 ? '1px solid #c0bdb5' : 'none',
                                background: isActive ? 'linear-gradient(to bottom, #316ac5, #1a4a8a)' : 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
                                color: isActive ? '#fff' : '#333',
                                cursor: 'pointer',
                            }}
                        >
                            {tabLabel[tab]}
                            <span style={{
                                marginLeft: 4,
                                background: isActive ? 'rgba(255,255,255,0.25)' : '#e0ddd5',
                                color: isActive ? '#fff' : '#555',
                                fontSize: 9,
                                fontWeight: 'bold',
                                padding: '0 4px',
                                borderRadius: 1,
                            }}>
                                {counts[tab]}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* WO List */}
            {filtered.length === 0 ? (
                <div style={xpInset({ padding: '20px', textAlign: 'center', color: '#666', fontFamily: XP_FONT, fontSize: 12 })}>
                    No work orders found
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {filtered.map((wo: any) => (
                        <div
                            key={wo.id}
                            style={xpPanel({
                                padding: '10px 12px',
                                borderLeft: `4px solid ${wo.isOverdue ? '#cc0000' : wo.status === 'IN_PROGRESS' ? '#1a4a8a' : wo.status === 'PENDING' ? '#b8860b' : '#666'}`,
                                cursor: 'default',
                            })}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontFamily: "'Courier New', monospace", fontSize: 15, fontWeight: 'bold', color: '#00309c' }}>{wo.code}</div>
                                    <div style={{ fontFamily: XP_FONT, fontSize: 12, color: '#333', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wo.itemName}</div>
                                    <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#555', marginTop: 1 }}>
                                        Qty: {parseFloat(wo.qty)}
                                        {wo.target_end_date && (
                                            <span style={{ marginLeft: 8, color: wo.isOverdue ? '#cc0000' : '#555' }}>
                                                {wo.isOverdue && <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 3 }} />}
                                                Due: {wo.target_end_date.slice(0, 10)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                                    <span style={xpStatusBadge(wo.status)}>
                                        {wo.status === 'IN_PROGRESS' ? 'IN PROGRESS' : wo.status}
                                    </span>
                                    {['PENDING', 'IN_PROGRESS'].includes(wo.status) && (
                                        <button
                                            onClick={() => router.push('/scanner')}
                                            style={xpBtn({ fontSize: 10, padding: '3px 8px' })}
                                        >
                                            <i className="bi bi-qr-code-scan" />Scan
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
