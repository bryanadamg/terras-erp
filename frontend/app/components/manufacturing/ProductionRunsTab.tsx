import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import ManufacturingSearchBar from './ManufacturingSearchBar';
import { FilterChipBar, ToolbarButton } from '../shared/shellTheme';
import Pager from '../shared/Pager';
import { useToast } from '../shared/Toast';
import { useData } from '../../context/DataContext';
import { statusChipStyle, useFloatingMenu, MenuTriggerButton, FloatingMenu, XPActionButton, ExpandedRowPanel, ExpandedRowPanelBody, ProgressBar, CodeChip, CODE_FONT, xpFont, TableSkeleton, SkeletonBar, useTableSkeletonMetrics, rowStateBg, StatusChip, CHIP_RADIUS, familyColor, VariantChip, SKEL_PAGE_ROWS } from '../shared/xpTheme';
import { lvSubTh, lvSubTd, lvSubTable, lvSubRow, ExpanderCell, LV_EXPANDER_COL_W, lvZebra, lvThead, lvTh, ResizableTable } from '../shared/listViewTheme';
import { API_BASE } from '../shared/apiBase';
const PRMaterialPullSheetModal = dynamic(() => import('./PRMaterialPullSheetModal'), { ssr: false });

// Column defs for the expanded row's material table. Module-level so the loading
// skeleton renders the SAME header, column count AND column widths as the real
// table — a placeholder of a different shape is just a different flash.
//
// `wc`/`wm` (classic / modern px) are what make the two states line up: the table
// is `tableLayout: 'fixed'`, so these widths hold whether the body carries bars or
// figures, and nothing reflows when the data lands. Item Name has no width — it
// flexes into whatever is left. `bar`/`sub` describe the placeholder for the
// column: bar width in px, and how wide the second line is on the rows that have
// one (Req shows a net figure, Available a lot count, MOs a "made" line).
const PR_MATERIAL_COLUMNS: {
    h: string; t: string; num: boolean;
    wc?: number; wm?: number; bar: number; sub?: number;
}[] = [
    { h: 'Item Code', t: '', num: false, wc: 158, wm: 184, bar: 110 },
    { h: 'Item Name', t: '', num: false, bar: 132 },
    { h: 'UOM', t: '', num: false, wc: 42, wm: 50, bar: 24 },
    { h: 'Req (fix)', t: 'Fixed requirement at full order qty — never decrements. Grey figure below it is the NET still required after what this run has already been issued.', num: true, wc: 74, wm: 88, bar: 44, sub: 36 },
    { h: 'Produced', t: 'Good output logged so far by this Production Run’s own MOs that make this item. Dash = nothing here produces it (bought or taken from stock).', num: true, wc: 74, wm: 88, bar: 42 },
    { h: 'Available', t: 'Physical on-hand across all locations (good stock only — QC-rejected lots excluded). Hover a figure to see the lots behind it.', num: true, wc: 78, wm: 92, bar: 46, sub: 30 },
    { h: 'Free', t: 'On-hand minus what every OTHER open order has already claimed. This is what this run can actually count on — “Available” alone shows the same stock to every run that needs it.', num: true, wc: 72, wm: 86, bar: 42 },
    { h: 'Incoming', t: 'Outstanding output of this Production Run’s own component MOs — already scheduled, not yet made.', num: true, wc: 74, wm: 88, bar: 40 },
    { h: 'Status', t: 'SHORT = material genuinely missing (nothing on hand, nothing scheduled) — needs action. NO WO = no work order opened on the producing MO yet. NOT STARTED = WO opened, nothing logged. IN PROGRESS = output logged, not finished. DONE = made in full. Dash = bought or taken from stock, covered.', num: false, wc: 148, wm: 172, bar: 96 },
    { h: 'MOs', t: 'needs = MOs consuming this component. made = MOs producing it (logged / target).', num: false, wc: 150, wm: 176, bar: 120, sub: 104 },
];

const prColWidth = (c: { wc?: number; wm?: number }) => (c.wc);

// Measured height of a real material row, kept module-level so it survives the
// panel unmounting: once the user has seen one loaded panel, every later skeleton
// stands exactly as tall as the rows it stands in for. Keyed by theme — a classic
// row is a good deal shorter than a modern one. Fallbacks are a two-line row,
// which is what most of these rows are (a net figure, a lot count or a "made"
// line puts a second line in about half of them).
const PR_ROW_H: Record<'c' | 'm', number> = { c: 27, m: 36 };

/** Placeholder body for the material table: same columns, same widths, same row
 *  height, and — when the batched Materials-column summary has already told us —
 *  the same NUMBER of rows as the table being fetched. */
