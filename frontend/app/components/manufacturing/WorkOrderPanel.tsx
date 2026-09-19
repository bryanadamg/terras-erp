'use client';
import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
// Single-WO Kartu Kerja printing goes through WOBulkPrintModal (n=1 -> A6 card).
const WOBulkPrintModal = dynamic(() => import('./WOBulkPrintModal'), { ssr: false });
import WOStagingModal from './WOStagingModal';
import BagScanStageModal from './BagScanStageModal';
import BeamPlanningModal from './BeamPlanningModal';
import LeftoverBeamModal from './LeftoverBeamModal';
import { useToast } from '../shared/Toast';
import { useData } from '../../context/DataContext';
import { useUser } from '../../context/UserContext';
import { useTimezone } from '../../context/TimezoneContext';
import { isContainerWC, isMachineWC, isTypeWC, machinesUnderWC, woHasStaging, woScanStages } from '../shared/workCenterTree';
import SearchableSelect from '@bryanadamg/terras-ui/components/Combobox';
import TreeSelect, { buildLocationPickerTree } from '../shared/TreeSelect';
import { STATUS_COLORS as STATUS_BORDER, workCenterChipStyle, useFloatingMenu, MenuTriggerButton, FloatingMenu, XPActionButton, ProgressBar, CodeChip, CODE_FONT, xpFont, StatusChip, CHIP_RADIUS, XP_BTN, xpBtn, BTN_TONES, xpInput as xpInputBase, LocationChip } from '../shared/xpTheme';

const xpInput: React.CSSProperties = xpInputBase({ padding: '0 4px' });

// Work-center type chip colors. Thin re-export of the shared palette in
// xpTheme so the WO panel/list and BOM list stay in lockstep (no per-view copy).
export function getChipStyle(centerType?: string | null): React.CSSProperties {
    return workCenterChipStyle(centerType);
}

// Machine names carry embedded numbers (JB 02, JB 10) — numeric collation keeps 10
// after 2 instead of sorting it straight after 1.
const byName = (a: any, b: any) =>
    String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { numeric: true, sensitivity: 'base' });

// Lot-producing work centers — these WOs emit weighed bags (one bag = one lot),
// so bag labels apply to them. Others only ever print a Kartu Kerja card.
const LOT_WC_TYPES = ['WEAVING', 'TENUN', 'DYEING', 'CELUP', 'BEAMING', 'SETTING'];

// Derive the print state for a WO row from its timestamps + completions.
//  - cardPrinted: Kartu Kerja printed at least once.
//  - hasBags: lot-type WO with ≥1 non-rejected completion (= a bag to label).
//  - labelsPrinted: labels stamped AND not stale (no bag logged since the print).
export function computePrintState(wo: any): { cardPrinted: boolean; hasBags: boolean; labelsPrinted: boolean } {
    const type = (wo.work_center_type || '').toUpperCase();
    const lotType = LOT_WC_TYPES.includes(type);
    const bags = (wo.completions || []).filter((c: any) => !c.rejected);
    const hasBags = lotType && bags.length > 0;
    let newest = 0;
    for (const c of bags) {
        const t = new Date(c.created_at || 0).getTime();
        if (!isNaN(t) && t > newest) newest = t;
    }
    const lp = wo.labels_printed_at ? new Date(wo.labels_printed_at).getTime() : 0;
    const labelsPrinted = hasBags ? (lp > 0 && lp >= newest) : false;
    return { cardPrinted: !!wo.card_printed_at, hasBags, labelsPrinted };
}

// Single small "printed" indicator chip. Green = printed, gray/amber = not.
// Shared by WO's PrintChips (Card/Label) and MO's single Card indicator.
export function printChipVariantStyle(v: 'green' | 'gray' | 'amber'): React.CSSProperties {
    return v === 'green' ? { background: '#d4f0d4', color: '#005500', borderColor: '#99cc99' }
        : v === 'amber' ? { background: '#fff3cc', color: '#664400', borderColor: '#f0d888' }
            : { background: '#eae8e2', color: '#777', borderColor: '#c8c6be' };
}
export function PrintChip({ variant, label, title }: { variant: 'green' | 'gray' | 'amber'; label: string; title: string }) {
    return (
        <span title={title} style={{
            display: 'inline-flex', alignItems: 'center', gap: 2,
            fontSize: 8, fontWeight: 'bold', padding: '0 3px', whiteSpace: 'nowrap',
            border: '1px solid', ...printChipVariantStyle(variant),
        }}>
            <i className="bi bi-printer" style={{ fontSize: 9 }} />{label}
        </span>
    );
}

// Two small "printed" indicators for a WO row: Card (Kartu Kerja) + Label (bags).
// Green = printed, gray = card not printed yet, amber = labels missing/stale.
export function PrintChips({ wo }: { wo: any }) {
    const { cardPrinted, hasBags, labelsPrinted } = computePrintState(wo);
    const { formatCustom: tzFmt } = useTimezone();
    const _printChipFmt = (v: any) =>
        v ? tzFmt(v, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }, 'id-ID') : '';
    return (
        <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
            <PrintChip variant={cardPrinted ? 'green' : 'gray'} label="Card"
                title={cardPrinted ? `Kartu Kerja printed ${_printChipFmt(wo.card_printed_at)}` : 'Kartu Kerja not printed yet'} />
            {hasBags && <PrintChip variant={labelsPrinted ? 'green' : 'amber'} label="Label"
                title={labelsPrinted ? `Bag labels printed ${_printChipFmt(wo.labels_printed_at)}` : 'Bag labels not printed (or new bags since last print)'} />}
        </span>
    );
}

