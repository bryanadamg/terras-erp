'use client';

import { useMemo, useState, useEffect } from 'react';
import { useToast } from '../shared/Toast';
import { useTimezone } from '../../context/TimezoneContext';
import { useUser, User } from '../../context/UserContext';
import { useConfirm } from '../../context/ConfirmContext';
import { xpBtn, xpFont, XP_BTN, StatusChip, XPEmptyState } from '../shared/xpTheme';
import { SearchField } from '../shared/shellTheme';
import { FilterChipBar } from '@bryanadamg/terras-ui/components/FilterChipBar';
import { DetailGrid, Detail } from '@bryanadamg/terras-ui/components/DetailGrid';
import SettingsPanel from './SettingsPanel';
import PixelAvatar from '../shared/PixelAvatar';
import UserFormModal, { UserFormPayload } from './UserFormModal';
import PermissionBreakdown from './PermissionBreakdown';
import ScopeBreakdown from './ScopeBreakdown';
import { useData } from '../../context/DataContext';
import { API_BASE } from '../shared/apiBase';
import {
    MasterDetail, ListRow, DetailSection, Callout, CoveragePills, Flag,
    sectionCoverage, isAdminPerms, relativeTime, effectivePermissionList,
} from './accessParts';

type StatusFilter = 'all' | 'active' | 'inactive' | 'attention';

/** Direct grants that add nothing beyond the role, and the ones that do. */
function directSplit(user: User) {
    const roleIds = new Set((user.role?.permissions || []).map(p => p.id));
    const direct = user.permissions || [];
    return {
        redundant: direct.filter(p => roleIds.has(p.id)),
        extra: direct.filter(p => !roleIds.has(p.id)),
    };
}

// Enough one-off grants that the user is really on a role nobody wrote down.
const MANY_DIRECT = 10;

/** The one thing worth flagging on a user's list row, if anything. */
function attention(user: User): { tone: 'amber' | 'gray'; icon: string; label: string } | null {
    if (!user.is_active) return null;
    if (!user.role) return { tone: 'amber', icon: 'bi-exclamation-triangle-fill', label: 'No role' };
    const { extra } = directSplit(user);
    if (extra.length >= MANY_DIRECT) return { tone: 'amber', icon: 'bi-shuffle', label: `+${extra.length} direct` };
    if (!user.last_login_at) return { tone: 'gray', icon: 'bi-moon', label: 'Never logged in' };
    return null;
}

