'use client';

import WorkOrderListView from '../components/manufacturing/WorkOrderListView';
import { useData } from '../context/DataContext';

export default function WorkOrdersPage() {
    const {
        manufacturingOrders,
        workCenters,
        fetchData, authFetch,
    } = useData();

    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

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

    return (
        <WorkOrderListView
            manufacturingOrders={manufacturingOrders}
            workCenters={workCenters}
            onUpdate={handleUpdateWO}
            onUpdateStatus={handleUpdateWOStatus}
            onDelete={handleDeleteWO}
        />
    );
}
