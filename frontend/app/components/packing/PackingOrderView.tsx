'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useData } from '../../context/DataContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import { useTheme } from '../../context/ThemeContext';
import { useUser } from '../../context/UserContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useToast } from '../shared/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { XPStatusBar, XPEmptyState, TableSkeleton, useTableSkeletonMetrics, StatusChip, useFloatingMenu, MenuTriggerButton, FloatingMenu, FormSection, SectionTitle, FieldLabel, XPActionButton, LegendPanel, ExpandedRowPanel, ProgressBar, CodeChip, Chip, CODE_FONT, rowStateBg, CHIP_RADIUS, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { LV_XP_FONT, lvBtn, lvInput, lvTd, lvRow, lvSubTh, lvSubTd, lvSubRow, ExpanderCell, RowCheckbox, lvThSticky, lvPickerRow, lvSubTable } from '../shared/listViewTheme';
import { ShellWindow, ShellTitleBar, xpToolbar, ToolbarButton } from '../shared/shellTheme';
import Pager from '../shared/Pager';
import ModalWrapper from '../shared/ModalWrapper';
import SearchableSelect from '../shared/SearchableSelect';
import TreeSelect, { buildLocationPickerTree } from '../shared/TreeSelect';
import { useFinishedGoodsSearch } from '../shared/useEntitySearch';
import { LotChips, LotChip, lotSizeKey, lotSizeLabel } from '../shared/LotChips';
import VariantChips from '../shared/VariantChips';
import { machinesOfCenterType, toMachineOptions } from '../shared/workCenterTree';
import {
    BoxGroup, emptyBoxGroup, seedBoxGroups, expandBoxGroups, groupCount, groupTotal,
    filledBoxRows, hasUnweighedBox, uomIsKg, boxAltTotal, boxAltPayload, orderBoxSizeAlt,
    hasUnboxedBox, hasUnweighedTare, boxPackagingPayload, boxTarePayload,
    findPackagingType, isCustomType, effectiveTare,
} from '../shared/packingBoxes';
import { usePackagingTypes } from '../shared/usePackagingTypes';
import { basePerAlt, altToBase, baseToAlt, orderBasePerAlt, formatAlt, lengthPerAlt } from '../shared/altUnit';
const PackingCardPrintModal = dynamic(() => import('./PackingCardPrintModal'), { ssr: false });
const PackedUnitLabelPrintModal = dynamic(() => import('./PackedUnitLabelPrintModal'), { ssr: false });

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace(/\/api$/, '') + '/api';

// ── Classic XP theme primitives (match PickListView / StockOnHandView) ──────
const xpFont = LV_XP_FONT;
const xpInput: React.CSSProperties = lvInput(true);
const xpSelect: React.CSSProperties = { ...xpInput, height: 22 };
const xpTableHeader: React.CSSProperties = lvThSticky(true);
const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => lvBtn(true, 'default', extra);
const xpBtnGreen = (extra: React.CSSProperties = {}) => lvBtn(true, 'success', extra);
// Title-bar "create" button — same style as SalesOrderView / PartnersView / SampleRequestView.
const rowStyle = (idx: number): React.CSSProperties => lvRow(true, idx);
const td: React.CSSProperties = lvTd(true);
// This view is classic-only chrome (ShellWindow classic), so the shared form
// primitives are always driven in their classic branch.
const CLASSIC = true;
// Form rows use fixed grid columns rather than flex-wrap so fields land in the
// same column on every row instead of reflowing to a ragged edge.
const fieldGrid: React.CSSProperties = { display: 'grid', gap: '8px 14px', alignItems: 'start' };
const hintText: React.CSSProperties = { fontFamily: xpFont, fontSize: 10, color: '#938c76', fontStyle: 'italic', marginTop: 6 };
// Operator-log-modal field label + UOM pill — copied from WOCompletionModal so the
// pack modal and the WO completion modal read as the same screen.
const xpFormLabel: React.CSSProperties = { fontFamily: xpFont, fontSize: 11, display: 'block', marginBottom: 2 };
const uomChip: React.CSSProperties = {
    fontSize: 9, fontWeight: 'bold', letterSpacing: 0.3, textTransform: 'uppercase',
    color: '#31569e', background: '#e8f0fe', border: '1px solid #a8c0f0',
    borderRadius: CHIP_RADIUS, padding: '0 5px', lineHeight: '14px',
};

// Inline label button in the expanded row — same chrome as the WO list's
// per-completion "Label" button, so the two logs read as one pattern.
const miniBtn: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 8, padding: '0 5px', cursor: 'pointer',
    background: 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid #808080',
    color: '#000040', textTransform: 'none', letterSpacing: 0,
};

const num = (v: any) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const PO_PAGE_SIZE = 20;
// Width of the carton-count column on the pack form — the input and the header
// above it, which drift apart the moment either is typed as a literal. Sized for
// four digits with the native spinner suppressed (`.xp-nospin`): a whole pack run
// is hundreds of cartons, and the old 46px clipped a three-digit count.
const CARTON_COUNT_W = 56;
// Packaging column on the pack form: the box picker and the tare slot beside it.
// Same reason as CARTON_COUNT_W — the header labels and the controls under them
// share these, so they cannot drift apart. The tare slot is reserved on every
// row (an input for a custom box, the master's figure for any other) so a mixed
// list stays aligned instead of jumping a column wide on one line.
const PACKAGING_W = 104;
const TARE_W = 46;

// Pack progress, measured in whatever the order is COUNTED in. Read by both the
// list row's bar and the pack modal's header panel, so the two can never quote
// different percentages — keep any change to the basis here, in the one place.
//
// On an alt-unit order the basis is pieces: an order for 2880 Pcs is done when
// 2880 pieces are in boxes, whatever they weighed. Measuring it in kg against a
// target derived from g/y meant a run of elastic cloth that came in light could
// box every ordered piece and still show 97%. Falls back to the base pair when
// there is no alt unit. Both alt figures are COUNTED, never kilos divided back
// out by the factor (see api/packing._packed_alt_qty).
function packProgress(po: any, it?: any) {
    const target = num(po.qty_target);
    const packed = num(po.qty_packed);
    const altUom = po.uom2 || '';
    const altFactor = orderBasePerAlt(po, it);
    const hasAlt = !!(altUom && altFactor);
    const tAlt = hasAlt
        ? (num(po.qty2) > 0 ? num(po.qty2) : baseToAlt(target, altFactor))
        : null;
    const pAlt = hasAlt && po.qty_packed_alt != null ? num(po.qty_packed_alt) : null;
    const basis = tAlt !== null && pAlt !== null ? { done: pAlt, goal: tAlt } : { done: packed, goal: target };
    const pctOf = (done: number, goal: number) =>
        goal > 0 ? Math.min(100, Math.round((done / goal) * 100)) : 0;
    return {
        target,
        packed,
        remaining: Math.max(0, target - packed),
        hasAlt,
        altUom,
        altFactor,
        targetAlt: tAlt,
        packedAlt: pAlt,
        remainingAlt: tAlt !== null && pAlt !== null
            ? Math.max(0, Math.round((tAlt - pAlt) * 100) / 100)
            : null,
        pct: pctOf(basis.done, basis.goal),
        // The two bars the pack screen and the list row draw side by side. They
        // are the SAME run measured twice — the boxes are weighed, and the piece
        // count is that weight read through the order's own sampled unit weight
        // (`order_base_per_alt` -> `sample_weight_per_unit`, entered on the New
        // Packing Order modal). Showing only one hid the gap the two open up: a
        // light run is 100% of its pieces at 96% of its kilos, and the packer
        // needs to see both figures rather than infer one from the other.
        // `pctAlt` is null when the order has no alt unit — then `pctBase` is
        // the only bar and `pct` equals it.
        pctAlt: tAlt !== null && pAlt !== null ? pctOf(pAlt, tAlt) : null,
        pctBase: pctOf(packed, target),
    };
}

/** Both bars for one packing order — pieces and kilos, one under the other.
 *
 *  Drawn by the list row and the pack modal from the same `packProgress`, so the
 *  two screens can never quote a different pair. The alt row leads because that
 *  is what the order is FOR and what `is_target_met` judges; the base row is the
 *  weight actually on the scale, which is what the packer types and what stock
 *  moves in. One is not derived from the other on screen — both come off the
 *  order (`qty_packed_alt` is summed from the cartons, `qty_packed` from the
 *  completions) and they meet only through the sampled unit weight the New
 *  Packing Order modal captured. An order with no alt unit draws the base row
 *  alone, which is exactly what the single bar used to be.
 */
function PackProgressBars({ prog, uom, height = 6, fontSize = 9, hatched = false, only }: {
    prog: ReturnType<typeof packProgress>;
    uom: string;
    height?: number;
    fontSize?: number;
    hatched?: boolean;
    /** Draw one of the pair instead of both — the list table gives each its own
     *  column, so the two bars sit side by side there rather than stacked. An
     *  `only="alt"` order with no alt unit draws nothing and the cell reads as
     *  empty, which is honest: there is no piece count to be at 40% of. */
    only?: 'alt' | 'base';
}) {
    const rows: { key: string; pct: number; done: string; goal: string; unit: string }[] = [];
    if (prog.pctAlt !== null) {
        rows.push({
            key: 'alt',
            pct: prog.pctAlt,
            done: (prog.packedAlt ?? 0).toLocaleString(),
            goal: (prog.targetAlt ?? 0).toLocaleString(),
            unit: prog.altUom,
        });
    }
    rows.push({
        key: 'base',
        pct: prog.pctBase,
        done: prog.packed.toFixed(2),
        goal: prog.target.toFixed(2),
        unit: uom,
    });
    const shown = only ? rows.filter(r => r.key === only) : rows;
    if (!shown.length) return <span style={{ color: '#bbb' }}>—</span>;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, width: '100%' }}>
            {shown.map(r => (
                /* Figures sit ON THEIR OWN LINE above the bar, not beside it: in a
                   130px column a trailing "100% · 2,880 / 2,880 Pcs" left the track
                   a ~30px stub that read as noise rather than as progress. Stacked,
                   the bar spans the whole cell and the numbers still line up. */
                <div key={r.key} style={{ minWidth: 0 }}>
                    <div style={{
                        fontFamily: xpFont, fontSize, whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        lineHeight: 1.3, marginBottom: 1,
                        color: r.pct >= 100 ? (CLASSIC ? '#1a5e1a' : '#166534') : '#777',
                    }}>
                        {r.pct}% · {r.done} / {r.goal} {r.unit}
                    </div>
                    <ProgressBar
                        pct={r.pct}
                        tone={r.pct >= 100 ? 'green' : r.pct > 0 ? 'blue' : 'gray'}
                        hatched={hatched}
                        height={height}
                    />
                </div>
            ))}
        </div>
    );
}

