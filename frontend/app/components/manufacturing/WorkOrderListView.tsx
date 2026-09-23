'use client';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useUser } from '../../context/UserContext';
import { useTimezone } from '../../context/TimezoneContext';

import { useToast } from '../shared/Toast';
const WOCompletionModal = dynamic(() => import('./WOCompletionModal'), { ssr: false });
// Single-WO Kartu Kerja printing is handled by WOBulkPrintModal (n=1 -> A6); no separate single modal.
const WOBulkPrintModal = dynamic(() => import('./WOBulkPrintModal'), { ssr: false });
const WOStagingModal = dynamic(() => import('./WOStagingModal'), { ssr: false });
const BagLabelPrintModal = dynamic(() => import('./BagLabelPrintModal'), { ssr: false });
const BagScanStageModal = dynamic(() => import('./BagScanStageModal'), { ssr: false });
import { getChipStyle, PrintChips } from './WorkOrderPanel';
import Pager from '../shared/Pager';
import { XPEmptyState, TableSkeleton, useTableSkeletonMetrics, XPStatusBar, useSortable, useFloatingMenu, MenuTriggerButton, FloatingMenu, XPActionButton, ExpandedRowPanel, ProgressBar, CodeChip, CODE_FONT, xpFont, rowStateBg, StatusChip, CHIP_RADIUS, colorLabel, xpInput as xpInputBase } from '../shared/xpTheme';
import TreeSelect, { TreeSelectOption } from '../shared/TreeSelect';
import { lvSubTh, lvSubTd, lvSubTable, lvSubRow, ExpanderCell, useRowSelection, RowCheckbox, SelectAllCheckbox, LV_CHECK_COL_W, LV_EXPANDER_COL_W, SortableTh, lvThSticky, lvTd, lvZebra, useColumnWidths } from '../shared/listViewTheme';
import { childrenOfWC, isMachineWC, isTypeWC, woHasStaging, woScanStages } from '../shared/workCenterTree';
import { rejectTitle } from '../shared/rejectDisplay';
import SearchableSelect from '@bryanadamg/terras-ui/components/Combobox';
import VariantChips from '../shared/VariantChips';
import { Tabs, TabDef } from '../shared/Tabs';
import { SearchField, pageFillStyle, viewShellStyle, xpTitleBar } from '../shared/shellTheme';

const STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

