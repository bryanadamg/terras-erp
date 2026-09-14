'use client';

import { useEffect, useMemo, useState } from 'react';
import { xpFont } from '../shared/xpTheme';
import { PERMISSION_MATRIX, RESOURCE_ACTIONS, permissionCode, PermissionScope } from '../shared/permissionMatrix';
import { PermissionChip, PermissionSectionTable, PermissionCountPill } from '../shared/permissionChips';

export interface PermissionOption {
    id: string;
    code: string;
    description: string;
}

const SCOPE_BADGE: Record<PermissionScope, string> = {
    category: 'by category',
    location: 'by location',
    work_center_type: 'by station type',
};

/**
 * Resource x action matrix picker matching the Permissions config spreadsheet
 * layout — one row per resource, one toggle per action that resource supports
 * (not every resource has the same actions, so this isn't a uniform grid).
 *
 * Built from the same `PermissionSectionTable` + `PermissionChip` pair as the
 * read-only PermissionBreakdown, so the panel a role is configured in and the
 * panel it is audited in read as one object. Granted chips are filled and
 * checked, ungranted ones flat grey, so a half-configured section is visible
 * without reading every label. disabledIds render locked (role-inherited grants
 * a direct user override can't remove).
 */
export default function PermissionsPicker({
    allPermissions, selectedIds, onChange, disabledIds,
}: {
    allPermissions: PermissionOption[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    disabledIds?: string[];
}) {
    const idByCode = useMemo(() => {
        const m = new Map<string, string>();
        for (const p of allPermissions) m.set(p.code, p.id);
        return m;
    }, [allPermissions]);
    const disabledSet = useMemo(() => new Set(disabledIds || []), [disabledIds]);
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const resourceIds = (resource: string): string[] => {
        const actions = RESOURCE_ACTIONS[resource] || [];
        return actions.map(a => idByCode.get(permissionCode(resource, a.code))).filter((x): x is string => !!x);
    };

    // `<resource>.view` is the base read grant: the route guard (navConfig's
    // ROUTE_PERMISSIONS) and the list GETs check it, so an action grant without it
    // is dead — the user holds work_order.create but the page the button lives on
    // renders AccessDenied. So granting any action grants view too, and view can't
    // be taken away while a sibling action is still granted.
    const viewIdFor = (resource: string) => idByCode.get(permissionCode(resource, 'view'));

    const isViewRequired = (resource: string): boolean =>
        (RESOURCE_ACTIONS[resource] || []).some(a => {
            if (a.code === 'view') return false;
            const id = idByCode.get(permissionCode(resource, a.code));
            return !!id && (selectedSet.has(id) || disabledSet.has(id));
        });

    const toggle = (id: string, resource: string, actionCode: string) => {
        if (disabledSet.has(id)) return;
        const viewId = viewIdFor(resource);
        if (selectedSet.has(id)) {
            // Locked while other actions on this row need it.
            if (actionCode === 'view' && isViewRequired(resource)) return;
            onChange(selectedIds.filter(i => i !== id));
            return;
        }
        const add = [id];
        if (actionCode !== 'view' && viewId && !selectedSet.has(viewId) && !disabledSet.has(viewId)) add.push(viewId);
        onChange([...selectedIds, ...add]);
    };

    const sectionIds = (section: typeof PERMISSION_MATRIX[number]): string[] =>
        section.resources.flatMap(r => resourceIds(r.resource));

    const setIds = (ids: string[], on: boolean) => {
        const toggleable = ids.filter(id => !disabledSet.has(id));
        if (!toggleable.length) return;
        if (on) {
            const add = toggleable.filter(id => !selectedSet.has(id));
            if (add.length) onChange([...selectedIds, ...add]);
        } else {
            const remove = new Set(toggleable);
            onChange(selectedIds.filter(id => !remove.has(id)));
        }
    };

    // Heal grants saved before view was implicit (a user holding work_order.create
    // with no work_order.view is a user who can't open the page). Only ever adds
    // the view row, and only when a sibling action on that row is already granted,
    // so it can't loop and can't widen access beyond what the row already implies.
    useEffect(() => {
        const missing: string[] = [];
        for (const section of PERMISSION_MATRIX) {
            for (const r of section.resources) {
                if (!isViewRequired(r.resource)) continue;
                const viewId = viewIdFor(r.resource);
                if (viewId && !selectedSet.has(viewId) && !disabledSet.has(viewId)) missing.push(viewId);
            }
        }
        if (missing.length) onChange([...selectedIds, ...missing]);
    }, [selectedIds, idByCode, disabledSet]);

    const toggleCollapse = (section: string) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            next.has(section) ? next.delete(section) : next.add(section);
            return next;
        });
    };

    const font = xpFont;

    const wrapStyle = { background: '#f7f6f2', border: '1px solid #b0a898', maxHeight: 400, overflowY: 'auto' as const, padding: 6, display: 'flex', flexDirection: 'column' as const, gap: 8 };

    const linkBtn = (label: string, onClick: () => void, disabled: boolean) => (
        <button
            type="button"
            disabled={disabled}
            onClick={e => { e.stopPropagation(); onClick(); }}
            style={{
                fontFamily: font, fontSize: 9,
                background: 'none', border: 'none', padding: '0 3px',
                color: disabled ? '#a9a396' : '#00006e',
                textDecoration: disabled ? 'none' : 'underline',
                cursor: disabled ? 'default' : 'pointer',
            }}
        >{label}</button>
    );

    return (
        <div style={wrapStyle}>
            {PERMISSION_MATRIX.map(section => {
                const secIds = sectionIds(section);
                if (!secIds.length) return null;
                const isCollapsed = collapsed.has(section.section);
                const toggleable = secIds.filter(id => !disabledSet.has(id));
                const grantedCount = secIds.filter(id => selectedSet.has(id) || disabledSet.has(id)).length;
                const allSelected = toggleable.length > 0 && toggleable.every(id => selectedSet.has(id));

                const rows = isCollapsed ? [] : section.resources.flatMap(r => {
                    const actions = RESOURCE_ACTIONS[r.resource] || [];
                    const rowActions = actions
                        .map(a => ({ action: a, id: idByCode.get(permissionCode(r.resource, a.code)) }))
                        .filter((x): x is { action: typeof actions[number]; id: string } => !!x.id);
                    if (!rowActions.length) return [];
                    return [{
                        key: r.resource,
                        label: r.label,
                        hint: r.scope ? SCOPE_BADGE[r.scope] : undefined,
                        chips: rowActions.map(({ action, id }) => {
                            const inherited = disabledSet.has(id);
                            const pinned = action.code === 'view' && !inherited && isViewRequired(r.resource);
                            const code = permissionCode(r.resource, action.code);
                            return (
                                <PermissionChip
                                    key={id}
                                    label={action.label}
                                    code={code}
                                    state={inherited || pinned ? 'locked' : selectedSet.has(id) ? 'on' : 'off'}
                                    onClick={() => toggle(id, r.resource, action.code)}
                                    title={
                                        inherited ? `${code} — granted by the role, can't be removed here`
                                            : pinned ? `${code} — required by the other grants on this row`
                                                : code
                                    }
                                />
                            );
                        }),
                    }];
                });

                return (
                    <PermissionSectionTable
                        key={section.section}
                        headerActive={grantedCount > 0}
                        onHeaderClick={() => toggleCollapse(section.section)}
                        labelWidth={160}
                        title={
                            <>
                                <i className={`bi ${isCollapsed ? 'bi-caret-right-fill' : 'bi-caret-down-fill'}`} style={{ fontSize: 8, color: '#5a6472' }} />
                                {section.section}
                                <PermissionCountPill granted={grantedCount} total={secIds.length} />
                            </>
                        }
                        right={
                            <>
                                {linkBtn('All', () => setIds(secIds, true), allSelected || !toggleable.length)}
                                <span style={{ color: '#c3bfb3', fontSize: 9 }}>|</span>
                                {linkBtn('Clear', () => setIds(secIds, false), !toggleable.some(id => selectedSet.has(id)))}
                            </>
                        }
                        rows={rows}
                    />
                );
            })}
            {PERMISSION_MATRIX.every(s => !sectionIds(s).length) && (
                <div style={{ fontFamily: font, fontSize: 10, padding: 8, color: '#888', fontStyle: 'italic' }}>No permissions defined</div>
            )}
        </div>
    );
}
