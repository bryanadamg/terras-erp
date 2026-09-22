'use client';

import PartnersView from '../components/settings/PartnersView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/shared/Toast';
import { API_BASE } from '../components/shared/apiBase';

export default function SuppliersPage() {
    // No `partners` here: PartnersView server-paginates its own /partners page.
    // fetchData() still refreshes DataContext's /partners/lookup index so the
    // supplier dropdowns elsewhere see the change.
    const { fetchData, authFetch } = useData();
    const { showToast } = useToast();

    const handleCreatePartner = async (p: any) => {
        try {
            const res = await authFetch(`${API_BASE}/partners`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
            if (res.ok) {
                showToast('Supplier created successfully', 'success');
                fetchData();
            } else {
                showToast(`Failed to create supplier: ${res.status}`, 'danger');
            }
        } catch (e) {
            showToast('Network error creating supplier', 'danger');
        }
    };

    const handleUpdatePartner = async (id: string, p: any) => {
        const res = await authFetch(`${API_BASE}/partners/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
    };

    const handleDeletePartner = async (id: string) => {
        const res = await authFetch(`${API_BASE}/partners/${id}`, { method: 'DELETE' });
        if (res.ok) fetchData();
    };

    const handleBulkDeletePartner = async (ids: string[]) => {
        let succeeded = 0;
        let failed = 0;
        for (const id of ids) {
            try {
                const res = await authFetch(`${API_BASE}/partners/${id}`, { method: 'DELETE' });
                if (res.ok) succeeded++;
                else failed++;
            } catch {
                failed++;
            }
        }
        if (succeeded > 0 && failed === 0) {
            showToast(`${succeeded} supplier${succeeded !== 1 ? 's' : ''} deleted`, 'success');
        } else if (succeeded > 0) {
            showToast(`${succeeded} deleted, ${failed} could not be removed — linked records exist`, 'warning');
        } else {
            showToast(`Could not delete suppliers — they have linked records`, 'danger');
        }
        fetchData();
    };

    return (
            <PartnersView
                type="SUPPLIER"
                onCreate={handleCreatePartner}
                onUpdate={handleUpdatePartner}
                onDelete={handleDeletePartner}
                onBulkDelete={handleBulkDeletePartner}
            />
    );
}
