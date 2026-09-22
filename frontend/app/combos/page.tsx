'use client';

import { useState } from 'react';
import ComboLibraryView from '../components/combos/ComboLibraryView';
import { useData } from '../context/DataContext';
import { usePaginatedFetch } from '../context/usePaginatedList';
import { useToast } from '../components/shared/Toast';
import { API_BASE } from '../components/shared/apiBase';

// Uncapped on purpose. The colour-family chips filter on words parsed out of every
// combo name, so their tallies have to see the whole matching set — over one page
// they would undercount and the chips would hide rows. `size=0` is the uncapped
// contract on the endpoint (the same request `/dye-recipes`' lookup callers make),
// and 147 rows of bounded master data is nothing to hold. If the library ever
// reaches the thousands this needs a real server-side family filter instead.

export default function CombosPage() {
    const { authFetch } = useData();
    const { showToast } = useToast();

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');

    // Page window, fetch, loading flag and stale-response race guard all come from
    // the shared hook (context/usePaginatedList.ts). ComboLibraryView debounces its
    // search box itself, so `search` arrives already settled and rides in as a
    // plain param rather than through the hook's own search box.
    const {
        rows: combos, total, loading, refetch: fetchCombos,
    } = usePaginatedFetch<any>({
        endpoint: `${API_BASE}/combos`,
        authFetch,
        pageSize: 0,
        params: {
            search,
            status: statusFilter === 'ALL' ? '' : statusFilter,
        },
    });


    const handleSearchChange = setSearch;
    const handleStatusChange = setStatusFilter;

    const handleCreate = async (payload: any) => {
        const res = await authFetch(`${API_BASE}/combos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) { fetchCombos(); showToast('Combo created', 'success'); }
        else { const e = await res.json().catch(() => ({})); showToast(e.detail || 'Failed to create combo', 'danger'); }
    };

    const handleEdit = async (id: string, payload: any) => {
        const res = await authFetch(`${API_BASE}/combos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) { fetchCombos(); showToast('Combo updated', 'success'); }
        else { const e = await res.json().catch(() => ({})); showToast(e.detail || 'Failed to update combo', 'danger'); }
    };

    const handleDelete = async (id: string) => {
        const res = await authFetch(`${API_BASE}/combos/${id}`, { method: 'DELETE' });
        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            fetchCombos();
            showToast(data.action === 'archive' ? 'Combo archived' : 'Combo deleted', 'success');
        } else showToast('Failed to remove combo', 'danger');
    };

    return (
        <ComboLibraryView
            combos={combos}
            total={total}
            search={search}
            statusFilter={statusFilter}
            loading={loading}
            onSearchChange={handleSearchChange}
            onStatusChange={handleStatusChange}
            onCreate={handleCreate}
            onEdit={handleEdit}
            onDelete={handleDelete}
        />
    );
}
