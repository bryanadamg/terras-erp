'use client';

import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import { useLanguage } from '../context/LanguageContext';
import ModalWrapper from './ModalWrapper';
import { useTheme } from '../context/ThemeContext';

interface Partner {
    id: string;
    name: string;
    address?: string;
    type: string;
    active: boolean;
}

interface PartnersViewProps {
    partners: Partner[];
    type: 'CUSTOMER' | 'SUPPLIER';
    onCreate: (partner: any) => void;
    onUpdate: (id: string, partner: any) => void;
    onDelete: (id: string) => void;
    onBulkDelete?: (ids: string[]) => void;
}

export default function PartnersView({ partners, type, onCreate, onUpdate, onDelete, onBulkDelete }: PartnersViewProps) {
    const { showToast } = useToast();
    const { t } = useLanguage();
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
    const [newPartner, setNewPartner] = useState({ name: '', address: '', type, active: true });
    const [deletingPartner, setDeletingPartner] = useState<Partner | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const { uiStyle: currentStyle } = useTheme();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

    useEffect(() => {
        setSelectedIds(new Set());
    }, [searchTerm]);

    const classic = currentStyle === 'classic';
    const typeLabel = type === 'CUSTOMER' ? 'Customer' : 'Supplier';

    // ── XP shared inline styles ──────────────────────────────────────────────
    const xpBevel: React.CSSProperties = {
        border: '2px solid',
        borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
        boxShadow: '2px 2px 4px rgba(0,0,0,0.3)',
        background: '#ece9d8',
        borderRadius: 0,
    };

    const xpTitleBar: React.CSSProperties = {
        background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)',
        color: '#ffffff',
        fontFamily: 'Tahoma, Arial, sans-serif',
        fontSize: '12px',
        fontWeight: 'bold',
        padding: '4px 8px',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
        borderBottom: '1px solid #003080',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        minHeight: '26px',
    };

    const xpToolbar: React.CSSProperties = {
        background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)',
        borderBottom: '1px solid #b0a898',
        padding: '3px 6px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        flexWrap: 'wrap' as const,
    };

    const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
        fontFamily: 'Tahoma, Arial, sans-serif',
        fontSize: '11px',
        padding: '2px 10px',
        cursor: 'pointer',
        background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
        border: '1px solid',
        borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
        color: '#000000',
        borderRadius: 0,
        ...extra,
    });

    const xpInput: React.CSSProperties = {
        fontFamily: 'Tahoma, Arial, sans-serif',
        fontSize: '11px',
        border: '1px solid #7f9db9',
        boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)',
        padding: '1px 6px',
        background: '#ffffff',
        color: '#000000',
        height: '20px',
        outline: 'none',
    };

    const xpSep: React.CSSProperties = {
        width: '1px',
        height: '20px',
        background: '#a0988c',
        margin: '0 2px',
        flexShrink: 0,
    };

    const xpTableHeader: React.CSSProperties = {
        background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)',
        borderBottom: '2px solid #808080',
        fontSize: '10px',
        fontWeight: 'bold',
        color: '#000000',
    };

    const xpThCell: React.CSSProperties = {
        padding: '3px 6px',
        borderRight: '1px solid #b0aaa0',
        textAlign: 'left' as const,
        whiteSpace: 'nowrap' as const,
        fontFamily: 'Tahoma, Arial, sans-serif',
    };

    const tdBase: React.CSSProperties = {
        padding: '4px 6px',
        borderRight: '1px solid #c0bdb5',
        borderBottom: '1px solid #d0cdc8',
        verticalAlign: 'middle' as const,
        fontFamily: 'Tahoma, Arial, sans-serif',
        fontSize: '11px',
    };

    const filteredPartners = partners.filter(p =>
        p.type === type &&
        (p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
         (p.address || '').toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const allSelected = filteredPartners.length > 0 && selectedIds.size === filteredPartners.length;
    const someSelected = selectedIds.size > 0;

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (allSelected) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredPartners.map(p => p.id)));
        }
    };

    const confirmBulkDelete = () => {
        const ids = Array.from(selectedIds);
        if (onBulkDelete) {
            onBulkDelete(ids);
        } else {
            ids.forEach(id => onDelete(id));
        }
        setSelectedIds(new Set());
        setShowBulkDeleteConfirm(false);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newPartner.name) return;
        onCreate(newPartner);
        setNewPartner({ name: '', address: '', type, active: true });
        setIsCreateOpen(false);
    };

    const handleUpdateSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingPartner) return;
        onUpdate(editingPartner.id, {
            name: editingPartner.name,
            address: editingPartner.address,
            active: editingPartner.active
        });
        setEditingPartner(null);
    };

    const handleDelete = (p: Partner) => {
        setDeletingPartner(p);
    };

    const confirmDelete = () => {
        if (!deletingPartner) return;
        onDelete(deletingPartner.id);
        setDeletingPartner(null);
    };

    return (
        <div className="fade-in">
            {/* ── Outer shell ── */}
            <div
                style={classic ? xpBevel : undefined}
                className={classic ? '' : 'card border-0 shadow-sm'}
            >
                {/* ── Title bar ── */}
                {classic ? (
                    <div style={xpTitleBar}>
                        <span>
                            <i className="bi bi-people-fill" style={{ marginRight: 6 }}></i>
                            {typeLabel} Management
                        </span>
                        <button
                            style={xpBtn({ background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', fontWeight: 'bold' })}
                            onClick={() => setIsCreateOpen(true)}
                        >
                            <i className="bi bi-plus-lg" style={{ marginRight: 4 }}></i>Add {typeLabel}
                        </button>
                    </div>
                ) : (
                    <div className="card-header bg-white d-flex justify-content-between align-items-center">
                        <div>
                            <h5 className="card-title mb-0">
                                <i className="bi bi-people-fill me-2"></i>{typeLabel} Management
                            </h5>
                            <p className="text-muted small mb-0 mt-1">
                                Maintain your network of {typeLabel.toLowerCase()}s
                            </p>
                        </div>
                        <button className="btn btn-sm btn-primary" onClick={() => setIsCreateOpen(true)}>
                            <i className="bi bi-plus-lg me-2"></i>Add {typeLabel}
                        </button>
                    </div>
                )}

                {/* ── Secondary toolbar: search + count ── */}
                {classic ? (
                    <div style={xpToolbar}>
                        <input
                            style={{ ...xpInput, width: 200 }}
                            placeholder={`Search ${typeLabel.toLowerCase()}s…`}
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        <div style={xpSep}></div>
                        <span style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#333' }}>
                            {filteredPartners.length} {typeLabel}{filteredPartners.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                ) : (
                    <div className="px-3 py-2 border-bottom d-flex align-items-center gap-3 bg-white">
                        <div className="position-relative" style={{ flex: '1 1 200px', maxWidth: 280 }}>
                            <i className="bi bi-search position-absolute" style={{ left: 7, top: '50%', transform: 'translateY(-50%)', fontSize: 11, opacity: 0.5 }}></i>
                            <input
                                className="form-control form-control-sm"
                                style={{ paddingLeft: 24 }}
                                placeholder={`Search ${typeLabel.toLowerCase()}s…`}
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <span className="text-muted small">
                            {filteredPartners.length} {typeLabel}{filteredPartners.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                )}

                {/* ── Bulk action bar ── */}
                {someSelected && (
                    classic ? (
                        <div style={{ ...xpToolbar, background: '#fff8e1', borderBottom: '1px solid #e0c060' }}>
                            <span style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#665500', fontWeight: 'bold' }}>
                                {selectedIds.size} selected
                            </span>
                            <div style={xpSep}></div>
                            <button
                                style={xpBtn({ background: 'linear-gradient(to bottom, #c84040, #8e0000)', borderColor: '#8e0000 #5e0000 #5e0000 #8e0000', color: '#ffffff', fontWeight: 'bold' })}
                                onClick={() => setShowBulkDeleteConfirm(true)}
                            >
                                <i className="bi bi-trash" style={{ marginRight: 4 }}></i>Delete Selected
                            </button>
                            <button
                                style={xpBtn()}
                                onClick={() => setSelectedIds(new Set())}
                            >Clear</button>
                        </div>
                    ) : (
                        <div className="px-3 py-2 border-bottom d-flex align-items-center gap-3" style={{ background: '#fff8e1' }}>
                            <span className="small fw-bold" style={{ color: '#665500' }}>{selectedIds.size} selected</span>
                            <button className="btn btn-sm btn-danger" onClick={() => setShowBulkDeleteConfirm(true)}>
                                <i className="bi bi-trash me-1"></i>Delete Selected
                            </button>
                            <button className="btn btn-sm btn-link text-muted p-0" onClick={() => setSelectedIds(new Set())}>Clear</button>
                        </div>
                    )
                )}

                {/* ── Table ── */}
                <div
                    className={classic ? '' : 'card-body p-0'}
                    style={classic ? { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' } : undefined}
                >
                    <div className="table-responsive">
                        <table
                            className={classic ? '' : 'table table-hover align-middle mb-0'}
                            style={classic ? { width: '100%', borderCollapse: 'collapse', background: '#fff' } : undefined}
                        >
                            <thead style={classic ? xpTableHeader : undefined} className={classic ? '' : 'table-light'}>
                                <tr>
                                    <th style={classic ? { ...xpThCell, width: '28px', textAlign: 'center' as const } : undefined} className={classic ? '' : 'ps-3'}>
                                        <input
                                            type="checkbox"
                                            checked={allSelected}
                                            ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                                            onChange={toggleSelectAll}
                                            title="Select all"
                                            style={classic ? { cursor: 'pointer' } : undefined}
                                        />
                                    </th>
                                    <th style={classic ? { ...xpThCell, width: '30%' } : undefined} className={classic ? '' : 'ps-2'}>Name</th>
                                    <th style={classic ? xpThCell : undefined}>Address</th>
                                    <th style={classic ? { ...xpThCell, width: '80px' } : undefined}>Status</th>
                                    <th style={classic ? { ...xpThCell, textAlign: 'right' as const, borderRight: 'none', width: '80px' } : undefined} className={classic ? '' : 'text-end pe-4'}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPartners.map((p, rowIndex) => (
                                    <tr
                                        key={p.id}
                                        style={classic ? { background: selectedIds.has(p.id) ? '#e8f0f8' : rowIndex % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' } : undefined}
                                        className={classic ? '' : selectedIds.has(p.id) ? 'table-active' : ''}
                                    >
                                        <td style={classic ? { ...tdBase, textAlign: 'center' as const } : undefined} className={classic ? '' : 'ps-3'}>
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(p.id)}
                                                onChange={() => toggleSelect(p.id)}
                                                style={classic ? { cursor: 'pointer' } : undefined}
                                            />
                                        </td>
                                        <td style={classic ? { ...tdBase, fontWeight: 'bold' } : undefined} className={classic ? '' : 'ps-2 fw-bold'}>
                                            {p.name}
                                        </td>
                                        <td style={classic ? { ...tdBase, color: '#555' } : undefined} className={classic ? '' : 'text-muted small'}>
                                            {p.address || <span style={classic ? { color: '#aaa' } : undefined} className={classic ? '' : 'fst-italic'}>—</span>}
                                        </td>
                                        <td style={tdBase}>
                                            {classic ? (
                                                <span style={{
                                                    background: p.active ? '#e8f5e9' : '#e8e8e8',
                                                    border: `1px solid ${p.active ? '#2e7d32' : '#6a6a6a'}`,
                                                    color: p.active ? '#1b4620' : '#444',
                                                    padding: '1px 5px',
                                                    fontSize: '9px',
                                                    fontFamily: 'Tahoma, Arial, sans-serif',
                                                    fontWeight: 'bold',
                                                    whiteSpace: 'nowrap' as const,
                                                }}>
                                                    {p.active ? 'Active' : 'Inactive'}
                                                </span>
                                            ) : (
                                                <span className={`badge ${p.active ? 'bg-success' : 'bg-secondary'}`}>
                                                    {p.active ? 'Active' : 'Inactive'}
                                                </span>
                                            )}
                                        </td>
                                        <td style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'right' as const } : undefined} className={classic ? '' : 'text-end pe-4'}>
                                            {classic ? (
                                                <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                                                    <button
                                                        title="Edit"
                                                        onClick={() => setEditingPartner(p)}
                                                        style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: 'pointer', padding: '1px 4px', color: '#555', fontSize: '11px' }}
                                                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#7f9db9'; (e.currentTarget as HTMLButtonElement).style.background = '#e8f0f8'; }}
                                                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                                    >
                                                        <i className="bi bi-pencil-square"></i>
                                                    </button>
                                                    <button
                                                        title="Delete"
                                                        onClick={() => handleDelete(p)}
                                                        style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: 'pointer', padding: '1px 4px', color: '#aa0000', fontSize: '11px' }}
                                                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#cc4444'; (e.currentTarget as HTMLButtonElement).style.background = '#fff0f0'; }}
                                                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                                    >
                                                        <i className="bi bi-trash"></i>
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <button className="btn btn-sm btn-link text-primary p-0 me-2" title="Edit" onClick={() => setEditingPartner(p)}>
                                                        <i className="bi bi-pencil-square"></i>
                                                    </button>
                                                    <button className="btn btn-sm btn-link text-danger p-0" title="Delete" onClick={() => handleDelete(p)}>
                                                        <i className="bi bi-trash"></i>
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {filteredPartners.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={5}
                                            style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'center', padding: '24px 8px', color: '#888', fontStyle: 'italic' } : undefined}
                                            className={classic ? '' : 'text-center py-5 text-muted'}
                                        >
                                            {searchTerm
                                                ? `No ${typeLabel.toLowerCase()}s match "${searchTerm}"`
                                                : `No ${typeLabel.toLowerCase()}s found. Add one to get started.`}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ── Status bar ── */}
                {classic && (
                    <div style={{
                        background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)',
                        borderTop: '1px solid #b0a898',
                        padding: '2px 8px',
                        display: 'flex',
                        gap: '12px',
                        fontFamily: 'Tahoma, Arial, sans-serif',
                        fontSize: '10px',
                        color: '#333',
                    }}>
                        <span>{partners.filter(p => p.type === type).length} total</span>
                        <span>|</span>
                        <span>{partners.filter(p => p.type === type && p.active).length} active</span>
                    </div>
                )}
            </div>

            {/* Create Modal */}
            <ModalWrapper
                isOpen={isCreateOpen}
                onClose={() => setIsCreateOpen(false)}
                title={<><i className="bi bi-plus-circle me-1"></i> Add New {typeLabel}</>}
                variant="primary"
                footer={
                    <>
                        <button
                            type="button"
                            style={classic ? xpBtn() : undefined}
                            className={classic ? '' : 'btn btn-sm btn-link text-muted'}
                            onClick={() => setIsCreateOpen(false)}
                        >Cancel</button>
                        <button
                            type="button"
                            style={classic ? xpBtn({ background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)', borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a', color: '#ffffff', fontWeight: 'bold' }) : undefined}
                            className={classic ? '' : 'btn btn-sm btn-primary px-4 fw-bold'}
                            onClick={handleSubmit}
                        >CREATE {typeLabel.toUpperCase()}</button>
                    </>
                }
            >
                <div className="mb-3">
                    <label
                        style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 } : undefined}
                        className={classic ? '' : 'form-label small fw-bold'}
                    >Name</label>
                    <input
                        style={classic ? xpInput : undefined}
                        className={classic ? '' : 'form-control'}
                        value={newPartner.name}
                        onChange={e => setNewPartner({...newPartner, name: e.target.value})}
                        required
                        placeholder={`Enter ${typeLabel.toLowerCase()} name…`}
                        autoFocus
                    />
                </div>
                <div className="mb-3">
                    <label
                        style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 } : undefined}
                        className={classic ? '' : 'form-label small fw-bold'}
                    >Address <span style={classic ? { fontWeight: 'normal', color: '#666' } : undefined} className={classic ? '' : 'fw-normal text-muted'}>(Optional)</span></label>
                    <textarea
                        style={classic ? { ...xpInput, height: 'auto', padding: '4px 6px', width: '100%', resize: 'vertical' as const } : undefined}
                        className={classic ? '' : 'form-control'}
                        rows={3}
                        value={newPartner.address}
                        onChange={e => setNewPartner({...newPartner, address: e.target.value})}
                        placeholder="Street, City, Zip Code…"
                    ></textarea>
                </div>
            </ModalWrapper>

            {/* Delete Confirmation Modal */}
            <ModalWrapper
                isOpen={!!deletingPartner}
                onClose={() => setDeletingPartner(null)}
                title={<><i className="bi bi-trash me-1"></i> Delete {typeLabel}</>}
                variant="danger"
                size="sm"
                footer={
                    <>
                        <button
                            type="button"
                            style={classic ? xpBtn() : undefined}
                            className={classic ? '' : 'btn btn-sm btn-link text-muted'}
                            onClick={() => setDeletingPartner(null)}
                        >Cancel</button>
                        <button
                            type="button"
                            style={classic ? xpBtn({ background: 'linear-gradient(to bottom, #c84040, #8e0000)', borderColor: '#8e0000 #5e0000 #5e0000 #8e0000', color: '#ffffff', fontWeight: 'bold' }) : undefined}
                            className={classic ? '' : 'btn btn-sm btn-danger px-4 fw-bold'}
                            onClick={confirmDelete}
                        >DELETE</button>
                    </>
                }
            >
                <p style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', margin: 0 } : undefined} className={classic ? '' : 'mb-0'}>
                    Delete <strong>{deletingPartner?.name}</strong>? This action cannot be undone.
                </p>
            </ModalWrapper>

            {/* Bulk Delete Confirmation Modal */}
            <ModalWrapper
                isOpen={showBulkDeleteConfirm}
                onClose={() => setShowBulkDeleteConfirm(false)}
                title={<><i className="bi bi-trash me-1"></i> Delete {selectedIds.size} {typeLabel}{selectedIds.size !== 1 ? 's' : ''}</>}
                variant="danger"
                size="sm"
                footer={
                    <>
                        <button
                            type="button"
                            style={classic ? xpBtn() : undefined}
                            className={classic ? '' : 'btn btn-sm btn-link text-muted'}
                            onClick={() => setShowBulkDeleteConfirm(false)}
                        >Cancel</button>
                        <button
                            type="button"
                            style={classic ? xpBtn({ background: 'linear-gradient(to bottom, #c84040, #8e0000)', borderColor: '#8e0000 #5e0000 #5e0000 #8e0000', color: '#ffffff', fontWeight: 'bold' }) : undefined}
                            className={classic ? '' : 'btn btn-sm btn-danger px-4 fw-bold'}
                            onClick={confirmBulkDelete}
                        >DELETE ALL</button>
                    </>
                }
            >
                <p style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', margin: 0 } : undefined} className={classic ? '' : 'mb-0'}>
                    Delete <strong>{selectedIds.size} {typeLabel.toLowerCase()}{selectedIds.size !== 1 ? 's' : ''}</strong>? This action cannot be undone.
                </p>
            </ModalWrapper>

            {/* Edit Modal */}
            <ModalWrapper
                isOpen={!!editingPartner}
                onClose={() => setEditingPartner(null)}
                title={<><i className="bi bi-pencil-square me-1"></i> Edit {typeLabel}</>}
                variant="info"
                footer={
                    <>
                        <button
                            type="button"
                            style={classic ? xpBtn() : undefined}
                            className={classic ? '' : 'btn btn-sm btn-link text-muted'}
                            onClick={() => setEditingPartner(null)}
                        >Cancel</button>
                        <button
                            type="button"
                            style={classic ? xpBtn({ background: 'linear-gradient(to bottom, #006e8e, #004a5e)', borderColor: '#004a5e #001a2e #001a2e #004a5e', color: '#ffffff', fontWeight: 'bold' }) : undefined}
                            className={classic ? '' : 'btn btn-sm btn-info text-white px-4 fw-bold'}
                            onClick={handleUpdateSubmit}
                        >SAVE CHANGES</button>
                    </>
                }
            >
                {editingPartner && (
                    <>
                        <div className="mb-3">
                            <label
                                style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 } : undefined}
                                className={classic ? '' : 'form-label small fw-bold'}
                            >Name</label>
                            <input
                                style={classic ? xpInput : undefined}
                                className={classic ? '' : 'form-control'}
                                value={editingPartner.name}
                                onChange={e => setEditingPartner({...editingPartner, name: e.target.value})}
                                required
                            />
                        </div>
                        <div className="mb-3">
                            <label
                                style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 } : undefined}
                                className={classic ? '' : 'form-label small fw-bold'}
                            >Address <span style={classic ? { fontWeight: 'normal', color: '#666' } : undefined} className={classic ? '' : 'fw-normal text-muted'}>(Optional)</span></label>
                            <textarea
                                style={classic ? { ...xpInput, height: 'auto', padding: '4px 6px', width: '100%', resize: 'vertical' as const } : undefined}
                                className={classic ? '' : 'form-control'}
                                rows={3}
                                value={editingPartner.address || ''}
                                onChange={e => setEditingPartner({...editingPartner, address: e.target.value})}
                            ></textarea>
                        </div>
                        <div style={classic ? { marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 } : undefined} className={classic ? '' : 'form-check mt-3'}>
                            <input
                                style={classic ? { cursor: 'pointer' } : undefined}
                                className={classic ? '' : 'form-check-input'}
                                type="checkbox"
                                id="activeCheck"
                                checked={editingPartner.active}
                                onChange={e => setEditingPartner({...editingPartner, active: e.target.checked})}
                            />
                            <label
                                style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', cursor: 'pointer' } : undefined}
                                className={classic ? '' : 'form-check-label small fw-bold'}
                                htmlFor="activeCheck"
                            >Active {typeLabel}</label>
                        </div>
                    </>
                )}
            </ModalWrapper>
        </div>
    );
}
