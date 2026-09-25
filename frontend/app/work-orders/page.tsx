'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import WorkOrderListView, { WO_TABS } from '../components/manufacturing/WorkOrderListView';
import { useRememberedTab } from '../hooks/useRememberedTab';
import { useData } from '../context/DataContext';
import { usePaginatedFetch } from '../context/usePaginatedList';
import { API_BASE } from '../components/shared/apiBase';

const WO_PAGE_SIZE = 50;
const CACHE_KEY = 'wo_page_cache';
const WO_TAB_KEYS: string[] = WO_TABS.map(t => t.key);

function readCache() {
    try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}
function writeCache(items: any[], total: number) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ items, total })); } catch {}
}

export default function WorkOrdersPage() {
    const { workCenters, itemIndex, authFetch, subscribeLiveEvents } = useData();


    const [filterStatus, setFilterStatus] = useState('');
    const [filterGroup, setFilterGroup] = useState('');
    const [filterWC, setFilterWC] = useState('');
    const [filterComponentId, setFilterComponentId] = useState('');
    const [filterUnprinted, setFilterUnprinted] = useState(false);
    const [activeTab, setActiveTab] = useRememberedTab('work-orders', 'ALL', WO_TAB_KEYS);

    // Deep link from another screen: /work-orders?wo=WO-1234 lands with the list
    // filtered to that code. Same shape as /manufacturing-orders?mo= — seed, then
    // router.replace the param away so a later manual search isn't re-clobbered by
    // a re-render, and a ref so re-entering the effect doesn't fight the user.
    const searchParams = useSearchParams();
    const router = useRouter();
    const consumedWORef = useRef<string | null>(null);

    // Page window, fetch, loading flag, the debounced search box and the
    // stale-response race guard come from the shared hook. The sessionStorage
    // cache below is layered on top of it (see the two effects/derivations after).
    const {
        rows, total, loading, page: woPage, setPage: setWoPage,
        search, searchInput: woSearch, setSearch: handleSearch,
        refetch: fetchWOs,
    } = usePaginatedFetch<any>({
        endpoint: `${API_BASE}/work-orders`,
        authFetch,
        pageSize: WO_PAGE_SIZE,
        // Falsy values are dropped from the query string, and any change here
        // restarts at page 1 inside the hook — so no setWoPage(1) in the handlers.
        params: {
            status: filterStatus,
            group_id: filterGroup,
            work_center_id: filterWC,
            center_type: activeTab === 'ALL' ? '' : activeTab,
            component_item_id: filterComponentId,
            unprinted: filterUnprinted,
        },
    });

    useEffect(() => {
        const code = searchParams.get('wo');
        if (code && code !== consumedWORef.current) {
            consumedWORef.current = code;
            handleSearch(code);
            setActiveTab('ALL'); // a remembered type tab could hide the linked WO
            router.replace('/work-orders');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // --- sessionStorage cache (deliberate: return navigation paints instantly) ---
    // Read once at mount and shown until the first response for this visit lands.
    const [seed] = useState<{ items: any[]; total: number } | null>(() => readCache());
    const initialRowsRef = useRef(rows);
    const hasResponse = rows !== initialRowsRef.current;
    const woList: any[] = hasResponse ? rows : (seed?.items || rows);
    const woTotal: number = hasResponse ? total : (seed?.total || total);

    // Write side. Keyed on `rows` *identity*, which only changes when a response is
    // committed — so a failed fetch (rows untouched) never overwrites a good cache,
    // and a filter change alone can't persist the previous view's rows under the
    // default-view key. Only the default view (page 1, no filters) is cached.
    const cachedRowsRef = useRef(rows);
    const isDefaultView = woPage === 1 && !filterStatus && !filterGroup && !filterWC
        && !search && activeTab === 'ALL' && !filterComponentId && !filterUnprinted;
    useEffect(() => {
        if (rows === cachedRowsRef.current) return;
        cachedRowsRef.current = rows;
        if (isDefaultView) writeCache(rows, total);
    }, [rows, total, isDefaultView]);

    // Live updates: refetch the list when a debounced batch of production events
    // arrives over the WebSocket (this page owns its list; context can't update it).
    useEffect(() => subscribeLiveEvents(['production'], () => fetchWOs()),
        [subscribeLiveEvents, fetchWOs]);

    const handleFilterStatus = (v: string) => setFilterStatus(v);
    const handleFilterWCChange = (groupId: string, wcId: string) => { setFilterGroup(groupId); setFilterWC(wcId); };
    const handleFilterComponent = (itemId: string) => setFilterComponentId(itemId);
    const handleFilterUnprinted = (v: boolean) => setFilterUnprinted(v);
    const handleTabChange = (tab: string) => setActiveTab(tab);

    const handleUpdateWO = async (id: string, payload: any) => {
        const res = await authFetch(`${API_BASE}/work-orders/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (res.ok) fetchWOs();
        return res;
    };

    const handleUpdateWOStatus = async (id: string, status: string) => {
        const res = await authFetch(`${API_BASE}/work-orders/${id}/status?status=${encodeURIComponent(status)}`, { method: 'PUT' });
        if (res.ok) fetchWOs();
        return res;
    };

    const handleDeleteWO = async (id: string) => {
        const res = await authFetch(`${API_BASE}/work-orders/${id}`, { method: 'DELETE' });
        if (res.ok) fetchWOs();
    };

    const fetchMO = useCallback(async (moId: string) => {
        const res = await authFetch(`${API_BASE}/manufacturing-orders/${moId}`);
        if (!res.ok) return null;
        return res.json();
    }, [authFetch, API_BASE]);

    return (
        <WorkOrderListView
            workOrders={woList}
            total={woTotal}
            page={woPage}
            pageSize={WO_PAGE_SIZE}
            onPageChange={setWoPage}
            workCenters={workCenters || []}
            filterStatus={filterStatus}
            filterGroup={filterGroup}
            filterWC={filterWC}
            woSearch={woSearch}
            activeTab={activeTab}
            itemIndex={itemIndex}
            filterComponentId={filterComponentId}
            filterUnprinted={filterUnprinted}
            onTabChange={handleTabChange}
            onFilterStatus={handleFilterStatus}
            onFilterWCChange={handleFilterWCChange}
            onFilterComponent={handleFilterComponent}
            onFilterUnprinted={handleFilterUnprinted}
            onSearch={handleSearch}
            onClearFilters={() => {
                setFilterStatus(''); setFilterGroup(''); setFilterWC(''); handleSearch('');
                setFilterComponentId(''); setFilterUnprinted(false);
            }}
            onUpdate={handleUpdateWO}
            onUpdateStatus={handleUpdateWOStatus}
            onDelete={handleDeleteWO}
            onFetchMO={fetchMO}
            onRefresh={() => fetchWOs()}
            loading={loading}
        />
    );
}
