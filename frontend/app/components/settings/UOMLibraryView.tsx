'use client';
import React, { useState } from 'react';
import { useConfirm } from '../../context/ConfirmContext';
import { lvInput, lvBtn, lvPrimaryBtn, lvTh, lvTd, lvSep, lvRow, lvThead, ExpanderCell } from '../shared/listViewTheme';
import { ExpandedRowPanel, rowStateBg, Chip, XP_BTN } from '../shared/xpTheme';
import { SearchField, ToolbarCount } from '../shared/shellTheme';

interface Props {
    uoms: any[];
    canManage: boolean;
    onCreateUOM: (name: string) => Promise<Response>;
    onDeleteUOM: (id: string) => void;
    onSaveUOMFactor: (fromUomId: string, toUomId: string, value: number) => void;
    onDeleteUOMFactor: (uomId: string, factorId: string) => void;
}

export default function UOMLibraryView({ uoms, canManage, onCreateUOM, onDeleteUOM, onSaveUOMFactor, onDeleteUOMFactor }: Props) {
    const { confirm } = useConfirm();

    const [search, setSearch] = useState('');
    const [newName, setNewName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [factorValue, setFactorValue] = useState('');
    const [factorToUomId, setFactorToUomId] = useState('');

    const filtered = (uoms || []).filter((u: any) => u.name.toLowerCase().includes(search.toLowerCase()));
    const sorted = [...filtered.filter((u: any) => u.is_system), ...filtered.filter((u: any) => !u.is_system)];

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newName.trim() || isSubmitting) return;
        setIsSubmitting(true);
        try {
            const res = await onCreateUOM(newName.trim());
            if (res?.ok) setNewName('');
        } finally { setIsSubmitting(false); }
    };

    const toggleExpand = (uom: any) => {
        setExpandedId(expandedId === uom.id ? null : uom.id);
        setFactorValue('');
        setFactorToUomId('');
    };

    const handleAddFactor = (uom: any) => {
        if (!factorValue || !factorToUomId) return;
        onSaveUOMFactor(uom.id, factorToUomId, parseFloat(factorValue));
        setFactorValue('');
        setFactorToUomId('');
    };

    const handleDelete = async (uom: any) => {
        const ok = await confirm({
            title: 'Delete UOM', variant: 'danger', confirmText: 'Delete',
            message: `Delete unit "${uom.name}"? Blocked if it is used by any item or conversion.`,
        });
        if (ok) onDeleteUOM(uom.id);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Toolbar */}
            <div style={{ background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
                {canManage && (
                    <form onSubmit={handleCreate} style={{ display: 'flex', gap: 6 }}>
                        <input
                            style={{ ...lvInput(), width: 180 }}
                            placeholder="e.g. Dozen, kg…"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                        />
                        <button type="submit" className={XP_BTN} style={lvPrimaryBtn()} disabled={isSubmitting}>
                            <i className="bi bi-plus-lg" /> {isSubmitting ? '…' : 'New UOM'}
                        </button>
                    </form>
                )}
                <span style={lvSep()} />
                <SearchField classic value={search} onChange={setSearch} placeholder="Search units…" width={200} />
                <ToolbarCount right>
                    {filtered.filter((u: any) => u.is_system).length} system &nbsp;+&nbsp; {filtered.filter((u: any) => !u.is_system).length} packaging
                </ToolbarCount>
            </div>

            {/* Table */}
            <div style={{ flex: 1, minHeight: 0, background: '#fff', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                    <thead style={lvThead()}>
                        <tr>
                            <th style={{ ...lvTh(), width: 34 }}></th>
                            <th style={{ ...lvTh(), width: 160 }}>Name</th>
                            <th style={lvTh()}>Conversions</th>
                            <th style={{ ...lvTh(), width: 70, textAlign: 'right', borderRight: 'none' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.length === 0 && (
                            <tr><td colSpan={4} style={{ ...lvTd(), textAlign: 'center', color: '#888', fontStyle: 'italic', padding: 20 }}>
                                No units defined.
                            </td></tr>
                        )}
                        {sorted.map((uom: any, idx: number) => {
                            const isExpanded = expandedId === uom.id;
                            const factors: any[] = uom.factors || [];
                            return (
                                <React.Fragment key={uom.id}>
                                    <tr style={{ ...lvRow(idx), cursor: 'pointer', background: isExpanded ? rowStateBg('expanded') : lvRow(idx).background }} onClick={() => toggleExpand(uom)}>
                                        <ExpanderCell expanded={isExpanded} onToggle={() => toggleExpand(uom)} label="conversion factors" />
                                        <td style={lvTd()}>
                                            <span style={{ fontWeight: 'bold', fontVariant: 'all-small-caps'}}>{uom.name}</span>
                                            {uom.is_system && (
                                                <Chip size="xs" style={{ marginLeft: 6 }} tone={{
                                                    background: '#dce8ff',
                                                    borderColor: '#7fa8e0',
                                                    color: '#003080',
                                                }}>SYSTEM</Chip>
                                            )}
                                        </td>
                                        <td style={lvTd()}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                {factors.length > 0 ? factors.map((f: any) => (
                                                    <Chip key={f.id} tone={{
                                                        background: '#fff3e0',
                                                        borderColor: '#f0a040',
                                                        color: '#804800',
                                                    }}>1 {uom.name} = {parseFloat(f.value)} {f.to_uom_name}</Chip>
                                                )) : (
                                                    <span style={{ fontSize: 10, color: '#aaa', fontStyle: 'italic' }}>
                                                        {uom.is_system ? 'base unit' : 'no conversion set'}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td style={{ ...lvTd(), borderRight: 'none', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                            {canManage && !uom.is_system && (
                                                <button title="Delete" onClick={() => handleDelete(uom)} style={{ background: 'none', border: '1px solid transparent', cursor: 'pointer', padding: '1px 4px', color: '#a00', fontSize: 13 }}>
                                                    <i className="bi bi-trash" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                    {isExpanded && (
                                        <tr>
                                            <td colSpan={4} style={{ padding: 0 }}>
                                                <ExpandedRowPanel style={{ padding: '8px 12px 8px 28px' }}>
                                                    {canManage ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                            <span style={{ fontSize: 11, color: '#804800'}}>1 <b>{uom.name}</b> =</span>
                                                            <input
                                                                type="number"
                                                                style={{ ...lvInput(), width: 90 }}
                                                                value={factorValue}
                                                                onChange={e => setFactorValue(e.target.value)}
                                                                placeholder="value"
                                                            />
                                                            <select
                                                                style={{ ...lvInput(), width: 160 }}
                                                                value={factorToUomId}
                                                                onChange={e => setFactorToUomId(e.target.value)}
                                                            >
                                                                <option value="">-- unit --</option>
                                                                {(uoms || []).filter((u: any) => u.id !== uom.id).map((u: any) => (
                                                                    <option key={u.id} value={u.id}>{u.name}</option>
                                                                ))}
                                                            </select>
                                                            <button className={XP_BTN} style={lvBtn()} onClick={() => handleAddFactor(uom)}>Add</button>
                                                            {factors.length > 0 && (
                                                                <>
                                                                    <span style={{ width: 1, height: 18, background: '#c0a060'}} />
                                                                    {factors.map((f: any) => (
                                                                        <Chip key={f.id} tone={{
                                                                            background: '#fff3e0',
                                                                            borderColor: '#f0a040',
                                                                            color: '#804800',
                                                                        }} onRemove={() => onDeleteUOMFactor(uom.id, f.id)}>1 {uom.name} = {parseFloat(f.value)} {f.to_uom_name}</Chip>
                                                                    ))}
                                                                </>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>No conversions defined</span>
                                                    )}
                                                </ExpandedRowPanel>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
