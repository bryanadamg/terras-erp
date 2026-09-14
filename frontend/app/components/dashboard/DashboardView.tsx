import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { useTimezone } from '../../context/TimezoneContext';
import CalendarView from '../shared/CalendarView';
import {
    xpFont, ProgressBar, StatusChip, XPStatusBar, familyColor, familyTint, type StatusFamily,
    CodeChip, CODE_FONT, SkeletonBar,
} from '../shared/xpTheme';
import { ShellWindow, ShellTitleBar } from '../shared/shellTheme';
import { lvTh, lvTd, lvRow, lvThead } from '../shared/listViewTheme';

// ── Local table chrome ───────────────────────────────────────────────────────
// Cells/rows come from listViewTheme (lvTh/lvTd/lvRow); only the sticky+gradient
// header treatment these scroll panes need is added on top.
const xpTable: React.CSSProperties = {
    width: '100%', borderCollapse: 'collapse', fontFamily: xpFont, background: '#ffffff',
};

const stickyTh = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    ...lvTh(),
    ...lvThead(),
    position: 'sticky', top: 0, zIndex: 1,
    ...extra,
});

const emptyRowStyle: React.CSSProperties = {
    textAlign: 'center', padding: '16px', color: '#666', fontStyle: 'italic',
    fontSize: '10px', background: '#fff', fontFamily: xpFont,
};

// Health panels signal the same five semantic families as every status chip —
// map through STATUS_FAMILY's palette instead of a local hex table.
type HealthStatus = 'ok' | 'warn' | 'crit';
const HEALTH_FAMILY: Record<HealthStatus, StatusFamily> = { ok: 'green', warn: 'amber', crit: 'red' };
const SEV_FAMILY: Record<string, StatusFamily> = { crit: 'red', warn: 'amber', info: 'green' };

// ── Dependency-free inline SVG donut (no chart library — light on old clients) ──
// Modern-only (the classic dashboard uses XP gauges), so the palette is tuned to
// the modern blue theme rather than the old saturated XP colors.
const DONUT_COLORS = ['#2563eb', '#0ea5e9', '#14b8a6', '#8b5cf6', '#f59e0b', '#ec4899', '#64748b'];
const Donut = ({ segments, size = 132, stroke = 20, centerLabel, centerSub, ariaLabel }: {
    segments: { label: string; value: number }[];
    size?: number; stroke?: number; centerLabel: string; centerSub?: string; ariaLabel: string;
}) => {
    const total = segments.reduce((s, x) => s + x.value, 0);
    const r = (size - stroke) / 2;
    const circ = 2 * Math.PI * r;
    let acc = 0;
    // Shrink the center number so long values (e.g. "1,234,567") never spill past
    // the inner hole. Usable width ≈ size − 2·stroke; ~0.62em per char for Tahoma bold.
    const innerWidth = size - stroke * 2 - 10;
    const labelLen = String(centerLabel).length || 1;
    const labelFont = Math.max(9, Math.min(size * 0.17, innerWidth / (labelLen * 0.62)));
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef1f6" strokeWidth={stroke} />
            <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
                {total > 0 && segments.map((seg, i) => {
                    const dash = (seg.value / total) * circ;
                    const el = (
                        <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
                            stroke={DONUT_COLORS[i % DONUT_COLORS.length]} strokeWidth={stroke}
                            strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-acc} />
                    );
                    acc += dash;
                    return el;
                })}
            </g>
            <text x="50%" y="46%" textAnchor="middle" dominantBaseline="central"
                fontFamily="system-ui, 'Segoe UI', Arial, sans-serif" fontSize={labelFont} fontWeight="bold" fill="#1e293b">
                {centerLabel}
            </text>
            {centerSub && (
                <text x="50%" y="62%" textAnchor="middle" dominantBaseline="central"
                    fontFamily="system-ui, 'Segoe UI', Arial, sans-serif" fontSize={size * 0.085} fill="#64748b">
                    {centerSub}
                </text>
            )}
        </svg>
    );
};

