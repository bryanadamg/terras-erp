'use client';

import MainLayout from '../components/MainLayout';
import SalesOrderView from '../components/SalesOrderView';
import { useData } from '../context/DataContext';
import { useRouter } from 'next/navigation';
import { useToast } from '../components/Toast';

export default function SalesOrdersPage() {
    const { items, attributes, salesOrders, partners, fetchData, authFetch } = useData();
    const { showToast } = useToast();
    const router = useRouter();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const handleCreateSO = async (p: any) => {
        const res = await authFetch(`${API_BASE}/sales-orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
    };

    const handleDeleteSO = async (id: string) => {
        if (!confirm('Are you sure?')) return;
        const res = await authFetch(`${API_BASE}/sales-orders/${id}`, { method: 'DELETE' });
        if (res.ok) fetchData();
    };

    const handleGenerateWO = (so: any, line: any) => {
        // Navigate to manufacturing page with pre-filled data in query params
        const params = new URLSearchParams({
            action: 'create_wo',
            sales_order_id: so.id,
            item_id: line.item_id,
            qty: line.qty.toString()
        });
        router.push(`/manufacturing?${params.toString()}`);
    };

    const handleUpdateSOStatus = async (soId: string, status: string) => {
        const res = await authFetch(`${API_BASE}/sales-orders/${soId}/status?status=${status}`, { method: 'PUT' });
        if (res.ok) {
            fetchData();
            showToast(`Order status updated to ${status}`, 'success');
        } else {
            const err = await res.json();
            showToast(`Error: ${err.detail}`, 'danger');
        }
    };

    return (
        <MainLayout>
            <SalesOrderView 
                items={items} 
                attributes={attributes} 
                salesOrders={salesOrders} 
                partners={partners}
                onCreateSO={handleCreateSO}
                onDeleteSO={handleDeleteSO}
                onUpdateSOStatus={handleUpdateSOStatus}
                onGenerateWO={handleGenerateWO}
            />
        </MainLayout>
    );}
