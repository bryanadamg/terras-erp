'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useData } from '../../context/DataContext';
import { isoDate } from '../shared/format';
import { useTimezone } from '../../context/TimezoneContext';
import { useToast } from '../shared/Toast';
import { ShellWindow, ShellTitleBar, xpToolbar as sharedXpToolbar, ToolbarButton } from '../shared/shellTheme';
import {
    lvTh, lvThead, lvRow, lvBtn, lvInput, lvLabel, lvSep, LvSectionCaption, LV_XP_FONT, LV_MODERN_FONT,
    SortableTh,
} from '../shared/listViewTheme';
import {
    StatusChip, TableBlockSkeleton, XPStatusBar, XPEmptyState, useSortable,
    familyColor, familyTint, xpPanel, type StatusFamily, XP_BTN,
} from '../shared/xpTheme';

/**
 * Sample development report — attempt-grain, not status-grain.
 *
 * The client asks: over a date range, how many variants did we touch, how many
 * times did we run the sample process, how many times was a variant rejected,
 * how many times approved. Those are counts of logged transitions
 * (`sample_color_events`), so a variant rejected twice before approval reads as
 * 3 processes / 2 rejects / 1 approval. A variant's current status can never
 * answer that, which is why this view never derives numbers from the samples
 * list in DataContext — it always reads GET /samples/report.
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api')
    .replace(/\/api$/, '') + '/api';

const iso = isoDate;   // calendar-field formatting: toISOString() would shift the range by a day
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };

type Preset = 'month' | 'last30' | 'quarter' | 'year';

const presetRange = (p: Preset): [string, string] => {
    const today = new Date();
    if (p === 'month') return [iso(monthStart()), iso(today)];
    if (p === 'last30') { const from = new Date(); from.setDate(from.getDate() - 29); return [iso(from), iso(today)]; }
    if (p === 'quarter') {
        const q = Math.floor(today.getMonth() / 3) * 3;
        return [iso(new Date(today.getFullYear(), q, 1)), iso(today)];
    }
    return [iso(new Date(today.getFullYear(), 0, 1)), iso(today)];
};

const GROUP_LABEL: Record<string, string> = { customer: 'Customer', category: 'Category', month: 'Month' };

// Scroll region under a section caption — both tables on this page own their scroll
// so neither can push the other off the window.
const SCROLL_BODY: React.CSSProperties = {
    flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', background: '#ffffff',
};

export default function SampleReportView() {
    const { authFetch, partners, attributes } = useData();
    const { formatDateTime: tzDateTime } = useTimezone();
    const { showToast } = useToast();

    const [[defFrom, defTo]] = useState<[string, string]>(() => presetRange('month'));
    const [dateFrom, setDateFrom] = useState(defFrom);
    const [dateTo, setDateTo] = useState(defTo);
    const [customerId, setCustomerId] = useState('');
    const [categoryValueId, setCategoryValueId] = useState('ALL');
    const [groupBy, setGroupBy] = useState<'customer' | 'category' | 'month'>('customer');
    const [report, setReport] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const customers = useMemo(
        () => (partners as any[]).filter((p: any) => p.type === 'CUSTOMER'),
        [partners],
    );
    const categoryOptions = useMemo(() => {
        const attr = (attributes as any[]).find((a: any) => a.system_role === 'sample_category');
        return (attr?.values ?? []).map((v: any) => ({ id: String(v.id), label: v.value as string }));
    }, [attributes]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const qs = new URLSearchParams({ group_by: groupBy });
            if (dateFrom) qs.set('date_from', dateFrom);
            if (dateTo) qs.set('date_to', dateTo);
            if (customerId) qs.set('customer_id', customerId);
            if (categoryValueId && categoryValueId !== 'ALL') qs.set('category_value_id', categoryValueId);
            const res = await authFetch(`${API_BASE}/samples/report?${qs.toString()}`);
            if (!res.ok) throw new Error(String(res.status));
            setReport(await res.json());
        } catch {
            showToast('Failed to load sample report', 'danger');
            setReport(null);
        } finally {
            setLoading(false);
        }
    }, [authFetch, dateFrom, dateTo, customerId, categoryValueId, groupBy, showToast]);

    useEffect(() => { load(); }, [load]);

    const totals = report?.totals ?? {
        variants: 0, requests: 0, processes: 0, sent: 0, approvals: 0, rejects: 0,
        approval_rate: 0, avg_processes_per_variant: 0,
    };
    const rows: any[] = report?.rows ?? [];
    const groups: any[] = report?.groups ?? [];

    const { sorted, sort, toggle } = useSortable(rows, {
        sample_code: r => r.sample_code,
        variant_name: r => r.variant_name,
        customer_name: r => r.customer_name || '',
        processes: r => r.processes,
        rejects: r => r.rejects,
        approvals: r => r.approvals,
        status: r => r.status,
        last_event_at: r => r.last_event_at || '',
    }, { key: 'last_event_at', dir: -1 });

    const applyPreset = (p: Preset) => { const [f, t] = presetRange(p); setDateFrom(f); setDateTo(t); };

    const exportCsv = () => {
        const head = ['Sample', 'Customer', 'Article', 'Category', 'Variant', 'Repeat', 'Processes', 'Sent', 'Rejected', 'Approved', 'Current Status', 'Last Activity'];
        const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const body = sorted.map((r: any) => [
            r.sample_code, r.customer_name || '', r.customer_article_code || '', r.category || '',
            r.variant_name, r.is_repeat ? 'Yes' : 'No', r.processes, r.sent, r.rejects, r.approvals,
            r.status, r.last_event_at ? tzDateTime(r.last_event_at) : '',
        ].map(esc).join(','));
        const csv = [head.map(esc).join(','), ...body].join('\r\n');
        const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `sample-report_${dateFrom || 'all'}_${dateTo || 'all'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // ── KPI tiles ────────────────────────────────────────────────────────────
    // Tones come from the shared five-family palette (familyTint/familyColor) — a
    // measurement carrying a health signal, same rule as the dashboard panels. No
    // per-view hex map.
    const TILES: { key: string; label: string; value: React.ReactNode; hint: string; family: StatusFamily }[] = [
        { key: 'variants', label: 'Variants', value: totals.variants, hint: 'Distinct variants with activity in range', family: 'blue' },
        { key: 'processes', label: 'Processed', value: totals.processes, hint: 'Times a variant was put In Production', family: 'amber' },
        { key: 'sent', label: 'Sent', value: totals.sent, hint: 'Times a variant was sent to the customer', family: 'blue' },
        { key: 'approvals', label: 'Approved', value: totals.approvals, hint: 'Times a variant was approved', family: 'green' },
        { key: 'rejects', label: 'Rejected', value: totals.rejects, hint: 'Times a variant was rejected (a reopened variant can be rejected again)', family: 'red' },
        { key: 'rate', label: 'Approval Rate', value: `${totals.approval_rate}%`, hint: 'Approvals as a share of decided attempts (approved + rejected)', family: 'green' },
        { key: 'avg', label: 'Runs / Variant', value: totals.avg_processes_per_variant, hint: 'Process runs per variant — above 1 means remakes', family: 'gray' },
    ];

    const KpiTiles = () => (
        <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, flexShrink: 0,
            padding: '6px 8px',
            ...(xpPanel({ borderBottom: '1px solid #a0988c' })),
        }}>
            {TILES.map(tile => {
                const tint = familyTint(tile.family);
                return (
                    <div
                        key={tile.key}
                        title={tile.hint}
                        style={{
                            background: tint.background, border: `1px solid ${tint.borderColor}`,
                            boxShadow: 'inset 1px 1px 0 #ffffff', padding: '5px 8px',
                            fontFamily: LV_XP_FONT,
                        }}
                    >
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: tint.color, opacity: 0.85 }}>
                            {tile.label}
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 'bold', color: tint.color, lineHeight: 1.2 }}>
                            {tile.value}
                        </div>
                    </div>
                );
            })}
        </div>
    );

    // ── Filters ──────────────────────────────────────────────────────────────
    // One flat row. `lvLabel` is a block-level form label (marginBottom, display:block);
    // inline it here so a caption sits *beside* its field instead of pushing the row
    // taller, and drop the toolbar gradient so the bar reads as a flat strip.
    const inlineLabel: React.CSSProperties = {
        ...lvLabel(), display: 'inline-block', marginBottom: 0, whiteSpace: 'nowrap',
    };

    const Filters = () => (
        <div style={sharedXpToolbar({ background: '#ece9d8', padding: '5px 8px', gap: 5, flexShrink: 0 })}>
            <span style={inlineLabel}>From</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                style={lvInput({ width: 128 })} />
            <span style={inlineLabel}>To</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                style={lvInput({ width: 128 })} />

            <div style={lvSep()} />
            {([['month', 'This Month'], ['last30', 'Last 30 Days'], ['quarter', 'This Quarter'], ['year', 'This Year']] as [Preset, string][]).map(([p, label]) => (
                <button key={p} type="button" onClick={() => applyPreset(p)}
                    style={lvBtn()} className={XP_BTN}>{label}</button>
            ))}

            <div style={lvSep()} />
            <select value={customerId} onChange={e => setCustomerId(e.target.value)}
                style={lvInput({ width: 168 })}>
                <option value="">All Customers</option>
                {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={categoryValueId} onChange={e => setCategoryValueId(e.target.value)}
                style={lvInput({ width: 140 })}>
                <option value="ALL">All Categories</option>
                {categoryOptions.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <select value={groupBy} onChange={e => setGroupBy(e.target.value as any)}
                style={lvInput({ width: 132 })}
                title="Summary grouping">
                <option value="customer">By Customer</option>
                <option value="category">By Category</option>
                <option value="month">By Month</option>
            </select>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={inlineLabel}>
                    <b>{rows.length}</b> variant rows
                </span>
                <ToolbarButton classic tone="neutral" icon="bi-arrow-clockwise" title="Reload" onClick={load}>Refresh</ToolbarButton>
                <ToolbarButton classic tone="neutral" icon="bi-download" disabled={!rows.length} title="Download the variant table as CSV" onClick={exportCsv}>Export CSV</ToolbarButton>
            </div>
        </div>
    );

    // ── Summary table (grouped) ──────────────────────────────────────────────
    // Capped scroll region: the group list grows with the customer/category count,
    // and unbounded it ate the whole window and squeezed the variant table below it
    // down to a two-row sliver.
    const SummaryTable = () => (
        <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, maxHeight: '32%', minHeight: 92 }}>
            <LvSectionCaption icon="bi-bar-chart-steps" right={`${groups.length} ${groups.length === 1 ? 'group' : 'groups'}`}>
                Summary by {GROUP_LABEL[groupBy]}
            </LvSectionCaption>
            <div style={SCROLL_BODY}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={lvThead()}>
                        <tr>
                            <th style={lvTh()}>{GROUP_LABEL[groupBy]}</th>
                            <th style={{ ...lvTh(), width: 90, textAlign: 'right' }}>Variants</th>
                            <th style={{ ...lvTh(), width: 90, textAlign: 'right' }}>Processed</th>
                            <th style={{ ...lvTh(), width: 80, textAlign: 'right' }}>Sent</th>
                            <th style={{ ...lvTh(), width: 90, textAlign: 'right' }}>Approved</th>
                            <th style={{ ...lvTh(), width: 90, textAlign: 'right' }}>Rejected</th>
                            <th style={{ ...lvTh(), width: 110, textAlign: 'right', borderRight: 'none' }}>Approval %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groups.map((g: any, i: number) => (
                            <tr key={g.label} style={lvRow(i)}>
                                <td style={{ padding: '3px 8px', fontFamily: LV_XP_FONT, fontSize: 11, fontWeight: 'bold' }}>{g.label}</td>
                                <td style={{ padding: '3px 8px', textAlign: 'right', fontSize: 11 }}>{g.variants}</td>
                                <td style={{ padding: '3px 8px', textAlign: 'right', fontSize: 11 }}>{g.processes}</td>
                                <td style={{ padding: '3px 8px', textAlign: 'right', fontSize: 11 }}>{g.sent}</td>
                                <td style={{ padding: '3px 8px', textAlign: 'right', fontSize: 11, color: familyColor('green'), fontWeight: 'bold' }}>{g.approvals}</td>
                                <td style={{ padding: '3px 8px', textAlign: 'right', fontSize: 11, color: familyColor('red'), fontWeight: 'bold' }}>{g.rejects}</td>
                                <td style={{ padding: '3px 8px', textAlign: 'right', fontSize: 11 }}>{g.approval_rate}%</td>
                            </tr>
                        ))}
                        {!groups.length && (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 14, fontSize: 11, fontStyle: 'italic', color: '#666' }}>
                                No activity in this range
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    // ── Variant table ────────────────────────────────────────────────────────
    const Th = ({ colKey, label, width, align }: { colKey: string; label: string; width?: number; align?: 'right' }) => (
        <SortableTh sort={sort} colKey={colKey} onSort={toggle} style={{ ...lvTh(), width, textAlign: align }}>
            {label}
        </SortableTh>
    );

    const countCell = (n: number, tone: string) => (
        <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: LV_XP_FONT, fontSize: 11 }}>
            {n > 0
                ? <span style={{ color: tone, fontWeight: 'bold' }}>{n}{n > 1 ? '×' : ''}</span>
                : <span style={{ color: '#aaa' }}>—</span>}
        </td>
    );

    const VariantTable = () => (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 150 }}>
            <LvSectionCaption icon="bi-list-ul" right={`${sorted.length} ${sorted.length === 1 ? 'row' : 'rows'}`}>
                Variant Detail
            </LvSectionCaption>
            <div style={SCROLL_BODY}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <thead style={lvThead()}>
                        <tr>
                            <Th colKey="sample_code" label="Sample" width={130} />
                            <Th colKey="customer_name" label="Customer" width={150} />
                            <Th colKey="variant_name" label="Variant" />
                            <Th colKey="processes" label="Processed" width={90} align="right" />
                            <Th colKey="sent" label="Sent" width={70} align="right" />
                            <Th colKey="rejects" label="Rejected" width={90} align="right" />
                            <Th colKey="approvals" label="Approved" width={90} align="right" />
                            <Th colKey="status" label="Now" width={110} />
                            <Th colKey="last_event_at" label="Last Activity" width={140} />
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((r: any, i: number) => (
                            <tr key={r.color_id} style={lvRow(i)}>
                                <td style={{ padding: '3px 8px', fontFamily: LV_XP_FONT, fontSize: 11, fontWeight: 'bold', color: familyColor('blue') }}>
                                    {r.sample_code}
                                </td>
                                <td style={{ padding: '3px 8px', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.customer_name || ''}>
                                    {r.customer_name || '—'}
                                </td>
                                <td style={{ padding: '3px 8px', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    title={`${r.variant_name}${r.customer_article_code ? ` · ${r.customer_article_code}` : ''}`}>
                                    {r.variant_name}
                                    {r.is_repeat && (
                                        <span style={{
                                            marginLeft: 5, fontSize: 9, padding: '0 3px', border: '1px solid',
                                            ...familyTint('amber'),
                                        }}>REPEAT</span>
                                    )}
                                </td>
                                {countCell(r.processes, familyColor('amber'))}
                                {countCell(r.sent, familyColor('blue'))}
                                {countCell(r.rejects, familyColor('red'))}
                                {countCell(r.approvals, familyColor('green'))}
                                <td style={{ padding: '3px 8px' }}><StatusChip status={r.status} tint /></td>
                                <td style={{ padding: '3px 8px', fontSize: 10, color: '#555' }}>
                                    {r.last_event_at ? tzDateTime(r.last_event_at) : '—'}
                                </td>
                            </tr>
                        ))}
                        {!sorted.length && !loading && (
                            <tr><td colSpan={9} style={{ padding: 0 }}>
                                <XPEmptyState message="No sample activity in this date range" icon="bi-graph-up" />
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const rangeLabel = `${dateFrom || 'start'} → ${dateTo || 'today'}`;

    return (
        <ShellWindow classic fill="page" className="fade-in">
            <ShellTitleBar
                classic
                icon="bi-clipboard-data"
                title="Sample Development Report"
                subtitle="Attempt counts per variant over a date range — processes, rejections and approvals are event counts, so a remade variant contributes more than one."
                right={<span style={{ fontFamily: LV_XP_FONT, fontSize: 11, color: '#fff'}}>{rangeLabel}</span>}
            />
            <Filters />
            <KpiTiles />
            {/* Column counts match SummaryTable (7) and VariantTable (9) so the
                report lands in the skeleton's columns instead of replacing it. */}
            {loading && !report
                ? <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <TableBlockSkeleton cols={7} rows={4} classic />
                    <TableBlockSkeleton cols={9} rows={10} classic />
                </div>
                : <><SummaryTable /><VariantTable /></>}
            <XPStatusBar right={`Range ${rangeLabel}`}>
                {totals.requests} requests · {totals.variants} variants · {totals.processes} processed · {totals.approvals} approved · {totals.rejects} rejected
            </XPStatusBar>
        </ShellWindow>
    );
}
