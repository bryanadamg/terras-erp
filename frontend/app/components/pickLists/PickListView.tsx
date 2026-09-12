'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useData } from '../../context/DataContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import { useTheme } from '../../context/ThemeContext';
import { useUser } from '../../context/UserContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useToast } from '../shared/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { LotChip, LotChips, LotChipRow } from '../shared/LotChips';
import { XPStatusBar, XPEmptyState, TableSkeleton, useTableSkeletonMetrics, StatusChip, useFloatingMenu, MenuTriggerButton, FloatingMenu, ExpandedRowPanel, XPActionButton, CODE_FONT, rowStateBg, CHIP_RADIUS, XP_BTN, ProgressBar, useSortable } from '../shared/xpTheme';
import { LV_XP_FONT, lvBtn, lvInput, lvTd, lvLabel, lvRow, lvSubTh, lvSubTd, lvSubRow, ExpanderCell, lvThSticky, lvSubTable, RowCheckboxCell, LV_CHECK_COL_W, SortableTh } from '../shared/listViewTheme';
import { ShellWindow, ShellTitleBar, xpToolbar } from '../shared/shellTheme';
import Pager from '../shared/Pager';
import ModalWrapper from '../shared/ModalWrapper';
import { Tabs } from '../shared/Tabs';
const PickListPrintModal = dynamic(() => import('./PickListPrintModal'), { ssr: false });
import TreeSelect, { buildLocationPickerTree } from '../shared/TreeSelect';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace(/\/api$/, '') + '/api';

// ── Classic XP theme primitives (match StockOnHandView / LocationsView) ──────
// This view has no modern-theme branch yet (renders the classic look always,
// regardless of the user's theme setting) — inherited from the packing view this
// was split out of, tracked separately.
const xpFont = LV_XP_FONT;
const xpInput: React.CSSProperties = lvInput(true);
const xpSelect: React.CSSProperties = { ...xpInput, height: 22 };
const xpTableHeader: React.CSSProperties = lvThSticky(true);
const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => lvBtn(true, 'default', extra);
const xpBtnGreen = (extra: React.CSSProperties = {}) => lvBtn(true, 'success', extra);
const rowStyle = (idx: number): React.CSSProperties => lvRow(true, idx);
const td: React.CSSProperties = lvTd(true);
const xpLabel: React.CSSProperties = lvLabel(true);

const num = (v: any) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const PL_PAGE_SIZE = 20;
const OPEN_STATUSES = ['DRAFT', 'PICKING', 'PICKED'];
type PLTab = 'lists' | 'topick';

