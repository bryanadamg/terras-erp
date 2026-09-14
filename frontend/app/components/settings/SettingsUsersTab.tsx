'use client';

import { Fragment, useMemo, useState, useEffect } from 'react';
import { useToast } from '../shared/Toast';
import { useTimezone } from '../../context/TimezoneContext';
import { useUser, User } from '../../context/UserContext';
import { useConfirm } from '../../context/ConfirmContext';
import { xpBtn, xpInput, CodeChip, xpFont, rowStateBg, StatusChip, CHIP_RADIUS, XP_BTN } from '../shared/xpTheme';
import { SearchField, ToolbarCount, FilterChipBar } from '../shared/shellTheme';
import { xpTableHeader, xpThCell, tdBase } from './settingsStyles';
import SettingsPanel from './SettingsPanel';
import PixelAvatar from '../shared/PixelAvatar';
import Pager from '../shared/Pager';
import UserFormModal, { UserFormPayload } from './UserFormModal';
import EffectivePermissions, { effectivePermissionList } from './EffectivePermissions';
import PermissionBreakdown from './PermissionBreakdown';
import { API_BASE } from '../shared/apiBase';
import { lvZebra } from '../shared/listViewTheme';

const USERS_PAGE_SIZE = 10;

type StatusFilter = 'all' | 'active' | 'inactive';

const USER_STATUS_FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
];

