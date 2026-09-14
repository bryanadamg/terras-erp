'use client';

import React from 'react';
import { useData } from '../../context/DataContext';
import { ProgressBar, xpFont } from './xpTheme';

/**
 * Determinate progress strip for the initial data load.
 *
 * This is the one place in the app where a filling bar is honest: the first
 * fetchData round fans out to a known number of requests (master data, items,
 * BOMs, MOs, PRs, samples, partners), and DataContext counts responses as they
 * land. Everywhere else a single request is in flight — nothing to measure —
 * so those keep the indeterminate marquee / skeleton rows.
 *
 * Renders nothing once the tracked round finishes, and never appears at all for
 * the small route-scoped fetches that follow.
 */
export default function AppLoadBar() {
    const { loadProgress } = useData();

    const { done, total } = loadProgress;
    if (total === 0 || done >= total) return null;

    const pct = (done / total) * 100;

    return (
        <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-label="Loading data"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '4px 12px',
                background: '#ece9d8',
                borderBottom: '1px solid #b0aaa0',
                fontFamily: xpFont,
                fontSize: 11,
                color: '#33393f',
                userSelect: 'none',
            }}
        >
            <span style={{ whiteSpace: 'nowrap' }}>Loading data…</span>
            <span style={{ flex: 1, maxWidth: 320 }}>
                <ProgressBar pct={pct} tone="blue" height={10} />
            </span>
            <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {done} of {total}
            </span>
        </div>
    );
}
