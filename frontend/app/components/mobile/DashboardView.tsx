'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';

export default function MobileDashboardView({ items, stockBalance, workOrders, salesOrders, kpis }: any) {
    const router = useRouter();

    // ── Metrics (same as desktop DashboardView) ───────────────────────────────
    const metrics = {
        totalItems: kpis?.total_items    ?? items.length,
        lowStock:   kpis?.low_stock      ?? 0,
        activeWO:   kpis?.active_wo      ?? 0,
        openOrders: kpis?.open_sos       ?? (salesOrders || []).filter((s: any) => s.status === 'PENDING').length,
    };

    const today = new Date();

    const overdueWOs = (workOrders || []).filter((w: any) =>
        ['IN_PROGRESS', 'PENDING'].includes(w.status) &&
        w.target_end_date && new Date(w.target_end_date) < today
    );

    const openSOs = (salesOrders || []).filter((s: any) => s.status === 'PENDING');

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

    const shortSOs = openSOs.filter((so: any) => {
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

    // ── KPI config ────────────────────────────────────────────────────────────
    const kpiCards = [
        { label: 'Total SKUs',   value: metrics.totalItems, bg: '#f8fafc', border: '#e2e8f0', color: '#0f172a', labelColor: '#64748b' },
        { label: 'Low Stock',    value: metrics.lowStock,   bg: metrics.lowStock > 0 ? '#fffbeb' : '#f8fafc', border: metrics.lowStock > 0 ? '#fbbf24' : '#e2e8f0', color: metrics.lowStock > 0 ? '#92400e' : '#0f172a', labelColor: metrics.lowStock > 0 ? '#b45309' : '#64748b' },
        { label: 'Active WOs',   value: metrics.activeWO,   bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af', labelColor: '#3b82f6' },
        { label: 'Open Orders',  value: metrics.openOrders, bg: '#f0fdf4', border: '#bbf7d0', color: '#14532d', labelColor: '#16a34a' },
    ];

    const sevColor = { crit: '#dc2626', warn: '#d97706', info: '#2563eb' };
    const sevBg    = { crit: '#fef2f2', warn: '#fffbeb', info: '#eff6ff' };
    const sevBorder = { crit: '#fecaca', warn: '#fde68a', info: '#bfdbfe' };

    const statusBadge: Record<string, { bg: string; color: string }> = {
        IN_PROGRESS: { bg: '#dbeafe', color: '#1e40af' },
        PENDING:     { bg: '#fef9c3', color: '#854d0e' },
    };

    return (
        <div style={{ background: '#f8fafc', minHeight: '100%' }}>

            {/* ── KPI 2×2 grid ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '16px 16px 0' }}>
                {kpiCards.map(k => (
                    <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.border}`, borderRadius: 14, padding: '14px 16px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: k.labelColor, marginBottom: 4 }}>{k.label}</div>
                        <div style={{ fontSize: 32, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
                    </div>
                ))}
            </div>

            {/* ── Advisor ── */}
            {actionItems.length > 0 && (
                <div style={{ margin: '14px 16px 0' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', marginBottom: 8 }}>
                        Needs Attention
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {actionItems.slice(0, 5).map((item, i) => (
                            <div key={i} style={{
                                background: sevBg[item.sev], border: `1px solid ${sevBorder[item.sev]}`,
                                borderLeft: `4px solid ${sevColor[item.sev]}`,
                                borderRadius: 10, padding: '10px 12px',
                            }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: sevColor[item.sev] }}>{item.title}</div>
                                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{item.sub}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Active Work Orders ── */}
            <div style={{ margin: '14px 16px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b' }}>
                        Active Work Orders
                    </div>
                    <button
                        onClick={() => router.push('/manufacturing')}
                        style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}
                    >
                        View all →
                    </button>
                </div>

                {activeWOList.length === 0 ? (
                    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                        No active work orders
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {activeWOList.map((wo: any) => (
                            <div key={wo.id} style={{
                                background: '#fff', border: `1px solid ${wo.isOverdue ? '#fecaca' : '#e2e8f0'}`,
                                borderLeft: `4px solid ${wo.isOverdue ? '#dc2626' : wo.status === 'IN_PROGRESS' ? '#3b82f6' : '#f59e0b'}`,
                                borderRadius: 10, padding: '12px 14px',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>{wo.code}</div>
                                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wo.itemName}</div>
                                    {wo.isOverdue && (
                                        <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2, fontWeight: 600 }}>⚠ Overdue</div>
                                    )}
                                </div>
                                <div style={{ marginLeft: 10, flexShrink: 0 }}>
                                    <span style={{
                                        background: statusBadge[wo.status]?.bg || '#f1f5f9',
                                        color: statusBadge[wo.status]?.color || '#475569',
                                        borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 600,
                                    }}>
                                        {wo.status === 'IN_PROGRESS' ? 'IN PROGRESS' : wo.status}
                                    </span>
                                </div>
                            </div>
                        ))}
                        {(workOrders || []).filter((w: any) => ['IN_PROGRESS', 'PENDING'].includes(w.status)).length > 10 && (
                            <button
                                onClick={() => router.push('/manufacturing')}
                                style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px', color: '#3b82f6', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
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
