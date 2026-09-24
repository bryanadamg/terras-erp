import { useState, useMemo, useRef } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useUser } from '../../context/UserContext';
import { useServerSort, TableSkeleton, useTableSkeletonMetrics, XPActionButton, FormSection, FieldLabel, CodeChip, CODE_FONT, xpFont, rowStateBg, VariantChip, Chip, REF_TONES, statusTint, xpInput as xpInputBase, xpBtn as xpBtnBase, BTN_TONES, XP_BTN, SKEL_PAGE_ROWS } from '../shared/xpTheme';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import { xpBevel as sharedXpBevel, xpTitleBar as sharedXpTitleBar, xpToolbar as sharedXpToolbar, SearchField, ToolbarButton, pageFillStyle, flexFillStyle } from '../shared/shellTheme';
import { useToast } from '../shared/Toast';
import SearchableSelect from '@bryanadamg/terras-ui/components/Combobox';
import ModalWrapper from '../shared/ModalWrapper';
import Pager from '../shared/Pager';
import TreeSelect, { buildLocationFilterTree, buildLocationPickerTree, buildCategoryTree } from '../shared/TreeSelect';
import { lotColorLabel } from '../shared/LotChips';
import { useRowSelection, RowCheckbox, SelectAllCheckbox, SortableTh, lvThSticky, lvZebra, Dash, ResizableTable } from '../shared/listViewTheme';

const STOCK_PAGE_SIZE = 50;

// Row actions are icon-only (project convention, see BatchesView) so the tooltip is
// the only label the operator gets — keep these explicit about what each one does.
const ADJUST_TITLE = 'Adjust quantity — cycle count or correction';
const MOVE_TITLE = 'Move — transfer this stock to another location';

interface StockOnHandViewProps {
    locations: any[];
    attributes: any[];
    categories: any[];
    items?: any[];
    onSearchItems?: (term: string) => void;
    /** DataContext-wide refresh, wired to the toolbar Refresh button alongside the
     *  grid's own refetch. The grid rows come from /stock/balance/paginated, NOT from
     *  DataContext's `stockBalance` (that array is the plant-wide lookup feed for
     *  manufacturing material availability and must stay unpaginated). */
    onRefresh: () => void;
    authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
    apiBase: string;
}

// Fixed px column widths + a table min-width: the grid scrolls horizontally instead of
// squeezing chip columns into overlapping percentages.
const COL_W = {
    check: 34, item: 230, ends: 60, category: 140, location: 190, lot: 150, mo: 170, wo: 170, attrs: 260,
    qty: 110, uom: 60, packaging: 130, notes: 190, actions: 74,
};
const TABLE_MIN_WIDTH = Object.values(COL_W).reduce((a, b) => a + b, 0);

