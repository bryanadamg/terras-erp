'use client';

import React, { useState } from 'react';
import { useUser } from '../../context/UserContext';
import { useConfirm } from '../../context/ConfirmContext';
import { XPActionButton, xpFont, rowStateBg, XP_BTN } from '../shared/xpTheme';
import { lvInput, lvBtn } from '../shared/listViewTheme';
import { xpToolbar, SearchField, ToolbarCount } from '../shared/shellTheme';

type Category = {
    id: string;
    name: string;
    parent_id: string | null;
    level: number;
    path_names: string[];
    is_system: boolean;
    item_count?: number;
};

interface CategoriesViewProps {
    categories: Category[];
    onCreateCategory: (name: string, parentId?: string) => Promise<any>;
    onDeleteCategory: (id: string) => Promise<void>;
    onRenameCategory: (id: string, name: string) => Promise<void>;
}

const MAX_DEPTH = 3; // mirrors the backend's "Maximum category depth of 3"
const byName = (a: Category, b: Category) => a.name.localeCompare(b.name);

// A search hit is kept WITH its ancestors, so a matched leaf still has a column
// path leading to it (filtering the flat list alone dropped every matched child
// whose parent did not match).
function keepWithAncestors(cats: Category[], term: string): Set<string> {
    const q = term.toLowerCase();
    const byId = new Map(cats.map(c => [c.id, c]));
    const keep = new Set<string>();
    for (const c of cats) {
        if (!c.name.toLowerCase().includes(q)) continue;
        for (let cur: Category | undefined = c; cur && !keep.has(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined)
            keep.add(cur.id);
    }
    return keep;
}

// Three fixed columns, one per level — the backend caps depth at 3, so the columns
// never overflow (same shape as Locations' store | zone | bin). A column is the
// children of the selection to its left, and is where you add to that level.
export default function CategoriesView({
    categories,
    onCreateCategory,
    onDeleteCategory,
    onRenameCategory,
}: CategoriesViewProps) {
    const { hasPermission } = useUser();
    const { confirm } = useConfirm();
    const canCreate = hasPermission('category.create');
    const canEdit = hasPermission('category.edit');
    const canDelete = hasPermission('category.delete');

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [pending, setPending] = useState<{ name: string; parentId: string | null } | null>(null);
    const [search, setSearch] = useState('');
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
    const [adding, setAdding] = useState<{ level: number; value: string } | null>(null);

    const all = categories || [];
    const byId = new Map(all.map(c => [c.id, c]));
    const keep = search.trim() ? keepWithAncestors(all, search.trim()) : null;
    const childrenOf = (id: string | null) =>
        all.filter(c => (c.parent_id ?? null) === id && (!keep || keep.has(c.id))).sort(byName);
    const allChildrenOf = (id: string) => all.filter(c => c.parent_id === id);
    const subtreeCount = (id: string): number =>
        (byId.get(id)?.item_count ?? 0) + allChildrenOf(id).reduce((s, c) => s + subtreeCount(c.id), 0);

    // A just-created category is selected once the refresh brings it in.
    const created = pending ? all.find(c => c.name === pending.name && (c.parent_id ?? null) === pending.parentId) : null;
    if (created) { setPending(null); setSelectedId(created.id); }

    // path[0..2] = the selection's chain, root first. Default: first root.
    const selected = (selectedId && byId.get(selectedId)) || childrenOf(null)[0] || null;
    const path: Category[] = [];
    for (let c: Category | undefined = selected ?? undefined; c; c = c.parent_id ? byId.get(c.parent_id) : undefined) path.unshift(c);

    const columns: { level: number; parent: Category | null; rows: Category[] }[] = [1, 2, 3].map(level => {
        const parent = level === 1 ? null : path[level - 2] ?? null;
        return { level, parent, rows: level === 1 || parent ? childrenOf(parent?.id ?? null) : [] };
    });

    const select = (id: string) => { setSelectedId(id); setRenaming(null); };

    // ── Actions ──────────────────────────────────────────────────────────────
    const commitRename = async () => {
        const r = renaming;
        setRenaming(null);
        const cur = r ? byId.get(r.id) : null;
        if (r && cur && r.value.trim() && r.value.trim() !== cur.name) await onRenameCategory(r.id, r.value.trim());
    };

    const commitAdd = async (parent: Category | null) => {
        const v = adding?.value.trim();
        if (!v) { setAdding(null); return; }
        const siblings = all.filter(c => (c.parent_id ?? null) === (parent?.id ?? null));
        if (siblings.some(c => c.name.toLowerCase() === v.toLowerCase())) return;
        const res = await onCreateCategory(v, parent?.id);
        if (res && res.ok === false) return;
        setAdding(null); setSearch('');
        setPending({ name: v, parentId: parent?.id ?? null });
    };

    const deleteBlock = (c: Category) =>
        c.is_system ? 'System category — cannot be deleted'
        : allChildrenOf(c.id).length ? 'Has subcategories — delete those first'
        : null;

    const handleDelete = async (c: Category) => {
        if (deleteBlock(c)) return;
        const n = c.item_count ?? 0;
        const ok = await confirm({
            title: 'Delete Category', variant: 'danger', confirmText: 'Delete',
            message: n
                ? `Delete category "${c.name}"? Its ${n} item${n !== 1 ? 's' : ''} will become uncategorized.`
                : `Delete category "${c.name}"? No items use it.`,
        });
        if (!ok) return;
        await onDeleteCategory(c.id);
        if (path.some(p => p.id === c.id)) setSelectedId(c.parent_id);
    };

    // ── Pieces ───────────────────────────────────────────────────────────────
    const empty = (text: string) => (
        <div style={{ padding: '20px 10px', textAlign: 'center', color: '#888', fontStyle: 'italic', fontFamily: xpFont, fontSize: 11 }}>{text}</div>
    );

    const row = (c: Category, level: number) => {
        const onPath = path[level - 1]?.id === c.id;
        const isSel = selected?.id === c.id;
        const hover = hoveredId === c.id;
        const hasKids = allChildrenOf(c.id).length > 0;
        const n = c.item_count ?? 0;
        const block = deleteBlock(c);

        if (renaming?.id === c.id) {
            return (
                <div key={c.id} style={{ display: 'flex', gap: 4, padding: '2px 6px', background: rowStateBg('expanded'), borderBottom: '1px solid #eceae2' }}>
                    <input
                        autoFocus
                        style={lvInput({ flex: 1, minWidth: 0 })}
                        value={renaming.value}
                        onChange={e => setRenaming({ id: c.id, value: e.target.value })}
                        onBlur={commitRename}
                        onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                            if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); }
                        }}
                        aria-label="Category name"
                    />
                </div>
            );
        }

        return (
            <div
                key={c.id}
                role="option"
                aria-selected={onPath}
                tabIndex={0}
                onClick={() => select(c.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c.id); } }}
                onMouseEnter={() => setHoveredId(c.id)}
                onMouseLeave={() => setHoveredId(null)}
                title={c.path_names.join(' › ')}
                style={{
                    display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', cursor: 'pointer',
                    fontFamily: xpFont, fontSize: 11, userSelect: 'none',
                    borderBottom: '1px solid #eceae2',
                    // The selection itself is solid; ancestors on its path stay lit, paler.
                    background: isSel ? rowStateBg('selected') : onPath ? '#e8eef8' : hover ? rowStateBg('expanded') : 'transparent',
                    borderLeft: `3px solid ${isSel ? '#316ac5' : onPath ? '#9db6dc' : 'transparent'}`,
                    fontWeight: onPath ? 'bold' : 'normal',
                }}
            >
                <i className={`bi ${hasKids ? 'bi-folder-fill' : 'bi-folder'}`} style={{ color: '#c8a030' }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                {c.is_system && <i className="bi bi-shield-lock" style={{ color: '#a06000', fontSize: 10 }} title="System category" />}
                {(canEdit || canDelete) && (
                    // Hover-revealed row actions, same as the Attributes / UOM tabs.
                    <span style={{ display: 'flex', gap: 3, opacity: hover ? 1 : 0, transition: 'opacity 0.1s' }} onClick={e => e.stopPropagation()}>
                        {canEdit && !c.is_system && (
                            <XPActionButton icon="bi-pencil" title="Rename" onClick={() => { setAdding(null); setRenaming({ id: c.id, value: c.name }); }} />
                        )}
                        {canDelete && !c.is_system && (
                            <XPActionButton tone="danger" icon="bi-trash" title={block ?? 'Delete'} disabled={!!block} onClick={() => handleDelete(c)} />
                        )}
                    </span>
                )}
                {n > 0 && <span style={{ fontSize: 10, color: '#777', fontWeight: 'normal', minWidth: 14, textAlign: 'right' }} title={`${n} item${n !== 1 ? 's' : ''} filed directly here`}>{n}</span>}
                {level < MAX_DEPTH && <i className="bi bi-chevron-right" style={{ fontSize: 9, color: onPath ? '#316ac5' : '#bbb' }} />}
            </div>
        );
    };

    const column = ({ level, parent, rows }: typeof columns[number]) => {
        const reachable = level === 1 || !!parent;
        const isAdding = adding?.level === level;
        const title = level === 1 ? 'Categories' : parent ? parent.name : `Level ${level}`;
        const dup = isAdding && !!adding!.value.trim() && all.some(c =>
            (c.parent_id ?? null) === (parent?.id ?? null) && c.name.toLowerCase() === adding!.value.trim().toLowerCase());
        return (
            <div
                key={level}
                role="listbox"
                aria-label={`Level ${level}`}
                style={{
                    flex: 1, minWidth: 0,
                    display: 'flex', flexDirection: 'column',
                    borderRight: level < MAX_DEPTH ? '1px solid #a0988c' : 'none',
                    background: reachable ? '#fff' : '#f5f4ef',
                }}
            >
                <div style={xpToolbar({ flexShrink: 0, flexWrap: 'nowrap', justifyContent: 'space-between' })}>
                    <span style={{ fontFamily: xpFont, fontSize: 11, fontWeight: 'bold', color: level === 1 ? '#000' : '#003080', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {title} <span style={{ color: '#888', fontWeight: 'normal' }}>({rows.length})</span>
                    </span>
                    {canCreate && reachable && (
                        <button
                            type="button" className={XP_BTN} style={lvBtn('success', { padding: '1px 6px' })}
                            title={parent ? `New subcategory of ${parent.name}` : 'New top-level category'}
                            onClick={() => { setRenaming(null); setAdding(isAdding ? null : { level, value: '' }); }}
                        >
                            <i className="bi bi-plus-lg" />
                        </button>
                    )}
                </div>
                {isAdding && (
                    <div style={{ display: 'flex', gap: 4, padding: '4px 6px', background: '#eef3fb', borderBottom: '1px solid #b0c4de' }}>
                        <input
                            autoFocus
                            style={lvInput({ flex: 1, minWidth: 0, ...(dup ? { borderColor: '#c00000' } : {}) })}
                            title={dup ? 'Already exists here' : undefined}
                            placeholder={parent ? `New in ${parent.name}… (Enter)` : 'New category… (Enter)'}
                            value={adding!.value}
                            onChange={e => setAdding({ level, value: e.target.value })}
                            onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); commitAdd(parent); }
                                if (e.key === 'Escape') { e.preventDefault(); setAdding(null); }
                            }}
                        />
                        <button type="button" className={XP_BTN} style={lvBtn('success', { padding: '1px 6px' })} disabled={dup} onClick={() => commitAdd(parent)}>Add</button>
                    </div>
                )}
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                    {!reachable
                        ? empty(`Select a level ${level - 1} category.`)
                        : rows.length === 0
                            ? empty(keep ? 'No matches.' : parent ? `No subcategories in ${parent.name}${canCreate ? ' — add one with +' : ''}.` : 'No categories defined.')
                            : rows.map(c => row(c, level))}
                </div>
            </div>
        );
    };

    const direct = selected?.item_count ?? 0;
    const total = selected ? subtreeCount(selected.id) : 0;
    const hasKids = selected ? allChildrenOf(selected.id).length > 0 : false;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <div style={xpToolbar({ flexShrink: 0, padding: '4px 8px' })}>
                <SearchField value={search} onChange={setSearch} placeholder="Search categories…" width={240} />
                <ToolbarCount right>{all.length} categor{all.length === 1 ? 'y' : 'ies'}</ToolbarCount>
            </div>

            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                {columns.map(column)}
            </div>

            {/* Status bar: where the selection sits and what it holds */}
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(to bottom,#e8e6df,#d5d3cc)', borderTop: '1px solid #b0a898', padding: '3px 8px', fontFamily: xpFont, fontSize: 11, color: '#333' }}>
                {selected ? (
                    <>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <i className="bi bi-folder2-open me-1" style={{ color: '#c8a030' }} />
                            {path.map(p => p.name).join(' › ')}
                        </span>
                        <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                            <b>{direct}</b> item{direct !== 1 ? 's' : ''} filed here
                            {hasKids && <> · <b>{total}</b> incl. subcategories</>}
                        </span>
                    </>
                ) : <span style={{ color: '#888' }}>No category selected</span>}
            </div>
        </div>
    );
}