function PRMaterialSkeletonRows({ rows, cellStyle, rowHeight }: {
    rows: number; cellStyle: React.CSSProperties; rowHeight: number;
}) {
    return (
        <>
            {Array.from({ length: rows }, (_, r) => (
                <tr key={`skel-${r}`} style={lvSubRow(r, { zebra: true })}>
                    {PR_MATERIAL_COLUMNS.map((c, ci) => {
                        // Deterministic, not random: the bars must not reshuffle on
                        // re-render while the fetch is in flight. Second lines land on
                        // roughly the share of rows that really carry one.
                        const showSub = !!c.sub && (r + ci) % 2 === 0;
                        const jitter = 1 - ((r * 3 + ci * 5) % 4) * 0.07;
                        return (
                            <td key={c.h} style={{
                                ...cellStyle,
                                height: rowHeight, boxSizing: 'border-box', verticalAlign: 'middle',
                            }}>
                                <div style={{
                                    display: 'flex', flexDirection: 'column', gap: 2,
                                    alignItems: c.num ? 'flex-end' : 'flex-start',
                                }}>
                                    <SkeletonBar width={Math.round(c.bar * jitter)} height={9} />
                                    {showSub && <SkeletonBar width={Math.round((c.sub || 0) * jitter)} height={7} />}
                                </div>
                            </td>
                        );
                    })}
                </tr>
            ))}
        </>
    );
}