export default function SettingsUsersTab({
    roles, allPermissions, roleFilter, onClearRoleFilter,
}: {
    roles: any[];
    allPermissions: any[];
    /** Set when the roles panel above filtered this list to one role. */
    roleFilter: string | null;
    onClearRoleFilter: () => void;
}) {
    const { formatCustom: tzFmt } = useTimezone();
    const formatLastLogin = (value?: string | null): string => {
        if (!value) return 'Never';
        return tzFmt(value, { dateStyle: 'medium', timeStyle: 'short' } as Intl.DateTimeFormatOptions);
    };
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const { users, setCurrentUser, currentUser, refreshUsers } = useUser();

    const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
    const [formUser, setFormUser] = useState<User | undefined>(undefined);

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [page, setPage] = useState(1);
    /* Expansion is owned here (not in the cell) so the detail panel can render
       as a full-width row, matching the roles table. */
    const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
    const toggleExpanded = (id: string) => setExpandedUsers(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    useEffect(() => {
        refreshUsers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const filteredUsers = useMemo(() => {
        const term = search.trim().toLowerCase();
        return users.filter(u => {
            if (roleFilter && u.role?.id !== roleFilter) return false;
            if (statusFilter === 'active' && !u.is_active) return false;
            if (statusFilter === 'inactive' && u.is_active) return false;
            if (term && !u.username.toLowerCase().includes(term) && !u.full_name.toLowerCase().includes(term)) return false;
            return true;
        });
    }, [users, search, statusFilter, roleFilter]);

    const roleFilterName = roleFilter ? (roles.find(r => r.id === roleFilter)?.name || 'Unknown role') : null;

    const pageCount = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE));
    const clampedPage = Math.min(page, pageCount);
    const pagedUsers = filteredUsers.slice((clampedPage - 1) * USERS_PAGE_SIZE, clampedPage * USERS_PAGE_SIZE);

    useEffect(() => { setPage(1); }, [search, statusFilter, roleFilter]);

    const submitCreate = async (payload: UserFormPayload): Promise<{ ok: boolean; error?: string }> => {
        try {
            const res = await fetch(`${API_BASE}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('access_token')}` },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                showToast('User created successfully!', 'success');
                refreshUsers();
                return { ok: true };
            }
            const err = await res.json();
            return { ok: false, error: err.detail };
        } catch (e) {
            console.error(e);
            return { ok: false, error: 'Error creating user' };
        }
    };

    const submitEdit = async (userId: string, payload: UserFormPayload): Promise<{ ok: boolean; error?: string }> => {
        try {
            const res = await fetch(`${API_BASE}/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('access_token')}` },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                const updated = await res.json();
                showToast('User updated successfully!', 'success');
                if (currentUser?.id === userId) setCurrentUser(updated);
                refreshUsers();
                return { ok: true };
            }
            const err = await res.json();
            return { ok: false, error: err.detail };
        } catch (e) {
            console.error(e);
            return { ok: false, error: 'Error updating user' };
        }
    };

    const setUserActive = async (user: User, active: boolean) => {
        if (!active) {
            const ok = await confirm({
                title: 'Deactivate User',
                message: `Deactivate "${user.username}"? They will immediately lose access until reactivated.`,
                confirmText: 'Deactivate',
                variant: 'danger',
            });
            if (!ok) return;
        }
        try {
            const res = await fetch(`${API_BASE}/users/${user.id}/${active ? 'reactivate' : 'deactivate'}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
            });
            if (res.ok) {
                showToast(`User ${active ? 'reactivated' : 'deactivated'} successfully!`, 'success');
                refreshUsers();
            } else {
                const err = await res.json();
                showToast(`Failed: ${err.detail}`, 'danger');
            }
        } catch (e) {
            console.error(e);
            showToast('Error updating user status', 'danger');
        }
    };

    return (
        <SettingsPanel
            icon="bi-people-fill"
            title="Users"
            flush
            right={
                <button
                    type="button"
                    style={xpBtn({ padding: '1px 8px' })}
                    className={XP_BTN}
                    onClick={() => { setFormUser(undefined); setFormMode('create'); }}
                ><i className="bi bi-person-plus" style={{ marginRight: 4 }}></i>Add User</button>
            }
        >
            {/* Search + status filter toolbar */}
            {<div style={{
                    background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898',
                    padding: '3px 6px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const,
                }}>
                    <SearchField classic value={search} onChange={setSearch} placeholder="Search username or name…" width={200} />
                    <FilterChipBar
                        classic
                        options={USER_STATUS_FILTERS}
                        value={statusFilter}
                        onChange={v => setStatusFilter(v as StatusFilter)}
                    />
                    {roleFilterName && (
                        <button
                            onClick={onClearRoleFilter}
                            title="Clear role filter"
                            style={{
                                display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                                background: '#dde8f5', border: '1px solid #7f9db9', color: '#00006e',
                                padding: '1px 5px', fontSize: 10, fontFamily: xpFont, borderRadius: CHIP_RADIUS,
                            }}
                        >
                            Role: {roleFilterName}
                            <i className="bi bi-x-lg" style={{ fontSize: 8 }} />
                        </button>
                    )}
                    <ToolbarCount classic right>
                        {filteredUsers.length} of {users.length} user{users.length !== 1 ? 's' : ''}
                    </ToolbarCount>
                </div>}

            <div>
                <div className="table-responsive">
                    <table
                        style={{ width: '100%', borderCollapse: 'collapse' as const, background: '#fff' }}
                    >
                        <thead style={xpTableHeader}>
                            <tr>
                                <th style={{ ...xpThCell, width: 36 }} />
                                <th style={xpThCell}>Username</th>
                                <th style={xpThCell}>Full Name</th>
                                <th style={xpThCell}>Role</th>
                                <th style={xpThCell}>Permissions</th>
                                <th style={xpThCell}>Last Login</th>
                                <th style={xpThCell}>Status</th>
                                <th style={{ ...xpThCell, textAlign: 'right' as const, borderRight: 'none' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pagedUsers.map((user, rowIndex) => {
                                const isSelf = currentUser?.id === user.id;
                                const isExpanded = expandedUsers.has(user.id);
                                const detailPermissions = isExpanded
                                    ? effectivePermissionList(user.role?.permissions || [], user.permissions || [])
                                    : [];
                                return (
                                    <Fragment key={user.id}>
                                    <tr
                                        style={{ background: isExpanded ? rowStateBg('expanded', true) : lvZebra(rowIndex), borderBottom: isExpanded ? 'none' : '1px solid #c0bdb5', opacity: user.is_active ? 1 : 0.6 }}
                                    >
                                        <td style={{ ...tdBase, textAlign: 'center' as const }}>
                                            <div style={{ width: 28, height: 28, border: '1px solid', borderColor: '#fff #888 #888 #fff', background: '#e0dcd4', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <PixelAvatar avatarId={user.avatar_id} seed={user.username} template={user.role?.default_avatar_id} size={24} />
                                            </div>
                                        </td>
                                        <td style={tdBase}>
                                            <CodeChip code={user.username} classic />
                                            {isSelf && <span style={{ fontSize: 8, color: '#888', fontWeight: 'normal' }}> (you)</span>}
                                        </td>
                                        <td style={tdBase}>{user.full_name}</td>
                                        <td style={tdBase}>
                                            {<span style={{ borderRadius: CHIP_RADIUS, display: 'inline-block', width: 'fit-content', maxWidth: '100%', background: '#e8e8e8', border: '1px solid #6a6a6a', color: '#000', padding: '1px 5px', fontSize: '9px', fontFamily: xpFont, fontWeight: 'bold' }}>
                                                    {user.role?.name || '—'}
                                                </span>}
                                        </td>
                                        <td style={tdBase}>
                                            <EffectivePermissions
                                                rolePermissions={user.role?.permissions || []}
                                                directPermissions={user.permissions || []}
                                                expanded={isExpanded}
                                                onToggle={() => toggleExpanded(user.id)}
                                            />
                                        </td>
                                        <td style={{ ...tdBase, fontSize: 9, whiteSpace: 'nowrap' as const }}>
                                            {formatLastLogin(user.last_login_at)}
                                        </td>
                                        <td style={tdBase}>
                                            <StatusChip status={user.is_active ? 'ACTIVE' : 'INACTIVE'} tint />
                                        </td>
                                        <td style={{ ...tdBase, borderRight: 'none', textAlign: 'right' as const }}>
                                            {<>
                                                    <button
                                                        title="Edit"
                                                        onClick={() => { setFormUser(user); setFormMode('edit'); }}
                                                        style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: 'pointer', padding: '1px 4px', color: '#555', fontSize: '12px' }}
                                                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#7f9db9'; (e.currentTarget as HTMLButtonElement).style.background = '#e8f0f8'; }}
                                                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                                    ><i className="bi bi-pencil-square"></i></button>
                                                    {!isSelf && (
                                                        <button
                                                            title={user.is_active ? 'Deactivate' : 'Reactivate'}
                                                            onClick={() => setUserActive(user, !user.is_active)}
                                                            style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: 'pointer', padding: '1px 4px', color: user.is_active ? '#8e0000' : '#2d7a2d', fontSize: '12px' }}
                                                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#7f9db9'; (e.currentTarget as HTMLButtonElement).style.background = '#e8f0f8'; }}
                                                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                                        ><i className={`bi ${user.is_active ? 'bi-person-dash' : 'bi-person-check'}`}></i></button>
                                                    )}
                                                </>}
                                        </td>
                                    </tr>
                                    {isExpanded && detailPermissions.length > 0 && (
                                        <tr style={{ opacity: user.is_active ? 1 : 0.6 }}>
                                            <td colSpan={8} style={{ padding: 0, border: 'none' }}>
                                                <PermissionBreakdown permissions={detailPermissions} showDirect />
                                            </td>
                                        </tr>
                                    )}
                                    </Fragment>
                                );
                            })}
                            {filteredUsers.length === 0 && (
                                <tr>
                                    <td colSpan={8} style={{ ...tdBase, textAlign: 'center' as const, fontStyle: 'italic', color: '#888' }}>
                                        No users match this search/filter.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <Pager
                    page={clampedPage}
                    total={filteredUsers.length}
                    pageSize={USERS_PAGE_SIZE}
                    onPageChange={setPage}
                    leftContent={`${filteredUsers.length} of ${users.length} user${users.length !== 1 ? 's' : ''}`}
                />
            </div>

            <UserFormModal
                isOpen={formMode !== null}
                onClose={() => setFormMode(null)}
                mode={formMode || 'create'}
                user={formUser}
                roles={roles}
                allPermissions={allPermissions}
                onSubmit={(payload) => formMode === 'create' ? submitCreate(payload) : submitEdit(formUser!.id, payload)}
            />
        </SettingsPanel>
    );
}
