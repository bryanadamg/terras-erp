import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '../../context/LanguageContext';
import { useTimezone } from '../../context/TimezoneContext';
import CalendarView from '../shared/CalendarView';
import {
    xpFont, ProgressBar, StatusChip, XPStatusBar, familyColor, familyTint, statusColor, type StatusFamily,
    CodeChip, CODE_FONT, SkeletonBar, TableSkeleton, useTableSkeletonMetrics, XPEmptyState,
} from '../shared/xpTheme';
import { Tooltip } from '../shared/Tooltip';
import { ShellWindow, ShellTitleBar } from '../shared/shellTheme';
import { lvTd, lvRow, lvThSticky, TableEmpty } from '../shared/listViewTheme';

// ── Local table chrome ───────────────────────────────────────────────────────
// Header cells, body cells, rows and empty rows are listViewTheme's
// (lvThSticky/lvTd/lvRow/TableEmpty) — the sticky banded header and the muted
// empty row here were local copies of exactly those. Only the <table> element
// itself stays local.
const xpTable: React.CSSProperties = {
    width: '100%', borderCollapse: 'collapse', fontFamily: xpFont, background: '#ffffff',
};

// Health panels signal the same five semantic families as every status chip —
// map through STATUS_FAMILY's palette instead of a local hex table.
type HealthStatus = 'ok' | 'warn' | 'crit';
const HEALTH_FAMILY: Record<HealthStatus, StatusFamily> = { ok: 'green', warn: 'amber', crit: 'red' };

// A line under a health panel's big number. `tone` picks its text + icon colour
// from the shared five families; a line with neither reads as plain context.
type HealthLine = { text: string; tone?: StatusFamily; icon?: string };
const SEV_FAMILY: Record<string, StatusFamily> = { crit: 'red', warn: 'amber', info: 'green' };

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

