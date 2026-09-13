'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useData } from '../../context/DataContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import { useUser } from '../../context/UserContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useToast } from '../shared/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import {
    XPStatusBar, XPEmptyState, TableSkeleton, useTableSkeletonMetrics, StatusChip,
    useFloatingMenu, MenuTriggerButton, FloatingMenu, ExpandedRowPanel, XPActionButton, CodeChip, CODE_FONT, rowStateBg, colorLabel, colorTitle, XP_BTN,
} from '../shared/xpTheme';
import { LV_XP_FONT, lvBtn, lvInput, lvTd, lvLabel, lvRow, lvSubTh, lvSubTd, lvSubTable, useRowSelection, RowCheckbox, SelectAllCheckbox, LV_CHECK_COL_W, EMPTY_DASH, lvTh, lvThead } from '../shared/listViewTheme';
import { ShellWindow, ShellTitleBar, SearchField, FilterChipBar, ToolbarCount, xpToolbar } from '../shared/shellTheme';
import Pager from '../shared/Pager';
import ModalWrapper from '../shared/ModalWrapper';
import { LotChip, LotChips, LotChipRow, lotSizeLabel, lotComboLabel, lotColorLabel } from '../shared/LotChips';
import { qtyFmt, toNum as num } from '../shared/format';
const SuratJalanPrintModal = dynamic(() => import('./SuratJalanPrintModal'), { ssr: false });

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace(/\/api$/, '') + '/api';

// Classic-XP primitives, same set PickListView uses — the two pages are read by
// the same warehouse staff minutes apart and must not drift apart visually.
const xpFont = LV_XP_FONT;
const xpInput: React.CSSProperties = lvInput(true);
const xpTableHeader: React.CSSProperties = { ...lvTh(true), ...lvThead(true), position: 'sticky', top: 0 };
// One grid now carries both grains. Nine columns:
// checkbox · Document · Reference · Customer · Vehicle · Cartons · Status · Checked by · menu
const COLS = 9;
const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => lvBtn(true, 'default', extra);
const xpBtnGreen = (extra: React.CSSProperties = {}) => lvBtn(true, 'success', extra);
const rowStyle = (idx: number): React.CSSProperties => lvRow(true, idx);
const td: React.CSSProperties = lvTd(true);
// Expanded-row sub-table (shipment contents) — subordinate chrome, not the
// main-list chrome above. Classic-only like the rest of this file.
const subTh: React.CSSProperties = lvSubTh(true);
const subTd: React.CSSProperties = lvSubTd(true);
const subTable: React.CSSProperties = lvSubTable(true);
const xpLabel: React.CSSProperties = lvLabel(true);

const fmtQty = qtyFmt(2, 'id-ID');   // the deck feeds a printed Surat Jalan
const PAGE_SIZE = 20;
// The chip bar is what replaced the tab strip. '' = no filter (deck block pinned
// above the shipments); DECK is a *client-side* pseudo-status — no shipment row
// ever has it — that shows the un-staged pick lists on their own. Every other
// segment is a real Shipment.status and hides the deck block.
const DECK_FILTER = 'DECK';
const STATUS_FILTERS = [
    { value: '', label: 'All' },
    { value: DECK_FILTER, label: 'On Deck' },
    { value: 'STAGED' }, { value: 'VERIFIED' }, { value: 'DISPATCHED' }, { value: 'CANCELLED' },
];

// Deck rows wear a left tick so the two grains stay tellable apart without a
// second header, and a divider closes the block off from the shipments below.
const deckMark: React.CSSProperties = { borderLeft: '3px solid #c98a2e' };
const dividerTd: React.CSSProperties = {
    padding: 0, height: 3, background: '#ded9cd',
    borderTop: '1px solid #8a8578', borderBottom: '1px solid #ffffff',
};
// Customer PO under the SO code — their reference, ours above it.
const subRef: React.CSSProperties = { fontSize: 10, color: '#666666', marginTop: 1 };

/**
 * Loading deck — the second half of the outbound flow.
 *
 * "Deck" is the inbox: finished pick lists waiting to be loaded. Staging one or
 * more of them onto a truck mints a Shipment and its Surat Jalan number; the
 * printout goes out with the goods, a *different* person counts the cartons
 * against it and verifies, and only then does dispatch post goods issue.
 *
 * One table, two grains. This used to be two tabs — a Deck tab and a Shipments
 * tab — but the Deck tab was a picker masquerading as a list: eight columns whose
 * rows had no actions of their own, existing only to feed a checkbox selection.
 * Merged, the Status column carries the whole flow in one place
 * (PICKED -> STAGED -> VERIFIED -> DISPATCHED), which is what the loader and the
 * checker were each flipping tabs to reconstruct.
 *
 * Deck rows keep their real `PICKED` status rather than a made-up "ON DECK" —
 * that is what they are, and the chip already reads amber for it. "On Deck" is a
 * filter label only.
 */
