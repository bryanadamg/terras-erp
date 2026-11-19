'use client';

import React from 'react';
import { TableBlockSkeleton } from './xpTheme';
import { SkeletonBar } from '@bryanadamg/terras-ui/components/Skeleton';
import { viewShellStyle, scrollAreaStyle } from './shellTheme';
import { toolbar as xpToolbar } from '@bryanadamg/terras-ui/styles';

/**
 * The generic list silhouette, for the one case where no route may draw
 * itself: a cold start with no token (MainLayout), where mounting the page
 * would fire fetches that can only 401.
 *
 * Deliberately NOT used as per-route `loading.tsx` files. Every page already
 * draws its own measured skeleton inside its real chrome while its data loads,
 * and the page's server render carries it, so a route-level fallback only ever
 * added a second, differently shaped skeleton in front of the first. Routes are
 * prefetched (hover + PREFETCH_ROUTES), so a click has nothing to cover.
 *
 * Server-rendered HTML with no hydration behind it, so row counts overshoot
 * and clip rather than being measured the way a live TableSkeleton is.
 */

/** Same `viewShellStyle`/`xpToolbar` chrome a real list page wears (the page title lives in the app header). */
export function ListPageSkeleton({ cols = 8 }: { cols?: number }) {
    return (
        <div style={viewShellStyle('page')}>
            <div style={xpToolbar()}>
                <SkeletonBar width={200} height={18} />
                <SkeletonBar width={110} height={18} />
                <span style={{ flex: 1 }} />
                <SkeletonBar width={100} height={18} />
            </div>
            <div style={{ ...scrollAreaStyle, overflow: 'hidden' }}>
                <TableBlockSkeleton cols={cols} rows={60} />
            </div>
        </div>
    );
}
