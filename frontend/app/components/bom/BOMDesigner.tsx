import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import CodeConfigModal, { CodeConfig, buildCodeWithCounter } from '../shared/CodeConfigModal';
import BOMAutomatorModal from './BOMAutomatorModal';
import BOMConfirmModal, { BOMPlan, BOMPlanNode, BOMPlanLine } from './BOMConfirmModal';
import SearchableSelect from '../shared/SearchableSelect';
import { useToast } from '../shared/Toast';
import { CodeChip, CODE_FONT, xpFont, CHIP_RADIUS, BUTTON_RADIUS, xpInput as xpInputBase, xpBtn as xpBtnBase, BTN_TONES, LegendPanel, XP_BTN } from '../shared/xpTheme';

// Types for Recursive Structure
interface BOMSizeEntry {
    size_id: string;
    label?: string;
    target_measurement: number | null;
    measurement_min: number | null;
    measurement_max: number | null;
}

interface BOMLineNode {
    id: string;
    item_code: string;
    attribute_value_ids: string[];
    percentage: number;
    qty: number;
    source_location_code: string;
    bom_operation_sequence: number | null;
    is_decoupling_point: boolean | null; // null = inherit item-master default
    subBOM?: BOMNodeData;
    isNewItem?: boolean;
}

interface BOMNodeData {
    id: string;
    bomId?: string;
    code: string;
    item_code: string;
    attribute_value_ids: string[];
    qty: number;
    tolerance_percentage: number;             // input side: material wastage
    overdelivery_tolerance_percentage: number; // output side: overdelivery allowance
    operations: any[];
    lines: BOMLineNode[];
    sizes: BOMSizeEntry[];
    kerapatan_picks: number | null;
    kerapatan_unit: string;
    sisir_no: number | null;
    pemakaian_obat: string;
    pembuatan_sample_oleh: string;
    customer_id: string;
    work_center_id: string;
    sizeMode: 'sized' | 'free';
    berat_bahan_mateng: number | null;
    berat_bahan_mentah_pelesan: number | null;
    mesin_lebar: number | null;
    mesin_panjang_tulisan: number | null;
    mesin_panjang_tarikan: number | null;
    mesin_panjang_tarikan_bandul_1kg: number | null;
    mesin_panjang_tarikan_bandul_9kg: number | null;
    celup_lebar: number | null;
    celup_panjang_tulisan: number | null;
    celup_panjang_tarikan: number | null;
    celup_panjang_tarikan_bandul_1kg: number | null;
    celup_panjang_tarikan_bandul_9kg: number | null;
    isNewItem?: boolean;
}

// --- XP style constants ---

const xpBtn: React.CSSProperties = xpBtnBase({ whiteSpace: 'nowrap' });

const xpBtnPrimary: React.CSSProperties = xpBtnBase({ ...BTN_TONES.primary, minWidth: 80 });

const xpBtnSuccess: React.CSSProperties = xpBtnBase({ ...BTN_TONES.success, minWidth: 100 });

const xpBtnDanger: React.CSSProperties = xpBtnBase({ ...BTN_TONES.danger, minWidth: 'auto', padding: '1px 5px', fontSize: 10 });

const xpBtnInfo: React.CSSProperties = xpBtnBase({ ...BTN_TONES.primary, minWidth: 'auto', padding: '1px 8px', fontSize: 10 });

// Spread over any xpBtn* variant to gray it out — XP disabled controls lose their
// tint entirely rather than just dimming.
const xpBtnDisabled: React.CSSProperties = { background: 'linear-gradient(to bottom, #ececec, #d8d4cc)', color: '#999', cursor: 'default', borderRadius: BUTTON_RADIUS };

const xpInput: React.CSSProperties = xpInputBase({ borderTopColor: '#5a7fa8', padding: '0 4px', width: '100%' });

const xpSelect: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11,
    border: '1px solid #7f9db9',
    background: 'white', height: 20, padding: '0 2px',
    width: '100%',
};

const xpLabel: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11, color: '#000',
    display: 'block', marginBottom: 2,
};

const xpInset: React.CSSProperties = {
    border: '2px inset #aaa', background: 'white',
    overflowY: 'auto', padding: 2,
};

const xpBadge = (color = '#316ac5'): React.CSSProperties => ({
    background: color, color: 'white',
    fontSize: 9, fontWeight: 'bold',
    padding: '1px 5px', borderRadius: 1,
    fontFamily: xpFont, whiteSpace: 'nowrap',
});

// --- Tree View Component ---
// The BOM an item already has, when that BOM is the one shared across combos.
interface SharedBomInfo { id: string; code: string; attrIds: string[] }

const TreeView = memo(({
    node, level = 0, selectedNodeId, items, onSelect, hasExistingBOM, sharedBomFor
}: {
    node: BOMNodeData, level: number, selectedNodeId: string,
    items: any[], onSelect: (id: string) => void,
    hasExistingBOM: (code: string, attributeValueIds: string[]) => boolean,
    sharedBomFor: (node: BOMNodeData) => SharedBomInfo | null
}) => {
    const itemExists = items.some((i: any) => (i.code || '').trim().toLowerCase() === (node.item_code || '').trim().toLowerCase());
    const shared = sharedBomFor(node);
    const recipeExists = hasExistingBOM(node.item_code, node.attribute_value_ids);
    const hasLocalDef = node.lines.length > 0 || node.operations.length > 0;
    const isSelected = selectedNodeId === node.id;

    return (
        <div className="tree-node" data-testid={`tree-node-${node.item_code}`}>
            <div
                style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '3px 4px',
                    paddingLeft: `${level * 14 + 4}px`,
                    cursor: 'pointer',
                    background: isSelected ? '#316ac5' : 'transparent',
                    color: isSelected ? 'white' : '#000',
                    borderBottom: '1px solid #e8e4d8',
                    fontFamily: xpFont, fontSize: 11,
                }}
                onClick={() => onSelect(node.id)}
                data-testid={`tree-node-clickable-${node.item_code}`}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#d0e4f8'; }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
                <span style={{ fontSize: 12 }}><i className={`bi ${level === 0 ? 'bi-box-seam' : 'bi-nut'}`} /></span>
                <span style={{ flex: 1, fontWeight: level === 0 ? 'bold' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {node.item_code || 'Unnamed'}
                </span>
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                    {shared && <span style={xpBadge('#6a4b9a')} title={`Reuses existing BOM ${shared.code} — shared across combos`}>SHARED</span>}
                    {!shared && recipeExists && <span style={xpBadge('#2a7a2a')}>RECIPE✓</span>}
                    {!shared && !recipeExists && hasLocalDef && <span style={xpBadge('#316ac5')}>DRAFT</span>}
                    {!shared && !itemExists && <span style={xpBadge('#a02020')}>NEW</span>}
                </div>
            </div>
            {node.lines.map(line => line.subBOM && (
                <TreeView
                    key={line.subBOM.id}
                    node={line.subBOM}
                    level={level + 1}
                    selectedNodeId={selectedNodeId}
                    items={items}
                    onSelect={onSelect}
                    hasExistingBOM={hasExistingBOM}
                    sharedBomFor={sharedBomFor}
                />
            ))}
        </div>
    );
});
TreeView.displayName = 'TreeView';

type InheritableFields = Pick<BOMNodeData,
    'sizes' | 'sizeMode' |
    'kerapatan_picks' | 'kerapatan_unit' | 'sisir_no' | 'pemakaian_obat' | 'pembuatan_sample_oleh' |
    'customer_id' | 'work_center_id' |
    'berat_bahan_mateng' | 'berat_bahan_mentah_pelesan' |
    'mesin_lebar' | 'mesin_panjang_tulisan' | 'mesin_panjang_tarikan' |
    'mesin_panjang_tarikan_bandul_1kg' | 'mesin_panjang_tarikan_bandul_9kg' |
    'celup_lebar' | 'celup_panjang_tulisan' | 'celup_panjang_tarikan' |
    'celup_panjang_tarikan_bandul_1kg' | 'celup_panjang_tarikan_bandul_9kg'
>;

// Mirrors the fallback order inside CodeConfigModal's buildCodeWithCounter (which
// appends 'counter' itself) — needed here to splice an extra variant slot in.
const DEFAULT_SEGMENT_ORDER = ['prefix', 'item', 'attribute', 'year', 'month', 'suffix'];

// Increment the trailing numeric segment of a code, keeping its zero padding
// ("BOM-357-00001" → "BOM-357-00002"). Mirrors the server-side resolver in
// api/boms.py; used only to separate two tree nodes that wanted the same code.
function bumpCodeCounter(code: string): string {
    const m = /^(.*?)([-_/ ]?)(\d+)$/.exec(code);
    if (!m) return `${code}-00002`;
    const [, base, sep, counter] = m;
    return `${base}${sep}${String(parseInt(counter, 10) + 1).padStart(counter.length, '0')}`;
}

function extractInheritableFields(source: BOMNodeData): InheritableFields {
    return {
        sizes: (source.sizes || []).map(s => ({ ...s })),
        sizeMode: source.sizeMode,
        kerapatan_picks: source.kerapatan_picks,
        kerapatan_unit: source.kerapatan_unit,
        sisir_no: source.sisir_no,
        pemakaian_obat: source.pemakaian_obat,
        pembuatan_sample_oleh: source.pembuatan_sample_oleh,
        customer_id: source.customer_id,
        work_center_id: source.work_center_id,
        berat_bahan_mateng: source.berat_bahan_mateng,
        berat_bahan_mentah_pelesan: source.berat_bahan_mentah_pelesan,
        mesin_lebar: source.mesin_lebar,
        mesin_panjang_tulisan: source.mesin_panjang_tulisan,
        mesin_panjang_tarikan: source.mesin_panjang_tarikan,
        mesin_panjang_tarikan_bandul_1kg: source.mesin_panjang_tarikan_bandul_1kg,
        mesin_panjang_tarikan_bandul_9kg: source.mesin_panjang_tarikan_bandul_9kg,
        celup_lebar: source.celup_lebar,
        celup_panjang_tulisan: source.celup_panjang_tulisan,
        celup_panjang_tarikan: source.celup_panjang_tarikan,
        celup_panjang_tarikan_bandul_1kg: source.celup_panjang_tarikan_bandul_1kg,
        celup_panjang_tarikan_bandul_9kg: source.celup_panjang_tarikan_bandul_9kg,
    };
}

function applyFieldsToDescendants(node: BOMNodeData, fields: InheritableFields): BOMNodeData {
    return {
        ...node,
        lines: node.lines.map(line =>
            line.subBOM
                ? { ...line, subBOM: { ...applyFieldsToDescendants(line.subBOM, fields), ...fields } }
                : line
        ),
    };
}

function buildNodeFromTree(data: any, locations: any[]): BOMNodeData {
    return {
        id: Math.random().toString(36).substr(2, 9),
        bomId: data.id,
        code: data.code || '',
        item_code: data.item_code || '',
        attribute_value_ids: (data.attribute_value_ids || []).map(String),
        qty: data.qty ?? 1.0,
        tolerance_percentage: data.tolerance_percentage ?? 0.0,
        overdelivery_tolerance_percentage: data.overdelivery_tolerance_percentage ?? 10.0,
        operations: (data.operations || []).map((op: any) => ({
            _key: op.id || Math.random().toString(36).substr(2, 9),
            operation_id: op.operation_id || null,
            work_center_id: op.work_center_id || null,
            sequence: op.sequence ?? 10,
            time_minutes: op.time_minutes ?? 0,
        })),
        lines: (data.lines || []).map((l: any) => ({
            id: l.id || Math.random().toString(36).substr(2, 9),
            item_code: l.item_code || '',
            attribute_value_ids: (l.attribute_value_ids || []).map(String),
            percentage: l.percentage ?? 0,
            qty: l.qty ?? 0,
            source_location_code: locations?.find((loc: any) => loc.id === l.source_location_id)?.code || '',
            bom_operation_sequence: l.bom_operation_id
                ? (data.operations || []).find((o: any) => o.id === l.bom_operation_id)?.sequence ?? null
                : null,
            is_decoupling_point: l.is_decoupling_point ?? null,
            subBOM: l.sub_bom ? buildNodeFromTree(l.sub_bom, locations) : undefined,
            isNewItem: false,
        })),
        sizes: (data.sizes || []).map((s: any) => ({
            size_id: s.size_id || null,
            label: s.label || null,
            target_measurement: s.target_measurement ?? null,
            measurement_min: s.measurement_min ?? null,
            measurement_max: s.measurement_max ?? null,
        })),
        sizeMode: data.size_mode || data.sizeMode || 'sized',
        kerapatan_picks: data.kerapatan_picks ?? null,
        kerapatan_unit: data.kerapatan_unit || '/cm',
        sisir_no: data.sisir_no ?? null,
        pemakaian_obat: data.pemakaian_obat || '',
        pembuatan_sample_oleh: data.pembuatan_sample_oleh || '',
        customer_id: data.customer_id || '',
        work_center_id: data.work_center_id || '',
        berat_bahan_mateng: data.berat_bahan_mateng ?? null,
        berat_bahan_mentah_pelesan: data.berat_bahan_mentah_pelesan ?? null,
        mesin_lebar: data.mesin_lebar ?? null,
        mesin_panjang_tulisan: data.mesin_panjang_tulisan ?? null,
        mesin_panjang_tarikan: data.mesin_panjang_tarikan ?? null,
        mesin_panjang_tarikan_bandul_1kg: data.mesin_panjang_tarikan_bandul_1kg ?? null,
        mesin_panjang_tarikan_bandul_9kg: data.mesin_panjang_tarikan_bandul_9kg ?? null,
        celup_lebar: data.celup_lebar ?? null,
        celup_panjang_tulisan: data.celup_panjang_tulisan ?? null,
        celup_panjang_tarikan: data.celup_panjang_tarikan ?? null,
        celup_panjang_tarikan_bandul_1kg: data.celup_panjang_tarikan_bandul_1kg ?? null,
        celup_panjang_tarikan_bandul_9kg: data.celup_panjang_tarikan_bandul_9kg ?? null,
    };
}

