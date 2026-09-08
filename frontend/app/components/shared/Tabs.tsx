'use client';

import React from 'react';
import UITabs from '@bryanadamg/terras-ui/components/Tabs';

// `label` is a node, not a string, so a tab can carry a small state marker
// alongside its text (the avatar picker's "this slot is pinned" dot). Text is
// still the norm — this is not an invitation to build a second control in a tab.
//
// `icon` stays a bootstrap-icons *name* (`bi-gear`), not a node: every call site
// passes one, and the package has no icon-set opinion, so the adapter below is
// where the `bi` prefix gets attached.
export type TabDef<K extends string = string> = { key: K; label: React.ReactNode; icon?: string };

/**
 * Shared tab strip — a thin adapter over terras-ui's Tabs, which owns the strip
 * chrome and the active/inactive faces. Renders only the row of tab buttons;
 * page chrome (title bars, bordered panels) stays with the caller since
 * different pages wrap their tabs differently.
 *
 * `classic` is still accepted so the 14 call sites did not have to change, but it
 * is inert — the strip retones itself off `.ui-style-classic` in CSS now, rather
 * than forking the whole component on a prop.
 */
export function Tabs<K extends string>({ tabs, activeKey, onChange, classic: _classic, right }: {
    tabs: TabDef<K>[];
    activeKey: K;
    onChange: (key: K) => void;
    /** @deprecated Inert — terras-ui reads the theme from `.ui-style-classic`. */
    classic?: boolean;
    /** Optional trailing control (e.g. a refresh button) pushed to the far end of the strip. */
    right?: React.ReactNode;
}) {
    const mapped = React.useMemo(
        () => tabs.map(t => ({
            key: t.key,
            label: t.label,
            icon: t.icon ? <i className={`bi ${t.icon}`} style={{ fontSize: 11 }} /> : undefined,
        })),
        [tabs],
    );

    return <UITabs tabs={mapped} activeKey={activeKey} onChange={onChange} right={right} />;
}
