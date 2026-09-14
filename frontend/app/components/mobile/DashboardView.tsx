'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '../../context/LanguageContext';
import { xpFont as XP_FONT, familyColor, familyTint, ProgressBar, StatusChip, type StatusFamily, CodeChip, CODE_FONT } from '../shared/xpTheme';
import { MOBILE_BG, MobilePanel, MobileButton, MobileEmpty, mobileCard, mobileInset } from './mobileTheme';

// Severity families for the action-item rows — same five as STATUS_FAMILY.
const SEV_FAMILY: Record<'crit' | 'warn' | 'info', StatusFamily> = { crit: 'red', warn: 'amber', info: 'blue' };

const kpiLabel = (alert: boolean): React.CSSProperties => ({
    fontFamily: XP_FONT, fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase',
    letterSpacing: 0.5, color: alert ? '#cc0000' : '#666', marginBottom: 3,
});

export default function MobileDashboardView({ items, stockBalance, workOrders, salesOrders, kpis, summary, itemIndex }: any) {
    const router = useRouter();
    const { t } = useLanguage();
    const today = new Date();
    const hasSummary = !!summary;

    const resolveName = (id: string) =>
        itemIndex?.[String(id)]?.name || (items || []).find((i: any) => i.id === id)?.name || id;

    const metrics = {
        totalItems: kpis?.total_items ?? (items || []).length,
        lowStock:   kpis?.low_stock   ?? 0,
        activeWO:   kpis?.active_wo   ?? 0,
        pendingWO:  kpis?.pending_wo  ?? 0,
        openOrders: kpis?.open_sos    ?? (summary?.open_so_count ?? (salesOrders || []).filter((s: any) => s.status === 'PENDING').length),
    };

    const prodYield = hasSummary ? summary.production_yield : 100;
    const deliveryReadiness = hasSummary ? summary.delivery_readiness : 100;

    const overdueWOs = (workOrders || []).filter((w: any) =>
        ['IN_PROGRESS', 'PENDING'].includes(w.status) &&
        w.target_end_date && new Date(w.target_end_date) < today
    );

    // namedLowStock + shortSOs come from the server summary (the full stock-balance
    // and all sales-orders are no longer shipped to the dashboard).
    const namedLowStock: any[] = hasSummary
        ? (summary.low_stock_items || []).map((l: any) => ({ id: l.item_id, name: l.item_name, totalStock: l.total_qty, minLevel: l.min_level }))
        : [];
    const shortSOs: any[] = hasSummary ? (summary.short_orders || []) : [];

    const actionItems = useMemo(() => {
        const list: { sev: 'crit' | 'warn' | 'info'; title: string; sub: string }[] = [];
        namedLowStock.forEach((i: any) => { const out = i.totalStock <= 0; list.push({ sev: out ? 'crit' : 'warn', title: `${i.name} — ${out ? 'OUT' : 'LOW'}`, sub: `Stock ${i.totalStock} · reorder at ${i.minLevel}` }); });
        if (metrics.lowStock > namedLowStock.length)
            list.push({ sev: 'crit', title: `${metrics.lowStock - namedLowStock.length} more low-stock items`, sub: 'Check inventory' });
        overdueWOs.slice(0, 3).forEach((w: any) => {
            list.push({ sev: 'warn', title: `${w.code} — Overdue`, sub: `${resolveName(w.item_id)} · due ${w.target_end_date?.slice(0, 10) || '?'}` });
        });
        shortSOs.slice(0, 2).forEach((so: any) => {
            list.push({ sev: 'warn', title: `${so.code} — Material Gap`, sub: `${so.short_lines} of ${so.total_lines} lines unfulfilled` });
        });
        if (metrics.pendingWO > 0)
            list.push({ sev: 'info', title: `${metrics.pendingWO} WO${metrics.pendingWO > 1 ? 's' : ''} ready to release`, sub: 'Review and start production' });
        return list;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [summary, overdueWOs, metrics.lowStock, metrics.pendingWO]);

    const activeWOList = useMemo(() => {
        return (workOrders || [])
            .filter((w: any) => ['IN_PROGRESS', 'PENDING'].includes(w.status))
            .map((w: any) => ({
                ...w,
                isOverdue: w.target_end_date && new Date(w.target_end_date) < today,
                itemName: resolveName(w.item_id),
                progress: parseFloat(w.qty) > 0 ? Math.min(100, (parseFloat(w.qty_completed_total || 0) / parseFloat(w.qty)) * 100) : 0,
            }))
            .sort((a: any, b: any) => {
                if (a.isOverdue && !b.isOverdue) return -1;
                if (!a.isOverdue && b.isOverdue) return 1;
                if (a.status === 'IN_PROGRESS' && b.status !== 'IN_PROGRESS') return -1;
                return 0;
            })
            .slice(0, 10);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workOrders, items, itemIndex]);

    const kpiCards = [
        { label: t('total_skus'),  value: metrics.totalItems, icon: 'bi-tags-fill',        alert: false },
        { label: t('low_stock'),   value: metrics.lowStock,   icon: 'bi-exclamation-triangle-fill', alert: metrics.lowStock > 0 },
        { label: t('active_wo'),   value: metrics.activeWO,   icon: 'bi-gear-fill',         alert: false },
        { label: t('pending_wo'),  value: metrics.pendingWO,  icon: 'bi-clock-history',     alert: false },
        { label: t('open_orders'), value: metrics.openOrders, icon: 'bi-bag-fill',          alert: false },
        { label: t('samples'),     value: kpis?.active_samples ?? 0, icon: 'bi-eyedropper',  alert: false },
    ];

    const PctBar = ({ label, pct, good }: { label: string; pct: number; good: boolean }) => {
        const tone: StatusFamily = good ? 'green' : 'amber';
        return (
            <div style={mobileCard({ padding: '8px 10px', flex: 1, minWidth: 0 })}>
                <div style={kpiLabel(false)}>{label}</div>
                <div style={{ fontFamily: CODE_FONT, fontSize: 20, fontWeight: 'bold', color: familyColor(tone), lineHeight: 1 }}>{pct.toFixed(0)}%</div>
                <div style={{ marginTop: 4 }}>
                    <ProgressBar pct={pct} tone={tone} height={7} title={label} />
                </div>
            </div>
        );
    };

    // Panels head each section with the same blue-gradient title bar the desktop
    // views use, and carry severity in the bar itself (alerts amber) the way the
    // desktop dashboard panel stack does.
    const alertTone = actionItems.some(a => a.sev === 'crit') ? 'red' : 'amber';
    const activeCount = (workOrders || []).filter((w: any) => ['IN_PROGRESS', 'PENDING'].includes(w.status)).length;

    return (
        <div style={{ background: MOBILE_BG, padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* KPI grid + rate bars */}
            <MobilePanel icon="bi-speedometer2" title={t('system_status') || 'System Status'}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {kpiCards.map(k => (
                        <div key={k.label} style={mobileCard({
                            padding: '10px 12px',
                            borderColor: k.alert ? '#cc0000 #800000 #800000 #cc0000' : undefined,
                            background: k.alert ? '#fce8e8' : undefined,
                        })}>
                            <div style={kpiLabel(k.alert)}>
                                <i className={`bi ${k.icon}`} style={{ marginRight: 4 }} aria-hidden="true" />{k.label}
                            </div>
                            <div style={{ fontFamily: CODE_FONT, fontSize: 28, fontWeight: 'bold', color: k.alert ? '#cc0000' : '#00309c', lineHeight: 1 }}>
                                {k.value}
                            </div>
                        </div>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <PctBar label={t('production_yield')} pct={prodYield} good={prodYield > 90} />
                    <PctBar label={t('delivery_readiness')} pct={deliveryReadiness} good={deliveryReadiness > 80} />
                </div>
            </MobilePanel>

            {/* Needs Attention */}
            {actionItems.length > 0 && (
                <MobilePanel
                    icon="bi-exclamation-triangle-fill"
                    title={t('action_items') || 'Needs Attention'}
                    tone={alertTone}
                    right={<span style={{ fontFamily: XP_FONT, fontSize: 11 }}>{actionItems.length}</span>}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {actionItems.slice(0, 5).map((item, i) => {
                            const tint = familyTint(SEV_FAMILY[item.sev]);
                            return (
                                <div key={i} style={{
                                    ...mobileInset(),
                                    padding: '8px 10px',
                                    borderLeft: `4px solid ${familyColor(SEV_FAMILY[item.sev])}`,
                                    background: tint.background,
                                }}>
                                    <div style={{ fontFamily: XP_FONT, fontSize: 12, fontWeight: 'bold', color: tint.color }}>{item.title}</div>
                                    <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#555', marginTop: 2 }}>{item.sub}</div>
                                </div>
                            );
                        })}
                    </div>
                </MobilePanel>
            )}

            {/* Active Work Orders */}
            <MobilePanel
                icon="bi-clipboard-check-fill"
                title={t('work_orders')}
                right={
                    <MobileButton compact tone="neutral" icon="bi-box-arrow-up-right" onClick={() => router.push('/work-orders')}>
                        View all
                    </MobileButton>
                }
            >
                {activeWOList.length === 0 ? (
                    <MobileEmpty>{t('no_active_production')}</MobileEmpty>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {activeWOList.map((wo: any) => (
                            <div key={wo.id} style={mobileCard({
                                padding: '9px 10px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderLeft: `4px solid ${familyColor(wo.isOverdue ? 'red' : wo.status === 'IN_PROGRESS' ? 'blue' : 'gray')}`,
                            })}>
                                <div style={{ minWidth: 0 }}>
                                    <CodeChip code={wo.code} tone="accent" style={{ display: 'block', fontSize: 14 }} />
                                    <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#444', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wo.itemName}</div>
                                    {wo.isOverdue && (
                                        <div style={{ fontFamily: XP_FONT, fontSize: 10, color: '#cc0000', fontWeight: 'bold', marginTop: 1 }}>
                                            <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 3 }} aria-hidden="true" />Overdue
                                        </div>
                                    )}
                                    <div style={{ maxWidth: 160, marginTop: 4 }}>
                                        <ProgressBar
                                            pct={wo.progress}
                                            tone={wo.isOverdue ? 'red' : wo.progress >= 100 ? 'green' : wo.status === 'IN_PROGRESS' ? 'blue' : 'gray'}
                                            height={8}
                                            label="outside"
                                        />
                                    </div>
                                </div>
                                <StatusChip status={wo.isOverdue ? 'OVERDUE' : wo.status} />
                            </div>
                        ))}
                        {activeCount > 10 && (
                            <MobileButton tone="launch" icon="bi-list-ul" onClick={() => router.push('/work-orders')} style={{ width: '100%' }}>
                                View all {activeCount} work orders
                            </MobileButton>
                        )}
                    </div>
                )}
            </MobilePanel>
        </div>
    );
}
