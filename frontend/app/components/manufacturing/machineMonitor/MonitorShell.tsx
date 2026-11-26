'use client';

import React from 'react';
import { xpFont } from '../../shared/xpTheme';
import { CardGridSkeleton, SkeletonBar } from '@bryanadamg/terras-ui/components/Skeleton';
import { toolbar as xpToolbar } from '@bryanadamg/terras-ui/styles';
import { ShellWindow, RefreshButton } from '../../shared/shellTheme';

/**
 * The window both machine monitors live in: toolbar (summary + actions), a chip bar
 * pinned above the scroll area, and the scrolling grid.
 *
 * The chip bar sits OUTSIDE the scroll region deliberately — the filter and its
 * alarm badges stay on screen no matter how far down the grid you are.
 */
export const MonitorShell = ({
    summary, onRefresh, refreshTitle, loading, hasMachines, chipBar, actions, children,
}: {
    summary: React.ReactNode;
    onRefresh: () => void;
    refreshTitle: string;
    loading: boolean;
    hasMachines: boolean;
    chipBar: React.ReactNode;
    actions?: React.ReactNode;   // extra toolbar buttons, left of Refresh
    children: React.ReactNode;
}) => (
    <div className="fade-in" style={{ fontFamily: xpFont }}>
        <ShellWindow fill="page">
            <div style={xpToolbar()}>
                <span>{summary}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <RefreshButton onClick={onRefresh} label={refreshTitle} />
                    {actions}
                </span>
            </div>
            {(loading || hasMachines) && (
                <div style={{ padding: '6px 8px 0', background: '#ece9d8'}}>
                    {/* Placeholder chips hold the strip's height while loading — without
                        them the whole grid jumps down when the real chip bar appears. */}
                    {loading
                        ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {[70, 96, 84, 110].map((w, i) => (
                                <SkeletonBar key={i} width={w} height={17} />
                            ))}
                        </div>
                        : chipBar}
                </div>
            )}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, background: '#ece9d8'}}>
                {children}
            </div>
        </ShellWindow>
    </div>
);

/**
 * Loading state for the grid. Geometry mirrors `gridColumns`/`MachineCard` so the
 * real grid drops straight into the skeleton's tracks with no shift — a body deep
 * enough for the run readout plus whatever the domain hangs under it.
 */
export const MonitorGridSkeleton = ({ bodyHeight }: { bodyHeight?: number }) => (
    <CardGridSkeleton
        count={12}
        minWidth={240}
        gap={8}
        bodyLines={3}
        bodyHeight={bodyHeight ?? (96)}
    />
);
