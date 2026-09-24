'use client';

import { useState, useEffect, useCallback } from 'react';
import PackagingTypesView from '../components/packaging/PackagingTypesView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/shared/Toast';
import { API_BASE } from '../components/shared/apiBase';

// Bounded master — a handful of boxes the plant stocks — so the page loads the
// whole list (including inactive rows, which the pack pickers hide) and the view
// filters it client-side. Same treatment as Routing and Settings > Users: a
// window here would cost a request per keystroke for data that fits in one.


export default function PackagingTypesPage() {
    const { authFetch } = useData();
    const { showToast } = useToast();
    const [types, setTypes] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/packaging-types?include_inactive=true`);
            const data = res.ok ? await res.json() : [];
            setTypes(Array.isArray(data) ? data : []);
        } catch {
            setTypes([]);
        } finally {
            setLoading(false);
        }
    }, [authFetch]);

    useEffect(() => { load(); }, [load]);

    const failure = async (res: Response, fallback: string) => {
        const body = await res.json().catch(() => ({}));
        showToast(body.detail || fallback, 'danger');
    };

    const handleCreate = async (payload: any) => {
        const res = await authFetch(`${API_BASE}/packaging-types`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (res.ok) { showToast('Packaging type created', 'success'); load(); }
        else await failure(res, 'Create failed');
    };

    const handleEdit = async (id: string, payload: any) => {
        const res = await authFetch(`${API_BASE}/packaging-types/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (res.ok) { showToast('Packaging type saved', 'success'); load(); }
        else await failure(res, 'Save failed');
    };

    const handleDelete = async (t: any) => {
        const res = await authFetch(`${API_BASE}/packaging-types/${t.id}`, { method: 'DELETE' });
        if (res.ok) {
            // The server deactivates instead of deleting when cartons already
            // reference the type, and says which it did — reported as such rather
            // than as a flat "deleted" the user can see is untrue in the table.
            const body = await res.json().catch(() => ({}));
            showToast(
                body.action === 'archive'
                    ? `${t.code} is in use — deactivated instead of deleted`
                    : `${t.code} deleted`,
                body.action === 'archive' ? 'warning' : 'success',
            );
            load();
        } else await failure(res, 'Delete failed');
    };

    return (
        <PackagingTypesView
            types={types}
            loading={loading}
            onCreate={handleCreate}
            onEdit={handleEdit}
            onDelete={handleDelete}
        />
    );
}
