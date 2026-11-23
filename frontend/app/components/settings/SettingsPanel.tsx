'use client';

import React from 'react';
import { SectionTitle } from '../shared/xpTheme';
import { FormSection } from '@bryanadamg/terras-ui/components/FormSection';

/**
 * One group inside the Settings window.
 *
 * Every settings panel used to draw its own bevelled window with its own
 * colored XP title bar — inside a tab that already sits in the Settings window.
 * That nested the chrome one level too deep and, because each panel picked its
 * own hue, made eight peers shout at the same volume: nothing led, nothing
 * supported. A settings panel is a *section of a form*, not a window, so it
 * uses the app's one section chrome (`FormSection`) in both themes.
 *
 * `right` holds the group's own action (Refresh, Add User, Create Snapshot).
 * `flush` drops the body padding for a full-bleed table.
 * `fill` stretches the panel to its parent's height and makes the body the
 * scroll pane (the Access Control list/detail panes).
 */
export default function SettingsPanel({ icon, title, right, flush = false, fill = false, children }: {
    icon: string;
    title: React.ReactNode;
    right?: React.ReactNode;
    flush?: boolean;
    fill?: boolean;
    children: React.ReactNode;
}) {
    return (
        <FormSection
            style={fill ? { marginBottom: 0, display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' } : { marginBottom: 0 }}
            bodyStyle={{
                ...(flush ? { padding: 0 } : null),
                ...(fill ? { flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' } : null),
            }}
            title={<SectionTitle icon={icon} right={right}>{title}</SectionTitle>}
        >
            {children}
        </FormSection>
    );
}