export default function ProductionRunsTab({
    productionRuns,
    prPage,
    prTotal,
    setPrPage,
    pageSize,
    prSearch,
    setPrSearch,
    prSoFilter,
    setPrSoFilter,
    prProgressFilter,
    setPrProgressFilter,
    onDeleteProductionRun,
    canManage,
    companyProfile,
    helpers,
    onNewProductionRun,
    onPrint,
}: any) {
    const { showToast } = useToast();
    const router = useRouter();
    const { authFetch, loading: dataLoading } = useData();

    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('production-runs', listBodyRef, (productionRuns?.length ?? 0) > 0);
    const { getLocationName, getAttributeValueName, formatDate } = helpers;

    const [expandedPRs, setExpandedPRs] = useState<Record<string, boolean>>({});
    const [prMaterialReqs, setPrMaterialReqs] = useState<Record<string, any[]>>({});
    const [prMaterialReqsLoading, setPrMaterialReqsLoading] = useState<Record<string, boolean>>({});
    // Lightweight per-PR material summary (component counts + shortfall count) for the
    // Materials column. Fetched for ALL visible rows in ONE batched call, so the column
    // stays populated up front without the old per-row /material-requirements fan-out.
    const [prMaterialStatus, setPrMaterialStatus] = useState<Record<string, { total_count: number; shortfall_count: number; sufficient_count: number }>>({});
    const [prStatusLoading, setPrStatusLoading] = useState(false);
    const [printPreviewPR, setPrintPreviewPR] = useState<any>(null);
    const { openId: openPrMenuId, pos: prMenuPos, toggle: togglePrMenu, close: closePrMenu } = useFloatingMenu();

    const filteredProductionRuns = productionRuns || [];
    // Both filters are server-side (see /production-runs has_sales_order + progress) —
    // client-side narrowing would only filter the current page, not the whole result set.
    const filtersActive = !!prSoFilter || !!prProgressFilter;

    // Skeleton row height: seeded from the module-level cache (so it is already
    // right on a remount), then corrected by measuring the first real row the user
    // sees. Re-seeded on a theme switch because classic rows are denser.
    const [subRowHeight, setSubRowHeight] = useState<number>(PR_ROW_H['c']);
    useEffect(() => { setSubRowHeight(PR_ROW_H['c']); }, []);
    const measureSubRow = (el: HTMLTableRowElement | null) => {
        if (!el) return;
        const h = el.offsetHeight;
        const k = 'c';
        // Guarded so writing the measurement can't loop: only a real change lands.
        if (h > 8 && Math.abs(PR_ROW_H[k] - h) > 1) {
            PR_ROW_H[k] = h;
            setSubRowHeight(h);
        }
    };

    const fetchPRMaterialRequirements = async (prId: string) => {
        setPrMaterialReqsLoading(prev => ({ ...prev, [prId]: true }));
        try {
            const res = await authFetch(`${API_BASE}/production-runs/${prId}/material-requirements`);
            if (res.ok) {
                const data = await res.json();
                setPrMaterialReqs(prev => ({ ...prev, [prId]: data }));
            }
        } finally {
            setPrMaterialReqsLoading(prev => ({ ...prev, [prId]: false }));
        }
    };

    const togglePR = (prId: string) => {
        setExpandedPRs(prev => {
            const expanding = !prev[prId];
            // Rows already pulled stay cached — collapsing and re-opening the same PR
            // must not re-pay the round trip. The cache is dropped (and open panels
            // silently re-pulled) whenever the PR list itself refreshes, so a cached
            // panel can never show numbers older than the list around it.
            if (expanding && !prMaterialReqs[prId] && !prMaterialReqsLoading[prId]) {
                fetchPRMaterialRequirements(prId);
            }
            return { ...prev, [prId]: expanding };
        });
    };

    // Mirror of expandedPRs for the refresh effect below — reading it through a ref
    // keeps expandedPRs out of that effect's deps, so toggling a row doesn't
    // re-trigger a whole-page material refresh.
    const expandedRef = useRef<Record<string, boolean>>({});
    useEffect(() => { expandedRef.current = expandedPRs; }, [expandedPRs]);

    // The PR list re-fetching (page load, WS live event, paging, search) means the
    // cached requirement rows may be stale: drop them, and immediately re-pull the
    // panels the user actually has open. The old rows stay on screen during that
    // re-pull (the panel only shows its skeleton when it has nothing yet), so an
    // open panel refreshes in place instead of flashing empty.
    const prListSettled = useRef(false);
    useEffect(() => {
        if (!prListSettled.current) { prListSettled.current = true; return; }
        const open = Object.keys(expandedRef.current).filter(id => expandedRef.current[id]);
        setPrMaterialReqs(prev => {
            const next: Record<string, any[]> = {};
            for (const id of open) if (prev[id]) next[id] = prev[id];
            return next;
        });
        for (const id of open) fetchPRMaterialRequirements(id);
    }, [productionRuns]);

    // One batched call for the Materials column of every visible PR (replaces the
    // old per-row storm). Full material rows are still fetched lazily on expand/print.
    useEffect(() => {
        const ids = (productionRuns || []).map((pr: any) => pr.id);
        if (ids.length === 0) { setPrMaterialStatus({}); return; }
        let cancelled = false;
        (async () => {
            setPrStatusLoading(true);
            try {
                const res = await authFetch(`${API_BASE}/production-runs/material-status`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pr_ids: ids }),
                });
                if (res.ok && !cancelled) {
                    const data = await res.json();
                    const map: Record<string, any> = {};
                    for (const s of (data || [])) map[String(s.pr_id)] = s;
                    setPrMaterialStatus(map);
                }
            } finally {
                if (!cancelled) setPrStatusLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [productionRuns]);

    // Full material requirement ROWS are fetched lazily — only when a PR row is
    // expanded (togglePR) or printed (handlePrintPR). The old eager loop fired one
    // /material-requirements call per visible row on mount (up to `pageSize`
    // concurrent heavy queries), which dominated PR-page load on the low-power
    // backend. The Materials column's shortfall/sufficient COUNTS come from the
    // single batched /material-status call above instead.

    const handlePrintPR = (pr: any) => {
        if (!prMaterialReqs[pr.id] && !prMaterialReqsLoading[pr.id]) fetchPRMaterialRequirements(pr.id);
        setPrintPreviewPR(pr);
    };

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {printPreviewPR && (
                <PRMaterialPullSheetModal
                    pr={printPreviewPR}
                    reqs={prMaterialReqs[printPreviewPR.id] || []}
                    isLoading={!!prMaterialReqsLoading[printPreviewPR.id]}
                    companyProfile={companyProfile}
                    getLocationName={getLocationName}
                    getAttributeValueName={getAttributeValueName}
                    formatDate={formatDate}
                    onClose={() => setPrintPreviewPR(null)}
                />
            )}

            <ManufacturingSearchBar
                    value={prSearch}
                    onChange={setPrSearch}
                    placeholder="Search by code, style, or BOM..."
                    total={prTotal}
                    showCount={filtersActive}
                    actions={
                        <>
                            {canManage && (
                                <ToolbarButton tone="launch" icon="bi-collection-play" onClick={onNewProductionRun}>New Production Run</ToolbarButton>
                            )}
                            {onPrint && (
                                <ToolbarButton tone="neutral" icon="bi-printer" printable onClick={onPrint}>Print</ToolbarButton>
                            )}
                        </>
                    }
                    filters={
                        <>
                            <FilterChipBar
                                value={prSoFilter || ''}
                                onChange={(v: string) => setPrSoFilter?.(v === prSoFilter ? '' : v)}
                                options={[
                                    { value: '', label: 'All SO' },
                                    { value: 'with', label: 'With SO' },
                                    { value: 'without', label: 'No SO' },
                                ]}
                            />
                            <FilterChipBar
                                value={prProgressFilter || ''}
                                onChange={(v: string) => setPrProgressFilter?.(v === prProgressFilter ? '' : v)}
                                options={[
                                    { value: '', label: 'All Progress' },
                                    { value: 'complete', label: '100%' },
                                    { value: 'incomplete', label: 'Under 100%' },
                                ]}
                            />
                        </>
                    }
                />
            {/* The table renders while loading too, so the skeleton sits under the
                real header and inherits its columns instead of standing in for
                the whole table. */}
            {(productionRuns && productionRuns.length > 0) || dataLoading.productionRuns ? (
                <div className="table-responsive" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                    <ResizableTable style={{
                        width: '100%', borderCollapse: 'collapse',
                        // Fixed layout: column widths come from the header row only, so an
                        // expanded colSpan detail row (MO chips + nested material table) can
                        // never widen the columns. Prevents the width flash on expand/collapse
                        // when a PR has many linked MOs. BOM/Style has no width -> it flexes to
                        // absorb the remaining space.
                        tableLayout: 'fixed',
                        fontFamily: xpFont,
                        fontSize: '11px',
                        background: '#fff',
                    }}>
                        <thead style={{ ...lvThead(), fontSize: '10px'}}>
                            <tr>
                                {(() => {
                                    const colWidths: Record<string, string | undefined> = {
                                        '': `${LV_EXPANDER_COL_W}px`,
                                        'Code': '210px',
                                        'BOM / Style': undefined, // flexes
                                        'MOs': '48px',
                                        'Progress': '150px',
                                        'Status': '92px',
                                        'Materials': '130px',
                                        'Due Date': '92px',
                                        'Actions': '104px',
                                    };
                                    return ['', 'Code', 'BOM / Style', 'MOs', 'Progress', 'Status', 'Materials', 'Due Date', 'Actions'].map((h, i) => (
                                        <th key={h || `col-${i}`} style={{
                                            ...lvTh(),
                                            textAlign: h === 'Actions' ? 'right' : 'left',
                                            width: colWidths[h],
                                        }}>{h}</th>
                                    ));
                                })()}
                            </tr>
                        </thead>
                        <tbody ref={listBodyRef}>
                            {filteredProductionRuns.length === 0 && dataLoading.productionRuns && (
                                <TableSkeleton rows={SKEL_PAGE_ROWS} cols={skel.cols ?? 9} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                            )}
                            {filteredProductionRuns.map((pr: any, rowIdx: number) => {
                                const mos = pr.manufacturing_orders || [];
                                // DELIVERED = qty met, order not closed yet — still "done" for progress.
                                const done = mos.filter((m: any) => ['COMPLETED', 'DELIVERED'].includes(m.status)).length;
                                const total = mos.length;
                                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                                const rowBg = lvZebra(rowIdx);
                                const tdStyle: React.CSSProperties = {
                                    border: '1px solid #c0bdb5', padding: '4px 8px', color: '#000', verticalAlign: 'middle',
                                };
                                const isExpanded = !!expandedPRs[pr.id];
                                const reqs: any[] = prMaterialReqs[pr.id] || [];
                                const isLoading = !!prMaterialReqsLoading[pr.id];
                                // Materials column is driven by the batched summary; the
                                // full `reqs` (loaded on expand) only powers the detail panel.
                                const mstat = prMaterialStatus[pr.id];
                                const statusShort = mstat?.shortfall_count ?? 0;
                                const statusSuff = mstat?.sufficient_count ?? 0;
                                const statusTotal = mstat?.total_count ?? 0;
                                // Trust the backend verdict, not a raw float compare — sub-precision
                                // residue must never light this up (see _QTY_EPS server-side).
                                const hasShortfall = mstat ? statusShort > 0 : reqs.some((r: any) => (r.status ? r.status === 'SHORT' : r.shortfall > 0.005));
                                return (
                                    <React.Fragment key={pr.id}>
                                    <tr style={{ background: isExpanded ? rowStateBg('expanded') : rowBg, cursor: 'pointer' }} onClick={() => togglePR(pr.id)} title="Material Requirements">
                                        <ExpanderCell expanded={isExpanded} onToggle={() => togglePR(pr.id)} tdStyle={tdStyle} tone={hasShortfall ? 'alert' : 'default'} label="material requirements" />
                                        <td style={tdStyle}>
                                            <CodeChip code={pr.code} style={{ fontWeight: 'bold' }} />
                                            {pr.sales_order_id && (
                                                <div style={{ marginTop: 3 }}>
                                                    <span style={{
                                                        fontSize: '8px', background: '#dce8ff', border: '1px solid #9ab0e0',
                                                        color: '#003ea6', padding: '0 5px', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', fontFamily: xpFont,
                                                    }} title="Originating Sales Order">
                                                        <i className="bi bi-receipt me-1" style={{ fontSize: '7px'}}></i>SO: {pr.sales_order_code || '—'}
                                                    </span>
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ ...tdStyle, overflow: 'hidden' }}>
                                            <div style={{
                                                fontWeight: 'bold', fontSize: '11px',
                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            }} title={pr.bom_entries?.length > 0
                                                ? pr.bom_entries.map((e: any) => e.bom?.item_name || e.bom?.item_code || e.bom?.code).filter(Boolean).join(' / ')
                                                : (pr.bom?.item_name || pr.bom?.item_code || pr.bom?.code || pr.bom_id)}>
                                                {pr.bom_entries?.length > 0
                                                    ? pr.bom_entries.map((e: any) => e.bom?.item_name || e.bom?.item_code || e.bom?.code).filter(Boolean).join(' / ')
                                                    : (pr.bom?.item_name || pr.bom?.item_code || pr.bom?.code || pr.bom_id)}
                                            </div>
                                            {(pr.bom_entries?.length > 0
                                                ? pr.bom_entries.map((e: any) => e.bom?.code).filter(Boolean).join(' / ')
                                                : pr.bom?.code
                                            ) && (
                                                <CodeChip
                                                    tier={2}
                                                    style={{
                                                        display: 'block', maxWidth: '100%',
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    }}
                                                    code={pr.bom_entries?.length > 0
                                                        ? pr.bom_entries.map((e: any) => e.bom?.code).filter(Boolean).join(' / ')
                                                        : pr.bom?.code}
                                                />
                                            )}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>{total}</td>
                                        <td style={{ ...tdStyle, minWidth: 120 }}>
                                            <ProgressBar pct={pct} tone={pct === 100 ? 'green' : 'blue'} label="outside" />
                                            <div style={{ fontSize: 9, color: '#666' }}>{done}/{total} done</div>
                                        </td>
                                        <td style={tdStyle}>
                                            <StatusChip status={pr.status || 'PENDING'} />
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }} title={!mstat && prStatusLoading ? 'Loading material status...' : !mstat ? 'Material status unavailable' : statusTotal === 0 ? 'No components' : `${statusShort} short / ${statusSuff} sufficient`}>
                                            {!mstat && prStatusLoading ? (
                                                <span style={{ fontSize: 10, color: '#999' }}>…</span>
                                            ) : !mstat ? (
                                                <span style={{ fontSize: 10, color: '#bbb' }}>·</span>
                                            ) : statusTotal === 0 ? (
                                                <span style={{ fontSize: 10, color: '#999' }}>—</span>
                                            ) : (
                                                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 'bold', minWidth: 18, color: statusShort > 0 ? '#c00000' : '#ccc', opacity: statusShort > 0 ? 1 : 0.5 }}>
                                                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusShort > 0 ? '#c00000' : '#ccc', display: 'inline-block' }} />
                                                        {statusShort}
                                                    </span>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 'bold', minWidth: 18, color: statusSuff > 0 ? '#2d7a2d' : '#ccc', opacity: statusSuff > 0 ? 1 : 0.5 }}>
                                                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusSuff > 0 ? '#2d7a2d' : '#ccc', display: 'inline-block' }} />
                                                        {statusSuff}
                                                    </span>
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ ...tdStyle, fontSize: 10 }}>{formatDate(pr.target_end_date)}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                                                <XPActionButton
                                                    tone="primary"
                                                    icon="bi-printer"
                                                    title="Print Material Pull Sheet"
                                                    onClick={() => handlePrintPR(pr)}
                                                />
                                                <MenuTriggerButton onClick={(e) => togglePrMenu(pr.id, e)} />
                                            </div>
                                        </td>
                                    </tr>
                                    {isExpanded && (
                                        <tr>
                                            <td colSpan={9} className="p-0 border-0">
                                            <ExpandedRowPanel>
                                            <ExpandedRowPanelBody>
                                                {/* Empty message only once the pull has actually finished — while it
                                                    is in flight the real header renders over a skeleton body instead.
                                                    A background re-pull (list refresh) keeps the current rows on
                                                    screen and swaps them when the fresh ones land. */}
                                                {reqs.length === 0 && !isLoading ? (
                                                    <span style={{ fontSize: 11, color: '#999', fontFamily: xpFont}}>
                                                        No component requirements found for this Production Run.
                                                    </span>
                                                ) : (
                                                    <div>
                                                        {(() => {
                                                            const rootMos = mos.filter((mo: any) => !mo.is_shared_component);
                                                            if (rootMos.length === 0) return null;
                                                            return (
                                                                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                                    <span style={{ fontSize: 9, color: '#555', fontFamily: xpFont, marginRight: 2, whiteSpace: 'nowrap' }}>
                                                                        Linked MOs:
                                                                    </span>
                                                                    {rootMos.map((mo: any) => (
                                                                            <button
                                                                                key={mo.id}
                                                                                onClick={() => router.push(`/manufacturing-orders?mo=${encodeURIComponent(mo.code)}`)}
                                                                                title={`View ${mo.code} in Manufacturing Orders (${mo.status})`}
                                                                                style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
                                                                            >
                                                                                <CodeChip code={mo.code} link />
                                                                            </button>
                                                                        ))}
                                                                </div>
                                                            );
                                                        })()}
                                                        <div style={{ fontSize: 10, fontWeight: 'bold', marginBottom: 4, fontFamily: xpFont, color: '#333' }}>
                                                            {/* While the rows are in flight the count comes from the batched
                                                                material-status summary, which counts the same components the
                                                                detail rows are built from — so the caption doesn't have to
                                                                appear late or change when the table lands. */}
                                                            {(() => {
                                                                const n = reqs.length || statusTotal;
                                                                return `Consolidated Material Requirements${n ? ` — ${n} component${n !== 1 ? 's' : ''}` : ''}`;
                                                            })()}
                                                            {hasShortfall && <span style={{ marginLeft: 8, color: '#c00000', fontWeight: 'bold' }}>SHORTFALL DETECTED</span>}
                                                            {(() => {
                                                                // Production roll-up: how many made-here components are DONE. Amber,
                                                                // never red — a run in progress is expected to be unfinished.
                                                                const made = reqs.filter((r: any) => (r.production_mos || []).length > 0);
                                                                if (made.length === 0) return null;
                                                                const done = made.filter((r: any) => r.status === 'DONE').length;
                                                                // Components whose producing MO has no work order yet — the user's own
                                                                // next action, so it earns its own badge rather than hiding in a row.
                                                                const noWo = made.filter((r: any) => r.status === 'NO_WO').length;
                                                                return (
                                                                    <>
                                                                        <span style={{ marginLeft: 8, color: done === made.length ? '#2d7a2d' : '#1b5e9c', fontWeight: 'bold' }}>
                                                                            PRODUCTION {done}/{made.length} DONE
                                                                        </span>
                                                                        {noWo > 0 && (
                                                                            <span style={{ marginLeft: 8, color: '#a05a00', fontWeight: 'bold' }} title="Producing MOs with no work order opened yet">
                                                                                {noWo} NO WO
                                                                            </span>
                                                                        )}
                                                                    </>
                                                                );
                                                            })()}
                                                        </div>
                                                        {/* Fixed layout so the column widths come from PR_MATERIAL_COLUMNS
                                                            rather than from whatever the body happens to hold: the skeleton
                                                            and the loaded grid then occupy identical geometry and nothing
                                                            shifts when the figures arrive. */}
                                                        <table style={{ ...lvSubTable(), tableLayout: 'fixed' }}>
                                                            <thead>
                                                                <tr>
                                                                    {PR_MATERIAL_COLUMNS.map((col) => (
                                                                        // Full cell borders, not lvSubTd's single rule: at 10 columns
                                                                        // this reads as a grid and the verticals do real work.
                                                                        <th key={col.h} title={col.t || undefined} style={{ ...lvSubTh(), textAlign: col.num ? 'right' : 'left', border: '1px solid #808080', cursor: col.t ? 'help' : undefined, width: prColWidth(col) }}>{col.h}</th>
                                                                    ))}
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {reqs.length === 0 && (
                                                                    <PRMaterialSkeletonRows
                                                                        // Exact row count: the batched material-status call has
                                                                        // already counted this PR's components (total_count is the
                                                                        // same aggregate the detail rows come from), so the
                                                                        // placeholder is as tall as the table replacing it. Only
                                                                        // when that summary is missing does it fall back to a guess.
                                                                        rows={Math.max(1, Math.min(statusTotal || 3, 30))}
                                                                        rowHeight={subRowHeight}
                                                                        cellStyle={{
                                                                            ...lvSubTd(),
                                                                            border: '1px solid #c0bdb5',
                                                                        }}
                                                                    />
                                                                )}
                                                                {reqs.map((req: any, ri: number) => {
                                                                    // Row tint = genuine material shortage only. Epsilon-guarded so a
                                                                    // zero gap can't paint the row red (the "SHORT 0.00" bug).
                                                                    const short = req.status ? req.status === 'SHORT' : req.shortfall > 0.005;
                                                                    // Zebra is opt-in per sub-table; this grid is wide enough to earn
                                                                    // it. The shortage tint is passed as `fill` so it overrides the
                                                                    // stripe rather than alternating with it.
                                                                    const rowStyle = lvSubRow(ri, {
                                                                        zebra: true,
                                                                        fill: short ? ('#fff0f0') : undefined,
                                                                    });
                                                                    const cellStyle: React.CSSProperties = {
                                                                        ...lvSubTd(),
                                                                        border: '1px solid #c0bdb5',
                                                                        verticalAlign: 'middle',
                                                                    };
                                                                    const gross = parseFloat(req.gross_required ?? req.total_required);
                                                                    const net = parseFloat(req.total_required);
                                                                    // Consumed-so-far is the gap between the full-order requirement and what is
                                                                    // still outstanding — spell it out so a dropping "Available" reads as
                                                                    // material issued to this run, not as material going missing.
                                                                    const issued = gross - net;
                                                                    const incoming = parseFloat(req.qty_incoming ?? 0);
                                                                    // Production progress: only rows this PR actually makes carry producing MOs.
                                                                    const prodMos = req.production_mos || [];
                                                                    const isMade = prodMos.length > 0;
                                                                    const produced = parseFloat(req.qty_produced ?? 0);
                                                                    const prodShort = parseFloat(req.production_shortfall ?? 0);
                                                                    // One verdict per row, from the backend `status`. Colours follow the
                                                                    // app's 5 semantic families (xpTheme STATUS_FAMILY): red = stopped,
                                                                    // amber = needs attention, blue = active, green = done, grey = inactive.
                                                                    // Red is reserved for material genuinely missing, so it always means
                                                                    // "act on this" — never "a healthy run isn't finished yet".
                                                                    const woCount = prodMos.reduce((n: number, m: any) => n + (m.wo_count || 0), 0);
                                                                    const status = req.status || (short ? 'SHORT' : isMade ? (prodShort > 0.005 ? (produced > 0.005 ? 'IN_PROGRESS' : (woCount > 0 ? 'NOT_STARTED' : 'NO_WO')) : 'DONE') : 'SUPPLIED');
                                                                    const STATUS_UI: Record<string, { color: string; text: string; title: string }> = {
                                                                        SHORT: {
                                                                            color: familyColor('red'),
                                                                            text: `SHORT ${parseFloat(req.shortfall).toFixed(2)}`,
                                                                            title: `Missing ${parseFloat(req.shortfall).toFixed(2)} ${req.uom}: ${net.toFixed(2)} still required, ${parseFloat(req.qty_available).toFixed(2)} on hand, ${incoming.toFixed(2)} scheduled.`,
                                                                        },
                                                                        NO_WO: {
                                                                            color: familyColor('amber'),
                                                                            text: 'NO WO',
                                                                            title: `No work order opened yet on ${prodMos.map((m: any) => m.mo_code).join(', ') || 'the producing MO'} — nothing has been dispatched to the floor.`,
                                                                        },
                                                                        NOT_STARTED: {
                                                                            color: familyColor('gray'),
                                                                            text: 'NOT STARTED',
                                                                            title: `Work order opened (${woCount}) but no output logged yet.`,
                                                                        },
                                                                        IN_PROGRESS: {
                                                                            color: familyColor('blue'),
                                                                            text: `IN PROGRESS ${produced.toFixed(2)}/${gross.toFixed(2)}`,
                                                                            title: `Still being produced — ${prodShort.toFixed(2)} ${req.uom} to go. Material for it is covered, so this is on plan, not a shortage.`,
                                                                        },
                                                                        DONE: { color: familyColor('green'), text: 'DONE', title: 'Requirement has been produced in full.' },
                                                                        SUPPLIED: { color: familyColor('gray'), text: '—', title: 'Not produced by this Production Run — bought or drawn from stock, and covered.' },
                                                                    };
                                                                    const ui = STATUS_UI[status] || STATUS_UI.SUPPLIED;
                                                                    const statusColor = ui.color;
                                                                    const needsList = req.mo_contributions || [];
                                                                    const needsTotal = needsList.reduce((sum: number, c: any) => sum + parseFloat(c.required_qty || 0), 0);
                                                                    const needsDetail = needsList.map((c: any) => `${c.mo_code} (${parseFloat(c.required_qty).toFixed(2)})`).join('\n');
                                                                    const madeTotalProduced = prodMos.reduce((sum: number, m: any) => sum + parseFloat(m.qty_produced || 0), 0);
                                                                    const madeTotalQty = prodMos.reduce((sum: number, m: any) => sum + parseFloat(m.mo_qty || 0), 0);
                                                                    const madeNoWoCount = prodMos.filter((m: any) => (m.wo_count || 0) === 0).length;
                                                                    const madeDetail = prodMos.map((m: any) => `${m.mo_code} (${parseFloat(m.qty_produced).toFixed(2)}/${parseFloat(m.mo_qty).toFixed(2)}${(m.wo_count || 0) === 0 ? ', no WO' : ''})`).join('\n');
                                                                    return (
                                                                        // First row is measured (see measureSubRow) so the next
                                                                        // skeleton is exactly this tall.
                                                                        <tr key={ri} ref={ri === 0 ? measureSubRow : undefined} style={rowStyle}>
                                                                            {/* Backstop for a code even longer than the widened column:
                                                                                clip instead of letting CodeChip's nowrap span bleed
                                                                                into Item Name (fixed layout won't grow the cell for it).
                                                                                Full code still available via CodeChip's own title. */}
                                                                            <td style={{ ...cellStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><CodeChip code={req.item_code} /></td>
                                                                            <td style={cellStyle}>
                                                                                {req.item_name}
                                                                                {/* Netting is size-aware, so a sized component yields one
                                                                                    row per size — without the chip they read as duplicates. */}
                                                                                {req.size_label && (
                                                                                    <VariantChip kind="size"
                                                                                        title={`Size: ${req.size_label} — netted separately from other sizes`}>
                                                                                        {req.size_label}
                                                                                    </VariantChip>
                                                                                )}
                                                                            </td>
                                                                            <td style={cellStyle}>{req.uom}</td>
                                                                            <td
                                                                                style={{ ...cellStyle, textAlign: 'right', fontFamily: CODE_FONT, cursor: issued > 0.0001 ? 'help' : undefined }}
                                                                                title={issued > 0.0001
                                                                                    ? `Full order requirement ${gross.toFixed(2)} ${req.uom} − ${issued.toFixed(2)} already issued to this run = ${net.toFixed(2)} still required`
                                                                                    : undefined}
                                                                            >
                                                                                {gross.toFixed(2)}
                                                                                {issued > 0.0001 && (
                                                                                    <div style={{ color: '#777', fontWeight: 'normal', fontSize: 9}}>
                                                                                        {net.toFixed(2)} net
                                                                                    </div>
                                                                                )}
                                                                            </td>
                                                                            <td
                                                                                style={{ ...cellStyle, textAlign: 'right', fontFamily: CODE_FONT, color: statusColor, fontWeight: isMade ? 'bold' : undefined, cursor: isMade ? 'help' : undefined }}
                                                                                title={isMade
                                                                                    ? prodMos.map((m: any) => `${m.mo_code}: ${parseFloat(m.qty_produced).toFixed(2)} / ${parseFloat(m.mo_qty).toFixed(2)} ${m.status} — ${m.wo_count || 0} WO`).join('\n')
                                                                                    : 'Not produced by this Production Run — bought or drawn from stock.'}
                                                                            >
                                                                                {isMade ? produced.toFixed(2) : '—'}
                                                                            </td>
                                                                            <td
                                                                                style={{ ...cellStyle, textAlign: 'right', fontFamily: CODE_FONT, cursor: (req.lots || []).length ? 'help' : undefined }}
                                                                                title={(req.lots || []).length
                                                                                    ? (req.lots || []).map((l: any) => `${l.batch_number}: ${parseFloat(l.qty).toFixed(2)}${l.location_name ? ` @ ${l.location_name}` : ''}`).join('\n')
                                                                                    : 'On hand but not lot-tracked, so there are no lots to list.'}
                                                                            >
                                                                                {parseFloat(req.qty_available).toFixed(2)}
                                                                                {(req.lots || []).length > 0 && (
                                                                                    <div style={{ color: '#777', fontWeight: 'normal', fontSize: 9}}>
                                                                                        {(req.lots || []).length} lot{(req.lots || []).length === 1 ? '' : 's'}
                                                                                    </div>
                                                                                )}
                                                                            </td>
                                                                            {(() => {
                                                                                const avail = parseFloat(req.qty_available ?? 0);
                                                                                const claimed = parseFloat(req.qty_claimed_elsewhere ?? 0);
                                                                                const free = parseFloat(req.qty_free ?? avail);
                                                                                // Amber only when other orders are the reason it is not
                                                                                // free — plain zero stock is the Available column's story.
                                                                                const squeezed = claimed > 0.005 && free < avail - 0.005;
                                                                                return (
                                                                                    <td
                                                                                        style={{ ...cellStyle, textAlign: 'right', fontFamily: CODE_FONT, color: squeezed ? '#b8860b' : undefined, fontWeight: squeezed ? 'bold' : undefined, cursor: claimed > 0.005 ? 'help' : undefined }}
                                                                                        title={claimed > 0.005
                                                                                            ? `${claimed.toFixed(2)} ${req.uom} of the ${avail.toFixed(2)} on hand is already claimed by other open orders.`
                                                                                            : undefined}
                                                                                    >
                                                                                        {free.toFixed(2)}
                                                                                    </td>
                                                                                );
                                                                            })()}
                                                                            <td
                                                                                style={{ ...cellStyle, textAlign: 'right', fontFamily: CODE_FONT, color: incoming > 0 ? '#1b5e9c' : '#999' }}
                                                                                title={incoming > 0
                                                                                    ? (req.supply_mos || []).map((s: any) => `${s.mo_code} (${parseFloat(s.incoming_qty).toFixed(2)})`).join(', ')
                                                                                    : undefined}
                                                                            >
                                                                                {incoming > 0 ? incoming.toFixed(2) : '—'}
                                                                            </td>
                                                                            <td
                                                                                // Fixed column: keep the verdict on one line, and clip
                                                                                // rather than spill into MOs if a long IN PROGRESS
                                                                                // figure pair outgrows the column (full text is in the
                                                                                // tooltip either way).
                                                                                style={{ ...cellStyle, fontFamily: CODE_FONT, color: ui.color, fontWeight: status === 'SUPPLIED' ? undefined : 'bold', cursor: 'help', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                                                                title={ui.title}
                                                                            >
                                                                                {ui.text}
                                                                            </td>
                                                                            <td style={{ ...cellStyle, fontSize: 9, color: '#555' }}>
                                                                                <div title={needsDetail || undefined} style={{ cursor: needsList.length ? 'help' : undefined }}>
                                                                                    <span style={{ color: '#888' }}>needs:</span> {needsList.length} MO{needsList.length === 1 ? '' : 's'} ({needsTotal.toFixed(2)} total)
                                                                                </div>
                                                                                {isMade && (
                                                                                    <div title={madeDetail || undefined} style={{ cursor: 'help' }}>
                                                                                        <span style={{ color: '#888' }}>made:</span>{' '}
                                                                                        {prodMos.length} MO{prodMos.length === 1 ? '' : 's'} · {madeTotalProduced.toFixed(2)}/{madeTotalQty.toFixed(2)}{madeNoWoCount > 0 ? `, ${madeNoWoCount} no WO` : ''}
                                                                                    </div>
                                                                                )}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </ExpandedRowPanelBody>
                                            </ExpandedRowPanel>
                                            </td>
                                        </tr>
                                    )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </ResizableTable>
                </div>
            ) : (
                <div style={{
                    padding: '32px', textAlign: 'center',
                    fontFamily: xpFont,
                    fontSize: '11px',
                    color: '#888',
                }}>
                    <i className="bi bi-collection-play" style={{ fontSize: 32, display: 'block', marginBottom: 8, opacity: 0.4 }}></i>
                    {prSearch
                        ? <>No Production Runs match "<strong>{prSearch}</strong>"{filtersActive ? ' with the selected filters' : ''}.</>
                        : filtersActive
                            ? <>No Production Runs match the selected filters.</>
                            : <>No Production Runs yet. Click <strong>New Production Run</strong> to get started.</>}
                </div>
            )}
            <Pager page={prPage} total={prTotal} pageSize={pageSize} onPageChange={setPrPage} hideWhenEmpty />
            {/* Floating "more actions" menu — Delete */}
            {openPrMenuId && (() => {
                const menuPR = (productionRuns || []).find((p: any) => p.id === openPrMenuId);
                if (!menuPR) return null;
                return (
                    <FloatingMenu
                        pos={prMenuPos}
                        items={[
                            { key: 'delete', icon: 'bi-trash', label: 'Delete', danger: true, hidden: !canManage, onClick: () => { closePrMenu(); onDeleteProductionRun(menuPR.id); } },
                        ]}
                    />
                );
            })()}
        </div>
    );
}
