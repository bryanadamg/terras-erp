'use client';
import React, { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../shared/Toast';
import { useTimezone } from '../../context/TimezoneContext';
import { useUser } from '../../context/UserContext';
import { useData } from '../../context/DataContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import SearchableSelect from '@bryanadamg/terras-ui/components/Combobox';
import ModalWrapper from '../shared/ModalWrapper';
import Pager from '../shared/Pager';
import { StatusChip, StatusCountPill, FormSection, useFloatingMenu, MenuTriggerButton, FloatingMenu, ColorSwatchChip, useSortable, ExpandedRowPanel, CodeChip, CODE_FONT, xpFont, TableSkeleton, useTableSkeletonMetrics, rowStateBg, ChipTone, CHIP_RADIUS, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { SearchField, FilterChipBar, ToolbarCount, ToolbarButton, viewShellStyle, PageTitleBar } from '../shared/shellTheme';
import RequestDetailPanel, { getStatusStripe } from '../shared/RequestDetailPanel';
import { lvThead, ExpanderCell, LV_EXPANDER_COL_W, SortableTh, lvTh, lvTdRuled, lvZebra, TableEmpty, lvBtn, lvInput } from '../shared/listViewTheme';
import { API_BASE, STATIC_BASE } from '../shared/apiBase';

// ── XP style constants (consistent with DyeingSettingView) ──────────────────
const modernFont = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const xpInput = (): React.CSSProperties => lvInput({ width: 'auto' });
const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => lvBtn('default', extra);
// Modern primary-button overrides (Submit/Create/Add/New). Merged on top of the secondary base above.
const modernPrimaryBtn: React.CSSProperties = {
    fontWeight: 600, background: '#2563eb', color: '#fff', border: 'none',
};
const xpLbl = (): React.CSSProperties => ({ fontFamily: xpFont, fontSize: 11, color: '#000', display: 'block', marginBottom: 2 });
const REQUEST_TYPES = ['NEW', 'RESUBMIT', 'STRIKE_OFF'];
const STATUS_FILTERS = ['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'];
const REQUEST_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'];

// Reject confirmation reasons — mirrors the sample-request reject flow.
const REJECT_REASONS = [
    'Color mismatch',
    'Shade too dark',
    'Shade too light',
    'Quality defect',
    'Wrong material',
    'Measurement out of spec',
    'Hand-feel / texture',
    'Customer changed requirement',
    'Other',
];

const statusStyle = (status: string): React.CSSProperties => {
    const map: Record<string, { bg: string; border: string; color: string }> = {
        APPROVED:    { bg: '#d4edda', border: '#27713a', color: '#0c3a1a' },
        REJECTED:    { bg: '#f8d7da', border: '#a01a1a', color: '#4a0000' },
        SUBMITTED:   { bg: '#dce4f5', border: '#3a5faa', color: '#0d2a6e' },
        RESUBMIT:    { bg: '#fff3cd', border: '#b8860b', color: '#3e2000' },
        IN_PROGRESS: { bg: '#fff3cd', border: '#b8860b', color: '#3e2000' },
        PENDING:     { bg: '#e8e8e8', border: '#7a7a7a', color: '#111' },
    };
    const s = map[status] || { bg: '#e8e8e8', border: '#7a7a7a', color: '#111' };
    return { background: s.bg, border: `1px solid ${s.border}`, color: s.color, padding: '1px 5px', fontSize: 9, fontFamily: xpFont, fontWeight: 'bold', whiteSpace: 'nowrap' as const };
    // Modern: semantic colors preserved, softer bg + matching text/border, rounded 6px.
};

const today = () => new Date().toISOString().split('T')[0];
const LABDIP_PAGE_SIZE = 20;

type DipDraft = { id?: string; color_name: string; color_id?: string | null; submission_round: number; recipe_ref?: string };
type ItemDraft = { id?: string; item_id: string; item_label?: string; variant_seq?: number; locked_variant_code?: string; dips: DipDraft[] };

// 0 → A, 1 → B, … 25 → Z, 26 → AA (spreadsheet-column style).
const variantLetter = (seq: number): string => {
    let s = '', n = seq + 1;
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
};
// Raw numeric tail of a request code: "LD-2026-00001" / "LDY-2026-00001" → "00001".
const rawSeq = (code?: string): string => (code || '').split('-').pop() || '';
// Numeric portion namespaced by book — mirrors `_seq_part` in api/lab_dips.py:
//   "LD-2026-00001"  → "00001"
//   "LDY-2026-00001" → "Y00001"
// FG and yarn each number from 1, so the bare number is ambiguous across the two;
// the Y marker is what keeps variant codes and minted color codes unique.
const seqPart = (code?: string): string =>
    (code || '').startsWith('LDY-') ? `Y${rawSeq(code)}` : rawSeq(code);
// Splits a variant code ("00003-A") back into its seq/letter parts for the two-tone badge pair.
const splitVariantCode = (code: string): { seq: string; variant: string } => {
    const idx = code.lastIndexOf('-');
    return idx === -1 ? { seq: code, variant: '' } : { seq: code.slice(0, idx), variant: code.slice(idx + 1) };
};

// Color-variant names this item was dipped for: its own dips, else the request-level picks
// (Colors applies to every item). These names are `Colors` variant attribute values.
const itemColorNames = (req: any, item: any): string[] => {
    const own = (item?.dips || []).map((d: any) => d.color_name).filter(Boolean);
    if (own.length) return own;
    return (req?.dips || []).filter((d: any) => !d.lab_dip_item_id).map((d: any) => d.color_name).filter(Boolean);
};

// Two distinct chips: the request sequence (neutral) and the item's variant letter (accent).
const seqBadge = (): React.CSSProperties => ({
    fontFamily: CODE_FONT, fontSize: 11, fontWeight: 'bold', color: '#333',
    background: '#e4e1d8', border: '1px solid #a0988c', borderRadius: CHIP_RADIUS, padding: '1px 7px', whiteSpace: 'nowrap' as const,
});
const variantBadge = (): React.CSSProperties => ({
    fontFamily: xpFont, fontSize: 11, fontWeight: 'bold', color: '#fff',
    background: '#3a6fc4', border: '1px solid #1a4a8a', borderRadius: CHIP_RADIUS, padding: '1px 7px', whiteSpace: 'nowrap' as const,
});

const emptyForm = () => ({
    request_date: today(),
    customer_id: '',
    approved_recipe_id: '',
    season: '',
    request_type: 'NEW',
    notes: '',
    // Not exposed as form fields (no UI for these yet) — carried through as-is so
    // editing/resubmitting never silently wipes them.
    customer_article_code: '',
    internal_article_code: '',
    items: [] as ItemDraft[],
    // Legacy dips with no item, carried through on edit so they aren't dropped.
    legacyDips: [] as DipDraft[],
});

/**
 * Shared by /lab-dips (FG) and /lab-dips-yarn (YARN) — `kind` selects the book.
 *
 * This view owns the list fetch (`GET /lab-dips`), not the pages: the list is
 * server-paginated and server-filtered, and the search/status/created-date filter
 * state that feeds those params lives here. Putting the hook in the two pages would
 * have meant duplicating that state plus the whole params object twice and plumbing
 * six callbacks back down. The pages keep the mutations (they differ in wording,
 * item scope and the yarn `kind` on create) and this view refetches after each one.
 */
export default function LabDipRequestView({
    customers, items, onSearchItems, recipes, attributes,
    onCreate, onEdit, onUpdateStatus, onUpdateItemStatus, onDelete,
    openRequestId, kind = 'FG',
}: any) {
    useToast();
    const router = useRouter();
    const { formatDate: tzDate, formatDateTime: tzDateTime } = useTimezone();
    const { hasPermission, hasAnyPermission } = useUser();
    const canManage = hasAnyPermission('lab_dip_request.create', 'lab_dip_request.edit', 'lab_dip_request.delete');
    const { openId: menuOpenId, pos: menuPos, toggle: menuToggle, close: menuClose } = useFloatingMenu(160);

    const [statusFilter, setStatusFilter] = useState('ALL');
    // Created-date range, inclusive at both ends — applied server-side now.
    const [createdFrom, setCreatedFrom] = useState('');
    const [createdTo, setCreatedTo] = useState('');
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);
    const [form, setForm] = useState(emptyForm());
    const [pendingItem, setPendingItem] = useState('');
    const [pendingColor, setPendingColor] = useState('');

    // ── The list: one server page, filtered + ordered server-side ───────────────
    // Previously the page fetched /lab-dips with no window at all, took the endpoint's
    // silent first 100 rows and paginated client-side over those — request #101 was
    // unreachable however far you clicked. `searchTerm` is the hook's own debounced
    // box (350ms), so no second debounce here; every other filter rides in as a param
    // and any param change restarts at page 1 inside the hook.
    const { authFetch } = useData();
    const {
        rows: labDips, total, meta, loading, page, setPage, refetch: refetchLabDips,
        searchInput: searchTerm, setSearch: setSearchTerm,
    } = usePaginatedFetch<any>({
        endpoint: `${API_BASE}/lab-dips`,
        authFetch,
        pageSize: LABDIP_PAGE_SIZE,
        params: {
            kind,
            status: statusFilter === 'ALL' ? '' : statusFilter,
            created_from: createdFrom,
            created_to: createdTo,
            // Deep link: the server ranks this request under the active filters and
            // reports the page holding it as `focus_page` (see the effect below).
            focus_id: openRequestId || '',
        },
    });

    // Mutations stay on the pages (wording/scope differ per book); the list refresh is
    // this view's job, so each handler is wrapped to refetch the current page after it
    // settles rather than every page calling its own fetch.
    const after = (fn: any) => async (...args: any[]) => { await fn?.(...args); refetchLabDips(); };
    const doCreate = after(onCreate);
    const doEdit = after(onEdit);
    const doUpdateStatus = after(onUpdateStatus);
    const doUpdateItemStatus = after(onUpdateItemStatus);
    const doDelete = after(onDelete);

    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('lab-dips-classic', listBodyRef, (labDips?.length ?? 0) > 0);

    // Which numbering book this mount shows. Only the labels, the code preview and the
    // POST payload differ — the FG and yarn pages are the same component, one code path.
    const isYarn = kind === 'YARN';
    const requestNoun = isYarn ? 'Yarn Lab Dip Request' : 'Lab Dip Request';

    // "Colors" system variant attribute — request-level color picks (apply to all items).
    const colorOptions = useMemo(() => {
        const attr = (attributes as any[] || []).find((a: any) => a.system_role === 'color');
        return (attr?.values ?? []).map((v: any) => ({ value: v.value, label: v.value }));
    }, [attributes]);
    const colorsAttrName = useMemo(() => (attributes as any[] || []).find((a: any) => a.system_role === 'color')?.name ?? 'Colors', [attributes]);
    // Stored swatch color (user-picked on the Colors master) by value name, falls back to the derived name lookup in ColorSwatchChip.
    const hexByColorName = useMemo(() => {
        const attr = (attributes as any[] || []).find((a: any) => a.system_role === 'color');
        const map: Record<string, string> = {};
        (attr?.values ?? []).forEach((v: any) => { if (v.hex) map[v.value] = v.hex; });
        return map;
    }, [attributes]);

    // Approval dialog: captures the "set" index (+ optional notes) that completes the
    // approved color code, then mints a Color library entry via onUpdateItemStatus.
    const [approval, setApproval] = useState<{ reqId: string; itemId: string; seq: string; variant: string; colorNames: string[]; customerName?: string | null } | null>(null);
    const [approvalSet, setApprovalSet] = useState('');
    const [approvalNotes, setApprovalNotes] = useState('');
    const [approvalImage, setApprovalImage] = useState<File | null>(null);
    // The `Colors` variant the minted shade is linked to (shows in the Color Codes table).
    const [approvalVariantId, setApprovalVariantId] = useState('');

    // Colors-attribute value id by value name — the dips' color_name are these values.
    const colorValueIdByName = useMemo(() => {
        const attr = (attributes as any[] || []).find((a: any) => a.system_role === 'color');
        const map: Record<string, string> = {};
        (attr?.values ?? []).forEach((v: any) => { map[v.value] = v.id; });
        return map;
    }, [attributes]);

    // Color variants this request dipped for: the item's own dips, else the request-level
    // picks that apply to every item. Drives the approve dialog's variant link.
    const approvalVariantOptions = useMemo(() => {
        const seen = new Set<string>();
        return (approval?.colorNames || []).reduce((acc: { value: string; label: string }[], n: string) => {
            const id = colorValueIdByName[n];
            if (id && !seen.has(id)) { seen.add(id); acc.push({ value: id, label: n }); }
            return acc;
        }, []);
    }, [approval, colorValueIdByName]);

    const openApproval = (reqId: string, v: any) => {
        if (v.status === 'APPROVED' || v.status === 'REJECTED') return; // locked
        setApproval({ reqId, itemId: v.id, seq: v.seq, variant: v.variant, colorNames: v.colorNames || [], customerName: v.customerName || null });
        setApprovalSet('');
        setApprovalNotes('');
        setApprovalImage(null);
        // Single pick → link it automatically; several → the user chooses.
        const ids = (v.colorNames || []).map((n: string) => colorValueIdByName[n]).filter(Boolean);
        const unique = Array.from(new Set(ids));
        setApprovalVariantId(unique.length === 1 ? String(unique[0]) : '');
    };
    const confirmApproval = () => {
        if (!approval || !approvalSet.trim()) return;
        doUpdateItemStatus(approval.reqId, approval.itemId, 'APPROVED', {
            set: approvalSet.trim(),
            notes: approvalNotes.trim() || undefined,
            variant_attribute_value_id: approvalVariantId || undefined,
            image: approvalImage,
        });
        setApproval(null);
    };

    // Reject dialog: confirm before locking a variant, capturing a reason + optional notes
    // (mirrors the sample-request reject flow).
    const [reject, setReject] = useState<{ reqId: string; itemId: string; seq: string; variant: string } | null>(null);
    const [rejectReason, setRejectReason] = useState(REJECT_REASONS[0]);
    const [rejectNotes, setRejectNotes] = useState('');
    const [rejectImage, setRejectImage] = useState<File | null>(null);
    const openReject = (reqId: string, v: any) => {
        if (v.status === 'APPROVED' || v.status === 'REJECTED') return; // locked
        setReject({ reqId, itemId: v.id, seq: v.seq, variant: v.variant });
        setRejectReason(REJECT_REASONS[0]);
        setRejectNotes('');
        setRejectImage(null);
    };
    const confirmReject = () => {
        if (!reject) return;
        doUpdateItemStatus(reject.reqId, reject.itemId, 'REJECTED', { reason: rejectReason, notes: rejectNotes.trim() || undefined, image: rejectImage });
        setReject(null);
    };

    // Rejection-history viewer: the "Rejected Nx" chip opens this, listing every
    // reject round (reason + notes) for the item — traceability across reopens.
    const [historyItem, setHistoryItem] = useState<{ item: any; code: string } | null>(null);

    // Approval / rejection proof photo on a variant row — thumb in the Photo column,
    // full size in a modeless preview panel.
    const [photoPreview, setPhotoPreview] = useState<{ url: string; filename: string } | null>(null);
    const statusPhotoThumb = (url?: string | null, label = 'Photo') => {
        if (!url) return null;
        const full = `${STATIC_BASE}${url}`;
        const filename = url.split('/').pop() || 'photo';
        if (filename.toLowerCase().endsWith('.pdf')) {
            return (
                <i className="bi bi-file-earmark-pdf" title={`${label} — click to preview`}
                    onClick={() => setPhotoPreview({ url: full, filename })}
                    style={{ fontSize: 28, color: '#c0392b', cursor: 'pointer', display: 'block', margin: '0 auto', textAlign: 'center' as const }} />
            );
        }
        return (
            <img src={full} alt={label} title={`${label} — click to preview`}
                onClick={() => setPhotoPreview({ url: full, filename })}
                style={{ maxHeight: 40, maxWidth: 64, border: '1px solid #a0988c', borderRadius: 0, cursor: 'pointer', display: 'block', margin: '0 auto' }} />
        );
    };

    // `items` is the server-side typeahead result page, scoped by the page that mounts us
    // (Finished Goods for the FG book, Raw Material for the yarn book).
    const itemLabel = (it: any) => it.code ? `${it.code} — ${it.name}` : it.name;
    const itemOptions = useMemo(() =>
        (items || []).map((it: any) => ({ value: it.id, label: itemLabel(it) })),
    [items]);

    const recipeOptions = useMemo(() =>
        (recipes || []).map((r: any) => ({ value: r.id, label: r.code ? `${r.code} — ${r.name}` : r.name })),
    [recipes]);

    const customerOptions = useMemo(() =>
        [{ value: '', label: 'No Customer (Internal)' }, ...(customers || []).map((c: any) => ({ value: c.id, label: c.name }))],
    [customers]);

    const getCustomerName = (id: string) => (customers || []).find((c: any) => c.id === id)?.name || '—';

    const toggleExpand = (id: string) =>
        setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

    const openCreate = () => { setEditing(null); setForm(emptyForm()); setPendingItem(''); setIsModalOpen(true); };

    const openEdit = (r: any) => {
        setEditing(r);
        const mapDip = (d: any): DipDraft => ({ id: d.id, color_name: d.color_name, color_id: d.color_id || null, submission_round: d.submission_round, recipe_ref: d.recipe_ref || '' });
        setForm({
            request_date: r.request_date || today(),
            customer_id: r.customer_id || '',
            approved_recipe_id: r.approved_recipe_id || '',
            season: r.season || '',
            request_type: r.request_type || 'NEW',
            notes: r.notes || '',
            customer_article_code: r.customer_article_code || '',
            internal_article_code: r.internal_article_code || '',
            items: (r.items || []).map((it: any) => ({ id: it.id, item_id: it.item_id, item_label: it.item_code ? `${it.item_code} — ${it.item_name}` : it.item_name, variant_seq: it.variant_seq, locked_variant_code: it.locked_variant_code || undefined, dips: (it.dips || []).map(mapDip) })),
            legacyDips: (r.dips || []).filter((d: any) => !d.lab_dip_item_id).map(mapDip),
        });
        setPendingItem('');
        setIsModalOpen(true);
    };

    const addItem = () => {
        if (!pendingItem) return;
        if (form.items.some(it => it.item_id === pendingItem)) { setPendingItem(''); return; }
        const label = itemOptions.find((o: any) => o.value === pendingItem)?.label || pendingItem;
        setForm(prev => ({ ...prev, items: [...prev.items, { item_id: pendingItem, item_label: label, dips: [] }] }));
        setPendingItem('');
    };
    const removeItem = (itemId: string) => setForm(prev => ({ ...prev, items: prev.items.filter(it => it.item_id !== itemId) }));

    // Request-level colors (apply to all items) — picked from the "Colors" variant attribute.
    const addColor = () => {
        if (!pendingColor) return;
        if (form.legacyDips.some(d => d.color_name === pendingColor)) { setPendingColor(''); return; }
        setForm(prev => ({ ...prev, legacyDips: [...prev.legacyDips, { color_name: pendingColor, submission_round: 1 }] }));
        setPendingColor('');
    };
    const removeColor = (colorName: string) => setForm(prev => ({ ...prev, legacyDips: prev.legacyDips.filter(d => d.color_name !== colorName) }));

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const payload = {
            request_date: form.request_date,
            customer_id: form.customer_id || null,
            approved_recipe_id: form.approved_recipe_id || null,
            season: form.season,
            request_type: form.request_type,
            notes: form.notes,
            customer_article_code: form.customer_article_code || null,
            internal_article_code: form.internal_article_code || null,
            items: form.items.map((it, gi) => ({
                id: it.id,
                item_id: it.item_id,
                order: gi,
                locked_variant_code: it.locked_variant_code || null,
                dips: it.dips.filter(d => d.color_name.trim() !== ''),
            })),
            dips: form.legacyDips.filter(d => d.color_name.trim() !== ''),
        };
        if (editing) doEdit(editing.id, payload); else doCreate(payload);
        setIsModalOpen(false);
        setEditing(null);
        setForm(emptyForm());
    };

    // No client-side filtering: search / status / created-date range are all applied by
    // the server (`_labdip_conditions` in api/lab_dips.py), so `labDips` is already the
    // filtered set, windowed to one page.
    const hasActiveFilter = !!searchTerm || statusFilter !== 'ALL' || !!createdFrom || !!createdTo;
    const clearFilters = () => {
        setSearchTerm('');
        setStatusFilter('ALL');
        setCreatedFrom('');
        setCreatedTo('');
    };

    // Footer tallies run at VARIANT grain, not request grain — a request is a bag of
    // per-color variants each approved/rejected on its own, so a request-level count
    // hides the real progress. Server-computed (`variant_counts`) over the whole
    // filtered set: summing the loaded rows would only ever tally the current page.
    const variantStats = useMemo(() => ({
        total: 0, PENDING: 0, IN_PROGRESS: 0, APPROVED: 0, REJECTED: 0,
        ...(meta?.variant_counts || {}),
    } as Record<string, number>), [meta]);

    // Sortable columns for the request list. Default sort = most-recently-updated first,
    // so a freshly rejected/reopened request (its parent updated_at is bumped on any item
    // status change) floats to the top.
    const sortCols = useMemo(() => ({
        code:     (r: any) => r.code,
        customer: (r: any) => r.customer_id ? getCustomerName(r.customer_id) : '',
        type:     (r: any) => r.request_type,
        status:   (r: any) => r.status,
        updated:  (r: any) => new Date(r.updated_at || r.created_at || 0).getTime(),
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [customers]);
    // Sorting is page-local: it reorders the rows on screen, which is the same trade the
    // other server-paginated lists make (see PurchaseOrderView). The server's own order
    // is the default one — last-touched first — so page 1 is the same top of the list
    // the unsorted view showed.
    const { sorted, sort, toggle: toggleSort } = useSortable(labDips, sortCols, { key: 'updated', dir: -1 });

    // No setPage(1) on a filter change: the hook restarts at page 1 whenever a param
    // changes, and doing it here as well would fire a second fetch.

    // Deep link from the Color Library "From Lab Dip" cell. The target may sit on any
    // page, so the server ranks it under the active filters and returns `focus_page`;
    // this jumps there once (ref-guarded — after that the pager belongs to the user),
    // expands the row, and scrolls to it when it actually arrives in `labDips`.
    const focusJumpedRef = useRef<string | null>(null);
    React.useEffect(() => {
        if (!openRequestId) return;
        setExpandedIds(prev => new Set(prev).add(openRequestId));
        const target = meta?.focus_page;
        if (!target || focusJumpedRef.current === openRequestId) return;
        focusJumpedRef.current = openRequestId;
        if (target !== page) setPage(target);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openRequestId, meta]);

    React.useEffect(() => {
        if (!openRequestId) return;
        if (!labDips.some((r: any) => String(r.id) === String(openRequestId))) return;
        const t = setTimeout(() => {
            document.getElementById(`labdip-row-${openRequestId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
        return () => clearTimeout(t);
    }, [openRequestId, labDips]);

    const setField = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

    // Request code: real code when editing; else a best-effort preview of the next code.
    // The server mints from a monotonic DB sequence, so this max+1 estimate is a lower bound
    // (it can trail the true value after the top request is deleted, and it now scans only
    // the loaded page) — hence the "(on save)" note. Nothing depends on it being right.
    // Parses the raw tail (not seqPart) — the yarn book's "Y" marker is not a number.
    const maxSeq = (labDips || []).reduce((m: number, r: any) => {
        const n = parseInt(rawSeq(r.code), 10);
        return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    const nextCode = `${isYarn ? 'LDY' : 'LD'}-${new Date().getFullYear()}-${String(maxSeq + 1).padStart(5, '0')}`;
    const displayCode = editing ? editing.code : nextCode;

    return (
        <div style={viewShellStyle('page', { fontFamily: xpFont})}>
            {/* Title bar */}
            <PageTitleBar
                icon={isYarn ? 'bi-droplet-half' : 'bi-droplet'}
                title={isYarn ? 'Yarn Lab Dip Requests' : 'Lab Dip Requests'}
            />

            {/* Toolbar */}
            <div style={{ background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, flexShrink: 0 }}>
                <SearchField value={searchTerm} onChange={setSearchTerm} placeholder="Search code, color standard, article…" width={220} />
                <span style={{ width: 1, height: 20, background: '#a0988c', margin: '0 2px' }} />
                <FilterChipBar options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />
                <span style={{ width: 1, height: 20, background: '#a0988c', margin: '0 2px' }} />
                <span style={{ fontSize: 11, color: '#333' }}>Created</span>
                <input
                    type="date"
                    style={{ ...xpInput(), width: 130 }}
                    value={createdFrom}
                    onChange={e => setCreatedFrom(e.target.value)}
                    title="Created from"
                />
                <span style={{ fontSize: 11, color: '#333' }}>–</span>
                <input
                    type="date"
                    style={{ ...xpInput(), width: 130 }}
                    value={createdTo}
                    onChange={e => setCreatedTo(e.target.value)}
                    title="Created to"
                />
                {hasActiveFilter && (
                    <button className={XP_BTN} style={xpBtn()} onClick={clearFilters} title="Clear all filters">Clear</button>
                )}
                <ToolbarCount right>{total} item{total !== 1 ? 's' : ''}</ToolbarCount>
                {canManage && (
                    <>
                        <span style={{ width: 1, height: 20, background: '#a0988c', margin: '0 2px' }} />
                        <ToolbarButton tone="create" icon="bi-plus-lg" onClick={openCreate}>New {requestNoun}</ToolbarButton>
                    </>
                )}
            </div>

            {/* Table */}
            <div style={{ flex: 1, background: '#fff', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                    <thead style={lvThead()}>
                        <tr>
                            <th style={{ ...lvTh(), width: LV_EXPANDER_COL_W }} />
                            <SortableTh sort={sort} colKey="code" onSort={toggleSort} style={{ ...lvTh(), width: 140 }}>Request Code</SortableTh>
                            <SortableTh sort={sort} colKey="customer" onSort={toggleSort} style={{ ...lvTh(), width: 120 }}>Customer</SortableTh>
                            <th style={lvTh()}>Items</th>
                            <th style={{ ...lvTh(), width: 140 }}>{colorsAttrName}</th>
                            <SortableTh sort={sort} colKey="type" onSort={toggleSort} style={{ ...lvTh(), width: 90 }}>Type</SortableTh>
                            <SortableTh sort={sort} colKey="status" onSort={toggleSort} style={{ ...lvTh(), width: 110 }}>Status</SortableTh>
                            <th style={{ ...lvTh(), width: 90 }}>Variants</th>
                            <SortableTh sort={sort} colKey="updated" onSort={toggleSort} style={{ ...lvTh(), width: 128 }}>Updated</SortableTh>
                            <th style={{ ...lvTh(), width: 44, textAlign: 'right' as const, borderRight: 'none' }}></th>
                        </tr>
                    </thead>
                    <tbody ref={listBodyRef}>
                        {labDips.length === 0 && (loading ? (
                            <TableSkeleton rows={8} cols={skel.cols ?? 10} tdStyle={lvTdRuled()} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                        ) : (
                            <TableEmpty colSpan={10} tdStyle={lvTdRuled()}
                                message={hasActiveFilter ? 'No requests match the current filter.' : isYarn ? 'No yarn lab dip requests yet.' : 'No lab dip requests yet.'} />
                        ))}
                        {sorted.map((r: any, idx: number) => {
                            const approved = (r.items || []).filter((it: any) => it.status === 'APPROVED').length;
                            const total = (r.items || []).length;
                            return (
                                <React.Fragment key={r.id}>
                                    <tr id={`labdip-row-${r.id}`} onClick={() => toggleExpand(r.id)} style={{
                                        background: String(r.id) === String(openRequestId) ? rowStateBg('highlighted')
                                            : expandedIds.has(r.id) ? rowStateBg('expanded')
                                            : lvZebra(idx),
                                        borderBottom: '1px solid #c0bdb5',
                                        cursor: 'pointer',
                                    }}>
                                        <ExpanderCell expanded={expandedIds.has(r.id)} onToggle={() => toggleExpand(r.id)} label="lab dip detail"
                                            tdStyle={lvTdRuled()} />
                                        <td style={lvTdRuled()}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <div>
                                                    <CodeChip code={r.code} tone="accent" style={{ fontWeight: 'bold' }} />
                                                    {r.items?.some((it: any) => it.approval_image_url || it.rejection_image_url) && (
                                                        <i className="bi bi-paperclip" title="Has attached photo(s)" style={{ marginLeft: 4, fontSize: 11, color: '#555' }} />
                                                    )}
                                                    <div style={{ fontSize: 9, color: '#555'}}>{r.created_at ? tzDate(r.created_at) : ''}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td style={lvTdRuled()}>
                                            {r.customer_id ? getCustomerName(r.customer_id) : <span style={{ fontSize: 9, color: '#555', fontStyle: 'italic' }}>Internal</span>}
                                        </td>
                                        <td style={lvTdRuled()}>
                                            {(() => {
                                                const its = r.items || [];
                                                if (!its.length) return <span style={{ fontSize: 9, color: '#888', fontStyle: 'italic' }}>—</span>;
                                                const first = its[0];
                                                const firstCode = first.variant_code || `${seqPart(r.code)}-${variantLetter(first.variant_seq ?? 0)}`;
                                                const firstParts = splitVariantCode(firstCode);
                                                return (
                                                    <>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <span style={{ ...seqBadge(), fontSize: 9, padding: '0 5px' }}>{firstParts.seq}</span>
                                                            <span style={{ ...variantBadge(), fontSize: 9, padding: '0 5px' }}>{firstParts.variant}</span>
                                                            <span style={{ fontWeight: 'bold', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{first.item_name || first.item_code || '—'}</span>
                                                        </div>
                                                        {its.length > 1 && <div style={{ fontSize: 9, color: '#555'}}>+{its.length - 1} more</div>}
                                                    </>
                                                );
                                            })()}
                                        </td>
                                        <td style={lvTdRuled()}>
                                            {(() => {
                                                const dips = (r.dips || []).filter((d: any) => !d.lab_dip_item_id);
                                                if (!dips.length) return <span style={{ fontSize: 9, color: '#888', fontStyle: 'italic' }}>—</span>;
                                                return (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 3 }}>
                                                        {dips.map((d: any) => <ColorSwatchChip key={d.id || d.color_name} label={d.color_name} hex={hexByColorName[d.color_name]} />)}
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                        <td style={lvTdRuled()}><span style={{ fontSize: 10}}>{r.request_type}</span></td>
                                        <td style={lvTdRuled()}><span style={statusStyle(r.status)}>{r.status}</span></td>
                                        <td style={lvTdRuled()}>
                                            {total > 0 ? (
                                                <span style={{ fontSize: 11}}>
                                                    <span style={{ fontWeight: 'bold', color: approved === total ? ('#1a6e1a') : approved > 0 ? ('#0047c8') : ('#777') }}>{approved}</span>
                                                    <span style={{ color: '#777'}}>/{total}</span>
                                                    <span style={{ fontSize: 9, color: '#555', marginLeft: 3 }}>approved</span>
                                                </span>
                                            ) : <span style={{ fontSize: 9, color: '#888', fontStyle: 'italic' }}>—</span>}
                                        </td>
                                        <td style={lvTdRuled()}>
                                            <span style={{ fontSize: 10, color: '#333', whiteSpace: 'nowrap' as const }}>
                                                {r.updated_at ? tzDateTime(r.updated_at) : (r.created_at ? tzDateTime(r.created_at) : '—')}
                                            </span>
                                        </td>
                                        <td style={{ ...lvTdRuled(), borderRight: 'none', textAlign: 'right' as const }} onClick={e => e.stopPropagation()}>
                                            <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end', alignItems: 'center' }}>
                                                {canManage && (
                                                <MenuTriggerButton onClick={e => menuToggle(String(r.id), e)} />
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                    {expandedIds.has(r.id) && (() => {
                                        const fmt = (d: any) => d ? tzDate(d) : '—';
                                        const recipeLabel = recipeOptions.find((o: any) => o.value === r.approved_recipe_id)?.label;
                                        // Progress/Reject toggle: clicking the active one reverts to PENDING.
                                        // APPROVED/REJECTED are terminal (locked) — guarded here and on the server.
                                        const setItemStatus = (itemId: string, cur: string, next: string) => {
                                            if (cur === 'APPROVED' || cur === 'REJECTED') return;
                                            doUpdateItemStatus(r.id, itemId, cur === next ? 'PENDING' : next);
                                        };

                                        const columns = [
                                            { header: 'Item' },
                                            { header: 'Code', width: 104 },
                                            { header: 'Status', width: 96 },
                                            { header: 'Rejections', width: 92, align: 'center' as const },
                                            { header: 'Update Status', width: 224, align: 'center' as const },
                                            // Proof photo of whichever side the variant landed on (approval or rejection).
                                            { header: 'Photo', width: 72, align: 'center' as const },
                                            { header: '', width: 40, align: 'center' as const },
                                        ];

                                        // One row per selected item: item name, color code+variant, status, update control.
                                        const rows = (r.items || []).map((it: any) => {
                                            const status = it.status || 'PENDING';
                                            const locked = status === 'APPROVED' || status === 'REJECTED';
                                            const variantCode = it.variant_code || `${seqPart(r.code)}-${variantLetter(it.variant_seq ?? 0)}`;
                                            const codeParts = splitVariantCode(variantCode);
                                            const stripe = getStatusStripe(status);
                                            return {
                                                key: it.id,
                                                stripeColor: stripe.borderLeftColor,
                                                background: stripe.background,
                                                cells: [
                                                    <span style={{ fontWeight: 'bold', color: '#0d3a8a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, display: 'block' }}>{it.item_name || it.item_code || '—'}</span>,
                                                    // Color code + variant; the full approved code once approved.
                                                    it.approved_color_code ? (
                                                        <span title="Approved color code (saved to library)" style={{ ...variantBadge(), fontSize: 9, padding: '0 6px', background: '#1b7a34', color: '#fff', borderColor: '#0f5a22'}}>{it.approved_color_code}</span>
                                                    ) : (
                                                        <span style={{ ...seqBadge(), fontFamily: CODE_FONT, fontSize: 10}}>{variantCode}</span>
                                                    ),
                                                    <StatusChip status={status} tint />,
                                                    // Rejections column: a clear "log" button (icon + count) that opens the
                                                    // history trace. Bordered/underlined so it reads as clickable, not a static tag.
                                                    (it.rejection_count ?? 0) > 0 ? (
                                                        <button
                                                            type="button"
                                                            title={`View ${it.rejection_count} rejection${it.rejection_count === 1 ? '' : 's'} — reasons & notes`}
                                                            onClick={() => setHistoryItem({ item: it, code: variantCode })}
                                                            style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #a01a1a', background: '#f8d7da', color: '#7f0000', borderRadius: CHIP_RADIUS, fontSize: 10, fontWeight: 'bold', lineHeight: 1.5, padding: '0 6px', textDecoration: 'underline', textUnderlineOffset: 2 }}
                                                        >
                                                            <i className="bi bi-clock-history" style={{ fontSize: 10, textDecoration: 'none' }} />
                                                            {it.rejection_count}x
                                                        </button>
                                                    ) : <span style={{ color: '#aaa', fontSize: 11}}>—</span>,
                                                    canManage ? (
                                                        <FilterChipBar
                                                            disabled={locked}
                                                            flat
                                                            value={status === 'IN_PROGRESS' ? 'progress' : status === 'APPROVED' ? 'approved' : status === 'REJECTED' ? 'rejected' : null}
                                                            options={[
                                                                { value: 'progress', label: 'Progress', tone: 'amber' as ChipTone },
                                                                { value: 'approved', label: 'Approved', tone: 'green' as ChipTone },
                                                                { value: 'rejected', label: 'Rejected', tone: 'red' as ChipTone },
                                                            ]}
                                                            onChange={key => {
                                                                if (key === 'progress') setItemStatus(it.id, status, 'IN_PROGRESS');
                                                                else if (key === 'approved') openApproval(r.id, { id: it.id, status, seq: codeParts.seq, variant: codeParts.variant, colorNames: itemColorNames(r, it), customerName: r.customer_id ? getCustomerName(r.customer_id) : null });
                                                                else if (key === 'rejected') openReject(r.id, { id: it.id, status, seq: codeParts.seq, variant: codeParts.variant });
                                                            }}
                                                        />
                                                    ) : <span style={{ color: '#999' }}>—</span>,
                                                    // Photo column — only one side can be current, so this is whichever
                                                    // status the variant rests on. Earlier rounds stay on their event rows.
                                                    statusPhotoThumb(
                                                        status === 'APPROVED' ? it.approval_image_url : status === 'REJECTED' ? it.rejection_image_url : null,
                                                        status === 'APPROVED' ? 'Approval photo' : 'Rejection photo',
                                                    ) || <span style={{ color: '#aaa', fontSize: 11}}>—</span>,
                                                    // Jump to the minted color code in the Color Library (approved), or resubmit a fresh request (rejected).
                                                    (status === 'APPROVED' && it.approved_color_code) ? (
                                                        <button
                                                            type="button"
                                                            title={`Open color code ${it.approved_color_code} in library`}
                                                            className={XP_BTN}
                                                            style={{ ...xpBtn({ padding: '1px 5px', lineHeight: 1, color: '#0d3a8a'}) }}
                                                            onClick={() => router.push(`/colors?search=${encodeURIComponent(it.approved_color_code)}`)}
                                                        >
                                                            <i className="bi bi-box-arrow-up-right" style={{ fontSize: 10}} />
                                                        </button>
                                                    ) : (status === 'REJECTED' && canManage) ? (
                                                        <button
                                                            type="button"
                                                            title={`Reopen ${variantCode} for another round (keeps rejection history)`}
                                                            className={XP_BTN}
                                                            style={{ ...xpBtn({ padding: '1px 5px', lineHeight: 1, color: '#a05a00'}) }}
                                                            onClick={() => doUpdateItemStatus(r.id, it.id, 'IN_PROGRESS')}
                                                        >
                                                            <i className="bi bi-arrow-repeat" style={{ fontSize: 10}} />
                                                        </button>
                                                    ) : <span style={{ color: '#bbb' }}>—</span>,
                                                ],
                                            };
                                        });

                                        const sections = [
                                            { title: 'Identity', fields: [
                                                { label: 'Customer', value: r.customer_id ? getCustomerName(r.customer_id) : 'Internal' },
                                                { label: 'Season / Project', value: r.season || '—' },
                                                { label: 'Request Type', value: r.request_type || '—' },
                                                { label: 'Request Date', value: fmt(r.request_date) },
                                            ]},
                                            { title: colorsAttrName, fields: [
                                                { label: colorsAttrName, value: (() => {
                                                    const dips = (r.dips || []).filter((d: any) => !d.lab_dip_item_id);
                                                    if (!dips.length) return '—';
                                                    return (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5 }}>
                                                            {dips.map((d: any) => <ColorSwatchChip key={d.id || d.color_name} label={d.color_name} hex={hexByColorName[d.color_name]} />)}
                                                        </div>
                                                    );
                                                })(), full: true },
                                            ]},
                                            { title: 'Recipe & Notes', fields: [
                                                { label: 'Approved Recipe', value: recipeLabel || '—', full: true },
                                                { label: 'Notes', value: r.notes || '—', full: true },
                                            ]},
                                        ];

                                        const rightHeader = (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', flexWrap: 'wrap' as const, borderBottom: '1px solid #d0cdc8', background: '#fff' }}>
                                                <span style={{ fontSize: 10, fontWeight: 'bold', color: '#111'}}>Request Status:</span>
                                                <select style={{ ...xpInput(), width: 140 }} value={r.status} disabled={!canManage} onChange={e => doUpdateStatus(r.id, e.target.value)}>
                                                    {REQUEST_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                                </select>
                                            </div>
                                        );

                                        return (
                                        <tr>
                                            <td colSpan={10} style={{ padding: 0 }}>
                                                <ExpandedRowPanel style={{ overflow: 'hidden' }}>
                                                    <RequestDetailPanel
                                                        leftTitle={<><i className="bi bi-box-seam" /> Variants — {total} total · {approved} approved</>}
                                                        leftWidth="62%"
                                                        columns={columns}
                                                        rows={rows}
                                                        emptyText="No items on this request."
                                                        sections={sections}
                                                        rightHeader={rightHeader}
                                                        minHeight={170}
                                                    />
                                                </ExpandedRowPanel>
                                            </td>
                                        </tr>
                                        );
                                    })()}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <Pager page={page} total={total} pageSize={LABDIP_PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />

            {/* ── Status bar: variant-grain tallies over the filtered set ── */}
            <div style={{ background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' as const, fontFamily: xpFont, fontSize: 10, color: '#333', flexShrink: 0 }}>
                <span>
                    {total} request{total !== 1 ? 's' : ''} · {variantStats.total} variant{variantStats.total !== 1 ? 's' : ''}
                </span>
                <span style={{ width: 1, height: 15, background: '#a0988c', margin: '0 2px' }} />
                <StatusCountPill status="PENDING" count={variantStats.PENDING} title="Variants not yet started" />
                <StatusCountPill status="IN_PROGRESS" count={variantStats.IN_PROGRESS} title="Variants in progress" />
                <StatusCountPill status="APPROVED" count={variantStats.APPROVED} title="Variants approved" />
                <StatusCountPill status="REJECTED" count={variantStats.REJECTED} title="Variants rejected" />
                {hasActiveFilter && <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>filtered</span>}
            </div>

            {/* ── Row ⋯ menu: Edit / Delete ── */}
            {menuOpenId && (() => {
                // Row lookup in the loaded page is safe: the ⋯ menu is opened from a row
                // that is on screen, and it closes on any list change.
                const r = labDips.find((x: any) => String(x.id) === menuOpenId);
                if (!r || !canManage) return null;
                return (
                    <FloatingMenu
                        pos={menuPos}
                        items={[
                            { key: 'edit', label: 'Edit', icon: 'bi-pencil', onClick: () => { menuClose(); openEdit(r); } },
                            { key: 'delete', label: 'Delete', icon: 'bi-trash', danger: true, onClick: () => { menuClose(); doDelete(r.id); } },
                        ]}
                    />
                );
            })()}

            {/* Create / Edit modal */}
            <ModalWrapper
                isOpen={isModalOpen}
                modeless
                onClose={() => { setIsModalOpen(false); setEditing(null); }}
                title={editing ? <><i className="bi bi-pencil me-2" />Edit {requestNoun} — {editing.code}</> : <><i className={`${isYarn ? 'bi bi-droplet-half' : 'bi bi-droplet'} me-2`} />New {requestNoun}</>}
                variant="primary"
                size="lg"
                footer={
                    <>
                        <button type="button" className={XP_BTN} style={xpBtn()} onClick={() => { setIsModalOpen(false); setEditing(null); }}>Cancel</button>
                        <button type="button" className={XP_BTN} style={xpBtn({ ...BTN_TONES.primary })} onClick={handleSubmit as any}>
                            {editing ? 'Save Changes' : 'Create Request'}
                        </button>
                    </>
                }
            >
                <form onSubmit={handleSubmit} id="create-lab-dip-form">
                    {/* Identity */}
                    <FormSection title="Identity">
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                                <div>
                                    <label style={xpLbl()}>Request Code</label>
                                    <div style={{ fontFamily: CODE_FONT, fontSize: 14, fontWeight: 'bold', color: '#000055', padding: '2px 0'}}>
                                        {displayCode}
                                        {!editing && <span style={{ fontFamily: modernFont, fontSize: 9, fontWeight: 400, color: '#888', marginLeft: 6 }}>(on save)</span>}
                                    </div>
                                </div>
                                <div>
                                    <label style={xpLbl()}>Request Type</label>
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                                        {REQUEST_TYPES.map(t => {
                                            const active = form.request_type === t;
                                            return (
                                                <button key={t} type="button" onClick={() => setField('request_type', t)} style={{ fontFamily: xpFont, fontSize: 10, fontWeight: 'bold', padding: '2px 9px', cursor: 'pointer', border: '1px solid', background: active ? 'linear-gradient(to bottom, #316ac5, #1a4a8a)' : 'linear-gradient(to bottom, #ffffff, #d4d0c8)', borderColor: active ? '#1a3a7a #0a1a4a #0a1a4a #1a3a7a' : '#dfdfdf #808080 #808080 #dfdfdf', color: active ? '#fff' : '#333' }}>
                                                    {t}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div>
                                    <label style={xpLbl()}>Customer (Optional)</label>
                                    <SearchableSelect options={customerOptions} value={form.customer_id} onChange={(v: string) => setField('customer_id', v)} placeholder="Select customer…" />
                                </div>
                                <div>
                                    <label style={xpLbl()}>Season / Project</label>
                                    <input style={{ ...xpInput(), width: '100%', boxSizing: 'border-box' as const }} value={form.season} onChange={e => setField('season', e.target.value)} placeholder="e.g. Spring 2026" />
                                </div>
                            </div>
                    </FormSection>

                    {/* Items */}
                    <FormSection title="Items">
                            {/* Add item — finished good on the FG book, yarn on the yarn book */}
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
                                <div style={{ flex: 1 }}>
                                    <SearchableSelect
                                        options={itemOptions.filter((o: any) => !form.items.some(it => it.item_id === o.value))}
                                        value={pendingItem}
                                        onChange={setPendingItem}
                                        onSearch={onSearchItems}
                                        placeholder={isYarn ? 'Add yarn item…' : 'Add finished-good item…'}
                                        size="sm"
                                    />
                                </div>
                                <button type="button" className={XP_BTN} style={xpBtn()} onClick={addItem}><i className="bi bi-plus-lg" /> Add Item</button>
                            </div>

                            {form.items.length === 0 && (
                                <div style={{ fontSize: 11, color: '#999', fontStyle: 'italic', padding: '4px 2px' }}>
                                    No items yet — add {isYarn ? 'yarn' : 'finished-good'} items; each is assigned a variant code.
                                </div>
                            )}

                            {(() => {
                                // Preview variant_seq per item: existing keep theirs; new items take
                                // the next index above the max kept seq (matches the server's rule).
                                const keptSeqs = form.items.filter(it => it.variant_seq !== undefined).map(it => it.variant_seq as number);
                                let np = keptSeqs.length ? Math.max(...keptSeqs) + 1 : 0;
                                return form.items.map(it => {
                                const seq = it.variant_seq !== undefined ? it.variant_seq : np++;
                                return (
                                    <div key={it.item_id} style={{ border: '1px solid #b0c8e8', background: '#f5f9ff', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
                                        {/* Item name (left) */}
                                        <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 11, color: '#0d3a8a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                                            <i className="bi bi-box-seam" style={{ marginRight: 5, color: '#3a6fc4'}} />{it.item_label || it.item_id}
                                        </span>
                                        {/* Two distinct badges: sequence + variant (right) — or, for a resubmitted
                                            item, a single pinned badge showing the code it keeps from the rejected item. */}
                                        {it.locked_variant_code ? (
                                            <span title="Pinned code (kept from the rejected item being resubmitted)" style={{ ...variantBadge(), background: '#c77800', color: '#fff', borderColor: '#7a4a00'}}>
                                                <i className="bi bi-pin-angle-fill" style={{ marginRight: 3, fontSize: 9}} />{it.locked_variant_code}
                                            </span>
                                        ) : (
                                            <>
                                                <span title="Request sequence" style={seqBadge()}>{seqPart(displayCode)}</span>
                                                <span title="Variant" style={variantBadge()}>{variantLetter(seq)}</span>
                                            </>
                                        )}
                                        <button type="button" title="Remove item" onClick={() => removeItem(it.item_id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a00', fontSize: 15, fontWeight: 'bold', lineHeight: 1, padding: '0 2px' }}>×</button>
                                    </div>
                                );
                                });
                            })()}
                    </FormSection>

                    {/* Colors — applies to all items on this request */}
                    <FormSection title={colorsAttrName}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
                                <div style={{ flex: 1 }}>
                                    <SearchableSelect
                                        options={colorOptions.filter((o: any) => !form.legacyDips.some(d => d.color_name === o.value))}
                                        value={pendingColor}
                                        onChange={setPendingColor}
                                        placeholder={`Add ${colorsAttrName.toLowerCase()}…`}
                                        size="sm"
                                    />
                                </div>
                                <button type="button" className={XP_BTN} style={xpBtn()} onClick={addColor}><i className="bi bi-plus-lg" /> Add</button>
                            </div>
                            {form.legacyDips.length === 0 ? (
                                <div style={{ fontSize: 11, color: '#999', fontStyle: 'italic', padding: '4px 2px' }}>
                                    No colors picked yet — applies to all items above.
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                                    {form.legacyDips.map(d => (
                                        <ColorSwatchChip key={d.color_name} label={d.color_name} hex={hexByColorName[d.color_name]} onRemove={() => removeColor(d.color_name)} />
                                    ))}
                                </div>
                            )}
                    </FormSection>

                    {/* Recipe link & notes */}
                    <FormSection title="Approved Recipe & Notes">
                            <div style={{ marginBottom: 8 }}>
                                <label style={xpLbl()}>Approved Dye Recipe (Optional)</label>
                                <SearchableSelect options={[{ value: '', label: 'Not yet linked' }, ...recipeOptions]} value={form.approved_recipe_id} onChange={(v: string) => setField('approved_recipe_id', v)} placeholder="Link approved recipe…" />
                            </div>
                            <div>
                                <label style={xpLbl()}>Notes</label>
                                <textarea style={{ ...xpInput(), height: 'auto', padding: '4px 6px', width: '100%', resize: 'vertical' as const, boxSizing: 'border-box' as const }} rows={2} value={form.notes} onChange={e => setField('notes', e.target.value)} />
                            </div>
                    </FormSection>
                </form>
            </ModalWrapper>

            {/* Approve variant → capture the "set" index, mint the color code */}
            <ModalWrapper
                isOpen={!!approval}
                modeless
                onClose={() => setApproval(null)}
                title={<><i className="bi bi-check2-circle me-2" />Approve Variant</>}
                variant="success"
                size="sm"
                footer={
                    <>
                        <button type="button" className={XP_BTN} style={xpBtn()} onClick={() => setApproval(null)}>Cancel</button>
                        <button type="button" className={XP_BTN} disabled={!approvalSet.trim()} style={xpBtn({ background: 'linear-gradient(to bottom, #7bd88f, #1b7a34)', borderColor: '#0f5a22 #073d15 #073d15 #0f5a22', color: '#04220c', fontWeight: 'bold', opacity: approvalSet.trim() ? 1 : 0.55 })}
                            onClick={confirmApproval}>
                            Approve &amp; Save Color
                        </button>
                    </>
                }
            >
                {approval && (
                    <div style={{ padding: '2px 2px 4px' }}>
                        <label style={xpLbl()}>Set Index</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <span style={{ ...seqBadge(), fontSize: 11}}>{approval.seq}</span>
                            <span style={{ ...variantBadge(), fontSize: 11}}>{approval.variant}</span>
                            <span style={{ fontFamily: CODE_FONT, fontWeight: 700, color: '#555'}}>–</span>
                            <input autoFocus style={{ ...xpInput(), width: 90 }} value={approvalSet}
                                onChange={e => setApprovalSet(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') confirmApproval(); }}
                                placeholder="e.g. 5" />
                        </div>
                        <div style={{ fontSize: 11, color: '#555', marginBottom: 10 }}>
                            Approved color code:{' '}
                            <span style={{ fontFamily: CODE_FONT, fontWeight: 700, color: '#1b7a34'}}>
                                {approval.seq}-{approval.variant}-{approvalSet.trim() || '…'}
                            </span>
                            {' '}— saved to the Color library.
                        </div>
                        {/* Color Variant carried onto the minted shade → shows in the Color Codes table.
                            Prefilled when the request picked exactly one color. */}
                        <label style={xpLbl()}>Color Variant</label>
                        {approvalVariantOptions.length === 0 ? (
                            <div style={{ fontSize: 11, color: '#999', fontStyle: 'italic', marginBottom: 10 }}>
                                No {colorsAttrName.toLowerCase()} picked on this request — the color will not be linked to a variant.
                            </div>
                        ) : (
                            <div style={{ marginBottom: 10 }}>
                                <select style={{ ...xpInput(), width: '100%', boxSizing: 'border-box' as const }}
                                    value={approvalVariantId} onChange={e => setApprovalVariantId(e.target.value)}>
                                    <option value="">Not linked to a variant</option>
                                    {approvalVariantOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                        )}
                        {/* Read-only: the request's customer is stamped on the minted shade
                            (House color when the request has none). */}
                        <label style={xpLbl()}>Customer</label>
                        <div style={{ fontSize: 11, color: approval.customerName ? ('#333') : ('#999'), fontStyle: approval.customerName ? 'normal' : 'italic', marginBottom: 10 }}>
                            {approval.customerName || 'No customer on this request — saved as a House color.'}
                        </div>
                        <label style={xpLbl()}>Notes (optional)</label>
                        <textarea style={{ ...xpInput(), height: 'auto', padding: '4px 6px', width: '100%', resize: 'vertical' as const, boxSizing: 'border-box' as const }} rows={2} value={approvalNotes} onChange={e => setApprovalNotes(e.target.value)} placeholder="Optional note carried onto the color entry…" />
                        <label style={{ ...xpLbl(), marginTop: 10 }}>Photo (optional)</label>
                        <input type="file" accept="image/*"
                            style={{ ...xpInput(), height: 'auto', padding: '3px 4px', width: '100%', boxSizing: 'border-box' as const }}
                            onChange={e => setApprovalImage(e.target.files?.[0] || null)} />
                        {approvalImage && <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{approvalImage.name}</div>}
                    </div>
                )}
            </ModalWrapper>

            {/* Reject variant → confirm with a reason + optional notes */}
            <ModalWrapper
                isOpen={!!reject}
                modeless
                onClose={() => setReject(null)}
                title={<><i className="bi bi-x-octagon me-2" />Reject Variant</>}
                variant="danger"
                size="sm"
                footer={
                    <>
                        <button type="button" className={XP_BTN} style={xpBtn()} onClick={() => setReject(null)}>Cancel</button>
                        <button type="button" className={XP_BTN} style={xpBtn({ background: 'linear-gradient(to bottom, #d32f2f, #8b0000)', borderColor: '#7f0000 #4a0000 #4a0000 #7f0000', color: '#fff', fontWeight: 'bold' })}
                            onClick={confirmReject}>
                            Reject Variant
                        </button>
                    </>
                }
            >
                {reject && (
                    <div style={{ padding: '2px 2px 4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                            <span style={{ ...seqBadge(), fontSize: 11}}>{reject.seq}</span>
                            <span style={{ ...variantBadge(), fontSize: 11}}>{reject.variant}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#555', marginBottom: 10 }}>
                            This rejection is logged for traceability. The variant rests as Rejected — reopen it for another round when ready.
                        </div>
                        <label style={xpLbl()}>Rejection Reason</label>
                        <select style={{ ...xpInput(), width: '100%', boxSizing: 'border-box' as const, marginBottom: 10 }}
                            value={rejectReason} onChange={e => setRejectReason(e.target.value)}>
                            {REJECT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <label style={xpLbl()}>Notes (optional)</label>
                        <textarea style={{ ...xpInput(), height: 'auto', padding: '4px 6px', width: '100%', resize: 'vertical' as const, boxSizing: 'border-box' as const }} rows={2}
                            value={rejectNotes} onChange={e => setRejectNotes(e.target.value)}
                            placeholder="Extra detail for this rejection…" />
                        <label style={{ ...xpLbl(), marginTop: 10 }}>Photo (optional)</label>
                        <input type="file" accept="image/*"
                            style={{ ...xpInput(), height: 'auto', padding: '3px 4px', width: '100%', boxSizing: 'border-box' as const }}
                            onChange={e => setRejectImage(e.target.files?.[0] || null)} />
                        {rejectImage && <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{rejectImage.name}</div>}
                    </div>
                )}
            </ModalWrapper>

            {/* Approval / rejection photo preview — modeless so the variant table stays usable. */}
            {photoPreview && (
                <ModalWrapper
                    isOpen={true}
                    modeless
                    onClose={() => setPhotoPreview(null)}
                    title={<><i className="bi bi-image me-2" />Photo: {photoPreview.filename}</>}
                    size="xl"
                    variant="primary"
                    level={2}
                    footer={
                        <>
                            <span style={{ flex: 1, fontFamily: xpFont, fontSize: 10, color: '#666', textAlign: 'left' as const }}>{photoPreview.filename}</span>
                            <button type="button" className={XP_BTN} style={xpBtn()} onClick={() => window.open(photoPreview.url, '_blank')}>Open Full View</button>
                            <button type="button" className={XP_BTN} style={xpBtn()} onClick={() => setPhotoPreview(null)}>Close</button>
                        </>
                    }
                >
                    <div style={{ textAlign: 'center' as const, padding: 6 }}>
                        {photoPreview.filename.toLowerCase().endsWith('.pdf') ? (
                            <embed src={photoPreview.url} type="application/pdf" style={{ width: '100%', height: 'calc(var(--app-vh) * 70 / 100)', border: 'none' }} />
                        ) : (
                            <img src={photoPreview.url} alt={photoPreview.filename} style={{ maxWidth: '100%', maxHeight: 'calc(var(--app-vh) * 70 / 100)' }} />
                        )}
                    </div>
                </ModalWrapper>
            )}

            {/* Rejection history — every reject round with its reason + notes (traceability). */}
            <ModalWrapper
                isOpen={!!historyItem}
                modeless
                onClose={() => setHistoryItem(null)}
                title={<><i className="bi bi-clock-history me-2" />Rejection History</>}
                size="sm"
                footer={<button type="button" className={XP_BTN} style={xpBtn()} onClick={() => setHistoryItem(null)}>Close</button>}
            >
                {historyItem && (
                    <div style={{ padding: '2px 2px 4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                            <span style={{ fontWeight: 'bold', color: '#0d3a8a', fontSize: 12}}>{historyItem.item.item_name || historyItem.item.item_code || '—'}</span>
                            <span style={{ ...variantBadge(), fontSize: 10}}>{historyItem.code}</span>
                        </div>
                        {(historyItem.item.rejections || []).length === 0 ? (
                            <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>No rejections recorded.</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
                                {(historyItem.item.rejections || []).map((rj: any) => (
                                    <div key={rj.id} style={{ border: '1px solid #d9b8b8', background: '#fbeeee', borderRadius: 0, padding: '5px 7px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                                            <span style={{ fontWeight: 'bold', fontSize: 10, color: '#7f0000'}}>Round {rj.round_no}</span>
                                            <span style={{ fontSize: 9, color: '#888' }}>{rj.rejected_at ? new Date(rj.rejected_at).toLocaleString() : ''}</span>
                                        </div>
                                        <div style={{ fontSize: 11, color: '#333'}}>{rj.reason || '—'}</div>
                                        {rj.notes && <div style={{ fontSize: 10, color: '#666', marginTop: 2, whiteSpace: 'pre-wrap' as const }}>{rj.notes}</div>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </ModalWrapper>
        </div>
    );
}
