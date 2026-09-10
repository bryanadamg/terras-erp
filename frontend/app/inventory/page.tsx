'use client';

import { useEffect } from 'react';
import InventoryView from '../components/inventory/InventoryView';
import { useData } from '../context/DataContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../components/shared/Toast';

export default function InventoryPage() {
    const {
        items, attributes, uoms, fetchData, pagination, filters, authFetch
    } = useData();

    useEffect(() => {
        return () => {
            filters.setItemSearch('');
            filters.setCategoryL1('');
            filters.setCategoryL2('');
            filters.setCategoryL3('');
        };
    }, []);
    const { confirm } = useConfirm();
    const { showToast } = useToast();

    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const handleCreateItem = async (p: any) => {
        const res = await authFetch(`${API_BASE}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
        return res;
    };

    const handleUpdateItem = async (id: string, p: any) => {
        const res = await authFetch(`${API_BASE}/items/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
        return res;
    };

    const handleDeleteItem = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete Item',
            message: 'Are you sure you want to delete this item? This will also remove all associated variants and stock records.',
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/items/${id}`, { method: 'DELETE' });
        if (res.ok) fetchData();
        else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Failed to delete item', 'danger');
        }
        return res;
    };

    const handleDeleteMultipleItems = async (ids: string[]) => {
        const confirmed = await confirm({
            title: 'Delete Items',
            message: `Delete ${ids.length} item(s)? This will also remove all associated variants and stock records.`,
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;
        const results = await Promise.all(ids.map(id => authFetch(`${API_BASE}/items/${id}`, { method: 'DELETE' })));
        const failed = results.filter(res => !res.ok);
        if (failed.length) {
            const err = await failed[0].json().catch(() => ({}));
            showToast(
                failed.length === results.length
                    ? (err.detail || 'Failed to delete items')
                    : `${results.length - failed.length} deleted, ${failed.length} failed: ${err.detail || 'still referenced'}`,
                'danger'
            );
        }
        fetchData();
    };

    // The import button is modeless — it hands the picked file straight here.
    const handleImportItems = async (file: File) => {
        const body = new FormData();
        body.append('file', file);
        const res = await authFetch(`${API_BASE}/items/import`, { method: 'POST', body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { status: 'error', errors: [data.detail || 'Import failed'] };
        return data;
    };

    const handleDownloadTemplate = () => {
        // Header the CSV parser in import_service.import_items_csv expects.
        const blob = new Blob(['Code,Name,UOM,Category\n'], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'item-import-template.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleAddVariant = async (itemId: string, p: any) => {
        const res = await authFetch(`${API_BASE}/items/${itemId}/variants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
    };

    const handleDeleteVariant = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete Variant',
            message: 'Are you sure you want to delete this variant?',
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/variants/${id}`, { method: 'DELETE' });
        if (res.ok) fetchData();
    };

    return (
            <InventoryView
                items={items}
                attributes={attributes}
                uoms={uoms}
                onCreateItem={handleCreateItem}
                onUpdateItem={handleUpdateItem}
                onDeleteItem={handleDeleteItem}
                onDeleteMultipleItems={handleDeleteMultipleItems}
                onAddVariant={handleAddVariant}
                onDeleteVariant={handleDeleteVariant}
                onImportItems={handleImportItems}
                onDownloadTemplate={handleDownloadTemplate}
                onRefresh={fetchData}
                currentPage={pagination.itemPage}
                totalItems={pagination.itemTotal}
                pageSize={pagination.pageSize}
                onPageChange={pagination.setItemPage}
                searchTerm={filters.itemSearch}
                onSearchChange={filters.setItemSearch}
            />
    );
}
