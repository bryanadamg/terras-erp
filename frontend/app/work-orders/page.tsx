'use client';

import ManufacturingView from '../components/manufacturing/ManufacturingView';
import MobileManufacturingView from '../components/mobile/ManufacturingView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/shared/Toast';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useConfirm } from '../context/ConfirmContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function WorkOrdersPage() {
    const {
        items, attributes, sizes, boms,
        manufacturingOrders,
        productionRuns,
        operations, workCenters, partners,
        locations, stockBalance, companyProfile,
        fetchData, authFetch,
        pagination,
    } = useData();
    const { woPage, woTotal, prPage, prTotal, setPrPage, setWoPage, pageSize } = pagination;
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const searchParams = useSearchParams();
    const router = useRouter();
    const isMobile = useIsMobile();
    const [initialCreateState, setInitialCreateState] = useState<any>(null);
    const consumedSOIdRef = useRef<string | null>(null);

    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    useEffect(() => {
        const soId = searchParams.get('sales_order_id');
        if (searchParams.get('action') === 'create_wo' && soId !== consumedSOIdRef.current) {
            consumedSOIdRef.current = soId;
            setInitialCreateState({
                sales_order_id: soId,
                item_id: searchParams.get('item_id'),
                qty: parseFloat(searchParams.get('qty') || '0'),
                bom_id: searchParams.get('bom_id')
            });
            router.replace('/work-orders');
        }
    }, [searchParams]);

    // Manufacturing Order handlers
    const handleCreateMO = async (payload: any) => {
        const res = await authFetch(`${API_BASE}/manufacturing-orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        fetchData();
        return res;
    };

    const handleUpdateMOStatus = async (moId: string, status: string) => {
        const res = await authFetch(`${API_BASE}/manufacturing-orders/${moId}/status?status=${status}`, { method: 'PUT' });
        if (res.ok) { fetchData(); return true; }
        else { const err = await res.json(); showToast(`Error: ${err.detail}`, 'danger'); return false; }
    };

    const handleDeleteMO = async (moId: string) => {
        const confirmed = await confirm({
            title: 'Delete Manufacturing Order',
            message: 'Are you sure you want to delete this manufacturing order? This will remove it from the schedule.',
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;

        const res = await authFetch(`${API_BASE}/manufacturing-orders/${moId}`, { method: 'DELETE' });
        if (res.ok) { showToast('Manufacturing Order deleted', 'success'); fetchData(); }
    };

    // Production Run handlers
    const handleCreateProductionRun = async (p: any) => {
        const res = await authFetch(`${API_BASE}/production-runs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p)
        });
        if (res.ok) fetchData();
        return res;
    };

    const handleDeleteProductionRun = async (id: string) => {
        const res = await authFetch(`${API_BASE}/production-runs/${id}`, { method: 'DELETE' });
        if (res.ok) fetchData();
    };

    const handleUpdatePRStatus = async (id: string, status: string) => {
        const res = await authFetch(`${API_BASE}/production-runs/${id}/status?status=${encodeURIComponent(status)}`, { method: 'PUT' });
        if (res.ok) fetchData();
        return res;
    };

    // Work Order (operation step) handlers
    const handleCreateWO = async (payload: any) => {
        const res = await authFetch(`${API_BASE}/work-orders`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (res.ok) fetchData();
        return res;
    };

    const handleUpdateWO = async (id: string, payload: any) => {
        const res = await authFetch(`${API_BASE}/work-orders/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (res.ok) fetchData();
        return res;
    };

    const handleUpdateWOStatus = async (id: string, status: string) => {
        const res = await authFetch(`${API_BASE}/work-orders/${id}/status?status=${encodeURIComponent(status)}`, { method: 'PUT' });
        if (res.ok) fetchData();
        return res;
    };

    const handleDeleteWO = async (id: string) => {
        const res = await authFetch(`${API_BASE}/work-orders/${id}`, { method: 'DELETE' });
        if (res.ok) fetchData();
    };

    const handleClearInitialState = useCallback(() => {
        setInitialCreateState(null);
    }, []);

    if (isMobile) {
        return <MobileManufacturingView workOrders={manufacturingOrders} items={items} />;
    }

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
            initialCreateState={initialCreateState}
            onClearInitialState={handleClearInitialState}
            initialTab="production-runs"
            showTabSwitcher={false}
        />
    );
}
