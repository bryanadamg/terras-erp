import { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import CalendarView from './CalendarView';

// ── XP style helpers ─────────────────────────────────────────────────────────
const xpBevel = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    border: '2px solid',
    borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    boxShadow: '2px 2px 4px rgba(0,0,0,0.25)',
    background: '#ece9d8',
    ...extra,
});

const xpTitleBar = (variant: 'blue' | 'red' | 'amber' | 'green' | 'grey'): React.CSSProperties => {
    const gradients: Record<string, string> = {
        blue:  'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)',
        red:   'linear-gradient(to right, #990000 0%, #cc2222 100%)',
        amber: 'linear-gradient(to right, #c07000 0%, #e09830 100%)',
        green: 'linear-gradient(to right, #1a7a1a 0%, #2ea42e 100%)',
        grey:  'linear-gradient(to bottom, #6a6a6a, #4a4a4a)',
    };
    const borders: Record<string, string> = {
        blue: '#003080', red: '#550000', amber: '#804000', green: '#0a4a0a', grey: '#222',
    };
    return {
        background: gradients[variant],
        color: '#ffffff',
        fontFamily: 'Tahoma, Arial, sans-serif',
        fontWeight: 'bold',
        fontSize: '12px',
        padding: '3px 8px',
        borderBottom: `1px solid ${borders[variant]}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: '24px',
        textShadow: '1px 1px 1px rgba(0,0,0,0.4)',
    };
};

const xpProgTrack: React.CSSProperties = {
    height: '10px',
    background: '#ffffff',
    border: '1px solid',
    borderColor: '#808080 #dfdfdf #dfdfdf #808080',
    boxShadow: 'inset 1px 1px 2px rgba(0,0,0,0.15)',
};

const xpProgFill = (color: 'blue' | 'green' | 'orange' | 'red'): React.CSSProperties => {
    const bg: Record<string, string> = {
        blue:   'linear-gradient(to bottom, #4fa4ff, #0058e6)',
        green:  'linear-gradient(to bottom, #6ec86e, #2a7a2a)',
        orange: 'linear-gradient(to bottom, #ffbb44, #cc7700)',
        red:    'linear-gradient(to bottom, #ff6666, #cc0000)',
    };
    return { height: '100%', background: bg[color] };
};

const xpTable: React.CSSProperties = {
    width: '100%', borderCollapse: 'collapse',
    fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '10px',
    background: '#ffffff',
};

const xpTh: React.CSSProperties = {
    background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)',
    borderBottom: '2px solid #808080',
    borderRight: '1px solid #b0aaa0',
    padding: '3px 6px', fontWeight: 'bold', color: '#000', textAlign: 'left',
};

const xpTd = (isEven: boolean): React.CSSProperties => ({
    padding: '3px 6px',
    borderBottom: '1px solid #d8d5ce',
    borderRight: '1px solid #e0ddd4',
    background: isEven ? '#f5f3ee' : '#ffffff',
    verticalAlign: 'middle',
});

const xpStatusBar: React.CSSProperties = {
    background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)',
    borderTop: '1px solid #b0a898',
    padding: '2px 8px',
    fontFamily: 'Tahoma, Arial, sans-serif',
    fontSize: '10px',
    color: '#333',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
};

type HealthStatus = 'ok' | 'warn' | 'crit';

const healthBorder: Record<HealthStatus, string> = {
    ok:   '2px solid #2e7d32',
    warn: '2px solid #c77800',
    crit: '2px solid #b71c1c',
};
const healthBg: Record<HealthStatus, string> = {
    ok: '#e8f5e9', warn: '#fff8e1', crit: '#ffebee',
};
const healthTitleBg: Record<HealthStatus, string> = {
    ok: 'rgba(46,125,50,0.08)', warn: 'rgba(199,120,0,0.08)', crit: 'rgba(183,27,27,0.08)',
};
const healthTitleColor: Record<HealthStatus, string> = {
    ok: '#1b4620', warn: '#5a3500', crit: '#7f0000',
};
const healthDot: Record<HealthStatus, string> = {
    ok: '#2e7d32', warn: '#c77800', crit: '#b71c1c',
};
const healthNumColor: Record<HealthStatus, string> = {
    ok: '#2e7d32', warn: '#c77800', crit: '#b71c1c',
};

const StatusBadge = ({ status }: { status: string }) => {
    const cfg: Record<string, { bg: string; border: string; color: string; label: string }> = {
        IN_PROGRESS: { bg: '#fff3cd', border: '#cc9900', color: '#664d00', label: 'IN PROG' },
        PENDING:     { bg: '#e8e8e8', border: '#888',    color: '#333',    label: 'PENDING' },
        COMPLETED:   { bg: '#d4edda', border: '#28a745', color: '#155724', label: 'DONE'    },
        OVERDUE:     { bg: '#ffcccc', border: '#cc0000', color: '#660000', label: 'OVERDUE' },
    };
    const c = cfg[status] || cfg.PENDING;
    return (
        <span style={{
            fontSize: '8px', fontWeight: 'bold', padding: '1px 5px',
            border: `1px solid ${c.border}`, background: c.bg, color: c.color,
            fontFamily: 'Tahoma, Arial, sans-serif', whiteSpace: 'nowrap',
        }}>
            {c.label}
        </span>
    );
};

export default function DashboardView({ items, locations, stockBalance, workOrders, stockEntries, samples, salesOrders, kpis }: any) {
    const { t } = useLanguage();
    const { uiStyle: currentStyle } = useTheme();
    const classic = currentStyle === 'classic';

    // ── Metrics ──────────────────────────────────────────────────────────────
    const metrics = {
        totalItems:    kpis?.total_items    ?? items.length,
        lowStock:      kpis?.low_stock      ?? 0,
        activeWO:      kpis?.active_wo      ?? 0,
        pendingWO:     kpis?.pending_wo     ?? 0,
        activeSamples: kpis?.active_samples ?? 0,
        openOrders:    kpis?.open_sos       ?? (salesOrders || []).filter((s: any) => s.status === 'PENDING').length,
    };

    // ── Production Yield ─────────────────────────────────────────────────────
    const yieldOrders = (workOrders || []).filter((w: any) => ['COMPLETED', 'IN_PROGRESS'].includes(w.status));
    const completedQty = yieldOrders.filter((w: any) => w.status === 'COMPLETED').reduce((s: number, w: any) => s + parseFloat(w.qty), 0);
    const totalStartedQty = yieldOrders.reduce((s: number, w: any) => s + parseFloat(w.qty), 0);
    const prodYield = totalStartedQty > 0 ? (completedQty / totalStartedQty) * 100 : 100;

    // ── Delivery Readiness ───────────────────────────────────────────────────
    const openSOs = (salesOrders || []).filter((s: any) => s.status === 'PENDING');
    let readySOCount = 0;
    openSOs.forEach((so: any) => {
        const allAvail = (so.lines || []).every((line: any) => {
            const inStock = (stockBalance || [])
                .filter((b: any) => String(b.item_id) === String(line.item_id))
                .reduce((s: number, b: any) => s + parseFloat(b.qty), 0);
            return inStock >= line.qty;
        });
        if (allAvail && (so.lines || []).length > 0) readySOCount++;
    });
    const deliveryReadiness = openSOs.length > 0 ? (readySOCount / openSOs.length) * 100 : 100;

    // ── Named low-stock items ────────────────────────────────────────────────
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

    // ── Overdue WOs ──────────────────────────────────────────────────────────
    const today = new Date();
    const overdueWOs = (workOrders || []).filter((w: any) =>
        ['IN_PROGRESS', 'PENDING'].includes(w.status) &&
        w.target_end_date && new Date(w.target_end_date) < today
    );

    // ── SOs with material shortages ──────────────────────────────────────────
    const shortSOs = openSOs.filter((so: any) => {
        if (!(so.lines || []).length) return false;
        return (so.lines || []).some((line: any) => {
            const inStock = (stockBalance || [])
                .filter((b: any) => String(b.item_id) === String(line.item_id))
                .reduce((s: number, b: any) => s + parseFloat(b.qty), 0);
            return inStock < line.qty;
        });
    });

    // ── Action items list ────────────────────────────────────────────────────
    const actionItems = useMemo(() => {
        const list: { sev: 'crit' | 'warn' | 'info'; title: string; sub: string }[] = [];
        namedLowStock.forEach(i => {
            list.push({ sev: 'crit', title: `${i.name} — OUT`, sub: `Total stock: ${i.totalStock} units` });
        });
        if (metrics.lowStock > namedLowStock.length) {
            list.push({ sev: 'crit', title: `${metrics.lowStock - namedLowStock.length} more items low`, sub: 'Check inventory for details' });
        }
        overdueWOs.slice(0, 3).forEach((w: any) => {
            const name = (items || []).find((i: any) => i.id === w.item_id)?.name || w.item_id;
            list.push({ sev: 'warn', title: `${w.code} — Overdue`, sub: `${name} · due ${w.target_end_date?.slice(0,10) || '?'}` });
        });
        shortSOs.slice(0, 2).forEach((so: any) => {
            const shortLines = (so.lines || []).filter((line: any) => {
                const inStock = (stockBalance || [])
                    .filter((b: any) => String(b.item_id) === String(line.item_id))
                    .reduce((s: number, b: any) => s + parseFloat(b.qty), 0);
                return inStock < line.qty;
            }).length;
            list.push({ sev: 'warn', title: `${so.code} — Material Gap`, sub: `${shortLines} of ${so.lines.length} lines unfulfilled` });
        });
        const pendingReady = (workOrders || []).filter((w: any) => w.status === 'PENDING').length;
        if (pendingReady > 0) {
            list.push({ sev: 'info', title: `${pendingReady} WO${pendingReady > 1 ? 's' : ''} ready to release`, sub: 'Review and start production' });
        }
        return list;
    }, [namedLowStock, overdueWOs, shortSOs, workOrders, metrics.lowStock]);

    // ── Health statuses ──────────────────────────────────────────────────────
    const stockHealth: HealthStatus  = namedLowStock.length > 0 ? 'crit' : metrics.lowStock > 0 ? 'warn' : 'ok';
    const prodHealth: HealthStatus   = overdueWOs.length > 0 ? 'warn' : metrics.activeWO > 0 ? 'ok' : 'ok';
    const orderHealth: HealthStatus  = deliveryReadiness < 50 ? 'crit' : deliveryReadiness < 80 ? 'warn' : 'ok';

    // ── Active WOs for table ─────────────────────────────────────────────────
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
            .slice(0, 8);
    }, [workOrders, items]);

    // ── Recent activity ──────────────────────────────────────────────────────
    const recentActivity = [...(stockEntries || [])]
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5)
        .map((e: any) => ({
            ...e,
            itemName: (items || []).find((i: any) => i.id === e.item_id)?.name || e.item_id,
        }));

    // ── Location stats ────────────────────────────────────────────────────────
    const locationStats = (locations || []).map((loc: any) => {
        const totalQty = (stockBalance || [])
            .filter((b: any) => String(b.location_id) === String(loc.id))
            .reduce((s: number, b: any) => s + parseFloat(b.qty), 0);
        return { ...loc, totalQty };
    }).filter((l: any) => l.totalQty > 0).sort((a: any, b: any) => b.totalQty - a.totalQty);
    const totalStockQty = locationStats.reduce((s: number, l: any) => s + l.totalQty, 0);

    const getItemName = (id: string) => (items || []).find((i: any) => i.id === id)?.name || id;

    // ────────────────────────────────────────────────────────────────────────
    // DEFAULT (non-classic) layout — unchanged from original
    // ────────────────────────────────────────────────────────────────────────
    if (!classic) {
        const KPICard = ({ title, value, subtext, icon, colorClass }: any) => (
            <div className="col-md-4 col-lg-2">
                <div className={`card h-100 border-0 shadow-sm ${colorClass} text-white`}>
                    <div className="card-body p-3">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                            <h6 className="card-title mb-0 opacity-75 small text-uppercase fw-bold text-white">{title}</h6>
                            <i className={`bi ${icon} fs-4 opacity-50`}></i>
                        </div>
                        <h3 className="fw-bold mb-0">{value}</h3>
                        <small className="opacity-75" style={{fontSize: '0.75rem'}}>{subtext}</small>
                    </div>
                </div>
            </div>
        );
        return (
            <div className="fade-in">
                <div className="d-flex justify-content-between align-items-center mb-3">
                    <h4 className="fw-bold mb-0 text-capitalize">{t('dashboard') || 'Dashboard'}</h4>
                    <span className="text-muted small">{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
                <div className="card border-0 shadow-sm mb-4 bg-dark text-white overflow-hidden">
                    <div className="card-body p-2 px-3">
                        <div className="row align-items-center g-3">
                            <div className="col-auto border-end border-secondary pe-3">
                                <div className="d-flex align-items-center gap-2">
                                    <i className="bi bi-cpu-fill text-info"></i>
                                    <span className="extra-small fw-bold text-uppercase letter-spacing-1">Smart Advisor</span>
                                </div>
                            </div>
                            <div className="col">
                                <div className="d-flex gap-4 overflow-auto no-scrollbar py-1">
                                    {metrics.lowStock > 0 && (
                                        <div className="d-flex align-items-center gap-2 extra-small text-nowrap">
                                            <i className="bi bi-info-circle-fill text-warning"></i>
                                            <span><strong>{metrics.lowStock} Items</strong> require replenishment.</span>
                                        </div>
                                    )}
                                    {metrics.pendingWO > 0 && (
                                        <div className="d-flex align-items-center gap-2 extra-small text-nowrap">
                                            <i className="bi bi-gear-fill text-info"></i>
                                            <span><strong>{metrics.pendingWO} WOs</strong> are ready for release.</span>
                                        </div>
                                    )}
                                    {deliveryReadiness < 100 && openSOs.length > 0 && (
                                        <div className="d-flex align-items-center gap-2 extra-small text-nowrap">
                                            <i className="bi bi-truck text-secondary"></i>
                                            <span>Material shortages affecting <strong>{Math.round(100 - deliveryReadiness)}%</strong> of orders.</span>
                                        </div>
                                    )}
                                    {metrics.lowStock === 0 && metrics.pendingWO === 0 && (
                                        <div className="extra-small text-muted italic">System state is currently balanced.</div>
                                    )}
                                </div>
                            </div>
                            <div className="col-auto ms-auto border-start border-secondary ps-3">
                                <div className="d-flex gap-4">
                                    <div className="text-center">
                                        <div className="extra-small text-muted fw-bold uppercase" style={{fontSize: '0.6rem'}}>Production Yield</div>
                                        <div className={`fw-bold small ${prodYield > 90 ? 'text-success' : 'text-warning'}`}>{prodYield.toFixed(1)}%</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="extra-small text-muted fw-bold uppercase" style={{fontSize: '0.6rem'}}>Delivery Ready</div>
                                        <div className={`fw-bold small ${deliveryReadiness > 80 ? 'text-success' : 'text-warning'}`}>{deliveryReadiness.toFixed(1)}%</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="row g-3 mb-4">
                    <KPICard title={t('item_inventory')} value={metrics.totalItems} subtext="Total SKUs" icon="bi-box-seam" colorClass="bg-primary" />
                    <KPICard title="Low Stock" value={metrics.lowStock} subtext="Global Alert" icon="bi-exclamation-triangle" colorClass="bg-warning text-dark" />
                    <KPICard title="Active WO" value={metrics.activeWO} subtext="Production" icon="bi-gear-wide-connected" colorClass="bg-success" />
                    <KPICard title="Pending WO" value={metrics.pendingWO} subtext="In Queue" icon="bi-clock-history" colorClass="bg-info" />
                    <KPICard title="Samples" value={metrics.activeSamples} subtext="In Development" icon="bi-eyedropper" colorClass="bg-secondary" />
                    <KPICard title="Open Orders" value={metrics.openOrders} subtext="Sales Pipeline" icon="bi-receipt" colorClass="bg-dark" />
                </div>
                <div className="row g-4 mb-4">
                    <div className="col-md-4">
                        <div className="card h-100 shadow-sm border-0">
                            <div className="card-header bg-white"><h5 className="card-title mb-0">Warehouse Distribution</h5></div>
                            <div className="card-body">
                                <div className="d-flex flex-column gap-4">
                                    {locationStats.map((loc: any, idx: number) => {
                                        const pct = totalStockQty > 0 ? (loc.totalQty / totalStockQty) * 100 : 0;
                                        const colors = ['bg-primary', 'bg-success', 'bg-info', 'bg-warning', 'bg-danger'];
                                        return (
                                            <div key={loc.id}>
                                                <div className="d-flex justify-content-between mb-1">
                                                    <span className="fw-bold text-dark">{loc.name}</span>
                                                    <span className="small text-muted">{loc.totalQty.toLocaleString()} units</span>
                                                </div>
                                                <div className="progress shadow-sm" style={{height: '10px'}}>
                                                    <div className={`progress-bar ${colors[idx % colors.length]}`} style={{width: `${pct}%`}}></div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {locationStats.length === 0 && <div className="text-center py-5"><i className="bi bi-pie-chart text-muted opacity-25 display-1"></i><p className="text-muted small mt-2">No inventory recorded.</p></div>}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="col-md-4">
                        <div className="card h-100 shadow-sm border-0">
                            <div className="card-header bg-white"><h5 className="card-title mb-0">Production Deadlines</h5></div>
                            <div className="card-body">
                                <CalendarView workOrders={workOrders} items={items} compact={true} />
                                <div className="mt-3 d-flex flex-wrap gap-2 justify-content-center">
                                    <small className="text-muted d-flex align-items-center"><span className="bg-primary rounded-circle me-1" style={{width: 6, height: 6, display: 'inline-block'}}></span> Pending</small>
                                    <small className="text-muted d-flex align-items-center"><span className="bg-warning rounded-circle me-1" style={{width: 6, height: 6, display: 'inline-block'}}></span> Active</small>
                                    <small className="text-muted d-flex align-items-center"><span className="bg-success rounded-circle me-1" style={{width: 6, height: 6, display: 'inline-block'}}></span> Done</small>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="col-md-4">
                        <div className="card h-100 shadow-sm border-0">
                            <div className="card-header bg-white"><h5 className="card-title mb-0">Recent Activity</h5></div>
                            <div className="card-body p-0">
                                <ul className="list-group list-group-flush">
                                    {recentActivity.map((entry: any) => (
                                        <li key={entry.id} className="list-group-item d-flex justify-content-between align-items-center py-2 border-0 border-bottom">
                                            <div style={{minWidth: 0}}>
                                                <div className="fw-medium text-truncate small">{entry.itemName}</div>
                                                <small className="text-muted d-block font-monospace" style={{fontSize: '0.65rem'}}>{new Date(entry.created_at).toLocaleString()}</small>
                                            </div>
                                            <div className={`fw-bold ms-2 small ${entry.qty_change > 0 ? 'text-success' : 'text-danger'}`}>
                                                {entry.qty_change > 0 ? '+' : ''}{entry.qty_change}
                                            </div>
                                        </li>
                                    ))}
                                    {recentActivity.length === 0 && <li className="list-group-item text-center py-5 text-muted small">No recent movements</li>}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="row">
                    <div className="col-12">
                        <div className="card shadow-sm border-0">
                            <div className="card-header bg-white"><h5 className="card-title mb-0">Manufacturing Monitoring</h5></div>
                            <div className="card-body p-0">
                                <div className="table-responsive">
                                    <table className="table table-hover align-middle mb-0 small">
                                        <thead className="table-light">
                                            <tr><th className="ps-3">Code</th><th>Product</th><th>Status</th><th>Progress</th><th className="text-end pe-3">Target</th></tr>
                                        </thead>
                                        <tbody>
                                            {activeWOList.map((wo: any) => (
                                                <tr key={wo.id}>
                                                    <td className="ps-3 font-monospace fw-bold">{wo.code}</td>
                                                    <td>{wo.itemName}</td>
                                                    <td><span className={`badge ${wo.status === 'IN_PROGRESS' ? 'bg-warning text-dark' : 'bg-secondary'} extra-small`}>{wo.status}</span></td>
                                                    <td><div className="progress" style={{height: '6px', width: '120px'}}><div className={`progress-bar ${wo.status === 'IN_PROGRESS' ? 'bg-warning' : 'bg-secondary'}`} style={{width: wo.status === 'IN_PROGRESS' ? '60%' : '0%'}}></div></div></td>
                                                    <td className="text-end pe-3 fw-bold">{wo.qty?.toLocaleString()}</td>
                                                </tr>
                                            ))}
                                            {activeWOList.length === 0 && <tr><td colSpan={5} className="text-center py-4 text-muted">No active production runs</td></tr>}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
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

    const alertRowStyle = (sev: string): React.CSSProperties => ({
        padding: '4px 8px',
        borderBottom: '1px solid #ddd',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '6px',
        background: sev === 'crit' ? '#fff0f0' : sev === 'warn' ? '#fffde8' : '#f0fff0',
        borderLeft: `3px solid ${sev === 'crit' ? '#cc0000' : sev === 'warn' ? '#cc9900' : '#228822'}`,
    });

    const HealthPanel = ({ status, title, bigNum, bigLabel, lines, prog, progColor, progLabel }: any) => (
        <div style={{ border: healthBorder[status as HealthStatus], background: healthBg[status as HealthStatus], flex: 1, minWidth: 0 }}>
            <div style={{
                fontFamily: 'Tahoma, Arial, sans-serif', fontWeight: 'bold', fontSize: '11px',
                padding: '3px 8px', borderBottom: '1px solid rgba(0,0,0,0.1)',
                display: 'flex', alignItems: 'center', gap: '5px',
                background: healthTitleBg[status as HealthStatus],
                color: healthTitleColor[status as HealthStatus],
            }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: healthDot[status as HealthStatus], border: '1px solid rgba(0,0,0,0.3)', flexShrink: 0 }}></div>
                {title}
            </div>
            <div style={{ padding: '6px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '26px', fontWeight: 'bold', fontFamily: "'Courier New', monospace", color: healthNumColor[status as HealthStatus], lineHeight: 1 }}>
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
                        <div style={xpProgTrack}>
                            <div style={{ ...xpProgFill(progColor), width: `${Math.min(100, prog)}%` }}></div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    const kpiTileStyle = (highlight?: 'crit' | 'warn'): React.CSSProperties => ({
        border: '2px solid',
        borderColor: highlight === 'crit' ? '#ffaaaa #cc0000 #cc0000 #ffaaaa'
                   : highlight === 'warn' ? '#ffe088 #c77800 #c77800 #ffe088'
                   : '#dfdfdf #808080 #808080 #dfdfdf',
        textAlign: 'center',
        padding: '5px 4px',
        background: highlight === 'crit' ? '#ffecec' : highlight === 'warn' ? '#fffae8' : '#f5f4ef',
    });

    return (
        <div className="fade-in" style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', background: '#ece9d8', padding: '4px' }}>

            {/* ── Top bar: date + title ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', padding: '0 2px' }}>
                <span style={{ fontWeight: 'bold', fontSize: '13px', color: '#00309c' }}>
                    📊 {t('dashboard') || 'Dashboard'}
                </span>
                <span style={{ fontSize: '10px', color: '#555' }}>
                    {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
            </div>

            {/* ── Row 1: 3 Health Panels ── */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <HealthPanel
                    status={stockHealth}
                    title="Stock Health"
                    bigNum={namedLowStock.length > 0 ? namedLowStock.length : metrics.totalItems}
                    bigLabel={namedLowStock.length > 0 ? `item${namedLowStock.length > 1 ? 's' : ''} at critical level` : 'SKUs in inventory'}
                    lines={namedLowStock.length > 0
                        ? namedLowStock.slice(0, 2).map((i: any) => ({ text: `${i.name} — ${i.totalStock} units`, color: '#880000', icon: '●' }))
                          .concat(metrics.totalItems ? [{ text: `${metrics.totalItems} total SKUs across ${(locations||[]).length} locations`, color: '#555', icon: '' }] : [])
                        : [
                            { text: `${metrics.totalItems} total SKUs tracked`, color: '#228822', icon: '✓' },
                            { text: `${(locations||[]).length} warehouse location${(locations||[]).length !== 1 ? 's' : ''}`, color: '#555', icon: '' },
                          ]
                    }
                />
                <HealthPanel
                    status={prodHealth}
                    title="Production Health"
                    bigNum={metrics.activeWO}
                    bigLabel="active work orders"
                    lines={[
                        overdueWOs.length > 0
                            ? { text: `${overdueWOs[0].code} overdue (${overdueWOs[0].target_end_date?.slice(0,10) || '?'})`, color: '#aa6600', icon: '●' }
                            : { text: 'No overdue work orders', color: '#228822', icon: '✓' },
                        { text: `${metrics.pendingWO} WO${metrics.pendingWO !== 1 ? 's' : ''} pending release`, color: '#555', icon: '' },
                    ]}
                    prog={prodYield}
                    progColor={prodYield > 90 ? 'green' : 'orange'}
                    progLabel="Production Yield"
                />
                <HealthPanel
                    status={orderHealth}
                    title="Order Health"
                    bigNum={metrics.openOrders}
                    bigLabel="open sales orders"
                    lines={[
                        readySOCount > 0
                            ? { text: `${readySOCount} order${readySOCount > 1 ? 's' : ''} fully fulfillable`, color: '#228822', icon: '✓' }
                            : { text: 'No orders fully fulfillable', color: '#aa6600', icon: '⚠' },
                        shortSOs.length > 0
                            ? { text: `${shortSOs.length} order${shortSOs.length > 1 ? 's' : ''} have material shortages`, color: '#aa6600', icon: '⚠' }
                            : { text: 'No material shortages', color: '#228822', icon: '✓' },
                    ]}
                    prog={deliveryReadiness}
                    progColor={deliveryReadiness > 80 ? 'green' : deliveryReadiness > 50 ? 'orange' : 'red'}
                    progLabel="Delivery Readiness"
                />
            </div>

            {/* ── Row 2: KPI strip ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '4px', marginBottom: '6px' }}>
                <div style={kpiTileStyle()}>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: "'Courier New', monospace", color: '#0058e6', lineHeight: 1.1 }}>{metrics.totalItems}</div>
                    <div style={{ fontSize: '8px', color: '#444', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>Total SKUs</div>
                </div>
                <div style={kpiTileStyle(namedLowStock.length > 0 ? 'crit' : metrics.lowStock > 0 ? 'warn' : undefined)}>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: "'Courier New', monospace", color: namedLowStock.length > 0 ? '#cc0000' : metrics.lowStock > 0 ? '#c77800' : '#228822', lineHeight: 1.1 }}>{metrics.lowStock}</div>
                    <div style={{ fontSize: '8px', color: '#444', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>Low Stock</div>
                </div>
                <div style={kpiTileStyle(overdueWOs.length > 0 ? 'warn' : undefined)}>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: "'Courier New', monospace", color: overdueWOs.length > 0 ? '#c77800' : '#333', lineHeight: 1.1 }}>{metrics.activeWO}</div>
                    <div style={{ fontSize: '8px', color: '#444', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>Active WO</div>
                </div>
                <div style={kpiTileStyle()}>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: "'Courier New', monospace", color: '#333', lineHeight: 1.1 }}>{metrics.pendingWO}</div>
                    <div style={{ fontSize: '8px', color: '#444', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>Pending WO</div>
                </div>
                <div style={kpiTileStyle()}>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: "'Courier New', monospace", color: '#333', lineHeight: 1.1 }}>{metrics.activeSamples}</div>
                    <div style={{ fontSize: '8px', color: '#444', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>Samples</div>
                </div>
                <div style={kpiTileStyle(shortSOs.length > 0 ? 'warn' : undefined)}>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: "'Courier New', monospace", color: shortSOs.length > 0 ? '#c77800' : '#333', lineHeight: 1.1 }}>{metrics.openOrders}</div>
                    <div style={{ fontSize: '8px', color: '#444', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>Open Orders</div>
                </div>
            </div>

            {/* ── Row 3: Action Items (left) + WO Table (right) ── */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>

                {/* Action Items pane */}
                <div style={{ ...xpBevel(), width: '260px', flexShrink: 0 }}>
                    <div style={xpTitleBar('red')}>
                        <span>📋 Action Items</span>
                        {(critCount > 0 || warnCount > 0) && (
                            <span style={{ fontSize: '10px', fontWeight: 'normal' }}>
                                {critCount > 0 && `${critCount} critical`}{critCount > 0 && warnCount > 0 && ' · '}{warnCount > 0 && `${warnCount} warnings`}
                            </span>
                        )}
                    </div>
                    <div>
                        {actionItems.length === 0 ? (
                            <div style={{ padding: '16px', textAlign: 'center', fontStyle: 'italic', color: '#666', fontSize: '10px', background: '#f0fff0', borderLeft: '3px solid #228822' }}>
                                🟢 All systems nominal
                            </div>
                        ) : (
                            actionItems.map((item, i) => (
                                <div key={i} style={alertRowStyle(item.sev)}>
                                    <span style={{ fontSize: '11px', marginTop: '1px', flexShrink: 0 }}>
                                        {item.sev === 'crit' ? '🔴' : item.sev === 'warn' ? '🟡' : '🟢'}
                                    </span>
                                    <div>
                                        <div style={{ fontWeight: 'bold', color: item.sev === 'crit' ? '#880000' : item.sev === 'warn' ? '#665500' : '#226622', fontSize: '10px' }}>
                                            {item.title}
                                        </div>
                                        <div style={{ fontSize: '9px', color: '#666' }}>{item.sub}</div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    <div style={xpStatusBar}>
                        <span>{critCount} critical · {warnCount} warnings · {actionItems.filter(a => a.sev === 'info').length} info</span>
                    </div>
                </div>

                {/* WO Table */}
                <div style={{ ...xpBevel(), flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <div style={xpTitleBar('amber')}>
                        <span>⚙ Work Order Monitoring</span>
                        <span style={{ fontSize: '10px', fontWeight: 'normal' }}>
                            {metrics.activeWO} active · {metrics.pendingWO} pending
                        </span>
                    </div>
                    <div style={{ overflowX: 'auto', flex: 1 }}>
                        <table style={xpTable}>
                            <thead>
                                <tr>
                                    <th style={{ ...xpTh, width: '100px' }}>Code</th>
                                    <th style={xpTh}>Product</th>
                                    <th style={{ ...xpTh, width: '65px' }}>Status</th>
                                    <th style={{ ...xpTh, width: '110px' }}>Progress</th>
                                    <th style={{ ...xpTh, width: '50px', textAlign: 'right' }}>Qty</th>
                                    <th style={{ ...xpTh, width: '75px', borderRight: 'none' }}>Due Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeWOList.map((wo: any, idx: number) => {
                                    const progColor: 'red' | 'orange' | 'blue' = wo.isOverdue ? 'red' : wo.status === 'IN_PROGRESS' ? 'blue' : 'orange';
                                    const progWidth = wo.status === 'IN_PROGRESS' ? 55 : 0;
                                    const displayStatus = wo.isOverdue ? 'OVERDUE' : wo.status;
                                    return (
                                        <tr key={wo.id}>
                                            <td style={{ ...xpTd(idx % 2 === 1), fontFamily: "'Courier New', monospace", fontWeight: 'bold', fontSize: '10px' }}>{wo.code}</td>
                                            <td style={{ ...xpTd(idx % 2 === 1), fontWeight: 'bold', color: '#000' }}>{wo.itemName}</td>
                                            <td style={xpTd(idx % 2 === 1)}><StatusBadge status={displayStatus} /></td>
                                            <td style={xpTd(idx % 2 === 1)}>
                                                <div style={xpProgTrack}>
                                                    <div style={{ ...xpProgFill(progColor), width: `${progWidth}%` }}></div>
                                                </div>
                                            </td>
                                            <td style={{ ...xpTd(idx % 2 === 1), textAlign: 'right', fontWeight: 'bold' }}>{wo.qty?.toLocaleString()}</td>
                                            <td style={{ ...xpTd(idx % 2 === 1), borderRight: 'none', color: wo.isOverdue ? '#cc0000' : '#333', fontWeight: wo.isOverdue ? 'bold' : 'normal', fontSize: '9px' }}>
                                                {wo.target_end_date ? `${wo.target_end_date.slice(0,10)}${wo.isOverdue ? ' ●' : ''}` : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {activeWOList.length === 0 && (
                                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '16px', color: '#666', fontStyle: 'italic', fontSize: '10px', background: '#fff' }}>No active production runs</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div style={xpStatusBar}>
                        <span>Production Yield: {prodYield.toFixed(1)}%</span>
                        <span>Delivery Readiness: {deliveryReadiness.toFixed(1)}%</span>
                    </div>
                </div>
            </div>

            {/* ── Row 4: Recent Movements (left) + Warehouse Distribution (right) ── */}
            <div style={{ display: 'flex', gap: '6px' }}>

                {/* Recent stock movements */}
                <div style={{ ...xpBevel(), flex: 1, minWidth: 0 }}>
                    <div style={xpTitleBar('grey')}>
                        <span>🕐 Recent Stock Movements</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={xpTable}>
                            <thead>
                                <tr>
                                    <th style={xpTh}>Item</th>
                                    <th style={{ ...xpTh, width: '60px', textAlign: 'right' }}>Change</th>
                                    <th style={{ ...xpTh, width: '110px' }}>Location</th>
                                    <th style={{ ...xpTh, width: '90px', borderRight: 'none' }}>When</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentActivity.map((entry: any, idx: number) => (
                                    <tr key={entry.id}>
                                        <td style={{ ...xpTd(idx % 2 === 1), fontWeight: 'bold', color: '#000' }}>{entry.itemName}</td>
                                        <td style={{ ...xpTd(idx % 2 === 1), textAlign: 'right', fontWeight: 'bold', color: entry.qty_change > 0 ? '#228822' : '#cc0000' }}>
                                            {entry.qty_change > 0 ? '+' : ''}{entry.qty_change}
                                        </td>
                                        <td style={{ ...xpTd(idx % 2 === 1), fontSize: '9px', color: '#444' }}>
                                            {(locations || []).find((l: any) => String(l.id) === String(entry.location_id))?.name || '—'}
                                        </td>
                                        <td style={{ ...xpTd(idx % 2 === 1), fontSize: '9px', color: '#666', borderRight: 'none' }}>
                                            {new Date(entry.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </td>
                                    </tr>
                                ))}
                                {recentActivity.length === 0 && (
                                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '12px', color: '#666', fontStyle: 'italic', fontSize: '10px', background: '#fff' }}>No recent movements</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Warehouse distribution */}
                <div style={{ ...xpBevel(), width: '240px', flexShrink: 0 }}>
                    <div style={xpTitleBar('grey')}>
                        <span>🏭 Warehouse Distribution</span>
                    </div>
                    <div style={{ padding: '6px 8px', background: '#f0efe8' }}>
                        {locationStats.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '12px', color: '#888', fontStyle: 'italic', fontSize: '10px' }}>No stock recorded</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {locationStats.slice(0, 5).map((loc: any, idx: number) => {
                                    const pct = totalStockQty > 0 ? (loc.totalQty / totalStockQty) * 100 : 0;
                                    const colors: Array<'blue' | 'green' | 'orange' | 'red'> = ['blue', 'green', 'orange', 'red', 'blue'];
                                    return (
                                        <div key={loc.id}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' }}>
                                                <span style={{ fontWeight: 'bold', color: '#000' }}>{loc.name}</span>
                                                <span style={{ color: '#555' }}>{loc.totalQty.toLocaleString()} · {pct.toFixed(0)}%</span>
                                            </div>
                                            <div style={xpProgTrack}>
                                                <div style={{ ...xpProgFill(colors[idx % colors.length]), width: `${pct}%` }}></div>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div style={{ fontSize: '9px', color: '#666', marginTop: '2px', borderTop: '1px solid #ccc', paddingTop: '4px' }}>
                                    Total: {totalStockQty.toLocaleString()} units across {locationStats.length} location{locationStats.length !== 1 ? 's' : ''}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