export default function DashboardView({ items, locations, stockBalance, workOrders, stockEntries, samples, salesOrders, kpis, summary, itemIndex, kpiHistory, loading }: any) {
    const { t } = useLanguage();
    const { formatDateTime: tzDateTime, formatCustom: tzFmt } = useTimezone();
    const router = useRouter();
    const [drill, setDrill] = useState<'lowstock' | 'short' | null>(null);
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
    // Command Center layout
    // ────────────────────────────────────────────────────────────────────────

    // Skeleton metrics: cols summed off the live <thead>, row height measured from
       // a real row — never hand-counted (see the loading-UI standard).
    const woBodyRef = useRef<HTMLTableSectionElement>(null);
    const woSkel = useTableSkeletonMetrics('dashboard-wo', woBodyRef, false);
    const moveBodyRef = useRef<HTMLTableSectionElement>(null);
    const moveSkel = useTableSkeletonMetrics('dashboard-movements', moveBodyRef, false);

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
                {lines.map((line: HealthLine, i: number) => (
                    <div key={i} style={{
                        fontSize: '9px', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: 4,
                        color: line.tone ? familyTint(line.tone).color : '#555',
                    }}>
                        {line.icon && line.tone && <i className={`bi ${line.icon}`} style={{ fontSize: 8, color: familyColor(line.tone) }} aria-hidden="true" />}
                        <span>{line.text}</span>
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

    // Accent frame + wash come from the same five families as every chip, health
    // panel and alert row. The local crit/warn hex pair was a sixth red and a sixth
    // amber sitting one row above the ones STATUS_FAMILY paints.
    const kpiTileStyle = (frame?: StatusFamily): React.CSSProperties => ({
        border: '2px solid',
        ...(frame
            ? { borderColor: familyColor(frame), background: familyTint(frame).background }
            : { borderColor: '#dfdfdf #808080 #808080 #dfdfdf', background: '#f5f4ef' }),
        textAlign: 'center',
        padding: '5px 4px',
    });

    // One tile shape for the whole KPI strip — the six tiles differed only in
    // value/label/accent, so they were six copies of the same two divs.
    const KpiTile = ({ value, label, tone, frame }: {
        value: React.ReactNode; label: string; tone?: StatusFamily; frame?: boolean;
    }) => (
        <div style={kpiTileStyle(frame ? tone : undefined)}>
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
                        ? namedLowStock.slice(0, 2).map((i: any): HealthLine => ({ text: `${i.name} — ${i.totalStock} units`, tone: 'red', icon: 'bi-circle-fill' }))
                          .concat(metrics.totalItems ? [{ text: `${metrics.totalItems} total SKUs across ${(locations || []).length} locations` }] : [])
                        : [
                            { text: `${metrics.totalItems} total SKUs tracked`, tone: 'green', icon: 'bi-check-circle-fill' },
                            { text: `${(locations || []).length} warehouse location${(locations || []).length !== 1 ? 's' : ''}` },
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
                            ? { text: `${overdueWOs[0].code} overdue (${overdueWOs[0].target_end_date?.slice(0, 10) || '?'})`, tone: 'amber', icon: 'bi-exclamation-triangle-fill' }
                            : { text: 'No overdue work orders', tone: 'green', icon: 'bi-check-circle-fill' },
                        { text: `${metrics.pendingWO} WO${metrics.pendingWO !== 1 ? 's' : ''} pending release` },
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
                            ? { text: `${readySOCount} order${readySOCount > 1 ? 's' : ''} fully fulfillable`, tone: 'green', icon: 'bi-check-circle-fill' }
                            : { text: 'No orders fully fulfillable', tone: 'amber', icon: 'bi-exclamation-triangle-fill' },
                        shortSOCount > 0
                            ? { text: `${shortSOCount} order${shortSOCount > 1 ? 's' : ''} have material shortages`, tone: 'amber', icon: 'bi-exclamation-triangle-fill' }
                            : { text: 'No material shortages', tone: 'green', icon: 'bi-check-circle-fill' },
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
                    frame={metrics.lowStock > 0}
                />
                <KpiTile
                    value={metrics.activeWO}
                    label={t('active_wo')}
                    tone={overdueWOs.length > 0 ? 'amber' : undefined}
                    frame={overdueWOs.length > 0}
                />
                <KpiTile value={metrics.pendingWO} label={t('pending_wo')} />
                <KpiTile value={metrics.activeSamples} label={t('samples')} />
                <KpiTile
                    value={metrics.openOrders}
                    label={t('open_orders')}
                    tone={shortSOCount > 0 ? 'amber' : undefined}
                    frame={shortSOCount > 0}
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
                            <XPEmptyState icon="bi-check-circle" message={t('all_systems_nominal')} />
                        ) : (
                            // The detail text rides the app's own hover layer (delay,
                            // placement, portal, aria-describedby). The local absolute
                            // popup it replaces was a second tooltip surface, clipped by
                            // this pane's own overflow.
                            actionItems.map((item, i) => (
                                <Tooltip key={i} content={item.detail} placement="side" maxWidth={260}>
                                    <div style={{ ...alertRowStyle(item.sev), cursor: 'help' }}>
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
                                    </div>
                                </Tooltip>
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
                                    <th style={lvThSticky({ width: '100px' })}>{t('code')}</th>
                                    <th style={lvThSticky()}>{t('product')}</th>
                                    <th style={lvThSticky({ width: '65px' })}>{t('status')}</th>
                                    <th style={lvThSticky({ width: '110px' })}>{t('progress')}</th>
                                    <th style={lvThSticky({ width: '50px', textAlign: 'right' })}>{t('qty')}</th>
                                    <th style={lvThSticky({ width: '75px', borderRight: 'none' })}>{t('due_date')}</th>
                                </tr>
                            </thead>
                            <tbody ref={woBodyRef}>
                                {activeWOList.map((wo: any, idx: number) => {
                                    const progTone: StatusFamily = wo.isOverdue ? 'red' : wo.progress >= 100 ? 'green' : wo.status === 'IN_PROGRESS' ? 'blue' : 'gray';
                                    const displayStatus = wo.isOverdue ? 'OVERDUE' : wo.status;
                                    return (
                                        <tr key={wo.id} style={lvRow(idx)}>
                                            <td style={lvTd()}><CodeChip code={wo.code} /></td>
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
                                {activeWOList.length === 0 && (loading
                                    ? <TableSkeleton rows={6} cols={woSkel.cols ?? 6} tdStyle={lvTd()} rowHeight={woSkel.rowHeight} fillHeight={woSkel.fillHeight} />
                                    : <TableEmpty colSpan={6} icon="bi-gear" message={t('no_active_production')} tdStyle={lvTd()} />
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

            {/* ── Row 4: Recent Movements + Production Deadlines + Warehouse Distribution ── */}
            {/* 280px so a 6-week month grid (6 x 34px cells + weekday header + month nav
                + legend) fits without the pane scrolling; the two table panes just show
                more rows at that height. */}
            <div style={{ display: 'flex', gap: '6px', height: '280px' }}>

                {/* Recent stock movements */}
                <ShellWindow fill={false} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <ShellTitleBar tone="grey" icon="bi-clock-history" title={t('recent_stock_movements')} />
                    <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                        <table style={xpTable}>
                            <thead>
                                <tr>
                                    <th style={lvThSticky()}>{t('item')}</th>
                                    <th style={lvThSticky({ width: '60px', textAlign: 'right' })}>{t('change')}</th>
                                    <th style={lvThSticky({ width: '110px' })}>{t('locations')}</th>
                                    <th style={lvThSticky({ width: '90px', borderRight: 'none' })}>{t('when')}</th>
                                </tr>
                            </thead>
                            <tbody ref={moveBodyRef}>
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
                                {recentActivity.length === 0 && (loading
                                    ? <TableSkeleton rows={6} cols={moveSkel.cols ?? 4} tdStyle={lvTd()} rowHeight={moveSkel.rowHeight} fillHeight={moveSkel.fillHeight} />
                                    : <TableEmpty colSpan={4} icon="bi-clock-history" message={t('no_recent_movements')} tdStyle={lvTd()} />
                                )}
                            </tbody>
                        </table>
                    </div>
                </ShellWindow>

                {/* Production deadlines — WOs are dated by target_end_date (their only
                    due field); target_start_date is the fallback for one not yet scheduled
                    to finish, matching the MO calendar tab. */}
                <ShellWindow fill={false} style={{ width: '320px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                    <ShellTitleBar tone="grey" icon="bi-calendar-event" title={t('production_deadlines')} />
                    <div style={{ padding: '4px 6px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
                        <CalendarView
                            orders={workOrders}
                            items={items}
                            compact
                            endField="target_end_date"
                            startField="target_start_date"
                        />
                        {/* Dots are painted by statusColor(); the legend reads the same
                            function so the two can never drift apart. */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginTop: '6px' }}>
                            {([['PENDING', t('pending')], ['IN_PROGRESS', t('in_progress')], ['COMPLETED', t('completed')]] as const).map(([code, label]) => (
                                <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '9px', color: '#555' }}>
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor(code), display: 'inline-block' }} />
                                    {label}
                                </span>
                            ))}
                        </div>
                    </div>
                </ShellWindow>

                {/* Warehouse distribution */}
                <ShellWindow fill={false} style={{ width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                    <ShellTitleBar tone="grey" icon="bi-building" title={t('warehouse_distribution')} />
                    <div style={{ padding: '6px 8px', background: '#f0efe8', flex: 1, overflowY: 'auto', minHeight: 0 }}>
                        {groupedStats.length === 0 ? (
                            <XPEmptyState icon="bi-building" message={t('no_inventory_recorded')} />
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
