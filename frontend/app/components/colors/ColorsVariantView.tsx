'use client';
import React, { useMemo, useState } from 'react';
import { useConfirm } from '../../context/ConfirmContext';
import ModalWrapper from '../shared/ModalWrapper';
import { FormSection, FormError, XP_BTN, useFloatingMenu, MenuTriggerButton, FloatingMenu, SwatchBox, CODE_FONT } from '../shared/xpTheme';
import { lvInput, lvBtn, lvPrimaryBtn, lvLabel, lvSep, lvTh, lvTd, lvRow, lvThead, TableEmpty } from '../shared/listViewTheme';
import { ToolbarButton, SearchField, ToolbarCount, FilterChipBar, FilterChipOption } from '../shared/shellTheme';
import { ColorFamilyKey, COLOR_FAMILY_META, colorFamilyOf, colorFamilyCounts, derivedColorHex } from '../shared/colorFamilies';

interface Props {
    values: any[];                 // AttributeValue rows of the Colors variant attribute
    // Per-action, not one canManage flag: color_variant.create/edit/delete are granted
    // independently on the Access Control grid, so a create-only role must not be shown
    // a Delete button the API will refuse.
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    /** Resolves with the outcome so a rejected create can be shown in the modal
     *  rather than closing it and leaving the reason in a toast the user has
     *  already dismissed. */
    onAdd: (value: string, hex?: string | null) => Promise<{ ok: boolean; error?: string }>;
    onRename: (valueId: string, value: string, hex?: string | null) => void;
    onDelete: (valueId: string) => void;
}

// Manages the values of the `Colors` variant attribute (system_role='color') — a small
// curated product-color list. This is the SAME variant attribute used for BOM gating,
// dye-recipe matching, MO/stock variant_key; it is NOT the 30k Color Code catalog. It
// lives here as a sibling tab purely for discoverability (single "Colors" home).
//
// Two views, and the table is the DEFAULT on purpose. The swatch grid is the better
// way to read ~140 short colour names — the only column carrying information is the
// swatch — but this page shipped as a table, so opening on the grid would replace a
// list users know with one they have to go looking for. Landing on the table inverts
// the risk to "never finds the grid", which the labelled toggle answers: it reads
// "List / Swatches", not two bare icons, because an icon-only toggle is exactly what
// hides a second view. The choice then persists, so the grid becomes their default
// once they pick it rather than one we imposed.
// No pager on either view — the whole value set already rides in on the attributes
// master load, so paging 140 rows at 25 only hid search hits behind Next.
type ViewMode = 'grid' | 'table';
const VIEW_KEY = 'color_variant_view';

// Swatch picker for the create/edit form: the colour input is always live — no
// checkbox to arm it first. "No color" is the untouched default (hex === null),
// reachable again via Clear once a colour has been picked.
function SwatchPicker({ hex, onChange, size = 22 }: { hex: string | null; onChange: (hex: string | null) => void; size?: number }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <SwatchBox hex={hex} size={size} classic onPick={onChange} />
            {hex
                ? <button type="button" onClick={() => onChange(null)} title="Remove color"
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: '#0a246a', textDecoration: 'underline' }}>Clear</button>
                : <span style={{ fontSize: 11, color: '#666' }}>No color</span>}
        </div>
    );
}

