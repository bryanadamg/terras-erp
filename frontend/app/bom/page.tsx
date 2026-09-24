'use client';

import BOMView from '../components/bom/BOMView';
import { useData } from '../context/DataContext';
import { usePaginatedFetch } from '../context/usePaginatedList';
import { useConfirm } from '../context/ConfirmContext';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useCallback } from 'react';
import { API_BASE } from '../components/shared/apiBase';

const BOM_PAGE_SIZE = 50;

export default function BOMPage() {
    const { items, attributes, sizes, locations, operations, workCenters, partners, companyProfile, fetchData, authFetch, filters, subscribeLiveEvents } = useData();
    const { confirm } = useConfirm();
    const searchParams = useSearchParams();
    const [initialCreateState, setInitialCreateState] = useState<any>(null);

    // Self-managed paginated BOM list (decoupled from DataContext). Page window,
    // fetch, loading flag, the debounced search box and the stale-response race
    // guard all come from the shared hook (context/usePaginatedList.ts).
    const [showRootOnly, setShowRootOnly] = useState(true);

    const {
        rows: bomList, total: bomTotal, loading: bomLoading,
        page: bomPage, setPage: setBomPage,
        searchInput: bomSearch, setSearch: handleBomSearch,
        refetch: fetchBomList,
    } = usePaginatedFetch<any>({
        endpoint: `${API_BASE}/boms/summary`,
        authFetch,
        pageSize: BOM_PAGE_SIZE,
        // false is dropped from the query string, which matches the endpoint default.
        // Toggling it restarts at page 1 inside the hook — no setBomPage(1) needed.
        params: { root_only: showRootOnly },
    });

    // Live refresh: a BOM created/updated/deleted elsewhere (WS BOM_UPDATE) reloads
    // the current page in place. This page owns its own list, so DataContext can't
    // refresh it for us — subscribe and re-pull the same page/search/filter.
    useEffect(() => subscribeLiveEvents(['bom'], () => fetchBomList()), [subscribeLiveEvents, fetchBomList]);

    useEffect(() => {
        if (searchParams.get('action') === 'create_bom') {
            setInitialCreateState({
                item_id: searchParams.get('item_id'),
                attribute_value_ids: searchParams.get('attribute_value_ids'),
            });
        }
    }, [searchParams]);

    const handleClearInitialState = () => setInitialCreateState(null);

    // Item search debounce (for the BOM designer item picker — triggers DataContext item reload)
    const setItemSearch = filters.setItemSearch;
    const itemSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleItemSearch = useCallback((term: string) => {
        if (itemSearchTimer.current) clearTimeout(itemSearchTimer.current);
        itemSearchTimer.current = setTimeout(() => setItemSearch(term), 350);
    }, [setItemSearch]);
    // On unmount: cancel the pending debounce AND clear the global item search, so a
    // material search typed in the BOM designer picker doesn't leak into other pages
    // (e.g. Inventory opening pre-filtered) — `itemSearch` is app-global in DataContext.
    useEffect(() => () => {
        if (itemSearchTimer.current) clearTimeout(itemSearchTimer.current);
        setItemSearch('');
    }, [setItemSearch]);

    // /bom no longer auto-fetches the paginated items array (BOMView list renders
    // off itemIndex). Pull it on demand for the BOMDesigner picker — first designer
    // open / deep-link create. fetchData dedupes concurrent identical targets.
    const handleEnsureItems = useCallback(() => {
        if (items.length > 0) return;
        fetchData('bom-items');
    }, [items.length, fetchData]);

    // After mutations: refresh BOM list + DataContext (items/attributes may have changed)
    const afterMutation = useCallback(() => {
        fetchBomList();
        fetchData();
    }, [fetchBomList, fetchData]);

    const handleCreateBOM = async (p: any) => {
        const res = await authFetch(`${API_BASE}/boms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) afterMutation();
        return res;
    };

    const handleCreateItem = async (p: any) => {
        const res = await authFetch(`${API_BASE}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
        return res;
    };

    const handleUpdateItem = async (id: string, p: any) => {
        const res = await authFetch(`${API_BASE}/items/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
        return res;
    };

    const handleUpdateBOM = async (id: string, p: any) => {
        const res = await authFetch(`${API_BASE}/boms/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) afterMutation();
        return res;
    };

    const handleDeleteBOM = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete BOM',
            message: 'Delete this BOM and all sub-BOMs beneath it? This action cannot be undone.',
            confirmText: 'Delete',
            variant: 'danger',
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/boms/${id}`, { method: 'DELETE' });
        if (res.ok) afterMutation();
        return res;
    };

    const handleUploadBOMPhoto = async (bomId: string, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await authFetch(`${API_BASE}/boms/${bomId}/sample-photo`, { method: 'POST', body: formData });
        if (res.ok) afterMutation();
    };

    const handleUploadBOMDesign = async (bomId: string, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await authFetch(`${API_BASE}/boms/${bomId}/design-file`, { method: 'POST', body: formData });
        if (res.ok) afterMutation();
    };

    const handleFetchBOMTree = async (id: string) => {
        const res = await authFetch(`${API_BASE}/boms/${id}/tree`);
        if (!res.ok) return null;
        return res.json();
    };

    const handleDeleteMultipleBOMs = async (ids: string[]) => {
        const confirmed = await confirm({
            title: 'Delete BOMs',
            message: `Delete ${ids.length} BOM(s)? This action cannot be undone.`,
            confirmText: 'Delete',
            variant: 'danger',
        });
        if (!confirmed) return;
        await Promise.all(ids.map(id => authFetch(`${API_BASE}/boms/${id}`, { method: 'DELETE' })));
        afterMutation();
    };

    return (
        <BOMView
            items={items}
            attributes={attributes}
            sizes={sizes}
            boms={bomList}
            bomPage={bomPage}
            bomTotal={bomTotal}
            bomPageSize={BOM_PAGE_SIZE}
            bomSearch={bomSearch}
            onBomSearch={handleBomSearch}
            setBomPage={setBomPage}
            showRootOnly={showRootOnly}
            setShowRootOnly={setShowRootOnly}
            bomLoading={bomLoading}
            operations={operations}
            workCenters={workCenters}
            partners={partners}
            onCreateBOM={handleCreateBOM}
            onUpdateBOM={handleUpdateBOM}
            onFetchBOMTree={handleFetchBOMTree}
            onUploadBOMPhoto={handleUploadBOMPhoto}
            onUploadBOMDesign={handleUploadBOMDesign}
            onDeleteBOM={handleDeleteBOM}
            onDeleteMultipleBOMs={handleDeleteMultipleBOMs}
            onSearchItem={handleItemSearch}
            onCreateItem={handleCreateItem}
            onUpdateItem={handleUpdateItem}
            locations={locations || []}
            companyProfile={companyProfile}
            initialCreateState={initialCreateState}
            onClearInitialState={handleClearInitialState}
            onEnsureItems={handleEnsureItems}
        />
    );
}
