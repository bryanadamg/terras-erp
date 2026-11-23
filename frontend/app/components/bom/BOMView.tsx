import React, { useState, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useUser } from '../../context/UserContext';
const BOMDesigner = dynamic(() => import('./BOMDesigner'), { ssr: false });
const BOMPrintModal = dynamic(() => import('./BOMPrintModal'), { ssr: false });
import ModalWrapper from '../shared/ModalWrapper';
import { useToast } from '../shared/Toast';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { workCenterChipStyle, xpFont, colorHexFor, CodeChip, CODE_FONT, TableSkeleton, useTableSkeletonMetrics, CHIP_RADIUS, VariantChip, BUTTON_RADIUS, XP_BTN, XPActionButton, useFloatingMenu, MenuTriggerButton, FloatingMenu } from '../shared/xpTheme';
import { expandedRowFrame, rowStateBg, Table } from '@bryanadamg/terras-ui/components/Table';
import { FormSection } from '@bryanadamg/terras-ui/components/FormSection';
import { TINT, tintTitle, FieldList, type DetailField } from '../shared/RequestDetailPanel';
import { SKEL_PAGE_ROWS } from '@bryanadamg/terras-ui/components/Skeleton';
import Pager from '../shared/Pager';
import { lvThead, LV_STICKY_THEAD, ExpanderCell, lvZebra, TableEmpty, Dash, ResizableTable } from '../shared/listViewTheme';
import { useRowSelection, RowCheckbox, SelectAllCheckbox, CHECK_COL_W as LV_CHECK_COL_W, EXPANDER_COL_W as LV_EXPANDER_COL_W } from '@bryanadamg/terras-ui/components/Table';
import { ToolbarButton, SearchField, viewShellStyle } from '../shared/shellTheme';
import { FilterChipBar } from '@bryanadamg/terras-ui/components/FilterChipBar';
import { toolbar as xpToolbar } from '@bryanadamg/terras-ui/styles';
import { STATIC_BASE } from '../shared/apiBase';
import { matchSubBOM } from '../shared/bomMatch';

const BOM_SCOPE_FILTERS = [
    { value: 'root', label: 'Root BOMs' },
    { value: 'all', label: 'All BOMs' },
];

// --- Dense-row display helpers -----------------------------------------
// colorHexFor() now lives in components/shared/xpTheme.tsx (shared with lab dips).

// "S–XL" range from a BOM's sizes (ordered by sort_order); count fallback.
function sizeTag(sizes: any[]): string {
    if (!sizes?.length) return '';
    const sorted = [...sizes].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const names = sorted.map((s) => s.size_name || s.label).filter(Boolean);
    if (!names.length) return `${sizes.length} sz`;
    if (names.length === 1) return names[0];
    return `${names[0]}–${names[names.length - 1]}`;
}

// Does this BOM carry any weaving/textile technical spec?
function hasTeknisFor(b: any): boolean {
    return b.kerapatan_picks != null || b.sisir_no != null || !!b.pemakaian_obat
        || b.berat_bahan_mateng != null || b.berat_bahan_mentah_pelesan != null
        || b.mesin_lebar != null || b.celup_lebar != null;
}

// ── Expanded-row workspace styles ────────────────────────────────────────────
// A fixed-height workspace: all three cards run to the bottom of the row (it reads as
// one framed tool, not three floating boxes) and each scrolls its own overflow.
const PANE_H = 420;
const PANE: React.CSSProperties = { ...TINT, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column' };
const PANE_BODY: React.CSSProperties = { padding: 0, overflowY: 'auto', minHeight: 0, flex: 1 };
type Tone = 'blue' | 'green' | 'amber' | 'red' | 'gray';
const toneChip = (f: Tone): React.CSSProperties => ({
    background: `var(--terras-chip-${f}-bg)`, border: `1px solid var(--terras-chip-${f}-border)`, color: `var(--terras-chip-${f}-text)`,
    borderRadius: CHIP_RADIUS, fontSize: 9, fontWeight: 'bold', padding: '0 4px', flexShrink: 0, whiteSpace: 'nowrap', display: 'inline-block',
});
// A chip on the solid selection blue: a translucent wash so it doesn't fight the row.
const onSolidChip: React.CSSProperties = { borderRadius: CHIP_RADIUS, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.5)', color: 'inherit', fontSize: 9, fontWeight: 'bold', padding: '0 4px', flexShrink: 0 };
const treeRow = (selected: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 5, padding: '3px 6px', userSelect: 'none', fontSize: 11,
    borderBottom: '1px solid var(--terras-table-line, #e8e4d8)',
    background: selected ? 'var(--terras-row-selected, #316ac5)' : undefined,
    color: selected ? 'var(--terras-on-solid, #fff)' : 'var(--terras-win-text, #000)',
});
const subCaption: React.CSSProperties = {
    fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.4px',
    color: 'var(--terras-chip-blue-text, #0d2a6e)', margin: '10px 0 4px', paddingTop: 8,
    borderTop: '1px solid var(--terras-table-line, #d6d3ce)',
};

