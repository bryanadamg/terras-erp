'use client';

import React from 'react';
import { xpFont, ExpandedRowPanel, ExpandedRowPanelBody } from '../shared/xpTheme';
import { describePermission, groupPermissionsBySection, groupPermissionsByResource } from '../shared/permissionMatrix';
import { PermissionChip, PermissionSectionTable } from '../shared/permissionChips';

export interface BreakdownPermission {
    id: string;
    code: string;
    description: string;
    /** true when granted directly on the user rather than inherited from the role. */
    _direct?: boolean;
}

/**
 * The expanded permission list on a role row and on a user row.
 *
 * Renders through the same `PermissionSectionTable` + `PermissionChip` pair the
 * editable picker uses, so what you configure and what you audit are visibly
 * the same object. Sections tile into a responsive grid; the resource is stated
 * once per row with its action chips beside it, never repeated per chip.
 */
export default function PermissionBreakdown({ permissions, showDirect = false }: {
    permissions: BreakdownPermission[];
    /** Marks `_direct` permissions apart from role-inherited ones (user rows). */
    showDirect?: boolean;
}) {
    const sections = groupPermissionsBySection(permissions);
    const font = xpFont;

    return (
        <ExpandedRowPanel>
            <ExpandedRowPanelBody>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                    gap: 14,
                    alignItems: 'start',
                }}>
                    {sections.map(({ section, permissions: secPerms }) => (
                        <PermissionSectionTable
                            key={section}
                            title={section}
                            right={<span style={{ fontFamily: font, fontSize: 9, color: '#7b8794' }}>{secPerms.length}</span>}
                            rows={groupPermissionsByResource(secPerms).map(({ resource, permissions: resPerms }) => ({
                                key: resource,
                                label: resource,
                                chips: resPerms.map(p => {
                                    const { action } = describePermission(p.code, p.description);
                                    return (
                                        <PermissionChip
                                            key={p.id}
                                            label={action}
                                            code={p.code}
                                            state="static"
                                            direct={showDirect && p._direct}
                                            title={showDirect ? `${p.code} (${p._direct ? 'direct grant' : 'via role'})` : p.code}
                                        />
                                    );
                                }),
                            }))}
                        />
                    ))}
                </div>
                {showDirect && permissions.some(p => p._direct) && (
                    <div style={{ fontFamily: font, fontSize: 9, color: '#6b6558', marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <PermissionChip label="Chip" code="edit" state="static" direct />
                        outlined in blue = granted directly to this user, not through the role.
                    </div>
                )}
            </ExpandedRowPanelBody>
        </ExpandedRowPanel>
    );
}
