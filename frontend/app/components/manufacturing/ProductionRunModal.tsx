'use client';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import ModalWrapper from '../shared/ModalWrapper';
import SearchableSelect from '@bryanadamg/terras-ui/components/Combobox';
import { useData } from '../../context/DataContext';
import NettingPlanTable, { useNettingPreview } from './NettingPlanTable';
import { xpFont, xpInput as _xpInput, xpLabel as _xpLabel, ModalFooterActions, CHIP_RADIUS, BUTTON_RADIUS, XP_BTN } from '../shared/xpTheme';
import {
    QtyFormulaRule,
    DEFAULT_QTY_FORMULA,
    applyQtyFormula,
    applyQtyFormulaTotal,
    formulaSummary,
} from '../shared/qtyFormula';
import QtyFormulaModal from '../shared/QtyFormulaModal';
import { useUser } from '../../context/UserContext';
import { API_BASE } from '../shared/apiBase';


const fi = (extra: React.CSSProperties = {}): React.CSSProperties =>
    _xpInput({ width: '100%', height: '22px', borderRadius: 0, boxSizing: 'border-box', padding: '0 4px', ...extra });
const xpInput = fi;
const xpLabel = (extra: React.CSSProperties = {}): React.CSSProperties => _xpLabel(extra);

interface BomEntryState {
    bomId: string;
    // Set when the entry arrives from a Sales Order that deliberately left the
    // recipe open: it scopes the BOM picker to that item's own recipes.
    itemId?: string;
    sizeQtys: Record<string, string>;
    // Ordered sizes as folded size NAMES, carried until a BOM is chosen — a
    // BOMSize id belongs to one BOM, so it cannot exist before the pick.
    sizeTokens?: Record<string, number>;
    totalQty: string;
    attributeValueIds: string[];
    colorId?: string;
    colorLabel?: string;
    labdipVariantCode?: string;
    locked?: boolean;
    rawSoQtys?: Record<string, number>;
    rawTotalQty?: number;
    forceCreate?: boolean;
}

interface Props {
    boms: any[];
    items: any[];
    attributes: any[];
    locations: any[];
    onSave: (payload: any) => Promise<any>;
    onClose: () => void;
    initialBomId?: string;
    initialSizes?: Record<string, string>;
    initialTotalQty?: string;
    initialBomEntries?: Array<{
        bomId: string;
        itemId?: string;
        sizeQtys: Record<string, string>;
        sizeTokens?: Record<string, number>;
        totalQty: string;
        attributeValueIds?: string[];
        colorId?: string;
        colorLabel?: string;
        labdipVariantCode?: string;
        locked?: boolean;
    }>;
    salesOrderId?: string;
    salesOrderCode?: string;
    productionRuns?: any[];
}

function hasStandardSizes(bom: any): boolean {
    return (bom?.sizes || []).some((s: any) => s.size_id && !s.label);
}

// The size identity shared with the sales order and with netting: the folded
// size NAME, never a BOMSize id (those are per-BOM).
function sizeTokenOf(bomSize: any): string {
    return String(bomSize?.size_name || bomSize?.size?.name || bomSize?.label || '').trim().toLowerCase();
}