export default function BOMDesigner({
    rootItemCode,
    initialAttributeValueIds,
    initialBOMData,
    items,
    locations,
    attributes,
    sizes,
    partners,
    workCenters,
    operations,
    onSave,
    onCreateItem,
    onUpdateItem,
    onUploadPhoto,
    onUploadDesign,
    onCancel,
    existingBOMs,
    onSearchItem
}: any) {
    const { t } = useLanguage();
    const { itemIndex, authFetch } = useData();
    const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api')
        .replace(/\/api$/, '') + '/api';
    const { showProgressToast } = useToast();

    const [rootBOM, setRootBOM] = useState<BOMNodeData>(() => {
        if (initialBOMData) {
            const node = buildNodeFromTree(initialBOMData, locations);
            node.id = 'root';
            return node;
        }
        return {
            id: 'root', code: '',
            item_code: rootItemCode || '',
            attribute_value_ids: initialAttributeValueIds || [],
            qty: 1.0, tolerance_percentage: 0.0, overdelivery_tolerance_percentage: 10.0,
            operations: [], lines: [], sizes: [],
            kerapatan_picks: null, kerapatan_unit: '/cm',
            sisir_no: null, pemakaian_obat: '', pembuatan_sample_oleh: '',
            customer_id: '', work_center_id: '', sizeMode: 'sized',
            berat_bahan_mateng: null, berat_bahan_mentah_pelesan: null,
            mesin_lebar: null, mesin_panjang_tulisan: null, mesin_panjang_tarikan: null,
            mesin_panjang_tarikan_bandul_1kg: null, mesin_panjang_tarikan_bandul_9kg: null,
            celup_lebar: null, celup_panjang_tulisan: null, celup_panjang_tarikan: null,
            celup_panjang_tarikan_bandul_1kg: null, celup_panjang_tarikan_bandul_9kg: null,
        };
    });

    const [selectedNodeId, setSelectedNodeId] = useState<string>('root');
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [isAutomatorOpen, setIsAutomatorOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [pendingDesignFile, setPendingDesignFile] = useState<File | null>(null);

    const [inheritFields, setInheritFields] = useState(true);

    const [pendingItemCode, setPendingItemCode] = useState('');
    const [pendingPercentage, setPendingPercentage] = useState<string>('');
    const [pendingQty, setPendingQty] = useState<string>('');
    const [pctError, setPctError] = useState<string | null>(null);
    // Save-time confirmation: the plan is snapshotted when the user hits Save so the
    // panel can't drift from what was reviewed.
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [savePlan, setSavePlan] = useState<BOMPlan | null>(null);
    // Tree the confirmed save will write — same shape as rootBOM but with every new
    // node's code resolved against the server (see resolveTreeCodes).
    const [pendingTree, setPendingTree] = useState<BOMNodeData | null>(null);
    // itemCode (lowercased) -> the BOM that item already owns
    // item code -> every existing BOM for that item (an item owns one per combo, plus
    // possibly a combo-less one). Reuse is decided per combo, not per item.
    const [sharedBomByItem, setSharedBomByItem] = useState<Record<string, SharedBomInfo[]>>({});

    const [pendingOpSeq, setPendingOpSeq] = useState<string>('');
    const [pendingOpWc, setPendingOpWc] = useState<string>('');
    const [pendingOpType, setPendingOpType] = useState<string>('');
    const [pendingOpTime, setPendingOpTime] = useState<string>('');

    const [codeConfig, setCodeConfig] = useState<CodeConfig>({
        prefix: 'BOM', suffix: '', separator: '-',
        includeItemCode: true, includeVariant: false,
        variantAttributeNames: [], includeYear: false, includeMonth: false
    });

    useEffect(() => {
        const savedConfig = localStorage.getItem('bom_code_config');
        if (savedConfig) {
            try { setCodeConfig(JSON.parse(savedConfig)); } catch (e) {}
        }
    }, []);

    useEffect(() => {
        if (rootItemCode && !rootBOM.code) {
            setRootBOM(prev => ({
                ...prev,
                code: suggestBOMCode(rootItemCode, prev.attribute_value_ids)
            }));
        }
    }, [rootItemCode]);

    // Precomputed lookups so per-row helpers are O(1) map hits instead of a linear
    // items.find / existingBOMs.filter on every call (each runs many times/render).
    const itemByCode = useMemo(() => {
        const m = new Map<string, any>();
        for (const i of items) m.set((i.code || '').trim().toLowerCase(), i);
        return m;
    }, [items]);
    // Append-only snapshot of each item's attribute_ids, keyed by code. The material
    // picker (SearchableSelect) drives the GLOBAL item search, which narrows the shared
    // `items` list server-side and can drop the root (or any already-configured) item
    // off the current page — which would blank its attribute_ids and make the
    // combo/attribute dropdowns vanish mid-edit. We resolve dropdowns from this snapshot
    // instead of the volatile `items` list, so an item's attributes stay stable for the
    // editing session once seen. Seeded synchronously on mount (no first-render flash)
    // and kept current in an effect (the correct place for this side effect).
    // Items never seen on any page fall back to `indexByCode` — see getAttrIds below.
    const [attrIdsByCode, setAttrIdsByCode] = useState<Map<string, string[]>>(() => {
        const m = new Map<string, string[]>();
        for (const i of items) {
            if (Array.isArray(i.attribute_ids)) m.set((i.code || '').trim().toLowerCase(), i.attribute_ids);
        }
        return m;
    });
    useEffect(() => {
        setAttrIdsByCode(prev => {
            let next = prev;
            for (const i of items) {
                if (!Array.isArray(i.attribute_ids)) continue;
                const key = (i.code || '').trim().toLowerCase();
                const cur = prev.get(key);
                const changed = !cur || cur.length !== i.attribute_ids.length
                    || cur.some((v, idx) => v !== i.attribute_ids[idx]);
                if (changed) {
                    if (next === prev) next = new Map(prev);
                    next.set(key, i.attribute_ids);
                }
            }
            return next; // same reference when nothing changed → no re-render
        });
    }, [items]);
    // Fallback lookup from the cached full item index (name/code/uom/ends plus
    // attribute_ids/variant_type for EVERY item, not just the paginated `items` slice). Lets the designer resolve names,
    // uom and beam-detection for components that aren't on the current items page —
    // otherwise editing a BOM whose parts are off-page showed raw codes. itemIndex
    // is keyed by id; re-key by code and carry the id through for existing-BOM lookup.
    const indexByCode = useMemo(() => {
        const m = new Map<string, any>();
        for (const id in itemIndex) {
            const e = itemIndex[id];
            if (e?.code) m.set(e.code.trim().toLowerCase(), { ...e, id });
        }
        return m;
    }, [itemIndex]);
    // Attribute ids for an item code. The paginated `items` snapshot wins (freshest),
    // then the cached full item index — which covers EVERY item, so editing a BOM whose
    // root/child sits outside the current 50-item page still resolves its variant
    // (Colors/Combo) dropdowns. Returns undefined when the item is unknown to both, so
    // callers can distinguish "no attributes" ([]) from "not seen yet".
    const getAttrIds = useCallback((code: string): string[] | undefined => {
        const k = (code || '').trim().toLowerCase();
        return attrIdsByCode.get(k) ?? indexByCode.get(k)?.attribute_ids;
    }, [attrIdsByCode, indexByCode]);

    const existingBomsByItemId = useMemo(() => {
        const m = new Map<string, any[]>();
        for (const b of existingBOMs) {
            const arr = m.get(b.item_id) || [];
            arr.push(b); m.set(b.item_id, arr);
        }
        return m;
    }, [existingBOMs]);

    // Beam finished items: BOM "Batch Size" (qty) is repurposed as the warp-ends (utas) count.
    // Prefer the freshest paginated `items` row, fall back to the cached index.
    const getItemByCode = useCallback((code: string) => {
        const k = (code || '').trim().toLowerCase();
        return itemByCode.get(k) || indexByCode.get(k);
    }, [itemByCode, indexByCode]);

    const getItemName = useCallback((code: string) =>
        getItemByCode(code)?.name || code,
    [getItemByCode]);

    const getItemUom = useCallback((code: string) =>
        getItemByCode(code)?.uom || '',
    [getItemByCode]);
    const isBeamCode = useCallback((code: string) => {
        const it = getItemByCode(code);
        return !!it && (((it.category_path || []).some((c: string) => (c || '').toLowerCase() === 'beam')) || it.ends != null);
    }, [getItemByCode]);
    // Work center (group, or its parent group) is BEAMING type. Covers inline-created items with no category/ends yet.
    const isBeamWc = useCallback((wcId?: string) => {
        if (!wcId) return false;
        const wc = (workCenters || []).find((w: any) => String(w.id) === String(wcId));
        if (!wc) return false;
        if ((wc.center_type || '').toUpperCase() === 'BEAMING') return true;
        // Walk all the way up — with the optional GROUP tier the BEAMING type node can
        // be more than one hop away (mirrors _sync_beam_item in api/boms.py).
        let cursor = wc;
        const seen = new Set<string>([String(wc.id)]);
        while (cursor?.parent_id && !seen.has(String(cursor.parent_id))) {
            seen.add(String(cursor.parent_id));
            cursor = (workCenters || []).find((w: any) => String(w.id) === String(cursor.parent_id));
            if (!cursor) break;
            if ((cursor.center_type || '').toUpperCase() === 'BEAMING') return true;
        }
        return false;
    }, [workCenters]);
    const isBeamNode = useCallback((node: any) =>
        !!node && (isBeamCode(node.item_code) || isBeamWc(node.work_center_id)),
    [isBeamCode, isBeamWc]);

    const comboAttr = useMemo(() => attributes.find((a: any) =>
        (a.system_role || '').toLowerCase() === 'combo' || (a.name || '').toLowerCase() === 'combo'
    ), [attributes]);

    // NOTE: combo-agnosticism is deliberately NOT read off Item.variant_type. That
    // field is FG-only, so keying on it made every WIP sub-assembly combo-agnostic by
    // construction — greige could never hold a combo. What decides is whether the BOM
    // itself carries a Combo value.
    const comboValueIds = useMemo(
        () => new Set((comboAttr?.values || []).map((v: any) => String(v.id))),
        [comboAttr]);

    // Combo values carried by a given value list, as a stable key. Two BOMs of the
    // same item are the same recipe only when their combo matches — that, not the
    // item's type, is what decides reuse vs a new per-combo BOM.
    const comboKeyOf = useCallback((valueIds: string[] = []): string =>
        valueIds.map(String).filter(id => comboValueIds.has(id)).sort().join('|'),
    [comboValueIds]);

    // variant_type for an item created inline from a node/line that inherited a
    // Combo value: it is a combo-variant item, so tag it as one. Undefined (not
    // null) when there is no combo, so the field is simply absent from the POST.
    const variantTypeFor = useCallback((valueIds: string[] = []): string | undefined =>
        comboKeyOf(valueIds) ? 'combo' : undefined,
    [comboKeyOf]);

    const hasExistingBOM = useCallback((code: string, attributeValueIds: string[] = []): boolean => {
        const item = getItemByCode(code);
        if (!item) return false;
        const candidates = existingBomsByItemId.get(item.id) || [];
        if (candidates.length === 0) return false;
        const sortedAttrs = [...attributeValueIds].sort();
        const exactMatch = candidates.some((b: any) => {
            const bAttrs = [...(b.attribute_value_ids || [])].sort();
            return bAttrs.length === sortedAttrs.length && bAttrs.every((id: string, i: number) => id === sortedAttrs[i]);
        });
        if (exactMatch) return true;
        // An attribute-less BOM is the variant-agnostic recipe and covers a node that
        // carries no combo. It does NOT cover a combo-specific node — RED greige needs
        // its own recipe, so the node must stay definable.
        if (comboKeyOf(attributeValueIds)) return false;
        return candidates.some((b: any) => (b.attribute_value_ids || []).length === 0);
    }, [getItemByCode, existingBomsByItemId, comboKeyOf]);

    const getWcName = (id: string) => workCenters.find((wc: any) => wc.id === id)?.name || id;

    const getAttributeValueName = (valId: string) => {
        for (const attr of attributes) {
            const val = attr.values.find((v: any) => v.id === valId);
            if (val) return val.value;
        }
        return valId;
    };

    // Attribute (not value) ids owning the given values — what an inline-created item
    // must be bound to so its BOM's values are actually holdable. Derived from the
    // node's OWN values rather than the root's: a node saved without a Combo gets an
    // item without the Combo attribute, so nothing reappears as a stray dropdown.
    const attributeIdsForValues = useCallback((valueIds: string[] = []): string[] => {
        if (valueIds.length === 0) return [];
        const ids: string[] = [];
        for (const attr of attributes) {
            if (attr.values.some((v: any) => valueIds.includes(v.id))) ids.push(attr.id);
        }
        return ids;
    }, [attributes]);

    // Backfill an EXISTING item's attribute types when a BOM node/line carries a value
    // (e.g. Combo) the item was never bound to. Creation-time attribute_ids assignment
    // (see onCreateItem calls in saveNode) only covers brand-new items — an item that
    // already existed without that attribute type would otherwise silently keep
    // dropping the value on every save with no way to attach it short of editing the
    // item master by hand. Additive (union with current), never replaces.
    const ensureItemHasAttributes = useCallback(async (code: string, valueIds: string[] = []) => {
        if (!onUpdateItem) return;
        const required = attributeIdsForValues(valueIds);
        if (required.length === 0) return;
        const item = getItemByCode(code);
        if (!item?.id) return;
        const current = getAttrIds(code) ?? [];
        const missing = required.filter(id => !current.includes(id));
        if (missing.length === 0) return;
        await onUpdateItem(item.id, { attribute_ids: [...current, ...missing] });
    }, [onUpdateItem, attributeIdsForValues, getItemByCode, getAttrIds]);

    // Root's assigned attribute values as "Attr: Value" text — drives the Automator's
    // per-level inherit checkboxes (label, tooltip, and whether they're usable at all).
    const rootAttributeSummary = useMemo(() => {
        const ids = rootBOM.attribute_value_ids || [];
        if (ids.length === 0) return '';
        const parts: string[] = [];
        for (const attr of attributes) {
            const val = attr.values.find((v: any) => ids.includes(v.id));
            if (val) parts.push(`${attr.name}: ${val.value}`);
        }
        return parts.join(', ');
    }, [attributes, rootBOM.attribute_value_ids]);

    // A BOM carrying a Combo value bakes it into the code, so RED and BLUE of the same
    // item read as BOM-<item>-RED-00001 / BOM-<item>-BLUE-00001 instead of racing the
    // same counter on an identical base. Keyed on the VALUE the node holds, not on the
    // item — a greige/beam whose combo is woven in has a per-combo recipe on a shared
    // item, and its code has to say which combo it is.
    const comboCodeToken = useCallback((itemCode: string, attributeValueIds: string[] = []): string | null => {
        if (!comboAttr) return null;
        const val = comboAttr.values.find((v: any) => attributeValueIds.includes(v.id));
        if (!val) return null;
        return String(val.value).toUpperCase().replace(/\s+/g, '');
    }, [comboAttr]);

    const suggestBOMCode = useCallback((itemCode: string, attributeValueIds: string[] = [], config = codeConfig) => {
        const valueNames: string[] = [];
        if (config.includeVariant) {
            for (const attrName of (config.variantAttributeNames ?? [])) {
                const attr = attributes.find((a: any) => a.name === attrName);
                if (!attr) continue;
                const selectedVal = attr.values.find((v: any) => attributeValueIds.includes(v.id));
                if (selectedVal) valueNames.push(selectedVal.value.toUpperCase().replace(/\s+/g, ''));
            }
        }

        // Combo token is implicit — it doesn't need (and isn't controlled by) the code
        // config's variant toggle, so force a variant slot in when the config has none.
        let effConfig = config;
        const combo = comboCodeToken(itemCode, attributeValueIds);
        if (combo && !valueNames.includes(combo)) {
            valueNames.unshift(combo);
            const order = config.segmentOrder ?? DEFAULT_SEGMENT_ORDER;
            const slots = order.filter(s => s === 'attribute').length;
            let nextOrder = order;
            if (slots < valueNames.length) {
                const itemAt = order.indexOf('item');
                const insertAt = itemAt >= 0 ? itemAt + 1 : 0;
                nextOrder = [...order.slice(0, insertAt), 'attribute', ...order.slice(insertAt)];
            }
            effConfig = { ...config, includeVariant: true, segmentOrder: nextOrder };
        }

        let counter = 1;
        let code = buildCodeWithCounter(effConfig, counter, itemCode, valueNames);
        while (existingBOMs.some((b: any) => b.code === code)) {
            counter++;
            code = buildCodeWithCounter(effConfig, counter, itemCode, valueNames);
        }
        return code;
    }, [codeConfig, attributes, existingBOMs, comboCodeToken]);

    const findMatchingAttributeIds = useCallback((childItemCode: string, parentAttrIds: string[]): string[] => {
        // Resolved through getAttrIds, not items.find — a child outside the current
        // items page would otherwise silently inherit nothing.
        const childAttrIds = getAttrIds(childItemCode);
        if (!childAttrIds || childAttrIds.length === 0) return [];
        const matches: string[] = [];
        for (const parentValId of parentAttrIds) {
            let attrName = ''; let valName = '';
            for (const attr of attributes) {
                const val = attr.values.find((v: any) => v.id === parentValId);
                if (val) { attrName = attr.name; valName = val.value; break; }
            }
            if (attrName && valName) {
                const childAttr = attributes.find((a: any) => a.name === attrName && childAttrIds.includes(a.id));
                if (childAttr) {
                    const childVal = childAttr.values.find((v: any) => v.value === valName);
                    if (childVal) matches.push(childVal.id);
                }
            }
        }
        return matches;
    }, [getAttrIds, attributes]);

    // THE inheritance rule — every node-construction site must call this, never
    // findMatchingAttributeIds directly (drifting copies of this logic are how children
    // silently lose or gain variant values).
    //   1. A brand-new item has no attribute master yet, so the parent's values pass
    //      through as-is; an existing item takes only values it can actually hold.
    //   2. Combo gets NO exemption from (1)'s filter. It used to be force-added to every
    //      child regardless of binding, on the theory that combo is woven in — but (1)
    //      already passes the parent's values through wholesale for a brand-new item, so
    //      the only rows the override actually reached were EXISTING items whose master
    //      says they hold no Combo. That stamped a combo onto a combo-agnostic shared
    //      component (a beam cover feeding both the RED and BLUE greige), which MRP
    //      Pass 2 then split into one MO per parent combo. The item master is the
    //      authority: bind Combo to the item to make it combo-specific.
    //      Color needs no counterpart rule: color-type FGs carry no attribute value at
    //      all (they ride color_id), so there is nothing for greige to inherit and it
    //      stays color-agnostic by construction.
    const inheritAttrsFor = useCallback((childItemCode: string, parentAttrIds: string[]): string[] => {
        const parent = parentAttrIds || [];
        if (!getItemByCode(childItemCode)) return [...parent];
        return findMatchingAttributeIds(childItemCode, parent);
    }, [getItemByCode, findMatchingAttributeIds]);

    // Re-derive a whole subtree's variant after the node's OWN values changed. The
    // node's dropdown is the authority: every descendant line and sub-node re-inherits
    // through THE rule above, so a combo cleared here vanishes all the way down instead
    // of lingering on stale descendant lines (which is what MRP keys the split on).
    const reinheritSubtree = useCallback((node: BOMNodeData, attrs: string[]): BOMNodeData => {
        const walk = (n: BOMNodeData, a: string[]): BOMNodeData => ({
            ...n,
            attribute_value_ids: a,
            lines: n.lines.map(line => {
                const childAttrs = inheritAttrsFor(line.item_code, a);
                return {
                    ...line,
                    attribute_value_ids: childAttrs,
                    subBOM: line.subBOM ? walk(line.subBOM, childAttrs) : line.subBOM,
                };
            }),
        });
        return walk(node, attrs);
    }, [inheritAttrsFor]);

    // Which items in this tree already own a BOM. Asked of the server because
    // `existingBOMs` is one root-only page of /boms/summary and therefore blind to
    // exactly the shared sub-assemblies this lookup is for (see /boms/lookup-by-items).
    const treeItemCodes = useMemo(() => {
        const codes = new Set<string>();
        const walk = (node: BOMNodeData, isRoot: boolean) => {
            if (!isRoot && node.item_code) codes.add(node.item_code);
            for (const line of node.lines) {
                if (line.item_code) codes.add(line.item_code);
                if (line.subBOM) walk(line.subBOM, false);
            }
        };
        walk(rootBOM, true);
        return Array.from(codes).sort();
    }, [rootBOM]);
    const treeItemCodesKey = treeItemCodes.join('|');

    useEffect(() => {
        if (!treeItemCodesKey) { setSharedBomByItem({}); return; }
        let cancelled = false;
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/boms/lookup-by-items`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ item_codes: treeItemCodesKey.split('|') }),
                });
                if (!res.ok || cancelled) return;
                const data = await res.json();
                const map: Record<string, SharedBomInfo[]> = {};
                for (const m of (data.matches || [])) {
                    const key = String(m.item_code).trim().toLowerCase();
                    (map[key] ||= []).push({
                        id: String(m.bom_id), code: m.bom_code, attrIds: (m.attribute_value_ids || []).map(String),
                    });
                }
                if (!cancelled) setSharedBomByItem(map);
            } catch { /* leave the map as-is; nothing is marked shared */ }
        })();
        return () => { cancelled = true; };
    }, [treeItemCodesKey]);   // eslint-disable-line react-hooks/exhaustive-deps

    // A node is a SHARED reuse when the item already owns a BOM built for the SAME
    // combo as this node — that recipe is the one this node would produce, so the node
    // is read-only and written by nobody. Matching on the item alone would hand a RED
    // greige recipe to a BLUE tree; matching on combo means a combo-less node reuses
    // the combo-less recipe (beams, greige under a color tree) exactly as before.
    // The root is never shared — it IS the BOM being built.
    const sharedBomForItem = useCallback((itemCode: string, attributeValueIds: string[] = []): SharedBomInfo | null => {
        if (!itemCode) return null;
        const list = sharedBomByItem[itemCode.trim().toLowerCase()];
        if (!list?.length) return null;
        const want = comboKeyOf(attributeValueIds);
        return list.find(b => comboKeyOf(b.attrIds) === want) || null;
    }, [sharedBomByItem, comboKeyOf]);

    const sharedBomFor = useCallback((node: BOMNodeData): SharedBomInfo | null => {
        if (!node || node.id === 'root') return null;
        const info = sharedBomForItem(node.item_code, node.attribute_value_ids);
        if (!info) return null;
        // Editing an existing tree: this node already *is* that BOM, so it stays editable.
        if (node.bomId && String(node.bomId) === info.id) return null;
        return info;
    }, [sharedBomForItem]);

    const getInheritedFields = (source: BOMNodeData) => inheritFields
        ? extractInheritableFields(source)
        : {
            sizes: [], sizeMode: 'sized' as const,
            kerapatan_picks: null, kerapatan_unit: '/cm',
            sisir_no: null, pemakaian_obat: '', pembuatan_sample_oleh: '',
            customer_id: '', work_center_id: '',
            berat_bahan_mateng: null, berat_bahan_mentah_pelesan: null,
            mesin_lebar: null, mesin_panjang_tulisan: null, mesin_panjang_tarikan: null,
            mesin_panjang_tarikan_bandul_1kg: null, mesin_panjang_tarikan_bandul_9kg: null,
            celup_lebar: null, celup_panjang_tulisan: null, celup_panjang_tarikan: null,
            celup_panjang_tarikan_bandul_1kg: null, celup_panjang_tarikan_bandul_9kg: null,
        };

    const handleApplyAutomation = useCallback((levels: string[][], inheritAttributes: boolean[] = []) => {
        if (!rootBOM.item_code) return;

        // Inheritance is per level and opt-in, and always sources from the ROOT — not
        // from whatever the level above happened to resolve to. That keeps a skipped
        // level from severing inheritance for the levels beneath it, and guarantees an
        // unticked level generates children with no attribute values at all.
        const rootAttrs = rootBOM.attribute_value_ids || [];

        const constructTreeRecursive = (levelIdx: number): any[] => {
            if (levelIdx >= levels.length) return [];
            const currentLevelPatterns = levels[levelIdx];
            const inheritsHere = !!inheritAttributes[levelIdx];
            const levelLines: any[] = [];
            for (const pattern of currentLevelPatterns) {
                if (!pattern) continue;
                const expectedChildCode = pattern.replace('{CODE}', rootBOM.item_code);
                // getItemByCode, not items.find — an existing child outside the current
                // items page would otherwise be flagged isNewItem and re-created.
                const isNewItem = !getItemByCode(expectedChildCode);
                const matchingAttrs = !inheritsHere ? [] : inheritAttrsFor(expectedChildCode, rootAttrs);
                const subLines = constructTreeRecursive(levelIdx + 1);
                const subBOM: BOMNodeData = {
                    id: Math.random().toString(36).substr(2, 9),
                    code: suggestBOMCode(expectedChildCode, matchingAttrs),
                    item_code: expectedChildCode,
                    attribute_value_ids: matchingAttrs,
                    qty: 1.0, tolerance_percentage: 0.0, overdelivery_tolerance_percentage: 10.0,
                    operations: [], lines: subLines,
                    ...getInheritedFields(rootBOM),
                    isNewItem,
                };
                levelLines.push({
                    id: Math.random().toString(36).substr(2, 9),
                    item_code: expectedChildCode,
                    attribute_value_ids: matchingAttrs,
                    percentage: 0, qty: 0, source_location_code: '', bom_operation_sequence: null,
                    is_decoupling_point: null,
                    subBOM, isNewItem,
                });
            }
            if (levelLines.length === 1) {
                levelLines[0] = { ...levelLines[0], percentage: 100 };
            }
            return levelLines;
        };

        const newLines = constructTreeRecursive(0);
        setRootBOM(prev => ({ ...prev, lines: newLines }));
    }, [rootBOM.item_code, rootBOM.attribute_value_ids, getItemByCode, inheritAttrsFor, attributes, existingBOMs, suggestBOMCode, inheritFields]);

    // onNodeSaved fires once per BOM actually written (skipped nodes don't call it), so
    // the caller's tally matches the plan's create+update count exactly.
    const saveNode = async (node: BOMNodeData, onNodeSaved?: (n: BOMNodeData) => void): Promise<boolean> => {
        // Shared sub-assembly: the item's one BOM is reused across combos, so this node
        // and its whole subtree are reference-only — nothing is written for them.
        if (sharedBomFor(node)) return true;
        // Resolved via the code lookups (paginated items + cached full index) so
        // inline-created WIP items still inherit the root's uom when the root item
        // sits outside the current items page.
        const rootItem = getItemByCode(rootBOM.item_code);
        let item = getItemByCode(node.item_code);
        if (item) {
            // Item predates this save — creation-time attribute_ids assignment never
            // ran for it, so backfill any attribute type its own value now requires.
            await ensureItemHasAttributes(node.item_code, node.attribute_value_ids);
        } else if (node.isNewItem) {
            const res = await onCreateItem({
                code: node.item_code, name: node.item_code,
                uom: rootItem?.uom || 'kg', category: 'WIP',
                attribute_ids: attributeIdsForValues(node.attribute_value_ids),
                variant_type: variantTypeFor(node.attribute_value_ids)
            });
            if (res.status === 400) {
                // item existed after all (race/stale cache) — backfill same as above
                await ensureItemHasAttributes(node.item_code, node.attribute_value_ids);
            } else if (!res.ok) {
                return false;
            }
        }
        for (const line of node.lines) {
            if (line.subBOM) {
                const success = await saveNode(line.subBOM, onNodeSaved);
                if (!success) return false;
                continue;
            }
            if (line.isNewItem) {
                const res = await onCreateItem({
                    code: line.item_code, name: line.item_code,
                    uom: rootItem?.uom || 'kg', category: 'WIP',
                    attribute_ids: attributeIdsForValues(line.attribute_value_ids),
                    variant_type: variantTypeFor(line.attribute_value_ids)
                });
                if (res?.status === 400) await ensureItemHasAttributes(line.item_code, line.attribute_value_ids);
            } else {
                await ensureItemHasAttributes(line.item_code, line.attribute_value_ids);
            }
        }
        if (node.lines.length === 0 && node.operations.length === 0) return true;
        try {
            const bomId = await onSave(node);
            if (bomId && node.id === 'root') {
                if (pendingPhotoFile && onUploadPhoto) await onUploadPhoto(bomId, pendingPhotoFile);
                if (pendingDesignFile && onUploadDesign) await onUploadDesign(bomId, pendingDesignFile);
            }
            onNodeSaved?.(node);
            return true;
        } catch (e) {
            console.error("Save failed for", node.code, e);
            return false;
        }
    };

    const validatePercentages = (node: BOMNodeData): string | null => {
        // Shared subtrees aren't written, so their draft lines aren't validated.
        if (sharedBomFor(node)) return null;
        if (node.lines.length > 0) {
            const hasZero = node.lines.some(l => (l.percentage || 0) === 0);
            const total = node.lines.reduce((sum, l) => sum + (l.percentage || 0), 0);
            if (hasZero || Math.abs(total - 100) > 0.01) {
                return node.item_code || node.code || 'root';
            }
        }
        for (const line of node.lines) {
            if (line.subBOM) {
                const err = validatePercentages(line.subBOM);
                if (err) return err;
            }
        }
        return null;
    };

    // L2: when a node defines routing operations, every material must be assigned
    // to a step. Mirrors the backend block so the user gets feedback before saving.
    const validateSteps = (node: BOMNodeData): string | null => {
        if (sharedBomFor(node)) return null;
        if (node.operations.length > 0 && node.lines.length > 0) {
            const validSeqs = new Set(node.operations.map((o: any) => o.sequence));
            const bad = node.lines.some(l => l.bom_operation_sequence == null || !validSeqs.has(l.bom_operation_sequence));
            if (bad) return node.item_code || node.code || 'root';
        }
        for (const line of node.lines) {
            if (line.subBOM) {
                const err = validateSteps(line.subBOM);
                if (err) return err;
            }
        }
        return null;
    };

    // Walks the draft tree and describes exactly what saving will do, in the same order
    // and by the same rules as saveNode — including its "no lines and no operations →
    // don't write a BOM" skip. Feeds the confirmation modal; building it here keeps all
    // the code→name/uom/beam lookups in the one component that owns them.
    const buildSavePlan = useCallback((tree: BOMNodeData = rootBOM): BOMPlan => {
        let createCount = 0, updateCount = 0, skipCount = 0;
        const newItemCodes: string[] = [];
        const noteNewItem = (code: string) => {
            if (code && !newItemCodes.includes(code)) newItemCodes.push(code);
        };

        // `sharedWith` carries the shared BOM code down a reused subtree: saveNode
        // returns early on the shared node, so nothing under it is written either.
        const walk = (node: BOMNodeData, depth: number, sharedWith?: string): BOMPlanNode => {
            const shared = sharedWith || sharedBomFor(node)?.code;
            const isSkipped = !!shared || (node.lines.length === 0 && node.operations.length === 0);
            const action: BOMPlanNode['action'] = isSkipped ? 'skip' : (node.bomId ? 'update' : 'create');
            if (action === 'create') createCount++;
            else if (action === 'update') updateCount++;
            else skipCount++;

            // Mirrors saveNode: the node's own item is created when it is flagged new
            // and still absent from both item lookups.
            const nodeItemNew = !shared && !!node.isNewItem && !getItemByCode(node.item_code);
            if (nodeItemNew) noteNewItem(node.item_code);

            const sortedNodeOps = [...(node.operations || [])].sort((a: any, b: any) => a.sequence - b.sequence);
            const stepLabelFor = (seq: number | null): string | null => {
                if (seq == null) return null;
                const op = sortedNodeOps.find((o: any) => o.sequence === seq);
                if (!op) return `Step ${seq}`;
                return `${seq} ${getWcName(op.work_center_id) || ''}`.trim();
            };

            const lines: BOMPlanLine[] = node.lines.map(line => {
                // saveNode only creates items for lines WITHOUT a sub-BOM; a line that
                // drills down has its item created when that child node is walked.
                const lineItemNew = !shared && !!line.isNewItem && !line.subBOM && !getItemByCode(line.item_code);
                if (lineItemNew) noteNewItem(line.item_code);
                return {
                    itemCode: line.item_code,
                    itemName: getItemName(line.item_code),
                    percentage: line.percentage || 0,
                    qty: line.qty || 0,
                    isNewItem: lineItemNew,
                    hasSubBOM: !!line.subBOM,
                    stepLabel: stepLabelFor(line.bom_operation_sequence),
                };
            });

            const beam = isBeamNode(node);
            const sizeCount = (node.sizes || []).length;

            return {
                key: node.id,
                depth,
                bomCode: node.code,
                itemCode: node.item_code,
                itemName: getItemName(node.item_code),
                action,
                skipReason: shared
                    ? (sharedWith
                        ? `Part of shared BOM ${shared} — nothing is written for this node.`
                        : `${node.item_code} already has BOM ${shared}, shared across combos — it is reused as-is and nothing is written for it or its components.`)
                    : isSkipped
                        ? 'No components and no routing steps — no BOM will be written for this node.'
                        : undefined,
                itemWillBeCreated: nodeItemNew,
                qty: node.qty,
                uom: getItemUom(node.item_code),
                qtyLabel: beam
                    ? `${node.qty} utas (warp ends)`
                    : `Batch ${node.qty}${getItemUom(node.item_code) ? ` ${getItemUom(node.item_code)}` : ''}`,
                attributeSummary: (node.attribute_value_ids || []).map(getAttributeValueName).join(', '),
                wastagePct: node.tolerance_percentage ?? 0,
                overdeliveryPct: node.overdelivery_tolerance_percentage ?? 0,
                sizeSummary: sizeCount === 0
                    ? 'No measurements'
                    : `${node.sizeMode === 'free' ? 'Free' : 'Sized'} · ${sizeCount} row${sizeCount === 1 ? '' : 's'}`,
                operations: sortedNodeOps.map((op: any) => ({
                    sequence: op.sequence,
                    label: getWcName(op.work_center_id) || (operations || []).find((o: any) => o.id === op.operation_id)?.name || 'Step',
                    minutes: op.time_minutes || 0,
                })),
                lines,
                children: node.lines
                    .filter(l => l.subBOM)
                    .map(l => walk(l.subBOM!, depth + 1, shared)),
            };
        };

        const root = walk(tree, 0);
        return { root, createCount, updateCount, skipCount, newItemCodes };
    }, [rootBOM, getItemByCode, getItemName, getItemUom, isBeamNode, getAttributeValueName, getWcName, operations, sharedBomFor]);

    // `suggestBOMCode` can only dedup against `existingBOMs`, which is one page of
    // /boms/summary filtered to root BOMs — so a sub-BOM code it generates (e.g.
    // BOM-BEAM Y 357-00001, whose item is a component line elsewhere) is invisible
    // to it and collides on save. The server owns bom.code uniqueness, so ask it to
    // resolve the counters for every node about to be created, then write those codes
    // back into the tree so the confirmation panel shows what will actually be saved.
    const resolveTreeCodes = async (tree: BOMNodeData): Promise<BOMNodeData> => {
        const wanted: string[] = [];
        const collect = (node: BOMNodeData) => {
            // A shared subtree is reused as-is — no node under it needs a code.
            if (sharedBomFor(node)) return;
            const skipped = node.lines.length === 0 && node.operations.length === 0;
            // Updates keep their own code; skipped nodes write no BOM at all.
            if (!skipped && !node.bomId && node.code) wanted.push(node.code);
            node.lines.forEach(l => { if (l.subBOM) collect(l.subBOM); });
        };
        collect(tree);
        if (wanted.length === 0) return tree;

        let resolved: Record<string, string> = {};
        try {
            const res = await authFetch(`${API_BASE}/boms/resolve-codes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codes: wanted }),
            });
            if (!res.ok) return tree;   // fall back to local codes; backend still rejects dups
            resolved = (await res.json()).resolved || {};
        } catch {
            return tree;
        }

        // A repeated desired code maps to one free code, so hand each node the next
        // unused one rather than giving two nodes the same resolution.
        const used = new Set<string>();
        const apply = (node: BOMNodeData): BOMNodeData => {
            if (sharedBomFor(node)) return node;
            const skipped = node.lines.length === 0 && node.operations.length === 0;
            let code = node.code;
            if (!skipped && !node.bomId && node.code) {
                code = resolved[node.code] || node.code;
                while (used.has(code)) code = bumpCodeCounter(code);
                used.add(code);
            }
            return {
                ...node, code,
                lines: node.lines.map(l => l.subBOM ? { ...l, subBOM: apply(l.subBOM) } : l),
            };
        };
        return apply(tree);
    };

    // Validate first, then show the plan. Saving only happens once the user confirms.
    const handleGlobalSave = async () => {
        const pctErr = validatePercentages(rootBOM);
        if (pctErr) {
            setPctError(`Components under "${pctErr}" must all have percentages set and sum to 100%.`);
            return;
        }
        const stepErr = validateSteps(rootBOM);
        if (stepErr) {
            setPctError(`Every material under "${stepErr}" must be assigned a routing step (the BOM has operations).`);
            return;
        }
        setPctError(null);
        // Codes are resolved server-side before the plan is built, so the button is
        // held disabled for that round trip (no double-submit, no stale plan).
        setIsSaving(true);
        let tree: BOMNodeData;
        try {
            tree = await resolveTreeCodes(rootBOM);
        } finally {
            setIsSaving(false);
        }
        setRootBOM(tree);
        setPendingTree(tree);
        setSavePlan(buildSavePlan(tree));
        setIsConfirmOpen(true);
    };

    const handleConfirmedSave = async () => {
        // Total comes from the reviewed plan, so the bar is measured against exactly the
        // BOMs the user approved — skipped nodes are already excluded from these counts.
        const total = savePlan ? savePlan.createCount + savePlan.updateCount : 1;
        let saved = 0;
        const progress = showProgressToast(
            `Saving BOM tree — ${total} BOM${total === 1 ? '' : 's'}`,
            `0 of ${total}`,
        );

        setIsSaving(true);
        const success = await saveNode(pendingTree || rootBOM, (node) => {
            saved++;
            progress.update((saved / total) * 100, `${saved} of ${total} · ${node.item_code || node.code}`);
        });
        setIsSaving(false);
        setIsConfirmOpen(false);

        if (success) {
            progress.finish(`Saved ${saved} BOM${saved === 1 ? '' : 's'}`);
            onCancel();
        } else {
            // Name how far it got — sub-BOMs written before the failure have persisted.
            progress.fail(saved > 0
                ? `BOM save failed after ${saved} of ${total} — ${total - saved} not written`
                : 'BOM save failed — nothing was written');
            // Surface the failure on the designer, not the (now closed) confirmation.
            setPctError('Save failed — check that all items and source locations exist, then retry. Note: sub-BOMs saved before the failure may have persisted.');
        }
    };

    const findNodeAndReplace = (root: BOMNodeData, targetId: string, newNode: BOMNodeData): BOMNodeData => {
        if (root.id === targetId) return newNode;
        return {
            ...root,
            lines: root.lines.map(line => {
                if (!line.subBOM) return line;
                const subBOM = findNodeAndReplace(line.subBOM, targetId, newNode);
                // The line that owns a sub-node carries that node's variant BY DEFINITION —
                // the line's component IS what the sub-BOM produces. Letting the two drift is
                // how a combo cleared on the node stayed stamped on the parent line, which
                // MRP Pass 2 reads as the split key.
                return line.subBOM.id === targetId
                    ? { ...line, subBOM, attribute_value_ids: [...(newNode.attribute_value_ids || [])] }
                    : { ...line, subBOM };
            })
        };
    };

    const findNodeById = (root: BOMNodeData, id: string): BOMNodeData | null => {
        if (root.id === id) return root;
        for (const line of root.lines) {
            if (line.subBOM) {
                const found = findNodeById(line.subBOM, id);
                if (found) return found;
            }
        }
        return null;
    };

    const updateSelectedNode =(updatedFields: Partial<BOMNodeData>) => {
        const selected = findNodeById(rootBOM, selectedNodeId);
        if (!selected) return;
        const newNode = { ...selected, ...updatedFields };
        setRootBOM(prev => findNodeAndReplace(prev, selectedNodeId, newNode));
    };

    const handleSizeChange = (sizeId: string, field: keyof BOMSizeEntry, rawValue: string) => {
        const value = rawValue === '' ? null : parseFloat(rawValue);
        const current = findNodeById(rootBOM, selectedNodeId);
        if (!current) return;
        const currentSizes = current.sizes || [];
        const exists = currentSizes.find(s => s.size_id === sizeId);
        const newSizes = exists
            ? currentSizes.map(s => s.size_id === sizeId ? { ...s, [field]: value } : s)
            : [...currentSizes, { size_id: sizeId, target_measurement: null, measurement_min: null, measurement_max: null, [field]: value }];
        updateSelectedNode({ sizes: newSizes });
    };

    // Memoized so the tree walks run once per data change, not on every render
    // (both were re-walking the whole tree each keystroke).
    const selectedNode = useMemo(() => findNodeById(rootBOM, selectedNodeId), [rootBOM, selectedNodeId]);
    const selectedShared = selectedNode ? sharedBomFor(selectedNode) : null;

    // Count nodes
    const countNodes = (node: BOMNodeData): number =>
        1 + node.lines.reduce((sum, l) => sum + (l.subBOM ? countNodes(l.subBOM) : 0), 0);
    const nodeCount = useMemo(() => countNodes(rootBOM), [rootBOM]);

    // Attributes shown for the selected node (its item's, else root item's). Computed
    // once instead of two items.find scans inside a filter run twice per render.
    const visibleAttributes = useMemo(() => {
        const selCode = (selectedNode?.item_code || '').trim().toLowerCase();
        const rootCode = (rootBOM.item_code || '').trim().toLowerCase();
        // `??` (not `||`) preserves intent: an item KNOWN to have no attributes
        // (a raw material, resolved as []) shows no dropdown, while an item not known
        // to either lookup (undefined) borrows the root item's attributes, as before.
        const allowed = getAttrIds(selCode) ?? getAttrIds(rootCode) ?? [];
        return attributes.filter((a: any) => allowed.includes(a.id));
    }, [attributes, getAttrIds, selectedNode?.item_code, rootBOM.item_code]);

    // How many measurement entries the selected node actually carries. Drives the
    // Clear button's enabled state — in sized mode the grid always renders every
    // master size, so row count is not a usable signal.
    const sizeEntryCount = (selectedNode?.sizes || []).length;

    // Copy/paste buffer for the measurement panel — designer-session scoped, not
    // persisted. Carries sizeMode with the entries because a free-mode entry keys off
    // `label` while a sized one keys off `size_id`; pasting the rows without the mode
    // they were authored in would produce unrenderable entries. Main use: stamp the
    // root's measurements onto each child node.
    const [sizeClipboard, setSizeClipboard] = useState<{ mode: 'sized' | 'free'; sizes: BOMSizeEntry[]; from: string } | null>(null);
    const copySizes = () => {
        if (!selectedNode) return;
        setSizeClipboard({
            mode: selectedNode.sizeMode,
            sizes: (selectedNode.sizes || []).map(s => ({ ...s })),
            from: selectedNode.item_code || selectedNode.code || 'node',
        });
    };
    const pasteSizes = () => {
        if (!sizeClipboard) return;
        // Mode travels with the entries; a sized→free paste (or the reverse) would
        // otherwise render blank rows.
        updateSelectedNode({
            sizeMode: sizeClipboard.mode,
            sizes: sizeClipboard.sizes.map(s => ({ ...s })),
        });
    };

    // Selected node's routing steps, sorted once (was re-sorted twice per render).
    const sortedOps = useMemo(
        () => [...(selectedNode?.operations || [])].sort((a: any, b: any) => a.sequence - b.sequence),
        [selectedNode?.operations],
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 'calc(var(--app-vh) * 80 / 100)', fontFamily: xpFont, fontSize: 11, background: '#ece9d8' }}>
            <CodeConfigModal
                isOpen={isConfigOpen}
                onClose={() => setIsConfigOpen(false)}
                type="BOM"
                onSave={(cfg) => {
                    setCodeConfig(cfg);
                    if (rootBOM.item_code) setRootBOM(p => ({ ...p, code: suggestBOMCode(p.item_code, p.attribute_value_ids, cfg) }));
                }}
                initialConfig={codeConfig}
                attributes={attributes}
            />
            <BOMAutomatorModal
                isOpen={isAutomatorOpen}
                onClose={() => setIsAutomatorOpen(false)}
                onApply={handleApplyAutomation}
                rootAttributeSummary={rootAttributeSummary}
            />
            <BOMConfirmModal
                isOpen={isConfirmOpen}
                plan={savePlan}
                saving={isSaving}
                onConfirm={handleConfirmedSave}
                onClose={() => setIsConfirmOpen(false)}
            />

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                {/* ===== LEFT PANEL: Tree ===== */}
                <div style={{ width: 220, flexShrink: 0, borderRight: '2px solid #aca899', display: 'flex', flexDirection: 'column', background: '#ddd9c8' }}>
                    {/* Sub-titlebar */}
                    <div style={{
                        background: 'linear-gradient(to bottom, #4a78c8, #2a54a8)',
                        padding: '3px 8px',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        flexShrink: 0,
                    }}>
                        <span style={{ color: 'white', fontSize: 11, fontWeight: 'bold' }}><i className="bi bi-diagram-3" style={{ marginRight: 4 }} />Structure</span>
                        <span style={{
                            background: 'rgba(255,255,255,0.2)', color: 'white',
                            fontSize: 9, padding: '0 5px', borderRadius: CHIP_RADIUS,
                        }}>
                            {nodeCount} nodes
                        </span>
                    </div>

                    {/* Tree list */}
                    <div style={{ ...xpInset, flex: 1, margin: 4, marginBottom: 0 }}>
                        <TreeView
                            node={rootBOM}
                            level={0}
                            selectedNodeId={selectedNodeId}
                            items={items}
                            onSelect={setSelectedNodeId}
                            hasExistingBOM={hasExistingBOM}
                            sharedBomFor={sharedBomFor}
                        />
                    </div>

                    {/* Automate button */}
                    <div style={{ padding: 4 }}>
                        <button
                            data-testid="automate-levels-btn"
                            className={XP_BTN}
                            style={{ ...xpBtnPrimary, width: '100%', fontSize: 10, display: selectedNodeId === 'root' ? 'block' : 'none' }}
                            onClick={() => setIsAutomatorOpen(true)}
                        >
                            <i className="bi bi-lightning-fill" style={{ marginRight: 4 }} />Automate All Levels
                        </button>
                    </div>
                </div>

                {/* ===== RIGHT PANEL: Editor ===== */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {selectedNode ? (
                        <>
                            {/* Node title strip */}
                            <div style={{
                                background: 'linear-gradient(to bottom, #e8e4d8, #dddad0)',
                                borderBottom: '1px solid #aca899',
                                padding: '5px 10px',
                                display: 'flex', alignItems: 'center', gap: 8,
                                flexShrink: 0,
                            }}>
                                <span style={{ fontSize: 16, color: '#000080' }}><i className={`bi ${selectedNodeId === 'root' ? 'bi-box-seam' : 'bi-nut'}`} /></span>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 'bold', fontSize: 12, color: '#000080' }}>
                                        {getItemName(selectedNode.item_code) || 'Select an item'}
                                    </div>
                                    <CodeChip code={selectedNode.item_code || '—'} tier={2} style={{ display: 'block' }} />
                                </div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                    {selectedShared && (
                                        <span style={xpBadge('#6a4b9a')}>Shared Recipe</span>
                                    )}
                                    {!selectedShared && selectedNode.isNewItem && (
                                        <span style={xpBadge('#a02020')}>New Inventory Record</span>
                                    )}
                                    {!selectedShared && hasExistingBOM(selectedNode.item_code, selectedNode.attribute_value_ids) && (
                                        <span style={xpBadge('#2a7a2a')}>Existing Recipe</span>
                                    )}
                                </div>
                            </div>

                            {/* The item already has a recipe for this node's combo, so that BOM
                                is shown for reference and never written from here. Edit it by
                                opening that BOM on its own. */}
                            {selectedShared && (
                                <div style={{
                                    flexShrink: 0, margin: '6px 10px 0', padding: '5px 8px',
                                    background: '#efe8f8', border: '1px solid #6a4b9a',
                                    fontFamily: xpFont, fontSize: 10, color: '#3a2a55',
                                    display: 'flex', alignItems: 'flex-start', gap: 6,
                                }}>
                                    <i className="bi bi-link-45deg" style={{ fontSize: 12, marginTop: 1 }} />
                                    <span>
                                        <strong>{selectedNode.item_code}</strong> already has BOM{' '}
                                        <strong style={{ fontFamily: CODE_FONT }}>{selectedShared.code}</strong>
                                        {' '}for this variant. This node is read-only and nothing is written for it
                                        on save — the existing recipe is reused. To change the recipe, open that BOM directly.
                                    </span>
                                </div>
                            )}

                            {/* Scrollable body */}
                            <div style={{
                                flex: 1, overflowY: 'auto', padding: '10px 10px 8px', display: 'flex', flexDirection: 'column', gap: 10,
                                ...(selectedShared ? { opacity: 0.55, pointerEvents: 'none' as const } : {}),
                            }}>

                                {/* BOM Header groupbox */}
                                <LegendPanel title="BOM Header">
                                    <div style={{ padding: '0 8px 8px' }}>
                                    {/* Row 1: Code + Item + Batch + Tolerance */}
                                    <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                                        {/* BOM Code */}
                                        <div style={{ flex: 2, minWidth: 140 }}>
                                            <label style={xpLabel}>
                                                BOM Code
                                                {selectedNodeId === 'root' && (
                                                    <span
                                                        style={{ marginLeft: 6, cursor: 'pointer', fontSize: 12 }}
                                                        onClick={() => setIsConfigOpen(true)}
                                                        title="Code Settings"
                                                    ><i className="bi bi-gear-fill" /></span>
                                                )}
                                            </label>
                                            <input
                                                data-testid="bom-code-input"
                                                style={xpInput}
                                                value={selectedNode.code}
                                                onChange={e => updateSelectedNode({ code: e.target.value })}
                                            />
                                        </div>

                                        {/* Finished Item */}
                                        <div style={{ flex: 3, minWidth: 160 }}>
                                            <label style={xpLabel}>Finished Item</label>
                                            {selectedNodeId === 'root' ? (
                                                <SearchableSelect
                                                    options={items.map((i: any) => ({ value: i.code, label: i.name, subLabel: i.code }))}
                                                    value={selectedNode.item_code}
                                                    onChange={(code: string) => {
                                                        const beamEnds = isBeamCode(code) ? getItemByCode(code)?.ends : null;
                                                        setRootBOM(prev => ({
                                                            ...prev,
                                                            item_code: code,
                                                            code: suggestBOMCode(code, prev.attribute_value_ids),
                                                            attribute_value_ids: [],
                                                            ...(beamEnds != null ? { qty: beamEnds } : {})
                                                        }));
                                                    }}
                                                    placeholder="Select Item..."
                                                    testId="root-item-select"
                                                    onSearch={onSearchItem}
                                                />
                                            ) : (
                                                <div style={{ ...xpInput, height: 'auto', minHeight: 20, display: 'flex', alignItems: 'center', background: '#f0efe6' }}>
                                                    {getItemName(selectedNode.item_code)}
                                                </div>
                                            )}
                                        </div>

                                        {/* Batch Size — for beam items/BEAMING machine this is the warp-ends (utas) count */}
                                        <div style={{ width: isBeamNode(selectedNode) ? 120 : 80 }}>
                                            <label style={xpLabel}>{isBeamNode(selectedNode) ? 'Warp Ends (Utas)' : 'Batch Size'}</label>
                                            <input
                                                data-testid="batch-size-input"
                                                type="number"
                                                style={xpInput}
                                                value={selectedNode.qty}
                                                onChange={e => updateSelectedNode({ qty: parseFloat(e.target.value) || 0 })}
                                            />
                                        </div>

                                        {/* Input-side allowance: inflates component requirements */}
                                        <div style={{ width: 96 }}>
                                            <label style={xpLabel} title="Process wastage: inflates every component requirement by this much for availability checks and MRP.">Wastage %</label>
                                            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                                <input
                                                    data-testid="tolerance-input"
                                                    type="number"
                                                    style={{ ...xpInput, flex: 1 }}
                                                    value={selectedNode.tolerance_percentage}
                                                    onChange={e => updateSelectedNode({ tolerance_percentage: parseFloat(e.target.value) || 0 })}
                                                />
                                                <span style={{ fontSize: 10, color: '#555' }}>%</span>
                                            </div>
                                        </div>

                                        {/* Output-side allowance: how far past an order's qty may be logged */}
                                        <div style={{ width: 110 }}>
                                            <label style={xpLabel} title="Overdelivery: how far past the order quantity the floor may log production. Copied onto every new MO, overridable per order.">Overdelivery %</label>
                                            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                                <input
                                                    data-testid="overdelivery-tolerance-input"
                                                    type="number"
                                                    style={{ ...xpInput, flex: 1 }}
                                                    value={selectedNode.overdelivery_tolerance_percentage}
                                                    onChange={e => updateSelectedNode({ overdelivery_tolerance_percentage: parseFloat(e.target.value) || 0 })}
                                                />
                                                <span style={{ fontSize: 10, color: '#555' }}>%</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Attributes row */}
                                    {visibleAttributes.length > 0 && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                            {visibleAttributes.map((attr: any) => (
                                                <div key={attr.id} style={{ minWidth: 130 }}>
                                                    <label style={{ ...xpLabel, fontSize: 10, color: '#555' }}>{attr.name}</label>
                                                    <SearchableSelect
                                                        testId={`bom-attribute-select-${attr.name}`}
                                                        size="sm"
                                                        options={[
                                                            { value: '', label: 'Any...' },
                                                            ...attr.values.map((v: any) => ({ value: v.id, label: v.value }))
                                                        ]}
                                                        value={selectedNode.attribute_value_ids.find(v => attr.values.some((av: any) => av.id === v)) || ''}
                                                        onChange={(attrValId: string) => {
                                                            const others = selectedNode.attribute_value_ids.filter(v => !attr.values.some((av: any) => av.id === v));
                                                            const newVals = attrValId ? [...others, attrValId] : others;
                                                            // Cascade: descendants re-inherit from the new value, so clearing a
                                                            // combo here clears it on every line below instead of leaving stale
                                                            // tags that MRP still splits on.
                                                            const respread = reinheritSubtree(selectedNode, newVals);
                                                            updateSelectedNode({
                                                                ...respread,
                                                                code: selectedNodeId === 'root' ? suggestBOMCode(selectedNode.item_code, newVals) : selectedNode.code
                                                            });
                                                        }}
                                                        placeholder="Any..."
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Linked sample info strip — root only, when item has a source sample */}
                                    {selectedNodeId === 'root' && (() => {
                                        const selItem = items.find((i: any) => (i.code || '').trim().toLowerCase() === (selectedNode.item_code || '').trim().toLowerCase());
                                        if (!selItem?.source_sample_code) return null;
                                        return (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#eef4ff', border: '1px solid #b0c8e8', padding: '4px 8px', marginTop: 2 }}>
                                                <span style={{ fontSize: 10, color: '#003080', fontWeight: 'bold', whiteSpace: 'nowrap' }}>Linked Sample:</span>
                                                <CodeChip code={selItem.source_sample_code} tone="accent" />
                                                {selItem.source_color_name && (
                                                    <span style={{ borderRadius: CHIP_RADIUS, fontSize: 10, color: '#333', background: '#d8e8f8', border: '1px solid #b0c8e8', padding: '0 6px', whiteSpace: 'nowrap' }}>
                                                        {selItem.source_color_name}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {/* Customer + Machine selectors */}
                                    {(
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2, flexWrap: 'wrap' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <label style={{ ...xpLabel, marginBottom: 0, whiteSpace: 'nowrap', minWidth: 60 }}>Customer</label>
                                                <div style={{ width: 200 }}>
                                                    <SearchableSelect
                                                        options={[
                                                            { value: '', label: '— None —' },
                                                            ...(partners || [])
                                                                .filter((p: any) => p.type === 'CUSTOMER' && p.active !== false)
                                                                .map((p: any) => ({ value: p.id, label: p.name }))
                                                        ]}
                                                        value={selectedNode.customer_id || ''}
                                                        onChange={(val: string) => updateSelectedNode({ customer_id: val })}
                                                        placeholder="— None —"
                                                    />
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <label style={{ ...xpLabel, marginBottom: 0, whiteSpace: 'nowrap', minWidth: 50 }}>Machine</label>
                                                <div style={{ width: 200 }}>
                                                    <SearchableSelect
                                                        options={[
                                                            { value: '', label: '— None —' },
                                                            ...(workCenters || []).filter((wc: any) => !wc.parent_id).map((wc: any) => ({ value: wc.id, label: wc.name }))
                                                        ]}
                                                        value={selectedNode.work_center_id || ''}
                                                        onChange={(val: string) => updateSelectedNode({ work_center_id: val })}
                                                        placeholder="— None —"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    </div>
                                </LegendPanel>

                                {/* Sizes + Detail Teknis + Measurements row */}
                                {(
                                    <div style={{ display: 'flex', gap: 10 }}>

                                        {/* Left: Size Measurements */}
                                        <LegendPanel
                                            title="Measurements (cm)"
                                            style={{ flexShrink: 0 }}
                                        >
                                            <div style={{ padding: '0 8px 8px' }}>
                                            {/* Toggle lives in the body, not the border line — was in
                                                LegendPanel's `right` slot which pins to the top border. */}
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginBottom: 4 }}>
                                                <span style={{ fontSize: 9, color: '#555' }}>Sizes</span>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const next = selectedNode.sizeMode === 'sized' ? 'free' : 'sized';
                                                        updateSelectedNode({ sizeMode: next, sizes: [] });
                                                    }}
                                                    title={selectedNode.sizeMode === 'sized' ? 'Switch to free labels' : 'Switch to size labels'}
                                                    style={{
                                                        width: 32, height: 14, padding: 0, cursor: 'pointer', flexShrink: 0,
                                                        border: '1px solid #7f9db9', borderRadius: 3,
                                                        background: selectedNode.sizeMode === 'sized' ? '#316ac5' : '#aca899',
                                                        position: 'relative',
                                                        transition: 'background 0.15s',
                                                    }}
                                                >
                                                    {/* Knob insets 2px from the track on both sides in either
                                                        position — the old split-colour track + border-flush knob
                                                        made the switch look sliced in half rather than sliding. */}
                                                    <span style={{
                                                        position: 'absolute',
                                                        width: 10, height: 10,
                                                        borderRadius: 2,
                                                        background: '#fff',
                                                        boxShadow: '0 1px 2px rgba(0,0,0,0.45)',
                                                        left: selectedNode.sizeMode === 'sized' ? 1 : 19,
                                                        top: 1,
                                                        transition: 'left 0.15s',
                                                    }} />
                                                </button>
                                                <span style={{ fontSize: 9, color: '#555' }}>Free</span>
                                            </div>
                                            {/* Sized mode */}
                                            {selectedNode.sizeMode === 'sized' && (sizes || []).length > 0 && (
                                                <div style={{ display: 'grid', gridTemplateColumns: '32px 52px 48px 12px 48px', gap: '3px 4px', alignItems: 'center' }}>
                                                    <div />
                                                    <span style={{ ...xpLabel, fontSize: 10, color: '#555', marginBottom: 0 }}>Target</span>
                                                    <span style={{ ...xpLabel, fontSize: 10, color: '#555', marginBottom: 0 }}>Min</span>
                                                    <div />
                                                    <span style={{ ...xpLabel, fontSize: 10, color: '#555', marginBottom: 0 }}>Max</span>
                                                    {(sizes || []).map((size: any) => {
                                                        const entry = (selectedNode?.sizes || []).find((s: BOMSizeEntry) => s.size_id === size.id);
                                                        return (
                                                            <React.Fragment key={size.id}>
                                                                <span style={{ ...xpLabel, fontWeight: 'bold', fontSize: 11, marginBottom: 0 }}>{size.name}</span>
                                                                <input type="number" style={{ ...xpInput, height: 19 }} placeholder="—"
                                                                    value={entry?.target_measurement ?? ''}
                                                                    onChange={e => handleSizeChange(size.id, 'target_measurement', e.target.value)} />
                                                                <input type="number" style={{ ...xpInput, height: 19 }} placeholder="—"
                                                                    value={entry?.measurement_min ?? ''}
                                                                    onChange={e => handleSizeChange(size.id, 'measurement_min', e.target.value)} />
                                                                <span style={{ textAlign: 'center', fontSize: 11, color: '#555', fontWeight: 'bold', lineHeight: '19px' }}>—</span>
                                                                <input type="number" style={{ ...xpInput, height: 19 }} placeholder="—"
                                                                    value={entry?.measurement_max ?? ''}
                                                                    onChange={e => handleSizeChange(size.id, 'measurement_max', e.target.value)} />
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {/* Free mode */}
                                            {selectedNode.sizeMode === 'free' && (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                                    {/* Column headers */}
                                                    <div style={{ display: 'grid', gridTemplateColumns: '80px 52px 48px 12px 48px 18px', gap: '0 4px', alignItems: 'center' }}>
                                                        <span style={{ ...xpLabel, fontSize: 10, color: '#555', marginBottom: 0 }}>Label</span>
                                                        <span style={{ ...xpLabel, fontSize: 10, color: '#555', marginBottom: 0 }}>Target</span>
                                                        <span style={{ ...xpLabel, fontSize: 10, color: '#555', marginBottom: 0 }}>Min</span>
                                                        <div />
                                                        <span style={{ ...xpLabel, fontSize: 10, color: '#555', marginBottom: 0 }}>Max</span>
                                                        <div />
                                                    </div>
                                                    {/* Rows */}
                                                    {(selectedNode.sizes || []).map((entry, idx) => (
                                                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '80px 52px 48px 12px 48px 18px', gap: '0 4px', alignItems: 'center' }}>
                                                            <input type="text" style={{ ...xpInput, height: 19 }} placeholder="Label..."
                                                                value={entry.label || ''}
                                                                onChange={e => {
                                                                    const newSizes = [...(selectedNode.sizes || [])];
                                                                    newSizes[idx] = { ...newSizes[idx], label: e.target.value };
                                                                    updateSelectedNode({ sizes: newSizes });
                                                                }} />
                                                            <input type="number" style={{ ...xpInput, height: 19 }} placeholder="—"
                                                                value={entry.target_measurement ?? ''}
                                                                onChange={e => {
                                                                    const newSizes = [...(selectedNode.sizes || [])];
                                                                    newSizes[idx] = { ...newSizes[idx], target_measurement: e.target.value === '' ? null : parseFloat(e.target.value) };
                                                                    updateSelectedNode({ sizes: newSizes });
                                                                }} />
                                                            <input type="number" style={{ ...xpInput, height: 19 }} placeholder="—"
                                                                value={entry.measurement_min ?? ''}
                                                                onChange={e => {
                                                                    const newSizes = [...(selectedNode.sizes || [])];
                                                                    newSizes[idx] = { ...newSizes[idx], measurement_min: e.target.value === '' ? null : parseFloat(e.target.value) };
                                                                    updateSelectedNode({ sizes: newSizes });
                                                                }} />
                                                            <span style={{ textAlign: 'center', fontSize: 11, color: '#555', fontWeight: 'bold', lineHeight: '19px' }}>—</span>
                                                            <input type="number" style={{ ...xpInput, height: 19 }} placeholder="—"
                                                                value={entry.measurement_max ?? ''}
                                                                onChange={e => {
                                                                    const newSizes = [...(selectedNode.sizes || [])];
                                                                    newSizes[idx] = { ...newSizes[idx], measurement_max: e.target.value === '' ? null : parseFloat(e.target.value) };
                                                                    updateSelectedNode({ sizes: newSizes });
                                                                }} />
                                                            <button type="button" className={XP_BTN} style={{ ...xpBtnDanger, padding: '0 3px', minWidth: 'auto', height: 19 }}
                                                                onClick={() => updateSelectedNode({ sizes: (selectedNode.sizes || []).filter((_, i) => i !== idx) })}>
                                                                ×
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Placeholder when sized mode but no sizes configured */}
                                            {selectedNode.sizeMode === 'sized' && (sizes || []).length === 0 && (
                                                <div style={{ fontSize: 10, color: '#888', fontStyle: 'italic' }}>No sizes configured.</div>
                                            )}

                                            {/* Footer actions, below the inputs in both modes. Add Row is
                                                free-mode only (sized mode renders off the master size list).
                                                Hidden only when sized mode has no master sizes AND nothing is
                                                stored on the node — otherwise entries could get stranded with
                                                no Clear to reach them. */}
                                            {(!(selectedNode.sizeMode === 'sized' && (sizes || []).length === 0) || sizeEntryCount > 0) && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                                                    {selectedNode.sizeMode === 'free' && (
                                                        <button type="button" className={XP_BTN} style={{ ...xpBtn, padding: '1px 6px', minWidth: 'auto', fontSize: 10 }}
                                                            onClick={() => updateSelectedNode({ sizes: [...(selectedNode.sizes || []), { size_id: '', label: '', target_measurement: null, measurement_min: null, measurement_max: null }] })}>
                                                            + Add Row
                                                        </button>
                                                    )}
                                                    {/* Copy → Paste stamps one node's measurements onto another
                                                        (typically root → each child), mode included. */}
                                                    <button
                                                        type="button"
                                                        className={XP_BTN}
                                                        disabled={sizeEntryCount === 0}
                                                        onClick={copySizes}
                                                        title={sizeEntryCount === 0 ? 'No measurements to copy' : 'Copy these measurements'}
                                                        style={{ ...xpBtnInfo, padding: '1px 6px', ...(sizeEntryCount === 0 ? xpBtnDisabled : {}) }}
                                                    >
                                                        Copy
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={XP_BTN}
                                                        disabled={!sizeClipboard}
                                                        onClick={pasteSizes}
                                                        title={sizeClipboard
                                                            ? `Paste ${sizeClipboard.sizes.length} measurement row(s) copied from ${sizeClipboard.from} (replaces what is here)`
                                                            : 'Nothing copied yet'}
                                                        style={{ ...xpBtnInfo, padding: '1px 6px', ...(!sizeClipboard ? xpBtnDisabled : {}) }}
                                                    >
                                                        Paste
                                                    </button>
                                                    {/* Wipes every measurement entry on this node, keeping the current
                                                        mode. Sized mode: grid stays and goes blank. Free: rows go away. */}
                                                    <button
                                                        type="button"
                                                        className={XP_BTN}
                                                        disabled={sizeEntryCount === 0}
                                                        onClick={() => updateSelectedNode({ sizes: [] })}
                                                        title={sizeEntryCount === 0 ? 'No measurements to clear' : 'Clear all measurements on this node'}
                                                        style={{ ...xpBtnDanger, padding: '1px 6px', fontSize: 10, ...(sizeEntryCount === 0 ? xpBtnDisabled : {}) }}
                                                    >
                                                        Clear
                                                    </button>
                                                </div>
                                            )}
                                            </div>
                                        </LegendPanel>

                                        {/* Detail Teknis */}
                                        <LegendPanel title="Detail Teknis" style={{ flexShrink: 0 }}>
                                            <div style={{ padding: '0 8px 8px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

                                                {/* Kerapatan/Picks */}
                                                <div>
                                                    <label style={xpLabel}>Kerapatan / Picks</label>
                                                    <div style={{ display: 'flex', gap: 4 }}>
                                                        <input type="number" style={{ ...xpInput, flex: 1 }}
                                                            value={selectedNode?.kerapatan_picks ?? ''}
                                                            onChange={e => updateSelectedNode({ kerapatan_picks: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                                                        <select style={{ ...xpSelect, width: 60 }}
                                                            value={selectedNode?.kerapatan_unit || '/cm'}
                                                            onChange={e => updateSelectedNode({ kerapatan_unit: e.target.value })}>
                                                            <option value="/cm">/cm</option>
                                                            <option value="/inch">/inch</option>
                                                        </select>
                                                    </div>
                                                </div>

                                                {/* Sisir no. */}
                                                <div>
                                                    <label style={xpLabel}>Sisir no.</label>
                                                    <input type="number" style={xpInput}
                                                        value={selectedNode?.sisir_no ?? ''}
                                                        onChange={e => updateSelectedNode({ sisir_no: e.target.value === '' ? null : parseInt(e.target.value, 10) })} />
                                                </div>

                                                {/* Pemakaian Obat */}
                                                <div>
                                                    <label style={xpLabel}>Pemakaian Obat U/ Setting</label>
                                                    <input type="text" style={xpInput}
                                                        value={selectedNode?.pemakaian_obat || ''}
                                                        onChange={e => updateSelectedNode({ pemakaian_obat: e.target.value })} />
                                                </div>

                                                {/* Pembuatan sample */}
                                                <div>
                                                    <label style={xpLabel}>Pembuatan sample dikerjakan oleh</label>
                                                    <input type="text" style={xpInput}
                                                        value={selectedNode?.pembuatan_sample_oleh || ''}
                                                        onChange={e => updateSelectedNode({ pembuatan_sample_oleh: e.target.value })} />
                                                </div>

                                                {/* Berat Bahan */}
                                                <div>
                                                    <label style={xpLabel}>Berat Bahan Mateng</label>
                                                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                        <input type="number" style={{ ...xpInput, flex: 1 }} placeholder="—"
                                                            value={selectedNode?.berat_bahan_mateng ?? ''}
                                                            onChange={e => updateSelectedNode({ berat_bahan_mateng: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                                                        <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>gr/yard</span>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label style={xpLabel}>Berat Bahan Mentah (Pelesan 1 Jam)</label>
                                                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                        <input type="number" style={{ ...xpInput, flex: 1 }} placeholder="—"
                                                            value={selectedNode?.berat_bahan_mentah_pelesan ?? ''}
                                                            onChange={e => updateSelectedNode({ berat_bahan_mentah_pelesan: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                                                        <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>gr/yard</span>
                                                    </div>
                                                </div>

                                                {/* Product Sample Photo — root only */}
                                                {selectedNodeId === 'root' && <div>
                                                    <label style={xpLabel}>Product Sample Photo</label>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <input type="file" accept="image/*" id="bom-sample-photo"
                                                            style={{ display: 'none' }}
                                                            onChange={e => setPendingPhotoFile(e.target.files?.[0] || null)} />
                                                        <button type="button" className={XP_BTN} style={{ ...xpBtn, padding: '1px 8px' }}
                                                            onClick={() => (document.getElementById('bom-sample-photo') as HTMLInputElement)?.click()}>
                                                            Browse...
                                                        </button>
                                                        <span style={{ fontFamily: xpFont, fontSize: 10, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                                                            {pendingPhotoFile ? pendingPhotoFile.name : 'No file chosen'}
                                                        </span>
                                                    </div>
                                                    {pendingPhotoFile && (
                                                        <img
                                                            src={URL.createObjectURL(pendingPhotoFile)}
                                                            alt="Sample photo"
                                                            title="Click to preview"
                                                            onClick={() => setPhotoPreview(URL.createObjectURL(pendingPhotoFile!))}
                                                            style={{ marginTop: 4, maxHeight: 64, maxWidth: '100%', border: '1px solid #b0a898', display: 'block', cursor: 'pointer', objectFit: 'cover' }}
                                                        />
                                                    )}
                                                </div>}

                                                {/* Design / Formula File — root only */}
                                                {selectedNodeId === 'root' && <div>
                                                    <label style={xpLabel}>Design / Susunan Rumusan</label>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <input type="file" accept="image/*,.pdf" id="bom-design-file"
                                                            style={{ display: 'none' }}
                                                            onChange={e => setPendingDesignFile(e.target.files?.[0] || null)} />
                                                        <button type="button" className={XP_BTN} style={{ ...xpBtn, padding: '1px 8px' }}
                                                            onClick={() => (document.getElementById('bom-design-file') as HTMLInputElement)?.click()}>
                                                            Browse...
                                                        </button>
                                                        <span style={{ fontFamily: xpFont, fontSize: 10, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                                                            {pendingDesignFile ? pendingDesignFile.name : 'No file chosen'}
                                                        </span>
                                                    </div>
                                                    {pendingDesignFile && pendingDesignFile.type.startsWith('image/') && (
                                                        <img
                                                            src={URL.createObjectURL(pendingDesignFile)}
                                                            alt="Design preview"
                                                            style={{ marginTop: 4, maxHeight: 48, maxWidth: '100%', border: '1px solid #b0a898', display: 'block', objectFit: 'cover' }}
                                                        />
                                                    )}
                                                    {pendingDesignFile && pendingDesignFile.type === 'application/pdf' && (
                                                        <div style={{ marginTop: 4, fontSize: 10, color: '#555', background: '#f5f3ee', border: '1px solid #c0bdb5', padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                            <i className="bi bi-file-earmark-pdf" style={{ color: '#c00' }} />
                                                            {pendingDesignFile.name}
                                                        </div>
                                                    )}
                                                </div>}

                                            </div>
                                            </div>
                                        </LegendPanel>

                                        {/* Bahan Keluar Dari Mesin */}
                                        <LegendPanel title="Bahan Keluar Dari Mesin" style={{ flex: 1 }}>
                                            <div style={{ padding: '0 8px 8px' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px', gap: '4px 6px', alignItems: 'center' }}>
                                                <label style={{ ...xpLabel, marginBottom: 0 }}>Lebar</label>
                                                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                                    <input type="number" style={{ ...xpInput, flex: 1 }} placeholder="—"
                                                        value={selectedNode?.mesin_lebar ?? ''}
                                                        onChange={e => updateSelectedNode({ mesin_lebar: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                                                    <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>mm</span>
                                                </div>
                                                <label style={{ ...xpLabel, marginBottom: 0 }}>Panjang Tulisan</label>
                                                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                                    <input type="number" style={{ ...xpInput, flex: 1 }} placeholder="—"
                                                        value={selectedNode?.mesin_panjang_tulisan ?? ''}
                                                        onChange={e => updateSelectedNode({ mesin_panjang_tulisan: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                                                    <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>cm</span>
                                                </div>
                                                <label style={{ ...xpLabel, marginBottom: 0, fontSize: 10 }}>Panjang Tarikan <span style={{ color: '#888' }}>(10cm)</span></label>
                                                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                                    <input type="number" style={{ ...xpInput, flex: 1 }} placeholder="—"
                                                        value={selectedNode?.mesin_panjang_tarikan ?? ''}
                                                        onChange={e => updateSelectedNode({ mesin_panjang_tarikan: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                                                    <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>cm</span>
                                                </div>
                                                <label style={{ ...xpLabel, marginBottom: 0, fontSize: 10 }}>Tarikan Bandul 1kg <span style={{ color: '#888' }}>(10cm)</span></label>
                                                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                                    <input type="number" style={{ ...xpInput, flex: 1 }} placeholder="—"
                                                        value={selectedNode?.mesin_panjang_tarikan_bandul_1kg ?? ''}
                                                        onChange={e => updateSelectedNode({ mesin_panjang_tarikan_bandul_1kg: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                                                    <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>cm</span>
                                                </div>
                                                <label style={{ ...xpLabel, marginBottom: 0, fontSize: 10 }}>Tarikan Bandul 9kg <span style={{ color: '#888' }}>(10cm)</span></label>
                                                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                                    <input type="number" style={{ ...xpInput, flex: 1 }} placeholder="—"
                                                        value={selectedNode?.mesin_panjang_tarikan_bandul_9kg ?? ''}
                                                        onChange={e => updateSelectedNode({ mesin_panjang_tarikan_bandul_9kg: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                                                    <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>cm</span>
                                                </div>
                                            </div>
                                            </div>
                                        </LegendPanel>

                                        {/* Bahan Dari Celup / Setting */}
                                        <LegendPanel title="Bahan Dari Celup / Setting" style={{ flex: 1 }}>
                                            <div style={{ padding: '0 8px 8px' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px', gap: '4px 6px', alignItems: 'center' }}>
                                                <label style={{ ...xpLabel, marginBottom: 0 }}>Lebar</label>
                                                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                                    <input type="number" style={{ ...xpInput, flex: 1 }} placeholder="—"
                                                        value={selectedNode?.celup_lebar ?? ''}
                                                        onChange={e => updateSelectedNode({ celup_lebar: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                                                    <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>mm</span>
                                                </div>
                                                <label style={{ ...xpLabel, marginBottom: 0 }}>Panjang Tulisan</label>
                                                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                                    <input type="number" style={{ ...xpInput, flex: 1 }} placeholder="—"
                                                        value={selectedNode?.celup_panjang_tulisan ?? ''}
                                                        onChange={e => updateSelectedNode({ celup_panjang_tulisan: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                                                    <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>cm</span>
                                                </div>
                                                <label style={{ ...xpLabel, marginBottom: 0, fontSize: 10 }}>Panjang Tarikan <span style={{ color: '#888' }}>(10cm)</span></label>
                                                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                                    <input type="number" style={{ ...xpInput, flex: 1 }} placeholder="—"
                                                        value={selectedNode?.celup_panjang_tarikan ?? ''}
                                                        onChange={e => updateSelectedNode({ celup_panjang_tarikan: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                                                    <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>cm</span>
                                                </div>
                                                <label style={{ ...xpLabel, marginBottom: 0, fontSize: 10 }}>Tarikan Bandul 1kg <span style={{ color: '#888' }}>(10cm)</span></label>
                                                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                                    <input type="number" style={{ ...xpInput, flex: 1 }} placeholder="—"
                                                        value={selectedNode?.celup_panjang_tarikan_bandul_1kg ?? ''}
                                                        onChange={e => updateSelectedNode({ celup_panjang_tarikan_bandul_1kg: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                                                    <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>cm</span>
                                                </div>
                                                <label style={{ ...xpLabel, marginBottom: 0, fontSize: 10 }}>Tarikan Bandul 9kg <span style={{ color: '#888' }}>(10cm)</span></label>
                                                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                                    <input type="number" style={{ ...xpInput, flex: 1 }} placeholder="—"
                                                        value={selectedNode?.celup_panjang_tarikan_bandul_9kg ?? ''}
                                                        onChange={e => updateSelectedNode({ celup_panjang_tarikan_bandul_9kg: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                                                    <span style={{ fontSize: 9, color: '#555', whiteSpace: 'nowrap' }}>cm</span>
                                                </div>
                                            </div>
                                            </div>
                                        </LegendPanel>

                                    </div>
                                )}

                                {/* Components */}
                                <div style={{ display: 'flex', gap: 10, flex: 1, alignItems: 'flex-start' }}>

                                    {/* Components */}
                                    <div style={{ flex: 1 }}>
                                        <LegendPanel title="Components">
                                            <div style={{ padding: '0 8px 8px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                                {inheritFields && (
                                                    <button
                                                        className={XP_BTN}
                                                        style={{ ...xpBtnInfo, fontSize: 9, padding: '1px 6px' }}
                                                        title="Copy current node fields to all child BOMs"
                                                        onClick={() => setRootBOM(prev => applyFieldsToDescendants(prev, extractInheritableFields(rootBOM)))}
                                                    >Re-apply to children</button>
                                                )}
                                                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#444', cursor: 'pointer', userSelect: 'none' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={inheritFields}
                                                        onChange={e => {
                                                            const checked = e.target.checked;
                                                            setInheritFields(checked);
                                                            if (checked) {
                                                                setRootBOM(prev => applyFieldsToDescendants(prev, extractInheritableFields(prev)));
                                                            }
                                                        }}
                                                        style={{ margin: 0 }}
                                                    />
                                                    Inherit fields to child BOMs
                                                </label>
                                            </div>

                                            {/* Add component row */}
                                            <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                                <div style={{ flex: 3, minWidth: 120 }}>
                                                    <label style={{ ...xpLabel, fontSize: 10 }}>
                                                        Item
                                                        {pendingItemCode && getItemUom(pendingItemCode) && (
                                                            <span style={{ borderRadius: CHIP_RADIUS, marginLeft: 5, fontSize: 9, fontWeight: 'normal', background: '#dde8f5', border: '1px solid #7f9db9', padding: '0 4px', color: '#336' }}>
                                                                {getItemUom(pendingItemCode)}
                                                            </span>
                                                        )}
                                                    </label>
                                                    <SearchableSelect
                                                        options={items.map((i: any) => ({ value: i.code, label: i.name, subLabel: i.code }))}
                                                        value={pendingItemCode}
                                                        onChange={setPendingItemCode}
                                                        placeholder="Component..."
                                                        testId="component-select"
                                                        onSearch={onSearchItem}
                                                        size="sm"
                                                    />
                                                </div>
                                                <div style={{ width: 60 }}>
                                                    <label style={{ ...xpLabel, fontSize: 10 }}>%</label>
                                                    <input
                                                        type="number"
                                                        style={xpInput}
                                                        placeholder="0"
                                                        min="0"
                                                        max="100"
                                                        value={pendingPercentage}
                                                        onChange={e => setPendingPercentage(e.target.value)}
                                                        data-testid="component-pct-input"
                                                    />
                                                </div>
                                                <div style={{ width: 60 }}>
                                                    <label style={{ ...xpLabel, fontSize: 10 }}>{isBeamNode(selectedNode) ? 'Ends' : 'Qty'}</label>
                                                    <input
                                                        type="number"
                                                        style={xpInput}
                                                        placeholder="—"
                                                        min="0"
                                                        title={isBeamNode(selectedNode) ? 'Warp ends contributed by this yarn' : undefined}
                                                        value={pendingQty}
                                                        onChange={e => setPendingQty(e.target.value)}
                                                    />
                                                </div>
                                                <button
                                                    className={XP_BTN}
                                                    style={{ ...xpBtnPrimary, minWidth: 'auto', padding: '2px 10px', alignSelf: 'flex-end' }}
                                                    onClick={() => {
                                                        if (pendingItemCode) {
                                                            // getItemByCode (not items.some), so an existing item sitting
                                                            // off the current items page isn't wrongly flagged new.
                                                            const exists = !!getItemByCode(pendingItemCode);
                                                            const attributeValueIds = inheritAttrsFor(pendingItemCode, selectedNode.attribute_value_ids);
                                                            const newLine: BOMLineNode = {
                                                                id: Math.random().toString(36).substr(2, 9),
                                                                item_code: pendingItemCode,
                                                                attribute_value_ids: attributeValueIds,
                                                                percentage: parseFloat(pendingPercentage) || 0,
                                                                qty: parseFloat(pendingQty) || 0,
                                                                source_location_code: '',
                                                                bom_operation_sequence: null,
                                                                is_decoupling_point: null,
                                                                isNewItem: !exists
                                                            };
                                                            const newLines = [...selectedNode.lines, newLine];
                                                            if (newLines.length === 1 && newLines[0].percentage === 0) {
                                                                newLines[0] = { ...newLines[0], percentage: 100 };
                                                            }
                                                            updateSelectedNode({ lines: newLines });
                                                            setPendingItemCode('');
                                                            setPendingPercentage('');
                                                            setPendingQty('');
                                                        }
                                                    }}
                                                    data-testid="add-component-btn"
                                                >+ Add</button>
                                            </div>

                                            {/* Component list */}
                                            <div style={{ ...xpInset, maxHeight: 260, padding: 0 }}>
                                                {selectedNode.lines.length > 0 && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px', background: '#ece9d8', borderBottom: '1px solid #aca899', fontSize: 9, color: '#555', fontWeight: 'bold' }}>
                                                        <span style={{ flex: 1 }}>Component</span>
                                                        <span style={{ width: 57, textAlign: 'right' }}>%</span>
                                                        <span style={{ width: 48, textAlign: 'right' }}>{isBeamNode(selectedNode) ? 'Ends' : 'Qty'}</span>
                                                        {selectedNode.operations.length > 0 && <span style={{ width: 80 }}>Step</span>}
                                                        <span style={{ width: 96, flexShrink: 0 }}></span>
                                                    </div>
                                                )}
                                                {selectedNode.lines.length === 0 && (
                                                    <div style={{ padding: 6, fontSize: 10, color: '#888', fontStyle: 'italic' }}>No components added.</div>
                                                )}
                                                {selectedNode.lines.map((line, i) => (
                                                    <div key={line.id} style={{
                                                        display: 'flex', alignItems: 'center', gap: 6,
                                                        padding: '4px 6px',
                                                        borderBottom: '1px solid #e8e4d8',
                                                        background: i % 2 === 0 ? 'white' : '#f8f7f2',
                                                    }}>
                                                        <span style={{ flex: 1, fontWeight: 'bold', fontSize: 11 }}>
                                                            {getItemName(line.item_code)}
                                                            {getItemUom(line.item_code) && (
                                                                <span style={{ borderRadius: CHIP_RADIUS, marginLeft: 5, fontSize: 9, fontWeight: 'normal', background: '#dde8f5', border: '1px solid #7f9db9', padding: '0 4px', color: '#336' }}>
                                                                    {getItemUom(line.item_code)}
                                                                </span>
                                                            )}
                                                        </span>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                            <input
                                                                type="number"
                                                                title="Percentage"
                                                                placeholder="0"
                                                                min="0"
                                                                max="100"
                                                                style={{ ...xpInput, width: 48, textAlign: 'right', padding: '1px 3px' }}
                                                                value={line.percentage || ''}
                                                                onChange={e => {
                                                                    const pct = parseFloat(e.target.value) || 0;
                                                                    const newLines = [...selectedNode.lines];
                                                                    newLines[i] = { ...line, percentage: pct };
                                                                    updateSelectedNode({ lines: newLines });
                                                                }}
                                                            />
                                                            <span style={{ fontSize: 9, color: '#666' }}>%</span>
                                                        </div>
                                                        <input
                                                            type="number"
                                                            title={isBeamNode(selectedNode) ? 'Warp ends contributed by this yarn' : 'Quantity (note only)'}
                                                            placeholder="—"
                                                            min="0"
                                                            style={{ ...xpInput, width: 48, textAlign: 'right', padding: '1px 3px' }}
                                                            value={line.qty || ''}
                                                            onChange={e => {
                                                                const qty = parseFloat(e.target.value) || 0;
                                                                const newLines = [...selectedNode.lines];
                                                                newLines[i] = { ...line, qty };
                                                                updateSelectedNode({ lines: newLines });
                                                            }}
                                                        />
                                                        {selectedNode.operations.length > 0 && (
                                                            <select
                                                                title="Routing step that consumes this material"
                                                                style={{ ...xpInput, width: 80, fontSize: 9, padding: '1px 2px' }}
                                                                value={line.bom_operation_sequence != null ? String(line.bom_operation_sequence) : ''}
                                                                onChange={e => {
                                                                    const newLines = [...selectedNode.lines];
                                                                    newLines[i] = { ...line, bom_operation_sequence: e.target.value ? parseInt(e.target.value) : null };
                                                                    updateSelectedNode({ lines: newLines });
                                                                }}
                                                            >
                                                                <option value="">Any step</option>
                                                                {sortedOps.map((op: any) => {
                                                                    const wc = workCenters?.find((w: any) => w.id === op.work_center_id);
                                                                    return (
                                                                        <option key={op._key} value={String(op.sequence)}>
                                                                            {op.sequence} - {wc?.name || 'Op'}
                                                                        </option>
                                                                    );
                                                                })}
                                                            </select>
                                                        )}
                                                        {(line.subBOM || hasExistingBOM(line.item_code, line.attribute_value_ids) || sharedBomForItem(line.item_code, line.attribute_value_ids)) && (
                                                            <select
                                                                title="MRP planning for this material: Auto follows the item-master default; Pool (make-to-stock) records demand but creates no sub-order here — replenish it on a standalone pooled order; Make here forces an inline sub-order even if the item is make-to-stock."
                                                                style={{ ...xpInput, width: 92, fontSize: 9, padding: '1px 2px' }}
                                                                value={line.is_decoupling_point == null ? '' : (line.is_decoupling_point ? 'y' : 'n')}
                                                                onChange={e => {
                                                                    const v = e.target.value;
                                                                    const newLines = [...selectedNode.lines];
                                                                    newLines[i] = { ...line, is_decoupling_point: v === '' ? null : v === 'y' };
                                                                    updateSelectedNode({ lines: newLines });
                                                                }}
                                                            >
                                                                <option value="">Auto (inherit)</option>
                                                                <option value="y">Pool (MTS)</option>
                                                                <option value="n">Make here</option>
                                                            </select>
                                                        )}
                                                        <div style={{ width: 96, flexShrink: 0, display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                                                            {/* Item already has a recipe for this exact combo: nothing to
                                                                define here, that BOM is reused. */}
                                                            {sharedBomForItem(line.item_code, line.attribute_value_ids) && !line.subBOM && (
                                                                <span
                                                                    style={xpBadge('#6a4b9a')}
                                                                    title={`Reuses existing BOM ${sharedBomForItem(line.item_code, line.attribute_value_ids)!.code}`}
                                                                >SHARED</span>
                                                            )}
                                                            {!sharedBomForItem(line.item_code, line.attribute_value_ids) && !hasExistingBOM(line.item_code, line.attribute_value_ids) && !line.subBOM && (
                                                                <button className={XP_BTN} style={xpBtnInfo} onClick={() => {
                                                                    const subNode: BOMNodeData = {
                                                                        id: Math.random().toString(36).substr(2, 9),
                                                                        code: suggestBOMCode(line.item_code, line.attribute_value_ids),
                                                                        item_code: line.item_code,
                                                                        attribute_value_ids: line.attribute_value_ids,
                                                                        qty: 1.0, tolerance_percentage: 0.0, overdelivery_tolerance_percentage: 10.0,
                                                                        operations: [], lines: [],
                                                                        ...getInheritedFields(selectedNode),
                                                                        isNewItem: line.isNewItem
                                                                    };
                                                                    const newLines = [...selectedNode.lines];
                                                                    newLines[i] = { ...line, subBOM: subNode };
                                                                    updateSelectedNode({ lines: newLines });
                                                                    setSelectedNodeId(subNode.id);
                                                                }}>
                                                                    Define BOM
                                                                </button>
                                                            )}
                                                            {line.subBOM && (
                                                                <button className={XP_BTN} style={xpBtnInfo} onClick={() => setSelectedNodeId(line.subBOM!.id)}>
                                                                    Draft ▶
                                                                </button>
                                                            )}
                                                            <button
                                                                className={XP_BTN}
                                                                style={xpBtnDanger}
                                                                onClick={() => {
                                                                    const newLines = selectedNode.lines.filter((_, idx) => idx !== i);
                                                                    if (newLines.length === 1 && newLines[0].percentage === 0) {
                                                                        newLines[0] = { ...newLines[0], percentage: 100 };
                                                                    }
                                                                    updateSelectedNode({ lines: newLines });
                                                                }}
                                                            >X</button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            {/* Percentage total indicator */}
                                            {(() => {
                                                if (selectedNode.lines.length === 0) return null;
                                                const nodePct = selectedNode.lines.reduce((sum, l) => sum + (l.percentage || 0), 0);
                                                const hasZero = selectedNode.lines.some(l => (l.percentage || 0) === 0);
                                                const isValid = !hasZero && Math.abs(nodePct - 100) < 0.01;
                                                return (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', borderTop: '1px solid #aca899', background: '#ece9d8' }}>
                                                        <span style={{ fontSize: 10, color: '#555', flex: 1 }}>Total %:</span>
                                                        <span style={xpBadge(isValid ? '#2a7a2a' : '#a02020')}>{nodePct.toFixed(1)}%</span>
                                                        {!isValid && <span style={{ fontSize: 10, color: '#a02020' }}>{hasZero ? 'set all percentages' : 'must = 100%'}</span>}
                                                    </div>
                                                );
                                            })()}
                                            </div>
                                        </LegendPanel>
                                    </div>

                                    {/* Routing Steps */}
                                    <div style={{ width: 240, flexShrink: 0 }}>
                                        <LegendPanel title="Routing Steps">
                                            <div style={{ padding: '0 8px 8px' }}>
                                            {/* Existing steps list */}
                                            <div style={{ ...xpInset, marginBottom: 6, padding: 0, minHeight: 40 }}>
                                                {selectedNode.operations.length === 0 && (
                                                    <div style={{ padding: '4px 6px', fontSize: 10, color: '#888', fontStyle: 'italic' }}>No routing steps.</div>
                                                )}
                                                {sortedOps.map((op: any, i: number) => {
                                                    const wc = workCenters?.find((w: any) => w.id === op.work_center_id);
                                                    const opType = operations?.find((o: any) => o.id === op.operation_id);
                                                    return (
                                                        <div key={op._key || i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px', borderBottom: '1px solid #d4d0c8', fontSize: 10 }}>
                                                            <span style={{ width: 22, textAlign: 'center', color: '#555', fontWeight: 'bold' }}>{op.sequence}</span>
                                                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wc?.name || '—'}</span>
                                                            {opType && <span style={{ fontSize: 9, color: '#555', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opType.name}</span>}
                                                            <span style={{ width: 36, textAlign: 'right', color: '#666' }}>{op.time_minutes || 0}m</span>
                                                            <button
                                                                className={XP_BTN}
                                                                style={{ ...xpBtnDanger, padding: '0 4px', fontSize: 10, minWidth: 'auto' }}
                                                                onClick={() => {
                                                                    const newOps = selectedNode.operations.filter((o: any) => o._key !== op._key);
                                                                    updateSelectedNode({ operations: newOps });
                                                                }}
                                                            >X</button>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Add step form */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                                <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end' }}>
                                                    <div style={{ width: 36 }}>
                                                        <label style={{ ...xpLabel, fontSize: 9 }}>Seq</label>
                                                        <input
                                                            type="number"
                                                            style={{ ...xpInput, width: '100%' }}
                                                            placeholder="10"
                                                            value={pendingOpSeq}
                                                            onChange={e => setPendingOpSeq(e.target.value)}
                                                        />
                                                    </div>
                                                    <div style={{ flex: 1 }}>
                                                        <label style={{ ...xpLabel, fontSize: 9 }}>Work Center</label>
                                                        <select
                                                            style={{ ...xpInput, width: '100%' }}
                                                            value={pendingOpWc}
                                                            onChange={e => setPendingOpWc(e.target.value)}
                                                        >
                                                            <option value="">— Select —</option>
                                                            {(workCenters || []).filter((wc: any) => !wc.parent_id).map((wc: any) => (
                                                                <option key={wc.id} value={wc.id}>{wc.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end' }}>
                                                    <div style={{ flex: 1 }}>
                                                        <label style={{ ...xpLabel, fontSize: 9 }}>Operation Type</label>
                                                        <select
                                                            style={{ ...xpInput, width: '100%' }}
                                                            value={pendingOpType}
                                                            onChange={e => setPendingOpType(e.target.value)}
                                                        >
                                                            <option value="">— None —</option>
                                                            {(operations || []).map((o: any) => (
                                                                <option key={o.id} value={o.id}>{o.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div style={{ width: 44 }}>
                                                        <label style={{ ...xpLabel, fontSize: 9 }}>Min</label>
                                                        <input
                                                            type="number"
                                                            style={{ ...xpInput, width: '100%' }}
                                                            placeholder="0"
                                                            value={pendingOpTime}
                                                            onChange={e => setPendingOpTime(e.target.value)}
                                                        />
                                                    </div>
                                                </div>
                                                <button
                                                    className={XP_BTN}
                                                    style={{ ...xpBtnPrimary, minWidth: 'auto', alignSelf: 'flex-end' }}
                                                    onClick={() => {
                                                        if (!pendingOpWc) return;
                                                        const nextSeq = pendingOpSeq
                                                            ? parseInt(pendingOpSeq)
                                                            : (selectedNode.operations.length > 0
                                                                ? Math.max(...selectedNode.operations.map((o: any) => o.sequence)) + 10
                                                                : 10);
                                                        const newOp = {
                                                            _key: Math.random().toString(36).substr(2, 9),
                                                            operation_id: pendingOpType || null,
                                                            work_center_id: pendingOpWc,
                                                            sequence: nextSeq,
                                                            time_minutes: parseFloat(pendingOpTime) || 0,
                                                        };
                                                        updateSelectedNode({ operations: [...selectedNode.operations, newOp] });
                                                        setPendingOpSeq('');
                                                        setPendingOpWc('');
                                                        setPendingOpType('');
                                                        setPendingOpTime('');
                                                    }}
                                                >+ Add Step</button>
                                            </div>
                                            </div>
                                        </LegendPanel>
                                    </div>

                                </div>
                            </div>
                        </>
                    ) : (
                        <div style={{
                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#888', fontSize: 12, fontStyle: 'italic',
                        }}>
                            Select a part from the tree to edit its recipe
                        </div>
                    )}

                    {/* Footer */}
                    <div style={{
                        borderTop: '1px solid #aca899',
                        background: '#ece9d8',
                        padding: '5px 10px',
                        display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6,
                        flexShrink: 0,
                    }}>
                        {pctError && (
                            <span style={{ flex: 1, fontSize: 10, color: '#a02020', fontFamily: xpFont }}>
                                <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 4 }} />{pctError}
                            </span>
                        )}
                        <button className={XP_BTN} style={xpBtn} onClick={onCancel}>{t('cancel')}</button>
                        <button
                            className={XP_BTN}
                            data-testid="save-bom-tree-btn"
                            style={{ ...xpBtnSuccess, opacity: isSaving ? 0.6 : 1 }}
                            onClick={handleGlobalSave}
                            disabled={isSaving}
                        >
                            {isSaving ? 'Processing...' : <><i className="bi bi-save" style={{ marginRight: 4 }} />Finish &amp; Save Tree</>}
                        </button>
                    </div>
                </div>
            </div>

            {/* Photo preview overlay */}
            {photoPreview && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ background: '#ece9d8', border: '2px solid #0a246a', borderRadius: 4, overflow: 'hidden', maxWidth: 'calc(var(--app-vw) * 80 / 100)', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ background: 'linear-gradient(to right, #0a246a, #a6caf0, #0a246a)', padding: '3px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none' }}>
                        <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 12, fontFamily: xpFont, textShadow: '1px 1px 2px rgba(0,0,0,0.6)' }}>Product Sample Photo</span>
                        <button onClick={() => setPhotoPreview(null)} style={{ width: 21, height: 21, padding: 0, background: 'linear-gradient(to bottom, #e06060, #b03030)', border: '1px solid #800', borderRadius: 2, cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
                    </div>
                    <div style={{ background: '#1e1e1e', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
                        <img src={photoPreview} alt="Sample" style={{ maxWidth: 'calc(var(--app-vw) * 72 / 100)', maxHeight: 'calc(var(--app-vh) * 62 / 100)', objectFit: 'contain', display: 'block' }} />
                    </div>
                    <div style={{ padding: '5px 8px', display: 'flex', justifyContent: 'flex-end', gap: 4, background: '#f0efe6', borderTop: '1px solid #ccc' }}>
                        <button className={XP_BTN} style={{ ...xpBtn, padding: '2px 10px' }} onClick={() => window.open(photoPreview, '_blank')}>
                            ↗ Open Full View
                        </button>
                        <button className={XP_BTN} style={{ ...xpBtn, padding: '2px 10px' }} onClick={() => setPhotoPreview(null)}>
                            Close
                        </button>
                    </div>
                </div>
            </div>
        )}
        </div>
    );
}
