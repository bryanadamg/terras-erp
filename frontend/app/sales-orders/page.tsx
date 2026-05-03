'use client';

import SalesOrderView from '../components/sales/SalesOrderView';
import { useData } from '../context/DataContext';
import { useRouter } from 'next/navigation';
import { useToast } from '../components/shared/Toast';
import { useConfirm } from '../context/ConfirmContext';

export default function SalesOrdersPage() {
    const { items, attributes, salesOrders, partners, boms, fetchData, authFetch } = useData();
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

    const handleGeneratePR = (so: any, line: any) => {
        const lineAttrIds = line.attribute_value_ids || [];
        const matchingBOM = boms.find((b: any) => {
            if (b.item_id !== line.item_id) return false;
            const bomAttrIds = b.attribute_value_ids || [];
            if (lineAttrIds.length !== bomAttrIds.length) return false;
            return lineAttrIds.every((id: string) => bomAttrIds.includes(id));
        });

        if (matchingBOM) {
            // Collect ALL lines from this SO that share the same BOM to pre-fill sizes
            const soLines: any[] = so.lines || [];
            const sizes = soLines
                .filter((l: any) => {
                    if (l.item_id !== matchingBOM.item_id) return false;
                    if (!l.bom_size_id) return false;
                    return true;
                })
                .map((l: any) => ({ bom_size_id: l.bom_size_id, qty: l.qty }));

            const params: Record<string, string> = {
                action: 'create_pr',
                sales_order_id: so.id,
                bom_id: matchingBOM.id,
                sizes: encodeURIComponent(JSON.stringify(sizes)),
            };
            router.push(`/production-runs?${new URLSearchParams(params).toString()}`);
        } else {
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
                boms={boms}
                salesOrders={salesOrders}
                partners={partners}
                onCreateSO={handleCreateSO}
                onDeleteSO={handleDeleteSO}
                onUpdateSOStatus={handleUpdateSOStatus}
                onGenerateWO={handleGeneratePR}
            />
    );}
