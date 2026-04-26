'use client';

import PurchaseOrderView from '../components/purchasing/PurchaseOrderView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/shared/Toast';
import { useConfirm } from '../context/ConfirmContext';

export default function PurchaseOrdersPage() {
    const { items, attributes, purchaseOrders, partners, locations, fetchData, authFetch } = useData();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const handleCreatePO = async (p: any) => {
        const res = await authFetch(`${API_BASE}/purchase-orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
    };

    const handleReceivePO = async (id: string) => {
        const res = await authFetch(`${API_BASE}/purchase-orders/${id}/receive`, { method: 'PUT' });
        if (res.ok) { showToast('PO Received into Stock', 'success'); fetchData(); }
    };

    const handleDeletePO = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete Purchase Order',
            message: 'Are you sure you want to delete this purchase order?',
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/purchase-orders/${id}`, { method: 'DELETE' });
        if (res.ok) fetchData();
    };

    return (
            <PurchaseOrderView 
                items={items} 
                attributes={attributes} 
                purchaseOrders={purchaseOrders} 
                partners={partners} 
                locations={locations} 
                onCreatePO={handleCreatePO} 
                onReceivePO={handleReceivePO} 
                onDeletePO={handleDeletePO} 
            />
    );
}