function BomEntryRow({
    entry, index, boms, items, attributes, onChange, onRemove, canRemove,
}: {
    entry: BomEntryState;
    index: number;
    boms: any[];
    items: any[];
    attributes: any[];
    onChange: (updated: BomEntryState) => void;
    onRemove: () => void;
    canRemove: boolean;
}) {
    const selectedBom = boms.find((b: any) => b.id === entry.bomId) || null;
    const sizes = selectedBom?.sizes || [];
    // Scoped to the ordered item when the SO named one — the planner is choosing
    // between that item's recipes, not the whole master list.
    const bomChoices = entry.itemId ? boms.filter((b: any) => b.item_id === entry.itemId) : boms;
    const unmatchedTokens = !selectedBom || !entry.sizeTokens ? [] : Object.keys(entry.sizeTokens).filter(
        tok => !sizes.some((bs: any) => sizeTokenOf(bs) === tok)
    );

    const item = selectedBom ? items.find((it: any) => it.id === selectedBom.item_id) : null;
    const itemUom: string = item?.uom || '';
    const itemAttrIds: string[] = item?.attribute_ids?.map(String) || [];
    const bomAttrIds: string[] = selectedBom?.attribute_value_ids || [];
    const freeAttributes = !selectedBom ? [] : attributes.filter((attr: any) => {
        if (!attr.values?.length) return false;
        if (!itemAttrIds.includes(String(attr.id))) return false;
        return !(attr.values || []).some((v: any) => bomAttrIds.includes(v.id));
    });

    const handleAttrChange = (attr: any, valId: string) => {
        const attrValueIds: string[] = (attr.values || []).map((v: any) => v.id);
        const others = entry.attributeValueIds.filter((id: string) => !attrValueIds.includes(id));
        onChange({ ...entry, attributeValueIds: valId ? [...others, valId] : others });
    };

    return (
        <div style={{ border: '1px solid #aca899', borderRadius: 3, padding: '10px 8px 8px', background: '#f5f4ee', position: 'relative' }}>
            <span style={{ position: 'absolute', top: -8, left: 8, background: '#f5f4ee', padding: '0 4px', fontSize: 10, fontWeight: 'bold', color: '#000080' }}>
                BOM Entry {index + 1}
            </span>
            {canRemove && (
                <button
                    onClick={onRemove}
                    className={XP_BTN}
                    style={{ position: 'absolute', top: -8, right: 6, background: '#c84040', border: '1px solid #800', color: '#fff', fontSize: 9, padding: '1px 5px', cursor: 'pointer', fontFamily: xpFont, borderRadius: BUTTON_RADIUS }}
                >
                    Remove
                </button>
            )}
            <div style={{ marginBottom: 6 }}>
                <label style={xpLabel()}>Product Recipe (BOM)</label>
                <SearchableSelect
                    options={bomChoices.map((b: any) => ({ value: b.id, label: b.item_name || b.item_code, subLabel: b.code }))}
                    value={entry.bomId}
                    // A locked entry whose recipe the SO deliberately left open is
                    // still pickable here — that is the whole point of choosing the
                    // BOM on the PR. Only a decided one is frozen. The ordered size
                    // qtys survive the pick (sizeTokens), so switching recipe keeps
                    // the demand and just re-hangs it on the new BOM's sizes.
                    onChange={val => onChange({ ...entry, bomId: val, sizeQtys: {}, totalQty: entry.sizeTokens ? '' : entry.totalQty, attributeValueIds: entry.locked ? entry.attributeValueIds : [] })}
                    disabled={!!entry.locked && !!entry.bomId}
                    placeholder="-- Select a BOM --"
                />
                {!entry.bomId && entry.sizeTokens && (
                    <div style={{ fontSize: 10, color: '#7a5c00', marginTop: 2 }}>
                        Ordered: {Object.entries(entry.sizeTokens).map(([tok, q]) => `${tok.toUpperCase()} ${q}`).join(', ')} — pick the recipe to plan it.
                    </div>
                )}
                {entry.bomId && unmatchedTokens.length > 0 && (
                    <div style={{ fontSize: 10, color: '#a33', marginTop: 2 }}>
                        This BOM has no size for {unmatchedTokens.map(t => t.toUpperCase()).join(', ')} — that qty is not planned.
                    </div>
                )}
            </div>

            {freeAttributes.map((attr: any) => {
                // Color Code (labdip_color) is resolved on the SO via the Color
                // Library / pending-lab-dip pickers into entry.colorId /
                // entry.labdipVariantCode — a separate field from attributeValueIds
                // (see SalesOrderView.tsx). Its mirrored AttributeValue id is never
                // pushed into attributeValueIds (that array must stay an exact match
                // against BOM.attribute_value_ids for BOM lookup), so the generic
                // select below can never show it as selected. When the SO already
                // decided it, show it locked instead of a huge unselected dropdown.
                if (attr.system_role === 'labdip_color' && entry.locked && (entry.colorId || entry.labdipVariantCode)) {
                    return (
                        <div key={attr.id} style={{ marginBottom: 6 }}>
                            <label style={xpLabel()}>{attr.name}</label>
                            <div style={xpInput({ height: '22px', lineHeight: '20px', background: '#e8e8e0', color: '#555' })}>
                                {entry.colorLabel || entry.labdipVariantCode || entry.colorId}
                            </div>
                        </div>
                    );
                }
                const selectedValId = entry.attributeValueIds.find(
                    (id: string) => (attr.values || []).some((v: any) => v.id === id)
                ) || '';
                return (
                    <div key={attr.id} style={{ marginBottom: 6 }}>
                        <label style={xpLabel()}>{attr.name}</label>
                        <select
                            style={xpInput({ height: '22px' })}
                            value={selectedValId}
                            onChange={e => handleAttrChange(attr, e.target.value)}
                        >
                            <option value="">-- None --</option>
                            {(attr.values || []).map((v: any) => (
                                <option key={v.id} value={v.id}>{v.value}</option>
                            ))}
                        </select>
                    </div>
                );
            })}

            {selectedBom && sizes.length > 0 && (
                <div>
                    <label style={xpLabel({ fontWeight: 'bold', marginBottom: 4 })}>
                        Qty per Size{itemUom ? <span style={{ borderRadius: CHIP_RADIUS, fontWeight: 'normal', marginLeft: 4, fontSize: 10, background: '#dde8f5', border: '1px solid #7f9db9', padding: '0 4px', color: '#336' }}>{itemUom}</span> : null}
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 4 }}>
                        {sizes.map((s: any) => (
                            <div key={s.id}>
                                <label style={xpLabel({ fontWeight: 'bold', fontSize: 10 })}>
                                    {s.label || s.size?.name || s.size_name || (s.target_measurement ? String(s.target_measurement) : `S${s.id.slice(0, 4)}`)}
                                </label>
                                <input
                                    type="number" min="0" style={xpInput()} placeholder="0"
                                    value={entry.sizeQtys[s.id] || ''}
                                    onChange={e => onChange({ ...entry, sizeQtys: { ...entry.sizeQtys, [s.id]: e.target.value } })}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {selectedBom && sizes.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={xpLabel()}>Total Quantity</label>
                    <input
                        type="number" min="0" style={xpInput({ width: 100 })} placeholder="0"
                        value={entry.totalQty}
                        onChange={e => onChange({ ...entry, totalQty: e.target.value })}
                    />
                    {itemUom && (
                        <span style={{ borderRadius: CHIP_RADIUS, fontSize: 10, fontFamily: xpFont, background: '#dde8f5', border: '1px solid #7f9db9', padding: '1px 5px', color: '#336' }}>{itemUom}</span>
                    )}
                </div>
            )}

            {selectedBom && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 10, fontFamily: xpFont, color: '#663c00', cursor: 'pointer' }}>
                    <input
                        type="checkbox"
                        checked={!!entry.forceCreate}
                        onChange={e => onChange({ ...entry, forceCreate: e.target.checked })}
                    />
                    Force create even if in stock
                </label>
            )}
        </div>
    );
}

