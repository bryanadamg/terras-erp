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
    manufacturingOrders: any[];
    items: any[];
    workCenters: any[];
    boms: any[];
    authFetch: (url: string, options?: any) => Promise<Response>;
    onRefresh: () => void;
}

export default function MobileManufacturingView({
    manufacturingOrders, items, workCenters, boms, authFetch, onRefresh,
}: MobileManufacturingViewProps) {
    const router = useRouter();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const [filter, setFilter]           = useState<StatusFilter>('ALL');
    const [search, setSearch]           = useState('');
    const [expandedId, setExpandedId]   = useState<string | null>(null);
    const [addRunMOId, setAddRunMOId]   = useState<string | null>(null);
    const [runWcId, setRunWcId]         = useState('');
    const [runQty, setRunQty]           = useState('');
    const [submitting, setSubmitting]   = useState(false);
    const [updatingRunId, setUpdatingRunId] = useState<string | null>(null);

    const today = new Date();

    const filtered = useMemo(() => {
        return (manufacturingOrders || [])
            .filter((mo: any) => {
                if (filter !== 'ALL' && mo.status !== filter) return false;
                if (search.trim()) {
                    const q = search.trim().toUpperCase();
                    return mo.code.toUpperCase().includes(q) || (mo.item_name || '').toUpperCase().includes(q);
                }
                return true;
            })
            .map((mo: any) => ({
                ...mo,
                isOverdue: mo.target_end_date && new Date(mo.target_end_date) < today,
            }))
            .sort((a: any, b: any) => {
                if (a.isOverdue && !b.isOverdue) return -1;
                if (!a.isOverdue && b.isOverdue) return 1;
                const order = ['IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED'];
                return order.indexOf(a.status) - order.indexOf(b.status);
            });
    }, [manufacturingOrders, filter, search]);

    const counts: Record<StatusFilter, number> = useMemo(() => ({
        ALL:         (manufacturingOrders || []).length,
        PENDING:     (manufacturingOrders || []).filter((mo: any) => mo.status === 'PENDING').length,
        IN_PROGRESS: (manufacturingOrders || []).filter((mo: any) => mo.status === 'IN_PROGRESS').length,
    }), [manufacturingOrders]);

    const tabLabel: Record<StatusFilter, string> = {
        ALL: 'All', PENDING: 'Pending', IN_PROGRESS: 'In Progress',
    };

    const getRuns = (mo: any) => (mo.work_orders || []).filter((wo: any) => wo.qty != null);
    const getRunQtySum = (mo: any) => getRuns(mo).reduce((s: number, wo: any) => s + parseFloat(wo.qty || 0), 0);
    const getToleranceMax = (mo: any) => {
        const bom = mo.bom || boms.find((b: any) => b.id === mo.bom_id);
        const tol = parseFloat(bom?.tolerance_percentage || 0);
        return mo.qty * (1 + tol / 100);
    };
    const getRemaining = (mo: any) => Math.max(0, mo.qty - getRunQtySum(mo));

    const handleToggleExpand = (id: string) => {
        setExpandedId(prev => prev === id ? null : id);
        setAddRunMOId(null);
        setRunWcId('');
        setRunQty('');
    };

    const handleOpenAddRun = (mo: any) => {
        setAddRunMOId(mo.id);
        setRunQty(getRemaining(mo).toFixed(2));
        setRunWcId('');
    };

    const handleAddRun = async (mo: any) => {
        const qty = parseFloat(runQty);
        if (!qty || qty <= 0) return;
        setSubmitting(true);
        try {
            const runs = getRuns(mo);
            const res = await authFetch(`${API_BASE}/work-orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    manufacturing_order_id: mo.id,
                    name: `Run ${runs.length + 1}`,
                    sequence: runs.length + 1,
                    work_center_id: runWcId || null,
                    qty,
                }),
            });
            if (res.ok) {
                onRefresh();
                setAddRunMOId(null);
                setRunWcId('');
                setRunQty('');
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleRunStatus = async (runId: string, status: string) => {
        setUpdatingRunId(runId);
        try {
            const res = await authFetch(`${API_BASE}/work-orders/${runId}/status?status=${status}`, { method: 'PUT' });
            if (res.ok) onRefresh();
        } finally {
            setUpdatingRunId(null);
        }
    };

    return (
        <div style={{ background: XP_BEIGE, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Header */}
            <div style={{ fontFamily: XP_FONT, fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5, color: '#555', borderBottom: '1px solid #c0bdb5', paddingBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span><i className="bi bi-gear-fill" style={{ marginRight: 5, color: '#1a4a8a' }} />Manufacturing Orders</span>
                <button
                    onClick={() => router.push('/scanner')}
                    style={xpBtn({
                        background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)',
                        borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a',
                        color: '#fff', fontWeight: 'bold', fontSize: 11, padding: '5px 10px',
                    })}
                >
                    <i className="bi bi-qr-code-scan" />Scan MO
                </button>
            </div>

            {/* Search */}
            <div style={xpInset({ padding: 0, display: 'flex', alignItems: 'center' })}>
                <i className="bi bi-search" style={{ padding: '0 8px', color: '#666', fontSize: 13, flexShrink: 0 }} />
                <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search MO code or item..."
                    style={{
                        flex: 1, border: 'none', outline: 'none',
                        background: 'transparent', fontFamily: XP_FONT,
                        fontSize: 13, padding: '9px 8px 9px 0', color: '#000',
                    }}
                />
                {search && (
                    <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px', color: '#666', fontSize: 14 }}>x</button>
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
                                flex: 1, fontFamily: XP_FONT, fontSize: 11,
                                fontWeight: isActive ? 'bold' : 'normal',
                                padding: '7px 4px', border: 'none',
                                borderRight: i < STATUS_TABS.length - 1 ? '1px solid #c0bdb5' : 'none',
                                background: isActive ? 'linear-gradient(to bottom, #316ac5, #1a4a8a)' : 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
                                color: isActive ? '#fff' : '#333', cursor: 'pointer',
                            }}
                        >
                            {tabLabel[tab]}
                            <span style={{
                                marginLeft: 4,
                                background: isActive ? 'rgba(255,255,255,0.25)' : '#e0ddd5',
                                color: isActive ? '#fff' : '#555',
                                fontSize: 9, fontWeight: 'bold', padding: '0 4px', borderRadius: 1,
                            }}>
                                {counts[tab]}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* MO List */}
            {filtered.length === 0 ? (
                <div style={xpInset({ padding: '20px', textAlign: 'center', color: '#666', fontFamily: XP_FONT, fontSize: 12 })}>
                    No manufacturing orders found
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {filtered.map((mo: any) => {
                        const isExpanded = expandedId === mo.id;
                        const runs = getRuns(mo);
                        const runQtySum = getRunQtySum(mo);
                        const remaining = Math.max(0, mo.qty - runQtySum);
                        const maxQty = getToleranceMax(mo);
                        const isAddingRun = addRunMOId === mo.id;
                        const newRunQtyNum = parseFloat(runQty) || 0;
                        const wouldExceed = isAddingRun && (runQtySum + newRunQtyNum) > maxQty;

                        return (
                            <div key={mo.id}>
                                {/* MO card */}
                                <div
                                    style={xpPanel({
                                        padding: '10px 12px',
                                        borderLeft: `4px solid ${mo.isOverdue ? '#cc0000' : mo.status === 'IN_PROGRESS' ? '#1a4a8a' : mo.status === 'PENDING' ? '#b8860b' : '#666'}`,
                                        cursor: 'pointer',
                                    })}
                                    onClick={() => handleToggleExpand(mo.id)}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 15, fontWeight: 'bold', color: '#00309c' }}>{mo.code}</div>
                                            <div style={{ fontFamily: XP_FONT, fontSize: 12, color: '#333', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mo.item_name || '—'}</div>
                                            <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#555', marginTop: 1 }}>
                                                Qty: {parseFloat(mo.qty)}
                                                {runs.length > 0 && (
                                                    <span style={{ marginLeft: 8, color: '#1a4a8a' }}>
                                                        {runs.length} run{runs.length !== 1 ? 's' : ''} — {runQtySum.toFixed(2)} assigned
                                                    </span>
                                                )}
                                                {mo.target_end_date && (
                                                    <span style={{ marginLeft: 8, color: mo.isOverdue ? '#cc0000' : '#555' }}>
                                                        {mo.isOverdue && <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 3 }} />}
                                                        Due: {mo.target_end_date.slice(0, 10)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                                            <span style={xpStatusBadge(mo.status)}>
                                                {mo.status === 'IN_PROGRESS' ? 'IN PROGRESS' : mo.status}
                                            </span>
                                            <span style={{ fontFamily: XP_FONT, fontSize: 10, color: '#888' }}>
                                                {isExpanded ? 'collapse' : 'tap to expand'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded runs panel */}
                                {isExpanded && (
                                    <div style={{ border: '2px solid', borderColor: '#808080 #dfdfdf #dfdfdf #808080', borderTop: 'none', background: '#fff', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>

                                        {/* Runs list */}
                                        {runs.length === 0 ? (
                                            <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#888', textAlign: 'center', padding: '8px 0' }}>
                                                No runs assigned. Add a run below.
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                                <div style={{ fontFamily: XP_FONT, fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', color: '#555', borderBottom: '1px solid #e0ddd5', paddingBottom: 3 }}>
                                                    Runs ({runs.length})
                                                </div>
                                                {runs.map((run: any) => (
                                                    <div key={run.id} style={xpPanel({ padding: '7px 10px', borderLeft: `3px solid ${run.status === 'COMPLETED' ? '#2e7d32' : run.status === 'IN_PROGRESS' ? '#1a4a8a' : '#b8860b'}` })}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                                                            <div>
                                                                <div style={{ fontFamily: XP_FONT, fontSize: 12, fontWeight: 'bold', color: '#333' }}>
                                                                    {run.name}
                                                                    {run.work_center_name && (
                                                                        <span style={{ fontWeight: 'normal', color: '#666', marginLeft: 5 }}>@ {run.work_center_name}</span>
                                                                    )}
                                                                </div>
                                                                <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#555' }}>Qty: {parseFloat(run.qty)}</div>
                                                            </div>
                                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                                                                <span style={xpStatusBadge(run.status)}>{run.status === 'IN_PROGRESS' ? 'IN PROGRESS' : run.status}</span>
                                                                <div style={{ display: 'flex', gap: 4 }}>
                                                                    {run.status === 'PENDING' && (
                                                                        <button
                                                                            disabled={updatingRunId === run.id}
                                                                            onClick={e => { e.stopPropagation(); handleRunStatus(run.id, 'IN_PROGRESS'); }}
                                                                            style={xpBtn({ fontSize: 10, padding: '3px 8px', background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)', borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a', color: '#fff', fontWeight: 'bold' })}
                                                                        >
                                                                            Start
                                                                        </button>
                                                                    )}
                                                                    {run.status === 'IN_PROGRESS' && (
                                                                        <button
                                                                            disabled={updatingRunId === run.id}
                                                                            onClick={e => { e.stopPropagation(); handleRunStatus(run.id, 'COMPLETED'); }}
                                                                            style={xpBtn({ fontSize: 10, padding: '3px 8px', background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#fff', fontWeight: 'bold' })}
                                                                        >
                                                                            Done
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Qty summary bar */}
                                        <div style={{ fontFamily: XP_FONT, fontSize: 11, color: '#555', background: '#f5f4ef', padding: '5px 8px', border: '1px solid #e0ddd5' }}>
                                            Target: {parseFloat(mo.qty)} | Assigned: {runQtySum.toFixed(2)} | Remaining: {remaining.toFixed(2)}
                                        </div>

                                        {/* Add Run */}
                                        {!isAddingRun ? (
                                            <button
                                                onClick={e => { e.stopPropagation(); handleOpenAddRun(mo); }}
                                                style={xpBtn({ fontSize: 11, padding: '6px 12px', width: '100%', justifyContent: 'center' })}
                                            >
                                                + Add Run
                                            </button>
                                        ) : (
                                            <div style={{ border: '1px solid #aca899', padding: '8px', background: '#f5f4ee', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                <div style={{ fontFamily: XP_FONT, fontSize: 10, fontWeight: 'bold', color: '#000080', textTransform: 'uppercase' }}>New Run</div>
                                                <div style={{ display: 'flex', gap: 6 }}>
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ fontFamily: XP_FONT, fontSize: 10, marginBottom: 2 }}>Work Center</div>
                                                        <select
                                                            value={runWcId}
                                                            onChange={e => setRunWcId(e.target.value)}
                                                            onClick={e => e.stopPropagation()}
                                                            style={{ width: '100%', fontFamily: XP_FONT, fontSize: 12, border: '1px solid #7f9db9', padding: '4px 6px', background: '#fff' }}
                                                        >
                                                            <option value="">— any —</option>
                                                            {workCenters.map((wc: any) => (
                                                                <option key={wc.id} value={wc.id}>{wc.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ fontFamily: XP_FONT, fontSize: 10, marginBottom: 2 }}>Qty</div>
                                                        <input
                                                            type="number"
                                                            value={runQty}
                                                            onChange={e => setRunQty(e.target.value)}
                                                            onClick={e => e.stopPropagation()}
                                                            min="0.0001"
                                                            step="any"
                                                            style={{ width: '100%', fontFamily: XP_FONT, fontSize: 12, border: '1px solid #7f9db9', padding: '4px 6px' }}
                                                        />
                                                    </div>
                                                </div>
                                                {wouldExceed && (
                                                    <div style={{ fontFamily: XP_FONT, fontSize: 10, color: '#8a3c00', background: '#fff3cd', border: '1px solid #b8860b', padding: '4px 6px' }}>
                                                        Exceeds target + tolerance ({maxQty.toFixed(2)}). Override allowed.
                                                    </div>
                                                )}
                                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                                    <button
                                                        onClick={e => { e.stopPropagation(); setAddRunMOId(null); }}
                                                        style={xpBtn({ fontSize: 11, padding: '4px 10px' })}
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        disabled={submitting || !runQty || parseFloat(runQty) <= 0}
                                                        onClick={e => { e.stopPropagation(); handleAddRun(mo); }}
                                                        style={xpBtn({
                                                            fontSize: 11, padding: '4px 10px',
                                                            background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)',
                                                            borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a',
                                                            color: '#fff', fontWeight: 'bold',
                                                            opacity: (submitting || !runQty || parseFloat(runQty) <= 0) ? 0.6 : 1,
                                                        })}
                                                    >
                                                        {submitting ? 'Saving...' : 'Add Run'}
                                                    </button>
                                                </div>
                                            </div>
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
