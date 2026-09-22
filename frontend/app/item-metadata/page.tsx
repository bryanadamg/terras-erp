'use client';

import ItemMetadataView from '../components/settings/ItemMetadataView';
import { useData } from '../context/DataContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../components/shared/Toast';
import { API_BASE } from '../components/shared/apiBase';

export default function ItemMetadataPage() {
    const { categories, uoms, attributes, refreshItemMetadata, authFetch } = useData();
    const { confirm } = useConfirm();
    const { showToast } = useToast();

    // Every handler below used to drop a non-2xx on the floor: a 400 ("UOM already
    // exists" — the name check is case-sensitive) or a 403 looked exactly like a
    // dead button. Surface it once, here, instead of per call site.
    const report = async (res: Response, fallback: string) => {
        if (res.ok) return res;
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || fallback, 'danger');
        return res;
    };

    // ── Categories ────────────────────────────────────────────────────────────
    const handleCreateCategory = async (name: string, parentId?: string) => {
        const res = await report(await authFetch(`${API_BASE}/categories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, parent_id: parentId ?? null }),
        }), 'Failed to create category');
        if (res.ok) refreshItemMetadata();
        return res;
    };

    const handleDeleteCategory = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete Category', message: 'Are you sure you want to delete this category?',
            confirmText: 'Delete', variant: 'danger',
        });
        if (!confirmed) return;
        const res = await report(await authFetch(`${API_BASE}/categories/${id}`, { method: 'DELETE' }), 'Failed to delete category');
        if (res.ok) refreshItemMetadata();
    };

    const handleRenameCategory = async (id: string, name: string) => {
        const res = await report(await authFetch(`${API_BASE}/categories/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        }), 'Failed to rename category');
        if (res.ok) refreshItemMetadata();
    };

    // ── UOM ───────────────────────────────────────────────────────────────────
    const handleCreateUOM = async (name: string) => {
        const res = await report(await authFetch(`${API_BASE}/uoms`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
        }), 'Failed to create unit');
        if (res.ok) refreshItemMetadata();
        return res;
    };

    const handleDeleteUOM = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete UOM', message: 'Are you sure you want to delete this unit of measure?',
            confirmText: 'Delete', variant: 'danger',
        });
        if (!confirmed) return;
        const res = await report(await authFetch(`${API_BASE}/uoms/${id}`, { method: 'DELETE' }), 'Failed to delete unit');
        if (res.ok) refreshItemMetadata();
    };

    const handleSaveUOMFactor = async (fromUomId: string, toUomId: string, value: number) => {
        const res = await report(await authFetch(`${API_BASE}/uoms/${fromUomId}/factors`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to_uom_id: toUomId, value }),
        }), 'Failed to save conversion');
        if (res.ok) refreshItemMetadata();
    };

    const handleDeleteUOMFactor = async (uomId: string, factorId: string) => {
        const res = await report(await authFetch(`${API_BASE}/uoms/${uomId}/factors/${factorId}`, { method: 'DELETE' }), 'Failed to delete conversion');
        if (res.ok) refreshItemMetadata();
    };

    // ── Attributes ────────────────────────────────────────────────────────────
    const handleCreateAttribute = async (p: any) => {
        const res = await report(await authFetch(`${API_BASE}/attributes`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
        }), 'Failed to create attribute');
        if (res.ok) refreshItemMetadata();
        return res;
    };

    const handleUpdateAttribute = async (id: string, name: string) => {
        const res = await report(await authFetch(`${API_BASE}/attributes/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
        }), 'Failed to rename attribute');
        if (res.ok) refreshItemMetadata();
    };

    const handleDeleteAttribute = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete Attribute', message: 'Are you sure you want to delete this attribute and all its values?',
            confirmText: 'Delete', variant: 'danger',
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/attributes/${id}`, { method: 'DELETE' });
        if (res.ok) {
            refreshItemMetadata();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Failed to delete attribute', 'danger');
        }
    };

    const handleAddValue = async (attributeId: string, value: string) => {
        const res = await report(await authFetch(`${API_BASE}/attributes/${attributeId}/values`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
        }), 'Failed to add value');
        if (res.ok) refreshItemMetadata();
    };

    const handleUpdateValue = async (valueId: string, value: string) => {
        const res = await report(await authFetch(`${API_BASE}/attributes/values/${valueId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
        }), 'Failed to rename value');
        if (res.ok) refreshItemMetadata();
    };

    const handleDeleteValue = async (valueId: string) => {
        const res = await authFetch(`${API_BASE}/attributes/values/${valueId}`, { method: 'DELETE' });
        if (res.ok) {
            refreshItemMetadata();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Failed to delete value', 'danger');
        }
    };

    return (
            <ItemMetadataView
                categories={categories}
                uoms={uoms}
                attributes={attributes}
                onCreateCategory={handleCreateCategory}
                onDeleteCategory={handleDeleteCategory}
                onRenameCategory={handleRenameCategory}
                onCreateUOM={handleCreateUOM}
                onDeleteUOM={handleDeleteUOM}
                onSaveUOMFactor={handleSaveUOMFactor}
                onDeleteUOMFactor={handleDeleteUOMFactor}
                onCreateAttribute={handleCreateAttribute}
                onUpdateAttribute={handleUpdateAttribute}
                onDeleteAttribute={handleDeleteAttribute}
                onAddValue={handleAddValue}
                onUpdateValue={handleUpdateValue}
                onDeleteValue={handleDeleteValue}
            />
    );
}
