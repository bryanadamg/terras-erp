'use client';
// Production Output report — what was produced, how much was QC-rejected, and the
// reject % of output. Self-fetching like ReportsView: it pulls authFetch/workCenters
// from DataContext and queries the server-side aggregation endpoints.
//
// Three groupings over one source (`/reports/machine-output`):
//   machine / group — per work centre, output pegged to the machine through the
//                     WORK ORDER server-side (the operator's own completion
//                     work_center_id is only the fallback for MO-level logs)
//   wo              — the per-WO result sheet the floor asks for: hasil, QC reject
//                     and reject % per work order, filterable to finished orders
// plus a separate source (`/reports/packing-output`) for packing, which cannot be a
// grouping of the machine report: a PackingCompletion has no work centre to peg to.
// That source has two grains of its own:
//   packing        — per packing order
//   operator       — per packer, from `PackingCompletion.operator_user_id` (the
//                    account that logged it, not the typed name), expanding to a
//                    per-day breakdown: the per-head output figure.
//
// Every row carries its reject events (reason, operator, defect store), so the
// expanded panel answers "what was rejected and where did it go" in one place.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useData } from '../../context/DataContext';
import { useUser } from '../../context/UserContext';
import {
    xpFont, xpBtn, xpInput, xpSep, TableBlockSkeleton, XPEmptyState,
    useSortable, WorkCenterChip, StatusChip, ExpandedRowPanel, ProgressBar, rowStateBg, XP_BTN,
} from '../shared/xpTheme';
import TreeSelect, { TreeSelectOption } from '../shared/TreeSelect';
import { childrenOfWC, isMachineWC, isTypeWC } from '../shared/workCenterTree';
import { xpBevel as sharedXpBevel, xpTitleBar as sharedXpTitleBar, xpToolbar as sharedXpToolbar, FilterChipBar, SegmentedBar, pageFillStyle, flexFillStyle } from '../shared/shellTheme';
import { lvThead, lvSubTh, lvSubTd, lvSubTable, lvSubCaption, ExpanderCell, SortableTh, lvZebra, Dash } from '../shared/listViewTheme';
import { qtyFmt } from '../shared/format';

// Machine output is weighed to the gram, so this report alone runs at 3dp.
const fmtQty = qtyFmt(3);
const fmtPct = (n: number | null | undefined) => (n == null ? '-' : `${n}%`);
const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// UOMs differ per item, so a row total is only meaningful when its items agree.
// A WO/packing row states its own item's uom directly.
const uomOf = (row: any): string => {
    if (row.uom) return String(row.uom);
    const set = new Set((row.items || []).map((i: any) => i.uom).filter(Boolean));
    if (set.size === 1) return String([...set][0]);
    return set.size === 0 ? '' : 'mixed';
};

// Reject % is scrap over *hasil* (good), matching the shop-floor formula, so 10
// rejected against 100 good reads 10%. Anything at or above this is worth flagging
// red rather than leaving it to the reader to spot in a column of numbers.
const REJECT_ALERT_PCT = 5;

type Mode = 'machine' | 'group' | 'wo' | 'packing' | 'operator';

interface ReportColumn {
    key: string;
    label: string;
    sortKey?: string;
    align?: 'left' | 'right';
    width?: number;
    /** Cell body. `classic` lets a cell pick XP vs Bootstrap typography. */
    render: (r: any) => React.ReactNode;
    /** Flat value for the CSV export. */
    csv: (r: any) => string | number;
}

