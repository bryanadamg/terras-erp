import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import CalendarView from '../shared/CalendarView';
import ManufacturingSearchBar from './ManufacturingSearchBar';
import { ToolbarButton, FilterChipBar, TITLE_TONES } from '../shared/shellTheme';
import Pager from '../shared/Pager';
import { Tabs } from '../shared/Tabs';
import ModalWrapper from '../shared/ModalWrapper';
import { useToast } from '../shared/Toast';
import { useData } from '../../context/DataContext';
import type { PrintSettings } from './MOPrintModal';
import { STATUS_COLORS, useFloatingMenu, MenuTriggerButton, FloatingMenu, ExpandedRowPanel, ExpandedRowPanelBody, ProgressBar, CodeChip, CODE_FONT, xpFont, TableSkeleton, useTableSkeletonMetrics, rowStateBg, StatusChip, CHIP_RADIUS, VariantChip, colorHexFor, colorLabel, colorTitle, BUTTON_RADIUS, XP_BTN, Chip, XPActionButton, ModalFooterActions, LocationChip } from '../shared/xpTheme';
import { lvSubTh, lvSubTd, lvSubTable, lvSubRow, ExpanderCell, LV_EXPANDER_COL_W, lvZebra, lvThead, lvTh, TableEmpty, Dash } from '../shared/listViewTheme';
const MOPrintModal = dynamic(() => import('./MOPrintModal'), { ssr: false });
import WorkOrderPanel, { PrintChip } from './WorkOrderPanel';
import { resolveMoBom } from '../shared/moHelpers';
import { useTimezone } from '../../context/TimezoneContext';
const WOCompletionModal = dynamic(() => import('./WOCompletionModal'), { ssr: false });

// On the selected (blue) tree row a normal chip fill would fight the highlight, so
// chips there go translucent-on-blue instead of picking a second palette.
const activeChipStyle = (isActive: boolean): React.CSSProperties | undefined =>
    isActive ? { background: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.45)', color: '#eaf2ff' } : undefined;