export default function PickListView() {
    // partners/locations/attributes/companyProfile/itemIndex come from DataContext
    // master data (loaded on initial app load). Pick lists, sales orders and stock
    // balances are all fetched here scoped to what's actually on screen.
    const { partners, locations, attributes, companyProfile, itemIndex, authFetch } = useData();
    const { uiStyle } = useTheme();
    const { formatDate: tzDate, formatDateTime: tzDateTime } = useTimezone();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const { hasPermission } = useUser();
    const canManage = hasPermission('sales.manage');

    // Two surfaces for one planner: "To Pick" is the release board (which order
    // do I cut a list for next), "Pick Lists" is the register of lists already
    // cut. Same user, same permission — tabs, not separate pages.
    //
    // The board lands first: opening this page is nearly always "what should ship
    // next", and the Pick row on the board is the only way to create a list, so
    // the register is the follow-up view rather than the entry point.
    const [tab, setTab] = useState<PLTab>('topick');

    // Page window, fetch, loading flag and the stale-response race guard all come
    // from the shared hook (context/usePaginatedList.ts). No filters on this list —
    // the register shows every pick list, newest first.
    const {
        rows: pickLists, total: plTotal, loading, page: plPage, setPage: setPlPage,
        refetch: reloadPickLists,
    } = usePaginatedFetch<any>({
        endpoint: `${API_BASE}/pick-lists`,
        authFetch,
        pageSize: PL_PAGE_SIZE,
    });

    const [openCount, setOpenCount] = useState(0);
    const [dispatchedCount, setDispatchedCount] = useState(0);
    // Only loaded once the release board is opened — `pickable-orders` scores
    // every open SO line by line, so it is not cheap enough to prefetch for a
    // tab badge the user may never look at.
    const [pickableSOs, setPickableSOs] = useState<any[]>([]);
    const [pickableLoading, setPickableLoading] = useState(false);
    const [pickableLoaded, setPickableLoaded] = useState(false);
    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('pick-lists', listBodyRef, pickLists.length > 0);
    const [editing, setEditing] = useState<any | null>(null);
    // Kartu Picking — the floor card, distinct from the Surat Jalan above it.
    const [printCard, setPrintCard] = useState<any | null>(null);
    // One row open at a time, same as the packing order and WO lists.
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const { openId: menuOpenId, pos: menuPos, toggle: menuToggle, close: menuClose } = useFloatingMenu(160);

    const itemById = useMemo(() => {
        const m: Record<string, any> = {};
        Object.entries(itemIndex || {}).forEach(([id, v]: [string, any]) => { m[id] = { id, ...v }; });
        return m;
    }, [itemIndex]);

    const locPickerTreeOptions = useMemo(() => buildLocationPickerTree(locations || []), [locations]);
    const locationById = useMemo(() => {
        const m: Record<string, any> = {};
        (locations || []).forEach((l: any) => { m[String(l.id)] = l; });
        return m;
    }, [locations]);

    // Cheap total-only lookups (size=1) for the status-bar counts.
    const loadCounts = useCallback(async () => {
        const [openRes, sRes] = await Promise.all([
            Promise.all(OPEN_STATUSES.map(s => authFetch(`${API_BASE}/pick-lists?status=${s}&page=1&size=1`))),
            authFetch(`${API_BASE}/pick-lists?status=DISPATCHED&page=1&size=1`),
        ]);
        let open = 0;
        for (const r of openRes) { if (r.ok) { const d = await r.json(); open += d.total || 0; } }
        setOpenCount(open);
        if (sRes.ok) { const d = await sRes.json(); setDispatchedCount(d.total || 0); }
    }, [authFetch]);

    // Re-pull the current page and the status-bar counts after a mutation. The list
    // fetch itself lives in the hook, so this is just its refetch plus the counts.
    const loadAll = useCallback(async () => {
        reloadPickLists();
        await loadCounts();
    }, [reloadPickLists, loadCounts]);

    useEffect(() => { loadCounts(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // One readiness call instead of "every open SO" + "every draft": the server
    // scores each order's packed cartons against what it still owes, so the picker
    // sees what can actually ship rather than the whole order book.
    const loadPickable = useCallback(async () => {
        setPickableLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/pick-lists/pickable-orders`);
            setPickableSOs(res.ok ? (await res.json() || []) : []);
            setPickableLoaded(true);
        } finally {
            setPickableLoading(false);
        }
    }, [authFetch]);

    // Board data is fetched on first visit to the tab and then kept — creating a
    // list refreshes it explicitly, so re-scoring on every tab flip would only
    // re-pay the N+1 for an unchanged answer.
    useEffect(() => {
        if (tab === 'topick' && !pickableLoaded && !pickableLoading) loadPickable();
    }, [tab, pickableLoaded, pickableLoading, loadPickable]);

    // Clicking "Pick" no longer commits straight to a DRAFT — it previews what
    // the server would auto-fill (FIFO, whole cartons) so the planner can
    // uncheck one before anything is written. This matters when the only
    // carton covering a line overshoots what's still owed (packed extra for
    // tolerance/reject allowance) and that surplus should stay in stock.
    const [suggestFor, setSuggestFor] = useState<any | null>(null);
    const [suggestGroups, setSuggestGroups] = useState<any[]>([]);
    const [suggestLoading, setSuggestLoading] = useState(false);
    const [creatingPL, setCreatingPL] = useState(false);

    const openSuggestFor = async (so: any) => {
        setSuggestFor(so);
        setSuggestGroups([]);
        setSuggestLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/pick-lists/suggest?sales_order_id=${so.id}`);
            setSuggestGroups(res.ok ? (await res.json() || []) : []);
        } finally {
            setSuggestLoading(false);
        }
    };

    const createWithLines = async (so: any, lines: any[]) => {
        setCreatingPL(true);
        try {
            const res = await authFetch(`${API_BASE}/pick-lists`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sales_order_id: so.id, lines }),
            });
            if (res.ok) {
                const pl = await res.json();
                // The order just consumed cartons — re-score the board before the
                // planner returns to it, and land them on the list they just cut.
                await Promise.all([loadAll(), loadPickable()]);
                setSuggestFor(null);
                setTab('lists');
                setEditing(pl);
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(`Error: ${err.detail || 'could not create'}`, 'danger');
            }
        } finally {
            setCreatingPL(false);
        }
    };

    const deletePL = async (pl: any) => {
        const ok = await confirm({ title: 'Delete Pick List', message: `Delete ${pl.code}?`, confirmText: 'Delete', variant: 'danger' });
        if (!ok) return;
        const res = await authFetch(`${API_BASE}/pick-lists/${pl.id}`, { method: 'DELETE' });
        if (res.ok) { showToast('Pick list deleted', 'success'); loadAll(); }
        else { const e = await res.json().catch(() => ({})); showToast(`Error: ${e.detail || 'failed'}`, 'danger'); }
    };

    // Tab badge counts orders that can actually be picked today, not every open
    // order — a board full of un-packed orders is not work waiting on the planner.
    const readyCount = useMemo(
        () => pickableSOs.filter((so: any) => num(so.cartons_ready) > 0).length,
        [pickableSOs],
    );

    const plPages = Math.max(1, Math.ceil(plTotal / PL_PAGE_SIZE));
    const clampedPage = Math.min(plPage, plPages);

    const cartonProgress = (pl: any) => {
        const cartons = (pl.lines || []).filter((l: any) => l.batch_id);
        if (!cartons.length) return '—';
        return `${cartons.filter((l: any) => l.picked_at).length}/${cartons.length}`;
    };

    const PL_COLS = 9; // chevron + 7 data cols + actions

    // Expanded row — same three-pane shape as the packing order and WO list
    // panels (info, the physical units, the log/summary). Everything rendered
    // here is already on the list payload (`_load_options` eager-loads lines with
    // item + batch), so opening a row costs no fetch.
    const renderPickDetail = (pl: any) => {
        const lines: any[] = pl.lines || [];
        const cartons = lines.filter((l: any) => l.batch_id);
        const pickedCount = cartons.filter((l: any) => l.picked_at).length;
        const srcName = locationById?.[String(pl.source_location_id)]?.name || null;

        // Per-item roll-up across cartons: what actually goes on the Surat Jalan.
        const byItem: Record<string, { code: string; name: string; qty: number; cartons: number; picked: number; uom: string }> = {};
        for (const l of lines) {
            const key = String(l.item_id);
            const it = itemById[key];
            const row = byItem[key] || (byItem[key] = {
                code: l.item_code || it?.code || key,
                name: l.item_name || it?.name || '',
                qty: 0, cartons: 0, picked: 0,
                uom: l.item_uom || it?.uom || '',
            });
            row.qty += num(l.qty_picked);
            if (l.batch_id) { row.cartons += 1; if (l.picked_at) row.picked += 1; }
        }
        const itemRows = Object.values(byItem);

        const colHeader: React.CSSProperties = {
            fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', color: '#555',
            letterSpacing: 0.5, borderBottom: '1px solid #c0bdb5', paddingBottom: 2, marginBottom: 4,
        };
        const infoRow = (label: string, val: React.ReactNode) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 1, fontSize: 9 }}>
                <span style={{ color: '#888' }}>{label}</span>
                <span style={{ fontWeight: 'bold', color: '#222', textAlign: 'right', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
            </div>
        );
        // Dense: this table shares its row with two other panes in the grid below.
        const th = lvSubTh(true, true);
        const td = lvSubTd(true, true);

        return (
            <tr key={`${pl.id}-detail`}>
                <td colSpan={PL_COLS} style={{ padding: 0 }}>
                    <ExpandedRowPanel classic>
                        <div style={{
                            display: 'grid', gridTemplateColumns: '250px minmax(280px, 1fr) 260px',
                            border: '1px solid #7f9db9', fontFamily: xpFont, fontSize: 10,
                        }}>
                            {/* Info + QC + where the goods went */}
                            <div style={{ borderRight: '1px solid #c0bdb5', padding: '6px 8px', background: '#f5f4ef' }}>
                                <div style={colHeader}>Info</div>
                                {infoRow('Sales Order', pl.sales_order_code || '—')}
                                {infoRow('Customer', pl.customer_name || '—')}
                                {infoRow('Pick from', srcName || 'any location')}
                                {infoRow('Cartons', `${pickedCount} / ${cartons.length} scanned`)}
                                <div style={{ borderTop: '1px solid #e0ddd8', margin: '3px 0' }} />
                                <div style={colHeader}>QC</div>
                                {infoRow('Passed', pl.qc_passed
                                    ? <span style={{ color: '#0a3e0a' }}>yes</span>
                                    : <span style={{ color: '#a00000' }}>not yet</span>)}
                                {infoRow('Inspector', pl.qc_inspector || '—')}
                                {infoRow('Checked', pl.qc_at ? tzDateTime(pl.qc_at) : '—')}
                                <div style={{ borderTop: '1px solid #e0ddd8', margin: '3px 0' }} />
                                {/* The delivery note itself lives on the Dispatch
                                    page — this only says where the goods went. */}
                                <div style={colHeader}>Loading Deck</div>
                                {infoRow('Shipment', pl.shipment_code || 'not staged')}
                                {infoRow('Deck status', pl.shipment_status || '—')}
                                {infoRow('Surat Jalan', pl.delivery_note_number || '—')}
                                <div style={{ borderTop: '1px solid #e0ddd8', margin: '3px 0' }} />
                                {infoRow('Created', pl.created_at ? tzDateTime(pl.created_at) : '—')}
                                {infoRow('Dispatched', pl.dispatched_at ? tzDateTime(pl.dispatched_at) : '—')}
                                {pl.notes && (
                                    <div style={{ marginTop: 4, padding: '2px 5px', background: '#fffbe6', border: '1px solid #e0d080', fontSize: 9, fontStyle: 'italic', color: '#666' }}>
                                        {pl.notes}
                                    </div>
                                )}
                            </div>

                            {/* Carton lines — the floor's scan sheet */}
                            <div style={{ borderRight: '1px solid #c0bdb5', padding: '6px 8px', background: '#f5f4ef', overflow: 'hidden' }}>
                                <div style={{ ...colHeader, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>Cartons ({cartons.length})</span>
                                    {cartons.length > 0 && (
                                        <span style={{ color: pickedCount === cartons.length ? '#0a3e0a' : '#b8860b' }}>
                                            {pickedCount} scanned
                                        </span>
                                    )}
                                </div>
                                {lines.length === 0 ? (
                                    <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: 9 }}>
                                        No lines — nothing was packed for this order when it was created.
                                    </div>
                                ) : (
                                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                                        <table style={{ ...lvSubTable(true), border: 'none' }}>
                                            <thead>
                                                <tr>
                                                    <th style={{ ...th, width: 24 }}>#</th>
                                                    <th style={th}>Lot</th>
                                                    <th style={th}>Item</th>
                                                    <th style={{ ...th, width: 78 }}>Packaging</th>
                                                    <th style={{ ...th, textAlign: 'right', width: 54 }}>Qty</th>
                                                    {/* Brutto per carton — the figure the loading deck counts
                                                        the load by and the carrier bills on. */}
                                                    <th style={{ ...th, textAlign: 'right', width: 62 }}>Gross</th>
                                                    <th style={{ ...th, width: 96 }}>Scanned</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {/* No zebra — the only row fill is the picked-green
                                                    confirmation, which is the floor's actual signal. */}
                                                {lines.map((l: any, li: number) => (
                                                    <tr key={l.id} style={lvSubRow(true, li, { fill: l.picked_at ? '#eef7ee' : undefined })}>
                                                        <td style={{ ...td, color: '#888' }}>{l.package_no ?? '—'}</td>
                                                        <td style={{ ...td, fontFamily: CODE_FONT, color: '#00309c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}
                                                            title={l.batch_number || undefined}>
                                                            {/* No batch = a bulk line from before pick lists became carton-only. */}
                                                            {l.batch_number || <span style={{ fontFamily: xpFont, color: '#b8860b' }}>bulk line</span>}
                                                        </td>
                                                        <td style={{ ...td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}
                                                            title={l.item_name || undefined}>
                                                            {l.item_code || itemById[String(l.item_id)]?.code || '—'}
                                                            {/* Size of the CARTON, not of the order line: an SO running
                                                                several sizes ships them out of one pick list, and the
                                                                colour column above is the ordered shade. */}
                                                            {l.size_label && (
                                                                <LotChip tone="size" title={`Size: ${l.size_label}`}>{l.size_label}</LotChip>
                                                            )}
                                                        </td>
                                                        <td style={{ ...td, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 78 }}
                                                            title={l.packaging_type_name || undefined}>
                                                            {l.packaging_type_name || '—'}
                                                        </td>
                                                        <td style={{ ...td, textAlign: 'right', fontWeight: 'bold' }}>{num(l.qty_picked).toFixed(2)}</td>
                                                        <td style={{ ...td, textAlign: 'right', color: '#555', whiteSpace: 'nowrap' }}
                                                            title={l.gross_weight_kg != null && l.net_weight_kg != null
                                                                ? `Net ${num(l.net_weight_kg).toFixed(2)} kg + tare` : undefined}>
                                                            {l.gross_weight_kg != null ? `${num(l.gross_weight_kg).toFixed(2)}` : '—'}
                                                        </td>
                                                        <td style={{ ...td, color: '#555', whiteSpace: 'nowrap' }}>
                                                            {l.picked_at
                                                                ? <span title={l.picked_by ? `by ${l.picked_by}` : undefined} style={{ color: '#0a3e0a' }}>
                                                                    {tzDateTime(l.picked_at)}
                                                                </span>
                                                                : <span style={{ color: '#aaa' }}>pending</span>}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* What ships, per item */}
                            <div style={{ padding: '6px 8px', background: '#f5f4ef', overflow: 'hidden' }}>
                                <div style={colHeader}>Shipping ({itemRows.length} item{itemRows.length === 1 ? '' : 's'})</div>
                                {itemRows.length === 0 ? (
                                    <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: 9 }}>Nothing allocated.</div>
                                ) : (
                                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                                        {itemRows.map(r => (
                                            <div key={r.code} style={{ marginBottom: 3, paddingBottom: 3, borderBottom: '1px solid #e8e6e0' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4, fontSize: 9 }}>
                                                    <span style={{ fontWeight: 'bold', color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>
                                                        {r.code}
                                                    </span>
                                                    <span style={{ fontWeight: 'bold', color: '#000080', whiteSpace: 'nowrap' }}>
                                                        {r.qty.toLocaleString()} {r.uom}
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: 9, color: '#888' }}>
                                                    {r.cartons > 0
                                                        ? `${r.picked}/${r.cartons} carton${r.cartons === 1 ? '' : 's'} scanned`
                                                        : 'bulk line'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </ExpandedRowPanel>
                </td>
            </tr>
        );
    };

    return (
        <ShellWindow classic fill="page" className="fade-in" style={{ fontFamily: xpFont }}>
            <ShellTitleBar
                classic
                icon="bi-clipboard-check"
                title="Pick Lists & Dispatch"
            />
            {/* No "New Pick List" button: a list is only ever created from a scored
                order on the board, so the Pick action lives on the row that says
                whether the order can be picked at all. */}
            <Tabs<PLTab>
                classic
                activeKey={tab}
                onChange={setTab}
                tabs={[
                    { key: 'topick' as const, label: pickableLoaded ? `To Pick (${readyCount})` : 'To Pick', icon: 'bi-box-arrow-in-down' },
                    { key: 'lists' as const, label: 'Pick Lists', icon: 'bi-clipboard-check' },
                ]}
            />
            {tab === 'topick' ? (
                <SOPickerBoard
                    pickableSOs={pickableSOs}
                    loading={pickableLoading}
                    tzDate={tzDate}
                    canManage={canManage}
                    onRefresh={loadPickable}
                    onPick={openSuggestFor}
                />
            ) : (
            <>
            <div style={xpToolbar()}>
                <button className={XP_BTN} style={xpBtn()} onClick={loadAll} title="Refresh">
                    <i className="bi bi-arrow-clockwise" style={{ marginRight: 4 }} />Refresh
                </button>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#333' }}>
                    {plTotal.toLocaleString()} pick list{plTotal !== 1 ? 's' : ''}
                </span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', background: '#fff', minHeight: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th style={{ ...xpTableHeader, width: 22 }} />
                            <th style={xpTableHeader}>Code</th>
                            <th style={xpTableHeader}>Sales Order</th>
                            <th style={xpTableHeader}>Customer</th>
                            <th style={xpTableHeader}>Status</th>
                            <th style={{ ...xpTableHeader, textAlign: 'right' }}>Cartons scanned</th>
                            <th style={xpTableHeader}>Delivery Note</th>
                            <th style={xpTableHeader}>Dispatched</th>
                            <th style={{ ...xpTableHeader, textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody ref={listBodyRef}>
                        {pickLists.length === 0 && (loading ? (
                            <TableSkeleton rows={7} cols={skel.cols ?? PL_COLS} classic tdStyle={td} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                        ) : (
                            <tr><td colSpan={PL_COLS} style={{ padding: 0 }}>
                                <XPEmptyState icon="bi-clipboard-check" message='No pick lists yet. Click "New Pick List" to pick packed cartons for an order.' />
                            </td></tr>
                        ))}
                        {pickLists.map((pl: any, idx: number) => {
                            const isExpanded = expandedId === String(pl.id);
                            return (
                            <React.Fragment key={pl.id}>
                            <tr
                                style={{ ...rowStyle(idx), ...(isExpanded ? { background: rowStateBg('expanded', true) } : {}), cursor: 'pointer' }}
                                onClick={() => setExpandedId(prev => prev === String(pl.id) ? null : String(pl.id))}
                            >
                                <ExpanderCell classic expanded={isExpanded} tdStyle={td} label="pick list detail"
                                    onToggle={() => setExpandedId(prev => prev === String(pl.id) ? null : String(pl.id))} />
                                <td style={{ ...td, fontWeight: 'bold', color: '#00309c' }}>{pl.code}</td>
                                <td style={td}>{pl.sales_order_code || '—'}</td>
                                <td style={td}>{pl.customer_name || '—'}</td>
                                <td style={td}><StatusChip status={pl.status} /></td>
                                <td style={{ ...td, textAlign: 'right' }}>{cartonProgress(pl)}</td>
                                <td style={td}>{pl.delivery_note_number || '—'}</td>
                                <td style={td}>{pl.dispatched_at ? tzDate(pl.dispatched_at) : '—'}</td>
                                <td style={{ ...td, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                    <span style={{ marginRight: 2 }}>
                                        <XPActionButton
                                            classic
                                            tone="primary"
                                            icon="bi-upc-scan"
                                            title={pl.status === 'DISPATCHED' ? 'View' : 'Pick'}
                                            onClick={() => setEditing(pl)}
                                        />
                                    </span>
                                    <span style={{ marginRight: 2 }}>
                                        <XPActionButton
                                            classic
                                            tone="neutral"
                                            icon="bi-card-list"
                                            title="Kartu Picking"
                                            onClick={() => setPrintCard(pl)}
                                        />
                                    </span>
                                    <MenuTriggerButton classic onClick={e => menuToggle(String(pl.id), e)} />
                                </td>
                            </tr>
                            {isExpanded && renderPickDetail(pl)}
                            </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <Pager page={clampedPage} total={plTotal} pageSize={PL_PAGE_SIZE} onPageChange={setPlPage} hideWhenEmpty />
            </>
            )}

            {menuOpenId && tab === 'lists' && (() => {
                const pl = pickLists.find((x: any) => String(x.id) === menuOpenId);
                if (!pl) return null;
                return (
                    <FloatingMenu
                        pos={menuPos}
                        items={[
                            { key: 'delete', label: 'Delete', icon: 'bi-trash', danger: true, hidden: !(canManage && pl.status !== 'DISPATCHED'), onClick: () => { menuClose(); deletePL(pl); } },
                        ]}
                    />
                );
            })()}
            <XPStatusBar right={`${openCount} open · ${dispatchedCount} dispatched`}>
                {tab === 'topick'
                    ? (pickableLoading ? 'Scoring open orders...' : `${pickableSOs.length} open order(s) · ${readyCount} ready to pick`)
                    : (loading ? 'Loading...' : `${plTotal} pick list(s)`)}
            </XPStatusBar>

            {editing && (
                <PickListEditor
                    pl={editing}
                    itemById={itemById}
                    locPickerTreeOptions={locPickerTreeOptions}
                    authFetch={authFetch}
                    onClose={() => setEditing(null)}
                    onSaved={async () => { await loadAll(); }}
                    showToast={showToast}
                />
            )}

            {printCard && (
                <PickListPrintModal
                    pl={printCard}
                    companyProfile={companyProfile}
                    onClose={() => setPrintCard(null)}
                />
            )}

            {suggestFor && (
                <PickListSuggestionModal
                    so={suggestFor}
                    groups={suggestGroups}
                    loading={suggestLoading}
                    creating={creatingPL}
                    itemById={itemById}
                    onClose={() => setSuggestFor(null)}
                    onConfirm={(lines: any[]) => createWithLines(suggestFor, lines)}
                />
            )}

        </ShellWindow>
    );
}

// ── SO picker ────────────────────────────────────────────────────────────────
// Due-date urgency, in the same 5-family language as StatusChip: red = late,
// amber = this week, grey = comfortable.
function dueChip(days: number | null | undefined) {
    if (days == null) return { bg: '#f0efe8', border: '#c0bdb5', fg: '#666', text: 'no date' };
    if (days < 0) return { bg: '#fbe4e4', border: '#c88', fg: '#900', text: `${-days}d late` };
    if (days === 0) return { bg: '#ffe9c7', border: '#d9a441', fg: '#7a4a00', text: 'due today' };
    if (days <= 7) return { bg: '#fff4e5', border: '#d9a441', fg: '#7a4a00', text: `in ${days}d` };
    return { bg: '#eef2ff', border: '#b0c8f8', fg: '#1a56c4', text: `in ${days}d` };
}

/**
 * Pick readiness board — the planner's release queue, a full tab rather than a
 * dialog because it is a work surface (sortable-width table, urgency chips,
 * coverage bars) that the planner reads alongside the pick list register, not a
 * one-question prompt.
 *
 * Orders are listed soonest-due first, each showing how much of what it still
 * owes is already packed into cartons — packing is upstream of picking, so an
 * order with nothing packed cannot be picked at all (the server rejects it too;
 * this just says so before the click).
 */
// Coverage % — same formula the row itself renders the progress bar with.
const coveragePct = (so: any) => num(so.qty_outstanding) > 0
    ? Math.min(100, Math.round(num(so.qty_ready) / num(so.qty_outstanding) * 100))
    : 0;

// Whole-order fulfilment, in the same three nested stages the SO table draws
// (made >= packed >= dispatched, so they stack on one track rather than add up).
// Coverage answers "is there a carton for what's left"; this answers "how much of
// the order is done" — the last carton of a barely-started order reads 100%
// coverage, and only this tells it apart from one that is nearly shipped.
const fulfilment = (so: any) => {
    const ordered = num(so.qty_ordered_base);
    const pct = (v: number) => (ordered > 0 ? Math.min(100, Math.round(v / ordered * 100)) : 0);
    return {
        ordered,
        uom: so.base_uom ? ` ${so.base_uom}` : '',
        made: num(so.qty_made),
        packed: num(so.qty_packed),
        dispatched: num(so.qty_dispatched),
        unknown: Number(so.lines_unknown_base) || 0,
        pct,
    };
};

const fmtQty = (v: number) => (Math.round(v * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

function fulfilmentCell(so: any) {
    const f = fulfilment(so);
    // No derivable denominator on any line (weight-stocked item with no
    // weight-per-yard): say so rather than draw a 0% bar, since the fix is on the
    // item master, not on this order.
    if (f.ordered <= 0) {
        return f.unknown > 0
            ? <span title="Ordered qty can't be restated in the stock UoM — set weight per unit on the item master"
                style={{ fontSize: 9, color: '#8a6d00', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <i className="bi bi-exclamation-triangle" style={{ fontSize: 8 }} />no weight
            </span>
            : <span style={{ fontSize: 9, color: '#ccc' }}>—</span>;
    }
    const shipped = f.pct(f.dispatched), packed = f.pct(f.packed), made = f.pct(f.made);
    const title = `Made ${fmtQty(f.made)} · Packed ${fmtQty(f.packed)} · Shipped ${fmtQty(f.dispatched)}`
        + ` — of ${fmtQty(f.ordered)}${f.uom} ordered`
        + (f.unknown > 0 ? ` (${f.unknown} line(s) excluded: no derivable weight)` : '');
    return (
        <div title={title} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 78 }}>
            <ProgressBar
                pct={shipped} tone="green"
                secondaryPct={Math.max(0, packed - shipped)} secondaryTone="blue"
                tertiaryPct={Math.max(0, made - packed)} tertiaryTone="gray"
                width={70} height={8}
            />
            <div style={{ fontSize: 9, color: shipped >= 100 ? '#0a3e0a' : '#777' }}>
                {f.dispatched > 0
                    ? `${shipped}% shipped`
                    : f.packed > 0 ? `${packed}% packed`
                    : f.made > 0 ? `${made}% made` : 'not started'}
                {f.unknown > 0 && <i className="bi bi-exclamation-triangle" style={{ fontSize: 8, color: '#8a6d00', marginLeft: 3 }} />}
            </div>
        </div>
    );
}

function SOPickerBoard({ pickableSOs, loading, tzDate, canManage, onRefresh, onPick }: any) {
    // "Ready" filter — hides orders with nothing packed yet, since those can't
    // be picked at all today; the planner's actual queue is the rest.
    const [readyOnly, setReadyOnly] = useState(false);
    const filtered = useMemo(
        () => readyOnly ? pickableSOs.filter((so: any) => num(so.cartons_ready) > 0) : pickableSOs,
        [pickableSOs, readyOnly],
    );
    const { sorted, sort, toggle: toggleSort } = useSortable(filtered, {
        po: (so: any) => so.po_number,
        customer: (so: any) => so.customer_name,
        due: (so: any) => so.days_to_due,
        outstanding: (so: any) => num(so.qty_outstanding),
        ready: (so: any) => num(so.qty_ready),
        coverage: (so: any) => coveragePct(so),
        fulfilment: (so: any) => { const f = fulfilment(so); return f.pct(f.dispatched); },
    });
    return (
        <>
            <div style={xpToolbar()}>
                <button className={XP_BTN} style={xpBtn()} onClick={onRefresh} title="Re-score open orders">
                    <i className="bi bi-arrow-clockwise" style={{ marginRight: 4 }} />Refresh
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: xpFont, fontSize: 11, color: '#000', cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: 10 }}
                    title="Hide orders with nothing packed yet — nothing there can be picked today">
                    <input type="checkbox" checked={readyOnly} onChange={e => setReadyOnly(e.target.checked)} style={{ margin: 0 }} />
                    Ready to pick only
                </label>
                <span style={{ fontSize: 10, color: '#666', marginLeft: 8, maxWidth: 620, lineHeight: 1.3 }}>
                    Soonest delivery first. &quot;Ready&quot; counts whole cartons already packed and not on
                    another pick list — cartons are suggested oldest-first, and the last one may overshoot
                    since a carton is never split.
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#333', whiteSpace: 'nowrap' }}>
                    {filtered.length.toLocaleString()} order{filtered.length !== 1 ? 's' : ''}
                    {readyOnly ? '' : ` (of ${pickableSOs.length.toLocaleString()})`}
                </span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', background: '#fff', minHeight: 0, fontFamily: xpFont }}>
                {loading
                    ? <div style={{ fontSize: 11, color: '#888', padding: '12px 8px' }}>Scoring open orders...</div>
                    : sorted.length === 0
                    ? <XPEmptyState icon="bi-inbox" message={readyOnly ? "No orders ready to pick right now." : "No open sales orders with anything outstanding."} />
                    : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <SortableTh sort={sort} colKey="po" onSort={toggleSort} style={xpTableHeader}>Sales Order</SortableTh>
                                    <SortableTh sort={sort} colKey="customer" onSort={toggleSort} style={xpTableHeader}>Customer</SortableTh>
                                    <th style={xpTableHeader}>Items</th>
                                    <SortableTh sort={sort} colKey="due" onSort={toggleSort} style={xpTableHeader}>Delivery due</SortableTh>
                                    <SortableTh sort={sort} colKey="outstanding" onSort={toggleSort} style={{ ...xpTableHeader, textAlign: 'right' }}>Outstanding</SortableTh>
                                    <SortableTh sort={sort} colKey="ready" onSort={toggleSort} style={{ ...xpTableHeader, textAlign: 'right' }}>Ready</SortableTh>
                                    <SortableTh sort={sort} colKey="coverage" onSort={toggleSort} style={xpTableHeader}
                                        title="Sort — of what this order still owes, how much is packed and waiting">Coverage</SortableTh>
                                    <SortableTh sort={sort} colKey="fulfilment" onSort={toggleSort} style={xpTableHeader}
                                        title="Sort — how much of the whole order is made, packed and shipped">Fulfilment</SortableTh>
                                    <th style={{ ...xpTableHeader, textAlign: 'right' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((so: any, idx: number) => {
                                    const chip = dueChip(so.days_to_due);
                                    const ready = num(so.cartons_ready) > 0;
                                    const pct = coveragePct(so);
                                    return (
                                        <tr key={so.id} style={{ ...rowStyle(idx), opacity: ready ? 1 : 0.6 }}>
                                            <td style={{ ...td, fontWeight: 'bold', color: '#00309c' }}>
                                                {so.po_number}
                                                {so.customer_po_ref && (
                                                    <div style={{ fontSize: 9, fontWeight: 'normal', color: '#888' }}>{so.customer_po_ref}</div>
                                                )}
                                            </td>
                                            <td style={td}>
                                                {so.customer_name}
                                                <div style={{ marginTop: 1 }}><StatusChip status={so.status} tint /></div>
                                            </td>
                                            {/* What the order is actually made of. The row's numbers are the
                                                order's total, and two lines of the same item differing only by
                                                shade or size are indistinguishable without this — the picker
                                                would be releasing "235 of something". Chips are the same lot
                                                vocabulary the cartons carry, so ordered identity and packed
                                                identity read alike. */}
                                            <td style={{ ...td, maxWidth: 260 }}>
                                                {(so.lines || []).length === 0
                                                    ? <span style={{ color: '#999' }}>&mdash;</span>
                                                    : (so.lines || []).map((l: any) => (
                                                        <div key={l.sales_order_line_id} style={{ marginBottom: 2 }}>
                                                            <LotChipRow>
                                                                <span style={{ fontFamily: CODE_FONT, color: '#00309c', fontSize: 10 }}
                                                                    title={l.item_name || undefined}>
                                                                    {l.item_code || '—'}
                                                                </span>
                                                                <LotChips batch={l} />
                                                                <span style={{ fontSize: 9, color: num(l.cartons_ready) > 0 ? '#0a3e0a' : '#999' }}>
                                                                    {num(l.qty_outstanding).toLocaleString()} {l.item_uom || ''}
                                                                    {' · '}
                                                                    {l.cartons_ready} ctn ready
                                                                </span>
                                                            </LotChipRow>
                                                        </div>
                                                    ))}
                                            </td>
                                            <td style={td}>
                                                <span style={{ borderRadius: CHIP_RADIUS,
                                                    fontSize: 9, fontWeight: 'bold', padding: '0 5px',
                                                    background: chip.bg, border: `1px solid ${chip.border}`, color: chip.fg,
                                                }}>{chip.text}</span>
                                                <div style={{ fontSize: 9, color: '#888', marginTop: 1 }}>
                                                    {so.due_date ? tzDate(so.due_date) : '—'}
                                                </div>
                                            </td>
                                            <td style={{ ...td, textAlign: 'right' }}>
                                                {num(so.qty_outstanding).toLocaleString()}
                                                <div style={{ fontSize: 9, color: '#888' }}>
                                                    {so.lines_outstanding} of {so.line_count} line{so.line_count === 1 ? '' : 's'}
                                                </div>
                                            </td>
                                            <td style={{ ...td, textAlign: 'right', color: ready ? '#0a3e0a' : '#999', fontWeight: 'bold' }}>
                                                {num(so.qty_ready).toLocaleString()}
                                                <div style={{ fontSize: 9, fontWeight: 'normal', color: '#888' }}>
                                                    {so.cartons_ready} carton{so.cartons_ready === 1 ? '' : 's'}
                                                </div>
                                            </td>
                                            <td style={td}>
                                                <ProgressBar pct={pct} tone={pct >= 100 ? 'green' : 'blue'} width={70} height={8} label="outside" />
                                            </td>
                                            <td style={td}>{fulfilmentCell(so)}</td>
                                            <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                {so.has_open_pick_list && (
                                                    <span style={{ fontSize: 9, color: '#b8860b', marginRight: 8 }}>open pick list</span>
                                                )}
                                                <button
                                                    style={{ ...xpBtnGreen(), opacity: ready && canManage ? 1 : 0.5, cursor: ready && canManage ? 'pointer' : 'not-allowed' }}
                                                    disabled={!ready || !canManage}
                                                    title={!canManage ? 'You do not have permission to create pick lists'
                                                        : ready ? 'Create a pick list for this order'
                                                        : 'Nothing packed for this order yet — pack cartons first'}
                                                    onClick={() => onPick(so)}
                                                >Pick</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
            </div>
        </>
    );
}

/**
 * Preview of what "Pick" would auto-fill, before anything is written. Every
 * carton the server's FIFO suggestion found starts checked — the planner only
 * has to act when something is wrong, most commonly a carton that overshoots
 * what a line still owes (the only box left is bigger than the remaining
 * order, e.g. extra packed for tolerance/reject allowance) and should stay in
 * stock rather than ship early.
 */
function PickListSuggestionModal({ so, groups, loading, creating, itemById, onClose, onConfirm }: any) {
    const [checked, setChecked] = useState<Record<string, boolean>>({});

    // Re-seed whenever a fresh suggestion arrives (new SO, or a refetch).
    useEffect(() => {
        const init: Record<string, boolean> = {};
        (groups || []).forEach((g: any) => (g.cartons || []).forEach((c: any) => { init[String(c.batch_id)] = true; }));
        setChecked(init);
    }, [groups]);

    const toggle = (batchId: string) => setChecked(prev => ({ ...prev, [batchId]: !prev[batchId] }));

    const selectedLines = useMemo(() => {
        const out: any[] = [];
        (groups || []).forEach((g: any) => (g.cartons || []).forEach((c: any) => {
            if (checked[String(c.batch_id)]) {
                out.push({
                    sales_order_line_id: g.sales_order_line_id,
                    item_id: g.item_id,
                    qty_picked: c.qty,
                    source_location_id: c.source_location_id,
                    batch_id: c.batch_id,
                });
            }
        }));
        return out;
    }, [groups, checked]);

    const totalCartons = (groups || []).reduce((s: number, g: any) => s + (g.cartons || []).length, 0);

    return (
        <ModalWrapper
            isOpen
            onClose={onClose}
            title={`Pick Cartons — SO ${so.po_number}`}
            size="lg"
            modeless
            footer={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <button className={XP_BTN} style={xpBtn()} onClick={onClose}>Cancel</button>
                    <button
                        className={XP_BTN}
                        style={{ ...xpBtnGreen(), opacity: selectedLines.length && !creating ? 1 : 0.5, cursor: selectedLines.length && !creating ? 'pointer' : 'not-allowed' }}
                        disabled={!selectedLines.length || creating}
                        onClick={() => onConfirm(selectedLines)}
                    >
                        {creating ? 'Creating...' : `Create Pick List (${selectedLines.length} carton${selectedLines.length === 1 ? '' : 's'})`}
                    </button>
                </div>
            }
        >
            <div style={{ fontFamily: xpFont }}>
                <div style={{ fontSize: 10, color: '#666', marginBottom: 8, lineHeight: 1.3 }}>
                    Every ready carton is pre-checked, oldest first. Uncheck one to leave it in stock — useful
                    when the only carton left overshoots what&apos;s still owed on a line (e.g. extra packed
                    for tolerance or an overestimated reject rate).
                </div>
                {loading ? (
                    <div style={{ fontSize: 11, color: '#888', padding: 12 }}>Scoring available cartons...</div>
                ) : totalCartons === 0 ? (
                    <XPEmptyState icon="bi-inbox" message="Nothing packed and available for this order." />
                ) : (
                    (groups || []).filter((g: any) => (g.cartons || []).length > 0).map((g: any) => {
                        const it = itemById[String(g.item_id)];
                        const selectedQty = (g.cartons || [])
                            .filter((c: any) => checked[String(c.batch_id)])
                            .reduce((s: number, c: any) => s + num(c.qty), 0);
                        const over = selectedQty > num(g.remaining_qty) + 1e-6;
                        return (
                            <div key={g.sales_order_line_id} style={{ marginBottom: 12, border: '1px solid #c8c4b8' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, background: '#f5f4ef', padding: '4px 8px', fontSize: 11 }}>
                                    <span style={{ fontWeight: 'bold' }}>
                                        {it?.code || g.item_code}
                                        <span style={{ fontWeight: 'normal', color: '#888', marginLeft: 6 }}>{it?.name || g.item_name}</span>
                                        {/* What the LINE ordered. The cartons below carry their own chips —
                                            they are what is physically in each box, and the two can differ. */}
                                        <LotChipRow style={{ display: 'inline-flex', marginLeft: 6, verticalAlign: 'middle' }}>
                                            <LotChips batch={g} />
                                        </LotChipRow>
                                    </span>
                                    <span style={{ whiteSpace: 'nowrap' }}>
                                        Remaining <b>{num(g.remaining_qty).toLocaleString()}</b> {it?.uom || g.item_uom}
                                        {' · '}
                                        <span style={{ color: over ? '#a00000' : '#0a3e0a', fontWeight: 'bold' }}>
                                            selected {selectedQty.toLocaleString()}
                                        </span>
                                        {over && <span style={{ color: '#a00000' }}> (overshoots)</span>}
                                    </span>
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <tbody>
                                        {(g.cartons || []).map((c: any) => (
                                            <tr key={c.batch_id}>
                                                <td style={{ ...td, width: LV_CHECK_COL_W }}>
                                                    <input type="checkbox" checked={!!checked[String(c.batch_id)]} onChange={() => toggle(String(c.batch_id))} />
                                                </td>
                                                <td style={{ ...td, color: '#00309c' }}>
                                                    <LotChipRow>
                                                        <span style={{ fontFamily: CODE_FONT }}>
                                                            {c.batch_number}{c.package_no ? ` · #${c.package_no}` : ''}
                                                        </span>
                                                        {/* Size off the carton's own Batch row, shade/combo off its
                                                            stock key — the box's identity, not the order's. */}
                                                        <LotChips batch={c} />
                                                    </LotChipRow>
                                                </td>
                                                <td style={{ ...td, textAlign: 'right' }}>{num(c.qty).toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })
                )}
            </div>
        </ModalWrapper>
    );
}

// ── editor ───────────────────────────────────────────────────────────────────
function PickListEditor({ pl: initialPl, itemById, locPickerTreeOptions, authFetch, onClose, onSaved, showToast }: any) {
    const { hasPermission } = useUser();
    const canManage = hasPermission('sales.manage');

    // Lines are server-owned here: scanning mutates them on the backend and the
    // response replaces the local copy. Only header fields and bulk-line qty are
    // edited client-side, which keeps the scan (the source of pick truth) from
    // ever racing an unsaved local edit.
    const [pl, setPl] = useState<any>(initialPl);
    const readOnly = pl.status === 'DISPATCHED' || pl.status === 'CANCELLED' || !canManage;

    const [so, setSo] = useState<any | null>(null);
    const [soLoading, setSoLoading] = useState(true);
    const [remainingMap, setRemainingMap] = useState<Record<string, number>>({});
    const soLines: any[] = so?.lines || [];

    const [lines, setLines] = useState<any[]>(() => (initialPl.lines || []).map((l: any) => ({ ...l })));
    const [sourceLoc, setSourceLoc] = useState<string>(initialPl.source_location_id || '');
    const [qcPassed, setQcPassed] = useState<boolean>(!!initialPl.qc_passed);
    const [qcInspector, setQcInspector] = useState<string>(initialPl.qc_inspector || '');
    const [notes, setNotes] = useState<string>(initialPl.notes || '');
    const [saving, setSaving] = useState(false);
    const [scanCode, setScanCode] = useState('');
    const [scanning, setScanning] = useState(false);
    const scanRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setSoLoading(true);
            const soRes = await authFetch(`${API_BASE}/sales-orders/${initialPl.sales_order_id}`);
            const soData = soRes.ok ? await soRes.json() : null;
            if (cancelled) return;
            setSo(soData);
            setSoLoading(false);

            const remRes = await authFetch(`${API_BASE}/pick-lists/${initialPl.id}/remaining`);
            if (cancelled) return;
            if (remRes && remRes.ok) setRemainingMap(await remRes.json());
        })();
        return () => { cancelled = true; };
    }, [initialPl.sales_order_id, initialPl.id, authFetch]);

    useEffect(() => { if (!readOnly) scanRef.current?.focus(); }, [readOnly]);

    const applyServer = (fresh: any) => {
        setPl(fresh);
        setLines((fresh.lines || []).map((l: any) => ({ ...l })));
    };

    const buildPayload = () => ({
        source_location_id: sourceLoc || null,
        qc_passed: qcPassed, qc_inspector: qcInspector || null,
        notes: notes || null,
        lines: lines.map(l => ({
            sales_order_line_id: l.sales_order_line_id,
            item_id: l.item_id,
            qty_picked: num(l.qty_picked),
            source_location_id: l.source_location_id || null,
            batch_id: l.batch_id || null,
        })),
    });

    const save = async () => {
        setSaving(true);
        try {
            const res = await authFetch(`${API_BASE}/pick-lists/${pl.id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload()),
            });
            if (res.ok) { applyServer(await res.json()); showToast('Saved', 'success'); await onSaved(); return true; }
            const e = await res.json().catch(() => ({})); showToast(`Error: ${e.detail || 'save failed'}`, 'danger'); return false;
        } finally { setSaving(false); }
    };

    // Rebuilding lines on PUT drops picked_at, so scan BEFORE saving header edits
    // is the safe order — hence the scan box posts straight through and never
    // piggybacks the local payload.
    const scan = async (code: string) => {
        const trimmed = code.trim();
        if (!trimmed) return;
        setScanning(true);
        try {
            const res = await authFetch(`${API_BASE}/pick-lists/${pl.id}/scan`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: trimmed }),
            });
            if (res.ok) {
                applyServer(await res.json());
                setScanCode('');
                showToast(`${trimmed} confirmed`, 'success');
            } else {
                const e = await res.json().catch(() => ({}));
                showToast(`${e.detail || 'Scan failed'}`, 'danger');
            }
        } finally { setScanning(false); scanRef.current?.focus(); }
    };

    const removeLine = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));
    const setLineQty = (idx: number, v: any) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, qty_picked: v } : l));
    const setLineLoc = (idx: number, v: any) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, source_location_id: v } : l));

    const linesBySoLine = useMemo(() => {
        const m: Record<string, any[]> = {};
        lines.forEach((l, idx) => {
            const k = String(l.sales_order_line_id);
            (m[k] = m[k] || []).push({ ...l, __idx: idx });
        });
        return m;
    }, [lines]);

    const cartonLines = lines.filter(l => l.batch_id);
    const scannedCount = cartonLines.filter(l => l.picked_at).length;

    const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 'bold', color: '#00309c', margin: '14px 0 6px', borderBottom: '1px solid #c8c4b8', paddingBottom: 3 };

    return (
        <ModalWrapper
            isOpen
            onClose={onClose}
            title={`Pick List ${pl.code} — SO ${pl.sales_order_code || so?.po_number || ''}`}
            size="xl"
            modeless
            footer={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <button className={XP_BTN} style={xpBtn()} onClick={onClose}>Close</button>
                    <div style={{ display: 'flex', gap: 6 }}>
                        {!readOnly && <button className={XP_BTN} style={xpBtnGreen()} disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>}
                    </div>
                </div>
            }
        >
            <div style={{ fontFamily: xpFont }}>
                {readOnly && (
                    <div style={{ background: '#eef7ee', border: '1px solid #2d7a2d', color: '#0a3e0a', padding: '5px 10px', fontSize: 11, marginBottom: 10 }}>
                        This pick list is {pl.status} and read-only.
                    </div>
                )}

                {/* Header fields */}
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 200 }}>
                        <label style={xpLabel}>Default ship-from warehouse</label>
                        <TreeSelect options={locPickerTreeOptions} value={sourceLoc} onChange={setSourceLoc} disabled={readOnly} allowEmpty emptyLabel="— select —" size="sm" style={{ width: '100%' }} />
                    </div>
                    {/* Delivery-note fields (DN no., carrier, vehicle, driver) are
                        not here: they are loading-deck facts captured on the
                        Dispatch page when this pick list is staged. */}
                </div>

                {/* Scan */}
                {!readOnly && (
                    <>
                        <div style={sectionTitle}>Scan Cartons</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                                ref={scanRef}
                                style={{ ...xpInput, width: 260 }}
                                placeholder="Scan or type carton number (PU-…)"
                                value={scanCode}
                                disabled={scanning}
                                onChange={e => setScanCode(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); scan(scanCode); } }}
                            />
                            <button className={XP_BTN} style={xpBtn()} disabled={scanning || !scanCode.trim()} onClick={() => scan(scanCode)}>
                                {scanning ? 'Scanning...' : 'Confirm'}
                            </button>
                            <span style={{ fontSize: 10, color: scannedCount === cartonLines.length && cartonLines.length > 0 ? '#0a3e0a' : '#c77800' }}>
                                {scannedCount}/{cartonLines.length} cartons scanned
                            </span>
                        </div>
                        <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
                            Scanning a carton that was not suggested adds it, as long as the order includes that item.
                        </div>
                    </>
                )}

                {/* Lines */}
                <div style={sectionTitle}>Cartons to Pick</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', border: '1px solid #c8c4b8' }}>
                    <thead>
                        <tr>
                            <th style={{ ...xpTableHeader, width: LV_CHECK_COL_W }} />
                            <th style={xpTableHeader}>Item / Carton</th>
                            <th style={{ ...xpTableHeader, width: 50, textAlign: 'center' }}>#</th>
                            <th style={{ ...xpTableHeader, textAlign: 'right' }}>Ordered</th>
                            <th style={{ ...xpTableHeader, textAlign: 'right' }}>Remaining</th>
                            <th style={{ ...xpTableHeader, width: 110, textAlign: 'right' }}>Qty</th>
                            <th style={{ ...xpTableHeader, width: 160 }}>Pick-from</th>
                            <th style={{ ...xpTableHeader, width: 110 }}>Scanned</th>
                            <th style={{ ...xpTableHeader, width: 60 }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {soLoading && (
                            <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#999' }}>Loading order lines...</td></tr>
                        )}
                        {soLines.map((sl: any) => {
                            const it = itemById[String(sl.item_id)];
                            const rows = linesBySoLine[String(sl.id)] || [];
                            // Ordered qty in the item's STOCK UOM. `sl.qty` is not it —
                            // the SO form authors every quantity as yards (see
                            // so_fulfilment_service.ordered_qty_in_stock_uom), while
                            // `rem` and `totalPicked` below are in kg/pcs, so showing
                            // the raw figure put three units in one row: "10,000 kg
                            // ordered / 10 remaining / 11 picked". Null = the item is
                            // stocked by weight with no g/y on its master, which is
                            // unknowable rather than zero — an em dash, never yards.
                            const ordered = sl.qty_ordered_base != null ? num(sl.qty_ordered_base) : null;
                            // Server returns 0.0 for an underivable line on purpose
                            // ("seed nothing rather than guess"), so a missing entry
                            // means the fetch has not landed — not that everything is
                            // outstanding. Falling back to `sl.qty` here reintroduced
                            // exactly the yard figure that rule exists to keep out.
                            const remRaw = remainingMap[String(sl.id)];
                            const rem = remRaw != null ? num(remRaw) : ordered;
                            const totalPicked = rows.reduce((s: number, r: any) => s + num(r.qty_picked), 0);
                            return (
                                <React.Fragment key={sl.id}>
                                    <tr style={{ background: '#f5f4ef' }}>
                                        <td style={td} />
                                        <td style={{ ...td, fontWeight: 'bold' }}>
                                            {it?.name || sl.item_name || sl.item_id}
                                            <span style={{ fontSize: 9, color: '#888', marginLeft: 6 }}>{it?.code || sl.item_code}</span>
                                        </td>
                                        <td style={td} />
                                        <td style={{ ...td, textAlign: 'right' }}>
                                            {ordered !== null
                                                ? `${ordered.toLocaleString()} ${sl.base_uom || it?.uom || ''}`
                                                : <span style={{ color: '#999' }} title="This item is stocked by weight but carries no g/y or g/m on its master, so the ordered yards cannot be restated in it">&mdash;</span>}
                                        </td>
                                        <td style={{ ...td, textAlign: 'right', color: rem !== null && rem > 0 ? '#0a3e0a' : '#999' }}>
                                            {rem !== null ? rem.toLocaleString() : <span>&mdash;</span>}
                                        </td>
                                        <td style={{ ...td, textAlign: 'right', fontWeight: 'bold' }}>{totalPicked.toLocaleString()}</td>
                                        <td style={td} colSpan={3}>
                                            {rows.length === 0 && <span style={{ fontSize: 10, color: '#c00' }}>No packed cartons available</span>}
                                        </td>
                                    </tr>
                                    {rows.map((r: any) => (
                                        <tr key={r.id || r.__idx}>
                                            {/* Manual fallback for a scanner-less floor or a damaged label —
                                                ticking confirms the same carton scanning would, via its known
                                                batch number. No unpick: once confirmed, only removing the line
                                                undoes it. Bulk (uncartonised) lines have nothing to confirm. */}
                                            {r.batch_id ? (
                                                <RowCheckboxCell
                                                    classic
                                                    checked={!!r.picked_at}
                                                    disabled={readOnly || !!r.picked_at || scanning}
                                                    onChange={() => scan(r.batch_number)}
                                                    label={`carton ${r.batch_number}`}
                                                    tdStyle={td}
                                                />
                                            ) : (
                                                <td style={td} />
                                            )}
                                            <td style={{ ...td, paddingLeft: 22 }}>
                                                {r.batch_id
                                                    ? <span style={{ color: '#00309c' }}>{r.batch_number}</span>
                                                    : <span style={{ color: '#888' }}>Bulk (no carton)</span>}
                                            </td>
                                            <td style={{ ...td, textAlign: 'center' }}>{r.package_no ? `#${r.package_no}` : '—'}</td>
                                            <td style={td} />
                                            <td style={td} />
                                            <td style={{ ...td, textAlign: 'right' }}>
                                                <input type="number" min={0}
                                                    style={{ ...xpInput, width: '100%', textAlign: 'right' }}
                                                    disabled={readOnly || !!r.batch_id}
                                                    title={r.batch_id ? 'A carton ships whole — its qty comes from stock' : undefined}
                                                    value={r.qty_picked ?? ''} onChange={e => setLineQty(r.__idx, e.target.value)} />
                                            </td>
                                            <td style={td}>
                                                <TreeSelect options={locPickerTreeOptions} value={r.source_location_id || ''} onChange={id => setLineLoc(r.__idx, id)} disabled={readOnly || !!r.batch_id} allowEmpty emptyLabel="(default)" size="sm" style={{ width: '100%' }} />
                                            </td>
                                            <td style={td}>
                                                {!r.batch_id
                                                    ? <span style={{ fontSize: 10, color: '#bbb' }}>n/a</span>
                                                    : r.picked_at
                                                        ? <span style={{ fontSize: 10, color: '#0a3e0a' }}><i className="bi bi-check-lg" /> {r.picked_by || 'yes'}</span>
                                                        : <span style={{ fontSize: 10, color: '#c77800' }}>pending</span>}
                                            </td>
                                            <td style={{ ...td, textAlign: 'right' }}>
                                                {!readOnly && <button className={XP_BTN} style={xpBtn({ color: '#a00' })} onClick={() => removeLine(r.__idx)}>Remove</button>}
                                            </td>
                                        </tr>
                                    ))}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>

                {/* QC */}
                <div style={sectionTitle}>Quality Control</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: readOnly ? 'default' : 'pointer' }}>
                        <input type="checkbox" checked={qcPassed} disabled={readOnly} onChange={e => setQcPassed(e.target.checked)} />
                        QC passed
                    </label>
                    <div>
                        <label style={xpLabel}>Inspector</label>
                        <input style={{ ...xpInput, width: 200 }} disabled={readOnly} value={qcInspector} onChange={e => setQcInspector(e.target.value)} />
                    </div>
                </div>

                <div style={sectionTitle}>Notes</div>
                <textarea style={{ ...xpInput, height: 50, width: '100%', resize: 'vertical' }} disabled={readOnly} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
        </ModalWrapper>
    );
}