export default function MachineOutputReportView() {
    const { t } = useLanguage();
    const { formatDate: tzDate, formatTime: tzTime } = useTimezone();
    const { authFetch, workCenters = [] } = useData();
    const { hasPermission } = useUser();
    // Reading the report and taking it off the system are separate grants.
    const canExport = hasPermission('production_output.export');

    const API_BASE = useMemo(() => {
        const env = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
        return env.replace(/\/api$/, '') + '/api';
    }, []);

    // Filters — default to the trailing 7 days (a shift report, not all-time).
    const [startDate, setStartDate] = useState(() => {
        const s = new Date(); s.setDate(s.getDate() - 6); return fmtDate(s);
    });
    const [endDate, setEndDate] = useState(() => fmtDate(new Date()));
    const [scope, setScope] = useState('');            // '' | 'grp:<id>' | 'wc:<id>'
    const [mode, setMode] = useState<Mode>('machine');
    const [completedOnly, setCompletedOnly] = useState(false);
    const [rejectsOnly, setRejectsOnly] = useState(false);
    const [hideIdle, setHideIdle] = useState(true);
    const [expanded, setExpanded] = useState<string | null>(null);

    const [rows, setRows] = useState<any[]>([]);
    const [totals, setTotals] = useState<any>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const isGroupMode = mode === 'group';
    const isWoMode = mode === 'wo';
    const isPacking = mode === 'packing';
    const isOperator = mode === 'operator';
    // Both grains come off /reports/packing-output, so anything that depends on the
    // SOURCE (no work centre to scope by, no lot on a reject) tests this, and only
    // the column/row shape tests isPacking vs isOperator.
    const isPackingSource = isPacking || isOperator;
    const isMachineLevel = mode === 'machine' || mode === 'group';

    const fetchReport = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const p = new URLSearchParams();
            if (startDate) p.set('start_date', startDate);
            if (endDate) p.set('end_date', `${endDate}T23:59:59`);

            let url: string;
            if (isPackingSource) {
                // Packing is its own source — no work-centre scope applies to it.
                if (isOperator) p.set('group_by', 'operator');
                url = `${API_BASE}/reports/packing-output?${p.toString()}`;
            } else {
                if (scope.startsWith('wc:')) p.set('work_center_id', scope.slice(3));
                else if (scope.startsWith('grp:')) p.set('group_id', scope.slice(4));
                p.set('group_by', mode);
                p.set('include_idle', hideIdle && mode !== 'wo' ? 'false' : 'true');
                if (mode === 'wo' && completedOnly) p.set('wo_status', 'COMPLETED');
                url = `${API_BASE}/reports/machine-output?${p.toString()}`;
            }

            const res = await authFetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setRows(data.rows || []);
            setTotals(data.totals || {});
        } catch (e: any) {
            setError(e.message || 'Failed to load report');
            setRows([]);
            setTotals({});
        } finally {
            setLoading(false);
        }
    }, [API_BASE, authFetch, startDate, endDate, scope, mode, isPackingSource, isOperator, hideIdle, completedOnly]);

    useEffect(() => { fetchReport(); }, [fetchReport]);
    // Row identity differs per grouping, so a stale expanded key would open nothing.
    useEffect(() => { setExpanded(null); }, [mode]);

    // Mirrors the 3-level work-center tree: TYPE > GROUP > machine. A `grp:` value is
    // any container (type or group) — the backend resolves its whole subtree.
    const wcTreeOptions = useMemo((): TreeSelectOption[] => {
        const nodeOption = (node: any): TreeSelectOption => {
            const kids = childrenOfWC(workCenters, node.id);
            return {
                value: `grp:${node.id}`,
                label: node.name,
                subLabel: node.code,
                selectable: true,
                children: kids.length > 0
                    ? kids.map((k: any) => isMachineWC(k)
                        ? { value: `wc:${k.id}`, label: k.name, subLabel: k.code, selectable: true }
                        : nodeOption(k))
                    : undefined,
            };
        };
        const out: TreeSelectOption[] = (workCenters || []).filter((wc: any) => isTypeWC(wc)).map(nodeOption);
        // Nodes whose parent row isn't loaded — keep them reachable.
        const known = new Set((workCenters || []).map((wc: any) => String(wc.id)));
        (workCenters || [])
            .filter((wc: any) => wc.parent_id && !known.has(String(wc.parent_id)))
            .forEach((wc: any) => out.push(isMachineWC(wc)
                ? { value: `wc:${wc.id}`, label: wc.name, subLabel: wc.code, selectable: true }
                : nodeOption(wc)));
        return out;
    }, [workCenters]);

    // "Rejects only" is a client-side cut of the loaded rows, not another request —
    // the reject events already ship with every row.
    const visibleRows = useMemo(
        () => (rejectsOnly ? rows.filter((r: any) => (r.qty_rejected || 0) > 0) : rows),
        [rows, rejectsOnly],
    );

    const rowKey = useCallback((r: any): string => {
        if (isOperator) return String(r.operator_key);
        if (isPacking) return String(r.packing_order_id);
        if (isWoMode) return String(r.work_order_id || `${r.work_center_id}:${r.mo_code}`);
        return String(r.work_center_id);
    }, [isOperator, isPacking, isWoMode]);

    const sortCols = useMemo(() => ({
        name:      (r: any) => (isOperator ? r.operator_name : isPacking ? r.po_code : isWoMode ? (r.wo_code || r.mo_code || '') : r.work_center_name) || '',
        cartons:   (r: any) => r.cartons || 0,
        days:      (r: any) => r.days_active || 0,
        perDay:    (r: any) => (r.qty_per_day ?? -1),
        orders:    (r: any) => r.order_count || 0,
        item:      (r: any) => r.item_code || r.item_name || '',
        machine:   (r: any) => r.work_center_name || '',
        status:    (r: any) => r.wo_status || r.po_status || '',
        target:    (r: any) => (isPacking ? r.qty_target : r.wo_qty) || 0,
        output:    (r: any) => r.qty_good || 0,
        scrap:     (r: any) => r.qty_rejected || 0,
        rejectPct: (r: any) => (r.reject_pct ?? -1),
        yield:     (r: any) => (r.yield_pct ?? -1),
        wos:       (r: any) => r.wo_count || 0,
        logs:      (r: any) => r.logs || 0,
        last:      (r: any) => r.last_log || '',
    }), [isOperator, isPacking, isWoMode]);
    const { sorted, sort, toggle } = useSortable(visibleRows, sortCols);

    const applyPreset = (kind: 'today' | 'yesterday' | '7d' | '30d' | 'month') => {
        const now = new Date();
        if (kind === 'yesterday') {
            const d = new Date(now); d.setDate(d.getDate() - 1);
            setStartDate(fmtDate(d)); setEndDate(fmtDate(d)); return;
        }
        const end = fmtDate(now);
        let start = end;
        if (kind === '7d') { const s = new Date(now); s.setDate(s.getDate() - 6); start = fmtDate(s); }
        else if (kind === '30d') { const s = new Date(now); s.setDate(s.getDate() - 29); start = fmtDate(s); }
        else if (kind === 'month') { start = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)); }
        setStartDate(start); setEndDate(end);
    };

    const periodLabel = `${startDate || 'All time'} → ${endDate || 'now'}`;
    const maxOutput = useMemo(() => Math.max(1, ...visibleRows.map((r: any) => r.qty_good || 0)), [visibleRows]);

    // ── Cell fragments shared by both themes ─────────────────────────────────
    const twoLine = (main: React.ReactNode, sub: React.ReactNode) => (
        <>
            <div style={{ fontWeight: 'bold' }}>{main}</div>
            {sub ? <div style={{ fontSize: 10, color: '#777' }}>{sub}</div> : null}
        </>
    );

    const outputCell = (r: any) => (
        <>
            <span style={{ fontWeight: 'bold', color: r.qty_good ? '#1a5e1a' : '#999' }}>{fmtQty(r.qty_good)}</span>
            <span style={{ fontWeight: 'normal', fontSize: 10, color: '#888', marginLeft: 3 }}>{uomOf(r)}</span>
        </>
    );

    const rejectCell = (r: any) => (
        <span style={{ color: r.qty_rejected ? '#c00000' : '#aaa' }}>{fmtQty(r.qty_rejected)}</span>
    );

    const rejectPctCell = (r: any) => {
        const pct = r.reject_pct;
        const hot = pct != null && pct >= REJECT_ALERT_PCT;
        return (
            <span style={{ color: pct == null ? '#aaa' : hot ? '#c00000' : '#333', fontWeight: hot ? 'bold' : 'normal' }}>
                {fmtPct(pct)}
            </span>
        );
    };

    const lastLogCell = (r: any) => (
        r.last_log
            ? <><div>{tzDate(r.last_log)}</div><div style={{ fontSize: 10, color: '#777' }}>{tzTime(r.last_log)}</div></>
            : <span style={{ color: '#aaa', fontSize: 10 }}>no activity</span>
    );

    // ── Column sets ──────────────────────────────────────────────────────────
    const columns = useMemo((): ReportColumn[] => {
        const shared: ReportColumn[] = [
            {
                key: 'output', label: 'Output', sortKey: 'output', align: 'right',
                render: r => outputCell(r), csv: r => r.qty_good ?? 0,
            },
            {
                key: 'share', label: 'Share', width: 110,
                render: r => <ProgressBar pct={(r.qty_good / maxOutput) * 100} tone="blue" height={8} />,
                csv: () => '',
            },
            {
                key: 'scrap', label: 'QC Reject', sortKey: 'scrap', align: 'right',
                render: r => rejectCell(r), csv: r => r.qty_rejected ?? 0,
            },
            {
                key: 'rejectPct', label: 'Reject %', sortKey: 'rejectPct', align: 'right',
                render: r => rejectPctCell(r), csv: r => r.reject_pct ?? '',
            },
        ];
        const lastLog: ReportColumn = {
            key: 'last', label: 'Last log', sortKey: 'last',
            render: r => lastLogCell(r), csv: r => r.last_log || '',
        };

        if (isOperator) {
            return [
                {
                    key: 'name', label: 'Packer', sortKey: 'name',
                    render: r => twoLine(
                        r.operator_name,
                        // A log with no account behind it is named, not hidden: its
                        // qty is only as good as what someone typed in the box.
                        r.has_account ? (r.username || '') : 'typed name — no user account',
                    ),
                    csv: r => r.operator_name || '',
                },
                ...shared,
                {
                    key: 'cartons', label: 'Cartons', sortKey: 'cartons', align: 'right',
                    render: r => (
                        <>
                            <span>{r.cartons || 0}</span>
                            {r.cartons_rejected ? <span style={{ color: '#c00000', marginLeft: 4 }}>(-{r.cartons_rejected})</span> : null}
                        </>
                    ),
                    csv: r => `${r.cartons || 0}${r.cartons_rejected ? ` (-${r.cartons_rejected})` : ''}`,
                },
                {
                    key: 'days', label: 'Days', sortKey: 'days', align: 'right',
                    render: r => r.days_active || 0, csv: r => r.days_active ?? 0,
                },
                {
                    // Days that produced, not days in the window — a packer who was
                    // off on Tuesday is not averaged down by it.
                    key: 'perDay', label: 'Avg / day', sortKey: 'perDay', align: 'right',
                    render: r => (r.qty_per_day == null
                        ? <Dash classic />
                        : <><span style={{ fontWeight: 'bold' }}>{fmtQty(r.qty_per_day)}</span>
                            <span style={{ fontSize: 10, color: '#888', marginLeft: 3 }}>{uomOf(r)}</span></>),
                    csv: r => r.qty_per_day ?? '',
                },
                {
                    key: 'orders', label: 'Orders', sortKey: 'orders', align: 'right',
                    render: r => r.order_count || 0, csv: r => r.order_count ?? 0,
                },
                lastLog,
            ];
        }

        if (isPacking) {
            return [
                {
                    key: 'name', label: 'Packing Order', sortKey: 'name',
                    render: r => twoLine(r.po_code, [r.sales_order_code, r.customer_name].filter(Boolean).join(' · ') || 'to stock'),
                    csv: r => r.po_code || '',
                },
                {
                    key: 'item', label: 'Item', sortKey: 'item',
                    render: r => twoLine(r.item_code || '—', r.item_name),
                    csv: r => r.item_code || r.item_name || '',
                },
                {
                    key: 'status', label: 'Status', sortKey: 'status',
                    render: r => (r.po_status ? <StatusChip status={r.po_status} tint /> : <Dash classic />),
                    csv: r => r.po_status || '',
                },
                {
                    key: 'target', label: 'Target', sortKey: 'target', align: 'right',
                    render: r => fmtQty(r.qty_target), csv: r => r.qty_target ?? 0,
                },
                ...shared,
                {
                    key: 'cartons', label: 'Cartons', align: 'right',
                    render: r => (
                        <>
                            <span>{r.cartons || 0}</span>
                            {r.cartons_rejected ? <span style={{ color: '#c00000', marginLeft: 4 }}>(-{r.cartons_rejected})</span> : null}
                        </>
                    ),
                    csv: r => `${r.cartons || 0}${r.cartons_rejected ? ` (-${r.cartons_rejected})` : ''}`,
                },
                lastLog,
            ];
        }

        if (isWoMode) {
            return [
                {
                    key: 'name', label: 'Work Order', sortKey: 'name',
                    render: r => twoLine(
                        r.wo_code || '(MO-level log)',
                        [r.wo_name, r.mo_code].filter(Boolean).join(' · '),
                    ),
                    csv: r => r.wo_code || r.mo_code || '',
                },
                {
                    key: 'item', label: 'Item', sortKey: 'item',
                    render: r => twoLine(r.item_code || '—', r.item_name),
                    csv: r => r.item_code || r.item_name || '',
                },
                {
                    key: 'machine', label: 'Machine', sortKey: 'machine',
                    render: r => twoLine(r.work_center_name || '—', r.work_center_code),
                    csv: r => r.work_center_name || '',
                },
                {
                    key: 'status', label: 'Status', sortKey: 'status',
                    render: r => (r.wo_status ? <StatusChip status={r.wo_status} tint /> : <Dash classic />),
                    csv: r => r.wo_status || '',
                },
                {
                    key: 'target', label: 'Target', sortKey: 'target', align: 'right',
                    render: r => (r.wo_qty != null ? fmtQty(r.wo_qty) : <Dash classic />),
                    csv: r => r.wo_qty ?? '',
                },
                ...shared,
                lastLog,
            ];
        }

        return [
            {
                key: 'name', label: isGroupMode ? 'Group' : 'Machine', sortKey: 'name',
                render: r => twoLine(
                    r.work_center_name,
                    `${r.work_center_code || ''}${isGroupMode
                        ? ` · ${r.machine_count || 0} machines`
                        : (r.group_name ? ` · ${r.group_name}` : (r.type_name ? ` · ${r.type_name}` : ''))}`,
                ),
                csv: r => r.work_center_name || '',
            },
            {
                key: 'type', label: 'Type',
                render: r => (r.center_type
                    ? <WorkCenterChip type={r.center_type} name={r.work_center_name} />
                    : <Dash classic />),
                csv: r => r.center_type || '',
            },
            {
                key: 'wos', label: 'WOs', sortKey: 'wos', align: 'right',
                render: r => r.wo_count || 0, csv: r => r.wo_count ?? 0,
            },
            {
                key: 'logs', label: 'Logs', sortKey: 'logs', align: 'right',
                render: r => r.logs || 0, csv: r => r.logs ?? 0,
            },
            ...shared,
            {
                key: 'yield', label: 'Yield', sortKey: 'yield', align: 'right',
                render: r => fmtPct(r.yield_pct), csv: r => r.yield_pct ?? '',
            },
            lastLog,
        ];
    }, [isOperator, isPacking, isWoMode, isGroupMode, maxOutput, true, tzDate, tzTime]);

    const exportCsv = () => {
        const head = columns.filter(c => c.key !== 'share').map(c => c.label);
        const body = sorted.map((r: any) => columns.filter(c => c.key !== 'share').map(c => c.csv(r)));
        const csv = [head, ...body]
            .map(line => line.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
            .join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${isOperator ? 'packing-operator' : isPacking ? 'packing' : mode}-output_${startDate || 'all'}_${endDate || 'now'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // ── Expanded detail (shared by both themes) ──────────────────────────────
    const detailPanel = (r: any) => {
        const dth = lvSubTh(true);
        const dtd = lvSubTd(true);
        const block = (title: string, body: React.ReactNode) => (
            <div style={{ flex: 1, minWidth: 280 }}>
                <div style={lvSubCaption(true)}>{title}</div>
                <div style={{ background: '#fff', border: '1px solid #a8a292', maxHeight: 220, overflowY: 'auto' }}>
                    {body}
                </div>
            </div>
        );

        const itemsTable = (
            <table style={{ ...lvSubTable(true), border: 'none' }}>
                <thead><tr>
                    <th style={dth}>Item</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Output</th>
                    <th style={{ ...dth, textAlign: 'right' }}>QC Reject</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Reject %</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Logs</th>
                </tr></thead>
                <tbody>
                    {(r.items || []).length === 0 ? (
                        <tr><td style={{ ...dtd, color: '#999' }} colSpan={5}>No output logged</td></tr>
                    ) : r.items.map((it: any) => (
                        <tr key={String(it.item_id)}>
                            <td style={dtd}>
                                <div style={{ fontWeight: 'bold' }}>{it.item_name || '(unknown item)'}</div>
                                <div style={{ fontSize: 9, color: '#777' }}>{it.item_code}</div>
                            </td>
                            <td style={{ ...dtd, textAlign: 'right', fontWeight: 'bold', color: '#1a5e1a' }}>{fmtQty(it.qty_good)} <span style={{ color: '#888', fontWeight: 'normal' }}>{it.uom}</span></td>
                            <td style={{ ...dtd, textAlign: 'right', color: it.qty_rejected ? '#c00000' : '#aaa' }}>{fmtQty(it.qty_rejected)}</td>
                            <td style={{ ...dtd, textAlign: 'right' }}>{fmtPct(it.reject_pct)}</td>
                            <td style={{ ...dtd, textAlign: 'right' }}>{it.logs}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );

        const wosTable = (
            <table style={{ ...lvSubTable(true), border: 'none' }}>
                <thead><tr>
                    <th style={dth}>Work Order</th>
                    <th style={dth}>Item</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Output</th>
                    <th style={{ ...dth, textAlign: 'right' }}>QC Reject</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Reject %</th>
                    <th style={dth}>Last log</th>
                </tr></thead>
                <tbody>
                    {(r.work_orders || []).length === 0 ? (
                        <tr><td style={{ ...dtd, color: '#999' }} colSpan={6}>No work order activity</td></tr>
                    ) : r.work_orders.map((w: any, i: number) => (
                        <tr key={`${w.work_order_id || 'nowo'}-${w.mo_code}-${i}`}>
                            <td style={dtd}>
                                <div style={{ fontWeight: 'bold' }}>{w.wo_code || '(MO-level log)'}</div>
                                <div style={{ fontSize: 9, color: '#777' }}>{w.wo_name || ''}{w.mo_code ? ` · ${w.mo_code}` : ''}</div>
                            </td>
                            <td style={dtd}>{w.item_code || w.item_name || '—'}</td>
                            <td style={{ ...dtd, textAlign: 'right', fontWeight: 'bold' }}>{fmtQty(w.qty_good)} <span style={{ color: '#888', fontWeight: 'normal' }}>{w.uom}</span></td>
                            <td style={{ ...dtd, textAlign: 'right', color: w.qty_rejected ? '#c00000' : '#aaa' }}>{fmtQty(w.qty_rejected)}</td>
                            <td style={{ ...dtd, textAlign: 'right' }}>{fmtPct(w.reject_pct)}</td>
                            <td style={dtd}>
                                {w.wo_status && <StatusChip status={w.wo_status} tint />}
                                <div style={{ fontSize: 9, color: '#777' }}>{w.last_log ? `${tzDate(w.last_log)} ${tzTime(w.last_log)}` : '—'}</div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );

        const machinesTable = (
            <table style={{ ...lvSubTable(true), border: 'none' }}>
                <thead><tr>
                    <th style={dth}>Machine</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Output</th>
                    <th style={{ ...dth, textAlign: 'right' }}>QC Reject</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Reject %</th>
                    <th style={{ ...dth, textAlign: 'right' }}>WOs</th>
                </tr></thead>
                <tbody>
                    {(r.machines || []).map((m: any) => (
                        <tr key={m.work_center_id}>
                            <td style={dtd}>
                                <div style={{ fontWeight: 'bold' }}>{m.work_center_name}</div>
                                <div style={{ fontSize: 9, color: '#777' }}>{m.work_center_code}</div>
                            </td>
                            <td style={{ ...dtd, textAlign: 'right', fontWeight: 'bold', color: '#1a5e1a' }}>{fmtQty(m.qty_good)}</td>
                            <td style={{ ...dtd, textAlign: 'right', color: m.qty_rejected ? '#c00000' : '#aaa' }}>{fmtQty(m.qty_rejected)}</td>
                            <td style={{ ...dtd, textAlign: 'right' }}>{fmtPct(m.reject_pct)}</td>
                            <td style={{ ...dtd, textAlign: 'right' }}>{m.wo_count}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );

        // The reject log — reason, who rejected it, and which defect store the scrap
        // was moved into (blank = the reject predates reject routing, or the output
        // was un-lotted and written off rather than quarantined).
        // Sub-table column count, so an empty reject log spans exactly the header.
        const rejectColCount = 6 + (!isWoMode && !isPackingSource ? 1 : 0) + (isOperator ? 1 : 0);

        // The payroll grain: what this packer put out on each day of the window.
        const daysTable = (
            <table style={{ ...lvSubTable(true), border: 'none' }}>
                <thead><tr>
                    <th style={dth}>Day</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Output</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Cartons</th>
                    <th style={{ ...dth, textAlign: 'right' }}>QC Reject</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Reject %</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Logs</th>
                </tr></thead>
                <tbody>
                    {(r.days || []).length === 0 ? (
                        <tr><td style={{ ...dtd, color: '#999' }} colSpan={6}>No output logged</td></tr>
                    ) : r.days.map((d: any) => (
                        <tr key={d.date}>
                            <td style={{ ...dtd, fontWeight: 'bold' }}>{d.date}</td>
                            <td style={{ ...dtd, textAlign: 'right', fontWeight: 'bold', color: '#1a5e1a' }}>{fmtQty(d.qty_good)}</td>
                            <td style={{ ...dtd, textAlign: 'right' }}>
                                {d.cartons || 0}
                                {d.cartons_rejected ? <span style={{ color: '#c00000' }}> (-{d.cartons_rejected})</span> : null}
                            </td>
                            <td style={{ ...dtd, textAlign: 'right', color: d.qty_rejected ? '#c00000' : '#aaa' }}>{fmtQty(d.qty_rejected)}</td>
                            <td style={{ ...dtd, textAlign: 'right' }}>{fmtPct(d.reject_pct)}</td>
                            <td style={{ ...dtd, textAlign: 'right' }}>{d.logs}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );

        const ordersTable = (
            <table style={{ ...lvSubTable(true), border: 'none' }}>
                <thead><tr>
                    <th style={dth}>Packing Order</th>
                    <th style={dth}>Item</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Output</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Cartons</th>
                    <th style={{ ...dth, textAlign: 'right' }}>QC Reject</th>
                    <th style={dth}>Last log</th>
                </tr></thead>
                <tbody>
                    {(r.orders || []).length === 0 ? (
                        <tr><td style={{ ...dtd, color: '#999' }} colSpan={6}>No packing orders in this period</td></tr>
                    ) : r.orders.map((o: any) => (
                        <tr key={o.packing_order_id}>
                            <td style={dtd}>
                                <div style={{ fontWeight: 'bold' }}>{o.po_code}</div>
                                <div style={{ fontSize: 9, color: '#777' }}>
                                    {[o.sales_order_code, o.customer_name].filter(Boolean).join(' · ') || 'to stock'}
                                </div>
                            </td>
                            <td style={dtd}>{o.item_code || o.item_name || '—'}</td>
                            <td style={{ ...dtd, textAlign: 'right', fontWeight: 'bold' }}>{fmtQty(o.qty_good)} <span style={{ color: '#888', fontWeight: 'normal' }}>{o.uom}</span></td>
                            <td style={{ ...dtd, textAlign: 'right' }}>{o.cartons || 0}</td>
                            <td style={{ ...dtd, textAlign: 'right', color: o.qty_rejected ? '#c00000' : '#aaa' }}>{fmtQty(o.qty_rejected)}</td>
                            <td style={dtd}>
                                {o.po_status && <StatusChip status={o.po_status} tint />}
                                <div style={{ fontSize: 9, color: '#777' }}>{o.last_log ? `${tzDate(o.last_log)} ${tzTime(o.last_log)}` : '—'}</div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );

        const rejectsTable = (
            <table style={{ ...lvSubTable(true), border: 'none' }}>
                <thead><tr>
                    <th style={dth}>When</th>
                    {!isWoMode && !isPackingSource && <th style={dth}>Work Order</th>}
                    {isOperator && <th style={dth}>Packing Order</th>}
                    <th style={dth}>Lot</th>
                    <th style={{ ...dth, textAlign: 'right' }}>Rejected</th>
                    <th style={dth}>Reject location</th>
                    <th style={dth}>Reason</th>
                    <th style={dth}>By</th>
                </tr></thead>
                <tbody>
                    {(r.rejects || []).length === 0 ? (
                        <tr><td style={{ ...dtd, color: '#999' }} colSpan={rejectColCount}>No QC rejects in this period</td></tr>
                    ) : r.rejects.map((rj: any) => (
                        <tr key={rj.completion_id}>
                            <td style={dtd}>
                                <div>{rj.logged_at ? tzDate(rj.logged_at) : '—'}</div>
                                <div style={{ fontSize: 9, color: '#777' }}>{rj.logged_at ? tzTime(rj.logged_at) : ''}</div>
                            </td>
                            {!isWoMode && !isPackingSource && (
                                <td style={dtd}>
                                    <div>{rj.wo_code || '(MO-level log)'}</div>
                                    <div style={{ fontSize: 9, color: '#777' }}>{rj.mo_code}</div>
                                </td>
                            )}
                            {isOperator && <td style={dtd}>{rj.po_code || <Dash classic />}</td>}
                            <td style={dtd}>
                                {isPackingSource
                                    ? <span style={{ color: '#777' }}>{rj.cartons_rejected || 0} carton(s)</span>
                                    : (rj.lot_number
                                        ? <>
                                            <div>{rj.lot_number}</div>
                                            {rj.lot_status && rj.lot_status !== 'GOOD' && (
                                                <div style={{ fontSize: 9, color: rj.lot_status === 'REJECT_USABLE' ? '#8a5a00' : '#900' }}>
                                                    {rj.lot_status === 'REJECT_USABLE' ? 'usable' : rj.lot_status.toLowerCase()}
                                                </div>
                                            )}
                                          </>
                                        : <span style={{ color: '#aaa' }}>un-lotted</span>)}
                            </td>
                            <td style={{ ...dtd, textAlign: 'right', color: '#c00000', fontWeight: 'bold' }}>
                                {fmtQty(rj.qty_rejected)}
                                {!rj.whole_lot && <span style={{ fontWeight: 'normal', color: '#777', fontSize: 9 }}> partial</span>}
                            </td>
                            <td style={dtd}>{rj.reject_location_name || <span style={{ color: '#aaa' }}>—</span>}</td>
                            <td style={dtd}>{rj.reason || <span style={{ color: '#aaa' }}>—</span>}</td>
                            <td style={dtd}>{rj.rejected_by || rj.operator_name || <span style={{ color: '#aaa' }}>—</span>}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );

        return (
            <ExpandedRowPanel classic style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {isOperator && block(`By day (${(r.days || []).length})`, daysTable)}
                {isOperator && block('By item', itemsTable)}
                {isOperator && block(`Packing orders (${(r.orders || []).length})`, ordersTable)}
                {isMachineLevel && block('By item', itemsTable)}
                {isGroupMode && block(`Machines (${(r.machines || []).length})`, machinesTable)}
                {isMachineLevel && block('Work orders', wosTable)}
                {block(`QC rejects (${(r.rejects || []).length})`, rejectsTable)}
            </ExpandedRowPanel>
        );
    };

    const emptyIcon = isOperator ? 'bi-person-badge' : isPacking ? 'bi-box-seam' : isWoMode ? 'bi-card-checklist' : 'bi-cpu';
    const emptyMessage = rows.length === 0
        ? (isOperator ? 'No packing logged by anyone in this period'
            : isPacking ? 'No packing logged in this period'
            : isWoMode ? 'No work order output in this period'
            : hideIdle ? 'No production logged in this period' : 'No machines in scope')
        : 'No rows with QC rejects in this period';

    const modeTabs = [
        { value: 'machine', label: 'Per Machine' },
        { value: 'group', label: 'Per Group' },
        { value: 'wo', label: 'Per Work Order' },
        { value: 'packing', label: 'Packing' },
        { value: 'operator', label: 'Per Packer' },
    ];

    // Same preset row in both themes — one list, rendered by SegmentedBar.
    const presetActions = ([
        ['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7d'], ['30d', '30d'], ['month', 'Month'],
    ] as const).map(([k, label]) => ({ key: k, label, onClick: () => applyPreset(k) }));

    // Summary tiles — mode-aware, reject % always present since that is the ask.
    const statTiles = useMemo(() => {
        const base = [
            { label: 'Output', value: fmtQty(totals.qty_good || 0), color: '#1a5e1a', cls: 'text-success' },
            { label: 'QC Reject', value: fmtQty(totals.qty_rejected || 0), color: '#c00000', cls: 'text-danger' },
            { label: 'Reject %', value: fmtPct(totals.reject_pct), color: (totals.reject_pct ?? 0) >= REJECT_ALERT_PCT ? '#c00000' : '#1a3d7a', cls: (totals.reject_pct ?? 0) >= REJECT_ALERT_PCT ? 'text-danger' : 'text-primary' },
            { label: 'Yield', value: fmtPct(totals.yield_pct), color: '#1a3d7a', cls: 'text-primary' },
        ];
        if (isOperator) {
            return [
                ...base,
                { label: 'Cartons', value: `${totals.cartons || 0}`, color: '#1a3d7a', cls: 'text-primary' },
                { label: 'Packers', value: String(totals.operator_count || 0), color: '#4a2a7a', cls: 'text-dark' },
                // Logs with no account behind them. Zero is the healthy reading;
                // anything else is output nobody can be paid for reliably.
                {
                    label: 'No account',
                    value: String(totals.unattributed_count || 0),
                    color: totals.unattributed_count ? '#c00000' : '#777',
                    cls: totals.unattributed_count ? 'text-danger' : 'text-muted',
                },
            ];
        }
        if (isPacking) {
            return [
                ...base,
                { label: 'Cartons', value: `${totals.cartons || 0}`, color: '#1a3d7a', cls: 'text-primary' },
                { label: 'Orders', value: String(totals.order_count || 0), color: '#4a2a7a', cls: 'text-dark' },
            ];
        }
        return [
            ...base,
            { label: 'Work Orders', value: String(totals.wo_count || 0), color: '#1a3d7a', cls: 'text-primary' },
            { label: 'Logs', value: String(totals.logs || 0), color: '#1a3d7a', cls: 'text-primary' },
            ...(isMachineLevel
                ? [{ label: 'Machines', value: `${totals.active_machine_count || 0}/${totals.machine_count || 0}`, color: '#4a2a7a', cls: 'text-dark' }]
                : [{ label: 'Reject events', value: String(totals.reject_events || 0), color: '#4a2a7a', cls: 'text-dark' }]),
        ];
    }, [totals, isOperator, isPacking, isMachineLevel]);

    // ── Render — one tree, classic vs modern chosen per element ─────────────
    const toolbar: React.CSSProperties = sharedXpToolbar({ padding: '4px 6px', gap: '5px', flexWrap: 'nowrap', overflowX: 'auto' });
    const toolbarTop: React.CSSProperties = { ...toolbar, borderBottom: 'none', paddingBottom: 0 };
    const th: React.CSSProperties = {
        ...lvThead(true),
        fontSize: '10px', fontWeight: 'bold', color: '#000', fontFamily: xpFont, padding: '3px 8px',
        position: 'sticky', top: 0, textAlign: 'left', borderRight: '1px solid #b0a898',
    };
    const td: React.CSSProperties = { padding: '4px 8px', fontFamily: xpFont, borderRight: '1px solid #e0ddd3', fontSize: 11 };
    const lbl: React.CSSProperties = { fontFamily: xpFont, fontSize: '11px', color: '#444' };

    return (
        <div className={'fade-in'} style={pageFillStyle}>
            <div style={sharedXpBevel(flexFillStyle)}
            >
                <>
                        <div style={sharedXpTitleBar()}>
                            <span><i className="bi bi-clipboard-data" style={{ marginRight: 6 }} />Production Output &amp; QC Reject</span>
                            <span style={{ fontSize: '10px', opacity: 0.85 }}>{periodLabel}</span>
                        </div>

                        {/* Line 1: scope + mode */}
                        <div style={toolbarTop}>
                            <span style={lbl}>Work center:</span>
                            <TreeSelect
                                options={wcTreeOptions}
                                value={scope}
                                onChange={setScope}
                                allowEmpty
                                emptyLabel="All Work Centres"
                                style={{ width: 200 }}
                                disabled={isPackingSource}
                            />
                            <div style={xpSep} />
                            <span style={lbl}>View:</span>
                            <FilterChipBar classic options={modeTabs} value={mode} onChange={v => setMode(v as Mode)} />
                            <div style={xpSep} />
                            {isWoMode && (
                                <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                                    <input type="checkbox" checked={completedOnly} onChange={e => setCompletedOnly(e.target.checked)} />
                                    Completed WOs only
                                </label>
                            )}
                            {isMachineLevel && (
                                <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                                    <input type="checkbox" checked={hideIdle} onChange={e => setHideIdle(e.target.checked)} />
                                    Hide machines with no output
                                </label>
                            )}
                            <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                                <input type="checkbox" checked={rejectsOnly} onChange={e => setRejectsOnly(e.target.checked)} />
                                With rejects only
                            </label>
                            <div style={{ flex: 1 }} />
                        </div>

                        {/* Line 2: date range + actions */}
                        <div style={toolbar}>
                            <span style={lbl}>{t('from')}:</span>
                            <input type="date" style={xpInput({ width: 122 })} value={startDate} onChange={e => setStartDate(e.target.value)} />
                            <span style={lbl}>{t('to')}:</span>
                            <input type="date" style={xpInput({ width: 122 })} value={endDate} onChange={e => setEndDate(e.target.value)} />
                            <SegmentedBar classic actions={presetActions} />
                            <div style={{ flex: 1 }} />
                            <span style={{ ...lbl, whiteSpace: 'nowrap' }}>{sorted.length} rows</span>
                            <button className={XP_BTN} style={xpBtn({ padding: '1px 6px' })} onClick={fetchReport} title="Refresh"><i className="bi bi-arrow-clockwise" /></button>
                            {canExport && (
                                <button className={XP_BTN} style={xpBtn({ padding: '1px 6px' })} onClick={exportCsv} disabled={!sorted.length} title="Export CSV"><i className="bi bi-filetype-csv" /></button>
                            )}
                        </div>
                    </>

                {/* Summary strip — one map, per-tile markup differs by theme */}
                <div
                    className={undefined}
                    style={{ display: 'flex', gap: 5, padding: '3px 6px', background: '#ece9d8', borderBottom: '1px solid #b0a898' }}
                >
                    {statTiles.map((s, i) => <div key={s.label} style={{
                            flex: 1, minWidth: 96, background: '#ffffff',
                            border: '1px solid', borderColor: '#808080 #ffffff #ffffff #808080',
                            padding: '1px 8px', fontFamily: xpFont,
                            display: 'flex', alignItems: 'baseline', gap: 6,
                        }}>
                            <span style={{ fontSize: 9, color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 'bold', color: s.color, marginLeft: 'auto' }}>{s.value}</span>
                        </div>)}
                </div>

                <div
                    className={undefined}
                    style={{ flex: 1, overflowY: 'auto', background: '#fff', minHeight: 0 }}
                >
                    {/* +1 for the leading expander column the real table renders. */}
                    {loading ? <TableBlockSkeleton cols={columns.length + 1} rows={14} classic />
                    : error ? (
                        <XPEmptyState icon="bi-exclamation-triangle" message={`Could not load report — ${error}`} />)
                    : sorted.length === 0 ? (
                        <XPEmptyState icon={emptyIcon} message={emptyMessage} />)
                    : (
                        <div className={undefined} style={undefined}>
                            <table className={undefined} style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead className={undefined} style={undefined}>
                                    <tr>
                                        <th style={{ ...th, width: 22 }} />
                                        {columns.map((c, ci) => (
                                            <SortableTh
                                                key={c.key}
                                                sort={sort} colKey={c.sortKey || null} onSort={toggle}
                                                style={{
                                                    ...th,
                                                    ...(c.align === 'right' ? { textAlign: 'right' } : {}),
                                                    ...(c.width ? { width: c.width } : {}),
                                                    ...(ci === columns.length - 1 ? { borderRight: 'none' } : {}),
                                                }}
                                            >
                                                {c.label}
                                            </SortableTh>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map((r: any, i: number) => {
                                        const key = rowKey(r);
                                        const open = expanded === key;
                                        return (
                                            <React.Fragment key={key}>
                                            <tr
                                                style={{ background: open ? rowStateBg('expanded', true) : lvZebra(true, i), borderBottom: '1px solid #e0ddd3', cursor: 'pointer' }}
                                                onClick={() => setExpanded(open ? null : key)}
                                            >
                                                <ExpanderCell classic expanded={open} onToggle={() => setExpanded(open ? null : key)} tdStyle={td} label="machine detail" />
                                                {columns.map((c, ci) => (
                                                    <td
                                                        key={c.key}
                                                        style={{
                                                            ...td,
                                                            ...(c.align === 'right' ? { textAlign: 'right' } : {}),
                                                            ...(ci === columns.length - 1 ? { borderRight: 'none', whiteSpace: 'nowrap' } : {}),
                                                        }}
                                                    >
                                                        {c.render(r)}
                                                    </td>
                                                ))}
                                            </tr>
                                            {open && (
                                                <tr style={{ background: '#ece9d8' }}>
                                                    <td
                                                        colSpan={columns.length + 1}
                                                        className={undefined}
                                                        style={{ padding: 6 }}
                                                    >
                                                        {detailPanel(r)}
                                                    </td>
                                                </tr>
                                            )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
