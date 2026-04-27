'use client';

import SalesOrderView from '../components/sales/SalesOrderView';
import { useData } from '../context/DataContext';
import { useRouter } from 'next/navigation';
import { useToast } from '../components/shared/Toast';
import { useConfirm } from '../context/ConfirmContext';

export default function SalesOrdersPage() {
    const { items, attributes, salesOrders, partners, fetchData, authFetch, boms } = useData();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const router = useRouter();

    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const handleCreateSO = async (p: any) => {
        const res = await authFetch(`${API_BASE}/sales-orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
        return res;
    };

    const handleDeleteSO = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete Sales Order',
            message: 'Are you sure you want to delete this sales order?',
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/sales-orders/${id}`, { method: 'DELETE' });
        if (res.ok) fetchData();
    };

    const handleGenerateWO = (so: any, line: any) => {
        // 1. Check if BOM exists for this item + attributes
        const lineAttrIds = line.attribute_value_ids || [];
        
        // Find a BOM that matches the item ID
        const matchingBOM = boms.find((b: any) => {
            if (b.item_id !== line.item_id) return false;
            
            // Check if BOM attributes match the line attributes
            // A BOM matches if its attribute_value_ids (Set) is EQUAL to the line's attribute_value_ids (Set)
            // Or if the BOM covers the specific configuration.
            // Simplified: Exact match of sorted IDs or if BOM has no attributes and line has none.
            const bomAttrIds = b.attribute_value_ids || [];
            
            if (lineAttrIds.length !== bomAttrIds.length) return false;
            
            // Check if every ID in lineAttrIds is present in bomAttrIds
            return lineAttrIds.every((id: string) => bomAttrIds.includes(id));
        });

        if (matchingBOM) {
            // Navigate to manufacturing page with pre-filled data
            const params = new URLSearchParams({
                action: 'create_wo',
                sales_order_id: so.id,
                item_id: line.item_id,
                qty: line.qty.toString(),
                bom_id: matchingBOM.id
            });
            router.push(`/work-orders?${params.toString()}`);
        } else {
            // No BOM found - Redirect to BOM creation
            showToast('No matching BOM found. Please create a recipe first.', 'warning');
            const params = new URLSearchParams({
                action: 'create_bom',
                item_id: line.item_id,
                attribute_value_ids: (line.attribute_value_ids || []).join(',')
            });
            router.push(`/bom?${params.toString()}`);
        }
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
    );}