export default function DispatchView() {
    const { partners, attributes, companyProfile, itemIndex, authFetch } = useData();
    const { formatDate: tzDate, formatDateTime: tzDateTime } = useTimezone();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const { hasPermission } = useUser();
    const canManage = hasPermission('sales.manage') || hasPermission('shipment.create');
    const canVerify = hasPermission('shipment.verify');
    const canDispatch = hasPermission('sales.manage') || hasPermission('shipment.dispatch');

    const [deck, setDeck] = useState<any[]>([]);
    const [deckLoading, setDeckLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('');
    // One expansion at a time across both grains, so the key carries its type:
    // `pl:<id>` or `shp:<id>`.
    const [expandedId, setExpandedId] = useState<string | null>(null);
    // Deck rows arrive as a rollup only — `/shipments/stageable` deliberately stays
    // cheap — so their cartons are fetched on first expand and then kept.
    const [deckDetail, setDeckDetail] = useState<Record<string, any>>({});
    const [editing, setEditing] = useState<any | null>(null);     // shipment header edit
    const [verifying, setVerifying] = useState<any | null>(null);
    const [printShp, setPrintShp] = useState<any | null>(null);

    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const { openId: menuOpenId, pos: menuPos, toggle: menuToggle, close: menuClose } = useFloatingMenu(180);

    const customerAddr = (name: string) => (partners || []).find((p: any) => p.name === name)?.address || '';

    const loadDeck = useCallback(async () => {
        setDeckLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/shipments/stageable`);
            if (res.ok) setDeck(await res.json());
        } finally { setDeckLoading(false); }
    }, [authFetch]);

    // Page window, the debounced server-backed search box, the loading flag and the
    // stale-response race guard all come from the shared hook
    // (context/usePaginatedList.ts) — the status chip bar rides in as a param, and
    // changing it restarts at page 1 on its own.
    const {
        rows: shipments, total, loading, page, setPage,
        searchInput, setSearch: setSearchInput, refetch: loadShipments,
    } = usePaginatedFetch<any>({
        endpoint: `${API_BASE}/shipments`,
        authFetch,
        pageSize: PAGE_SIZE,
        // DECK filters the deck block client-side, so the shipment query stays
        // unfiltered — flipping to that segment and back costs no refetch.
        params: { status: statusFilter === DECK_FILTER ? '' : statusFilter },
    });

    const skel = useTableSkeletonMetrics('shipments', listBodyRef, shipments.length > 0);

    useEffect(() => { loadDeck(); }, [loadDeck]);

    const refreshAll = useCallback(async () => {
        await Promise.all([loadDeck(), loadShipments()]);
    }, [loadDeck, loadShipments]);

    // Which half of the merged grid this filter segment shows.
    const showDeck = statusFilter === '' || statusFilter === DECK_FILTER;
    const showShipments = statusFilter !== DECK_FILTER;

    // The search box is server-backed for the shipments; the deck block is a local
    // array, so it filters here — otherwise a search would silently ignore half the
    // table. Matches the echoed input rather than the debounced value: the deck is
    // already in memory, so there is nothing to wait for.
    const deckRows = useMemo(() => {
        if (!showDeck) return [];
        const q = searchInput.trim().toLowerCase();
        if (!q) return deck;
        return deck.filter(d => [d.code, d.sales_order_code, d.customer_po_ref, d.customer_name]
            .some(v => String(v || '').toLowerCase().includes(q)));
    }, [deck, showDeck, searchInput]);

    // Keeps the pick-list rows themselves — staging posts their ids and the header
    // count sums their cartons. Fed the *visible* rows so select-all takes what is
    // on screen; anything selected and then filtered away stays in the selection,
    // which is why the count and a Clear button are always on show below.
    const sel = useRowSelection<any>(deckRows, d => String(d.id));
    const selectedDeck = sel.items;
    // One Surat Jalan addresses one customer — the backend rejects a mixed set, so
    // the button is disabled rather than letting the user find out on submit.
    const mixedCustomers = useMemo(
        () => new Set(selectedDeck.map(d => d.customer_name || '')).size > 1,
        [selectedDeck],
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { sel.clear(); }, [statusFilter]);

    const toggleExpand = (key: string) => setExpandedId(prev => (prev === key ? null : key));

    // Deck cartons on demand. `/shipments/stageable` returns a rollup only, and
    // `GET /pick-lists/{id}` already decorates lines with item, colour and batch.
    const loadDeckDetail = useCallback(async (plId: any) => {
        const k = String(plId);
        if (deckDetail[k]) return;
        const res = await authFetch(`${API_BASE}/pick-lists/${k}`);
        if (!res.ok) return;
        const data = await res.json();
        setDeckDetail(prev => ({ ...prev, [k]: data }));
    }, [authFetch, deckDetail]);

    // Staging no longer collects carrier/vehicle/driver/notes up front — it mints
    // the shipment immediately (defaults: next SJ number, today's date, everything
    // else blank) and drops straight into the print preview, which is now the one
    // place those loading-deck facts get typed in and saved.
    const stageNow = useCallback(async (picks: any[]) => {
        if (!picks.length) return;
        if (new Set(picks.map((p: any) => p.customer_name || '')).size > 1) {
            showToast('One Surat Jalan addresses one customer', 'danger');
            return;
        }
        const res = await authFetch(`${API_BASE}/shipments`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pick_list_ids: picks.map((d: any) => d.id) }),
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            showToast(`Error: ${e.detail || 'could not stage'}`, 'danger');
            return;
        }
        const shp = await res.json();
        sel.clear();
        await refreshAll();
        // Clear any filter that would hide the row that was just minted, and open it.
        setStatusFilter('');
        setExpandedId(`shp:${shp.id}`);
        showToast(`Staged ${shp.code} — Surat Jalan ${shp.delivery_note_number}`, 'success');
        setPrintShp(shp);
    }, [authFetch, refreshAll, sel, showToast]);

    const doVerify = async (shp: any, payload: any) => {
        const res = await authFetch(`${API_BASE}/shipments/${shp.id}/verify`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            showToast(`Error: ${e.detail || 'verify failed'}`, 'danger');
            return;
        }
        setVerifying(null);
        loadShipments();
        showToast(`${shp.code} verified`, 'success');
    };

    const doAction = async (shp: any, action: string, confirmText?: string) => {
        if (confirmText && !(await confirm({ title: 'Confirm', message: confirmText, variant: action === 'dispatch' ? 'success' : 'warning' }))) return;
        const res = await authFetch(`${API_BASE}/shipments/${shp.id}/${action}`, { method: 'POST' });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            showToast(`Error: ${e.detail || `${action} failed`}`, 'danger');
            return;
        }
        await refreshAll();
        showToast(`${shp.code} ${action === 'dispatch' ? 'dispatched' : action}ed`, 'success');
    };

    const doDelete = async (shp: any) => {
        if (!(await confirm({ title: 'Delete shipment', message: `Delete shipment ${shp.code}? Its pick lists return to the deck.`, variant: 'danger' }))) return;
        const res = await authFetch(`${API_BASE}/shipments/${shp.id}`, { method: 'DELETE' });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            showToast(`Error: ${e.detail || 'delete failed'}`, 'danger');
            return;
        }
        await refreshAll();
    };

    const openEdit = async (shp: any) => {
        // The list row already carries pick_lists; re-fetch anyway so the editor
        // never opens on a row that a WS refresh has since moved on.
        const res = await authFetch(`${API_BASE}/shipments/${shp.id}`);
        setEditing(res.ok ? await res.json() : shp);
    };

    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    // ── The one grid ─────────────────────────────────────────
    const bothBlocks = showDeck && showShipments && deckRows.length > 0;
    const nothingYet = deckRows.length === 0 && (!showShipments || shipments.length === 0);
    const stillLoading = (showDeck && deckLoading) || (showShipments && loading);

    const body = (
        <>
            <div style={{ ...xpToolbar(), gap: 6 }}>
                <SearchField
                    classic
                    value={searchInput}
                    onChange={setSearchInput}
                    placeholder="Search SJ no, code, vehicle..."
                />
                <FilterChipBar
                    classic
                    options={STATUS_FILTERS}
                    value={statusFilter}
                    onChange={setStatusFilter}
                />
                <ToolbarCount classic right>
                    {statusFilter === DECK_FILTER ? `${deckRows.length} on deck` : `${total} shipment(s)`}
                </ToolbarCount>
            </div>

            {/* Contextual strip — only on screen with a live selection, so the resting
                toolbar stays a search box and a filter bar rather than carrying both
                states side by side. */}
            {selectedDeck.length > 0 && (
                <div style={{ ...xpToolbar(), gap: 8, background: rowStateBg('selected', true) }}>
                    <span style={{ fontSize: 11 }}>
                        {`${selectedDeck.length} pick list(s) selected · ${selectedDeck.reduce((t, d) => t + num(d.carton_count), 0)} carton(s)`}
                    </span>
                    <div style={{ flex: 1 }} />
                    {mixedCustomers && (
                        <span style={{ fontSize: 11, color: '#8e0000' }}>
                            One Surat Jalan = one customer
                        </span>
                    )}
                    {canManage && (
                        <button className={XP_BTN} style={xpBtnGreen()} disabled={mixedCustomers} onClick={() => stageNow(selectedDeck)}>
                            Stage on Deck
                        </button>
                    )}
                    <button className={XP_BTN} style={xpBtn()} onClick={sel.clear}>Clear</button>
                </div>
            )}

            <div style={{ flex: 1, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: xpFont, fontSize: 11 }}>
                    <thead>
                        <tr>
                            <th style={{ ...xpTableHeader, width: LV_CHECK_COL_W, textAlign: 'center' }}>
                                <SelectAllCheckbox classic allSelected={sel.allPageSelected} someSelected={sel.someSelected}
                                    disabled={!sel.pageEligibleCount} onChange={sel.togglePage} />
                            </th>
                            <th style={xpTableHeader}>Document</th>
                            <th style={xpTableHeader}>Reference</th>
                            <th style={xpTableHeader}>Customer</th>
                            <th style={xpTableHeader}>Vehicle</th>
                            <th style={{ ...xpTableHeader, textAlign: 'right' }}>Cartons</th>
                            <th style={xpTableHeader}>Status</th>
                            <th style={xpTableHeader}>Checked by</th>
                            <th style={{ ...xpTableHeader, width: 96, textAlign: 'right' }} />
                        </tr>
                    </thead>
                    <tbody ref={listBodyRef}>
                        {nothingYet && (stillLoading ? (
                            <TableSkeleton rows={6} cols={skel.cols ?? COLS} classic tdStyle={td} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                        ) : (
                            <tr><td colSpan={COLS} style={{ padding: 0 }}>
                                <XPEmptyState icon="bi-truck" message={statusFilter === DECK_FILTER
                                    ? 'Deck is clear. Pick lists appear here once the floor has confirmed every carton.'
                                    : 'Nothing here yet. Pick lists land on the deck once the floor has confirmed every carton — select them to raise a Surat Jalan.'} />
                            </td></tr>
                        ))}

                        {/* Deck block: pinned above the shipments and deliberately outside
                            the pager — it is a short work queue, and paging it would hide
                            work rather than tidy it. */}
                        {deckRows.map((d, i) => {
                            const key = `pl:${d.id}`;
                            const open = expandedId === key;
                            const picked = sel.isSelected(d);
                            return (
                                <React.Fragment key={key}>
                                    <tr
                                        style={{
                                            ...rowStyle(i),
                                            ...(open ? { background: rowStateBg('expanded', true) }
                                                : picked ? { background: rowStateBg('selected', true) } : {}),
                                            cursor: 'pointer',
                                        }}
                                        onClick={() => { toggleExpand(key); if (!open) loadDeckDetail(d.id); }}
                                    >
                                        <td style={{ ...td, ...deckMark, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                                            <RowCheckbox classic checked={picked} onChange={() => sel.toggle(d)} label={`pick list ${d.code}`} />
                                        </td>
                                        <td style={td}><CodeChip code={d.code} classic tone="accent" /></td>
                                        <td style={td}>
                                            {d.sales_order_code || EMPTY_DASH}
                                            {d.customer_po_ref && <div style={subRef}>{d.customer_po_ref}</div>}
                                        </td>
                                        <td style={td}>{d.customer_name || EMPTY_DASH}</td>
                                        <td style={td}>{EMPTY_DASH}</td>
                                        <td style={{ ...td, textAlign: 'right' }}>{d.carton_count}</td>
                                        <td style={td}><StatusChip status="PICKED" /></td>
                                        <td style={td}>{EMPTY_DASH}</td>
                                        <td style={{ ...td, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                            {canManage && (
                                                <XPActionButton
                                                    classic
                                                    tone="success"
                                                    icon="bi-truck"
                                                    title="Stage on Deck"
                                                    onClick={() => stageNow([d])}
                                                />
                                            )}
                                        </td>
                                    </tr>
                                    {open && (
                                        <tr>
                                            <td colSpan={COLS} style={{ padding: 0 }}>
                                                <ExpandedRowPanel classic>
                                                    <DeckDetail row={d} pl={deckDetail[String(d.id)]} tzDate={tzDate} itemIndex={itemIndex} />
                                                </ExpandedRowPanel>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}

                        {bothBlocks && <tr><td colSpan={COLS} style={dividerTd} /></tr>}

                        {showShipments && shipments.map((shp, i) => {
                            const key = `shp:${shp.id}`;
                            const open = expandedId === key;
                            // Zebra runs on through the deck block instead of restarting, so
                            // the stripe reads as one list rather than two stacked ones.
                            const zebra = rowStyle(i + deckRows.length);
                            return (
                                <React.Fragment key={key}>
                                    <tr
                                        style={{ ...zebra, ...(open ? { background: rowStateBg('expanded', true) } : {}), cursor: 'pointer' }}
                                        onClick={() => toggleExpand(key)}
                                    >
                                        <td style={td} />
                                        <td style={td}><CodeChip code={shp.code} classic tone="accent" /></td>
                                        <td style={td}>{shp.delivery_note_number ? <CodeChip code={shp.delivery_note_number} classic /> : EMPTY_DASH}</td>
                                        <td style={td}>{shp.customer_name || EMPTY_DASH}</td>
                                        <td style={td}>{shp.vehicle_plate || EMPTY_DASH}</td>
                                        <td style={{ ...td, textAlign: 'right' }}>{shp.carton_count}</td>
                                        <td style={td}><StatusChip status={shp.status} /></td>
                                        <td style={td}>
                                            {shp.verified_by_name
                                                ? `${shp.verified_by_name}${shp.verified_with_discrepancy ? ' (discrepancy)' : ''}`
                                                : EMPTY_DASH}
                                        </td>
                                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                                            {canVerify && shp.status === 'STAGED' && (
                                                <span style={{ marginRight: 2 }}>
                                                    <XPActionButton classic tone="success" icon="bi-check2-square" title="Verify Load" onClick={() => setVerifying(shp)} />
                                                </span>
                                            )}
                                            {canManage && shp.status === 'VERIFIED' && (
                                                <span style={{ marginRight: 2 }}>
                                                    <XPActionButton classic tone="warning" icon="bi-arrow-counterclockwise" title="Reopen" onClick={() => doAction(shp, 'reopen')} />
                                                </span>
                                            )}
                                            {canDispatch && shp.status === 'VERIFIED' && (
                                                <span style={{ marginRight: 2 }}>
                                                    <XPActionButton classic tone="success" icon="bi-truck" title="Confirm Dispatch" onClick={() => doAction(shp, 'dispatch', `Dispatch ${shp.code}? This posts goods issue and cannot be undone.`)} />
                                                </span>
                                            )}
                                            <span style={{ marginRight: 2 }}>
                                                <XPActionButton classic tone="neutral" icon="bi-printer" title="Print Surat Jalan" onClick={() => setPrintShp(shp)} />
                                            </span>
                                            <MenuTriggerButton classic onClick={e => menuToggle(String(shp.id), e)} />
                                        </td>
                                    </tr>
                                    {open && (
                                        <tr>
                                            <td colSpan={COLS} style={{ padding: 0 }}>
                                                <ExpandedRowPanel classic>
                                                    <ShipmentDetail shp={shp} tzDateTime={tzDateTime} itemIndex={itemIndex} />
                                                </ExpandedRowPanel>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {showShipments && <Pager page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />}
        </>
    );

    const menuShipment = shipments.find(s => String(s.id) === menuOpenId);

    return (
        <ShellWindow classic fill="page" className="fade-in" style={{ fontFamily: xpFont }}>
            <ShellTitleBar classic icon="bi-truck" title="Dispatch & Loading Deck" />
            {body}

            <XPStatusBar right={`${deck.length} waiting · ${total} shipment(s)`}>
                Loading deck
            </XPStatusBar>

            {menuOpenId && menuShipment && (
                <FloatingMenu
                    pos={menuPos}
                    items={[
                        // Surat Jalan, Verify Load, Reopen and Confirm Dispatch are all
                        // promoted to the row's action column — the things a deck user
                        // reaches for every time a shipment is in that state. Only Edit,
                        // Cancel and Delete are left in the overflow menu.
                        ...(canManage && ['DRAFT', 'STAGED'].includes(menuShipment.status)
                            ? [{ key: 'edit', label: 'Edit', icon: 'bi-pencil', onClick: () => { menuClose(); openEdit(menuShipment); } }] : []),
                        ...(canManage && menuShipment.status !== 'DISPATCHED'
                            ? [{ key: 'cancel', label: 'Cancel', icon: 'bi-x-circle', onClick: () => { menuClose(); doAction(menuShipment, 'cancel', `Cancel ${menuShipment.code}? Pick lists return to the deck.`); } }] : []),
                        ...(canManage && menuShipment.status !== 'DISPATCHED'
                            ? [{ key: 'delete', label: 'Delete', icon: 'bi-trash', onClick: () => { menuClose(); doDelete(menuShipment); } }] : []),
                    ]}
                />
            )}

            {editing && (
                <EditShipmentModal
                    shp={editing}
                    deck={deck}
                    authFetch={authFetch}
                    showToast={showToast}
                    onClose={() => setEditing(null)}
                    onSaved={async () => { setEditing(null); await refreshAll(); }}
                />
            )}

            {verifying && (
                <VerifyModal
                    shp={verifying}
                    onClose={() => setVerifying(null)}
                    onSubmit={(payload: any) => doVerify(verifying, payload)}
                    showToast={showToast}
                />
            )}

            {printShp && (
                <SuratJalanPrintModal
                    shipment={printShp}
                    attributes={attributes}
                    companyProfile={companyProfile}
                    customerAddr={customerAddr}
                    onClose={() => setPrintShp(null)}
                    onSaved={refreshAll}
                />
            )}
        </ShellWindow>
    );
}

// ── Expanded row: what is physically on this truck ─────────────────────────
function ShipmentDetail({ shp, tzDateTime, itemIndex }: any) {
    const info = (k: string, v: any) => (
        <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
            <span style={{ ...xpLabel, minWidth: 110 }}>{k}</span>
            <span>{v ?? '—'}</span>
        </div>
    );
    return (
        <div style={{ display: 'flex', gap: 20, padding: '8px 12px', fontFamily: xpFont }}>
            <div style={{ minWidth: 260 }}>
                {info('Surat Jalan', shp.delivery_note_number)}
                {info('Delivery date', shp.delivery_date ? tzDateTime(shp.delivery_date) : null)}
                {info('Carrier', shp.carrier)}
                {info('Vehicle', shp.vehicle_plate)}
                {info('Driver', shp.driver)}
                {info('Staged by', shp.staged_by_name)}
                {info('Staged at', shp.staged_at ? tzDateTime(shp.staged_at) : null)}
                {info('Checked by', shp.verified_by_name)}
                {info('Checked at', shp.verified_at ? tzDateTime(shp.verified_at) : null)}
                {shp.verified_with_discrepancy && info('Discrepancy', 'Yes — passed with note')}
                {shp.verification_notes && info('Check notes', shp.verification_notes)}
                {info('Dispatched', shp.dispatched_at ? tzDateTime(shp.dispatched_at) : null)}
            </div>
            <div style={{ flex: 1 }}>
                {/* Sub-table chrome, not the main-list chrome it used to borrow —
                    dressed as the outer list it reads as a second grid. No zebra:
                    the index restarts per pick list, so the stripe was banding by
                    position-within-document rather than by row anyway. */}
                <table style={subTable}>
                    <thead>
                        <tr>
                            <th style={subTh}>Pick List</th>
                            <th style={subTh}>SO</th>
                            <th style={subTh}>Item</th>
                            <th style={subTh}>Identity</th>
                            <th style={subTh}>Carton</th>
                            <th style={{ ...subTh, textAlign: 'right' }}>Qty</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(shp.pick_lists || []).flatMap((pl: any) =>
                            (pl.lines || []).map((l: any) => (
                                <tr key={`${pl.id}-${l.id}`}>
                                    <td style={subTd}><CodeChip code={pl.code} classic tier={2} /></td>
                                    <td style={subTd}>{pl.sales_order_code || '—'}</td>
                                    <td style={subTd}>{l.item_name || itemIndex?.[String(l.item_id)]?.name || '—'}</td>
                                    <td style={subTd}>{cartonChips(l)}</td>
                                    <td style={subTd}>{l.batch_number ? <CodeChip code={l.batch_number} classic tier={2} /> : '—'}</td>
                                    <td style={{ ...subTd, textAlign: 'right' }}>{fmtQty(l.qty_picked)} {l.item_uom || ''}</td>
                                </tr>
                            )))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Expanded deck row: what this pick list would put on a truck ───────────
// The row itself is a rollup, so the cartons are fetched on first expand. Same
// two-pane shape as ShipmentDetail — a loader reads them the same way.
function DeckDetail({ row, pl, tzDate, itemIndex }: any) {
    const info = (k: string, v: any) => (
        <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
            <span style={{ ...xpLabel, minWidth: 110 }}>{k}</span>
            <span>{v ?? EMPTY_DASH}</span>
        </div>
    );
    const lines = pl?.lines || [];
    return (
        <div style={{ display: 'flex', gap: 20, padding: '8px 12px', fontFamily: xpFont }}>
            <div style={{ minWidth: 260 }}>
                {info('Sales order', row.sales_order_code)}
                {info('Customer PO', row.customer_po_ref)}
                {info('Customer', row.customer_name)}
                {info('Cartons', row.carton_count)}
                {info('Total qty', fmtQty(row.total_qty))}
                {info('Picked', row.picked_at ? tzDate(row.picked_at) : null)}
                {info('QC', row.qc_passed ? 'Passed' : 'Not passed')}
            </div>
            <div style={{ flex: 1 }}>
                {!pl ? (
                    <div style={{ fontSize: 11, color: '#555555' }}>Loading cartons…</div>
                ) : (
                    <table style={subTable}>
                        <thead>
                            <tr>
                                <th style={subTh}>Item</th>
                                <th style={subTh}>Identity</th>
                                <th style={subTh}>Carton</th>
                                <th style={{ ...subTh, textAlign: 'right' }}>Qty</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map((l: any) => (
                                <tr key={String(l.id)}>
                                    <td style={subTd}>{l.item_name || itemIndex?.[String(l.item_id)]?.name || EMPTY_DASH}</td>
                                    <td style={subTd}>{cartonChips(l)}</td>
                                    <td style={subTd}>{l.batch_number ? <CodeChip code={l.batch_number} classic tier={2} /> : EMPTY_DASH}</td>
                                    <td style={{ ...subTd, textAlign: 'right' }}>
                                        {fmtQty(l.qty_picked)} {l.item_uom || itemIndex?.[String(l.item_id)]?.uom || ''}
                                    </td>
                                </tr>
                            ))}
                            {lines.length === 0 && (
                                <tr><td colSpan={4} style={{ ...subTd, color: '#555555' }}>No cartons on this pick list.</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

// ── Edit a staged shipment's header / membership ───────────────────────────
function EditShipmentModal({ shp, deck, authFetch, showToast, onClose, onSaved }: any) {
    const [dn, setDn] = useState(shp.delivery_note_number || '');
    const [date, setDate] = useState(shp.delivery_date ? String(shp.delivery_date).slice(0, 10) : '');
    const [carrier, setCarrier] = useState(shp.carrier || '');
    const [vehicle, setVehicle] = useState(shp.vehicle_plate || '');
    const [driver, setDriver] = useState(shp.driver || '');
    const [notes, setNotes] = useState(shp.notes || '');
    const [members, setMembers] = useState<Record<string, boolean>>(
        () => Object.fromEntries((shp.pick_lists || []).map((p: any) => [String(p.id), true])),
    );

    // Current members plus anything still free on the deck for the same customer.
    const candidates = useMemo(() => {
        const own = (shp.pick_lists || []).map((p: any) => ({
            id: p.id, code: p.code, sales_order_code: p.sales_order_code,
            customer_name: p.customer_name, carton_count: p.carton_count,
        }));
        const ownIds = new Set(own.map((p: any) => String(p.id)));
        const free = (deck || []).filter((d: any) =>
            !ownIds.has(String(d.id)) && (!shp.customer_name || d.customer_name === shp.customer_name));
        return [...own, ...free];
    }, [shp, deck]);

    const save = async () => {
        const res = await authFetch(`${API_BASE}/shipments/${shp.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                delivery_note_number: dn || null,
                delivery_date: date ? new Date(date).toISOString() : null,
                carrier: carrier || null, vehicle_plate: vehicle || null, driver: driver || null,
                notes: notes || null,
                pick_list_ids: candidates.filter((c: any) => members[String(c.id)]).map((c: any) => c.id),
            }),
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            showToast(`Error: ${e.detail || 'save failed'}`, 'danger');
            return;
        }
        onSaved();
    };

    return (
        <ModalWrapper
            isOpen onClose={onClose} title={`Edit ${shp.code}`} size="lg" modeless
            footer={<><button className={XP_BTN} style={xpBtn()} onClick={onClose}>Cancel</button><button className={XP_BTN} style={xpBtnGreen()} onClick={save}>Save</button></>}
        >
            <div style={{ fontFamily: xpFont, fontSize: 11, display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                    <div style={xpLabel}>Surat Jalan no.</div>
                    <input style={{ ...xpInput, width: '100%', marginBottom: 8 }} value={dn} onChange={e => setDn(e.target.value)} />
                    <div style={xpLabel}>Delivery date</div>
                    <input type="date" style={{ ...xpInput, width: '100%', marginBottom: 8 }} value={date} onChange={e => setDate(e.target.value)} />
                    <div style={xpLabel}>Carrier</div>
                    <input style={{ ...xpInput, width: '100%', marginBottom: 8 }} value={carrier} onChange={e => setCarrier(e.target.value)} />
                    <div style={xpLabel}>Vehicle no.</div>
                    <input style={{ ...xpInput, width: '100%', marginBottom: 8 }} value={vehicle} onChange={e => setVehicle(e.target.value)} />
                    <div style={xpLabel}>Driver</div>
                    <input style={{ ...xpInput, width: '100%', marginBottom: 8 }} value={driver} onChange={e => setDriver(e.target.value)} />
                    <div style={xpLabel}>Notes</div>
                    <input style={{ ...xpInput, width: '100%' }} value={notes} onChange={e => setNotes(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                    <div style={xpLabel}>Pick lists on this shipment</div>
                    <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #b0a898', padding: 6, background: '#fff' }}>
                        {candidates.map((c: any) => (
                            <label key={String(c.id)} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' }}>
                                <RowCheckbox classic checked={!!members[String(c.id)]} label={`pick list ${c.code}`}
                                    onChange={() => setMembers(m => ({ ...m, [String(c.id)]: !m[String(c.id)] }))} />
                                <CodeChip code={c.code} classic tier={2} />
                                <span style={{ color: '#555' }}>{c.sales_order_code} · {c.carton_count} ctn</span>
                            </label>
                        ))}
                        {candidates.length === 0 && <div style={{ color: '#555' }}>Nothing available.</div>}
                    </div>
                </div>
            </div>
        </ModalWrapper>
    );
}

/**
 * Identity chips for one carton on the deck check.
 *
 * `carton_identity` is present on every line the server could resolve, but a
 * carton packed out of a plain unvariant lot (manual stock entry, an item with
 * no variant_type, a pre-feature lot) resolves to an object whose fields are all
 * null — `LotChips` correctly renders nothing for it, which left an empty cell
 * that reads as a broken column rather than as "this box has no size or shade".
 * So: carton first, the ORDERED shade + stamped size as fallback (that is all a
 * bulk legacy line has), an explicit dash when the box genuinely has no identity.
 */
function cartonChips(c: any) {
    const ci = c.carton_identity;
    const hasCarton = !!ci && (
        lotSizeLabel(ci) || lotComboLabel(ci) || lotColorLabel(ci) || (ci.variant_attributes || []).length > 0
    );
    if (hasCarton) return <LotChipRow><LotChips batch={ci} /></LotChipRow>;

    const size = c.size_label || lotSizeLabel(ci || {});
    const color = colorLabel(c.color_code, c.color_name);
    if (!size && !color) return <span style={{ color: '#bbb' }}>{EMPTY_DASH}</span>;
    return (
        <LotChipRow>
            {size && <LotChip tone="size" title={`Size: ${size}`}>{size}</LotChip>}
            {color && (
                <LotChip tone="color" swatch={c.color_hex || null} title={`Ordered shade: ${colorTitle(c.color_code, c.color_name)}`}>
                    {color}
                </LotChip>
            )}
        </LotChipRow>
    );
}

// ── The deck check ─────────────────────────────────────────────────────
function VerifyModal({ shp, onClose, onSubmit, showToast }: any) {
    const [notes, setNotes] = useState('');
    const [discrepancy, setDiscrepancy] = useState(false);
    const [ticked, setTicked] = useState<Record<string, boolean>>({});
    const [scanCode, setScanCode] = useState('');
    const scanRef = useRef<HTMLInputElement | null>(null);

    const cartons = (shp.pick_lists || []).flatMap((pl: any) =>
        (pl.lines || []).filter((l: any) => l.batch_number).map((l: any) => ({ ...l, pl_code: pl.code })));
    const doneCount = cartons.filter((c: any) => ticked[String(c.id)]).length;
    const allTicked = cartons.length > 0 && doneCount === cartons.length;

    useEffect(() => { scanRef.current?.focus(); }, []);

    // Same scan-to-confirm shape as the pick list floor screen — the checker
    // gun-scans (or types) each carton rather than hunting it in a checkbox list.
    // Purely a local tally: nothing is written to the server until Confirm Load.
    const scan = (code: string) => {
        const trimmed = code.trim();
        if (!trimmed) return;
        const match = cartons.find((c: any) => (c.batch_number || '').toUpperCase() === trimmed.toUpperCase());
        if (!match) {
            showToast?.(`No carton '${trimmed}' on this shipment`, 'danger');
        } else if (ticked[String(match.id)]) {
            showToast?.(`${trimmed} already counted`, 'warning');
        } else {
            setTicked(t => ({ ...t, [String(match.id)]: true }));
        }
        setScanCode('');
        scanRef.current?.focus();
    };

    return (
        <ModalWrapper
            isOpen onClose={onClose} title={`Verify Load — ${shp.code}`} size="xl" modeless variant="success"
            footer={
                <>
                    <button className={XP_BTN} style={xpBtn()} onClick={onClose}>Cancel</button>
                    <button
                        className={XP_BTN}
                        style={xpBtnGreen()}
                        disabled={!allTicked && !discrepancy}
                        onClick={() => onSubmit({ notes: notes || null, with_discrepancy: discrepancy })}
                    >Confirm Load</button>
                </>
            }
        >
            <div style={{ fontFamily: xpFont, fontSize: 11 }}>
                <div style={{ marginBottom: 8 }}>
                    Count the cartons on the deck against Surat Jalan{' '}
                    <strong style={{ fontFamily: CODE_FONT }}>{shp.delivery_note_number}</strong>. Scan each carton you
                    have physically seen — you cannot verify a shipment you staged yourself.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <input
                        ref={scanRef}
                        style={{ ...xpInput, width: 260 }}
                        placeholder="Scan or type carton number (PU-…)"
                        value={scanCode}
                        onChange={e => setScanCode(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); scan(scanCode); } }}
                    />
                    <button className={XP_BTN} style={xpBtn()} disabled={!scanCode.trim()} onClick={() => scan(scanCode)}>Confirm</button>
                    <span style={{ fontSize: 10, color: allTicked && cartons.length > 0 ? '#0a3e0a' : '#c77800' }}>
                        {doneCount}/{cartons.length} counted
                    </span>
                </div>
                <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #b0a898', background: '#fff' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                            <tr>
                                <th style={{ ...xpTableHeader, width: LV_CHECK_COL_W, textAlign: 'center' }} />
                                <th style={xpTableHeader}>Carton</th>
                                <th style={xpTableHeader}>Item</th>
                                <th style={xpTableHeader}>Identity</th>
                                <th style={{ ...xpTableHeader, textAlign: 'right' }}>Qty</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cartons.map((c: any, i: number) => (
                                <tr key={String(c.id)} style={rowStyle(i)}>
                                    <td style={{ ...td, textAlign: 'center' }}>
                                        {/* Ticked one carton at a time by design — a select-all
                                            would defeat the second count. */}
                                        <RowCheckbox classic checked={!!ticked[String(c.id)]} label={`carton ${c.batch_number}`}
                                            onChange={() => setTicked(t => ({ ...t, [String(c.id)]: !t[String(c.id)] }))} />
                                    </td>
                                    <td style={td}><CodeChip code={c.batch_number} classic tier={2} /></td>
                                    <td style={td}>{c.item_code || c.item_name}</td>
                                    {/* What is in the BOX — size, combo, shade (with swatch) —
                                        off the carton's own stock key, same chips the picker
                                        confirmed on and the Kartu Packing carries. The line's
                                        own `color_name` is the ORDERED shade and prints on the
                                        Surat Jalan; a checker counting a substituted lot has to
                                        see the real one, so the carton wins when it has one. */}
                                    <td style={td}>{cartonChips(c)}</td>
                                    <td style={{ ...td, textAlign: 'right' }}>{fmtQty(c.qty_picked)} {c.item_uom || ''}</td>
                                </tr>
                            ))}
                            {cartons.length === 0 && (
                                <tr><td colSpan={5} style={{ ...td, color: '#555' }}>No cartons on this shipment.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
                    <input type="checkbox" checked={discrepancy} onChange={e => setDiscrepancy(e.target.checked)} />
                    Pass with discrepancy (short or over load agreed with the customer)
                </label>
                <div style={{ ...xpLabel, marginTop: 8 }}>Check notes</div>
                <input style={{ ...xpInput, width: '100%' }} value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder={discrepancy ? 'Required context for the discrepancy' : 'Optional'} />
            </div>
        </ModalWrapper>
    );
}
