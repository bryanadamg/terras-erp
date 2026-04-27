import React, { useState, useEffect, useCallback, memo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import CodeConfigModal, { CodeConfig, buildCodeWithCounter } from '../shared/CodeConfigModal';
import BOMAutomatorModal from './BOMAutomatorModal';
import SearchableSelect from '../shared/SearchableSelect';

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
    qty: number;
    percentage: number;
    is_percentage: boolean;
    source_location_code: string;
    subBOM?: BOMNodeData;
    isNewItem?: boolean;
}

interface BOMNodeData {
    id: string;
    code: string;
    item_code: string;
    attribute_value_ids: string[];
    qty: number;
    tolerance_percentage: number;
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
const xpFont = 'Tahoma, "Segoe UI", sans-serif';

const xpBtn: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11,
    padding: '2px 10px',
    background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)',
    borderTop: '1px solid #fff', borderLeft: '1px solid #fff',
    borderRight: '1px solid #555', borderBottom: '1px solid #555',
    cursor: 'pointer', whiteSpace: 'nowrap', color: '#000',
};

const xpBtnPrimary: React.CSSProperties = {
    ...xpBtn,
    background: 'linear-gradient(to bottom, #b4d0f8, #7aacf0)',
    borderTopColor: '#c8e0ff', borderLeftColor: '#c8e0ff',
    fontWeight: 'bold', color: '#00007a', minWidth: 80,
};

const xpBtnSuccess: React.CSSProperties = {
    ...xpBtn,
    background: 'linear-gradient(to bottom, #b0e8b0, #70c870)',
    borderTopColor: '#d0f0d0', borderLeftColor: '#d0f0d0',
    fontWeight: 'bold', color: '#004000', minWidth: 100,
};

const xpBtnDanger: React.CSSProperties = {
    ...xpBtn,
    background: 'linear-gradient(to bottom, #f8d0d0, #e0a0a0)',
    color: '#800000', minWidth: 'auto', padding: '1px 5px', fontSize: 10,
};

const xpBtnInfo: React.CSSProperties = {
    ...xpBtn,
    background: 'linear-gradient(to bottom, #d0e8f8, #90c8e8)',
    borderTopColor: '#e8f4ff', borderLeftColor: '#e8f4ff',
    color: '#003060', minWidth: 'auto', padding: '1px 8px', fontSize: 10,
};

const xpBtnWarning: React.CSSProperties = {
    ...xpBtn,
    background: 'linear-gradient(to bottom, #fff0b0, #e8d060)',
    color: '#604000', minWidth: 'auto', padding: '1px 8px', fontSize: 10,
};

const xpInput: React.CSSProperties = {
    fontFamily: xpFont, fontSize: 11,
    border: '1px solid #7f9db9', borderTopColor: '#5a7fa8',
    background: 'white', height: 20, padding: '0 4px',
    outline: 'none', width: '100%',
};

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

const xpGroupWrapper: React.CSSProperties = {
    border: '1px solid #aca899', borderRadius: 3,
    padding: '14px 8px 8px', background: '#f5f4ee',
    position: 'relative',
};

const xpGroupLabel = (bg = '#f5f4ee'): React.CSSProperties => ({
    position: 'absolute', top: -8, left: 8,
    background: bg, padding: '0 4px',
    fontSize: 10, fontWeight: 'bold', color: '#000080',
    fontFamily: xpFont,
});

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
const TreeView = memo(({
    node, level = 0, selectedNodeId, items, onSelect, hasExistingBOM
}: {
    node: BOMNodeData, level: number, selectedNodeId: string,
    items: any[], onSelect: (id: string) => void,
    hasExistingBOM: (code: string) => boolean
}) => {
    const itemExists = items.some((i: any) => (i.code || '').trim().toLowerCase() === (node.item_code || '').trim().toLowerCase());
    const recipeExists = hasExistingBOM(node.item_code);
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
                <span style={{ fontSize: 12 }}>{level === 0 ? '📦' : '🔩'}</span>
                <span style={{ flex: 1, fontWeight: level === 0 ? 'bold' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {node.item_code || 'Unnamed'}
                </span>
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                    {recipeExists && <span style={xpBadge('#2a7a2a')}>RECIPE✓</span>}
                    {!recipeExists && hasLocalDef && <span style={xpBadge('#316ac5')}>DRAFT</span>}
                    {!itemExists && <span style={xpBadge('#a02020')}>NEW</span>}
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
                />
            ))}
        </div>
    );
});
TreeView.displayName = 'TreeView';