export default function ColorsVariantView({ values, canCreate, canEdit, canDelete, onAdd, onRename, onDelete }: Props) {
    const { confirm } = useConfirm();

    // Lazy initialiser, not an effect: reading it after mount would render the table
    // first and snap to the grid a frame later. Anything unreadable (SSR, private
    // mode, a stale value) falls back to the table.
    const [view, setViewState] = useState<ViewMode>(() => {
        try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'table'; }
        catch { return 'table'; }
    });
    const setView = (v: ViewMode) => {
        setViewState(v);
        try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable — session-only */ }
    };
    const [search, setSearch] = useState('');
    const [family, setFamily] = useState<ColorFamilyKey | 'ALL'>('ALL');
    const [missingOnly, setMissingOnly] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newValue, setNewValue] = useState('');
    const [newHex, setNewHex] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [editHex, setEditHex] = useState<string | null>(null);
    const [editModal, setEditModal] = useState<any | null>(null);
    const [formError, setFormError] = useState('');
    const [saving, setSaving] = useState(false);
    const { openId: menuOpenId, pos: menuPos, toggle: menuToggle, close: menuClose } = useFloatingMenu(140);

    const sorted = useMemo(
        () => [...(values || [])].sort((a, b) => String(a.value).localeCompare(String(b.value))),
        [values],
    );
    // Search first, then the chips: the chip tallies describe what the search left,
    // so "BIRU (14)" never promises rows the search has already excluded.
    const searched = useMemo(
        () => search ? sorted.filter(v => String(v.value).toLowerCase().includes(search.toLowerCase())) : sorted,
        [sorted, search],
    );
    const familyCounts = useMemo(() => colorFamilyCounts(searched), [searched]);
    const missingCount = useMemo(() => searched.filter(v => !v.hex).length, [searched]);
    const filtered = useMemo(() => searched.filter(v =>
        (family === 'ALL' || colorFamilyOf(v.value) === family) && (!missingOnly || !v.hex)
    ), [searched, family, missingOnly]);

    const familyOptions: FilterChipOption[] = [
        { value: 'ALL', label: 'All', count: searched.length },
        ...familyCounts.map(({ key, count }) => ({
            value: key,
            count,
            title: `${COLOR_FAMILY_META[key].label} shades`,
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

    const handleSearchChange = (v: string) => setSearch(v);

    const openCreate = () => { setNewValue(''); setNewHex(null); setFormError(''); setIsModalOpen(true); };

    const handleAdd = async () => {
        const v = newValue.trim();
        if (!v) { setFormError('Enter a color name.'); return; }
        const clash = sorted.find(x => String(x.value).trim().toLowerCase() === v.toLowerCase());
        if (clash) { setFormError(`"${clash.value}" already exists — color names must be unique.`); return; }

        // The loaded list can be stale (it rides in on the attributes master load), so
        // the server's own uniqueness check is the one that decides. Keep the modal open
        // and show what it said instead of closing on an unconfirmed create.
        setFormError('');
        setSaving(true);
        const res = await onAdd(v, newHex);
        setSaving(false);
        if (!res?.ok) { setFormError(res?.error || 'Could not add this color.'); return; }

        setNewValue('');
        setNewHex(null);
        setIsModalOpen(false);
    };

    const startEdit = (v: any) => { setEditingId(v.id); setEditText(v.value); setEditHex(v.hex || null); };
    const commitEdit = (v: any) => {
        const t = editText.trim();
        const nextHex = editHex;
        if (t && (t !== v.value || nextHex !== (v.hex || null))) onRename(v.id, t, nextHex);
        setEditingId(null);
    };

    // Grid cards are too narrow for the table's inline rename field, so a rename
    // started from a card runs through the same form the create modal uses.
    const openEdit = (v: any) => { setEditText(v.value); setEditHex(v.hex || null); setFormError(''); setEditModal(v); };
    const commitEditModal = () => {
        const t = editText.trim();
        if (!t) { setFormError('Enter a color name.'); return; }
        const clash = sorted.find(x => x.id !== editModal.id && String(x.value).trim().toLowerCase() === t.toLowerCase());
        if (clash) { setFormError(`"${clash.value}" already exists — color names must be unique.`); return; }
        if (t !== editModal.value || editHex !== (editModal.hex || null)) onRename(editModal.id, t, editHex);
        setEditModal(null);
    };

    const handleDelete = async (v: any) => {
        const ok = await confirm({
            title: 'Delete Color', variant: 'danger', confirmText: 'Delete',
            message: `Delete color variant "${v.value}"? Blocked if it is used by any BOM, order, or stock.`,
        });
        if (ok) onDelete(v.id);
    };

    const rowStripe = { background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898' };
    const emptyMessage = search || family !== 'ALL' || missingOnly
        ? 'No colors match these filters.'
        : 'No color variants yet.';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <div style={{ ...rowStripe, padding: '4px 8px', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <SearchField classic value={search} onChange={handleSearchChange} placeholder="Search color…" width={220} />
                <span style={lvSep(true)} />
                <FilterChipBar
                    classic
                    value={view}
                    onChange={v => setView(v as ViewMode)}
                    options={[
                        // Labelled, not icon-only: this is the only affordance telling a
                        // user the other view exists at all.
                        { value: 'table', label: <><i className="bi bi-list-ul" style={{ marginRight: 4 }} />List</>, title: 'Table with inline rename' },
                        { value: 'grid', label: <><i className="bi bi-grid-3x3-gap-fill" style={{ marginRight: 4 }} />Swatches</>, title: 'Swatch grid' },
                    ]}
                />
                <ToolbarCount classic right>
                    {filtered.length === sorted.length
                        ? `${sorted.length} color${sorted.length !== 1 ? 's' : ''}`
                        : `${filtered.length} of ${sorted.length} colors`}
                </ToolbarCount>
                {canCreate && (
                    <>
                        <span style={lvSep(true)} />
                        <ToolbarButton classic tone="create" icon="bi-plus-lg" onClick={openCreate}>New Color</ToolbarButton>
                    </>
                )}
            </div>

            {sorted.length > 0 && (
                <div style={{ ...rowStripe, padding: '4px 8px', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                    <FilterChipBar
                        classic
                        flat
                        value={family}
                        onChange={v => setFamily(v as ColorFamilyKey | 'ALL')}
                        options={familyOptions}
                        style={{ flexWrap: 'wrap' }}
                    />
                    <span style={lvSep(true)} />
                    {/* Turns the mostly-empty swatch column into a work queue instead of
                        a defect: 124 of 139 values have no saved hex. */}
                    <FilterChipBar
                        classic
                        flat
                        value={missingOnly ? 'missing' : null}
                        onChange={() => setMissingOnly(m => !m)}
                        options={[{ value: 'missing', label: 'Missing swatch', count: missingCount, tone: 'amber', title: 'Values with no saved hex — the swatch shown is derived from the name' }]}
                    />
                </div>
            )}

            <div style={{ flex: 1, minHeight: 0, background: '#fff', overflow: 'auto' }}>
                {filtered.length === 0 && view === 'grid' && (
                    <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: '#666' }}>
                        {emptyMessage}
                    </div>
                )}

                {view === 'grid' ? (
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                        gap: 8, padding: 10, alignContent: 'start',
                    }}>
                        {filtered.map(v => {
                            const derived = v.hex ? null : derivedColorHex(v.value);
                            return (
                                <div key={v.id} style={{ border: '1px solid #b0a898', background: '#fff' }}>
                                    <SwatchBox
                                        hex={v.hex}
                                        derived={derived}
                                        classic
                                        onPick={canEdit ? h => onRename(v.id, v.value, h) : undefined}
                                        style={{ display: 'block', width: '100%', height: 48, borderRadius: 0, borderWidth: '0 0 1px 0' }}
                                    />
                                    <div style={{ padding: '4px 6px 3px' }}>
                                        <div title={v.value} style={{
                                            fontSize: 11, fontWeight: 600,
                                            color: '#000', lineHeight: 1.3,
                                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                            minHeight: 28,
                                        }}>{v.value}</div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginTop: 2 }}>
                                            <span style={{
                                                fontFamily: CODE_FONT, fontSize: 9.5,
                                                color: v.hex ? '#555' : '#999',
                                                fontStyle: v.hex ? 'normal' : 'italic',
                                            }}>{v.hex || 'no swatch'}</span>
                                            {(canEdit || canDelete) && <MenuTriggerButton classic onClick={e => menuToggle(v.id, e)} />}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                        <thead style={lvThead(true, true)}>
                            <tr>
                                <th style={{ ...lvTh(true), width: 130 }}>Swatch</th>
                                <th style={{ ...lvTh(true), width: 110 }}>Family</th>
                                <th style={lvTh(true)}>Color</th>
                                <th style={{ ...lvTh(true), width: 120, textAlign: 'right', borderRight: 'none' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 && (
                                <TableEmpty colSpan={4} classic tdStyle={lvTd(true)} message={emptyMessage} />
                            )}
                            {filtered.map((v, idx) => {
                                const derived = v.hex ? null : derivedColorHex(v.value);
                                const fam = colorFamilyOf(v.value);
                                return (
                                    <tr key={v.id} style={lvRow(true, idx)}>
                                        <td style={lvTd(true)}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {editingId === v.id ? (
                                                    <SwatchPicker hex={editHex} onChange={setEditHex} size={18} />
                                                ) : (
                                                    <>
                                                        <SwatchBox
                                                            hex={v.hex}
                                                            derived={derived}
                                                            classic
                                                            onPick={canEdit ? h => onRename(v.id, v.value, h) : undefined}
                                                        />
                                                        <span style={{
                                                            fontFamily: CODE_FONT, fontSize: 10,
                                                            color: v.hex ? '#555' : '#999',
                                                            fontStyle: v.hex ? 'normal' : 'italic',
                                                        }}>{v.hex || 'not set'}</span>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                        <td style={{ ...lvTd(true), fontSize: 11, color: '#444' }}>
                                            {COLOR_FAMILY_META[fam].label}
                                        </td>
                                        <td style={lvTd(true)}>
                                            {editingId === v.id ? (
                                                <input
                                                    autoFocus
                                                    style={{ ...lvInput(true), width: 240 }}
                                                    value={editText}
                                                    onChange={e => setEditText(e.target.value)}
                                                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(v); if (e.key === 'Escape') setEditingId(null); }}
                                                />
                                            ) : v.value}
                                        </td>
                                        <td style={{ ...lvTd(true), borderRight: 'none', textAlign: 'right' }}>
                                            {(canEdit || canDelete) && (
                                                <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end', alignItems: 'center' }}>
                                                    {editingId === v.id ? (
                                                        <>
                                                            <button title="Save" onClick={() => commitEdit(v)} style={{ background: 'none', border: '1px solid transparent', cursor: 'pointer', padding: '1px 4px', color: '#1a6e1a', fontSize: 13 }}>
                                                                <i className="bi bi-check-lg" />
                                                            </button>
                                                            <button title="Cancel" onClick={() => setEditingId(null)} style={{ background: 'none', border: '1px solid transparent', cursor: 'pointer', padding: '1px 4px', color: '#555', fontSize: 13 }}>
                                                                <i className="bi bi-x-lg" />
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <MenuTriggerButton classic onClick={e => menuToggle(v.id, e)} />
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Row ⋯ menu: Rename / Delete */}
            {menuOpenId && (() => {
                const v = filtered.find(x => String(x.id) === menuOpenId);
                if (!v) return null;
                return (
                    <FloatingMenu
                        pos={menuPos}
                        items={[
                            { key: 'rename', label: 'Rename', icon: 'bi-pencil-square', hidden: !canEdit, onClick: () => { menuClose(); view === 'grid' ? openEdit(v) : startEdit(v); } },
                            { key: 'delete', label: 'Delete', icon: 'bi-trash', danger: true, hidden: !canDelete, onClick: () => { menuClose(); handleDelete(v); } },
                        ]}
                    />
                );
            })()}

            <ModalWrapper
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="New Color"
                size="sm"
                modeless
                footer={
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button type="button" className={XP_BTN} style={lvBtn(true)} onClick={() => setIsModalOpen(false)}>Cancel</button>
                        <button type="submit" className={XP_BTN} form="color-variant-form" style={lvPrimaryBtn(true)} disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
                    </div>
                }
            >
                <form id="color-variant-form" onSubmit={e => { e.preventDefault(); handleAdd(); }}>
                    <FormError classic>{formError}</FormError>
                    <FormSection title="Color" classic>
                        <div>
                            <label style={lvLabel(true)}>Name *</label>
                            <input
                                autoFocus
                                value={newValue}
                                onChange={e => { setNewValue(e.target.value); if (formError) setFormError(''); }}
                                style={lvInput(true, { width: '100%', ...(formError ? { borderColor: '#8e0000' } : {}) })}
                                required
                            />
                        </div>
                        <div style={{ marginTop: 10 }}>
                            <label style={lvLabel(true)}>Swatch</label>
                            <SwatchPicker hex={newHex} onChange={setNewHex} />
                        </div>
                    </FormSection>
                </form>
            </ModalWrapper>

            <ModalWrapper
                isOpen={!!editModal}
                onClose={() => setEditModal(null)}
                title="Edit Color"
                size="sm"
                modeless
                footer={
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button type="button" className={XP_BTN} style={lvBtn(true)} onClick={() => setEditModal(null)}>Cancel</button>
                        <button type="submit" className={XP_BTN} form="color-variant-edit-form" style={lvPrimaryBtn(true)}>Save</button>
                    </div>
                }
            >
                <form id="color-variant-edit-form" onSubmit={e => { e.preventDefault(); commitEditModal(); }}>
                    <FormError classic>{formError}</FormError>
                    <FormSection title="Color" classic>
                        <div>
                            <label style={lvLabel(true)}>Name *</label>
                            <input
                                autoFocus
                                value={editText}
                                onChange={e => { setEditText(e.target.value); if (formError) setFormError(''); }}
                                style={lvInput(true, { width: '100%', ...(formError ? { borderColor: '#8e0000' } : {}) })}
                                required
                            />
                        </div>
                        <div style={{ marginTop: 10 }}>
                            <label style={lvLabel(true)}>Swatch</label>
                            <SwatchPicker hex={editHex} onChange={setEditHex} />
                        </div>
                    </FormSection>
                </form>
            </ModalWrapper>
        </div>
    );
}
