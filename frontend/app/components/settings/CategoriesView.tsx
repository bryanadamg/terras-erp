'use client';

import React, { useState } from 'react';
import { useUser } from '../../context/UserContext';
import { useConfirm } from '../../context/ConfirmContext';
import { XPActionButton } from '../shared/xpTheme';
import { xpToolbar, SearchField, ToolbarCount } from '../shared/shellTheme';
import {
    ColumnPanes, ColumnPane, ColumnAddBar, ColumnInput, ColumnRenameRow, ColumnRow, ColumnCount,
    ColumnEmpty, ColumnStatusBar,
} from '../shared/columnBrowser';

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

// Three fixed columns, one per level (shared/columnBrowser.tsx — same shape as
// Locations' store | zone | bin). The backend caps depth at 3, so the columns
// never overflow. A column is the children of the selection to its left, and is
// where you add to that level.
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

    const columns = [1, 2, 3].map(level => {
        const parent = level === 1 ? null : path[level - 2] ?? null;
        return { level, parent, rows: level === 1 || parent ? childrenOf(parent?.id ?? null) : [] };
    });

    const select = (id: string) => { setSelectedId(id); setRenaming(null); };

    // ── Actions ──────────────────────────────────────────────────────────────
    const siblingsOf = (parent: Category | null) => all.filter(c => (c.parent_id ?? null) === (parent?.id ?? null));
    const isDup = (parent: Category | null, v: string) =>
        !!v.trim() && siblingsOf(parent).some(c => c.name.toLowerCase() === v.trim().toLowerCase());

    const commitRename = async () => {
        const r = renaming;
        setRenaming(null);
        const cur = r ? byId.get(r.id) : null;
        if (r && cur && r.value.trim() && r.value.trim() !== cur.name) await onRenameCategory(r.id, r.value.trim());
    };

    const commitAdd = async (parent: Category | null) => {
        const v = adding?.value.trim();
        if (!v || isDup(parent, v)) return;
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

    // ── Rows / panes ─────────────────────────────────────────────────────────
    const row = (c: Category, level: number) => {
        if (renaming?.id === c.id) {
            return (
                <ColumnRenameRow
                    key={c.id}
                    value={renaming.value}
                    onChange={v => setRenaming({ id: c.id, value: v })}
                    onCommit={commitRename}
                    onCancel={() => setRenaming(null)}
                />
            );
        }
        const onPath = path[level - 1]?.id === c.id;
        const block = deleteBlock(c);
        const n = c.item_count ?? 0;
        const editable = !c.is_system && (canEdit || canDelete);
        return (
            <ColumnRow
                key={c.id}
                icon={allChildrenOf(c.id).length ? 'bi-folder-fill' : 'bi-folder'}
                label={c.name}
                selected={selected?.id === c.id}
                onPath={onPath && selected?.id !== c.id}
                onSelect={() => select(c.id)}
                chevron={level < MAX_DEPTH}
                title={c.path_names.join(' › ')}
                actions={editable ? (
                    <>
                        {canEdit && <XPActionButton icon="bi-pencil" title="Rename" onClick={() => { setAdding(null); setRenaming({ id: c.id, value: c.name }); }} />}
                        {canDelete && <XPActionButton tone="danger" icon="bi-trash" title={block ?? 'Delete'} disabled={!!block} onClick={() => handleDelete(c)} />}
                    </>
                ) : undefined}
                trailing={
                    <>
                        {c.is_system && <i className="bi bi-shield-lock" style={{ color: '#a06000', fontSize: 10 }} title="System category" />}
                        <ColumnCount n={n} title={`${n} item${n !== 1 ? 's' : ''} filed directly here`} />
                    </>
                }
            />
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

            <ColumnPanes>
                {columns.map(({ level, parent, rows }) => {
                    const reachable = level === 1 || !!parent;
                    const isAdding = adding?.level === level;
                    const dup = isAdding && isDup(parent, adding!.value);
                    return (
                        <ColumnPane
                            key={level}
                            last={level === MAX_DEPTH}
                            label={`Level ${level}`}
                            title={level === 1 ? 'Categories' : parent ? parent.name : `Level ${level}`}
                            count={reachable ? rows.length : undefined}
                            dimmed={!reachable}
                            onAdd={canCreate && reachable ? () => { setRenaming(null); setAdding(isAdding ? null : { level, value: '' }); } : undefined}
                            addTitle={parent ? `New subcategory of ${parent.name}` : 'New top-level category'}
                            adding={isAdding ? (
                                <ColumnAddBar onSubmit={() => commitAdd(parent)} onCancel={() => setAdding(null)} submitDisabled={!adding!.value.trim() || dup}>
                                    <ColumnInput
                                        autoFocus
                                        placeholder={parent ? `New in ${parent.name}…` : 'New category…'}
                                        value={adding!.value}
                                        invalid={dup && 'Already exists here'}
                                        onChange={e => setAdding({ level, value: e.target.value })}
                                    />
                                </ColumnAddBar>
                            ) : undefined}
                        >
                            {!reachable
                                ? <ColumnEmpty>Select a level {level - 1} category.</ColumnEmpty>
                                : rows.length === 0
                                    ? <ColumnEmpty>{keep ? 'No matches.' : parent ? `No subcategories in ${parent.name}${canCreate ? ' — add one with +' : ''}.` : 'No categories defined.'}</ColumnEmpty>
                                    : rows.map(c => row(c, level))}
                        </ColumnPane>
                    );
                })}
            </ColumnPanes>

            <ColumnStatusBar
                left={selected
                    ? <><i className="bi bi-folder2-open me-1" style={{ color: '#c8a030' }} />{path.map(p => p.name).join(' › ')}</>
                    : <span style={{ color: '#888' }}>No category selected</span>}
                right={selected ? (
                    <>
                        <b>{direct}</b> item{direct !== 1 ? 's' : ''} filed here
                        {hasKids && <> · <b>{total}</b> incl. subcategories</>}
                    </>
                ) : undefined}
            />
        </div>
    );
}
