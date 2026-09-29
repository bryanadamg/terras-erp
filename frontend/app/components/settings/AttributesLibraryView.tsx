'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useConfirm } from '../../context/ConfirmContext';
import ModalWrapper from '../shared/ModalWrapper';
import { FormSection, Chip, XPActionButton, XP_BTN } from '../shared/xpTheme';
import { lvInput, lvBtn, lvPrimaryBtn, lvLabel, lvSep } from '../shared/listViewTheme';
import { ToolbarButton, SearchField, ToolbarCount, xpToolbar } from '../shared/shellTheme';
import { ColumnPanes, ColumnPane, ColumnRow, ColumnEmpty, DetailPane, DetailHeader, DetailRow, BROWSER_TONES } from '../shared/columnBrowser';

// Attributes with a dedicated management home are hidden here so they are not
// hand-edited in two places:
//   - Combo (system_role='combo')             → Combo Library (Inventory nav)
//   - Color Code (system_role='labdip_color') → Color Library, "Color Codes" tab
//   - Colors (system_role='color')            → Color Library, "Colors (Variant)" tab
// Each attribute + its values still exist underneath (load-bearing: Colors/Combo gate
// BOM selection + drive recipe-match / variant_key; labdip_color mirrors the library).
// `Materials` stays — it is managed here, no dedicated home.
const HIDDEN_LIBRARY_ROLES = ['combo', 'labdip_color', 'color'];

// Where each system attribute's values are picked — shown so the user knows what
// editing the list affects. Every role seeded in `seed_system_attributes()` needs a
// row, otherwise the raw role key leaks into the UI.
const ROLE_LABELS: Record<string, string> = {
    material: 'Sample Materials',
    color: 'Sample Colors',
    labdip_color: 'Labdip Colors',
    combo: 'Sample Combo',
    wash_bath: 'Dye Recipe · Wash Bath',
    finishing_step: 'Dye Recipe · Finishing',
    sample_category: 'Sample Request Category',
    quarantine_status: 'Quarantine QC Status',
    dyeing_speed: 'Dyeing Rope Speed',
};
const roleLabel = (role?: string | null) => (role ? ROLE_LABELS[role] || role : null);


interface Props {
    attributes: any[];
    canManage: boolean;
    onCreateAttribute: (p: any) => Promise<Response>;
    onUpdateAttribute: (id: string, name: string) => void;
    onDeleteAttribute: (id: string) => void;
    onAddValue: (attributeId: string, value: string) => void;
    onUpdateValue: (valueId: string, value: string) => void;
    onDeleteValue: (valueId: string) => void;
}

const nextNumber = (values: string[]) => {
    const nums = values.map(v => parseInt(v)).filter(n => !isNaN(n));
    return nums.length > 0 ? Math.max(...nums) + 1 : null;
};

