import { useCallback, useRef, useState, useEffect } from 'react';

/**
 * page/total bookkeeping shared by every server-paginated domain in
 * DataContext (items, MOs, PRs, audit-logs, stock-ledger, sales-orders).
 * Deliberately just page+total — the fetch URL, response shape, and any
 * extra filters stay in DataContext itself, since those genuinely differ
 * per domain (slim mode, race-guard generations, category/status filters).
 */
export function usePageState() {
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    return { page, setPage, total, setTotal };
}

/**
 * Debounced-commit shape shared by every text search box that drives a
 * server fetch: the input echoes instantly, the committed value (which
 * triggers the actual request) only updates after a quiet period, and
 * committing always resets to page 1.
 *
 * `setPage` is optional — audit/report-style pages that don't have their
 * own dedicated search box don't need it wired.
 */
export function useDebouncedSearch(setPage?: (p: number) => void, delayMs = 350, initial = '') {
    const [input, setInput] = useState(initial);
    const [committed, setCommitted] = useState(initial);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const setSearch = useCallback((v: string) => {
        setInput(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { setCommitted(v); setPage?.(1); }, delayMs);
    }, [setPage, delayMs]);

    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    return { input, committed, setSearch };
}

/**
 * Push a locally-held input value out to an *external* committed setter after a
 * pause — for search boxes whose committed value lives somewhere else (DataContext's
 * shared `moSearch`/`prSearch`, which outlive the view and are read by other pages),
 * so `useDebouncedSearch` can't own it.
 *
 * Only `value` is in the dependency list, deliberately: re-arming the timer when the
 * external value or setter changes would fight the very update it just committed.
 */
