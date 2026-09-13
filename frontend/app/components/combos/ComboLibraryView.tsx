'use client';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useConfirm } from '../../context/ConfirmContext';
import { useUser } from '../../context/UserContext';
import ModalWrapper from '../shared/ModalWrapper';
import { StatusChip, CodeChip, SwatchBox, CODE_FONT, TableSkeleton, useTableSkeletonMetrics, XP_BTN, useFloatingMenu, MenuTriggerButton, FloatingMenu } from '../shared/xpTheme';
import { SearchField, FilterChipBar, ToolbarCount, ToolbarButton, viewShellStyle, PageTitleBar } from '../shared/shellTheme';
import {
    LV_XP_FONT, lvInput, lvBtn, lvPrimaryBtn, lvLabel, lvTh, lvTd, lvSep, lvRow, lvThead, TableEmpty,
} from '../shared/listViewTheme';
import { ColorFamilyKey, COLOR_FAMILY_META, colorBandsFor, colorFamiliesIn, colorFamilyMembershipCounts } from '../shared/colorFamilies';

const STATUS_FILTERS = ['ALL', 'active', 'archived'];

// A combo IS several colours — `BLACK WHITE`, `NVYRED`, `DSR ABU TUL NAVY LIST NAVY`
// — so 85 of the 147 live rows name two or more. Both views lead with a band strip
// parsed out of the name, which is the only depiction of the entity this table has
// ever had; the alternative was three columns of text, two of which say nothing
// (`name` repeats `code` in 146 of 147 rows and every `description` is empty, so
// both are now tooltips on the code rather than columns).
//
// The table is the default for the same reason as the Colors tab: this page shipped
// as a list, and opening on the grid would replace one users know with one they have
// to go find. The toggle is labelled, and the choice sticks.
type ViewMode = 'grid' | 'table';
const VIEW_KEY = 'combo_library_view';

interface Props {
    combos: any[];
    total: number;
    search: string;
    statusFilter: string;
    loading?: boolean;
    onSearchChange: (s: string) => void;
    onStatusChange: (s: string) => void;
    onCreate: (payload: any) => void;
    onEdit: (id: string, payload: any) => void;
    onDelete: (id: string) => void;
    embedded?: boolean;
}

const emptyForm = () => ({ code: '', name: '', description: '', status: 'active' });

