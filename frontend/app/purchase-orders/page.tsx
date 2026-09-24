'use client';

import PurchaseOrderView from '../components/purchasing/PurchaseOrderView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/shared/Toast';
import { useConfirm } from '../context/ConfirmContext';
import { usePurchasableItemSearch } from '../components/shared/useEntitySearch';
import { API_BASE } from '../components/shared/apiBase';

export default function PurchaseOrdersPage() {
    const { items, attributes, purchaseOrders, partners, locations, companyProfile, refreshPurchaseOrders, authFetch } = useData();
    const { results: itemResults, onSearch: onSearchItems } = usePurchasableItemSearch();
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    const handleCreatePO = async (p: any) => {
        const res = await authFetch(`${API_BASE}/purchase-orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) await refreshPurchaseOrders();
        return res;
    };

    const handleEditPO = async (id: string, p: any) => {
        const res = await authFetch(`${API_BASE}/purchase-orders/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) await refreshPurchaseOrders();
        return res;
    };

    const handleCreateReceipt = async (poId: string, receiptPayload: any, dnFile?: File | null) => {
        const res = await authFetch(`${API_BASE}/purchase-orders/${poId}/receipts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(receiptPayload),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Failed to record receipt', 'error');
            return;
        }
        // Receipt booked. Attach the delivery-note file in a second step if one was picked.
        if (dnFile) {
            const receipt = await res.json().catch(() => null);
            if (receipt?.id) {
                const fd = new FormData();
                fd.append('file', dnFile);
                const up = await authFetch(`${API_BASE}/purchase-orders/receipts/${receipt.id}/delivery-note`, {
                    method: 'POST',
                    body: fd,
                });
                if (!up.ok) showToast('Goods received, but delivery note upload failed', 'error');
            }
        }
        showToast('Goods received into stock', 'success');
        await refreshPurchaseOrders();
    };

    const handleClosePO = async (id: string) => {
        const confirmed = await confirm({
            title: 'Close Purchase Order',
            message: 'Mark this PO as RECEIVED even though received quantities are short of what was ordered? This cannot be undone.',
            confirmText: 'Close as Received',
            variant: 'warning'
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/purchase-orders/${id}/close`, { method: 'PATCH' });
        if (res.ok) {
            showToast('PO closed as received', 'success');
            await refreshPurchaseOrders();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Failed to close PO', 'error');
        }
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
        if (res.ok) await refreshPurchaseOrders();
    };

    return (
            <PurchaseOrderView
                items={items}
                itemResults={itemResults}
                onSearchItems={onSearchItems}
                attributes={attributes}
                purchaseOrders={purchaseOrders}
                partners={partners}
                locations={locations}
                onCreatePO={handleCreatePO}
                onEditPO={handleEditPO}
                onCreateReceipt={handleCreateReceipt}
                onClosePO={handleClosePO}
                onDeletePO={handleDeletePO}
                companyProfile={companyProfile}
            />
    );
}
