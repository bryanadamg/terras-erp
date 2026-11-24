'use client';

import React, { useMemo } from 'react';
import { xpFont, CHIP_RADIUS } from '../shared/xpTheme';
import { PermissionSectionTable, PermissionSectionRow } from '../shared/permissionChips';
import { useData } from '../../context/DataContext';
import { RoleLike } from './RoleFormModal';

/** Tint per scope kind — matches the collapsed-row chip colors so the two views read as the same object. */
const SCOPE_TINT = {
    wc: { bg: '#fff3d6', border: '#c8a04a', fg: '#5e3000' },
    cat: { bg: '#e6f0ff', border: '#6a8fc8', fg: '#0a2a5e' },
    loc: { bg: '#f0e6ff', border: '#8f6ac8', fg: '#2a0a5e' },
};

function ScopeChip({ label, kind }: { label: string; kind: keyof typeof SCOPE_TINT }) {
    const t = SCOPE_TINT[kind];
    return (
        <span style={{
            fontFamily: xpFont,
            fontSize: 9.5,
            lineHeight: 1.6,
            background: t.bg,
            border: `1px solid ${t.border}`,
            color: t.fg,
            padding: '1px 6px',
            borderRadius: CHIP_RADIUS,
            whiteSpace: 'nowrap',
        }}>{label}</span>
    );
}

/**
 * What a role is limited to — the counterpart to `PermissionBreakdown` in the
 * role and user detail panes, through the same `PermissionSectionTable` card.
 * Category/location ids resolve to their full paths here so callers pass the role.
 */
export default function ScopeBreakdown({ role }: { role?: RoleLike | null }) {
    const { categories, locations } = useData();
    const categoryName = useMemo(() => new Map<string, string>(
        categories.map((c: any) => [c.id, (c.path_names || [c.name]).join(' / ')])), [categories]);
    const locationName = useMemo(() => new Map<string, string>(
        locations.map((l: any) => [l.id, l.full_path || l.name])), [locations]);

    const workCenterTypes = role?.allowed_work_center_types || [];
    const categoryLabels = (role?.allowed_categories || []).map(id => categoryName.get(id) || id);
    const locationLabels = (role?.allowed_locations || []).map(id => locationName.get(id) || id);

    const rows: PermissionSectionRow[] = [];
    if (workCenterTypes.length > 0) {
        rows.push({ key: 'wc', label: 'Station types', chips: workCenterTypes.map(t => <ScopeChip key={t} label={t} kind="wc" />) });
    }
    if (categoryLabels.length > 0) {
        rows.push({ key: 'cat', label: 'Categories', chips: categoryLabels.map(c => <ScopeChip key={c} label={c} kind="cat" />) });
    }
    if (locationLabels.length > 0) {
        rows.push({ key: 'loc', label: 'Locations', chips: locationLabels.map(l => <ScopeChip key={l} label={l} kind="loc" />) });
    }
    if (rows.length === 0) {
        return (
            <div style={{ fontFamily: xpFont, fontSize: 11, color: '#6b6558' }}>
                Unrestricted — every station type, category and location.
            </div>
        );
    }

    return <PermissionSectionTable title="Scope Restrictions" rows={rows} labelWidth={140} />;
}
