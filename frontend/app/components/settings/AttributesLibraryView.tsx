'use client';
import React, { useState } from 'react';
import { useConfirm } from '../../context/ConfirmContext';
import ModalWrapper from '../shared/ModalWrapper';
import { FormSection, useFloatingMenu, MenuTriggerButton, FloatingMenu, CHIP_RADIUS, XP_BTN } from '../shared/xpTheme';
import { lvInput, lvBtn, lvPrimaryBtn, lvLabel, lvTh, lvTd, lvSep, lvRow, lvThead, lvZebra } from '../shared/listViewTheme';
import { ToolbarButton, SearchField, ToolbarCount } from '../shared/shellTheme';

// Attributes with a dedicated management home are hidden here so they are not
// hand-edited in two places:
//   - Combo (system_role='combo')             → Combo Library (Inventory nav)
//   - Color Code (system_role='labdip_color') → Color Library, "Color Codes" tab
//   - Colors (system_role='color')            → Color Library, "Colors (Variant)" tab
// Each attribute + its values still exist underneath (load-bearing: Colors/Combo gate
// BOM selection + drive recipe-match / variant_key; labdip_color mirrors the library).
// `Materials` stays — it is managed here, no dedicated home.
const HIDDEN_LIBRARY_ROLES = ['combo', 'labdip_color', 'color'];

const ROLE_LABELS: Record<string, string> = {
    material: 'Sample Materials',
    color: 'Sample Colors',
    labdip_color: 'Labdip Colors',
    combo: 'Sample Combo',
    wash_bath: 'Dye Recipe Bak Cuci',
    finishing_step: 'Dye Recipe Finishing',
};

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

