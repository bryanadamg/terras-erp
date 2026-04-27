'use client';

import { useMemo } from 'react';
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

const xpSectionLabel: React.CSSProperties = {
    fontFamily: XP_FONT,
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#555',
    borderBottom: '1px solid #c0bdb5',
    paddingBottom: 3,
    marginBottom: 8,
};

const xpStatusBadge = (status: string): React.CSSProperties => {
    const base: React.CSSProperties = {
        fontFamily: XP_FONT, fontSize: 9, fontWeight: 'bold',
        padding: '1px 6px', display: 'inline-block',
    };
    if (status === 'IN_PROGRESS') return { ...base, background: '#1a4a8a', color: '#fff' };
    if (status === 'COMPLETED')   return { ...base, background: '#2e7d32', color: '#fff' };
    if (status === 'CANCELLED')   return { ...base, background: '#666',    color: '#fff' };
    return { ...base, background: '#b8860b', color: '#fff' };
};

export default function MobileDashboardView({ items, stockBalance, workOrders, salesOrders, kpis }: any) {
    const router = useRouter();
    const today = new Date();

    const metrics = {
        totalItems: kpis?.total_items ?? items.length,
        lowStock:   kpis?.low_stock   ?? 0,
        activeWO:   kpis?.active_wo   ?? 0,
        openOrders: kpis?.open_sos    ?? (salesOrders || []).filter((s: any) => s.status === 'PENDING').length,
    };

    const overdueWOs = (workOrders || []).filter((w: any) =>
        ['IN_PROGRESS', 'PENDING'].includes(w.status) &&
        w.target_end_date && new Date(w.target_end_date) < today
    );

    const namedLowStock = useMemo(() => {
        return (items || [])
            .map((item: any) => {
                const total = (stockBalance || [])
                    .filter((b: any) => String(b.item_id) === String(item.id))
                    .reduce((s: number, b: any) => s + parseFloat(b.qty || 0), 0);
                const hasRecord = (stockBalance || []).some((b: any) => String(b.item_id) === String(item.id));
                return { ...item, totalStock: total, hasRecord };
            })
            .filter((i: any) => i.hasRecord && i.totalStock <= 0)
            .slice(0, 4);
    }, [items, stockBalance]);

    const shortSOs = (salesOrders || []).filter((so: any) => {
        if (!(so.lines || []).length) return false;
        return (so.lines || []).some((line: any) => {
            const inStock = (stockBalance || [])
                .filter((b: any) => String(b.item_id) === String(line.item_id))
                .reduce((s: number, b: any) => s + parseFloat(b.qty), 0);
            return inStock < line.qty;
        });
    });

    const actionItems = useMemo(() => {
        const list: { sev: 'crit' | 'warn' | 'info'; title: string; sub: string }[] = [];
        namedLowStock.forEach(i => list.push({ sev: 'crit', title: `${i.name} — OUT`, sub: `Stock: ${i.totalStock} units` }));
        if (metrics.lowStock > namedLowStock.length)
            list.push({ sev: 'crit', title: `${metrics.lowStock - namedLowStock.length} more low-stock items`, sub: 'Check inventory' });
        overdueWOs.slice(0, 3).forEach((w: any) => {
            const name = (items || []).find((i: any) => i.id === w.item_id)?.name || w.code;
            list.push({ sev: 'warn', title: `${w.code} — Overdue`, sub: `${name} · due ${w.target_end_date?.slice(0, 10) || '?'}` });
        });
        shortSOs.slice(0, 2).forEach((so: any) => {
            const short = (so.lines || []).filter((line: any) => {
                const inStock = (stockBalance || []).filter((b: any) => String(b.item_id) === String(line.item_id)).reduce((s: number, b: any) => s + parseFloat(b.qty), 0);
                return inStock < line.qty;
            }).length;
            list.push({ sev: 'warn', title: `${so.code} — Material Gap`, sub: `${short} of ${so.lines.length} lines unfulfilled` });
        });
        const pendingReady = (workOrders || []).filter((w: any) => w.status === 'PENDING').length;
        if (pendingReady > 0)
            list.push({ sev: 'info', title: `${pendingReady} WO${pendingReady > 1 ? 's' : ''} ready to release`, sub: 'Review and start production' });
        return list;
    }, [namedLowStock, overdueWOs, shortSOs, workOrders, metrics.lowStock]);

    const activeWOList = useMemo(() => {
        return (workOrders || [])
            .filter((w: any) => ['IN_PROGRESS', 'PENDING'].includes(w.status))
            .map((w: any) => ({
                ...w,
                isOverdue: w.target_end_date && new Date(w.target_end_date) < today,
                itemName: (items || []).find((i: any) => i.id === w.item_id)?.name || w.item_id,
            }))
            .sort((a: any, b: any) => {
                if (a.isOverdue && !b.isOverdue) return -1;
                if (!a.isOverdue && b.isOverdue) return 1;
                if (a.status === 'IN_PROGRESS' && b.status !== 'IN_PROGRESS') return -1;
                return 0;
            })
            .slice(0, 10);
    }, [workOrders, items]);

    const kpiCards = [
        { label: 'Total SKUs',  value: metrics.totalItems, icon: 'bi-tags-fill',        alert: false },
        { label: 'Low Stock',   value: metrics.lowStock,   icon: 'bi-exclamation-triangle-fill', alert: metrics.lowStock > 0 },
        { label: 'Active WOs',  value: metrics.activeWO,   icon: 'bi-gear-fill',         alert: false },
        { label: 'Open Orders', value: metrics.openOrders, icon: 'bi-bag-fill',          alert: false },
    ];

    const sevBorderLeft = { crit: '#cc0000', warn: '#b8860b', info: '#1a4a8a' };
    const sevBg         = { crit: '#fce8e8', warn: '#fef9e7', info: '#e8f0fe' };
    const sevColor      = { crit: '#6b0000', warn: '#5a3e00', info: '#0a246a' };

    return (
        <div style={{ background: XP_BEIGE, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* KPI 2×2 grid */}
            <div>
                <div style={xpSectionLabel}>System Status</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {kpiCards.map(k => (
                        <div key={k.label} style={xpPanel({
                            padding: '10px 12px',
                            borderColor: k.alert ? '#cc0000 #800000 #800000 #cc0000' : undefined,
                            background: k.alert ? '#fce8e8' : '#f5f4ef',
                        })}>
                            <div style={{ fontFamily: XP_FONT, fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5, color: k.alert ? '#cc0000' : '#666', marginBottom: 3 }}>
                                <i className={`bi ${k.icon}`} style={{ marginRight: 4 }} />{k.label}
                            </div>
                            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 28, fontWeight: 'bold', color: k.alert ? '#cc0000' : '#00309c', lineHeight: 1 }}>
                                {k.value}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Needs Attention */}
            {actionItems.length > 0 && (
                <div>
                    <div style={xpSectionLabel}>Needs Attention</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {actionItems.slice(0, 5).map((item, i) => (
                            <div key={i} style={{
                                ...xpInset(),
                                padding: '8px 10px',
                                borderLeft: `4px solid ${sevBorderLeft[item.sev]}`,
                                background: sevBg[item.sev],
                            }}>
                                <div style={{ fontFamily: XP_FONT, fontSize: 12, fontWeight: 'bold', color: sevColor[item.sev] }}>{item.title}</div>
                                <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#555', marginTop: 2 }}>{item.sub}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Active Work Orders */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <div style={xpSectionLabel}>Active Work Orders</div>
                    <button
                        onClick={() => router.push('/work-orders')}
                        style={{ background: 'none', border: 'none', color: '#0058e6', fontFamily: XP_FONT, fontSize: 11, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                    >
                        View all →
                    </button>
                </div>

                {activeWOList.length === 0 ? (
                    <div style={xpInset({ padding: '16px', textAlign: 'center', color: '#666', fontFamily: XP_FONT, fontSize: 12 })}>
                        No active work orders
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {activeWOList.map((wo: any) => (
                            <div key={wo.id} style={xpPanel({
                                padding: '9px 10px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderLeft: `4px solid ${wo.isOverdue ? '#cc0000' : wo.status === 'IN_PROGRESS' ? '#1a4a8a' : '#b8860b'}`,
                            })}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontFamily: "'Courier New', monospace", fontSize: 14, fontWeight: 'bold', color: '#00309c' }}>{wo.code}</div>
                                    <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#444', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wo.itemName}</div>
                                    {wo.isOverdue && (
                                        <div style={{ fontFamily: XP_FONT, fontSize: 10, color: '#cc0000', fontWeight: 'bold', marginTop: 1 }}>
                                            <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 3 }} />Overdue
                                        </div>
                                    )}
                                </div>
                                <span style={xpStatusBadge(wo.status)}>
                                    {wo.status === 'IN_PROGRESS' ? 'IN PROGRESS' : wo.status}
                                </span>
                            </div>
                        ))}
                        {(workOrders || []).filter((w: any) => ['IN_PROGRESS', 'PENDING'].includes(w.status)).length > 10 && (
                            <button
                                onClick={() => router.push('/work-orders')}
                                style={{ ...xpPanel({ padding: '9px', textAlign: 'center' as const }), border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#0058e6', fontFamily: XP_FONT, fontSize: 12, cursor: 'pointer', width: '100%' }}
                            >
                                View all work orders →
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
