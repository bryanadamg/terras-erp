'use client';

import { xpFont, CHIP_RADIUS } from '../shared/xpTheme';

interface Permission { id: string; code: string; description: string }

/**
 * Union of role-inherited and directly-granted permissions, direct ones
 * flagged. The detail panel is rendered by the caller in a full-width row
 * (same shape as the roles table), so this list is computed here and drawn
 * there.
 */
export function effectivePermissionList(rolePermissions: Permission[], directPermissions: Permission[]) {
    const directIds = new Set(directPermissions.map(p => p.id));
    return [
        ...rolePermissions.filter(p => !directIds.has(p.id)).map(p => ({ ...p, _direct: false })),
        ...directPermissions.map(p => ({ ...p, _direct: true })),
    ];
}

/**
 * Shows the union of role-inherited and directly-granted permissions on a
 * user row — previously only direct overrides were visible, which hid what a
 * user could actually do if their role already covered it. Collapses to a
 * one-line summary; the caller expands it into a full-width detail row.
 */
export default function EffectivePermissions({
    rolePermissions, directPermissions, expanded, onToggle,
}: {
    rolePermissions: Permission[];
    directPermissions: Permission[];
    expanded: boolean;
    onToggle: () => void;
}) {
    const directIds = new Set(directPermissions.map(p => p.id));
    const inherited = rolePermissions.filter(p => !directIds.has(p.id));
    const isAdmin = rolePermissions.some(p => p.code === 'admin.access') || directPermissions.some(p => p.code === 'admin.access');

    if (isAdmin) {
        return <span style={{ borderRadius: CHIP_RADIUS, background: '#e8e8e8', border: '1px solid #6a6a6a', color: '#000', padding: '0 4px', fontSize: '9px', fontFamily: xpFont, fontWeight: 'bold' }}>
                All Permissions
            </span>;
    }

    const total = inherited.length + directPermissions.length;
    if (total === 0) {
        return <span style={{ fontSize: '9px', color: '#888', fontStyle: 'italic', fontFamily: xpFont }}>None</span>;
    }

    const summary = `${total} permission${total !== 1 ? 's' : ''}${directPermissions.length > 0 ? ` (${directPermissions.length} direct)` : ''}`;

    return (
        <button
            onClick={onToggle}
            style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontFamily: xpFont, fontSize: '10px', color: '#00006e',
                display: 'flex', alignItems: 'center', gap: 4,
            }}
        >
            <i className={`bi ${expanded ? 'bi-caret-down-fill' : 'bi-caret-right-fill'}`} style={{ fontSize: 8 }} />
            {summary}
        </button>
    );
}
