'use client';

import ManufacturingView from '../components/manufacturing/ManufacturingView';
import MobileManufacturingView from '../components/mobile/ManufacturingView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/shared/Toast';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useConfirm } from '../context/ConfirmContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { useSearchParams, useRouter } from 'next/navigation';
import { API_BASE } from '../components/shared/apiBase';

export default function ManufacturingOrdersPage() {
    const {
        items, attributes, sizes, boms,
        manufacturingOrders,
        productionRuns,
        operations, workCenters, partners,
        locations, stockBalance, companyProfile,
        fetchData, refreshManufacturing, authFetch,
        pagination, loading,
    } = useData();

    // Same mount-time gap as /production-runs: DataContext's untargeted fetch reads
    // window.location.pathname but doesn't depend on it, so a router.push onto this
    // route fetches nothing and the table sits on its skeleton. Mount-only and
    // unloaded-only so sidebar entry (already hover-prefetched) costs nothing extra.
    const loadingRef = useRef(loading);
    loadingRef.current = loading;
    useEffect(() => {
        if (loadingRef.current.manufacturingOrders) fetchData('manufacturing-orders');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Guard against the wrong-MO flash: the global manufacturingOrders is SHARED
    // with the Work Orders page (which loads ALL levels via all_levels=true) and is
    // also repopulated with all-levels data by the WS handler's fetchData('work-orders').
    // The MO page only ever shows root MOs, so filter to roots here — this is a no-op
    // on correct (root-only) data and corrects any stale all-levels data instantly.
    const rootMOs = useMemo(
        () => (manufacturingOrders || []).filter((m: any) => !m.parent_mo_id && !m.is_shared_component),
        [manufacturingOrders]
    );
    const { woPage, woTotal, prPage, prTotal, setPrPage, setWoPage, pageSize } = pagination;
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const isMobile = useIsMobile();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [initialCreateState, setInitialCreateState] = useState<any>(null);
    const [initialMOFilter, setInitialMOFilter] = useState<string>('');
    const consumedSOIdRef = useRef<string | null>(null);
    const consumedMOFilterRef = useRef<string | null>(null);

    useEffect(() => {
        const soId = searchParams.get('sales_order_id');
        if (searchParams.get('action') === 'create_wo' && soId !== consumedSOIdRef.current) {
            consumedSOIdRef.current = soId;
            setInitialCreateState({
                sales_order_id: soId,
                item_id: searchParams.get('item_id'),
                // `qty` seeds ManufacturingOrder.qty and must already be in the
                // ITEM'S STOCK UOM. A producer building this link off a sales order
                // line must send `qty_ordered_base`, never `line.qty` — the latter is
                // authored in yards (so_fulfilment_service.ordered_qty_in_stock_uom)
                // and would plan a kg-stocked BOM against a length. Nothing in the
                // repo builds this link today: the SO page routes to /production-runs
                // with bom_entries instead, and that path converts correctly
                // (sales-orders/page.tsx `pickQty`).
                qty: parseFloat(searchParams.get('qty') || '0'),
                bom_id: searchParams.get('bom_id'),
                bom_size_id: searchParams.get('bom_size_id') || null,
            });
            router.replace('/manufacturing-orders');
        }
        const moCode = searchParams.get('mo');
        if (moCode && moCode !== consumedMOFilterRef.current) {
            consumedMOFilterRef.current = moCode;
            setInitialMOFilter(moCode);
            router.replace('/manufacturing-orders');
        }
    }, [searchParams]);


    // Manufacturing Order handlers
    const handleCreateMO = async (payload: any) => {
        const res = await authFetch(`${API_BASE}/manufacturing-orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
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

    // Production Run handlers
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

    // Work Order (operation step) handlers
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

    // Above the mobile early return: a hook after it changes the hook count
    // when the viewport crosses the breakpoint, and React throws.
    const handleClearInitialState = useCallback(() => setInitialCreateState(null), []);

    if (isMobile) {
        return (
            <MobileManufacturingView
                manufacturingOrders={rootMOs}
                items={items}
                workCenters={workCenters}
                boms={boms}
                authFetch={authFetch}
                onRefresh={fetchData}
            />
        );
    }

    return (
        <ManufacturingView
            items={items}
            boms={boms}
            locations={locations}
            attributes={attributes}
            manufacturingOrders={rootMOs}
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
            initialCreateState={initialCreateState}
            onClearInitialState={handleClearInitialState}
            initialMOFilter={initialMOFilter}
            initialTab="manufacturing-orders"
        />
    );
}
