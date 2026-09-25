'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * A page's active tab, remembered for this browser tab (sessionStorage) so leaving
 * and coming back lands where you were. Restored after mount, not in the useState
 * initializer: pages server-render, and reading storage during render would be a
 * hydration mismatch — so the default tab can show for a frame first.
 *
 * `valid` rejects a saved key the page no longer offers (an admin-only tab after a
 * non-admin logs in, a work-center type that was removed). It is re-checked when
 * the list changes, since permission- or data-driven tabs arrive after mount.
 * A deep link that forces a tab should call setTab in its own effect declared
 * after this hook, so it runs later and wins.
 */
export function useRememberedTab<K extends string>(pageKey: string, fallback: K, valid?: readonly K[]) {
    const storageKey = `terras_tab:${pageKey}`;
    const [tab, setTabState] = useState<K>(fallback);
    const validSig = valid?.join(',');

    useEffect(() => {
        try {
            const saved = sessionStorage.getItem(storageKey) as K | null;
            if (saved && (!valid || valid.includes(saved))) setTabState(saved);
        } catch { /* storage blocked: keep the default tab */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageKey, validSig]);

    const setTab = useCallback((k: K) => {
        setTabState(k);
        try { sessionStorage.setItem(storageKey, k); } catch { /* not remembered, still switches */ }
    }, [storageKey]);

    return [tab, setTab] as const;
}
