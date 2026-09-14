'use client';

import { useState, useRef, useEffect } from 'react';
import { useUser } from '../../context/UserContext';
import { CODE_FONT, xpFont, CHIP_RADIUS, xpInput as xpInputBase, xpBtn as xpBtnBase, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { SearchField, ToolbarCount } from '../shared/shellTheme';

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
        if (!node.parent_id) roots.push(node);
        else map.get(node.parent_id)?.children?.push(node);
    }
    const sort = (arr: Category[]) => arr.sort((a, b) => a.name.localeCompare(b.name));
    sort(roots);
    roots.forEach(r => { sort(r.children!); r.children!.forEach(c => sort(c.children!)); });
    return roots;
}

// Auto-focus helper component
function AutoFocusInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
    return <input ref={ref} {...props} />;
}

export default function CategoriesView({
    categories,
    onCreateCategory,
    onDeleteCategory,
    onRenameCategory,
}: CategoriesViewProps) {
    const { hasPermission, hasAnyPermission } = useUser();
    const canManage = hasAnyPermission('category.create', 'category.edit', 'category.delete');

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [editingState, setEditingState] = useState<EditingState>(null);
    const [addingState, setAddingState] = useState<AddingState>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [newRootName, setNewRootName] = useState('');
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
    const renderCounter = { n: 0 };

    const toggleCollapse = (id: string) => {
        setCollapsedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleAddRoot = async () => {
        if (newRootName.trim()) {
            await onCreateCategory(newRootName.trim(), undefined);
            setNewRootName('');
        }
    };

    const selectedNode = selectedId ? categories.find(c => c.id === selectedId) ?? null : null;
    const tree = buildTree(
        search
            ? categories.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
            : [...categories]
    );

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

    const handleDelete = async (id: string) => {
        await onDeleteCategory(id);
        if (selectedId === id) setSelectedId(null);
        if (editingState?.id === id) setEditingState(null);
    };

    const startAdd = (parentId: string | undefined) => {
        setEditingState(null);
        setAddingState({ parentId, value: '' });
    };

    const startRename = (node: Category) => {
        setAddingState(null);
        setEditingState({ type: 'rename', id: node.id, value: node.name });
    };

    // ── XP style helpers ──────────────────────────────────────────────────────
    const xpToolbar: React.CSSProperties = {
        background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)',
        borderBottom: '1px solid #b0a898',
        padding: '4px 6px',
        display: 'flex',
        gap: 4,
        alignItems: 'center',
    };
    const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => xpBtnBase({ padding: '2px 8px', ...extra });
    const xpIconBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
        background: 'none',
        border: 'none',
        padding: '0 2px',
        fontFamily: xpFont,
        fontSize: 11,
        cursor: 'pointer',
        borderRadius: 0,
        lineHeight: 1,
        ...extra,
    });
    const xpInput: React.CSSProperties = xpInputBase({ boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)', height: 'auto', padding: '2px 4px' });

    // ── Add-row renderer ──────────────────────────────────────────────────────
    const renderAddRow = (level: number): React.ReactNode => {
        const indent = (level - 1) * 16;
        return (
            <div
                key="__adding__"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '1px 4px',
                    paddingLeft: indent + (4),
                    gap: 4,
                }}
            >
                <span style={{ marginRight: 4, fontSize: 10, fontFamily: CODE_FONT, color: '#999'}}>—</span>
                <AutoFocusInput
                    className={undefined}
                    style={{ ...xpInput, flex: 1 }}
                    placeholder="New category name..."
                    value={addingState?.value ?? ''}
                    onChange={e => setAddingState(s => s ? { ...s, value: e.target.value } : s)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); handleConfirmAdd(); }
                        if (e.key === 'Escape') { e.preventDefault(); setAddingState(null); }
                    }}
                />
                {<>
                        <button className={XP_BTN} style={xpBtn()} onClick={handleConfirmAdd} title="Save">✓</button>
                        <button className={XP_BTN} style={xpBtn()} onClick={() => setAddingState(null)} title="Cancel">✕</button>
                    </>}
            </div>
        );
    };

    // ── Tree node renderer ────────────────────────────────────────────────────
    const renderNode = (node: Category): React.ReactNode => {
        const rowIdx = renderCounter.n++;
        const isEven = rowIdx % 2 === 0;
        const indent = (node.level - 1) * 16;
        const isSelected = node.id === selectedId;
        const isHovered = node.id === hoveredId;
        const isEditing = editingState?.id === node.id;
        const hasChildren = (node.children?.length ?? 0) > 0;
        const isCollapsed = collapsedIds.has(node.id);
        const chevron = hasChildren ? (isCollapsed ? '▶' : '▼') : '—';
        const chevronColor = isSelected ? '#fff' : (hasChildren ? '#444' : '#bbb');
        const actionsOpacity = isHovered || isEditing ? 1 : 0;
        const rowBg = isSelected ? '#316ac5' : (isHovered ? '#dde8fb' : (isEven ? '#fff' : '#f5f4ef'));

        if (isEditing) {
            return (
                <div key={node.id}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '1px 4px',
                            paddingLeft: indent + (4),
                            background: '#316ac5',
                            borderRadius: undefined,
                            gap: 4,
                        }}
                    >
                        <span style={{ marginRight: 4, fontSize: 10, color: '#fff', fontFamily: CODE_FONT }}>{chevron}</span>
                        <AutoFocusInput
                            className={undefined}
                            style={{ ...xpInput, flex: 1 }}
                            value={editingState.value}
                            onChange={e => setEditingState(s => s ? { ...s, value: e.target.value } : s)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); handleConfirmRename(); }
                                if (e.key === 'Escape') { e.preventDefault(); setEditingState(null); }
                            }}
                        />
                        {<>
                                <button className={XP_BTN} style={xpBtn()} onClick={handleConfirmRename} title="Save">✓</button>
                                <button className={XP_BTN} style={xpBtn()} onClick={() => setEditingState(null)} title="Cancel">✕</button>
                            </>}
                    </div>
                    {node.children?.map(child => renderNode(child))}
                    {addingState?.parentId === node.id && renderAddRow(node.level + 1)}
                </div>
            );
        }

        return (
            <div key={node.id}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '1px 4px',
                        paddingLeft: indent + 4,
                        cursor: 'pointer',
                        fontFamily: xpFont,
                        fontSize: 11,
                        fontWeight: node.level === 1 ? 'bold' : 'normal',
                        background: rowBg,
                        color: isSelected ? '#fff' : '#000',
                        userSelect: 'none' as const,
                        position: 'relative',
                    }}
                    onClick={() => setSelectedId(node.id)}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                >
                    <span
                        style={{ marginRight: 4, fontSize: 10, fontFamily: CODE_FONT, color: chevronColor, cursor: hasChildren ? 'pointer' : 'default' }}
                        onClick={hasChildren ? e => { e.stopPropagation(); toggleCollapse(node.id); } : undefined}
                    >{chevron}</span>
                    <span style={{ flex: 1 }}>{node.name}</span>
                    {node.is_system && (
                        <span style={{ borderRadius: CHIP_RADIUS, fontFamily: xpFont, fontSize: 9, color: '#003080', background: '#dce8ff', border: '1px solid #7fa8e0', padding: '0 4px', marginRight: 4 }}>SYSTEM</span>)}
                    {canManage && (
                    <span style={{ display: 'flex', gap: 2, opacity: actionsOpacity, transition: 'opacity 0.1s' }}>
                        {node.level < 3 && (
                            <button
                                    style={xpIconBtn({ color: isSelected ? '#fff' : '#316ac5' })}
                                    title="Add child"
                                    onClick={e => { e.stopPropagation(); startAdd(node.id); }}
                                >＋</button>)}
                        {<button
                                style={xpIconBtn({ color: isSelected ? '#fff' : '#555' })}
                                title="Rename"
                                onClick={e => { e.stopPropagation(); startRename(node); }}
                            ><i className="bi bi-pencil-fill" /></button>}
                        {!node.is_system && (
                            <button
                                    style={xpIconBtn({ color: isSelected ? '#ffc0c0' : '#c00' })}
                                    title="Delete"
                                    onClick={e => { e.stopPropagation(); handleDelete(node.id); }}
                                >✕</button>)}
                    </span>
                    )}
                </div>
                {!isCollapsed && node.children?.map(child => renderNode(child))}
                {!isCollapsed && addingState?.parentId === node.id && renderAddRow(node.level + 1)}
            </div>
        );
    };

    return <div>
            {/* Search toolbar */}
            <div style={xpToolbar}>
                <SearchField value={search} onChange={setSearch} placeholder="Search categories..." width={200} />
                <div style={{ width: 1, height: 20, background: '#a0988c', margin: '0 2px', flexShrink: 0 }} />
                <ToolbarCount>
                    {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}
                </ToolbarCount>
            </div>

            {/* Tree */}
            <div style={{
                background: '#fff',
                border: '1px solid #7f9db9',
                boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)',
                minHeight: 160,
                maxHeight: 360,
                overflow: 'auto',
                padding: 4,
            }}>
                {tree.length === 0 && !addingState && (
                    <div style={{ color: '#888', fontSize: 11, padding: 8, fontFamily: xpFont }}>
                        No categories found.
                    </div>
                )}
                {(renderCounter.n = 0, tree.map(node => renderNode(node)))}
            </div>

            {/* Add row */}
            {canManage && (
            <div style={{ ...xpToolbar, borderTop: '1px solid #b0a898', borderBottom: 'none' }}>
                <span style={{ fontFamily: xpFont, fontSize: '11px', color: '#000', whiteSpace: 'nowrap' }}>New category:</span>
                <input
                    style={{ ...xpInput, flex: 1, minWidth: 120 }}
                    placeholder="Category name..."
                    value={newRootName}
                    onChange={e => setNewRootName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddRoot(); } }}
                />
                <button
                    className={XP_BTN}
                    style={xpBtn({ ...BTN_TONES.success })}
                    onClick={handleAddRoot}
                >
                    <i className="bi bi-plus-lg" style={{ marginRight: 4 }}></i>Add
                </button>
            </div>
            )}

            {/* Status bar */}
            <div style={{
                background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)',
                borderTop: '1px solid #b0a898',
                padding: '2px 8px',
                fontSize: 11,
                color: '#333',
                display: 'flex',
                gap: 16,
                fontFamily: xpFont,
            }}>
                {selectedNode ? (
                    <>
                        <span>Selected: {selectedNode.name} (Level {selectedNode.level})</span>
                        <span>Path: {selectedNode.path_names.join(' / ')}</span>
                    </>
                ) : (
                    <span><b>{categories.length}</b> Total</span>
                )}
            </div>
        </div>;
}
