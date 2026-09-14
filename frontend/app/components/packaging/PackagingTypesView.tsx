'use client';
import React, { useState, useMemo } from 'react';
import { useConfirm } from '../../context/ConfirmContext';
import { useUser } from '../../context/UserContext';
import ModalWrapper from '../shared/ModalWrapper';
import { StatusChip, CodeChip, XP_BTN, useFloatingMenu, MenuTriggerButton, FloatingMenu } from '../shared/xpTheme';
import { SearchField, ToolbarCount, ToolbarButton, viewShellStyle, PageTitleBar } from '../shared/shellTheme';
import {
    LV_XP_FONT, lvInput, lvBtn, lvPrimaryBtn, lvLabel, lvTh, lvTd, lvSep, lvRow, lvThead, TableEmpty,
} from '../shared/listViewTheme';

// The box master the pack screens pick from: Box S/M/L/XL, Plastic Bag, Custom.
//
// The only figure that matters here is `tare_kg` — the empty box's weight, added
// to each carton's net reading to make the brutto printed on its label and
// totalled on the delivery note. Editing one NEVER rewrites what is already
// packed: every carton snapshots the tare it was packed with, so a correction
// applies from the next pack event on.
//
// The Custom row is the exception with no tare of its own: it is weighed by hand
// at log time. Exactly one such row is expected, but nothing enforces that —
// "custom" is a property of a box (it has no standard weight), not a singleton.
//
// Bounded data — a handful of rows the plant physically stocks — so it lists
// whole and filters client-side, like Routing and Settings > Users.

const emptyForm = () => ({ code: '', name: '', tare_kg: '', is_custom: false, sort_order: '0', active: true });

interface Props {
    types: any[];
    loading?: boolean;
    onCreate: (payload: any) => void;
    onEdit: (id: string, payload: any) => void;
    onDelete: (t: any) => void;
}

