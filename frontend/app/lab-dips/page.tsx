'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import LabDipRequestView from '../components/lab-dips/LabDipRequestView';
import { useData } from '../context/DataContext';
import { useFinishedGoodsSearch } from '../components/shared/useEntitySearch';
import { useToast } from '../components/shared/Toast';
import { useConfirm } from '../context/ConfirmContext';
import { API_BASE } from '../components/shared/apiBase';

export default function LabDipsPage() {
    const { partners, attributes, authFetch } = useData();
    const customers = partners.filter((p: any) => p.type === 'CUSTOMER');
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const searchParams = useSearchParams();
    const router = useRouter();
    // Deep-link from Color Library's "From Lab Dip" cell: /lab-dips?open=<request_id>
    // expands+scrolls to that request. Cleared from the URL once consumed — but LATCHED
    // in state first: the id is a fetch param for the view's server-paginated list (the
    // server ranks it to find its page), so letting it flip back to null when the URL is
    // rewritten would change the query and bounce the list back to page 1.
    const rawOpen = searchParams.get('open');
    const [openRequestId, setOpenRequestId] = useState<string | null>(null);
    useEffect(() => {
        if (!rawOpen) return;
        setOpenRequestId(rawOpen);
        router.replace('/lab-dips');
    }, [rawOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    const [recipes, setRecipes] = useState<any[]>([]);
    const [colors, setColors] = useState<any[]>([]);
    // Finished-goods item picker: shared server-side typeahead (scales past any client cap).
    const { results: items, onSearch: handleItemSearch } = useFinishedGoodsSearch();

    // The request list itself is fetched by LabDipRequestView: it is server-paginated
    // and server-filtered, and the filter state that drives those params lives there.
    // The view also refetches after each mutation below, so these handlers only own the
    // call + the toast.
    const fetchRecipes = useCallback(async () => {
        try {
            // Picker feed, not a list — the approved-recipe select must offer every
            // recipe, so take the uncapped set (`size=0`) rather than page 1.
            const res = await authFetch(`${API_BASE}/dye-recipes?size=0`);
            if (res.ok) {
                const data = await res.json();
                setRecipes(Array.isArray(data) ? data : (data.items ?? []));
            }
        } catch { /* silent */ }
    }, [authFetch, API_BASE]);

    const fetchColors = useCallback(async () => {
        try {
            // Active colors for the dip picker. Capped; a true 30k library needs a
            // server-side typeahead (future), but this covers current volumes.
            const res = await authFetch(`${API_BASE}/colors?status=active&size=500`);
            if (res.ok) {
                const data = await res.json();
                setColors(Array.isArray(data) ? data : (data.items ?? []));
            }
        } catch { /* silent */ }
    }, [authFetch, API_BASE]);

    useEffect(() => { fetchRecipes(); fetchColors(); }, [fetchRecipes, fetchColors]);

    const handleCreate = async (payload: any) => {
        const res = await authFetch(`${API_BASE}/lab-dips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) showToast('Lab dip request created', 'success');
        else showToast('Failed to create lab dip request', 'danger');
    };

    const handleEdit = async (id: string, payload: any) => {
        const res = await authFetch(`${API_BASE}/lab-dips/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) showToast('Lab dip request updated', 'success');
        else showToast('Failed to update lab dip request', 'danger');
    };

    const handleUpdateStatus = async (id: string, status: string) => {
        await authFetch(`${API_BASE}/lab-dips/${id}/status?status=${status}`, { method: 'PUT' });
    };

    // The photo is a second call on purpose: the status PUT decides which side
    // (approval / rejection) the file belongs to, and creates the event row the
    // upload attaches itself to.
    const handleUpdateItemStatus = async (reqId: string, itemId: string, status: string, extra?: { set?: string; notes?: string; reason?: string; variant_attribute_value_id?: string; image?: File | null }) => {
        let url = `${API_BASE}/lab-dips/${reqId}/items/${itemId}/status?status=${status}`;
        if (extra?.set) url += `&set_value=${encodeURIComponent(extra.set)}`;
        if (extra?.notes) url += `&notes=${encodeURIComponent(extra.notes)}`;
        if (extra?.reason) url += `&reason=${encodeURIComponent(extra.reason)}`;
        if (extra?.variant_attribute_value_id) url += `&variant_attribute_value_id=${encodeURIComponent(extra.variant_attribute_value_id)}`;
        const res = await authFetch(url, { method: 'PUT' });
        if (res.ok) {
            if (extra?.image) {
                const fd = new FormData();
                fd.append('file', extra.image);
                await authFetch(`${API_BASE}/lab-dips/${reqId}/items/${itemId}/status-image`, { method: 'POST', body: fd });
            }
            if (status === 'APPROVED') { fetchColors(); showToast('Variant approved · color added to library', 'success'); }
        } else {
            const err = await res.json().catch(() => null);
            showToast(err?.detail || 'Failed to update variant status', 'danger');
        }
    };

    const handleDelete = async (id: string) => {
        const ok = await confirm({
            title: 'Delete Lab Dip Request',
            message: 'Delete this lab dip request? This action cannot be undone.',
            confirmText: 'Delete',
            variant: 'danger',
        });
        if (!ok) return;
        const res = await authFetch(`${API_BASE}/lab-dips/${id}`, { method: 'DELETE' });
        if (res.ok) showToast('Lab dip request deleted', 'success');
        else showToast('Failed to delete lab dip request', 'danger');
    };

    return (
        <LabDipRequestView
            openRequestId={openRequestId}
            customers={customers}
            items={items}
            onSearchItems={handleItemSearch}
            recipes={recipes}
            attributes={attributes || []}
            colors={colors}
            onCreate={handleCreate}
            onEdit={handleEdit}
            onUpdateStatus={handleUpdateStatus}
            onUpdateItemStatus={handleUpdateItemStatus}
            onDelete={handleDelete}
        />
    );
}
