'use client';

import { useState, useRef, useEffect } from 'react';
import { useUser } from '../../context/UserContext';
import { useConfirm } from '../../context/ConfirmContext';
import { Chip, XPActionButton, xpFont, rowStateBg, XP_BTN } from '../shared/xpTheme';
import { lvInput, lvBtn, lvSep, lvZebra } from '../shared/listViewTheme';
import { xpToolbar, SearchField, ToolbarCount, ToolbarButton } from '../shared/shellTheme';

type Category = {
    id: string;
    name: string;
    parent_id: string | null;
    level: number;
    path_names: string[];
    is_system: boolean;
    children?: Category[];
};

interface CategoriesViewProps {
    categories: Category[];
    onCreateCategory: (name: string, parentId?: string) => Promise<void>;
    onDeleteCategory: (id: string) => Promise<void>;
    onRenameCategory: (id: string, name: string) => Promise<void>;
}

type EditingState = { type: 'rename'; id: string; value: string } | null;
type AddingState = { parentId: string | undefined; value: string } | null;

function buildTree(cats: Category[]): Category[] {
    const map = new Map(cats.map(c => [c.id, { ...c, children: [] as Category[] }]));
    const roots: Category[] = [];
    for (const node of map.values()) {
        if (!node.parent_id || !map.has(node.parent_id)) roots.push(node);
        else map.get(node.parent_id)!.children!.push(node);
    }
    const sort = (arr: Category[]) => {
        arr.sort((a, b) => a.name.localeCompare(b.name));
        arr.forEach(n => sort(n.children!));
    };
    sort(roots);
    return roots;
}

// A search hit is kept WITH its ancestors: filtering the flat list first dropped
// every matched child whose parent did not match (its parent id no longer
// resolved in the map), so searching for a leaf name found nothing.
function filterWithAncestors(cats: Category[], term: string): Category[] {
    const q = term.toLowerCase();
    const byId = new Map(cats.map(c => [c.id, c]));
    const keep = new Set<string>();
    for (const c of cats) {
        if (!c.name.toLowerCase().includes(q)) continue;
        let cur: Category | undefined = c;
        while (cur && !keep.has(cur.id)) {
            keep.add(cur.id);
            cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
        }
    }
    return cats.filter(c => keep.has(c.id));
}

// Auto-focus helper component
function AutoFocusInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
    return <input ref={ref} {...props} />;
}

const SYSTEM_TONE = { background: '#dce8ff', borderColor: '#7fa8e0', color: '#003080' };
const INDENT = 16;

