'use client';

import { useState, useRef } from 'react';
import { useToast } from '../shared/Toast';
import { useLanguage } from '../../context/LanguageContext';
import ModalWrapper from '../shared/ModalWrapper';
import Pager from '../shared/Pager';
import { useUser } from '../../context/UserContext';
import { StatusChip, useFloatingMenu, MenuTriggerButton, FloatingMenu, xpFont, TableSkeleton, useTableSkeletonMetrics, rowStateBg, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { useData } from '../../context/DataContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import { lvBtn, lvInput, lvTh, lvTd, lvLabel, lvThead, LV_STICKY_THEAD, useRowSelection, RowCheckbox, SelectAllCheckbox, lvZebra } from '../shared/listViewTheme';
import { ShellWindow, ShellTitleBar, xpToolbar, SearchField, ToolbarCount, ToolbarButton } from '../shared/shellTheme';

const PARTNERS_PAGE_SIZE = 20;

const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
const API_BASE = envBase.replace(/\/api$/, '') + '/api';

interface Partner {
    id: string;
    name: string;
    address?: string;
    contact_person?: string;
    phone?: string;
    fax?: string;
    email?: string;
    type: string;
    active: boolean;
}

interface PartnersViewProps {
    /**
     * Deliberately unused for the table: the list is server-paginated (see
     * `usePaginatedFetch` below), so DataContext's shared `partners` array — which
     * is now the unwindowed /partners/lookup index for dropdowns and name
     * resolution — must not be sliced here. Kept optional so existing callers that
     * still pass it keep compiling.
     */
    partners?: Partner[];
    type: 'CUSTOMER' | 'SUPPLIER';
    onCreate: (partner: any) => void;
    onUpdate: (id: string, partner: any) => void;
    onDelete: (id: string) => void;
    onBulkDelete?: (ids: string[]) => void;
}

export default function PartnersView({ type, onCreate, onUpdate, onDelete, onBulkDelete }: PartnersViewProps) {
    const { showToast } = useToast();
    const { t } = useLanguage();
    const { authFetch } = useData();
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
    const [newPartner, setNewPartner] = useState({ name: '', address: '', contact_person: '', phone: '', fax: '', email: '', type, active: true });
    const [deletingPartner, setDeletingPartner] = useState<Partner | null>(null);
    const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
    const { openId: menuOpenId, pos: menuPos, toggle: menuToggle, close: menuClose } = useFloatingMenu(140);

    // Server-paginated + server-filtered: `rows` is ONE page of this partner type,
    // never the whole directory. Search (name OR address) and the `type` scope are
    // applied by the backend; the hook resets to page 1 whenever either changes.
    const {
        rows: pagedPartners, total, meta, loading,
        page, setPage, search: searchTerm, searchInput, setSearch, refetch,
    } = usePaginatedFetch<Partner>({
        endpoint: `${API_BASE}/partners`,
        authFetch,
        pageSize: PARTNERS_PAGE_SIZE,
        params: { type },
        onError: m => showToast(m, 'danger'),
    });

    /** Reload the current page after a mutation the parent performed. */
    const afterMutation = async (result: any) => {
        await Promise.resolve(result);
        refetch();
    };

    const typeLabel = type === 'CUSTOMER' ? 'Customer' : 'Supplier';
    const { hasPermission, hasAnyPermission } = useUser();
    const canManage = type === 'CUSTOMER'
        ? hasAnyPermission('customer.create', 'customer.edit', 'customer.delete')
        : hasAnyPermission('supplier.create', 'supplier.edit', 'supplier.delete');

    // Button/input/cell/label chrome sourced from the shared lv* helpers instead
    // of re-declaring the same CSS values locally.
    const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => lvBtn(true, 'default', extra);
    const xpInput: React.CSSProperties = lvInput(true);
    const xpSep: React.CSSProperties = {
        width: '1px',
        height: '20px',
        background: '#a0988c',
        margin: '0 2px',
        flexShrink: 0,
    };
    const xpThCell: React.CSSProperties = lvTh(true);
    const xpTableHeader: React.CSSProperties = lvThead(true, true);
    const tdBase: React.CSSProperties = lvTd(true);
    const xpLabel: React.CSSProperties = lvLabel(true);

    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('partners', listBodyRef, pagedPartners.length > 0);

    // Page-scoped: only the loaded rows exist client-side now.
    const sel = useRowSelection<any>(pagedPartners, (p: any) => p.id);

    const confirmBulkDelete = () => {
        const ids = sel.keys;
        if (onBulkDelete) {
            afterMutation(onBulkDelete(ids));
        } else {
            afterMutation(Promise.all(ids.map(id => onDelete(id))));
        }
        sel.clear();
        setShowBulkDeleteConfirm(false);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newPartner.name) return;
        afterMutation(onCreate(newPartner));
        setNewPartner({ name: '', address: '', contact_person: '', phone: '', fax: '', email: '', type, active: true });
        setIsCreateOpen(false);
    };

    const handleUpdateSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingPartner) return;
        afterMutation(onUpdate(editingPartner.id, {
            name: editingPartner.name,
            address: editingPartner.address,
            contact_person: editingPartner.contact_person,
            phone: editingPartner.phone,
            fax: editingPartner.fax,
            email: editingPartner.email,
            active: editingPartner.active
        }));
        setEditingPartner(null);
    };

    const handleDelete = (p: Partner) => {
        setDeletingPartner(p);
    };

    const confirmDelete = () => {
        if (!deletingPartner) return;
        afterMutation(onDelete(deletingPartner.id));
        setDeletingPartner(null);
    };

    return (
        <ShellWindow classic fill="page" className="fade-in">
            <ShellTitleBar
                classic
                icon="bi-people-fill"
                title={`${typeLabel} Management`}
                subtitle={`Maintain your network of ${typeLabel.toLowerCase()}s`}
            />

                {/* ── Secondary toolbar: search + count + actions ── */}
                <div
                    style={xpToolbar()}
                >
                    {/* `searchInput` is the live echo; the hook debounces the committed
                        value it actually sends as `?search=`. No local timer here. */}
                    <SearchField
                        classic
                        value={searchInput}
                        onChange={setSearch}
                        placeholder={`Search ${typeLabel.toLowerCase()}s…`}
                        width={280}
                        grow
                    />
                    {<div style={xpSep}></div>}
                    <ToolbarCount classic>
                        {total} {typeLabel}{total !== 1 ? 's' : ''}
                    </ToolbarCount>
                    {canManage && (
                        <ToolbarButton classic tone="create" icon="bi-plus-lg" style={{ marginLeft: 'auto' }} onClick={() => setIsCreateOpen(true)}>
                            Add {typeLabel}
                        </ToolbarButton>
                    )}
                </div>

                {/* ── Bulk action bar ── */}
                {canManage && sel.count > 0 && (
                    <div style={xpToolbar({ background: '#fff8e1', borderBottom: '1px solid #e0c060' })}>
                            <span style={{ fontFamily: xpFont, fontSize: '11px', color: '#665500', fontWeight: 'bold' }}>
                                {sel.count} selected
                            </span>
                            <div style={xpSep}></div>
                            <button
                                className={XP_BTN}
                                style={xpBtn({ ...BTN_TONES.danger })}
                                onClick={() => setShowBulkDeleteConfirm(true)}
                            >
                                <i className="bi bi-trash" style={{ marginRight: 4 }}></i>Delete Selected
                            </button>
                            <button
                                className={XP_BTN}
                                style={xpBtn()}
                                onClick={sel.clear}
                            >Clear</button>
                        </div>)}

                {/* ── Table ── */}
                <div
                    style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
                >
                    <div className="table-responsive" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                        <table
                            style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}
                        >
                            <thead style={xpTableHeader}>
                                <tr>
                                    <th style={{ ...xpThCell, width: '28px', textAlign: 'center' as const }}>
                                        <SelectAllCheckbox classic allSelected={sel.allPageSelected} someSelected={sel.someSelected} onChange={sel.togglePage} title="Select all" />
                                    </th>
                                    <th style={{ ...xpThCell, width: '30%' }}>Name</th>
                                    <th style={xpThCell}>Address</th>
                                    <th style={{ ...xpThCell, width: '80px' }}>Status</th>
                                    <th style={{ ...xpThCell, textAlign: 'right' as const, borderRight: 'none', width: '80px' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody ref={listBodyRef}>
                                {pagedPartners.map((p, rowIndex) => (
                                    <tr
                                        key={p.id}
                                        style={{ background: sel.isSelected(p) ? rowStateBg('selected', true) : lvZebra(true, rowIndex), borderBottom: '1px solid #c0bdb5' }}
                                    >
                                        <td style={{ ...tdBase, textAlign: 'center' as const }}>
                                            <RowCheckbox classic checked={sel.isSelected(p)} onChange={() => sel.toggle(p)} label={p.name} />
                                        </td>
                                        <td style={{ ...tdBase, fontWeight: 'bold' }}>
                                            {p.name}
                                        </td>
                                        <td style={{ ...tdBase, color: '#555' }}>
                                            {p.address || <span style={{ color: '#aaa' }}>—</span>}
                                        </td>
                                        <td style={tdBase}>
                                            <StatusChip status={p.active ? 'ACTIVE' : 'INACTIVE'} />
                                        </td>
                                        <td style={{ ...tdBase, borderRight: 'none', textAlign: 'right' as const }}>
                                            {canManage && <MenuTriggerButton classic onClick={e => menuToggle(p.id, e)} />}
                                        </td>
                                    </tr>
                                ))}
                                {pagedPartners.length === 0 && (loading ? (
                                    <TableSkeleton rows={8} cols={skel.cols ?? 5} classic tdStyle={tdBase} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                                ) : (
                                    <tr>
                                        <td
                                            colSpan={5}
                                            style={{ ...tdBase, borderRight: 'none', textAlign: 'center', padding: '24px 8px', color: '#888', fontStyle: 'italic' }}
                                        >
                                            {searchTerm
                                                ? `No ${typeLabel.toLowerCase()}s match "${searchTerm}"`
                                                : `No ${typeLabel.toLowerCase()}s found. Add one to get started.`}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <Pager page={page} total={total} pageSize={PARTNERS_PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />

                {/* ── Status bar ── */}
                {(
                    <div style={{
                        background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)',
                        borderTop: '1px solid #b0a898',
                        padding: '2px 8px',
                        display: 'flex',
                        gap: '12px',
                        fontFamily: xpFont,
                        fontSize: '10px',
                        color: '#333',
                    }}>
                        {/* Whole-directory counts from the server (`type_total`/`type_active`,
                            scoped by type only), NOT the loaded page or the search result. */}
                        <span>{meta.type_total ?? total} total</span>
                        <span>|</span>
                        <span>{meta.type_active ?? 0} active</span>
                    </div>
                )}

            {/* Row ⋯ menu: Edit / Delete */}
            {menuOpenId && (() => {
                const p = pagedPartners.find(x => String(x.id) === menuOpenId);
                if (!p || !canManage) return null;
                return (
                    <FloatingMenu
                        pos={menuPos}
                        items={[
                            { key: 'edit', label: 'Edit', icon: 'bi-pencil-square', onClick: () => { menuClose(); setEditingPartner(p); } },
                            { key: 'delete', label: 'Delete', icon: 'bi-trash', danger: true, onClick: () => { menuClose(); handleDelete(p); } },
                        ]}
                    />
                );
            })()}

            {/* Create Modal */}
            <ModalWrapper
                isOpen={isCreateOpen}
                modeless
                onClose={() => setIsCreateOpen(false)}
                title={<><i className="bi bi-plus-circle me-1"></i> Add New {typeLabel}</>}
                variant="primary"
                footer={
                    <>
                        <button
                            type="button"
                            style={xpBtn()}
                            className={XP_BTN}
                            onClick={() => setIsCreateOpen(false)}
                        >Cancel</button>
                        <button
                            type="button"
                            style={xpBtn({ ...BTN_TONES.primary })}
                            className={XP_BTN}
                            onClick={handleSubmit}
                        >CREATE {typeLabel.toUpperCase()}</button>
                    </>
                }
            >
                <div className="mb-3">
                    <label
                        style={xpLabel}
                    >Name</label>
                    <input
                        style={xpInput}
                        value={newPartner.name}
                        onChange={e => setNewPartner({...newPartner, name: e.target.value})}
                        required
                        placeholder={`Enter ${typeLabel.toLowerCase()} name…`}
                        autoFocus
                    />
                </div>
                <div className="mb-3">
                    <label
                        style={xpLabel}
                    >Address <span style={{ fontWeight: 'normal', color: '#666' }}>(Optional)</span></label>
                    <textarea
                        style={{ ...xpInput, height: 'auto', padding: '4px 6px', width: '100%', resize: 'vertical' as const }}
                        rows={3}
                        value={newPartner.address}
                        onChange={e => setNewPartner({...newPartner, address: e.target.value})}
                        placeholder="Street, City, Zip Code…"
                    ></textarea>
                </div>
                <div className="mb-3">
                    <label style={xpLabel}>Contact Person <span style={{ fontWeight: 'normal', color: '#666' }}>(Attn)</span></label>
                    <input style={xpInput} value={newPartner.contact_person} onChange={e => setNewPartner({...newPartner, contact_person: e.target.value})} placeholder="e.g. Pak Nicolas" />
                </div>
                <div className="row g-2 mb-3">
                    <div className="col-6">
                        <label style={xpLabel}>Phone / Telp</label>
                        <input style={xpInput} value={newPartner.phone} onChange={e => setNewPartner({...newPartner, phone: e.target.value})} placeholder="e.g. 021 5869948" />
                    </div>
                    <div className="col-6">
                        <label style={xpLabel}>Fax</label>
                        <input style={xpInput} value={newPartner.fax} onChange={e => setNewPartner({...newPartner, fax: e.target.value})} placeholder="e.g. 021 5868012" />
                    </div>
                </div>
                <div className="mb-3">
                    <label style={xpLabel}>Email</label>
                    <input style={xpInput} value={newPartner.email} onChange={e => setNewPartner({...newPartner, email: e.target.value})} placeholder="e.g. sales@supplier.com" />
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
                            style={xpBtn()}
                            className={XP_BTN}
                            onClick={() => setDeletingPartner(null)}
                        >Cancel</button>
                        <button
                            type="button"
                            style={xpBtn({ ...BTN_TONES.danger })}
                            className={XP_BTN}
                            onClick={confirmDelete}
                        >DELETE</button>
                    </>
                }
            >
                <p style={{ fontFamily: xpFont, fontSize: '11px', margin: 0 }}>
                    Delete <strong>{deletingPartner?.name}</strong>? This action cannot be undone.
                </p>
            </ModalWrapper>

            {/* Bulk Delete Confirmation Modal */}
            <ModalWrapper
                isOpen={showBulkDeleteConfirm}
                onClose={() => setShowBulkDeleteConfirm(false)}
                title={<><i className="bi bi-trash me-1"></i> Delete {sel.count} {typeLabel}{sel.count !== 1 ? 's' : ''}</>}
                variant="danger"
                size="sm"
                footer={
                    <>
                        <button
                            type="button"
                            style={xpBtn()}
                            className={XP_BTN}
                            onClick={() => setShowBulkDeleteConfirm(false)}
                        >Cancel</button>
                        <button
                            type="button"
                            style={xpBtn({ ...BTN_TONES.danger })}
                            className={XP_BTN}
                            onClick={confirmBulkDelete}
                        >DELETE ALL</button>
                    </>
                }
            >
                <p style={{ fontFamily: xpFont, fontSize: '11px', margin: 0 }}>
                    Delete <strong>{sel.count} {typeLabel.toLowerCase()}{sel.count !== 1 ? 's' : ''}</strong>? This action cannot be undone.
                </p>
            </ModalWrapper>

            {/* Edit Modal */}
            <ModalWrapper
                isOpen={!!editingPartner}
                modeless
                onClose={() => setEditingPartner(null)}
                title={<><i className="bi bi-pencil-square me-1"></i> Edit {typeLabel}</>}
                variant="info"
                footer={
                    <>
                        <button
                            type="button"
                            style={xpBtn()}
                            className={XP_BTN}
                            onClick={() => setEditingPartner(null)}
                        >Cancel</button>
                        <button
                            type="button"
                            style={xpBtn({ background: 'linear-gradient(to bottom, #006e8e, #004a5e)', borderColor: '#004a5e #001a2e #001a2e #004a5e', color: '#ffffff', fontWeight: 'bold' })}
                            className={XP_BTN}
                            onClick={handleUpdateSubmit}
                        >SAVE CHANGES</button>
                    </>
                }
            >
                {editingPartner && (
                    <>
                        <div className="mb-3">
                            <label
                                style={xpLabel}
                            >Name</label>
                            <input
                                style={xpInput}
                                value={editingPartner.name}
                                onChange={e => setEditingPartner({...editingPartner, name: e.target.value})}
                                required
                            />
                        </div>
                        <div className="mb-3">
                            <label
                                style={xpLabel}
                            >Address <span style={{ fontWeight: 'normal', color: '#666' }}>(Optional)</span></label>
                            <textarea
                                style={{ ...xpInput, height: 'auto', padding: '4px 6px', width: '100%', resize: 'vertical' as const }}
                                rows={3}
                                value={editingPartner.address || ''}
                                onChange={e => setEditingPartner({...editingPartner, address: e.target.value})}
                            ></textarea>
                        </div>
                        <div className="mb-3">
                            <label style={xpLabel}>Contact Person <span style={{ fontWeight: 'normal', color: '#666' }}>(Attn)</span></label>
                            <input style={xpInput} value={editingPartner.contact_person || ''} onChange={e => setEditingPartner({...editingPartner, contact_person: e.target.value})} placeholder="e.g. Pak Nicolas" />
                        </div>
                        <div className="row g-2 mb-3">
                            <div className="col-6">
                                <label style={xpLabel}>Phone / Telp</label>
                                <input style={xpInput} value={editingPartner.phone || ''} onChange={e => setEditingPartner({...editingPartner, phone: e.target.value})} placeholder="e.g. 021 5869948" />
                            </div>
                            <div className="col-6">
                                <label style={xpLabel}>Fax</label>
                                <input style={xpInput} value={editingPartner.fax || ''} onChange={e => setEditingPartner({...editingPartner, fax: e.target.value})} placeholder="e.g. 021 5868012" />
                            </div>
                        </div>
                        <div className="mb-3">
                            <label style={xpLabel}>Email</label>
                            <input style={xpInput} value={editingPartner.email || ''} onChange={e => setEditingPartner({...editingPartner, email: e.target.value})} placeholder="e.g. sales@supplier.com" />
                        </div>
                        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                                style={{ cursor: 'pointer' }}
                                type="checkbox"
                                id="activeCheck"
                                checked={editingPartner.active}
                                onChange={e => setEditingPartner({...editingPartner, active: e.target.checked})}
                            />
                            <label
                                style={{ fontFamily: xpFont, fontSize: '11px', color: '#000', cursor: 'pointer' }}
                                htmlFor="activeCheck"
                            >Active {typeLabel}</label>
                        </div>
                    </>
                )}
            </ModalWrapper>
        </ShellWindow>
    );
}