export default function AttributesLibraryView({
    attributes, canManage,
    onCreateAttribute, onUpdateAttribute, onDeleteAttribute,
    onAddValue, onUpdateValue, onDeleteValue,
}: Props) {
    const { confirm } = useConfirm();
    const { openId: menuOpenId, pos: menuPos, toggle: menuToggle, close: menuClose } = useFloatingMenu(160);

    const [search, setSearch] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [nameDraft, setNameDraft] = useState('');
    const [newValues, setNewValues] = useState<string[]>([]);
    const [valueDraft, setValueDraft] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const visible = (attributes || []).filter((a: any) => !HIDDEN_LIBRARY_ROLES.includes(a.system_role));
    const filtered = visible.filter((a: any) => a.name.toLowerCase().includes(search.toLowerCase()));
    const editing = editingId ? visible.find((a: any) => a.id === editingId) : null;

    const getNextValue = (values: any[]) => {
        const numbers = (values || []).map((v: any) => parseInt(v.value)).filter((n: number) => !isNaN(n));
        return numbers.length > 0 ? Math.max(...numbers) + 1 : null;
    };
    const nextVal = editing ? getNextValue(editing.values) : getNextValue(newValues.map(v => ({ value: v })));

    const openCreate = () => { setEditingId(null); setNameDraft(''); setNewValues([]); setValueDraft(''); setIsModalOpen(true); };
    const openEdit = (attr: any) => { setEditingId(attr.id); setNameDraft(attr.name); setValueDraft(''); setIsModalOpen(true); };
    const closeModal = () => setIsModalOpen(false);

    const addDraftValue = () => {
        const v = valueDraft.trim();
        if (!v) return;
        setNewValues([...newValues, v]);
        setValueDraft('');
    };
    const addNextDraftValue = () => { if (nextVal !== null) setNewValues([...newValues, String(nextVal)]); };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!nameDraft.trim() || isSubmitting) return;
        setIsSubmitting(true);
        try {
            if (editing) {
                if (nameDraft.trim() !== editing.name) onUpdateAttribute(editing.id, nameDraft.trim());
            } else {
                const res = await onCreateAttribute({ name: nameDraft.trim(), values: newValues.map(v => ({ value: v })) });
                if (!res?.ok) return;
            }
            closeModal();
        } finally { setIsSubmitting(false); }
    };

    const handleAddValueToExisting = () => {
        if (editing && valueDraft.trim()) { onAddValue(editing.id, valueDraft.trim()); setValueDraft(''); }
    };
    const handleAddNextToExisting = () => {
        if (editing && nextVal !== null) onAddValue(editing.id, String(nextVal));
    };

    const handleDeleteValue = async (v: any) => {
        const ok = await confirm({
            title: 'Delete Value', variant: 'danger', confirmText: 'Delete',
            message: `Delete value "${v.value}"? Blocked if it is used by any item, BOM, or stock.`,
        });
        if (ok) onDeleteValue(v.id);
    };

    const handleDelete = async (attr: any) => {
        const ok = await confirm({
            title: 'Delete Attribute', variant: 'danger', confirmText: 'Delete',
            message: `Delete attribute "${attr.name}" and all ${attr.values.length} of its values? This cannot be undone.`,
        });
        if (ok) onDeleteAttribute(attr.id);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Toolbar */}
            <div style={{ background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
                <SearchField classic value={search} onChange={setSearch} placeholder="Search attributes…" width={220} />
                <ToolbarCount right>
                    {filtered.length} attribute{filtered.length !== 1 ? 's' : ''}
                </ToolbarCount>
                {canManage && (
                    <>
                        <span style={lvSep()} />
                        <ToolbarButton tone="create" icon="bi-plus-lg" onClick={openCreate}>New Attribute</ToolbarButton>
                    </>
                )}
            </div>

            {/* Table */}
            <div style={{ flex: 1, minHeight: 0, background: '#fff', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                    <thead style={lvThead()}>
                        <tr>
                            <th style={{ ...lvTh(), width: 200 }}>Name</th>
                            <th style={{ ...lvTh(), width: 140 }}>Role</th>
                            <th style={lvTh()}>Values</th>
                            <th style={{ ...lvTh(), width: 90, textAlign: 'center' }}>Count</th>
                            <th style={{ ...lvTh(), width: 70, textAlign: 'right', borderRight: 'none' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length === 0 && (
                            <tr><td colSpan={5} style={{ ...lvTd(), textAlign: 'center', color: '#888', fontStyle: 'italic', padding: 20 }}>
                                No attributes defined.
                            </td></tr>
                        )}
                        {filtered.map((attr: any, idx: number) => (
                            <tr key={attr.id} style={{ ...lvRow(idx), cursor: 'pointer' }} onClick={() => openEdit(attr)}>
                                <td style={lvTd()}>
                                    <span style={{ fontWeight: 'bold' }}>{attr.name}</span>
                                </td>
                                <td style={lvTd()}>
                                    {attr.system_role ? (
                                        <span style={{
                                            fontSize: 9, background: '#dce8ff',
                                            border: `1px solid ${'#7fa8e0'}`, color: '#003080',
                                            padding: '1px 5px', borderRadius: CHIP_RADIUS,
                                        }}>{ROLE_LABELS[attr.system_role] || attr.system_role}</span>
                                    ) : <span style={{ color: '#aaa' }}>—</span>}
                                </td>
                                <td style={lvTd()}>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                        {attr.values.slice(0, 8).map((v: any) => (
                                            <span key={v.id} style={{
                                                background: '#dde8f5', border: `1px solid ${'#7f9db9'}`,
                                                padding: '0 4px', fontSize: 10, color: '#333',
                                            }}>{v.value}</span>
                                        ))}
                                        {attr.values.length > 8 && <span style={{ fontSize: 10, color: '#888' }}>…</span>}
                                        {attr.values.length === 0 && <span style={{ fontSize: 10, color: '#aaa', fontStyle: 'italic' }}>no values</span>}
                                    </div>
                                </td>
                                <td style={{ ...lvTd(), textAlign: 'center' }}>{attr.values.length}</td>
                                <td style={{ ...lvTd(), borderRight: 'none', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                    {canManage && <MenuTriggerButton onClick={e => menuToggle(String(attr.id), e)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Row ⋯ menu: Edit / Delete */}
            {menuOpenId && (() => {
                const attr = filtered.find((x: any) => String(x.id) === menuOpenId);
                if (!attr || !canManage) return null;
                return (
                    <FloatingMenu
                        pos={menuPos}
                        items={[
                            { key: 'edit', label: 'Edit', icon: 'bi-pencil', onClick: () => { menuClose(); openEdit(attr); } },
                            ...(attr.is_system ? [] : [{ key: 'delete', label: 'Delete', icon: 'bi-trash', danger: true, onClick: () => { menuClose(); handleDelete(attr); } }]),
                        ]}
                    />
                );
            })()}

            <ModalWrapper
                isOpen={isModalOpen}
                onClose={closeModal}
                title={editing ? <><i className="bi bi-pencil-square me-1"></i>Edit Attribute — {editing.name}</> : <><i className="bi bi-plus-circle me-1"></i>New Attribute</>}
                size="md"
                modeless
                footer={
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button type="button" className={XP_BTN} style={lvBtn()} onClick={closeModal}>Cancel</button>
                        {canManage && (!editing || !editing.is_system) && (
                            <button type="submit" form="attribute-form" className={XP_BTN} style={lvPrimaryBtn()} disabled={isSubmitting}>
                                {editing ? 'Save' : 'Create'}
                            </button>
                        )}
                    </div>
                }
            >
                <form id="attribute-form" onSubmit={handleSubmit}>
                    <FormSection title="Identity">
                        <div>
                            <label style={lvLabel()}>Name *</label>
                            <input
                                style={lvInput()}
                                value={nameDraft}
                                onChange={e => setNameDraft(e.target.value)}
                                placeholder="e.g. Size, Fabric"
                                disabled={!canManage || (!!editing && editing.is_system)}
                                required
                                autoFocus
                            />
                            {editing?.is_system && (
                                <div style={{ marginTop: 4, fontSize: 10, color: '#804800'}}>
                                    <i className="bi bi-shield-lock me-1" />System attribute — name is protected, values can still be managed below.
                                </div>
                            )}
                        </div>
                    </FormSection>

                    <FormSection title={editing ? `Values (${editing.values.length})` : 'Initial Values'}>
                        {editing ? (
                            <>
                                <div style={{ background: '#fff', border: '1px solid #7f9db9', maxHeight: 220, overflowY: 'auto', marginBottom: 8 }}>
                                    {editing.values.map((val: any, vi: number) => (
                                        <div key={val.id} style={{ display: 'flex', alignItems: 'center', padding: '2px 4px', background: lvZebra(vi), borderBottom: '1px solid #e0dfd8' }}>
                                            <input
                                                style={{ ...lvInput(), flex: 1, border: 'none', boxShadow: 'none', background: 'transparent' }}
                                                defaultValue={val.value}
                                                disabled={!canManage}
                                                onBlur={e => { if (e.target.value !== val.value && e.target.value.trim()) onUpdateValue(val.id, e.target.value.trim()); }}
                                            />
                                            {canManage && (
                                                <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c00000', padding: '0 4px' }} onClick={() => handleDeleteValue(val)}>
                                                    <i className="bi bi-x-lg" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    {editing.values.length === 0 && (
                                        <div style={{ padding: 10, textAlign: 'center', fontSize: 11, color: '#888' }}>No values yet</div>
                                    )}
                                </div>
                                {canManage && (
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <input
                                            style={lvInput()}
                                            placeholder="Add value…"
                                            value={valueDraft}
                                            onChange={e => setValueDraft(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddValueToExisting(); } }}
                                        />
                                        <button type="button" className={XP_BTN} style={lvBtn()} onClick={handleAddValueToExisting}>Add</button>
                                        {nextVal !== null && (
                                            <button type="button" className={XP_BTN} style={lvBtn()} onClick={handleAddNextToExisting}>+{nextVal}</button>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                                    <input
                                        style={lvInput()}
                                        placeholder="Value (e.g. S, M, L)"
                                        value={valueDraft}
                                        onChange={e => setValueDraft(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDraftValue(); } }}
                                    />
                                    <button type="button" className={XP_BTN} style={lvBtn()} onClick={addDraftValue}>Add</button>
                                    {nextVal !== null && (
                                        <button type="button" className={XP_BTN} style={lvBtn()} onClick={addNextDraftValue}>+{nextVal}</button>
                                    )}
                                </div>
                                <div style={{ background: '#fff', border: '1px solid #7f9db9', minHeight: 32, padding: '4px 6px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {newValues.map((v, i) => (
                                        <span key={i} style={{ borderRadius: CHIP_RADIUS, background: '#dde8f5', border: '1px solid #7f9db9', padding: '1px 6px', fontSize: 11 }}>{v}</span>
                                    ))}
                                    {newValues.length === 0 && <span style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>No values added</span>}
                                </div>
                            </>
                        )}
                    </FormSection>
                </form>
            </ModalWrapper>
        </div>
    );
}