export default function PackagingTypesView({ types, loading, onCreate, onEdit, onDelete }: Props) {
    const { confirm } = useConfirm();
    const { hasAnyPermission } = useUser();
    const canManage = hasAnyPermission('packaging_type.create', 'packaging_type.edit', 'packaging_type.archive');

    const [search, setSearch] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);
    const [form, setForm] = useState(emptyForm());
    const { openId: menuOpenId, pos: menuPos, toggle: menuToggle, close: menuClose } = useFloatingMenu(140);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return types;
        return types.filter((t: any) => `${t.code} ${t.name}`.toLowerCase().includes(q));
    }, [types, search]);

    const openCreate = () => { setEditing(null); setForm(emptyForm()); setIsModalOpen(true); };
    const openEdit = (t: any) => {
        setEditing(t);
        setForm({
            code: t.code || '',
            name: t.name || '',
            tare_kg: t.tare_kg != null ? String(t.tare_kg) : '',
            is_custom: !!t.is_custom,
            sort_order: String(t.sort_order ?? 0),
            active: t.active !== false,
        });
        setIsModalOpen(true);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.code.trim() || !form.name.trim()) return;
        const payload: any = {
            code: form.code.trim(),
            name: form.name.trim(),
            // A custom box's tare is typed per carton at pack time, so storing one
            // here would be a default nobody means — the server drops it too.
            tare_kg: form.is_custom ? null : (form.tare_kg === '' ? null : Number(form.tare_kg)),
            is_custom: form.is_custom,
            sort_order: Number(form.sort_order) || 0,
            active: form.active,
        };
        if (editing) onEdit(editing.id, payload);
        else onCreate(payload);
        setIsModalOpen(false);
        setEditing(null);
        setForm(emptyForm());
    };

    const handleDelete = async (t: any) => {
        const ok = await confirm({
            title: 'Delete Packaging Type',
            message: `Delete "${t.code} — ${t.name}"? A type already used by packed cartons is deactivated instead, so those labels keep naming their box.`,
            confirmText: 'Delete',
            variant: 'danger',
        });
        if (ok) onDelete(t);
    };

    const emptyMessage = search.trim()
        ? 'No packaging type matches that search.'
        : 'No packaging types yet. Add the boxes the floor packs into, with the weight of each empty box.';

    return (
        <div style={viewShellStyle('page', { fontFamily: LV_XP_FONT })}>
            <PageTitleBar icon="bi-box2" title="Packaging Types" />

            <div style={{ background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
                <SearchField value={search} onChange={setSearch} placeholder="Search code or name…" width={240} />
                <ToolbarCount right>
                    {filtered.length === types.length
                        ? `${types.length} type${types.length !== 1 ? 's' : ''}`
                        : `${filtered.length} of ${types.length} types`}
                </ToolbarCount>
                {canManage && (
                    <>
                        <span style={lvSep()} />
                        <ToolbarButton tone="create" icon="bi-plus-lg" onClick={openCreate}>New Packaging Type</ToolbarButton>
                    </>
                )}
            </div>

            <div style={{ flex: 1, minHeight: 0, background: '#fff', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={lvThead()}>
                        <tr>
                            <th style={{ ...lvTh(), width: 120 }}>Code</th>
                            <th style={lvTh()}>Name</th>
                            <th style={{ ...lvTh(), width: 150, textAlign: 'right' }}>Tare (kg)</th>
                            <th style={{ ...lvTh(), width: 80, textAlign: 'center' }}>Order</th>
                            <th style={{ ...lvTh(), width: 90 }}>Status</th>
                            <th style={{ ...lvTh(), width: 80, textAlign: 'right', borderRight: 'none' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length === 0 && (
                            <TableEmpty colSpan={6} tdStyle={lvTd()}
                                message={loading ? 'Loading…' : emptyMessage} />
                        )}
                        {filtered.map((t: any, idx: number) => (
                            <tr key={t.id} style={lvRow(idx)}>
                                <td style={lvTd()}><CodeChip code={t.code} tone="accent" /></td>
                                <td style={lvTd()}>{t.name}</td>
                                <td style={{ ...lvTd(), textAlign: 'right' }}>
                                    {/* A custom box has no stored tare BY DESIGN — the packer
                                        weighs the empty box at log time — so it reads as that
                                        rather than as a number someone forgot to fill in. */}
                                    {t.is_custom
                                        ? <span style={{ color: '#888', fontStyle: 'italic' }}>weighed at packing</span>
                                        : Number(t.tare_kg) > 0
                                            ? Number(t.tare_kg).toFixed(3)
                                            : <span style={{ color: '#b8860b' }}>not set</span>}
                                </td>
                                <td style={{ ...lvTd(), textAlign: 'center', color: '#888' }}>{t.sort_order ?? 0}</td>
                                <td style={lvTd()}><StatusChip status={t.active === false ? 'archived' : 'active'} /></td>
                                <td style={{ ...lvTd(), borderRight: 'none', textAlign: 'right' }}>
                                    {canManage && <MenuTriggerButton onClick={e => menuToggle(t.id, e)} />}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {menuOpenId && (() => {
                const t = filtered.find((x: any) => String(x.id) === menuOpenId);
                if (!t || !canManage) return null;
                return (
                    <FloatingMenu
                        pos={menuPos}
                        items={[
                            { key: 'edit', label: 'Edit', icon: 'bi-pencil-square', onClick: () => { menuClose(); openEdit(t); } },
                            { key: 'delete', label: 'Delete', icon: 'bi-trash', danger: true, onClick: () => { menuClose(); handleDelete(t); } },
                        ]}
                    />
                );
            })()}

            <ModalWrapper
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editing ? `Edit Packaging Type — ${editing.code}` : 'New Packaging Type'}
                size="md"
                modeless
                footer={
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button type="button" className={XP_BTN} style={lvBtn()} onClick={() => setIsModalOpen(false)}>Cancel</button>
                        <button type="submit" form="packaging-type-form" className={XP_BTN} style={lvPrimaryBtn()}>
                            {editing ? 'Save' : 'Create'}
                        </button>
                    </div>
                }
            >
                <form id="packaging-type-form" onSubmit={handleSubmit}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                            <label style={lvLabel()}>Code *</label>
                            <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} style={lvInput()} required />
                        </div>
                        <div>
                            <label style={lvLabel()}>Name *</label>
                            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={lvInput()} required />
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={{ ...lvLabel(), display: 'flex', alignItems: 'center', gap: 6 }}>
                                <input type="checkbox" checked={form.is_custom}
                                    onChange={e => setForm({ ...form, is_custom: e.target.checked })} />
                                <span>Weighed at packing (custom box)</span>
                            </label>
                            <div style={{ fontSize: 10, color: '#777', marginTop: 2 }}>
                                Tick this for a box with no standard weight — the packer weighs the
                                empty box on each pack log instead of taking a figure from here.
                            </div>
                        </div>
                        <div>
                            <label style={lvLabel()}>Tare — weight of the empty box (kg)</label>
                            <input
                                type="number" min="0" step="any"
                                value={form.is_custom ? '' : form.tare_kg}
                                onChange={e => setForm({ ...form, tare_kg: e.target.value })}
                                style={lvInput()}
                                disabled={form.is_custom}
                                placeholder={form.is_custom ? 'weighed at packing' : '0.000'}
                            />
                            <div style={{ fontSize: 10, color: '#777', marginTop: 2 }}>
                                Added to each carton&apos;s net weight to make its gross. Changing it
                                affects cartons packed from now on — never ones already packed.
                            </div>
                        </div>
                        <div>
                            <label style={lvLabel()}>Sort order</label>
                            <input type="number" step="1" value={form.sort_order}
                                onChange={e => setForm({ ...form, sort_order: e.target.value })} style={lvInput()} />
                        </div>
                        {editing && (
                            <div>
                                <label style={lvLabel()}>Status</label>
                                <select value={form.active ? 'active' : 'archived'}
                                    onChange={e => setForm({ ...form, active: e.target.value === 'active' })}
                                    style={lvInput()}>
                                    <option value="active">active</option>
                                    <option value="archived">archived</option>
                                </select>
                                <div style={{ fontSize: 10, color: '#777', marginTop: 2 }}>
                                    An archived type disappears from the pack screens&apos; pickers but
                                    still names the cartons it packed.
                                </div>
                            </div>
                        )}
                    </div>
                </form>
            </ModalWrapper>
        </div>
    );
}
