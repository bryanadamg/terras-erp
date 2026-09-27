'use client';

import { useCallback, useEffect, useState } from 'react';
import SettingsRolesTab from './SettingsRolesTab';
import SettingsUsersTab from './SettingsUsersTab';
import { RoleLike } from './RoleFormModal';
import { useData } from '../../context/DataContext';
import { API_BASE } from '../shared/apiBase';
import { settingsStack } from './settingsStyles';

/**
 * Access Control — the roles panel and the users panel stacked in one tab.
 * They were separate tabs, which meant two copies of the same /roles +
 * /permissions fetch and a tab hop to answer "why can this user do X?". The
 * fetch now lives here and feeds both panels, and a role's user count is a
 * filter into the users panel below instead of a dead-end number.
 *
 * Both panels stay full-bleed one-per-row rather than sharing a `settingsColumns`
 * band like the other tabs: these are eight- and six-column data tables, and half
 * a screen each would squeeze the permission chips and Last Login off the end.
 */
export default function SettingsAccessTab() {
    const { authFetch } = useData();
    const [roles, setRoles] = useState<RoleLike[]>([]);
    const [allPermissions, setAllPermissions] = useState<any[]>([]);
    const [roleFilter, setRoleFilter] = useState<string | null>(null);

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

    return (
        <div style={settingsStack}>
            <SettingsRolesTab
                roles={roles}
                allPermissions={allPermissions}
                reload={loadAuthData}
                roleFilter={roleFilter}
                onFilterUsers={(roleId) => setRoleFilter(prev => prev === roleId ? null : roleId)}
            />
            <SettingsUsersTab
                roles={roles}
                allPermissions={allPermissions}
                roleFilter={roleFilter}
                onClearRoleFilter={() => setRoleFilter(null)}
            />
        </div>
    );
}
