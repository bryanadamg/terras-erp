'use client';

import { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../shared/Toast';

interface Props {
    categories: any[];
    uoms: any[];
    attributes: any[];
    onCreateCategory: (name: string) => void;
    onDeleteCategory: (id: string) => void;
    onCreateUOM: (name: string) => void;
    onDeleteUOM: (id: string) => void;
    onCreateUOMFactor: (uomId: string, value: number, label: string) => void;
    onDeleteUOMFactor: (uomId: string, factorId: string) => void;
    onCreateAttribute: (p: any) => void;
    onUpdateAttribute: (id: string, name: string) => void;
    onDeleteAttribute: (id: string) => void;
    onAddValue: (attributeId: string, value: string) => void;
    onUpdateValue: (valueId: string, value: string) => void;
    onDeleteValue: (valueId: string) => void;
}

export default function ItemMetadataView({
    categories, uoms, attributes,
    onCreateCategory, onDeleteCategory,
    onCreateUOM, onDeleteUOM, onCreateUOMFactor, onDeleteUOMFactor,
    onCreateAttribute, onUpdateAttribute, onDeleteAttribute,
    onAddValue, onUpdateValue, onDeleteValue,
}: Props) {
    const { t } = useLanguage();
    const { showToast } = useToast();

    // ── UI style ──────────────────────────────────────────────────────────────
    const { uiStyle: currentStyle } = useTheme();
    const classic = currentStyle === 'classic';

    // ── Category state ────────────────────────────────────────────────────────
    const [newCategoryName, setNewCategoryName] = useState('');
    const [catSearch, setCatSearch] = useState('');
    const [catHovered, setCatHovered] = useState<string | null>(null);
    const [isCatSubmitting, setIsCatSubmitting] = useState(false);

    // ── UOM state ─────────────────────────────────────────────────────────────
    const [newUOMName, setNewUOMName] = useState('');
    const [uomSearch, setUomSearch] = useState('');
    const [uomHovered, setUomHovered] = useState<string | null>(null);
    const [isUomSubmitting, setIsUomSubmitting] = useState(false);
    const [expandedUomId, setExpandedUomId] = useState<string | null>(null);
    const [newFactorValue, setNewFactorValue] = useState('');
    const [newFactorLabel, setNewFactorLabel] = useState('');

    // ── Attribute state ───────────────────────────────────────────────────────
    const [newAttribute, setNewAttribute] = useState({ name: '', values: [] as any[] });
    const [isAttrSubmitting, setIsAttrSubmitting] = useState(false);
    const [newAttributeValue, setNewAttributeValue] = useState('');
    const [editingAttr, setEditingAttr] = useState<any>(null);
    const [newValueForEdit, setNewValueForEdit] = useState('');
    const [attrSearch, setAttrSearch] = useState('');
    const [attrHovered, setAttrHovered] = useState<string | null>(null);

    // ── Derived ───────────────────────────────────────────────────────────────
    const activeAttribute = editingAttr ? (attributes || []).find((a: any) => a.id === editingAttr.id) : null;

    const getNextValue = (values: any[]) => {
        const numbers = values.map((v: any) => parseInt(v.value)).filter((n: number) => !isNaN(n));
        return numbers.length > 0 ? Math.max(...numbers) + 1 : null;
    };

    const nextValForNew = getNextValue(newAttribute.values);
    const nextValForEdit = activeAttribute ? getNextValue(activeAttribute.values) : null;

    const filteredCats = (categories || []).filter((c: any) => c.name.toLowerCase().includes(catSearch.toLowerCase()));
    const filteredUOMs = (uoms || []).filter((u: any) => u.name.toLowerCase().includes(uomSearch.toLowerCase()));
    const filteredAttrs = (attributes || []).filter((a: any) => a.name.toLowerCase().includes(attrSearch.toLowerCase()));

    // ── Handlers ──────────────────────────────────────────────────────────────
    const handleCreateCategory = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newCategoryName.trim() || isCatSubmitting) return;
        setIsCatSubmitting(true);
        try {
            const res = await onCreateCategory(newCategoryName.trim());
            if (res?.ok) { showToast('Category added', 'success'); setNewCategoryName(''); }
            else if (res?.status === 400) showToast(`Category "${newCategoryName.trim()}" already exists`, 'warning');
            else showToast('Failed to add category', 'danger');
        } finally { setIsCatSubmitting(false); }
    };

    const handleCreateUOM = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newUOMName.trim() || isUomSubmitting) return;
        setIsUomSubmitting(true);
        try {
            const res = await onCreateUOM(newUOMName.trim());
            if (res?.ok) { showToast('UOM added', 'success'); setNewUOMName(''); }
            else if (res?.status === 400) showToast(`UOM "${newUOMName.trim()}" already exists`, 'warning');
            else showToast('Failed to add UOM', 'danger');
        } finally { setIsUomSubmitting(false); }
    };

    const handleAddValueToNewAttr = () => {
        if (!newAttributeValue) return;
        setNewAttribute({ ...newAttribute, values: [...newAttribute.values, { value: newAttributeValue }] });
        setNewAttributeValue('');
    };

    const handleAddNextToNew = () => {
        if (nextValForNew !== null)
            setNewAttribute({ ...newAttribute, values: [...newAttribute.values, { value: String(nextValForNew) }] });
    };

    const handleCreateAttrSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newAttribute.name.trim() || isAttrSubmitting) return;
        setIsAttrSubmitting(true);
        try {
            const res = await onCreateAttribute(newAttribute);
            if (res?.ok) { showToast('Attribute added', 'success'); setNewAttribute({ name: '', values: [] }); }
            else if (res?.status === 400) showToast(`Attribute "${newAttribute.name}" already exists`, 'warning');
            else showToast('Failed to add attribute', 'danger');
        } finally { setIsAttrSubmitting(false); }
    };

    const startEditing = (attr: any) => setEditingAttr({ ...attr });
    const cancelEditing = () => { setEditingAttr(null); setNewValueForEdit(''); };

    const handleUpdateAttrName = () => {
        if (editingAttr?.name) onUpdateAttribute(editingAttr.id, editingAttr.name);
    };

    const handleAddValueToExisting = () => {
        if (editingAttr && newValueForEdit) { onAddValue(editingAttr.id, newValueForEdit); setNewValueForEdit(''); }
    };

    const handleAddNextToExisting = () => {
        if (editingAttr && nextValForEdit !== null) onAddValue(editingAttr.id, String(nextValForEdit));
    };

    // ── XP shared styles ──────────────────────────────────────────────────────
    const xpBevel: React.CSSProperties = {
        border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
        boxShadow: '2px 2px 4px rgba(0,0,0,0.3)', background: '#ece9d8', borderRadius: 0,
    };
    const xpTitleBar = (extra: React.CSSProperties = {}): React.CSSProperties => ({
        background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)', color: '#ffffff',
        fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '12px', fontWeight: 'bold',
        padding: '4px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
        borderBottom: '1px solid #003080', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', minHeight: '26px', ...extra,
    });
    const xpTitleBarEdit: React.CSSProperties = {
        background: 'linear-gradient(to right, #6a3a8e 0%, #a06ac8 100%)', color: '#ffffff',
        fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '12px', fontWeight: 'bold',
        padding: '4px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
        borderBottom: '1px solid #3d1a5e', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', minHeight: '26px',
    };
    const xpToolbar: React.CSSProperties = {
        background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898',
        padding: '3px 6px', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap',
    };
    const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
        fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', padding: '2px 10px', cursor: 'pointer',
        background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)', border: '1px solid',
        borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#000000', borderRadius: 0, ...extra,
    });
    const xpBtnGreen: React.CSSProperties = xpBtn({
        background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)',
        borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', fontWeight: 'bold',
    });
    const xpBtnBlue: React.CSSProperties = xpBtn({
        background: 'linear-gradient(to bottom,#316ac5,#1a4a8a)',
        borderColor: '#1a3a7a #0a2a5a #0a2a5a #1a3a7a', color: '#ffffff',
    });
    const xpInput: React.CSSProperties = {
        fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', border: '1px solid #7f9db9',
        boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)', padding: '1px 6px',
        background: '#ffffff', color: '#000000', height: '20px', outline: 'none',
    };
    const xpSep: React.CSSProperties = { width: '1px', height: '20px', background: '#a0988c', margin: '0 2px', flexShrink: 0 };
    const xpLabel: React.CSSProperties = { fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 };
    const xpStatusBar: React.CSSProperties = {
        background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898',
        padding: '2px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#333',
    };

    // ── Classic (XP) mode ─────────────────────────────────────────────────────
    if (classic) {
        return (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* ── Row 1: Categories + UOM side-by-side ─────────────────── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

                    {/* Categories mini-window */}
                    <div style={xpBevel}>
                        <div style={xpTitleBar({ background: 'linear-gradient(to right,#1a8a1a,#3ec83e)', borderBottom: '1px solid #0a4e0a' })}>
                            <span><i className="bi bi-tag-fill" style={{ marginRight: 6 }}></i>Categories</span>
                        </div>
                        <form onSubmit={handleCreateCategory}>
                            <div style={xpToolbar}>
                                <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', whiteSpace: 'nowrap' }}>New:</span>
                                <input style={{ ...xpInput, flex: 1, minWidth: 80 }} placeholder="e.g. Spare Parts..." value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} />
                                <button type="submit" disabled={isCatSubmitting} style={{ ...xpBtnGreen, opacity: isCatSubmitting ? 0.6 : 1 }}><i className="bi bi-plus-lg" style={{ marginRight: 3 }}></i>{isCatSubmitting ? '...' : 'Add'}</button>
                            </div>
                        </form>
                        <div style={xpToolbar}>
                            <i className="bi bi-search" style={{ fontSize: '11px', color: '#666' }}></i>
                            <input style={{ ...xpInput, flex: 1 }} placeholder="Search..." value={catSearch} onChange={e => setCatSearch(e.target.value)} />
                            <div style={xpSep} />
                            <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>{filteredCats.length}</span>
                        </div>
                        <div style={{ background: '#ffffff', maxHeight: 200, overflowY: 'auto' }}>
                            {filteredCats.map((cat: any, i: number) => (
                                <div key={cat.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: i % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' }}>
                                    <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px' }}>{cat.name}</span>
                                    <button
                                        style={{ ...xpBtn(), border: catHovered === cat.id ? '1px solid #808080' : '1px solid transparent', background: catHovered === cat.id ? 'linear-gradient(to bottom,#ffffff,#d4d0c8)' : 'transparent', padding: '1px 6px' }}
                                        onMouseEnter={() => setCatHovered(cat.id)} onMouseLeave={() => setCatHovered(null)}
                                        onClick={() => onDeleteCategory(cat.id)} title="Delete"
                                    >
                                        <i className="bi bi-trash" style={{ color: '#c00000', fontSize: '11px' }}></i>
                                    </button>
                                </div>
                            ))}
                            {filteredCats.length === 0 && <div style={{ textAlign: 'center', padding: '16px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666' }}>No categories</div>}
                        </div>
                        <div style={xpStatusBar}><b>{(categories || []).length}</b> Total</div>
                    </div>

                    {/* UOM mini-window */}
                    <div style={xpBevel}>
                        <div style={xpTitleBar({ background: 'linear-gradient(to right,#c06a00,#f09030)', borderBottom: '1px solid #804800' })}>
                            <span><i className="bi bi-rulers" style={{ marginRight: 6 }}></i>Units of Measure (UOM)</span>
                        </div>
                        <form onSubmit={handleCreateUOM}>
                            <div style={xpToolbar}>
                                <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', whiteSpace: 'nowrap' }}>New:</span>
                                <input style={{ ...xpInput, flex: 1, minWidth: 80 }} placeholder="e.g. Dozen, kg..." value={newUOMName} onChange={e => setNewUOMName(e.target.value)} />
                                <button type="submit" disabled={isUomSubmitting} style={{ ...xpBtnGreen, opacity: isUomSubmitting ? 0.6 : 1 }}><i className="bi bi-plus-lg" style={{ marginRight: 3 }}></i>{isUomSubmitting ? '...' : 'Add'}</button>
                            </div>
                        </form>
                        <div style={xpToolbar}>
                            <i className="bi bi-search" style={{ fontSize: '11px', color: '#666' }}></i>
                            <input style={{ ...xpInput, flex: 1 }} placeholder="Search..." value={uomSearch} onChange={e => setUomSearch(e.target.value)} />
                            <div style={xpSep} />
                            <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>{filteredUOMs.length}</span>
                        </div>
                        <div style={{ background: '#ffffff', maxHeight: 260, overflowY: 'auto' }}>
                            {filteredUOMs.map((uom: any, i: number) => (
                                <div key={uom.id}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: i % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                                            <button
                                                style={{ ...xpBtn(), padding: '0px 4px', fontSize: '10px', minWidth: 16 }}
                                                onClick={() => setExpandedUomId(expandedUomId === uom.id ? null : uom.id)}
                                                title="Conversion factors"
                                            >{expandedUomId === uom.id ? '▾' : '▸'}</button>
                                            <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', fontVariant: 'all-small-caps' }}>{uom.name}</span>
                                            {uom.is_system && (
                                                <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '9px', color: '#003080', background: '#dce8ff', border: '1px solid #7fa8e0', padding: '0 4px', borderRadius: 0 }}>SYSTEM</span>
                                            )}
                                            {(uom.factors || []).length > 0 && (
                                                <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '9px', color: '#c06a00', background: '#fff3e0', border: '1px solid #f0a040', padding: '0 4px', borderRadius: 0 }}>
                                                    {(uom.factors || []).length} factor{(uom.factors || []).length > 1 ? 's' : ''}
                                                </span>
                                            )}
                                        </div>
                                        {!uom.is_system && (
                                            <button
                                                style={{ ...xpBtn(), border: uomHovered === uom.id ? '1px solid #808080' : '1px solid transparent', background: uomHovered === uom.id ? 'linear-gradient(to bottom,#ffffff,#d4d0c8)' : 'transparent', padding: '1px 6px' }}
                                                onMouseEnter={() => setUomHovered(uom.id)} onMouseLeave={() => setUomHovered(null)}
                                                onClick={() => onDeleteUOM(uom.id)} title="Delete"
                                            >
                                                <i className="bi bi-trash" style={{ color: '#c00000', fontSize: '11px' }}></i>
                                            </button>
                                        )}
                                    </div>
                                    {expandedUomId === uom.id && (
                                        <div style={{ background: '#f0ede4', borderBottom: '1px solid #c0bdb5', padding: '6px 12px 6px 28px' }}>
                                            <div style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: '#804800', marginBottom: 4 }}>
                                                1 {uom.name} = X Yd (conversion factors)
                                            </div>
                                            {(uom.factors || []).map((f: any) => (
                                                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                                    <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000' }}>
                                                        <b>{parseFloat(f.value)} Yd</b>{f.label ? ` — ${f.label}` : ''}
                                                    </span>
                                                    <button style={{ ...xpBtn(), padding: '0px 4px', fontSize: '10px' }} onClick={() => onDeleteUOMFactor(uom.id, f.id)} title="Remove">✕</button>
                                                </div>
                                            ))}
                                            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                                                <input type="number" style={{ ...xpInput, width: 64 }} placeholder="Yd" value={expandedUomId === uom.id ? newFactorValue : ''} onChange={e => setNewFactorValue(e.target.value)} />
                                                <input style={{ ...xpInput, flex: 1 }} placeholder="Label (optional)" value={expandedUomId === uom.id ? newFactorLabel : ''} onChange={e => setNewFactorLabel(e.target.value)} />
                                                <button style={xpBtn({ background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#fff' })}
                                                    onClick={() => { if (newFactorValue) { onCreateUOMFactor(uom.id, parseFloat(newFactorValue), newFactorLabel); setNewFactorValue(''); setNewFactorLabel(''); } }}
                                                >Add</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {filteredUOMs.length === 0 && <div style={{ textAlign: 'center', padding: '16px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666' }}>No units</div>}
                        </div>
                        <div style={xpStatusBar}><b>{(uoms || []).length}</b> Total</div>
                    </div>
                </div>

                {/* ── Row 2: Attributes full-width ─────────────────────────── */}
                <div className="row g-3">
                    {/* Left: Create / Edit panel */}
                    <div className="col-md-5">
                        <div style={{ ...xpBevel, height: '100%' }}>
                            <div style={activeAttribute ? xpTitleBarEdit : xpTitleBar()}>
                                <span>
                                    {activeAttribute
                                        ? <><i className="bi bi-pencil-square" style={{ marginRight: 6 }}></i>Edit: {activeAttribute.name}</>
                                        : <><i className="bi bi-plus-circle" style={{ marginRight: 6 }}></i>Create Attribute</>
                                    }
                                </span>
                                {activeAttribute && (
                                    <button style={xpBtn({ padding: '1px 8px', fontSize: '10px' })} onClick={cancelEditing}>Cancel</button>
                                )}
                            </div>
                            <div style={{ padding: '8px', background: '#f5f4ef' }}>
                                {activeAttribute ? (
                                    // Edit mode
                                    <div>
                                        <label style={xpLabel}>Attribute Name</label>
                                        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                                            <input style={{ ...xpInput, flex: 1 }} value={editingAttr.name} onChange={e => setEditingAttr({ ...editingAttr, name: e.target.value })} />
                                            <button style={xpBtnBlue} onClick={handleUpdateAttrName}>Save</button>
                                        </div>
                                        <label style={xpLabel}>Values ({activeAttribute.values.length})</label>
                                        <div style={{ background: '#ffffff', border: '1px solid #7f9db9', maxHeight: 200, overflowY: 'auto', marginBottom: 6 }}>
                                            {activeAttribute.values.map((val: any, i: number) => (
                                                <div key={val.id} style={{ display: 'flex', alignItems: 'center', padding: '2px 4px', background: i % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #e0dfd8' }}>
                                                    <input
                                                        style={{ ...xpInput, flex: 1, border: 'none', boxShadow: 'none', height: '18px', background: 'transparent' }}
                                                        defaultValue={val.value}
                                                        onBlur={e => { if (e.target.value !== val.value) onUpdateValue(val.id, e.target.value); }}
                                                    />
                                                    <button
                                                        style={{ ...xpBtn(), border: attrHovered === val.id ? '1px solid #808080' : '1px solid transparent', background: attrHovered === val.id ? 'linear-gradient(to bottom,#ffffff,#d4d0c8)' : 'transparent', padding: '0 4px' }}
                                                        onMouseEnter={() => setAttrHovered(val.id)} onMouseLeave={() => setAttrHovered(null)}
                                                        onClick={() => onDeleteValue(val.id)}
                                                    >
                                                        <i className="bi bi-x" style={{ color: '#c00000', fontSize: '11px' }}></i>
                                                    </button>
                                                </div>
                                            ))}
                                            {activeAttribute.values.length === 0 && (
                                                <div style={{ padding: '8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666', textAlign: 'center' }}>No values yet</div>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            <input
                                                style={{ ...xpInput, flex: 1 }}
                                                placeholder="Add value..."
                                                value={newValueForEdit}
                                                onChange={e => setNewValueForEdit(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleAddValueToExisting()}
                                            />
                                            <button style={xpBtn()} onClick={handleAddValueToExisting}>{t('add')}</button>
                                            {nextValForEdit !== null && (
                                                <button style={xpBtn({ background: 'linear-gradient(to bottom,#d4ead4,#a0c8a0)', borderColor: '#2e7d32 #1a5e1a #1a5e1a #2e7d32' })} onClick={handleAddNextToExisting}>+{nextValForEdit}</button>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    // Create mode
                                    <form onSubmit={handleCreateAttrSubmit}>
                                        <label style={xpLabel}>Name</label>
                                        <input style={{ ...xpInput, width: '100%', marginBottom: 8 }} placeholder="e.g. Size, Color" value={newAttribute.name} onChange={e => setNewAttribute({ ...newAttribute, name: e.target.value })} required />
                                        <label style={xpLabel}>Initial Values</label>
                                        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                                            <input
                                                style={{ ...xpInput, flex: 1 }}
                                                placeholder="Value (e.g. S, M, L)"
                                                value={newAttributeValue}
                                                onChange={e => setNewAttributeValue(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddValueToNewAttr(); } }}
                                            />
                                            <button type="button" style={xpBtn()} onClick={handleAddValueToNewAttr}>{t('add')}</button>
                                            {nextValForNew !== null && (
                                                <button type="button" style={xpBtn({ background: 'linear-gradient(to bottom,#d4ead4,#a0c8a0)', borderColor: '#2e7d32 #1a5e1a #1a5e1a #2e7d32' })} onClick={handleAddNextToNew}>+{nextValForNew}</button>
                                            )}
                                        </div>
                                        <div style={{ background: '#ffffff', border: '1px solid #7f9db9', minHeight: 32, padding: '4px 6px', display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                                            {newAttribute.values.map((v, i) => (
                                                <span key={i} style={{ background: '#dde8f5', border: '1px solid #7f9db9', padding: '1px 6px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px' }}>{v.value}</span>
                                            ))}
                                            {newAttribute.values.length === 0 && <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#888', fontStyle: 'italic' }}>No values added</span>}
                                        </div>
                                        <button type="submit" disabled={isAttrSubmitting} style={{ ...xpBtnGreen, width: '100%', padding: '4px 10px', opacity: isAttrSubmitting ? 0.6 : 1 }}>
                                            <i className="bi bi-plus-circle" style={{ marginRight: 6 }}></i>{isAttrSubmitting ? '...' : 'Create Attribute'}
                                        </button>
                                    </form>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right: Attribute list */}
                    <div className="col-md-7">
                        <div style={{ ...xpBevel, height: '100%' }}>
                            <div style={xpTitleBar()}>
                                <span><i className="bi bi-collection-fill" style={{ marginRight: 6 }}></i>Variants &amp; Attributes</span>
                            </div>
                            <div style={xpToolbar}>
                                <i className="bi bi-search" style={{ fontSize: '11px', color: '#666' }}></i>
                                <input style={{ ...xpInput, width: 200 }} placeholder="Search attributes..." value={attrSearch} onChange={e => setAttrSearch(e.target.value)} />
                                <div style={xpSep} />
                                <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>{filteredAttrs.length} attribute{filteredAttrs.length === 1 ? '' : 's'}</span>
                            </div>
                            <div style={{ background: '#ffffff', maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}>
                                {filteredAttrs.map((attr: any, i: number) => {
                                    const isActive = activeAttribute?.id === attr.id;
                                    return (
                                        <div
                                            key={attr.id}
                                            onClick={() => startEditing(attr)}
                                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '5px 8px', cursor: 'pointer', background: isActive ? '#316ac5' : (i % 2 === 0 ? '#ffffff' : '#f5f3ee'), borderBottom: '1px solid #c0bdb5', borderLeft: isActive ? '3px solid #08a5ff' : '3px solid transparent' }}
                                        >
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                                    <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', fontWeight: 'bold', color: isActive ? '#ffffff' : '#000' }}>{attr.name}</span>
                                                    <span style={{ background: isActive ? 'rgba(255,255,255,0.2)' : '#e0dfd8', border: `1px solid ${isActive ? 'rgba(255,255,255,0.4)' : '#b0a898'}`, padding: '0 4px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: isActive ? '#ffffff' : '#555' }}>{attr.values.length}</span>
                                                </div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                                    {attr.values.slice(0, 8).map((v: any) => (
                                                        <span key={v.id} style={{ background: isActive ? 'rgba(255,255,255,0.15)' : '#dde8f5', border: `1px solid ${isActive ? 'rgba(255,255,255,0.35)' : '#7f9db9'}`, padding: '0 4px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: isActive ? '#ffffff' : '#333' }}>{v.value}</span>
                                                    ))}
                                                    {attr.values.length > 8 && <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: isActive ? 'rgba(255,255,255,0.7)' : '#888' }}>…</span>}
                                                </div>
                                            </div>
                                            <button
                                                onClick={e => { e.stopPropagation(); onDeleteAttribute(attr.id); }}
                                                style={{ ...xpBtn(), border: attrHovered === `del-${attr.id}` ? '1px solid #808080' : '1px solid transparent', background: attrHovered === `del-${attr.id}` ? 'linear-gradient(to bottom,#ffffff,#d4d0c8)' : 'transparent', padding: '1px 6px', marginLeft: 6, flexShrink: 0 }}
                                                onMouseEnter={() => setAttrHovered(`del-${attr.id}`)} onMouseLeave={() => setAttrHovered(null)}
                                                title="Delete"
                                            >
                                                <i className="bi bi-trash" style={{ color: isActive ? '#ffcccc' : '#c00000', fontSize: '11px' }}></i>
                                            </button>
                                        </div>
                                    );
                                })}
                                {filteredAttrs.length === 0 && (
                                    <div style={{ textAlign: 'center', padding: '20px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666' }}>No attribute templates defined</div>
                                )}
                            </div>
                            <div style={xpStatusBar}><b>{(attributes || []).length}</b> Total</div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Modern (Bootstrap) mode ───────────────────────────────────────────────
    return (
        <div className="fade-in d-flex flex-column gap-3">

            {/* Row 1: Categories + UOM */}
            <div className="row g-3">
                <div className="col-md-6">
                    <div className="card shadow-sm border-0 h-100">
                        <div className="card-header bg-white">
                            <h5 className="card-title mb-0"><i className="bi bi-tag-fill me-2 text-success"></i>{t('categories')}</h5>
                            <p className="text-muted small mb-0 mt-1">Classify your inventory items.</p>
                        </div>
                        <div className="card-body">
                            <form onSubmit={handleCreateCategory} className="mb-3">
                                <div className="input-group">
                                    <input className="form-control" placeholder="e.g. Spare Parts, Raw Materials..." value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} required />
                                    <button type="submit" className="btn btn-success px-4" disabled={isCatSubmitting}>{isCatSubmitting ? '...' : t('add')}</button>
                                </div>
                            </form>
                            <div className="input-group mb-3">
                                <span className="input-group-text"><i className="bi bi-search"></i></span>
                                <input className="form-control" placeholder="Search categories..." value={catSearch} onChange={e => setCatSearch(e.target.value)} />
                            </div>
                            <div className="list-group list-group-flush border rounded">
                                {filteredCats.map((cat: any) => (
                                    <div key={cat.id} className="list-group-item d-flex justify-content-between align-items-center">
                                        <span className="fw-medium">{cat.name}</span>
                                        <button className="btn btn-sm text-danger" onClick={() => onDeleteCategory(cat.id)}><i className="bi bi-trash me-1"></i>{t('delete')}</button>
                                    </div>
                                ))}
                                {filteredCats.length === 0 && <div className="list-group-item text-center text-muted py-4 fst-italic">No categories found</div>}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-md-6">
                    <div className="card shadow-sm border-0 h-100">
                        <div className="card-header bg-white">
                            <h5 className="card-title mb-0"><i className="bi bi-rulers me-2 text-warning"></i>Units of Measure (UOM)</h5>
                            <p className="text-muted small mb-0 mt-1">Manage standard units for items.</p>
                        </div>
                        <div className="card-body">
                            <form onSubmit={handleCreateUOM} className="mb-3">
                                <div className="input-group">
                                    <input className="form-control" placeholder="e.g. Dozen, Box, Litre..." value={newUOMName} onChange={e => setNewUOMName(e.target.value)} required />
                                    <button type="submit" className="btn btn-success px-4" disabled={isUomSubmitting}>{isUomSubmitting ? '...' : t('add')}</button>
                                </div>
                            </form>
                            <div className="input-group mb-3">
                                <span className="input-group-text"><i className="bi bi-search"></i></span>
                                <input className="form-control" placeholder="Search units..." value={uomSearch} onChange={e => setUomSearch(e.target.value)} />
                            </div>
                            <div className="list-group list-group-flush border rounded">
                                {filteredUOMs.map((uom: any) => (
                                    <div key={uom.id}>
                                        <div className="list-group-item d-flex justify-content-between align-items-center">
                                            <div className="d-flex align-items-center gap-2">
                                                <button className="btn btn-sm btn-outline-secondary py-0 px-1" style={{ fontSize: 11 }}
                                                    onClick={() => setExpandedUomId(expandedUomId === uom.id ? null : uom.id)}
                                                >{expandedUomId === uom.id ? '▾' : '▸'}</button>
                                                <span className="fw-medium font-monospace">{uom.name}</span>
                                                {uom.is_system && (
                                                    <span className="badge bg-primary" style={{ fontSize: 10 }}>SYSTEM</span>
                                                )}
                                                {(uom.factors || []).length > 0 && (
                                                    <span className="badge bg-warning text-dark" style={{ fontSize: 10 }}>
                                                        {(uom.factors || []).length} factor{(uom.factors || []).length > 1 ? 's' : ''}
                                                    </span>
                                                )}
                                            </div>
                                            {!uom.is_system && (
                                                <button className="btn btn-sm text-danger" onClick={() => onDeleteUOM(uom.id)}><i className="bi bi-trash me-1"></i>{t('delete')}</button>
                                            )}
                                        </div>
                                        {expandedUomId === uom.id && (
                                            <div className="list-group-item bg-light ps-4">
                                                <div className="text-muted small mb-2">1 {uom.name} = X Yd — conversion factors</div>
                                                {(uom.factors || []).map((f: any) => (
                                                    <div key={f.id} className="d-flex align-items-center gap-2 mb-1">
                                                        <span className="small"><strong>{parseFloat(f.value)} Yd</strong>{f.label ? ` — ${f.label}` : ''}</span>
                                                        <button className="btn btn-sm text-danger p-0 px-1" onClick={() => onDeleteUOMFactor(uom.id, f.id)}>✕</button>
                                                    </div>
                                                ))}
                                                <div className="d-flex gap-2 mt-2">
                                                    <input type="number" className="form-control form-control-sm" style={{ width: 80 }} placeholder="Yd"
                                                        value={expandedUomId === uom.id ? newFactorValue : ''} onChange={e => setNewFactorValue(e.target.value)} />
                                                    <input className="form-control form-control-sm" placeholder="Label (optional)"
                                                        value={expandedUomId === uom.id ? newFactorLabel : ''} onChange={e => setNewFactorLabel(e.target.value)} />
                                                    <button className="btn btn-sm btn-success" onClick={() => { if (newFactorValue) { onCreateUOMFactor(uom.id, parseFloat(newFactorValue), newFactorLabel); setNewFactorValue(''); setNewFactorLabel(''); } }}>Add</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {filteredUOMs.length === 0 && <div className="list-group-item text-center text-muted py-4 fst-italic">No UOMs defined</div>}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Row 2: Attributes full-width */}
            <div className="row g-4">
                <div className="col-md-5">
                    <div className={`card h-100 shadow-sm border-0 ${activeAttribute ? 'border-primary border-2' : ''}`}>
                        <div className={`card-header ${activeAttribute ? 'bg-primary bg-opacity-10 text-primary-emphasis' : 'bg-success bg-opacity-10 text-success-emphasis'}`}>
                            <h5 className="card-title mb-0">
                                {activeAttribute
                                    ? <span><i className="bi bi-pencil-square me-2"></i>{t('edit')} Template</span>
                                    : <span><i className="bi bi-plus-circle me-2"></i>{t('create')} Template</span>
                                }
                            </h5>
                        </div>
                        <div className="card-body">
                            {activeAttribute ? (
                                <div>
                                    <div className="d-flex justify-content-between align-items-center mb-3">
                                        <span className="badge bg-primary text-white">{activeAttribute.name}</span>
                                        <button className="btn btn-sm btn-outline-secondary" onClick={cancelEditing}>{t('cancel')}</button>
                                    </div>
                                    <div className="mb-3">
                                        <label className="form-label small">Template Name</label>
                                        <div className="input-group">
                                            <input className="form-control" value={editingAttr.name} onChange={e => setEditingAttr({ ...editingAttr, name: e.target.value })} />
                                            <button className="btn btn-outline-primary" onClick={handleUpdateAttrName}>{t('save')}</button>
                                        </div>
                                    </div>
                                    <label className="form-label small">Values</label>
                                    <div className="list-group mb-3" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                        {activeAttribute.values.map((val: any) => (
                                            <div key={val.id} className="list-group-item d-flex justify-content-between align-items-center p-2">
                                                <input className="form-control form-control-sm border-0 bg-transparent" defaultValue={val.value} onBlur={e => { if (e.target.value !== val.value) onUpdateValue(val.id, e.target.value); }} />
                                                <button className="btn btn-sm text-danger" onClick={() => onDeleteValue(val.id)}><i className="bi bi-trash"></i></button>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="input-group input-group-sm">
                                        <input className="form-control" placeholder="Add new value..." value={newValueForEdit} onChange={e => setNewValueForEdit(e.target.value)} />
                                        <button className="btn btn-secondary" onClick={handleAddValueToExisting}>{t('add')}</button>
                                        {nextValForEdit !== null && (
                                            <button className="btn btn-outline-success" onClick={handleAddNextToExisting}>+ {nextValForEdit}</button>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <form onSubmit={handleCreateAttrSubmit}>
                                    <div className="mb-3">
                                        <label className="form-label small text-muted">Name</label>
                                        <input className="form-control" placeholder="e.g. Size, Color" value={newAttribute.name} onChange={e => setNewAttribute({ ...newAttribute, name: e.target.value })} required />
                                    </div>
                                    <div className="mb-3">
                                        <label className="form-label small text-muted">Initial Values</label>
                                        <div className="input-group mb-2">
                                            <input className="form-control" placeholder="Value (e.g. S, M, L)" value={newAttributeValue} onChange={e => setNewAttributeValue(e.target.value)} />
                                            <button type="button" className="btn btn-secondary" onClick={handleAddValueToNewAttr}>{t('add')}</button>
                                            {nextValForNew !== null && (
                                                <button type="button" className="btn btn-outline-success" onClick={handleAddNextToNew}>+ {nextValForNew}</button>
                                            )}
                                        </div>
                                        <div className="d-flex flex-wrap gap-2 p-2 border rounded bg-light">
                                            {newAttribute.values.map((v, i) => (
                                                <span key={i} className="badge bg-white text-dark border shadow-sm">{v.value}</span>
                                            ))}
                                            {newAttribute.values.length === 0 && <small className="text-muted fst-italic">No values added</small>}
                                        </div>
                                    </div>
                                    <button type="submit" className="btn btn-success w-100 fw-bold shadow-sm" disabled={isAttrSubmitting}>{isAttrSubmitting ? '...' : t('create')}</button>
                                </form>
                            )}
                        </div>
                    </div>
                </div>

                <div className="col-md-7">
                    <div className="card h-100 shadow-sm border-0">
                        <div className="card-header bg-white d-flex justify-content-between align-items-center">
                            <h5 className="card-title mb-0">{t('attributes')}</h5>
                            <div className="input-group" style={{ width: 220 }}>
                                <span className="input-group-text"><i className="bi bi-search"></i></span>
                                <input className="form-control form-control-sm" placeholder="Search..." value={attrSearch} onChange={e => setAttrSearch(e.target.value)} />
                            </div>
                        </div>
                        <div className="card-body p-0" style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
                            <div className="list-group list-group-flush">
                                {filteredAttrs.map((attr: any) => (
                                    <div
                                        key={attr.id}
                                        className={`list-group-item list-group-item-action d-flex justify-content-between align-items-start p-3 ${activeAttribute?.id === attr.id ? 'active' : ''}`}
                                        onClick={() => startEditing(attr)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <div className="flex-grow-1 me-3">
                                            <div className="d-flex justify-content-between mb-1">
                                                <h6 className="mb-0 fw-bold">{attr.name}</h6>
                                                <span className={`badge ${activeAttribute?.id === attr.id ? 'bg-light text-primary' : 'bg-light text-dark border'}`}>{attr.values.length}</span>
                                            </div>
                                            <div className="d-flex flex-wrap gap-1">
                                                {attr.values.slice(0, 8).map((v: any) => (
                                                    <span key={v.id} className={`badge small ${activeAttribute?.id === attr.id ? 'bg-primary border border-white' : 'bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-10'}`}>{v.value}</span>
                                                ))}
                                                {attr.values.length > 8 && <span className="badge text-muted">...</span>}
                                            </div>
                                        </div>
                                        <div onClick={e => e.stopPropagation()}>
                                            <button className="btn btn-sm btn-link text-danger p-0" onClick={() => onDeleteAttribute(attr.id)}><i className="bi bi-trash fs-6"></i></button>
                                        </div>
                                    </div>
                                ))}
                                {filteredAttrs.length === 0 && <div className="text-center text-muted py-5">No templates defined yet.</div>}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