interface WO {
    id: string;
    sequence: number;
    code?: string;
    name: string;
    work_center_name?: string;
    work_center_id?: string;
    work_center_type?: string;
    input_location_id?: string;
    output_location_id?: string;
    input_location?: { id: string; code: string; name: string } | null;
    output_location?: { id: string; code: string; name: string } | null;
    bom_operation_id?: string;
    staging_status?: string;
    status: string;
    planned_duration_hours?: number;
    actual_duration_hours?: number;
    qty?: number;
    qty_completed_total?: number;
    qty_rejected_total?: number;   // scrap logged on this step (MO yield analysis)
    notes?: string;
    target_start_date?: string | null;
    target_end_date?: string | null;
    created_at?: string;
}

const emptyForm = { group_id: '', work_center_id: '', bom_operation_id: '', input_location_id: '', output_location_id: '', next_destination_work_center_id: '', next_destination_location_id: '', planned_duration_hours: '', qty: '', target_start_date: '', target_end_date: '' };

interface Props {
    manufacturingOrderId: string;
    workOrders: WO[];
    workCenters: any[];
    locations?: any[];
    onAdd: (payload: any) => Promise<any>;
    onUpdate: (id: string, payload: any) => Promise<any>;
    onUpdateStatus: (id: string, status: string) => Promise<any>;
    onDelete: (id: string) => Promise<any>;
    onLogWO?: (wo: WO) => void;
    parentMO?: any;
    // Full BOM object (with work_center_id/operations) for parentMO. Pass this when
    // parentMO may be a shared/consolidated component MO — those come from the PR
    // list's slimmed ManufacturingOrderListItem schema, which omits `bom` entirely
    // (see project_pr_page_perf memory), so parentMO.bom is undefined there.
    bom?: any;
}

