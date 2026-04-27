'use client';

import ManufacturingView from '../components/manufacturing/ManufacturingView';
import MobileManufacturingView from '../components/mobile/ManufacturingView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/shared/Toast';
import { useEffect, useState, useCallback } from 'react';
import { useConfirm } from '../context/ConfirmContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function ManufacturingOrdersPage() {
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
    const isMobile = useIsMobile();

    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

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
            initialTab="manufacturing-orders"
            showTabSwitcher={false}
        />
    );
}
