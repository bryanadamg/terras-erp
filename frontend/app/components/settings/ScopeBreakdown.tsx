'use client';

import React from 'react';
import { xpFont, ExpandedRowPanel, ExpandedRowPanelBody, CHIP_RADIUS } from '../shared/xpTheme';
import { PermissionSectionTable, PermissionSectionRow } from '../shared/permissionChips';

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
 * The expanded scope detail on a role row — the counterpart to `PermissionBreakdown`.
 * Collapsed view shows a restriction count; this fills in what's actually restricted,
 * through the same `PermissionSectionTable` card the permission grid uses.
 */
export default function ScopeBreakdown({ workCenterTypes, categories, locations}: {
    workCenterTypes: string[];
    categories: string[];
    locations: string[];
}) {
    const rows: PermissionSectionRow[] = [];
    if (workCenterTypes.length > 0) {
        rows.push({
            key: 'wc',
            label: 'Work Center Types',
            hint: `${workCenterTypes.length}`,
            chips: workCenterTypes.map(t => <ScopeChip key={t} label={t} kind="wc" />),
        });
    }
    if (categories.length > 0) {
        rows.push({
            key: 'cat',
            label: 'Categories',
            hint: `${categories.length}`,
            chips: categories.map(c => <ScopeChip key={c} label={c} kind="cat" />),
        });
    }
    if (locations.length > 0) {
        rows.push({
            key: 'loc',
            label: 'Locations',
            hint: `${locations.length}`,
            chips: locations.map(l => <ScopeChip key={l} label={l} kind="loc" />),
        });
    }
    if (rows.length === 0) return null;

    return (
        <ExpandedRowPanel>
            <ExpandedRowPanelBody>
                <PermissionSectionTable
                    title="Scope Restrictions"
                    rows={rows}
                    labelWidth={140}
                    style={{ maxWidth: 900 }}
                />
            </ExpandedRowPanelBody>
        </ExpandedRowPanel>
    );
}
