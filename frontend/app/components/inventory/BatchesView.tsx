'use client';

import React, { useState, useRef } from 'react';
import { useToast } from '../shared/Toast';
import ModalWrapper from '../shared/ModalWrapper';
import Pager from '../shared/Pager';
import { useTheme } from '../../context/ThemeContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useConfirm } from '../../context/ConfirmContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import BagLabelPrintModal from '../manufacturing/BagLabelPrintModal';
import LotLabelPrintModal from '../manufacturing/LotLabelPrintModal';
import { useFloatingMenu, MenuTriggerButton, FloatingMenu, useSortable, XPActionButton, ExpandedRowPanel, StatusChip, CODE_FONT, xpFont, TableSkeleton, useTableSkeletonMetrics, rowStateBg, CHIP_RADIUS, OriginChip, VariantChip, xpBtn as xpBtnBase, xpInput as xpInputBase, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { xpBevel as sharedXpBevel, xpTitleBar as sharedXpTitleBar, FilterChipBar, ToolbarButton, SearchField, pageFillStyle } from '../shared/shellTheme';

const LOT_STATUS_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'depleted', label: 'Depleted' },
  { value: '', label: 'All' },
];
import TreeSelect, { buildLocationFilterTree, buildLocationPickerTree, expandLocationFilterValue, buildCategoryTree } from '../shared/TreeSelect';
import SearchableSelect from '../shared/SearchableSelect';
import { useItemSearch, itemToOption } from '../shared/useEntitySearch';
import { lotSizeLabel, lotComboLabel, lotColorLabel, type LotVariantAttr } from '../shared/LotChips';
import { isRejectGrade } from '../shared/rejectDisplay';
import { ExpanderCell, SortableTh, lvZebra, lvThead, lvTh, TableEmpty, EMPTY_DASH } from '../shared/listViewTheme';
import { Tabs, TabDef } from '../shared/Tabs';
import { rejectGradeLabel } from '../shared/rejectDisplay';

const REJECT_TITLE = 'QC reject — lot drops out of good stock; produced qty returns to its MO';
const SPLIT_TITLE = 'Split — peel a portion off into a new lot (prints a label)';
const DISPOSE_TITLE = 'Dispose rejected lot — write off its remaining stock, or reassign it to another item';

// Either reject grade blocks split/re-reject and allows dispose — the grade only
// changes whether pickers still offer the lot (see components/shared/rejectDisplay).

interface Batch {
  id: string;
  batch_number: string;
  vendor_lot: string | null;
  item_id: string;
  item_code: string | null;
  item_name: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  ends: number | null;
  source_wo_id: string | null;
  // Produced-lot size (sized greige/dyed lots); snapshot carries the human label.
  bom_size_id?: string | null;
  bom_size_snapshot?: { size_name?: string | null; label?: string | null } | null;
  // Variant identity of the producing MO — combo/colour, resolved by the batches
  // endpoints. Size lives on the lot; these are what separate two same-size lots.
  variant_attributes?: LotVariantAttr[] | null;
  color_code?: string | null;
  color_name?: string | null;
  color_hex?: string | null;
  labdip_variant_code?: string | null;
  remaining: number | null;
  location_id: string | null;
  location_name: string | null;
  location_path: string[] | null;  // root-first [store, zone, bin]
  quality_status?: string;   // GOOD | REJECTED | REJECT_USABLE | DISPOSED
  // Production origin (beam batches)
  wo_code: string | null;
  mo_id: string | null;
  mo_code: string | null;
  production_run_code: string | null;
  sales_order_code: string | null;
  // GR origin
  po_id: string | null;
  po_number: string | null;
}

interface BatchConsumption {
  id: string;
  manufacturing_order_id: string;
  mo_code: string | null;
  input_batch_id: string;
  output_batch_id: string | null;
  output_batch_number: string | null;
  qty_consumed: number;
  created_at: string;
}

interface Item {
  id: string;
  code: string;
  name: string;
  default_putaway_location_id?: string | null;
}

interface ForwardNode {
  batch: Batch;
  consumptions: ForwardEdge[];
}

interface ForwardEdge extends BatchConsumption {
  child: ForwardNode | null;
}

interface RowTraceState {
  traceBack: any | null;
  forward: ForwardNode | null;
  loading: boolean;
}

interface BatchesViewProps {
  items: Item[];
  locations: any[];
  categories: any[];
  workCenters: any[];
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>;
  apiBase: string;
}

