'use client';

import React from 'react';
import { TableBlockSkeleton, CardGridSkeleton, PanelSkeleton, SkeletonBar } from './xpTheme';
import { xpTitleBar, xpToolbar, viewShellStyle, scrollAreaStyle } from './shellTheme';

/**
 * Route-level loading shapes, one per page silhouette.
 *
 * These back the `loading.tsx` file each route segment owns — Next wraps that
 * file as the segment's `<Suspense fallback>`, so it paints while the route's
 * chunk and data are still coming and disappears the moment the page can draw.
 * Putting the shape next to the route rather than in one app-wide shell is the
 * whole point: a dashboard is not a table, and a loom grid is not either, but a
 * single boot shell had to guess one of them for all forty routes.
 *
 * Shape only — nothing here fetches, reads context or takes non-serializable
 * props, so a `loading.tsx` can stay a server component.
 *
 * The chrome (window bevel, title bar, toolbar strip) is the same
 * `viewShellStyle`/`xpTitleBar`/`xpToolbar` a real page wears, so the swap moves
 * nothing. Row counts overshoot and clip rather than stopping mid-panel: this is
 * server-rendered HTML with no hydration behind it, so the panel can't be
 * measured the way a live list's TableSkeleton measures `fillHeight`.
 */

/** Window chrome every page shape shares: bevel, title bar, toolbar strip. */
function PageShell({ toolbar = true, children }: { toolbar?: boolean; children: React.ReactNode }) {
    return (
        <div style={viewShellStyle('page')}>
            <div style={xpTitleBar()}>
                <SkeletonBar width={140} height={8} />
                <SkeletonBar width={54} height={8} />
            </div>
            {toolbar && (
                <div style={xpToolbar()}>
                    <SkeletonBar width={200} height={18} />
                    <SkeletonBar width={110} height={18} />
                    <span style={{ flex: 1 }} />
                    <SkeletonBar width={100} height={18} />
                </div>
            )}
            {children}
        </div>
    );
}

/** The paginated-list silhouette — ~30 of the 40 routes. */
export function ListPageSkeleton({ cols = 8 }: { cols?: number }) {
    return (
        <PageShell>
            <div style={{ ...scrollAreaStyle, overflow: 'hidden' }}>
                <TableBlockSkeleton cols={cols} rows={60} />
            </div>
        </PageShell>
    );
}

/** Card-grid pages: the loom and vessel monitors. */
export function GridPageSkeleton({ minWidth = 250, count = 24 }: { minWidth?: number; count?: number }) {
    return (
        <PageShell>
            <div style={{ ...scrollAreaStyle, overflow: 'hidden', padding: 8, background: '#f0efe8' }}>
                <CardGridSkeleton count={count} minWidth={minWidth} />
            </div>
        </PageShell>
    );
}

/** Split-pane pages: routing, locations, settings, print designer. */
export function PanesPageSkeleton({ left = 260 }: { left?: number }) {
    return (
        <PageShell>
            <div style={{ ...scrollAreaStyle, overflow: 'hidden', display: 'flex', gap: 6, padding: 6 }}>
                <div style={{ width: left, flexShrink: 0, border: '1px solid #c0bdb5', background: '#fff', padding: 8 }}>
                    <PanelSkeleton sections={3} rows={5} />
                </div>
                <div style={{ flex: 1, minWidth: 0, border: '1px solid #c0bdb5', background: '#fff', padding: 8 }}>
                    <PanelSkeleton sections={4} rows={6} />
                </div>
            </div>
        </PageShell>
    );
}

/** The dashboard's own silhouette: KPI strip, two panel rows, trend strip. */
export function DashboardPageSkeleton() {
    const panel = (h: number, flex: string | number, width?: number) => (
        <div style={{
            flex, width, minWidth: 0, height: h,
            border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', background: '#ece9d8',
        }}>
            <div style={{ ...xpTitleBar(), height: 20 }}><SkeletonBar width={120} height={7} /></div>
            <div style={{ padding: 6, background: '#fff', height: h - 24, overflow: 'hidden' }}>
                <TableBlockSkeleton cols={4} rows={14} header={false} />
            </div>
        </div>
    );

    return (
        <div style={{ background: '#ece9d8', padding: 4 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 6 }}>
                {Array.from({ length: 7 }, (_, i) => (
                    <div key={i} style={{
                        border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                        background: '#f5f4ef', padding: '8px 4px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                    }}>
                        <SkeletonBar width={42} height={18} />
                        <SkeletonBar width="60%" height={6} />
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                {panel(250, 1)}
                {panel(250, '0 0 260px', 260)}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
                {panel(280, 1)}
                {panel(280, '0 0 320px', 320)}
                {panel(280, '0 0 240px', 240)}
            </div>
        </div>
    );
}