export default function StockOnHandView({ locations, attributes, categories, items = [], onSearchItems, onRefresh, authFetch, apiBase }: StockOnHandViewProps) {
    const { t } = useLanguage();
    const { showToast } = useToast();
    const { hasPermission, hasAnyPermission } = useUser();
    const canEntry = hasAnyPermission('stock_on_hand.create', 'stock_on_hand.adjust', 'stock_on_hand.move');
    const canRebuild = hasPermission('admin.access');

    const [locationFilter, setLocationFilter] = useState('');
    const [warehouseFilter, setWarehouseFilter] = useState('');
    const [selectedCat, setSelectedCat] = useState('');
    // MO/WO quick filters — set by clicking a row's MO/WO chip (exact-match, not the
    // free-text `search` box's substring match) so an operator can jump from "this
    // lot came from MO X" to "show me every other lot MO X produced" in one click.
    const [moFilter, setMoFilter] = useState('');
    const [woFilter, setWoFilter] = useState('');
    // QC-rejected lots stay physically in their location until disposed, so they are
    // shown by default (the table is the physical truth) but flagged, and hideable
    // for anyone reading the table as available stock.
    const [hideRejected, setHideRejected] = useState(false);
    // Sort is a server param (the grid only holds one page), so the column-header
    // toggle drives query state instead of useSortable's in-memory comparator.
    const { sort, toggleSort } = useServerSort();

    // Transfer modal state
    const [transferTarget, setTransferTarget] = useState<any>(null);
    const [transferToLoc, setTransferToLoc] = useState('');
    const [transferQty, setTransferQty] = useState('');
    const [transferCones, setTransferCones] = useState('');
    const [transferBoxes, setTransferBoxes] = useState('');
    const [transferDrums, setTransferDrums] = useState('');
    const [transferring, setTransferring] = useState(false);

    // Multi-select + combined move. The selection itself is `sel` (useRowSelection),
    // declared further down where pageRows exists to scope select-all to.
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkToLoc, setBulkToLoc] = useState('');
    const [bulkQty, setBulkQty] = useState<Record<string, string>>({});
    const [bulkMoving, setBulkMoving] = useState(false);

    // Adjust modal state
    const ADJUST_REASONS = ['Cycle count', 'Damaged / Loss', 'Correction', 'Found stock', 'Scrap', 'Other'];
    const [adjustTarget, setAdjustTarget] = useState<any>(null);
    const [adjustMode, setAdjustMode] = useState<'set' | 'delta'>('set');
    const [adjustQty, setAdjustQty] = useState('');
    const [adjustCones, setAdjustCones] = useState('');
    const [adjustBoxes, setAdjustBoxes] = useState('');
    const [adjustDrums, setAdjustDrums] = useState('');
    const [adjustReason, setAdjustReason] = useState(ADJUST_REASONS[0]);
    const [adjustNote, setAdjustNote] = useState('');
    const [adjusting, setAdjusting] = useState(false);

    // New manual entry modal state (covers items with no existing balance row)
    const NEW_REASONS = ['Opening balance', 'Manual entry', 'Correction', 'Found stock', 'Other'];
    const [newOpen, setNewOpen] = useState(false);
    const [newItemCode, setNewItemCode] = useState('');
    const [newLocId, setNewLocId] = useState('');
    const [newAttrIds, setNewAttrIds] = useState<string[]>([]);
    const [newQty, setNewQty] = useState('');
    const [newCones, setNewCones] = useState('');
    const [newBoxes, setNewBoxes] = useState('');
    const [newDrums, setNewDrums] = useState('');
    const [newReason, setNewReason] = useState(NEW_REASONS[0]);
    const [newNote, setNewNote] = useState('');
    const [savingNew, setSavingNew] = useState(false);

    const [rebuilding, setRebuilding] = useState(false);
    const handleRebuild = async () => {
        if (rebuilding) return;
        setRebuilding(true);
        try {
            const res = await authFetch(`${apiBase}/stock/balances/rebuild`, { method: 'POST' });
            if (res.ok) { showToast('Stock balances rebuilt from ledger', 'success'); reload(); }
            else { showToast(`Rebuild failed (HTTP ${res.status})`, 'danger'); }
        } catch { showToast('Rebuild failed — network error', 'danger'); }
        finally { setRebuilding(false); }
    };

    // Mirrors the stock_balances grain: (item, location, variant, lot).
    const rowKey = (bal: any) =>
        `${bal.item_id}|${bal.location_id}|${bal.batch_key || ''}|${[...(bal.attribute_value_ids || [])].sort().join(',')}`;

    // Only positive-qty rows can be moved; a zero/negative row has nothing to send.
    const movable = (bal: any) => bal.qty > 0;

    const openTransfer = (bal: any) => {
        setTransferTarget(bal);
        setTransferToLoc('');
        setTransferQty(String(bal.qty));
        // Default packaging counts to the full holding; operator trims as needed.
        setTransferCones(bal.qty_cones ? String(bal.qty_cones) : '');
        setTransferBoxes(bal.qty_boxes ? String(bal.qty_boxes) : '');
        setTransferDrums(bal.qty_drums ? String(bal.qty_drums) : '');
    };

    const handleTransfer = async () => {
        if (!transferTarget) return;
        const qty = parseFloat(transferQty);
        if (!qty || qty <= 0) { showToast('Enter a positive quantity', 'danger'); return; }
        if (!transferToLoc) { showToast('Select a destination location', 'danger'); return; }
        setTransferring(true);
        try {
            const res = await authFetch(`${apiBase}/stock/transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_id: transferTarget.item_id,
                    from_location_id: transferTarget.location_id,
                    to_location_id: transferToLoc,
                    qty,
                    batch_id: transferTarget.batch_key || null,
                    attribute_value_ids: transferTarget.attribute_value_ids || [],
                    qty_cones: transferCones ? parseInt(transferCones, 10) : null,
                    qty_boxes: transferBoxes ? parseInt(transferBoxes, 10) : null,
                    qty_drums: transferDrums ? parseInt(transferDrums, 10) : null,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Transfer failed');
            }
            showToast('Transfer recorded', 'success');
            setTransferTarget(null);
            reload();
        } catch (err: any) {
            showToast(err.message, 'danger');
        } finally {
            setTransferring(false);
        }
    };

    const openBulkMove = () => {
        const qtys: Record<string, string> = {};
        for (const [k, bal] of sel.entries) qtys[k] = String(bal.qty);
        setBulkQty(qtys);
        setBulkToLoc('');
        setBulkOpen(true);
    };

    const dropBulkRow = (k: string) => {
        sel.deselectKey(k);
        setBulkQty(prev => { const n = { ...prev }; delete n[k]; return n; });
    };

    const handleBulkMove = async () => {
        if (!bulkToLoc) { showToast('Select a destination location', 'danger'); return; }
        const lines: any[] = [];
        for (const [k, bal] of sel.entries) {
            const qty = parseFloat(bulkQty[k]);
            if (!qty || qty <= 0) { showToast(`${bal.item_name}: enter a positive quantity`, 'danger'); return; }
            if (qty > bal.qty) { showToast(`${bal.item_name}: only ${bal.qty} on hand`, 'danger'); return; }
            if (String(bal.location_id) === bulkToLoc) { showToast(`${bal.item_name} is already in the destination location`, 'danger'); return; }
            // Packaging tallies are independent counts, not derivable from a trimmed
            // qty — so they only ride along on a whole-row move. Partial moves that
            // need container counts go through the single-row Move dialog.
            const whole = qty === bal.qty;
            lines.push({
                item_id: bal.item_id,
                from_location_id: bal.location_id,
                qty,
                batch_id: bal.batch_key || null,
                attribute_value_ids: bal.attribute_value_ids || [],
                qty_cones: whole ? (bal.qty_cones || null) : null,
                qty_boxes: whole ? (bal.qty_boxes || null) : null,
                qty_drums: whole ? (bal.qty_drums || null) : null,
            });
        }
        if (!lines.length) { showToast('Nothing selected', 'danger'); return; }
        setBulkMoving(true);
        try {
            const res = await authFetch(`${apiBase}/stock/transfer/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to_location_id: bulkToLoc, lines }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Combined move failed');
            }
            const body = await res.json().catch(() => ({}));
            showToast(body.message || `Moved ${lines.length} rows`, 'success');
            setBulkOpen(false);
            sel.clear();
            reload();
        } catch (err: any) {
            showToast(err.message, 'danger');
        } finally {
            setBulkMoving(false);
        }
    };

    // Prefill the adjust modal. 'set' mode shows current values (operator overwrites
    // with the counted figure); 'delta' mode starts blank (operator enters +/- change).
    const fillAdjust = (bal: any, mode: 'set' | 'delta') => {
        setAdjustMode(mode);
        if (mode === 'set') {
            setAdjustQty(String(bal.qty));
            setAdjustCones(bal.qty_cones != null ? String(bal.qty_cones) : '');
            setAdjustBoxes(bal.qty_boxes != null ? String(bal.qty_boxes) : '');
            setAdjustDrums(bal.qty_drums != null ? String(bal.qty_drums) : '');
        } else {
            setAdjustQty('');
            setAdjustCones(''); setAdjustBoxes(''); setAdjustDrums('');
        }
    };
    const openAdjust = (bal: any) => {
        setAdjustTarget(bal);
        setAdjustReason(ADJUST_REASONS[0]);
        setAdjustNote('');
        fillAdjust(bal, 'set');
    };

    const num = (s: string, d = 0) => { const n = parseFloat(s); return isNaN(n) ? d : n; };
    const int = (s: string, d = 0) => { const n = parseInt(s, 10); return isNaN(n) ? d : n; };

    const handleAdjust = async () => {
        if (!adjustTarget) return;
        const t = adjustTarget;
        const curCones = t.qty_cones || 0, curBoxes = t.qty_boxes || 0, curDrums = t.qty_drums || 0;
        let qtyDelta: number, coneDelta: number, boxDelta: number, drumDelta: number;
        if (adjustMode === 'set') {
            qtyDelta = num(adjustQty, t.qty) - t.qty;
            coneDelta = int(adjustCones, curCones) - curCones;
            boxDelta = int(adjustBoxes, curBoxes) - curBoxes;
            drumDelta = int(adjustDrums, curDrums) - curDrums;
        } else {
            qtyDelta = num(adjustQty, 0);
            coneDelta = int(adjustCones, 0);
            boxDelta = int(adjustBoxes, 0);
            drumDelta = int(adjustDrums, 0);
        }
        if (!qtyDelta && !coneDelta && !boxDelta && !drumDelta) {
            showToast('Nothing to adjust — no change entered', 'danger'); return;
        }
        if (!adjustReason) { showToast('Select a reason', 'danger'); return; }
        const locationCode = locMap[t.location_id]?.code;
        if (!locationCode) { showToast('Cannot resolve location code', 'danger'); return; }
        setAdjusting(true);
        try {
            const res = await authFetch(`${apiBase}/stock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_code: t.item_code,
                    location_code: locationCode,
                    attribute_value_ids: t.attribute_value_ids || [],
                    qty: qtyDelta,
                    qty_cones: coneDelta || null,
                    qty_boxes: boxDelta || null,
                    qty_drums: drumDelta || null,
                    reference_type: 'adjustment',
                    reference_id: adjustNote.trim() ? `${adjustReason}: ${adjustNote.trim()}` : adjustReason,
                    batch_id: t.batch_key || null,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Adjustment failed');
            }
            showToast('Stock adjusted', 'success');
            setAdjustTarget(null);
            reload();
        } catch (err: any) {
            showToast(err.message, 'danger');
        } finally {
            setAdjusting(false);
        }
    };

    // Attributes bound to the selected item (mirrors Stock Entry form).
    const newItem = useMemo(() => items.find((i: any) => i.code === newItemCode), [items, newItemCode]);
    const newBoundAttrs = useMemo(() => {
        if (!newItem?.attribute_ids) return [];
        return attributes.filter((a: any) => newItem.attribute_ids.includes(a.id));
    }, [newItem, attributes]);

    const openNew = () => {
        setNewItemCode(''); setNewLocId(''); setNewAttrIds([]);
        setNewQty(''); setNewCones(''); setNewBoxes(''); setNewDrums('');
        setNewReason(NEW_REASONS[0]); setNewNote('');
        setNewOpen(true);
    };
    const setNewAttrValue = (valId: string, attrId: string) => {
        const attr = attributes.find((a: any) => a.id === attrId);
        if (!attr) return;
        const others = newAttrIds.filter(vid => !attr.values.some((v: any) => v.id === vid));
        setNewAttrIds(valId ? [...others, valId] : others);
    };

    const handleNewEntry = async () => {
        if (!newItemCode) { showToast('Select an item', 'danger'); return; }
        const newLoc = locations.find((l: any) => l.id === newLocId);
        if (!newLocId || !newLoc) { showToast('Select a location', 'danger'); return; }
        const qty = num(newQty, NaN);
        if (isNaN(qty) || qty === 0) { showToast('Enter a non-zero quantity', 'danger'); return; }
        setSavingNew(true);
        try {
            const res = await authFetch(`${apiBase}/stock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_code: newItemCode,
                    location_code: newLoc.code,
                    attribute_value_ids: newAttrIds,
                    qty,
                    qty_cones: int(newCones, 0) || null,
                    qty_boxes: int(newBoxes, 0) || null,
                    qty_drums: int(newDrums, 0) || null,
                    reference_type: 'manual',
                    reference_id: newNote.trim() ? `${newReason}: ${newNote.trim()}` : newReason,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Entry failed');
            }
            showToast('Stock entry recorded', 'success');
            setNewOpen(false);
            reload();
        } catch (err: any) {
            showToast(err.message, 'danger');
        } finally {
            setSavingNew(false);
        }
    };

    const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || id;

    const locMap = useMemo(() => {
        const m: Record<string, any> = {};
        for (const l of (locations || [])) m[l.id] = l;
        return m;
    }, [locations]);
    // Walk up to the root warehouse (handles 2-level zone and 3-level bin).
    const getWarehouseId = (locId: string): string | null => {
        const loc = locMap[locId];
        if (!loc?.parent_id) return null;
        const parent = locMap[String(loc.parent_id)];
        if (!parent?.parent_id) return String(loc.parent_id); // parent is warehouse
        return String(parent.parent_id); // grandparent is warehouse (bin case)
    };
    const getWarehouseName = (locId: string): string => {
        const wid = getWarehouseId(locId);
        return wid ? (locMap[wid]?.name || '') : '';
    };

    // Combined Warehouse → Location dropdown. Top-level locations with children
    // are warehouse groups; childless top-level locations hold stock directly and
    // fall under "No Warehouse".
    const byName = (a: any, b: any) => (a.name || '').localeCompare(b.name || '');
    const topLevel = useMemo(() => (locations || []).filter((l: any) => !l.parent_id), [locations]);
    const childrenByWh = useMemo(() => {
        const m: Record<string, any[]> = {};
        for (const l of (locations || [])) {
            if (l.parent_id) (m[l.parent_id] ||= []).push(l);
        }
        for (const k of Object.keys(m)) m[k].sort(byName);
        return m;
    }, [locations]);
    const warehouseGroups = useMemo(
        () => topLevel.filter((w: any) => (childrenByWh[w.id] || []).length > 0).sort(byName),
        [topLevel, childrenByWh]
    );
    const standaloneLocs = useMemo(
        () => topLevel.filter((w: any) => (childrenByWh[w.id] || []).length === 0).sort(byName),
        [topLevel, childrenByWh]
    );

    // Encode warehouse-vs-location into one select value; the two filter states
    // stay mutually exclusive (a specific location overrides a whole-warehouse pick).
    const locSelectValue = locationFilter ? `loc:${locationFilter}` : warehouseFilter ? `wh:${warehouseFilter}` : '';
    const onLocSelect = (val: string) => {
        if (!val) { setWarehouseFilter(''); setLocationFilter(''); }
        else if (val.startsWith('wh:')) { setWarehouseFilter(val.slice(3)); setLocationFilter(''); }
        else if (val.startsWith('loc:')) { setLocationFilter(val.slice(4)); setWarehouseFilter(''); }
    };
    const locFilterTreeOptions = useMemo(() => buildLocationFilterTree(locations || []), [locations]);
    const locPickerTreeOptions = useMemo(() => buildLocationPickerTree(locations || []), [locations]);

    const getAttrValueName = (valId: string) => {
        for (const attr of attributes) {
            const v = attr.values?.find((v: any) => v.id === valId);
            if (v) return v.value;
        }
        return valId;
    };

    // Combo (system_role='combo') value carried by a balance row, if any — surfaced
    // as its own badge since it's the variant identity for shared greige/base stock.
    const comboValueIds = useMemo(() => {
        const attr = (attributes || []).find((a: any) => a.system_role === 'combo');
        return new Set((attr?.values || []).map((v: any) => String(v.id)));
    }, [attributes]);
    const getComboLabel = (bal: any): string | null => {
        const id = (bal.attribute_value_ids || []).find((vid: string) => comboValueIds.has(String(vid)));
        return id ? getAttrValueName(id) : null;
    };

    // Colors (system_role='color') value carried by the row's own variant pick —
    // separate from `colorInfo` (the producing MO's Color Library shade, resolved
    // server-side). A color-variant FG item's stock is identified by this attribute
    // value directly, and it can carry its own swatch (AttributeValue.hex) same as
    // any other attribute value — shown here so that swatch isn't lost.
    const colorValueIds = useMemo(() => {
        const attr = (attributes || []).find((a: any) => a.system_role === 'color');
        return new Set((attr?.values || []).map((v: any) => String(v.id)));
    }, [attributes]);
    const getColorAttrValue = (bal: any): { name: string; hex: string | null } | null => {
        const id = (bal.attribute_value_ids || []).find((vid: string) => colorValueIds.has(String(vid)));
        if (!id) return null;
        for (const attr of attributes) {
            const v = attr.values?.find((v: any) => v.id === id);
            if (v) return { name: v.value, hex: v.hex || null };
        }
        return null;
    };

    // Packaging counts (no UOM conversion) — show only nonzero units.
    const pkgParts = (bal: any): { n: number; label: string }[] => {
        const out: { n: number; label: string }[] = [];
        const c = bal.qty_cones || 0, b = bal.qty_boxes || 0, d = bal.qty_drums || 0;
        if (c) out.push({ n: c, label: c === 1 || c === -1 ? 'cone' : 'cones' });
        if (b) out.push({ n: b, label: b === 1 || b === -1 ? 'box' : 'boxes' });
        if (d) out.push({ n: d, label: d === 1 || d === -1 ? 'drum' : 'drums' });
        return out;
    };

    // ── Category filter ───────────────────────────────────────────────────────
    const cats = categories || [];
    const catTreeOptions = useMemo(() => buildCategoryTree(cats), [cats]);
    const effectiveCat = selectedCat;

    // A row matches when its item_category_id is the selected category or any
    // descendant of it. Precompute the descendant-inclusive id set once.
    const catMatchSet = useMemo(() => {
        if (!effectiveCat) return null;
        const childrenOf: Record<string, string[]> = {};
        for (const c of cats) {
            if (!c.parent_id) continue;
            (childrenOf[c.parent_id] ||= []).push(c.id);
        }
        const set = new Set<string>();
        const stack = [effectiveCat];
        while (stack.length) {
            const id = stack.pop()!;
            if (set.has(id)) continue;
            set.add(id);
            for (const child of (childrenOf[id] || [])) stack.push(child);
        }
        return set;
    }, [cats, effectiveCat]);

    const clearCats = () => setSelectedCat('');

    // ── Server-paginated rows ─────────────────────────────────────────────────
    // The grid reads /stock/balance/paginated, NOT DataContext's `stockBalance`:
    // that array is the plant-wide lookup feed manufacturing nets material
    // availability from, so it must stay unpaginated (see the note on the endpoint).
    // Filtering, sorting and the page window are all applied in SQL; the footer
    // aggregates come back as envelope extras because they must describe the whole
    // filtered set, not this page.
    const categoryParam = useMemo(() => (catMatchSet ? Array.from(catMatchSet).join(',') : ''), [catMatchSet]);
    const {
        rows: pageRows, total, meta, loading, page, setPage,
        searchInput: search, setSearch, refetch,
    } = usePaginatedFetch<any>({
        endpoint: `${apiBase}/stock/balance/paginated`,
        authFetch,
        pageSize: STOCK_PAGE_SIZE,
        params: {
            location_id: locationFilter,
            warehouse_id: warehouseFilter,
            category_id: categoryParam,
            mo_code: moFilter,
            wo_code: woFilter,
            hide_rejected: hideRejected,
            sort_by: sort?.key,
            sort_dir: sort ? (sort.dir === 1 ? 'asc' : 'desc') : '',
        },
        onError: m => showToast(m, 'danger'),
    });
    // Post-mutation reload. The grid's own page is what the operator is looking at;
    // DataContext's shared feed follows the STOCK_UPDATE broadcast the mutation
    // endpoints emit, so it does not need a second full pull here.
    const reload = () => refetch();

    const negativeCount = Number(meta.negative_count || 0);
    const rejectedCount = Number(meta.rejected_count || 0);
    // Rejected qty is physically present but unusable — call the number out so the
    // row total is never read as available stock.
    const rejectedQty = Number(meta.rejected_qty || 0);
    // Unfiltered balance-row count ("Total: N SKUs"), served as an aggregate since the
    // client no longer holds every row.
    const totalRows = Number(meta.total_rows || 0);

    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them. Classic and modern
    // rows differ in height, so they cache under separate keys.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('stock-on-hand-classic', listBodyRef, pageRows.length > 0);

    // Keyed by the balance-row identity (item + location + lot + variant) and
    // holding the row object, so a pick survives paging, sorting and filter
    // changes. The header checkbox acts on the visible page only — selecting 4000
    // filtered rows in one click is never what the operator meant.
    const sel = useRowSelection<any>(pageRows, rowKey, { selectable: movable });

    // ── XP style helpers ─────────────────────────────────────────────────────
    const xpBevel: React.CSSProperties = sharedXpBevel();
    const xpTitleBar: React.CSSProperties = sharedXpTitleBar();
    const xpToolbar: React.CSSProperties = sharedXpToolbar({ gap: '6px' });
    const xpInput: React.CSSProperties = xpInputBase({ boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)' });
    const xpSelect: React.CSSProperties = { ...xpInput, height: '22px' };
    // Heavier divider than lvTh's: this is a 12-column grid and the verticals are
    // what keep a row's figures tracking across it.
    const xpTableHeader: React.CSSProperties = lvThSticky({ borderRight: '1px solid #a8a29a' });
    const colDivider: React.CSSProperties = { borderRight: '1px solid #c0bdb5' };
    const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => xpBtnBase(extra);
    const xpSep: React.CSSProperties = {
        width: '1px', height: '20px', background: '#a0988c', margin: '0 2px', flexShrink: 0,
    };

    // Identity block every stock modal opens with: which item/lot/location is being
    // touched, and how much of it is there right now.
    const stockContextSection = (bal: any, locPrefix: string, qtyLabel: string) => (
        <FormSection title="Stock">
            <div style={{ fontWeight: 'bold' }}>{bal.item_name}</div>
            <div style={{ fontSize: 10, color: '#666' }}>
                {locPrefix}: {bal.location_name || getLocationName(bal.location_id)}
                {bal.batch_key ? ` · Lot: ${bal.batch_number || bal.batch_key}` : ''}
                {' · '}{qtyLabel}: {bal.qty} {bal.item_uom || ''}
            </div>
        </FormSection>
    );

    // Packaging tallies (cones/boxes/drums) are independent counts, never UOM conversions —
    // so the unit has to stay readable AFTER a number is typed. A placeholder alone vanishes
    // on the first keystroke and leaves three unlabelled boxes; every kind gets a real label.
    const packagingInputs = (rows: [string, string, (v: string) => void][], allowNegative = false) => (
        <div style={{ display: 'flex', gap: 6 }}>
            {rows.map(([lbl, val, set]) => (
                <div key={lbl} style={{ flex: 1, minWidth: 0 }}>
                    <div
                        style={{ fontFamily: xpFont, fontSize: 10, fontWeight: 'bold', color: '#2b2822', marginBottom: 1 }}
                    >
                        {lbl}
                    </div>
                    <input
                        type="number" step="1" min={allowNegative ? undefined : '0'} placeholder="0" title={lbl}
                        style={{ ...xpInput, width: '100%' }}
                        value={val}
                        onChange={e => set(e.target.value)}
                    />
                </div>
            ))}
        </div>
    );

    const renderRow = (bal: any, i: number) => {
        const batchLabel = bal.batch_key ? (bal.batch_number || bal.batch_key) : '—';
        // Shade identity: prefer the lot's producing MO (Color Library, same helper
        // the Lot page uses) — richer (code + name + pending state). Rows with no
        // such lineage (no batch, or a lotted row whose MO never got a Color Library
        // pick) fall back to the row's own `Colors` variant attribute value, which
        // carries its own swatch (AttributeValue.hex) same as any other attribute.
        const colorInfo = lotColorLabel(bal);
        const ownColorAttr = !colorInfo ? getColorAttrValue(bal) : null;
        // QC-rejected/disposed lots sit in the same bin as good stock — tint the row
        // and flag the lot so the qty is never mistaken for available.
        const qStatus: string = bal.quality_status && bal.quality_status !== 'GOOD' ? bal.quality_status : '';
        const qtyColor = bal.qty < 0 ? '#c00000' : qStatus ? '#8b0000' : '#00008b';
        const rk = rowKey(bal);
        const checkCell = (
            <RowCheckbox
                checked={sel.isSelectedKey(rk)}
                disabled={!movable(bal)}
                title={movable(bal) ? 'Select for a combined move' : 'Nothing on hand to move'}
                onChange={() => sel.toggle(bal)}
                label={bal.item_name}
            />
        );

        return (
            <tr key={`${bal.item_id}-${bal.location_id}-${bal.batch_key}-${i}`}
                className={undefined}
                title={qStatus ? `Lot is QC ${qStatus} — physically in stock but excluded from netting and consumption pickers` : undefined}
                style={{ background: sel.isSelectedKey(rk) ? rowStateBg('selected') : qStatus ? (i % 2 === 0 ? '#fdf0f0' : '#f8e8e8') : lvZebra(i), borderBottom: '1px solid #c0bdb5' }}>
                <td className={undefined} style={{ padding: '4px 6px', textAlign: 'center', ...colDivider }}>{checkCell}</td>
                <td style={{ padding: '4px 8px', fontFamily: xpFont, overflow: 'hidden', ...colDivider }}>
                    <div title={bal.item_name}
                        style={{ fontSize: '11px', fontWeight: 'bold', color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        className={undefined}>{bal.item_name}</div>
                    <CodeChip code={bal.item_code} tier={2}
                        style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        className={undefined} />
                </td>
                <td className={undefined} style={{ padding: '4px 8px', textAlign: 'right', fontFamily: xpFont, fontSize: '11px', color: '#444', whiteSpace: 'nowrap', ...colDivider }}>
                    {bal.item_ends != null ? bal.item_ends : ''}
                </td>
                <td style={{ padding: '4px 8px', fontFamily: xpFont, fontSize: '11px', maxWidth: 140, ...colDivider }}>
                    {bal.item_category_name ? (
                        // Shared Chip in both themes: these six badges each carried a
                        // classic palette AND a bootstrap badge class, so the same fact
                        // wore two shapes, and neither popped out when the column
                        // clipped it. Palettes moved to REF_TONES unchanged.
                        <Chip tone={REF_TONES.category} truncate size="xs">
                            {bal.item_category_name}
                        </Chip>
                    ) : (
                        <span style={{ fontSize: '10px', color: '#999', fontStyle: 'italic' }} className={undefined}>—</span>
                    )}
                </td>
                <td style={{ padding: '4px 8px', fontFamily: xpFont, fontSize: '11px', overflow: 'hidden', ...colDivider }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxWidth: '100%' }} className={undefined}>
                        {getWarehouseName(bal.location_id) && (
                            <Chip tone={REF_TONES.warehouse} truncate size="xs">
                                {getWarehouseName(bal.location_id)}
                            </Chip>
                        )}
                        <Chip tone={REF_TONES.bin} truncate size="xs">
                            {bal.location_name || getLocationName(bal.location_id)}
                        </Chip>
                    </div>
                </td>
                <td style={{ padding: '4px 8px', fontFamily: xpFont, fontSize: '11px', overflow: 'hidden', ...colDivider }}>
                    {bal.batch_key ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start', maxWidth: '100%' }}
                            className={undefined}>
                            <Chip tone={REF_TONES.lot} truncate size="xs">{batchLabel}</Chip>
                            {bal.vendor_lot && (
                                <Chip tone={REF_TONES.supplierLot} truncate size="xs"
                                    title={`Supplier lot: ${bal.vendor_lot}`} style={{ fontFamily: CODE_FONT }}>
                                    SUP {bal.vendor_lot}
                                </Chip>
                            )}
                            {qStatus && (
                                <Chip tone={statusTint('REJECTED')} truncate size="xs" bold
                                    icon="bi-x-octagon-fill"
                                    title="QC rejected — not usable stock, excluded from netting and consumption pickers">
                                    {qStatus}
                                </Chip>
                            )}
                        </div>
                    ) : (
                        <Dash />
                    )}
                </td>
                <td style={{ padding: '4px 8px', fontFamily: xpFont, fontSize: '11px', overflow: 'hidden', ...colDivider }}>
                    {bal.mo_code ? (
                        <Chip tone={REF_TONES.producedBy} truncate size="xs"
                            title={moFilter === bal.mo_code ? `Filtering to MO ${bal.mo_code} — click to clear` : `Produced by MO ${bal.mo_code} — click to filter the grid to this MO`}
                            style={{ fontFamily: CODE_FONT }}
                            onClick={() => setMoFilter(moFilter === bal.mo_code ? '' : bal.mo_code)}
                            onRemove={moFilter === bal.mo_code ? () => setMoFilter('') : undefined}
                            bold={moFilter === bal.mo_code}>
                            MO {bal.mo_code}
                        </Chip>
                    ) : (
                        <Dash />
                    )}
                </td>
                <td style={{ padding: '4px 8px', fontFamily: xpFont, fontSize: '11px', overflow: 'hidden', ...colDivider }}>
                    {bal.wo_code ? (
                        <Chip tone={REF_TONES.producedBy} truncate size="xs"
                            title={woFilter === bal.wo_code ? `Filtering to WO ${bal.wo_code} — click to clear` : `Produced by WO ${bal.wo_code} — click to filter the grid to this WO`}
                            style={{ fontFamily: CODE_FONT }}
                            onClick={() => setWoFilter(woFilter === bal.wo_code ? '' : bal.wo_code)}
                            onRemove={woFilter === bal.wo_code ? () => setWoFilter('') : undefined}
                            bold={woFilter === bal.wo_code}>
                            WO {bal.wo_code}
                        </Chip>
                    ) : (
                        <Dash />
                    )}
                </td>
                <td style={{ padding: '4px 8px', ...colDivider }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {bal.size_label && (
                            <VariantChip kind="size" title={`Size: ${bal.size_label}`}>{bal.size_label}</VariantChip>
                        )}
                        {getComboLabel(bal) && (
                            <VariantChip kind="combo" title={`Combo: ${getComboLabel(bal)}`}>{getComboLabel(bal)}</VariantChip>
                        )}
                        {colorInfo && (
                            <VariantChip
                                kind={colorInfo.pending ? 'pending' : 'color'}
                                swatch={colorInfo.hex || null}
                                title={colorInfo.pending
                                    ? `Shade pending lab dip approval: ${colorInfo.label}`
                                    : `Color: ${colorInfo.name && colorInfo.name !== colorInfo.label ? `${colorInfo.label} — ${colorInfo.name}` : colorInfo.label}`}
                            >
                                {colorInfo.label}{colorInfo.pending ? ' (pending)' : ''}
                            </VariantChip>
                        )}
                        {!colorInfo && ownColorAttr && (
                            <VariantChip kind="color" swatch={ownColorAttr.hex} title={`Color: ${ownColorAttr.name}`}>
                                {ownColorAttr.name}
                            </VariantChip>
                        )}
                        {/* Combo and Colors already render above as VariantChips —
                            skip their raw values here so the same pick doesn't show
                            twice in one cell. */}
                        {bal.attribute_value_ids
                            ?.filter((vid: string) => !comboValueIds.has(String(vid)) && !colorValueIds.has(String(vid)))
                            .map((vid: string) => (
                                <Chip key={vid} size="xs">{getAttrValueName(vid)}</Chip>
                            ))}
                        {!bal.size_label && !getComboLabel(bal) && !colorInfo && !ownColorAttr && !bal.attribute_value_ids?.length && (
                            <Dash />
                        )}
                    </div>
                </td>
                <td className={undefined}
                    style={{ padding: '4px 8px', textAlign: 'right', fontFamily: CODE_FONT, fontSize: '11px', fontWeight: 'bold', color: qtyColor, whiteSpace: 'nowrap', ...colDivider }}>
                    {Number(bal.qty).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                </td>
                <td className={undefined} style={{ padding: '4px 8px', fontFamily: xpFont, fontSize: '10px', color: '#666', whiteSpace: 'nowrap', ...colDivider }}>
                    {bal.item_uom || ''}
                </td>
                <td className={undefined} style={{ padding: '4px 8px', fontFamily: xpFont, fontSize: '10px', whiteSpace: 'nowrap', ...colDivider }}>
                    {pkgParts(bal).length === 0
                        ? <Dash />
                        : pkgParts(bal).map((p, idx) => (
                            <span key={idx}
                                style={{ color: p.n < 0 ? '#c00000' : '#5a3c00' }}
                                className={undefined}>
                                {idx > 0 ? ' / ' : ''}{p.n} {p.label}
                            </span>
                        ))}
                </td>
                <td className={undefined} style={{ padding: '4px 8px', fontFamily: xpFont, fontSize: '10px', color: '#444', overflow: 'hidden', ...colDivider }}>
                    {bal.batch_notes ? (
                        <span title={bal.batch_notes}
                            style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            className={undefined}>
                            {bal.batch_notes}
                        </span>
                    ) : (
                        <Dash />
                    )}
                </td>
                <td style={{ padding: '2px 6px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 4 }} className={undefined}>
                        {canEntry && (
                            <XPActionButton tone="warning" icon="bi-sliders" title={ADJUST_TITLE} onClick={() => openAdjust(bal)} />
                        )}
                        {canEntry && bal.qty > 0 && (
                            <XPActionButton tone="primary" icon="bi-arrow-left-right" title={MOVE_TITLE} onClick={() => openTransfer(bal)} />
                        )}
                    </div>
                </td>
            </tr>
        );
    };

    const transferModal = transferTarget && (
        <ModalWrapper
            isOpen={!!transferTarget}
            modeless
            onClose={() => setTransferTarget(null)}
            title="Transfer Stock"
            size="sm"
            footer={<>
                <button style={xpBtn()} className={XP_BTN} onClick={() => setTransferTarget(null)}>Cancel</button>
                <button style={xpBtn()} className={XP_BTN} onClick={handleTransfer} disabled={transferring}>
                    {transferring ? 'Moving...' : 'Transfer'}
                </button>
            </>}
        >
            <div style={{ fontFamily: xpFont, fontSize: 11}}>
                {stockContextSection(transferTarget, 'From', 'Available')}
                <FormSection title="Move">
                    <div style={{ marginBottom: 8 }}>
                        <FieldLabel>Destination</FieldLabel>
                        <TreeSelect
                            options={buildLocationPickerTree(locations, transferTarget.location_id)}
                            value={transferToLoc}
                            onChange={setTransferToLoc}
                            placeholder="— select location —"
                            style={{ width: '100%' }}
                            size="sm"
                        />
                    </div>
                    <div>
                        <FieldLabel>Quantity{transferTarget.item_uom ? ` (${transferTarget.item_uom})` : ''}</FieldLabel>
                        <input
                            type="number" min="0.0001" step="any"
                            style={{ ...xpInput, width: '100%' }}
                            value={transferQty}
                            onChange={e => setTransferQty(e.target.value)}
                        />
                    </div>
                </FormSection>
                <FormSection title="Packaging to move">
                    <FieldLabel hint="Optional — how many of each container moves with the quantity above.">Containers</FieldLabel>
                    {packagingInputs([
                        ['Cones', transferCones, setTransferCones],
                        ['Boxes', transferBoxes, setTransferBoxes],
                        ['Drums', transferDrums, setTransferDrums],
                    ])}
                </FormSection>
            </div>
        </ModalWrapper>
    );

    // Combined move — one destination, many source rows. Each line keeps its own
    // lot/variant/source, so this is not a merge: it's N transfers in one commit.
    const bulkMoveModal = bulkOpen && (
        <ModalWrapper
            isOpen={bulkOpen}
            modeless
            onClose={() => setBulkOpen(false)}
            title={`Combined Move — ${sel.count} row${sel.count === 1 ? '' : 's'}`}
            size="lg"
            footer={<>
                <button style={xpBtn()} className={XP_BTN} onClick={() => setBulkOpen(false)}>Cancel</button>
                <button style={xpBtn()} className={XP_BTN} onClick={handleBulkMove} disabled={bulkMoving || !sel.count}>
                    {bulkMoving ? 'Moving...' : `Move ${sel.count} row${sel.count === 1 ? '' : 's'}`}
                </button>
            </>}
        >
            <div style={{ fontFamily: xpFont, fontSize: 11}}>
                <FormSection title="Destination">
                    <FieldLabel hint="Every selected row moves here. Sources, lots and variants are kept as they are.">Move to</FieldLabel>
                    <TreeSelect
                        options={locPickerTreeOptions}
                        value={bulkToLoc}
                        onChange={setBulkToLoc}
                        placeholder="— select location —"
                        style={{ width: '100%' }}
                        size="sm"
                    />
                </FormSection>
                <FormSection title="Rows to move">
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={xpTableHeader}>Item</th>
                                    <th style={xpTableHeader}>From</th>
                                    <th style={xpTableHeader}>Lot</th>
                                    <th style={{ ...xpTableHeader, textAlign: 'right' }}>On hand</th>
                                    <th style={{ ...xpTableHeader, width: 110 }}>Qty to move</th>
                                    <th style={{ ...xpTableHeader, width: 28 }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {sel.items.map((bal: any) => {
                                    const k = rowKey(bal);
                                    const q = parseFloat(bulkQty[k]);
                                    const bad = !q || q <= 0 || q > bal.qty;
                                    return (
                                        <tr key={k} style={{ borderBottom: '1px solid #c0bdb5' }}>
                                            <td style={{ padding: '3px 6px' }}>
                                                <div style={{ fontWeight: 'bold' }}>{bal.item_name}</div>
                                                <CodeChip code={bal.item_code} tier={2} />
                                            </td>
                                            <td style={{ padding: '3px 6px' }}>{bal.location_name || getLocationName(bal.location_id)}</td>
                                            <td style={{ padding: '3px 6px', fontFamily: CODE_FONT, fontSize: 10 }}>
                                                <div>{bal.batch_key ? (bal.batch_number || bal.batch_key) : '—'}</div>
                                                {bal.mo_code && <div style={{ color: '#2a4a2a' }}>MO {bal.mo_code}</div>}
                                            </td>
                                            <td style={{ padding: '3px 6px', textAlign: 'right', fontFamily: CODE_FONT }}>
                                                {Number(bal.qty).toLocaleString('en-US', { maximumFractionDigits: 3 })} {bal.item_uom || ''}
                                            </td>
                                            <td style={{ padding: '3px 6px' }}>
                                                <input
                                                    type="number" min="0.0001" step="any" max={bal.qty}
                                                    style={{ ...xpInput, width: '100%', borderColor: bad ? '#a03030' : undefined }}
                                                    value={bulkQty[k] ?? ''}
                                                    onChange={e => setBulkQty(prev => ({ ...prev, [k]: e.target.value }))}
                                                />
                                            </td>
                                            <td style={{ padding: '3px 6px' }}>
                                                <XPActionButton tone="danger" icon="bi-x-lg" title="Remove from this move" onClick={() => dropBulkRow(k)} />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ fontSize: 10, color: '#666', marginTop: 6 }}>
                        Container tallies (cones/boxes/drums) move with a row only when the full on-hand quantity is sent.
                        For a partial move that also splits containers, use the single-row Move action.
                    </div>
                </FormSection>
            </div>
        </ModalWrapper>
    );

    const adjustModal = adjustTarget && (() => {
        const t = adjustTarget;
        const newQty = adjustMode === 'set' ? num(adjustQty, t.qty) : t.qty + num(adjustQty, 0);
        const delta = newQty - t.qty;
        const modeBtn = (m: 'set' | 'delta', label: string) => {
            const active = adjustMode === m;
            return (
                <button key={m} className={XP_BTN} style={xpBtn({ fontSize: '11px', flex: 1, fontWeight: active ? 'bold' : 'normal', background: active ? 'linear-gradient(to bottom,#cfe3ff,#a9c9f0)' : undefined })}
                    onClick={() => fillAdjust(t, m)}>{label}</button>
            );
        };
        const pkgLabel = adjustMode === 'set' ? 'Counted packaging' : 'Packaging change (+/-)';
        return (
            <ModalWrapper
                isOpen={true}
                modeless
                onClose={() => setAdjustTarget(null)}
                title="Adjust Stock"
                size="sm"
                footer={<>
                    <button style={xpBtn()} className={XP_BTN} onClick={() => setAdjustTarget(null)}>Cancel</button>
                    <button style={xpBtn()} className={XP_BTN} onClick={handleAdjust} disabled={adjusting}>
                        {adjusting ? 'Saving...' : 'Save Adjustment'}
                    </button>
                </>}
            >
                <div style={{ fontFamily: xpFont, fontSize: 11}}>
                    {stockContextSection(t, 'Location', 'On hand')}
                    <FormSection title="Adjustment">
                        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                            {modeBtn('set', 'Set to (count)')}
                            {modeBtn('delta', 'Adjust by (+/-)')}
                        </div>
                        <div>
                            <FieldLabel>
                                {adjustMode === 'set' ? 'Counted quantity' : 'Quantity change (+/-)'}
                                {t.item_uom ? ` (${t.item_uom})` : ''}
                            </FieldLabel>
                            <input
                                type="number" step="any"
                                style={{ ...xpInput, width: '100%' }}
                                value={adjustQty}
                                onChange={e => setAdjustQty(e.target.value)}
                            />
                            <div style={{ fontSize: 10, color: delta < 0 ? '#c00000' : '#2d7a2d', marginTop: 2 }}>
                                New on hand: <b>{newQty}</b> {t.item_uom || ''} ({delta >= 0 ? '+' : ''}{delta})
                            </div>
                        </div>
                    </FormSection>
                    <FormSection title={pkgLabel}>
                        <FieldLabel hint={adjustMode === 'set' ? 'Optional — counted containers, blank to leave untouched.' : 'Optional — container change, may be negative.'}>Containers</FieldLabel>
                        {packagingInputs([
                            ['Cones', adjustCones, setAdjustCones],
                            ['Boxes', adjustBoxes, setAdjustBoxes],
                            ['Drums', adjustDrums, setAdjustDrums],
                        ], adjustMode === 'delta')}
                    </FormSection>
                    <FormSection title="Why">
                        <div style={{ marginBottom: 8 }}>
                            <FieldLabel>Reason</FieldLabel>
                            <select
                                style={{ ...xpSelect, width: '100%' }}
                                value={adjustReason}
                                onChange={e => setAdjustReason(e.target.value)}
                            >
                                {ADJUST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <div>
                            <FieldLabel hint="Optional">Note</FieldLabel>
                            <input
                                type="text" placeholder="e.g. spoiled in transit"
                                style={{ ...xpInput, width: '100%' }}
                                value={adjustNote}
                                onChange={e => setAdjustNote(e.target.value)}
                            />
                        </div>
                    </FormSection>
                </div>
            </ModalWrapper>
        );
    })();

    const newEntryModal = newOpen && (
        <ModalWrapper
            isOpen={newOpen}
            modeless
            onClose={() => setNewOpen(false)}
            title="New Stock Entry"
            size="sm"
            footer={<>
                <button style={xpBtn()} className={XP_BTN} onClick={() => setNewOpen(false)}>Cancel</button>
                <button style={xpBtn()} className={XP_BTN} onClick={handleNewEntry} disabled={savingNew}>
                    {savingNew ? 'Saving...' : 'Save Entry'}
                </button>
            </>}
        >
            <div style={{ fontFamily: xpFont, fontSize: 11}}>
                <FormSection title="Item">
                    <div style={{ marginBottom: newBoundAttrs.length ? 8 : 0 }}>
                        <FieldLabel>Item</FieldLabel>
                        <SearchableSelect
                            options={items.map((it: any) => ({ value: it.code, label: it.name, subLabel: it.code }))}
                            onSearch={onSearchItems}
                            value={newItemCode}
                            onChange={(code: string) => { setNewItemCode(code); setNewAttrIds([]); }}
                            placeholder="Search item..."
                            size="sm"
                        />
                    </div>
                    {newBoundAttrs.map((attr: any, i: number) => (
                        <div key={attr.id} style={{ marginBottom: i === newBoundAttrs.length - 1 ? 0 : 6 }}>
                            <FieldLabel>{attr.name}</FieldLabel>
                            <select
                                style={{ ...xpSelect, width: '100%' }}
                                value={newAttrIds.find(vid => attr.values.some((v: any) => v.id === vid)) || ''}
                                onChange={e => setNewAttrValue(e.target.value, attr.id)}
                            >
                                <option value="">Select {attr.name}...</option>
                                {attr.values.map((v: any) => <option key={v.id} value={v.id}>{v.value}</option>)}
                            </select>
                        </div>
                    ))}
                </FormSection>
                <FormSection title="Quantity">
                    <div style={{ marginBottom: 8 }}>
                        <FieldLabel>Location</FieldLabel>
                        <TreeSelect
                            options={locPickerTreeOptions}
                            value={newLocId}
                            onChange={setNewLocId}
                            placeholder="— select location —"
                            style={{ width: '100%' }}
                            size="sm"
                        />
                    </div>
                    <div>
                        <FieldLabel hint="Negative to subtract">Quantity</FieldLabel>
                        <input
                            type="number" step="any"
                            style={{ ...xpInput, width: '100%' }}
                            value={newQty}
                            onChange={e => setNewQty(e.target.value)}
                        />
                    </div>
                </FormSection>
                <FormSection title="Packaging">
                    <FieldLabel hint="Optional — container tallies booked alongside the quantity.">Containers</FieldLabel>
                    {packagingInputs([
                        ['Cones', newCones, setNewCones],
                        ['Boxes', newBoxes, setNewBoxes],
                        ['Drums', newDrums, setNewDrums],
                    ], true)}
                </FormSection>
                <FormSection title="Why">
                    <div style={{ marginBottom: 8 }}>
                        <FieldLabel>Reason</FieldLabel>
                        <select
                            style={{ ...xpSelect, width: '100%' }}
                            value={newReason}
                            onChange={e => setNewReason(e.target.value)}
                        >
                            {NEW_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>
                    <div>
                        <FieldLabel hint="Optional">Note</FieldLabel>
                        <input
                            type="text"
                            style={{ ...xpInput, width: '100%' }}
                            value={newNote}
                            onChange={e => setNewNote(e.target.value)}
                        />
                    </div>
                </FormSection>
            </div>
        </ModalWrapper>
    );

    // Bootstrap grid (col-md-*) vs the flat XP toolbar are genuinely different layout
    // scaffolding, not duplicated content — wrap each control once here so the actual
    // control props/handlers are defined a single time regardless of theme.
    const col = (cls: string, node: React.ReactNode) => node;

    const toolbarControls = (
        <>
            {col('col-md-4',
                <SearchField value={search} onChange={setSearch}
                    placeholder={'Search item, location, lot, MO, WO, notes...'}
                    width={300}
                    {...({})}
                />
            )}
            <div style={xpSep} />
            {col('col-md-3',
                <TreeSelect
                    options={catTreeOptions}
                    value={selectedCat}
                    onChange={setSelectedCat}
                    allowEmpty
                    emptyLabel="All Categories"
                    {...({ style: { width: 180 } })}
                />
            )}
            {(!!effectiveCat) && col('col-md-1',
                <button
                    style={xpBtn()}
                    className={XP_BTN}
                    onClick={clearCats}
                    disabled={undefined}
                    title="Clear category filter"
                >Clear</button>
            )}
            <div style={xpSep} />
            {col('col-md-3',
                <TreeSelect
                    options={locFilterTreeOptions}
                    value={locSelectValue}
                    onChange={onLocSelect}
                    allowEmpty
                    emptyLabel="All Locations"
                    {...({ style: { width: 200 } })}
                />
            )}
            {(moFilter || woFilter) && col('col-md-2 d-flex align-items-center gap-1', (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {moFilter && (
                        <Chip tone={REF_TONES.producedBy} size="xs" onRemove={() => setMoFilter('')}>
                            MO {moFilter}
                        </Chip>
                    )}
                    {woFilter && (
                        <Chip tone={REF_TONES.producedBy} size="xs" onRemove={() => setWoFilter('')}>
                            WO {woFilter}
                        </Chip>
                    )}
                </div>
            ))}
            <div style={xpSep} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: xpFont, fontSize: '11px', color: '#000', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    title="Hide QC-rejected lots — they are physically in stock but not usable">
                    <input type="checkbox" checked={hideRejected} onChange={e => setHideRejected(e.target.checked)} style={{ margin: 0 }} />
                    Hide rejected
                </label>
            {canEntry && sel.count > 0 && (
                <>
                        <div style={xpSep} />
                        <button className={XP_BTN} style={xpBtn({ ...BTN_TONES.primary })} onClick={openBulkMove}
                            title="Move every selected row to one destination in a single transaction">
                            <i className="bi bi-arrow-left-right" style={{ marginRight: 4 }} />Move {sel.count} selected
                        </button>
                        <button className={XP_BTN} style={xpBtn()} onClick={sel.clear} title="Clear selection">Clear</button>
                    </>)}
            <div style={xpSep} />
            {col('col-md-2',
                <button
                    style={xpBtn()}
                    className={XP_BTN}
                    onClick={() => { refetch(); onRefresh(); }}
                    title={'Refresh'}
                >
                    <i className={'bi bi-arrow-clockwise'} style={{ marginRight: 4 }} />Refresh
                </button>
            )}
            {canRebuild && col('col-md-2',
                <button
                    style={xpBtn()}
                    className={XP_BTN}
                    onClick={handleRebuild} disabled={rebuilding}
                    title="Recompute stock balances from the ledger (use if balances look stale)"
                >
                    <i className={'bi bi-arrow-repeat'} style={{ marginRight: 4 }} />{rebuilding ? 'Rebuilding...' : 'Rebuild'}
                </button>
            )}
            {canEntry && col('col-md-2 ms-auto',
                <ToolbarButton tone="create" icon="bi-plus-lg" style={{ marginLeft: 'auto' }} title="Add stock for an item (new manual entry)" onClick={openNew}>
                    New Entry
                </ToolbarButton>
            )}
        </>
    );

    return (
        <div className="fade-in" style={pageFillStyle}>
            <div
                style={{ ...xpBevel, ...flexFillStyle }}
                className={undefined}
            >
                <div style={xpTitleBar} className={undefined}>
                    <span><i className="bi bi-boxes" style={{ marginRight: 6 }} />{t('stock_on_hand') || 'Stock On-Hand'}</span>
                    <span style={{ fontSize: '10px', opacity: 0.85 }} className={undefined}>{total} records</span>
                </div>
                <div style={xpToolbar}>{toolbarControls}</div>
                <div style={{ flex: 1, overflow: 'auto', background: '#ffffff', minHeight: 0 }} className={undefined}>
                    <ResizableTable colKey="stock-on-hand" style={{ width: '100%', minWidth: TABLE_MIN_WIDTH, borderCollapse: 'collapse', tableLayout: 'fixed' }} className={undefined}>
                        <thead className={undefined}>
                            <tr>
                                <th className={undefined} style={{ ...xpTableHeader, width: COL_W.check, textAlign: 'center' }}>
                                    <SelectAllCheckbox allSelected={sel.allPageSelected} someSelected={sel.someSelected}
                                        disabled={!sel.pageEligibleCount} onChange={sel.togglePage}
                                        title={sel.allPageSelected ? 'Clear selection on this page' : 'Select every movable row on this page'} />
                                </th>
                                <SortableTh sort={sort} colKey="item" onSort={toggleSort} style={{ ...xpTableHeader, width: COL_W.item }}>Item</SortableTh>
                                <th className={undefined} style={{ ...xpTableHeader, textAlign: 'right', width: COL_W.ends }}>Ends</th>
                                <SortableTh sort={sort} colKey="itemCategory" onSort={toggleSort} style={{ ...xpTableHeader, width: COL_W.category }}>Item Category</SortableTh>
                                <SortableTh sort={sort} colKey="location" onSort={toggleSort} style={{ ...xpTableHeader, width: COL_W.location }}>{t('locations') || 'Location'}</SortableTh>
                                <SortableTh sort={sort} colKey="batch" onSort={toggleSort} style={{ ...xpTableHeader, width: COL_W.lot }}>Lot</SortableTh>
                                <SortableTh sort={sort} colKey="mo" onSort={toggleSort} style={{ ...xpTableHeader, width: COL_W.mo }}>MO</SortableTh>
                                <SortableTh sort={sort} colKey="wo" onSort={toggleSort} style={{ ...xpTableHeader, width: COL_W.wo }}>WO</SortableTh>
                                <th style={{ ...xpTableHeader, width: COL_W.attrs }}>{t('attributes') || 'Attributes'}</th>
                                <SortableTh sort={sort} colKey="qty" onSort={toggleSort} style={{ ...xpTableHeader, textAlign: 'right', width: COL_W.qty }} className={undefined}>{t('qty') || 'Qty'}</SortableTh>
                                <th style={{ ...xpTableHeader, width: COL_W.uom }}>UOM</th>
                                <SortableTh sort={sort} colKey="packaging" onSort={toggleSort} style={{ ...xpTableHeader, width: COL_W.packaging }}>Packaging</SortableTh>
                                <SortableTh sort={sort} colKey="notes" onSort={toggleSort} style={{ ...xpTableHeader, width: COL_W.notes }}>Notes</SortableTh>
                                <th style={{ ...xpTableHeader, width: COL_W.actions, borderRight: 'none' }}></th>
                            </tr>
                        </thead>
                        <tbody ref={listBodyRef}>
                            {pageRows.map((bal: any, i: number) => renderRow(bal, i))}
                            {pageRows.length === 0 && (loading ? (
                                <TableSkeleton rows={SKEL_PAGE_ROWS} cols={skel.cols ?? 14} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                            ) : <tr>
                                    <td colSpan={14} style={{ textAlign: 'center', padding: '24px' }}>
                                        <span style={{ fontFamily: xpFont, fontSize: '11px', color: '#666', fontStyle: 'italic' }}>No stock records found</span>
                                    </td>
                                </tr>)}
                        </tbody>
                    </ResizableTable>
                </div>
                <div style={{
                        background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898',
                        padding: '2px 8px', display: 'flex', gap: 16,
                        fontFamily: xpFont, fontSize: '11px', color: '#333',
                    }}>
                        <span><b>{total}</b> rows</span>
                        {negativeCount > 0 && <span style={{ color: '#c00000' }}><b>{negativeCount}</b> negative</span>}
                        {rejectedCount > 0 && (
                            <span style={{ color: '#7a1010' }} title="QC-rejected lots included in the rows above — physically present, not usable">
                                <b>{rejectedCount}</b> rejected ({rejectedQty.toLocaleString('en-US', { maximumFractionDigits: 3 })})
                            </span>
                        )}
                        <span style={{ marginLeft: 'auto', color: '#666' }}>Total: {totalRows} SKUs</span>
                    </div>
                <Pager page={page} total={total} pageSize={STOCK_PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />
            </div>
            {transferModal}
            {bulkMoveModal}
            {adjustModal}
            {newEntryModal}
        </div>
    );
}