// ── Dependency-free inline SVG sparkline (KPI daily trend) ─────────────────────
const Sparkline = ({ data, color = familyColor('blue'), width = 120, height = 28, ariaLabel }: {
    data: { date: string; value: number }[]; color?: string; width?: number; height?: number; ariaLabel: string;
}) => {
    const vals = (data || []).map(d => d.value);
    if (vals.length < 2) return <span style={{ fontSize: 9, color: '#aaa', fontFamily: xpFont }}>not enough history</span>;
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = (max - min) || 1;
    const pad = 2;
    const pts = vals.map((v, i) => {
        const x = pad + (i / (vals.length - 1)) * (width - pad * 2);
        const y = pad + (height - pad * 2) - ((v - min) / range) * (height - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const lastX = pad + (width - pad * 2);
    const lastY = pad + (height - pad * 2) - ((vals[vals.length - 1] - min) / range) * (height - pad * 2);
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
            <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={lastX} cy={lastY} r={2} fill={color} />
        </svg>
    );
};

const TREND_METRICS = [
    { key: 'low_stock', color: familyColor('amber') },
    { key: 'active_wo', color: familyColor('blue') },
    { key: 'pending_wo', color: familyColor('gray') },
    { key: 'open_sos', color: familyColor('green') },
];

export default function DashboardView({ items, locations, stockBalance, workOrders, stockEntries, samples, salesOrders, kpis, summary, itemIndex, kpiHistory }: any) {
    const { t } = useLanguage();
    const { formatDateTime: tzDateTime, formatCustom: tzFmt } = useTimezone();
    const { uiStyle: currentStyle } = useTheme();
    const classic = currentStyle === 'classic';
    const router = useRouter();
    const [drill, setDrill] = useState<'lowstock' | 'short' | null>(null);
    const [hoveredAction, setHoveredAction] = useState<number | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
    const toggleGroup = (id: string) => setExpandedGroups(p => ({ ...p, [id]: !p[id] }));

    // Resolve item name across the FULL catalog (itemIndex), falling back to the
    // paginated items array, then the raw id. Fixes UUID-instead-of-name on the
    // WO table for items beyond the first items page.
    const resolveName = (id: string) =>
        itemIndex?.[String(id)]?.name || (items || []).find((i: any) => i.id === id)?.name || id;

    const hasSummary = !!summary;

    // Until /dashboard/summary lands, `metrics` below falls back to zeros (and to
    // whatever slice of items/SOs the client happens to hold). Rendering those as
    // finished figures is worse than rendering nothing — "0 low stock" is a claim,
    // not a placeholder — so the tiles show a bar until the real numbers arrive.
    const kpisLoading = !kpis;

    // ── Metrics ──────────────────────────────────────────────────────────────
    const metrics = {
        totalItems:    kpis?.total_items    ?? (items || []).length,
        lowStock:      kpis?.low_stock      ?? 0,
        activeWO:      kpis?.active_wo      ?? 0,
        pendingWO:     kpis?.pending_wo     ?? 0,
        activeSamples: kpis?.active_samples ?? 0,
        openOrders:    kpis?.open_sos       ?? (summary?.open_so_count ?? (salesOrders || []).filter((s: any) => s.status === 'PENDING').length),
    };

    // ── Server-computed aggregates (with client fallback if summary missing) ───
    const prodYield = hasSummary
        ? summary.production_yield
        : (() => {
            const yo = (workOrders || []).filter((w: any) => ['COMPLETED', 'IN_PROGRESS'].includes(w.status));
            const done = yo.filter((w: any) => w.status === 'COMPLETED').reduce((s: number, w: any) => s + parseFloat(w.qty), 0);
            const tot = yo.reduce((s: number, w: any) => s + parseFloat(w.qty), 0);
            return tot > 0 ? (done / tot) * 100 : 100;
        })();

    const deliveryReadiness = hasSummary ? summary.delivery_readiness : 100;
    const openSOsCount = hasSummary ? summary.open_so_count : (salesOrders || []).filter((s: any) => s.status === 'PENDING').length;
    const readySOCount = hasSummary ? summary.ready_so_count : 0;
    // shortSOs: [{code, short_lines, total_lines}]
    const shortSOs: any[] = hasSummary ? (summary.short_orders || []) : [];
    const shortSOCount = hasSummary ? summary.short_so_count : shortSOs.length;

    // namedLowStock: [{id, name, code, totalStock}]
    const namedLowStock: any[] = hasSummary
        ? (summary.low_stock_items || []).map((l: any) => ({ id: l.item_id, name: l.item_name, code: l.item_code, totalStock: l.total_qty, minLevel: l.min_level }))
        : [];
    const outCount = namedLowStock.filter((i: any) => i.totalStock <= 0).length;

    // recentActivity: [{itemName, qty_change, created_at, location_name}]
    const recentActivity: any[] = hasSummary
        ? (summary.recent_movements || []).map((m: any, i: number) => ({
            key: i, itemName: m.item_name, qty_change: m.qty_change, created_at: m.created_at, location_name: m.location_name,
        }))
        : [...(stockEntries || [])]
            .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 5)
            .map((e: any, i: number) => ({ key: i, itemName: resolveName(e.item_id), qty_change: e.qty_change, created_at: e.created_at, location_name: (locations || []).find((l: any) => String(l.id) === String(e.location_id))?.name || '—' }));

    // locationStats grouped by parent warehouse: [{id, name, totalQty, catId, catName}]
    const whNameById: Record<string, string> = {};
    (locations || []).forEach((l: any) => { if (!l.parent_id) whNameById[String(l.id)] = l.name; });
    const locationStats: any[] = hasSummary
        ? (summary.warehouse_distribution || []).map((w: any) => ({
            id: w.location_id, name: w.location_name, totalQty: w.total_qty,
            catId: w.location_category_id ? String(w.location_category_id) : 'uncat',
            catName: w.location_category_name || 'No Warehouse',
        }))
        : (locations || []).map((loc: any) => ({
            id: loc.id, name: loc.name,
            totalQty: (stockBalance || []).filter((b: any) => String(b.location_id) === String(loc.id)).reduce((s: number, b: any) => s + parseFloat(b.qty), 0),
            catId: loc.parent_id ? String(loc.parent_id) : 'uncat',
            catName: whNameById[String(loc.parent_id)] || 'No Warehouse',
        })).filter((l: any) => l.totalQty > 0).sort((a: any, b: any) => b.totalQty - a.totalQty);
    const totalStockQty = locationStats.reduce((s: number, l: any) => s + l.totalQty, 0);

    // Group warehouse distribution by Location group (category); each group is
    // expandable to the specific locations within it.
    const groupedStats = useMemo(() => {
        const g: Record<string, { catId: string; name: string; total: number; locations: any[] }> = {};
        for (const l of locationStats) {
            if (!g[l.catId]) g[l.catId] = { catId: l.catId, name: l.catName, total: 0, locations: [] };
            g[l.catId].total += l.totalQty;
            g[l.catId].locations.push(l);
        }
        return Object.values(g)
            .sort((a, b) => b.total - a.total)
            .map(grp => ({ ...grp, locations: grp.locations.sort((a: any, b: any) => b.totalQty - a.totalQty) }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [summary, locations, stockBalance]);

    // ── Overdue WOs (from the MO list, which IS loaded on the dashboard) ───────
    const today = new Date();
    const overdueWOs = (workOrders || []).filter((w: any) =>
        ['IN_PROGRESS', 'PENDING'].includes(w.status) &&
        w.target_end_date && new Date(w.target_end_date) < today
    );

    // ── Action items list ────────────────────────────────────────────────────
    const actionItems = useMemo(() => {
        const list: { sev: 'crit' | 'warn' | 'info'; title: string; sub: string; detail: string }[] = [];
        namedLowStock.forEach((i: any) => {
            const out = i.totalStock <= 0;
            list.push({
                sev: out ? 'crit' : 'warn', title: `${i.name} — ${out ? 'OUT' : 'LOW'}`, sub: `Stock ${i.totalStock} · reorder at ${i.minLevel}`,
                detail: `On-hand stock for "${i.name}" across all locations is ${i.totalStock}, ${out ? 'at or below zero' : `below its reorder point of ${i.minLevel}`}. Work orders and sales orders that consume it may stall until it is replenished — raise a Purchase Order or a Production Run.`,
            });
        });
        if (metrics.lowStock > namedLowStock.length) {
            list.push({
                sev: 'warn', title: `${metrics.lowStock - namedLowStock.length} more items low`, sub: 'Check inventory for details',
                detail: `${metrics.lowStock - namedLowStock.length} additional item(s) have total on-hand stock below their reorder point (per-item, default 10 units). Open Inventory to see exactly which items need reordering.`,
            });
        }
        overdueWOs.slice(0, 3).forEach((w: any) => {
            list.push({
                sev: 'warn', title: `${w.code} — Overdue`, sub: `${resolveName(w.item_id)} · due ${w.target_end_date?.slice(0, 10) || '?'}`,
                detail: `Work order ${w.code} (${resolveName(w.item_id)}) had a planned end date of ${w.target_end_date?.slice(0, 10) || '?'} which has passed, but it is not yet COMPLETED. Check floor progress or reschedule the target date.`,
            });
        });
        shortSOs.slice(0, 2).forEach((so: any) => {
            list.push({
                sev: 'warn', title: `${so.code} — Material Gap`, sub: `${so.short_lines} of ${so.total_lines} lines unfulfilled`,
                detail: `Sales order ${so.code} has ${so.short_lines} of ${so.total_lines} line(s) whose ordered quantity exceeds available stock. Those lines cannot be shipped until the stock is received or produced.`,
            });
        });
        if (metrics.pendingWO > 0) {
            list.push({
                sev: 'info', title: `${metrics.pendingWO} WO${metrics.pendingWO > 1 ? 's' : ''} ready to release`, sub: 'Review and start production',
                detail: `${metrics.pendingWO} work order(s) are PENDING and waiting to be started. Review them and release to begin production.`,
            });
        }
        return list;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [summary, overdueWOs, metrics.lowStock, metrics.pendingWO]);

    // ── Health statuses ──────────────────────────────────────────────────────
    const stockHealth: HealthStatus  = outCount > 0 ? 'crit' : (namedLowStock.length > 0 || metrics.lowStock > 0) ? 'warn' : 'ok';
    const prodHealth: HealthStatus   = overdueWOs.length > 0 ? 'warn' : 'ok';
    const orderHealth: HealthStatus  = deliveryReadiness < 50 ? 'crit' : deliveryReadiness < 80 ? 'warn' : 'ok';

    // ── Active WOs for table ─────────────────────────────────────────────────
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
            .slice(0, 8);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workOrders, items, itemIndex]);

    // ────────────────────────────────────────────────────────────────────────
    // DEFAULT (non-classic) layout
    // ────────────────────────────────────────────────────────────────────────
    if (!classic) {
        const KPICard = ({ title, value, subtext, icon, bg, textDark, onClick }: any) => {
            const textCls = textDark ? 'text-dark' : 'text-white';
            return (
            <div className="col-md-4 col-lg-2">
                <div
                    className={`card h-100 border-0 shadow-sm ${textCls} ${onClick ? 'kpi-clickable' : ''}`}
                    onClick={onClick}
                    role={onClick ? 'button' : undefined}
                    tabIndex={onClick ? 0 : undefined}
                    onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
                    aria-label={onClick ? `${title}: ${value}. ${t('view_details')}` : `${title}: ${value}`}
                    style={{ background: bg, ...(onClick ? { cursor: 'pointer' } : {}) }}
                >
                    <div className="card-body p-3">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                            <h6 className={`card-title mb-0 opacity-75 small text-uppercase fw-bold ${textCls}`}>{title}</h6>
                            <i className={`bi ${icon} fs-4 opacity-50`} aria-hidden="true"></i>
                        </div>
                        <h3 className="fw-bold mb-0">
                            {kpisLoading ? <SkeletonBar width={56} height={24} /> : value}
                        </h3>
                        <small className="opacity-75" style={{ fontSize: '0.75rem' }}>{subtext}</small>
                    </div>
                </div>
            </div>
            );
        };

        const AdvisorPill = ({ icon, color, children, onClick, action }: any) => (
            <div className="d-flex align-items-center gap-2 extra-small text-nowrap">
                <i className={`bi ${icon} ${color}`} aria-hidden="true"></i>
                <span>{children}</span>
                {action && (
                    <button className="btn btn-sm btn-outline-light py-0 px-2 extra-small" style={{ fontSize: '0.6rem' }} onClick={onClick}>
                        {action} →
                    </button>
                )}
            </div>
        );

        return (
            <div className="fade-in">
                <div className="d-flex justify-content-between align-items-center mb-3">
                    <h4 className="fw-bold mb-0 text-capitalize">{t('dashboard')}</h4>
                    <span className="text-muted small">{tzFmt(new Date(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>

                {/* Smart Advisor */}
                <div className="card border-0 shadow-sm mb-4 text-white overflow-hidden" style={{ background: '#1e293b' }}>
                    <div className="card-body p-2 px-3">
                        <div className="row align-items-center g-3">
                            <div className="col-auto border-end border-secondary pe-3">
                                <div className="d-flex align-items-center gap-2">
                                    <i className="bi bi-cpu-fill text-info" aria-hidden="true"></i>
                                    <span className="extra-small fw-bold text-uppercase letter-spacing-1">{t('smart_advisor')}</span>
                                </div>
                            </div>
                            <div className="col">
                                <div className="d-flex gap-4 overflow-auto no-scrollbar py-1">
                                    {metrics.lowStock > 0 && (
                                        <AdvisorPill icon="bi-info-circle-fill" color="text-warning" action={t('inventory')} onClick={() => router.push('/inventory')}>
                                            <strong>{metrics.lowStock} {t('item')}{metrics.lowStock > 1 ? 's' : ''}</strong> {t('require_replenishment')}.
                                        </AdvisorPill>
                                    )}
                                    {metrics.pendingWO > 0 && (
                                        <AdvisorPill icon="bi-gear-fill" color="text-info" action={t('work_orders')} onClick={() => router.push('/work-orders')}>
                                            <strong>{metrics.pendingWO} WO{metrics.pendingWO > 1 ? 's' : ''}</strong> {t('ready_for_release')}.
                                        </AdvisorPill>
                                    )}
                                    {deliveryReadiness < 100 && openSOsCount > 0 && (
                                        <AdvisorPill icon="bi-truck" color="text-secondary" action={t('sales_orders')} onClick={() => router.push('/sales-orders')}>
                                            {t('material_shortages_affecting')} <strong>{Math.round(100 - deliveryReadiness)}%</strong> {t('of_orders')}.
                                        </AdvisorPill>
                                    )}
                                    {metrics.lowStock === 0 && metrics.pendingWO === 0 && (
                                        <div className="extra-small text-muted italic">{t('system_balanced')}</div>
                                    )}
                                </div>
                            </div>
                            <div className="col-auto ms-auto border-start border-secondary ps-3">
                                <div className="d-flex gap-4">
                                    <div className="text-center">
                                        <div className="extra-small text-muted fw-bold uppercase" style={{ fontSize: '0.6rem' }}>{t('production_yield')}</div>
                                        <div className={`fw-bold small ${prodYield > 90 ? 'text-success' : 'text-warning'}`}>{prodYield.toFixed(1)}%</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="extra-small text-muted fw-bold uppercase" style={{ fontSize: '0.6rem' }}>{t('delivery_readiness')}</div>
                                        <div className={`fw-bold small ${deliveryReadiness > 80 ? 'text-success' : 'text-warning'}`}>{deliveryReadiness.toFixed(1)}%</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* KPI cards */}
                <div className="row g-3 mb-3">
                    <KPICard title={t('item_inventory')} value={metrics.totalItems} subtext={t('total_skus')} icon="bi-box-seam" bg="#2563eb" onClick={() => router.push('/inventory')} />
                    <KPICard title={t('low_stock')} value={metrics.lowStock} subtext={t('view_details')} icon="bi-exclamation-triangle" bg="#f59e0b" textDark onClick={() => setDrill(drill === 'lowstock' ? null : 'lowstock')} />
                    <KPICard title={t('active_wo')} value={metrics.activeWO} subtext="Production" icon="bi-gear-wide-connected" bg="#16a34a" onClick={() => router.push('/work-orders')} />
                    <KPICard title={t('pending_wo')} value={metrics.pendingWO} subtext="In Queue" icon="bi-clock-history" bg="#8b5cf6" onClick={() => router.push('/work-orders')} />
                    <KPICard title={t('samples')} value={metrics.activeSamples} subtext="In Development" icon="bi-eyedropper" bg="#0ea5e9" onClick={() => router.push('/samples')} />
                    <KPICard title={t('open_orders')} value={metrics.openOrders} subtext={t('view_details')} icon="bi-receipt" bg="#475569" onClick={() => setDrill(drill === 'short' ? null : 'short')} />
                </div>

                {/* Drill-down panel */}
                {drill && (
                    <ShellWindow fill={false} className="mb-4">
                        <ShellTitleBar
                            icon={drill === 'lowstock' ? 'bi-exclamation-triangle' : 'bi-receipt'}
                            title={drill === 'lowstock' ? `${t('low_stock')} — ${t('item')}s` : `${t('order_health')} — ${t('material_shortages_affecting')}`}
                            right={<button className="btn btn-sm btn-light" onClick={() => setDrill(null)} aria-label={t('cancel')}><i className="bi bi-x-lg"></i></button>}
                        />
                        <div className="card-body p-0">
                            {drill === 'lowstock' ? (
                                <ul className="list-group list-group-flush">
                                    {namedLowStock.length === 0 && <li className="list-group-item text-muted small">{t('all_systems_nominal')}</li>}
                                    {namedLowStock.map((i: any) => (
                                        <li key={i.id} className="list-group-item d-flex justify-content-between align-items-center py-2">
                                            <span><CodeChip code={i.code} classic={false} tier={2} className="me-2" />{i.name}</span>
                                            <span className={`badge ${i.totalStock <= 0 ? 'bg-danger' : 'bg-warning text-dark'}`}>{i.totalStock} / min {i.minLevel}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <ul className="list-group list-group-flush">
                                    {shortSOs.length === 0 && <li className="list-group-item text-muted small">{t('all_systems_nominal')}</li>}
                                    {shortSOs.map((so: any) => (
                                        <li key={so.code} className="list-group-item d-flex justify-content-between align-items-center py-2">
                                            <span className="fw-medium">{so.code}</span>
                                            <span className="badge bg-warning text-dark">{so.short_lines} / {so.total_lines} {t('materials').toLowerCase()}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </ShellWindow>
                )}

                {/* Charts + calendar + activity */}
                <div className="row g-4 mb-4">
                    <div className="col-md-4">
                        <ShellWindow fill={false} className="h-100">
                            <ShellTitleBar icon="bi-building" title={t('warehouse_distribution')} />
                            <div className="card-body">
                                {groupedStats.length === 0 ? (
                                    <div className="text-center py-5"><i className="bi bi-pie-chart text-muted opacity-25 display-1" aria-hidden="true"></i><p className="text-muted small mt-2">{t('no_inventory_recorded')}</p></div>
                                ) : (
                                    <div className="d-flex align-items-center gap-3 flex-wrap">
                                        <Donut
                                            segments={groupedStats.slice(0, 7).map((g: any) => ({ label: g.name, value: g.total }))}
                                            centerLabel={totalStockQty.toLocaleString()}
                                            centerSub="units"
                                            ariaLabel={`${t('warehouse_distribution')}: ${groupedStats.map((g: any) => `${g.name} ${g.total}`).join(', ')}`}
                                        />
                                        <div className="flex-grow-1" style={{ minWidth: 150 }}>
                                            {groupedStats.slice(0, 7).map((g: any, idx: number) => {
                                                const pct = totalStockQty > 0 ? (g.total / totalStockQty) * 100 : 0;
                                                const open = !!expandedGroups[g.catId];
                                                return (
                                                    <div key={g.catId} className="mb-1">
                                                        <button type="button" onClick={() => toggleGroup(g.catId)}
                                                            className="btn btn-link p-0 text-decoration-none d-flex align-items-center justify-content-between w-100 small"
                                                            style={{ color: 'inherit' }} aria-expanded={open}>
                                                            <span className="d-flex align-items-center gap-2 text-truncate">
                                                                <i className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`} style={{ fontSize: '0.6rem' }} aria-hidden="true"></i>
                                                                <span style={{ width: 10, height: 10, borderRadius: 2, background: DONUT_COLORS[idx % DONUT_COLORS.length], display: 'inline-block', flexShrink: 0 }}></span>
                                                                <span className="text-truncate fw-medium">{g.name}</span>
                                                            </span>
                                                            <span className="text-muted ms-2 text-nowrap">{g.total.toLocaleString()} · {pct.toFixed(0)}%</span>
                                                        </button>
                                                        {open && (
                                                            <div className="ps-4 mt-1">
                                                                {g.locations.map((loc: any) => {
                                                                    const lpct = g.total > 0 ? (loc.totalQty / g.total) * 100 : 0;
                                                                    return (
                                                                        <div key={loc.id} className="d-flex justify-content-between small text-muted mb-1">
                                                                            <span className="text-truncate">{loc.name}</span>
                                                                            <span className="ms-2 text-nowrap">{loc.totalQty.toLocaleString()} · {lpct.toFixed(0)}%</span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </ShellWindow>
                    </div>
                    <div className="col-md-4">
                        <ShellWindow fill={false} className="h-100">
                            <ShellTitleBar icon="bi-calendar-event" title={t('production_deadlines')} />
                            <div className="card-body">
                                <CalendarView orders={workOrders} items={items} compact={true} />
                                <div className="mt-3 d-flex flex-wrap gap-2 justify-content-center">
                                    <small className="text-muted d-flex align-items-center"><span className="bg-primary rounded-circle me-1" style={{ width: 6, height: 6, display: 'inline-block' }}></span> {t('pending')}</small>
                                    <small className="text-muted d-flex align-items-center"><span className="bg-warning rounded-circle me-1" style={{ width: 6, height: 6, display: 'inline-block' }}></span> {t('in_progress')}</small>
                                    <small className="text-muted d-flex align-items-center"><span className="bg-success rounded-circle me-1" style={{ width: 6, height: 6, display: 'inline-block' }}></span> {t('completed')}</small>
                                </div>
                            </div>
                        </ShellWindow>
                    </div>
                    <div className="col-md-4">
                        <ShellWindow fill={false} className="h-100">
                            <ShellTitleBar icon="bi-clock-history" title={t('recent_activity')} />
                            <div className="card-body p-0">
                                <ul className="list-group list-group-flush">
                                    {recentActivity.map((entry: any) => (
                                        <li key={entry.key} className="list-group-item d-flex justify-content-between align-items-center py-2 border-0 border-bottom">
                                            <div style={{ minWidth: 0 }}>
                                                <div className="fw-medium text-truncate small">{entry.itemName}</div>
                                                <small className="text-muted d-block" style={{ fontSize: '0.65rem', fontFamily: CODE_FONT }}>{tzDateTime(entry.created_at)}</small>
                                            </div>
                                            <div className={`fw-bold ms-2 small ${entry.qty_change > 0 ? 'text-success' : 'text-danger'}`}>
                                                {entry.qty_change > 0 ? '+' : ''}{entry.qty_change}
                                            </div>
                                        </li>
                                    ))}
                                    {recentActivity.length === 0 && <li className="list-group-item text-center py-5 text-muted small">{t('no_recent_movements')}</li>}
                                </ul>
                            </div>
                        </ShellWindow>
                    </div>
                </div>

                {/* KPI Trends */}
                <div className="row g-4 mb-4">
                    <div className="col-12">
                        <ShellWindow fill={false}>
                            <ShellTitleBar icon="bi-graph-up" title={t('kpi_trends')} />
                            <div className="card-body">
                                <div className="row g-3">
                                    {TREND_METRICS.map((m) => {
                                        const series = kpiHistory?.[m.key] || [];
                                        const last = series.length ? series[series.length - 1].value : (kpis?.[m.key] ?? 0);
                                        const first = series.length ? series[0].value : last;
                                        const delta = last - first;
                                        const labelKey = m.key === 'open_sos' ? 'open_orders' : m.key;
                                        const deltaCls = m.key === 'low_stock' ? (delta > 0 ? 'text-danger' : delta < 0 ? 'text-success' : 'text-muted') : 'text-muted';
                                        return (
                                            <div key={m.key} className="col-6 col-md-3">
                                                <div className="border rounded p-2 h-100">
                                                    <div className="d-flex justify-content-between align-items-baseline mb-1">
                                                        <span className="text-muted text-uppercase fw-bold" style={{ fontSize: '0.65rem' }}>{t(labelKey)}</span>
                                                        <span className="fw-bold">{last.toLocaleString()}</span>
                                                    </div>
                                                    <Sparkline data={series} color={m.color} width={200} height={32} ariaLabel={`${t(labelKey)} 30-day trend`} />
                                                    <div className={`mt-1 ${deltaCls}`} style={{ fontSize: '0.65rem' }}>
                                                        {delta === 0 ? 'no change · 30d' : `${delta > 0 ? '+' : ''}${delta.toLocaleString()} · 30d`}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </ShellWindow>
                    </div>
                </div>

                {/* Manufacturing monitoring */}
                <div className="row">
                    <div className="col-12">
                        <ShellWindow fill={false}>
                            <ShellTitleBar
                                icon="bi-gear"
                                title={t('manufacturing_monitoring')}
                                right={<span className="small text-muted">{metrics.activeWO} {t('active_wo').toLowerCase()} · {metrics.pendingWO} {t('pending').toLowerCase()}</span>}
                            />
                            <div className="card-body p-0">
                                <div className="table-responsive">
                                    <table className="table table-hover align-middle mb-0 small">
                                        <thead className="table-light">
                                            <tr><th className="ps-3">{t('code')}</th><th>{t('product')}</th><th>{t('status')}</th><th>{t('progress')}</th><th className="text-end pe-3">{t('target')}</th></tr>
                                        </thead>
                                        <tbody>
                                            {activeWOList.map((wo: any) => (
                                                <tr key={wo.id}>
                                                    <td className="ps-3"><CodeChip code={wo.code} classic={false} /></td>
                                                    <td>{wo.itemName}</td>
                                                    <td><StatusChip status={wo.isOverdue ? 'OVERDUE' : wo.status} tint /></td>
                                                    <td style={{ maxWidth: 160 }}>
                                                        <ProgressBar
                                                            pct={wo.progress}
                                                            tone={wo.isOverdue ? 'red' : wo.status === 'IN_PROGRESS' ? 'blue' : 'gray'}
                                                            height={8}
                                                            label="outside"
                                                        />
                                                    </td>
                                                    <td className="text-end pe-3 fw-bold">{wo.qty?.toLocaleString()}</td>
                                                </tr>
                                            ))}
                                            {activeWOList.length === 0 && <tr><td colSpan={5} className="text-center py-4 text-muted">{t('no_active_production')}</td></tr>}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </ShellWindow>
                    </div>
                </div>
            </div>
        );
    }

    // ────────────────────────────────────────────────────────────────────────
    // CLASSIC (Windows XP) layout — Command Center
    // ────────────────────────────────────────────────────────────────────────

    const critCount = actionItems.filter(a => a.sev === 'crit').length;
    const warnCount = actionItems.filter(a => a.sev === 'warn').length;

    const alertRowStyle = (sev: string): React.CSSProperties => {
        const fam = SEV_FAMILY[sev] || 'gray';
        return {
            padding: '4px 8px',
            borderBottom: '1px solid #ddd',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '6px',
            background: familyTint(fam).background,
            borderLeft: `3px solid ${familyColor(fam)}`,
        };
    };

    const HealthPanel = ({ status, title, bigNum, bigLabel, lines, prog, progTone, progLabel }: any) => {
        const fam = HEALTH_FAMILY[status as HealthStatus];
        const tint = familyTint(fam);
        return (
        <div style={{ border: `2px solid ${familyColor(fam)}`, background: tint.background, flex: 1, minWidth: 0 }}>
            <div style={{
                fontFamily: xpFont, fontWeight: 'bold', fontSize: '11px',
                padding: '3px 8px', borderBottom: '1px solid rgba(0,0,0,0.1)',
                display: 'flex', alignItems: 'center', gap: '5px',
                background: 'rgba(0,0,0,0.04)',
                color: tint.color,
            }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: familyColor(fam), border: '1px solid rgba(0,0,0,0.3)', flexShrink: 0 }}></div>
                {title}
            </div>
            <div style={{ padding: '6px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '26px', fontWeight: 'bold', fontFamily: CODE_FONT, color: familyColor(fam), lineHeight: 1 }}>
                        {bigNum}
                    </span>
                    <span style={{ fontSize: '10px', color: '#555' }}>{bigLabel}</span>
                </div>
                {lines.map((line: any, i: number) => (
                    <div key={i} style={{ fontSize: '9px', color: line.color || '#555', marginBottom: '2px' }}>
                        {line.icon} {line.text}
                    </div>
                ))}
                {prog !== undefined && (
                    <div style={{ marginTop: '5px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#555', marginBottom: '2px' }}>
                            <span>{progLabel}</span>
                            <span style={{ fontWeight: 'bold', color: '#333' }}>{prog.toFixed(1)}%</span>
                        </div>
                        <ProgressBar pct={prog} tone={progTone} title={progLabel} />
                    </div>
                )}
            </div>
        </div>
        );
    };

    const kpiTileStyle = (highlight?: 'crit' | 'warn'): React.CSSProperties => ({
        border: '2px solid',
        borderColor: highlight === 'crit' ? '#ffaaaa #cc0000 #cc0000 #ffaaaa'
                   : highlight === 'warn' ? '#ffe088 #c77800 #c77800 #ffe088'
                   : '#dfdfdf #808080 #808080 #dfdfdf',
        textAlign: 'center',
        padding: '5px 4px',
        background: highlight === 'crit' ? '#ffecec' : highlight === 'warn' ? '#fffae8' : '#f5f4ef',
    });

    // One tile shape for the whole KPI strip — the six tiles differed only in
    // value/label/accent, so they were six copies of the same two divs.
    const KpiTile = ({ value, label, tone, highlight }: {
        value: React.ReactNode; label: string; tone?: StatusFamily; highlight?: 'crit' | 'warn';
    }) => (
        <div style={kpiTileStyle(highlight)}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: CODE_FONT, color: tone ? familyColor(tone) : '#333', lineHeight: 1.1 }}>
                {kpisLoading
                    ? <span style={{ display: 'inline-block', width: 42, verticalAlign: 'middle' }}><SkeletonBar width="100%" height={18} /></span>
                    : value}
            </div>
            <div style={{ fontSize: '8px', color: '#444', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>{label}</div>
        </div>
    );

    return (
        <div className="fade-in" style={{ fontFamily: xpFont, fontSize: '11px', background: '#ece9d8', padding: '4px' }}>

            {/* ── Top bar: date + title ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', padding: '0 2px' }}>
                <span style={{ fontWeight: 'bold', fontSize: '13px', color: '#00309c' }}>
                    <i className="bi bi-speedometer2" style={{ marginRight: 4 }} aria-hidden="true" /> {t('dashboard')}
                </span>
                <span style={{ fontSize: '10px', color: '#555' }}>
                    {tzFmt(new Date(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
            </div>

            {/* ── Row 1: 3 Health Panels ── */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <HealthPanel
                    status={stockHealth}
                    title={t('stock_health')}
                    bigNum={namedLowStock.length > 0 ? namedLowStock.length : metrics.totalItems}
                    bigLabel={namedLowStock.length > 0 ? `item${namedLowStock.length > 1 ? 's' : ''} at critical level` : 'SKUs in inventory'}
                    lines={namedLowStock.length > 0
                        ? namedLowStock.slice(0, 2).map((i: any) => ({ text: `${i.name} — ${i.totalStock} units`, color: '#880000', icon: '●' }))
                          .concat(metrics.totalItems ? [{ text: `${metrics.totalItems} total SKUs across ${(locations || []).length} locations`, color: '#555', icon: '' }] : [])
                        : [
                            { text: `${metrics.totalItems} total SKUs tracked`, color: '#228822', icon: '+' },
                            { text: `${(locations || []).length} warehouse location${(locations || []).length !== 1 ? 's' : ''}`, color: '#555', icon: '' },
                          ]
                    }
                />
                <HealthPanel
                    status={prodHealth}
                    title={t('production_health')}
                    bigNum={metrics.activeWO}
                    bigLabel="active work orders"
                    lines={[
                        overdueWOs.length > 0
                            ? { text: `${overdueWOs[0].code} overdue (${overdueWOs[0].target_end_date?.slice(0, 10) || '?'})`, color: '#aa6600', icon: '●' }
                            : { text: 'No overdue work orders', color: '#228822', icon: '+' },
                        { text: `${metrics.pendingWO} WO${metrics.pendingWO !== 1 ? 's' : ''} pending release`, color: '#555', icon: '' },
                    ]}
                    prog={prodYield}
                    progTone={prodYield > 90 ? 'green' : 'amber'}
                    progLabel={t('production_yield')}
                />
                <HealthPanel
                    status={orderHealth}
                    title={t('order_health')}
                    bigNum={metrics.openOrders}
                    bigLabel="open sales orders"
                    lines={[
                        readySOCount > 0
                            ? { text: `${readySOCount} order${readySOCount > 1 ? 's' : ''} fully fulfillable`, color: '#228822', icon: '+' }
                            : { text: 'No orders fully fulfillable', color: '#aa6600', icon: '!' },
                        shortSOCount > 0
                            ? { text: `${shortSOCount} order${shortSOCount > 1 ? 's' : ''} have material shortages`, color: '#aa6600', icon: '!' }
                            : { text: 'No material shortages', color: '#228822', icon: '+' },
                    ]}
                    prog={deliveryReadiness}
                    progTone={deliveryReadiness > 80 ? 'green' : deliveryReadiness > 50 ? 'amber' : 'red'}
                    progLabel={t('delivery_readiness')}
                />
            </div>

            {/* ── Row 2: KPI strip ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '4px', marginBottom: '6px' }}>
                <KpiTile value={metrics.totalItems} label={t('total_skus')} tone="blue" />
                <KpiTile
                    value={metrics.lowStock}
                    label={t('low_stock')}
                    tone={outCount > 0 ? 'red' : metrics.lowStock > 0 ? 'amber' : 'green'}
                    highlight={outCount > 0 ? 'crit' : metrics.lowStock > 0 ? 'warn' : undefined}
                />
                <KpiTile
                    value={metrics.activeWO}
                    label={t('active_wo')}
                    tone={overdueWOs.length > 0 ? 'amber' : undefined}
                    highlight={overdueWOs.length > 0 ? 'warn' : undefined}
                />
                <KpiTile value={metrics.pendingWO} label={t('pending_wo')} />
                <KpiTile value={metrics.activeSamples} label={t('samples')} />
                <KpiTile
                    value={metrics.openOrders}
                    label={t('open_orders')}
                    tone={shortSOCount > 0 ? 'amber' : undefined}
                    highlight={shortSOCount > 0 ? 'warn' : undefined}
                />
            </div>

            {/* ── Row 3: Action Items (left) + WO Table (right) ── */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', height: '220px' }}>

                {/* Action Items pane */}
                <ShellWindow fill={false} style={{ width: '260px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                    <ShellTitleBar
                        tone="red"
                        icon="bi-list-check"
                        title={t('action_items')}
                        right={(critCount > 0 || warnCount > 0) ? (
                            <span style={{ fontSize: '10px', fontWeight: 'normal' }}>
                                {critCount > 0 && `${critCount} critical`}{critCount > 0 && warnCount > 0 && ' · '}{warnCount > 0 && `${warnCount} warnings`}
                            </span>
                        ) : undefined}
                    />
                    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                        {actionItems.length === 0 ? (
                            <div style={{ ...alertRowStyle('info'), padding: '16px', textAlign: 'center', fontStyle: 'italic', color: '#666', fontSize: '10px', display: 'block' }}>
                                <i className="bi bi-check-circle" style={{ marginRight: 4, color: familyColor('green') }} aria-hidden="true" />{t('all_systems_nominal')}
                            </div>
                        ) : (
                            actionItems.map((item, i) => (
                                <div key={i}
                                    style={{ ...alertRowStyle(item.sev), position: 'relative', cursor: 'help' }}
                                    onMouseEnter={() => setHoveredAction(i)}
                                    onMouseLeave={() => setHoveredAction(null)}
                                >
                                    <span style={{
                                        width: 9, height: 9, marginTop: '3px', flexShrink: 0, display: 'inline-block',
                                        background: familyColor(SEV_FAMILY[item.sev]),
                                        border: '1px solid rgba(0,0,0,0.35)',
                                    }} />
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 'bold', color: familyTint(SEV_FAMILY[item.sev]).color, fontSize: '10px' }}>
                                            {item.title}
                                            <i className="bi bi-question-circle" style={{ marginLeft: 4, color: '#999', fontSize: 9 }} aria-hidden="true" />
                                        </div>
                                        <div style={{ fontSize: '9px', color: '#666' }}>{item.sub}</div>
                                    </div>
                                    {hoveredAction === i && (
                                        <div role="tooltip" style={{
                                            position: 'absolute', left: '100%', top: 0, marginLeft: 6, width: 230, zIndex: 1000,
                                            background: '#ffffe1', border: '1px solid #808080', boxShadow: '2px 2px 5px rgba(0,0,0,0.3)',
                                            padding: '6px 8px', fontFamily: xpFont, fontSize: '10px', color: '#222', lineHeight: 1.4,
                                        }}>
                                            {item.detail}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                    <XPStatusBar style={{ marginTop: 0 }}>
                        {critCount} critical · {warnCount} warnings · {actionItems.filter(a => a.sev === 'info').length} info
                    </XPStatusBar>
                </ShellWindow>

                {/* WO Table */}
                <ShellWindow fill={false} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <ShellTitleBar
                        tone="amber"
                        icon="bi-gear"
                        title={t('work_order_monitoring')}
                        right={<span style={{ fontSize: '10px', fontWeight: 'normal' }}>{metrics.activeWO} active · {metrics.pendingWO} pending</span>}
                    />
                    <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                        <table style={xpTable}>
                            <thead>
                                <tr>
                                    <th style={stickyTh({ width: '100px' })}>{t('code')}</th>
                                    <th style={stickyTh()}>{t('product')}</th>
                                    <th style={stickyTh({ width: '65px' })}>{t('status')}</th>
                                    <th style={stickyTh({ width: '110px' })}>{t('progress')}</th>
                                    <th style={stickyTh({ width: '50px', textAlign: 'right' })}>{t('qty')}</th>
                                    <th style={stickyTh({ width: '75px', borderRight: 'none' })}>{t('due_date')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeWOList.map((wo: any, idx: number) => {
                                    const progTone: StatusFamily = wo.isOverdue ? 'red' : wo.progress >= 100 ? 'green' : wo.status === 'IN_PROGRESS' ? 'blue' : 'gray';
                                    const displayStatus = wo.isOverdue ? 'OVERDUE' : wo.status;
                                    return (
                                        <tr key={wo.id} style={lvRow(idx)}>
                                            <td style={lvTd()}><CodeChip code={wo.code} classic /></td>
                                            <td style={{ ...lvTd(), fontWeight: 'bold', color: '#000' }}>{wo.itemName}</td>
                                            <td style={lvTd()}>
                                                <StatusChip
                                                    status={displayStatus}
                                                    label={displayStatus === 'IN_PROGRESS' ? 'IN PROG' : displayStatus === 'COMPLETED' ? 'DONE' : undefined}
                                                    tint
                                                />
                                            </td>
                                            <td style={lvTd()}>
                                                <ProgressBar pct={wo.progress} tone={progTone} height={9} label="outside" />
                                            </td>
                                            <td style={{ ...lvTd(), textAlign: 'right', fontWeight: 'bold' }}>{wo.qty?.toLocaleString()}</td>
                                            <td style={{ ...lvTd(), borderRight: 'none', color: wo.isOverdue ? familyColor('red') : '#333', fontWeight: wo.isOverdue ? 'bold' : 'normal', fontSize: '9px' }}>
                                                {wo.target_end_date ? `${wo.target_end_date.slice(0, 10)}${wo.isOverdue ? ' ●' : ''}` : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {activeWOList.length === 0 && (
                                    <tr><td colSpan={6} style={emptyRowStyle}>{t('no_active_production')}</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <XPStatusBar
                        style={{ marginTop: 0 }}
                        right={<>{t('delivery_readiness')}: {deliveryReadiness.toFixed(1)}%</>}
                    >
                        {t('production_yield')}: {prodYield.toFixed(1)}%
                    </XPStatusBar>
                </ShellWindow>
            </div>

            {/* ── Row 4: Recent Movements (left) + Warehouse Distribution (right) ── */}
            <div style={{ display: 'flex', gap: '6px', height: '200px' }}>

                {/* Recent stock movements */}
                <ShellWindow fill={false} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <ShellTitleBar tone="grey" icon="bi-clock-history" title={t('recent_stock_movements')} />
                    <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                        <table style={xpTable}>
                            <thead>
                                <tr>
                                    <th style={stickyTh()}>{t('item')}</th>
                                    <th style={stickyTh({ width: '60px', textAlign: 'right' })}>{t('change')}</th>
                                    <th style={stickyTh({ width: '110px' })}>{t('locations')}</th>
                                    <th style={stickyTh({ width: '90px', borderRight: 'none' })}>{t('when')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentActivity.map((entry: any, idx: number) => (
                                    <tr key={entry.key} style={lvRow(idx)}>
                                        <td style={{ ...lvTd(), fontWeight: 'bold', color: '#000' }}>{entry.itemName}</td>
                                        <td style={{ ...lvTd(), textAlign: 'right', fontWeight: 'bold', color: familyColor(entry.qty_change > 0 ? 'green' : 'red') }}>
                                            {entry.qty_change > 0 ? '+' : ''}{entry.qty_change}
                                        </td>
                                        <td style={{ ...lvTd(), fontSize: '9px', color: '#444' }}>
                                            {entry.location_name || '—'}
                                        </td>
                                        <td style={{ ...lvTd(), fontSize: '9px', color: '#666', borderRight: 'none' }}>
                                            {tzFmt(entry.created_at, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </td>
                                    </tr>
                                ))}
                                {recentActivity.length === 0 && (
                                    <tr><td colSpan={4} style={{ ...emptyRowStyle, padding: '12px' }}>{t('no_recent_movements')}</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </ShellWindow>

                {/* Warehouse distribution */}
                <ShellWindow fill={false} style={{ width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                    <ShellTitleBar tone="grey" icon="bi-building" title={t('warehouse_distribution')} />
                    <div style={{ padding: '6px 8px', background: '#f0efe8', flex: 1, overflowY: 'auto', minHeight: 0 }}>
                        {groupedStats.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '12px', color: '#888', fontStyle: 'italic', fontSize: '10px' }}>{t('no_inventory_recorded')}</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {groupedStats.map((g: any) => {
                                    const pct = totalStockQty > 0 ? (g.total / totalStockQty) * 100 : 0;
                                    const open = !!expandedGroups[g.catId];
                                    return (
                                        <div key={g.catId}>
                                            <div onClick={() => toggleGroup(g.catId)} style={{ cursor: 'pointer' }} title={open ? 'Collapse' : 'Expand locations'}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' }}>
                                                    <span style={{ fontWeight: 'bold', color: '#000' }}>
                                                        <i className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`} style={{ fontSize: 8, marginRight: 3 }} aria-hidden="true" />
                                                        {g.name}
                                                    </span>
                                                    <span style={{ color: '#555' }}>{g.total.toLocaleString()} · {pct.toFixed(0)}%</span>
                                                </div>
                                                {/* Share-of-stock, not a status: one neutral blue tone for every
                                                    group — a rotating red/green palette would read as severity. */}
                                                <ProgressBar pct={pct} tone="blue" title={g.name} />
                                            </div>
                                            {open && (
                                                <div style={{ paddingLeft: 12, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    {g.locations.map((loc: any) => {
                                                        const lpct = g.total > 0 ? (loc.totalQty / g.total) * 100 : 0;
                                                        return (
                                                            <div key={loc.id}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginBottom: '1px', color: '#333' }}>
                                                                    <span>{loc.name}</span>
                                                                    <span style={{ color: '#666' }}>{loc.totalQty.toLocaleString()} · {lpct.toFixed(0)}%</span>
                                                                </div>
                                                                <ProgressBar pct={lpct} tone="blue" height={7} title={loc.name} />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                <div style={{ fontSize: '9px', color: '#666', marginTop: '2px', borderTop: '1px solid #ccc', paddingTop: '4px' }}>
                                    Total: {totalStockQty.toLocaleString()} units · {groupedStats.length} group{groupedStats.length !== 1 ? 's' : ''} · {locationStats.length} location{locationStats.length !== 1 ? 's' : ''}
                                </div>
                            </div>
                        )}
                    </div>
                </ShellWindow>
            </div>

            {/* ── Row 5: KPI Trends ── */}
            <ShellWindow fill={false} style={{ marginTop: '6px' }}>
                <ShellTitleBar tone="grey" icon="bi-graph-up" title={t('kpi_trends')} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '6px', padding: '8px', background: '#f0efe8' }}>
                    {TREND_METRICS.map((m) => {
                        const series = kpiHistory?.[m.key] || [];
                        const last = series.length ? series[series.length - 1].value : (kpis?.[m.key] ?? 0);
                        const first = series.length ? series[0].value : last;
                        const delta = last - first;
                        const labelKey = m.key === 'open_sos' ? 'open_orders' : m.key;
                        const deltaColor = m.key === 'low_stock' && delta !== 0 ? familyColor(delta > 0 ? 'red' : 'green') : '#777';
                        return (
                            <div key={m.key} style={{ border: '1px solid #c0bdb5', background: '#fff', padding: '6px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                                    <span style={{ fontSize: 8, fontWeight: 'bold', textTransform: 'uppercase', color: '#444' }}>{t(labelKey)}</span>
                                    <span style={{ fontFamily: CODE_FONT, fontWeight: 'bold', fontSize: 13, color: '#00309c' }}>{last.toLocaleString()}</span>
                                </div>
                                <Sparkline data={series} color={m.color} width={150} height={30} ariaLabel={`${t(labelKey)} 30-day trend`} />
                                <div style={{ fontSize: 8, color: deltaColor, marginTop: 2 }}>
                                    {delta === 0 ? 'no change · 30d' : `${delta > 0 ? '+' : ''}${delta.toLocaleString()} · 30d`}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </ShellWindow>
        </div>
    );
}
