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
 * The strip retones itself off `.ui-style-classic` in CSS,
 * than forking the whole component on a prop.
 */
export function Tabs<K extends string>({ tabs, activeKey, onChange, right }: {
    tabs: TabDef<K>[];
    activeKey: K;
    onChange: (key: K) => void;
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

    // The strip must NOT be a scroll container. terras-ui gives it `overflow-x: auto`
    // for tabs that might not fit, but `overflow-x: auto` forces `overflow-y` to
    // compute to `auto` too — and the active tab hangs 1px below the padding box on
    // purpose (`marginBottom: -1`, the open seam into the pane). That 1px is vertical
    // scrollable overflow, so every strip in the app rendered a stray scrollbar in its
    // corner. `overflow-y: hidden` is not the fix: it clips the seam, which is the one
    // thing the strip exists to draw.
    //
    // Nothing here overflows horizontally — the widest strip in the app is 4 short
    // tabs — so the scroll container was speculative and the spill is the honest
    // fallback. If a strip ever does outgrow its row, wrap it rather than restoring
    // `auto`, or the scrollbar comes straight back.
    return <UITabs tabs={mapped} activeKey={activeKey} onChange={onChange} right={right}
        style={{ overflowX: 'visible' }} />;
}
