'use client';

import { useCallback, useEffect, useState } from 'react';
import { FilterChipBar } from '@bryanadamg/terras-ui/components/FilterChipBar';
import SettingsRolesTab from './SettingsRolesTab';
import SettingsUsersTab from './SettingsUsersTab';
import { RoleLike } from './RoleFormModal';
import { useData } from '../../context/DataContext';
import { useUser } from '../../context/UserContext';
import { useRememberedTab } from '../../hooks/useRememberedTab';
import { API_BASE } from '../shared/apiBase';

type AccessSub = 'users' | 'roles';

/**
 * Access Control — Users and Roles as two list/detail screens behind one
 * switch. They used to be two full-width tables stacked in one scroll, with a
 * role's detail expanding inline and pushing the users table off-screen. The
 * /roles + /permissions fetch lives here and feeds both, and the selection does
 * too, so "open this user's role" / "open this member" jump across the switch.
 */
export default function SettingsAccessTab() {
    const { authFetch } = useData();
    const { users } = useUser();
    const [roles, setRoles] = useState<RoleLike[]>([]);
    const [allPermissions, setAllPermissions] = useState<any[]>([]);
    const [sub, setSub] = useRememberedTab<AccessSub>('settings.access', 'users', ['users', 'roles']);
    const [roleId, setRoleId] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    const loadAuthData = useCallback(() => {
        const authHeaders = { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` };
        Promise.all([
            authFetch(`${API_BASE}/roles`, { headers: authHeaders }).then(res => res.ok ? res.json() : []),
            authFetch(`${API_BASE}/permissions`, { headers: authHeaders }).then(res => res.ok ? res.json() : []),
        ]).then(([rolesData, permsData]) => {
            setRoles(rolesData);
            setAllPermissions(permsData);
        }).catch(err => console.error('Failed to fetch roles/permissions', err));
    }, []);

    useEffect(() => { loadAuthData(); }, [loadAuthData]);

    const openRole = (id: string) => { setRoleId(id); setSub('roles'); };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0 }}>
            <FilterChipBar
                ariaLabel="Access control section"
                options={[
                    { value: 'users', label: <><i className="bi bi-people-fill" style={{ marginRight: 4 }} />Users</>, count: users.length },
                    { value: 'roles', label: <><i className="bi bi-diagram-3" style={{ marginRight: 4 }} />Roles</>, count: roles.length },
                ]}
                value={sub}
                onChange={v => setSub(v as AccessSub)}
                style={{ alignSelf: 'flex-start' }}
            />
            {sub === 'roles' ? (
                <SettingsRolesTab
                    roles={roles}
                    allPermissions={allPermissions}
                    reload={loadAuthData}
                    selectedId={roleId}
                    onSelect={setRoleId}
                />
            ) : (
                <SettingsUsersTab
                    roles={roles}
                    allPermissions={allPermissions}
                    selectedId={userId}
                    onSelect={setUserId}
                    onOpenRole={openRole}
                />
            )}
        </div>
    );
}