export function useDebouncedCommit(
    value: string, committed: string, commit: (v: string) => void, delayMs = 350,
) {
    useEffect(() => {
        const id = setTimeout(() => { if (value !== committed) commit(value); }, delayMs);
        return () => clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);
}

interface PaginatedFetchOptions {
    /** Absolute endpoint URL, no query string — e.g. `${API_BASE}/colors`. */
    endpoint: string;
    authFetch: (url: string, options?: any) => Promise<Response>;
    pageSize?: number;
    /**
     * Extra filter params. Falsy values (''/null/undefined/false) are dropped, so a
     * cleared filter simply disappears from the query string. Changing any of them
     * restarts at page 1.
     */
    params?: Record<string, any>;
    /** Seeds the search box — for deep links like `/colors?search=<code>`. */
    initialSearch?: string;
    searchDelayMs?: number;
    /** Skip fetching entirely (inactive tab, missing prerequisite). */
    enabled?: boolean;
    /**
     * Called when a fetch fails (non-OK response or a thrown request). Wire this to
     * a toast — several of the hand-rolled fetches this hook replaced showed one, and
     * without it a failed load is indistinguishable from an empty result.
     */
    onError?: (message: string) => void;
}

/**
 * Self-fetching server-paginated list: page/total state, a debounced `?search=`
 * box, the `{items, total, ...}` unwrap, a loading flag, and — the part every
 * hand-rolled copy of this omits — a **stale-response race guard**.
 *
 * The pages that predate this hook each build their own `fetchX` useCallback and
 * run it from a useEffect, which means overlapping requests commit in *arrival*
 * order, not dispatch order: type fast, or flip filters on a slow link, and an
 * older response can land last and overwrite the newer one. Only DataContext's
 * production-runs slice guarded against that (its `prGenRef` generation counter);
 * the generation counter here is the same idea, applied once for everyone.
 *
 * Sends the canonical `page`/`size` params — see backend `core/pagination.py`,
 * which also still accepts the legacy `skip`/`limit` spelling.
 */
export function usePaginatedFetch<T = any>({
    endpoint, authFetch, pageSize = 50, params, initialSearch = '', searchDelayMs = 350, enabled = true, onError,
}: PaginatedFetchOptions) {
    // Held in a ref so an inline `onError={m => showToast(m)}` doesn't re-arm the
    // fetch effect on every render.
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;
    // Page reset on a search change is handled by `queryKey` below, so the hook's
    // own setPage wiring isn't needed here.
    const { input: searchInput, committed: search, setSearch } = useDebouncedSearch(undefined, searchDelayMs, initialSearch);

    // `params` is a fresh object literal on every render, so its identity is
    // useless as a dependency — the serialized form is what actually changed.
    const paramsKey = JSON.stringify(params ?? {});
    const queryKey = `${paramsKey}\u0000${search}`;
    const paramsRef = useRef(params);
    paramsRef.current = params;

    // page travels WITH the filter key in one state object, so a filter change is a
    // single transition to {page: 1, key: new} and therefore a single fetch. Holding
    // them separately means the fetch effect sees the new filters against the old
    // page first, and fires twice.
    const [q, setQ] = useState({ page: 1, key: queryKey, nonce: 0 });
    useEffect(() => {
        // Page 7 of the previous result set is meaningless against a new one — the
        // server would return an empty slice and the list would look broken.
        setQ(prev => (prev.key === queryKey ? prev : { page: 1, key: queryKey, nonce: prev.nonce }));
    }, [queryKey]);

    const setPage = useCallback((p: number) => setQ(prev => ({ ...prev, page: p })), []);
    const refetch = useCallback(() => setQ(prev => ({ ...prev, nonce: prev.nonce + 1 })), []);

    const [rows, setRows] = useState<T[]>([]);
    const [total, setTotal] = useState(0);
    /** Everything in the response body other than `items`/`total` — per-domain extras. */
    const [meta, setMeta] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(enabled);
    /** Last fetch failure, cleared on the next success. Lets a view tell "failed" from "empty". */
    const [error, setError] = useState<string | null>(null);
    const genRef = useRef(0);

    /**
     * Snap back into range when the set shrinks under the current offset — deleting the
     * last rows on page 5, or any mutation that drops the total, otherwise leaves the
     * view showing an empty slice with the Pager reading "Page 5 / 4". Every hand-rolled
     * list this hook replaced clamped (`Math.min(page, pageCount)`) for exactly this.
     *
     * Only ever clamps *down*, and only once `total` has been reported, so it can't fight
     * a legitimate page change whose response is still in flight.
     */
    const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    useEffect(() => {
        setQ(prev => (prev.page > pageCount ? { ...prev, page: pageCount } : prev));
    }, [pageCount]);

    const buildQuery = useCallback((page: number, size: number) => {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(paramsRef.current ?? {})) {
            if (v === undefined || v === null || v === '' || v === false) continue;
            sp.set(k, String(v));
        }
        if (search) sp.set('search', search);
        sp.set('page', String(page));
        sp.set('size', String(size));
        return sp.toString();
    }, [search]);

    useEffect(() => {
        if (!enabled) return;
        const gen = ++genRef.current;
        setLoading(true);
        (async () => {
            try {
                const res = await authFetch(`${endpoint}?${buildQuery(q.page, pageSize)}`);
                if (gen !== genRef.current) return;   // a newer request is already in flight
                if (!res.ok) {
                    // 403 is a normal outcome for a user without the read permission —
                    // reporting it would nag on every load of a page they can see.
                    if (res.status !== 403) {
                        setError(`Request failed (${res.status})`);
                        onErrorRef.current?.(`Request failed (${res.status})`);
                    }
                    return;
                }
                const { items, total: t, ...rest } = await res.json();
                if (gen !== genRef.current) return;   // ...or landed while we parsed
                setRows(items || []);
                setTotal(t || 0);
                setMeta(rest);
                setError(null);
            } catch (e: any) {
                if (gen !== genRef.current) return;
                const msg = e?.message || 'Request failed';
                setError(msg);
                onErrorRef.current?.(msg);
            } finally {
                if (gen === genRef.current) setLoading(false);
            }
        })();
    }, [enabled, endpoint, authFetch, q, pageSize, buildQuery]);

    /**
     * The whole filtered set in one shot, bypassing the page window — for "print
     * table" / CSV export, which must cover every match rather than the rows on
     * screen. Does not touch list state. `size=0` is the uncapped contract.
     */
    const fetchAll = useCallback(async (): Promise<T[]> => {
        const res = await authFetch(`${endpoint}?${buildQuery(1, 0)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        return d.items || [];
    }, [authFetch, endpoint, buildQuery]);

    return {
        rows, total, meta, loading, error,
        page: q.page, setPage, pageSize,
        /** Committed (debounced) value actually sent to the server. */
        search,
        /** Live input echo — bind this to the search box. */
        searchInput, setSearch,
        refetch, fetchAll,
    };
}
