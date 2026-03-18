'use client';

import MainLayout from '../components/MainLayout';
import ManufacturingView from '../components/ManufacturingView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/Toast';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useConfirm } from '../context/ConfirmContext';

export default function ManufacturingPage() {
    const { 
        items, boms, locations, attributes, workOrders, stockBalance, 
        workCenters, operations, fetchData, pagination, authFetch
    } = useData();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const searchParams = useSearchParams();
    const router = useRouter();
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
            router.replace('/manufacturing');
        }
    }, [searchParams]);

    const handleCreateWO = async (payload: any) => {
        const res = await authFetch(`${API_BASE}/work-orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        fetchData();
        return res;
    };

    const handleUpdateWOStatus = async (woId: string, status: string) => {
        const res = await authFetch(`${API_BASE}/work-orders/${woId}/status?status=${status}`, { method: 'PUT' });
        if (res.ok) { fetchData(); return true; } 
        else { const err = await res.json(); showToast(`Error: ${err.detail}`, 'danger'); return false; }
    };

    const handleDeleteWO = async (woId: string) => {
        const confirmed = await confirm({
            title: 'Delete Work Order',
            message: 'Are you sure you want to delete this work order? This will remove it from the schedule.',
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;
        
        const res = await authFetch(`${API_BASE}/work-orders/${woId}`, { method: 'DELETE' });
        if (res.ok) { showToast('Work Order deleted', 'success'); fetchData(); }
    };

    const handleClearInitialState = useCallback(() => {
        setInitialCreateState(null);
    }, []);

    return (
        <MainLayout>
            <ManufacturingView 
                items={items} 
                boms={boms} 
                locations={locations} 
                attributes={attributes}
                workOrders={workOrders} 
                stockBalance={stockBalance} 
                workCenters={workCenters} 
                operations={operations}
                onCreateWO={handleCreateWO}
                onUpdateStatus={handleUpdateWOStatus}
                onDeleteWO={handleDeleteWO}
                currentPage={pagination.woPage}
                totalItems={pagination.woTotal}
                pageSize={pagination.pageSize}
                onPageChange={pagination.setWoPage}
                initialCreateState={initialCreateState}
                onClearInitialState={handleClearInitialState}
            />
        </MainLayout>
    );
}