export default function ComboLibraryView({
    combos, total, search, statusFilter, loading,
    onSearchChange, onStatusChange, onCreate, onEdit, onDelete, embedded,
}: Props) {
    const { confirm } = useConfirm();
    const { hasPermission, hasAnyPermission } = useUser();
    const canManage = hasAnyPermission('combo_library.create', 'combo_library.edit', 'combo_library.delete');

    // Lazy initialiser, not an effect: reading it after mount would render the
    // table first and snap to the grid a frame later.
    const [view, setViewState] = useState<ViewMode>(() => {
        try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'table'; }
        catch { return 'table'; }
    });
    const setView = (v: ViewMode) => {
        setViewState(v);
        try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable — session-only */ }
    };
    const [family, setFamily] = useState<ColorFamilyKey | 'ALL'>('ALL');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);
    const [form, setForm] = useState(emptyForm());
    const [searchInput, setSearchInput] = useState(search);
    const { openId: menuOpenId, pos: menuPos, toggle: menuToggle, close: menuClose } = useFloatingMenu(140);

    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('combos', listBodyRef, combos.length > 0);

    // Debounce the search box so each keystroke does not fire a request against many rows.
    useEffect(() => {
        const t = setTimeout(() => onSearchChange(searchInput.trim()), 350);
        return () => clearTimeout(t);
    }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

    // Colour families for a combo are MULTI-MEMBERSHIP: a chip means "contains this
    // colour", so the tallies overlap and deliberately do not sum to the row count —
    // "every combo with NAVY in it" is the question worth asking of this library.
    // `search` and `statusFilter` are still served server-side; `combos` arrives
    // uncapped (see combos/page.tsx), so these counts describe the whole matching set.
    const familyCounts = useMemo(
        () => colorFamilyMembershipCounts(combos.map((c: any) => ({ value: c.code }))),
        [combos],
    );
    const filtered = useMemo(() => family === 'ALL' ? combos : combos.filter((c: any) => {
        const fams = colorFamiliesIn(c.code);
        // The OTHER chip is the inverse: names with no colour word at all (BEBAS,
        // WARNA WARNI, the bare Pantone codes) — 9 of the 147.
        return family === 'OTHER' ? fams.length === 0 : fams.includes(family);
    }), [combos, family]);

    const familyOptions = [
        { value: 'ALL', label: 'All', count: combos.length },
        ...familyCounts.map(({ key, count }) => ({
            value: key,
            count,
            title: `Combos containing ${COLOR_FAMILY_META[key].label.toLowerCase()}`,
            label: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {COLOR_FAMILY_META[key].hex && (
                        <span style={{
                            width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
                            background: COLOR_FAMILY_META[key].hex!, border: '1px solid rgba(0,0,0,0.3)',
                        }} />
                    )}
                    {COLOR_FAMILY_META[key].label}
                </span>
            ),
        })),
    ];

    // `name` repeats `code` in all but one live row and no row has a description, so
    // neither earns a column — they surface here only when they say something the
    // code does not (the rule `colorTitle` already applies in the Color Library).
    const codeTitle = (c: any) => {
        const extra = [
            c.name && String(c.name).trim().toLowerCase() !== String(c.code).trim().toLowerCase() ? c.name : null,
            c.description || null,
        ].filter(Boolean);
        return extra.length ? `${c.code} — ${extra.join(' · ')}` : undefined;
    };

    // Names the strip instead of leaving the reader to guess the band order.
    const bandTitle = (code: string) => {
        const fams = colorFamiliesIn(code);
        return fams.length
            ? `${code} — ${fams.map(f => COLOR_FAMILY_META[f].label.toLowerCase()).join(' + ')}`
            : `${code} — no colour named`;
    };

    const emptyMessage = family !== 'ALL'
        ? `No combos contain ${COLOR_FAMILY_META[family].label.toLowerCase()}.`
        : 'No combos found.';

    const openCreate = () => { setEditing(null); setForm(emptyForm()); setIsModalOpen(true); };
    const openEdit = (c: any) => {
        setEditing(c);
        setForm({ code: c.code || '', name: c.name || '', description: c.description || '', status: c.status || 'active' });
        setIsModalOpen(true);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.code.trim() || !form.name.trim()) return;
        const payload: any = { ...form };
        if (editing) onEdit(editing.id, payload);
        else onCreate(payload);
        setIsModalOpen(false);
        setEditing(null);
        setForm(emptyForm());
    };

    const handleDelete = async (c: any) => {
        const ok = await confirm({
            title: c.usage_count > 0 ? 'Archive Combo' : 'Delete Combo',
            message: c.usage_count > 0
                ? `"${c.code}" is used by ${c.usage_count} record(s); it will be archived, not deleted.`
                : `Delete combo "${c.code} — ${c.name}"? This cannot be undone.`,
            confirmText: c.usage_count > 0 ? 'Archive' : 'Delete',
            variant: 'danger',
        });
        if (ok) onDelete(c.id);
    };

    return (
        <div style={embedded
            ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: LV_XP_FONT, background: '#fff' }
            : viewShellStyle(true, 'page', { fontFamily: LV_XP_FONT })}>

            {/* Title bar (hidden when embedded under a tab shell) */}
            {!embedded && (
            <PageTitleBar classic icon="bi-grid-3x3-gap" title="Combo Library" />
            )}

            {/* Toolbar */}
            <div style={{ background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
                <SearchField classic value={searchInput} onChange={setSearchInput} placeholder="Search code, name, description…" width={260} />
                <span style={lvSep(true)} />
                <FilterChipBar
                    classic
                    options={STATUS_FILTERS.map(s => ({ value: s, label: s === 'ALL' ? 'All' : s }))}
                    value={statusFilter}
                    onChange={onStatusChange}
                />
                <span style={lvSep(true)} />
                <FilterChipBar
                    classic
                    value={view}
                    onChange={v => setView(v as ViewMode)}
                    options={[
                        // Labelled, not icon-only: this is the only affordance telling a
                        // user the other view exists at all.
                        { value: 'table', label: <><i className="bi bi-list-ul" style={{ marginRight: 4 }} />List</>, title: 'Table' },
                        { value: 'grid', label: <><i className="bi bi-grid-3x3-gap-fill" style={{ marginRight: 4 }} />Swatches</>, title: 'Swatch grid' },
                    ]}
                />
                <ToolbarCount classic right>
                    {filtered.length === total
                        ? `${total.toLocaleString()} combo${total !== 1 ? 's' : ''}`
                        : `${filtered.length.toLocaleString()} of ${total.toLocaleString()} combos`}
                </ToolbarCount>
                {canManage && (
                    <>
                        <span style={lvSep(true)} />
                        <ToolbarButton classic tone="create" icon="bi-plus-lg" onClick={openCreate}>New Combo</ToolbarButton>
                    </>
                )}
            </div>

            {/* Colour-family chips, parsed from the combo names */}
            {familyCounts.length > 0 && (
                <div style={{ background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
                    <FilterChipBar
                        classic
                        flat
                        value={family}
                        onChange={v => setFamily(v as ColorFamilyKey | 'ALL')}
                        options={familyOptions}
                        style={{ flexWrap: 'wrap' }}
                    />
                </div>
            )}

            {/* List / swatch grid */}
            <div style={{ flex: 1, minHeight: 0, background: '#fff', overflow: 'auto' }}>
                {view === 'grid' ? (
                    filtered.length === 0 ? (
                        <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: '#666' }}>
                            {loading ? 'Loading…' : emptyMessage}
                        </div>
                    ) : (
                        <div style={{
                            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                            gap: 8, padding: 10, alignContent: 'start',
                        }}>
                            {filtered.map((c: any) => (
                                <div key={c.id} style={{ border: '1px solid #b0a898', background: '#fff' }}>
                                    <SwatchBox
                                        bands={colorBandsFor(c.code)}
                                        classic
                                        title={bandTitle(c.code)}
                                        style={{ display: 'block', width: '100%', height: 48, borderRadius: 0, borderWidth: '0 0 1px 0' }}
                                    />
                                    <div style={{ padding: '4px 6px 3px' }}>
                                        <div title={codeTitle(c) ?? c.code} style={{
                                            fontFamily: CODE_FONT, fontSize: 10.5, fontWeight: 600,
                                            color: '#000', lineHeight: 1.3,
                                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                            minHeight: 27,
                                        }}>{c.code}</div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginTop: 2 }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                <StatusChip status={c.status} tint />
                                                {c.usage_count > 0 && (
                                                    <span title={`Used by ${c.usage_count} record(s)`} style={{ fontSize: 9.5, color: '#555' }}>
                                                        &times;{c.usage_count}
                                                    </span>
                                                )}
                                            </span>
                                            {canManage && <MenuTriggerButton classic onClick={e => menuToggle(c.id, e)} />}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )
                ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                    <thead style={lvThead(true, true)}>
                        <tr>
                            <th style={{ ...lvTh(true), width: 70 }}>Colors</th>
                            <th style={lvTh(true)}>Code</th>
                            <th style={{ ...lvTh(true), width: 60, textAlign: 'center' }}>Usage</th>
                            <th style={{ ...lvTh(true), width: 80 }}>Status</th>
                            <th style={{ ...lvTh(true), width: 120, textAlign: 'right', borderRight: 'none' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody ref={listBodyRef}>
                        {filtered.length === 0 && (loading ? (
                            <TableSkeleton rows={8} cols={skel.cols ?? 5} classic tdStyle={lvTd(true)} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                        ) : (
                            <TableEmpty colSpan={5} classic tdStyle={lvTd(true)} message={emptyMessage} />
                        ))}
                        {filtered.map((c: any, idx: number) => (
                            <tr key={c.id} style={lvRow(true, idx)}>
                                <td style={lvTd(true)}>
                                    <SwatchBox bands={colorBandsFor(c.code)} classic title={bandTitle(c.code)} style={{ width: 44 }} />
                                </td>
                                <td style={lvTd(true)}>
                                    <CodeChip code={c.code} classic tone="accent" title={codeTitle(c)} />
                                </td>
                                <td style={{ ...lvTd(true), textAlign: 'center' }}>{c.usage_count || 0}</td>
                                <td style={lvTd(true)}><StatusChip status={c.status} /></td>
                                <td style={{ ...lvTd(true), borderRight: 'none', textAlign: 'right' }}>
                                    {canManage && <MenuTriggerButton classic onClick={e => menuToggle(c.id, e)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                )}
            </div>

            {/* Row ⋯ menu: Edit / Delete (Archive when in use) */}
            {menuOpenId && (() => {
                const c = filtered.find((x: any) => String(x.id) === menuOpenId);
                if (!c || !canManage) return null;
                return (
                    <FloatingMenu
                        pos={menuPos}
                        items={[
                            { key: 'edit', label: 'Edit', icon: 'bi-pencil-square', onClick: () => { menuClose(); openEdit(c); } },
                            {
                                key: 'delete',
                                label: c.usage_count > 0 ? 'Archive' : 'Delete',
                                icon: c.usage_count > 0 ? 'bi-archive' : 'bi-trash',
                                danger: true,
                                onClick: () => { menuClose(); handleDelete(c); },
                            },
                        ]}
                    />
                );
            })()}

            <ModalWrapper
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editing ? `Edit Combo — ${editing.code}` : 'New Combo'}
                size="md"
                modeless
                footer={
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button type="button" className={XP_BTN} style={lvBtn(true)} onClick={() => setIsModalOpen(false)}>Cancel</button>
                        <button type="submit" form="combo-form" className={XP_BTN} style={lvPrimaryBtn(true)}>
                            {editing ? 'Save' : 'Create'}
                        </button>
                    </div>
                }
            >
                <form id="combo-form" onSubmit={handleSubmit}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                            <label style={lvLabel(true)}>Code *</label>
                            <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} style={lvInput(true)} required />
                        </div>
                        <div>
                            <label style={lvLabel(true)}>Name *</label>
                            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={lvInput(true)} required />
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={lvLabel(true)}>Description</label>
                            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Weave / yarn-color pattern notes…" style={{ ...lvInput(true), height: 'auto', resize: 'vertical' }} />
                        </div>
                        {editing && (
                            <div>
                                <label style={lvLabel(true)}>Status</label>
                                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={lvInput(true)}>
                                    <option value="active">active</option>
                                    <option value="archived">archived</option>
                                </select>
                            </div>
                        )}
                    </div>
                </form>
            </ModalWrapper>
        </div>
    );
}