export default function CategoriesView({
    categories,
    onCreateCategory,
    onDeleteCategory,
    onRenameCategory,
}: CategoriesViewProps) {
    const { hasAnyPermission } = useUser();
    const { confirm } = useConfirm();
    const canManage = hasAnyPermission('category.create', 'category.edit', 'category.delete');

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [editingState, setEditingState] = useState<EditingState>(null);
    const [addingState, setAddingState] = useState<AddingState>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

    const toggleCollapse = (id: string) => {
        setCollapsedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const tree = buildTree(search ? filterWithAncestors(categories, search) : [...categories]);

    // ── Shared action handlers ────────────────────────────────────────────────
    const handleConfirmRename = async () => {
        if (editingState && editingState.value.trim()) {
            await onRenameCategory(editingState.id, editingState.value.trim());
        }
        setEditingState(null);
    };

    const handleConfirmAdd = async () => {
        if (addingState && addingState.value.trim()) {
            await onCreateCategory(addingState.value.trim(), addingState.parentId);
        }
        setAddingState(null);
    };

    const handleDelete = async (node: Category) => {
        const ok = await confirm({
            title: 'Delete Category', variant: 'danger', confirmText: 'Delete',
            message: `Delete category "${node.name}"? Blocked if it is used by any item.`,
        });
        if (!ok) return;
        await onDeleteCategory(node.id);
        if (selectedId === node.id) setSelectedId(null);
        if (editingState?.id === node.id) setEditingState(null);
    };

    const startAdd = (parentId: string | undefined) => {
        setEditingState(null);
        setAddingState({ parentId, value: '' });
        if (parentId) setCollapsedIds(prev => { const n = new Set(prev); n.delete(parentId); return n; });
    };

    const startRename = (node: Category) => {
        setAddingState(null);
        setEditingState({ type: 'rename', id: node.id, value: node.name });
    };

    // ── Row chrome ────────────────────────────────────────────────────────────
    const rowStyle = (level: number, extra: React.CSSProperties = {}): React.CSSProperties => ({
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '2px 6px', paddingLeft: (level - 1) * INDENT + 6,
        fontFamily: xpFont, fontSize: 11,
        borderBottom: '1px solid #e6e3db',
        ...extra,
    });

    const caret = (color = '#5a6472'): React.CSSProperties => ({ fontSize: 8, color, width: 12 });

    // ── Add-row renderer ──────────────────────────────────────────────────────
    const renderAddRow = (level: number): React.ReactNode => (
        <div key="__adding__" style={rowStyle(level, { background: rowStateBg('expanded') })}>
            <i className="bi bi-caret-right-fill" style={caret('#8a8a8a')} />
            <AutoFocusInput
                style={lvInput({ flex: 1 })}
                placeholder="New category name..."
                value={addingState?.value ?? ''}
                onChange={e => setAddingState(s => s ? { ...s, value: e.target.value } : s)}
                onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); handleConfirmAdd(); }
                    if (e.key === 'Escape') { e.preventDefault(); setAddingState(null); }
                }}
            />
            <button className={XP_BTN} style={lvBtn('primary')} onClick={handleConfirmAdd}>Add</button>
            <button className={XP_BTN} style={lvBtn()} onClick={() => setAddingState(null)}>Cancel</button>
        </div>
    );

    // ── Tree node renderer ────────────────────────────────────────────────────
    let rowIdx = 0;

    const renderNode = (node: Category): React.ReactNode => {
        const isSelected = node.id === selectedId;
        const isHovered = node.id === hoveredId;
        const isEditing = editingState?.id === node.id;
        const hasChildren = (node.children?.length ?? 0) > 0;
        const isCollapsed = collapsedIds.has(node.id);
        const zebra = lvZebra(rowIdx++);

        const subRows = (
            <>
                {!isCollapsed && node.children?.map(child => renderNode(child))}
                {!isCollapsed && addingState?.parentId === node.id && renderAddRow(node.level + 1)}
            </>
        );

        if (isEditing) {
            return (
                <div key={node.id}>
                    <div style={rowStyle(node.level, { background: rowStateBg('expanded') })}>
                        <i className="bi bi-caret-down-fill" style={caret('#8a8a8a')} />
                        <AutoFocusInput
                            style={lvInput({ flex: 1 })}
                            value={editingState.value}
                            onChange={e => setEditingState(s => s ? { ...s, value: e.target.value } : s)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); handleConfirmRename(); }
                                if (e.key === 'Escape') { e.preventDefault(); setEditingState(null); }
                            }}
                        />
                        <button className={XP_BTN} style={lvBtn('primary')} onClick={handleConfirmRename}>Save</button>
                        <button className={XP_BTN} style={lvBtn()} onClick={() => setEditingState(null)}>Cancel</button>
                    </div>
                    {subRows}
                </div>
            );
        }

        return (
            <div key={node.id}>
                <div
                    style={rowStyle(node.level, {
                        cursor: 'pointer',
                        fontWeight: node.level === 1 ? 'bold' : 'normal',
                        background: isSelected ? rowStateBg('selected') : (isHovered ? rowStateBg('expanded') : zebra),
                        userSelect: 'none' as const,
                    })}
                    onClick={() => setSelectedId(node.id)}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    title={node.path_names.join(' / ')}
                >
                    {hasChildren ? (
                        <i
                            className={`bi ${isCollapsed ? 'bi-caret-right-fill' : 'bi-caret-down-fill'}`}
                            style={{ ...caret(), cursor: 'pointer' }}
                            onClick={e => { e.stopPropagation(); toggleCollapse(node.id); }}
                        />
                    ) : <span style={{ width: 12 }} />}
                    <span style={{ flex: 1 }}>{node.name}</span>
                    {node.is_system && <Chip size="xs" tone={SYSTEM_TONE}>SYSTEM</Chip>}
                    {canManage && (
                        <span
                            style={{ display: 'flex', gap: 3, opacity: isHovered ? 1 : 0, transition: 'opacity 0.1s' }}
                            onClick={e => e.stopPropagation()}
                        >
                            {node.level < 3 && (
                                <XPActionButton tone="primary" icon="bi-plus-lg" title="Add sub-category"
                                    onClick={() => startAdd(node.id)} />
                            )}
                            <XPActionButton icon="bi-pencil" title="Rename" onClick={() => startRename(node)} />
                            {!node.is_system && (
                                <XPActionButton tone="danger" icon="bi-trash" title="Delete"
                                    onClick={() => handleDelete(node)} />
                            )}
                        </span>
                    )}
                </div>
                {subRows}
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Toolbar */}
            <div style={xpToolbar({ padding: '4px 8px', flexShrink: 0 })}>
                <SearchField value={search} onChange={setSearch} placeholder="Search categories…" width={220} />
                <ToolbarCount right>
                    {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}
                </ToolbarCount>
                {canManage && (
                    <>
                        <span style={lvSep()} />
                        <ToolbarButton tone="create" icon="bi-plus-lg" onClick={() => startAdd(undefined)}>New Category</ToolbarButton>
                    </>
                )}
            </div>

            {/* Tree */}
            <div style={{ flex: 1, minHeight: 0, background: '#fff', overflow: 'auto' }}>
                {tree.length === 0 && !addingState && (
                    <div style={{ padding: 20, textAlign: 'center', color: '#888', fontStyle: 'italic', fontFamily: xpFont, fontSize: 11 }}>
                        No categories found.
                    </div>
                )}
                {tree.map(node => renderNode(node))}
                {addingState && addingState.parentId === undefined && renderAddRow(1)}
            </div>
        </div>
    );
}
