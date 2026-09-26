'use client';

import { Fragment, useMemo, useState } from 'react';
import { useToast } from '../shared/Toast';
import { useUser } from '../../context/UserContext';
import { useData } from '../../context/DataContext';
import { useConfirm } from '../../context/ConfirmContext';
import { xpBtn, xpFont, rowStateBg, CHIP_RADIUS, XP_BTN } from '../shared/xpTheme';
import { xpTableHeader, xpThCell, tdBase } from './settingsStyles';
import SettingsPanel from './SettingsPanel';
import PermissionBreakdown from './PermissionBreakdown';
import RoleFormModal, { RoleFormPayload, RoleLike } from './RoleFormModal';
import ScopeBreakdown from './ScopeBreakdown';
import { API_BASE } from '../shared/apiBase';
import { groupPermissionsBySection } from '../shared/permissionMatrix';
import { lvZebra } from '../shared/listViewTheme';

export default function SettingsRolesTab({
    roles, allPermissions, reload, roleFilter, onFilterUsers,
}: {
    roles: RoleLike[];
    allPermissions: any[];
    reload: () => void;
    /** Role whose users the sibling users panel is currently filtered to, if any. */
    roleFilter: string | null;
    onFilterUsers: (roleId: string) => void;
}) {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const { users } = useUser();
    const { categories, locations, authFetch } = useData();

    const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
    const [formRole, setFormRole] = useState<RoleLike | undefined>(undefined);
    const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());

    const toggleExpanded = (roleId: string) => {
        setExpandedRoles(prev => {
            const next = new Set(prev);
            next.has(roleId) ? next.delete(roleId) : next.add(roleId);
            return next;
        });
    };

    const groupedPermissions = (role: RoleLike) => groupPermissionsBySection(role.permissions);

    const categoryName = useMemo(() => {
        const m = new Map<string, string>();
        for (const c of categories) m.set(c.id, (c.path_names || [c.name]).join(' / '));
        return m;
    }, [categories]);
    const locationName = useMemo(() => {
        const m = new Map<string, string>();
        for (const l of locations) m.set(l.id, l.full_path || l.name);
        return m;
    }, [locations]);

    const authHeaders = () => ({ 'Authorization': `Bearer ${localStorage.getItem('access_token')}` });

    const userCountByRole = useMemo(() => {
        const counts = new Map<string, number>();
        for (const u of users) {
            if (u.role?.id) counts.set(u.role.id, (counts.get(u.role.id) || 0) + 1);
        }
        return counts;
    }, [users]);

    const submitCreate = async (payload: RoleFormPayload): Promise<{ ok: boolean; error?: string }> => {
        try {
            const res = await authFetch(`${API_BASE}/roles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                showToast('Role created successfully!', 'success');
                reload();
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

    const deleteRole = async (role: RoleLike) => {
        const inUse = userCountByRole.get(role.id) || 0;
        if (inUse > 0) {
            showToast(`Cannot delete — assigned to ${inUse} user${inUse !== 1 ? 's' : ''}. Reassign them first.`, 'warning');
            return;
        }
        const ok = await confirm({
            title: 'Delete Role',
            message: `Delete the role "${role.name}"? This cannot be undone.`,
            confirmText: 'Delete',
            variant: 'danger',
        });
        if (!ok) return;
        try {
            const res = await authFetch(`${API_BASE}/roles/${role.id}`, { method: 'DELETE', headers: authHeaders() });
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

    return (
        <SettingsPanel
            icon="bi-diagram-3"
            title="Roles"
            flush
            right={
                <button
                    type="button"
                    style={xpBtn({ padding: '1px 8px' })}
                    className={XP_BTN}
                    onClick={() => { setFormRole(undefined); setFormMode('create'); }}
                ><i className="bi bi-plus-lg" style={{ marginRight: 4 }}></i>Add Role</button>
            }
        >
            <div className="table-responsive">
                    <table
                        style={{ width: '100%', borderCollapse: 'collapse' as const, background: '#fff' }}
                    >
                        <thead style={xpTableHeader}>
                            <tr>
                                <th style={xpThCell}>Name</th>
                                <th style={xpThCell}>Description</th>
                                <th style={xpThCell}>Permissions</th>
                                <th style={xpThCell}>Scope</th>
                                <th style={{ ...xpThCell, width: 90, textAlign: 'center' as const }}>Users</th>
                                <th style={{ ...xpThCell, textAlign: 'right' as const, borderRight: 'none' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {roles.map((role, rowIndex) => {
                                const count = userCountByRole.get(role.id) || 0;
                                const isAdminRole = role.permissions.some(p => p.code === 'admin.access');
                                const isExpanded = expandedRoles.has(role.id);
                                const isFiltered = roleFilter === role.id;
                                const sections = isAdminRole ? [] : groupedPermissions(role);
                                const wcTypes = role.allowed_work_center_types || [];
                                const catIds = role.allowed_categories || [];
                                const locIds = role.allowed_locations || [];
                                const scopeCount = wcTypes.length + catIds.length + locIds.length;
                                const hasScope = scopeCount > 0;
                                return (
                                    <Fragment key={role.id}>
                                    <tr style={{ background: isExpanded ? rowStateBg('expanded') : lvZebra(rowIndex), borderBottom: isExpanded ? 'none' : '1px solid #c0bdb5' }}>
                                        <td style={{ ...tdBase, fontWeight: 'bold' }}>{role.name}</td>
                                        <td style={tdBase}>{role.description || '—'}</td>
                                        <td style={tdBase}>
                                            {isAdminRole ? (
                                                <span style={{ borderRadius: CHIP_RADIUS, background: '#e8e8e8', border: '1px solid #6a6a6a', color: '#000', padding: '0 4px', fontSize: '9px', fontFamily: xpFont, fontWeight: 'bold' }}>All Permissions</span>) : role.permissions.length === 0 ? (
                                                <span style={{ fontSize: '9px', color: '#888', fontStyle: 'italic', fontFamily: xpFont }}>None</span>
                                            ) : (
                                                <button
                                                    onClick={() => toggleExpanded(role.id)}
                                                    style={{
                                                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                                        fontFamily: xpFont, fontSize: '10px', color: '#00006e',
                                                        display: 'flex', alignItems: 'center', gap: 4,
                                                    }}
                                                >
                                                    <i className={`bi ${isExpanded ? 'bi-caret-down-fill' : 'bi-caret-right-fill'}`} style={{ fontSize: 8 }} />
                                                    {role.permissions.length} permission{role.permissions.length !== 1 ? 's' : ''}
                                                </button>
                                            )}
                                        </td>
                                        <td style={tdBase}>
                                            {hasScope ? (
                                                <button
                                                    onClick={() => toggleExpanded(role.id)}
                                                    style={{
                                                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                                        fontFamily: xpFont, fontSize: '10px', color: '#00006e',
                                                        display: 'flex', alignItems: 'center', gap: 4,
                                                    }}
                                                >
                                                    <i className={`bi ${isExpanded ? 'bi-caret-down-fill' : 'bi-caret-right-fill'}`} style={{ fontSize: 8 }} />
                                                    Restricted ({scopeCount})
                                                </button>
                                            ) : (
                                                <span style={{ fontSize: '9px', color: '#888', fontStyle: 'italic', fontFamily: xpFont }}>Unrestricted</span>
                                            )}
                                        </td>
                                        <td style={{ ...tdBase, textAlign: 'center' as const }}>
                                            {count === 0 ? (
                                                <span style={{ fontFamily: xpFont, fontSize: 10, color: '#888' }}>0</span>) : (
                                                /* Filters the users panel below to this role — the count was a dead end before. */
                                                <button
                                                    title={isFiltered ? 'Clear filter on the users list below' : 'Show these users in the list below'}
                                                    onClick={() => onFilterUsers(role.id)}
                                                    style={{
                                                        fontFamily: xpFont, fontSize: 10, cursor: 'pointer',
                                                        background: isFiltered ? '#dde8f5' : 'none',
                                                        border: `1px solid ${isFiltered ? '#7f9db9' : 'transparent'}`,
                                                        color: '#00006e', padding: '0 5px', textDecoration: isFiltered ? 'none' : 'underline',
                                                    }}
                                                >{count}</button>
                                            )}
                                        </td>
                                        <td style={{ ...tdBase, borderRight: 'none', textAlign: 'right' as const }}>
                                            {<>
                                                    <button
                                                        title="Edit"
                                                        onClick={() => { setFormRole(role); setFormMode('edit'); }}
                                                        style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: 'pointer', padding: '1px 4px', color: '#555', fontSize: '12px' }}
                                                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#7f9db9'; (e.currentTarget as HTMLButtonElement).style.background = '#e8f0f8'; }}
                                                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                                    ><i className="bi bi-pencil-square"></i></button>
                                                    <button
                                                        title={count > 0 ? `Assigned to ${count} user(s)` : 'Delete'}
                                                        onClick={() => deleteRole(role)}
                                                        disabled={count > 0}
                                                        style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: count > 0 ? 'not-allowed' : 'pointer', padding: '1px 4px', color: count > 0 ? '#bbb' : '#8e0000', fontSize: '12px' }}
                                                        onMouseEnter={e => { if (count === 0) { (e.currentTarget as HTMLButtonElement).style.borderColor = '#7f9db9'; (e.currentTarget as HTMLButtonElement).style.background = '#e8f0f8'; } }}
                                                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                                    ><i className="bi bi-trash"></i></button>
                                                </>}
                                        </td>
                                    </tr>
                                    {isExpanded && (sections.length > 0 || hasScope) && (
                                        <tr>
                                            <td colSpan={6} style={{ padding: 0, border: 'none' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: sections.length > 0 && hasScope ? 6 : 0 }}>
                                                    {sections.length > 0 && (
                                                        <PermissionBreakdown permissions={role.permissions} />
                                                    )}
                                                    {hasScope && (
                                                        <ScopeBreakdown
                                                            workCenterTypes={wcTypes}
                                                            categories={catIds.map(id => categoryName.get(id) || id)}
                                                            locations={locIds.map(id => locationName.get(id) || id)}
                                                        />
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    </Fragment>
                                );
                            })}
                            {roles.length === 0 && (
                                <tr>
                                    <td colSpan={6} style={{ ...tdBase, textAlign: 'center' as const, fontStyle: 'italic', color: '#888' }}>
                                        No roles defined yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
            </div>

            <RoleFormModal
                isOpen={formMode !== null}
                onClose={() => setFormMode(null)}
                mode={formMode || 'create'}
                role={formRole}
                allPermissions={allPermissions}
                onSubmit={(payload) => formMode === 'create' ? submitCreate(payload) : submitEdit(formRole!.id, payload)}
            />
        </SettingsPanel>
    );
}