export default function BatchesView({ items, locations, categories, workCenters, authFetch, apiBase }: BatchesViewProps) {
  const { showToast } = useToast();
  const { uiStyle } = useTheme();
  const { formatDate: tzDate } = useTimezone();
  const { confirm } = useConfirm();
  const classic = uiStyle === 'classic';

  const PAGE_SIZE = 50;
  const [itemFilter, setItemFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'depleted'>('active');
  const [locationFilter, setLocationFilter] = useState('');  // '' | 'wh:<id>' | 'loc:<id>'
  const [selectedCat, setSelectedCat] = useState('');
  // Lot type: classifies a lot by the process that produced it — a WorkCenter
  // TYPE's center_type (WEAVING, DYEING, BEAMING, ...), resolved server-side
  // through source_wo -> work_center -> TYPE-root (see /batches/paginated's
  // lot_type param). 'GR' (goods-receipt/manual) and 'PACK' (packed carton) are
  // the two buckets with no producing work center. '' = All.
  const [lotTypeFilter, setLotTypeFilter] = useState('');

  const locationTree = React.useMemo(() => buildLocationFilterTree(locations || []), [locations]);
  const itemFilterOptions = React.useMemo(() => [
    { value: '', label: 'All Items' },
    ...items.map((i: Item) => ({ value: i.id, label: i.name, subLabel: i.code })),
  ], [items]);

  // ── Category filter — same tree-select + descendant-inclusive expansion as
  // Stock On-Hand (components/stock/StockOnHandView.tsx). Sent to the server as a
  // comma-joined id list; the backend just does `Item.category_id IN (...)`.
  const cats = categories || [];
  const catTreeOptions = React.useMemo(() => buildCategoryTree(cats), [cats]);
  const catMatchIds = React.useMemo(() => {
    if (!selectedCat) return '';
    const childrenOf: Record<string, string[]> = {};
    for (const c of cats) {
      if (!c.parent_id) continue;
      (childrenOf[c.parent_id] ||= []).push(c.id);
    }
    const set = new Set<string>();
    const stack = [selectedCat];
    while (stack.length) {
      const id = stack.pop()!;
      if (set.has(id)) continue;
      set.add(id);
      for (const child of (childrenOf[id] || [])) stack.push(child);
    }
    return Array.from(set).join(',');
  }, [cats, selectedCat]);

  // ── Lot type filter — tabs built from whichever WorkCenter TYPE roots actually
  // exist under Routing & Ops (node_type='TYPE'), so a canonical bucket doesn't
  // show up empty just because that production stage hasn't been set up yet, and
  // its label is always whatever that TYPE row is actually named there — never a
  // second hardcoded copy that could drift from a rename on the Routing page.
  // Icons have no Routing & Ops equivalent (WorkCenter carries no icon field), so
  // those alone stay a small cosmetic lookup keyed by center_type.
  // GR and PACK are fixed: they're lots with no producing work center at all, so
  // there's no Routing & Ops row to read a label from.
  // Same shared Tabs strip + 'ALL' sentinel pattern as InventoryView's category tabs.
  const LOT_TYPE_ICON: Record<string, string> = {
    BEAMING: 'bi-record-circle', WARPING: 'bi-diagram-3', WEAVING: 'bi-layers',
    DYEING: 'bi-droplet-half', SETTING: 'bi-thermometer-half', FINISHING: 'bi-check2-circle',
    GENERAL: 'bi-gear',
  };
  const lotTypeTabs: TabDef<string>[] = React.useMemo(() => {
    const seen = new Set<string>();
    const centerTypeTabs = (workCenters || [])
      .filter((wc: any) => wc.node_type === 'TYPE' && wc.center_type)
      .filter((wc: any) => (seen.has(wc.center_type) ? false : (seen.add(wc.center_type), true)))
      .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))
      .map((wc: any) => ({ key: wc.center_type as string, label: wc.name, icon: LOT_TYPE_ICON[wc.center_type] || 'bi-gear' }));
    return [
      { key: 'ALL', label: 'All', icon: 'bi-collection' },
      { key: 'GR', label: 'Goods Receipt', icon: 'bi-truck' },
      ...centerTypeTabs,
      { key: 'PACK', label: 'Packing', icon: 'bi-box-seam' },
    ];
  }, [workCenters]);
  const handleLotTypeTabChange = (key: string) => setLotTypeFilter(key === 'ALL' ? '' : key);

  // Expand the picked warehouse/zone/bin into its full descendant leaf set so a lot
  // recorded at any depth below it still matches. Sent as one comma-joined value —
  // the shared list hook serializes each filter as a single query param, and
  // /batches/paginated accepts both that and the repeated-param form.
  const locationIds = React.useMemo(
    () => (locationFilter ? expandLocationFilterValue(locations || [], locationFilter).join(',') : ''),
    [locations, locationFilter],
  );

  // Page window, debounced search box, fetch, loading flag and the stale-response
  // race guard all come from the shared hook (context/usePaginatedList.ts).
  const {
    rows: batches, total, loading, page, setPage,
    searchInput, setSearch, refetch: fetchBatches,
  } = usePaginatedFetch<Batch>({
    endpoint: `${apiBase}/batches/paginated`,
    authFetch,
    pageSize: PAGE_SIZE,
    params: {
      item_id: itemFilter,
      status: statusFilter,
      location_id: locationIds,
      category_id: catMatchIds,
      lot_type: lotTypeFilter,
    },
    onError: () => showToast('Failed to load lots', 'danger'),
  });

  // Create form
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createItemId, setCreateItemId] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [createQty, setCreateQty] = useState('');
  const [createLocId, setCreateLocId] = useState('');
  // Server typeahead: `items` is only DataContext's current page, so an item off
  // that page is unreachable by typing in a client-filtered list.
  const { results: createItemResults, onSearch: onSearchCreateItem, resolve: resolveCreateItem } =
    useItemSearch({ seed: items, enabled: isCreateOpen });
  const createItemOptions = React.useMemo(
    () => (createItemResults || []).map(itemToOption),
    [createItemResults],
  );
  const [creating, setCreating] = useState(false);

  // Expandable row trace state
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [rowTraceData, setRowTraceData] = useState<Record<string, RowTraceState>>({});

  // QC reject
  const [rejectBatch, setRejectBatch] = useState<Batch | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectQty, setRejectQty] = useState('');
  const [rejectLocId, setRejectLocId] = useState('');
  // Reject grade: false = REJECTED (scrap-bound, out of every picker), true =
  // REJECT_USABLE (quarantined and out of availability, still pickable).
  const [rejectUsable, setRejectUsable] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  // Rejected stock is quarantined, so the picker is a leaf-selectable location tree.
  const locationPickerTree = React.useMemo(() => buildLocationPickerTree(locations || []), [locations]);
  // A plant normally keeps one defect/quarantine store — preselect it by name so the
  // common case is one click, while any location stays selectable.
  const defaultDefectLocId = React.useMemo(() => {
    const hit = (locations || []).find((l: any) => /defect|reject|quarantine|scrap|karantina|cacat/i.test(`${l.name || ''} ${l.code || ''}`));
    return hit ? String(hit.id) : '';
  }, [locations]);

  const openReject = (b: Batch) => {
    setRejectBatch(b);
    setRejectReason('');
    setRejectQty(b.remaining != null ? String(Number(b.remaining)) : '');
    setRejectLocId(defaultDefectLocId);
  };

  // Split — peel a portion of a lot into a new GOOD sub-lot, then offer to print
  // its label. Same /batches/{id}/split the dyeing stager uses for leftovers.
  const [splitBatch, setSplitBatch] = useState<Batch | null>(null);
  const [splitQty, setSplitQty] = useState('');
  const [splitReason, setSplitReason] = useState('');
  const [splitting, setSplitting] = useState(false);
  const [lotLabels, setLotLabels] = useState<any[] | null>(null);

  const openSplit = (b: Batch) => {
    setSplitBatch(b);
    setSplitQty('');
    setSplitReason('');
  };

  // Disposition panel for a rejected lot: write off, or recycle into another item.
  const [disposeBatch, setDisposeBatch] = useState<Batch | null>(null);
  const [disposeMode, setDisposeMode] = useState<'writeoff' | 'reassign'>('writeoff');
  const [disposeReason, setDisposeReason] = useState('');
  const [reassignItemId, setReassignItemId] = useState('');
  const [reassignQty, setReassignQty] = useState('');
  const [reassignLocId, setReassignLocId] = useState('');
  const [disposing, setDisposing] = useState(false);
  // Same server typeahead as the create form — `items` is one page of /items, so
  // the item this lot is being recycled into may not be in it.
  const { results: reassignItemResults, onSearch: onSearchReassignItem, resolve: resolveReassignItem } =
    useItemSearch({ seed: items, enabled: !!disposeBatch });
  const reassignItemOptions = React.useMemo(
    () => (reassignItemResults || []).filter((i: any) => String(i.id) !== String(disposeBatch?.item_id || '')).map(itemToOption),
    [reassignItemResults, disposeBatch],
  );

  const openDispose = (b: Batch) => {
    setDisposeBatch(b);
    setDisposeMode('writeoff');
    setDisposeReason('');
    setReassignItemId('');
    setReassignQty(b.remaining != null ? String(Number(b.remaining)) : '');
    // Default: leave the goods where they are (the defect store). Picking the
    // target item overrides this with its default putaway bin.
    setReassignLocId('');
  };

  const onReassignItemChange = (id: string) => {
    setReassignItemId(id);
    const it: any = resolveReassignItem(id);
    setReassignLocId(it?.default_putaway_location_id ? String(it.default_putaway_location_id) : '');
  };

  const handleSplit = async () => {
    if (!splitBatch) return;
    const rem = Number(splitBatch.remaining ?? 0);
    const q = parseFloat(splitQty);
    if (isNaN(q) || q <= 0) { showToast('Split qty must be positive', 'warning'); return; }
    if (q >= rem - 1e-9) { showToast(`Split qty must be less than remaining (${rem.toFixed(2)})`, 'warning'); return; }
    setSplitting(true);
    try {
      const res = await authFetch(`${apiBase}/batches/${splitBatch.id}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty: q, reason: splitReason.trim() || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Split failed');
      }
      const sub = await res.json();
      showToast(`Split ${q.toFixed(2)} off → ${sub.batch_number}`, 'success');
      setSplitBatch(null);
      fetchBatches();
      setLotLabels([sub]);   // auto-open the print preview for the new leftover lot
    } catch (e: any) {
      showToast(e.message, 'danger');
    } finally {
      setSplitting(false);
    }
  };

  // Output-label reprint. GRG (greige) bags and BM- (warp beam) lots are both born
  // as MOCompletions; fetch the origin MO, find the completion that produced this
  // lot, and hand it to the same BagLabelPrintModal the WO page uses, which picks
  // the bag or beam card off the lot prefix — full-fidelity label, no new payload.
  const [labelData, setLabelData] = useState<{ bags: any[]; wo: any; mo: any; seqStart: number } | null>(null);
  const { openId, pos, toggle, close } = useFloatingMenu(160);

  const openBatchLabel = async (b: Batch) => {
    // Try for the rich weaving bag label (Warna/Lebar/Rak/bag#), which needs the
    // originating MOCompletion. Split leftovers (GRG-…-S1) and manual lots have no
    // completion of their own — fall back to the generic lot label off the Batch.
    if (b.mo_id) {
      const res = await authFetch(`${apiBase}/manufacturing-orders/${b.mo_id}`);
      if (res.ok) {
        const mo = await res.json();
        const comps = (mo.completions || []).filter((c: any) => !c.rejected && c.output_batch_number);
        const comp = comps.find((c: any) => String(c.output_batch_id || '') === String(b.id))
          || comps.find((c: any) => c.output_batch_number === b.batch_number);
        if (comp) {
          const wo = (mo.work_orders || []).find((w: any) => String(w.id) === String(comp.work_order_id || b.source_wo_id || '')) || null;
          // Bag sequence = this completion's order among its WO's non-rejected lotted bags.
          const woBags = comps
            .filter((c: any) => String(c.work_order_id || '') === String(comp.work_order_id || ''))
            .sort((a: any, c: any) => new Date(a.created_at).getTime() - new Date(c.created_at).getTime());
          const seqStart = Math.max(1, woBags.findIndex((c: any) => String(c.id) === String(comp.id)) + 1);
          setLabelData({ bags: [comp], wo, mo, seqStart });
          return;
        }
      }
    }
    // Fallback: plain lot sticker straight off the Batch (split leftovers etc.).
    setLotLabels([b]);
  };

  // Picking the item preselects its default putaway bin, same priority the
  // production putaway suggestion starts from.
  const onCreateItemChange = (id: string) => {
    setCreateItemId(id);
    const it = resolveCreateItem(id);
    setCreateLocId(it?.default_putaway_location_id ? String(it.default_putaway_location_id) : '');
  };

  const handleCreate = async () => {
    if (!createItemId) { showToast('Select an item', 'warning'); return; }
    const qty = parseFloat(createQty);
    if (createQty !== '' && (isNaN(qty) || qty < 0)) { showToast('Quantity must be a positive number', 'warning'); return; }
    const hasQty = createQty !== '' && !isNaN(qty) && qty > 0;
    if (hasQty && !createLocId) { showToast('Select a location for the opening quantity', 'warning'); return; }
    setCreating(true);
    try {
      const res = await authFetch(`${apiBase}/batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: createItemId,
          notes: createNotes || null,
          qty: hasQty ? qty : null,
          location_id: hasQty ? createLocId : null,
        }),
      });
      if (res.ok) {
        showToast('Lot created', 'success');
        setIsCreateOpen(false);
        setCreateItemId('');
        setCreateNotes('');
        setCreateQty('');
        setCreateLocId('');
        fetchBatches();
      } else {
        const err = await res.json();
        showToast(err.detail || 'Failed to create lot', 'danger');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (batch: Batch) => {
    const ok = await confirm({
      title: 'Delete Lot',
      message: `Delete lot ${batch.batch_number}? Stock linked to this lot will lose its lot reference.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    const res = await authFetch(`${apiBase}/batches/${batch.id}`, { method: 'DELETE' });
    if (res.ok) { showToast('Deleted', 'success'); fetchBatches(); }
    else showToast('Delete failed', 'danger');
  };

  // QC disposition: lot flagged REJECTED (drops out of good stock/pickers);
  // if it was born from a production log, that qty returns to the MO's progress.
  const handleReject = async () => {
    if (!rejectBatch) return;
    const remaining = Number(rejectBatch.remaining ?? 0);
    const q = parseFloat(rejectQty);
    if (rejectQty !== '' && (isNaN(q) || q <= 0)) { showToast('Reject qty must be positive', 'warning'); return; }
    if (!isNaN(q) && q > remaining + 1e-9) { showToast(`Reject qty exceeds remaining (${remaining})`, 'warning'); return; }
    // Omit qty (full reject) when the field is blank or covers the whole balance.
    const partial = rejectQty !== '' && !isNaN(q) && q < remaining - 1e-9;
    setRejecting(true);
    try {
      const res = await authFetch(`${apiBase}/batches/${rejectBatch.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: rejectReason.trim() || null,
          qty: partial ? q : null,
          // Defect store: the rejected stock is transferred there so it never sits
          // on the good-stock shelf. Blank = the server routes it (producing work
          // centre's reject location, then the item master default).
          location_id: rejectLocId || null,
          // Downgrade rather than scrap — the lot stays pickable for consumption
          // (a rejected warp beam still weaves certain items).
          usable: rejectUsable,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to reject lot');
      }
      const destName = rejectLocId
        ? ((locations || []).find((l: any) => String(l.id) === rejectLocId)?.name || '')
        : '';
      showToast(
        `Lot ${rejectBatch.batch_number} rejected${rejectUsable ? ' (usable)' : ''}${destName ? ` — moved to ${destName}` : ''}`,
        'success',
      );
      setRejectBatch(null);
      setRejectReason('');
      setRejectLocId('');
      setRejectUsable(false);
      fetchBatches();
    } catch (err: any) {
      showToast(err.message, 'danger');
    } finally {
      setRejecting(false);
    }
  };

  // Disposition of a rejected lot — two exits, one panel. Write-off physically
  // scraps the remaining stock (deducts from on-hand, like a consumed beam);
  // reassign recycles it into a different item instead, because reject is not
  // always scrap (a beam rejected for one cloth still warps a coarser one).
  const handleDispose = async () => {
    if (!disposeBatch) return;
    const batch = disposeBatch;
    setDisposing(true);
    try {
      if (disposeMode === 'reassign') {
        const rem = Number(batch.remaining ?? 0);
        const q = parseFloat(reassignQty);
        if (!reassignItemId) { showToast('Pick the item to reassign this lot to', 'warning'); return; }
        if (isNaN(q) || q <= 0) { showToast('Reassign qty must be positive', 'warning'); return; }
        if (q > rem + 1e-9) { showToast(`Reassign qty exceeds remaining (${rem.toFixed(2)})`, 'warning'); return; }
        const res = await authFetch(`${apiBase}/batches/${batch.id}/reassign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_id: reassignItemId,
            // Omit qty when it covers the whole balance — the server then moves
            // exactly what's on hand rather than a client-rounded number.
            qty: q < rem - 1e-9 ? q : null,
            location_id: reassignLocId || null,
            reason: disposeReason.trim() || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || 'Failed to reassign lot');
        }
        const newLot = await res.json();
        showToast(`Reassigned ${q.toFixed(2)} → ${newLot.batch_number} (${newLot.item_code || ''})`, 'success');
        setDisposeBatch(null);
        fetchBatches();
        setLotLabels([newLot]);   // the recycled goods need a new label on the rack
        return;
      }
      const res = await authFetch(`${apiBase}/batches/${batch.id}/dispose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: disposeReason.trim() || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to dispose lot');
      }
      showToast(`Lot ${batch.batch_number} disposed`, 'success');
      setDisposeBatch(null);
      fetchBatches();
    } catch (err: any) {
      showToast(err.message, 'danger');
    } finally {
      setDisposing(false);
    }
  };

  // The forward endpoint only returns one hop (this batch -> what consumed it).
  // To show the full downstream pipeline (Beam -> Greige -> Dyed Lot -> ...) we
  // chase each resulting output batch's own /trace recursively, client-side —
  // mirrors what trace-back already does server-side for the backward direction.
  const fetchForwardTree = async (batchId: string, depth = 0, visited: Set<string> = new Set()): Promise<ForwardNode | null> => {
    if (depth >= 6 || visited.has(batchId)) return null;
    visited.add(batchId);
    const res = await authFetch(`${apiBase}/batches/${batchId}/trace`);
    if (!res.ok) return null;
    const data = await res.json();
    const consumptions: BatchConsumption[] = data.consumptions || [];
    const edges: ForwardEdge[] = await Promise.all(consumptions.map(async c => ({
      ...c,
      child: c.output_batch_id ? await fetchForwardTree(c.output_batch_id, depth + 1, visited) : null,
    })));
    return { batch: data.batch, consumptions: edges };
  };

  const toggleExpand = async (b: Batch) => {
    const wasOpen = !!expandedRows[b.id];
    setExpandedRows(prev => ({ ...prev, [b.id]: !wasOpen }));
    if (!wasOpen && !rowTraceData[b.id]) {
      setRowTraceData(prev => ({ ...prev, [b.id]: { traceBack: null, forward: null, loading: true } }));
      const [traceBackRes, forward] = await Promise.all([
        authFetch(`${apiBase}/batches/${b.id}/trace-back`),
        fetchForwardTree(b.id),
      ]);
      const traceBack = traceBackRes.ok ? await traceBackRes.json() : null;
      setRowTraceData(prev => ({ ...prev, [b.id]: { traceBack, forward, loading: false } }));
    }
  };

  const itemMap = Object.fromEntries(items.map(i => [i.id, i]));

  const isDepleted = (b: Batch) => (b.remaining ?? 0) <= 0;

  const batchItemCode = (b: Batch) => b.item_code || itemMap[b.item_id]?.code || '—';

  // Client-side sort of the current page (list is server-paginated). Mirrors the
  // WO table: click a header to toggle asc → desc → off shows the arrow.
  const sortCols = React.useMemo(() => ({
    lot:       (b: Batch) => b.batch_number,
    product:   (b: Batch) => batchItemCode(b),
    origin:    (b: Batch) => b.sales_order_code || b.po_number || null,
    wo:        (b: Batch) => b.wo_code || null,
    mo:        (b: Batch) => b.mo_code || null,
    pr:        (b: Batch) => b.production_run_code || null,
    location:  (b: Batch) => (b.location_path && b.location_path.join(' / ')) || b.location_name || null,
    remaining: (b: Batch) => b.remaining ?? null,
    ends:      (b: Batch) => b.ends ?? null,
    notes:     (b: Batch) => b.notes || null,
    created:   (b: Batch) => b.created_at || null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [itemMap]);
  const { sorted: sortedBatches, sort, toggle: toggleSort } = useSortable(batches, sortCols, null);

  // Skeleton sizing: measure one real row so the placeholders shown on the next
  // load are exactly as tall as the rows that replace them.
  const listBodyRef = useRef<HTMLTableSectionElement>(null);
  const skel = useTableSkeletonMetrics(classic ? 'lots-classic' : 'lots', listBodyRef, sortedBatches.length > 0);

  // Small pill/chip — the shared shape for Origin (SO/PO), MO/PR, and Location
  // badges. Square in classic (XP), rounded in modern. Kept on a single line so
  // every table row holds a consistent height.
  const chip = (
    label: React.ReactNode,
    fg: string, bg: string, border: string,
    opts: { mono?: boolean; title?: string } = {},
  ) => (
    <span
      title={opts.title}
      style={{
        display: 'inline-block', fontSize: classic ? 9 : 10, fontWeight: 'bold',
        padding: '0 5px', borderRadius: CHIP_RADIUS, lineHeight: classic ? '14px' : '16px',
        color: fg, background: bg, border: `1px solid ${border}`, whiteSpace: 'nowrap',
        fontFamily: opts.mono ? CODE_FONT : undefined,
      }}
    >
      {label}
    </span>
  );

  // Chips stay on one line — the table scrolls horizontally instead of growing
  // rows taller, so every row keeps a uniform height.
  const chipRow = (children: React.ReactNode) => (
    <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 3, alignItems: 'center', whiteSpace: 'nowrap' }}>{children}</div>
  );

  const emDash = <span style={{ color: '#ccc' }}>—</span>;

  // Origin — customer/supplier source only (SO + PO), as badges.
  const originCell = (b: Batch) => {
    const chips: React.ReactNode[] = [];
    if (b.sales_order_code) chips.push(<OriginChip kind="so" code={b.sales_order_code} classic={classic} />);
    if (b.po_number) chips.push(<OriginChip kind="po" code={b.po_number} classic={classic}
      title={b.vendor_lot ? `Supplier Lot: ${b.vendor_lot}` : undefined} />);
    return chips.length ? chipRow(chips.map((c, i) => <React.Fragment key={i}>{c}</React.Fragment>)) : emDash;
  };

  // WO / MO / PR — internal production origin, one column each so a lot with
  // more than one of them doesn't crowd a single cell.
  const woCell = (b: Batch) => b.wo_code ? <OriginChip kind="wo" code={b.wo_code} classic={classic} prefix={false} truncate /> : emDash;
  const moCell = (b: Batch) => b.mo_code ? <OriginChip kind="mo" code={b.mo_code} classic={classic} prefix={false} truncate /> : emDash;
  const prCell = (b: Batch) => b.production_run_code ? <OriginChip kind="pr" code={b.production_run_code} classic={classic} truncate /> : emDash;

  // WO/MO/PR share one fixed width so the three origin columns line up — codes are
  // clipped with an ellipsis and pop out unclipped on hover (Chip's truncate prop).
  const ORIGIN_COL_W = 150;

  // Attributes (size/combo/shade chips, split out of the Item column) gets its own
  // width so a row with all three isn't cramped.
  const ATTRS_COL_W = 220;

  // Location — Store / Zone / Bin as distinct badges (root-first hierarchy).
  const LOC_LEVEL = [
    { fg: '#33506e', bg: '#e2e9f2', border: '#a8bcd0' },  // Store (warehouse)
    { fg: '#2e6070', bg: '#e2eef0', border: '#a8ccd0' },  // Zone
    { fg: '#3a6b2a', bg: '#e8f0e2', border: '#b8d0a8' },  // Bin
  ];
  const locationCell = (b: Batch) => {
    const path = b.location_path && b.location_path.length ? b.location_path : (b.location_name ? [b.location_name] : []);
    if (!path.length) return emDash;
    return chipRow(path.map((name, i) => {
      const lvl = LOC_LEVEL[Math.min(i, LOC_LEVEL.length - 1)];
      return <React.Fragment key={i}>{chip(name, lvl.fg, lvl.bg, lvl.border)}</React.Fragment>;
    }));
  };

  // Created — date on line 1, created-by as a small chip underneath.
  const createdCell = (b: Batch) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.2, alignItems: 'flex-start' }}>
      <span>{tzDate(b.created_at)}</span>
      {b.created_by && chip(b.created_by, '#555', '#eceae2', '#c4c2ba')}
    </div>
  );

  // Product — item code on line 1, then what the lot actually IS as chips: size
  // (from the lot's stamped bom_size_snapshot), combo and shade (from the producing
  // MO's variant attributes). Same identity vocabulary as the staging/completion
  // One chip for the lot's quality grade in both themes. The vocabulary comes
  // from rejectDisplay so a rejected lot reads the same here as on the
  // completion log that rejected it.
  const qualityChip = (b: any) => {
    const label = rejectGradeLabel(b.quality_status);
    if (!label) return null;
    return (
      <StatusChip
        status={b.quality_status}
        label={label}
        tint
        style={{ marginLeft: 5 }}
        title={b.quality_status === 'REJECT_USABLE'
          ? 'Rejected but still usable — out of availability planning, still offered in consumption pickers'
          : undefined}
      />
    );
  };

  // Product — just the item code. Size/combo/shade identity moved to its own
  // Attributes column (attrsCell below) so it isn't cramped under the item.
  const productCell = (b: Batch) => <span>{batchItemCode(b)}</span>;

  // Attributes — what the lot actually IS: size (from the lot's stamped
  // bom_size_snapshot), combo and shade (from the producing MO's variant
  // attributes). Same identity vocabulary as the staging/completion lot pickers —
  // see components/shared/LotChips.tsx for the label rules.
  const attrsCell = (b: Batch) => {
    const sz = lotSizeLabel(b);
    const combo = lotComboLabel(b);
    const shade = lotColorLabel(b);
    if (!sz && !combo && !shade) return emDash;
    return chipRow(
      <>
        {sz && <VariantChip kind="size" classic={classic} title={`Size: ${sz}`}>{sz}</VariantChip>}
        {combo && <VariantChip kind="combo" classic={classic} title={`Combo: ${combo}`}>{combo}</VariantChip>}
        {shade && (shade.pending
          ? <VariantChip kind="pending" classic={classic} title={`Shade pending lab dip approval: ${shade.label}`}>{shade.label} (pending)</VariantChip>
          : <VariantChip kind="color" classic={classic} swatch={shade.hex} title={`Color: ${shade.label}`}>{shade.label}</VariantChip>)}
      </>,
    );
  };

  // Notes — single line, ellipsised. Free text would otherwise stretch the
  // (now nowrap) table arbitrarily wide; full text stays on hover.
  const notesCell = (b: Batch) => (
    b.notes
      ? <span title={b.notes} style={{ display: 'block', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.notes}</span>
      : EMPTY_DASH
  );

  // Remaining — value with the green (or gray, if depleted) status dot pinned to
  // the far right so every row's dot aligns in a column.
  const remainingCell = (b: Batch) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
      <span>{b.remaining != null ? Number(b.remaining).toFixed(2) : '—'}</span>
      <span style={{
        display: 'inline-block', width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        background: isDepleted(b) ? '#b8b8b8' : '#3a9b3a',
        border: isDepleted(b) ? '1px solid #999' : '1px solid #2a7a2a',
      }} />
    </div>
  );

  // Stage classification purely from the batch-number prefix — the manufacturing
  // completion route stamps GR- (goods receipt), BM- (beam), GRG- (greige/weaving),
  // DYE- (dyed lot), LOT-/BAT- (generic). Colors mirror the work-center chip
  // palette used elsewhere (getChipStyle in WorkOrderPanel.tsx) for consistency.
  type StageMeta = { label: string; bg: string; fg: string; border: string; icon: string };
  const STAGE_META: Record<string, StageMeta> = {
    GR:  { label: 'Goods Receipt', bg: '#fdf3d8', fg: '#7a4500', border: '#e0c080', icon: 'bi-truck' },
    BM:  { label: 'Beam',          bg: '#fce8ff', fg: '#660088', border: '#dda8f0', icon: 'bi-record-circle' },
    GRG: { label: 'Greige',        bg: '#e8d8ff', fg: '#440099', border: '#c4a8ee', icon: 'bi-layers' },
    DYE: { label: 'Dyed Lot',      bg: '#cce4ff', fg: '#004b99', border: '#99c4ee', icon: 'bi-droplet-half' },
    PACK:{ label: 'Packaging',     bg: '#d4f0d4', fg: '#005500', border: '#99cc99', icon: 'bi-box-seam' },
    RCY: { label: 'Recycled',      bg: '#ffe8cc', fg: '#8a4b00', border: '#e6b980', icon: 'bi-arrow-repeat' },
  };
  const DEFAULT_STAGE: StageMeta = { label: 'Lot', bg: '#e4e2dc', fg: '#444444', border: '#c4c2ba', icon: 'bi-tag' };
  const classifyLot = (batchNumber?: string | null): StageMeta => {
    const prefix = (batchNumber || '').split('-')[0].toUpperCase();
    return STAGE_META[prefix] || DEFAULT_STAGE;
  };

  // Flatten a recursive tree into left-to-right levels via BFS, so each level
  // renders as one column of connected boxes regardless of branching.
  const levelsFrom = (roots: any[], getChildren: (n: any) => any[]): any[][] => {
    const levels: any[][] = [];
    let frontier = roots;
    let guard = 0;
    while (frontier.length && guard < 6) {
      levels.push(frontier);
      frontier = frontier.flatMap(getChildren);
      guard++;
    }
    return levels;
  };

  const renderExpandedPanel = (b: Batch) => {
    const state = rowTraceData[b.id];
    const fnt: React.CSSProperties = classic ? { fontFamily: xpFont, fontSize: 11 } : { fontSize: 13 };
    const focalMeta = classifyLot(b.batch_number);

    // Ancestor levels: level 0 = immediate inputs, deepest last — reversed for
    // left-to-right display (oldest/rawest material first).
    const backLevels = levelsFrom(state?.traceBack?.inputs || [], (n: any) => n.inputs || []);
    const ancestorLevels = [...backLevels].reverse();

    // Descendant levels: level 0 = immediate consumption edges.
    const fwdLevels = levelsFrom(state?.forward?.consumptions || [], (e: ForwardEdge) => e.child?.consumptions || []);
    const lastFwdBatches = fwdLevels.length ? fwdLevels[fwdLevels.length - 1].map((e: ForwardEdge) => e.output_batch_number) : [];
    const showPackagingGhost = focalMeta === STAGE_META.DYE && fwdLevels.length === 0;
    const showPackagingContinuation = lastFwdBatches.some((n: string | null) => classifyLot(n) === STAGE_META.DYE);

    const NodeBox = ({ meta, title, subtitle, tag, ghost, focal }: {
      meta: StageMeta; title: React.ReactNode; subtitle?: React.ReactNode; tag?: React.ReactNode;
      ghost?: boolean; focal?: boolean;
    }) => (
      <div style={{
        ...fnt,
        minWidth: 128, maxWidth: 168,
        border: `1px solid ${ghost ? '#c8c8c8' : meta.border}`,
        borderStyle: ghost ? 'dashed' : 'solid',
        borderWidth: focal ? 2 : 1,
        background: ghost ? (classic ? '#f0ede4' : '#f8f9fa') : meta.bg,
        opacity: ghost ? 0.75 : 1,
        boxShadow: focal ? '0 0 0 2px rgba(0,88,230,0.25)' : classic ? '1px 1px 2px rgba(0,0,0,0.15)' : '0 1px 2px rgba(0,0,0,0.08)',
        padding: '5px 8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: classic ? 8 : 9, fontWeight: 'bold', textTransform: 'uppercase', color: ghost ? '#999' : meta.fg, letterSpacing: 0.3, marginBottom: 2 }}>
          <i className={`bi ${meta.icon}`} />
          {meta.label}
        </div>
        <div style={{ fontWeight: 'bold', color: ghost ? '#999' : '#000', fontStyle: ghost ? 'italic' : 'normal', wordBreak: 'break-word' }}>
          {title}
        </div>
        {subtitle && <div style={{ color: '#666', fontSize: classic ? 9 : 11, marginTop: 1 }}>{subtitle}</div>}
        {tag && <div style={{ color: '#888', fontSize: classic ? 9 : 11, marginTop: 1 }}>{tag}</div>}
      </div>
    );

    const Connector = () => (
      <div style={{ display: 'flex', alignItems: 'center', color: '#aaa', fontSize: 16, flexShrink: 0, alignSelf: 'center' }}>
        <i className="bi bi-chevron-right" />
      </div>
    );

    const Column = ({ children }: { children: React.ReactNode }) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>{children}</div>
    );

    return (
      <ExpandedRowPanel classic={classic} style={{
        padding: '12px 14px',
        whiteSpace: 'normal',   // table rows are nowrap; lineage boxes wrap normally
        ...fnt,
      }}>
        <div style={{ fontWeight: 'bold', color: '#555', fontSize: classic ? 9 : 11, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 }}>
          Lineage
        </div>
        {state?.loading ? (
          <div style={{ color: '#888', padding: 8 }}>Loading lineage...</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {/* Ancestors: rawest material first, flowing toward the focal lot */}
            {ancestorLevels.map((level, li) => (
              <React.Fragment key={`anc-${li}`}>
                <Column>
                  {level.map((n: any, ni: number) => {
                    const meta = classifyLot(n.batch.batch_number);
                    return (
                      <NodeBox
                        key={`${n.batch.id}-${ni}`}
                        meta={meta}
                        title={n.batch.batch_number}
                        subtitle={n.batch.item_code || itemMap[n.batch.item_id]?.code}
                        tag={n.batch.po_number
                          ? `PO ${n.batch.po_number}`
                          : n.qty_consumed != null
                            ? `${n.qty_consumed} used${n.mo_code ? ` in ${n.mo_code}` : ''}`
                            : undefined}
                      />
                    );
                  })}
                </Column>
                <Connector />
              </React.Fragment>
            ))}

            {/* Focal lot — this row */}
            <NodeBox
              focal
              meta={focalMeta}
              title={b.batch_number}
              subtitle={batchItemCode(b)}
              tag={b.remaining != null ? `${Number(b.remaining).toFixed(2)} remaining` : undefined}
            />

            {/* Descendants: what this lot became, hop by hop */}
            {fwdLevels.map((level, li) => (
              <React.Fragment key={`fwd-${li}`}>
                <Connector />
                <Column>
                  {level.map((e: ForwardEdge, ei: number) => {
                    if (!e.output_batch_number) {
                      return (
                        <NodeBox
                          key={e.id || ei}
                          ghost
                          meta={DEFAULT_STAGE}
                          title="Consumed"
                          subtitle={e.mo_code || undefined}
                          tag={`${e.qty_consumed} used — no output lot`}
                        />
                      );
                    }
                    const meta = classifyLot(e.output_batch_number);
                    return (
                      <NodeBox
                        key={e.id || ei}
                        meta={meta}
                        title={e.output_batch_number}
                        subtitle={e.mo_code || undefined}
                        tag={`${e.qty_consumed} used`}
                      />
                    );
                  })}
                </Column>
              </React.Fragment>
            ))}

            {/* Future stage placeholder — Packaging isn't tracked as lots yet */}
            {(showPackagingGhost || showPackagingContinuation) && (
              <>
                <Connector />
                <NodeBox ghost meta={STAGE_META.PACK} title="Packaging" tag="Coming soon" />
              </>
            )}

            {!ancestorLevels.length && !fwdLevels.length && !showPackagingGhost && (
              <div style={{ color: '#bbb', fontStyle: 'italic', alignSelf: 'center', padding: '0 8px' }}>
                No linked lots — nothing consumed to make this, not yet consumed by anything.
              </div>
            )}
          </div>
        )}
      </ExpandedRowPanel>
    );
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const xpBevel: React.CSSProperties = classic ? sharedXpBevel() : {};

  const xpTitleBar: React.CSSProperties = classic ? sharedXpTitleBar() : {};

  const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties =>
    classic ? xpBtnBase(extra) : { cursor: 'pointer', ...extra };

  const xpInput: React.CSSProperties = classic ? xpInputBase() : {};

  // minWidth + nowrap: cells never wrap, the table scrolls sideways instead. Keeps
  // multi-chip rows (Product / WO-MO-PR / Location) one line tall.
  const TABLE_MIN_W = 1500 + ATTRS_COL_W;

  const xpTable: React.CSSProperties = classic ? {
    fontFamily: xpFont, fontSize: '11px', width: '100%', minWidth: TABLE_MIN_W,
    borderCollapse: 'collapse', whiteSpace: 'nowrap',
  } : { width: '100%', minWidth: TABLE_MIN_W, whiteSpace: 'nowrap' };

  const xpTd = (alt: boolean): React.CSSProperties => classic ? {
    border: '1px solid #c8c8c8', padding: '2px 6px',
    background: lvZebra(true, alt ? 1 : 0), verticalAlign: 'middle',
  } : { verticalAlign: 'middle' };

  const colSpan = 14; // Chevron, Lot Number, Item, Ends, Attributes, Origin, WO, MO, PR, Location, Remaining, Notes, Created, Actions

  // Fixed row height keeps the table visually even despite multi-badge cells.
  const ROW_H = classic ? 40 : 44;

  return (
    <div className="fade-in" style={pageFillStyle}>
      {classic ? (
        <div style={{ ...xpBevel, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {/* ── Title bar ── */}
          <div style={xpTitleBar}>
            <span>Lot Management</span>
          </div>
          {/* ── Lot type tabs — classifies by the process that produced the lot ── */}
          <Tabs<string> tabs={lotTypeTabs} activeKey={lotTypeFilter || 'ALL'} onChange={handleLotTypeTabChange} classic />
          {/* ── Filter/search bar + actions ── */}
          <div style={{ padding: '6px 8px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898', flexShrink: 0 }}>
            <SearchField classic value={searchInput} onChange={setSearch} placeholder="Search lot, item, WO/MO/PR, SO..." width={240} />
            <span style={{ fontFamily: xpFont, fontSize: 11 }}>Item:</span>
            <div style={{ width: 200, flexShrink: 0 }}>
              <SearchableSelect options={itemFilterOptions} value={itemFilter} onChange={setItemFilter} placeholder="All Items" size="sm" />
            </div>
            <span style={{ fontFamily: xpFont, fontSize: 11 }}>Category:</span>
            <TreeSelect
              options={catTreeOptions}
              value={selectedCat}
              onChange={setSelectedCat}
              allowEmpty
              emptyLabel="All Categories"
              style={{ width: 180 }}
            />
            <span style={{ fontFamily: xpFont, fontSize: 11 }}>Location:</span>
            <TreeSelect
              options={locationTree}
              value={locationFilter}
              onChange={setLocationFilter}
              allowEmpty
              emptyLabel="All Locations"
              placeholder="All Locations"
              style={{ width: 200 }}
            />
            <span style={{ fontFamily: xpFont, fontSize: 11 }}>Status:</span>
            <FilterChipBar
              classic
              options={LOT_STATUS_FILTERS}
              value={statusFilter}
              onChange={v => setStatusFilter(v as '' | 'active' | 'depleted')}
            />
            <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
              <ToolbarButton classic tone="neutral" icon="bi-arrow-clockwise" onClick={fetchBatches}>Refresh</ToolbarButton>
              <ToolbarButton classic tone="create" icon="bi-plus" onClick={() => setIsCreateOpen(true)}>New Lot</ToolbarButton>
            </span>
          </div>

          {/* ── Table ── */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', minHeight: 0, background: '#ffffff', scrollbarGutter: 'stable' } as React.CSSProperties}>
            <table style={xpTable}>
              <thead style={lvThead(true, true)}>
                <tr>
                  <th style={{ ...lvTh(true), width: 20 }}></th>
                  <SortableTh sort={sort} colKey="lot" onSort={toggleSort} style={lvTh(true)}>Lot Number</SortableTh>
                  <SortableTh sort={sort} colKey="product" onSort={toggleSort} style={lvTh(true)}>Item</SortableTh>
                  <SortableTh sort={sort} colKey="ends" onSort={toggleSort} style={{ ...lvTh(true), textAlign: 'right' }}>Ends</SortableTh>
                  <th style={{ ...lvTh(true), width: ATTRS_COL_W, maxWidth: ATTRS_COL_W }}>Attributes</th>
                  <SortableTh sort={sort} colKey="origin" onSort={toggleSort} style={lvTh(true)}>Origin</SortableTh>
                  <SortableTh sort={sort} colKey="wo" onSort={toggleSort} style={{ ...lvTh(true), width: ORIGIN_COL_W, maxWidth: ORIGIN_COL_W }}>WO</SortableTh>
                  <SortableTh sort={sort} colKey="mo" onSort={toggleSort} style={{ ...lvTh(true), width: ORIGIN_COL_W, maxWidth: ORIGIN_COL_W }}>MO</SortableTh>
                  <SortableTh sort={sort} colKey="pr" onSort={toggleSort} style={{ ...lvTh(true), width: ORIGIN_COL_W, maxWidth: ORIGIN_COL_W }}>PR</SortableTh>
                  <SortableTh sort={sort} colKey="location" onSort={toggleSort} style={lvTh(true)}>Location</SortableTh>
                  <SortableTh sort={sort} colKey="remaining" onSort={toggleSort} style={{ ...lvTh(true), textAlign: 'right' }}>Remaining</SortableTh>
                  <SortableTh sort={sort} colKey="notes" onSort={toggleSort} style={lvTh(true)}>Notes</SortableTh>
                  <SortableTh sort={sort} colKey="created" onSort={toggleSort} style={lvTh(true)}>Created</SortableTh>
                  <th style={{ ...lvTh(true), borderRight: 'none' }}></th>
                </tr>
              </thead>
              <tbody ref={listBodyRef}>
                {loading && <TableSkeleton rows={8} cols={skel.cols ?? colSpan} classic tdStyle={xpTd(false)} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />}
                {!loading && batches.length === 0 && (
                  <TableEmpty colSpan={colSpan} classic tdStyle={xpTd(false)} message="No lots found." />
                )}
                {sortedBatches.map((b, i) => (
                  <>
                    <tr
                      key={b.id}
                      style={{ background: expandedRows[b.id] ? rowStateBg('expanded', true) : lvZebra(true, i), cursor: 'pointer', color: isDepleted(b) ? '#9a9a9a' : undefined, height: ROW_H }}
                      onClick={() => toggleExpand(b)}
                      title={isDepleted(b) ? 'Depleted lot — 0 remaining' : 'Show lot lineage'}
                    >
                      <ExpanderCell classic expanded={!!expandedRows[b.id]} onToggle={() => toggleExpand(b)} label="lot lineage"
                        tdStyle={{ ...xpTd(i % 2 === 1), background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined }} />
                      <td style={{ ...xpTd(i % 2 === 1), background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined }}>
                        <strong>{b.batch_number}</strong>
                        {qualityChip(b)}
                      </td>
                      <td style={{ ...xpTd(i % 2 === 1), background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined }}>{productCell(b)}</td>
                      <td style={{ ...xpTd(i % 2 === 1), textAlign: 'right', background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined }}>{b.ends ?? '-'}</td>
                      <td style={{ ...xpTd(i % 2 === 1), width: ATTRS_COL_W, maxWidth: ATTRS_COL_W, background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined }}>{attrsCell(b)}</td>
                      <td style={{ ...xpTd(i % 2 === 1), background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined }}>{originCell(b)}</td>
                      <td style={{ ...xpTd(i % 2 === 1), width: ORIGIN_COL_W, maxWidth: ORIGIN_COL_W, overflow: 'hidden', background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined }}>{woCell(b)}</td>
                      <td style={{ ...xpTd(i % 2 === 1), width: ORIGIN_COL_W, maxWidth: ORIGIN_COL_W, overflow: 'hidden', background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined }}>{moCell(b)}</td>
                      <td style={{ ...xpTd(i % 2 === 1), width: ORIGIN_COL_W, maxWidth: ORIGIN_COL_W, overflow: 'hidden', background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined }}>{prCell(b)}</td>
                      <td style={{ ...xpTd(i % 2 === 1), background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined }}>{locationCell(b)}</td>
                      <td style={{ ...xpTd(i % 2 === 1), textAlign: 'right', background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined, whiteSpace: 'nowrap' }}>{remainingCell(b)}</td>
                      <td style={{ ...xpTd(i % 2 === 1), background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined }}>{notesCell(b)}</td>
                      <td style={{ ...xpTd(i % 2 === 1), background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined }}>{createdCell(b)}</td>
                      <td style={{ ...xpTd(i % 2 === 1), whiteSpace: 'nowrap', textAlign: 'right', background: expandedRows[b.id] ? rowStateBg('expanded', true) : undefined }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                          {!isRejectGrade(b.quality_status) && (b.remaining ?? 0) > 0 && (
                            <XPActionButton classic tone="neutral" icon="bi-scissors" title={SPLIT_TITLE} onClick={() => openSplit(b)} />
                          )}
                          {!isRejectGrade(b.quality_status) && b.quality_status !== 'DISPOSED' && (
                            <XPActionButton classic tone="warning" icon="bi-slash-circle" title={REJECT_TITLE} onClick={() => openReject(b)} />
                          )}
                          {isRejectGrade(b.quality_status) && (b.remaining ?? 0) > 0 && (
                            <XPActionButton classic tone="danger" icon="bi-trash" title={DISPOSE_TITLE} onClick={() => openDispose(b)} />
                          )}
                          <MenuTriggerButton classic onClick={e => toggle(b.id, e)} />
                        </div>
                      </td>
                    </tr>
                    {expandedRows[b.id] && (
                      <tr key={`${b.id}-detail`}>
                        <td colSpan={colSpan} style={{ padding: 0 }}>
                          {renderExpandedPanel(b)}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />
        </div>
      ) : (
        <div className="card shadow-sm border-0 shell-window" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {/* ── Title bar ── */}
          <div className="card-header d-flex align-items-center gap-2" style={{ flexShrink: 0 }}>
            <h5 className="mb-0 fw-bold">Lot Management</h5>
          </div>
          {/* ── Lot type tabs — classifies by the process that produced the lot ── */}
          <Tabs<string> tabs={lotTypeTabs} activeKey={lotTypeFilter || 'ALL'} onChange={handleLotTypeTabChange} classic={false} />
          {/* ── Filter/search bar + actions ── */}
          <div className="d-flex align-items-center gap-2 flex-wrap px-3 py-2 border-bottom" style={{ flexShrink: 0, background: '#f8f9fa' }}>
            <SearchField classic={false} value={searchInput} onChange={setSearch} placeholder="Search lot, item, WO/MO/PR, SO..." width={260} />
            <div style={{ width: 200, flexShrink: 0 }}>
              <SearchableSelect options={itemFilterOptions} value={itemFilter} onChange={setItemFilter} placeholder="All Items" size="sm" />
            </div>
            <TreeSelect
              options={catTreeOptions}
              value={selectedCat}
              onChange={setSelectedCat}
              allowEmpty
              emptyLabel="All Categories"
              placeholder="All Categories"
              size="sm"
              style={{ width: 180 }}
            />
            <TreeSelect
              options={locationTree}
              value={locationFilter}
              onChange={setLocationFilter}
              allowEmpty
              emptyLabel="All Locations"
              placeholder="All Locations"
              size="sm"
              style={{ width: 200 }}
            />
            <FilterChipBar
              classic={false}
              options={LOT_STATUS_FILTERS}
              value={statusFilter}
              onChange={v => setStatusFilter(v as '' | 'active' | 'depleted')}
            />
            <div className="ms-auto d-flex gap-2">
              <ToolbarButton classic={false} tone="neutral" icon="bi-arrow-clockwise" onClick={fetchBatches}>Refresh</ToolbarButton>
              <ToolbarButton classic={false} tone="create" icon="bi-plus" onClick={() => setIsCreateOpen(true)}>New Lot</ToolbarButton>
            </div>
          </div>

          {/* ── Table ── */}
          <div className="table-responsive" style={{ flex: 1, overflowY: 'auto', minHeight: 0, scrollbarGutter: 'stable' } as React.CSSProperties}>
            <table className="table table-sm table-hover mb-0" style={xpTable}>
              <thead style={lvThead(false, true)}>
                <tr>
                  <th style={{ ...lvTh(false), width: 24 }}></th>
                  <SortableTh sort={sort} colKey="lot" onSort={toggleSort} style={lvTh(false)}>Lot Number</SortableTh>
                  <SortableTh sort={sort} colKey="product" onSort={toggleSort} style={lvTh(false)}>Item</SortableTh>
                  <SortableTh sort={sort} colKey="ends" onSort={toggleSort} style={{ ...lvTh(false), textAlign: 'right' }}>Ends</SortableTh>
                  <th style={{ ...lvTh(false), width: ATTRS_COL_W, maxWidth: ATTRS_COL_W }}>Attributes</th>
                  <SortableTh sort={sort} colKey="origin" onSort={toggleSort} style={lvTh(false)}>Origin</SortableTh>
                  <SortableTh sort={sort} colKey="wo" onSort={toggleSort} style={{ ...lvTh(false), width: ORIGIN_COL_W, maxWidth: ORIGIN_COL_W }}>WO</SortableTh>
                  <SortableTh sort={sort} colKey="mo" onSort={toggleSort} style={{ ...lvTh(false), width: ORIGIN_COL_W, maxWidth: ORIGIN_COL_W }}>MO</SortableTh>
                  <SortableTh sort={sort} colKey="pr" onSort={toggleSort} style={{ ...lvTh(false), width: ORIGIN_COL_W, maxWidth: ORIGIN_COL_W }}>PR</SortableTh>
                  <SortableTh sort={sort} colKey="location" onSort={toggleSort} style={lvTh(false)}>Location</SortableTh>
                  <SortableTh sort={sort} colKey="remaining" onSort={toggleSort} style={{ ...lvTh(false), textAlign: 'right' }}>Remaining</SortableTh>
                  <SortableTh sort={sort} colKey="notes" onSort={toggleSort} style={lvTh(false)}>Notes</SortableTh>
                  <SortableTh sort={sort} colKey="created" onSort={toggleSort} style={lvTh(false)}>Created</SortableTh>
                  <th style={{ ...lvTh(false), borderRight: 'none' }}></th>
                </tr>
              </thead>
              <tbody ref={listBodyRef}>
                {loading && <TableSkeleton rows={8} cols={skel.cols ?? colSpan} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />}
                {!loading && batches.length === 0 && <TableEmpty colSpan={colSpan} classic={false} message="No lots found." />}
                {sortedBatches.map(b => (
                  <>
                    <tr
                      key={b.id}
                      style={{ background: expandedRows[b.id] ? rowStateBg('expanded', false) : undefined, cursor: 'pointer', color: isDepleted(b) ? '#9a9a9a' : undefined, height: ROW_H }}
                      onClick={() => toggleExpand(b)}
                      title={isDepleted(b) ? 'Depleted lot — 0 remaining' : 'Show lot lineage'}
                    >
                      <ExpanderCell classic={false} expanded={!!expandedRows[b.id]} onToggle={() => toggleExpand(b)} label="lot lineage" />
                      <td>
                        <strong>{b.batch_number}</strong>
                        {qualityChip(b)}
                      </td>
                      <td>{productCell(b)}</td>
                      <td className="text-end">{b.ends ?? '-'}</td>
                      <td style={{ width: ATTRS_COL_W, maxWidth: ATTRS_COL_W }}>{attrsCell(b)}</td>
                      <td>{originCell(b)}</td>
                      <td style={{ width: ORIGIN_COL_W, maxWidth: ORIGIN_COL_W, overflow: 'hidden' }}>{woCell(b)}</td>
                      <td style={{ width: ORIGIN_COL_W, maxWidth: ORIGIN_COL_W, overflow: 'hidden' }}>{moCell(b)}</td>
                      <td style={{ width: ORIGIN_COL_W, maxWidth: ORIGIN_COL_W, overflow: 'hidden' }}>{prCell(b)}</td>
                      <td>{locationCell(b)}</td>
                      <td className="text-end" style={{ whiteSpace: 'nowrap' }}>{remainingCell(b)}</td>
                      <td>{notesCell(b)}</td>
                      <td>{createdCell(b)}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <div className="d-inline-flex align-items-center gap-1 justify-content-end">
                          {!isRejectGrade(b.quality_status) && (b.remaining ?? 0) > 0 && (
                            <XPActionButton classic={false} tone="neutral" icon="bi-scissors" title={SPLIT_TITLE} onClick={() => openSplit(b)} />
                          )}
                          {!isRejectGrade(b.quality_status) && b.quality_status !== 'DISPOSED' && (
                            <XPActionButton classic={false} tone="warning" icon="bi-slash-circle" title={REJECT_TITLE} onClick={() => openReject(b)} />
                          )}
                          {isRejectGrade(b.quality_status) && (b.remaining ?? 0) > 0 && (
                            <XPActionButton classic={false} tone="danger" icon="bi-trash" title={DISPOSE_TITLE} onClick={() => openDispose(b)} />
                          )}
                          <MenuTriggerButton classic={false} onClick={e => toggle(b.id, e)} />
                        </div>
                      </td>
                    </tr>
                    {expandedRows[b.id] && (
                      <tr key={`${b.id}-detail`}>
                        <td colSpan={colSpan} style={{ padding: 0 }}>
                          {renderExpandedPanel(b)}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />
        </div>
      )}

      {/* ── Create Modal ── */}
      {isCreateOpen && (
        <ModalWrapper
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          title="New Lot"
          size="sm"
          modeless
          footer={<>
            <button style={classic ? xpBtn() : undefined} className={classic ? XP_BTN : 'btn btn-sm btn-secondary'} onClick={() => setIsCreateOpen(false)}>Cancel</button>
            <button style={classic ? xpBtn() : undefined} className={classic ? XP_BTN : 'btn btn-sm btn-primary'} onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating...' : 'Create Lot'}
            </button>
          </>}
        >
          <div className="mb-3">
            <label style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>Item</label>
            <div className="mt-1">
              <SearchableSelect
                options={createItemOptions}
                value={createItemId}
                onChange={onCreateItemChange}
                onSearch={onSearchCreateItem}
                placeholder="Search item..."
                size="sm"
              />
            </div>
          </div>
          <div className="mb-3">
            <label style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>Quantity (optional)</label>
            <input
              type="number"
              min={0}
              step="any"
              className={classic ? '' : 'form-control form-control-sm mt-1'}
              style={classic ? { ...xpInput, width: '100%', height: 22 } : {}}
              value={createQty}
              onChange={e => setCreateQty(e.target.value)}
              placeholder="0"
            />
            <div style={classic ? { fontFamily: xpFont, fontSize: 10, color: '#555', marginTop: 2 } : { fontSize: 12, color: '#666', marginTop: 2 }}>
              Books the lot into stock at the location below. Leave blank to create an empty lot.
            </div>
          </div>
          <div className="mb-3">
            <label style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>Location{createQty && parseFloat(createQty) > 0 ? '' : ' (optional)'}</label>
            <div className="mt-1">
              <TreeSelect
                options={locationPickerTree}
                value={createLocId}
                onChange={setCreateLocId}
                allowEmpty
                emptyLabel="-- Select Location --"
                size="sm"
                style={classic ? { width: '100%' } : undefined}
              />
            </div>
          </div>
          <div className="mb-3">
            <label style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>Notes (optional)</label>
            <textarea
              className={classic ? '' : 'form-control form-control-sm mt-1'}
              style={classic ? { ...xpInput, width: '100%', height: 60, resize: 'vertical' } : {}}
              value={createNotes}
              onChange={e => setCreateNotes(e.target.value)}
              placeholder="Optional notes..."
            />
          </div>
        </ModalWrapper>
      )}

      {/* ── QC Reject Modal ── */}
      {rejectBatch && (() => {
        const rem = Number(rejectBatch.remaining ?? 0);
        const q = parseFloat(rejectQty);
        const partial = rejectQty !== '' && !isNaN(q) && q > 0 && q < rem - 1e-9;
        const goodLeft = partial ? rem - q : 0;
        return (
        <ModalWrapper
          isOpen={!!rejectBatch}
          onClose={() => setRejectBatch(null)}
          title={`Reject Lot ${rejectBatch.batch_number}`}
          size="sm"
          modeless
          footer={<>
            <button style={classic ? xpBtn() : undefined} className={classic ? XP_BTN : 'btn btn-sm btn-secondary'} onClick={() => setRejectBatch(null)}>Cancel</button>
            <button
              style={classic ? xpBtn({ ...BTN_TONES.danger }) : undefined}
              className={classic ? XP_BTN : 'btn btn-sm btn-danger'}
              onClick={handleReject}
              disabled={rejecting}
            >
              {rejecting ? 'Rejecting...' : partial ? 'Reject Portion' : 'Reject Whole Lot'}
            </button>
          </>}
        >
          <div className="mb-2" style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>
            <strong>{batchItemCode(rejectBatch)}</strong>
            {rejectBatch.remaining != null && <> — {rem.toFixed(2)} remaining</>}
            {rejectBatch.mo_code && <> (MO {rejectBatch.mo_code})</>}
          </div>
          <div className="mb-3">
            <label style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>Reject quantity</label>
            <input
              type="number"
              min={0}
              max={rem}
              step="any"
              className={classic ? '' : 'form-control form-control-sm mt-1'}
              style={classic ? { ...xpInput, width: '100%', height: 22 } : {}}
              value={rejectQty}
              onChange={e => setRejectQty(e.target.value)}
            />
            <div style={classic ? { fontFamily: xpFont, fontSize: 10, color: '#555', marginTop: 2 } : { fontSize: 12, color: '#666', marginTop: 2 }}>
              {partial
                ? `Splits off ${q.toFixed(2)} into a REJECTED sub-lot; ${goodLeft.toFixed(2)} stays active.`
                : 'Full quantity — rejects the whole lot.'}
            </div>
          </div>
          <div className="mb-3">
            <label style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>Move to defect store</label>
            <div className="mt-1">
              <TreeSelect
                options={locationPickerTree}
                value={rejectLocId}
                onChange={setRejectLocId}
                allowEmpty
                emptyLabel="Auto (routed by work centre / item)"
                size="sm"
                style={classic ? { width: '100%' } : undefined}
              />
            </div>
            <div style={classic ? { fontFamily: xpFont, fontSize: 10, color: '#555', marginTop: 2 } : { fontSize: 12, color: '#666', marginTop: 2 }}>
              {rejectLocId
                ? `Rejected stock is transferred out of ${rejectBatch.location_name || 'its current location'} into the selected store.`
                : 'Routed automatically: the producing work centre’s reject location (inherited from its group/type), then the item’s default. With none configured the stock stays put, flagged.'}
            </div>
          </div>
          <div className="mb-3">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, ...(classic ? { fontFamily: xpFont, fontSize: 11 } : {}) }}>
              <input type="checkbox" checked={rejectUsable} onChange={e => setRejectUsable(e.target.checked)} />
              Still usable (downgrade, not scrap)
            </label>
            <div style={classic ? { fontFamily: xpFont, fontSize: 10, color: '#555', marginTop: 2 } : { fontSize: 12, color: '#666', marginTop: 2 }}>
              {rejectUsable
                ? 'Quarantined and out of availability planning, but still offered in consumption and staging pickers — a rejected beam can be re-mounted for certain items.'
                : 'Scrap-bound: excluded from availability and from every consumption picker.'}
            </div>
          </div>
          <div className="mb-3" style={classic ? { fontFamily: xpFont, fontSize: 10, color: '#663300' } : { fontSize: 13, color: '#664d03' }}>
            {partial
              ? `The rejected ${q.toFixed(2)} moves to a new REJECTED sub-lot (excluded from availability/consumption) and is physically pulled out; the rest stays GOOD. If produced by a work order, that qty returns to the MO's progress — add a WO to refill.`
              : `The lot is marked REJECTED: it stays in stock but is excluded from availability and consumption. If it was produced by a work order log, that quantity is returned to the MO's progress — create a new WO to refill the shortfall.`}
          </div>
          <div className="mb-3">
            <label style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>Reason</label>
            <textarea
              className={classic ? '' : 'form-control form-control-sm mt-1'}
              style={classic ? { ...xpInput, width: '100%', height: 50, resize: 'vertical' } : {}}
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Defect, shade off, width out of spec..."
            />
          </div>
        </ModalWrapper>
        );
      })()}

      {/* ── Split Modal ── */}
      {splitBatch && (() => {
        const rem = Number(splitBatch.remaining ?? 0);
        const q = parseFloat(splitQty);
        const valid = !isNaN(q) && q > 0 && q < rem - 1e-9;
        const origLeft = valid ? rem - q : rem;
        return (
        <ModalWrapper
          isOpen={!!splitBatch}
          onClose={() => setSplitBatch(null)}
          title={`Split Lot ${splitBatch.batch_number}`}
          size="sm"
          modeless
          footer={<>
            <button style={classic ? xpBtn() : undefined} className={classic ? XP_BTN : 'btn btn-sm btn-secondary'} onClick={() => setSplitBatch(null)}>Cancel</button>
            <button
              style={classic ? xpBtn({ background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)', fontWeight: 'bold' }) : undefined}
              className={classic ? XP_BTN : 'btn btn-sm btn-primary'}
              onClick={handleSplit}
              disabled={splitting || !valid}
            >
              {splitting ? 'Splitting...' : 'Split & Print Label'}
            </button>
          </>}
        >
          <div className="mb-2" style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>
            <strong>{batchItemCode(splitBatch)}</strong>
            {splitBatch.remaining != null && <> — {rem.toFixed(2)} remaining</>}
          </div>
          <div className="mb-3">
            <label style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>Quantity to peel off</label>
            <input
              type="number"
              min={0}
              max={rem}
              step="any"
              className={classic ? '' : 'form-control form-control-sm mt-1'}
              style={classic ? { ...xpInput, width: '100%', height: 22 } : {}}
              value={splitQty}
              onChange={e => setSplitQty(e.target.value)}
              placeholder={`0 – ${rem.toFixed(2)}`}
            />
            <div style={classic ? { fontFamily: xpFont, fontSize: 10, color: '#555', marginTop: 2 } : { fontSize: 12, color: '#666', marginTop: 2 }}>
              {valid
                ? `Peels ${q.toFixed(2)} into a new GOOD lot; original keeps ${origLeft.toFixed(2)}.`
                : `Enter a qty between 0 and ${rem.toFixed(2)}.`}
            </div>
          </div>
          <div className="mb-3">
            <label style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>Reason (optional)</label>
            <textarea
              className={classic ? '' : 'form-control form-control-sm mt-1'}
              style={classic ? { ...xpInput, width: '100%', height: 50, resize: 'vertical' } : {}}
              value={splitReason}
              onChange={e => setSplitReason(e.target.value)}
              placeholder="Leftover after partial use..."
            />
          </div>
        </ModalWrapper>
        );
      })()}

      {/* ── Dispose / Reassign Modal (rejected lots) ── */}
      {disposeBatch && (() => {
        const rem = Number(disposeBatch.remaining ?? 0);
        const q = parseFloat(reassignQty);
        const reassign = disposeMode === 'reassign';
        const qtyOk = !isNaN(q) && q > 0 && q <= rem + 1e-9;
        const partial = qtyOk && q < rem - 1e-9;
        const canSubmit = reassign ? (!!reassignItemId && qtyOk) : rem >= 0;
        const targetItem: any = reassignItemId ? resolveReassignItem(reassignItemId) : null;
        const destName = reassignLocId
          ? ((locations || []).find((l: any) => String(l.id) === reassignLocId)?.name || '')
          : '';
        const hint = classic
          ? { fontFamily: xpFont, fontSize: 10, color: '#555', marginTop: 2 }
          : { fontSize: 12, color: '#666', marginTop: 2 };
        const modeBtn = (mode: 'writeoff' | 'reassign', label: string, icon: string) => (
          <button
            type="button"
            onClick={() => setDisposeMode(mode)}
            style={classic
              ? xpBtn(disposeMode === mode ? { fontWeight: 'bold', background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)' } : {})
              : undefined}
            className={classic ? XP_BTN : `btn btn-sm ${disposeMode === mode ? 'btn-primary' : 'btn-outline-secondary'}`}
          >
            <i className={`bi ${icon}`} style={{ marginRight: 4 }} />{label}
          </button>
        );
        return (
        <ModalWrapper
          isOpen={!!disposeBatch}
          onClose={() => setDisposeBatch(null)}
          title={`Dispose Rejected Lot ${disposeBatch.batch_number}`}
          size="sm"
          modeless
          footer={<>
            <button style={classic ? xpBtn() : undefined} className={classic ? XP_BTN : 'btn btn-sm btn-secondary'} onClick={() => setDisposeBatch(null)}>Cancel</button>
            <button
              style={classic ? xpBtn(reassign ? { fontWeight: 'bold' } : { ...BTN_TONES.danger }) : undefined}
              className={classic ? XP_BTN : `btn btn-sm ${reassign ? 'btn-primary' : 'btn-danger'}`}
              onClick={handleDispose}
              disabled={disposing || !canSubmit}
            >
              {disposing ? 'Working...' : reassign ? 'Reassign Lot' : 'Write Off'}
            </button>
          </>}
        >
          <div className="mb-2" style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>
            <strong>{batchItemCode(disposeBatch)}</strong>
            {disposeBatch.remaining != null && <> — {rem.toFixed(2)} remaining</>}
            {disposeBatch.location_name && <> at {disposeBatch.location_name}</>}
          </div>
          <div className="mb-3" style={{ display: 'flex', gap: 6 }}>
            {modeBtn('writeoff', 'Write off', 'bi-trash')}
            {modeBtn('reassign', 'Assign to another item', 'bi-arrow-repeat')}
          </div>

          {!reassign && (
            <div className="mb-3" style={classic ? { fontFamily: xpFont, fontSize: 10, color: '#663300' } : { fontSize: 13, color: '#664d03' }}>
              The remaining {rem.toFixed(2)} is physically written off and deducted from stock on-hand, and the lot is marked DISPOSED. This cannot be undone.
            </div>
          )}

          {reassign && (<>
            <div className="mb-3" style={classic ? { fontFamily: xpFont, fontSize: 10, color: '#663300' } : { fontSize: 13, color: '#664d03' }}>
              Recycle instead of scrap: the goods move onto a new GOOD lot under the item below, so they are pickable and count in availability again. The rejection stays on the record — this lot keeps its reject grade and the new lot traces back to it.
            </div>
            <div className="mb-3">
              <label style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>Reassign to item</label>
              <div className="mt-1">
                <SearchableSelect
                  options={reassignItemOptions}
                  value={reassignItemId}
                  onChange={onReassignItemChange}
                  onSearch={onSearchReassignItem}
                  placeholder="Search item..."
                  size="sm"
                />
              </div>
              <div style={hint}>
                {targetItem
                  ? `New lot is created under ${targetItem.code}${targetItem.name ? ` — ${targetItem.name}` : ''}.`
                  : 'The product this rejected material will be cycled into.'}
              </div>
            </div>
            <div className="mb-3">
              <label style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>Quantity to reassign</label>
              <input
                type="number"
                min={0}
                max={rem}
                step="any"
                className={classic ? '' : 'form-control form-control-sm mt-1'}
                style={classic ? { ...xpInput, width: '100%', height: 22 } : {}}
                value={reassignQty}
                onChange={e => setReassignQty(e.target.value)}
                placeholder={`0 – ${rem.toFixed(2)}`}
              />
              <div style={hint}>
                {partial
                  ? `Moves ${q.toFixed(2)}; ${(rem - q).toFixed(2)} stays on the rejected lot for a later write-off.`
                  : qtyOk
                    ? 'Whole remaining balance — the rejected lot is left depleted.'
                    : `Enter a qty between 0 and ${rem.toFixed(2)}.`}
              </div>
            </div>
            <div className="mb-3">
              <label style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>Move to location</label>
              <div className="mt-1">
                <TreeSelect
                  options={locationPickerTree}
                  value={reassignLocId}
                  onChange={setReassignLocId}
                  allowEmpty
                  emptyLabel="Leave where it is"
                  size="sm"
                  style={classic ? { width: '100%' } : undefined}
                />
              </div>
              <div style={hint}>
                {destName
                  ? `Recycled stock is transferred into ${destName}.`
                  : 'Stays in its current bin — usually the defect store, which is rarely where usable stock should sit.'}
              </div>
            </div>
          </>)}

          <div className="mb-3">
            <label style={classic ? { fontFamily: xpFont, fontSize: 11 } : {}}>Reason (optional)</label>
            <textarea
              className={classic ? '' : 'form-control form-control-sm mt-1'}
              style={classic ? { ...xpInput, width: '100%', height: 50, resize: 'vertical' } : {}}
              value={disposeReason}
              onChange={e => setDisposeReason(e.target.value)}
              placeholder={reassign ? 'Re-warped for coarser cloth...' : 'Unusable, shade off...'}
            />
          </div>
        </ModalWrapper>
        );
      })()}

      {/* ── Row ⋯ menu: Print Label (GRG only) + Delete ── */}
      {openId && (() => {
        const b = batches.find(x => x.id === openId);
        if (!b) return null;
        // Reprintable rich labels: greige bags and warp beams. Both are born as an
        // MOCompletion with an output lot, which is what openBatchLabel needs to
        // rebuild the full-fidelity card; every other prefix falls through to the
        // generic lot sticker there anyway.
        const lotMeta = classifyLot(b.batch_number);
        const canLabel = lotMeta === STAGE_META.GRG || lotMeta === STAGE_META.BM;
        return (
          <FloatingMenu
            pos={pos}
            items={[
              { key: 'label', label: 'Print Label', icon: 'bi-printer', hidden: !canLabel, title: lotMeta === STAGE_META.BM ? "Print this warp beam's label" : "Print this greige bag's label", onClick: () => { close(); openBatchLabel(b); } },
              { key: 'delete', label: 'Delete', icon: 'bi-trash', danger: true, onClick: () => { close(); handleDelete(b); } },
            ]}
          />
        );
      })()}

      {/* ── Bag Label Print (greige lots) ── */}
      {labelData && (
        <BagLabelPrintModal
          bags={labelData.bags}
          workOrder={labelData.wo}
          parentMO={labelData.mo}
          seqStart={labelData.seqStart}
          onClose={() => setLabelData(null)}
        />
      )}

      {/* ── Lot Label Print (split leftovers) ── */}
      {lotLabels && (
        <LotLabelPrintModal lots={lotLabels} onClose={() => setLotLabels(null)} />
      )}
    </div>
  );
}
