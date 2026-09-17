'use client';

import UIAppLoadBar from '@bryanadamg/terras-ui/components/AppLoadBar';
import { useData } from '../../context/DataContext';

/**
 * Determinate progress strip for the initial data load — a thin adapter over
 * terras-ui's AppLoadBar, which was extracted from this file and owns the strip
 * itself. The counting stays here: DataContext's `loadProgress` is app state.
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

    return <UIAppLoadBar done={loadProgress.done} total={loadProgress.total} />;
}
