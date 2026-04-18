'use client';

import ItemMetadataView from '../components/ItemMetadataView';
import { useData } from '../context/DataContext';
import { useConfirm } from '../context/ConfirmContext';

export default function ItemMetadataPage() {
    const { categories, uoms, attributes, fetchData, authFetch } = useData();
    const { confirm } = useConfirm();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    // ── Categories ────────────────────────────────────────────────────────────
    const handleCreateCategory = async (name: string) => {
        const res = await authFetch(`${API_BASE}/categories`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
        });
        if (res.ok) fetchData();
    };

    const handleDeleteCategory = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete Category', message: 'Are you sure you want to delete this category?',
            confirmText: 'Delete', variant: 'danger',
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/categories/${id}`, { method: 'DELETE' });
        if (res.ok) fetchData();
    };

    // ── UOM ───────────────────────────────────────────────────────────────────
    const handleCreateUOM = async (name: string) => {
        const res = await authFetch(`${API_BASE}/uoms`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
        });
        if (res.ok) fetchData();
    };

    const handleDeleteUOM = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete UOM', message: 'Are you sure you want to delete this unit of measure?',
            confirmText: 'Delete', variant: 'danger',
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/uoms/${id}`, { method: 'DELETE' });
        if (res.ok) fetchData();
    };

    // ── Attributes ────────────────────────────────────────────────────────────
    const handleCreateAttribute = async (p: any) => {
        const res = await authFetch(`${API_BASE}/attributes`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
        });
        if (res.ok) fetchData();
    };

    const handleUpdateAttribute = async (id: string, name: string) => {
        const res = await authFetch(`${API_BASE}/attributes/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
        });
        if (res.ok) fetchData();
    };

    const handleDeleteAttribute = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete Attribute', message: 'Are you sure you want to delete this attribute and all its values?',
            confirmText: 'Delete', variant: 'danger',
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/attributes/${id}`, { method: 'DELETE' });
        if (res.ok) fetchData();
    };

    const handleAddValue = async (attributeId: string, value: string) => {
        const res = await authFetch(`${API_BASE}/attributes/${attributeId}/values`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
        });
        if (res.ok) fetchData();
    };

    const handleUpdateValue = async (valueId: string, value: string) => {
        const res = await authFetch(`${API_BASE}/attributes/values/${valueId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
        });
        if (res.ok) fetchData();
    };

    const handleDeleteValue = async (valueId: string) => {
        const res = await authFetch(`${API_BASE}/attributes/values/${valueId}`, { method: 'DELETE' });
        if (res.ok) fetchData();
    };

    return (
            <ItemMetadataView
                categories={categories}
                uoms={uoms}
                attributes={attributes}
                onCreateCategory={handleCreateCategory}
                onDeleteCategory={handleDeleteCategory}
                onCreateUOM={handleCreateUOM}
                onDeleteUOM={handleDeleteUOM}
                onCreateAttribute={handleCreateAttribute}
                onUpdateAttribute={handleUpdateAttribute}
                onDeleteAttribute={handleDeleteAttribute}
                onAddValue={handleAddValue}
                onUpdateValue={handleUpdateValue}
                onDeleteValue={handleDeleteValue}
            />
    );
}
