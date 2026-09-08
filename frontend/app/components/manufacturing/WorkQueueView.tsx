'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useData } from '../../context/DataContext';
import { useTimezone } from '../../context/TimezoneContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import { ShellWindow, ShellTitleBar, SearchField, FilterChipBar, ToolbarCount, xpToolbar } from '../shared/shellTheme';
import { lvTh, lvThead, lvTd, lvRow, lvBtn, lvSubTable, lvSubTh, lvSubTd, lvSubRow, TableEmpty, LV_XP_FONT, LV_MODERN_FONT, ExpanderCell, LV_EXPANDER_COL_W } from '../shared/listViewTheme';
import {
    StatusChip, XPStatusBar, XPEmptyState, TableSkeleton, CodeChip,
    ExpandedRowPanel, ExpandedRowPanelBody, statusColor, WorkCenterChip, ToggleChip, rowStateBg, XP_BTN,
} from '../shared/xpTheme';
import Pager from '../shared/Pager';
import { fmtQtyCompact } from '../shared/format';

/**
 * Work-center dispatch queue — the PIC's screen.
 *
 * One work-center type at a time, scheduled order, each row carrying a readiness
 * verdict computed server-side (services/work_queue_service.py). The numbers are
 * ALLOCATED, not raw on-hand: the "available" a row shows is what was left after
 * every higher-priority order took its share, so three colour variants drawing on
 * one greige pool can never all read READY.
 *
 * Deliberately read-only. Staging, mounting and logging stay on the Work Orders
 * page and the scanner — this view answers "what can I start next?", nothing else.
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api')
    .replace(/\/api$/, '') + '/api';

const PAGE_SIZE = 50;

interface QueueMaterial {
    item_id: string;
    item_code: string | null;
    item_name: string | null;
    uom: string | null;
    required_qty: number;
    staged_qty: number;
    on_hand_qty: number;
    allocated_qty: number;
    shortfall_qty: number;
    is_beam: boolean;
    is_substrate: boolean;
    mounted_pcs: number;
    required_pcs: number;
    incoming_qty: number;
    incoming_mo_code: string | null;
    incoming_eta: string | null;
}

interface QueueLot {
    batch_id: string | null;
    batch_number: string | null;
    qty: number;
    location_name: string | null;
}

interface MaterialSummary {
    item_id: string;
    item_code: string | null;
    item_name: string | null;
    uom: string | null;
    on_hand_qty: number;
    required_total: number;
    allocated_total: number;
    staged_total: number;
    free_qty: number;
    shortfall_total: number;
    orders_total: number;
    orders_waiting: number;
    lot_count: number;
    lots: QueueLot[];
}

interface QueueRow {
    work_order_id: string | null;
    work_order_code: string | null;
    work_order_name: string | null;
    status: string;
    sequence: number | null;
    staging_status: string;
    is_released: boolean;
    release_hint_source: string;
    work_center_id: string | null;
    work_center_name: string | null;
    work_center_type: string | null;
    mo_id: string;
    mo_code: string | null;
    item_code: string | null;
    item_name: string | null;
    color_name: string | null;
    qty: number;
    target_start_date: string | null;
    priority_date: string | null;
    date_source: string;
    is_overdue: boolean;
    verdict: string;
    verdict_detail: string | null;
    substrate_item_code: string | null;
    substrate_uom: string | null;
    substrate_is_beam: boolean;
    substrate_required_qty: number;
    substrate_available_qty: number;
    chemical_shortfall_count: number;
    materials: QueueMaterial[];
}

// Verdict order in the filter bar: what the PIC can act on first, blockers last.
const VERDICTS = ['RUNNING', 'STAGED', 'READY', 'PARTIAL', 'WAITING_UPSTREAM', 'SHORT', 'NO_MATERIALS', 'NOT_RELEASED'];

const VERDICT_HELP: Record<string, string> = {
    RUNNING: 'Already started on the floor.',
    STAGED: 'Material is physically on the line — start any time.',
    READY: 'Enough free stock is reserved for this order. Stage it and go.',
    PARTIAL: 'Some material is available, not all of it.',
    WAITING_UPSTREAM: 'Material is on a production order that has not finished yet.',
    SHORT: 'No free stock and nothing incoming.',
    NO_MATERIALS: 'No BOM materials resolved for this step.',
    NOT_RELEASED: 'The order exists but no work order has been created, so nobody on the floor can start it. Create the work order to release it.',
};

// How an unreleased row's work centre was decided. "routing" is read from the BOM;
// the others are inferences and are labelled as such on the row.
const HINT_LABEL: Record<string, string> = {
    routing: 'from BOM routing',
    bom: 'from BOM work centre',
    colour: 'inferred from assigned colour',
    beam: 'inferred from beam output',
    unknown: 'work centre unknown',
};

const num = fmtQtyCompact;
// The unit is declared once per row, on its leading qty — Item.uom is per item, so
// every other figure on the same row reads in it. Repeating it six times is noise.
const withUom = (v: number, uom: string | null | undefined, classic: boolean) => (
    <>
        {num(v)}
        {uom ? <span style={{ color: '#888', marginLeft: 3, fontSize: classic ? 9 : 10 }}>{uom}</span> : null}
    </>
);

// Where the queue date came from. The PIC must be able to tell a real plan date
// from a stand-in — "created" means nobody scheduled the order and the row is
// sitting in order-entry (FIFO) position, which is a schedule only by courtesy.
const DATE_SOURCE_LABEL: Record<string, string> = {
    wo_start: 'WO start',
    wo_end: 'WO end',
    mo_start: 'MO start',
    mo_end: 'MO end',
    so_due: 'Customer due',
    created: 'not scheduled',
};

const ellipsis: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

export default function WorkQueueView() {
    const { uiStyle } = useTheme();
    // Backend timestamps are naive UTC; formatCustom parses them as such and
    // renders in the user's display timezone. `new Date(iso)` read them as local.
    const { formatCustom: tzFmt } = useTimezone();
    const shortDate = (iso: string | null) =>
        iso ? tzFmt(iso, { day: '2-digit', month: 'short' }) : '—';
    const classic = uiStyle === 'classic';
    const { authFetch, workCenters, subscribeLiveEvents } = useData();

    const [showMaterials, setShowMaterials] = useState(false);
    const [centerType, setCenterType] = useState('');
    const [verdict, setVerdict] = useState('');
    const [sort, setSort] = useState<'date' | 'readiness'>('date');
    const [overdueOnly, setOverdueOnly] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);

    // Center-type tabs come from the work-center master, not a hardcoded list —
    // an install that renamed DYEING to CELUP still gets its own tab.
    const centerTypes = useMemo(() => {
        const seen = new Set<string>();
        (workCenters || []).forEach((wc: any) => {
            const t = (wc.center_type || '').trim();
            if (t) seen.add(t.toUpperCase());
        });
        return Array.from(seen).sort();
    }, [workCenters]);

    // Page window, the debounced search box, the loading flag and the stale-response
    // race guard all come from the shared hook (context/usePaginatedList.ts). The queue
    // is computed server-side, but the wire contract is a plain `{items,total,page,size}`
    // list, so it retrofits directly; the per-queue extras (verdict counts, the material
    // panel, the overdue/undated/unreleased tallies) ride back in `meta`.
    const {
        rows, total, meta, loading, page, setPage,
        searchInput: search, setSearch: onSearch, refetch: fetchQueue,
    } = usePaginatedFetch<QueueRow>({
        endpoint: `${API_BASE}/work-queue`,
        authFetch,
        pageSize: PAGE_SIZE,
        params: {
            sort,
            center_type: centerType,
            verdict,
            overdue_only: overdueOnly,
        },
    });

    const counts: Record<string, number> = meta.counts || {};
    const overdueCount: number = meta.overdue_count || 0;
    const undatedCount: number = meta.undated_count || 0;
    const unreleasedCount: number = meta.unreleased_count || 0;
    const materials: MaterialSummary[] = meta.materials || [];

    // The whole point of the screen is that the PIC never refreshes it: an upstream
    // completion lands greige, the event arrives, the verdicts re-render. One flush
    // usually carries BOTH kinds (a completion books stock), so the reload is
    // coalesced — otherwise every logged bag costs two full queue rebuilds.
    // `fetchQueue` is the hook's `refetch`: it re-runs the CURRENT page and filters,
    // which is what the old default-argument `fetchQueue()` call did, and being stable
    // it no longer re-subscribes on every filter change.
    const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => subscribeLiveEvents(['production', 'stock'], () => {
        if (liveTimer.current) clearTimeout(liveTimer.current);
        liveTimer.current = setTimeout(() => fetchQueue(), 150);
    }), [subscribeLiveEvents, fetchQueue]);
    useEffect(() => () => { if (liveTimer.current) clearTimeout(liveTimer.current); }, []);

    // No setPage(1) in any of these — the hook restarts at page 1 whenever a param
    // changes, which is also what keeps the two from drifting out of step.
    const onCenterType = (v: string) => {
        setCenterType(v === centerType ? '' : v);
        setExpanded(null);
    };
    const onVerdict = (v: string) => setVerdict(v === verdict ? '' : v);
    const onSort = (v: string) => setSort(v === 'readiness' ? 'readiness' : 'date');
    const onOverdueOnly = () => setOverdueOnly(v => !v);

    const startable = (counts.READY || 0) + (counts.STAGED || 0);
    const blocked = (counts.SHORT || 0) + (counts.WAITING_UPSTREAM || 0);

    const font = classic ? LV_XP_FONT : LV_MODERN_FONT;

    const Toolbar = (
        <div style={xpToolbar({ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' })}>
            <SearchField
                classic={classic} value={search} onChange={onSearch}
                placeholder="WO, order, item, colour..." width={220}
            />
            <FilterChipBar
                classic={classic}
                options={centerTypes.map(t => ({ value: t, label: t }))}
                value={centerType}
                onChange={onCenterType}
            />
            <ToolbarCount classic={classic} right>
                {startable} startable · {blocked} blocked · {unreleasedCount} need a work order · {total} shown
            </ToolbarCount>
        </div>
    );

    const VerdictBar = (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '4px 8px', borderBottom: classic ? '1px solid #a0a0a0' : '1px solid #e5e9f0',
            background: classic ? '#f4f2ec' : '#fbfcfe',
        }}>
            <FilterChipBar
                classic={classic}
                options={VERDICTS.filter(v => counts[v]).map(v => ({
                    value: v, label: v.replace(/_/g, ' '), count: counts[v],
                }))}
                value={verdict}
                onChange={onVerdict}
            />
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                {overdueCount > 0 && (
                    <ToggleChip on={overdueOnly} onClick={onOverdueOnly} classic={classic}
                        title="Only orders past their planned date and not yet started">
                        <span style={{ color: overdueOnly ? undefined : statusColor('SHORT'), fontWeight: 'bold' }}>
                            Overdue
                        </span>
                        <span style={{ opacity: 0.75, fontWeight: 'normal', marginLeft: 4 }}>({overdueCount})</span>
                    </ToggleChip>
                )}
                <span style={{ fontFamily: font, fontSize: classic ? 11 : 12, color: '#555' }}>Sort</span>
                <FilterChipBar
                    classic={classic}
                    options={[{ value: 'date', label: 'By date' }, { value: 'readiness', label: 'By readiness' }]}
                    value={sort}
                    onChange={onSort}
                />
            </span>
        </div>
    );

    // Stock-side answer to "which greige can I dye?", straight off the same
    // allocation walk as the list, so the two can never disagree. Collapsed by
    // default — the order list is the primary view; this is the backing evidence.
    const MaterialPanel = materials.length > 0 && (
        <div style={{ borderBottom: classic ? '1px solid #a0a0a0' : '1px solid #e5e9f0' }}>
            <button
                onClick={() => setShowMaterials(v => !v)}
                className={XP_BTN}
                style={{
                    ...lvBtn(classic), width: '100%', textAlign: 'left', border: 'none',
                    background: classic ? '#ece9d8' : '#f8fafc', padding: '4px 8px',
                    display: 'flex', alignItems: 'center', gap: 6,
                }}
            >
                <i className={`bi ${showMaterials ? 'bi-chevron-down' : 'bi-chevron-right'}`} />
                <strong>Material on hand</strong>
                <span style={{ color: '#666' }}>
                    {materials.length} gating item{materials.length === 1 ? '' : 's'} ·{' '}
                    {materials.filter(m => m.shortfall_total > 0).length} short
                </span>
            </button>
            {showMaterials && (
                <div style={{ maxHeight: 220, overflowY: 'auto', background: '#ffffff' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: font, fontSize: classic ? 11 : 12 }}>
                        <thead style={lvThead(classic, true)}>
                            <tr>
                                <th style={lvTh(classic)}>Material</th>
                                <th style={{ ...lvTh(classic), textAlign: 'right' }}>On hand</th>
                                <th style={{ ...lvTh(classic), textAlign: 'right' }}
                                    title="Issued to a work order's input location. Counts material already consumed there, so it can exceed on-hand.">
                                    Staged</th>
                                <th style={{ ...lvTh(classic), textAlign: 'right' }}>Claimed</th>
                                <th style={{ ...lvTh(classic), textAlign: 'right' }}>Free</th>
                                <th style={{ ...lvTh(classic), textAlign: 'right' }}>Short</th>
                                <th style={{ ...lvTh(classic), textAlign: 'right' }}>Orders</th>
                                <th style={lvTh(classic)}>Lots</th>
                            </tr>
                        </thead>
                        <tbody>
                            {materials.map((m, i) => (
                                <tr key={m.item_id} style={lvRow(classic, i)}>
                                    <td style={lvTd(classic)}>
                                        <strong>{m.item_code || '—'}</strong>
                                        <span style={{ color: '#666', marginLeft: 6 }}>{m.item_name}</span>
                                    </td>
                                    <td style={{ ...lvTd(classic), textAlign: 'right' }}>{withUom(m.on_hand_qty, m.uom, classic)}</td>
                                    <td style={{ ...lvTd(classic), textAlign: 'right', color: '#666' }}>
                                        {num(m.staged_total)}
                                    </td>
                                    <td style={{ ...lvTd(classic), textAlign: 'right' }}>{num(m.allocated_total)}</td>
                                    <td style={{
                                        ...lvTd(classic), textAlign: 'right', fontWeight: 'bold',
                                        color: m.free_qty > 0 ? statusColor('READY') : '#888',
                                    }}>{num(m.free_qty)}</td>
                                    <td style={{
                                        ...lvTd(classic), textAlign: 'right',
                                        color: m.shortfall_total > 0 ? statusColor('SHORT') : undefined,
                                        fontWeight: m.shortfall_total > 0 ? 'bold' : 'normal',
                                    }}>{m.shortfall_total > 0 ? num(m.shortfall_total) : '—'}</td>
                                    <td style={{ ...lvTd(classic), textAlign: 'right' }}>
                                        {m.orders_waiting > 0
                                            ? `${m.orders_waiting} / ${m.orders_total} waiting`
                                            : m.orders_total}
                                    </td>
                                    <td style={lvTd(classic)}>
                                        {m.lot_count === 0
                                            ? <span style={{ color: '#888' }}>not lotted</span>
                                            : m.lots.map(l => (
                                                <span key={(l.batch_id || '') + String(l.qty)}
                                                    title={l.location_name || ''}
                                                    style={{ marginRight: 8, whiteSpace: 'nowrap' }}>
                                                    {l.batch_number} <strong>{num(l.qty)}</strong>
                                                </span>
                                            ))}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );

    // Said out loud rather than implied: when most rows have no planned date the
    // queue is FIFO by order entry, and a PIC reading it as a schedule would be
    // reading precision that isn't in the data.
    const UndatedNotice = undatedCount > 0 && (
        <div style={{
            padding: '3px 8px', fontFamily: font, fontSize: classic ? 10 : 11,
            color: '#7a4a00', background: '#fff3cd',
            borderBottom: classic ? '1px solid #b8860b' : '1px solid #f0e0b0',
        }}>
            <i className="bi bi-info-circle" style={{ marginRight: 5 }} />
            {undatedCount} of {Object.values(counts).reduce((a, b) => a + b, 0)} orders have no planned
            date — those rows are ordered by when the order was created, not by schedule.
            Set target dates on the work order or its MO to place them properly.
        </div>
    );

    const renderMaterials = (r: QueueRow) => (
        <ExpandedRowPanel classic={classic}>
            <ExpandedRowPanelBody classic={classic}>
                <table style={lvSubTable(classic)}>
                    <thead>
                        <tr>
                            <th style={lvSubTh(classic)}>Material</th>
                            <th style={{ ...lvSubTh(classic), textAlign: 'right' }}>Required</th>
                            <th style={{ ...lvSubTh(classic), textAlign: 'right' }}>Staged</th>
                            <th style={{ ...lvSubTh(classic), textAlign: 'right' }}>Free pool</th>
                            <th style={{ ...lvSubTh(classic), textAlign: 'right' }}>Allocated</th>
                            <th style={{ ...lvSubTh(classic), textAlign: 'right' }}>Short</th>
                            <th style={lvSubTh(classic)}>Incoming</th>
                        </tr>
                    </thead>
                    <tbody>
                        {r.materials.length === 0 && (
                            <TableEmpty
                                colSpan={7}
                                classic={classic}
                                message="No materials resolved for this step."
                                tdStyle={lvSubTd(classic)}
                            />
                        )}
                        {r.materials.map((m, i) => (
                            <tr key={m.item_id + String(i)} style={lvSubRow(classic, i)}>
                                <td style={lvSubTd(classic)}>
                                    <span style={{ fontWeight: m.is_substrate ? 'bold' : 'normal' }}>
                                        {m.item_code || '—'}
                                    </span>
                                    <span style={{ color: '#666', marginLeft: 6 }}>{m.item_name}</span>
                                    {m.is_substrate && (
                                        <span style={{ marginLeft: 6, fontSize: 9, color: '#0058e6', fontWeight: 'bold' }}>
                                            GATES
                                        </span>
                                    )}
                                </td>
                                {m.is_beam ? (
                                    <>
                                        {/* Warp is loom-mounted, never staged to the WO, so Staged is
                                            n/a and Free pool / Allocated are the kg left on the mounts.
                                            Slot counts are deliberately not shown. */}
                                        <td style={{ ...lvSubTd(classic), textAlign: 'right' }}>{withUom(m.required_qty, m.uom, classic)}</td>
                                        <td style={{ ...lvSubTd(classic), textAlign: 'right' }}>{'—'}</td>
                                        <td style={{ ...lvSubTd(classic), textAlign: 'right' }}>{num(m.on_hand_qty)}</td>
                                        <td style={{ ...lvSubTd(classic), textAlign: 'right' }}>{num(m.allocated_qty)}</td>
                                        <td style={{
                                            ...lvSubTd(classic), textAlign: 'right',
                                            // Amber, not red: a warp running out mid-run is normal — the
                                            // floor mounts the next beam — so it must not read like a
                                            // blocking substrate shortfall.
                                            color: m.required_qty - m.on_hand_qty > 1e-6 ? '#b8860b' : undefined,
                                        }}>
                                            {m.required_qty - m.on_hand_qty > 1e-6
                                                ? num(m.required_qty - m.on_hand_qty)
                                                : '—'}
                                        </td>
                                        <td style={lvSubTd(classic)}>
                                            {m.required_qty - m.on_hand_qty > 1e-6
                                                ? 'mounted · runs out mid-order'
                                                : 'mounted on loom'}
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td style={{ ...lvSubTd(classic), textAlign: 'right' }}>{withUom(m.required_qty, m.uom, classic)}</td>
                                        <td style={{ ...lvSubTd(classic), textAlign: 'right' }}>{num(m.staged_qty)}</td>
                                        <td style={{ ...lvSubTd(classic), textAlign: 'right' }}>{num(m.on_hand_qty)}</td>
                                        <td style={{ ...lvSubTd(classic), textAlign: 'right' }}>{num(m.allocated_qty)}</td>
                                        <td style={{
                                            ...lvSubTd(classic), textAlign: 'right',
                                            color: m.shortfall_qty > 0 ? statusColor('SHORT') : undefined,
                                            fontWeight: m.shortfall_qty > 0 ? 'bold' : 'normal',
                                        }}>{m.shortfall_qty > 0 ? num(m.shortfall_qty) : '—'}</td>
                                        <td style={lvSubTd(classic)}>
                                            {m.incoming_qty > 0
                                                ? `${num(m.incoming_qty)} on ${m.incoming_mo_code || 'order'}${m.incoming_eta ? ` · ${shortDate(m.incoming_eta)}` : ''}`
                                                : '—'}
                                        </td>
                                    </>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div style={{ marginTop: 6, fontSize: classic ? 10 : 11, color: '#666' }}>
                    Free pool is what remained after higher-priority orders in this queue took their share —
                    not the plant total for the item.
                </div>
            </ExpandedRowPanelBody>
        </ExpandedRowPanel>
    );

    return (
        <ShellWindow classic={classic} fill="page" className="fade-in">
            <ShellTitleBar
                classic={classic}
                icon="bi-list-ol"
                title="Work Queue"
                subtitle="Orders ready to start at each work centre. Material is allocated in scheduled order, so two orders never claim the same stock."
            />
            {Toolbar}
            {Object.keys(counts).length > 0 && VerdictBar}
            {UndatedNotice}
            {MaterialPanel}

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#ffffff' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: font, fontSize: classic ? 11 : 13 }}>
                    {/* Fixed widths, independent of row content — otherwise switching center-type/verdict
                        filters (which change what each row's cells contain) reflows column widths. */}
                    <colgroup>
                        <col style={{ width: LV_EXPANDER_COL_W }} />
                        <col style={{ width: 34 }} />
                        <col style={{ width: 110 }} />
                        <col style={{ width: 220 }} />
                        <col style={{ width: 70 }} />
                        <col style={{ width: 110 }} />
                        <col style={{ width: 55 }} />
                        <col style={{ width: 170 }} />
                        <col style={{ width: 60 }} />
                        <col style={{ width: 60 }} />
                        <col style={{ width: 95 }} />
                        <col style={{ width: 150 }} />
                    </colgroup>
                    <thead style={lvThead(classic, true)}>
                        <tr>
                            <th style={lvTh(classic)}></th>
                            <th style={{ ...lvTh(classic), textAlign: 'right' }}>#</th>
                            <th style={lvTh(classic)}>Work Order</th>
                            <th style={lvTh(classic)}>Order / Item</th>
                            <th style={lvTh(classic)}>Colour</th>
                            <th style={lvTh(classic)}>Work Centre</th>
                            <th style={{ ...lvTh(classic), textAlign: 'right' }}>Qty</th>
                            <th style={lvTh(classic)}>Gating Material</th>
                            <th style={{ ...lvTh(classic), textAlign: 'right' }}>Need</th>
                            <th style={{ ...lvTh(classic), textAlign: 'right' }}>Have</th>
                            <th style={lvTh(classic)}>Scheduled</th>
                            <th style={lvTh(classic)}>Verdict</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && rows.length === 0 && <TableSkeleton rows={8} cols={12} classic={classic} />}
                        {!loading && rows.length === 0 && (
                            <tr><td colSpan={12}>
                                <XPEmptyState
                                    icon="bi-list-ol"
                                    message={centerType
                                        ? `No open work orders at ${centerType}.`
                                        : 'No open work orders. Create work orders on the Work Orders page to populate the queue.'}
                                />
                            </td></tr>
                        )}
                        {rows.map((r, i) => {
                            const rowKey = r.work_order_id || r.mo_id;
                            const open = expanded === rowKey;
                            const short = r.substrate_required_qty - r.substrate_available_qty;
                            return (
                                <React.Fragment key={rowKey}>
                                    <tr
                                        style={{
                                            ...lvRow(classic, i),
                                            ...(open ? { background: rowStateBg('expanded', classic) } : {}),
                                            cursor: 'pointer',
                                            borderLeft: `3px solid ${statusColor(r.verdict)}`,
                                        }}
                                        onClick={() => setExpanded(open ? null : rowKey)}
                                    >
                                        <ExpanderCell classic={classic} expanded={open} onToggle={() => setExpanded(open ? null : rowKey)} label="work order detail" />
                                        <td style={{ ...lvTd(classic), textAlign: 'right', color: '#888' }}>
                                            {(page - 1) * PAGE_SIZE + i + 1}
                                        </td>
                                        <td style={{ ...lvTd(classic), overflow: 'hidden' }}>
                                            {r.is_released ? (
                                                <>
                                                    <div style={ellipsis}><CodeChip code={r.work_order_code || '—'} classic={classic} /></div>
                                                    <div style={{ ...ellipsis, fontSize: classic ? 10 : 11, color: '#666' }}>{r.work_order_name}</div>
                                                </>
                                            ) : (
                                                <>
                                                    <span style={{
                                                        fontSize: classic ? 10 : 11, fontWeight: 'bold',
                                                        color: statusColor('NOT_RELEASED'),
                                                    }}>NO WORK ORDER</span>
                                                    <div style={{ ...ellipsis, fontSize: classic ? 9 : 10, color: '#888' }}>
                                                        {HINT_LABEL[r.release_hint_source] || r.release_hint_source}
                                                    </div>
                                                </>
                                            )}
                                        </td>
                                        <td style={{ ...lvTd(classic), overflow: 'hidden' }}>
                                            <div style={ellipsis}><CodeChip code={r.mo_code || '—'} classic={classic} tier={2} /></div>
                                            <div style={{ ...ellipsis, fontSize: classic ? 10 : 11, color: '#666' }}>
                                                {r.item_code} {r.item_name ? `· ${r.item_name}` : ''}
                                            </div>
                                        </td>
                                        <td style={{ ...lvTd(classic), ...ellipsis }}>{r.color_name || '—'}</td>
                                        <td style={{ ...lvTd(classic), overflow: 'hidden' }}>
                                            <WorkCenterChip type={r.work_center_type} name={r.work_center_name} />
                                        </td>
                                        <td style={{ ...lvTd(classic), textAlign: 'right' }}>{num(r.qty)}</td>
                                        <td style={{ ...lvTd(classic), ...ellipsis }}>
                                            {r.substrate_item_code || '—'}
                                            {r.chemical_shortfall_count > 0 && (
                                                <span
                                                    title="Auxiliary chemicals are short. They do not block the order — expand to see which."
                                                    style={{ marginLeft: 6, fontSize: 9, fontWeight: 'bold', color: '#b8860b' }}
                                                >+{r.chemical_shortfall_count} CHEM</span>
                                            )}
                                        </td>
                                        <td style={{ ...lvTd(classic), textAlign: 'right' }}>
                                            {withUom(r.substrate_required_qty, r.substrate_uom, classic)}
                                        </td>
                                        <td style={{
                                            ...lvTd(classic), textAlign: 'right',
                                            color: short > 1e-6 ? statusColor('SHORT') : undefined,
                                            fontWeight: short > 1e-6 ? 'bold' : 'normal',
                                        }}>
                                            {num(r.substrate_available_qty)}
                                        </td>
                                        <td style={lvTd(classic)} title={DATE_SOURCE_LABEL[r.date_source] || r.date_source}>
                                            <span style={{
                                                color: r.is_overdue ? statusColor('SHORT') : undefined,
                                                fontWeight: r.is_overdue ? 'bold' : 'normal',
                                            }}>
                                                {shortDate(r.priority_date)}
                                                {r.is_overdue && <i className="bi bi-exclamation-triangle-fill" style={{ marginLeft: 4 }} />}
                                            </span>
                                            <div style={{
                                                fontSize: classic ? 9 : 10,
                                                color: r.date_source === 'created' ? '#b8860b' : '#888',
                                            }}>{DATE_SOURCE_LABEL[r.date_source] || r.date_source}</div>
                                        </td>
                                        <td style={lvTd(classic)} title={VERDICT_HELP[r.verdict] || ''}>
                                            <StatusChip status={r.verdict} />
                                            {r.verdict_detail && (
                                                <div style={{ fontSize: classic ? 10 : 11, color: '#666', marginTop: 2 }}>
                                                    {r.verdict_detail}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                    {open && (
                                        <tr>
                                            <td colSpan={12} style={{ padding: 0 }}>{renderMaterials(r)}</td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <Pager page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
            <XPStatusBar right={`${centerType || 'All work centres'} · sorted by ${sort === 'date' ? 'schedule' : 'readiness'}`}>
                {startable} startable · {counts.PARTIAL || 0} partial · {blocked} blocked · {overdueCount} overdue · {unreleasedCount} unreleased
            </XPStatusBar>
        </ShellWindow>
    );
}
