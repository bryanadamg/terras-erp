'use client';

import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../shared/Toast';
import { useUser } from '../../context/UserContext';
import { useData } from '../../context/DataContext';
import { useConfirm } from '../../context/ConfirmContext';
import { xpBtn, xpFont, XP_BTN, CodeChip, XPEmptyState } from '../shared/xpTheme';
import { field } from '@bryanadamg/terras-ui/styles';
import { SearchField } from '../shared/shellTheme';
import SettingsPanel from './SettingsPanel';
import PermissionBreakdown from './PermissionBreakdown';
import RoleFormModal, { RoleFormPayload, RoleLike } from './RoleFormModal';
import ScopeBreakdown from './ScopeBreakdown';
import PixelAvatar from '../shared/PixelAvatar';
import { API_BASE } from '../shared/apiBase';
import {
    MasterDetail, ListRow, DetailSection, Callout, CoverageStrip, CoveragePills,
    sectionCoverage, isAdminPerms, permissionOverlap, relativeTime,
} from './accessParts';

const hasScope = (r: RoleLike) =>
    !!(r.allowed_work_center_types?.length || r.allowed_categories?.length || r.allowed_locations?.length);

export default function SettingsRolesTab({
    roles, allPermissions, reload, selectedId, onSelect, draft, onDraftOpened,
}: {
    roles: RoleLike[];
    allPermissions: any[];
    reload: () => void;
    selectedId: string | null;
    onSelect: (roleId: string) => void;
    /** A role to open in the create form ("Create role from user"). */
    draft?: RoleLike | null;
    onDraftOpened?: () => void;
}) {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const { users, refreshUsers } = useUser();
    const { authFetch } = useData();

    const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
    const [formRole, setFormRole] = useState<RoleLike | undefined>(undefined);
    const [search, setSearch] = useState('');

    const authHeaders = () => ({ 'Authorization': `Bearer ${localStorage.getItem('access_token')}` });

    useEffect(() => {
        if (!draft) return;
        setFormRole(draft);
        setFormMode('create');
        onDraftOpened?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft]);

    const membersByRole = useMemo(() => {
        const m = new Map<string, typeof users>();
        for (const u of users) {
            if (!u.role?.id) continue;
            if (!m.has(u.role.id)) m.set(u.role.id, []);
            m.get(u.role.id)!.push(u);
        }
        return m;
    }, [users]);

    const visibleRoles = useMemo(() => {
        const term = search.trim().toLowerCase();
        return term ? roles.filter(r => r.name.toLowerCase().includes(term)) : roles;
    }, [roles, search]);

    // Fall back to the first role so the detail pane is never blank on arrival.
    const role = roles.find(r => r.id === selectedId) || roles[0];

    const submitCreate = async (payload: RoleFormPayload): Promise<{ ok: boolean; error?: string }> => {
        try {
            const res = await authFetch(`${API_BASE}/roles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                const created = await res.json();
                showToast('Role created successfully!', 'success');
                reload();
                if (created?.id) onSelect(created.id);
                return { ok: true };
            }
            const err = await res.json();
            return { ok: false, error: err.detail };
        } catch (e) {
            console.error(e);
            return { ok: false, error: 'Error creating role' };
        }
    };

    const submitEdit = async (roleId: string, payload: RoleFormPayload): Promise<{ ok: boolean; error?: string }> => {
        try {
            const res = await authFetch(`${API_BASE}/roles/${roleId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                showToast('Role updated successfully!', 'success');
                reload();
                return { ok: true };
            }
            const err = await res.json();
            return { ok: false, error: err.detail };
        } catch (e) {
            console.error(e);
            return { ok: false, error: 'Error updating role' };
        }
    };

    const deleteRole = async (r: RoleLike) => {
        const inUse = membersByRole.get(r.id)?.length || 0;
        if (inUse > 0) {
            showToast(`Cannot delete — assigned to ${inUse} user${inUse !== 1 ? 's' : ''}. Reassign them first.`, 'warning');
            return;
        }
        const ok = await confirm({
            title: 'Delete Role',
            message: `Delete the role "${r.name}"? This cannot be undone.`,
            confirmText: 'Delete',
            variant: 'danger',
        });
        if (!ok) return;
        try {
            const res = await authFetch(`${API_BASE}/roles/${r.id}`, { method: 'DELETE', headers: authHeaders() });
            if (res.ok || res.status === 204) {
                showToast('Role deleted', 'success');
                reload();
            } else {
                const err = await res.json();
                showToast(`Failed: ${err.detail}`, 'danger');
            }
        } catch (e) {
            console.error(e);
            showToast('Error deleting role', 'danger');
        }
    };

    const openEdit = (r: RoleLike) => { setFormRole(r); setFormMode('edit'); };
    // Create form prefilled from an existing role; a blank id keeps it a new role.
    const openDuplicate = (r: RoleLike) => { setFormRole({ ...r, id: '', name: `${r.name} (copy)` }); setFormMode('create'); };

    const assignUser = async (r: RoleLike, userId: string) => {
        const u = users.find(x => x.id === userId);
        if (!u) return;
        if (u.role) {
            const ok = await confirm({
                title: 'Change Role',
                message: `Move "${u.username}" from ${u.role.name} to ${r.name}? A user has one role.`,
                confirmText: 'Move',
            });
            if (!ok) return;
        }
        try {
            const res = await authFetch(`${API_BASE}/users/${u.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ role_id: r.id }),
            });
            if (res.ok) {
                showToast(`${u.username} now has the ${r.name} role`, 'success');
                refreshUsers();
            } else {
                const err = await res.json();
                showToast(`Failed: ${err.detail}`, 'danger');
            }
        } catch (e) {
            console.error(e);
            showToast('Error assigning role', 'danger');
        }
    };

    const list = (
        <SettingsPanel
            icon="bi-diagram-3"
            title="Roles"
            flush
            fill
            right={
                <button
                    type="button"
                    style={xpBtn({ padding: '1px 8px' })}
                    className={XP_BTN}
                    onClick={() => { setFormRole(undefined); setFormMode('create'); }}
                ><i className="bi bi-plus-lg" style={{ marginRight: 4 }}></i>Add Role</button>
            }
        >
            <div style={{ flexShrink: 0, padding: 6, borderBottom: '1px solid #d6d3c6', background: '#f4f2ea' }}>
                <div style={{ display: 'flex' }}><SearchField value={search} onChange={setSearch} placeholder="Search roles…" grow width={600} /></div>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
                {visibleRoles.map(r => {
                    const n = membersByRole.get(r.id)?.length || 0;
                    const admin = isAdminPerms(r.permissions);
                    const selected = r.id === role?.id;
                    return (
                        <ListRow key={r.id} selected={selected} onClick={() => onSelect(r.id)}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {r.name}
                                    {hasScope(r) && <i className="bi bi-lock-fill" title="Restricted scope" style={{ fontSize: 9, marginLeft: 4, opacity: 0.7 }} />}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 9, opacity: 0.75 }}>
                                    <CoverageStrip coverage={sectionCoverage(admin ? allPermissions : r.permissions, allPermissions)} />
                                    {admin ? 'all permissions' : `${r.permissions.length} perms`}
                                </div>
                            </div>
                            <span title={`${n} user${n !== 1 ? 's' : ''}`} style={{ fontSize: 10, opacity: n ? 1 : 0.5, whiteSpace: 'nowrap' }}>
                                <i className="bi bi-person-fill" /> {n}
                            </span>
                        </ListRow>
                    );
                })}
                {visibleRoles.length === 0 && (
                    <div style={{ padding: 14, textAlign: 'center', fontStyle: 'italic', color: '#888', fontFamily: xpFont, fontSize: 11 }}>
                        {roles.length ? 'No roles match.' : 'No roles defined yet.'}
                    </div>
                )}
            </div>
        </SettingsPanel>
    );

    return (
        <>
            <MasterDetail
                list={list}
                detail={role ? (
                    <RoleDetail
                        role={role}
                        roles={roles}
                        allPermissions={allPermissions}
                        members={membersByRole.get(role.id) || []}
                        candidates={users.filter(u => u.is_active && u.role?.id !== role.id)}
                        onAssign={userId => assignUser(role, userId)}
                        onDuplicate={() => openDuplicate(role)}
                        onEdit={() => openEdit(role)}
                        onDelete={() => deleteRole(role)}
                        onSelectRole={onSelect}
                    />
                ) : (
                    <SettingsPanel icon="bi-diagram-3" title="Role" fill>
                        <XPEmptyState message="Pick a role on the left, or add one." icon="bi-diagram-3" />
                    </SettingsPanel>
                )}
            />

            <RoleFormModal
                isOpen={formMode !== null}
                onClose={() => setFormMode(null)}
                mode={formMode || 'create'}
                role={formRole}
                allPermissions={allPermissions}
                onSubmit={(payload) => formMode === 'create' ? submitCreate(payload) : submitEdit(formRole!.id, payload)}
            />
        </>
    );
}

function RoleDetail({ role, roles, allPermissions, members, candidates, onAssign, onDuplicate, onEdit, onDelete, onSelectRole }: {
    role: RoleLike;
    roles: RoleLike[];
    allPermissions: any[];
    members: ReturnType<typeof useUser>['users'];
    /** Active users not on this role, for "Assign user". */
    candidates: ReturnType<typeof useUser>['users'];
    onAssign: (userId: string) => void;
    onDuplicate: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onSelectRole: (id: string) => void;
}) {
    const admin = isAdminPerms(role.permissions);
    const inUse = members.length > 0;

    // The role this one most overlaps — two near-identical roles (Gudang Bahan /
    // Gudang Bahan Baku) are usually one role that drifted, or need descriptions.
    const similar = useMemo(() => {
        if (admin) return null;
        let best: { role: RoleLike; shared: number; score: number } | null = null;
        for (const o of roles) {
            if (o.id === role.id || isAdminPerms(o.permissions)) continue;
            const { shared, score } = permissionOverlap(role.permissions, o.permissions);
            if (shared >= 3 && score >= 0.5 && (!best || score > best.score)) best = { role: o, shared, score };
        }
        return best;
    }, [role, roles, admin]);

    return (
        <SettingsPanel icon="bi-shield-lock" title="Role" fill>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: xpFont }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 'bold' }}>
                            {role.name}
                            {hasScope(role) && <i className="bi bi-lock-fill" title="Restricted scope" style={{ fontSize: 12, marginLeft: 6, color: '#888' }} />}
                        </div>
                        <div style={{ fontSize: 11, color: '#666', marginTop: 3 }}>
                            {role.description || (
                                <button type="button" onClick={onEdit} style={{ background: 'none', border: 'none', padding: 0, color: '#00006e', textDecoration: 'underline', cursor: 'pointer', fontFamily: xpFont, fontSize: 11 }}>
                                    + Add a description
                                </button>
                            )}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className={XP_BTN} style={xpBtn({ padding: '2px 8px' })} onClick={onEdit}>
                            <i className="bi bi-pencil-square" style={{ marginRight: 4 }} />Edit
                        </button>
                        <button type="button" className={XP_BTN} style={xpBtn({ padding: '2px 8px' })} onClick={onDuplicate} title="New role starting from this one's permissions and scope">
                            <i className="bi bi-copy" style={{ marginRight: 4 }} />Duplicate
                        </button>
                        <button
                            type="button"
                            className={XP_BTN}
                            style={xpBtn({ padding: '2px 8px', color: inUse ? undefined : '#8e0000', opacity: inUse ? 0.5 : 1 })}
                            disabled={inUse}
                            title={inUse ? `Assigned to ${members.length} user(s) — reassign them first` : 'Delete role'}
                            onClick={onDelete}
                        ><i className="bi bi-trash" style={{ marginRight: 4 }} />Delete</button>
                    </div>
                </div>

                {similar && (
                    <Callout
                        tone="blue"
                        icon="bi-intersect"
                        action={
                            <button type="button" className={XP_BTN} style={xpBtn({ padding: '1px 8px' })} onClick={() => onSelectRole(similar.role.id)}>
                                Open {similar.role.name}
                            </button>
                        }
                    >
                        Shares <b>{similar.shared}</b> permissions with <b>{similar.role.name}</b> — consider merging them, or describe how they differ.
                    </Callout>
                )}

                <DetailSection title="Can access" right={<span style={{ fontSize: 10, color: '#666' }}>{admin ? 'every permission' : `${role.permissions.length} permissions`}</span>}>
                    <CoveragePills coverage={sectionCoverage(admin ? allPermissions : role.permissions, allPermissions)} />
                </DetailSection>

                {!admin && role.permissions.length > 0 && (
                    <DetailSection title="Permissions">
                        <PermissionBreakdown permissions={role.permissions} />
                    </DetailSection>
                )}

                <DetailSection title="Limited to">
                    <ScopeBreakdown role={role} />
                </DetailSection>

                <DetailSection
                    title={`Members (${members.length})`}
                    right={candidates.length > 0 && (
                        <select
                            aria-label="Assign a user to this role"
                            value=""
                            onChange={e => { if (e.target.value) onAssign(e.target.value); }}
                            style={field({ fontSize: 11, padding: '1px 4px', width: 240 })}
                        >
                            <option value="">+ Assign user…</option>
                            {candidates.map(u => (
                                <option key={u.id} value={u.id}>
                                    {u.username} — {u.full_name}{u.role ? ` (${u.role.name})` : ''}
                                </option>
                            ))}
                        </select>
                    )}
                >
                    <div style={{ border: '1px solid #c8c4b6' }}>
                        {members.map((u, i) => (
                            <div key={u.id} style={{
                                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                                borderTop: i ? '1px solid #f0eee6' : undefined, opacity: u.is_active ? 1 : 0.55,
                            }}>
                                <PixelAvatar avatarId={u.avatar_id} seed={u.username} template={u.role?.default_avatar_id} size={22} />
                                <CodeChip code={u.username} />
                                <span style={{ fontSize: 11 }}>{u.full_name}</span>
                                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#666' }} title={u.last_login_at || undefined}>
                                    {u.is_active ? relativeTime(u.last_login_at) : 'Inactive'}
                                </span>
                            </div>
                        ))}
                        {members.length === 0 && (
                            <div style={{ padding: 12, textAlign: 'center', fontStyle: 'italic', color: '#888', fontSize: 11 }}>
                                No one has this role yet.
                            </div>
                        )}
                    </div>
                </DetailSection>
            </div>
        </SettingsPanel>
    );
}
