'use client';
import { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import type { PackagingType } from './packingBoxes';
import { API_BASE } from './apiBase';

// Same normalization every other caller uses (see CLAUDE.md > API Base URL).

// The packaging master (Box S/M/L/XL, Plastic Bag, Custom) as every pack screen
// needs it: the whole list, not a page of it. It is a lookup feed — the pack
// form reads a tare back out of it by id to preview brutto — so windowing it
// would be a wrong answer rather than a short list (see CLAUDE.md), and the
// endpoint returns a bare array to match.
//
// Shared rather than fetched at each call site so the desktop pack modal, the
// mobile scanner and anything added later can never diverge on which types the
// floor may pick (`active` only) or on what order they appear in.

export function usePackagingTypes(enabled: boolean = true) {
    const { authFetch } = useData() as any;
    const [types, setTypes] = useState<PackagingType[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!enabled) return;
        let alive = true;
        setLoading(true);
        (async () => {
            try {
                const res = await authFetch(`${API_BASE}/packaging-types`);
                const data = res.ok ? await res.json() : [];
                if (alive) setTypes(Array.isArray(data) ? data : []);
            } catch {
                // A failed load leaves the picker empty, which the pack form's own
                // gate then reports as "packaging type is required" — the packer is
                // blocked with a reason rather than shown a silent broken dropdown.
                if (alive) setTypes([]);
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [enabled, authFetch]);

    return { packagingTypes: types, loadingPackagingTypes: loading };
}