export default function ProductionRunModal({
    boms, items, attributes, locations, onSave, onClose,
    initialBomId, initialSizes, initialTotalQty, initialBomEntries, salesOrderId, salesOrderCode, productionRuns,
}: Props) {
    const { authFetch } = useData();
    const { hasPermission } = useUser();
    const [code, setCode] = useState('');
    const codeEdited = useRef(false);
    const [locationCode, setLocationCode] = useState('');
    const [sourceLocationCode, setSourceLocationCode] = useState('');
    const [targetStart, setTargetStart] = useState('');
    const [targetEnd, setTargetEnd] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [tolerance, setTolerance] = useState<number>(0);
    // The plant-wide quantity formula (Settings > General). Seeded with the
    // shipped default so an Apply pressed before the fetch lands still does
    // what it always did rather than nothing.
    const [formulaRules, setFormulaRules] = useState<QtyFormulaRule[]>(DEFAULT_QTY_FORMULA);
    const [formulaModalOpen, setFormulaModalOpen] = useState(false);
    // Saving the formula is admin-only server-side; a non-admin still gets the
    // dialog read-only, which is the only place the rule is written out in full.
    const canEditFormula = hasPermission('admin.access');

    // Leaf locations only (stock sits in leaves), labelled "Warehouse / Spot" —
    // matches the MO creation panel's dropdowns.
    const leafLocations = useMemo(
        () => locations.filter((l: any) => !l.has_children && l.location_type !== 'warehouse'),
        [locations]
    );
    const locLabel = (l: any) => l.full_path || (l.parent_name ? `${l.parent_name} / ${l.name}` : l.name);

    const [bomEntries, setBomEntries] = useState<BomEntryState[]>(() => {
        if (initialBomEntries && initialBomEntries.length > 0) {
            return initialBomEntries.map(e => ({
                ...e,
                attributeValueIds: e.attributeValueIds || [],
                locked: true,
                rawSoQtys: Object.fromEntries(
                    Object.entries(e.sizeQtys).map(([k, v]) => [k, parseFloat(v) || 0])
                ),
                rawTotalQty: parseFloat(e.totalQty) || 0,
            }));
        }
        if (initialBomId) {
            return [{
                bomId: initialBomId,
                sizeQtys: initialSizes || {},
                totalQty: initialTotalQty || '',
                attributeValueIds: [],
                locked: true,
                rawSoQtys: initialSizes
                    ? Object.fromEntries(Object.entries(initialSizes).map(([k, v]) => [k, parseFloat(v) || 0]))
                    : undefined,
                rawTotalQty: !initialSizes ? (parseFloat(initialTotalQty || '0') || 0) : undefined,
            }];
        }
        return [{ bomId: '', sizeQtys: {}, totalQty: '', attributeValueIds: [] }];
    });

    useEffect(() => {
        if (initialBomEntries && initialBomEntries.length > 0) {
            setBomEntries(initialBomEntries.map(e => ({
                ...e,
                attributeValueIds: e.attributeValueIds || [],
                locked: true,
                rawSoQtys: Object.fromEntries(
                    Object.entries(e.sizeQtys).map(([k, v]) => [k, parseFloat(v) || 0])
                ),
                rawTotalQty: parseFloat(e.totalQty) || 0,
            })));
        } else if (initialBomId) {
            setBomEntries([{
                bomId: initialBomId,
                sizeQtys: initialSizes || {},
                totalQty: initialTotalQty || '',
                attributeValueIds: [],
                locked: true,
                rawSoQtys: initialSizes
                    ? Object.fromEntries(Object.entries(initialSizes).map(([k, v]) => [k, parseFloat(v) || 0]))
                    : undefined,
                rawTotalQty: !initialSizes ? (parseFloat(initialTotalQty || '0') || 0) : undefined,
            }]);
        }
    }, [initialBomEntries, initialBomId, initialSizes, initialTotalQty]);

    // Resolve the ordered size NAMES onto whichever BOM the planner picked. The
    // sales order states sizes generically (a BOMSize id is per-BOM, so it cannot
    // be chosen before the recipe is), and this is where they become real rows.
    // `rawSoQtys` is refilled at the same time so the tolerance formula still has
    // the untouched ordered figures to scale.
    useEffect(() => {
        setBomEntries(prev => {
            let changed = false;
            const next = prev.map(entry => {
                if (!entry.bomId || !entry.sizeTokens) return entry;
                if (Object.keys(entry.sizeQtys).length > 0) return entry;
                const bom = boms.find((b: any) => b.id === entry.bomId);
                if (!bom) return entry;
                const resolved: Record<string, string> = {};
                const raw: Record<string, number> = {};
                for (const bs of (bom.sizes || [])) {
                    const qty = entry.sizeTokens[sizeTokenOf(bs)];
                    if (qty === undefined) continue;
                    resolved[bs.id] = String(qty);
                    raw[bs.id] = qty;
                }
                if (Object.keys(resolved).length === 0) return entry;
                changed = true;
                return { ...entry, sizeQtys: resolved, rawSoQtys: raw };
            });
            return changed ? next : prev;
        });
    }, [bomEntries, boms]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/settings/qty-formula`);
                if (!cancelled && res.ok) {
                    const d = await res.json();
                    if (Array.isArray(d?.rules) && d.rules.length) setFormulaRules(d.rules);
                }
            } catch { /* keep the default formula */ }
        })();
        return () => { cancelled = true; };
    }, [authFetch]);

    // Auto-generate the PR code via the backend (reliable, server-side dedup),
    // even when not created from a Sales Order. Base derives from the SO code,
    // else the first BOM's item, else a plain "PR". Skipped once the user edits.
    useEffect(() => {
        if (codeEdited.current) return;
        let base = 'PR';
        if (salesOrderCode) {
            const soSuffix = salesOrderCode.toUpperCase().replace(/\s+/g, '-').replace(/^SO-?/, '');
            base = `PR-${soSuffix}`;
        } else {
            const firstBom = boms.find((b: any) => b.id === bomEntries[0]?.bomId);
            if (firstBom) {
                const item = firstBom.item_name || firstBom.item_code || 'ITEM';
                base = `PR-${item.toUpperCase().replace(/\s+/g, '-').slice(0, 12)}`;
            }
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/production-runs/available-code?base=${encodeURIComponent(base)}`);
                if (!cancelled && res.ok && !codeEdited.current) {
                    const d = await res.json();
                    if (d?.code) setCode(d.code);
                }
            } catch { /* keep whatever is there */ }
        })();
        return () => { cancelled = true; };
    }, [bomEntries[0]?.bomId, salesOrderCode, boms, authFetch]);

    const showFormulaSection = bomEntries.some(e => {
        if (!e.locked || !e.bomId) return false;
        const bom = boms.find((b: any) => b.id === e.bomId);
        if (!bom) return false;
        const sized = hasStandardSizes(bom);
        const nonSized = !sized && (bom.sizes || []).length === 0 && (e.rawTotalQty ?? 0) > 0;
        return (sized && !!e.rawSoQtys) || nonSized;
    });

    const handleApplyFormula = () => {
        setBomEntries(prev => prev.map(entry => {
            if (!entry.locked || !entry.bomId) return entry;
            const bom = boms.find((b: any) => b.id === entry.bomId);
            if (!bom) return entry;
            if (hasStandardSizes(bom) && entry.rawSoQtys) {
                return { ...entry, sizeQtys: applyQtyFormula(bom.sizes, entry.rawSoQtys, tolerance, formulaRules) };
            }
            if ((bom.sizes || []).length === 0 && (entry.rawTotalQty ?? 0) > 0) {
                const newQty = applyQtyFormulaTotal(entry.rawTotalQty!, tolerance, formulaRules);
                return { ...entry, totalQty: String(newQty) };
            }
            return entry;
        }));
    };

    // ── Dry-run netting preview: same plan the backend will create ──
    const previewBody = useMemo(() => {
        const bom_entries = bomEntries
            .filter(e => e.bomId)
            .map(entry => {
                const selectedBom = boms.find((b: any) => b.id === entry.bomId);
                const sizes = selectedBom?.sizes || [];
                // Same variant the create call sends, or the preview nets (and labels)
                // on a different key than the run it is previewing.
                const attribute_value_ids = entry.attributeValueIds.length > 0
                    ? entry.attributeValueIds
                    : undefined;
                if (sizes.length > 0) {
                    const sizeEntries = sizes
                        .filter((s: any) => parseFloat(entry.sizeQtys[s.id] || '0') > 0)
                        .map((s: any) => ({ bom_size_id: s.id, qty: parseFloat(entry.sizeQtys[s.id]) }));
                    return { bom_id: entry.bomId, sizes: sizeEntries, attribute_value_ids, color_id: entry.colorId || undefined, labdip_variant_code: entry.labdipVariantCode || undefined, force_create: !!entry.forceCreate };
                }
                const qty = parseFloat(entry.totalQty || '0');
                return { bom_id: entry.bomId, total_qty: qty > 0 ? qty : undefined, attribute_value_ids, color_id: entry.colorId || undefined, labdip_variant_code: entry.labdipVariantCode || undefined, force_create: !!entry.forceCreate };
            })
            .filter((e: any) => (e.sizes && e.sizes.length > 0) || e.total_qty);
        return {
            bom_entries,
            location_code: null,
            source_location_code: null,
        };
    }, [bomEntries, boms]);

    const previewEnabled = previewBody.bom_entries.length > 0;
    const { nodes: previewNodes, loading: previewLoading, error: previewError } =
        useNettingPreview('/production-runs/preview', previewBody, previewEnabled);

    const addEntry = () => setBomEntries(prev => [...prev, { bomId: '', sizeQtys: {}, totalQty: '', attributeValueIds: [], forceCreate: false }]);
    const removeEntry = (i: number) => setBomEntries(prev => prev.filter((_, idx) => idx !== i));
    const updateEntry = (i: number, updated: BomEntryState) =>
        setBomEntries(prev => prev.map((e, idx) => idx === i ? updated : e));

    const handleSave = async () => {
        if (!code) {
            setError('Code is required.');
            return;
        }
        const validEntries = bomEntries.filter(e => e.bomId);
        if (!validEntries.length) {
            setError('At least one BOM must be selected.');
            return;
        }
        // An entry seeded from a sales order carries real ordered qty. Dropping it
        // for want of a recipe pick would plan less than was ordered, silently.
        const undecided = bomEntries.filter(e => !e.bomId && (e.sizeTokens || e.rawTotalQty));
        if (undecided.length) {
            setError(`${undecided.length} ordered line(s) still have no BOM selected. Pick a recipe for each, or remove it.`);
            return;
        }

        setError('');
        setIsSaving(true);
        try {
            const bom_entries = validEntries.map(entry => {
                const selectedBom = boms.find((b: any) => b.id === entry.bomId);
                const sizes = selectedBom?.sizes || [];
                const attribute_value_ids = entry.attributeValueIds.length > 0
                    ? entry.attributeValueIds
                    : undefined;
                if (sizes.length > 0) {
                    const sizeEntries = sizes
                        .filter((s: any) => parseFloat(entry.sizeQtys[s.id] || '0') > 0)
                        .map((s: any) => ({ bom_size_id: s.id, qty: parseFloat(entry.sizeQtys[s.id]) }));
                    return { bom_id: entry.bomId, sizes: sizeEntries, attribute_value_ids, color_id: entry.colorId || undefined, labdip_variant_code: entry.labdipVariantCode || undefined, force_create: !!entry.forceCreate };
                }
                const qty = parseFloat(entry.totalQty || '0');
                return { bom_id: entry.bomId, total_qty: qty > 0 ? qty : undefined, attribute_value_ids, color_id: entry.colorId || undefined, labdip_variant_code: entry.labdipVariantCode || undefined, force_create: !!entry.forceCreate };
            });

            const res = await onSave({
                code,
                bom_entries,
                target_start_date: targetStart || undefined,
                target_end_date: targetEnd || undefined,
                sales_order_id: salesOrderId || undefined,
            });
            if (res && !res.ok) {
                const err = await res.json().catch(() => ({}));
                setError(err.detail || 'Failed to create Production Run');
                return;
            }
            onClose();
        } catch (e: any) {
            setError(e.message || 'Failed to create Production Run');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <ModalWrapper
            isOpen
            modeless
            onClose={onClose}
            title={<><i className="bi bi-collection-play me-1"></i> NEW PRODUCTION RUN</>}
            variant="success"
            size="xxl"
            footer={
                <ModalFooterActions
                    onCancel={onClose}
                    onSubmit={handleSave}
                    submitting={isSaving}
                    submitLabel="CREATE PRODUCTION RUN"
                    submittingLabel="Creating..."
                    variant="success"
                />
            }
        >
            {/* Two-panel layout: left = form, right = live netting preview */}
            <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start', fontFamily: xpFont }}>

                {/* ── LEFT: form ── */}
                <div style={{ width: 420, minWidth: 420, flexShrink: 0, paddingRight: 18, borderRight: '1px solid #aca899' }}>
                    <div style={{ marginBottom: 8 }}>
                        <label style={xpLabel()}>Run Code</label>
                        <input
                            style={xpInput()}
                            value={code}
                            placeholder="Auto-generated"
                            onChange={e => { codeEdited.current = true; setCode(e.target.value); }}
                        />
                    </div>

                    {/* Output location follows the final WO output; material source
                        follows item-master default / BOM-line override (resolved at
                        staging). No order-level location needed. */}

                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <div style={{ flex: 1 }}>
                            <label style={xpLabel()}>Target Start</label>
                            <input type="date" style={xpInput()} value={targetStart} onChange={e => setTargetStart(e.target.value)} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={xpLabel()}>Target End</label>
                            <input type="date" style={xpInput()} value={targetEnd} onChange={e => setTargetEnd(e.target.value)} />
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {bomEntries.map((entry, i) => (
                            <BomEntryRow
                                key={i}
                                entry={entry}
                                index={i}
                                boms={boms}
                                items={items}
                                attributes={attributes}
                                onChange={updated => updateEntry(i, updated)}
                                onRemove={() => removeEntry(i)}
                                canRemove={bomEntries.length > 1 && !entry.locked}
                            />
                        ))}
                    </div>

                    {showFormulaSection && (
                        <div style={{ border: '1px solid #b0a890', borderRadius: 3, padding: '6px 8px', background: '#faf9f0', marginTop: 8 }}>
                            <div style={{ fontSize: 10, fontWeight: 'bold', color: '#5a4a00', marginBottom: 4 }}>
                                Quantity Tolerance
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <label style={xpLabel({ marginBottom: 0, whiteSpace: 'nowrap' })}>Tolerance %</label>
                                <input
                                    type="number" min={0} max={100} step={0.5}
                                    style={xpInput({ width: 60 })}
                                    value={tolerance}
                                    onChange={e => {
                                        const v = parseFloat(e.target.value);
                                        setTolerance(isNaN(v) ? 0 : Math.min(100, Math.max(0, v)));
                                    }}
                                />
                                <button
                                    onClick={handleApplyFormula}
                                    className={XP_BTN}
                                    style={{ fontFamily: xpFont, fontSize: 11, padding: '2px 10px', background: 'linear-gradient(to bottom, #e8f0ff, #c0d0f0)', border: '1px solid', borderColor: '#d0d8f0 #4060a0 #4060a0 #d0d8f0', cursor: 'pointer', whiteSpace: 'nowrap', borderRadius: BUTTON_RADIUS }}
                                >
                                    Apply
                                </button>
                                {/* Editing the formula from here, not only from
                                    Settings: a planner notices the rule is wrong
                                    while filling a run, and walking away loses it. */}
                                <button
                                    type="button"
                                    onClick={() => setFormulaModalOpen(true)}
                                    className={XP_BTN}
                                    title={canEditFormula ? 'Edit the quantity formula' : 'View the quantity formula'}
                                    style={{ fontFamily: xpFont, fontSize: 11, padding: '2px 8px', background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', cursor: 'pointer', whiteSpace: 'nowrap', borderRadius: BUTTON_RADIUS }}
                                >
                                    <i className="bi bi-gear" style={{ marginRight: 4 }}></i>
                                    Formula
                                </button>
                                {/* The active formula comes from the stored rules;
                                    this line must not restate a rule this file owns. */}
                                <span style={{ fontSize: 9, color: '#666', lineHeight: 1.2 }}>
                                    {formulaSummary(formulaRules)}{'  '}|{'  '}then × (1 + %), rounded up.
                                </span>
                            </div>
                        </div>
                    )}

                    <button
                        onClick={addEntry}
                        className={XP_BTN}
                        style={{ marginTop: 8, fontFamily: xpFont, fontSize: 11, padding: '2px 10px', background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', cursor: 'pointer', alignSelf: 'flex-start', borderRadius: BUTTON_RADIUS }}
                    >
                        + Add BOM
                    </button>

                    {error && <div style={{ marginTop: 8, fontSize: 10, color: '#a00', background: '#fff0f0', border: '1px solid #f0a0a0', padding: '4px 8px' }}>{error}</div>}
                </div>

                {/* ── RIGHT: live netting preview ── */}
                <div style={{ flex: 1, paddingLeft: 18, minWidth: 360 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', marginBottom: 8 }}>
                        Net requirement preview
                    </div>
                    {previewEnabled ? (
                        <NettingPlanTable nodes={previewNodes} loading={previewLoading} error={previewError} />
                    ) : (
                        <div style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            minHeight: 240, gap: 10, color: '#94a3b8', textAlign: 'center',
                        }}>
                            <i className="bi bi-diagram-3" style={{ fontSize: 40, opacity: 0.35 }}></i>
                            <div style={{ fontSize: 12, maxWidth: 220 }}>
                                Pick an output location, a recipe, and quantity to preview what will be made vs covered by stock.
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Level 2: opens over this window. The formula is plant-wide, so a
                save hands the new rules straight back rather than making the
                open run refetch them. Mounted only while open — the editor
                loads the rule set on mount and this window already fetched it. */}
            {formulaModalOpen && (
                <QtyFormulaModal
                    isOpen
                    onClose={() => setFormulaModalOpen(false)}
                    canEdit={canEditFormula}
                    onSaved={rules => { if (rules?.length) setFormulaRules(rules); }}
                />
            )}
        </ModalWrapper>
    );
}