export default function SettingsUsersTab({
    roles, allPermissions, selectedId, onSelect, onOpenRole, onCreateRoleFrom,
}: {
    roles: any[];
    allPermissions: any[];
    selectedId: string | null;
    onSelect: (userId: string) => void;
    onOpenRole: (roleId: string) => void;
    /** Opens the new-role form prefilled with this user's effective permissions. */
    onCreateRoleFrom: (user: User) => void;
}) {
    const { formatCustom: tzFmt } = useTimezone();
    const { authFetch } = useData();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const { users, setCurrentUser, currentUser, refreshUsers } = useUser();

    const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
    const [formUser, setFormUser] = useState<User | undefined>(undefined);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

    useEffect(() => {
        refreshUsers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const counts = useMemo(() => ({
        all: users.length,
        active: users.filter(u => u.is_active).length,
        inactive: users.filter(u => !u.is_active).length,
        attention: users.filter(u => attention(u)).length,
    }), [users]);

    // ponytail: one scrolling list, no pager — fine for the tens of users a plant has.
    const filteredUsers = useMemo(() => {
        const term = search.trim().toLowerCase();
        return users
            .filter(u => {
                if (statusFilter === 'active' && !u.is_active) return false;
                if (statusFilter === 'inactive' && u.is_active) return false;
                if (statusFilter === 'attention' && !attention(u)) return false;
                if (term && !u.username.toLowerCase().includes(term) && !u.full_name.toLowerCase().includes(term)) return false;
                return true;
            })
            .sort((a, b) => Number(b.is_active) - Number(a.is_active));
    }, [users, search, statusFilter]);

    const user = users.find(u => u.id === selectedId) || filteredUsers[0];

    const authJson = () => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('access_token')}` });

    const submitCreate = async (payload: UserFormPayload): Promise<{ ok: boolean; error?: string }> => {
        try {
            const res = await authFetch(`${API_BASE}/users`, { method: 'POST', headers: authJson(), body: JSON.stringify(payload) });
            if (res.ok) {
                const created = await res.json();
                showToast('User created successfully!', 'success');
                refreshUsers();
                if (created?.id) onSelect(created.id);
                return { ok: true };
            }
            const err = await res.json();
            return { ok: false, error: err.detail };
        } catch (e) {
            console.error(e);
            return { ok: false, error: 'Error creating user' };
        }
    };

    const submitEdit = async (userId: string, payload: Partial<UserFormPayload>): Promise<{ ok: boolean; error?: string }> => {
        try {
            const res = await authFetch(`${API_BASE}/users/${userId}`, { method: 'PUT', headers: authJson(), body: JSON.stringify(payload) });
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

    const setUserActive = async (u: User, active: boolean) => {
        if (!active) {
            const ok = await confirm({
                title: 'Deactivate User',
                message: `Deactivate "${u.username}"? They will immediately lose access until reactivated.`,
                confirmText: 'Deactivate',
                variant: 'danger',
            });
            if (!ok) return;
        }
        try {
            const res = await authFetch(`${API_BASE}/users/${u.id}/${active ? 'reactivate' : 'deactivate'}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` },
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

    /** Drops direct grants the role already gives — they change nothing but clutter the audit. */
    const removeRedundant = async (u: User) => {
        const { extra, redundant } = directSplit(u);
        const ok = await confirm({
            title: 'Remove Redundant Grants',
            message: `Remove ${redundant.length} direct grant${redundant.length !== 1 ? 's' : ''} from "${u.username}" that ${u.role?.name} already gives? What they can do does not change.`,
            confirmText: 'Remove',
        });
        if (!ok) return;
        await submitEdit(u.id, { permission_ids: extra.map(p => p.id) });
    };

    const openEdit = (u: User) => { setFormUser(u); setFormMode('edit'); };

    const list = (
        <SettingsPanel
            icon="bi-people-fill"
            title="Users"
            flush
            fill
            right={
                <button
                    type="button"
                    style={xpBtn({ padding: '1px 8px' })}
                    className={XP_BTN}
                    onClick={() => { setFormUser(undefined); setFormMode('create'); }}
                ><i className="bi bi-person-plus" style={{ marginRight: 4 }}></i>Add User</button>
            }
        >
            <div style={{ padding: 6, borderBottom: '1px solid #d6d3c6', background: '#f4f2ea', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SearchField value={search} onChange={setSearch} placeholder="Search username or name…" grow width={600} />
                <FilterChipBar
                    options={[
                        { value: 'all', label: 'All', count: counts.all },
                        { value: 'active', label: 'Active', count: counts.active },
                        { value: 'inactive', label: 'Inactive', count: counts.inactive },
                        { value: 'attention', label: <><i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 3 }} />Attention</>, count: counts.attention, tone: 'amber', title: 'No role, many direct grants, or never logged in' },
                    ]}
                    value={statusFilter}
                    onChange={v => setStatusFilter(v as StatusFilter)}
                />
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
                {filteredUsers.map(u => {
                    const flag = attention(u);
                    const selected = u.id === user?.id;
                    return (
                        <ListRow key={u.id} selected={selected} dim={!u.is_active} onClick={() => onSelect(u.id)}>
                            <PixelAvatar avatarId={u.avatar_id} seed={u.username} template={u.role?.default_avatar_id} size={26} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontFamily: 'Consolas, "Courier New", monospace', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {u.username}
                                    {currentUser?.id === u.id && <span style={{ fontWeight: 'normal', fontSize: 9, opacity: 0.7 }}> (you)</span>}
                                </div>
                                <div style={{ fontSize: 10, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {u.full_name}{u.role ? ` · ${u.role.name}` : ''}
                                </div>
                            </div>
                            <div style={{ textAlign: 'right', fontSize: 9, whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                                {flag ? <Flag tone={flag.tone} icon={flag.icon}>{flag.label}</Flag>
                                    : !u.is_active ? <Flag tone="gray">Inactive</Flag> : null}
                                <span style={{ opacity: 0.75 }}>{relativeTime(u.last_login_at)}</span>
                            </div>
                        </ListRow>
                    );
                })}
                {filteredUsers.length === 0 && (
                    <div style={{ padding: 14, textAlign: 'center', fontStyle: 'italic', color: '#888', fontFamily: xpFont, fontSize: 11 }}>
                        No users match this search/filter.
                    </div>
                )}
            </div>
            <div style={{ padding: '3px 8px', borderTop: '1px solid #d6d3c6', background: '#f4f2ea', fontFamily: xpFont, fontSize: 10, color: '#666' }}>
                {filteredUsers.length} of {users.length} user{users.length !== 1 ? 's' : ''}
            </div>
        </SettingsPanel>
    );

    return (
        <>
            <MasterDetail
                list={list}
                detail={user ? (
                    <UserDetail
                        user={user}
                        isSelf={currentUser?.id === user.id}
                        allPermissions={allPermissions}
                        lastLoginExact={user.last_login_at ? tzFmt(user.last_login_at, { dateStyle: 'medium', timeStyle: 'short' } as Intl.DateTimeFormatOptions) : ''}
                        onEdit={() => openEdit(user)}
                        onSetActive={active => setUserActive(user, active)}
                        onRemoveRedundant={() => removeRedundant(user)}
                        onOpenRole={onOpenRole}
                        onCreateRole={() => onCreateRoleFrom(user)}
                    />
                ) : (
                    <SettingsPanel icon="bi-person" title="User" fill>
                        <XPEmptyState message="Pick a user on the left, or add one." icon="bi-people" />
                    </SettingsPanel>
                )}
            />

            <UserFormModal
                isOpen={formMode !== null}
                onClose={() => setFormMode(null)}
                mode={formMode || 'create'}
                user={formUser}
                roles={roles}
                allPermissions={allPermissions}
                onSubmit={(payload) => formMode === 'create' ? submitCreate(payload) : submitEdit(formUser!.id, payload)}
            />
        </>
    );
}

function UserDetail({ user, isSelf, allPermissions, lastLoginExact, onEdit, onSetActive, onRemoveRedundant, onOpenRole, onCreateRole }: {
    user: User;
    isSelf: boolean;
    allPermissions: any[];
    lastLoginExact: string;
    onEdit: () => void;
    onSetActive: (active: boolean) => void;
    onRemoveRedundant: () => void;
    onOpenRole: (roleId: string) => void;
    onCreateRole: () => void;
}) {
    const rolePerms = user.role?.permissions || [];
    const direct = user.permissions || [];
    const admin = isAdminPerms(rolePerms) || isAdminPerms(direct);
    const effective = effectivePermissionList(rolePerms, direct);
    const { extra, redundant } = directSplit(user);
    const btn = (extraStyle = {}) => xpBtn({ padding: '1px 8px', ...extraStyle });

    return (
        <SettingsPanel icon="bi-person-badge" title="User" fill>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: xpFont }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ border: '1px solid', borderColor: '#fff #888 #888 #fff', background: '#e0dcd4', padding: 2, opacity: user.is_active ? 1 : 0.5 }}>
                        <PixelAvatar avatarId={user.avatar_id} seed={user.username} template={user.role?.default_avatar_id} size={44} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 'bold' }}>{user.full_name}{isSelf && <span style={{ fontSize: 10, fontWeight: 'normal', color: '#888' }}> (you)</span>}</div>
                        <div style={{ fontFamily: 'Consolas, "Courier New", monospace', fontSize: 11, color: '#666', marginTop: 2 }}>@{user.username}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className={XP_BTN} style={btn()} onClick={onEdit}>
                            <i className="bi bi-pencil-square" style={{ marginRight: 4 }} />Edit
                        </button>
                        {!isSelf && (
                            <button type="button" className={XP_BTN} style={btn({ color: user.is_active ? '#8e0000' : '#2d7a2d' })} onClick={() => onSetActive(!user.is_active)}>
                                <i className={`bi ${user.is_active ? 'bi-person-dash' : 'bi-person-check'}`} style={{ marginRight: 4 }} />
                                {user.is_active ? 'Deactivate' : 'Reactivate'}
                            </button>
                        )}
                    </div>
                </div>

                <DetailGrid columns={4}>
                    <Detail label="Role" value={user.role ? (
                        <button type="button" onClick={() => onOpenRole(user.role.id)} title="Open this role"
                            style={{ background: 'none', border: 'none', padding: 0, color: '#00006e', textDecoration: 'underline', cursor: 'pointer', fontFamily: xpFont, fontSize: 11 }}>
                            {user.role.name}
                        </button>
                    ) : <Flag tone="amber" icon="bi-exclamation-triangle-fill">No role</Flag>} />
                    <Detail label="Status" value={<StatusChip status={user.is_active ? 'ACTIVE' : 'INACTIVE'} tint />} />
                    <Detail label="Last login" value={<span title={lastLoginExact}>{relativeTime(user.last_login_at)}</span>} />
                    <Detail label="Permissions" value={admin ? 'All' : `${effective.length}${direct.length ? ` (${direct.length} direct)` : ''}`} />
                </DetailGrid>

                {!user.role && (
                    <Callout tone="amber" icon="bi-exclamation-triangle-fill" action={<button type="button" className={XP_BTN} style={btn()} onClick={onEdit}>Assign role</button>}>
                        <b>No role assigned.</b>{' '}
                        {direct.length
                            ? `Only ${direct.length} direct grant${direct.length !== 1 ? 's' : ''} — hard to audit and easy to forget.`
                            : 'This user can sign in but cannot open any page.'}
                    </Callout>
                )}
                {user.role && extra.length >= MANY_DIRECT && (
                    <Callout tone="amber" icon="bi-shuffle" action={<button type="button" className={XP_BTN} style={btn()} onClick={onCreateRole}>Create role from user</button>}>
                        <b>{extra.length} permissions granted directly</b> on top of {user.role.name}. If anyone else needs the same set, make it a role.
                    </Callout>
                )}
                {redundant.length > 0 && (
                    <Callout tone="blue" icon="bi-recycle" action={<button type="button" className={XP_BTN} style={btn()} onClick={onRemoveRedundant}>Clean up</button>}>
                        {redundant.length} direct grant{redundant.length !== 1 ? 's' : ''} already come{redundant.length === 1 ? 's' : ''} from {user.role?.name} — safe to remove.
                    </Callout>
                )}
                {user.is_active && !user.last_login_at && (
                    <Callout tone="blue" icon="bi-moon">Has never logged in.</Callout>
                )}

                <DetailSection title="Can access">
                    <CoveragePills coverage={sectionCoverage(admin ? allPermissions : effective, allPermissions)} />
                </DetailSection>

                {!admin && effective.length > 0 && (
                    <DetailSection title="Effective permissions">
                        <PermissionBreakdown permissions={effective} showDirect />
                    </DetailSection>
                )}

                <DetailSection title={<>Limited to <span style={{ fontWeight: 'normal', textTransform: 'none', color: '#888' }}>(from role)</span></>}>
                    <ScopeBreakdown role={user.role} />
                </DetailSection>
            </div>
        </SettingsPanel>
    );
}
