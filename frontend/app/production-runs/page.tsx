'use client';

import ManufacturingView from '../components/manufacturing/ManufacturingView';
import MobileManufacturingView from '../components/mobile/ManufacturingView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/shared/Toast';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useConfirm } from '../context/ConfirmContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { useSearchParams, useRouter } from 'next/navigation';
import { API_BASE } from '../components/shared/apiBase';

export default function ProductionRunsPage() {
    const {
        items, attributes, sizes, boms,
        manufacturingOrders,
        productionRuns,
        operations, workCenters, partners,
        locations, stockBalance, companyProfile,
        fetchData, refreshManufacturing, authFetch,
        pagination, loading,
    } = useData();
    const { woPage, woTotal, prPage, prTotal, setPrPage, setWoPage, pageSize } = pagination;
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const isMobile = useIsMobile();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [initialPRState, setInitialPRState] = useState<any>(null);
    const [initialPRFilter, setInitialPRFilter] = useState<string>('');
    const consumedSOIdRef = useRef<string | null>(null);
    const consumedPRFilterRef = useRef<string | null>(null);

    // Own our data on mount. DataContext's only untargeted fetch keys off
    // window.location.pathname but has no pathname dependency, and DataProvider sits
    // above the router so it never remounts — so a client-side router.push to this
    // route fetches nothing. Sidebar entry is covered by handleTabHover(tab); arriving
    // from the SO page's "Create Production Run" button is not, which left the PR
    // table on its skeleton forever (loading.productionRuns never goes false).
    //
    // Mount-only, and only when the slice is unloaded. Both conditions are load-bearing:
    // firing unconditionally would re-pull the 1.4 MB PR payload on every visit (the
    // cost e49ce47 removed from the SO page), and re-running on `loading` changes would
    // fire a second, differently-keyed fetch on every page/filter change — the dedupe
    // is keyed on target+window, so that one would NOT collapse. At mount all three
    // cases are right: already loaded → skip; hover-prefetch still in flight → dedupes
    // onto it; never fetched → this is the only thing that fills the table.
    const loadingRef = useRef(loading);
    loadingRef.current = loading;
    useEffect(() => {
        if (loadingRef.current.productionRuns) fetchData('production-runs');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const prCode = searchParams.get('pr');
        if (prCode && prCode !== consumedPRFilterRef.current) {
            consumedPRFilterRef.current = prCode;
            setInitialPRFilter(prCode);
            router.replace('/production-runs');
        }
        const soId = searchParams.get('sales_order_id');
        const action = searchParams.get('action');
        if (action === 'create_pr' && soId !== consumedSOIdRef.current) {
            consumedSOIdRef.current = soId;
            const soCode = searchParams.get('so_code') || undefined;
            const bomEntriesRaw = searchParams.get('bom_entries');
            if (bomEntriesRaw) {
                setInitialPRState({
                    sales_order_id: soId,
                    sales_order_code: soCode,
                    bom_entries: JSON.parse(decodeURIComponent(bomEntriesRaw)),
                });
            } else {
                // Legacy single-BOM path
                const sizesRaw = searchParams.get('sizes');
                const totalQtyRaw = searchParams.get('total_qty');
                setInitialPRState({
                    sales_order_id: soId,
                    sales_order_code: soCode,
                    bom_id: searchParams.get('bom_id'),
                    sizes: sizesRaw ? JSON.parse(decodeURIComponent(sizesRaw)) : [],
                    total_qty: totalQtyRaw ? parseFloat(totalQtyRaw) : undefined,
                });
            }
            router.replace('/production-runs');
        }
    }, [searchParams]);


    const handleCreateMO = async (payload: any) => {
        const res = await authFetch(`${API_BASE}/manufacturing-orders`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        refreshManufacturing();
        return res;
    };

    const handleUpdateMOStatus = async (moId: string, status: string) => {
        const res = await authFetch(`${API_BASE}/manufacturing-orders/${moId}/status?status=${status}`, { method: 'PUT' });
        if (res.ok) { refreshManufacturing(); return true; }
        else { const err = await res.json(); showToast(`Error: ${err.detail}`, 'danger'); return false; }
    };

    const handleDeleteMO = async (moId: string) => {
        const confirmed = await confirm({
            title: 'Delete Manufacturing Order',
            message: 'Are you sure you want to delete this manufacturing order? This also deletes all its child MOs, work orders, and completions. Consolidated component MOs are removed only if no other MO still depends on them. This cannot be undone.',
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/manufacturing-orders/${moId}`, { method: 'DELETE' });
        if (res.ok) { showToast('Manufacturing Order deleted', 'success'); refreshManufacturing(); }
    };

    const handleCreateProductionRun = async (p: any) => {
        const res = await authFetch(`${API_BASE}/production-runs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p)
        });
        if (res.ok) refreshManufacturing();
        return res;
    };

    const handleDeleteProductionRun = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete Production Run',
            message: 'Are you sure you want to delete this production run? This also deletes ALL associated Manufacturing Orders (roots, children, and consolidated component MOs), along with their work orders and completions. This cannot be undone.',
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/production-runs/${id}`, { method: 'DELETE' });
        if (res.ok) { showToast('Production Run deleted', 'success'); refreshManufacturing(); }
        else { const err = await res.json().catch(() => ({})); showToast(`Error: ${err.detail || 'Delete failed'}`, 'danger'); }
    };

    const handleUpdatePRStatus = async (id: string, status: string) => {
        const res = await authFetch(`${API_BASE}/production-runs/${id}/status?status=${encodeURIComponent(status)}`, { method: 'PUT' });
        if (res.ok) refreshManufacturing();
        return res;
    };

    const handleCreateWO = async (payload: any) => {
        const res = await authFetch(`${API_BASE}/work-orders`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (res.ok) refreshManufacturing();
        return res;
    };

    const handleUpdateWO = async (id: string, payload: any) => {
        const res = await authFetch(`${API_BASE}/work-orders/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (res.ok) refreshManufacturing();
        return res;
    };

    const handleUpdateWOStatus = async (id: string, status: string) => {
        const res = await authFetch(`${API_BASE}/work-orders/${id}/status?status=${encodeURIComponent(status)}`, { method: 'PUT' });
        if (res.ok) refreshManufacturing();
        return res;
    };

    const handleDeleteWO = async (id: string) => {
        const res = await authFetch(`${API_BASE}/work-orders/${id}`, { method: 'DELETE' });
        if (res.ok) refreshManufacturing();
    };

    if (isMobile) {
        return (
            <MobileManufacturingView
                manufacturingOrders={manufacturingOrders}
                items={items}
                workCenters={workCenters}
                boms={boms}
                authFetch={authFetch}
                onRefresh={fetchData}
            />
        );
    }

    const handleClearInitialPRState = useCallback(() => setInitialPRState(null), []);

    return (
        <ManufacturingView
            items={items}
            boms={boms}
            locations={locations}
            attributes={attributes}
            manufacturingOrders={manufacturingOrders}
            productionRuns={productionRuns}
            stockBalance={stockBalance}
            workCenters={workCenters}
            operations={operations}
            onCreateMO={handleCreateMO}
            onUpdateStatus={handleUpdateMOStatus}
            onDeleteMO={handleDeleteMO}
            onCreateProductionRun={handleCreateProductionRun}
            onDeleteProductionRun={handleDeleteProductionRun}
            onUpdatePRStatus={handleUpdatePRStatus}
            onCreateWO={handleCreateWO}
            onUpdateWO={handleUpdateWO}
            onUpdateWOStatus={handleUpdateWOStatus}
            onDeleteWO={handleDeleteWO}
            currentPage={woPage}
            totalItems={woTotal}
            pageSize={pageSize}
            onPageChange={setWoPage}
            prPage={prPage}
            prTotal={prTotal}
            setPrPage={setPrPage}
            initialPRState={initialPRState}
            onClearInitialPRState={handleClearInitialPRState}
            initialPRFilter={initialPRFilter}
            initialTab="production-runs"
            showTabSwitcher={false}
        />
    );
}