export default function WorkOrderPanel({
    manufacturingOrderId, workOrders, workCenters, locations,
    onAdd, onUpdate, onUpdateStatus, onDelete, onLogWO, parentMO, bom,
}: Props) {
    const { showToast } = useToast();
    const router = useRouter();
    const { operations: opMaster } = useData() as any;
    const { hasPermission, hasWorkCenterScope } = useUser();
    const canCreate = hasPermission('work_order.create');
    // Taking a beam off the loom is its own permission — the weaving leftover
    // action is that call, so it follows the same gate the monitor's Beams tab does.
    const canUnmountBeam = hasPermission('beam.unmount');
    const canLogBase = hasPermission('work_order.log');
    const canEditBase = hasPermission('work_order.edit');
    const canLog = (wo: any) => canLogBase && hasWorkCenterScope(wo.work_center_type);
    const canEdit = (wo: any) => canEditBase && hasWorkCenterScope(wo.work_center_type);
    // Scan-to-stage is for the steps whose input arrives as printed, individually
    // numbered units the operator scans in rather than picking by hand: greige bags
    // into dyeing, dyed lots into setting, warp beams (and weft lots) into weaving.
    // The modal branches per material — a bag stages in kg, a beam mounts on the
    // machine in whole pieces. See SCAN_STAGE_WC_TYPES.
    const canScanStage = (wo: any) =>
        woScanStages(wo) && wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED';
    // Weaving "staging" is really mounting a warp beam on the loom — a machine-level
    // action shared by every WO on that loom, so it gets its own wording.
    const isWeaving = (wo: any) => ['WEAVING', 'TENUN'].includes((wo.work_center_type || '').toUpperCase());
    const [addingRow, setAddingRow] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [form, setForm] = useState({ ...emptyForm });
    const [isSaving, setIsSaving] = useState(false);
    const [printWO, setPrintWO] = useState<WO | null>(null);
    const [stageWO, setStageWO] = useState<WO | null>(null);
    const [scanStageWO, setScanStageWO] = useState<WO | null>(null);
    const [leftoverWO, setLeftoverWO] = useState<WO | null>(null);
    const [overAssignWarning, setOverAssignWarning] = useState<{ totalAssigned: number; moQty: number } | null>(null);
    const [beamPlanOpen, setBeamPlanOpen] = useState(false);
    // Floating "more actions" menu — Print / Edit / Delete
    const { openId: openMenuId, pos: menuPos, toggle: toggleMenu, close: closeMenu } = useFloatingMenu();
    // Floating status menu — click the status badge to change lifecycle status
    const { openId: openStatusMenuId, pos: statusMenuPos, toggle: toggleStatusMenu, close: closeStatusMenu } = useFloatingMenu();

    // parentMO.bom is missing when parentMO is a shared/consolidated component MO
    // sourced from the PR list's slimmed ManufacturingOrderListItem schema (bom
    // omitted there — see project_pr_page_perf memory). Fall back to the `bom` prop
    // (looked up by bom_id from the global boms list) in that case.
    const effectiveBom = bom || parentMO?.bom;

    // Work center group assigned to this MO's BOM
    const bomWcGroup = useMemo(() => {
        const wcId = effectiveBom?.work_center_id;
        if (!wcId) return null;
        return workCenters.find((wc: any) => String(wc.id) === String(wcId)) ?? null;
    }, [effectiveBom, workCenters]);

    // BEAMING machines under the BOM's WC group, when that group is BEAMING type.
    // Walks the whole subtree — a machine can sit one level deeper, behind a GROUP.
    const beamingMachines = useMemo(() => {
        if (!bomWcGroup || (bomWcGroup.center_type || '').toUpperCase() !== 'BEAMING') return [];
        return machinesUnderWC(workCenters, bomWcGroup.id).sort(byName);
    }, [workCenters, bomWcGroup]);

    const locationList = locations || [];
    // Locations are a 3-level warehouse > zone > bin tree; a flat <select> of every
    // leaf code is unreadable past a handful of bins. Same picker every other
    // location field uses (staging, packing, routing, PO receipt).
    const locPickerTreeOptions = useMemo(() => buildLocationPickerTree(locationList), [locationList]);

    // Group locked by BOM's work_center_id (null = not locked, show standard group+machine selects)
    const lockedGroupId: string | null = effectiveBom?.work_center_id
        ? String(effectiveBom.work_center_id)
        : null;

    // Routing steps defined on this MO's BOM. A WO must declare which step it runs
    // (L2) so staging/consumption only touch that step's materials.
    const bomOperations = useMemo(() => {
        const ops = effectiveBom?.operations || [];
        return [...ops].sort((a: any, b: any) => (a.sequence ?? 0) - (b.sequence ?? 0));
    }, [effectiveBom]);
    const stepLabel = (op: any) => {
        const name = op.operation_name
            || (opMaster || []).find((o: any) => String(o.id) === String(op.operation_id))?.name
            || op.work_center_type || 'Step';
        return `${op.sequence != null ? op.sequence + '. ' : ''}${name}`;
    };

    // Selectable containers: the TYPE roots plus any GROUP under them, so a WO can be
    // narrowed to a loom bank and not just "WEAVING". Sorted per-tier (types A-Z, each
    // type's groups A-Z under it) so the ↳ indent still reads as a hierarchy.
    const availableGroups = useMemo(() => {
        const containers = workCenters.filter((wc: any) => isContainerWC(wc));
        const types = containers.filter((wc: any) => isTypeWC(wc)).sort(byName);
        const out: any[] = [];
        for (const t of types) {
            out.push(t);
            out.push(...containers.filter((c: any) => String(c.parent_id || '') === String(t.id)).sort(byName));
        }
        // Groups whose type is missing from the list would otherwise vanish.
        const placed = new Set(out.map((wc: any) => String(wc.id)));
        out.push(...containers.filter((wc: any) => !placed.has(String(wc.id))).sort(byName));
        return out;
    }, [workCenters]);

    const availableMachines = useMemo(() => {
        const gid = lockedGroupId || form.group_id;
        if (!gid) return [];
        return machinesUnderWC(workCenters, gid).sort(byName);
    }, [workCenters, lockedGroupId, form.group_id]);

    // Every machine in the plant — the "next destination" picker isn't scoped to a group.
    const allMachines = useMemo(() =>
        workCenters.filter((wc: any) => isMachineWC(wc)).sort(byName),
        [workCenters]
    );

    const machineOptions = (list: any[]) =>
        list.map((wc: any) => ({ value: String(wc.id), label: wc.name, subLabel: wc.code || undefined }));

    const resetForm = () => {
        setForm({ ...emptyForm });
        setAddingRow(false);
        setEditId(null);
    };

    const handleGroupChange = (groupId: string) => {
        // No machine yet, but the group itself may carry the locations its machines
        // inherit — show those instead of blanks.
        const grp = workCenters.find((w: any) => w.id === groupId);
        setForm(f => ({
            ...f,
            group_id: groupId,
            work_center_id: '',
            input_location_id: grp?.effective_input_location_id || '',
            output_location_id: grp?.effective_output_location_id || '',
        }));
    };

    const handleWCChange = (wcId: string) => {
        const wc = workCenters.find((w: any) => w.id === wcId);
        // effective_* is the machine's own location or the one it inherits from its
        // group/type — machines only carry their own when they override the group.
        setForm(f => ({
            ...f,
            work_center_id: wcId,
            input_location_id: wc?.effective_input_location_id || wc?.input_location_id || '',
            output_location_id: wc?.effective_output_location_id || wc?.output_location_id || '',
        }));
    };

    // A WO with no work center is invisible to every center-type tab (Dyeing /
    // Weaving / Beaming all filter on WorkCenter.center_type) and skips the DYEING
    // recipe gate. So when no machine is picked, fall back to the group — it's a
    // real WorkCenter row carrying the same center_type.
    const effectiveWorkCenterId = () => form.work_center_id || lockedGroupId || form.group_id || '';

    const handleAdd = async () => {
        const wcId = effectiveWorkCenterId();
        if (!wcId) {
            showToast('Select the work center (group or machine) this work order runs on.', 'danger');
            return;
        }
        const selectedWC = workCenters.find((w: any) => String(w.id) === String(wcId));
        const isWeaving = (selectedWC?.center_type || '').toUpperCase() === 'WEAVING';
        if (bomOperations.length > 0 && !form.bom_operation_id && !isWeaving) {
            showToast('Select the routing step this work order runs.', 'danger');
            return;
        }
        setIsSaving(true);
        try {
            const res = await onAdd({
                manufacturing_order_id: manufacturingOrderId,
                work_center_id: wcId,
                bom_operation_id: form.bom_operation_id || undefined,
                input_location_id: form.input_location_id || undefined,
                output_location_id: form.output_location_id || undefined,
                next_destination_work_center_id: form.next_destination_work_center_id || undefined,
                next_destination_location_id: form.next_destination_location_id || undefined,
                planned_duration_hours: form.planned_duration_hours ? parseFloat(form.planned_duration_hours) : undefined,
                qty: form.qty ? parseFloat(form.qty) : undefined,
                target_start_date: form.target_start_date || null,
                target_end_date: form.target_end_date || null,
            });
            if (res && !res.ok) {
                try {
                    const err = await res.json();
                    showToast(err.detail || 'Failed to create work order', 'danger');
                } catch {
                    showToast('Failed to create work order', 'danger');
                }
                return;
            }
            const result = res && res.ok ? await res.json().catch(() => null) : res;
            if (result?.warning === 'total_assigned_exceeds_mo_qty') {
                setOverAssignWarning({ totalAssigned: result.total_assigned, moQty: result.mo_qty });
            } else {
                setOverAssignWarning(null);
            }
            resetForm();
        } finally {
            setIsSaving(false);
        }
    };

    const handleUpdate = async (wo: WO) => {
        const wcId = effectiveWorkCenterId();
        if (!wcId) {
            showToast('Select the work center (group or machine) this work order runs on.', 'danger');
            return;
        }
        setIsSaving(true);
        try {
            const result = await onUpdate(wo.id, {
                manufacturing_order_id: manufacturingOrderId,
                sequence: wo.sequence,
                name: wo.name,
                work_center_id: wcId,
                bom_operation_id: form.bom_operation_id || undefined,
                input_location_id: form.input_location_id || undefined,
                output_location_id: form.output_location_id || undefined,
                next_destination_work_center_id: form.next_destination_work_center_id || undefined,
                next_destination_location_id: form.next_destination_location_id || undefined,
                planned_duration_hours: form.planned_duration_hours ? parseFloat(form.planned_duration_hours) : undefined,
                qty: form.qty ? parseFloat(form.qty) : undefined,
                target_start_date: form.target_start_date || null,
                target_end_date: form.target_end_date || null,
            });
            if (result?.warning === 'total_assigned_exceeds_mo_qty') {
                setOverAssignWarning({ totalAssigned: result.total_assigned, moQty: result.mo_qty });
            } else {
                setOverAssignWarning(null);
            }
            resetForm();
        } finally {
            setIsSaving(false);
        }
    };

    const startEdit = (wo: WO) => {
        setEditId(wo.id);
        setAddingRow(false);
        const machine = workCenters.find((w: any) => String(w.id) === String(wo.work_center_id));
        setForm({
            group_id: machine?.parent_id ? String(machine.parent_id) : '',
            work_center_id: wo.work_center_id || '',
            bom_operation_id: wo.bom_operation_id || '',
            input_location_id: wo.input_location_id || '',
            output_location_id: wo.output_location_id || '',
            next_destination_work_center_id: (wo as any).next_destination_work_center_id || '',
            next_destination_location_id: (wo as any).next_destination_location_id || '',
            planned_duration_hours: wo.planned_duration_hours != null ? String(wo.planned_duration_hours) : '',
            qty: wo.qty != null ? String(wo.qty) : '',
            target_start_date: wo.target_start_date ? wo.target_start_date.slice(0, 10) : '',
            target_end_date: wo.target_end_date ? wo.target_end_date.slice(0, 10) : '',
        });
    };

    const handleStatusChange = (wo: WO, s: string) => {
        if (s === 'COMPLETED' && wo.qty && (wo.qty_completed_total ?? 0) < wo.qty) {
            showToast(`Note: ${(wo.qty_completed_total ?? 0).toFixed(2)} of ${wo.qty} logged — marking complete anyway.`, 'warning');
        }
        onUpdateStatus(wo.id, s);
    };

    const sorted = [...workOrders].sort((a, b) =>
        new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    );

    // Shared column widths for the table header + every data row so cells line up.
    // Work Center is capped (not an unbounded 1fr) so it can't soak up all the
    // leftover width on wide screens and crowd the Actions buttons to the edge.
    // Actions is icon-only (Stage/Leftover/Log + a [...] menu for Print/Edit/Delete),
    // so it only needs room for those small squares, not full-word buttons.
    const COLS = '124px 64px 74px minmax(110px,200px) minmax(140px,1fr) 120px 40px 116px 108px';

    return (
        <div style={{ fontFamily: xpFont, fontSize: 11, background: '#fff' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: parentMO ? 4 : 8 }}>
                <span style={{ fontWeight: 'bold', fontSize: 11, color: '#000080' }}>
                    Work Orders
                </span>
                {canCreate && !addingRow && !editId && (
                    <div style={{ display: 'flex', gap: 4 }}>
                        <button
                            className={XP_BTN}
                            onClick={() => { setAddingRow(true); setEditId(null); }}
                            style={xpBtn()}
                        >
                            + Add Work Order
                        </button>
                        {beamingMachines.length > 0 && (
                            <button
                                className={XP_BTN}
                                onClick={() => setBeamPlanOpen(true)}
                                style={xpBtn(BTN_TONES.primary)}
                            >
                                Plan Beaming
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* MO context badge */}
            {parentMO && (
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: '#e8eaf6', border: '1px solid #9fa8da',
                    padding: '1px 7px', marginBottom: 8, fontSize: 10, color: '#1a237e',
                }}>
                    <span style={{ fontFamily: CODE_FONT, fontWeight: 'bold' }}>{parentMO.code}</span>
                    {parentMO.item_name && (
                        <span style={{ color: '#3949ab' }}>{parentMO.item_name}</span>
                    )}
                    {parentMO.qty != null && (
                        <span style={{ color: '#5c6bc0' }}>· {parentMO.qty}</span>
                    )}
                </div>
            )}

            {overAssignWarning && (
                <div style={{
                    background: '#fff8e1', border: '1px solid #f0c040',
                    padding: '3px 8px', marginBottom: 6, fontSize: 10, color: '#7a5500',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                    <span>
                        Total assigned ({overAssignWarning.totalAssigned.toFixed(1)}) exceeds MO qty ({overAssignWarning.moQty.toFixed(1)})
                    </span>
                    <button
                        onClick={() => setOverAssignWarning(null)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#7a5500', padding: '0 2px' }}
                    >
                        x
                    </button>
                </div>
            )}

            {/* Pipeline */}
            <div style={{ border: '1px solid #d4d0c8' }}>
                {sorted.length === 0 && !addingRow && (
                    <div style={{ color: '#888', fontStyle: 'italic', fontSize: 11, padding: '6px 8px' }}>
                        No work orders yet. Click + Add Work Order.
                    </div>
                )}

                {sorted.length > 0 && (
                    <div style={{
                        display: 'grid', gridTemplateColumns: COLS, gap: 10, alignItems: 'center',
                        padding: '4px 8px', background: '#eef0f3', borderBottom: '1px solid #d4d0c8',
                        fontSize: 9, fontWeight: 'bold', color: '#555', textTransform: 'uppercase', letterSpacing: '0.03em',
                    }}>
                        <span>WO Code</span>
                        <span>Print</span>
                        <span>Type</span>
                        <span>Work Center</span>
                        <span>Route</span>
                        <span>Progress</span>
                        <span>Hrs</span>
                        <span>Status</span>
                        <span>Actions</span>
                    </div>
                )}

                {sorted.map((wo, idx) => {
                    const pct = wo.qty ? Math.min(100, ((wo.qty_completed_total ?? 0) / wo.qty) * 100) : 0;
                    const done = wo.qty != null && (wo.qty_completed_total ?? 0) >= wo.qty;
                    const chipStyle = getChipStyle(wo.work_center_type);
                    const isEditing = editId === wo.id;

                    return (
                        <div key={wo.id} style={{ marginBottom: isEditing ? 5 : 0 }}>

                            {isEditing ? (
                                /* ── Edit row ── */
                                <div style={{
                                    border: '1px solid #7f9db9', background: '#fffbe6',
                                    padding: '5px 8px',
                                    borderLeft: `3px solid ${STATUS_BORDER[wo.status] || '#aaa'}`,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                                        <CodeChip
                                            code={wo.code || `Step ${wo.sequence}`}
                                            tier={2}
                                            style={{ minWidth: 90 }}
                                        />
                                        {bomOperations.length > 0 && (
                                            <select
                                                style={{ ...xpInput, minWidth: 130 }}
                                                value={form.bom_operation_id}
                                                onChange={e => setForm(f => ({ ...f, bom_operation_id: e.target.value }))}
                                                title="Routing step this work order runs"
                                            >
                                                <option value="">— Step —</option>
                                                {bomOperations.map((op: any) => (
                                                    <option key={op.id} value={op.id}>{stepLabel(op)}</option>
                                                ))}
                                            </select>
                                        )}
                                        {lockedGroupId && (
                                            <span style={{ borderRadius: CHIP_RADIUS,
                                                fontFamily: xpFont, fontSize: 10, padding: '0 7px', height: 20,
                                                display: 'inline-flex', alignItems: 'center',
                                                background: '#dce8ff', border: '1px solid #7f9db9', color: '#002080',
                                                fontWeight: 'bold',
                                            }}>
                                                {workCenters.find((wc: any) => String(wc.id) === lockedGroupId)?.name || 'Group'}
                                            </span>
                                        )}
                                        {!lockedGroupId && (
                                            <select
                                                style={{ ...xpInput, minWidth: 120 }}
                                                value={form.group_id}
                                                onChange={e => handleGroupChange(e.target.value)}
                                                autoFocus
                                            >
                                                <option value="">— Group —</option>
                                                {availableGroups.map((wc: any) => (
                                                    <option key={wc.id} value={wc.id}>{isTypeWC(wc) ? wc.name : `↳ ${wc.name}`}</option>
                                                ))}
                                            </select>
                                        )}
                                        <div style={{ width: 170 }}>
                                            <SearchableSelect
                                                options={machineOptions(availableMachines)}
                                                value={form.work_center_id}
                                                onChange={handleWCChange}
                                                placeholder="— Machine —"
                                                disabled={!lockedGroupId && !form.group_id}
                                            />
                                        </div>
                                        <input
                                            type="number" min="0" step="0.5"
                                            style={{ ...xpInput, width: 52 }}
                                            value={form.planned_duration_hours}
                                            onChange={e => setForm(f => ({ ...f, planned_duration_hours: e.target.value }))}
                                            placeholder="Hrs"
                                        />
                                        <input
                                            type="number" min="0" step="any"
                                            style={{ ...xpInput, width: 64 }}
                                            value={form.qty}
                                            onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                                            placeholder="Target qty"
                                        />
                                        <input
                                            type="date"
                                            style={{ ...xpInput, width: 110 }}
                                            value={form.target_start_date}
                                            onChange={e => setForm(f => ({ ...f, target_start_date: e.target.value }))}
                                            title="Target start date"
                                        />
                                        <input
                                            type="date"
                                            style={{ ...xpInput, width: 110 }}
                                            value={form.target_end_date}
                                            onChange={e => setForm(f => ({ ...f, target_end_date: e.target.value }))}
                                            title="Target end date"
                                        />
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                                            <button
                                                className={XP_BTN}
                                                onClick={resetForm}
                                                style={xpBtn()}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                className={XP_BTN}
                                                onClick={() => handleUpdate(wo)}
                                                disabled={isSaving}
                                                style={xpBtn(BTN_TONES.success)}
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                    {locationList.length > 0 && (
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 96 }}>
                                            <div style={{ width: 150 }} title="Input location — where this step's materials are drawn from">
                                                <TreeSelect
                                                    options={locPickerTreeOptions}
                                                    value={form.input_location_id}
                                                    onChange={id => setForm(f => ({ ...f, input_location_id: id }))}
                                                    allowEmpty emptyLabel="In: —"
                                                    size="sm" style={{ width: '100%' }}
                                                />
                                            </div>
                                            <div style={{ width: 150 }} title="Output location — where this step's output is put away">
                                                <TreeSelect
                                                    options={locPickerTreeOptions}
                                                    value={form.output_location_id}
                                                    onChange={id => setForm(f => ({ ...f, output_location_id: id }))}
                                                    allowEmpty emptyLabel="Out: —"
                                                    size="sm" style={{ width: '100%' }}
                                                />
                                            </div>
                                            <span style={{ fontSize: 9, color: '#444', fontWeight: 'bold', alignSelf: 'center' }}>Tujuan:</span>
                                            <div style={{ width: 160 }}>
                                                <SearchableSelect
                                                    options={machineOptions(allMachines)}
                                                    value={form.next_destination_work_center_id}
                                                    onChange={v => setForm(f => ({ ...f, next_destination_work_center_id: v }))}
                                                    placeholder="— Mesin —"
                                                    size="sm"
                                                />
                                            </div>
                                            <div style={{ width: 150 }} title="Next destination location">
                                                <TreeSelect
                                                    options={locPickerTreeOptions}
                                                    value={form.next_destination_location_id}
                                                    onChange={id => setForm(f => ({ ...f, next_destination_location_id: id }))}
                                                    allowEmpty emptyLabel="— Lokasi —"
                                                    size="sm" style={{ width: '100%' }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                /* ── Display row (table row) ── */
                                <div style={{
                                    display: 'grid', gridTemplateColumns: COLS, gap: 10, alignItems: 'center',
                                    padding: '6px 8px',
                                    background: idx % 2 === 0 ? '#fff' : '#fafaf8',
                                    borderBottom: '1px solid #e8e6e0',
                                }}>
                                    {/* WO Code — small status dot instead of a side-tab bar */}
                                    <span
                                        style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, cursor: 'pointer' }}
                                        title={wo.code || `Step ${wo.sequence}`}
                                        onClick={() => router.push(`/work-orders?wo=${wo.id}`)}
                                    >
                                        <span style={{
                                            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                                            background: STATUS_BORDER[wo.status] || '#c8c6be',
                                        }} />
                                        <CodeChip
                                            code={wo.code || `Step ${wo.sequence}`}
                                            link
                                            style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
                                        />
                                    </span>

                                    {/* Print status chips (Card / Label) */}
                                    <PrintChips wo={wo} />

                                    {/* Work center type chip */}
                                    {wo.work_center_type ? (
                                        <span style={{ borderRadius: CHIP_RADIUS,
                                            padding: '0 5px', fontSize: 9, fontWeight: 'bold',
                                            border: `1px solid ${chipStyle.borderColor}`,
                                            background: chipStyle.background,
                                            color: chipStyle.color,
                                            whiteSpace: 'nowrap', justifySelf: 'start',
                                        }}>
                                            {wo.work_center_type.toUpperCase()}
                                        </span>
                                    ) : <span />}

                                    {/* Work center name */}
                                    <span style={{ fontSize: 11, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {wo.work_center_name || <span style={{ color: '#aaa' }}>— no work center —</span>}
                                    </span>

                                    {/* Location flow chips */}
                                    {(wo.input_location || wo.output_location) ? (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, whiteSpace: 'nowrap', minWidth: 0 }}>
                                            <LocationChip direction="in" code={wo.input_location?.code}
                                                title={wo.input_location?.name || 'Input location'} />
                                            <span style={{ color: '#888' }}>&#8594;</span>
                                            <LocationChip direction="out" code={wo.output_location?.code}
                                                title={wo.output_location?.name || 'Output location'} />
                                        </span>
                                    ) : <span style={{ color: '#ccc', fontSize: 9 }}>—</span>}

                                    {/* Progress bar */}
                                    {wo.qty != null ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <ProgressBar pct={pct} tone={done ? 'amber' : 'blue'} hatched width={60} height={10} />
                                            <span style={{ fontSize: 9, color: done ? '#b87000' : '#555', whiteSpace: 'nowrap' }}>
                                                {(wo.qty_completed_total ?? 0).toFixed(1)}/{wo.qty}
                                            </span>
                                            {(wo.qty_rejected_total ?? 0) > 0 && (() => {
                                                // Step-level scrap: this WO's share of the MO's yield loss.
                                                const rej = wo.qty_rejected_total ?? 0;
                                                const prod = (wo.qty_completed_total ?? 0) + rej;
                                                return (
                                                    <span
                                                        title={`${rej.toFixed(2)} rejected on this step of ${prod.toFixed(2)} produced — yield ${((wo.qty_completed_total ?? 0) / prod * 100).toFixed(1)}%`}
                                                        style={{ fontSize: 9, fontWeight: 700, color: '#a01010', whiteSpace: 'nowrap' }}
                                                    >
                                                        rej {rej.toFixed(1)}
                                                    </span>
                                                );
                                            })()}
                                        </div>
                                    ) : (
                                        <span style={{ fontSize: 9, color: '#ccc' }}>—</span>
                                    )}

                                    {/* Planned hours */}
                                    <span style={{ fontSize: 9, color: '#666', textAlign: 'right' }}>
                                        {wo.planned_duration_hours != null ? `${wo.planned_duration_hours}h` : '—'}
                                    </span>

                                    {/* Status badge — click to change; staging shown as an icon alongside (matches Work Orders list) */}
                                    {(() => {
                                        const hasStaging = woHasStaging(wo);
                                        const stagingLabel = wo.staging_status === 'STAGED' ? 'Staged — materials issued'
                                            : wo.staging_status === 'PARTIAL' ? 'Partially staged' : 'Not staged';
                                        const stagingColor = wo.staging_status === 'STAGED' ? '#0058e6' : wo.staging_status === 'PARTIAL' ? '#b8860b' : '#999';
                                        return (
                                            <div
                                                className={canLog(wo) ? 'xp-menu-trigger' : undefined}
                                                onClick={canLog(wo) ? (e) => toggleStatusMenu(wo.id, e) : undefined}
                                                style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: canLog(wo) ? 'pointer' : 'default', justifySelf: 'start' }}
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

                                    {/* Actions — icon-only inline buttons + a [...] menu for Print/Edit/Delete */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'nowrap', justifyContent: 'flex-end', justifySelf: 'end' }}>
                                        {canEdit(wo) && woHasStaging(wo) && wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED' && (
                                            <XPActionButton
                                                tone="primary"
                                                icon={isWeaving(wo) ? 'bi-arrow-bar-up' : 'bi-box-seam'}
                                                title={isWeaving(wo)
                                                    ? 'Mount beam — gait warp onto this machine (shared by every WO on the loom)'
                                                    : "Stage — issue this step's materials to the line"}
                                                onClick={() => (canScanStage(wo) ? setScanStageWO(wo) : setStageWO(wo))}
                                            />
                                        )}
                                        {/* Leftover warp comes off a BEAM MOUNT, not off this WO — the
                                            warp belongs to the loom — so this is the machine's unmount
                                            call, reachable from the WO the weaver already has open.
                                            Gated on beam.unmount for that reason, not on work_order.edit. */}
                                        {canUnmountBeam && isWeaving(wo) && (wo.status === 'IN_PROGRESS' || wo.status === 'COMPLETED') && (
                                            <XPActionButton
                                                tone="warning"
                                                icon="bi-recycle"
                                                title="Strip leftover warp: weigh it into its own lot and take the beam off the loom"
                                                onClick={() => setLeftoverWO(wo)}
                                            />
                                        )}
                                        {canLog(wo) && onLogWO && wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED' && (
                                            <XPActionButton
                                                tone="success"
                                                icon="bi-plus-lg"
                                                title="Log production output"
                                                onClick={() => onLogWO(wo)}
                                            />
                                        )}
                                        <MenuTriggerButton onClick={(e) => toggleMenu(wo.id, e)} />
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Add step form */}
                {addingRow && (
                    <div style={{ marginBottom: 4 }}>
                        <div style={{
                            border: '1px dashed #7f9db9', background: '#fffbe6',
                            padding: '6px 8px',
                        }}>
                            <div style={{ fontSize: 9, color: '#888', marginBottom: 4 }}>
                                New work order — code assigned on save
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                                {/* Routing step — required when the BOM defines operations */}
                                {bomOperations.length > 0 && (
                                    <select
                                        style={{ ...xpInput, minWidth: 130 }}
                                        value={form.bom_operation_id}
                                        onChange={e => setForm(f => ({ ...f, bom_operation_id: e.target.value }))}
                                        title="Routing step this work order runs"
                                    >
                                        <option value="">— Step —</option>
                                        {bomOperations.map((op: any) => (
                                            <option key={op.id} value={op.id}>{stepLabel(op)}</option>
                                        ))}
                                    </select>
                                )}
                                {/* Group locked badge — BOM defines work_center_id */}
                                {lockedGroupId && (
                                    <span style={{ borderRadius: CHIP_RADIUS,
                                        fontFamily: xpFont, fontSize: 10, padding: '0 7px', height: 20,
                                        display: 'inline-flex', alignItems: 'center',
                                        background: '#dce8ff', border: '1px solid #7f9db9', color: '#002080',
                                        fontWeight: 'bold',
                                    }}>
                                        {workCenters.find((wc: any) => String(wc.id) === lockedGroupId)?.name || 'Group'}
                                    </span>
                                )}

                                {/* Standard group select — only when BOM has no work_center_id */}
                                {!lockedGroupId && (
                                    <select
                                        style={{ ...xpInput, minWidth: 120 }}
                                        value={form.group_id}
                                        onChange={e => handleGroupChange(e.target.value)}
                                        autoFocus
                                    >
                                        <option value="">— Group —</option>
                                        {availableGroups.map((wc: any) => (
                                            <option key={wc.id} value={wc.id}>{isTypeWC(wc) ? wc.name : `↳ ${wc.name}`}</option>
                                        ))}
                                    </select>
                                )}

                                {/* Machine select — searchable: a loom bank runs to 100+ machines */}
                                <div style={{ width: 190 }}>
                                    <SearchableSelect
                                        options={machineOptions(availableMachines)}
                                        value={form.work_center_id}
                                        onChange={handleWCChange}
                                        placeholder="— Machine —"
                                        disabled={!lockedGroupId && !form.group_id}
                                    />
                                </div>

                                <label style={{ fontSize: 10, color: '#555', whiteSpace: 'nowrap' }}>
                                    Planned hrs:
                                    <input
                                        type="number" min="0" step="0.5"
                                        style={{ ...xpInput, width: 48, marginLeft: 4 }}
                                        value={form.planned_duration_hours}
                                        onChange={e => setForm(f => ({ ...f, planned_duration_hours: e.target.value }))}
                                        placeholder="0"
                                    />
                                </label>
                                <label style={{ fontSize: 10, color: '#555', whiteSpace: 'nowrap' }}>
                                    Target qty:
                                    <input
                                        type="number" min="0" step="any"
                                        style={{ ...xpInput, width: 60, marginLeft: 4 }}
                                        value={form.qty}
                                        onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                                        placeholder="0"
                                    />
                                </label>
                                <label style={{ fontSize: 10, color: '#555', whiteSpace: 'nowrap' }}>
                                    Start:
                                    <input
                                        type="date"
                                        style={{ ...xpInput, width: 110, marginLeft: 4 }}
                                        value={form.target_start_date}
                                        onChange={e => setForm(f => ({ ...f, target_start_date: e.target.value }))}
                                    />
                                </label>
                                <label style={{ fontSize: 10, color: '#555', whiteSpace: 'nowrap' }}>
                                    End:
                                    <input
                                        type="date"
                                        style={{ ...xpInput, width: 110, marginLeft: 4 }}
                                        value={form.target_end_date}
                                        onChange={e => setForm(f => ({ ...f, target_end_date: e.target.value }))}
                                    />
                                </label>
                                {/* Actions sit right-aligned at the end of the field row (matches
                                    every other form footer: muted Cancel, solid submit, rightmost). */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                                    <button
                                        className={XP_BTN}
                                        onClick={resetForm}
                                        style={xpBtn()}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className={XP_BTN}
                                        onClick={handleAdd}
                                        disabled={isSaving}
                                        style={xpBtn(BTN_TONES.success)}
                                    >
                                        {isSaving ? '...' : 'Add'}
                                    </button>
                                </div>
                            </div>
                            {(form.input_location_id || form.output_location_id) && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#555', paddingLeft: 4 }}>
                                    <LocationChip direction="in"
                                        code={locationList.find((l: any) => l.id === form.input_location_id)?.code} />
                                    <span>&#8594;</span>
                                    <LocationChip direction="out"
                                        code={locationList.find((l: any) => l.id === form.output_location_id)?.code} />
                                    <span style={{ color: '#aaa' }}>(from work center)</span>
                                </div>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#555', paddingLeft: 4, marginTop: 2 }}>
                                <span style={{ color: '#444', fontWeight: 'bold', whiteSpace: 'nowrap' }}>Tujuan Berikutnya:</span>
                                <div style={{ width: 160 }} title="Next work center this WO's output goes to">
                                    <SearchableSelect
                                        options={machineOptions(allMachines)}
                                        value={form.next_destination_work_center_id}
                                        onChange={v => setForm(f => ({ ...f, next_destination_work_center_id: v }))}
                                        placeholder="— Mesin —"
                                        size="sm"
                                    />
                                </div>
                                <div style={{ width: 160 }} title="Next destination location">
                                    <TreeSelect
                                        options={locPickerTreeOptions}
                                        value={form.next_destination_location_id}
                                        onChange={id => setForm(f => ({ ...f, next_destination_location_id: id }))}
                                        allowEmpty emptyLabel="— Lokasi —"
                                        size="sm" style={{ width: '100%' }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Floating "more actions" menu — Print / Edit / Delete */}
            {openMenuId && (() => {
                const menuWO = sorted.find(w => w.id === openMenuId);
                if (!menuWO) return null;
                return (
                    <FloatingMenu
                        pos={menuPos}
                        items={[
                            {
                                key: 'print', icon: 'bi-printer', label: 'Print',
                                hidden: !parentMO,
                                onClick: () => { closeMenu(); setPrintWO(menuWO); },
                            },
                            {
                                key: 'edit', icon: 'bi-pencil', label: 'Edit',
                                hidden: !canEdit(menuWO),
                                onClick: () => { closeMenu(); startEdit(menuWO); },
                            },
                            {
                                key: 'delete', icon: 'bi-trash', label: 'Delete', danger: true,
                                hidden: !canEdit(menuWO),
                                onClick: () => { closeMenu(); onDelete(menuWO.id); },
                            },
                        ]}
                    />
                );
            })()}

            {/* Floating status menu — change a WO's lifecycle status */}
            {openStatusMenuId && (() => {
                const menuWO = sorted.find(w => w.id === openStatusMenuId);
                if (!menuWO) return null;
                return (
                    <FloatingMenu
                        pos={statusMenuPos}
                        items={['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(s => ({
                            key: `status-${s}`,
                            icon: s === menuWO.status ? 'bi-check2' : undefined,
                            label: s.replace('_', ' '),
                            onClick: () => { closeStatusMenu(); handleStatusChange(menuWO, s); },
                        }))}
                    />
                );
            })()}

            {printWO && parentMO && (
                <WOBulkPrintModal
                    selectedWOs={[{ ...printWO, mo_id: (printWO as any).mo_id ?? parentMO.id }]}
                    manufacturingOrders={[parentMO]}
                    onClose={() => setPrintWO(null)}
                />
            )}

            {stageWO && (
                <WOStagingModal
                    wo={stageWO}
                    onClose={() => setStageWO(null)}
                    onStaged={() => { /* WO list refreshes via the WORK_ORDER_UPDATE broadcast */ }}
                    onScanMode={canScanStage(stageWO) ? () => { const w = stageWO; setStageWO(null); setScanStageWO(w); } : undefined}
                />
            )}

            {scanStageWO && (
                <BagScanStageModal
                    wo={scanStageWO}
                    onClose={() => setScanStageWO(null)}
                    onStaged={() => { /* WO list refreshes via the WORK_ORDER_UPDATE broadcast */ }}
                    onManualMode={() => { const w = scanStageWO; setScanStageWO(null); setStageWO(w); }}
                />
            )}

            {leftoverWO && (
                <LeftoverBeamModal
                    wo={leftoverWO}
                    onClose={() => setLeftoverWO(null)}
                />
            )}

            {beamPlanOpen && parentMO && (
                <BeamPlanningModal
                    mo={{
                        id: parentMO.id,
                        code: parentMO.code,
                        qty: parentMO.qty,
                        item_name: parentMO.item_name,
                        uom: parentMO.uom,
                        ends: parentMO.item_ends ?? parentMO.bom?.qty,
                    }}
                    machines={beamingMachines.map((wc: any) => ({ id: wc.id, name: wc.name, code: wc.code }))}
                    groupId={bomWcGroup?.id ? String(bomWcGroup.id) : undefined}
                    groupName={bomWcGroup?.name}
                    components={(parentMO.bom?.lines || []).map((l: any) => ({
                        name: l.item_name || l.item_code || '—',
                        code: l.item_code,
                        ends: l.qty != null ? Number(l.qty) : null,
                    }))}
                    locations={locationList.map((l: any) => ({ id: l.id, code: l.code, name: l.name }))}
                    nextWorkCenters={allMachines.map((wc: any) => ({ id: wc.id, name: wc.name }))}
                    onClose={() => setBeamPlanOpen(false)}
                />
            )}
        </div>
    );
}
