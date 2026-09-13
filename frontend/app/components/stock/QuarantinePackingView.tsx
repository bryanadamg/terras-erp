'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '../../context/ThemeContext';
import { useData } from '../../context/DataContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import { useUser } from '../../context/UserContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useToast } from '../shared/Toast';
import { ShellWindow, ShellTitleBar, xpToolbar as sharedXpToolbar, SearchField, ToolbarCount, FilterChipBar, FilterChipOption } from '../shared/shellTheme';
import {
    lvTh, lvThead, lvTd, lvRow, lvBtn, lvInput, lvLabel, lvSep,
    lvSubTh, lvSubTd, lvSubTable, lvSubCaption, lvSubRow, LV_XP_FONT, LV_MODERN_FONT,
    ExpanderCell, LV_EXPANDER_COL_W, LV_CHECK_COL_W, RowCheckbox, SelectAllCheckbox,
} from '../shared/listViewTheme';
import {
    StatusChip, StatusCountPill, TableSkeleton, useTableSkeletonMetrics, XPStatusBar, XPEmptyState,
    XPActionButton, ColorSwatchChip, ExpandedRowPanel, CodeChip, rowStateBg, ToggleChip, ChipTone,
    OriginChip, OriginChipRow, colorLabel, colorTitle, resolveColorHex, XP_BTN,
} from '../shared/xpTheme';
import Pager from '../shared/Pager';
import { API_BASE } from '../shared/apiBase';
import { LotChips, LotChip, LotChipRow, LotVariantAttr, lotSizeLabel, lotComboLabel } from '../shared/LotChips';

/**
 * Quarantine Packing — the QC hold desk between production output and packing.
 *
 * Everything sitting in a quarantine location (Location.is_quarantine, inherited
 * by child zones/bins) lands here, grouped by the MO that produced it.
 *
 * The disposition is set **per lot**, and the MO row shows a rollup. That is
 * deliberate: a batch is rarely uniformly good, and an MO-level-only status
 * would force the whole run to wait on its worst lot. The row-level control is
 * a convenience that writes the same status to every lot of the group — the
 * lot stays the source of truth either way.
 *
 * Only the disposition flagged `is_pass` by the backend ("OK") releases a lot;
 * packing 400s on anything else. This page never moves stock — releasing is a
 * status change, and packing pulls straight out of the quarantine location.
 *
 * Inside the expanded panel the lots are banded by the **calendar day the
 * disposition was decided** (`quarantine_status_at`, rendered in the display
 * timezone), newest day first, with everything still undecided banded on top.
 * QC works the hold area in passes, so "what did we decide on the 9th" is the
 * question the floor actually asks of this table.
 */

const PAGE_SIZE = 25;

const fmtQty = (n: number) =>
    Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

/**
 * Checkbox with a real indeterminate state — `indeterminate` is a DOM property,
 * not an attribute, so React cannot set it through JSX and it has to be written
 * on the node. Module-level (not nested in the view) so React keeps the same
 * element across renders instead of remounting it on every keystroke elsewhere.
 */
type Lot = {
    batch_id: string | null;
    batch_number: string | null;
    item_id: string;
    qty: number;
    location_id: string | null;
    location_name: string | null;
    quality_status: string | null;
    quarantine_status: string | null;
    quarantine_status_id: string | null;
    quarantine_status_at: string | null;
    quarantine_status_by: string | null;
    quarantine_notes: string | null;
    released: boolean;
    // Drawn by a packing completion — the disposition is frozen from then on.
    packed: boolean;
    // How much packing has drawn. On a history row (qty 0, only present with
    // "Show packed" on) this is the only quantity the lot still has to show.
    qty_packed: number | null;
    last_packed_at: string | null;
    created_at: string | null;
    bom_size_snapshot?: { size_name?: string | null; label?: string | null } | null;
    variant_attributes?: LotVariantAttr[] | null;
    color_code: string | null;
    color_name: string | null;
    color_hex: string | null;
    labdip_variant_code: string | null;
    // How much of this lot an open packing order has allocated to itself — that
    // order's OPEN quantity (target minus packed), spread FIFO across the lots it
    // could draw from. `qty - claimed_qty` is what is still free to plan against,
    // so a lot can be partly claimed and partly available.
    claimed_qty: number;
    // Who claimed it. A label — `claimed_qty` is the figure that gates anything.
    claimed_by_order_code: string | null;
    // The WO that produced this lot. A group is one MO, but an MO can run
    // several WOs (e.g. re-dyeing passes), so this is meaningful per lot.
    wo_code: string | null;
};

type Group = {
    key: string;
    mo_id: string | null;
    mo_code: string | null;
    mo_status: string | null;
    mo_qty: number | null;
    production_run_code: string | null;
    sales_order_id: string | null;
    sales_order_code: string | null;
    color_id: string | null;
    color_code: string | null;
    color_name: string | null;
    color_hex: string | null;
    labdip_variant_code: string | null;
    combo_value_id: string | null;
    bom_size_id: string | null;
    size_label: string | null;
    item_id: string;
    item_code: string | null;
    item_name: string | null;
    uom: string | null;
    qty_total: number;
    qty_released: number;
    // Released stock already allocated to open packing orders. `qty_released -
    // qty_claimed` is what Pack can still offer a new order.
    qty_claimed: number;
    lot_count: number;
    // Listed history lots — counted apart, so the held columns never inflate.
    packed_lot_count: number;
    rollup_status: string;
    status_counts: Record<string, number>;
    lots: Lot[];
};

type StatusOption = { id: string; value: string; is_pass: boolean };

// What is left of a lot after open packing orders have taken their allocation —
// the figure a new packing order can be planned against. Claims are quantities,
// not flags, so a lot can be half spoken for and half free.
const lotFreeQty = (l: Lot) => Math.max(0, (l.qty || 0) - (l.claimed_qty || 0));
// Fully allocated: nothing left to plan, so the row reads settled like a packed one.
const isFullyClaimed = (l: Lot) => (l.claimed_qty || 0) > 0 && lotFreeQty(l) <= 1e-6;

// Rollup filter choices that are not attribute values.
const DERIVED_FILTERS = [
    { key: 'NONE', label: 'No status yet' },
    { key: 'MIXED', label: 'Mixed' },
];