export default function BOMView({
    items, boms, locations, attributes, sizes, workCenters, operations, partners,
    onCreateBOM, onUpdateBOM, onDeleteBOM, onDeleteMultipleBOMs, onCreateItem, onUpdateItem, onSearchItem,
    onUploadBOMPhoto, onUploadBOMDesign, onFetchBOMTree,
    companyProfile,
    initialCreateState, onClearInitialState,
    onEnsureItems,
    // Pagination props (managed by bom/page.tsx)
    bomPage = 1, bomTotal = 0, bomPageSize = 50,
    bomSearch = '', onBomSearch,
    setBomPage,
    showRootOnly = true, setShowRootOnly,
    bomLoading = false,
}: any) {
    const { showToast } = useToast();
    const { t } = useLanguage();
    const { itemIndex } = useData();

    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('boms', listBodyRef, (boms?.length ?? 0) > 0);
    const { hasPermission, hasAnyPermission } = useUser();
    const canManage = hasAnyPermission('bom.create', 'bom.edit', 'bom.delete');

    const [isDesignerOpen, setIsDesignerOpen] = useState(false);
    const [editingBOM, setEditingBOM] = useState<any>(null);
    const [printBOM, setPrintBOM] = useState<any>(null);
    const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
    // Cache of fetched BOM trees: rootBomId -> { bomId: bomObj } flat map
    const [bomTreeCache, setBomTreeCache] = useState<Record<string, Record<string, any>>>({});

    // Inline detail panel state
    const [expandedBOMRows, setExpandedBOMRows] = useState<Record<string, boolean>>({});
    const [selectedBOMNodes, setSelectedBOMNodes] = useState<Record<string, string>>({});

    // Flatten a BOMTreeResponse (recursive lines[].sub_bom) into a flat id->bom map
    const flattenBOMTree = (bom: any, acc: Record<string, any> = {}): Record<string, any> => {
        if (!bom || acc[bom.id]) return acc;
        acc[bom.id] = bom;
        for (const line of bom.lines || []) {
            if (line.sub_bom) flattenBOMTree(line.sub_bom, acc);
        }
        return acc;
    };

    const toggleBOMRow = (bomId: string, _bomItemId: string) => {
        setExpandedBOMRows(prev => {
            const opening = !prev[bomId];
            if (opening) {
                setSelectedBOMNodes(p => ({ ...p, [bomId]: bomId }));
                // Fetch and cache the full tree so sub-BOMs are available even across pages
                if (!bomTreeCache[bomId] && onFetchBOMTree) {
                    onFetchBOMTree(bomId).then((tree: any) => {
                        if (tree) setBomTreeCache(c => ({ ...c, [bomId]: flattenBOMTree(tree) }));
                    });
                }
            }
            return { ...prev, [bomId]: opening };
        });
    };

    const selectDetailNode = (bomId: string, subBomId: string) => {
        setSelectedBOMNodes(prev => ({ ...prev, [bomId]: subBomId }));
    };

    // Combined lookup: current page boms + all cached tree boms (cache wins for sub-BOMs)
    const allBomsById = useMemo<Record<string, any>>(() => {
        const map: Record<string, any> = {};
        for (const b of boms) map[b.id] = b;
        for (const subMap of Object.values(bomTreeCache)) {
            for (const [id, b] of Object.entries(subMap)) {
                if (!map[id]) map[id] = b;
            }
        }
        return map;
    }, [boms, bomTreeCache]);

    // Index boms by item_id once per data change so findSubBOM is an O(1) map hit
    // plus a tiny same-item filter — not an O(all boms) scan on every call (it runs
    // many times per render across the line list + recursive tree walk).
    const bomsByItemId = useMemo<Record<string, any[]>>(() => {
        const map: Record<string, any[]> = {};
        for (const b of Object.values(allBomsById)) {
            (map[(b as any).item_id] ||= []).push(b);
        }
        return map;
    }, [allBomsById]);

    // Attribute-aware sub-BOM lookup: searches current page + all cached trees
    const findSubBOM = (line: any, excludeIds: Set<string> = new Set()): any | undefined => {
        const pool = bomsByItemId[line.item_id];
        if (!pool) return undefined;
        const candidates = excludeIds.size ? pool.filter((b: any) => !excludeIds.has(b.id)) : pool;
        return matchSubBOM(candidates, line);
    };

    // Lookup helpers
    // Line/tree display resolves from itemIndex (full, cached) so the BOM page does
    // not depend on the paginated items array being loaded. items.find still wins
    // when present (freshest during an open designer session).
    const getItemName = (id: string, provided?: string) => provided || items.find((i: any) => i.id === id)?.name || itemIndex?.[String(id)]?.name || id;
    const getItemCode = (id: string, provided?: string) => provided || items.find((i: any) => i.id === id)?.code || itemIndex?.[String(id)]?.code || id;
    const getItemUom = (id: string) => items.find((i: any) => i.id === id)?.uom || itemIndex?.[String(id)]?.uom || '';
    // Beam items carry a warp-ends count; for a beam BOM the qty IS the ends (set on BOM creation).
    const getItemEnds = (id: string): number | null => { const e = items.find((i: any) => i.id === id)?.ends ?? itemIndex?.[String(id)]?.ends; return e != null ? e : null; };
    const uomBadge: React.CSSProperties = { background: '#dde8f5', border: '1px solid #7f9db9', color: '#336', fontSize: 9, padding: '0 4px', whiteSpace: 'nowrap', fontWeight: 'normal' };
    const getAttributeValueName = (valId: string) => {
        if (!valId || !attributes) return '-';
        for (const attr of attributes) {
            const val = attr.values.find((v: any) => v.id === valId);
            if (val) return val.value;
        }
        return valId;
    };
    // Stored swatch color (user-picked), when set — falls back to the derived name lookup at the render site.
    const getAttributeValueHex = (valId: string): string | null => {
        if (!valId || !attributes) return null;
        for (const attr of attributes) {
            const val = attr.values.find((v: any) => v.id === valId);
            if (val) return val.hex || null;
        }
        return null;
    };

    // Variant chip row — shared by the list Variant column and the detail node header.
    // Tone/geometry come from VariantChip (xpTheme); a value that resolves to a hex is
    // a shade, the rest are loose attributes. No local palette: the old beige one made
    // the same value read differently here than on the WO list or the lot pickers.
    const renderVariantChips = (valIds: string[], compact = false) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3 }}>
            {valIds.map((valId: string) => {
                const label = getAttributeValueName(valId);
                const hex = getAttributeValueHex(valId) ?? colorHexFor(label);
                return (
                    <VariantChip
                        key={valId} kind={hex ? 'color' : 'material'}
                        size={compact ? 'xs' : 'sm'} swatch={hex} icon={null} title={label}
                    >{label}</VariantChip>
                );
            })}
        </div>
    );

    // Server already filters by search + root_only; boms is the current page result,
    // so select-all is page-scoped while ticked rows survive paging.
    const sel = useRowSelection<any>(boms, (b: any) => b.id);
    const { openId: menuOpenId, pos: menuPos, toggle: menuToggle, close: menuClose } = useFloatingMenu(140);

    const handleBulkDelete = async () => {
        if (onDeleteMultipleBOMs) { await onDeleteMultipleBOMs(sel.keys); sel.clear(); }
    };

    // `items` is one page; a deep link may name any item, so fall back to the full index.
    const findDeepLinkItem = (id: string) => items.find((i: any) => i.id === id) || itemIndex?.[String(id)];
    const initialItemCode = initialCreateState ? (findDeepLinkItem(initialCreateState.item_id)?.code || '') : '';
    const initialAttributeIds = initialCreateState ? (initialCreateState.attribute_value_ids || '').split(',').filter(Boolean) : [];

    // The paginated items array is only pulled on demand now (see DataContext:
    // /bom no longer fetches it). The designer needs it, so load it whenever the
    // designer opens or a deep-link create arrives without items yet.
    useEffect(() => { if (isDesignerOpen) onEnsureItems?.(); }, [isDesignerOpen]);

    useEffect(() => {
        if (!initialCreateState) return;
        if (items.length === 0) { onEnsureItems?.(); return; }  // wait for items, effect re-runs
        if (findDeepLinkItem(initialCreateState.item_id)) setIsDesignerOpen(true);
    }, [initialCreateState, items, itemIndex]);

    const handleCloseDesigner = () => { setIsDesignerOpen(false); setEditingBOM(null); if (onClearInitialState) onClearInitialState(); };

    const handleEditBOM = async (bom: any) => {
        if (onFetchBOMTree) {
            const tree = await onFetchBOMTree(bom.id);
            setEditingBOM(tree);
            setIsDesignerOpen(true);
        } else {
            setEditingBOM(bom);
            setIsDesignerOpen(true);
        }
    };

    const handleCreateBOMWrapper = async (bomData: any) => {
        const cleaned = {
            ...bomData,
            customer_id: bomData.customer_id || null,
            work_center_id: bomData.work_center_id || null,
            size_mode: bomData.sizeMode || 'sized',
            sizes: (bomData.sizes || []).map((s: any) => ({
                size_id: s.size_id || null,
                label: s.label || null,
                target_measurement: s.target_measurement,
                measurement_min: s.measurement_min,
                measurement_max: s.measurement_max,
            })),
            operations: (bomData.operations || []).map(({ _key, ...op }: any) => op),
        };

        const isEdit = !!bomData.bomId;
        const res = isEdit
            ? await onUpdateBOM(bomData.bomId, cleaned)
            : await onCreateBOM(cleaned);

        if (res?.status === 400) {
            const err = await res.json();
            showToast(`Error saving BOM ${bomData.code}: ${err.detail || 'Invalid data'}`, 'warning');
            throw new Error(err.detail || 'Invalid');
        } else if (res?.status === 404) {
            const err = await res.json();
            showToast(`Failed to save BOM ${bomData.code}: ${err.detail}`, 'danger');
            throw new Error(err.detail || 'Not found');
        } else if (res?.ok) {
            const saved = await res.json();
            // No per-BOM success toast: saving a tree writes many BOMs and that produced
            // a stack of them. BOMDesigner reports the whole run through one progress
            // toast instead. Failures below still toast individually — they name the
            // specific BOM that broke, which the summary can't.
            return saved.id;
        } else {
            try { const err = await res.json(); showToast(`Failed to save BOM ${bomData.code}: ${err.detail}`, 'danger'); } catch (_) { showToast(`Failed to save BOM ${bomData.code}`, 'danger'); }
            throw new Error('Failed');
        }
    };

    // Materials column preview tree (existing)
    const toggleNode = (nodeId: string) => setExpandedNodes(prev => ({ ...prev, [nodeId]: !prev[nodeId] }));

    const renderBOMTree = (bomLines: any[], parentId: string, level = 0) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {bomLines.map((line: any) => {
                const subBOM = findSubBOM(line);
                const isExpandable = !!subBOM;
                const nodeKey = `${parentId}-${line.id}`;
                const isExpanded = expandedNodes[nodeKey];
                return (
                    <div key={line.id} style={{ fontSize: '11px' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            {isExpandable ? (
                                <i className={`bi bi-caret-${isExpanded ? 'down' : 'right'}-fill`}
                                    style={{ cursor: 'pointer', fontSize: '0.7rem', width: '12px', marginRight: '4px', color: '#0058e6', flexShrink: 0 }}
                                    onClick={() => toggleNode(nodeKey)} />
                            ) : (
                                <span style={{ width: '12px', display: 'inline-block', marginRight: '4px', flexShrink: 0 }} />
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingBottom: '2px', borderBottom: '1px solid #e0ddd4', width: '100%', overflow: 'hidden' }}>
                                <CodeChip code={getItemCode(line.item_id, line.item_code)} tier={2} className="text-truncate me-1" />
                                <span className="text-truncate" style={{ color: '#000' }}>{getItemName(line.item_id, line.item_name)}</span>
                                <div className="text-truncate flex-grow-1" style={{ fontSize: '0.7rem', color: '#555', fontStyle: 'italic' }}>
                                    {(line.attribute_value_ids || []).map(getAttributeValueName).join(', ')}
                                </div>
                                {line.source_location_id && (
                                    <span className="badge bg-light text-dark border ms-2 flex-shrink-0" style={{ fontSize: '0.6rem' }}>
                                        <i className="bi bi-geo-alt" />
                                    </span>
                                )}
                                <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                    {(line.percentage || 0) > 0 ? (
                                        <span style={{ background: '#b46a00', color: '#fff', fontSize: 8, padding: '0 3px', fontWeight: 'bold' }}>{line.percentage}%</span>
                                    ) : (line.qty || 0) > 0 ? (
                                        <span style={{ fontFamily: CODE_FONT, fontSize: 9, fontWeight: 'bold', color: '#000' }}>{Number(line.qty)}</span>
                                    ) : null}
                                    {getItemUom(line.item_id) && (
                                        <span style={uomBadge}>{getItemUom(line.item_id)}</span>
                                    )}
                                    {isExpandable && (
                                        <span style={{ borderRadius: CHIP_RADIUS, background: '#fff3cd', border: '1px solid #b8860b', color: '#6b4e00', fontSize: '8px', padding: '0 3px', fontWeight: 'bold' }}>Sub</span>
                                    )}
                                </span>
                            </div>
                        </div>
                        {isExpandable && isExpanded && subBOM.lines && (
                            <div style={{ borderLeft: '2px solid #b0aaa0', marginLeft: '14px', paddingLeft: '6px', marginTop: '4px' }}>
                                {renderBOMTree(subBOM.lines, nodeKey, level + 1)}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );

    // ── Detail panel ──────────────────────────────────────────────────────────

    const countTreeNodes = (b: any, visited = new Set<string>()): number => {
        if (visited.has(b.id)) return 0;
        visited.add(b.id);
        let count = 1;
        for (const line of b.lines || []) {
            const sub = findSubBOM(line, visited);
            count += sub ? countTreeNodes(sub, new Set(visited)) : 1;
        }
        return count;
    };

    const findParentName = (b: any, targetBomId: string, visited = new Set<string>()): string => {
        if (visited.has(b.id)) return '';
        visited.add(b.id);
        for (const line of b.lines || []) {
            const sub = findSubBOM(line, visited);
            if (sub?.id === targetBomId) return b.item_name || b.item_code || '';
            if (sub) { const r = findParentName(sub, targetBomId, new Set(visited)); if (r) return r; }
        }
        return '';
    };

    const buildTreeNodes = (b: any, level: number, visited: Set<string>, rootBomId: string, selectedBomId: string): React.ReactNode[] => {
        if (visited.has(b.id)) return [];
        const seen = new Set(visited);
        seen.add(b.id);
        const nodes: React.ReactNode[] = [];

        for (const line of b.lines || []) {
            const sub = findSubBOM(line, seen);
            const isSelectable = !!sub;
            const isSelected = isSelectable && !!sub && selectedBomId === sub.id;
            const indentPx = 5 + level * 14;

            nodes.push(
                <div key={line.id}
                    className={isSelectable && !isSelected ? 'bom-tree-hover' : undefined}
                    onClick={isSelectable && sub ? () => selectDetailNode(rootBomId, sub.id) : undefined}
                    style={{ ...treeRow(isSelected), padding: `3px 6px 3px ${indentPx}px`, cursor: isSelectable ? 'pointer' : 'default' }}
                >
                    <i className={`bi ${isSelectable ? 'bi-layers' : 'bi-box'}`} style={{ fontSize: 11, flexShrink: 0, color: isSelected ? 'inherit' : (isSelectable ? 'var(--terras-win-blue, #316ac5)' : 'var(--terras-win-text-3, #666)') }} />
                    <span title={line.item_name || line.item_code} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {line.item_name || line.item_code}
                    </span>
                    {isSelectable && <span style={isSelected ? onSolidChip : toneChip('amber')}>Sub</span>}
                </div>
            );

            if (sub) nodes.push(...buildTreeNodes(sub, level + 1, seen, rootBomId, selectedBomId));
        }
        return nodes;
    };

    const renderDetailPanel = (bom: any) => {
        const bomId = bom.id;
        const selectedBomId = selectedBOMNodes[bomId] ?? bom.id;
        const isRootSelected = selectedBomId === bom.id;
        const displayBOM = isRootSelected ? bom : (allBomsById[selectedBomId] || bom);

        const lines: any[] = displayBOM.lines || [];
        const totalPct = lines.reduce((sum: number, l: any) => sum + (l.percentage || 0), 0);
        const hasPct = lines.some((l: any) => (l.percentage || 0) > 0);
        // Beam BOM: each component line's qty holds that yarn's warp-ends count (independent of % / kg).
        const beamBom = getItemEnds(displayBOM.item_id) != null || (displayBOM.work_center_name || '').toUpperCase().includes('BEAM');
        const totalLineEnds = lines.reduce((sum: number, l: any) => sum + (Number(l.qty) || 0), 0);
        const nodeCount = countTreeNodes(bom);
        const parentName = isRootSelected ? '' : findParentName(bom, selectedBomId);

        // Measurement / size grids in the details card: a compact terras Table.
        const miniTd: React.CSSProperties = { padding: '2px 6px', fontSize: 10 };
        const miniTh: React.CSSProperties = { ...miniTd, fontWeight: 'bold' };
        const num = (v: any) => v != null ? v : <span style={{ color: 'var(--terras-win-text-3, #999)' }}>—</span>;
        const mRow = (label: string, mesinVal: any, celupVal: any, unit: string) => (
            <tr key={label}>
                <td style={miniTd}>{label}</td>
                <td style={{ ...miniTd, textAlign: 'right', fontWeight: 'bold' }}>{num(mesinVal)}</td>
                <td style={{ ...miniTd, textAlign: 'right', fontWeight: 'bold' }}>{num(celupVal)}</td>
                <td style={{ ...miniTd, color: 'var(--terras-win-text-3, #777)', borderRight: 'none' }}>{unit}</td>
            </tr>
        );
        const hasMesin = [displayBOM.mesin_lebar, displayBOM.mesin_panjang_tulisan, displayBOM.mesin_panjang_tarikan, displayBOM.mesin_panjang_tarikan_bandul_1kg, displayBOM.mesin_panjang_tarikan_bandul_9kg].some(v => v != null);
        const hasCelup = [displayBOM.celup_lebar, displayBOM.celup_panjang_tulisan, displayBOM.celup_panjang_tarikan, displayBOM.celup_panjang_tarikan_bandul_1kg, displayBOM.celup_panjang_tarikan_bandul_9kg].some(v => v != null);
        const warpEnds = getItemEnds(displayBOM.item_id) != null;
        const unitOf = (u: string) => <span style={{ fontWeight: 'normal', fontSize: 9, color: 'var(--terras-win-text-3, #666)' }}> {u}</span>;

        const detailFields: DetailField[] = [
            { label: 'BOM Code', value: <CodeChip code={displayBOM.code} tone="accent" style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom' }} /> },
            { label: 'Item', value: <><b>{displayBOM.item_name || displayBOM.item_code}</b>{displayBOM.item_name && displayBOM.item_name !== displayBOM.item_code && <div><CodeChip code={displayBOM.item_code} tier={2} /></div>}</> },
            ...((displayBOM.attribute_value_ids || []).length > 0 ? [{ label: 'Variant', value: renderVariantChips(displayBOM.attribute_value_ids) }] : []),
            ...(displayBOM.customer_name ? [{ label: 'Customer', value: displayBOM.customer_name }] : []),
            ...(displayBOM.work_center_name ? [{ label: 'Machine', value: displayBOM.work_center_name }] : []),
            warpEnds
                ? { label: 'Warp Ends', value: <span style={toneChip('green')}>{Math.round(Number(displayBOM.qty))} ends</span> }
                : { label: 'Batch Output', value: <b>{Number(displayBOM.qty).toFixed(2)}{unitOf('pcs')}</b> },
            { label: <span title="Process wastage — inflates component requirements">Wastage</span>, value: <b>+{Number(displayBOM.tolerance_percentage || 0).toFixed(2)}%</b> },
            { label: <span title="Overdelivery — how far past an order's qty may be logged">Overdelivery</span>, value: <b>+{Number(displayBOM.overdelivery_tolerance_percentage ?? 10).toFixed(2)}%</b> },
            { label: 'Status', value: <span style={toneChip(displayBOM.active ? 'green' : 'red')}>{displayBOM.active ? 'Active' : 'Inactive'}</span> },
            { label: 'Components', value: <b>{lines.length}{unitOf(`mat${lines.length !== 1 ? 's' : ''}`)}</b> },
        ];
        const teknisFields: DetailField[] = [
            ...(displayBOM.kerapatan_picks != null ? [{ label: 'Kerapatan', value: `${displayBOM.kerapatan_picks} ${displayBOM.kerapatan_unit || '/cm'}` }] : []),
            ...(displayBOM.sisir_no != null ? [{ label: 'Sisir No.', value: displayBOM.sisir_no }] : []),
            ...(displayBOM.pemakaian_obat ? [{ label: 'Obat Setting', value: displayBOM.pemakaian_obat }] : []),
            ...(displayBOM.pembuatan_sample_oleh ? [{ label: 'Sample oleh', value: displayBOM.pembuatan_sample_oleh }] : []),
            ...(displayBOM.berat_bahan_mateng != null ? [{ label: 'B. Mateng', value: <>{displayBOM.berat_bahan_mateng}{unitOf('gr/yd')}</> }] : []),
            ...(displayBOM.berat_bahan_mentah_pelesan != null ? [{ label: 'B. Mentah', value: <>{displayBOM.berat_bahan_mentah_pelesan}{unitOf('gr/yd')}</> }] : []),
        ];

        return (
            <tr key={`${bom.id}-detail`}>
                {/* Frame on a wrapper so its inset shadow isn't painted over. Three tinted cards
                    on the panel's own ground, stretched to PANE_H — the same card language as
                    the request detail panels. */}
                <td colSpan={9} style={{ padding: 0 }}>
                    <div style={{ ...expandedRowFrame(), padding: '8px 8px 8px 12px', background: 'var(--terras-table-bg, #fff)' }}>
                    <div style={{ display: 'flex', gap: 8, height: PANE_H, fontFamily: xpFont, fontSize: 11 }}>

                        {/* LEFT: Tree */}
                        <FormSection
                            title={tintTitle(<><i className="bi bi-diagram-3-fill" style={{ marginRight: 4 }} />BOM Structure</>)}
                            right={<span style={{ fontSize: 9, color: 'var(--terras-chip-blue-text, #0d2a6e)' }}>{nodeCount} nodes</span>}
                            style={{ ...PANE, width: 320, flexShrink: 0 }} bodyStyle={PANE_BODY}
                        >
                            <div className={isRootSelected ? undefined : 'bom-tree-hover'} onClick={() => selectDetailNode(bomId, bom.id)} style={{ ...treeRow(isRootSelected), cursor: 'pointer' }}>
                                <i className="bi bi-box-seam" style={{ fontSize: 13, flexShrink: 0 }} />
                                <span title={bom.item_name || bom.item_code} style={{ flex: 1, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {bom.item_name || bom.item_code}
                                </span>
                                <span style={isRootSelected ? onSolidChip : toneChip('green')}>ROOT</span>
                            </div>
                            {buildTreeNodes(bom, 1, new Set(), bomId, selectedBomId)}
                        </FormSection>

                        {/* CENTER: Components of the selected node */}
                        <FormSection
                            title={tintTitle(
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                    <i className={`bi ${isRootSelected ? 'bi-box-seam' : 'bi-layers'}`} />
                                    {displayBOM.item_name || displayBOM.item_code}
                                    {(displayBOM.attribute_value_ids || []).length > 0 && <span style={{ textTransform: 'none', letterSpacing: 0 }}>{renderVariantChips(displayBOM.attribute_value_ids)}</span>}
                                </span>
                            )}
                            right={!isRootSelected && parentName ? <span style={{ fontSize: 9, color: 'var(--terras-chip-blue-text, #0d2a6e)' }}>Sub-assembly of <b>{parentName}</b></span> : undefined}
                            style={{ ...PANE, flex: 1, minWidth: 0 }} bodyStyle={{ ...PANE_BODY, overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}
                        >
                            {lines.length === 0 ? (
                                <div style={{ fontSize: 10, color: 'var(--terras-win-text-3, #555)', fontStyle: 'italic', padding: '8px 10px' }}>No components defined.</div>
                            ) : (
                            <>
                                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                                <Table style={{ borderLeft: 'none', borderTop: 'none' }}>
                                    <thead>
                                        <tr>
                                            <th>Item</th>
                                            <th style={{ textAlign: 'right', width: 1 }}>Required</th>
                                            {beamBom && <th style={{ textAlign: 'right', width: 1 }}>Ends</th>}
                                            <th style={{ borderRight: 'none' }}>Attributes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {lines.map((line: any) => (
                                            <tr key={line.id}>
                                                <td className="terras-cell-wrap">
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                                        <CodeChip code={line.item_code} tone="accent" />
                                                        {/* Name only when it adds something — many items carry the code as their name. */}
                                                        {line.item_name && line.item_name !== line.item_code && <span>{line.item_name}</span>}
                                                        {!!findSubBOM(line) && <span style={toneChip('blue')}>Sub</span>}
                                                    </span>
                                                </td>
                                                <td style={{ textAlign: 'right' }}>
                                                    {(line.percentage || 0) > 0 ? (
                                                        <span style={toneChip('amber')}>{line.percentage}%</span>
                                                    ) : (line.qty || 0) > 0 ? (
                                                        <span style={{ fontFamily: CODE_FONT, fontWeight: 'bold' }}>{Number(line.qty)}</span>
                                                    ) : <span style={{ color: 'var(--terras-win-text-3, #888)' }}>—</span>}
                                                    {getItemUom(line.item_id) && <span style={{ ...toneChip('gray'), fontWeight: 'normal', marginLeft: 4 }}>{getItemUom(line.item_id)}</span>}
                                                </td>
                                                {beamBom && (
                                                    <td style={{ textAlign: 'right' }}>
                                                        {(Number(line.qty) || 0) > 0
                                                            ? <span style={toneChip('green')}>{Math.round(Number(line.qty))} ends</span>
                                                            : <span style={{ color: 'var(--terras-win-text-3, #888)' }}>—</span>}
                                                    </td>
                                                )}
                                                <td className="terras-cell-wrap" style={{ borderRight: 'none' }}>
                                                    {(line.attribute_value_ids || []).length > 0 ? renderVariantChips(line.attribute_value_ids) : <span style={{ color: 'var(--terras-win-text-3, #888)' }}>—</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                                </div>
                                <div style={{ flexShrink: 0, padding: '4px 10px', background: 'var(--terras-toolbar-bg, #f5f4ef)', borderTop: '1px solid var(--terras-table-line, #d6d3ce)', fontSize: 10, color: 'var(--terras-win-text-2, #444)', textAlign: 'right' }}>
                                    {lines.length} component{lines.length !== 1 ? 's' : ''}
                                    {hasPct && (
                                        <> · Total %: <span style={{ fontWeight: 'bold', color: Math.abs(totalPct - 100) < 0.01 ? 'var(--terras-status-green, #004400)' : 'var(--terras-status-red, #880000)' }}>{totalPct.toFixed(1)}%</span></>
                                    )}
                                    {beamBom && totalLineEnds > 0 && (
                                        <> · Total yarn ends: <span style={{ fontWeight: 'bold', color: 'var(--terras-status-green, #1a6e2e)' }}>{Math.round(totalLineEnds)}</span></>
                                    )}
                                </div>
                            </>
                            )}
                        </FormSection>

                        {/* RIGHT: BOM details */}
                        <FormSection
                            title={tintTitle(<><i className="bi bi-clipboard" style={{ marginRight: 4 }} />BOM Details</>)}
                            right={<XPActionButton icon="bi-printer" title="Print BOM" onClick={() => setPrintBOM(displayBOM)} />}
                            style={{ ...PANE, width: 290, flexShrink: 0 }} bodyStyle={{ ...PANE_BODY, padding: '6px 10px' }}
                        >
                            <FieldList fields={detailFields} columns={1} labelWidth={84} />

                            {teknisFields.length > 0 && (<>
                                <div style={subCaption}>Detail Teknis</div>
                                <FieldList fields={teknisFields} columns={1} labelWidth={84} />
                            </>)}

                            {(hasMesin || hasCelup) && (<>
                                <div style={subCaption}>Measurements</div>
                                <Table>
                                    <thead><tr><th style={miniTh} /><th style={{ ...miniTh, textAlign: 'right' }}>Mesin</th><th style={{ ...miniTh, textAlign: 'right' }}>Celup</th><th style={{ ...miniTh, borderRight: 'none' }} /></tr></thead>
                                    <tbody>
                                        {mRow('Lebar', displayBOM.mesin_lebar, displayBOM.celup_lebar, 'mm')}
                                        {mRow('P. Tulisan', displayBOM.mesin_panjang_tulisan, displayBOM.celup_panjang_tulisan, 'cm')}
                                        {mRow('P. Tarikan', displayBOM.mesin_panjang_tarikan, displayBOM.celup_panjang_tarikan, 'cm')}
                                        {mRow('Bandul 1kg', displayBOM.mesin_panjang_tarikan_bandul_1kg, displayBOM.celup_panjang_tarikan_bandul_1kg, 'cm')}
                                        {mRow('Bandul 9kg', displayBOM.mesin_panjang_tarikan_bandul_9kg, displayBOM.celup_panjang_tarikan_bandul_9kg, 'cm')}
                                    </tbody>
                                </Table>
                            </>)}

                            {(displayBOM.sizes || []).length > 0 && (<>
                                <div style={subCaption}>Size Measurements</div>
                                <Table>
                                    <thead><tr>
                                        <th style={miniTh}>{displayBOM.size_mode === 'free' ? 'Label' : 'Size'}</th>
                                        <th style={{ ...miniTh, textAlign: 'right' }}>Target</th>
                                        <th style={{ ...miniTh, textAlign: 'right' }}>Min</th>
                                        <th style={{ ...miniTh, textAlign: 'right', borderRight: 'none' }}>Max</th>
                                    </tr></thead>
                                    <tbody>
                                        {(displayBOM.sizes || []).map((sz: any, i: number) => (
                                            <tr key={i}>
                                                <td style={{ ...miniTd, fontWeight: 'bold' }}>{sz.size_name || sz.label || `Row ${i + 1}`}</td>
                                                <td style={{ ...miniTd, textAlign: 'right' }}>{num(sz.target_measurement)}</td>
                                                <td style={{ ...miniTd, textAlign: 'right' }}>{num(sz.measurement_min)}</td>
                                                <td style={{ ...miniTd, textAlign: 'right', borderRight: 'none' }}>{num(sz.measurement_max)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            </>)}

                            {displayBOM.design_file_url && (<>
                                <div style={subCaption}>Design / Susunan Rumusan</div>
                                {/\.(jpg|jpeg|png|gif|webp)$/i.test(displayBOM.design_file_url) ? (
                                    <a href={`${STATIC_BASE}${displayBOM.design_file_url}`} target="_blank" rel="noreferrer">
                                        <img src={`${STATIC_BASE}${displayBOM.design_file_url}`} alt="Design"
                                            style={{ maxWidth: '100%', maxHeight: 80, border: '1px solid var(--terras-table-line, #c0bdb5)', display: 'block', objectFit: 'cover', cursor: 'pointer' }} />
                                    </a>
                                ) : (
                                    <a href={`${STATIC_BASE}${displayBOM.design_file_url}`} target="_blank" rel="noreferrer"
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--terras-win-blue, #0000cc)', textDecoration: 'underline' }}>
                                        <i className="bi bi-file-earmark-pdf" style={{ color: 'var(--terras-status-red, #c00)', fontSize: 12 }} />
                                        Open design file
                                    </a>
                                )}
                            </>)}
                        </FormSection>

                    </div>
                    </div>
                </td>
            </tr>
        );
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <>
        <div className="row g-4 fade-in">
            {/* BOM Designer Modal */}
            <ModalWrapper
                isOpen={isDesignerOpen}
                onClose={handleCloseDesigner}
                title={<><i className="bi bi-collection-fill" style={{ marginRight: 6 }} />{editingBOM ? `Edit BOM: ${editingBOM.code}` : 'BOM Designer (Recursive)'}</>}
                size="xxl"
                variant="primary"
                modeless
                bodyScroll={false}
            >
                {/* Full-bleed: cancel the modal body's 12/14px padding so the designer's own
                    ground and footer meet the window frame, not a tinted band around them. */}
                <div style={{ margin: '-12px -14px', width: 'calc(100% + 28px)', height: 'min(calc(var(--app-vh) * 82 / 100), 860px)', overflow: 'hidden' }}>
                    <BOMDesigner
                        rootItemCode={editingBOM ? editingBOM.item_code : (initialItemCode || '')}
                        initialAttributeValueIds={editingBOM ? (editingBOM.attribute_value_ids || []) : initialAttributeIds}
                        initialBOMData={editingBOM || null}
                        items={items} locations={locations || []} attributes={attributes}
                        sizes={sizes || []}
                        partners={partners || []}
                        workCenters={workCenters} operations={operations} existingBOMs={boms}
                        onSave={handleCreateBOMWrapper} onCreateItem={onCreateItem} onUpdateItem={onUpdateItem}
                        onUploadPhoto={onUploadBOMPhoto}
                        onUploadDesign={onUploadBOMDesign}
                        onCancel={handleCloseDesigner} onSearchItem={onSearchItem}
                    />
                </div>
            </ModalWrapper>

            {/* BOM List */}
            <div className="col-12">
                <div style={viewShellStyle()}>
                    {/* Toolbar: search + filter + selection + create */}
                    <div style={xpToolbar()}>
                        <SearchField value={bomSearch} onChange={v => onBomSearch?.(v)} placeholder="Search BOMs..." width={200} />
                        <FilterChipBar
                            options={BOM_SCOPE_FILTERS}
                            value={showRootOnly ? 'root' : 'all'}
                            onChange={v => setShowRootOnly?.(v === 'root')}
                        />
                        {canManage && sel.count > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontFamily: xpFont, fontSize: '11px', color: '#333' }}>{sel.count} selected</span>
                                <button className={XP_BTN} style={{ fontFamily: xpFont, fontSize: '11px', padding: '2px 10px', cursor: 'pointer', background: 'linear-gradient(to bottom, #fff, #d4d0c8)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#000', borderRadius: BUTTON_RADIUS }} onClick={handleBulkDelete}>
                                    <i className="bi bi-trash" style={{ marginRight: '4px' }} />Delete Selected
                                </button>
                                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#003ea6', textDecoration: 'underline', fontFamily: xpFont, fontSize: '11px', padding: 0 }} onClick={sel.clear}>Clear</button>
                            </div>
                        )}
                        {canManage && (
                            <ToolbarButton tone="create" icon="bi-plus-lg" testId="create-bom-btn" style={{ marginLeft: 'auto' }} onClick={() => setIsDesignerOpen(true)}>
                                {t('create_recipe')}
                            </ToolbarButton>
                        )}
                    </div>

                    {/* Table body — flex:1 fills space between toolbar and pager */}
                    {/* `overflow: auto` here, and no `.table-responsive` inside: a nested overflow
                        wrapper is its own scroll container, so a sticky header in it pins to a box
                        that never scrolls vertically. */}
                    <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                        <div>
                            <ResizableTable 
                                style={{ width: '100%', borderCollapse: 'collapse', fontFamily: xpFont, fontSize: '11px', background: '#fff' }}
                            >
                                <thead style={LV_STICKY_THEAD}>
                                    <tr style={{ ...lvThead(), fontSize: '10px', fontWeight: 'bold', color: '#000', letterSpacing: '0.2px' }}>
                                        <th style={{ width: LV_CHECK_COL_W, padding: '4px 6px', borderRight: '1px solid #b0aaa0' }}>
                                            <SelectAllCheckbox allSelected={sel.allPageSelected} someSelected={sel.someSelected} onChange={sel.togglePage} />
                                        </th>
                                        <th style={{ width: LV_EXPANDER_COL_W, padding: '4px 6px', borderRight: '1px solid #b0aaa0' }} />
                                        <th style={{ padding: '4px 6px', borderRight: '1px solid #b0aaa0' }}>BOM Code</th>
                                        <th style={{ padding: '4px 6px', borderRight: '1px solid #b0aaa0' }}>{t('finished_good')}</th>
                                        <th style={{ padding: '4px 6px', borderRight: '1px solid #b0aaa0' }}>Code</th>
                                        <th style={{ padding: '4px 6px', borderRight: '1px solid #b0aaa0' }}>Variant</th>
                                        <th style={{ padding: '4px 6px', borderRight: '1px solid #b0aaa0' }}>Machine</th>
                                        <th style={{ padding: '4px 6px', borderRight: '1px solid #b0aaa0' }}>Summary</th>
                                        <th style={{ width: '50px', padding: '4px 6px' }} />
                                    </tr>
                                </thead>

                                <tbody ref={listBodyRef}>
                                    {boms.length === 0 && bomLoading ? (
                                        <TableSkeleton rows={SKEL_PAGE_ROWS} cols={skel.cols ?? 9} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                                    ) : boms.length === 0 ? (
                                        <TableEmpty colSpan={9}
                                            message={bomSearch.trim()
                                                ? 'No BOMs match your search.'
                                                : 'No BOMs yet. Click Create Recipe to get started.'} />
                                    ) : (
                                        boms.map((bom: any, index: number) => {
                                            const isExpanded = expandedBOMRows[bom.id];
                                            const rowBg = sel.isSelected(bom) ? rowStateBg('selected')
                                                : isExpanded ? rowStateBg('expanded')
                                                : lvZebra(index);

                                            return (
                                                <>
                                                <tr
                                                    key={bom.id}
                                                    style={{ background: rowBg, borderBottom: isExpanded ? 'none' : '1px solid #c0bdb5' }}
                                                >
                                                    <td style={{ padding: '7px 6px', borderRight: '1px solid #c0bdb5', verticalAlign: 'middle' }}>
                                                        <RowCheckbox checked={sel.isSelected(bom)} onChange={() => sel.toggle(bom)} label={`BOM ${bom.code}`} />
                                                    </td>
                                                    <ExpanderCell expanded={!!isExpanded} onToggle={() => toggleBOMRow(bom.id, bom.item_id)} label="BOM details"
                                                        tdStyle={{ borderRight: '1px solid #c0bdb5' }} />
                                                    {/* BOM Code — click to expand */}
                                                    <td
                                                        onClick={() => toggleBOMRow(bom.id, bom.item_id)}
                                                        style={{ padding: '7px 6px', borderRight: '1px solid #c0bdb5', verticalAlign: 'middle', cursor: 'pointer' }}
                                                        title="Click to expand BOM details"
                                                    >
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <CodeChip code={bom.code} />
                                                        </div>
                                                    </td>
                                                    {/* Finished Good — item name */}
                                                    <td
                                                        onClick={() => toggleBOMRow(bom.id, bom.item_id)}
                                                        style={{ padding: '7px 8px', borderRight: '1px solid #c0bdb5', verticalAlign: 'middle', cursor: 'pointer' }}
                                                    >
                                                        <span style={{ fontWeight: 'bold', color: '#000', fontSize: 11, fontFamily: xpFont }}>
                                                            {getItemName(bom.item_id, bom.item_name)}
                                                        </span>
                                                    </td>
                                                    {/* Item code */}
                                                    <td
                                                        onClick={() => toggleBOMRow(bom.id, bom.item_id)}
                                                        style={{ padding: '7px 8px', borderRight: '1px solid #c0bdb5', verticalAlign: 'middle', cursor: 'pointer' }}
                                                    >
                                                        {/* Reference to the item, not this row's identity — tier 2 so it
                                                            doesn't compete with the BOM code chip two columns over. */}
                                                        <CodeChip code={getItemCode(bom.item_id, bom.item_code)} tier={2} />
                                                    </td>
                                                    {/* Variant — color swatches + combo values */}
                                                    <td style={{ padding: '7px 8px', borderRight: '1px solid #c0bdb5', verticalAlign: 'middle' }}>
                                                        {(bom.attribute_value_ids || []).length > 0 ? (
                                                            renderVariantChips(bom.attribute_value_ids)
                                                        ) : (
                                                            <Dash />
                                                        )}
                                                    </td>
                                                    {/* Machine — hue-coded by work-center type */}
                                                    <td style={{ padding: '7px 6px', borderRight: '1px solid #c0bdb5', verticalAlign: 'middle' }}>
                                                        {bom.work_center_name ? (
                                                            <span style={{ ...workCenterChipStyle(bom.work_center_type, bom.work_center_name), borderWidth: 1, borderStyle: 'solid', fontSize: 9, padding: '1px 6px', whiteSpace: 'nowrap', fontFamily: xpFont, fontWeight: 'bold' }}>{bom.work_center_name}</span>
                                                        ) : (
                                                            <Dash />
                                                        )}
                                                    </td>
                                                    {/* Smart stats — glyph shows only when it carries signal */}
                                                    <td style={{ padding: '7px 8px', borderRight: '1px solid #c0bdb5', verticalAlign: 'middle' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontFamily: xpFont, fontSize: 10, color: '#555' }}>
                                                            <span title="Components (materials)" style={{ whiteSpace: 'nowrap', color: '#003080' }}>
                                                                <i className="bi bi-gear-fill" style={{ marginRight: 2, fontSize: 9 }} />{bom.lines?.length ?? 0}
                                                            </span>
                                                            {(() => { const c = bom.operation_count ?? bom.operations?.length ?? 0; return c > 0 ? (
                                                                <span title={`${c} routing operation${c !== 1 ? 's' : ''}`} style={{ whiteSpace: 'nowrap', color: '#1a4d1a' }}>
                                                                    <i className="bi bi-wrench" style={{ marginRight: 2, fontSize: 9 }} />{c}
                                                                </span>
                                                            ) : null; })()}
                                                            {getItemEnds(bom.item_id) != null ? (
                                                                <span title="Warp ends (utas)" style={{ whiteSpace: 'nowrap', color: '#1a6e2e', fontWeight: 'bold' }}>
                                                                    <i className="bi bi-bezier2" style={{ marginRight: 2, fontSize: 9 }} />{Math.round(Number(bom.qty ?? 1))}
                                                                </span>
                                                            ) : (
                                                                <span title="Batch output" style={{ whiteSpace: 'nowrap' }}>
                                                                    <i className="bi bi-box-seam" style={{ marginRight: 2, fontSize: 9 }} />{Number(bom.qty ?? 1).toFixed(2)}
                                                                </span>
                                                            )}
                                                            {bom.size_mode === 'sized' && (bom.sizes || []).length > 0 && (
                                                                <span title="Sized BOM" style={{ borderRadius: CHIP_RADIUS, whiteSpace: 'nowrap', background: '#eef0fa', border: '1px solid #99a6cc', color: '#334', padding: '0 4px', fontSize: 9 }}>{sizeTag(bom.sizes)}</span>
                                                            )}
                                                            {hasTeknisFor(bom) && (
                                                                <span title="Has weaving/textile spec" style={{ width: 7, height: 7, borderRadius: '50%', background: '#b46a00', display: 'inline-block', flexShrink: 0 }} />
                                                            )}
                                                            <span title={bom.active ? 'Active' : 'Inactive'} style={{ display: 'inline-block', width: 8, height: 8, background: bom.active ? '#00aa00' : '#cc0000', border: `1px solid ${bom.active ? '#005500' : '#660000'}`, flexShrink: 0, marginLeft: 'auto' }} />
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '7px 6px', textAlign: 'right', verticalAlign: 'middle' }}>
                                                        {canManage && <MenuTriggerButton onClick={e => menuToggle(bom.id, e)} />}
                                                    </td>
                                                </tr>
                                                {isExpanded && renderDetailPanel(bom)}
                                                </>
                                            );
                                        })
                                    )}
                                </tbody>
                            </ResizableTable>
                        </div>
                    </div>
                    {/* Pager footer — outside scroll container so always visible */}
                    <Pager page={bomPage} total={bomTotal} pageSize={bomPageSize} onPageChange={p => setBomPage?.(p)} hideWhenEmpty />
                </div>
            </div>
        </div>

        {/* Row ⋯ menu: Edit / Delete */}
        {menuOpenId && (() => {
            const bom = boms.find((b: any) => String(b.id) === menuOpenId);
            if (!bom || !canManage) return null;
            return (
                <FloatingMenu
                    pos={menuPos}
                    items={[
                        { key: 'edit', label: 'Edit', icon: 'bi-pencil-square', onClick: () => { menuClose(); handleEditBOM(bom); } },
                        { key: 'delete', label: 'Delete', icon: 'bi-trash', danger: true, onClick: () => { menuClose(); onDeleteBOM(bom.id); } },
                    ]}
                />
            );
        })()}

        {printBOM && (
            <BOMPrintModal
                bom={printBOM}
                companyProfile={companyProfile}
                getAttributeValueName={getAttributeValueName}
                onClose={() => setPrintBOM(null)}
            />
        )}
        </>
    );
}
