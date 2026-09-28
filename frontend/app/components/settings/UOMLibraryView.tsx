'use client';
import React, { useState } from 'react';
import { useConfirm } from '../../context/ConfirmContext';
import ModalWrapper from '../shared/ModalWrapper';
import { lvInput, lvBtn, lvPrimaryBtn, lvLabel, lvSep } from '../shared/listViewTheme';
import { Chip, XPActionButton, XP_BTN, FormSection, FormError } from '../shared/xpTheme';
import { ToolbarButton, SearchField, ToolbarCount, xpToolbar } from '../shared/shellTheme';
import {
    ColumnPanes, ColumnPane, ColumnRow, ColumnEmpty, DetailPane, DetailHeader, DetailCaption, DetailRow, BROWSER_TONES,
} from '../shared/columnBrowser';

interface Props {
    uoms: any[];
    canManage: boolean;
    onCreateUOM: (name: string) => Promise<Response>;
    onDeleteUOM: (id: string) => void;
    onSaveUOMFactor: (fromUomId: string, toUomId: string, value: number) => void;
    onDeleteUOMFactor: (uomId: string, factorId: string) => void;
}

const num = (v: any) => String(Number(v));

// A factor `1 <from> = N <to>` is a packaging definition: the item form
// (InventoryView) offers it as a packaging choice on items stocked in <to>
// (`f.to_uom_name === item.uom`). Any unit can be either side — `is_system` only
// means "seeded, can't be deleted" (live data has system Roll = 144 yard and custom
// m as the target of Pcs), so the layout never treats system as "base". Each unit
// shows both directions: what one of it holds, and what packs into it.
// Chrome: shared/columnBrowser.tsx master/detail, same as the Attributes tab.
export default function UOMLibraryView({ uoms, canManage, onCreateUOM, onDeleteUOM, onSaveUOMFactor, onDeleteUOMFactor }: Props) {
    const { confirm } = useConfirm();

    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [pendingName, setPendingName] = useState<string | null>(null);
    const [factorValue, setFactorValue] = useState('');
    const [factorToUomId, setFactorToUomId] = useState('');

    const all: any[] = uoms || [];
    const allFactors: any[] = all.flatMap(u => u.factors || []);
    const incomingTo = (id: string) => allFactors.filter(f => f.to_uom_id === id);

    const q = search.trim().toLowerCase();
    const filtered = all.filter(u => !q || u.name.toLowerCase().includes(q));
    const filteredSystem = filtered.filter(u => u.is_system);
    const filteredCustom = filtered.filter(u => !u.is_system);
    const ordered = [...filteredSystem, ...filteredCustom];

    // Select a just-created unit once the refresh brings it in; else keep the pick,
    // falling back to the first row when it is filtered out or deleted.
    const pending = pendingName ? all.find(u => u.name === pendingName) : null;
    if (pending) { setPendingName(null); setSelectedId(pending.id); }
    const selected = ordered.find(u => u.id === selectedId) || ordered[0] || null;

    const select = (id: string) => {
        if (id === selected?.id) return;
        setSelectedId(id); setFactorValue(''); setFactorToUomId('');
    };

    const selFactors: any[] = selected?.factors || [];
    const parsed = parseFloat(factorValue);
    const valueBad = factorValue !== '' && !(parsed > 0);
    const dupFactor = !!factorToUomId && selFactors.some(f => f.to_uom_id === factorToUomId && Number(f.value) === parsed);
    const canAdd = !!selected && !!factorToUomId && parsed > 0 && !dupFactor;

    const addFactor = () => {
        if (!canAdd) return;
        onSaveUOMFactor(selected.id, factorToUomId, parsed);
        setFactorValue('');
    };

    const deleteFactor = async (f: any) => {
        const ok = await confirm({
            title: 'Delete Conversion', variant: 'danger', confirmText: 'Delete',
            message: `Delete "1 ${f.from_uom_name} = ${num(f.value)} ${f.to_uom_name}"? Items using this packaging will lose it.`,
        });
        if (ok) onDeleteUOMFactor(f.from_uom_id, f.id);
    };

    // ── New-unit dialog ─────────────────────────────────────────────────────
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const [formError, setFormError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const openCreate = () => { setNewName(''); setFormError(''); setIsModalOpen(true); };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        const name = newName.trim();
        if (!name || isSubmitting) return;
        if (all.some(u => String(u.name).toLowerCase() === name.toLowerCase())) { setFormError(`"${name}" already exists.`); return; }
        setIsSubmitting(true);
        try {
            const res = await onCreateUOM(name);
            // A rejected create keeps the window open with what was typed; the
            // reason is toasted by the page (the body is already consumed there).
            if (res?.ok) { setSearch(''); setPendingName(name); setIsModalOpen(false); }
            else setFormError('Could not create that unit — see the message above the page.');
        } finally { setIsSubmitting(false); }
    };

    // ── Pieces ──────────────────────────────────────────────────────────────
    const groupHeader = (label: string, n: number) => (
        <div style={{ padding: '4px 8px', fontSize: 10, fontWeight: 'bold', color: '#555', textTransform: 'uppercase', background: '#f0eee6', borderBottom: '1px solid #d8d4c8', letterSpacing: 0.3 }}>
            {label} ({n})
        </div>
    );

    const listRow = (u: any) => {
        const defs: any[] = u.factors || [];
        const n = incomingTo(u.id).length;
        return (
            <ColumnRow
                key={u.id}
                icon={defs.length ? 'bi-box-seam' : 'bi-rulers'}
                iconColor="#7f9db9"
                label={u.name}
                sub={defs.length ? '= ' + defs.map(f => `${num(f.value)} ${f.to_uom_name}`).join(' · ') : undefined}
                selected={u.id === selected?.id}
                onSelect={() => select(u.id)}
                trailing={
                    <>
                        {u.is_system && <i className="bi bi-shield-lock" style={{ color: '#a06000', fontSize: 10 }} title="System unit" />}
                        {n > 0 && (
                            <Chip tone={BROWSER_TONES.count} size="xs" icon="bi-box-arrow-in-down" title={`${n} conversion${n !== 1 ? 's' : ''} pack into ${u.name}`}>{n}</Chip>
                        )}
                    </>
                }
            />
        );
    };

    const factorRow = (f: any, i: number, label: React.ReactNode) => (
        <DetailRow
            key={f.id}
            index={i}
            actions={canManage ? <XPActionButton tone="danger" icon="bi-trash" title="Delete conversion" onClick={() => deleteFactor(f)} /> : undefined}
        >
            <span style={{ flex: 1 }}>{label}</span>
        </DetailRow>
    );

    const unitPane = (u: any) => {
        const incoming = incomingTo(u.id);
        return (
            <>
                <DetailCaption title={<>1 {u.name} holds</>} count={selFactors.length} />
                {selFactors.length === 0 && <ColumnEmpty>{canManage
                    ? `Not defined — use the bar above if ${u.name} is a pack of something, e.g. 1 ${u.name} = 2.5 kg.`
                    : 'Not defined.'}</ColumnEmpty>}
                {selFactors.map((f, i) => factorRow(f, i, <>1 <b>{u.name}</b> = {num(f.value)} {f.to_uom_name}</>))}

                <DetailCaption title={<>Packs into {u.name}</>} count={incoming.length} />
                {incoming.length === 0 && <ColumnEmpty>Nothing packs into {u.name} — items stocked in {u.name} have no packaging choices.</ColumnEmpty>}
                {incoming.map((f, i) => factorRow(f, i, <>1 <b>{f.from_uom_name}</b> = {num(f.value)} {u.name}</>))}
            </>
        );
    };

    return (
        <ColumnPanes>
            {/* ── Left: unit list ──────────────────────────────────────────── */}
            <ColumnPane
                width={280}
                label="Units"
                toolbar={<SearchField value={search} onChange={setSearch} placeholder="Search units…" grow width={400} />}
                footer={
                    <>
                        <ToolbarCount>{filtered.length} unit{filtered.length !== 1 ? 's' : ''}</ToolbarCount>
                        {canManage && (
                            <span style={{ marginLeft: 'auto' }}>
                                <ToolbarButton tone="create" icon="bi-plus-lg" onClick={openCreate}>New UOM</ToolbarButton>
                            </span>
                        )}
                    </>
                }
            >
                {ordered.length === 0 && <ColumnEmpty>{all.length === 0 ? 'No units defined.' : 'No units match.'}</ColumnEmpty>}
                {filteredSystem.length > 0 && <>{groupHeader('System units', filteredSystem.length)}{filteredSystem.map(listRow)}</>}
                {filteredCustom.length > 0 && <>{groupHeader('Custom units', filteredCustom.length)}{filteredCustom.map(listRow)}</>}
            </ColumnPane>

            {/* ── Right: selected unit ─────────────────────────────────────── */}
            <DetailPane empty="Select a unit.">
                {selected && (
                    <>
                        <DetailHeader
                            title={selected.name}
                            chips={selected.is_system ? <Chip tone={BROWSER_TONES.system} icon="bi-shield-lock" size="xs">System</Chip> : undefined}
                            actions={canManage && !selected.is_system ? (
                                <button type="button" className={XP_BTN} style={lvBtn('danger')} onClick={() => onDeleteUOM(selected.id)}>
                                    <i className="bi bi-trash me-1" />Delete Unit
                                </button>
                            ) : undefined}
                        >
                            A conversion <b>1 {selected.name} = N X</b> makes {selected.name} a packaging choice on items stocked in X.
                            {selected.is_system && ' System unit — cannot be deleted.'}
                        </DetailHeader>

                        {/* Add bar: 1 <selected> = N <target> */}
                        {canManage && (
                            <div style={xpToolbar({ flexShrink: 0 })}>
                                <span style={{ fontSize: 11 }}>1 <b>{selected.name}</b> =</span>
                                <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    style={lvInput({ width: 90, ...(valueBad ? { borderColor: '#c00000' } : {}) })}
                                    value={factorValue}
                                    onChange={e => setFactorValue(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFactor(); } }}
                                    placeholder="qty"
                                    title={valueBad ? 'Must be greater than 0' : undefined}
                                    aria-label="Quantity"
                                />
                                <select
                                    style={lvInput({ width: 120 })}
                                    value={factorToUomId}
                                    onChange={e => setFactorToUomId(e.target.value)}
                                    aria-label="Target unit"
                                >
                                    <option value="">unit…</option>
                                    {all.filter(o => o.id !== selected.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </select>
                                <span style={lvSep()} />
                                <ToolbarButton tone="create" icon="bi-plus-lg" onClick={addFactor} disabled={!canAdd}>Add</ToolbarButton>
                                {dupFactor && <span style={{ fontSize: 10, color: '#c00000' }}>Already defined</span>}
                            </div>
                        )}

                        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#fff' }}>
                            {unitPane(selected)}
                        </div>
                    </>
                )}
            </DetailPane>

            <ModalWrapper
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={<><i className="bi bi-plus-circle me-1"></i>New UOM</>}
                size="sm"
                modeless
                footer={
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button type="button" className={XP_BTN} style={lvBtn()} onClick={() => setIsModalOpen(false)}>Cancel</button>
                        <button type="submit" className={XP_BTN} form="uom-create-form" style={lvPrimaryBtn()} disabled={isSubmitting || !newName.trim()}>{isSubmitting ? 'Creating…' : 'Create'}</button>
                    </div>
                }
            >
                <form id="uom-create-form" onSubmit={handleCreate}>
                    <FormError>{formError}</FormError>
                    <FormSection title="Unit">
                        <label style={lvLabel()}>Name *</label>
                        <input
                            autoFocus
                            value={newName}
                            onChange={e => { setNewName(e.target.value); if (formError) setFormError(''); }}
                            placeholder="e.g. Cone, Box, Dozen"
                            style={lvInput({ width: '100%', ...(formError ? { borderColor: '#8e0000' } : {}) })}
                            required
                        />
                        <div style={{ marginTop: 4, fontSize: 10, color: '#666' }}>
                            It is selected after creating, so you can define what one unit holds (e.g. 1 Cone = 2.5 kg).
                        </div>
                    </FormSection>
                </form>
            </ModalWrapper>
        </ColumnPanes>
    );
}
