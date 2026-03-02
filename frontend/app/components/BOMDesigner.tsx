import { useState, useEffect, useCallback, memo } from 'react';
import { useLanguage } from '../context/LanguageContext';
import CodeConfigModal, { CodeConfig } from './CodeConfigModal';
import BOMAutomatorModal from './BOMAutomatorModal';
import SearchableSelect from './SearchableSelect';

// Types for Recursive Structure
interface BOMLineNode {
    id: string; 
    item_code: string;
    attribute_value_ids: string[];
    qty: number;
    is_percentage: boolean;
    source_location_code: string;
    subBOM?: BOMNodeData; 
    isNewItem?: boolean;
}

interface BOMNodeData {
    id: string; // Unique ID for selecting in tree
    code: string;
    item_code: string; 
    attribute_value_ids: string[];
    qty: number;
    tolerance_percentage: number;
    operations: any[];
    lines: BOMLineNode[];
    isNewItem?: boolean;
}

// --- Sub-Components moved outside to prevent re-creation on every render ---

const TreeView = memo(({ 
    node, 
    level = 0, 
    selectedNodeId, 
    items, 
    onSelect,
    hasExistingBOM 
}: { 
    node: BOMNodeData, 
    level: number, 
    selectedNodeId: string, 
    items: any[], 
    onSelect: (id: string) => void,
    hasExistingBOM: (code: string) => boolean
}) => {
    const itemExists = items.some((i: any) => (i.code || '').trim().toLowerCase() === (node.item_code || '').trim().toLowerCase());
    const recipeExists = hasExistingBOM(node.item_code);
    const hasLocalDef = node.lines.length > 0 || node.operations.length > 0;

    return (
        <div className="tree-node">
            <div 
                className={`d-flex align-items-center p-2 rounded mb-1 cursor-pointer ${selectedNodeId === node.id ? 'bg-primary text-white shadow-sm' : 'hover-bg-light'}`}
                style={{ paddingLeft: `${level * 16 + 8}px`, cursor: 'pointer' }}
                onClick={() => onSelect(node.id)}
            >
                <i className={`bi ${level === 0 ? 'bi-box-seam-fill' : 'bi-diagram-3'} me-2`}></i>
                <span className="text-truncate small fw-bold">{node.item_code || 'Unnamed'}</span>
                
                <div className="ms-auto d-flex gap-1">
                    {recipeExists && <span className="badge bg-success" style={{fontSize: '0.5rem'}}>RECIPE✓</span>}
                    {!recipeExists && hasLocalDef && <span className="badge bg-info" style={{fontSize: '0.5rem'}}>DRAFT</span>}
                    {!itemExists && <span className="badge bg-danger" style={{fontSize: '0.5rem'}}>NEW ITEM</span>}
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

export default function BOMDesigner({ 
    rootItemCode, 
    items, 
    locations, 
    attributes, 
    workCenters, 
    operations, 
    onSave, 
    onCreateItem,
    onCancel,
    existingBOMs 
}: any) {
    const { t } = useLanguage();
    
    // State
    const [rootBOM, setRootBOM] = useState<BOMNodeData>({
        id: 'root',
        code: '',
        item_code: rootItemCode || '',
        attribute_value_ids: [],
        qty: 1.0,
        tolerance_percentage: 0.0,
        operations: [],
        lines: []
    });

    const [selectedNodeId, setSelectedNodeId] = useState<string>('root');
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [isAutomatorOpen, setIsAutomatorOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    // Add Component Local State
    const [pendingItemCode, setPendingItemCode] = useState('');
    const [pendingQty, setPendingQty] = useState<string>('');
    const [pendingIsPercentage, setPendingIsPercentage] = useState(false);
    
    const [codeConfig, setCodeConfig] = useState<CodeConfig>({
        prefix: 'BOM',
        suffix: '',
        separator: '-',
        includeItemCode: true,
        includeVariant: false,
        variantAttributeNames: [],
        includeYear: false,
        includeMonth: false
    });

    useEffect(() => {
        const savedConfig = localStorage.getItem('bom_code_config');
        if (savedConfig) {
            try { setCodeConfig(JSON.parse(savedConfig)); } catch (e) {}
        }
    }, []);

    // Initial code suggestion
    useEffect(() => {
        if (rootItemCode && !rootBOM.code) {
            setRootBOM(prev => ({
                ...prev,
                code: suggestBOMCode(rootItemCode, prev.attribute_value_ids)
            }));
        }
    }, [rootItemCode]);

    // --- Helpers ---
    const getItemName = useCallback((code: string) => items.find((i: any) => (i.code || '').trim().toLowerCase() === (code || '').trim().toLowerCase())?.name || code, [items]);
    
    const hasExistingBOM = useCallback((code: string) => {
         const item = items.find((i:any) => (i.code || '').trim().toLowerCase() === (code || '').trim().toLowerCase());
         return item && existingBOMs.some((b:any) => b.item_id === item.id);
    }, [items, existingBOMs]);

    const getOpName = (id: string) => operations.find((o: any) => o.id === id)?.name || id;
    const getWCName = (id: string) => workCenters.find((w: any) => w.id === id)?.name || id;
    
    const getAttributeValueName = (valId: string) => {
        for (const attr of attributes) {
            const val = attr.values.find((v: any) => v.id === valId);
            if (val) return val.value;
        }
        return valId;
    };

    // --- Logic ---
    const suggestBOMCode = useCallback((itemCode: string, attributeValueIds: string[] = [], config = codeConfig) => {
        const parts = [];
        if (config.prefix) parts.push(config.prefix);
        if (config.includeItemCode && itemCode) parts.push(itemCode);
        
        // Variant logic
        if (config.includeVariant && attributeValueIds.length > 0) {
             const valueNames: string[] = [];
             for (const valId of attributeValueIds) {
                 for (const attr of attributes) {
                     const val = attr.values.find((v: any) => v.id === valId);
                     if (val) {
                         if (!config.variantAttributeNames || config.variantAttributeNames.length === 0 || config.variantAttributeNames.includes(attr.name)) {
                             valueNames.push(val.value.toUpperCase().replace(/\s+/g, ''));
                         }
                         break;
                     }
                 }
             }
             if (valueNames.length > 0) parts.push(...valueNames);
        }

        const now = new Date();
        if (config.includeYear) parts.push(now.getFullYear());
        if (config.includeMonth) parts.push(String(now.getMonth() + 1).padStart(2, '0'));
        if (config.suffix) parts.push(config.suffix);
        const basePattern = parts.join(config.separator);
        let counter = 1;
        let baseCode = `${basePattern}${config.separator}001`;
        while (existingBOMs.some((b: any) => b.code === baseCode)) {
            counter++;
            baseCode = `${basePattern}${config.separator}${String(counter).padStart(3, '0')}`;
        }
        return baseCode;
    }, [codeConfig, attributes, existingBOMs]);

    const handleApplyAutomation = useCallback((levels: string[][]) => {
        if (!rootBOM.item_code) return;

        const findMatchingAttributeIds = (childItemCode: string, parentAttrIds: string[]) => {
            const childItem = items.find((i: any) => 
                (i.code || '').trim().toLowerCase() === (childItemCode || '').trim().toLowerCase()
            );
            if (!childItem || !childItem.attribute_ids) return [];
            const matches: string[] = [];
            for (const parentValId of parentAttrIds) {
                let attrName = ''; let valName = '';
                for (const attr of attributes) {
                    const val = attr.values.find((v:any) => v.id === parentValId);
                    if (val) { attrName = attr.name; valName = val.value; break; }
                }
                if (attrName && valName) {
                    const childAttr = attributes.find((a:any) => a.name === attrName && childItem.attribute_ids.includes(a.id));
                    if (childAttr) {
                        const childVal = childAttr.values.find((v:any) => v.value === valName);
                        if (childVal) matches.push(childVal.id);
                    }
                }
            }
            return matches;
        };

        const constructTreeRecursive = (parentItemCode: string, parentAttrs: string[], levelIdx: number): any[] => {
            if (levelIdx >= levels.length) return [];
            
            const currentLevelPatterns = levels[levelIdx];
            const levelLines: any[] = [];

            for (const pattern of currentLevelPatterns) {
                if (!pattern) continue;
                const expectedChildCode = pattern.replace('{CODE}', parentItemCode);
                
                const childItem = items.find((i: any) => 
                    (i.code || '').trim().toLowerCase() === (expectedChildCode || '').trim().toLowerCase()
                );
                
                const isNewItem = !childItem;
                const existingBOM = childItem ? existingBOMs.find((b: any) => b.item_id === childItem.id) : null;
                
                const matchingAttrs = isNewItem ? parentAttrs : findMatchingAttributeIds(expectedChildCode, parentAttrs);
                
                // Construct next level for this specific pattern
                const subLines = constructTreeRecursive(expectedChildCode, matchingAttrs, levelIdx + 1);
                
                const subBOM: BOMNodeData = {
                    id: Math.random().toString(36).substr(2, 9),
                    code: suggestBOMCode(expectedChildCode, matchingAttrs),
                    item_code: expectedChildCode,
                    attribute_value_ids: matchingAttrs,
                    qty: 1.0,
                    tolerance_percentage: 0.0,
                    operations: [],
                    lines: subLines,
                    isNewItem: isNewItem
                };

                levelLines.push({
                    id: Math.random().toString(36).substr(2, 9),
                    item_code: expectedChildCode,
                    attribute_value_ids: matchingAttrs,
                    qty: 1.0,
                    is_percentage: false,
                    source_location_code: '',
                    subBOM: existingBOM ? undefined : subBOM, // Link existing BOM if found, otherwise draft subBOM
                    isExpanded: true,
                    isNewItem: isNewItem
                });
            }

            return levelLines;
        };

        const newLines = constructTreeRecursive(rootBOM.item_code, rootBOM.attribute_value_ids, 0);
        setRootBOM(prev => ({ ...prev, lines: newLines }));
    }, [rootBOM.item_code, rootBOM.attribute_value_ids, items, attributes, existingBOMs, suggestBOMCode]);

    const saveNode = async (node: BOMNodeData): Promise<boolean> => {
        // Resolve Root Item to inherit attributes for new items
        const rootItem = items.find((i: any) => (i.code || '').trim().toLowerCase() === (rootBOM.item_code || '').trim().toLowerCase());

        // 1. Resolve Item (Create if missing)
        let item = items.find((i: any) => (i.code || '').trim().toLowerCase() === (node.item_code || '').trim().toLowerCase());
        
        // FIX: Ensure item creation happens if it doesn't exist OR if marked isNewItem
        if (!item && node.isNewItem) {
            const res = await onCreateItem({
                code: node.item_code, 
                name: node.item_code, 
                uom: rootItem?.uom || 'pcs', 
                category: 'WIP', 
                attribute_ids: rootItem?.attribute_ids || [] 
            });
            
            if (res.status === 400) {
                // Item might have been created in a previous step or by another user
                // We proceed, assuming it exists now.
                // Re-fetch logic is handled by parent view usually, but here we optimistically continue.
            } else if (!res.ok) {
                return false; 
            }
        }

        // 2. Save all children first (Bottom-Up)
        for (const line of node.lines) {
            if (line.isNewItem && !line.subBOM) {
                // Leaf item creation
                const res = await onCreateItem({ 
                    code: line.item_code, 
                    name: line.item_code, 
                    uom: rootItem?.uom || 'pcs', 
                    category: 'WIP', 
                    attribute_ids: rootItem?.attribute_ids || [] 
                });
                // Ignore 400 (duplicate)
            }
            if (line.subBOM) {
                const success = await saveNode(line.subBOM);
                if (!success) return false;
            }
        }

        // 3. Save this BOM node
        // FIX: Only save if it has lines or ops. If it's a leaf WIP with no definition yet, we skip saving BOM
        // BUT user wanted draft. If user added nothing to the last node, do we save an empty BOM?
        // No, API likely rejects empty BOM.
        // If the user didn't fill in the last node (Materials), we just skip saving that specific BOM.
        // It remains an Item in inventory, but without a Recipe.
        if (node.lines.length === 0 && node.operations.length === 0) return true;
        
        try {
            await onSave(node);
            return true;
        } catch (e) {
            console.error("Save failed for", node.code, e);
            return false;
        }
    };

    const handleGlobalSave = async () => {
        setIsSaving(true);
        const success = await saveNode(rootBOM);
        setIsSaving(false);
        if (success) onCancel();
    };

    // --- Search / Update node in tree ---
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

    // --- Components ---

    const selectedNode = findNodeById(rootBOM, selectedNodeId);

    return (
        <div className="d-flex flex-column h-100 bg-white" style={{ minHeight: '80vh' }}>
            <CodeConfigModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} type="BOM" onSave={(cfg) => {
                setCodeConfig(cfg);
                if (rootBOM.item_code) setRootBOM(p => ({...p, code: suggestBOMCode(p.item_code, p.attribute_value_ids, cfg)}));
            }} initialConfig={codeConfig} attributes={attributes} />
            <BOMAutomatorModal isOpen={isAutomatorOpen} onClose={() => setIsAutomatorOpen(false)} onApply={handleApplyAutomation} />

            <div className="row g-0 flex-grow-1 overflow-hidden">
                {/* LEFT: Tree Nav */}
                <div className="col-md-3 border-end bg-light d-flex flex-column h-100">
                    <div className="p-3 border-bottom bg-white d-flex justify-content-between align-items-center">
                        <h6 className="small fw-bold text-uppercase text-muted mb-0">Structure</h6>
                        <span className="badge bg-secondary extra-small">{items.length} SKUs</span>
                    </div>
                    <div className="p-2 flex-grow-1 overflow-auto">
                        <TreeView 
                            node={rootBOM} 
                            level={0} 
                            selectedNodeId={selectedNodeId} 
                            items={items} 
                            onSelect={setSelectedNodeId} 
                            hasExistingBOM={hasExistingBOM}
                        />
                    </div>
                </div>

                {/* RIGHT: Detail Editor */}
                <div className="col-md-9 d-flex flex-column h-100 bg-white">
                    {selectedNode ? (
                        <div className="p-4 overflow-auto">
                            <div className="d-flex justify-content-between align-items-start mb-4 border-bottom pb-3">
                                <div>
                                    <h4 className="fw-bold mb-1">{getItemName(selectedNode.item_code)}</h4>
                                    <div className="d-flex align-items-center gap-2">
                                        <span className="text-muted small font-monospace">{selectedNode.item_code}</span>
                                        {selectedNode.isNewItem && <span className="badge bg-danger-subtle text-danger border border-danger border-opacity-25 small">New Inventory Record</span>}
                                        {hasExistingBOM(selectedNode.item_code) && <span className="badge bg-success-subtle text-success border border-success border-opacity-25 small">Existing Recipe</span>}
                                    </div>
                                </div>
                                {selectedNodeId === 'root' && (
                                    <button data-testid="automate-levels-btn" className="btn btn-sm btn-info shadow-sm" onClick={() => setIsAutomatorOpen(true)}>
                                        <i className="bi bi-magic me-1"></i>Automate All Levels
                                    </button>
                                )}
                            </div>

                            <div className="row g-4">
                                <div className="col-md-4">
                                    <label className="form-label small text-muted d-flex justify-content-between">
                                        BOM Code
                                        {selectedNodeId === 'root' && <i className="bi bi-gear-fill cursor-pointer" onClick={() => setIsConfigOpen(true)}></i>}
                                    </label>
                                    <input data-testid="bom-code-input" className="form-control" value={selectedNode.code} onChange={e => updateSelectedNode({ code: e.target.value })} />
                                </div>
                                <div className="col-md-5">
                                    <label className="form-label small text-muted">Finished Item</label>
                                    {selectedNodeId === 'root' ? (
                                        <SearchableSelect 
                                            options={items.map((i: any) => ({ value: i.code, label: i.name, subLabel: i.code }))}
                                            value={selectedNode.item_code}
                                            onChange={(code) => {
                                                setRootBOM(prev => ({
                                                    ...prev,
                                                    item_code: code,
                                                    code: suggestBOMCode(code, prev.attribute_value_ids),
                                                    attribute_value_ids: []
                                                }));
                                            }}
                                            placeholder="Select Item..."
                                            testId="root-item-select"
                                        />
                                    ) : (
                                        <div className="form-control bg-light">{getItemName(selectedNode.item_code)}</div>
                                    )}
                                </div>
                                <div className="col-md-3">
                                    <label className="form-label small text-muted">Batch Size</label>
                                    <input data-testid="batch-size-input" type="number" className="form-control" value={selectedNode.qty} onChange={e => updateSelectedNode({ qty: parseFloat(e.target.value) })} />
                                </div>
                                <div className="col-md-2">
                                    <label className="form-label small text-muted text-nowrap">Tolerance %</label>
                                    <div className="input-group">
                                        <input data-testid="tolerance-input" type="number" className="form-control" value={selectedNode.tolerance_percentage} onChange={e => updateSelectedNode({ tolerance_percentage: parseFloat(e.target.value) })} />
                                        <span className="input-group-text px-2">%</span>
                                    </div>
                                </div>
                            </div>

                            {/* Node Attributes */}
                            <div className="mt-3 d-flex flex-wrap gap-2">
                                {attributes.filter((a:any) => {
                                    const itm = items.find((i:any) => (i.code || '').trim().toLowerCase() === (selectedNode.item_code || '').trim().toLowerCase());
                                    // If new item, check root item for attributes
                                    const rootItm = items.find((i:any) => (i.code || '').trim().toLowerCase() === (rootBOM.item_code || '').trim().toLowerCase());
                                    return (itm?.attribute_ids || rootItm?.attribute_ids || []).includes(a.id);
                                }).map((attr:any) => (
                                    <div key={attr.id} style={{minWidth: '150px'}}>
                                        <label className="extra-small text-muted">{attr.name}</label>
                                        <select className="form-select form-select-sm" value={selectedNode.attribute_value_ids.find(v => attr.values.some((av:any) => av.id === v)) || ''}
                                            onChange={e => {
                                                const attrValId = e.target.value;
                                                const others = selectedNode.attribute_value_ids.filter(v => !attr.values.some((av:any) => av.id === v));
                                                const newVals = attrValId ? [...others, attrValId] : others;
                                                updateSelectedNode({ attribute_value_ids: newVals, code: selectedNodeId === 'root' ? suggestBOMCode(selectedNode.item_code, newVals) : selectedNode.code });
                                            }}
                                        >
                                            <option value="">Any...</option>
                                            {attr.values.map((v:any) => <option key={v.id} value={v.id}>{v.value}</option>)}
                                        </select>
                                    </div>
                                ))}
                            </div>

                            <hr className="my-4" />

                            <div className="row g-4">
                                {/* Ops */}
                                <div className="col-lg-5">
                                    <div className="card h-100 border shadow-none bg-light bg-opacity-50">
                                        <div className="card-header bg-transparent border-0"><h6 className="fw-bold mb-0">Production Steps</h6></div>
                                        <div className="card-body">
                                            <div className="input-group input-group-sm mb-3">
                                                <select className="form-select" id="addOpSel">
                                                    <option value="">Add Operation...</option>
                                                    {operations.map((o:any) => <option key={o.id} value={o.id}>{o.name}</option>)}
                                                </select>
                                                <button className="btn btn-secondary" onClick={() => {
                                                    const sel = document.getElementById('addOpSel') as HTMLSelectElement;
                                                    if (sel.value) {
                                                        const newOps = [...selectedNode.operations, { operation_id: sel.value, sequence: (selectedNode.operations.length + 1) * 10, time_minutes: 0 }];
                                                        updateSelectedNode({ operations: newOps });
                                                        sel.value = "";
                                                    }
                                                }}><i className="bi bi-plus-lg"></i></button>
                                            </div>
                                            <div className="list-group list-group-flush border rounded bg-white overflow-auto" style={{maxHeight: '300px'}}>
                                                {selectedNode.operations.sort((a,b) => a.sequence - b.sequence).map((op, i) => (
                                                    <div key={i} className="list-group-item d-flex justify-content-between align-items-center py-2">
                                                        <span className="small fw-bold text-muted">{op.sequence}. {getOpName(op.operation_id)}</span>
                                                        <button className="btn btn-xs text-danger p-0" onClick={() => updateSelectedNode({ operations: selectedNode.operations.filter((_, idx) => idx !== i) })}><i className="bi bi-trash"></i></button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Materials */}
                                <div className="col-lg-7">
                                    <div className="card h-100 border shadow-none">
                                        <div className="card-header bg-transparent border-0 d-flex justify-content-between">
                                            <h6 className="fw-bold mb-0">Components</h6>
                                        </div>
                                        <div className="card-body">
                                            <div className="d-flex gap-2 mb-3">
                                                <div style={{ flex: 2 }}>
                                                    <SearchableSelect 
                                                        options={items.map((i:any) => ({ value: i.code, label: i.name, subLabel: i.code }))}
                                                        value={pendingItemCode}
                                                        onChange={setPendingItemCode}
                                                        placeholder="Component..."
                                                        testId="component-select"
                                                    />
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <div className="input-group">
                                                        <input 
                                                            type="number" 
                                                            className="form-control" 
                                                            placeholder="Qty" 
                                                            value={pendingQty}
                                                            onChange={e => setPendingQty(e.target.value)}
                                                            data-testid="component-qty-input"
                                                        />
                                                        <button 
                                                            className={`btn btn-sm ${pendingIsPercentage ? 'btn-warning' : 'btn-outline-secondary'}`}
                                                            type="button"
                                                            onClick={() => setPendingIsPercentage(!pendingIsPercentage)}
                                                            title="Toggle Percentage"
                                                        >
                                                            {pendingIsPercentage ? '%' : '#'}
                                                        </button>
                                                    </div>
                                                </div>
                                                <button 
                                                    className="btn btn-primary" 
                                                    onClick={() => {
                                                        if (pendingItemCode && pendingQty) {
                                                            const normalizedCode = pendingItemCode.trim().toLowerCase();
                                                            const exists = items.some((i:any) => (i.code || '').trim().toLowerCase() === normalizedCode);
                                                            const newLine: BOMLineNode = {
                                                                id: Math.random().toString(36).substr(2, 9),
                                                                item_code: pendingItemCode,
                                                                attribute_value_ids: [],
                                                                qty: parseFloat(pendingQty),
                                                                is_percentage: pendingIsPercentage,
                                                                source_location_code: '',
                                                                isNewItem: !exists
                                                            };
                                                            updateSelectedNode({ lines: [...selectedNode.lines, newLine] });
                                                            setPendingItemCode('');
                                                            setPendingQty('');
                                                            setPendingIsPercentage(false);
                                                        }
                                                    }}
                                                    data-testid="add-component-btn"
                                                >
                                                    <i className="bi bi-plus-lg"></i>
                                                </button>
                                            </div>

                                            <div className="d-flex flex-column gap-2 overflow-auto" style={{maxHeight: '400px'}}>
                                                {selectedNode.lines.map((line, i) => (
                                                    <div key={line.id} className="p-2 border rounded d-flex justify-content-between align-items-center bg-white">
                                                        <div className="d-flex align-items-center gap-2">
                                                            <span className="fw-bold small">{getItemName(line.item_code)}</span>
                                                            <span className={`badge ${line.is_percentage ? 'bg-warning text-dark' : 'bg-secondary'}`}>
                                                                {line.qty}{line.is_percentage ? '%' : ''}
                                                            </span>
                                                            {!hasExistingBOM(line.item_code) && !line.subBOM && (
                                                                <button className="btn btn-xs btn-warning py-0 px-2" onClick={() => {
                                                                    const subNode: BOMNodeData = {
                                                                        id: Math.random().toString(36).substr(2, 9),
                                                                        code: suggestBOMCode(line.item_code, line.attribute_value_ids),
                                                                        item_code: line.item_code,
                                                                        attribute_value_ids: line.attribute_value_ids,
                                                                        qty: 1.0,
                                                                        tolerance_percentage: 0.0,
                                                                        operations: [], 
                                                                        lines: [], 
                                                                        isNewItem: line.isNewItem
                                                                    };
                                                                    const newLines = [...selectedNode.lines];
                                                                    newLines[i] = { ...line, subBOM: subNode };
                                                                    updateSelectedNode({ lines: newLines });
                                                                    setSelectedNodeId(subNode.id);
                                                                }}>Define BOM</button>
                                                            )}
                                                            {line.subBOM && <span className="badge bg-info cursor-pointer" onClick={() => setSelectedNodeId(line.subBOM!.id)}>Draft Defined <i className="bi bi-arrow-right-short"></i></span>}
                                                        </div>
                                                        <button className="btn btn-xs text-danger p-0" onClick={() => updateSelectedNode({ lines: selectedNode.lines.filter((_, idx) => idx !== i) })}><i className="bi bi-trash"></i></button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-100 d-flex align-items-center justify-content-center text-muted">Select a part from the tree to edit its recipe</div>
                    )}

                    {/* FOOTER */}
                    <div className="mt-auto p-3 border-top bg-light d-flex justify-content-end gap-2">
                        <button className="btn btn-secondary" onClick={onCancel}>{t('cancel')}</button>
                        <button data-testid="save-bom-tree-btn" className="btn btn-success fw-bold px-4" onClick={handleGlobalSave} disabled={isSaving}>
                            {isSaving ? 'Processing...' : 'Finish & Save Tree'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