// Reserves a fixed-width slot for one row action. When the row can't perform
// the action the slot renders empty instead of collapsing, so the remaining
// icons stay in the same column across every row.
function ActionSlot({ width, show, children }: { width: number; show: boolean; children: React.ReactNode }) {
    return (
        <span style={{ width, flex: `0 0 ${width}px`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            {show ? children : null}
        </span>
    );
}

type WOTabKey = 'ALL' | 'BEAMING' | 'WEAVING' | 'DYEING' | 'SETTING' | 'OTHERS';
const WO_TABS: TabDef<WOTabKey>[] = [
    { key: 'ALL',     label: 'All',     icon: 'bi-collection' },
    { key: 'BEAMING', label: 'Beaming', icon: 'bi-diagram-3' },
    { key: 'WEAVING', label: 'Weaving', icon: 'bi-grid-3x3' },
    { key: 'DYEING',  label: 'Dyeing',  icon: 'bi-droplet-half' },
    { key: 'SETTING', label: 'Setting', icon: 'bi-thermometer-half' },
    { key: 'OTHERS',  label: 'Others',  icon: 'bi-three-dots' },
];

interface Props {
    workOrders: any[];
    total: number;
    page: number;
    pageSize: number;
    onPageChange: (page: number) => void;
    workCenters: any[];
    filterStatus: string;
    filterGroup: string;
    filterWC: string;
    woSearch: string;
    activeTab: string;
    itemIndex: Record<string, { name: string; code: string }>;
    filterComponentId: string;
    filterUnprinted: boolean;
    onTabChange: (v: string) => void;
    onFilterStatus: (v: string) => void;
    onFilterWCChange: (groupId: string, wcId: string) => void;
    onFilterComponent: (itemId: string) => void;
    onFilterUnprinted: (v: boolean) => void;
    onSearch: (v: string) => void;
    onClearFilters: () => void;
    onUpdate: (id: string, payload: any) => Promise<any>;
    onUpdateStatus: (id: string, status: string) => Promise<any>;
    onDelete: (id: string) => Promise<any>;
    onFetchMO: (moId: string) => Promise<any>;
    onRefresh: () => void;
    loading?: boolean;
}

interface FlatWO {
    id: string;
    sequence: number;
    name: string;
    work_center_id?: string;
    work_center_name?: string;
    work_center_type?: string;
    input_location_id?: string;
    output_location_id?: string;
    input_location?: { id: string; code: string; name: string } | null;
    output_location?: { id: string; code: string; name: string } | null;
    next_destination_location_id?: string;
    next_destination_work_center_id?: string;
    next_destination_location_name?: string;
    next_destination_work_center_name?: string;
    ends?: number;
    status: string;
    planned_duration_hours?: number;
    actual_duration_hours?: number;
    actual_start_date?: string;
    actual_end_date?: string;
    target_start_date?: string;
    target_end_date?: string;
    created_at?: string;
    qty?: number;
    qty_completed_total?: number;
    qty_rejected_total?: number;   // scrap logged on this step (MO yield analysis)
    notes?: string;
    completions?: any[];
    bom_line_item_ids?: string[];
    bom_operation_id?: string | null;
    staging_status?: string;
    mo_id: string;
    mo_code: string;
    root_mo_id?: string | null;
    root_mo_code?: string | null;
    root_mo_count?: number;
    root_mo_codes?: string[];
    item_name: string;
    combo_label?: string | null;
    color_label?: string | null;
    size_label?: string | null;
    color_id?: string | null;
    color_code?: string | null;
    color_name?: string | null;
    color_hex?: string | null;
    labdip_variant_code?: string | null;
}

// Column widths for the WO grid. Order matches the `<thead>` cells exactly — the
// resize grips index into this array, so a column added here needs one added there.
const WO_COL_W: (number | string)[] = [
    LV_CHECK_COL_W,     // checkbox
    LV_EXPANDER_COL_W,  // chevron
    190,                // Root MO
    34,                 // #
    '18%',              // Name
    '14%',              // Product
    '16%',              // Variant
    '11%',              // Work Center
    86,                 // Target / Done
    90,                 // Target Start
    90,                 // Target End
    98,                 // Actual Start
    98,                 // Actual End
    98,                 // Created
    112,                // Status
    78,                 // Actions
];

export default function WorkOrderListView({
    workOrders, total, page, pageSize, onPageChange,
    workCenters, filterStatus, filterGroup, filterWC, woSearch,
    activeTab, itemIndex, filterComponentId, filterUnprinted, onTabChange,
    onFilterStatus, onFilterWCChange, onFilterComponent, onFilterUnprinted, onSearch, onClearFilters,
    onUpdate, onUpdateStatus, onDelete, onFetchMO, onRefresh,
    loading = false,
}: Props) {
    const router = useRouter();
    // Dense: the completion log shares its row with the other detail panes.
    const subTh = lvSubTh();
    const subTd = lvSubTd();
    const { hasPermission, hasAnyPermission } = useUser();
    const canManage = hasAnyPermission('work_order.edit', 'work_order.delete', 'work_order.print_card', 'work_order.stage');
    const { formatCustom: tzFmt } = useTimezone();
    const fmtDate = (v: any) => {
        if (!v) return '—';
        return tzFmt(v, { day: '2-digit', month: 'short', year: 'numeric' }, 'id-ID');
    };
    const fmtDateTime = (v: any) => {
        if (!v) return '—';
        return tzFmt(v, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }, 'id-ID');
    };

    const { showToast } = useToast();
    // Floating "more actions" menu (Print / Edit / Delete)
    const { openId: openMenuId, pos: menuPos, toggle: toggleMenu, close: closeMenu } = useFloatingMenu();
    // Floating status menu — lists WO lifecycle statuses + staging state/action together
    const { openId: openStatusMenuId, pos: statusMenuPos, toggle: toggleStatusMenu, close: closeStatusMenu } = useFloatingMenu();
    const highlightedRowRef = useRef<HTMLTableRowElement | null>(null);
    const [highlightWOId, setHighlightWOId] = useState<string | null>(null);

    const [editId, setEditId] = useState<string | null>(null);
    const [completionMO, setCompletionMO] = useState<any>(null);
    const [completionWO, setCompletionWO] = useState<any>(null);
    const [stageWO, setStageWO] = useState<FlatWO | null>(null);
    const [scanStageWO, setScanStageWO] = useState<FlatWO | null>(null);
    const [bulkPrintOpen, setBulkPrintOpen] = useState(false);
    // Bag labels: one sticker per weighed bag (= one lotted completion on this WO).
    // The flat WO payload lacks lots/attrs/putaway the label needs, so fetch the
    // full MO on demand and feed that to the label modal.
    const [labelBags, setLabelBags] = useState<any[] | null>(null);
    const [labelMO, setLabelMO] = useState<any>(null);
    const [labelWO, setLabelWO] = useState<any>(null);
    const [labelSeqStart, setLabelSeqStart] = useState(1);
    const [labelLoadingWO, setLabelLoadingWO] = useState<string | null>(null);
    const [form, setForm] = useState({ sequence: '', name: '', work_center_id: '', planned_duration_hours: '' });
    const [isSaving, setIsSaving] = useState(false);
    const [expandedWOId, setExpandedWOId] = useState<string | null>(null);
    const [woQrUrls, setWoQrUrls] = useState<Record<string, string>>({});
    const [woComponents, setWoComponents] = useState<Record<string, any[]>>({});
    const [woComponentsLoading, setWoComponentsLoading] = useState<Record<string, boolean>>({});

    const componentOptions = useMemo(
        () => Object.entries(itemIndex).map(([id, it]) => ({ value: id, label: it.name, subLabel: it.code })),
        [itemIndex]
    );

    useEffect(() => {
        const woId = new URLSearchParams(window.location.search).get('wo');
        if (woId) setHighlightWOId(woId);
    }, []);

    useEffect(() => {
        if (!expandedWOId || woQrUrls[expandedWOId]) return;
        QRCode.toDataURL(expandedWOId, { margin: 4, width: 320, errorCorrectionLevel: 'H' })
            .then(url => setWoQrUrls(prev => ({ ...prev, [expandedWOId]: url })))
            .catch(() => {});
    }, [expandedWOId]);

    useEffect(() => {
        if (!expandedWOId || woComponents[expandedWOId]) return;
        const wo = flatWOs.find(w => w.id === expandedWOId);
        if (!wo) return;
        setWoComponentsLoading(prev => ({ ...prev, [expandedWOId]: true }));
        onFetchMO(wo.mo_id)
            .then((mo: any) => {
                const allLines: any[] = mo?.bom?.lines || [];
                // Same step-scoping as WOCompletionModal: a WO with a bom_operation_id
                // consumes only that step's lines; legacy/unassigned WOs fall back to the whole recipe.
                const lines = wo.bom_operation_id
                    ? allLines.filter((l: any) => l.bom_operation_id && String(l.bom_operation_id) === String(wo.bom_operation_id))
                    : allLines;
                const woQty = wo.qty ?? mo?.qty ?? 0;
                const rows = lines.map((l: any) => ({
                    item_id: l.item_id,
                    item_code: l.item_code,
                    item_name: l.item_name,
                    required_qty: l.percentage ? (woQty * l.percentage) / 100 : woQty * (l.qty || 0),
                }));
                setWoComponents(prev => ({ ...prev, [expandedWOId]: rows }));
            })
            .catch(() => setWoComponents(prev => ({ ...prev, [expandedWOId]: [] })))
            .finally(() => setWoComponentsLoading(prev => ({ ...prev, [expandedWOId]: false })));
    }, [expandedWOId]);

    const flatWOs: FlatWO[] = workOrders;

    // Mirrors the 3-level work-center tree: TYPE > GROUP > machine. A `grp:` value is
    // any container (type or group) — the backend filter resolves its whole subtree.
    const wcFilterTreeOptions = useMemo((): TreeSelectOption[] => {
        const nodeOption = (node: any): TreeSelectOption => {
            const kids = childrenOfWC(workCenters, node.id);
            return {
                value: `grp:${node.id}`,
                label: node.name,
                selectable: true,
                children: kids.length > 0
                    ? kids.map((k: any) => isMachineWC(k)
                        ? { value: `wc:${k.id}`, label: k.name, selectable: true }
                        : nodeOption(k))
                    : undefined,
            };
        };
        const result: TreeSelectOption[] = workCenters.filter((wc: any) => isTypeWC(wc)).map(nodeOption);
        // Machines/groups whose parent row isn't loaded — keep them reachable.
        const known = new Set(workCenters.map((wc: any) => String(wc.id)));
        workCenters
            .filter((wc: any) => wc.parent_id && !known.has(String(wc.parent_id)))
            .forEach((wc: any) => result.push({
                value: isMachineWC(wc) ? `wc:${wc.id}` : `grp:${wc.id}`,
                label: wc.name,
                selectable: true,
            }));
        return result;
    }, [workCenters]);

    const wcFilterValue = filterWC ? `wc:${filterWC}` : filterGroup ? `grp:${filterGroup}` : '';
    const onWCFilterChange = (val: string) => {
        if (!val) { onFilterWCChange('', ''); return; }
        if (val.startsWith('grp:')) { onFilterWCChange(val.slice(4), ''); }
        else { onFilterWCChange('', val.slice(3)); }
    };

    const filtered = flatWOs;

    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('work-orders', listBodyRef, filtered.length > 0);

    const sortCols = useMemo(() => ({
        rootmo:   (wo: FlatWO) => wo.root_mo_code ?? null,
        sequence: (wo: FlatWO) => wo.sequence,
        name:     (wo: FlatWO) => wo.name,
        product:  (wo: FlatWO) => (wo as any).item_name,
        wc:       (wo: FlatWO) => wo.work_center_name,
        tstart:   (wo: FlatWO) => wo.target_start_date ?? null,
        tend:     (wo: FlatWO) => wo.target_end_date ?? null,
        astart:   (wo: FlatWO) => wo.actual_start_date ?? null,
        aend:     (wo: FlatWO) => wo.actual_end_date ?? null,
        created:  (wo: FlatWO) => wo.created_at ?? null,
        status:   (wo: FlatWO) => wo.status,
    }), []);
    const { sorted: sortedWOs, sort, toggle: toggleSort } = useSortable(filtered, sortCols, { key: 'created', dir: -1 });

    useEffect(() => {
        if (!highlightWOId || flatWOs.length === 0) return;
        setExpandedWOId(highlightWOId);
        setTimeout(() => {
            if (highlightedRowRef.current) {
                highlightedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }, [highlightWOId, flatWOs]);

    const startEdit = (wo: FlatWO) => {
        setEditId(wo.id);
        setForm({
            sequence: String(wo.sequence),
            name: wo.name,
            work_center_id: wo.work_center_id || '',
            planned_duration_hours: wo.planned_duration_hours != null ? String(wo.planned_duration_hours) : '',
        });
    };

    const handleSave = async (wo: FlatWO) => {
        setIsSaving(true);
        try {
            await onUpdate(wo.id, {
                manufacturing_order_id: wo.mo_id,
                sequence: parseInt(form.sequence) || wo.sequence,
                name: wo.name,
                work_center_id: form.work_center_id || undefined,
                planned_duration_hours: form.planned_duration_hours ? parseFloat(form.planned_duration_hours) : undefined,
            });
            setEditId(null);
        } finally {
            setIsSaving(false);
        }
    };

    const canComplete = (wo: FlatWO) => !wo.qty || (wo.qty_completed_total ?? 0) >= wo.qty;
    // Manual complete allowed below target — warn, then proceed.
    const handleComplete = (wo: FlatWO) => {
        if (!canComplete(wo)) {
            showToast(`Note: ${(wo.qty_completed_total ?? 0).toFixed(2)} of ${wo.qty} logged — marking complete anyway.`, 'warning');
        }
        onUpdateStatus(wo.id, 'COMPLETED');
    };
    const canStage = (wo: FlatWO) =>
        canManage && woHasStaging(wo) &&
        wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED';
    // Scan-to-stage is for the steps whose input arrives as printed, individually
    // numbered units the operator scans in rather than picking by hand: greige bags
    // into dyeing, dyed lots into setting, warp beams (and weft lots) into weaving.
    // The modal branches per material — a bag stages in kg, a beam mounts on the
    // machine in whole pieces. See SCAN_STAGE_WC_TYPES.
    const canScanStage = (wo: FlatWO) => canStage(wo) && woScanStages(wo);

    const openLog = async (wo: FlatWO) => {
        const mo = await onFetchMO(wo.mo_id);
        setCompletionMO(mo ?? null);
        setCompletionWO(wo);
    };

    // Print bag labels straight from the expanded row — no need to reopen the log
    // modal. Fetches the full MO (flat payload has no lots/bom/attrs), filters to
    // this WO's non-rejected lotted completions (= bags) in log order. `onlyId`
    // prints a single bag with its real sequence number; otherwise all bags.
    const openBagLabels = async (wo: FlatWO, onlyId?: string) => {
        setLabelLoadingWO(wo.id);
        try {
            const mo = await onFetchMO(wo.mo_id);
            if (!mo) { showToast('Could not load MO for labels', 'danger'); return; }
            const bags = (mo.completions || [])
                .filter((c: any) => String(c.work_order_id || '') === String(wo.id) && !c.rejected && c.output_batch_number)
                .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            if (onlyId) {
                const idx = bags.findIndex((c: any) => String(c.id) === String(onlyId));
                if (idx < 0) { showToast('No lot recorded for this entry yet', 'warning'); return; }
                setLabelSeqStart(idx + 1);
                setLabelBags([bags[idx]]);
            } else {
                if (!bags.length) { showToast('No lotted output logged on this WO yet', 'info'); return; }
                setLabelSeqStart(1);
                setLabelBags(bags);
            }
            setLabelMO(mo);
            setLabelWO(wo);
        } finally {
            setLabelLoadingWO(null);
        }
    };

    const xpInput: React.CSSProperties = xpInputBase({ padding: '0 4px' });

    // Selection holds the WO rows themselves — the bulk print modal needs the
    // objects, and a WO ticked before paging can no longer be found in `filtered`.
    const sel = useRowSelection<FlatWO>(filtered, wo => wo.id);

    const COLS = 16; // checkbox + chevron + 13 data cols + actions

    const renderDetailPanel = (wo: FlatWO) => {
        const bomItemIds = new Set<string>(wo.bom_line_item_ids || []);
        const completions: any[] = wo.completions || [];
        // Bag labels apply to lot-producing steps (each weighed bag = one lot).
        const isLotWOType = ['WEAVING', 'TENUN', 'DYEING', 'CELUP', 'BEAMING', 'SETTING'].includes((wo.work_center_type || '').toUpperCase());
        // A beaming WO's output units are warp beams, not bags — same label modal,
        // different card (BeamLabelCard), so the button has to say so or the floor
        // reads it as the wrong sticker.
        const isBeamWOType = (wo.work_center_type || '').toUpperCase() === 'BEAMING';

        const components: any[] = woComponents[wo.id] || [];
        const componentsLoading = !!woComponentsLoading[wo.id];

        const panelStyle: React.CSSProperties = {
            display: 'grid', gridTemplateColumns: '110px 260px 220px minmax(200px, 1fr)',
            border: '1px solid #7f9db9',
            fontFamily: xpFont, fontSize: 10,
        };
        const colHeaderStyle: React.CSSProperties = {
            fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', color: '#555',
            letterSpacing: 0.5, borderBottom: '1px solid #c0bdb5', paddingBottom: 2, marginBottom: 4, width: '100%',
        };
        const infoRow = (label: string, val: string) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1, fontSize: 9 }}>
                <span style={{ color: '#888' }}>{label}</span>
                <span style={{ fontWeight: 'bold', color: '#222', textAlign: 'right', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
            </div>
        );

        return (
            <tr key={`${wo.id}-detail`}>
                <td colSpan={COLS} style={{ padding: 0 }}>
                    <ExpandedRowPanel>
                    <div style={panelStyle}>
                        {/* QR Code */}
                        <div style={{ borderRight: '1px solid #c0bdb5', padding: '6px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: '#f5f4ef' }}>
                            <div style={{ ...colHeaderStyle, alignSelf: 'flex-start' }}>QR</div>
                            {woQrUrls[wo.id]
                                ? <img src={woQrUrls[wo.id]} alt="QR" style={{ width: 76, height: 76, border: '1px solid #ccc' }} />
                                : <div style={{ width: 76, height: 76, background: '#ddd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#888' }}>...</div>
                            }
                            <div style={{ fontFamily: CODE_FONT, fontSize: 6, color: '#bbb', wordBreak: 'break-all', textAlign: 'center', maxWidth: 96 }}>{wo.id}</div>
                        </div>

                        {/* Timeline & Info — compact two-column key/value */}
                        <div style={{ borderRight: '1px solid #c0bdb5', padding: '6px 8px', background: '#f5f4ef' }}>
                            <div style={colHeaderStyle}>Info</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, fontSize: 9 }}>
                                <span style={{ color: '#888' }}>MO</span>
                                <CodeChip
                                    code={wo.mo_code}
                                    link
                                    onClick={() => router.push(`/manufacturing-orders?mo=${encodeURIComponent(wo.mo_code)}`)}
                                    title={`Go to ${wo.mo_code}`}
                                    style={{ fontSize: 9 }}
                                />
                            </div>
                            {infoRow('Product', wo.item_name || '—')}
                            {wo.color_label && infoRow('Variant', wo.color_label)}
                            {(wo.color_code || wo.labdip_variant_code) && infoRow(
                                'Color',
                                wo.color_code
                                    ? colorLabel(wo.color_code, wo.color_name)
                                    : `${wo.labdip_variant_code} (lab dip pending)`
                            )}
                            {infoRow('Work Center', wo.work_center_name || '—')}
                            {(wo.input_location || wo.output_location) && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2, marginTop: 1 }}>
                                    <span style={{ color: '#888', fontSize: 9, minWidth: 60 }}>Location</span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9 }}>
                                        <span style={{ background: '#e8f0fe', color: '#1a56c4', border: '1px solid #b0c8f8', padding: '0 4px' }}>
                                            {wo.input_location?.code || '?'}
                                        </span>
                                        <span style={{ color: '#888' }}>&#8594;</span>
                                        <span style={{ background: '#e6f4ea', color: '#1a6e2e', border: '1px solid #a8d8b0', padding: '0 4px' }}>
                                            {wo.output_location?.code || '?'}
                                        </span>
                                    </span>
                                </div>
                            )}
                            {infoRow('Created', fmtDateTime(wo.created_at))}
                            <div style={{ borderTop: '1px solid #e0ddd8', margin: '3px 0' }} />
                            {infoRow('Target Start', fmtDate(wo.target_start_date))}
                            {infoRow('Target End',   fmtDate(wo.target_end_date))}
                            {infoRow('Actual Start', fmtDateTime(wo.actual_start_date))}
                            {infoRow('Actual End',   fmtDateTime(wo.actual_end_date))}
                            <div style={{ borderTop: '1px solid #e0ddd8', margin: '3px 0' }} />
                            {infoRow('Planned hrs', wo.planned_duration_hours != null ? `${wo.planned_duration_hours}h` : '—')}
                            {infoRow('Actual hrs',  wo.actual_duration_hours != null  ? `${wo.actual_duration_hours}h`  : '—')}
                            {wo.notes && (
                                <div style={{ marginTop: 4, padding: '2px 5px', background: '#fffbe6', border: '1px solid #e0d080', fontSize: 9, fontStyle: 'italic', color: '#666' }}>
                                    {wo.notes}
                                </div>
                            )}
                        </div>

                        {/* Components — materials required for this WO's step */}
                        <div style={{ borderRight: '1px solid #c0bdb5', padding: '6px 8px', background: '#f5f4ef', overflow: 'hidden' }}>
                            <div style={colHeaderStyle}>Components ({components.length})</div>
                            {componentsLoading ? (
                                <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: 9 }}>Loading...</div>
                            ) : components.length === 0 ? (
                                <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: 9 }}>No components.</div>
                            ) : (
                                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                                    {components.map((c: any) => (
                                        <div key={c.item_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 2, paddingBottom: 2, borderBottom: '1px solid #e8e6e0' }}>
                                            <span style={{ color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }} title={c.item_name || c.item_code}>
                                                {c.item_code || c.item_name || c.item_id}
                                            </span>
                                            <span style={{ color: '#000080', fontWeight: 'bold' }}>{parseFloat(c.required_qty).toFixed(2)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Completion Log — compact table rows */}
                        <div style={{ padding: '6px 8px', background: '#f5f4ef', overflow: 'hidden' }}>
                            <div style={{ ...colHeaderStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                                <span>Completion Log ({completions.length})</span>
                                {isLotWOType && completions.some((c: any) => !c.rejected) && (
                                    <button
                                        type="button"
                                        onClick={() => openBagLabels(wo)}
                                        disabled={labelLoadingWO === wo.id}
                                        style={{ fontFamily: xpFont, fontSize: 8, padding: '0 6px', cursor: 'pointer', background: 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid #808080', color: '#000040', textTransform: 'none', letterSpacing: 0 }}
                                        title={isBeamWOType
                                            ? 'Print a sticker label for each beam produced on this WO'
                                            : 'Print a sticker label for each weighed bag on this WO'}
                                    >
                                        {labelLoadingWO === wo.id ? 'Loading…' : isBeamWOType ? 'Beam Labels' : 'Bag Labels'}
                                    </button>
                                )}
                            </div>
                            {completions.length === 0 ? (
                                <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: 9 }}>No entries yet.</div>
                            ) : (
                                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                                    <table style={{ ...lvSubTable(), border: 'none' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ ...subTh, width: 110 }}>Date / Time</th>
                                                <th style={{ ...subTh, textAlign: 'right', width: 44 }}>Qty</th>
                                                <th style={subTh}>Operator</th>
                                                <th style={subTh}>Machine</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {completions.map((c: any, ci: number) => {
                                                const substitutes = (c.actual_items || []).filter((ai: any) => !bomItemIds.has(ai.item_id));
                                                const bomItems    = (c.actual_items || []).filter((ai: any) =>  bomItemIds.has(ai.item_id));
                                                const hasMeta = substitutes.length > 0 || bomItems.length > 0 || c.notes;
                                                return (
                                                    <React.Fragment key={c.id || ci}>
                                                        {/* No zebra — the rejected-red fill is the only
                                                            meaningful row colour here. */}
                                                        <tr style={lvSubRow(ci, { fill: c.rejected ? '#fbe4e4' : undefined })}>
                                                            <td style={{ ...subTd, color: '#666', whiteSpace: 'nowrap' }}>{fmtDateTime(c.created_at)}</td>
                                                            <td
                                                                style={{ ...subTd, fontWeight: 'bold', color: c.rejected ? '#900' : '#000080', textAlign: 'right', textDecoration: c.rejected ? 'line-through' : 'none' }}
                                                                title={c.rejected ? rejectTitle(c, 'Rejected') : undefined}
                                                            >
                                                                +{parseFloat(c.qty_completed).toFixed(2)}
                                                            </td>
                                                            <td style={{ ...subTd, color: '#333' }}>
                                                                {c.operator_name || '—'}
                                                                {c.rejected && <span style={{ borderRadius: CHIP_RADIUS, marginLeft: 5, fontSize: 8, fontWeight: 'bold', color: '#900', border: '1px solid #c88', background: '#fff', padding: '0 3px' }}>REJECTED</span>}
                                                                {/* Partial reject: the log stays active with its qty already trimmed,
                                                                    so the scrapped amount only shows as its own marker. */}
                                                                {!c.rejected && (c.qty_rejected ?? 0) > 0 && (
                                                                    <span
                                                                        title={rejectTitle(c, 'Partially rejected')}
                                                                        style={{ borderRadius: CHIP_RADIUS, marginLeft: 5, fontSize: 8, fontWeight: 'bold', color: '#900', border: '1px solid #c88', background: '#fff', padding: '0 3px' }}
                                                                    >
                                                                        -{Number(c.qty_rejected).toFixed(2)} REJ
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td style={{ ...subTd, color: '#555' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                                                                    <span>{c.work_center_name || '—'}</span>
                                                                    {isLotWOType && !c.rejected && c.output_batch_number && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => openBagLabels(wo, c.id)}
                                                                            disabled={labelLoadingWO === wo.id}
                                                                            style={{ fontFamily: xpFont, fontSize: 8, padding: '0 4px', cursor: 'pointer', background: 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid #808080', color: '#000040' }}
                                                                            title={isBeamWOType ? "Print this beam's label" : "Print this bag's label"}
                                                                        >
                                                                            Label
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                        {hasMeta && (
                                                            <tr>
                                                                <td colSpan={4} style={{ ...subTd, borderTop: 'none', padding: '0 5px 3px 12px' }}>
                                                                    {bomItems.length > 0 && (
                                                                        <span style={{ color: '#555', marginRight: 8 }}>
                                                                            {bomItems.map((ai: any) => (
                                                                                <span key={ai.item_id} style={{ marginRight: 6 }}>
                                                                                    {ai.item_code || ai.item_id} &times;{parseFloat(ai.qty_used).toFixed(2)}
                                                                                </span>
                                                                            ))}
                                                                        </span>
                                                                    )}
                                                                    {substitutes.map((ai: any) => (
                                                                        <span key={ai.item_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 6 }}>
                                                                            <span style={{ borderRadius: CHIP_RADIUS, background: '#fff3cd', border: '1px solid #b8860b', color: '#7a5000', padding: '0 3px', fontWeight: 'bold', fontSize: 8 }}>SUB</span>
                                                                            <span style={{ color: '#555' }}>{ai.item_code || ai.item_id} &times;{parseFloat(ai.qty_used).toFixed(2)}</span>
                                                                        </span>
                                                                    ))}
                                                                    {c.notes && <span style={{ color: '#888', fontStyle: 'italic', marginLeft: 4 }}>{c.notes}</span>}
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
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

    const containerStyle: React.CSSProperties = viewShellStyle('page', { fontFamily: xpFont });

    const titleBarStyle: React.CSSProperties = xpTitleBar({
        justifyContent: 'flex-start', gap: 8,
    });

    const filterBarStyle: React.CSSProperties = {
        background: '#d4d0c8', borderBottom: '1px solid #808080',
        padding: '4px 8px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
    };

    // Full cell borders rather than lvTh/lvTd's single rule: 15 columns of dates
    // and quantities, where the verticals are what keep a row readable.
    const thStyle: React.CSSProperties = lvThSticky({ border: '1px solid #808080' });
    const colw = useColumnWidths('work-orders', WO_COL_W);

    const tdBase: React.CSSProperties = { ...lvTd(), border: '1px solid #c0bdb5' };

    return (
        <>
        <div className="row g-4 fade-in">
            <div className="col-12">
                <div style={containerStyle}>

                    {/* Title bar */}
                    <div style={titleBarStyle}>
                        <i className="bi bi-list-task" style={{ color: '#fff', fontSize: 14 }}></i>
                        <span style={{ fontWeight: 'bold', fontSize: 12, color: '#fff', textShadow: '1px 1px 1px rgba(0,0,0,0.4)'}}>
                            Work Orders
                        </span>
                        <span style={{ fontSize: 10, color: '#cce0ff', marginLeft: 4 }}>
                            {filtered.length} of {flatWOs.length} steps
                        </span>
                        {sel.count > 0 && (
                            <button
                                onClick={() => setBulkPrintOpen(true)}
                                style={{ fontFamily: xpFont, fontSize: 10, padding: '1px 8px', background: 'linear-gradient(to bottom,#b0e8b0,#70c870)', border: '1px solid #0a3e0a', cursor: 'pointer', color: '#004000', marginLeft: 8 }}
                            >
                                {''}
                                Print Selected ({sel.count})
                            </button>
                        )}
                    </div>

                    {/* Tabs */}
                    <Tabs<WOTabKey> tabs={WO_TABS} activeKey={activeTab as WOTabKey} onChange={onTabChange} />

                    {/* Filter bar */}
                    <div style={filterBarStyle}>
                        <label style={{ fontSize: 10, color: '#000', whiteSpace: 'nowrap' }}>Filter:</label>
                        <SearchField value={woSearch} onChange={onSearch} placeholder="Search WO / MO..." width={160} />
                        <select value={filterStatus} onChange={e => onFilterStatus(e.target.value)}
                            style={{ ...xpInput, width: 110 }}>
                            <option value="">All Statuses</option>
                            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                        </select>
                        <TreeSelect
                            options={wcFilterTreeOptions}
                            value={wcFilterValue}
                            onChange={onWCFilterChange}
                            allowEmpty
                            emptyLabel="All Work Centers"
                            style={{ width: 160 }}
                        />
                        <div style={{ width: 260}}>
                            <SearchableSelect
                                options={componentOptions}
                                value={filterComponentId}
                                onChange={onFilterComponent}
                                placeholder="All Components"
                                size={'sm'}
                            />
                        </div>
                        <label
                            title="Show only work orders whose Kartu Kerja card or bag labels are not yet printed"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#000', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={filterUnprinted}
                                onChange={e => onFilterUnprinted(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <i className="bi bi-printer" style={{ fontSize: 11 }} />
                            Un-printed only
                        </label>
                        {(filterStatus || filterGroup || filterWC || woSearch || filterComponentId || filterUnprinted) && (
                            <button onClick={onClearFilters}
                                style={{ ...xpInput, width: 'auto', cursor: 'pointer', height: 20 }}>
                                Clear
                            </button>
                        )}
                        {loading && (
                            <span style={{ fontSize: 10, color: '#666', marginLeft: 4 }}>Loading...</span>
                        )}
                    </div>

                    {/* Table */}
                    <div className="table-responsive" style={{ flex: 1, overflow: 'auto', minHeight: 0, ...({ background: '#fff' }) }}>
                        <table
                            style={{ width: '100%', minWidth: 1830, borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 11, fontFamily: xpFont, background: '#fff', ...colw.tableStyle }}
                        >
                            <colgroup>{colw.cols()}</colgroup>
                            <thead>
                                <tr>
                                    <th style={{ ...thStyle, width: 28, padding: '3px 6px' }}>
                                        <SelectAllCheckbox allSelected={sel.allPageSelected} someSelected={sel.someSelected} onChange={sel.togglePage} title="Select all filtered" />
                                    </th>
                                    <th style={{ ...thStyle, width: 22, padding: '3px 4px' }} />
                                    {([['Root MO', 'rootmo'], ['#', 'sequence'], ['Name', 'name'], ['Product', 'product'], ['Variant', ''], ['Work Center', 'wc'], ['Target / Done', ''], ['Target Start', 'tstart'], ['Target End', 'tend'], ['Actual Start', 'astart'], ['Actual End', 'aend'], ['Created', 'created'], ['Status', 'status'], ['', '']] as [string, string][]).map(([h, key], i) => (
                                        <SortableTh key={`${h}-${i}`}
                                            sort={sort} colKey={key || null} onSort={toggleSort}
                                            style={{ ...thStyle, textAlign: h === '' ? 'right' : 'left' }}>
                                            {h}{colw.grip(i + 2)}
                                        </SortableTh>
                                    ))}
                                </tr>
                            </thead>
                            <tbody ref={listBodyRef}>
                                {filtered.length === 0 && (loading ? (
                                    <TableSkeleton rows={8} cols={skel.cols ?? COLS} tdStyle={tdBase} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                                ) : (
                                    <tr>
                                        <td colSpan={COLS} style={{ padding: 0 }}>
                                            {<XPEmptyState message="No work orders found." icon="bi-tools" />}
                                        </td>
                                    </tr>
                                ))}
                                {sortedWOs.map((wo, idx) => {
                                    const rowBg = lvZebra(idx);
                                    const isEditing = editId === wo.id;
                                    const isExpanded = expandedWOId === wo.id;

                                    if (isEditing) {
                                        return (
                                            <tr key={wo.id} style={{ background: '#fffbe6'}}>
                                                <td style={{ ...tdBase, padding: '3px 6px' }} />
                                                <td style={tdBase} />
                                                <td style={tdBase} />
                                                <td style={tdBase}>
                                                    <input style={{ ...xpInput, width: 32 }} value={form.sequence}
                                                        onChange={e => setForm(f => ({ ...f, sequence: e.target.value }))} />
                                                </td>
                                                <td style={tdBase}>
                                                    <span style={{ fontFamily: CODE_FONT, fontSize: 10, color: '#666' }}>
                                                        {(wo as any).code || wo.name}
                                                    </span>
                                                </td>
                                                <td style={tdBase}>
                                                    <span style={{ fontSize: 10, color: '#666' }}>{wo.item_name || '—'}</span>
                                                </td>
                                                <td style={tdBase} />
                                                <td style={tdBase}>
                                                    <select style={{ ...xpInput, width: '100%' }} value={form.work_center_id}
                                                        onChange={e => setForm(f => ({ ...f, work_center_id: e.target.value }))}>
                                                        <option value="">—</option>
                                                        {workCenters.map((wc: any) => <option key={wc.id} value={wc.id}>{wc.name}</option>)}
                                                    </select>
                                                </td>
                                                <td style={tdBase}>
                                                    <input type="number" min="0" step="0.5" style={{ ...xpInput, width: 56 }}
                                                        value={form.planned_duration_hours}
                                                        onChange={e => setForm(f => ({ ...f, planned_duration_hours: e.target.value }))} />
                                                </td>
                                                <td style={tdBase} colSpan={5} />
                                                <td style={tdBase} />
                                                <td style={{ ...tdBase, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                    <button onClick={() => handleSave(wo)} disabled={isSaving}
                                                        style={{ fontFamily: xpFont, fontSize: 10, padding: '1px 8px', background: 'linear-gradient(to bottom,#b0e8b0,#70c870)', border: '1px solid #0a3e0a', cursor: 'pointer', marginRight: 4 }}>
                                                        {isSaving ? '...' : 'Save'}
                                                    </button>
                                                    <button onClick={() => setEditId(null)}
                                                        style={{ fontFamily: xpFont, fontSize: 10, padding: '1px 6px', background: 'linear-gradient(to bottom,#f0efe6,#dddbd0)', border: '1px solid #808080', cursor: 'pointer' }}>
                                                        Cancel
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    }

                                    const isHighlighted = highlightWOId === wo.id;
                                    return (
                                        <React.Fragment key={wo.id}>
                                            <tr
                                                ref={isHighlighted ? highlightedRowRef : null}
                                                style={{
                                                    background: isExpanded ? rowStateBg('expanded') : rowBg,
                                                    cursor: 'pointer',
                                                    outline: isHighlighted ? '2px solid #0058e6' : undefined,
                                                    outlineOffset: isHighlighted ? '-2px' : undefined,
                                                }}
                                                onClick={() => setExpandedWOId(prev => prev === wo.id ? null : wo.id)}
                                            >
                                                <td style={{ ...tdBase, padding: '3px 6px', width: 24 }} onClick={e => e.stopPropagation()}>
                                                    <RowCheckbox checked={sel.isSelected(wo)} onChange={() => sel.toggle(wo)} label={`work order ${wo.name || wo.id}`} />
                                                </td>
                                                <ExpanderCell expanded={isExpanded} onToggle={() => setExpandedWOId(prev => prev === wo.id ? null : wo.id)} tdStyle={tdBase} tdClassName={''} label="work order detail" />
                                                {/* Root MO — top of the parent/pegging chain, not this WO's own MO.
                                                    A shared component MO feeds several roots; the first is shown and
                                                    the rest sit behind a +N marker. */}
                                                <td style={{ ...tdBase, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
                                                    {wo.root_mo_code ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden' }}>
                                                            <CodeChip
                                                                code={wo.root_mo_code}
                                                                tier={2}
                                                                link
                                                                onClick={() => router.push(`/manufacturing-orders?mo=${encodeURIComponent(wo.root_mo_code!)}`)}
                                                                title={`Go to root MO ${wo.root_mo_code}`}
                                                                style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                                            />
                                                            {(wo.root_mo_count ?? 0) > 1 && (
                                                                <span
                                                                    title={`Shared component — feeds ${wo.root_mo_count} root MOs: ${(wo.root_mo_codes || []).join(', ')}`}
                                                                    style={{ borderRadius: CHIP_RADIUS, fontSize: 9, fontWeight: 'bold', color: '#7a5000', background: '#fff3cd', border: '1px solid #b8860b', padding: '0 3px', flexShrink: 0 }}
                                                                >+{(wo.root_mo_count ?? 1) - 1}</span>
                                                            )}
                                                        </div>
                                                    ) : <span style={{ color: '#bbb' }}>—</span>}
                                                </td>
                                                <td style={{ ...tdBase, color: '#888', width: 36 }}>{wo.sequence}</td>
                                                <td style={{ ...tdBase, overflow: 'hidden' }}
                                                    title={(wo as any).code || wo.name}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                                                        <CodeChip
                                                            code={(wo as any).code || wo.name}
                                                            tone="accent"
                                                            style={{ fontWeight: 'bold', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                                                        />
                                                        <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
                                                            <PrintChips wo={wo} />
                                                        </span>
                                                    </div>
                                                </td>
                                                <td style={{ ...tdBase, fontSize: 10, color: '#444', overflow: 'hidden' }}
                                                    title={wo.item_name || ''}>
                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{wo.item_name || '—'}</span>
                                                </td>
                                                {/* Own column, not crammed onto the right edge of Product — a row can
                                                    carry size + colour-variant + colour-code + labdip all at once, and
                                                    squeezing that into a shared cell with the item name is what forced
                                                    the name into a 6-character sliver. Chips are allowed to wrap; the
                                                    table scrolls horizontally (table-responsive) rather than clip them. */}
                                                <td style={{ ...tdBase, fontSize: 10, overflow: 'hidden', whiteSpace: 'normal' }}>
                                                    <VariantChips
                                                        combo={wo.combo_label}
                                                        size={wo.size_label}
                                                        colorVariant={wo.color_label}
                                                        colorCode={wo.color_code}
                                                        colorName={wo.color_name}
                                                        colorHex={wo.color_hex}
                                                        labdipCode={wo.labdip_variant_code}
                                                        style={{ flexWrap: 'wrap', rowGap: 2 }}
                                                    />
                                                </td>
                                                <td style={{ ...tdBase, fontSize: 10, overflow: 'hidden' }}>
                                                    {wo.work_center_name
                                                        ? (() => {
                                                            const cs = getChipStyle(wo.work_center_type);
                                                            return (
                                                                <span style={{
                                                                    padding: '1px 5px',
                                                                    borderRadius: CHIP_RADIUS,
                                                                    border: `1px solid ${cs.borderColor as string}`,
                                                                    background: cs.background as string,
                                                                    color: cs.color as string,
                                                                    whiteSpace: 'nowrap',
                                                                    fontSize: 'inherit',
                                                                }}>
                                                                    {wo.work_center_name}
                                                                </span>
                                                            );
                                                        })()
                                                        : '—'}
                                                </td>
                                                <td style={{ ...tdBase, fontSize: 10}}>
                                                    {wo.qty != null ? (() => {
                                                        const done = (wo.qty_completed_total ?? 0) >= wo.qty;
                                                        const pct = Math.min(100, ((wo.qty_completed_total ?? 0) / wo.qty) * 100);
                                                        // Step-level scrap — which routing step / loom lost the material.
                                                        const rej = wo.qty_rejected_total ?? 0;
                                                        const prod = (wo.qty_completed_total ?? 0) + rej;
                                                        return (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
                                                                <ProgressBar pct={pct} tone={done ? 'green' : 'blue'} hatched width={72} height={8} />
                                                                <span style={{ fontSize: 9, color: done ? '#007000' : '#555', whiteSpace: 'nowrap' }}>
                                                                    {(wo.qty_completed_total ?? 0).toFixed(1)}/{wo.qty}
                                                                </span>
                                                                {rej > 0 && (
                                                                    <span
                                                                        title={`${rej.toFixed(2)} rejected on this step of ${prod.toFixed(2)} produced — yield ${((wo.qty_completed_total ?? 0) / prod * 100).toFixed(1)}%`}
                                                                        style={{ fontSize: 9, fontWeight: 700, color: '#a01010', whiteSpace: 'nowrap' }}
                                                                    >
                                                                        rej {rej.toFixed(1)} · {((wo.qty_completed_total ?? 0) / prod * 100).toFixed(0)}%
                                                                    </span>
                                                                )}
                                                            </div>
                                                        );
                                                    })() : <span style={{ color: '#bbb' }}>—</span>}
                                                </td>
                                                <td style={{ ...tdBase, fontSize: 10}}>{fmtDate(wo.target_start_date)}</td>
                                                <td style={{ ...tdBase, fontSize: 10}}>{fmtDate(wo.target_end_date)}</td>
                                                <td style={{ ...tdBase, fontSize: 10}}>{fmtDateTime(wo.actual_start_date)}</td>
                                                <td style={{ ...tdBase, fontSize: 10}}>{fmtDateTime(wo.actual_end_date)}</td>
                                                <td style={{ ...tdBase, fontSize: 10}}>{fmtDateTime(wo.created_at)}</td>
                                                <td style={tdBase} onClick={e => e.stopPropagation()}>
                                                    {(() => {
                                                        const hasStaging = woHasStaging(wo);
                                                        const stagingLabel = wo.staging_status === 'STAGED' ? 'Staged — materials issued'
                                                            : wo.staging_status === 'PARTIAL' ? 'Partially staged' : 'Not staged';
                                                        const stagingColor = wo.staging_status === 'STAGED' ? '#0058e6' : wo.staging_status === 'PARTIAL' ? '#b8860b' : '#999';
                                                        return (
                                                            <div
                                                                className="xp-menu-trigger"
                                                                onClick={e => toggleStatusMenu(wo.id, e)}
                                                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5, cursor: 'pointer' }}
                                                            >
                                                                <StatusChip status={wo.status || 'PENDING'} />
                                                                {hasStaging && (
                                                                    <i className={`bi ${wo.staging_status === 'STAGED' ? 'bi-box-seam-fill' : 'bi-box-seam'}`}
                                                                        title={stagingLabel}
                                                                        style={{ fontSize: 12, color: stagingColor, flexShrink: 0 }} />
                                                                )}
                                                            </div>
                                                        );
                                                    })()}
                                                </td>
                                                <td style={{ ...tdBase, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                                                    {/* Fixed action slots — every row reserves the same slot per action so
                                                        icons line up in columns even when a row can't do that action. */}
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2}}>
                                                        {<>
                                                                <ActionSlot width={22} show={canStage(wo)}>
                                                                    <XPActionButton tone="primary" icon="bi-box-seam" title="Stage — issue this step's materials to the line" onClick={() => (canScanStage(wo) ? setScanStageWO(wo) : setStageWO(wo))} />
                                                                </ActionSlot>
                                                                <ActionSlot width={22} show={canManage && (wo.status === 'PENDING' || wo.status === 'IN_PROGRESS')}>
                                                                    <XPActionButton tone="success" icon="bi-plus-lg" title="Log production output" onClick={() => openLog(wo)} />
                                                                </ActionSlot>
                                                                <MenuTriggerButton onClick={(e) => toggleMenu(wo.id, e)} />
                                                            </>}
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && renderDetailPanel(wo)}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Floating "more actions" menu — Print / Edit / Delete */}
                    {openMenuId && (() => {
                        const menuWO = sortedWOs.find((w: any) => w.id === openMenuId);
                        if (!menuWO) return null;
                        return (
                            <FloatingMenu
                                pos={menuPos}
                                items={[
                                    {
                                        key: 'edit', icon: 'bi-pencil', label: 'Edit',
                                        hidden: !canManage,
                                        onClick: () => { closeMenu(); startEdit(menuWO); },
                                    },
                                    {
                                        key: 'delete', icon: 'bi-trash', label: 'Delete', danger: true,
                                        hidden: !canManage,
                                        onClick: () => { closeMenu(); onDelete(menuWO.id); },
                                    },
                                ]}
                            />
                        );
                    })()}

                    {/* Floating status menu — WO lifecycle statuses + staging state/action together */}
                    {openStatusMenuId && (() => {
                        const menuWO = sortedWOs.find((w: any) => w.id === openStatusMenuId);
                        if (!menuWO) return null;
                        const hasStaging = woHasStaging(menuWO);
                        const stagingLabel = menuWO.staging_status === 'STAGED' ? 'Staged — materials issued'
                            : menuWO.staging_status === 'PARTIAL' ? 'Partially staged' : 'Not staged';
                        return (
                            <FloatingMenu
                                pos={statusMenuPos}
                                items={[
                                    ...STATUSES.map(s => ({
                                        key: `status-${s}`,
                                        icon: s === menuWO.status ? 'bi-check2' : undefined,
                                        label: s.replace('_', ' '),
                                        hidden: !canManage,
                                        onClick: () => {
                                            closeStatusMenu();
                                            if (s === 'COMPLETED') { handleComplete(menuWO); return; }
                                            onUpdateStatus(menuWO.id, s);
                                        },
                                    })),
                                    {
                                        key: 'staging-info', icon: 'bi-box-seam',
                                        label: `Staging: ${stagingLabel}`,
                                        hidden: !hasStaging,
                                        title: canStage(menuWO) ? 'Click to stage materials for this step' : undefined,
                                        onClick: () => {
                                            closeStatusMenu();
                                            if (canScanStage(menuWO)) setScanStageWO(menuWO);
                                            else if (canStage(menuWO)) setStageWO(menuWO);
                                        },
                                    },
                                ]}
                            />
                        );
                    })()}

                    <Pager page={page} total={total} pageSize={pageSize} onPageChange={onPageChange} hideWhenEmpty />
                    {sel.count > 0 && (
                        <XPStatusBar right={null}>
                            {`${sel.count} selected`}
                        </XPStatusBar>
                    )}
                </div>
            </div>
        </div>

        {completionMO && (
            <WOCompletionModal
                mo={completionMO}
                workOrder={completionWO ?? undefined}
                onClose={() => { setCompletionMO(null); setCompletionWO(null); }}
                onSaved={() => { setCompletionMO(null); setCompletionWO(null); onRefresh(); }}
            />
        )}
        {stageWO && (
            <WOStagingModal
                wo={stageWO}
                onClose={() => setStageWO(null)}
                onStaged={() => { setStageWO(null); onRefresh(); }}
                onScanMode={canScanStage(stageWO) ? () => { const w = stageWO; setStageWO(null); setScanStageWO(w); } : undefined}
            />
        )}
        {scanStageWO && (
            <BagScanStageModal
                wo={scanStageWO}
                onClose={() => setScanStageWO(null)}
                onStaged={() => { setScanStageWO(null); onRefresh(); }}
                onManualMode={() => { const w = scanStageWO; setScanStageWO(null); setStageWO(w); }}
            />
        )}
        {labelBags && labelMO && (
            <BagLabelPrintModal
                bags={labelBags}
                workOrder={labelWO}
                parentMO={labelMO}
                seqStart={labelSeqStart}
                onClose={() => { setLabelBags(null); setLabelMO(null); setLabelWO(null); }}
            />
        )}
        {bulkPrintOpen && (
            <WOBulkPrintModal
                selectedWOs={sel.items}
                manufacturingOrders={sel.items
                    .map(wo => ({
                        id: wo.mo_id,
                        code: wo.mo_code,
                        item_name: wo.item_name,
                        completions: (wo as any).completions || [],
                        bom: null,
                    }))
                }
                onClose={() => setBulkPrintOpen(false)}
            />
        )}
        </>
    );
}