export default function ManufacturingOrdersTab({
    items,
    boms,
    locations,
    attributes,
    manufacturingOrders,
    productionRuns,
    workCenters,
    onUpdateStatus,
    onDeleteMO,
    onCreateWO,
    onUpdateWO,
    onUpdateWOStatus,
    onDeleteWO,
    currentPage,
    totalItems,
    pageSize,
    onPageChange,
    moCodeFilter,
    setMoCodeFilter,
    viewMode,
    setViewMode,
    currentStyle,
    canManage,
    companyProfile,
    helpers,
    onNewMO,
    onPrint,
}: any) {
    const { showToast } = useToast();
    const { authFetch, fetchData, loading: dataLoading } = useData();
    const { formatCustom: tzFmt } = useTimezone();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;
    const {
        getItemName, getItemCode, getItemUom, getItemEnds, uomBadgeStyle,
        getBOMCode, getLocationName, getWCName, getAttributeValueName, getAttributeValueHex, getBomSizeLabel,
        formatDate, formatDateTime, getDueDateWarning,
        calculateRequiredQty, getStockAcrossLocations, getBeamBatchCount,
    } = helpers;


    // Keep a ref so scanner callbacks always access the latest manufacturingOrders without stale closure issues

    const [printPreviewMO, setPrintPreviewMO] = useState<any>(null);
    const [printHideChildren, setPrintHideChildren] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
    const { openId: openMoMenuId, pos: moMenuPos, toggle: toggleMoMenu, close: closeMoMenu } = useFloatingMenu();
    const [expandedDetailTabs, setExpandedDetailTabs] = useState<Record<string, 'bom' | 'steps'>>({});
    const [selectedTreeNodes, setSelectedTreeNodes] = useState<Record<string, string>>({});
    const [completionMO, setCompletionMO] = useState<any>(null);
    const [completionWO, setCompletionWO] = useState<any>(null);
    const [editAttrsModal, setEditAttrsModal] = useState<{ mo: any; selected: string[] } | null>(null);
    // Set/confirm an approved Color on a root MO ordered against a pending lab dip.
    const [editColorModal, setEditColorModal] = useState<{ mo: any } | null>(null);
    const [colorModalSearch, setColorModalSearch] = useState('');
    const [colorModalResults, setColorModalResults] = useState<any[]>([]);
    const [colorModalLabdips, setColorModalLabdips] = useState<any[]>([]);
    const [putawayModal, setPutawayModal] = useState<{ mo: any; bins: any[]; suggested: string | null; reason: string | null; selected: string; loading: boolean; error: string | null } | null>(null);
    const [toleranceModal, setToleranceModal] = useState<{ mo: any; pct: string; unlimited: boolean } | null>(null);

    const defaultPrintSettings: PrintSettings = {
        showBOMTable: true,
        showTimeline: true,
        showChildMOs: false,
        showSignatureLine: true,
        showTechnicalFields: true,
        showFillFields: true,
        showSamplePhoto: true,
        headerCompanyName: '',
        headerDepartment: '',
        headerApprovedBy: '',
        headerReference: '',
    };
    const [printSettings, setPrintSettings] = useState<PrintSettings>(defaultPrintSettings);

    useEffect(() => {
        const savedPrintSettings = localStorage.getItem('mo_print_settings');
        if (savedPrintSettings) {
            try { setPrintSettings(JSON.parse(savedPrintSettings)); } catch (e) {}
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('mo_print_settings', JSON.stringify(printSettings));
    }, [printSettings]);

    // Auto-expand the matching MO when arriving via a code deep-link
    useEffect(() => {
        if (!moCodeFilter || manufacturingOrders.length === 0) return;
        const match = manufacturingOrders.find((mo: any) =>
            mo.code.toLowerCase().includes(moCodeFilter.toLowerCase())
        );
        if (match) setExpandedRows(prev => ({ ...prev, [match.id]: true }));
    }, [moCodeFilter, manufacturingOrders]);

    const findNodeById = (node: any, id: string): any => {
        if (node.id === id) return node;
        for (const child of (node.child_mos || [])) {
            const found = findNodeById(child, id);
            if (found) return found;
        }
        return null;
    };

    const flattenTree =(node: any, level = 0, moMap: Record<string, any> = {}, isShared = false): Array<{mo: any; level: number; isShared: boolean}> => {
        const result: Array<{mo: any; level: number; isShared: boolean}> = [{mo: node, level, isShared}];
        for (const child of (node.child_mos || [])) {
            result.push(...flattenTree(child, level + 1, moMap, false));
        }
        // Include shared component MOs linked via mo_dependencies
        for (const reqId of (node.required_mo_ids || [])) {
            const reqMO = moMap[reqId];
            if (reqMO) {
                result.push(...flattenTree(reqMO, level + 1, moMap, true));
            }
        }
        return result;
    };

    const handlePrintMO = (mo: any, hideChildren = false) => {
        setPrintHideChildren(hideChildren);
        setPrintPreviewMO(mo);
    };

    const toggleRow = (id: string) => {
        setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
    };

    // From the calendar: jump to the MO's list row, expand it, and scroll it into view.
    const openMOFromCalendar = (id: string) => {
        setViewMode('list');
        setExpandedRows(prev => ({ ...prev, [id]: true }));
        setTimeout(() => {
            document.getElementById(`mo-row-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    };

    const handleUpdateMOAttributes = async (moId: string, attributeValueIds: string[]) => {
        try {
            const res = await authFetch(`${API_BASE}/manufacturing-orders/${moId}/attributes`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ attribute_value_ids: attributeValueIds }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || 'Failed to update attributes', 'error');
                return;
            }
            setEditAttrsModal(null);
            showToast('Attributes updated', 'success');
            fetchData();
        } catch {
            showToast('Failed to update attributes', 'error');
        }
    };

    const handleSetMOColor = async (moId: string, colorId: string | null) => {
        try {
            const res = await authFetch(`${API_BASE}/manufacturing-orders/${moId}/color`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ color_id: colorId }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || 'Failed to set color', 'error');
                return;
            }
            setEditColorModal(null);
            setColorModalSearch('');
            setColorModalResults([]);
            showToast('Color set on order', 'success');
            fetchData();
        } catch {
            showToast('Failed to set color', 'error');
        }
    };

    // Color modal: server-side Color Library search + the item's pending lab dips
    // (shown for reference, so the planner can see approval progress).
    useEffect(() => {
        if (!editColorModal) { setColorModalResults([]); return; }
        const q = colorModalSearch.trim();
        const h = setTimeout(async () => {
            try {
                const res = await authFetch(`${API_BASE}/colors?search=${encodeURIComponent(q)}&size=20`);
                if (res.ok) {
                    const data = await res.json();
                    setColorModalResults(Array.isArray(data) ? data : (data.items || []));
                }
            } catch { /* transient */ }
        }, 300);
        return () => clearTimeout(h);
    }, [colorModalSearch, editColorModal]);

    useEffect(() => {
        if (!editColorModal?.mo?.item_id) { setColorModalLabdips([]); return; }
        let cancelled = false;
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/lab-dips/pending-variants?item_id=${encodeURIComponent(editColorModal.mo.item_id)}`);
                if (res.ok && !cancelled) setColorModalLabdips(await res.json());
            } catch { /* transient */ }
        })();
        return () => { cancelled = true; };
    }, [editColorModal]);

    // Putaway bin: planning decides where the output will be stored before
    // production finishes — the suggestion endpoint proposes, planner saves.
    const openPutawayModal = async (mo: any) => {
        setPutawayModal({ mo, bins: [], suggested: null, reason: null, selected: mo.planned_putaway_location_id || '', loading: true, error: null });
        try {
            const res = await authFetch(`${API_BASE}/manufacturing-orders/${mo.id}/putaway-suggestion`);
            // A failed request used to fall through as an empty bins list, so a 403 or
            // a server error read as "this MO has no bins" — two very different fixes.
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                const msg = err.detail || `Request failed (HTTP ${res.status})`;
                setPutawayModal(prev => prev && prev.mo.id === mo.id ? { ...prev, loading: false, error: msg } : prev);
                return;
            }
            const data = await res.json();
            setPutawayModal(prev => prev && prev.mo.id === mo.id ? {
                ...prev,
                loading: false,
                error: null,
                bins: data?.bins || [],
                suggested: data?.suggested_location_id || null,
                reason: data?.reason || null,
                selected: prev.selected || data?.suggested_location_id || '',
            } : prev);
        } catch {
            setPutawayModal(prev => prev && prev.mo.id === mo.id
                ? { ...prev, loading: false, error: 'Could not reach the server.' }
                : prev);
        }
    };

    const handleSavePutaway = async (moId: string, locationId: string) => {
        try {
            const res = await authFetch(`${API_BASE}/manufacturing-orders/${moId}/putaway`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ location_id: locationId || null }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || 'Failed to set putaway bin', 'error');
                return;
            }
            setPutawayModal(null);
            showToast(locationId ? 'Putaway bin saved' : 'Putaway bin cleared', 'success');
            fetchData();
        } catch {
            showToast('Failed to set putaway bin', 'error');
        }
    };

    const handleSaveTolerance = async () => {
        if (!toleranceModal) return;
        const pct = parseFloat(toleranceModal.pct);
        if (!toleranceModal.unlimited && (isNaN(pct) || pct < 0)) {
            showToast('Enter a tolerance of 0 or more', 'error');
            return;
        }
        try {
            const res = await authFetch(`${API_BASE}/manufacturing-orders/${toleranceModal.mo.id}/tolerance`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    overdelivery_tolerance_pct: toleranceModal.unlimited ? null : pct,
                    allow_unlimited_overdelivery: toleranceModal.unlimited,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || 'Failed to set tolerance', 'error');
                return;
            }
            setToleranceModal(null);
            showToast('Overdelivery tolerance saved', 'success');
            fetchData();
        } catch {
            showToast('Failed to set tolerance', 'error');
        }
    };

    // No client-side date filter. There was one here — a created_at range over
    // `manufacturingOrders` whose startDate/endDate setters were never wired to any
    // control, so it filtered nothing. Rebuilding it client-side would be wrong
    // anyway: this list is one server page, so a range applied here would narrow
    // only the visible rows and hide matches on every other page. A date filter has
    // to go into the /manufacturing-orders query alongside `search`.

    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('manufacturing-orders', listBodyRef, manufacturingOrders.length > 0);

    // NOTE: there is deliberately no inline QR scanner here. `/scanner` is the single
    // scan entry point for every domain (ScanDispatcher routes a code to the screen
    // that owns it) — the toolbar's Scanner button navigates there. An InlineScanWidget
    // lived here unrendered for a long time, holding the html5-qrcode import and a
    // findNodeByCode tree walk alive with it.

    // --- Work Order Expanded Panel (Tree + Detail) ---
    // NOTE: invoked as a plain function call (renderMOExpandedPanel({...})), NOT as <JSX/>.
    // Defined inside the parent body, so as a JSX element it would get a fresh component
    // identity every parent render and React would remount its whole subtree — wiping
    // WorkOrderPanel's local add-WO form state (the "add row flashes and disappears" bug).
    // Calling it as a function inlines the output and keeps child state stable.
    const renderMOExpandedPanel = ({ rootMO, detailTab, setDetailTab }: { rootMO: any; detailTab: 'bom' | 'steps'; setDetailTab: (t: 'bom' | 'steps') => void }) => {
        const selectedNodeId = selectedTreeNodes[rootMO.id] ?? rootMO.id;

        // Build a map of all MOs in the same PR so required component MOs appear in the tree
        const moMap: Record<string, any> = {};
        if (rootMO.production_run_id) {
            const pr = productionRuns.find((p: any) => p.id === rootMO.production_run_id);
            if (pr) {
                for (const mo of (pr.manufacturing_orders || [])) {
                    moMap[mo.id] = mo;
                }
            }
        }

        const treeNodes = flattenTree(rootMO, 0, moMap);

        // findNodeById must also search moMap for shared component MOs
        const findNodeInTree = (id: string): any => {
            const inTree = findNodeById(rootMO, id);
            if (inTree) return inTree;
            return moMap[id] ?? null;
        };

        const selectedNode = findNodeInTree(selectedNodeId) ?? rootMO;
        const bom = boms.find((b: any) => b.id === selectedNode.bom_id);
        // The order's OWN recipe: BOM lines snapshotted when it was cut
        // (MOPlannedComponent). The live BOM is only a fallback for pre-snapshot rows —
        // reading it directly meant a later BOM edit retroactively changed what an
        // in-flight MO appeared to demand, and disagreed with the availability flag the
        // server computed for the same row off the snapshot.
        const snapshot = selectedNode.planned_components || [];
        const componentLines = snapshot.length > 0 ? snapshot : (bom?.lines || []);
        const fromSnapshot = snapshot.length > 0;
        // Fixed body height for both tabs → no jittery resize when switching BOM/WO.
        // Inner sections scroll instead of flexing the panel taller.
        const PANEL_BODY_H = 360;

        // Compute per-parent-MO breakdown for shared component MOs (⇒ nodes)
        const parentMOBreakdown: Array<{ mo: any; qty: number }> = [];
        if (selectedNode.id !== rootMO.id && Object.keys(moMap).length > 0) {
            for (const mo of Object.values(moMap) as any[]) {
                if ((mo.required_mo_ids || []).includes(selectedNode.id)) {
                    const parentBOM = boms.find((b: any) => b.id === mo.bom_id);
                    // Parent's own snapshot first, same reason as componentLines below.
                    const parentLines = (mo.planned_components || []).length > 0
                        ? mo.planned_components
                        : (parentBOM?.lines || []);
                    const parentLine = parentLines.find((l: any) => l.item_id === selectedNode.item_id);
                    if (parentLine) {
                        parentMOBreakdown.push({
                            mo,
                            qty: calculateRequiredQty(mo.qty, parentLine, parentBOM),
                        });
                    }
                }
            }
        }
        const showBreakdown = parentMOBreakdown.length > 0;

        const selectNode = (nodeId: string) => {
            setSelectedTreeNodes(prev => ({ ...prev, [rootMO.id]: nodeId }));
        };

        // No gutter: the tab strip and the two-pane body carry their own edges and run
        // full-bleed to the panel's rules. Left padding still reserves the rail's width
        // so it doesn't paint over the first tab.
        return (
            <ExpandedRowPanel style={{ marginBottom: 6, padding: '0 0 0 4px'}}>
            {/* ── TABS ── */}
            <Tabs
                tabs={[
                    { key: 'bom', label: 'BOM & Stock', icon: 'bi-boxes' },
                    { key: 'steps', label: `Work Order (${(selectedNode.work_orders || []).length})`, icon: 'bi-list-ol' },
                ]}
                activeKey={detailTab}
                onChange={setDetailTab}
            />

            {detailTab === 'bom' && (
            <ExpandedRowPanelBody style={{ display: 'flex', height: PANEL_BODY_H, padding: 0, border: '1px solid #808080'}}>

                {/* ── LEFT: MO Tree ── */}
                <div style={{
                    width: '270px', minWidth: '270px',
                    borderRight: '2px solid #808080',
                    background: '#fff',
                    display: 'flex', flexDirection: 'column'
                }}>
                    <div style={{
                        background: TITLE_TONES.blue.background,
                        color: '#fff', fontWeight: 'bold', fontSize: '11px',
                        padding: '5px 8px', letterSpacing: '0.3px'
                    }}>
                        <i className="bi bi-diagram-3-fill me-2"></i>MO Tree
                    </div>
                    <div style={{ padding: '4px', overflowY: 'auto', flex: 1 }}>
                        {treeNodes.map(({ mo: node, level, isShared }: { mo: any; level: number; isShared: boolean }) => {
                            const isActive = node.id === selectedNodeId;
                            const statusColor = STATUS_COLORS[node.status] || '#6c757d';
                            return (
                                <div
                                    key={node.id}
                                    onClick={() => selectNode(node.id)}
                                    style={{
                                        display: 'flex', alignItems: 'flex-start', gap: '4px',
                                        padding: `3px 6px 3px ${level * 14 + 6}px`,
                                        cursor: 'pointer', borderRadius: '0',
                                        background: isActive ? ('#316ac5') : 'transparent',
                                        color: isActive ? '#fff' : '#000',
                                        border: isActive ? ('1px solid #003080') : (isShared ? '1px dashed #999' : '1px solid transparent'),
                                        marginBottom: '1px',
                                        userSelect: 'none'
                                    }}
                                >
                                    <span style={{ fontSize: '10px', color: isActive ? '#cce0ff' : '#888', minWidth: '10px', marginTop: '1px' }}>
                                        {level === 0 ? '●' : (isShared ? '⇒' : '└')}
                                    </span>
                                    <div style={{ flex: 1, overflow: 'hidden' }}>
                                        {/* Tree label, not a table cell — stays unboxed (a chip per node would
                                            fight the selection fill), but shares CODE_FONT with every other code. */}
                                        <div title={node.code} style={{ fontFamily: CODE_FONT, fontSize: '10px', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {node.code}
                                        </div>
                                        <div title={node.item_name} style={{ fontSize: '10px', color: isActive ? '#e0ecff' : '#444', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {node.item_name}
                                        </div>
                                        {node.item_ends != null && (
                                            <div title="Warp ends (utas) · qty to manufacture" style={{ fontSize: '9px', fontWeight: 700, whiteSpace: 'nowrap', color: isActive ? '#cfe3ff' : '#1a6e2e' }}>
                                                {node.item_ends} ends · {node.qty} {getItemUom(node.item_id)}
                                            </div>
                                        )}
                                        {((node.attribute_value_ids || []).length > 0 || node.bom_size_id) && (
                                            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 2 }}>
                                                {(node.attribute_value_ids || []).map((id: string) => {
                                                    const hex = getAttributeValueHex(id);
                                                    return (
                                                        <VariantChip key={id} kind={hex ? 'color' : 'material'}
                                                            swatch={hex} icon={null} truncate
                                                            style={activeChipStyle(isActive)}
                                                        >{getAttributeValueName(id)}</VariantChip>
                                                    );
                                                })}
                                                {(node.bom_size_id || node.bom_size_snapshot) && (() => {
                                                    const label = getBomSizeLabel(node.bom_id, node.bom_size_id, node.bom_size_snapshot);
                                                    return label ? (
                                                        <VariantChip kind="size" truncate
                                                            style={activeChipStyle(isActive)}
                                                        >{label}</VariantChip>
                                                    ) : null;
                                                })()}
                                            </div>
                                        )}
                                        {(node.qty_rejected_total ?? 0) > 0 && (() => {
                                            // Scrap on the tree row so a bad order is visible without
                                            // opening it; yield is against produced, not target.
                                            const rej = node.qty_rejected_total ?? 0;
                                            const prod = (node.qty_completed_total ?? 0) + rej;
                                            const yp = prod > 0 ? (node.qty_completed_total ?? 0) / prod * 100 : 0;
                                            return (
                                                <div
                                                    title={`${rej.toFixed(2)} rejected of ${prod.toFixed(2)} produced — yield ${yp.toFixed(1)}%`}
                                                    style={{ fontSize: '8px', marginTop: 2, fontWeight: 700, whiteSpace: 'nowrap', color: isActive ? '#ffd0d0' : '#a01010' }}
                                                >
                                                    <i className="bi bi-x-octagon-fill me-1" style={{ fontSize: '7px' }}></i>
                                                    REJ {rej.toFixed(2)} · YIELD {yp.toFixed(1)}%
                                                </div>
                                            );
                                        })()}
                                    </div>
                                    <span style={{ fontSize: '8px', background: statusColor, color: '#fff', padding: '1px 4px', borderRadius: CHIP_RADIUS, whiteSpace: 'nowrap', alignSelf: 'center', flexShrink: 0 }}>
                                        {node.status === 'IN_PROGRESS' ? 'IN PROG' : node.status}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ── CENTRE: BOM Components ── */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Detail header */}
                    <div style={{
                        background: 'linear-gradient(to bottom,#fff,#e8e4d8)',
                        borderBottom: '1px solid #808080',
                        padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap'
                    }}>
                        <CodeChip code={selectedNode.code} style={{ fontSize: 12, fontWeight: 'bold' }} />
                        <span style={{ fontSize: '12px', color: '#000' }}>{selectedNode.item_name}</span>
                        {(selectedNode.attribute_value_ids || []).map((id: string) => {
                            const hex = getAttributeValueHex(id);
                            return (
                                <VariantChip key={id} kind={hex ? 'color' : 'material'} size="sm"
                                    swatch={hex} icon={null}
                                >{getAttributeValueName(id)}</VariantChip>
                            );
                        })}
                        {canManage && selectedNode.status === 'PENDING' && (
                            <button
                                title="Edit attributes"
                                onClick={() => setEditAttrsModal({ mo: selectedNode, selected: [...(selectedNode.attribute_value_ids || [])] })}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: '#6b7280', fontSize: '11px' }}
                            >
                                <i className="bi bi-pencil"></i>
                            </button>
                        )}
                        {/* Color / pending-lab-dip status for color-type orders */}
                        {selectedNode.color_code && (
                            <VariantChip kind="color" size="sm"
                                title={`Approved color: ${colorTitle(selectedNode.color_code, selectedNode.color_name)}`}
                                swatch={selectedNode.color_hex || colorHexFor(selectedNode.color_name || selectedNode.color_code)}
                                icon={selectedNode.color_hex ? undefined : 'bi-palette'}
                            >{colorLabel(selectedNode.color_code, selectedNode.color_name)}</VariantChip>
                        )}
                        {!selectedNode.color_id && selectedNode.labdip_variant_code && (
                            <VariantChip kind="pending" size="sm"
                                title="Color still in lab dip — dyeing is blocked until approved or a color is set"
                            >Lab dip: {selectedNode.labdip_variant_code}</VariantChip>
                        )}
                        {canManage && (selectedNode.color_id || selectedNode.labdip_variant_code) && selectedNode.status !== 'COMPLETED' && selectedNode.status !== 'CANCELLED' && (
                            <button
                                title="Set / confirm color"
                                onClick={() => { setColorModalSearch(''); setColorModalResults([]); setEditColorModal({ mo: selectedNode }); }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: '#6b7280', fontSize: '11px' }}
                            >
                                <i className="bi bi-pencil"></i>
                            </button>
                        )}
                        {(selectedNode.bom_size_id || selectedNode.bom_size_snapshot) && (() => {
                            const label = getBomSizeLabel(selectedNode.bom_id, selectedNode.bom_size_id, selectedNode.bom_size_snapshot);
                            return label ? (
                                <VariantChip kind="size" size="sm">{label}</VariantChip>
                            ) : null;
                        })()}
                        <span
                            title="Planned putaway bin — where the output will be stored"
                            style={{ fontSize: '9px', padding: '1px 6px', background: selectedNode.planned_putaway_location_name ? '#e8f5e9' : '#f3f4f6', color: selectedNode.planned_putaway_location_name ? '#1b5e20' : '#6b7280', border: `1px solid ${selectedNode.planned_putaway_location_name ? '#a5d6a7' : '#d1d5db'}`, borderRadius: CHIP_RADIUS, fontWeight: 700 }}
                        >
                            <i className="bi bi-box-arrow-in-down me-1"></i>
                            {selectedNode.planned_putaway_location_name || 'No putaway bin'}
                        </span>
                        {canManage && selectedNode.status !== 'COMPLETED' && selectedNode.status !== 'CANCELLED' && (
                            <button
                                title="Set putaway bin"
                                onClick={() => openPutawayModal(selectedNode)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: '#6b7280', fontSize: '11px' }}
                            >
                                <i className="bi bi-pencil"></i>
                            </button>
                        )}
                        {bom && <span style={{ fontSize: '10px', color: '#444' }}>BOM: <CodeChip code={bom.code} tier={2} /></span>}
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                            {canManage && selectedNode.status === 'PENDING' && (
                                <button className="btn btn-sm btn-primary py-0 px-2" style={{ fontSize: '0.72rem' }} onClick={() => onUpdateStatus(selectedNode.id, 'IN_PROGRESS')}>
                                    <i className="bi bi-play-fill me-1"></i>Start
                                </button>
                            )}
                            {/* Delivered = qty met but still open. Closing is the explicit
                                act that stops further logging (industry: SAP TECO). */}
                            {canManage && selectedNode.status === 'DELIVERED' && (
                                <button className="btn btn-sm btn-success py-0 px-2" style={{ fontSize: '0.72rem' }} onClick={() => onUpdateStatus(selectedNode.id, 'COMPLETED')}>
                                    <i className="bi bi-lock-fill me-1"></i>Close Order
                                </button>
                            )}
                            {canManage && selectedNode.status === 'COMPLETED' && (
                                <button className="btn btn-sm btn-outline-secondary py-0 px-2" style={{ fontSize: '0.72rem' }} onClick={() => onUpdateStatus(selectedNode.id, 'IN_PROGRESS')}>
                                    <i className="bi bi-unlock me-1"></i>Reopen
                                </button>
                            )}
                            <button
                                title="Print this MO"
                                className={XP_BTN}
                                style={{ fontFamily: xpFont, fontSize: '10px', padding: '1px 8px', background: 'linear-gradient(to bottom,#f0efe6,#dddbd0)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', cursor: 'pointer', color: '#000', borderRadius: BUTTON_RADIUS }}
                                onClick={() => handlePrintMO(selectedNode, true)}
                            >
                                <i className="bi bi-printer me-1"></i>Print
                            </button>
                        </div>
                    </div>

                    {/* Production Progress — prominent, full width under MO code */}
                    {(selectedNode.status === 'IN_PROGRESS' || selectedNode.status === 'DELIVERED' || selectedNode.status === 'COMPLETED' || (selectedNode.qty_completed_total ?? 0) > 0 || (selectedNode.work_orders || []).some((w: any) => w.status !== 'COMPLETED')) && (() => {
                        const done = selectedNode.qty_completed_total ?? 0;
                        const total = selectedNode.qty ?? 0;
                        const remaining = Math.max(0, total - done);
                        // Effectivity: scrap is output that was produced and thrown away, so
                        // yield is measured against everything the floor made, not the target.
                        const rejected = selectedNode.qty_rejected_total ?? 0;
                        const produced = done + rejected;
                        const yieldPct = produced > 0 ? (done / produced) * 100 : null;
                        // Output overdelivery allowance: the order qty is a target, not a
                        // ceiling. Null pct on legacy rows = the 10% system default.
                        const tolPct = selectedNode.overdelivery_tolerance_pct ?? 10;
                        const unlimited = !!selectedNode.allow_unlimited_overdelivery;
                        const maxLoggable = unlimited ? null : total * (1 + tolPct / 100);
                        const over = Math.max(0, done - total);
                        // Projected output from WOs that are set up but not yet completed
                        const plannedRaw = (selectedNode.work_orders || [])
                            .filter((w: any) => w.status !== 'COMPLETED')
                            .reduce((s: number, w: any) => s + Math.max(0, (w.qty ?? 0) - (w.qty_completed_total ?? 0)), 0);
                        const planned = Math.min(plannedRaw, remaining);   // cap so Done + Planned ≤ total
                        const left = Math.max(0, remaining - planned);     // qty not yet covered by any WO
                        const donePct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
                        const plannedPct = total > 0 ? Math.min(100 - donePct, (planned / total) * 100) : 0;
                        return (
                            <div style={{
                                background: '#eef2f7',
                                borderBottom: '1px solid #808080',
                                padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: '4px'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                                    Production Progress
                                </span>
                                <ProgressBar
                                    pct={donePct}
                                    tone={donePct >= 100 ? 'green' : 'blue'}
                                    hatched
                                    height={15}
                                    secondaryPct={plannedPct}
                                    secondaryTone="gray"
                                    label="inside"
                                />
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '10px', color: '#555', whiteSpace: 'nowrap' }}>Done: <strong style={{ color: '#000' }}>{done.toFixed(2)}</strong></span>
                                {rejected > 0 && (
                                    <span
                                        title={`${rejected.toFixed(2)} of the ${produced.toFixed(2)} produced was QC-rejected. Yield = good / produced.`}
                                        style={{ fontSize: '10px', color: '#555', whiteSpace: 'nowrap' }}
                                    >
                                        Reject: <strong style={{ color: '#c00' }}>{rejected.toFixed(2)}</strong>
                                    </span>
                                )}
                                {rejected > 0 && yieldPct != null && (
                                    <span
                                        title={`Yield = ${done.toFixed(2)} good / ${produced.toFixed(2)} produced`}
                                        style={{ fontSize: '10px', color: '#555', whiteSpace: 'nowrap' }}
                                    >
                                        Yield: <strong style={{ color: yieldPct >= 98 ? '#1a6e1a' : yieldPct >= 95 ? '#8a6d00' : '#c00' }}>{yieldPct.toFixed(1)}%</strong>
                                    </span>
                                )}
                                <span style={{ fontSize: '10px', color: '#555', whiteSpace: 'nowrap' }}>Planned: <strong style={{ color: '#1565c0' }}>{planned.toFixed(2)}</strong></span>
                                <span style={{ fontSize: '10px', color: '#555', whiteSpace: 'nowrap' }}>Left: <strong style={{ color: left <= 0 ? '#1a6e1a' : '#c00' }}>{left.toFixed(2)}</strong></span>
                                {over > 0 && (
                                    <span style={{ fontSize: '10px', color: '#555', whiteSpace: 'nowrap' }}>Over: <strong style={{ color: '#8a6d00' }}>+{over.toFixed(2)}</strong></span>
                                )}
                                <span
                                    title={unlimited
                                        ? 'No output ceiling on this order — log as much as the floor produces.'
                                        : `Logging is allowed up to ${maxLoggable!.toFixed(2)} (${total.toFixed(2)} + ${Number(tolPct).toFixed(0)}%). Raise the tolerance to log more.`}
                                    style={{ fontSize: '9px', padding: '1px 6px', whiteSpace: 'nowrap', border: '1px solid #d1d5db', background: '#f3f4f6', color: '#555', borderRadius: CHIP_RADIUS, fontWeight: 700 }}
                                >
                                    <i className="bi bi-arrow-bar-up me-1"></i>
                                    {unlimited ? 'Max: unlimited' : `Max: ${maxLoggable!.toFixed(2)}`}
                                </span>
                                {canManage && selectedNode.status !== 'CANCELLED' && (
                                    <button
                                        title="Set overdelivery tolerance for this order"
                                        onClick={() => setToleranceModal({
                                            mo: selectedNode,
                                            pct: String(tolPct),
                                            unlimited,
                                        })}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: '#6b7280', fontSize: '11px' }}
                                    >
                                        <i className="bi bi-pencil"></i>
                                    </button>
                                )}
                              </div>
                            </div>
                        );
                    })()}

                    {/* Section title */}
                    <div style={{
                        background: '#d4d0c8',
                        borderBottom: '1px solid #808080',
                        padding: '2px 10px', fontSize: '10px', fontWeight: 'bold', color: '#000',
                        display: 'flex', alignItems: 'center', gap: '6px'
                    }}>
                        <i className="bi bi-boxes"></i>BOM Components
                        {componentLines.length === 0 && <span style={{ fontWeight: 'normal', color: '#888' }}>— No BOM linked</span>}
                        {fromSnapshot ? (
                            <span title="The recipe snapshotted when this order was created — later BOM edits do not change it" style={{ fontWeight: 'normal', color: '#555', fontSize: 9 }}>
                                as planned
                            </span>
                        ) : componentLines.length > 0 ? (
                            <span title="This order has no snapshotted recipe (created before the snapshot existed) — showing the live BOM, which may have changed since" style={{ fontWeight: 'normal', color: '#8a6d00', fontSize: 9 }}>
                                live BOM
                            </span>
                        ) : null}
                    </div>

                    {/* Components table */}
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        {componentLines.length > 0 ? (
                            <table style={lvSubTable()}>
                                <thead>
                                    <tr style={{ position: 'sticky', top: 0 }}>
                                        {['Component', 'Variant', 'Required', ...(showBreakdown ? ['Breakdown'] : []), 'In Stock', 'Available At'].map(h => (
                                            // Full cell borders rather than lvSubTd's single rule — this
                                            // is a grid, and the verticals separate the paired figures.
                                            <th key={h} style={{ ...lvSubTh(), border: '1px solid #808080', textAlign: h === 'Required' || h === 'In Stock' ? 'right' : 'left' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {componentLines.map((line: any, i: number) => {
                                        const req = calculateRequiredQty(selectedNode.qty, line, bom);
                                        const { total, isEnough, locs } = getStockAcrossLocations(line.item_id, line.attribute_value_ids || [], req);
                                        const hasSubBOM = boms.some((b: any) => b.item_id === line.item_id && b.active !== false);
                                        const attrLabel = (line.attribute_value_ids || []).map(getAttributeValueName).filter(Boolean).join(', ');
                                        // Zebra on: this is a wide grid, and the stripe is what keeps
                                        // a component's figures tracking across six columns.
                                        const rowStyle = lvSubRow(i, { zebra: true });
                                        const cell: React.CSSProperties = {
                                            ...lvSubTd(),
                                            border: '1px solid #c0bdb5',
                                        };
                                        const stockLevel = isEnough ? 'ok' : total > 0 ? 'low' : 'out';
                                        const dotStyle: Record<string, { dot: string; border: string }> = {
                                            ok:  { dot: '#00aa00', border: '#005500' },
                                            low: { dot: '#ccaa00', border: '#886600' },
                                            out: { dot: '#cc0000', border: '#660000' },
                                        };
                                        const dc = dotStyle[stockLevel];
                                        return (
                                            <tr key={line.id} style={rowStyle}>
                                                <td style={{ ...cell, color: '#000' }}>
                                                    <div style={{ fontWeight: 500 }}>{line.item_name || getItemName(line.item_id)}</div>
                                                    <CodeChip code={line.item_code || getItemCode(line.item_id)} tier={2} style={{ display: 'block' }} />
                                                    {hasSubBOM && (
                                                        <Chip size="xs" bold
                                                            tone={{ background: '#fff3cd', borderColor: '#b8860b', color: '#6b4e00' }}
                                                            title="This component has its own BOM — it is made, not bought">
                                                            SUB-BOM
                                                        </Chip>
                                                    )}
                                                </td>
                                                <td style={{ ...cell, color: '#333' }}>{attrLabel || '—'}</td>
                                                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                                                        {(line.percentage || 0) > 0 && (
                                                            <span title={`${line.percentage}% of MO qty`} style={{ background: '#b46a00', color: '#fff', fontSize: 8, padding: '0 3px', fontWeight: 'bold' }}>{line.percentage}%</span>
                                                        )}
                                                        <span style={{ fontFamily: CODE_FONT, color: '#000', fontWeight: 'bold' }}>{req.toFixed(2)}</span>
                                                        {getItemUom(line.item_id) && (
                                                            <span style={uomBadgeStyle}>{getItemUom(line.item_id)}</span>
                                                        )}
                                                    </div>
                                                </td>
                                                {showBreakdown && (
                                                    <td style={{ ...cell, verticalAlign: 'top' }}>
                                                        {parentMOBreakdown.map(({ mo, qty: parentContrib }) => {
                                                            const proportion = selectedNode.qty > 0 ? parentContrib / selectedNode.qty : 0;
                                                            const componentShare = req * proportion;
                                                            return (
                                                                <div key={mo.id} style={{ fontSize: '10px', display: 'flex', gap: 6, whiteSpace: 'nowrap', justifyContent: 'space-between' }}>
                                                                    <span style={{ fontFamily: CODE_FONT, color: '#666' }}>{mo.code}:</span>
                                                                    <span style={{ fontFamily: CODE_FONT, fontWeight: 'bold', color: '#000' }}>{componentShare.toFixed(2)}</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </td>
                                                )}
                                                <td style={{ ...cell, textAlign: 'right' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                                                        <span style={{ fontFamily: CODE_FONT, color: isEnough ? '#004400' : total > 0 ? '#664400' : '#880000', fontWeight: 'bold' }}>{total.toFixed(2)}</span>
                                                        <span style={{ display: 'inline-block', width: 8, height: 8, background: dc.dot, border: `1px solid ${dc.border}`, flexShrink: 0 }} />
                                                        {stockLevel === 'low' && <span style={{ fontSize: 8, background: '#886600', color: '#fff', padding: '0 3px', fontWeight: 'bold' }}>Low</span>}
                                                        {stockLevel === 'out' && <span style={{ fontSize: 8, background: '#880000', color: '#fff', padding: '0 3px', fontWeight: 'bold' }}>Out</span>}
                                                        {getItemUom(line.item_id) && <span style={uomBadgeStyle}>{getItemUom(line.item_id)}</span>}
                                                    </div>
                                                </td>
                                                <td style={{ ...cell }}>
                                                    {locs.length === 0 ? (
                                                        <span style={{ color: '#bbb', fontSize: 9 }}>—</span>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                                                            {locs.map(l => (
                                                                <LocationChip key={l.locId} direction="in" code={l.code}>
                                                                    {' '}<span style={{ fontFamily: CODE_FONT, fontWeight: 'bold' }}>{l.qty.toFixed(1)}</span>
                                                                </LocationChip>
                                                            ))}
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            <div style={{ padding: '16px', color: '#555', fontSize: '11px', textAlign: 'center' }}>No BOM lines to display for this manufacturing order.</div>
                        )}
                    </div>
                </div>

                {/* ── RIGHT: Meta + QR ── */}
                <div style={{
                    width: '170px', minWidth: '170px',
                    borderLeft: '2px solid #808080',
                    background: '#fafaf7',
                    display: 'flex', flexDirection: 'column', overflowY: 'auto'
                }}>
                    {/* Timeline */}
                    <div style={{ borderBottom: '1px solid #c0bdb5', padding: '6px 8px' }}>
                        <div style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.5px', marginBottom: '4px' }}>Timeline</div>
                        {([
                            { label: 'Target S', val: formatDate(selectedNode.target_start_date), warn: null },
                            { label: 'Target E', val: formatDate(selectedNode.target_end_date), warn: getDueDateWarning(selectedNode) },
                            { label: 'Actual S', val: formatDateTime(selectedNode.actual_start_date), warn: null },
                            { label: 'Actual E', val: formatDateTime(selectedNode.actual_end_date), warn: null },
                        ] as {label:string;val:string;warn:any}[]).map(({ label, val, warn }) => (
                            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' }}>
                                <span style={{ color: '#555' }}>{label}:</span>
                                <span style={{ fontWeight: 'bold', color: warn ? '#c00000' : '#000' }}>{val}</span>
                            </div>
                        ))}
                    </div>

                    {/* Machine Group */}
                    {(bom?.work_center_id || bom?.work_center_name) && (
                    <div style={{ borderBottom: '1px solid #c0bdb5', padding: '6px 8px' }}>
                        <div style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.5px', marginBottom: '4px' }}>
                            <i className="bi bi-gear me-1"></i>Machine Group
                        </div>
                        <div style={{ fontSize: '10px', color: '#000', fontWeight: 'bold' }}>
                            {bom.work_center_name || getWCName(bom.work_center_id)}
                        </div>
                    </div>
                    )}

                    {/* Output */}
                    <div style={{ borderBottom: '1px solid #c0bdb5', padding: '6px 8px' }}>
                        <div style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.5px', marginBottom: '4px' }}>Output</div>
                        <div style={{ fontSize: '10px', color: '#000', fontWeight: 'bold' }}>{getLocationName(selectedNode.location_id)}</div>
                        <div style={{ fontSize: '10px', color: '#444' }}>Qty: <strong style={{ color: '#000' }}>{selectedNode.qty}</strong>{getItemUom(selectedNode.item_id) && <span style={{ ...uomBadgeStyle, marginLeft: 4 }}>{getItemUom(selectedNode.item_id)}</span>}{selectedNode.item_ends != null && <span style={{ marginLeft: 8, color: '#1a6e2e', fontWeight: 'bold' }}>Ends: {selectedNode.item_ends}</span>}</div>
                    </div>

                    {/* Beams in Stock */}
                    {(() => {
                        const beamLines: { item_id: string; item_name: string; ends: number }[] = [];
                        // MO output is a beam
                        if (selectedNode.item_ends != null) {
                            beamLines.push({ item_id: selectedNode.item_id, item_name: selectedNode.item_name, ends: selectedNode.item_ends });
                        }
                        // BOM component lines that are beams
                        if (bom) {
                            for (const line of (bom.lines || [])) {
                                const ends = getItemEnds(line.item_id);
                                if (ends != null && !beamLines.some(b => b.item_id === line.item_id)) {
                                    beamLines.push({ item_id: line.item_id, item_name: line.item_name || getItemName(line.item_id), ends });
                                }
                            }
                        }
                        if (beamLines.length === 0) return null;
                        return (
                            <div style={{ borderBottom: '1px solid #c0bdb5', padding: '6px 8px' }}>
                                <div style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.5px', marginBottom: '4px' }}>
                                    Beams in Stock
                                </div>
                                {beamLines.map(b => {
                                    const { total } = getStockAcrossLocations(b.item_id, [], 0);
                                    const bc = getBeamBatchCount(b.item_id);
                                    return (
                                        <div key={b.item_id} style={{ marginBottom: '4px' }}>
                                            <div style={{ fontSize: '9px', color: '#444', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={b.item_name}>{b.item_name}</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                <span style={{ fontFamily: CODE_FONT, fontSize: '10px', fontWeight: 'bold', color: total > 0 ? '#004400' : '#880000' }}>{total.toFixed(2)}</span>
                                                {getItemUom(b.item_id) && <span style={uomBadgeStyle}>{getItemUom(b.item_id)}</span>}
                                                <span style={{ borderRadius: CHIP_RADIUS, fontSize: 9, background: '#e8d8ff', border: '1px solid #c4a8ee', color: '#440099', padding: '0 4px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{bc} beam{bc !== 1 ? 's' : ''}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}

                    {/* Batch Trace */}
                    <div style={{ borderBottom: '1px solid #c0bdb5', padding: '6px 8px' }}>
                        <div style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.5px', marginBottom: '4px' }}>
                            <i className="bi bi-upc-scan me-1"></i>Lots
                        </div>
                        {(() => {
                            const trace: any[] = selectedNode.batch_trace || [];
                            if (trace.length === 0) {
                                return <div style={{ fontSize: '9px', color: '#999', fontStyle: 'italic' }}>No batch recorded</div>;
                            }
                            const outputBatch = trace[0]?.output_batch_number;
                            return (
                                <>
                                    {outputBatch && (
                                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                                            <span style={{ color: '#555', fontSize: '9px' }}>Output: </span>
                                            <span style={{ fontFamily: CODE_FONT, fontWeight: 'bold', color: '#1a6e1a', fontSize: '10px', background: '#f0fdf4', border: '1px solid #86efac', padding: '0 4px', borderRadius: CHIP_RADIUS }}>
                                                {outputBatch}
                                            </span>
                                        </div>
                                    )}
                                    <div style={{ fontSize: '9px', color: '#555', marginBottom: '2px' }}>Input batches:</div>
                                    {trace.map((c: any, i: number) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px', fontSize: '9px' }}>
                                            <span style={{ fontFamily: CODE_FONT, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #93c5fd', padding: '0 3px', borderRadius: CHIP_RADIUS, fontSize: '9px' }}>
                                                {c.input_batch_number}
                                            </span>
                                            <span style={{ color: '#666', fontSize: '9px' }}>{Number(c.qty_consumed).toFixed(2)}</span>
                                        </div>
                                    ))}
                                </>
                            );
                        })()}
                    </div>

                </div>
            </ExpandedRowPanelBody>
            )}

            {detailTab === 'steps' && (
                <div style={{
                    padding: '8px 12px', height: PANEL_BODY_H, overflowY: 'auto', boxSizing: 'border-box',
                    background: '#fff', border: '1px solid #808080',
                }}>
                    <WorkOrderPanel
                        manufacturingOrderId={selectedNode.id}
                        workOrders={selectedNode.work_orders || []}
                        workCenters={workCenters || []}
                        locations={locations || []}
                        onAdd={onCreateWO}
                        onUpdate={onUpdateWO}
                        onUpdateStatus={onUpdateWOStatus}
                        onDelete={onDeleteWO}
                        // `wo` here really IS a WorkOrder — the log-output callback off
                        // WorkOrderPanel is the one place in this file that hands one back.
                        onLogWO={(wo: any) => { setCompletionWO(wo); setCompletionMO(resolveMoBom(selectedNode, boms)); }}
                        parentMO={selectedNode}
                        bom={bom}
                    />
                </div>
            )}
        </ExpandedRowPanel>
        );
    };

    return (
        <>
            {printPreviewMO && (
              <MOPrintModal
                  mo={printPreviewMO}
                  onClose={() => setPrintPreviewMO(null)}
                  printSettings={printSettings}
                  onPrintSettingsChange={setPrintSettings}
                  currentStyle={currentStyle}
                  companyProfile={companyProfile}
                  boms={boms}
                  getItemName={getItemName}
                  getItemCode={getItemCode}
                  getLocationName={getLocationName}
                  getAttributeValueName={getAttributeValueName}
                  formatDate={formatDate}
                  hideChildMOs={printHideChildren}
                  onPrint={() => {
                      authFetch(`${API_BASE}/manufacturing-orders/${printPreviewMO.id}/mark-printed`, { method: 'POST' }).catch(() => {});
                  }}
              />
          )}

            {(() => {
                const moActions = canManage || onPrint ? (
                    <>
                        {canManage && (
                            <ToolbarButton tone="create" icon="bi-plus-lg" onClick={onNewMO}>New MO</ToolbarButton>
                        )}
                        {onPrint && (
                            <ToolbarButton tone="neutral" icon="bi-printer" printable onClick={onPrint}>Print</ToolbarButton>
                        )}
                    </>
                ) : null;

                // Calendar/List picker. Lives in this tab's toolbar rather than the
                // page's title bar: it drives only this tab, and the shared toolbar
                // order is search -> filters -> count -> actions. In calendar mode
                // there is no search bar, so the same control is rendered into that
                // branch's own row — dropping it there would strand the user on the
                // calendar with no way back to the table.
                const viewToggle = (
                    <FilterChipBar
                        value={viewMode}
                        onChange={(v) => setViewMode(v as string)}
                        options={[
                            // No `title`: the labels already say what they do, so a
                            // hover restating them is noise on every pass of the cursor.
                            { value: 'calendar', label: 'Calendar' },
                            { value: 'list', label: 'List' },
                        ]}
                    />
                );

                return viewMode === 'calendar' ? (
                    <>
                        <div className="no-print" style={{
                            padding: '5px 8px',
                            borderBottom: '1px solid #808080',
                            background: '#ece9d8',
                            display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                            {viewToggle}
                            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                                {moActions}
                            </div>
                        </div>
                        <div className="p-3"><CalendarView orders={manufacturingOrders} items={items} onMOClick={openMOFromCalendar} endField="target_end_date" startField="target_start_date" showHolidays filterable showLoad /></div>
                    </>
                ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <ManufacturingSearchBar
                        value={moCodeFilter}
                        onChange={setMoCodeFilter}
                        placeholder="Search by MO code, product, or BOM..."
                        total={totalItems}
                        filters={viewToggle}
                        actions={moActions}
                    />
                    <div className="table-responsive" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                    <table style={{
                        width: '100%',
                        tableLayout: 'fixed',
                        borderCollapse: 'collapse',
                        fontFamily: xpFont,
                        fontSize: '11px',
                        background: '#fff',
                    }}>
                        <colgroup>
                            <col style={{ width: `${LV_EXPANDER_COL_W}px` }} />
                            <col style={{ width: '195px' }} />
                            <col />
                            <col style={{ width: '150px' }} />
                            <col style={{ width: '90px' }} />
                            <col style={{ width: '120px' }} />
                            <col style={{ width: '120px' }} />
                            <col style={{ width: '120px' }} />
                            <col style={{ width: '90px' }} />
                            <col style={{ width: '78px' }} />
                        </colgroup>
                        <thead style={{ ...lvThead(), fontSize: '10px'}}>
                            <tr>
                                {[
                                    { label: '',                  align: 'left',   cls: '' },
                                    { label: 'MO Code',           align: 'left',   cls: 'ps-3' },
                                    { label: 'Product',           align: 'left',   cls: '' },
                                    { label: 'BOM',               align: 'left',   cls: '' },
                                    { label: 'Qty',               align: 'center', cls: '' },
                                    { label: 'Target Timeline',   align: 'left',   cls: '' },
                                    { label: 'Actual',            align: 'left',   cls: '' },
                                    { label: 'Progress',          align: 'left',   cls: '' },
                                    { label: 'Status',            align: 'left',   cls: '' },
                                    { label: 'Actions',           align: 'right',  cls: 'pe-3 no-print' },
                                ].map(({ label, align, cls }) => (
                                    <th key={label} className={cls} style={{
                                        ...lvTh(),
                                        textAlign: align as any,
                                        overflow: 'hidden',
                                    }}>{label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody ref={listBodyRef}>
                            {manufacturingOrders.length === 0 && (dataLoading.manufacturingOrders ? (
                                <TableSkeleton rows={8} cols={skel.cols ?? 10} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                            ) : (
                                <TableEmpty colSpan={10}
                                    message={moCodeFilter
                                        ? <>No Manufacturing Orders match &quot;<strong>{moCodeFilter}</strong>&quot;.</>
                                        : 'No Manufacturing Orders yet.'} />
                            ))}
                            {manufacturingOrders.map((mo: any, rowIdx: number) => {
                                const warning = getDueDateWarning(mo);
                                const isExpanded = expandedRows[mo.id];
                                const isHighlighted = !!moCodeFilter && mo.code.toLowerCase().includes(moCodeFilter.toLowerCase());
                                const rowBg = isHighlighted ? rowStateBg('highlighted')
                                    : isExpanded ? rowStateBg('expanded')
                                    : lvZebra(rowIdx);
                                const tdStyle: React.CSSProperties = {
                                    border: '1px solid #c0bdb5',
                                    padding: '4px 8px',
                                    color: '#000',
                                    verticalAlign: 'middle',
                                    height: 46,
                                };

                                // Keyed Fragment, not <>: a row is TWO <tr>s (the row and its
                                // expanded detail), and a bare fragment takes no key — so the
                                // keys sat on the inner <tr>s where React never sees them.
                                // Paging or reordering then remounted both, dropping the
                                // expanded panel's state and any open inline form with it.
                                return (
                                    <React.Fragment key={mo.id}>
                                    <tr id={`mo-row-${mo.id}`} style={{ background: rowBg, cursor: 'default' }}>

                                        <ExpanderCell expanded={!!isExpanded} onToggle={() => toggleRow(mo.id)} label="order detail" tdStyle={tdStyle} />

                                        {/* MO Code */}
                                        <td style={{ ...tdStyle, paddingLeft: '10px'}}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                                                <CodeChip code={mo.code} style={{ fontWeight: 'bold', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} />
                                                <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
                                                    <PrintChip variant={mo.card_printed_at ? 'green' : 'gray'} label="Card"
                                                        title={mo.card_printed_at ? `SPK Produksi printed ${tzFmt(mo.card_printed_at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }, 'id-ID')}` : 'SPK Produksi not printed yet'} />
                                                </span>
                                            </div>
                                        </td>

                                        {/* Product — name (line 1) + variant chips (line 2); click to expand */}
                                        <td style={{ ...tdStyle, cursor: 'pointer' }} onClick={() => toggleRow(mo.id)}>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ fontWeight: 'bold', color: '#000', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {mo.item_name || getItemName(mo.item_id)}
                                                    </div>
                                                    {((mo.attribute_value_ids || []).length > 0 || mo.bom_size_id) && (
                                                        <div style={{ display: 'flex', gap: 3, flexWrap: 'nowrap', overflow: 'hidden', marginTop: 2 }}>
                                                            {(mo.attribute_value_ids || []).map((id: string) => {
                                                                const hex = getAttributeValueHex(id);
                                                                return (
                                                                    <VariantChip key={id} kind={hex ? 'color' : 'material'}
                                                                        swatch={hex} icon={null} truncate
                                                                    >{getAttributeValueName(id)}</VariantChip>
                                                                );
                                                            })}
                                                            {mo.bom_size_id && (() => {
                                                                const label = getBomSizeLabel(mo.bom_id, mo.bom_size_id);
                                                                return label ? (
                                                                    <VariantChip kind="size" truncate>{label}</VariantChip>
                                                                ) : null;
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>

                                        {/* BOM — code + originating SO + nested marker */}
                                        <td style={{ ...tdStyle, overflow: 'hidden' }}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, fontSize: '9px', color: '#555', minWidth: 0, maxWidth: '100%' }}>
                                                <CodeChip code={getBOMCode(mo.bom_id)} tier={2} style={{ display: 'block', minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }} />
                                                {/* Both badges go through Chip: the classic/modern pairs they
                                                    replaced disagreed on radius (one square, one CHIP_RADIUS)
                                                    and on wording ("NESTED x2" vs "NESTED (2)") for the same
                                                    fact, and neither gave a clipped label the popout. */}
                                                {mo.sales_order_id && (
                                                    <Chip size="xs" bold icon="bi-receipt" truncate
                                                        tone={{ background: '#dce8ff', borderColor: '#9ab0e0', color: '#003ea6' }}
                                                        title={`Originating Sales Order: ${mo.sales_order_code || 'unknown'}`}>
                                                        SO: {mo.sales_order_code || '—'}
                                                    </Chip>
                                                )}
                                                {mo.child_mos && mo.child_mos.length > 0 && (
                                                    <Chip size="xs" bold
                                                        tone={{ background: '#fff3cd', borderColor: '#b8860b', color: '#6b4e00' }}
                                                        title={`${mo.child_mos.length} nested component order(s) under this one`}>
                                                        NESTED x{mo.child_mos.length}
                                                    </Chip>
                                                )}
                                            </div>
                                        </td>

                                        {/* Qty */}
                                        <td style={{ ...tdStyle, fontWeight: 'bold', color: '#000', fontFamily: CODE_FONT }}>
                                            {(() => {
                                                const qtyStr = typeof mo.qty === 'number' ? mo.qty.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(mo.qty);
                                                const [intPart, decPart] = qtyStr.split('.');
                                                return (
                                                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                                                        <span style={{ minWidth: '48px', textAlign: 'right' }}>{intPart}</span>
                                                        <span style={{ width: '7px', textAlign: 'left' }}>{decPart ? '.' : ''}</span>
                                                        <span style={{ minWidth: '20px', textAlign: 'left' }}>{decPart || ''}</span>
                                                    </div>
                                                );
                                            })()}
                                        </td>

                                        {/* Target Timeline */}
                                        <td style={tdStyle}>
                                            <div style={{ fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                                <span style={{ color: '#000' }}>S: {formatDate(mo.target_start_date)}</span>
                                                <span style={{ color: warning ? '#c00000' : '#000', fontWeight: warning ? 'bold' : undefined }}>
                                                    E: {formatDate(mo.target_end_date)}
                                                    {warning && <i className={`bi ${warning.icon} ms-1`} style={{ fontSize: '9px' }}></i>}
                                                </span>
                                            </div>
                                        </td>

                                        {/* Actual — start / end only (2 lines) */}
                                        <td style={tdStyle}>
                                            <div style={{ fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                                <span style={{ color: '#555' }}>S: {formatDateTime(mo.actual_start_date)}</span>
                                                <span style={{ color: '#555' }}>E: {formatDateTime(mo.actual_end_date)}</span>
                                            </div>
                                        </td>

                                        {/* Progress — bar + completed / target (2 lines) */}
                                        <td style={tdStyle}>
                                            {(mo.qty_completed_total != null && mo.qty_completed_total > 0) ? (() => {
                                                const pct = Math.min(100, Math.round((mo.qty_completed_total / mo.qty) * 100));
                                                // Step-level scrap: the MO says how much was lost, this says where.
                                                const rej = mo.qty_rejected_total ?? 0;
                                                const prod = mo.qty_completed_total + rej;
                                                return (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                        <ProgressBar pct={pct} tone={pct >= 100 ? 'green' : 'blue'} height={8} />
                                                        <span style={{ fontSize: '9px', color: '#555' }}>{parseFloat(mo.qty_completed_total).toFixed(2)} / {mo.qty} ({pct}%)</span>
                                                        {rej > 0 && (
                                                            <span
                                                                title={`${rej.toFixed(2)} rejected on this step of ${prod.toFixed(2)} produced — yield ${(mo.qty_completed_total / prod * 100).toFixed(1)}%`}
                                                                style={{ fontSize: '9px', fontWeight: 700, color: '#a01010' }}
                                                            >
                                                                <i className="bi bi-x-octagon-fill me-1" style={{ fontSize: '8px' }}></i>
                                                                rej {rej.toFixed(2)} ({(mo.qty_completed_total / prod * 100).toFixed(1)}% yield)
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })() : (
                                                <Dash />
                                            )}
                                        </td>

                                        {/* Status */}
                                        <td style={tdStyle}>
                                            <StatusChip status={mo.status || 'PENDING'} />
                                        </td>

                                        {/* Actions — icon Start + [...] menu (Print / Delete) */}
                                        <td style={{ ...tdStyle, textAlign: 'right' }} className="no-print" onClick={(e) => e.stopPropagation()}>
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                                                {canManage && mo.status === 'PENDING' && (
                                                    <XPActionButton tone="primary" icon="bi-play-fill"
                                                        title="Start production"
                                                        onClick={() => onUpdateStatus(mo.id, 'IN_PROGRESS')} />
                                                )}
                                                <MenuTriggerButton onClick={(e) => toggleMoMenu(mo.id, e)} />
                                            </div>
                                        </td>
                                    </tr>
                                    {isExpanded && (
                                        <tr>
                                            <td colSpan={10} className="p-0 border-0">
                                                {renderMOExpandedPanel({
                                                    rootMO: mo,
                                                    detailTab: expandedDetailTabs[mo.id] || 'bom',
                                                    setDetailTab: (t) => setExpandedDetailTabs(prev => ({ ...prev, [mo.id]: t })),
                                                })}
                                            </td>
                                        </tr>
                                    )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                    </div>
                    {/* Floating "more actions" menu — Print / Delete */}
                    {openMoMenuId && (() => {
                        const menuMO = manufacturingOrders.find((m: any) => m.id === openMoMenuId);
                        if (!menuMO) return null;
                        return (
                            <FloatingMenu
                                pos={moMenuPos}
                                items={[
                                    { key: 'print', icon: 'bi-printer', label: 'Print', onClick: () => { closeMoMenu(); handlePrintMO(menuMO); } },
                                    { key: 'delete', icon: 'bi-trash', label: 'Delete', danger: true, hidden: !canManage, onClick: () => { closeMoMenu(); onDeleteMO(menuMO.id); } },
                                ]}
                            />
                        );
                    })()}
                    <Pager page={currentPage} total={totalItems} pageSize={pageSize} onPageChange={onPageChange} hideWhenEmpty />
                </div>
                );
            })()}

            {completionMO && (
                <WOCompletionModal
                    mo={completionMO}
                    workOrder={completionWO ?? undefined}
                    onClose={() => { setCompletionMO(null); setCompletionWO(null); }}
                    onSaved={(updated) => {
                        setCompletionMO(null);
                        setCompletionWO(null);
                        fetchData('work-orders');
                    }}
                />
            )}

            {editAttrsModal && (() => {
                return (
                    <ModalWrapper
                        isOpen
                        modeless
                        onClose={() => setEditAttrsModal(null)}
                        title={<><i className="bi bi-tags me-1"></i>Edit Attributes — <span style={{ fontFamily: CODE_FONT }}>{editAttrsModal.mo.code}</span></>}
                        size="md"
                        level={2}
                        footer={<ModalFooterActions
                            onCancel={() => setEditAttrsModal(null)}
                            onSubmit={() => handleUpdateMOAttributes(editAttrsModal.mo.id, editAttrsModal.selected)}
                            submitLabel="Save" />}
                    >
                        {/* Attribute rows: label + dropdown */}
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <tbody>
                                {(attributes || []).map((attr: any) => {
                                    const currentVal = (attr.values || []).find((v: any) => editAttrsModal.selected.includes(v.id));
                                    return (
                                        <tr key={attr.id}>
                                            <td style={{
                                                padding: '3px 8px 3px 0',
                                                fontFamily: xpFont,
                                                fontSize: 11,
                                                fontWeight: 'normal',
                                                color: '#333',
                                                whiteSpace: 'nowrap',
                                                width: 1,
                                            }}>{attr.name}</td>
                                            <td style={{ padding: '3px 0'}}>
                                                <select
                                                    value={currentVal?.id ?? ''}
                                                    onChange={e => {
                                                        const newValId = e.target.value;
                                                        setEditAttrsModal(prev => {
                                                            if (!prev) return prev;
                                                            const attrValueIds = (attr.values || []).map((v: any) => v.id);
                                                            const without = prev.selected.filter((id: string) => !attrValueIds.includes(id));
                                                            return { ...prev, selected: newValId ? [...without, newValId] : without };
                                                        });
                                                    }}
                                                    style={{
                                                        fontFamily: xpFont, fontSize: 11,
                                                        border: '1px solid', borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                                                        background: '#fff', height: 20, padding: '0 2px',
                                                        outline: 'none', width: '100%', borderRadius: 0,
                                                    }}
                                                    className={undefined}
                                                >
                                                    <option value="">— none —</option>
                                                    {(attr.values || []).map((val: any) => (
                                                        <option key={val.id} value={val.id}>{val.value}</option>
                                                    ))}
                                                </select>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </ModalWrapper>
                );
            })()}

            {editColorModal && (() => {
                const mo = editColorModal.mo;
                return (
                    <ModalWrapper
                        isOpen
                        modeless
                        onClose={() => setEditColorModal(null)}
                        title={<><i className="bi bi-palette me-1"></i>Set Color — <span style={{ fontFamily: CODE_FONT }}>{mo.code}</span></>}
                        size="md"
                        level={2}
                        footer={<ModalFooterActions
                            onCancel={() => setEditColorModal(null)} cancelLabel="Close"
                            onExtra={mo.color_id ? () => handleSetMOColor(mo.id, null) : undefined}
                            extraLabel={mo.color_id ? 'Clear' : undefined} />}
                    >
                        <div style={{ fontFamily: xpFont, fontSize: 11}}>
                            {mo.color_code && (
                                <div style={{ marginBottom: 8 }}>Current color: <b>{mo.color_code}</b>{mo.color_name && mo.color_name !== mo.color_code ? ` — ${mo.color_name}` : ''}</div>
                            )}
                            {mo.labdip_variant_code && (
                                <div style={{ marginBottom: 8, padding: '4px 8px', background: '#fbf4dd', border: '1px solid #e8dca8', color: '#8a6d00' }}>
                                    Ordered against lab dip <b>{mo.labdip_variant_code}</b>. It backfills the color automatically on approval — set one here only to override.
                                </div>
                            )}
                            {colorModalLabdips.length > 0 && (
                                <div style={{ marginBottom: 8 }}>
                                    <div style={{ fontWeight: 'bold', color: '#8a6d00', marginBottom: 2 }}>Lab dips in progress for this item</div>
                                    {colorModalLabdips.map((v: any) => (
                                        <div key={v.labdip_item_id} style={{ fontSize: 10, color: '#555' }}>{v.variant_code} · {v.request_code || 'lab dip'} · {v.status}</div>
                                    ))}
                                </div>
                            )}
                            <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Pick an approved color</div>
                            <input
                                type="text"
                                placeholder="Search color code / name / Pantone..."
                                value={colorModalSearch}
                                onChange={e => setColorModalSearch(e.target.value)}
                                style={{ fontFamily: xpFont, fontSize: 11, border: '1px solid', borderColor: '#808080 #dfdfdf #dfdfdf #808080', background: '#fff', height: 22, padding: '0 4px', outline: 'none', width: '100%', borderRadius: 0 }}
                                className={undefined}
                            />
                            <div style={{ maxHeight: 200, overflowY: 'auto', border: colorModalResults.length ? '1px solid #ccc' : 'none', marginTop: 4 }}>
                                {colorModalResults.map((c: any) => (
                                    <div
                                        key={c.id}
                                        onClick={() => handleSetMOColor(mo.id, c.id)}
                                        style={{ padding: '3px 6px', cursor: 'pointer', fontSize: 11, borderBottom: '1px solid #eee' }}
                                    >
                                        <b>{c.code}</b>{c.name ? ` — ${c.name}` : ''}{c.pantone_ref ? <span style={{ color: '#888' }}> · {c.pantone_ref}</span> : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </ModalWrapper>
                );
            })()}

            {putawayModal && (() => {
                const pm = putawayModal;
                const reasonText = pm.reason === 'same_item' ? 'bin already holds this item'
                    : pm.reason === 'empty_bin' ? 'first empty bin'
                    : pm.reason === 'configured' ? 'currently assigned bin'
                    : pm.reason === 'item_default' ? "item's default putaway bin"
                    : pm.reason === 'first_bin' ? 'first bin by code'
                    : pm.reason === 'all_locations' ? 'no output area configured for this order — every bin is listed'
                    : null;
                const selStyle = {
                    fontFamily: xpFont, fontSize: 11,
                    border: '1px solid', borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                    background: '#fff', height: 20, padding: '0 2px',
                    outline: 'none', width: '100%', borderRadius: 0,
                } as React.CSSProperties;
                return (
                    <ModalWrapper
                        isOpen
                        modeless
                        onClose={() => setPutawayModal(null)}
                        title={<><i className="bi bi-box-arrow-in-down me-1"></i>Putaway Bin — <span style={{ fontFamily: CODE_FONT }}>{pm.mo.code}</span></>}
                        size="md"
                        level={2}
                        footer={<ModalFooterActions
                            onCancel={() => setPutawayModal(null)}
                            onSubmit={() => handleSavePutaway(pm.mo.id, pm.selected)}
                            submitLabel="Save" />}
                    >
                        <div style={{ fontFamily: xpFont, fontSize: 11, color: '#333', marginBottom: 8 }}>
                            Where this output will be stored when produced. Operators see this on the work order — they do not choose it.
                        </div>
                        {pm.loading ? (
                            <div style={{ fontSize: 11, color: '#888' }}>Loading bins...</div>
                        ) : pm.error ? (
                            <div style={{ fontSize: 11, color: '#c00' }}>
                                Could not load bins: {pm.error}
                            </div>
                        ) : pm.bins.length === 0 ? (
                            <div style={{ fontSize: 11, color: '#888' }}>
                                No locations exist yet — create them on the Locations page.
                            </div>
                        ) : (
                            <>
                                <select
                                    value={pm.selected}
                                    onChange={e => setPutawayModal(prev => prev ? { ...prev, selected: e.target.value } : prev)}
                                    style={selStyle}
                                    className={undefined}
                                >
                                    <option value="">— none (fall back to WO output location) —</option>
                                    {pm.bins.map((b: any) => (
                                        <option key={b.id} value={b.id}>
                                            {b.full_path}
                                            {b.item_on_hand > 0 ? ` — ${Number(b.item_on_hand).toFixed(2)} same item` : b.total_on_hand <= 0 ? ' — empty' : ''}
                                            {b.id === pm.suggested ? ' (suggested)' : ''}
                                        </option>
                                    ))}
                                </select>
                                {reasonText && (
                                    <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
                                        Suggestion: {reasonText}.
                                    </div>
                                )}
                            </>
                        )}
                    </ModalWrapper>
                );
            })()}

            {toleranceModal && (() => {
                const tm = toleranceModal;
                const inpStyle = {
                    fontFamily: xpFont, fontSize: 11,
                    border: '1px solid', borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                    background: '#fff', height: 20, padding: '0 4px',
                    outline: 'none', width: 90, borderRadius: 0,
                } as React.CSSProperties;
                const pctNum = parseFloat(tm.pct);
                const preview = tm.unlimited || isNaN(pctNum)
                    ? null
                    : (Number(tm.mo.qty || 0) * (1 + pctNum / 100));
                return (
                    <ModalWrapper
                        isOpen
                        modeless
                        onClose={() => setToleranceModal(null)}
                        title={<><i className="bi bi-arrow-bar-up me-1"></i>Overdelivery Tolerance — <span style={{ fontFamily: CODE_FONT }}>{tm.mo.code}</span></>}
                        size="md"
                        level={2}
                        footer={<ModalFooterActions
                            onCancel={() => setToleranceModal(null)}
                            onSubmit={handleSaveTolerance}
                            submitLabel="Save" />}
                    >
                        <div style={{ fontFamily: xpFont, fontSize: 11, color: '#333', marginBottom: 10 }}>
                            How far past the order quantity the floor may log. Set this on the order
                            when a run is deliberately over-issued (spare beams against bad yarn) —
                            editing the BOM instead would loosen every future order of this article.
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <label style={{ fontSize: 11, color: '#333', minWidth: 90 }}>Tolerance</label>
                            <input
                                type="number"
                                min={0}
                                step={1}
                                disabled={tm.unlimited}
                                value={tm.pct}
                                onChange={e => setToleranceModal(prev => prev ? { ...prev, pct: e.target.value } : prev)}
                                style={{ ...inpStyle, opacity: tm.unlimited ? 0.5 : 1 }}
                                className={undefined}
                            />
                            <span style={{ fontSize: 11, color: '#555' }}>%</span>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#333' }}>
                            <input
                                type="checkbox"
                                checked={tm.unlimited}
                                onChange={e => setToleranceModal(prev => prev ? { ...prev, unlimited: e.target.checked } : prev)}
                            />
                            No limit (default for warp beams — kg per beam varies with the yarn)
                        </label>
                        <div style={{ fontSize: 10, color: '#666', marginTop: 10 }}>
                            Order qty {Number(tm.mo.qty || 0).toFixed(2)} —{' '}
                            {preview == null ? 'no ceiling: log as much as the floor produces.' : `logging allowed up to ${preview.toFixed(2)}.`}
                        </div>
                    </ModalWrapper>
                );
            })()}
        </>
    );
}