const STATIC_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000').replace(/\/api$/, '');

export default function BOMDesigner({
    rootItemCode,
    initialAttributeValueIds,
    items,
    locations,
    attributes,
    sizes,
    partners,
    workCenters,
    operations,
    onSave,
    onCreateItem,
    onUploadPhoto,
    onUploadDesign,
    onCancel,
    existingBOMs,
    onSearchItem
}: any) {
    const { t } = useLanguage();

    const [rootBOM, setRootBOM] = useState<BOMNodeData>({
        id: 'root', code: '',
        item_code: rootItemCode || '',
        attribute_value_ids: initialAttributeValueIds || [],
        qty: 1.0, tolerance_percentage: 0.0,
        operations: [], lines: [], sizes: [],
        kerapatan_picks: null, kerapatan_unit: '/cm',
        sisir_no: null, pemakaian_obat: '', pembuatan_sample_oleh: '',
        customer_id: '', work_center_id: '', sizeMode: 'sized',
        berat_bahan_mateng: null, berat_bahan_mentah_pelesan: null,
        mesin_lebar: null, mesin_panjang_tulisan: null, mesin_panjang_tarikan: null,
        mesin_panjang_tarikan_bandul_1kg: null, mesin_panjang_tarikan_bandul_9kg: null,
        celup_lebar: null, celup_panjang_tulisan: null, celup_panjang_tarikan: null,
        celup_panjang_tarikan_bandul_1kg: null, celup_panjang_tarikan_bandul_9kg: null,
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
    const [pendingQty, setPendingQty] = useState<string>('');
    const [pendingPercentage, setPendingPercentage] = useState<string>('');
    const [pctError, setPctError] = useState<string | null>(null);

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

    const getItemName = useCallback((code: string) =>
        items.find((i: any) => (i.code || '').trim().toLowerCase() === (code || '').trim().toLowerCase())?.name || code,
    [items]);

    const hasExistingBOM = useCallback((code: string) => {
        const item = items.find((i: any) => (i.code || '').trim().toLowerCase() === (code || '').trim().toLowerCase());
        return item && existingBOMs.some((b: any) => b.item_id === item.id);
    }, [items, existingBOMs]);

    const getWcName = (id: string) => workCenters.find((wc: any) => wc.id === id)?.name || id;

    const getAttributeValueName = (valId: string) => {
        for (const attr of attributes) {
            const val = attr.values.find((v: any) => v.id === valId);
            if (val) return val.value;
        }
        return valId;
    };

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
        let counter = 1;
        let code = buildCodeWithCounter(config, counter, itemCode, valueNames);
        while (existingBOMs.some((b: any) => b.code === code)) {
            counter++;
            code = buildCodeWithCounter(config, counter, itemCode, valueNames);
        }
        return code;
    }, [codeConfig, attributes, existingBOMs]);

    const findMatchingAttributeIds = useCallback((childItemCode: string, parentAttrIds: string[]): string[] => {
        const childItem = items.find((i: any) =>
            (i.code || '').trim().toLowerCase() === (childItemCode || '').trim().toLowerCase()
        );
        if (!childItem || !childItem.attribute_ids) return [];
        const matches: string[] = [];
        for (const parentValId of parentAttrIds) {
            let attrName = ''; let valName = '';
            for (const attr of attributes) {
                const val = attr.values.find((v: any) => v.id === parentValId);
                if (val) { attrName = attr.name; valName = val.value; break; }
            }
            if (attrName && valName) {
                const childAttr = attributes.find((a: any) => a.name === attrName && childItem.attribute_ids.includes(a.id));
                if (childAttr) {
                    const childVal = childAttr.values.find((v: any) => v.value === valName);
                    if (childVal) matches.push(childVal.id);
                }
            }
        }
        return matches;
    }, [items, attributes]);

    const getInheritedFields = (source: BOMNodeData) => inheritFields ? {
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
    } : {
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

    const handleApplyAutomation = useCallback((levels: string[][]) => {
        if (!rootBOM.item_code) return;

        const constructTreeRecursive = (parentAttrs: string[], levelIdx: number): any[] => {
            if (levelIdx >= levels.length) return [];
            const currentLevelPatterns = levels[levelIdx];
            const levelLines: any[] = [];
            for (const pattern of currentLevelPatterns) {
                if (!pattern) continue;
                const expectedChildCode = pattern.replace('{CODE}', rootBOM.item_code);
                const childItem = items.find((i: any) =>
                    (i.code || '').trim().toLowerCase() === (expectedChildCode || '').trim().toLowerCase()
                );
                const isNewItem = !childItem;
                const matchingAttrs = isNewItem ? parentAttrs : findMatchingAttributeIds(expectedChildCode, parentAttrs);
                const subLines = constructTreeRecursive(matchingAttrs, levelIdx + 1);
                const subBOM: BOMNodeData = {
                    id: Math.random().toString(36).substr(2, 9),
                    code: suggestBOMCode(expectedChildCode, matchingAttrs),
                    item_code: expectedChildCode,
                    attribute_value_ids: matchingAttrs,
                    qty: 1.0, tolerance_percentage: 0.0,
                    operations: [], lines: subLines,
                    ...getInheritedFields(rootBOM),
                    isNewItem,
                };
                levelLines.push({
                    id: Math.random().toString(36).substr(2, 9),
                    item_code: expectedChildCode,
                    attribute_value_ids: matchingAttrs,
                    qty: 1.0, percentage: 0, is_percentage: false, source_location_code: '',
                    subBOM, isExpanded: true, isNewItem,
                });
            }
            return levelLines;
        };

        const newLines = constructTreeRecursive(rootBOM.attribute_value_ids, 0);
        setRootBOM(prev => ({ ...prev, lines: newLines }));
    }, [rootBOM.item_code, rootBOM.attribute_value_ids, items, attributes, existingBOMs, suggestBOMCode, inheritFields]);

    const saveNode = async (node: BOMNodeData): Promise<boolean> => {
        const rootItem = items.find((i: any) => (i.code || '').trim().toLowerCase() === (rootBOM.item_code || '').trim().toLowerCase());
        let item = items.find((i: any) => (i.code || '').trim().toLowerCase() === (node.item_code || '').trim().toLowerCase());
        if (!item && node.isNewItem) {
            const res = await onCreateItem({
                code: node.item_code, name: node.item_code,
                uom: rootItem?.uom || 'pcs', category: 'WIP',
                attribute_ids: rootItem?.attribute_ids || []
            });
            if (res.status === 400) {
                // item exists, continue
            } else if (!res.ok) {
                return false;
            }
        }
        for (const line of node.lines) {
            if (line.isNewItem && !line.subBOM) {
                await onCreateItem({
                    code: line.item_code, name: line.item_code,
                    uom: rootItem?.uom || 'pcs', category: 'WIP',
                    attribute_ids: rootItem?.attribute_ids || []
                });
            }
            if (line.subBOM) {
                const success = await saveNode(line.subBOM);
                if (!success) return false;
            }
        }
        if (node.lines.length === 0 && node.operations.length === 0) return true;
        try {
            const bomId = await onSave(node);
            if (bomId && node.id === 'root') {
                if (pendingPhotoFile && onUploadPhoto) await onUploadPhoto(bomId, pendingPhotoFile);
                if (pendingDesignFile && onUploadDesign) await onUploadDesign(bomId, pendingDesignFile);
            }
            return true;
        } catch (e) {
            console.error("Save failed for", node.code, e);
            return false;
        }
    };

    const validatePercentages = (node: BOMNodeData): string | null => {
        if (node.lines.length > 0) {
            const total = node.lines.reduce((sum, l) => sum + (l.percentage || 0), 0);
            const hasAny = node.lines.some(l => (l.percentage || 0) > 0);
            if (hasAny && Math.abs(total - 100) > 0.01) {
                return node.item_code || 'root';
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

    const handleGlobalSave = async () => {
        const pctErr = validatePercentages(rootBOM);
        if (pctErr) {
            setPctError(`Percentages for "${pctErr}" must sum to 100%.`);
            return;
        }
        setPctError(null);
        setIsSaving(true);
        const success = await saveNode(rootBOM);
        setIsSaving(false);
        if (success) onCancel();
    };

    const findNodeAndReplace = (root: BOMNodeData, targetId: string, newNode: BOMNodeData): BOMNodeData => {
        if (root.id === targetId) return newNode;
        return {
            ...root,
            lines: root.lines.map(line => ({
                ...line,
                subBOM: line.subBOM ? findNodeAndReplace(line.subBOM, targetId, newNode) : undefined
            }))
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

    const updateSelectedNode = (updatedFields: Partial<BOMNodeData>) => {
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

    const selectedNode = findNodeById(rootBOM, selectedNodeId);

    // Count nodes
    const countNodes = (node: BOMNodeData): number =>
        1 + node.lines.reduce((sum, l) => sum + (l.subBOM ? countNodes(l.subBOM) : 0), 0);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '80vh', fontFamily: xpFont, fontSize: 11, background: '#ece9d8' }}>
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
                        <span style={{ color: 'white', fontSize: 11, fontWeight: 'bold' }}>📁 Structure</span>
                        <span style={{
                            background: 'rgba(255,255,255,0.2)', color: 'white',
                            fontSize: 9, padding: '0 5px', borderRadius: 2,
                        }}>
                            {countNodes(rootBOM)} nodes
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
                        />
                    </div>

                    {/* Automate button */}
                    <div style={{ padding: 4 }}>
                        <button
                            data-testid="automate-levels-btn"
                            style={{ ...xpBtnPrimary, width: '100%', fontSize: 10, display: selectedNodeId === 'root' ? 'block' : 'none' }}
                            onClick={() => setIsAutomatorOpen(true)}
                        >
                            ⚡ Automate All Levels
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
                                <span style={{ fontSize: 16 }}>{selectedNodeId === 'root' ? '📦' : '🔩'}</span>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 'bold', fontSize: 12, color: '#000080' }}>
                                        {getItemName(selectedNode.item_code) || 'Select an item'}
                                    </div>
                                    <div style={{ fontSize: 9, color: '#555', fontFamily: '"Courier New", monospace' }}>
                                        {selectedNode.item_code || '—'}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                    {selectedNode.isNewItem && (
                                        <span style={xpBadge('#a02020')}>New Inventory Record</span>
                                    )}
                                    {hasExistingBOM(selectedNode.item_code) && (
                                        <span style={xpBadge('#2a7a2a')}>Existing Recipe</span>
                                    )}
                                </div>
                            </div>

                            {/* Scrollable body */}
                            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>

                                {/* BOM Header groupbox */}
                                <div style={xpGroupWrapper}>
                                    <span style={xpGroupLabel()}>BOM Header</span>

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
                                                    >⚙</span>
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
                                                        setRootBOM(prev => ({
                                                            ...prev,
                                                            item_code: code,
                                                            code: suggestBOMCode(code, prev.attribute_value_ids),
                                                            attribute_value_ids: []
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

                                        {/* Batch Size */}
                                        <div style={{ width: 80 }}>
                                            <label style={xpLabel}>Batch Size</label>
                                            <input
                                                data-testid="batch-size-input"
                                                type="number"
                                                style={xpInput}
                                                value={selectedNode.qty}
                                                onChange={e => updateSelectedNode({ qty: parseFloat(e.target.value) })}
                                            />
                                        </div>

                                        {/* Tolerance */}
                                        <div style={{ width: 80 }}>
                                            <label style={xpLabel}>Tolerance %</label>
                                            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                                <input
                                                    data-testid="tolerance-input"
                                                    type="number"
                                                    style={{ ...xpInput, flex: 1 }}
                                                    value={selectedNode.tolerance_percentage}
                                                    onChange={e => updateSelectedNode({ tolerance_percentage: parseFloat(e.target.value) })}
                                                />
                                                <span style={{ fontSize: 10, color: '#555' }}>%</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Attributes row */}
                                    {attributes.filter((a: any) => {
                                        const itm = items.find((i: any) => (i.code || '').trim().toLowerCase() === (selectedNode.item_code || '').trim().toLowerCase());
                                        const rootItm = items.find((i: any) => (i.code || '').trim().toLowerCase() === (rootBOM.item_code || '').trim().toLowerCase());
                                        return (itm?.attribute_ids || rootItm?.attribute_ids || []).includes(a.id);
                                    }).length > 0 && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                            {attributes.filter((a: any) => {
                                                const itm = items.find((i: any) => (i.code || '').trim().toLowerCase() === (selectedNode.item_code || '').trim().toLowerCase());
                                                const rootItm = items.find((i: any) => (i.code || '').trim().toLowerCase() === (rootBOM.item_code || '').trim().toLowerCase());
                                                return (itm?.attribute_ids || rootItm?.attribute_ids || []).includes(a.id);
                                            }).map((attr: any) => (
                                                <div key={attr.id} style={{ minWidth: 130 }}>
                                                    <label style={{ ...xpLabel, fontSize: 10, color: '#555' }}>{attr.name}</label>
                                                    <select
                                                        data-testid={`bom-attribute-select-${attr.name}`}
                                                        style={xpSelect}
                                                        value={selectedNode.attribute_value_ids.find(v => attr.values.some((av: any) => av.id === v)) || ''}
                                                        onChange={e => {
                                                            const attrValId = e.target.value;
                                                            const others = selectedNode.attribute_value_ids.filter(v => !attr.values.some((av: any) => av.id === v));
                                                            const newVals = attrValId ? [...others, attrValId] : others;
                                                            updateSelectedNode({
                                                                attribute_value_ids: newVals,
                                                                code: selectedNodeId === 'root' ? suggestBOMCode(selectedNode.item_code, newVals) : selectedNode.code
                                                            });
                                                        }}
                                                    >
                                                        <option value="">Any...</option>
                                                        {attr.values.map((v: any) => <option key={v.id} value={v.id}>{v.value}</option>)}
                                                    </select>
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
                                                <span style={{ fontFamily: '"Courier New", monospace', fontSize: 10, background: '#fff', border: '1px solid #b0c8e8', padding: '0 5px', color: '#0000cc', whiteSpace: 'nowrap' }}>
                                                    {selItem.source_sample_code}
                                                </span>
                                                {selItem.source_color_name && (
                                                    <span style={{ fontSize: 10, color: '#333', background: '#d8e8f8', border: '1px solid #b0c8e8', padding: '0 6px', whiteSpace: 'nowrap' }}>
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
                                                            ...(workCenters || []).map((wc: any) => ({ value: wc.id, label: wc.name }))
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

                                {/* Sizes + Detail Teknis + Measurements row */}
                                {(
                                    <div style={{ display: 'flex', gap: 8 }}>

                                        {/* Left: Size Measurements */}
                                        <div style={{ ...xpGroupWrapper, flexShrink: 0 }}>
                                            {/* Header with toggle */}
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                                <span style={xpGroupLabel()}>Measurements (cm)</span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                                                    <span style={{ fontSize: 9, color: '#555' }}>Sizes</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const next = selectedNode.sizeMode === 'sized' ? 'free' : 'sized';
                                                            updateSelectedNode({ sizeMode: next, sizes: [] });
                                                        }}
                                                        title={selectedNode.sizeMode === 'sized' ? 'Switch to free labels' : 'Switch to size labels'}
                                                        style={{
                                                            width: 34, height: 14, padding: 0, cursor: 'pointer',
                                                            border: '1px solid #7f9db9',
                                                            background: selectedNode.sizeMode === 'sized'
                                                                ? 'linear-gradient(to right, #316ac5 50%, #d4d0c8 50%)'
                                                                : 'linear-gradient(to right, #d4d0c8 50%, #316ac5 50%)',
                                                            position: 'relative', display: 'flex', alignItems: 'center',
                                                        }}
                                                    >
                                                        <span style={{
                                                            position: 'absolute',
                                                            width: 14, height: 12,
                                                            background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)',
                                                            border: '1px solid #888',
                                                            left: selectedNode.sizeMode === 'sized' ? 0 : 18,
                                                            top: 0,
                                                            transition: 'left 0.1s',
                                                        }} />
                                                    </button>
                                                    <span style={{ fontSize: 9, color: '#555' }}>Free</span>
                                                </div>
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
                                                            <button type="button" style={{ ...xpBtnDanger, padding: '0 3px', minWidth: 'auto', height: 19 }}
                                                                onClick={() => updateSelectedNode({ sizes: (selectedNode.sizes || []).filter((_, i) => i !== idx) })}>
                                                                ×
                                                            </button>
                                                        </div>
                                                    ))}
                                                    {/* Add row button */}
                                                    <button type="button" style={{ ...xpBtn, padding: '1px 6px', marginTop: 2, alignSelf: 'flex-start', fontSize: 10 }}
                                                        onClick={() => updateSelectedNode({ sizes: [...(selectedNode.sizes || []), { size_id: '', label: '', target_measurement: null, measurement_min: null, measurement_max: null }] })}>
                                                        + Add Row
                                                    </button>
                                                </div>
                                            )}

                                            {/* Placeholder when sized mode but no sizes configured */}
                                            {selectedNode.sizeMode === 'sized' && (sizes || []).length === 0 && (
                                                <div style={{ fontSize: 10, color: '#888', fontStyle: 'italic' }}>No sizes configured.</div>
                                            )}
                                        </div>

                                        {/* Detail Teknis */}
                                        <div style={{ ...xpGroupWrapper, flexShrink: 0 }}>
                                            <span style={xpGroupLabel()}>Detail Teknis</span>
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
                                                        <button type="button" style={{ ...xpBtn, padding: '1px 8px' }}
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
                                                        <button type="button" style={{ ...xpBtn, padding: '1px 8px' }}
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

                                        {/* Bahan Keluar Dari Mesin */}
                                        <div style={{ ...xpGroupWrapper, flex: 1 }}>
                                            <span style={xpGroupLabel()}>Bahan Keluar Dari Mesin</span>
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

                                        {/* Bahan Dari Celup / Setting */}
                                        <div style={{ ...xpGroupWrapper, flex: 1 }}>
                                            <span style={xpGroupLabel()}>Bahan Dari Celup / Setting</span>
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

                                    </div>
                                )}

                                {/* Components */}
                                <div style={{ display: 'flex', gap: 8, flex: 1, alignItems: 'flex-start' }}>

                                    {/* Components */}
                                    <div style={{ flex: 1 }}>
                                        <div style={xpGroupWrapper}>
                                            <span style={xpGroupLabel()}>Components</span>
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#444', cursor: 'pointer', userSelect: 'none' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={inheritFields}
                                                        onChange={e => setInheritFields(e.target.checked)}
                                                        style={{ margin: 0 }}
                                                    />
                                                    Inherit fields to child BOMs
                                                </label>
                                            </div>

                                            {/* Add component row */}
                                            <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                                <div style={{ flex: 3, minWidth: 120 }}>
                                                    <label style={{ ...xpLabel, fontSize: 10 }}>Item</label>
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
                                                <div style={{ width: 70 }}>
                                                    <label style={{ ...xpLabel, fontSize: 10 }}>Qty</label>
                                                    <input
                                                        type="number"
                                                        style={xpInput}
                                                        placeholder="Qty"
                                                        value={pendingQty}
                                                        onChange={e => setPendingQty(e.target.value)}
                                                        data-testid="component-qty-input"
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
                                                <button
                                                    style={{ ...xpBtnPrimary, minWidth: 'auto', padding: '2px 10px', alignSelf: 'flex-end' }}
                                                    onClick={() => {
                                                        if (pendingItemCode && pendingQty) {
                                                            const normalizedCode = pendingItemCode.trim().toLowerCase();
                                                            const exists = items.some((i: any) => (i.code || '').trim().toLowerCase() === normalizedCode);
                                                            const newLine: BOMLineNode = {
                                                                id: Math.random().toString(36).substr(2, 9),
                                                                item_code: pendingItemCode,
                                                                attribute_value_ids: findMatchingAttributeIds(pendingItemCode, selectedNode.attribute_value_ids),
                                                                qty: parseFloat(pendingQty) || 0,
                                                                percentage: parseFloat(pendingPercentage) || 0,
                                                                is_percentage: (parseFloat(pendingPercentage) || 0) > 0,
                                                                source_location_code: '',
                                                                isNewItem: !exists
                                                            };
                                                            updateSelectedNode({ lines: [...selectedNode.lines, newLine] });
                                                            setPendingItemCode('');
                                                            setPendingQty('');
                                                            setPendingPercentage('');
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
                                                        <span style={{ width: 55, textAlign: 'right' }}>Qty</span>
                                                        <span style={{ width: 57, textAlign: 'right' }}>%</span>
                                                        <span style={{ minWidth: 60 }}></span>
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
                                                        </span>
                                                        <input
                                                            type="number"
                                                            title="Qty"
                                                            style={{ ...xpInput, width: 55, textAlign: 'right', padding: '1px 3px' }}
                                                            value={line.qty}
                                                            onChange={e => {
                                                                const newLines = [...selectedNode.lines];
                                                                newLines[i] = { ...line, qty: parseFloat(e.target.value) || 0 };
                                                                updateSelectedNode({ lines: newLines });
                                                            }}
                                                        />
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
                                                                    newLines[i] = { ...line, percentage: pct, is_percentage: pct > 0 };
                                                                    updateSelectedNode({ lines: newLines });
                                                                }}
                                                            />
                                                            <span style={{ fontSize: 9, color: '#666' }}>%</span>
                                                        </div>
                                                        {!hasExistingBOM(line.item_code) && !line.subBOM && (
                                                            <button style={xpBtnInfo} onClick={() => {
                                                                const subNode: BOMNodeData = {
                                                                    id: Math.random().toString(36).substr(2, 9),
                                                                    code: suggestBOMCode(line.item_code, line.attribute_value_ids),
                                                                    item_code: line.item_code,
                                                                    attribute_value_ids: line.attribute_value_ids,
                                                                    qty: 1.0, tolerance_percentage: 0.0,
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
                                                            <button style={xpBtnInfo} onClick={() => setSelectedNodeId(line.subBOM!.id)}>
                                                                Draft ▶
                                                            </button>
                                                        )}
                                                        <button
                                                            style={xpBtnDanger}
                                                            onClick={() => updateSelectedNode({ lines: selectedNode.lines.filter((_, idx) => idx !== i) })}
                                                        >🗑</button>
                                                    </div>
                                                ))}
                                            </div>
                                            {/* Percentage total indicator */}
                                            {(() => {
                                                const totalPct = selectedNode.lines.reduce((sum, l) => sum + (l.percentage || 0), 0);
                                                const hasPct = selectedNode.lines.some(l => (l.percentage || 0) > 0);
                                                if (!hasPct) return null;
                                                const isValid = Math.abs(totalPct - 100) < 0.01;
                                                return (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', borderTop: '1px solid #aca899', background: '#ece9d8' }}>
                                                        <span style={{ fontSize: 10, color: '#555', flex: 1 }}>Total %:</span>
                                                        <span style={xpBadge(isValid ? '#2a7a2a' : '#a02020')}>{totalPct.toFixed(1)}%</span>
                                                        {!isValid && <span style={{ fontSize: 10, color: '#a02020' }}>must = 100%</span>}
                                                    </div>
                                                );
                                            })()}
                                        </div>
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
                                ⚠ {pctError}
                            </span>
                        )}
                        <button style={xpBtn} onClick={onCancel}>{t('cancel')}</button>
                        <button
                            data-testid="save-bom-tree-btn"
                            style={{ ...xpBtnSuccess, opacity: isSaving ? 0.6 : 1 }}
                            onClick={handleGlobalSave}
                            disabled={isSaving}
                        >
                            {isSaving ? 'Processing...' : '💾 Finish & Save Tree'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Photo preview overlay */}
            {photoPreview && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ background: '#ece9d8', border: '2px solid #0a246a', borderRadius: 4, overflow: 'hidden', maxWidth: '80vw', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ background: 'linear-gradient(to right, #0a246a, #a6caf0, #0a246a)', padding: '3px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none' }}>
                        <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 12, fontFamily: xpFont, textShadow: '1px 1px 2px rgba(0,0,0,0.6)' }}>Product Sample Photo</span>
                        <button onClick={() => setPhotoPreview(null)} style={{ width: 21, height: 21, padding: 0, background: 'linear-gradient(to bottom, #e06060, #b03030)', border: '1px solid #800', borderRadius: 2, cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
                    </div>
                    <div style={{ background: '#1e1e1e', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
                        <img src={photoPreview} alt="Sample" style={{ maxWidth: '72vw', maxHeight: '62vh', objectFit: 'contain', display: 'block' }} />
                    </div>
                    <div style={{ padding: '5px 8px', display: 'flex', justifyContent: 'flex-end', gap: 4, background: '#f0efe6', borderTop: '1px solid #ccc' }}>
                        <button style={{ ...xpBtn, padding: '2px 10px' }} onClick={() => window.open(photoPreview, '_blank')}>
                            ↗ Open Full View
                        </button>
                        <button style={{ ...xpBtn, padding: '2px 10px' }} onClick={() => setPhotoPreview(null)}>
                            Close
                        </button>
                    </div>
                </div>
            </div>
        )}
        </div>
    );
}
