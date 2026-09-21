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

// Alert rows signal the same five semantic families as every status chip — map
// through STATUS_FAMILY's palette instead of a local hex table.
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

// `locations`, `stockBalance`, `stockEntries`, `samples` and `salesOrders` are
// gone from the signature: every figure now comes from the three /dashboard
// endpoints, so the page no longer needs whole domain arrays to add up its own.
export default function DashboardView({ items, workOrders, kpis, summary, outlook, itemIndex, kpiHistory, loading }: any) {
    const { t } = useLanguage();
    const { formatCustom: tzFmt } = useTimezone();
    const router = useRouter();

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
        openOrders:    outlook?.open_count   ?? kpis?.open_sos ?? 0,
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

    // Every sales figure on this page reads from /dashboard/delivery-outlook and
    // nowhere else. /summary computes its own ready/short counts off raw stock
    // availability (still used by the mobile dashboard and the section homes), and
    // showing both would put two different "at risk" numbers on one screen.
    // An absent `outlook` means the role has no sales permission — the panel and
    // its tiles drop out rather than render zeros.
    const outlookRows: any[] = outlook?.rows || [];
    const seesStock = Array.isArray(summary?.low_stock_items);
    const seesSales = !!outlook;
    const openSOsCount: number = outlook?.open_count ?? 0;
    const readySOCount: number = outlook?.ready_count ?? 0;
    const lateSOCount: number = outlook?.late_count ?? 0;
    const shortSOCount: number = outlook?.at_risk_count ?? 0;
    const deliveryReadiness = openSOsCount > 0 ? (readySOCount / openSOsCount) * 100 : 100;

    // namedLowStock: [{id, name, code, totalStock}]
    const namedLowStock: any[] = hasSummary
        ? (summary.low_stock_items || []).map((l: any) => ({ id: l.item_id, name: l.item_name, code: l.item_code, totalStock: l.total_qty, minLevel: l.min_level }))
        : [];
    const outCount = namedLowStock.filter((i: any) => i.totalStock <= 0).length;

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
        outlookRows.filter((r: any) => r.late).slice(0, 3).forEach((r: any) => {
            list.push({
                sev: 'crit', title: `${r.code} — Late`, sub: `${r.customer} · due ${r.due_date?.slice(0, 10) || '?'} · ${r.pct.toFixed(0)}% shippable`,
                detail: `Sales order ${r.code} for ${r.customer} was due ${r.due_date?.slice(0, 10) || '?'} and only ${r.pct.toFixed(0)}% of it is packed or already dispatched. Chase the production orders behind it, or agree a new date with the customer.`,
            });
        });
        outlookRows.filter((r: any) => !r.late && r.short_lines > 0).slice(0, 2).forEach((r: any) => {
            list.push({
                sev: 'warn', title: `${r.code} — Material Gap`, sub: `${r.short_lines} of ${r.line_count} lines short · ${r.customer}`,
                detail: `Sales order ${r.code} has ${r.short_lines} of ${r.line_count} line(s) with less produced than ordered. Those lines cannot be packed until production catches up.`,
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
    }, [summary, outlook, overdueWOs, metrics.lowStock, metrics.pendingWO]);

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
    const outlookBodyRef = useRef<HTMLTableSectionElement>(null);
    const outlookSkel = useTableSkeletonMetrics('dashboard-outlook', outlookBodyRef, false);

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

    const kpiTiles: { key: string; value: React.ReactNode; label: string; tone?: StatusFamily; frame?: boolean }[] = [
        ...(seesSales ? [
            { key: 'late', value: lateSOCount, label: t('late_orders'), tone: 'red' as StatusFamily, frame: lateSOCount > 0 },
            { key: 'risk', value: shortSOCount, label: t('at_risk'), tone: 'amber' as StatusFamily, frame: shortSOCount > 0 },
            { key: 'ready', value: readySOCount, label: t('ready_to_ship'), tone: 'green' as StatusFamily },
            { key: 'open', value: openSOsCount, label: t('open_orders') },
        ] : []),
        ...(kpis?.active_wo !== undefined ? [
            { key: 'active_wo', value: metrics.activeWO, label: t('active_wo'), tone: (overdueWOs.length > 0 ? 'amber' : undefined) as StatusFamily | undefined, frame: overdueWOs.length > 0 },
            { key: 'pending_wo', value: metrics.pendingWO, label: t('pending_wo') },
        ] : []),
        ...(kpis?.low_stock !== undefined ? [
            { key: 'low_stock', value: metrics.lowStock, label: t('low_stock'), tone: (outCount > 0 ? 'red' : metrics.lowStock > 0 ? 'amber' : 'green') as StatusFamily, frame: metrics.lowStock > 0 },
        ] : []),
    ];

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

            {/* ── Row 1: the six numbers somebody acts on ──
                Total SKUs and sample count used to sit here; neither changes what
                anyone does that morning. A tile is dropped, not zeroed, when the
                role can't see its domain — /dashboard/kpis omits those keys, so an
                undefined value IS the permission answer. */}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${kpiTiles.length}, 1fr)`, gap: '4px', marginBottom: '6px' }}>
                {kpiTiles.map(tile => (
                    <KpiTile key={tile.key} value={tile.value} label={tile.label} tone={tile.tone} frame={tile.frame} />
                ))}
            </div>

            {/* ── Row 2: what is owed (left) + what to chase (right) ── */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', height: '250px' }}>

                {/* Delivery outlook — the question the page exists to answer: what is owed,
                    when, and how much of it can actually leave the building. Progress is
                    packed + dispatched cartons, the same quantity an order's READY status
                    is gated on, so the bar and the chip can never disagree. */}
                {seesSales && (
                <ShellWindow fill={false} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <ShellTitleBar
                        tone="blue"
                        icon="bi-truck"
                        title={t('delivery_outlook')}
                        right={<span style={{ fontSize: '10px', fontWeight: 'normal' }}>
                            {lateSOCount} {t('late_orders').toLowerCase()} · {shortSOCount} {t('at_risk').toLowerCase()} · {readySOCount} {t('ready_to_ship').toLowerCase()}
                        </span>}
                    />
                    <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                        <table style={xpTable}>
                            <thead>
                                <tr>
                                    <th style={lvThSticky({ width: '110px' })}>{t('code')}</th>
                                    <th style={lvThSticky()}>{t('customer')}</th>
                                    <th style={lvThSticky({ width: '75px' })}>{t('due_date')}</th>
                                    <th style={lvThSticky({ width: '130px' })}>{t('shippable')}</th>
                                    <th style={lvThSticky({ width: '75px', borderRight: 'none' })}>{t('status')}</th>
                                </tr>
                            </thead>
                            <tbody ref={outlookBodyRef}>
                                {outlookRows.map((r: any, idx: number) => (
                                    <tr key={r.id} style={lvRow(idx)}>
                                        <td style={lvTd()}><CodeChip code={r.code} /></td>
                                        <td style={{ ...lvTd(), fontWeight: 'bold', color: '#000' }}>{r.customer}</td>
                                        <td style={{
                                            ...lvTd(), fontSize: '9px',
                                            color: r.late ? familyColor('red') : '#333',
                                            fontWeight: r.late ? 'bold' : 'normal',
                                        }}>
                                            {r.due_date ? r.due_date.slice(0, 10) : '—'}
                                        </td>
                                        <td style={lvTd()}>
                                            <ProgressBar
                                                pct={r.pct}
                                                tone={r.late ? 'red' : r.pct >= 100 ? 'green' : r.short_lines > 0 ? 'amber' : 'blue'}
                                                height={9}
                                                label="outside"
                                                title={`${r.shippable_qty.toLocaleString()} of ${r.ordered_qty.toLocaleString()} shippable · ${r.produced_pct.toFixed(0)}% produced`}
                                            />
                                        </td>
                                        <td style={{ ...lvTd(), borderRight: 'none' }}>
                                            <StatusChip status={r.late ? 'LATE' : r.short_lines > 0 ? 'SHORT' : r.status} tint />
                                        </td>
                                    </tr>
                                ))}
                                {outlookRows.length === 0 && (loading
                                    ? <TableSkeleton rows={5} cols={outlookSkel.cols ?? 5} tdStyle={lvTd()} rowHeight={outlookSkel.rowHeight} fillHeight={outlookSkel.fillHeight} />
                                    : <TableEmpty colSpan={5} icon="bi-truck" message={t('no_open_orders')} tdStyle={lvTd()} />
                                )}
                            </tbody>
                        </table>
                    </div>
                    <XPStatusBar
                        style={{ marginTop: 0 }}
                        right={<>{t('delivery_readiness')}: {deliveryReadiness.toFixed(1)}%</>}
                    >
                        {openSOsCount} {t('open_orders').toLowerCase()}
                    </XPStatusBar>
                </ShellWindow>
                )}

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
            </div>

            {/* ── Row 3: production in flight + its calendar + the stock that blocks it ── */}
            <div style={{ display: 'flex', gap: '6px', height: '280px' }}>

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

                {/* Stock risk — the items that stop orders, where warehouse distribution
                    used to sit. A share-of-stock-per-bin chart answered a question nobody
                    asked on a landing page; Stock On-Hand still has it. */}
                {seesStock && (
                <ShellWindow fill={false} style={{ width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                    <ShellTitleBar tone="amber" icon="bi-box-seam" title={t('stock_risk')} />
                    <div style={{ padding: '6px 8px', background: '#f0efe8', flex: 1, overflowY: 'auto', minHeight: 0 }}>
                        {namedLowStock.length === 0 ? (
                            <XPEmptyState icon="bi-check-circle" message={t('no_low_stock')} />
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {namedLowStock.map((i: any) => {
                                    const out = i.totalStock <= 0;
                                    const pct = i.minLevel > 0 ? Math.min(100, (i.totalStock / i.minLevel) * 100) : 0;
                                    return (
                                        <div key={i.id}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px', gap: 6 }}>
                                                <span style={{ fontWeight: 'bold', color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
                                                <span style={{ color: familyColor(out ? 'red' : 'amber'), fontWeight: 'bold', flexShrink: 0 }}>
                                                    {out ? t('out_of_stock') : i.totalStock.toLocaleString()}
                                                </span>
                                            </div>
                                            <ProgressBar pct={pct} tone={out ? 'red' : 'amber'} height={7} title={`${i.totalStock.toLocaleString()} on hand · reorder at ${i.minLevel.toLocaleString()}`} />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <XPStatusBar style={{ marginTop: 0 }}>
                        {outCount} {t('out_of_stock')} · {metrics.lowStock} {t('below_reorder')}
                    </XPStatusBar>
                </ShellWindow>
                )}
            </div>

            {/* ── Row 4: KPI trends ── */}
            <ShellWindow fill={false} style={{ marginTop: '6px' }}>
                <ShellTitleBar tone="grey" icon="bi-graph-up" title={t('kpi_trends')} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '6px', padding: '8px', background: '#f0efe8' }}>
                    {TREND_METRICS.filter(m => kpiHistory?.[m.key] || kpis?.[m.key] !== undefined).map((m) => {
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