export default function PackingOrderView({ initialCreateState, onClearInitialState }: any = {}) {
    const { locations, attributes, companyProfile, itemIndex, workCenters, authFetch } = useData();
    const { uiStyle } = useTheme();
    const { formatDate: tzDate, formatDateTime: tzDateTime } = useTimezone();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const { hasPermission } = useUser();
    const canManage = hasPermission('sales.manage');
    const router = useRouter();

    // Page window, fetch, `loading` (true from first paint, so the list shows the
    // loader rather than "none yet") and the stale-response race guard all come from
    // the shared hook (context/usePaginatedList.ts). This list carries no search box
    // or filters; the footer's open/closed tallies are counted separately below.
    const {
        rows: orders, total, loading, page, setPage, refetch: reloadOrders,
    } = usePaginatedFetch<any>({
        endpoint: `${API_BASE}/packing`,
        authFetch,
        pageSize: PO_PAGE_SIZE,
    });
    const [openCount, setOpenCount] = useState(0);
    const [doneCount, setDoneCount] = useState(0);
    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('packing-orders', listBodyRef, orders.length > 0);
    const [creating, setCreating] = useState(false);
    const [createInitialValues, setCreateInitialValues] = useState<any>(null);
    const [detail, setDetail] = useState<any | null>(null);
    // One row open at a time, same as the WO list — the panel is tall and two open
    // at once turns the list into a scroll hunt.
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [printCard, setPrintCard] = useState<any | null>(null);
    const [printLabels, setPrintLabels] = useState<{ order: any; units: any[] } | null>(null);
    const { openId: menuOpenId, pos: menuPos, toggle: menuToggle, close: menuClose } = useFloatingMenu(180);

    const itemById = useMemo(() => {
        const m: Record<string, any> = {};
        Object.entries(itemIndex || {}).forEach(([id, v]: [string, any]) => { m[id] = { id, ...v }; });
        return m;
    }, [itemIndex]);

    const locPickerTreeOptions = useMemo(() => buildLocationPickerTree(locations || []), [locations]);
    // Seeded stores resolved by system_code, not by name — a plant may rename the
    // display name but the code is the stable handle (see SYSTEM_WAREHOUSES).
    const systemLocId = useCallback((code: string) => {
        const l = (locations || []).find((x: any) => x.system_code === code);
        return l ? String(l.id) : '';
    }, [locations]);
    const locationById = useMemo(() => {
        const m: Record<string, any> = {};
        (locations || []).forEach((l: any) => { m[String(l.id)] = l; });
        return m;
    }, [locations]);

    // Machine picker scope. Packing machines are the MACHINE rows running under a
    // PACKING centre type; a plant that has not declared that type yet gets every
    // machine rather than an empty list — the same "never hand back an empty
    // picker" rule WOCompletionModal applies to its process scope.
    const machineOptions = useMemo(
        () => toMachineOptions(machinesOfCenterType(workCenters || [], 'PACKING')),
        [workCenters],
    );
    // DELIVERED counts as OPEN, not done: the order met its target but was never
    // closed, so it still accepts completions. Same split as MOs (DLV vs TECO).
    const loadCounts = useCallback(async () => {
        const [pendRes, progRes, delivRes, doneRes] = await Promise.all([
            authFetch(`${API_BASE}/packing?status=PENDING&page=1&size=1`),
            authFetch(`${API_BASE}/packing?status=IN_PROGRESS&page=1&size=1`),
            authFetch(`${API_BASE}/packing?status=DELIVERED&page=1&size=1`),
            authFetch(`${API_BASE}/packing?status=COMPLETED&page=1&size=1`),
        ]);
        let open = 0;
        for (const r of [pendRes, progRes, delivRes]) { if (r.ok) { const d = await r.json(); open += d.total || 0; } }
        setOpenCount(open);
        if (doneRes.ok) { const d = await doneRes.json(); setDoneCount(d.total || 0); }
    }, [authFetch]);

    const loadAll = useCallback(async () => {
        reloadOrders();
        await loadCounts();
    }, [reloadOrders, loadCounts]);

    useEffect(() => { loadCounts(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Deep-linked pre-fill from a Quarantine Packing "ready to pack" suggestion —
    // item/location/SO line are proposed, not committed; the form still opens for
    // the user to confirm or change before Create.
    useEffect(() => {
        if (initialCreateState) {
            setCreateInitialValues(initialCreateState);
            setCreating(true);
            onClearInitialState?.();
        }
    }, [initialCreateState, onClearInitialState]);

    const deleteOrder = async (po: any) => {
        const ok = await confirm({ title: 'Delete Packing Order', message: `Delete ${po.code}?`, confirmText: 'Delete', variant: 'danger' });
        if (!ok) return;
        const res = await authFetch(`${API_BASE}/packing/${po.id}`, { method: 'DELETE' });
        if (res.ok) { showToast('Packing order deleted', 'success'); loadAll(); }
        else { const e = await res.json().catch(() => ({})); showToast(`Error: ${e.detail || 'failed'}`, 'danger'); }
    };

    const closeOrder = async (po: any) => {
        const ok = await confirm({
            title: 'Close Packing Order',
            message: `Close ${po.code}? No further cartons can be packed against it.`,
            confirmText: 'Close',
        });
        if (!ok) return;
        const res = await authFetch(`${API_BASE}/packing/${po.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'COMPLETED' }),
        });
        if (res.ok) { showToast('Packing order closed', 'success'); loadAll(); }
        else { const e = await res.json().catch(() => ({})); showToast(`Error: ${e.detail || 'failed'}`, 'danger'); }
    };

    const pages = Math.max(1, Math.ceil(total / PO_PAGE_SIZE));
    const clampedPage = Math.min(page, pages);

    const PO_COLS = 11; // chevron + 9 data cols + actions

    // Variant identity of one order, in the shape VariantChips wants. The order
    // serves `attribute_value_ids` (not labels), so combo and the colour VARIANT
    // are resolved against the attributes master by `system_role` — never by
    // attribute name, per the system-attribute rule. The Color Library shade
    // (color_code/hex) is already decorated server-side.
    // Size is the SO line's plan when there is one; an order with no line is
    // size-agnostic by design, so the cartons' own stamps stand in — collapsed to
    // one chip because a run may legitimately hold several.
    const attrValById = useMemo(() => {
        const m: Record<string, { role: string | null; value: string; hex: string | null }> = {};
        for (const a of (attributes || [])) {
            for (const v of (a.values || [])) {
                m[String(v.id)] = { role: a.system_role || null, value: v.value, hex: v.hex || null };
            }
        }
        return m;
    }, [attributes]);

    const variantOf = (po: any) => {
        let combo: string | null = null;
        let colorVariant: string | null = null;
        let colorVariantHex: string | null = null;
        for (const vid of (po.attribute_value_ids || [])) {
            const v = attrValById[String(vid)];
            if (!v) continue;
            if (v.role === 'combo' && !combo) combo = v.value;
            else if (v.role === 'color' && !colorVariant) { colorVariant = v.value; colorVariantHex = v.hex; }
        }
        let size: string | null = po.size_label || null;
        if (!size) {
            const stamped = Array.from(new Set(
                (po.packed_units || []).map((u: any) => u.size_label).filter(Boolean)
            )) as string[];
            if (stamped.length) size = stamped.join(' / ');
        }
        return { combo, colorVariant, colorVariantHex, size };
    };

    // Expanded row — same three-pane shape as the WO list detail panel (info,
    // outputs, log), so a supervisor reads a packing order the way they read a WO.
    // Everything here is already on the list payload (`_load_options` eager-loads
    // completions, `_packed_units_for` decorates cartons) — no extra fetch.
    const renderPackDetail = (po: any) => {
        const it = itemById[String(po.item_id)];
        const uom = po.item_uom || it?.uom || '';
        // Newest first, matching the pack modal's Previous Entries.
        const comps = po.completions ? [...po.completions].reverse() : [];
        const units = po.packed_units || [];
        const srcName = locationById?.[String(po.source_location_id)]?.name || null;
        const outName = locationById?.[String(po.output_location_id)]?.name || null;

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
        // Dense: this table shares its row with the other panes of the detail grid.
        const th = lvSubTh(true, true);
        const td = lvSubTd(true, true);
        // Cartons of one pack event — the label set for that log line, matching the
        // WO list's per-completion "Label" button.
        const unitsOfComp = (compId: string) =>
            units.filter((u: any) => String(u.packing_completion_id || '') === String(compId));

        return (
            <tr key={`${po.id}-detail`}>
                <td colSpan={PO_COLS} style={{ padding: 0 }}>
                    <ExpandedRowPanel classic={CLASSIC}>
                        <div style={{
                            display: 'grid', gridTemplateColumns: '320px 300px minmax(260px, 1fr)',
                            border: '1px solid #7f9db9', fontFamily: xpFont, fontSize: 10,
                        }}>
                            {/* Info */}
                            <div style={{ borderRight: '1px solid #c0bdb5', padding: '6px 8px', background: '#f5f4ef' }}>
                                <div style={colHeader}>Info</div>
                                {infoRow('Item', po.item_code || it?.code || '—')}
                                {infoRow('Sales Order', po.sales_order_code || 'to stock')}
                                {po.color_name && infoRow('Colour', po.color_name)}
                                {/* Counted unit first, same as Target below: the box holds a
                                    stated number of pieces and the kilos are its estimate. */}
                                {infoRow(`${po.package_label} size`, (() => {
                                    const altSize = orderBoxSizeAlt(po, orderBasePerAlt(po, it));
                                    if (po.uom2 && altSize) {
                                        return `${formatAlt(altSize, po.uom2)}`
                                            + (num(po.pack_size) > 0 ? ` (${num(po.pack_size)} ${uom} est.)` : '');
                                    }
                                    return num(po.pack_size) > 0 ? `${num(po.pack_size)} ${uom}` : 'per event';
                                })())}
                                {infoRow('Machine', po.work_center_name || 'not assigned')}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 3, margin: '2px 0' }}>
                                    <span style={{ color: '#888', fontSize: 9, minWidth: 60 }}>Route</span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9 }}>
                                        <span style={{ background: '#e8f0fe', color: '#1a56c4', border: '1px solid #b0c8f8', padding: '0 4px' }}>{srcName || '?'}</span>
                                        <span style={{ color: '#888' }}>&#8594;</span>
                                        <span style={{ background: '#e6f4ea', color: '#1a6e2e', border: '1px solid #a8d8b0', padding: '0 4px' }}>{outName || '?'}</span>
                                    </span>
                                </div>
                                <div style={{ borderTop: '1px solid #e0ddd8', margin: '3px 0' }} />
                                {/* "est." because on an alt-unit order the base target is derived
                                    from the count, not promised: the packed figure beside it is a
                                    scale reading and will not match it exactly. */}
                                {infoRow('Target', `${num(po.qty_target).toLocaleString()} ${uom}`
                                    + (po.uom2 && orderBasePerAlt(po, it) ? ' est.' : ''))}
                                {infoRow('Packed', `${num(po.qty_packed).toLocaleString()} ${uom}`)}
                                {/* Same two figures in what the customer counts in. The base
                                    figures above stay first: they are what stock moves in. */}
                                {po.uom2 && orderBasePerAlt(po, it) && (() => {
                                    const f = orderBasePerAlt(po, it);
                                    // The ordered count as STATED — that is what the order is FOR,
                                    // and the base target above is only that count restated through
                                    // the item's g/y (api/packing._sync_target_to_alt), so deriving
                                    // it back would just round-trip. Packed has no stated count, so
                                    // it stays derived.
                                    const stated = num(po.qty2) > 0 ? num(po.qty2) : null;
                                    const derived = baseToAlt(num(po.qty_target), f);
                                    return (
                                        <>
                                            {infoRow('Target', formatAlt(stated ?? derived, po.uom2))}
                                            {/* Counted, never divided out of the kilos — the kilos
                                                are scale readings and an elastic cloth does not
                                                weigh what its g/y predicted. See
                                                api/packing._packed_alt_qty. */}
                                            {infoRow('Packed', po.qty_packed_alt != null
                                                ? formatAlt(num(po.qty_packed_alt), po.uom2)
                                                : '—')}
                                            {infoRow(`1 ${po.uom2}`, `${num(po.uom2_factor)} ${po.uom2_length_uom || 'Yard'} = ${f} ${uom}`)}
                                        </>
                                    );
                                })()}
                                {num(po.qty_rejected) > 0 && infoRow('QC reject', (
                                    <span style={{ color: '#a00000' }}>
                                        {num(po.qty_rejected).toFixed(2)}{po.package_count_rejected ? ` (${po.package_count_rejected})` : ''}
                                    </span>
                                ))}
                                <div style={{ borderTop: '1px solid #e0ddd8', margin: '3px 0' }} />
                                {infoRow('Created', po.created_at ? tzDateTime(po.created_at) : '—')}
                                {infoRow('Started', po.actual_start_date ? tzDateTime(po.actual_start_date) : '—')}
                                {infoRow('Reached target', po.actual_end_date ? tzDateTime(po.actual_end_date) : '—')}
                                {po.notes && (
                                    <div style={{ marginTop: 4, padding: '2px 5px', background: '#fffbe6', border: '1px solid #e0d080', fontSize: 9, fontStyle: 'italic', color: '#666' }}>
                                        {po.notes}
                                    </div>
                                )}
                            </div>

                            {/* Cartons minted by this order */}
                            <div style={{ borderRight: '1px solid #c0bdb5', padding: '6px 8px', background: '#f5f4ef', overflow: 'hidden' }}>
                                <div style={colHeader}>{po.package_label}s ({units.length})</div>
                                {units.length === 0 ? (
                                    <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: 9 }}>Nothing packed yet.</div>
                                ) : (
                                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                                        {units.map((u: any) => (
                                            <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, fontSize: 9, marginBottom: 2, paddingBottom: 2, borderBottom: '1px solid #e8e6e0' }}>
                                                <span style={{ color: '#888', width: 18, flexShrink: 0 }}>#{u.package_no}</span>
                                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                                                    <CodeChip code={u.batch_number} classic={CLASSIC} link style={{ cursor: 'default', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }} />
                                                    {/* A carton is a lot and labels itself like one: shade/combo
                                                        resolved from its stock key, size stamped on it at packing.
                                                        Renders nothing when it carries no identity. */}
                                                    <LotChips batch={u} showOtherAttrs={false} />
                                                </span>
                                                {/* The count that went in the box, when the order is
                                                    counted in one. Read off the carton, not divided out
                                                    of its qty. */}
                                                {u.alt_qty != null && po.uom2 && (
                                                    <span style={{ color: '#555' }}>{num(u.alt_qty)} {po.uom2}</span>
                                                )}
                                                {/* Which box it went into, and what the whole thing
                                                    weighs — the two figures the delivery note carries.
                                                    Both snapshotted on the carton at pack time, so an
                                                    edited master never rewrites what shipped. */}
                                                {u.packaging_type_name && (
                                                    <Chip classic={CLASSIC} size="xs" truncate title={u.packaging_type_name} style={{ maxWidth: 74 }}>
                                                        {u.packaging_type_name}
                                                    </Chip>
                                                )}
                                                {u.gross_weight_kg != null && (
                                                    <span style={{ color: '#555', whiteSpace: 'nowrap' }}
                                                        title={`Gross ${num(u.gross_weight_kg).toFixed(2)} kg = net ${num(u.weight_kg).toFixed(2)} + tare ${num(u.tare_kg).toFixed(2)}`}>
                                                        {num(u.gross_weight_kg).toFixed(2)} kg
                                                    </span>
                                                )}
                                                {/* Zero on hand = the carton has left on a pick list. */}
                                                <span style={{ fontWeight: 'bold', color: num(u.qty) > 0 ? '#0a3e0a' : '#999' }}>
                                                    {num(u.qty) > 0 ? num(u.qty).toFixed(2) : 'shipped'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Pack log — one row per PackingCompletion (one per lot per event) */}
                            <div style={{ padding: '6px 8px', background: '#f5f4ef', overflow: 'hidden' }}>
                                <div style={{ ...colHeader, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                                    <span>Pack Log ({comps.length})</span>
                                    {units.length > 0 && (
                                        <button type="button" onClick={() => setPrintLabels({ order: po, units })}
                                            style={miniBtn} title={`Print a label for every ${po.package_label.toLowerCase()} on this order`}>
                                            All Labels
                                        </button>
                                    )}
                                </div>
                                {comps.length === 0 ? (
                                    <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: 9 }}>No entries yet.</div>
                                ) : (
                                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                                        <table style={{ ...lvSubTable(true), border: 'none' }}>
                                            <thead>
                                                <tr>
                                                    <th style={{ ...th, width: 108 }}>Date / Time</th>
                                                    <th style={{ ...th, textAlign: 'right', width: 50 }}>Qty</th>
                                                    <th style={{ ...th, textAlign: 'right', width: 34 }}>{po.package_label.charAt(0)}s</th>
                                                    <th style={th}>Source lot</th>
                                                    <th style={th}>Operator</th>
                                                    <th style={{ ...th, width: 46 }} />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {/* No zebra — the only row fill is the rejected-red
                                                    marker, which carries meaning. */}
                                                {comps.map((c: any, ci: number) => (
                                                    <React.Fragment key={c.id || ci}>
                                                        <tr style={lvSubRow(true, ci, { fill: c.rejected ? '#fbe4e4' : undefined })}>
                                                            <td style={{ ...td, color: '#666', whiteSpace: 'nowrap' }}>
                                                                {c.completed_at ? tzDateTime(c.completed_at) : '—'}
                                                            </td>
                                                            <td style={{
                                                                ...td, textAlign: 'right', fontWeight: 'bold',
                                                                color: c.rejected ? '#900' : '#000080',
                                                                textDecoration: c.rejected ? 'line-through' : 'none',
                                                            }} title={c.reject_reason || undefined}>
                                                                +{num(c.qty).toFixed(2)}
                                                            </td>
                                                            <td style={{ ...td, textAlign: 'right', color: '#555' }}>{c.package_count}</td>
                                                            <td style={{ ...td, color: '#555', fontFamily: c.source_batch_number ? CODE_FONT : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}
                                                                title={c.source_batch_number || undefined}>
                                                                {c.source_batch_number || '—'}
                                                            </td>
                                                            <td style={{ ...td, color: '#333' }}>
                                                                {c.operator || '—'}
                                                                {c.rejected && (
                                                                    <span style={{ borderRadius: CHIP_RADIUS, marginLeft: 5, fontSize: 8, fontWeight: 'bold', color: '#900', border: '1px solid #c88', background: '#fff', padding: '0 3px' }}>REJECTED</span>
                                                                )}
                                                                {/* Partial reject: the entry stays live with its qty already
                                                                    trimmed, so the scrapped part only shows as its own marker. */}
                                                                {!c.rejected && num(c.qty_rejected) > 0 && (
                                                                    <span title={c.reject_reason || 'Partially rejected'}
                                                                        style={{ borderRadius: CHIP_RADIUS, marginLeft: 5, fontSize: 8, fontWeight: 'bold', color: '#900', border: '1px solid #c88', background: '#fff', padding: '0 3px' }}>
                                                                        -{num(c.qty_rejected).toFixed(2)} REJ
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td style={{ ...td, padding: '1px 4px', textAlign: 'right' }}>
                                                                {unitsOfComp(c.id).length > 0 && (
                                                                    <button type="button" style={miniBtn}
                                                                        onClick={() => setPrintLabels({ order: po, units: unitsOfComp(c.id) })}
                                                                        title={`Print labels for the ${unitsOfComp(c.id).length} ${po.package_label.toLowerCase()}(s) of this entry`}>
                                                                        Labels
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                        {c.notes && (
                                                            <tr>
                                                                <td colSpan={6} style={{ ...td, borderTop: 'none', padding: '0 5px 3px 12px', color: '#888', fontStyle: 'italic' }}>{c.notes}</td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                ))}
                                            </tbody>
                                        </table>
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
                icon="bi-box2"
                title="Packing Orders"
            />
            <div style={xpToolbar()}>
                <ToolbarButton classic tone="neutral" icon="bi-arrow-clockwise" onClick={loadAll}>Refresh</ToolbarButton>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#333' }}>
                    {total.toLocaleString()} order{total !== 1 ? 's' : ''}
                </span>
                {canManage && (
                    <ToolbarButton classic tone="create" icon="bi-plus-lg" title="Order finished goods packed into cartons" onClick={() => setCreating(true)}>
                        New Packing Order
                    </ToolbarButton>
                )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', background: '#fff', minHeight: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th style={{ ...xpTableHeader, width: 22 }} />
                            <th style={xpTableHeader}>Code</th>
                            <th style={xpTableHeader}>Item</th>
                            {/* Own column, same call as the WO list: a row can carry size +
                                combo + colour variant + colour code at once, and squeezing
                                that onto the right edge of Item left the item name a sliver. */}
                            <th style={{ ...xpTableHeader, width: 280 }}>Variant</th>
                            <th style={{ ...xpTableHeader, width: 140 }}>Sales Order</th>
                            <th style={{ ...xpTableHeader, width: 96 }}>Status</th>
                            {/* No Target/Packed columns: each bar's own line already reads
                                "packed / target unit", so the two number columns restated
                                the pair the packer was going to read off the bar anyway.
                                One column per unit — the selling unit the order is judged
                                in, and the stock UOM the scale and the ledger work in. */}
                            <th style={{ ...xpTableHeader, width: 145 }}>Selling Unit</th>
                            <th style={{ ...xpTableHeader, width: 145 }}>Stock UOM</th>
                            <th style={{ ...xpTableHeader, width: 100 }}>Cartons</th>
                            <th style={{ ...xpTableHeader, width: 100 }}>Created</th>
                            <th style={{ ...xpTableHeader, textAlign: 'right', width: 96 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody ref={listBodyRef}>
                        {orders.length === 0 && (loading ? (
                            <TableSkeleton rows={7} cols={skel.cols ?? PO_COLS} classic tdStyle={td} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                        ) : (
                            <tr><td colSpan={PO_COLS} style={{ padding: 0 }}>
                                <XPEmptyState icon="bi-box2" message='No packing orders yet. Click "New Packing Order" to pack finished goods into cartons.' />
                            </td></tr>
                        ))}
                        {orders.map((po: any, idx: number) => {
                            const it = itemById[String(po.item_id)];
                            // Same helper the pack modal's header bar reads, so the row
                            // and the modal always show the same percentage.
                            const prog = packProgress(po, it);
                            const closed = po.status === 'COMPLETED' || po.status === 'CANCELLED';
                            const isExpanded = expandedId === String(po.id);
                            return (
                                <React.Fragment key={po.id}>
                                <tr
                                    style={{ ...rowStyle(idx), ...(isExpanded ? { background: rowStateBg('expanded', true) } : {}), cursor: 'pointer' }}
                                    onClick={() => setExpandedId(prev => prev === String(po.id) ? null : String(po.id))}
                                >
                                    <ExpanderCell classic={CLASSIC} expanded={isExpanded} tdStyle={td} label="packing order detail"
                                        onToggle={() => setExpandedId(prev => prev === String(po.id) ? null : String(po.id))} />
                                    <td style={td}><CodeChip code={po.code} classic={CLASSIC} tone="accent" style={{ fontWeight: 'bold' }} /></td>
                                    <td style={td}>
                                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{po.item_name || it?.name || po.item_id}</div>
                                        <div style={{ fontSize: 9, color: '#888' }}>{po.item_code || it?.code}</div>
                                    </td>
                                    <td style={{ ...td, overflow: 'hidden', whiteSpace: 'normal' }}>
                                        {(() => {
                                            const v = variantOf(po);
                                            return (v.combo || v.size || v.colorVariant || po.color_code) ? (
                                                <VariantChips
                                                    combo={v.combo}
                                                    size={v.size}
                                                    colorVariant={v.colorVariant}
                                                    colorVariantHex={v.colorVariantHex}
                                                    colorCode={po.color_code}
                                                    colorName={po.color_name}
                                                    colorHex={po.color_hex}
                                                    scale="xs"
                                                    classic={CLASSIC}
                                                    style={{ flexWrap: 'wrap', rowGap: 2 }}
                                                />
                                            ) : <span style={{ color: '#888' }}>—</span>;
                                        })()}
                                    </td>
                                    <td style={td} onClick={e => e.stopPropagation()}>
                                        {po.sales_order_code ? (
                                            <CodeChip
                                                code={po.sales_order_code}
                                                classic={CLASSIC}
                                                link
                                                onClick={() => router.push(`/sales-orders?so=${encodeURIComponent(po.sales_order_code)}`)}
                                            />
                                        ) : <span style={{ color: '#888' }}>to stock</span>}
                                    </td>
                                    <td style={td}><StatusChip status={po.status} /></td>
                                    {/* The same run measured twice, one column each. The boxes
                                        are weighed and the piece count is that weight read
                                        through the order's sampled unit weight, so neither
                                        figure alone tells the packer where the order stands: a
                                        light run finishes its pieces before its kilos. Thin bar
                                        + qty line, matching the SO table's MO progress cell
                                        (MOProgressLink/moProgressCell in SalesOrderView). */}
                                    <td style={td}>
                                        <PackProgressBars prog={prog} uom={po.item_uom || it?.uom || ''} height={6} only="alt" />
                                    </td>
                                    <td style={td}>
                                        <PackProgressBars prog={prog} uom={po.item_uom || it?.uom || ''} height={6} only="base" />
                                    </td>
                                    <td style={{ ...td, textAlign: 'right' }}>{po.package_count || 0}</td>
                                    <td style={td}>{po.created_at ? tzDate(po.created_at) : '—'}</td>
                                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                                        {/* Pack is the row's primary action — inline, same shape as
                                            "log production output" on the WO list, not buried in the menu. */}
                                        {canManage && !closed && (
                                            <>
                                                <span style={{ marginRight: 2 }}>
                                                    <XPActionButton
                                                        classic={CLASSIC}
                                                        tone="success"
                                                        icon="bi-plus-lg"
                                                        title="Pack — log cartons against this order"
                                                        onClick={() => setDetail(po)}
                                                    />
                                                </span>
                                                <span style={{ marginRight: 2 }}>
                                                    <XPActionButton
                                                        classic={CLASSIC}
                                                        tone="primary"
                                                        icon="bi-check2-square"
                                                        title="Close Order — no further cartons can be packed"
                                                        onClick={() => closeOrder(po)}
                                                    />
                                                </span>
                                            </>
                                        )}
                                        <MenuTriggerButton classic onClick={e => menuToggle(String(po.id), e)} />
                                    </td>
                                </tr>
                                {isExpanded && renderPackDetail(po)}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <Pager page={clampedPage} total={total} pageSize={PO_PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />

            {menuOpenId && (() => {
                const po = orders.find((x: any) => String(x.id) === menuOpenId);
                if (!po) return null;
                const closed = po.status === 'COMPLETED' || po.status === 'CANCELLED';
                return (
                    <FloatingMenu
                        pos={menuPos}
                        items={[
                            // Open/Pack is inline on the row for anyone who can pack; the menu
                            // still carries it for closed orders and read-only users.
                            { key: 'open', label: closed ? 'View' : 'Pack', icon: 'bi-box-seam', hidden: canManage && !closed, onClick: () => { menuClose(); setDetail(po); } },
                            { key: 'card', label: 'Print Packing Card', icon: 'bi-printer', onClick: () => { menuClose(); setPrintCard(po); } },
                            { key: 'labels', label: 'Print Carton Labels', icon: 'bi-tags', hidden: !(po.packed_units || []).length, onClick: () => { menuClose(); setPrintLabels({ order: po, units: po.packed_units || [] }); } },
                            { key: 'delete', label: 'Delete', icon: 'bi-trash', danger: true, hidden: !(canManage && !(po.completions || []).length), onClick: () => { menuClose(); deleteOrder(po); } },
                        ]}
                    />
                );
            })()}
            <XPStatusBar right={`${openCount} open · ${doneCount} closed`}>
                {loading ? 'Loading...' : `${total} packing order(s)`}
            </XPStatusBar>

            {creating && (
                <PackingOrderForm
                    locPickerTreeOptions={locPickerTreeOptions}
                    machineOptions={machineOptions}
                    defaultSourceLocId={systemLocId('QC')}
                    defaultOutputLocId={systemLocId('FG')}
                    authFetch={authFetch}
                    showToast={showToast}
                    initialValues={createInitialValues}
                    onClose={() => { setCreating(false); setCreateInitialValues(null); }}
                    onCreated={async (po: any) => { setCreating(false); setCreateInitialValues(null); await loadAll(); setDetail(po); }}
                />
            )}

            {detail && (
                <PackingOrderDetail
                    po={detail}
                    itemById={itemById}
                    machineOptions={machineOptions}
                    locationById={locationById}
                    locPickerTreeOptions={locPickerTreeOptions}
                    authFetch={authFetch}
                    showToast={showToast}
                    onClose={() => setDetail(null)}
                    onChanged={loadAll}
                    onPrintCard={(o: any) => setPrintCard(o)}
                    onPrintLabels={(o: any, units: any[]) => setPrintLabels({ order: o, units })}
                />
            )}

            {printCard && (
                <PackingCardPrintModal
                    po={printCard}
                    attributes={attributes}
                    companyProfile={companyProfile}
                    currentStyle={uiStyle}
                    authFetch={authFetch}
                    onClose={() => setPrintCard(null)}
                />
            )}

            {printLabels && (
                <PackedUnitLabelPrintModal
                    po={printLabels.order}
                    units={printLabels.units}
                    companyProfile={companyProfile}
                    onClose={() => setPrintLabels(null)}
                />
            )}
        </ShellWindow>
    );
}

// ── create form ──────────────────────────────────────────────────────────────
function PackingOrderForm({ locPickerTreeOptions, machineOptions, defaultSourceLocId, defaultOutputLocId, authFetch, showToast, onClose, onCreated, initialValues }: any) {
    const { results: fgResults, onSearch: fgSearch } = useFinishedGoodsSearch();
    // UOM master for the alt-unit factor rows (Roll -> Yard = 50), and itemIndex
    // for the weight spec that turns a length into the item's stock UOM.
    const { uoms, itemIndex } = useData();
    const [itemId, setItemId] = useState(initialValues?.item_id || '');
    const [qtyTarget, setQtyTarget] = useState(initialValues?.qty_target != null ? String(initialValues.qty_target) : '');
    const [packSize, setPackSize] = useState('');
    const [packageLabel, setPackageLabel] = useState('Carton');
    // Alt (selling) unit — what the customer counts in (Pic = a roll, Pcs = a cut
    // piece). Snapshotted from the picked SO line so the packing order counts the
    // way the order was taken; picked by hand when packing to stock. `qtyTarget`
    // stays the canonical figure in the item's own UOM and is derived from these.
    const [qty2, setQty2] = useState('');
    const [uom2, setUom2] = useState('');
    const [uom2Factor, setUom2Factor] = useState<number | null>(null);
    const [uom2LengthUom, setUom2LengthUom] = useState('');
    const [altPerCarton, setAltPerCarton] = useState('');
    // How the floor will state a carton on this order — see PackingOrder.pack_basis.
    // Chosen here rather than per pack event: it decides what the packer is asked
    // to type, and two events on one order typing different things is exactly the
    // mixed record this column exists to prevent.
    const [packBasis, setPackBasis] = useState<'COUNTED' | 'WEIGHED'>('COUNTED');
    // What one yard/metre of THIS cloth actually weighs, sampled by the operator
    // before packing. Prefilled from the item master (a development estimate) and
    // overwritten with the measured figure; it is what every alt -> kg figure on
    // this order converts through.
    const [sampleWeight, setSampleWeight] = useState('');
    const [sampleWeightUnit, setSampleWeightUnit] = useState('');
    // True once the operator has touched either field, so the prefill effect below
    // stops overwriting their number when the item row re-resolves.
    const sampleTouched = useRef(false);
    // Both stores default to the seeded ones: bulk FG waits in Quarantine until QC
    // releases it, sealed cartons land in the Finished Goods store. A Quarantine
    // Packing suggestion still names its own source and wins. Both stay editable —
    // these are only the defaults, not a fixed route.
    const [sourceLoc, setSourceLoc] = useState(initialValues?.source_location_id || defaultSourceLocId || '');
    const [outputLoc, setOutputLoc] = useState(defaultOutputLocId || '');
    // Which packing machine runs this order. Optional — an order cut before the
    // floor knows the machine is still packable, and the packer can name one at
    // log time — but naming it here is what pre-fills every pack event.
    const [workCenterId, setWorkCenterId] = useState(initialValues?.work_center_id || '');
    const [soId, setSoId] = useState(initialValues?.sales_order_id || '');
    const [soLineId, setSoLineId] = useState(initialValues?.sales_order_line_id || '');
    const [notes, setNotes] = useState('');
    const [sos, setSos] = useState<any[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        (async () => {
            const res = await authFetch(`${API_BASE}/sales-orders?status=PENDING,READY,PARTIAL&limit=0`);
            const list = res.ok ? (await res.json()) : null;
            const rows = Array.isArray(list) ? list : (list?.items || []);
            // A Quarantine Packing deep link names the SO its lots were made for, and
            // that order is not necessarily still open — a partially shipped one sits
            // at SENT, and the list above only carries PENDING/READY/PARTIAL. Without
            // this the named SO is simply absent from the dropdown, so the <select>
            // falls back to showing "pack to stock", `selectedSO` is undefined, no
            // line can be matched, and the alt unit never arrives — all silently, and
            // all looking exactly like a lot that had no order in the first place.
            const wanted = initialValues?.sales_order_id;
            if (wanted && !rows.some((s: any) => String(s.id) === String(wanted))) {
                const one = await authFetch(`${API_BASE}/sales-orders/${wanted}`);
                if (one.ok) {
                    const so = await one.json();
                    if (so?.id) rows.unshift(so);
                }
            }
            setSos(rows);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authFetch, initialValues?.sales_order_id]);

    // Locations come from DataContext, which may still be loading when this modal
    // opens — backfill the defaults once they arrive, without clobbering a pick.
    useEffect(() => {
        if (defaultSourceLocId) setSourceLoc((v: string) => v || defaultSourceLocId);
        if (defaultOutputLocId) setOutputLoc((v: string) => v || defaultOutputLocId);
    }, [defaultSourceLocId, defaultOutputLocId]);

    // A pre-filled item (from a Quarantine Packing suggestion) is only an id —
    // the combobox can't show its name/code until a search has actually returned
    // it, so seed one from whatever identifying text the suggestion carried.
    useEffect(() => {
        if (initialValues?.item_id) fgSearch(initialValues.item_code || initialValues.item_name || '');
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const selectedSO = useMemo(() => sos.find((s: any) => String(s.id) === soId), [sos, soId]);
    const soLines = selectedSO?.lines || [];
    const soOptions = useMemo(
        () => sos.map((s: any) => ({ value: String(s.id), label: s.po_number, subLabel: s.customer_name })),
        [sos],
    );

    // Picking an SO line fixes what is being packed — item and variant both come
    // from the order, so they are not asked for twice.
    // The item row behind the picked id — its UOM and g/y (or g/m) weight are what
    // convert an alt count into the stock figure. The search results win over the
    // index: a just-searched row is the freshest copy of the same item.
    const selectedItem = useMemo(
        () => (fgResults || []).find((i: any) => String(i.id) === String(itemId)) || itemIndex?.[String(itemId)],
        [fgResults, itemIndex, itemId],
    );
    const selectedUom2 = useMemo(
        () => (uoms || []).find((u: any) => u.name === uom2),
        [uoms, uom2],
    );
    // Base-UOM qty in one alt unit. Null means the chain can't be resolved (a gsm
    // weight needs the fabric width, a counted stock UOM has no length at all) —
    // the form then keeps base-only entry rather than inventing a factor.
    // Prefill the sample from the item's own spec when an item is picked, so the
    // operator sees the estimate they are correcting rather than an empty box.
    // Only until they touch it — the item row re-resolves when a search lands, and
    // re-running this over a typed figure would quietly discard the sampling.
    useEffect(() => {
        if (sampleTouched.current || !selectedItem) return;
        const unit = String(selectedItem.weight_unit || '').trim().toLowerCase();
        // gsm can't convert a length to a weight without the fabric width, so it
        // is not offered as a starting point — the field stays empty and the order
        // keeps base-only entry, exactly as it does today.
        if (!(Number(selectedItem.weight_per_unit) > 0) || !['g/y', 'g/m'].includes(unit)) return;
        setSampleWeight(String(selectedItem.weight_per_unit));
        setSampleWeightUnit(unit);
    }, [selectedItem]);

    // The weight spec every conversion in this form runs through: the sampled
    // figure once both halves are set, the item's otherwise. Mirrors
    // `packing_service.order_weight_spec`, so the form's preview and the order the
    // server writes agree.
    const useSample = num(sampleWeight) > 0 && !!sampleWeightUnit;
    const weightSpec = {
        weightPerUnit: useSample ? num(sampleWeight) : selectedItem?.weight_per_unit,
        weightUnit: useSample ? sampleWeightUnit : selectedItem?.weight_unit,
    };

    const altBaseFactor = useMemo(() => basePerAlt({
        factor: uom2Factor,
        lengthUom: uom2LengthUom,
        itemUom: selectedItem?.uom,
        ...weightSpec,
    }), [uom2Factor, uom2LengthUom, selectedItem, sampleWeight, sampleWeightUnit]);

    // Is the base target being computed for the planner rather than typed by them?
    const altDrivesTarget = !!altBaseFactor && num(qty2) > 0;
    const altDrivesPackSize = !!altBaseFactor && num(altPerCarton) > 0;

    // Same for the box size: the count per carton is what the floor packs to, so
    // the base figure beside it is kept in step rather than typed.
    useEffect(() => {
        if (!altBaseFactor || num(altPerCarton) <= 0) return;
        const per = altToBase(num(altPerCarton), altBaseFactor);
        if (per !== null) setPackSize(String(per));
    }, [altBaseFactor, altPerCarton]);

    // The alt count IS the target when the order carries one — the base figure is
    // only that count restated through the item's g/y, and the weight that really
    // leaves stock is read off the scale at each pack event. Kept in an effect
    // rather than only in the change handlers because the item (and so its weight
    // spec) can land after the SO line was picked, and because a count copied off
    // that line has to move the target too — the server derives the same figure
    // from `qty2` regardless of what is posted (`api/packing._sync_target_to_alt`).
    useEffect(() => {
        if (!altBaseFactor || num(qty2) <= 0) return;
        const target = altToBase(num(qty2), altBaseFactor);
        if (target !== null) setQtyTarget(String(target));
    }, [altBaseFactor, qty2]);

    // One place that pushes the alt figures down onto the canonical ones, so the
    // target and the carton size can never be derived two different ways.
    const applyAlt = (qty2Str: string, factorVal: number | null, lengthUom: string, perCartonStr: string) => {
        const factor = basePerAlt({
            factor: factorVal,
            lengthUom,
            itemUom: selectedItem?.uom,
            ...weightSpec,
        });
        if (!factor) return;
        const target = altToBase(num(qty2Str), factor);
        if (target !== null && num(qty2Str) > 0) setQtyTarget(String(target));
        const per = altToBase(num(perCartonStr), factor);
        if (per !== null && num(perCartonStr) > 0) setPackSize(String(per));
    };

    const onQty2Change = (val: string) => {
        setQty2(val);
        applyAlt(val, uom2Factor, uom2LengthUom, altPerCarton);
    };
    const onFactorPick = (factorVal: number | null, toUom: string) => {
        setUom2Factor(factorVal);
        setUom2LengthUom(toUom);
        applyAlt(qty2, factorVal, toUom, altPerCarton);
    };
    const onAltPerCartonChange = (val: string) => {
        setAltPerCarton(val);
        applyAlt(qty2, uom2Factor, uom2LengthUom, val);
    };

    // The selling unit an SO line is counted in, copied onto the form. Split out of
    // `applySoLine` because the alt unit is NOT specific to one line: a style ordered
    // in four colours is four lines that all sell in Pcs of the same cut length. So
    // when the line pick is ambiguous and left to the planner, the unit can still be
    // filled in — which is the whole point of arriving here from a Quarantine Packing
    // deep link, where the lots are already made and only the counting is in question.
    // `copyQty2` is off for that case: the ordered count belongs to a specific line,
    // while the unit and factor do not.
    const applyLineAltUnit = (line: any, copyQty2: boolean) => {
        if (!line?.uom2) return;
        setUom2(line.uom2);
        const factor = line.uom2_factor != null ? parseFloat(String(line.uom2_factor)) : null;
        setUom2Factor(factor);
        // The factor's target unit lives on the UOM master, not on the SO line, so it
        // is resolved here rather than guessed downstream. `uoms` may still be loading
        // — the effect below re-runs once it lands, so a miss here is not permanent.
        const uomObj = (uoms || []).find((u: any) => u.name === line.uom2);
        const factorObj = (uomObj?.factors || []).find((f: any) => parseFloat(f.value) === factor);
        setUom2LengthUom(factorObj?.to_uom_name || '');
        if (copyQty2 && line.qty2 != null && line.qty2 !== '') setQty2(String(line.qty2));
    };

    // The line's own selling unit, for the picker row. A planner telling two lines
    // of the same style apart reads the count the customer ordered in (12 Roll)
    // before the yardage it converts to, and it is also the unit the cartons will
    // be counted in — so it belongs on the row that fixes the item, not only in
    // the alt-unit field it fills in below. The factor's length unit lives on the
    // UOM master rather than on the line, resolved the same way `applyLineAltUnit`
    // does; `uoms` may still be loading, in which case the tooltip drops the
    // conversion and the chip itself is unaffected.
    const lineAltUnit = (l: any): { text: string; title: string } | null => {
        if (!l?.uom2 || l.qty2 == null || l.qty2 === '') return null;
        const factor = l.uom2_factor != null ? parseFloat(String(l.uom2_factor)) : null;
        const uomObj = (uoms || []).find((u: any) => u.name === l.uom2);
        const factorObj = (uomObj?.factors || []).find((f: any) => parseFloat(f.value) === factor);
        const lengthUom = factorObj?.to_uom_name || 'Yard';
        return {
            text: `${num(l.qty2).toLocaleString()} ${l.uom2}`,
            title: factor
                ? `Ordered in the customer's selling unit — 1 ${l.uom2} = ${factor} ${lengthUom}`
                : `Ordered in the customer's selling unit`,
        };
    };

    const applySoLine = (lineId: string) => {
        setSoLineId(lineId);
        const line = soLines.find((l: any) => String(l.id) === lineId);
        if (line) {
            setItemId(String(line.item_id));
            // `qty_target` is in the ITEM's stock UOM, and `line.qty` is not: the SO
            // form's only quantity field is labelled Yard and its Meter/Gross-Yd/Kg
            // satellites all write back into it as yards (see
            // so_fulfilment_service.ordered_qty_in_stock_uom). Copying it straight
            // across made a 2880 Pcs order of a kg-stocked cloth a 14400 kg packing
            // order — the yard total, wearing a kg label, 5.5x the real one.
            // `qty_ordered_base` is that same figure restated by the server, which
            // prefers the line's own `qty_kg` over re-deriving it. Null means the
            // item is stocked by weight with no g/y/g/m on its master: unknowable,
            // so the field is left for the planner rather than filled with yards.
            if (!qtyTarget && line.qty_ordered_base != null) {
                setQtyTarget(String(line.qty_ordered_base));
            }
            // Follow the order's own selling unit: the packer counts cartons in
            // whatever the customer ordered in.
            applyLineAltUnit(line, true);
        }
    };

    // Once an SO is picked (and the item is already fixed — from a Quarantine
    // Packing deep link, or a prior manual pick), auto-select the order line
    // that's unambiguous. Colour and combo are order/production-level picks,
    // never baked into item_id (Item.variant_type just says which library the
    // SO line's own color_id/attribute_values came from), so a style ordered in
    // several colours/combos as separate lines needs those matched too, same as
    // size. Each hint only narrows if the source lot actually carried it, and
    // never past zero candidates — a hint that doesn't match anything present
    // is dropped rather than blocking the match, since a stale attribute snapshot
    // shouldn't defeat an otherwise-exact match. Ties are left for the planner.
    useEffect(() => {
        if (!soId || !itemId || soLineId) return;
        let candidates = soLines.filter((l: any) => String(l.item_id) === String(itemId));
        if (!candidates.length) return;

        const narrow = (pred: (l: any) => boolean) => {
            const next = candidates.filter(pred);
            if (next.length) candidates = next;
        };
        const sizeHint = initialValues?.bom_size_id;
        const colorHint = initialValues?.color_id;
        const comboHint = initialValues?.combo_value_id;
        if (sizeHint) narrow((l: any) => l.bom_size_id && String(l.bom_size_id) === String(sizeHint));
        if (colorHint) narrow((l: any) => l.color_id && String(l.color_id) === String(colorHint));
        if (comboHint) narrow((l: any) => (l.attribute_value_ids || []).some((id: any) => String(id) === String(comboHint)));

        if (candidates.length === 1) {
            applySoLine(String(candidates[0].id));
            return;
        }
        // Ambiguous line, but the selling unit may still be unambiguous: same style,
        // several colours, all sold as Pcs of the same cut. Fill the unit when every
        // candidate agrees on it and leave the line for the planner. Not the ordered
        // count — that belongs to whichever line they end up picking.
        const first = candidates[0];
        const sameUnit = first?.uom2 && candidates.every((l: any) =>
            l.uom2 === first.uom2
            && String(l.uom2_factor ?? '') === String(first.uom2_factor ?? ''));
        if (sameUnit && !uom2) applyLineAltUnit(first, false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [soId, itemId, soLines, soLineId]);

    // Backfill the factor's length unit once the UOM master lands.
    //
    // The prefill above can run before `uoms` has loaded, and then the lookup that
    // turns "1 Pic = 50" into "50 m" finds nothing. It cannot be left blank: with no
    // unit, `basePerAlt` falls back to yard (the unit every legacy factor was entered
    // against), so a metre-based recipe silently computes the target and the carton
    // size 9.4% light. Re-running it here rather than widening the effect above,
    // which sets `soLineId` on a single match and would early-return.
    useEffect(() => {
        if (!uom2 || uom2Factor == null || uom2LengthUom) return;
        const uomObj = (uoms || []).find((u: any) => u.name === uom2);
        const factorObj = (uomObj?.factors || []).find((f: any) => parseFloat(f.value) === uom2Factor);
        if (factorObj?.to_uom_name) setUom2LengthUom(factorObj.to_uom_name);
    }, [uoms, uom2, uom2Factor, uom2LengthUom]);


    const fgOptions = useMemo(
        () => (fgResults || []).map((i: any) => ({ value: String(i.id), label: i.name, subLabel: i.code })),
        [fgResults]
    );


    const submit = async () => {
        if (!itemId) { showToast('Pick an item to pack', 'warning'); return; }
        if (num(qtyTarget) <= 0) { showToast('Target quantity must be greater than zero', 'warning'); return; }
        // The line link is what credits these cartons to the order — without it the
        // SO can never reach READY, so an SO with no line picked is a silent dead end.
        if (soId && !soLineId) { showToast('Pick which order line this packs', 'warning'); return; }
        // Both are hard-required by the pack endpoint, so catching it here beats
        // creating an order that can never be packed.
        if (!sourceLoc) { showToast('Pick where the bulk goods are packed from', 'warning'); return; }
        if (!outputLoc) { showToast('Pick where the finished cartons are stored', 'warning'); return; }
        setSaving(true);
        try {
            const body = {
                item_id: itemId,
                qty_target: num(qtyTarget),
                pack_size: packSize === '' ? null : num(packSize),
                // The box size the floor packs to, in the counting unit. Stored
                // rather than left as the derived kilos: a carton holds 12 pieces,
                // and the pack screens split by that count (the kilos it works out
                // to are what the scale then contradicts).
                pack_size_alt: altPerCarton === '' ? null : num(altPerCarton),
                package_label: packageLabel || 'Carton',
                // Alt unit as stated here (already inherited from the SO line when
                // one was picked). Sent explicitly rather than left for the server
                // to re-read off the line: an SO edited later must not re-scale an
                // order that is already being packed.
                qty2: qty2 === '' ? null : num(qty2),
                uom2: uom2 || null,
                uom2_factor: uom2Factor,
                uom2_length_uom: uom2LengthUom || null,
                // The operator's measured figure. Sent as a pair, and only when
                // both halves are set — a weight with no unit converts nothing,
                // and the server refuses one anyway.
                sample_weight_per_unit: useSample ? num(sampleWeight) : null,
                sample_weight_unit: useSample ? sampleWeightUnit : null,
                // Only meaningful with an alt unit — with nothing to convert into,
                // the packer types the stock qty either way.
                pack_basis: uom2 ? packBasis : 'COUNTED',
                source_location_id: sourceLoc || null,
                output_location_id: outputLoc || null,
                work_center_id: workCenterId || null,
                sales_order_id: soId || null,
                sales_order_line_id: soLineId || null,
                // A hand-typed variant is still never sent — the pack event resolves
                // it from the source lot's own StockBalance row. But a Quarantine
                // Packing deep link is not hand-typed: it carries the exact shade of
                // the MO group being packed, and stating it is what stops the order
                // from claiming (and offering) every other colour of the same FG
                // sitting in the same hold bin. Packing to stock with no hint keeps
                // the old variant-less behaviour.
                color_id: initialValues?.color_id || null,
                attribute_value_ids: initialValues?.combo_value_id ? [initialValues.combo_value_id] : [],
                notes: notes || null,
                // No packaging plan on the order: the box is picked per carton line
                // in the pack modal, where the packer is holding it. Planning it
                // here meant naming a carton type before anyone knew how many
                // cartons there would be, and `qty_consumed` then argued with it.
            };
            const res = await authFetch(`${API_BASE}/packing`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            if (res.ok) { showToast('Packing order created', 'success'); onCreated(await res.json()); }
            else { const e = await res.json().catch(() => ({})); showToast(`Error: ${e.detail || 'create failed'}`, 'danger'); }
        } finally { setSaving(false); }
    };

    return (
        <ModalWrapper
            isOpen onClose={onClose} title="New Packing Order" size="lg" modeless
            footer={
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <button className={XP_BTN} style={xpBtn()} onClick={onClose}>Cancel</button>
                    <button className={XP_BTN} style={xpBtnGreen()} disabled={saving} onClick={submit}>{saving ? 'Creating...' : 'Create'}</button>
                </div>
            }
        >
            <div style={{ fontFamily: xpFont }}>
                <FormSection title={<SectionTitle icon="bi-receipt">Demand</SectionTitle>} classic={CLASSIC}>
                    <div style={{ ...fieldGrid, gridTemplateColumns: '1fr 1fr' }}>
                        <div>
                            <FieldLabel classic={CLASSIC} title="Leave empty to pack to stock">Sales Order</FieldLabel>
                            <SearchableSelect
                                options={soOptions}
                                value={soId}
                                onChange={(v: string) => { setSoId(v); setSoLineId(''); }}
                                placeholder="— pack to stock —"
                                size="sm"
                            />
                        </div>
                    </div>
                    {soId && (
                        <div style={{ marginTop: 8 }}>
                            {/* A native <select> only had room for a flattened text line
                                per option — fine for one line at a time, but it hid the
                                very differences (size/combo/colour) a planner needs to
                                tell same-item lines apart while comparing them side by
                                side. A checkbox-style picker (same row shape as the WO
                                staging lot picker) shows every line's badges at once. */}
                            <FieldLabel
                                classic={CLASSIC}
                                title="Fixes the item being packed — colour and variant attributes are inherited from the line"
                            >Order line</FieldLabel>
                            <div style={{
                                border: '1px solid #7f9db9', background: 'white',
                                maxHeight: 220, overflowY: 'auto',
                            }}>
                                {soLines.length === 0 ? (
                                    <div style={{ color: '#aaa', padding: '4px 6px', fontSize: 11 }}>— this order has no lines —</div>
                                ) : soLines.map((l: any) => {
                                    const checked = String(l.id) === String(soLineId);
                                    return (
                                        <label key={l.id} style={lvPickerRow(CLASSIC, checked)}>
                                            <RowCheckbox
                                                classic={CLASSIC}
                                                checked={checked}
                                                label={l.item_name || l.item_code || 'line'}
                                                onChange={() => applySoLine(checked ? '' : String(l.id))}
                                            />
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                    <CodeChip code={l.item_code || l.item_name} classic={CLASSIC} />
                                                    <LotChip tone="qty" title="Ordered quantity">
                                                        {num(l.qty).toLocaleString()} Yd
                                                    </LotChip>
                                                    {l.qty_ordered_base != null && l.base_uom && l.base_uom.toLowerCase() !== 'yard' ? (
                                                        <LotChip tone="qty" title="Ordered quantity in the item's stock UOM">
                                                            {num(l.qty_ordered_base).toLocaleString()} {l.base_uom}
                                                        </LotChip>
                                                    ) : null}
                                                    {(() => {
                                                        const alt = lineAltUnit(l);
                                                        return alt ? (
                                                            <LotChip tone="order" title={alt.title}>
                                                                {alt.text}
                                                            </LotChip>
                                                        ) : null;
                                                    })()}
                                                </div>
                                                <LotChips batch={l} />
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </FormSection>

                <FormSection title={<SectionTitle icon="bi-box2">What to Pack</SectionTitle>} classic={CLASSIC}>
                    {/* Fixed columns, and no per-field hints in this row: FieldLabel puts a
                        hint between the label and the input, so hinting only one field of a
                        row pushes that input a line below its neighbours. */}
                    <div style={{ ...fieldGrid, gridTemplateColumns: 'minmax(200px, 1fr) 100px 100px 120px' }}>
                        <div>
                            <FieldLabel classic={CLASSIC}>Finished good</FieldLabel>
                            <SearchableSelect options={fgOptions} value={itemId} onChange={setItemId} onSearch={fgSearch} placeholder="Search item..." size="sm" />
                        </div>
                        <div>
                            <FieldLabel classic={CLASSIC}>
                                {altDrivesTarget ? `Target ${selectedItem?.uom || 'qty'} (est.)` : 'Target qty'}
                            </FieldLabel>
                            {/* Read-only once an alt count drives it: the count below is what
                                the order is for, this is only its weight estimate, and typing
                                the piece count in here is exactly the mix-up that made a 50 Pcs
                                order a 50 kg one. */}
                            <input type="number" min={0} readOnly={altDrivesTarget}
                                title={altDrivesTarget
                                    ? `Derived from ${num(qty2).toLocaleString()} ${uom2} — the real weight is taken from the scale at pack time`
                                    : undefined}
                                style={{
                                    ...xpInput, width: '100%', textAlign: 'right',
                                    ...(altDrivesTarget ? { background: '#efeee9', color: '#555' } : null),
                                }}
                                value={qtyTarget} onChange={e => setQtyTarget(e.target.value)} />
                        </div>
                        <div>
                            <FieldLabel
                                classic={CLASSIC}
                                title="Splits the target into cartons — leave it empty to decide the carton count per pack event"
                            >
                                {altDrivesPackSize ? `${selectedItem?.uom || 'Qty'}/carton (est.)` : 'Qty per carton'}
                            </FieldLabel>
                            {/* Same rule as the target one field over: the carton holds a
                                stated number of pieces, and this is what they weigh in
                                theory — the pack screens split by the count. */}
                            <input type="number" min={0} readOnly={altDrivesPackSize}
                                title={altDrivesPackSize
                                    ? `Derived from ${num(altPerCarton).toLocaleString()} ${uom2} per carton — the boxes are split by that count`
                                    : undefined}
                                style={{
                                    ...xpInput, width: '100%', textAlign: 'right',
                                    ...(altDrivesPackSize ? { background: '#efeee9', color: '#555' } : null),
                                }}
                                value={packSize} onChange={e => setPackSize(e.target.value)} />
                        </div>
                        <div>
                            <FieldLabel classic={CLASSIC}>Package type</FieldLabel>
                            <input style={{ ...xpInput, width: '100%' }} value={packageLabel} onChange={e => setPackageLabel(e.target.value)} placeholder="Carton" />
                        </div>
                    </div>
                    {/* Alt (selling) unit. Its own row because the control is a compound
                        one (count + unit + factor), and because it drives the two fields
                        above rather than sitting beside them. */}
                    <div style={{ ...fieldGrid, gridTemplateColumns: 'minmax(220px, 1fr) 130px', marginTop: 8 }}>
                        <div>
                            <FieldLabel classic={CLASSIC}>Alt unit</FieldLabel>
                            <div style={{ display: 'flex' }}>
                                <input type="number" min={0}
                                    style={{ ...xpInput, flex: 1, minWidth: 0, borderRight: 'none', textAlign: 'right' }}
                                    placeholder="0" value={qty2} onChange={e => onQty2Change(e.target.value)} />
                                <select style={{ ...xpSelect, flexShrink: 0, width: 90 }} value={uom2}
                                    onChange={e => { setUom2(e.target.value); setUom2Factor(null); setUom2LengthUom(''); }}>
                                    <option value="">— none —</option>
                                    {(uoms || []).map((u: any) => <option key={u.id} value={u.name}>{u.name}</option>)}
                                </select>
                            </div>
                            {uom2 && (selectedUom2?.factors || []).length > 0 && (
                                <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                    {(selectedUom2?.factors || []).map((f: any) => {
                                        const fVal = parseFloat(f.value);
                                        const toUom = f.to_uom_name || 'Yard';
                                        const active = uom2Factor === fVal;
                                        return (
                                            <button key={f.id} type="button"
                                                style={{
                                                    fontFamily: xpFont, fontSize: 10, padding: '1px 6px', cursor: 'pointer',
                                                    borderRadius: 0,
                                                    border: active ? '1px solid #1a3a8a' : '1px solid #7f9db9',
                                                    background: active ? 'linear-gradient(to bottom,#4a9ae8,#1a5ec8)' : 'linear-gradient(to bottom,#fff,#e8e4d8)',
                                                    color: active ? '#fff' : '#000',
                                                }}
                                                onClick={() => onFactorPick(fVal, toUom)}
                                            >
                                                1 {uom2} = {fVal} {toUom}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            {uom2 && (selectedUom2?.factors || []).length === 0 && (
                                <div style={{ ...hintText, marginTop: 3 }}>
                                    {uom2} has no conversion on the UOM master — add one there to convert it.
                                </div>
                            )}
                        </div>
                        <div>
                            <FieldLabel classic={CLASSIC}>{uom2 || 'Alt'} per carton</FieldLabel>
                            <input type="number" min={0} disabled={!uom2}
                                style={{ ...xpInput, width: '100%', textAlign: 'right', background: uom2 ? undefined : '#efeee9' }}
                                value={altPerCarton} onChange={e => onAltPerCartonChange(e.target.value)} />
                        </div>
                    </div>
                    {/* The measured weight of the goods being packed. Sits under the alt
                        unit because it is the other half of the same conversion: the unit
                        says how many yards a piece is, this says what a yard weighs. */}
                    <div style={{ ...fieldGrid, gridTemplateColumns: 'minmax(220px, 1fr) 130px', marginTop: 8 }}>
                        <div>
                            <FieldLabel
                                classic={CLASSIC}
                                title={useSample
                                    ? 'Measured off the sampled goods — every kg figure on this order converts through it, not through the estimate on the item'
                                    : 'Prefilled from the item as a sampling estimate. Replace it with the figure the operator measured off the actual goods.'}
                            >Sampled weight</FieldLabel>
                            <div style={{ display: 'flex' }}>
                                <input type="number" min={0} step="any"
                                    style={{ ...xpInput, flex: 1, minWidth: 0, borderRight: 'none', textAlign: 'right' }}
                                    placeholder="0" value={sampleWeight}
                                    onChange={e => { sampleTouched.current = true; setSampleWeight(e.target.value); }} />
                                <select style={{ ...xpSelect, flexShrink: 0, width: 90 }} value={sampleWeightUnit}
                                    onChange={e => { sampleTouched.current = true; setSampleWeightUnit(e.target.value); }}>
                                    <option value="">— none —</option>
                                    <option value="g/y">g/y</option>
                                    <option value="g/m">g/m</option>
                                </select>
                            </div>
                        </div>
                        <div style={{ alignSelf: 'end' }}>
                            {/* What the item master says, so the operator can see what
                                they are correcting and by how much. */}
                            {Number(selectedItem?.weight_per_unit) > 0 && (
                                <div style={hintText}>
                                    Item: {Number(selectedItem.weight_per_unit)} {selectedItem.weight_unit || ''}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Cut-to-weight vs cut-to-length. The customer's order is the same
                        either way (1 Pcs = 5 Yd); this says whether the floor will measure
                        that out per box or weigh to it, which decides which figure the pack
                        screen asks for and which one it derives. */}
                    {uom2 && (
                        <div style={{ marginTop: 8 }}>
                            <FieldLabel
                                classic={CLASSIC}
                                title="Whether the floor measures the goods out per box or weighs to it — it decides which figure the pack screen asks for and which one it derives"
                            >Pack basis</FieldLabel>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {([
                                    ['COUNTED', `Count ${uom2}`, `The packer counts ${uom2} into each ${(packageLabel || 'carton').toLowerCase()} and weighs it`],
                                    ['WEIGHED', 'Weigh only', `The packer weighs each ${(packageLabel || 'carton').toLowerCase()}; the ${uom2} count is derived from the sampled weight`],
                                ] as const).map(([val, label, hint]) => {
                                    const active = packBasis === val;
                                    return (
                                        <button key={val} type="button" title={hint}
                                            style={{
                                                fontFamily: xpFont, fontSize: 10, padding: '2px 8px', cursor: 'pointer',
                                                borderRadius: 0,
                                                border: active ? '1px solid #1a3a8a' : '1px solid #7f9db9',
                                                background: active ? 'linear-gradient(to bottom,#4a9ae8,#1a5ec8)' : 'linear-gradient(to bottom,#fff,#e8e4d8)',
                                                color: active ? '#fff' : '#000',
                                            }}
                                            onClick={() => setPackBasis(val)}
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {uom2 && uom2Factor && !altBaseFactor && (
                        <div style={{ ...hintText, color: '#a00000', fontStyle: 'normal' }}>
                            {uom2} can&apos;t be converted into {selectedItem?.uom || 'the stock unit'}: a kg-stocked item
                            needs a g/y or g/m weight — enter the sampled one above, or set one on the item
                            (gsm needs the fabric width). Type the target in{' '}
                            {selectedItem?.uom || 'the stock unit'} instead.
                        </div>
                    )}
                    {/* The one caption of this section that is figures rather than prose:
                        the chain every kg on the order is derived through, and the order's
                        own totals in it. The estimate-vs-scale caveat rides in the tooltip
                        — it is read once, the numbers are read every time. */}
                    {altBaseFactor && (
                        <div
                            style={hintText}
                            title={num(qty2) > 0
                                ? `${num(qtyTarget).toLocaleString()} ${selectedItem?.uom || ''} is the estimate — the real weight is taken from the scale at pack time`
                                : undefined}
                        >
                            1 {uom2} = {uom2Factor} {uom2LengthUom || 'Yard'} = {altBaseFactor} {selectedItem?.uom || ''}
                            {num(qty2) > 0
                                ? ` — ${num(qty2).toLocaleString()} ${uom2} ≈ ${num(qtyTarget).toLocaleString()} ${selectedItem?.uom || ''}`
                                : ''}
                        </div>
                    )}
                </FormSection>

                <FormSection title={<SectionTitle icon="bi-geo-alt"><span title="The variant is not asked for here — the packer picks the source lots at pack time, and each lot's own stock row states its variant">Locations &amp; Machine</span></SectionTitle>} classic={CLASSIC}>
                    <div style={{ ...fieldGrid, gridTemplateColumns: '1fr 1fr 1fr' }}>
                        <div>
                            <FieldLabel classic={CLASSIC} title="Bulk finished goods are drawn from here">Pack from</FieldLabel>
                            <TreeSelect options={locPickerTreeOptions} value={sourceLoc} onChange={setSourceLoc} allowEmpty emptyLabel="— select —" size="sm" style={{ width: '100%' }} />
                        </div>
                        <div>
                            <FieldLabel classic={CLASSIC} title="Sealed cartons land here">Store cartons at</FieldLabel>
                            <TreeSelect options={locPickerTreeOptions} value={outputLoc} onChange={setOutputLoc} allowEmpty emptyLabel="— select —" size="sm" style={{ width: '100%' }} />
                        </div>
                        <div>
                            <FieldLabel classic={CLASSIC} title="Pre-fills every pack event">Machine</FieldLabel>
                            <SearchableSelect options={machineOptions || []} value={workCenterId} onChange={setWorkCenterId} placeholder="— none —" size="sm" />
                        </div>
                    </div>
                </FormSection>

                <FormSection title={<SectionTitle icon="bi-sticky">Notes</SectionTitle>} classic={CLASSIC}>
                    <textarea style={{ ...xpInput, height: 50, width: '100%', resize: 'vertical', boxSizing: 'border-box' }} value={notes} onChange={e => setNotes(e.target.value)} />
                </FormSection>
            </div>
        </ModalWrapper>
    );
}

// ── pack logging ─────────────────────────────────────────────────────────────
// Deliberately shaped like WOCompletionModal: same header progress panel, same
// "Lots to Consume" checkbox list with FIFO take-chips, same legend-panel
// groupboxes and Previous-Entries table. Packing is the same motion as logging
// WO output for the operator, so it reads the same. Keep the two in step — a
// change to one of these patterns belongs in both.
//
// The one deliberate divergence is the qty entry: a WO completion states a
// single number, but a pack event is a LIST of physical boxes, so the carton
// list is the entry and the totals are read off it.
function PackingOrderDetail({ po: initialPo, itemById, locationById, locPickerTreeOptions, machineOptions, authFetch, showToast, onClose, onChanged, onPrintCard, onPrintLabels }: any) {
    const { hasPermission } = useUser();
    const { formatDateTime: tzDateTime } = useTimezone();
    const canManage = hasPermission('sales.manage');
    const [po, setPo] = useState<any>(initialPo);
    const closed = po.status === 'COMPLETED' || po.status === 'CANCELLED';
    const readOnly = closed || !canManage;

    const it = itemById[String(po.item_id)];
    const uom = po.item_uom || it?.uom || '';
    const target = num(po.qty_target);
    const packed = num(po.qty_packed);
    const remaining = Math.max(0, target - packed);

    // There is deliberately no "Qty to Pack" field: the carton list below IS the
    // statement of what was packed, and a second figure the packer had to keep
    // equal to it was only ever a way to get them out of step. Everything that
    // used to read `qty` now reads the list's own total.
    //
    // Alt selling unit of this order (Pic = a roll, Pcs = a cut piece). When set,
    // the packer counts in it and every base figure is derived from it — the box
    // qtys and the label's CONTENT line all follow the same factor.
    const prog = useMemo(() => packProgress(po, it), [po, it]);
    const altUom = prog.altUom;
    const altFactor = prog.altFactor;
    const altLength = useMemo(
        () => lengthPerAlt({ factor: po.uom2_factor, lengthUom: po.uom2_length_uom }),
        [po.uom2_factor, po.uom2_length_uom],
    );
    const hasAlt = prog.hasAlt;
    // Cut-to-weight goods: nobody measures 5 yards off a roll for every box, they
    // weigh it. So the packer types kilos and the piece count is that reading run
    // through this order's sampled g/y as the box is logged. It is still a STATED
    // per-carton figure — `qty_packed_alt` sums what each carton says, and never
    // divides the order's kilos back out (see the model's docstring): converting
    // once, at the box, against the sample in force then is what keeps a later
    // re-sample from restating cartons that are already packed and shipped.
    const weighBasis = hasAlt && String(po.pack_basis || '').toUpperCase() === 'WEIGHED';
    // Whole pieces: a piece is a cut length, and a label reading 50.8 Pcs is not
    // something a customer can be handed. The drift that rounding leaves shows up
    // in the totals strip, against the kilos, which are the measured figure.
    const altFromBase = (kg: number) =>
        (altFactor && altFactor > 0 && kg > 0 ? Math.round(kg / altFactor) : 0);

    // The same three figures in what the customer counts in — DISPLAY ONLY. The
    // packer thinks in pieces ("2880 Pcs ordered, 1200 boxed"), so on an alt-unit
    // order these lead and the base figures follow in brackets. `target`/`packed`/
    // `remaining` above stay in the stock UOM and must: they seed the carton split,
    // gate the submit, and are what every stock move posts in. Two names for two
    // jobs, never one field doing both.
    //
    // Both are COUNTED figures, not converted ones. Target is the count stated on
    // the order; packed is `qty_packed_alt`, summed server-side from each carton's
    // own stated count (see api/packing._packed_alt_qty). Neither divides kilos by
    // the g/y factor: that factor is a planning estimate, an elastic cloth does not
    // weigh what it predicted, and the packer reweighs every box — so the kilos are
    // scale readings that drift with the fabric. Dividing them back out reports a
    // piece count nobody counted and leaves a physically complete order short.
    const targetAlt = prog.targetAlt;
    const packedAlt = prog.packedAlt;
    const remainingAlt = prog.remainingAlt;

    // Progress basis lives in packProgress — the list row's bars read the same
    // helper, so this panel and that row can't disagree. The panel draws
    // `pctAlt` and `pctBase` as two bars; `prog.pct` (the DELIVERED basis) is
    // deliberately not one of them, since it is whichever of the two is
    // load-bearing and drawing it a third time would say nothing new.

    // Box size, in whatever unit the order is COUNTED in — pieces on an alt-unit
    // order, the stock UOM otherwise. A carton holds a whole number of pieces and
    // `pack_size` is only what they weigh in theory, so splitting by the kilos left
    // a 0.5 kg thirteenth box on a 130 kg draw and labels reading 11.8 Pcs. The
    // order's own stated count is preferred; `pack_size` is divided back only for a
    // pre-feature order that has no count stored.
    //
    // Read off the ORDER, never typed here: the pack modal has no box-size field.
    // It was a shortcut for filling the carton lines, and those lines are directly
    // editable — count, qty each and box are all on the row — so a second control
    // that silently re-splits them was one more thing to keep in step.
    const boxSize: string = useMemo(() => {
        // On a weighed order the split is by kilos — that is the number the packer
        // sets the scale to, and splitting by pieces would hand them a box target
        // they cannot weigh out.
        if (weighBasis) return num(po.pack_size) > 0 ? String(num(po.pack_size)) : '';
        const alt = hasAlt ? orderBoxSizeAlt(po, altFactor) : null;
        if (alt) return String(alt);
        return !hasAlt && num(po.pack_size) > 0 ? String(num(po.pack_size)) : '';
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [po.pack_size, po.pack_size_alt, weighBasis, hasAlt, altFactor]);
    // Loose scrap found during this pack event — offcuts, stained ends, material
    // that came out of the source bin and never made it into a box. It has to be
    // stated because it physically LEFT the bin: omitting it would leave the
    // shelf lighter than the system by exactly this much. It never becomes a
    // carton, so it is entered here rather than as a flag on a carton line.
    const [scrapQty, setScrapQty] = useState<string>('');
    const [scrapReason, setScrapReason] = useState<string>('');
    const [operator, setOperator] = useState('');
    // Seeded from the order's machine so the common case is one click of nothing;
    // an override here rides on this event only and never rewrites the order.
    const [workCenterId, setWorkCenterId] = useState<string>(String(initialPo.work_center_id || ''));
    const [packNotes, setPackNotes] = useState('');
    const [lots, setLots] = useState<any[]>([]);
    const [heldLotCount, setHeldLotCount] = useState(0);
    const [lotsLoading, setLotsLoading] = useState(false);
    const [selectedLots, setSelectedLots] = useState<string[]>([]);
    const [logging, setLogging] = useState(false);

    // QC reject of an already-logged pack event. Same split as a WO completion
    // reject: whole event by default, or name cartons for a partial. The rejected
    // qty leaves qty_packed and the cartons move to the defect store.
    const [rejectComp, setRejectComp] = useState<any>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [rejectUsable, setRejectUsable] = useState(false);
    const [rejectUnitIds, setRejectUnitIds] = useState<string[]>([]);
    const [rejecting, setRejecting] = useState(false);

    const useLotPicker = !!it?.lot_tracked;
    const outputLocName = locationById?.[String(po.output_location_id)]?.name || null;
    const sourceLocName = locationById?.[String(po.source_location_id)]?.name || null;

    // Locations are editable here, not just on the create form: /complete hard-
    // requires both, and an order created without them (a Quarantine Packing
    // suggestion names only a source) is otherwise dead — no other edit path exists.
    const [srcDraft, setSrcDraft] = useState<string>(String(po.source_location_id || ''));
    const [outDraft, setOutDraft] = useState<string>(String(po.output_location_id || ''));
    const [savingLocs, setSavingLocs] = useState(false);
    // Re-sampling: the operator measures the actual goods again and the order's
    // kg figures follow. Drafted like the locations — typed here, saved through
    // `PUT /packing/{id}`, which restates the kg target and the box-size estimate.
    // Nothing already packed moves: a carton's weight is a scale reading and its
    // count is what the packer counted.
    const [sampleDraft, setSampleDraft] = useState<string>(
        po.sample_weight_per_unit != null ? String(po.sample_weight_per_unit) : '');
    const [sampleUnitDraft, setSampleUnitDraft] = useState<string>(po.sample_weight_unit || '');
    const [savingSample, setSavingSample] = useState(false);
    const locsDirty = srcDraft !== String(po.source_location_id || '') || outDraft !== String(po.output_location_id || '');
    const locsMissing = !po.source_location_id || !po.output_location_id;

    // Persist the picked machine onto the order itself. The log picker alone only
    // stamps the event, which is right for a one-off swap; an order that will keep
    // running on this machine wants it stored so every later event pre-fills.
    const [savingMachine, setSavingMachine] = useState(false);
    const machineDirty = String(workCenterId || '') !== String(po.work_center_id || '');
    const saveMachine = async () => {
        setSavingMachine(true);
        try {
            const res = await authFetch(`${API_BASE}/packing/${po.id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ work_center_id: workCenterId || null }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Could not save the machine');
            }
            setPo(await res.json());
            showToast('Machine assigned to this packing order', 'success');
            await onChanged();
        } catch (e: any) {
            showToast(e.message, 'danger');
        } finally { setSavingMachine(false); }
    };

    const sampleSaved = po.sample_weight_per_unit != null ? String(po.sample_weight_per_unit) : '';
    const sampleDirty = sampleDraft !== sampleSaved || sampleUnitDraft !== (po.sample_weight_unit || '');

    const saveSample = async () => {
        // Both halves or neither — a figure with no unit converts nothing, and
        // clearing the figure hands the conversion back to the item's estimate.
        const value = num(sampleDraft);
        if (value > 0 && !sampleUnitDraft) { showToast('Pick g/y or g/m for the sampled weight', 'danger'); return; }
        setSavingSample(true);
        try {
            const res = await authFetch(`${API_BASE}/packing/${po.id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sample_weight_per_unit: value > 0 ? value : null,
                    sample_weight_unit: value > 0 ? sampleUnitDraft : null,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Could not save the sampled weight');
            }
            const fresh = await res.json();
            setPo(fresh);
            setSampleDraft(fresh.sample_weight_per_unit != null ? String(fresh.sample_weight_per_unit) : '');
            setSampleUnitDraft(fresh.sample_weight_unit || '');
            showToast(
                value > 0
                    ? `Sampled weight set to ${value} ${sampleUnitDraft} — target and box size restated`
                    : 'Sampled weight cleared — back to the item’s estimate',
                'success',
            );
            await onChanged();
        } catch (e: any) {
            showToast(e.message, 'danger');
        } finally { setSavingSample(false); }
    };

    const saveLocations = async () => {
        if (!srcDraft || !outDraft) { showToast('Both locations are required', 'danger'); return; }
        setSavingLocs(true);
        try {
            const res = await authFetch(`${API_BASE}/packing/${po.id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_location_id: srcDraft, output_location_id: outDraft }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Could not save locations');
            }
            setPo(await res.json());
            showToast('Locations updated', 'success');
            await onChanged();
        } catch (e: any) {
            showToast(e.message, 'danger');
        } finally { setSavingLocs(false); }
    };

    // The packer picks lots exactly as a stager picks material for a WO: the lot
    // pins the StockBalance row being drawn, which is what makes the order's
    // variant redundant — the server reads the variant back off that row.
    // Scoping the fetch to the order's source location makes /batches drop lots
    // with no stock there, so only packable lots are ever offered.
    useEffect(() => {
        if (!useLotPicker || !po.source_location_id) { setLots([]); return; }
        let alive = true;
        setLotsLoading(true);
        (async () => {
            try {
                // `variant_key` scopes the fetch to the shade this order is packing.
                // Two MOs of the same FG in different colours share a hold bin, so
                // the unscoped (item, location) fetch offered the other colour's lots
                // as if they were packable — and the pack endpoint refuses them. The
                // match rule lives on the server (stock_service.variant_matches) so
                // the picker and the gate can't drift; an order with no variant of
                // its own (packing to stock) still sees the whole pool.
                const vq = po.variant_key ? `&variant_key=${encodeURIComponent(po.variant_key)}` : '';
                const res = await authFetch(
                    `${API_BASE}/batches?item_id=${po.item_id}&location_id=${po.source_location_id}${vq}&limit=200&with_source_lots=true`
                );
                const list = res.ok ? (await res.json() || []) : [];
                if (!alive) return;
                const withStock = (list || []).filter((b: any) => (b.remaining ?? 0) > 0 && b.quality_status !== 'REJECTED');
                // Held lots are excluded here rather than merely flagged — the server
                // hard-blocks packing them anyway (assert_lots_released), so offering
                // them as selectable would just be a checkbox that always 400s on submit.
                setHeldLotCount(withStock.filter((b: any) => b.held).length);
                const available = withStock.filter((b: any) => !b.held);
                setLots(available);
                // Default to the ready pool, but only as far as ONE size. The draw is
                // FIFO (oldest first) and the server refuses a box that straddles two
                // sizes, so pre-selecting an M lot and an L lot together hands the
                // packer a selection their first submit 400s on — over a seam they
                // never chose to cross. Unsized lots are unknown, not a different
                // size, so they ride along; an unsized oldest lot keeps the old
                // select-everything behaviour.
                const oldest = available[available.length - 1];  // /batches is newest-first
                const leadSize = oldest ? lotSizeKey(oldest) : null;
                const preselect = leadSize
                    ? available.filter((b: any) => {
                        const k = lotSizeKey(b);
                        return k === null || k === leadSize;
                    })
                    : available;
                setSelectedLots(preselect.map((b: any) => String(b.id)));
            } finally {
                if (alive) setLotsLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [po.item_id, po.source_location_id, po.variant_key, useLotPicker, authFetch, po.qty_packed]);

    const selSet = new Set(selectedLots);
    const selAvailable = lots.filter((b: any) => selSet.has(String(b.id)))
        .reduce((s: number, b: any) => s + (b.remaining ?? 0), 0);

    // Distinct sizes among the checked lots. More than one is allowed — packing
    // an M box and an L box on one log is a real thing — but the packer has to
    // cut their box list at the seam, so it is called out rather than left to a
    // 400 at submit. Keyed like the server (`lotSizeKey`), labelled for the eye.
    const selectedSizes: string[] = useMemo(() => {
        const byKey = new Map<string, string>();
        lots.filter((b: any) => selSet.has(String(b.id))).forEach((b: any) => {
            const k = lotSizeKey(b);
            if (k) byKey.set(k, lotSizeLabel(b) || 'unnamed size');
        });
        return Array.from(byKey.values());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lots, selectedLots]);

    // Spread a draw FIFO across the checked lots — oldest first, each capped at
    // what is left of it. /batches returns newest-first, hence reverse. Same rule
    // as WOCompletionModal's multi-lot consume.
    //
    // Cartons claim first and scrap takes what remains, which is why this is
    // called twice against a shared `taken` ledger rather than once over a
    // combined figure: the two halves land in different columns on the completion
    // (`qty` vs `qty_rejected`) and in different bins in stock, so every lot has
    // to know how much of its draw is which. Whatever neither claims stays on the
    // lot for the next event.
    const allocateOver = (need: number, taken: Record<string, number>): { batch_id: string; qty: number }[] => {
        if (need <= 0 || !selectedLots.length) return [];
        const out: { batch_id: string; qty: number }[] = [];
        for (const b of lots.filter((x: any) => selSet.has(String(x.id))).slice().reverse()) {
            if (need <= 1e-9) break;
            const id = String(b.id);
            const free = (b.remaining ?? 0) - (taken[id] || 0);
            const take = Math.min(need, free);
            if (take <= 0) continue;
            out.push({ batch_id: id, qty: Number(take.toFixed(4)) });
            taken[id] = (taken[id] || 0) + take;
            need -= take;
        }
        return out;
    };

    // Boxes are edited against the combined total regardless of how many lots feed
    // it — the server is the one that works out which lot backs each box (splitting
    // a box across a lot boundary if needed), so the packer never has to think
    // about lot lines while boxing up.
    //
    // They are edited as `count × qty each` groups, not one row per box: 17 kg in
    // 5 kg boxes reads "3 × 5 kg, 1 × 2 kg = 17 kg" instead of a four-row list the
    // packer has to add up. `expandBoxGroups` flattens back to one entry per
    // physical carton for everything downstream, so the payload is unchanged.
    // `kg` stays per carton inside a group — it is the packer's scale reading and
    // the label's N.W. line, never derived from qty (the item's UOM may be yards,
    // and the same yardage weighs differently per lot).
    const [boxGroups, setBoxGroups] = useState<BoxGroup[]>([]);
    const [openGroups, setOpenGroups] = useState<Set<number>>(new Set());
    // The box master. Its tare is what turns each carton's net reading into the
    // brutto printed on the label and totalled on the delivery note.
    const { packagingTypes } = usePackagingTypes();
    const boxRows = useMemo(() => expandBoxGroups(boxGroups), [boxGroups]);

    // Seeded from what the order still owes rather than from a typed qty — the
    // packer opens onto a plausible list and edits it down to what they actually
    // boxed. Runs on a fresh form and again after each log (a successful log
    // clears the groups and `remaining` drops), never over the packer's edits.
    // `boxSize` is in the counting unit, so it goes in as the alt size on an
    // alt-unit order and as the base size otherwise — one field, never both.
    const seedFrom = (total: number, prev: BoxGroup[] = []) => {
        // Weighed: split the kilos, then state each box's count off its own weight.
        // The alt-unit split (whole pieces, remainder in the last box) is the wrong
        // shape here — the boxes are equal on the scale, not equal in pieces.
        if (weighBasis) {
            return seedBoxGroups(total, num(boxSize), prev, null, null)
                .map(g => ({ ...g, alt: num(g.qty) > 0 ? String(altFromBase(num(g.qty))) : '' }));
        }
        return seedBoxGroups(
            total,
            hasAlt ? 0 : num(boxSize),
            prev,
            hasAlt ? altFactor : null,
            hasAlt ? num(boxSize) : null,
        );
    };

    useEffect(() => {
        if (boxGroups.length === 0 && remaining > 0) {
            setBoxGroups(seedFrom(remaining));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [remaining]);

    const updateGroup = (i: number, patch: Partial<BoxGroup>) =>
        setBoxGroups(prev => prev.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
    const removeGroup = (i: number) => setBoxGroups(prev => prev.filter((_, idx) => idx !== i));
    const addGroup = () => setBoxGroups(prev => [...prev, emptyBoxGroup()]);
    const toggleGroup = (i: number) => setOpenGroups(prev => {
        const next = new Set(prev);
        next.has(i) ? next.delete(i) : next.add(i);
        return next;
    });
    // One carton's scale reading inside a group. Sparse by design — a group of 3
    // with only #2 weighed keeps ['', '4.95'] rather than inventing the other two.
    const setGroupWeight = (i: number, box: number, val: string) =>
        setBoxGroups(prev => prev.map((g, idx) => {
            if (idx !== i) return g;
            const kg = [...g.kg];
            while (kg.length <= box) kg.push('');
            kg[box] = val;
            return { ...g, kg };
        }));

    // Picking a standard box drops any tare typed while a custom one was selected:
    // the master's figure is what the server will use, so leaving the stale number
    // visible would promise a brutto nobody is going to print.
    const setGroupPackaging = (i: number, val: string) =>
        updateGroup(i, {
            packagingTypeId: val,
            ...(isCustomType(val, packagingTypes) ? {} : { tare: '' }),
        });

    // Typing a count fills the base qty; typing a base qty only back-fills a count
    // that isn't there yet. That asymmetry is the point: on a kg item the packer
    // types 12 Pcs, the qty pre-fills at the theoretical 10.80, and then the scale
    // reading of 10.62 replaces it — which must not turn the count into 11.8.
    const setGroupAlt = (i: number, val: string) => {
        // Weighed: the count is a derived figure the packer may correct (they did
        // count this one), and correcting it must not rewrite the scale reading it
        // came from — the kilos are what stock moves in.
        if (weighBasis) { updateGroup(i, { alt: val }); return; }
        const derived = altToBase(num(val), altFactor);
        updateGroup(i, {
            alt: val,
            ...(derived !== null && num(val) > 0 ? { qty: String(derived) } : {}),
        });
    };
    const setGroupQty = (i: number, val: string) => {
        const g = boxGroups[i];
        // Weighed: every weight edit restates the count, overwriting a manual
        // correction — the correction was made against the old reading, and
        // leaving it standing beside a new one states a pair that never existed.
        if (weighBasis) {
            updateGroup(i, { qty: val, alt: num(val) > 0 ? String(altFromBase(num(val))) : '' });
            return;
        }
        const backfill = hasAlt && !(num(g?.alt) > 0) ? baseToAlt(num(val), altFactor) : null;
        updateGroup(i, {
            qty: val,
            ...(backfill !== null ? { alt: String(backfill) } : {}),
        });
    };

    // Weights stay positional against the qtys the server receives, so both are
    // filtered in one pass. Every carton must carry one: the log is written after
    // the boxes are packed and weighed, so a blank would print a label with no
    // N.W. line — the server rejects an unweighed carton outright.
    const boxes = filledBoxRows(boxRows);
    const boxValues = boxes.map(b => num(b.qty));
    // A kg item is weighed once: the qty in the carton IS its net weight, so the
    // row shows a single input and the weight rides along from it (the server
    // derives the same way). Any other UOM is a count or a length, so its weight
    // is a separate scale reading and stays required.
    const qtyIsWeight = uomIsKg(uom);
    const boxWeights = qtyIsWeight ? boxValues : boxes.map(b => num(b.kg));
    // Positional against `boxes`; null where the packer stated no count, which the
    // server then derives for that carton alone.
    const boxAlts = hasAlt ? boxAltPayload(boxRows) : null;
    const altTotal = hasAlt ? boxAltTotal(boxRows) : 0;
    const weightsMissing = !qtyIsWeight && hasUnweighedBox(boxRows);
    // Packaging is positional against `boxes` exactly like the weights. Tare only
    // travels for a custom box; every other type takes the master's figure
    // server-side, so a stale value from a re-picked row can't ride along.
    const boxPackaging = boxPackagingPayload(boxRows);
    const boxTares = boxTarePayload(boxRows, packagingTypes);
    const packagingMissing = hasUnboxedBox(boxRows);
    const taresMissing = hasUnweighedTare(boxRows, packagingTypes);
    const boxTotal = boxValues.reduce((s, v) => s + v, 0);
    const weightTotal = boxWeights.reduce((s: number, v) => s + v, 0);
    // Brutto preview: net + the tare each carton will actually be given. Mirrors
    // `packing_service.gross_weight`, so the footer and the printed label agree.
    const tareTotal = boxes.reduce((s, b) => s + effectiveTare(b, packagingTypes), 0);
    const grossTotal = weightTotal + tareTotal;
    // What the packer says was boxed. There is nothing left for it to disagree
    // with, so the old "boxes don't match qty to pack" block is gone along with
    // the field that caused it.
    const packTotal = boxTotal;
    const scrap = num(scrapQty);
    // Everything that leaves the source bin: cartons plus scrap. This is what the
    // selected lots have to cover, and what the server checks stock against.
    const drawTotal = packTotal + scrap;

    // Cartons claim their lots first, then scrap takes from what is left of the
    // same lots — see `allocateOver`.
    const takeByBatch: Record<string, number> = {};
    const alloc = allocateOver(packTotal, takeByBatch);
    const scrapAlloc = allocateOver(scrap, takeByBatch);
    const drawn = Object.values(takeByBatch).reduce((t, v) => t + v, 0);
    const short = drawTotal > 0 && drawn + 1e-6 < drawTotal;
    // Per-lot payload: one entry per lot touched, carrying its share of each.
    const lotPayload = () => {
        const byId = new Map<string, { batch_id: string; qty: number; qty_rejected: number }>();
        for (const l of alloc) byId.set(l.batch_id, { batch_id: l.batch_id, qty: l.qty, qty_rejected: 0 });
        for (const l of scrapAlloc) {
            const row = byId.get(l.batch_id);
            if (row) row.qty_rejected = l.qty;
            else byId.set(l.batch_id, { batch_id: l.batch_id, qty: 0, qty_rejected: l.qty });
        }
        return [...byId.values()];
    };

    const toggleLot = (id: string, on: boolean) =>
        setSelectedLots(prev => on ? [...prev, id] : prev.filter(x => x !== id));
    const allIds = lots.map((b: any) => String(b.id));
    const allSelected = allIds.length > 0 && selectedLots.length === allIds.length;

    // Why the log button is dead, in the order the submit handler checks. A
    // disabled button with no stated reason is the bug this exists to prevent —
    // the box-list footer alone was too far from the button to read as its cause.
    const logBlockedBy =
        locsMissing ? 'Set both locations on this order before packing'
        : locsDirty ? 'Save the location change before logging'
        // An unsaved basis would box by one conversion and log against another.
        : sampleDirty ? 'Save the sampled weight change before logging'
        // A scrap-only log is legitimate — a whole draw can fail QC and it still
        // has to leave the bin — so an empty carton list only blocks when there
        // is no scrap either. What is refused is a log that moves nothing.
        : drawTotal <= 0 ? `Add at least one ${po.package_label.toLowerCase()}, or state what was rejected`
        : weightsMissing ? `Weigh every ${po.package_label.toLowerCase()} — the label prints its net weight`
        : packagingMissing ? `Pick the packaging for every ${po.package_label.toLowerCase()} — its tare makes up the brutto`
        : taresMissing ? `Weigh the empty box on every custom ${po.package_label.toLowerCase()} line`
        : useLotPicker && !selectedLots.length ? 'Select at least one lot to pack from'
        : useLotPicker && short ? `Selected lots hold only ${drawn.toFixed(2)} of the ${drawTotal.toFixed(2)} needed`
        : null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (locsMissing) { showToast('Set both locations on this order before packing', 'danger'); return; }
        if (locsDirty) { showToast('Save the location change before logging', 'danger'); return; }
        if (sampleDirty) { showToast('Save the sampled weight change before logging', 'danger'); return; }
        if (drawTotal <= 0) {
            showToast(`Add at least one ${po.package_label.toLowerCase()}, or state what was rejected`, 'danger');
            return;
        }
        if (weightsMissing) {
            showToast(`Weigh every ${po.package_label.toLowerCase()} — the label prints its net weight`, 'danger');
            return;
        }
        if (packagingMissing) {
            showToast(`Pick the packaging for every ${po.package_label.toLowerCase()} — its tare makes up the brutto`, 'danger');
            return;
        }
        if (taresMissing) {
            showToast(`Weigh the empty box on every custom ${po.package_label.toLowerCase()} line`, 'danger');
            return;
        }

        const common = {
            boxes: boxValues,
            box_weights: boxWeights,
            box_alt_qtys: boxAlts,
            box_packaging_type_ids: boxPackaging,
            box_tares: boxTares,
            work_center_id: workCenterId || null,
            operator: operator || null,
            notes: packNotes || null,
            reject_reason: scrapReason.trim() || null,
        };
        // `qty` is the good, boxed total — never the draw. Scrap rides in its own
        // field so the server can send it to the defect store and keep it out of
        // qty_packed.
        let body: any = { ...common, qty: packTotal, qty_rejected: scrap };
        if (useLotPicker) {
            if (!selectedLots.length) { showToast('Select at least one lot to pack from', 'danger'); return; }
            if (short) {
                showToast(
                    `Selected lots hold only ${drawn.toFixed(2)} of the ${drawTotal.toFixed(2)} needed — select more lots`,
                    'danger',
                );
                return;
            }
            body = { ...common, lots: lotPayload() };
        }

        setLogging(true);
        try {
            const res = await authFetch(`${API_BASE}/packing/${po.id}/complete`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                const fresh = await res.json();
                setPo(fresh);
                setPackNotes(''); setScrapQty(''); setScrapReason('');
                setBoxGroups([]); setOpenGroups(new Set());
                showToast(
                    `Packed ${packTotal} into ${boxValues.length} ${po.package_label.toLowerCase()}(s)`
                    + (scrap > 0 ? `, rejected ${scrap}` : '')
                    + ` — total ${num(fresh.qty_packed).toFixed(2)} / ${target}`,
                    'success',
                );
                await onChanged();
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || 'Pack failed', 'danger');
            }
        } finally { setLogging(false); }
    };

    const units = po.packed_units || [];
    const completions = po.completions ? [...po.completions].reverse() : [];

    // Good cartons of one pack event — the choices for a partial reject.
    const goodUnitsOf = (compId: string) => units.filter((u: any) =>
        String(u.packing_completion_id || '') === String(compId)
        && u.quality_status !== 'REJECTED' && u.quality_status !== 'REJECT_USABLE' && u.quality_status !== 'DISPOSED');

    // One log's piece count, SUMMED off its own cartons rather than divided out of
    // its kg — the same rule `PackingOrder.qty_packed_alt` follows, so the entry
    // rows add up to the header's alt figure exactly. null when this event's
    // cartons carry no count at all (no alt unit, or an unresolvable conversion),
    // which is the only case the column has nothing to show.
    const altOf = (compId: string): number | null => {
        const counted = goodUnitsOf(compId).filter((u: any) => u.alt_qty != null);
        if (!counted.length) return null;
        return Math.round(counted.reduce((t: number, u: any) => t + num(u.alt_qty), 0) * 100) / 100;
    };

    const openReject = (c: any) => {
        setRejectComp(c);
        setRejectReason('');
        setRejectUsable(false);
        setRejectUnitIds([]);   // empty = whole event
    };

    const submitReject = async () => {
        if (!rejectComp) return;
        setRejecting(true);
        try {
            const res = await authFetch(`${API_BASE}/packing/${po.id}/completions/${rejectComp.id}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reason: rejectReason.trim() || null,
                    packed_unit_ids: rejectUnitIds,
                    usable: rejectUsable,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Reject failed');
            }
            const fresh = await res.json();
            setPo(fresh);
            setRejectComp(null);
            showToast(
                `QC rejected ${rejectUnitIds.length || goodUnitsOf(rejectComp.id).length || rejectComp.package_count} ${po.package_label.toLowerCase()}(s)`,
                'success',
            );
            await onChanged();
        } catch (e: any) {
            showToast(e.message, 'danger');
        } finally { setRejecting(false); }
    };

    // xl, not md: the To Pack grid is eight columns wide (count, qty
    // each, unit, kg each, packaging, tare, line total, remove) and at 480px it
    // scrolled sideways, which put the packaging picker and the tare — both
    // required before the log button unlocks — off the edge of the panel the
    // packer is filling in.
    return (
        <ModalWrapper
            isOpen onClose={onClose}
            title={`Pack ${po.code} — ${po.item_name || it?.name || ''}`}
            size="xl" modeless
            footer={
                <>
                    <button type="button" className={XP_BTN} onClick={onClose} style={xpBtn()}>Close</button>
                    <button type="button" className={XP_BTN} style={xpBtn()} onClick={() => onPrintCard(po)}>Packing Card</button>
                    <button type="button" className={XP_BTN} style={xpBtn()} disabled={!units.length} onClick={() => onPrintLabels(po, units)}>
                        Carton Labels
                    </button>
                    {/* Visible, not a tooltip: a disabled button dispatches no mouse
                        events in Chrome, so a `title` on it would never be read. */}
                    {!readOnly && logBlockedBy && (
                        // The one flexible thing in the footer: it takes the leftover
                        // width and wraps its own text, so the buttons either side keep
                        // their natural size. `minWidth: 0` is what actually lets it
                        // shrink — without it a flex item floors at its longest word.
                        <span style={{
                            fontFamily: xpFont, fontSize: 10, color: '#7a4a00', fontStyle: 'italic',
                            marginLeft: 'auto', paddingRight: 6, flex: '1 1 auto', minWidth: 0,
                            textAlign: 'right',
                        }}>
                            {logBlockedBy}
                        </span>
                    )}
                    {!readOnly && (
                        <button type="submit" form="packing-log-form" className={XP_BTN}
                            disabled={logging || !!logBlockedBy}
                            title={logBlockedBy || undefined}
                            style={{ ...xpBtnGreen(), opacity: logging || logBlockedBy ? 0.6 : 1 }}>
                            {logging ? 'Packing...' : 'Log Packing'}
                        </button>
                    )}
                </>
            }
        >
            <form id="packing-log-form" onSubmit={handleSubmit} style={{ fontFamily: xpFont }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                    {/* Order info + progress */}
                    <div style={{ border: '1px solid #aca899', padding: '8px 10px', background: '#f5f4ee', display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{ fontSize: 11, fontWeight: 'bold', color: '#000080' }}>{po.item_name || po.item_code}</span>
                            <span style={{ fontSize: 10, color: '#555' }}>{po.code}</span>
                        </div>
                        {/* Both bars, pieces over kilos. See PackProgressBars: the boxes
                            are weighed and the piece count is that weight read through this
                            order's sampled unit weight, so the packer is shown both rather
                            than left to divide one out of the other. */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {(hasAlt
                                ? [
                                    { key: 'alt', label: altUom || 'ALT', pct: prog.pctAlt ?? 0, done: (packedAlt ?? 0).toLocaleString(), goal: (targetAlt ?? 0).toLocaleString(), unit: altUom },
                                    { key: 'base', label: uom || 'QTY', pct: prog.pctBase, done: packed.toFixed(2), goal: target.toFixed(2), unit: uom },
                                ]
                                : [{ key: 'base', label: uom || 'QTY', pct: prog.pctBase, done: packed.toFixed(2), goal: target.toFixed(2), unit: uom }]
                            ).map(r => (
                                <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: 9, fontWeight: 'bold', color: '#555', width: 30, flexShrink: 0, textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {r.label}
                                    </span>
                                    <ProgressBar pct={r.pct} tone={r.pct >= 100 ? 'green' : 'blue'} hatched height={14} label="inside" />
                                    <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap', width: 120, flexShrink: 0, textAlign: 'right' }}>
                                        {r.done} / {r.goal} {r.unit}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div style={{ fontSize: 10, color: '#555', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span title={hasAlt
                                ? `1 ${altUom} = ${po.uom2_factor} ${altLength?.uom || 'Yd'} = ${altFactor} ${uom}`
                                : undefined}>
                                Remaining: <strong style={{ color: '#b46a00' }}>
                                    {hasAlt ? `${(remainingAlt ?? 0).toLocaleString()} ${altUom}` : remaining.toFixed(2)}
                                </strong>
                                {hasAlt && <span style={{ color: '#888' }}> ({remaining.toFixed(2)} {uom})</span>}
                            </span>
                            <span>{po.package_label}s: <strong>{po.package_count || 0}</strong></span>
                            {num(po.qty_rejected) > 0 && (
                                <span title="QC-rejected cartons — quarantined in the defect store, not part of packed qty">
                                    QC reject: <strong style={{ color: '#a00000' }}>{num(po.qty_rejected).toFixed(2)}</strong>
                                    {po.package_count_rejected ? ` (${po.package_count_rejected})` : ''}
                                </span>
                            )}
                            <span>{po.sales_order_code ? <>SO: <strong>{po.sales_order_code}</strong></> : 'to stock'}</span>
                            {/* States which figure the floor is typing, because the grid below
                                looks nearly identical either way and the wrong one silently
                                reverses what is derived from what. */}
                            {weighBasis && (
                                <span
                                    style={{ color: '#0058e6' }}
                                    title={`Cut to weight: each ${po.package_label.toLowerCase()} is weighed and its ${altUom} count derived through 1 ${altUom} = ${altFactor} ${uom}`}
                                >
                                    Weigh only
                                </span>
                            )}
                            {po.color_name && <span>Colour: <strong>{po.color_name}</strong></span>}
                            <StatusChip status={po.status} tint />
                        </div>
                    </div>

                    {closed && (
                        <div style={{ background: '#eef7ee', border: '1px solid #2d7a2d', color: '#0a3e0a', padding: '4px 8px', fontSize: 10 }}>
                            This packing order is {po.status} — read-only.
                        </div>
                    )}

                    {readOnly && (outputLocName || sourceLocName) && (
                        <div style={{ background: '#f5f4ee', border: '1px solid #aca899', padding: '4px 8px', fontSize: 10, color: '#555' }}>
                            {sourceLocName && <span>Packed from <strong>{sourceLocName}</strong></span>}
                            {outputLocName && <span style={{ marginLeft: sourceLocName ? 8 : 0 }}>{po.package_label}s stored at <strong>{outputLocName}</strong></span>}
                        </div>
                    )}

                    {/* Entry fields */}
                    {!readOnly && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {/* No "Qty to Pack" field: the list below states the pack, and a
                                second figure to keep equal to it was only ever a way to get
                                out of step with it. No "still to pack" strip either — it
                                restated the header's Remaining line word for word. */}
                            <div>
                                {/* A div, not a label. A <label> forwards a click anywhere in
                                    it to the first labelable element it contains, and <button>
                                    is labelable — so clicking this caption fired the + and
                                    appended a blank carton line. Nothing here labels a control
                                    (the grid below is a table of them), so the element was only
                                    ever borrowing the style. Same fix on the two headers below. */}
                                <div style={{ ...xpFormLabel, fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    {/* One tooltip, not three inline captions: the grid's own
                                        column headers already say count / qty each / unit, so
                                        the prose beside the title was read once and then sat
                                        there taking a line off the box list forever. */}
                                    <span title={[
                                        `Count × qty each — these lines ARE the pack total.`,
                                        hasAlt ? `${altUom} per ${po.package_label.toLowerCase()} sets its ${uom}.` : '',
                                        qtyIsWeight ? `Weighed in ${uom}, so each ${po.package_label.toLowerCase()}'s qty is its net weight.` : '',
                                    ].filter(Boolean).join(' ')}>
                                        To Pack
                                    </span>
                                    <XPActionButton
                                        classic={CLASSIC}
                                        tone="primary"
                                        icon="bi-plus-lg"
                                        title={`Add another ${po.package_label.toLowerCase()} line`}
                                        onClick={addGroup}
                                    />
                                </div>
                                <div style={{ border: '1px solid #7f9db9', background: '#fff', maxHeight: 168, overflowY: 'auto' }}>
                                    {boxGroups.length === 0 && (
                                        <div style={{ fontSize: 10, color: '#888', padding: '4px 5px' }}>
                                            No {po.package_label.toLowerCase()}s listed — add a line with +.
                                        </div>
                                    )}
                                    {boxGroups.length > 0 && (
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 5, padding: '1px 5px',
                                            fontSize: 9, color: '#888', fontVariant: 'all-small-caps', letterSpacing: 0.3,
                                            background: '#f7f6f0', borderBottom: '1px solid #d8d5cc',
                                            position: 'sticky', top: 0, zIndex: 1,
                                        }}>
                                            <span style={{ width: CARTON_COUNT_W, flexShrink: 0, textAlign: 'right' }}>{po.package_label}s</span>
                                            <span style={{ width: 12, flexShrink: 0 }} />
                                            {weighBasis ? (
                                                <>
                                                    <span style={{ flex: 1, minWidth: 0 }}>{uom || 'Qty'} each — weighed</span>
                                                    <span style={{ width: 56 + 24 + 5, flexShrink: 0 }}>{altUom} each (auto)</span>
                                                </>
                                            ) : (
                                                <>
                                                    {hasAlt && <span style={{ width: 56 + 24 + 5, flexShrink: 0 }}>{altUom} each</span>}
                                                    <span style={{ flex: 1, minWidth: 0 }}>{uom || 'Qty'} each</span>
                                                </>
                                            )}
                                            <span style={{ width: PACKAGING_W, flexShrink: 0 }}>Packaging</span>
                                            <span style={{ width: TARE_W, flexShrink: 0, textAlign: 'right' }}>Tare</span>
                                            <span style={{ width: 78, flexShrink: 0, textAlign: 'right' }}>Line total</span>
                                            <span style={{ width: 40, flexShrink: 0 }} />
                                        </div>
                                    )}
                                    {boxGroups.map((g, i) => {
                                        const count = groupCount(g);
                                        const lineTotal = groupTotal(g);
                                        // Cartons before this line, so an expanded row numbers its
                                        // boxes the way the printed labels will be numbered.
                                        const offset = boxGroups.slice(0, i).reduce((s, p) => s + groupCount(p), 0);
                                        const weighed = Array.from({ length: count }, (_, k) => num(g.kg[k]) > 0).filter(Boolean).length;
                                        const open = openGroups.has(i);
                                        // Which of these two the packer types is the whole difference
                                        // between the bases: counted orders state the count and weigh
                                        // the box afterwards, weighed orders state the scale reading
                                        // and the count falls out of it. The typed one gets the wide
                                        // cell, so the eye lands on the field being filled.
                                        const altCell = hasAlt ? (
                                            <React.Fragment key="alt">
                                                <input
                                                    type="number"
                                                    className="xp-nospin"
                                                    style={{
                                                        ...xpInput, width: 56, textAlign: 'right',
                                                        ...(weighBasis ? { color: '#555', background: '#faf9f4' } : {}),
                                                    }}
                                                    value={g.alt}
                                                    onChange={e => setGroupAlt(i, e.target.value)}
                                                    min="0" step="any"
                                                    title={weighBasis
                                                        ? `Derived from the weight through 1 ${altUom} = ${altFactor} ${uom} - overwrite it if this ${po.package_label.toLowerCase()} was counted`
                                                        : `How many ${altUom} go into each ${po.package_label.toLowerCase()} on this line - printed on the label`}
                                                />
                                                <span style={{ fontSize: 9, color: '#888', width: 24, flexShrink: 0 }}>{altUom}</span>
                                            </React.Fragment>
                                        ) : null;
                                        const qtyCell = (
                                            <input
                                                key="qty"
                                                type="number"
                                                className="xp-nospin"
                                                style={{ ...xpInput, flex: 1, minWidth: 0, ...(weighBasis ? { fontWeight: 'bold' } : {}) }}
                                                value={g.qty}
                                                onChange={e => setGroupQty(i, e.target.value)}
                                                min="0" step="any"
                                                title={weighBasis
                                                    ? `What this ${po.package_label.toLowerCase()} weighs on the scale - the ${altUom} count follows from it`
                                                    : `${uom || 'Qty'} in each ${po.package_label.toLowerCase()} on this line`}
                                            />
                                        );
                                        return (
                                            <React.Fragment key={i}>
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: 5, padding: '2px 5px',
                                                    borderBottom: open ? 'none' : '1px solid #eceae2',
                                                }}>
                                                    {/* How many identical cartons this line stands for — the
                                                        multiplier the packer actually counts on the floor. */}
                                                    <input
                                                        type="number"
                                                        className="xp-nospin"
                                                        style={{ ...xpInput, width: CARTON_COUNT_W, textAlign: 'right', flexShrink: 0, fontWeight: 'bold' }}
                                                        value={g.count}
                                                        onChange={e => updateGroup(i, { count: e.target.value })}
                                                        min="0" step="1"
                                                        title={`How many ${po.package_label.toLowerCase()}s of this size`}
                                                    />
                                                    <span style={{ fontSize: 11, color: '#888', width: 12, flexShrink: 0, textAlign: 'center' }}>×</span>
                                                    {/* The count in each box, printed on the carton label. Stored
                                                        rather than divided back out of the order's kilos, which on
                                                        a kg item are scale readings. */}
                                                    {weighBasis
                                                        ? <>{qtyCell}{altCell}</>
                                                        : <>{altCell}{qtyCell}</>}
                                                    {/* Which physical box this line goes into. Group-level: a
                                                        "3 × 5 kg" line is three identical boxes, so the pick is
                                                        made once. Its tare is what turns each carton's net
                                                        reading into the brutto on the label. */}
                                                    <select
                                                        style={{ ...xpInput, width: PACKAGING_W, flexShrink: 0, background: g.packagingTypeId ? '#fff' : '#fffbe6' }}
                                                        value={g.packagingTypeId}
                                                        onChange={e => setGroupPackaging(i, e.target.value)}
                                                        title={`Which ${po.package_label.toLowerCase()} this line is packed in — its tare is added to the net weight`}
                                                    >
                                                        <option value="">Pick box…</option>
                                                        {packagingTypes.map(t => (
                                                            <option key={t.id} value={t.id}>
                                                                {t.name}{!t.is_custom && Number(t.tare_kg) > 0 ? ` (${Number(t.tare_kg)} kg)` : ''}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    {/* One slot, two states: a custom box is weighed here, a
                                                        standard one just shows the master tare being applied.
                                                        Reserved either way so the rows stay aligned. */}
                                                    {isCustomType(g.packagingTypeId, packagingTypes) ? (
                                                        <input
                                                            type="number"
                                                            className="xp-nospin"
                                                            style={{ ...xpInput, width: TARE_W, flexShrink: 0, textAlign: 'right', background: num(g.tare) > 0 ? '#fff' : '#fffbe6' }}
                                                            value={g.tare}
                                                            onChange={e => updateGroup(i, { tare: e.target.value })}
                                                            min="0" step="any"
                                                            placeholder="tare"
                                                            title="Weight of the EMPTY custom box, off the scale"
                                                        />
                                                    ) : (
                                                        <span style={{
                                                            width: TARE_W, flexShrink: 0, textAlign: 'right', fontSize: 9,
                                                            color: '#888', whiteSpace: 'nowrap',
                                                        }}>
                                                            {(() => {
                                                                const t = findPackagingType(g.packagingTypeId, packagingTypes);
                                                                return t && Number(t.tare_kg) > 0 ? `+${Number(t.tare_kg)}` : '';
                                                            })()}
                                                        </span>
                                                    )}
                                                    {/* The addition half: what this line contributes to the pack
                                                        total, so the packer never multiplies in their head. */}
                                                    <span style={{
                                                        width: 78, flexShrink: 0, textAlign: 'right', fontSize: 10,
                                                        fontWeight: 'bold', color: lineTotal > 0 ? '#2e7d32' : '#bbb',
                                                        whiteSpace: 'nowrap',
                                                    }}>
                                                        = {lineTotal.toFixed(2)}
                                                    </span>
                                                    {/* Per-carton scale readings live one level down: cartons of
                                                        the same size still weigh differently, and the label prints
                                                        each box's own N.W. A kg item has no such row — its qty
                                                        already IS that weight. */}
                                                    {!qtyIsWeight ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleGroup(i)}
                                                            style={{
                                                                background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
                                                                fontSize: 9, width: 22, flexShrink: 0, whiteSpace: 'nowrap',
                                                                color: count > 0 && weighed < count ? '#9a6a00' : '#2e7d32',
                                                            }}
                                                            title={count > 0 && weighed < count
                                                                ? `${count - weighed} of ${count} still to weigh`
                                                                : `All ${count} weighed`}
                                                        >
                                                            <i className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`} />
                                                            {count > 0 && weighed < count && <span style={{ marginLeft: 1 }}>{weighed}/{count}</span>}
                                                        </button>
                                                    ) : <span style={{ width: 22, flexShrink: 0 }} />}
                                                    <button
                                                        type="button"
                                                        onClick={() => removeGroup(i)}
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aa0000', fontSize: 13, fontWeight: 'bold', padding: '0 3px', flexShrink: 0 }}
                                                        title="Remove this line"
                                                    >×</button>
                                                </div>
                                                {open && !qtyIsWeight && (
                                                    <div style={{ borderBottom: '1px solid #eceae2', background: '#fbfaf6', padding: '2px 5px 3px 22px' }}>
                                                        {count === 0 && (
                                                            <div style={{ fontSize: 9, color: '#888' }}>
                                                                Set a {po.package_label.toLowerCase()} count to weigh.
                                                            </div>
                                                        )}
                                                        {Array.from({ length: count }, (_, k) => (
                                                            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '1px 0' }}>
                                                                <span style={{ fontSize: 9, color: '#888', width: 30, flexShrink: 0 }}>#{offset + k + 1}</span>
                                                                <span style={{ fontSize: 9, color: '#999', flex: 1, minWidth: 0 }}>
                                                                    {num(g.qty) > 0 ? `${num(g.qty)} ${uom || ''}` : '—'}
                                                                </span>
                                                                <span style={{ fontSize: 9, color: '#888', flexShrink: 0 }}>net wt</span>
                                                                <input
                                                                    type="number"
                                                                    style={{ ...xpInput, width: 62, background: num(g.kg[k]) > 0 ? '#fff' : '#fffbe6' }}
                                                                    value={g.kg[k] || ''}
                                                                    onChange={e => setGroupWeight(i, k, e.target.value)}
                                                                    min="0" step="any"
                                                                    required
                                                                    placeholder="net wt"
                                                                    title="Net weight of this carton off the scale — printed as N.W. on the label"
                                                                />
                                                                <span style={{ fontSize: 9, color: '#888', width: 16, flexShrink: 0 }}>kg</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 6, rowGap: 2, flexWrap: 'wrap', fontSize: 10,
                                    padding: '3px 5px', background: '#f0efe6', border: '1px solid #c0bdb5', borderTop: 'none',
                                }}>
                                    <span style={{
                                        width: 7, height: 7, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
                                        background: weightsMissing || packagingMissing || taresMissing ? '#d9a441' : '#4caf50',
                                    }} />
                                    <span style={{ color: '#555' }}>Boxed:</span>
                                    {/* Same unit order as the target above it — the packer reads
                                        these two against each other, and leading one with pieces
                                        and the other with kilos is the conversion this is meant
                                        to spare them. */}
                                    {/* Whichever figure was MEASURED leads. On a weighed order the
                                        pieces are a conversion of the kilos, and printing them first
                                        would put the derived number where the packer looks to check
                                        the scale. */}
                                    <span style={{ fontWeight: 'bold', color: '#2e7d32' }}>
                                        {hasAlt && !weighBasis
                                            ? `${altTotal.toLocaleString()} ${altUom}`
                                            : `${boxTotal.toFixed(2)} ${uom}`}
                                    </span>
                                    {hasAlt && (
                                        <span style={{ color: '#888' }}>
                                            ({weighBasis
                                                ? `${altTotal.toLocaleString()} ${altUom}`
                                                : `${boxTotal.toFixed(2)} ${uom}`})
                                        </span>
                                    )}
                                    {scrap > 0 && (
                                        <>
                                            <span style={{ color: '#c0bdb5' }}>|</span>
                                            <span style={{ color: '#555' }}>Rejected:</span>
                                            <span style={{ fontWeight: 'bold', color: '#a00000' }}>{scrap.toFixed(2)}</span>
                                            <span style={{ color: '#c0bdb5' }}>|</span>
                                            <span style={{ color: '#555' }}>Drawn:</span>
                                            <span style={{ fontWeight: 'bold' }}>{drawTotal.toFixed(2)}</span>
                                        </>
                                    )}
                                    {/* The basis the two figures either side of it are converted
                                        through. It rides here rather than in a tooltip because
                                        this is the line where a piece count and a weight sit next
                                        to each other and the packer has to trust one against the
                                        other — a wrong factor shows up as a gross weight that
                                        argues with the scale. */}
                                    {hasAlt && (
                                        <>
                                            <span style={{ color: '#c0bdb5' }}>|</span>
                                            <span
                                                style={{ color: '#888' }}
                                                title={po.sample_weight_per_unit != null
                                                    ? 'Sampled off these goods — the middle term is the weight the sample gave'
                                                    : "Not sampled — converting through the item's estimate"}
                                            >
                                                1 {altUom} = {po.uom2_factor} {altLength?.uom || 'Yd'}
                                                {/* The sampled weight itself, not just what it works out
                                                    to: the packer weighs the goods, so the g/y they
                                                    measured is the term they can check this against. */}
                                                {po.sample_weight_per_unit != null
                                                    ? ` × ${po.sample_weight_per_unit} ${po.sample_weight_unit || 'g/y'}`
                                                    : ''}
                                                {' '}= {altFactor} {uom}
                                                {po.sample_weight_per_unit == null ? ' (est.)' : ''}
                                            </span>
                                        </>
                                    )}
                                    {/* No separate "<altUom>: n" segment — Boxed now leads with it. */}
                                    <span style={{ color: '#c0bdb5' }}>|</span>
                                    <span style={{ color: '#555' }}>{po.package_label}s:</span>
                                    <span style={{ fontWeight: 'bold' }}>{boxValues.length}</span>
                                    <span style={{ color: '#c0bdb5' }}>|</span>
                                    <span style={{ color: '#555' }}>Net wt:</span>
                                    <span style={{ fontWeight: 'bold', color: weightsMissing ? '#7a4a00' : undefined }}>
                                        {weightTotal.toFixed(2)} kg
                                    </span>
                                    {/* Brutto — net plus the boxes themselves. Shown beside the net
                                        rather than instead of it: the label prints both, and the
                                        delivery note totals this one. */}
                                    <span style={{ color: '#c0bdb5' }}>|</span>
                                    <span style={{ color: '#555' }}>Gross:</span>
                                    <span style={{ fontWeight: 'bold', color: packagingMissing || taresMissing ? '#7a4a00' : undefined }}>
                                        {grossTotal.toFixed(2)} kg
                                    </span>
                                    {tareTotal > 0 && (
                                        <span style={{ color: '#888' }}>(+{tareTotal.toFixed(2)} tare)</span>
                                    )}
                                    {weightsMissing
                                        ? <span style={{ color: '#7a4a00', marginLeft: 'auto', fontStyle: 'italic' }}>Weigh every {po.package_label.toLowerCase()}</span>
                                        : packagingMissing
                                            ? <span style={{ color: '#7a4a00', marginLeft: 'auto', fontStyle: 'italic' }}>Pick a box on every line</span>
                                            : taresMissing
                                                ? <span style={{ color: '#7a4a00', marginLeft: 'auto', fontStyle: 'italic' }}>Weigh every custom box</span>
                                                : null}
                                </div>
                            </div>

                            {/* Loose scrap. Sits under the carton list because that is the
                                other half of the same draw: the packer states what went into
                                boxes, then what came out of the bin and didn't. */}
                            <div>
                                <label
                                    style={{ ...xpFormLabel, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 6 }}
                                    title={`Offcuts or damage that left ${sourceLocName || 'the pack-from bin'} but never became a ${po.package_label.toLowerCase()} — moved to the defect store, never counted as packed`}
                                >
                                    <span>Rejected — not boxed</span>
                                </label>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <input
                                        type="number"
                                        style={{ ...xpInput, width: 96, textAlign: 'right', background: scrap > 0 ? '#fff4f4' : undefined }}
                                        value={scrapQty}
                                        onChange={e => setScrapQty(e.target.value)}
                                        min="0" step="any"
                                        placeholder="0"
                                        title={`Material drawn from the source that never became a ${po.package_label.toLowerCase()} — moved to the defect store, and never counted as packed`}
                                    />
                                    {uom && <span style={uomChip}>{uom}</span>}
                                    <input
                                        type="text"
                                        style={{ ...xpInput, flex: 1, minWidth: 0 }}
                                        value={scrapReason}
                                        onChange={e => setScrapReason(e.target.value)}
                                        placeholder="Reason (stained, offcuts, wet...)"
                                        disabled={scrap <= 0}
                                    />
                                </div>
                            </div>
                            <div style={{
                                background: locsMissing ? '#fff4e5' : '#eef7ee',
                                border: `1px solid ${locsMissing ? '#d9a441' : '#9cc79c'}`,
                                padding: '5px 8px', fontSize: 10,
                                display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap',
                            }}>
                                <div style={{ flex: 1, minWidth: 150 }}>
                                    <label style={{ ...xpFormLabel, fontSize: 9, color: '#555' }}>Pack from</label>
                                    <TreeSelect options={locPickerTreeOptions} value={srcDraft} onChange={setSrcDraft}
                                        allowEmpty emptyLabel="— select —" size="sm" style={{ width: '100%' }} />
                                </div>
                                <div style={{ flex: 1, minWidth: 150 }}>
                                    <label style={{ ...xpFormLabel, fontSize: 9, color: '#555' }}>{po.package_label}s stored at</label>
                                    <TreeSelect options={locPickerTreeOptions} value={outDraft} onChange={setOutDraft}
                                        allowEmpty emptyLabel="— select —" size="sm" style={{ width: '100%' }} />
                                </div>
                                {(locsDirty || locsMissing) && (
                                    <button type="button" className={XP_BTN} onClick={saveLocations}
                                        disabled={savingLocs || !srcDraft || !outDraft}
                                        style={{ ...xpBtn(), fontSize: 9, padding: '3px 8px', marginBottom: 1, opacity: savingLocs || !srcDraft || !outDraft ? 0.6 : 1 }}>
                                        {savingLocs ? 'Saving...' : 'Save Locations'}
                                    </button>
                                )}
                                {locsMissing && (
                                    <div style={{ flexBasis: '100%', color: '#7a4a00' }}>
                                        Both locations are required before packing can be logged.
                                    </div>
                                )}
                                {locsDirty && !locsMissing && (
                                    <div style={{ flexBasis: '100%', color: '#7a4a00' }}>
                                        Unsaved location change — save before logging.
                                    </div>
                                )}
                                {/* The sampled weight of THIS cloth. Only on an alt-unit
                                    order, because it is the basis that turns a piece count
                                    into kilos — with no alt unit there is nothing to
                                    convert and the field would be decoration. */}
                                {hasAlt && (
                                    <div style={{ flexBasis: '100%', display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', paddingTop: 4, borderTop: '1px solid #c8dcc8' }}>
                                        <div style={{ minWidth: 150 }}>
                                            <label
                                                style={{ ...xpFormLabel, fontSize: 9, color: '#555' }}
                                                title={`${po.sample_weight_per_unit != null
                                                    ? `Sampled off these goods — 1 ${altUom} = ${altFactor} ${uom}.`
                                                    : `Not sampled — converting through the item's estimate (1 ${altUom} = ${altFactor} ${uom}).`
                                                } Saving restates the kg target and box size; packed ${po.package_label.toLowerCase()}s are untouched.`}
                                            >Sampled weight</label>
                                            <div style={{ display: 'flex' }}>
                                                <input
                                                    type="number" min="0" step="any"
                                                    style={{ ...xpInput, width: 80, borderRight: 'none', textAlign: 'right' }}
                                                    value={sampleDraft}
                                                    onChange={e => setSampleDraft(e.target.value)}
                                                    placeholder="0"
                                                    title="What one yard/metre of the goods being packed actually weighs"
                                                />
                                                <select
                                                    style={{ ...xpInput, width: 62, flexShrink: 0 }}
                                                    value={sampleUnitDraft}
                                                    onChange={e => setSampleUnitDraft(e.target.value)}
                                                >
                                                    <option value="">—</option>
                                                    <option value="g/y">g/y</option>
                                                    <option value="g/m">g/m</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div style={{ flex: 1, minWidth: 120, color: '#7a4a00', paddingBottom: 2 }}>
                                            {po.sample_weight_per_unit == null
                                                && `Not sampled — using the item's estimate.`}
                                        </div>
                                        {sampleDirty && (
                                            <button type="button" className={XP_BTN} onClick={saveSample}
                                                disabled={savingSample}
                                                style={{ ...xpBtn(), fontSize: 9, padding: '3px 8px', marginBottom: 1, opacity: savingSample ? 0.6 : 1 }}>
                                                {savingSample ? 'Saving...' : 'Save Weight'}
                                            </button>
                                        )}
                                        {sampleDirty && (
                                            <div style={{ flexBasis: '100%', color: '#7a4a00' }}>
                                                Unsaved sampled weight — save before logging.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {useLotPicker && (
                                !po.source_location_id ? (
                                    <div style={{ background: '#fff4e5', border: '1px solid #d9a441', color: '#7a4a00', padding: '4px 8px', fontSize: 10 }}>
                                        Set a pack-from location on this order before packing.
                                    </div>
                                ) : (
                                    <div>
                                        <div style={{ ...xpFormLabel, fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span title={`Each lot is logged as its own pack event, and a ${po.package_label.toLowerCase()} that spans two lots of the same size is pegged to both. The variant is read from the lot's own stock row, the size off the lot itself.`}>
                                                Lots to Pack From — {po.item_code || it?.code || ''}
                                            </span>
                                            <span style={{ fontWeight: 'normal', color: short ? '#900' : '#555' }}>
                                                {selectedLots.length} lot{selectedLots.length === 1 ? '' : 's'} · {selAvailable.toFixed(2)} available · drawing{' '}
                                                <strong>{drawn.toFixed(2)}</strong>{short ? ` of ${drawTotal.toFixed(2)}` : ''}
                                                <button
                                                    type="button"
                                                    className={XP_BTN}
                                                    onClick={() => setSelectedLots(allSelected ? [] : allIds)}
                                                    style={{ ...xpBtn(), fontSize: 9, padding: '0 6px', marginLeft: 6 }}
                                                >{allSelected ? 'None' : 'All'}</button>
                                            </span>
                                        </div>
                                        <div style={{ border: '1px solid #7f9db9', background: '#fff', maxHeight: 150, overflowY: 'auto' }}>
                                            {lotsLoading && <div style={{ fontSize: 10, color: '#888', padding: '3px 5px' }}>Loading lots...</div>}
                                            {!lotsLoading && lots.length === 0 && (
                                                <div style={{ fontSize: 10, color: '#888', padding: '3px 5px' }}>
                                                    {heldLotCount > 0
                                                        ? `${heldLotCount} lot${heldLotCount === 1 ? '' : 's'} here ${heldLotCount === 1 ? 'is' : 'are'} held in quarantine — release on the Quarantine Packing page before packing.`
                                                        : 'No lots of this item in stock at the pack-from location.'}
                                                </div>
                                            )}
                                            {lots.map((b: any) => {
                                                const id = String(b.id);
                                                const on = selSet.has(id);
                                                return (
                                                    <label key={id} style={{ ...lvPickerRow(CLASSIC, on), fontSize: 10 }}>
                                                        <RowCheckbox classic={CLASSIC} checked={on} label={b.batch_number || 'lot'}
                                                            onChange={() => toggleLot(id, !on)} />
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                                <span style={{ fontFamily: CODE_FONT, fontWeight: 'bold' }}>{b.batch_number}</span>
                                                                <span style={{ color: '#555' }}>{Number(b.remaining ?? 0).toFixed(2)} {uom}</span>
                                                                {/* What this log takes off the lot — the rest stays on it for
                                                                    the next pack event. FIFO, so later lots may draw 0. */}
                                                                {on && (
                                                                    <span style={{ borderRadius: CHIP_RADIUS,
                                                                        fontSize: 9, fontWeight: 'bold', color: takeByBatch[id] ? '#0a3e0a' : '#777',
                                                                        background: takeByBatch[id] ? '#d0f0d0' : '#eceae2',
                                                                        border: '1px solid #aca899', padding: '0 4px',
                                                                    }}>
                                                                        pack {(takeByBatch[id] || 0).toFixed(2)}
                                                                    </span>
                                                                )}
                                                                {b.location_name && <span style={{ color: '#0058e6' }}>@ {b.location_name}</span>}
                                                            </div>
                                                            <LotChips batch={b} showOrder />
                                                        </div>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                        {selectedSizes.length > 1 && (
                                            <div style={{ background: '#fff4e5', border: '1px solid #d9a441', color: '#7a4a00', padding: '4px 8px', fontSize: 10, marginTop: 3 }}>
                                                Selected lots span {selectedSizes.length} sizes ({selectedSizes.join(', ')}).
                                                A {po.package_label.toLowerCase()} holds one size, so its label can name it —
                                                size your {po.package_label.toLowerCase()}s so none straddles the changeover, or
                                                log each size as its own entry.
                                            </div>
                                        )}
                                        {heldLotCount > 0 && (
                                            <div style={{ fontSize: 9, color: '#7a4a00', marginTop: 2 }}>
                                                {heldLotCount} more lot{heldLotCount === 1 ? '' : 's'} held in quarantine, not shown.
                                            </div>
                                        )}
                                    </div>
                                )
                            )}
                            {!useLotPicker && (
                                <div
                                    style={{ fontSize: 9, color: '#888' }}
                                    title="The variant is taken from the stock at the pack-from location"
                                >
                                    Not lot-tracked.
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                    {/* Also a div — see above. SearchableSelect is not a native
                                        control, so the label association bought nothing, and while
                                        the pin was showing a click on the word "Machine" wrote the
                                        machine onto the order. */}
                                    <div style={{ ...xpFormLabel, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                                        <span>Machine</span>
                                        {machineDirty && workCenterId && (
                                            <XPActionButton
                                                classic tone="primary" icon="bi-pin-angle" label="Set on order"
                                                title="Store this machine on the packing order so later entries pre-fill with it"
                                                disabled={savingMachine}
                                                onClick={saveMachine}
                                            />
                                        )}
                                    </div>
                                    <SearchableSelect options={machineOptions || []} value={workCenterId}
                                        onChange={setWorkCenterId} placeholder="Select machine (optional)…" size="sm" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={xpFormLabel}>Operator</label>
                                    <input type="text" style={{ ...xpInput, width: '100%' }} value={operator}
                                        onChange={e => setOperator(e.target.value)} placeholder="Name (optional)" />
                                </div>
                                <div style={{ flex: 2 }}>
                                    <label style={xpFormLabel}>Notes</label>
                                    <input type="text" style={{ ...xpInput, width: '100%' }} value={packNotes}
                                        onChange={e => setPackNotes(e.target.value)} placeholder="Shift, remarks..." />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Packaging materials */}
                    {(po.materials || []).length > 0 && (
                        <LegendPanel title="Packaging Materials">
                            <div style={{ padding: '4px 8px 8px' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                                    <thead>
                                        <tr style={{ background: '#dddbd0' }}>
                                            <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Material</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 90 }}>Planned</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 90 }}>Consumed</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(po.materials || []).map((m: any, idx: number) => (
                                            <tr key={m.id} style={{ background: idx % 2 === 0 ? '#fff' : '#f5f4ee' }}>
                                                <td style={{ padding: '2px 6px' }}>
                                                    <span style={{ fontWeight: 500 }}>{m.item_code || m.item_id}</span>
                                                    {m.item_name && <span style={{ color: '#666', marginLeft: 4 }}>{m.item_name}</span>}
                                                </td>
                                                <td style={{ padding: '2px 6px', textAlign: 'right', color: '#555' }}>
                                                    {num(m.qty_planned).toLocaleString()} {m.item_uom}
                                                </td>
                                                <td style={{ padding: '2px 6px', textAlign: 'right' }}>{num(m.qty_consumed).toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div style={{ fontSize: 9, color: '#888', marginTop: 4 }}>
                                    Planned is the free-entry plan; Consumed rolls up what each pack event actually took.
                                </div>
                            </div>
                        </LegendPanel>
                    )}

                    {/* Cartons */}
                    {units.length > 0 && (
                        <LegendPanel title={`${po.package_label}s (${units.length})`}>
                            <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                                    <thead>
                                        <tr style={{ background: '#dddbd0' }}>
                                            <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899', width: 34 }}>#</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Lot</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Identity</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899', width: 90 }}>In stock</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899', width: 90 }}>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {units.map((u: any, idx: number) => (
                                            <tr key={u.id} style={{ background: idx % 2 === 0 ? '#fff' : '#f5f4ee' }}>
                                                <td style={{ padding: '2px 6px' }}>{u.package_no}</td>
                                                <td style={{ padding: '2px 6px', fontFamily: CODE_FONT, color: '#00309c' }}>{u.batch_number}</td>
                                                {/* Size / shade / combo of THIS carton — the sized cartons of one
                                                    order differ here even though the order states one variant. */}
                                                <td style={{ padding: '2px 6px' }}><LotChips batch={u} /></td>
                                                <td style={{ padding: '2px 6px', textAlign: 'right', color: num(u.qty) > 0 ? '#0a3e0a' : '#888' }}>
                                                    {num(u.qty).toLocaleString()}
                                                </td>
                                                <td style={{ padding: '2px 6px' }}>
                                                    {num(u.qty) > 0 ? <StatusChip status="IN_STOCK" tint /> : <StatusChip status="SENT" tint />}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </LegendPanel>
                    )}

                    {/* History */}
                    {completions.length > 0 && (
                        <LegendPanel title="Previous Entries">
                            <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                                    <thead>
                                        <tr style={{ background: '#dddbd0' }}>
                                            {/* Both measurements of the same log: what the scale
                                                read, and the pieces that weight works out to
                                                through this order's sampled unit weight. */}
                                            <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899' }}>{uom || 'Qty'}</th>
                                            {hasAlt && (
                                                <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899' }}>{altUom}</th>
                                            )}
                                            <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899' }}>{po.package_label}s</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'right', borderBottom: '1px solid #aca899' }}>QC Reject</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Source lot</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Machine</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Operator</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Notes</th>
                                            <th style={{ padding: '2px 6px', textAlign: 'left', borderBottom: '1px solid #aca899' }}>Time</th>
                                            {!readOnly && <th style={{ padding: '2px 6px', borderBottom: '1px solid #aca899', width: 26 }} />}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {completions.map((c: any, i: number) => (
                                            <tr key={c.id} style={{ background: c.rejected ? '#fbeaea' : i % 2 === 0 ? '#fff' : '#f5f4ee', opacity: c.rejected ? 0.75 : 1 }}>
                                                <td style={{ padding: '2px 6px', textAlign: 'right', fontWeight: 'bold', textDecoration: c.rejected ? 'line-through' : undefined }}>
                                                    {num(c.qty).toFixed(2)}
                                                </td>
                                                {hasAlt && (() => {
                                                    const a = altOf(c.id);
                                                    return (
                                                        <td style={{ padding: '2px 6px', textAlign: 'right', color: '#555', textDecoration: c.rejected ? 'line-through' : undefined }}>
                                                            {a === null ? '—' : a.toLocaleString()}
                                                        </td>
                                                    );
                                                })()}
                                                <td style={{ padding: '2px 6px', textAlign: 'right', color: '#555' }}>{c.package_count}</td>
                                                <td style={{ padding: '2px 6px', textAlign: 'right', color: num(c.qty_rejected) ? '#a00000' : '#aaa', fontWeight: num(c.qty_rejected) ? 'bold' : 'normal' }}
                                                    title={c.reject_reason || undefined}>
                                                    {num(c.qty_rejected) ? num(c.qty_rejected).toFixed(2) : '—'}
                                                    {c.package_count_rejected ? <span style={{ fontWeight: 'normal', fontSize: 9 }}> ({c.package_count_rejected})</span> : null}
                                                </td>
                                                <td style={{ padding: '2px 6px', color: '#555', fontFamily: c.source_batch_number ? CODE_FONT : undefined }}>
                                                    {c.source_batch_number || '—'}
                                                </td>
                                                <td style={{ padding: '2px 6px', color: '#555' }}>{c.work_center_name || '—'}</td>
                                                <td style={{ padding: '2px 6px', color: '#555' }}>{c.operator || '—'}</td>
                                                <td style={{ padding: '2px 6px', color: '#555' }}>{c.notes || '—'}</td>
                                                <td style={{ padding: '2px 6px', color: '#555' }}>{c.completed_at ? tzDateTime(c.completed_at) : '—'}</td>
                                                {!readOnly && (
                                                    <td style={{ padding: '2px 4px', textAlign: 'right' }}>
                                                        {!c.rejected && goodUnitsOf(c.id).length > 0 && (
                                                            <XPActionButton
                                                                classic tone="warning" icon="bi-slash-circle"
                                                                title="QC reject cartons from this pack event"
                                                                onClick={() => openReject(c)}
                                                            />
                                                        )}
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </LegendPanel>
                    )}

                    {/* QC reject of a logged pack event — modeless panel, same shape as
                        the lot reject on the Lot Management page. */}
                    {rejectComp && (() => {
                        const candidates = goodUnitsOf(rejectComp.id);
                        const partial = rejectUnitIds.length > 0 && rejectUnitIds.length < candidates.length;
                        const rejectingCount = rejectUnitIds.length || candidates.length;
                        return (
                            <LegendPanel title={`QC Reject — ${num(rejectComp.qty).toFixed(2)} packed ${rejectComp.completed_at ? `on ${tzDateTime(rejectComp.completed_at)}` : ''}`}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 10 }}>
                                    <div style={{ color: '#555' }}>
                                        Rejecting <strong>{rejectingCount}</strong> of {candidates.length} {po.package_label.toLowerCase()}(s).
                                        {partial
                                            ? ' The log stays active for its good cartons.'
                                            : ' The whole pack event drops out of packed qty.'}
                                        {' '}Cartons move to the defect store routed from this item&apos;s default reject location.
                                    </div>
                                    <div style={{ maxHeight: 96, overflowY: 'auto', border: '1px solid #aca899', background: '#fff', padding: 4 }}>
                                        {candidates.length === 0 ? (
                                            <div style={{ color: '#888' }}>No good cartons left on this event.</div>
                                        ) : candidates.map((u: any) => (
                                            <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '1px 0' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={rejectUnitIds.includes(String(u.id))}
                                                    onChange={e => setRejectUnitIds(prev => e.target.checked
                                                        ? [...prev, String(u.id)]
                                                        : prev.filter(x => x !== String(u.id)))}
                                                />
                                                <span style={{ fontFamily: CODE_FONT }}>{u.batch_number}</span>
                                                <span style={{ color: '#777' }}>{num(u.qty).toFixed(2)} {uom}</span>
                                            </label>
                                        ))}
                                    </div>
                                    <div style={{ color: '#666' }}>Leave every box unticked to reject the whole event.</div>
                                    <input
                                        type="text"
                                        style={{ ...xpInput, width: '100%' }}
                                        value={rejectReason}
                                        onChange={e => setRejectReason(e.target.value)}
                                        placeholder="Reason — crushed carton, wrong count, damp..."
                                    />
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <input type="checkbox" checked={rejectUsable} onChange={e => setRejectUsable(e.target.checked)} />
                                        Still usable (downgrade, not scrap)
                                    </label>
                                    <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                                        <button type="button" className={XP_BTN} style={xpBtn()} onClick={() => setRejectComp(null)}>Cancel</button>
                                        <button
                                            type="button"
                                            className={XP_BTN}
                                            style={{ ...xpBtn({ ...BTN_TONES.danger }), opacity: rejecting ? 0.6 : 1 }}
                                            disabled={rejecting || candidates.length === 0}
                                            onClick={submitReject}
                                        >
                                            {rejecting ? 'Rejecting...' : partial ? 'Reject Selected' : 'Reject Whole Entry'}
                                        </button>
                                    </div>
                                </div>
                            </LegendPanel>
                        );
                    })()}
                </div>
            </form>
        </ModalWrapper>
    );
}
