'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../shared/Toast';
import { STATUS_COLORS, StatusChip, CodeChip, xpFont as XP_FONT } from '../shared/xpTheme';
import { ToolbarCount } from '../shared/shellTheme';
import {
    MOBILE_BG, MobilePanel, MobileToolbar, MobileSearchField, MobileFilterBar,
    MobileButton, MobileEmpty, mobileCard as xpPanel,
} from './mobileTheme';

const STATUS_TABS = ['ALL', 'PENDING', 'IN_PROGRESS'] as const;
type StatusFilter = typeof STATUS_TABS[number];

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
    const { showToast } = useToast();
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
                const order = ['IN_PROGRESS', 'PENDING', 'DELIVERED', 'COMPLETED', 'CANCELLED'];
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
    // Output-side ceiling. Reads the MO's own overdelivery snapshot — NOT
    // bom.tolerance_percentage, which is the input-side material wastage allowance.
    const getToleranceMax = (mo: any) => {
        if (mo.allow_unlimited_overdelivery) return Infinity;
        const tol = mo.overdelivery_tolerance_pct ?? 10;
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
            if (!res.ok) {
                try {
                    const err = await res.json();
                    showToast(err.detail || 'Failed to create work order', 'danger');
                } catch {
                    showToast('Failed to create work order', 'danger');
                }
            } else {
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
        <div style={{ background: MOBILE_BG, padding: 10 }}>
            <MobilePanel
                icon="bi-gear-fill"
                title="Manufacturing Orders"
                pad={0}
                right={
                    <MobileButton compact tone="neutral" icon="bi-qr-code-scan" onClick={() => router.push('/scanner')}>
                        Scan MO
                    </MobileButton>
                }
            >
                {/* Toolbar: the same search field and segmented status filter the
                    desktop list views use, one size up for a finger. */}
                <MobileToolbar>
                    <MobileSearchField value={search} onChange={setSearch} placeholder="Search MO code or item..." />
                    <ToolbarCount right>{filtered.length} MOs</ToolbarCount>
                </MobileToolbar>
                <MobileToolbar>
                    <MobileFilterBar
                        options={STATUS_TABS.map(tab => ({ value: tab, label: tabLabel[tab], count: counts[tab] }))}
                        value={filter}
                        onChange={v => setFilter(v as StatusFilter)}
                    />
                </MobileToolbar>

                <div style={{ padding: 8 }}>
            {/* MO List */}
            {filtered.length === 0 ? (
                <MobileEmpty>No manufacturing orders found</MobileEmpty>
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
                                        borderLeft: `4px solid ${mo.isOverdue ? '#cc0000' : mo.status === 'IN_PROGRESS' ? STATUS_COLORS.IN_PROGRESS : mo.status === 'PENDING' ? STATUS_COLORS.PENDING : '#666'}`,
                                        cursor: 'pointer',
                                    })}
                                    onClick={() => handleToggleExpand(mo.id)}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                        <div style={{ minWidth: 0 }}>
                                            {/* Card title on a phone — one step up from the desktop tier-1
                                                size so it stays readable at arm's length on the floor. */}
                                            <CodeChip code={mo.code} classic tone="accent" style={{ display: 'block', fontSize: 15 }} />
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
                                            <StatusChip status={mo.status} />
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
                                                    <div key={run.id} style={xpPanel({ padding: '7px 10px', borderLeft: `3px solid ${STATUS_COLORS[run.status] || STATUS_COLORS.PENDING}` })}>
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
                                                                <StatusChip status={run.status} />
                                                                <div style={{ display: 'flex', gap: 4 }}>
                                                                    {run.status === 'PENDING' && (
                                                                        <MobileButton
                                                                            compact
                                                                            tone="launch"
                                                                            disabled={updatingRunId === run.id}
                                                                            onClick={e => { e.stopPropagation(); handleRunStatus(run.id, 'IN_PROGRESS'); }}
                                                                        >
                                                                            Start
                                                                        </MobileButton>
                                                                    )}
                                                                    {run.status === 'IN_PROGRESS' && (
                                                                        <MobileButton
                                                                            compact
                                                                            tone="create"
                                                                            disabled={updatingRunId === run.id}
                                                                            onClick={e => { e.stopPropagation(); handleRunStatus(run.id, 'COMPLETED'); }}
                                                                        >
                                                                            Done
                                                                        </MobileButton>
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
                                            <MobileButton
                                                icon="bi-plus-lg"
                                                onClick={e => { e.stopPropagation(); handleOpenAddRun(mo); }}
                                                style={{ width: '100%' }}
                                            >
                                                Add Run
                                            </MobileButton>
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
                                                    <MobileButton
                                                        compact
                                                        onClick={e => { e.stopPropagation(); setAddRunMOId(null); }}
                                                        style={{ padding: '5px 12px' }}
                                                    >
                                                        Cancel
                                                    </MobileButton>
                                                    <MobileButton
                                                        compact
                                                        tone="launch"
                                                        disabled={submitting || !runQty || parseFloat(runQty) <= 0}
                                                        onClick={e => { e.stopPropagation(); handleAddRun(mo); }}
                                                        style={{ padding: '5px 12px' }}
                                                    >
                                                        {submitting ? 'Saving...' : 'Add Run'}
                                                    </MobileButton>
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
            </MobilePanel>
        </div>
    );
}