export default function QuarantinePackingView() {
    const { uiStyle } = useTheme();
    const classic = uiStyle === 'classic';
    const { authFetch, subscribeLiveEvents } = useData();
    const { hasPermission } = useUser();
    const { formatTime: tzTime, formatCustom: tzCustom } = useTimezone();
    const { showToast } = useToast();
    const router = useRouter();

    const canSetStatus = hasPermission('quarantine.set_status');
    const canPack = hasPermission('sales.manage');

    const [statuses, setStatuses] = useState<StatusOption[]>([]);
    const [saving, setSaving] = useState<string | null>(null);

    const [statusFilter, setStatusFilter] = useState('');
    // The page reads live stock, so a lot packed out of the hold area drops off
    // it entirely. Off by default — the desk's job is the queue, not the archive
    // — but one click brings the packed lots back as read-only history.
    const [showPacked, setShowPacked] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    // Checked lots, keyed by batch id (globally unique, so one flat set covers
    // every expanded group). Only ever holds *selectable* lots — see selectableIds.
    const [selectedLots, setSelectedLots] = useState<Set<string>>(new Set());

    const fetchStatuses = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/quarantine/statuses`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setStatuses(await res.json());
        } catch {
            setStatuses([]);
        }
    }, [authFetch]);

    // Page window, the debounced `?search=` box, the loading flag, the failure
    // message behind the error banner and the stale-response race guard all come
    // from the shared hook (context/usePaginatedList.ts); the two filters ride in
    // as params, and changing either one restarts at page 1 on its own.
    const {
        rows: groups, total, meta, loading, error, page, setPage,
        search, searchInput, setSearch: setSearchInput, refetch,
    } = usePaginatedFetch<Group>({
        endpoint: `${API_BASE}/quarantine`,
        authFetch,
        pageSize: PAGE_SIZE,
        params: { status: statusFilter, include_packed: showPacked ? 'true' : '' },
    });
    const truncated = !!meta.truncated;

    /**
     * Silent reload: refetch without showing the skeleton.
     *
     * A disposition write re-reads the same page with one field changed, but a
     * loud refetch flips `loading` on, which appends the skeleton block under
     * the live rows and collapses it again a moment later — the table jumps
     * twice for a change of one chip. Skeletons are for a page that has nothing
     * to show yet (first load, new filter, new page), not for a row edit. The
     * shared hook owns `loading`, so the quiet mode is a flag over it rather
     * than a second fetch path.
     */
    const [quiet, setQuiet] = useState(false);
    const silentRefetch = useCallback(() => { setQuiet(true); refetch(); }, [refetch]);
    useEffect(() => { if (!loading) setQuiet(false); }, [loading]);
    const showSkeleton = loading && !quiet;

    /**
     * Layout freeze — the reason this page does not move under the user's cursor.
     *
     * Both the group order and a lot's band are functions of the disposition, so
     * the act of setting one re-sorts the thing you just clicked out from under
     * you: the MO row slides down (the server sorts undispositioned first, and
     * with a 25-row window it can leave the page outright) and the lot jumps from
     * "Awaiting decision" into today's decided band. Correct orderings, terrible
     * to work in — QC clicks OK down a list and the list rearranges every click.
     *
     * So the freeze holds the on-screen *arrangement* steady while the data under
     * it stays live. Refetches still happen and every figure still updates in
     * place; only the position is pinned, and only until the next real reload
     * (page, search, filter, or the packed-history toggle), when the queue
     * re-sorts properly.
     *
     * `orderRef`  — group keys in the order they were first shown.
     * `stickyRef` — last-known copy of a group, so one that re-sorted onto
     *               another page is still rendered rather than vanishing.
     * `touchedRef`— groups the user has actually acted on. Only those (and
     *               expanded ones) are kept when the server stops returning them;
     *               without that, unrelated churn would pile up stale rows.
     * `bandRef`   — a lot's band key, captured the first time it is seen.
     */
    const orderRef = useRef<string[]>([]);
    const stickyRef = useRef<Map<string, Group>>(new Map());
    const touchedRef = useRef<Set<string>>(new Set());
    const bandRef = useRef<Map<string, string>>(new Map());
    const thaw = useCallback(() => {
        orderRef.current = [];
        stickyRef.current.clear();
        touchedRef.current.clear();
        bandRef.current.clear();
    }, []);
    // A real reload is the moment the queue is allowed to re-sort. A silent
    // refetch after a disposition write is not one, which is the whole point.
    useEffect(() => { thaw(); }, [page, search, statusFilter, showPacked, thaw]);

    const stableGroups = useMemo(() => {
        for (const g of groups) stickyRef.current.set(g.key, g);
        const byKey = new Map(groups.map(g => [g.key, g]));
        const out: Group[] = [];
        const seen = new Set<string>();
        for (const k of orderRef.current) {
            if (seen.has(k)) continue;
            // Still on the page -> the live row. Gone from it -> the retained copy,
            // but only if the user has a stake in it (acted on it, or has it open).
            const g = byKey.get(k)
                ?? ((touchedRef.current.has(k) || expanded.has(k)) ? stickyRef.current.get(k) : undefined);
            if (g) { out.push(g); seen.add(k); }
        }
        for (const g of groups) if (!seen.has(g.key)) { out.push(g); seen.add(g.key); }
        orderRef.current = out.map(g => g.key);
        return out;
    }, [groups, expanded]);

    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics(classic ? 'quarantine-classic' : 'quarantine', listBodyRef, stableGroups.length > 0);

    useEffect(() => { fetchStatuses(); }, [fetchStatuses]);

    // Another QC user releasing a lot, or production landing more output in the
    // hold area, both arrive as a 'stock' live event — reload rather than leave a
    // stale queue on screen. Always silent: a background event must never blank
    // the table someone is reading. Coalesced on a short timer because one write
    // broadcasts twice (QUARANTINE_UPDATE + STOCK_UPDATE) and our own write is
    // already refetching — without this the page reloads three times per click.
    const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        const off = subscribeLiveEvents(['stock'], () => {
            if (liveTimer.current) clearTimeout(liveTimer.current);
            liveTimer.current = setTimeout(() => silentRefetch(), 600);
        });
        return () => {
            if (liveTimer.current) clearTimeout(liveTimer.current);
            off();
        };
    }, [subscribeLiveEvents, silentRefetch]);

    // "Pack" hands this group's still-free released stock to the Packing page as a
    // deep link — it opens the New Packing Order form pre-filled, not creates the
    // order itself. Scoped to the group (this MO's lots), not the (item, location)
    // pair: two MOs can share both, and an order already open against one must
    // never hide the other's own released stock.
    //
    // The target is `qty - claimed_qty` summed over the released lots, NOT the
    // group's released total: whatever open orders have already allocated is
    // theirs, and re-offering it would plan two orders over one physical lot.
    // Equally it is not "zero because some order exists" — that is what left a
    // 2 kg order sitting fulfilled-but-open holding 8 kg of released stock
    // hostage, with Pack greyed out and nothing able to release it.
    const packGroup = useCallback((g: Group) => {
        const free = g.lots.filter(l => l.released && !l.packed && lotFreeQty(l) > 0);
        const sourceLot = free.find(l => l.location_id) || g.lots.find(l => l.location_id);
        if (!sourceLot?.location_id) {
            showToast('No lot location to pack from', 'warning');
            return;
        }
        const qtyFree = free.reduce((s, l) => s + lotFreeQty(l), 0);
        const params = new URLSearchParams({
            action: 'create_packing_order',
            item_id: g.item_id,
            source_location_id: sourceLot.location_id,
            qty_target: String(qtyFree),
        });
        if (g.sales_order_id) params.set('sales_order_id', g.sales_order_id);
        if (g.bom_size_id) params.set('bom_size_id', g.bom_size_id);
        // The size as text as well as the id: an SO line carries a Size-master id,
        // never a BOMSize one, so the name is the only thing the two sides share.
        if (g.size_label) params.set('size_label', g.size_label);
        if (g.color_id) params.set('color_id', g.color_id);
        if (g.combo_value_id) params.set('combo_value_id', g.combo_value_id);
        router.push(`/packing?${params.toString()}`);
    }, [router, showToast]);

    const setStatus = useCallback(async (batchIds: string[], statusValueId: string | null, label: string) => {
        const ids = batchIds.filter(Boolean);
        if (!ids.length) {
            showToast('These rows have no lot, so they cannot be given a status', 'warning');
            return;
        }
        setSaving(ids.join(','));
        try {
            const res = await authFetch(`${API_BASE}/quarantine/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ batch_ids: ids, status_value_id: statusValueId }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.detail || `HTTP ${res.status}`);
            }
            showToast(`${label} set on ${ids.length} lot${ids.length > 1 ? 's' : ''}`, 'success');
            // The write is about to change this group's rollup, which is the
            // server's primary sort key — it may re-sort onto another page and stop
            // coming back. Mark it so the freeze keeps rendering the retained copy
            // instead of letting the row the user just clicked disappear.
            const touched = new Set(ids);
            for (const g of stableGroups) {
                if (g.lots.some(l => l.batch_id && touched.has(l.batch_id))) touchedRef.current.add(g.key);
            }
            // Whatever we just wrote is done with — drop it from the checked set so
            // the selection bar reflects what is still pending, not what was applied.
            setSelectedLots(prev => {
                const next = new Set(prev);
                ids.forEach(id => next.delete(id));
                return next;
            });
            silentRefetch();
        } catch (e: any) {
            showToast(e?.message || 'Could not set the status', 'danger');
        } finally {
            setSaving(null);
        }
    }, [authFetch, silentRefetch, showToast, stableGroups]);

    // In-flight lot ids. `saving` is a joined key of exactly the lots being
    // written, so only their own controls grey out — disabling every bar on the
    // page for one lot's write dimmed the whole table on each click.
    const savingIds = useMemo(
        () => new Set((saving || '').split(',').filter(Boolean)),
        [saving],
    );
    const busy = useCallback(
        (ids: (string | null)[]) => ids.some(id => !!id && savingIds.has(id)),
        [savingIds],
    );

    // ── Lot selection ─────────────────────────────────────────────────────────
    // Packed lots are locked, and so is a lot every unit of which an open packing
    // order has already allocated. A *partly* claimed lot is not locked: the claim
    // is a quantity, so the rest of it is still free stock the desk can act on.
    // Un-lotted rows have nothing to write a status to. Same filter the whole-MO
    // apply uses.
    const selectableIds = (lots: Lot[]) =>
        lots.filter(l => l.batch_id && !l.packed && !isFullyClaimed(l)).map(l => l.batch_id) as string[];

    const setSelection = (ids: string[], on: boolean) => setSelectedLots(prev => {
        const next = new Set(prev);
        ids.forEach(id => (on ? next.add(id) : next.delete(id)));
        return next;
    });

    const toggleRow = (k: string, lots: Lot[] = []) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(k)) {
                next.delete(k);
                // Collapsing hides the checkboxes; leaving them ticked would arm an
                // apply the user can no longer see the targets of.
                setSelection(selectableIds(lots), false);
            } else {
                next.add(k);
            }
            return next;
        });
    };

    // ── Status control ────────────────────────────────────────────────────────
    // One click per disposition, not a dropdown: QC works the hold desk lot by
    // lot, and select > option > commit is three interactions for a decision the
    // operator has already made. Same segmented shape as the per-variant control
    // on Sample Requests / Lab Dips, but the buttons are *data* here — the
    // `Quarantine Status` attribute is client-extensible, so the bar is built
    // from whatever values exist rather than a fixed Approve/Reject pair.
    const statusTone = (s: StatusOption): 'pass' | 'stop' | 'hold' =>
        s.is_pass ? 'pass'
            : /REJECT|SCRAP|FAIL|NG\b/i.test(s.value) ? 'stop'
            : 'hold';

    const statusIcon = (s: StatusOption) => {
        const tone = statusTone(s);
        return tone === 'pass' ? 'bi-check2-circle'
            : tone === 'stop' ? 'bi-x-octagon'
            : 'bi-hourglass-split';
    };

    const CHIP_TONE: Record<'pass' | 'stop' | 'hold', ChipTone> = { pass: 'green', stop: 'red', hold: 'amber' };

    /**
     * Segmented disposition bar — built on the shared `FilterChipBar`/`ToggleChip`
     * primitives (same ones behind the Sample Request and Lab Dip status rows) so
     * all three read as one control family instead of three hand-rolled gradients.
     *
     * `current` is the lot's own status id when the bar sets one lot, and null on
     * the bulk bars (group row / selection) — nothing is "active" there because
     * the targets may disagree. Clicking the *active* button clears the status,
     * which re-holds the lot; that mirrors the In-Prod toggle on Sample Requests
     * and is the only way back to undispositioned now the dropdown's blank option
     * is gone.
     */
    const StatusButtons = ({ current, onPick, disabled, showClear, trailing }: {
        current?: string | null;
        onPick: (id: string | null, label: string) => void;
        disabled?: boolean;
        // Bulk bars have no active button to click twice, so they carry the clear
        // action explicitly — otherwise re-holding a whole MO would be lot by lot.
        showClear?: boolean;
        trailing?: React.ReactNode;
    }) => {
        const off = disabled || !canSetStatus || !statuses.length;
        if (!statuses.length) {
            return <span style={{ fontSize: 10, color: '#999', fontStyle: 'italic' }}>No statuses defined</span>;
        }
        const hasCurrent = !!current || !!showClear;
        const options: FilterChipOption[] = statuses.map(s => ({
            value: s.id,
            tone: CHIP_TONE[statusTone(s)],
            title: current === s.id
                ? `Clear ${s.value} — puts the lot back on hold`
                : `${s.value}${s.is_pass ? ' — releases to packing' : ''}`,
            label: <><i className={`bi ${statusIcon(s)}`} style={{ marginRight: 4 }} />{s.value}</>,
        }));
        return (
            <div style={{ display: 'inline-flex', alignItems: 'center', opacity: off ? 0.75 : 1 }}
                title={!canSetStatus ? 'Needs the Set Quarantine Status permission' : undefined}>
                <FilterChipBar
                    classic={classic}
                    options={options}
                    value={current ?? null}
                    disabled={off}
                    flat
                    onChange={id => {
                        const s = statuses.find(x => x.id === id);
                        if (!s) return;
                        current === id ? onPick(null, 'No status') : onPick(id, s.value);
                    }}
                    trailing={hasCurrent && (
                        <ToggleChip
                            on={false}
                            onClick={() => onPick(null, 'No status')}
                            classic={classic}
                            disabled={off}
                            flat
                            seg="last"
                            title="Clear the disposition — puts the lot back on hold"
                        >
                            <i className="bi bi-arrow-counterclockwise" />
                        </ToggleChip>
                    )}
                />
                {trailing}
            </div>
        );
    };

    const COL_COUNT = 11;
    const LOT_COL_COUNT = 8;   // 7 data columns + the select checkbox

    // ── Decided-day banding ───────────────────────────────────────────────────
    // 'en-CA' + 2-digit gives an ISO-ish "2026-08-09", so the key sorts lexically
    // and is computed in the *display* timezone — grouping by the raw UTC date
    // would file a 6pm-Jakarta decision under the previous day.
    const dayKey = useCallback((iso: string) =>
        tzCustom(iso, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA'), [tzCustom]);
    const dayLabel = useCallback((iso: string) =>
        tzCustom(iso, { day: 'numeric', month: 'short', year: 'numeric' }), [tzCustom]);

    const lotSections = useCallback((g: Group) => {
        const awaiting: Lot[] = [];
        const byDay = new Map<string, Lot[]>();
        for (const l of g.lots) {
            // Band membership is anchored to where the lot was first seen, not to
            // its live decided-day: deciding a lot must not teleport it out of the
            // band the user is working down. The anchor is dropped on the next real
            // reload, when it settles into its true day. Un-lotted rows have no id
            // to anchor with and simply band live.
            const live = l.quarantine_status_at ? dayKey(l.quarantine_status_at) : 'AWAITING';
            let k = live;
            if (l.batch_id) {
                const held = bandRef.current.get(l.batch_id);
                if (held) k = held; else bandRef.current.set(l.batch_id, live);
            }
            if (k === 'AWAITING') { awaiting.push(l); continue; }
            const bucket = byDay.get(k);
            if (bucket) bucket.push(l); else byDay.set(k, [l]);
        }
        const sum = (ls: Lot[]) => ls.reduce((s, l) => s + (l.qty || 0), 0);
        // The label comes off a lot that actually belongs to the day, not off
        // `ls[0]` — an anchored lot decided today would otherwise rename the band
        // it is being held in.
        const dayOf = (k: string, ls: Lot[]) =>
            ls.find(l => l.quarantine_status_at && dayKey(l.quarantine_status_at) === k)?.quarantine_status_at
            ?? ls[0].quarantine_status_at;
        const decided = Array.from(byDay.entries())
            .sort((a, b) => (a[0] < b[0] ? 1 : -1))   // newest day first
            .map(([k, ls]) => ({
                key: k,
                label: `Decided ${dayLabel(dayOf(k, ls) as string)}`,
                awaiting: false,
                lots: ls,
                qty: sum(ls),
            }));
        // Lots decided in this sitting are still banded under "Awaiting decision"
        // (that is the freeze doing its job), so the header says so rather than
        // leaving a green OK chip sitting under a heading that contradicts it.
        const justDecided = awaiting.filter(l => l.quarantine_status_at).length;
        return [
            ...(awaiting.length
                ? [{
                    key: 'AWAITING',
                    label: justDecided
                        ? `Awaiting decision · ${justDecided} just decided`
                        : 'Awaiting decision',
                    awaiting: true,
                    lots: awaiting,
                    qty: sum(awaiting),
                }]
                : []),
            ...decided,
        ];
    }, [dayKey, dayLabel]);

    const bandStyle = (awaiting: boolean): React.CSSProperties => ({
        padding: classic ? '3px 8px' : '4px 10px',
        background: awaiting ? (classic ? '#fff4d6' : '#fff8e6') : (classic ? '#f2f0e8' : '#f8fafc'),
        // One rule, not a top+bottom pair: the band is a divider inside a flat
        // table, not a second header competing with the real one above it.
        borderTop: `1px solid ${classic ? '#c9c2ae' : '#e2e8f0'}`,
        fontFamily: classic ? LV_XP_FONT : LV_MODERN_FONT,
        fontSize: classic ? 10 : 11,
        fontVariant: 'all-small-caps',
        letterSpacing: '0.5px',
        fontWeight: 'bold',
        color: awaiting ? '#9a6a00' : '#444',
    });

    const lotTh = lvSubTh(classic);
    const lotTd = lvSubTd(classic);

    // ── Per-lot detail table (both themes) ────────────────────────────────────
    const renderLots = (g: Group) => {
        // Selection is computed per group off the flat set, so a group only ever
        // reports and applies to its own lots.
        const groupIds = selectableIds(g.lots);
        const chosen = groupIds.filter(id => selectedLots.has(id));
        const allChosen = groupIds.length > 0 && chosen.length === groupIds.length;
        const chosenQty = g.lots.reduce(
            (s, l) => (l.batch_id && selectedLots.has(l.batch_id) ? s + (l.qty || 0) : s), 0);
        // Scoped to this group's own lots, so a write in one MO never freezes
        // the checkboxes of another.
        const pickDisabled = !canSetStatus || busy(groupIds);

        return (
        <ExpandedRowPanel classic={classic} style={{
            padding: classic ? '8px 12px 10px 18px' : '10px 16px',
        }}>
            <div style={lvSubCaption(classic)}>
                Lots on Hold — {g.lot_count} lot{g.lot_count === 1 ? '' : 's'}
                {g.packed_lot_count > 0 && ` · ${g.packed_lot_count} packed (history)`}
            </div>
            <div style={{
                fontFamily: classic ? LV_XP_FONT : LV_MODERN_FONT,
                fontSize: classic ? 10 : 11, color: '#777', marginBottom: 4,
            }}>
                Banded by the day they were decided — status is set per lot; the row above is their rollup
            </div>

            {/* Selection bar — only present once something is ticked, so the
                panel stays quiet during the normal read-only scan. */}
            {chosen.length > 0 && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                    padding: classic ? '4px 8px' : '6px 10px', marginBottom: 4,
                    background: classic ? '#fffbe6' : '#fff8e6',
                    border: `1px solid ${classic ? '#d8c98a' : '#f0d99b'}`,
                    fontFamily: classic ? LV_XP_FONT : LV_MODERN_FONT,
                    fontSize: classic ? 10 : 11, color: '#5c4a00',
                }}>
                    <i className="bi bi-check2-square" />
                    <span>
                        <b>{chosen.length}</b> of {groupIds.length} selectable lot{groupIds.length === 1 ? '' : 's'}
                        {' · '}{fmtQty(chosenQty)} {g.uom || ''}
                    </span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ color: '#5c4a00' }}>Apply to selected:</span>
                        {/* No `current` — the picked lots may hold different statuses,
                            so nothing is shown as active; each button is a write. */}
                        <StatusButtons
                            disabled={busy(chosen)}
                            showClear
                            onPick={(id, label) => setStatus(chosen, id, label)}
                        />
                        <XPActionButton
                            classic={classic}
                            tone="neutral"
                            icon="bi-x"
                            label="Clear"
                            title="Clear the selection"
                            onClick={() => setSelection(groupIds, false)}
                        />
                    </span>
                </div>
            )}

            <table style={lvSubTable(classic)}>
                <thead>
                    <tr>
                        <th style={{ ...lotTh, width: LV_CHECK_COL_W, textAlign: 'center' }}>
                            <SelectAllCheckbox
                                classic={classic}
                                allSelected={allChosen}
                                someSelected={chosen.length > 0}
                                disabled={pickDisabled || !groupIds.length}
                                title={groupIds.length
                                    ? 'Select every lot of this MO that is still open'
                                    : 'No selectable lots — all are packed or un-lotted'}
                                onChange={() => setSelection(groupIds, !allChosen)}
                            />
                        </th>
                        <th style={lotTh}>Lot</th>
                        <th style={{ ...lotTh, width: 100 }}>WO</th>
                        <th style={{ ...lotTh, width: 110, textAlign: 'right' }}>Qty</th>
                        <th style={{ ...lotTh, width: 170 }}>Location</th>
                        <th style={{ ...lotTh, width: 130 }}>Status</th>
                        <th style={{ ...lotTh, width: 190 }}>Decided</th>
                        <th style={{ ...lotTh, width: 300 }}>Set</th>
                    </tr>
                </thead>
                {lotSections(g).map(sec => {
                    const secIds = selectableIds(sec.lots);
                    const secChosen = secIds.filter(id => selectedLots.has(id));
                    const secAllChosen = secIds.length > 0 && secChosen.length === secIds.length;
                    return (
                <tbody key={sec.key}>
                    <tr>
                        <td colSpan={LOT_COL_COUNT} style={bandStyle(sec.awaiting)}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {/* QC works the hold area a day at a time, so the band
                                    is the selection grain the floor actually asks for. */}
                                <SelectAllCheckbox
                                    classic={classic}
                                    allSelected={secAllChosen}
                                    someSelected={secChosen.length > 0}
                                    disabled={pickDisabled || !secIds.length}
                                    title={secIds.length ? `Select the ${secIds.length} open lot${secIds.length === 1 ? '' : 's'} in this band` : 'No selectable lots in this band'}
                                    onChange={() => setSelection(secIds, !secAllChosen)}
                                />
                                <i className={`bi ${sec.awaiting ? 'bi-hourglass-split' : 'bi-calendar2-check'}`} style={{ fontSize: 10 }} />
                                <span>{sec.label}</span>
                                <span style={{ marginLeft: 'auto', fontWeight: 'normal', color: '#666' }}>
                                    {sec.lots.length} lot{sec.lots.length === 1 ? '' : 's'} · {fmtQty(sec.qty)} {g.uom || ''}
                                </span>
                            </div>
                        </td>
                    </tr>
                    {sec.lots.map((l, i) => {
                        // Packed lots stay in the list (they are still this MO's history)
                        // but read as settled rather than actionable — dimmed, not dropped.
                        // A lot an open order has allocated in FULL reads the same way, so
                        // nobody re-dispositions stock another order is about to draw. A
                        // partly claimed lot stays live: the remainder is real free stock,
                        // and greying it out is exactly the bug this replaced.
                        const locked = l.packed || isFullyClaimed(l);
                        const dim: React.CSSProperties = locked ? { opacity: 0.55 } : {};
                        const selectable = !!l.batch_id && !locked;
                        const isChosen = selectable && selectedLots.has(l.batch_id as string);
                        return (
                        <tr
                            key={l.batch_id || `${sec.key}-nolot-${i}`}
                            // Claimed rows deliberately carry no row-level title: the
                            // CLAIMED chip below is a data-no-tip zone with its own
                            // title, and GlobalTooltip skips data-no-tip entirely — a
                            // title here would go unstolen and fire the native OS
                            // tooltip alongside the chip's custom one.
                            title={l.packed ? 'Already packed — this lot’s quarantine status is locked' : undefined}
                            // No zebra. The only fills are the settled/claimed tint and
                            // the checked highlight — both semantic, both via lvSubRow.
                            style={{
                                ...lvSubRow(classic, i, {
                                    // Chosen = selected, so it takes the app-wide selection
                                    // fill; amber here read as a warning instead.
                                    fill: locked ? (classic ? '#f0efe9' : '#f6f7f9')
                                        : isChosen ? rowStateBg('selected', classic)
                                        : undefined,
                                }),
                                ...(locked ? { color: '#8a8a8a' } : {}),
                            }}
                        >
                            <td style={{ ...lotTd, textAlign: 'center' }}>
                                {selectable ? (
                                    <RowCheckbox
                                        classic={classic}
                                        checked={isChosen}
                                        disabled={pickDisabled}
                                        label={l.batch_number || 'lot'}
                                        onChange={() => setSelection([l.batch_id as string], !isChosen)}
                                    />
                                ) : (
                                    <span style={{ color: '#ccc' }}>—</span>
                                )}
                            </td>
                            <td style={{ ...lotTd, ...dim }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {l.batch_number
                                        ? <CodeChip code={l.batch_number} classic={classic} />
                                        : <span style={{ color: '#999', fontStyle: 'italic' }}>No lot</span>}
                                    {l.quality_status === 'REJECTED' && (
                                        <StatusChip status="REJECTED" tint />
                                    )}
                                    {l.packed && (
                                        <StatusChip status="PACKED" label="Packed" tint />
                                    )}
                                    {!l.packed && l.claimed_by_order_code && (
                                        <StatusChip
                                            status="CLAIMED"
                                            // Partial claims say so on the chip: "PCK-00003 · 2 of 8"
                                            // is the difference between a locked lot and one with
                                            // 6 kg still free, and the row looks identical otherwise.
                                            label={isFullyClaimed(l)
                                                ? l.claimed_by_order_code
                                                : `${l.claimed_by_order_code} · ${fmtQty(l.claimed_qty)} of ${fmtQty(l.qty)}`}
                                            tint
                                            title={isFullyClaimed(l)
                                                ? `Fully allocated to packing order ${l.claimed_by_order_code} — close, cancel or raise that order to free this lot`
                                                : `${fmtQty(l.claimed_qty)} ${g.uom || ''} allocated to packing order ${l.claimed_by_order_code}; ${fmtQty(lotFreeQty(l))} ${g.uom || ''} still free to pack`} />
                                    )}
                                    <div style={{ marginLeft: 'auto' }}><LotChips batch={l} /></div>
                                </div>
                            </td>
                            <td style={{ ...lotTd, ...dim }}>
                                {l.wo_code
                                    ? <CodeChip code={l.wo_code} classic={classic} />
                                    : <span style={{ color: '#ccc' }}>—</span>}
                            </td>
                            <td style={{ ...lotTd, textAlign: 'right', whiteSpace: 'nowrap', ...dim }}>
                                {/* A fully packed lot has nothing left on hand, so the
                                    only honest number is what packing took. */}
                                {l.packed && !l.qty ? (
                                    <span title={l.last_packed_at
                                        ? `Packed ${dayLabel(l.last_packed_at)} ${tzTime(l.last_packed_at)}`
                                        : undefined}>
                                        {fmtQty(l.qty_packed || 0)}{' '}
                                        <span style={{ color: '#999', fontSize: 10 }}>{g.uom} packed</span>
                                    </span>
                                ) : (
                                    <>
                                        {fmtQty(l.qty)} <span style={{ color: '#999', fontSize: 10 }}>{g.uom}</span>
                                    </>
                                )}
                            </td>
                            <td style={{ ...lotTd, ...dim }}>{l.location_name || '—'}</td>
                            <td style={{ ...lotTd, ...dim }}>
                                {l.quarantine_status
                                    ? <StatusChip status={l.quarantine_status.replace(/\s+/g, '_')} label={l.quarantine_status} />
                                    : <StatusChip status="NONE" label="No status" tint />}
                            </td>
                            <td style={{ ...lotTd, color: '#666', ...dim }}>
                                {/* The band carries the day; the row only needs who and when. */}
                                {l.quarantine_status_at
                                    ? `${l.quarantine_status_by || '—'} · ${tzTime(l.quarantine_status_at)}`
                                    : '—'}
                            </td>
                            <td style={lotTd}>
                                {l.packed ? (
                                    <span style={{ fontSize: 10, color: '#2d7a2d', fontStyle: 'italic' }}
                                        title="This lot has already been packed into cartons — its quarantine status is locked and can no longer be changed.">
                                        <i className="bi bi-lock-fill" style={{ marginRight: 4 }} />Locked — packed
                                    </span>
                                ) : l.batch_id ? (
                                    <StatusButtons
                                        current={l.quarantine_status_id}
                                        disabled={busy([l.batch_id])}
                                        onPick={(id, label) => setStatus([l.batch_id as string], id, label)}
                                    />
                                ) : (
                                    <span style={{ fontSize: 10, color: '#999', fontStyle: 'italic' }}
                                        title="Un-lotted stock carries no lot record to disposition. Lot-track the item to gate it.">
                                        Not lot-tracked
                                    </span>
                                )}
                            </td>
                        </tr>
                        );
                    })}
                </tbody>
                    );
                })}
            </table>
        </ExpandedRowPanel>
        );
    };

    // ── Toolbar ───────────────────────────────────────────────────────────────
    const toolbar = (
        <div style={classic
            ? sharedXpToolbar({ flexShrink: 0 })
            : {
                background: '#fff', borderBottom: '1px solid #dbe1ea', padding: '8px 10px',
                display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0,
            }}>
            <SearchField classic={classic} value={searchInput} onChange={setSearchInput} placeholder="MO, lot, item or SO..." width={230} />
            <div style={lvSep(classic)} />
            <span style={{ ...lvLabel(classic), display: 'inline', marginBottom: 0 }}>Status</span>
            <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                style={lvInput(classic, { width: 160 })}
                className={classic ? '' : 'form-select form-select-sm'}
            >
                <option value="">All</option>
                {DERIVED_FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                {statuses.map(s => (
                    <option key={s.id} value={s.value.toUpperCase()}>{s.value}</option>
                ))}
            </select>
            <div style={lvSep(classic)} />
            {/* Packed lots have left the hold area, so they are not part of the
                queue — but they are still this MO's history, and hiding them made
                a lot look deleted the moment it was packed. */}
            <ToggleChip
                classic={classic}
                on={showPacked}
                onClick={() => setShowPacked(v => !v)}
                title={showPacked
                    ? 'Hide lots already packed out of quarantine'
                    : 'Also list lots already packed out of quarantine — read-only, no longer on hand'}
            >
                <i className="bi bi-box-seam" style={{ marginRight: 4 }} />Show packed
            </ToggleChip>
            <div style={lvSep(classic)} />
            <button className={XP_BTN} style={lvBtn(classic)} onClick={() => refetch()} title="Refresh">
                <i className="bi bi-arrow-clockwise" style={{ marginRight: 4 }} />Refresh
            </button>
            {!canSetStatus && (
                <span style={{ fontFamily: classic ? LV_XP_FONT : LV_MODERN_FONT, fontSize: classic ? 10 : 11, color: '#9a6a00' }}>
                    <i className="bi bi-lock" style={{ marginRight: 4 }} />Read-only — no Set Quarantine Status permission
                </span>
            )}
            <ToolbarCount classic={classic} right>
                {total.toLocaleString()} MO group{total === 1 ? '' : 's'}
            </ToolbarCount>
        </div>
    );

    // ── Main table ────────────────────────────────────────────────────────────
    const body = (
        <div style={{ flex: 1, minHeight: 0, width: '100%', background: '#fff', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                <thead style={lvThead(classic, true)}>
                    <tr>
                        <th style={{ ...lvTh(classic), width: LV_EXPANDER_COL_W }} />
                        <th style={lvTh(classic)}>Item</th>
                        <th style={lvTh(classic)}>Manufacturing Order</th>
                        <th style={{ ...lvTh(classic), width: 130 }}>Sales Order</th>
                        <th style={{ ...lvTh(classic), width: 150 }}>Colour</th>
                        <th style={{ ...lvTh(classic), width: 130 }}>Variant</th>
                        <th style={{ ...lvTh(classic), width: 70, textAlign: 'right' }}>Lots</th>
                        <th style={{ ...lvTh(classic), width: 120, textAlign: 'right' }}>Qty Held</th>
                        <th style={{ ...lvTh(classic), width: 120, textAlign: 'right' }}>Released</th>
                        <th style={{ ...lvTh(classic), width: 140 }}>Status</th>
                        <th style={{ ...lvTh(classic), width: 110, borderRight: 'none' }}>Pack</th>
                    </tr>
                </thead>
                <tbody ref={listBodyRef}>
                    {stableGroups.map((g, i) => {
                        const open = expanded.has(g.key);
                        const allReleased = g.lot_count > 0 && g.qty_released >= g.qty_total - 1e-6;
                        // What "Pack" would actually offer — released, unpacked, less
                        // whatever open orders have already allocated to themselves.
                        const qtyFree = g.lots
                            .filter(l => l.released && !l.packed)
                            .reduce((s, l) => s + lotFreeQty(l), 0);
                        return (
                            <Fragment key={g.key}>
                                <tr
                                    onClick={() => toggleRow(g.key, g.lots)}
                                    title="Click to see the lots"
                                    style={{
                                        ...lvRow(classic, i),
                                        cursor: 'pointer',
                                        // Only override when open — `background: undefined` still wins over
                                        // the spread above (last key in the literal), which is what was
                                        // silently wiping the zebra stripe off every closed row.
                                        ...(open ? { background: rowStateBg('expanded', classic) } : {}),
                                    }}
                                >
                                    <ExpanderCell classic={classic} expanded={open} onToggle={() => toggleRow(g.key, g.lots)} label="lots" />
                                    <td style={lvTd(classic)}>
                                        <span style={{ fontWeight: 'bold' }}>{g.item_name}</span>
                                        <div style={{ fontSize: 10, color: '#666', fontVariant: 'all-small-caps' }}>{g.item_code}</div>
                                    </td>
                                    <td style={lvTd(classic)}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            {g.mo_code
                                                ? <CodeChip code={g.mo_code} classic={classic} tone="accent" />
                                                : <span style={{ color: '#999', fontStyle: 'italic' }}>No MO</span>}
                                            {g.mo_status && <StatusChip status={g.mo_status} style={{ marginLeft: 'auto' }} tint />}
                                        </div>
                                        {g.production_run_code ? (
                                            <OriginChipRow style={{ marginTop: 2 }}>
                                                <OriginChip kind="pr" code={g.production_run_code} classic={classic} />
                                            </OriginChipRow>
                                        ) : <div style={{ fontSize: 10 }}>&nbsp;</div>}
                                    </td>
                                    <td style={lvTd(classic)}>
                                        {g.sales_order_code
                                            ? <OriginChip kind="so" code={g.sales_order_code} classic={classic} />
                                            : <span style={{ color: '#ccc' }}>—</span>}
                                    </td>
                                    <td style={lvTd(classic)}>
                                        {g.color_name
                                            ? <ColorSwatchChip classic={classic} label={colorLabel(g.color_code, g.color_name)} title={`Color: ${colorTitle(g.color_code, g.color_name)}`} hex={resolveColorHex(g.color_hex, g.lots?.[0]?.variant_attributes)} />
                                            : g.labdip_variant_code
                                                ? <span style={{ fontSize: 10, color: '#9a6a00' }} title="Shade still awaiting lab-dip approval">{g.labdip_variant_code}</span>
                                                : <span style={{ color: '#999', fontStyle: 'italic', fontSize: 10 }}>Greige</span>}
                                    </td>
                                    <td style={lvTd(classic)}>
                                        {(() => {
                                            // Size/combo are carried on the lot record, not the group —
                                            // but every lot in a group shares the same bom_size_id /
                                            // combo_value_id, so the first lot's snapshot speaks for all.
                                            // Colour has its own column already, so it's left out here.
                                            const sample = g.lots[0];
                                            const size = sample ? lotSizeLabel(sample) : null;
                                            const combo = sample ? lotComboLabel(sample) : null;
                                            if (!size && !combo) return <span style={{ color: '#ccc' }}>—</span>;
                                            return (
                                                <LotChipRow>
                                                    {size && (
                                                        <LotChip tone="size" title={`Size: ${size}`}>
                                                            {size}
                                                        </LotChip>
                                                    )}
                                                    {combo && (
                                                        <LotChip tone="combo" title={`Combo: ${combo}`}>
                                                            {combo}
                                                        </LotChip>
                                                    )}
                                                </LotChipRow>
                                            );
                                        })()}
                                    </td>
                                    <td style={{ ...lvTd(classic), textAlign: 'right' }}>
                                        {g.lot_count}
                                        {g.packed_lot_count > 0 && (
                                            <div style={{ fontSize: 10, color: '#888' }}
                                                title={`${g.packed_lot_count} lot${g.packed_lot_count === 1 ? '' : 's'} already packed out of quarantine`}>
                                                +{g.packed_lot_count} packed
                                            </div>
                                        )}
                                    </td>
                                    <td style={{ ...lvTd(classic), textAlign: 'right', whiteSpace: 'nowrap' }}>
                                        {fmtQty(g.qty_total)} <span style={{ color: '#999', fontSize: 10 }}>{g.uom}</span>
                                    </td>
                                    <td style={{
                                        ...lvTd(classic), textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 'bold',
                                        color: allReleased ? '#2d7a2d' : g.qty_released > 0 ? '#9a6a00' : '#999',
                                    }}>
                                        {fmtQty(g.qty_released)}
                                    </td>
                                    <td style={lvTd(classic)}>
                                        <StatusChip
                                            status={g.rollup_status}
                                            label={g.rollup_status === 'NONE' ? 'No status' : g.rollup_status.replace(/_/g, ' ')}
                                            title={Object.entries(g.status_counts)
                                                .map(([k, n]) => `${n} × ${k === 'NONE' ? 'no status' : k}`).join(', ')}
                                        />
                                    </td>
                                    <td style={{ ...lvTd(classic), borderRight: 'none' }} onClick={e => e.stopPropagation()}>
                                        <XPActionButton
                                            classic={classic}
                                            tone="success"
                                            icon="bi-box2"
                                            label="Pack"
                                            title={
                                                !canPack ? 'Needs the Manage Sales Orders permission'
                                                    : qtyFree <= 0 ? (g.qty_released > 0
                                                        ? `All ${fmtQty(g.qty_released)} ${g.uom || ''} released here is already allocated to open packing orders — close, cancel or raise one to free it`
                                                        : 'No released stock on this MO yet')
                                                        : 'Open New Packing Order, pre-filled'
                                            }
                                            disabled={!canPack || qtyFree <= 0}
                                            onClick={() => packGroup(g)}
                                        />
                                    </td>
                                </tr>
                                {open && (
                                    <tr>
                                        <td colSpan={COL_COUNT} style={{ padding: 0 }}>
                                            {renderLots(g)}
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        );
                    })}
                    {showSkeleton && <TableSkeleton rows={7} cols={skel.cols ?? COL_COUNT} classic={classic} tdStyle={lvTd(classic)} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />}
                    {!loading && stableGroups.length === 0 && (
                        <tr>
                            <td colSpan={COL_COUNT} style={{ padding: 0 }}>
                                <XPEmptyState
                                    icon="bi-shield-check"
                                    message={search || statusFilter
                                        ? 'No held stock matches this filter.'
                                        : showPacked
                                            ? 'Nothing is on hold, and nothing has been packed out of a quarantine location yet.'
                                            : 'Nothing is on hold — no stock is sitting in a quarantine location. Turn on "Show packed" to see lots already packed out.'}
                                />
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );

    const heldTotal = useMemo(() => stableGroups.reduce((s, g) => s + g.qty_total, 0), [stableGroups]);
    // PACKED groups have nothing left on the desk, so they are not awaiting anything.
    const awaiting = useMemo(
        () => stableGroups.filter(g => g.rollup_status !== 'OK' && g.rollup_status !== 'PACKED').length,
        [stableGroups]);

    return (
        <ShellWindow classic={classic} fill="page" className="fade-in">
            <ShellTitleBar
                classic={classic}
                icon="bi-shield-exclamation"
                title="Quarantine Packing"
                subtitle="Stock held in quarantine, grouped by MO. Only lots set to OK can be packed."
            />
            {toolbar}
            {error && (
                <div style={{
                    fontFamily: classic ? LV_XP_FONT : LV_MODERN_FONT, fontSize: 11,
                    color: '#c00000', padding: '6px 12px', background: '#fdeeee',
                }}>{error}</div>
            )}
            {truncated && (
                <div style={{
                    fontFamily: classic ? LV_XP_FONT : LV_MODERN_FONT, fontSize: 11,
                    color: '#9a6a00', padding: '6px 12px', background: '#fff8e6',
                }}>
                    <i className="bi bi-exclamation-triangle" style={{ marginRight: 5 }} />
                    Too much stock on hold to list in full — only the largest holdings are shown. Clear the backlog or narrow the search.
                </div>
            )}
            {body}
            <XPStatusBar right={`Held ${fmtQty(heldTotal)} across ${stableGroups.length} group${stableGroups.length === 1 ? '' : 's'} on this page`}>
                <StatusCountPill status="NONE" count={awaiting} label="awaiting decision" classic={classic} />
            </XPStatusBar>
            <Pager page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />
        </ShellWindow>
    );
}