// Two-pane master/detail (shared/columnBrowser.tsx, same chrome as the UOM tab):
// attribute list on the left, the selected attribute's full value list edited in
// place on the right. Replaces a table that
// capped each row at 8 value chips and routed every edit through a modal.
export default function AttributesLibraryView({
    attributes, canManage,
    onCreateAttribute, onUpdateAttribute, onDeleteAttribute,
    onAddValue, onUpdateValue, onDeleteValue,
}: Props) {
    const { confirm } = useConfirm();

    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [pendingName, setPendingName] = useState<string | null>(null);
    const [valueFilter, setValueFilter] = useState('');
    const [valueDraft, setValueDraft] = useState('');
    const [nameDraft, setNameDraft] = useState<string | null>(null);

    const visible = (attributes || []).filter((a: any) => !HIDDEN_LIBRARY_ROLES.includes(a.system_role));
    const q = search.trim().toLowerCase();
    const filtered = visible.filter((a: any) =>
        !q || a.name.toLowerCase().includes(q)
        || (roleLabel(a.system_role) || '').toLowerCase().includes(q)
        || a.values.some((v: any) => v.value.toLowerCase().includes(q)));

    // A just-created attribute is selected once the refresh brings it in; otherwise
    // keep the pick, falling back to the first row when it is filtered out/deleted.
    const pending = pendingName ? visible.find((a: any) => a.name === pendingName) : null;
    if (pending) { setPendingName(null); setSelectedId(pending.id); }
    const selected = filtered.find((a: any) => a.id === selectedId) || filtered[0] || null;

    const select = (id: string) => {
        if (id === selected?.id) return;
        setSelectedId(id); setValueFilter(''); setValueDraft(''); setNameDraft(null);
    };

    const locked = !canManage || !!selected?.is_system;
    const values: any[] = selected?.values || [];
    const vq = valueFilter.trim().toLowerCase();
    const shownValues = vq ? values.filter(v => v.value.toLowerCase().includes(vq)) : values;
    const nextVal = selected ? nextNumber(values.map(v => v.value)) : null;
    const dupDraft = !!valueDraft.trim() && values.some(x => x.value.toLowerCase() === valueDraft.trim().toLowerCase());

    // New values append at the end — follow them there so the add is visible.
    const listRef = useRef<HTMLDivElement>(null);
    const lastCount = useRef({ id: null as string | null, n: 0 });
    useEffect(() => {
        const prev = lastCount.current;
        if (prev.id === selected?.id && values.length > prev.n && listRef.current)
            listRef.current.scrollTop = listRef.current.scrollHeight;
        lastCount.current = { id: selected?.id ?? null, n: values.length };
    }, [selected?.id, values.length]);
    const nameDirty = nameDraft !== null && nameDraft.trim() !== '' && nameDraft.trim() !== selected?.name;

    const addValue = (raw: string) => {
        const v = raw.trim();
        if (!selected || !v) return;
        if (values.some(x => x.value.toLowerCase() === v.toLowerCase())) return;
        onAddValue(selected.id, v);
        setValueDraft('');
    };

    const saveName = () => {
        if (selected && nameDirty) onUpdateAttribute(selected.id, nameDraft!.trim());
        setNameDraft(null);
    };

    const handleDeleteValue = async (v: any) => {
        const ok = await confirm({
            title: 'Delete Value', variant: 'danger', confirmText: 'Delete',
            message: `Delete value "${v.value}"? Blocked if it is used by any item, BOM, or stock.`,
        });
        if (ok) onDeleteValue(v.id);
    };

    // ── New-attribute dialog (the only modal left) ──────────────────────────
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const [newValues, setNewValues] = useState<string[]>([]);
    const [newDraft, setNewDraft] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const newNext = nextNumber(newValues);

    const openCreate = () => { setNewName(''); setNewValues([]); setNewDraft(''); setIsModalOpen(true); };
    const addNewValue = (raw: string) => {
        const v = raw.trim();
        if (!v || newValues.some(x => x.toLowerCase() === v.toLowerCase())) return;
        setNewValues([...newValues, v]); setNewDraft('');
    };
    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newName.trim() || isSubmitting) return;
        setIsSubmitting(true);
        try {
            const res = await onCreateAttribute({ name: newName.trim(), values: newValues.map(v => ({ value: v })) });
            if (!res?.ok) return;
            setSearch(''); setPendingName(newName.trim()); setIsModalOpen(false);
        } finally { setIsSubmitting(false); }
    };

    return (
        <ColumnPanes>
            {/* ── Left: attribute list ─────────────────────────────────────── */}
            <ColumnPane
                width={280}
                label="Attributes"
                toolbar={<SearchField value={search} onChange={setSearch} placeholder="Search name, role, value…" grow width={400} />}
                footer={
                    <>
                        <ToolbarCount>{filtered.length} attribute{filtered.length !== 1 ? 's' : ''}</ToolbarCount>
                        {canManage && (
                            <span style={{ marginLeft: 'auto' }}>
                                <ToolbarButton tone="create" icon="bi-plus-lg" onClick={openCreate}>New Attribute</ToolbarButton>
                            </span>
                        )}
                    </>
                }
            >
                {filtered.length === 0 && <ColumnEmpty>{visible.length === 0 ? 'No attributes defined.' : 'No attributes match.'}</ColumnEmpty>}
                {filtered.map((a: any) => (
                    <ColumnRow
                        key={a.id}
                        icon="bi-tag"
                        iconColor="#7f9db9"
                        label={a.name}
                        sub={roleLabel(a.system_role) ?? undefined}
                        selected={a.id === selected?.id}
                        onSelect={() => select(a.id)}
                        trailing={
                            <>
                                {a.is_system && <i className="bi bi-shield-lock" style={{ color: '#a06000', fontSize: 10 }} title="System attribute" />}
                                <Chip tone={BROWSER_TONES.count} size="xs">{a.values.length}</Chip>
                            </>
                        }
                    />
                ))}
            </ColumnPane>

            {/* ── Right: selected attribute ────────────────────────────────── */}
            <DetailPane empty={canManage ? 'Select an attribute, or create a new one.' : 'Select an attribute.'}>
                {selected && (
                    <>
                        <DetailHeader
                            title={locked ? selected.name : (
                                <>
                                    <input
                                        style={lvInput({ width: 260, fontSize: 13, fontWeight: 'bold' })}
                                        value={nameDraft ?? selected.name}
                                        onChange={e => setNameDraft(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') saveName();
                                            if (e.key === 'Escape') setNameDraft(null);
                                        }}
                                        aria-label="Attribute name"
                                    />
                                    {nameDirty && (
                                        <>
                                            <button type="button" className={XP_BTN} style={lvPrimaryBtn()} onClick={saveName}>Rename</button>
                                            <button type="button" className={XP_BTN} style={lvBtn()} onClick={() => setNameDraft(null)}>Cancel</button>
                                        </>
                                    )}
                                </>
                            )}
                            chips={
                                <>
                                    {selected.is_system && <Chip tone={BROWSER_TONES.system} icon="bi-shield-lock" size="xs">System</Chip>}
                                    {roleLabel(selected.system_role) && (
                                        <span style={{ fontSize: 11, color: '#555' }}>
                                            <i className="bi bi-link-45deg me-1" />Used by {roleLabel(selected.system_role)}
                                        </span>
                                    )}
                                </>
                            }
                            actions={canManage && !selected.is_system ? (
                                <button type="button" className={XP_BTN} style={lvBtn('danger')} onClick={() => onDeleteAttribute(selected.id)}>
                                    <i className="bi bi-trash me-1" />Delete Attribute
                                </button>
                            ) : undefined}
                        >
                            {selected.is_system && canManage && (
                                <span style={{ color: '#804800' }}>
                                    Name is protected — the system looks this attribute up by role. Values can be managed below.
                                </span>
                            )}
                        </DetailHeader>

                        {/* Values toolbar: filter left, count, add rightmost */}
                        <div style={xpToolbar({ flexShrink: 0 })}>
                            <SearchField value={valueFilter} onChange={setValueFilter} placeholder="Filter values…" width={200} icon="bi-funnel" />
                            <ToolbarCount right>
                                {vq ? `${shownValues.length} of ${values.length}` : values.length} value{values.length !== 1 ? 's' : ''}
                            </ToolbarCount>
                            {canManage && (
                                <>
                                    <span style={lvSep()} />
                                    <input
                                        style={lvInput({ width: 220, ...(dupDraft ? { borderColor: '#c00000' } : {}) })}
                                        placeholder="New value… (Enter)"
                                        title={dupDraft ? 'Already exists' : undefined}
                                        value={valueDraft}
                                        onChange={e => setValueDraft(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addValue(valueDraft); } }}
                                    />
                                    <ToolbarButton tone="create" icon="bi-plus-lg" onClick={() => addValue(valueDraft)} disabled={!valueDraft.trim() || dupDraft}>Add</ToolbarButton>
                                    {nextVal !== null && (
                                        <ToolbarButton tone="neutral" onClick={() => addValue(String(nextVal))} title="Add the next number in sequence">+{nextVal}</ToolbarButton>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Values list */}
                        <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#fff' }}>
                            {shownValues.length === 0 && <ColumnEmpty>{values.length === 0 ? 'No values yet.' : 'No values match.'}</ColumnEmpty>}
                            {shownValues.map((val: any, vi: number) => (
                                <DetailRow
                                    key={val.id}
                                    index={vi}
                                    actions={canManage ? (
                                        <XPActionButton tone="danger" icon="bi-trash" title={`Delete "${val.value}"`} onClick={() => handleDeleteValue(val)} />
                                    ) : undefined}
                                >
                                    <span style={{ width: 28, textAlign: 'right', fontSize: 10, color: '#999', flexShrink: 0 }}>{values.indexOf(val) + 1}</span>
                                    {canManage ? (
                                        <input
                                            // re-mount on server change so the field follows a refresh
                                            key={val.value}
                                            style={{ ...lvInput(), flex: 1, border: '1px solid transparent', boxShadow: 'none', background: 'transparent' }}
                                            defaultValue={val.value}
                                            title="Click to rename — Enter saves, Esc reverts"
                                            onFocus={e => { e.currentTarget.style.borderColor = '#7f9db9'; e.currentTarget.style.background = '#fff'; }}
                                            onBlur={e => {
                                                e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent';
                                                const next = e.target.value.trim();
                                                if (next && next !== val.value) onUpdateValue(val.id, next);
                                                else e.target.value = val.value;
                                            }}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') e.currentTarget.blur();
                                                if (e.key === 'Escape') { e.currentTarget.value = val.value; e.currentTarget.blur(); }
                                            }}
                                        />
                                    ) : (
                                        <span style={{ flex: 1, fontSize: 11, padding: '3px 4px' }}>{val.value}</span>
                                    )}
                                </DetailRow>
                            ))}
                        </div>
                    </>
                )}
            </DetailPane>

            <ModalWrapper
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={<><i className="bi bi-plus-circle me-1"></i>New Attribute</>}
                size="md"
                modeless
                footer={
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button type="button" className={XP_BTN} style={lvBtn()} onClick={() => setIsModalOpen(false)}>Cancel</button>
                        <button type="submit" form="attribute-form" className={XP_BTN} style={lvPrimaryBtn()} disabled={isSubmitting || !newName.trim()}>Create</button>
                    </div>
                }
            >
                <form id="attribute-form" onSubmit={handleCreate}>
                    <FormSection title="Identity">
                        <label style={lvLabel()}>Name *</label>
                        <input
                            style={lvInput()}
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            placeholder="e.g. Size, Fabric"
                            required
                            autoFocus
                        />
                    </FormSection>
                    <FormSection title={`Initial Values (${newValues.length})`}>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                            <input
                                style={lvInput()}
                                placeholder="Value (e.g. S, M, L) — Enter adds"
                                value={newDraft}
                                onChange={e => setNewDraft(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNewValue(newDraft); } }}
                            />
                            <button type="button" className={XP_BTN} style={lvBtn()} onClick={() => addNewValue(newDraft)}>Add</button>
                            {newNext !== null && (
                                <button type="button" className={XP_BTN} style={lvBtn()} onClick={() => addNewValue(String(newNext))}>+{newNext}</button>
                            )}
                        </div>
                        <div style={{ background: '#fff', border: '1px solid #7f9db9', minHeight: 32, padding: '4px 6px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {newValues.map((v, i) => (
                                <Chip key={v} onRemove={() => setNewValues(newValues.filter((_, j) => j !== i))}>{v}</Chip>
                            ))}
                            {newValues.length === 0 && <span style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>No values added — you can add them later too.</span>}
                        </div>
                    </FormSection>
                </form>
            </ModalWrapper>
        </ColumnPanes>
    );
}
