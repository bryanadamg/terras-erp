'use client';

import SampleRequestView from '../components/samples/SampleRequestView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/shared/Toast';
import { useConfirm } from '../context/ConfirmContext';
import { API_BASE } from '../components/shared/apiBase';

export default function SamplesPage() {
    const { partners, samples, refreshSamples, authFetch } = useData();
    const customers = partners.filter((p: any) => p.type === 'CUSTOMER');
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    const handleCreateSample = async (p: any, completionImage?: File, designPdf?: File) => {
        const res = await authFetch(`${API_BASE}/samples`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (!res.ok) return;
        const created = await res.json();
        const uploads: Promise<any>[] = [];
        if (completionImage) {
            const fd = new FormData();
            fd.append('file', completionImage);
            uploads.push(authFetch(`${API_BASE}/samples/${created.id}/completion-image`, { method: 'POST', body: fd }));
        }
        if (designPdf) {
            const fd = new FormData();
            fd.append('file', designPdf);
            uploads.push(authFetch(`${API_BASE}/samples/${created.id}/design-pdf`, { method: 'POST', body: fd }));
        }
        if (uploads.length) await Promise.all(uploads);
        refreshSamples();
    };

    const handleUpdateSampleStatus = async (id: string, status: string) => {
        const res = await authFetch(`${API_BASE}/samples/${id}/status?status=${status}`, { method: 'PUT' });
        if (res.ok) refreshSamples();
    };

    // The photo is a second call on purpose: the status PUT is what decides which side
    // (approval / rejection) the file belongs to, and it stamps the event row the
    // upload then attaches itself to.
    const handleUpdateColorStatus = async (sampleId: string, colorId: string, status: string, reason?: string, notes?: string, image?: File | null) => {
        let url = `${API_BASE}/samples/${sampleId}/colors/${colorId}/status?status=${status}`;
        if (reason) url += `&reason=${encodeURIComponent(reason)}`;
        if (notes) url += `&notes=${encodeURIComponent(notes)}`;
        const res = await authFetch(url, { method: 'PUT' });
        if (!res.ok) return;
        if (image) {
            const fd = new FormData();
            fd.append('file', image);
            await authFetch(`${API_BASE}/samples/${sampleId}/colors/${colorId}/status-image`, { method: 'POST', body: fd });
        }
        refreshSamples();
    };

    const handleEditSample = async (id: string, p: any) => {
        const res = await authFetch(`${API_BASE}/samples/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (!res.ok) return;
        refreshSamples();
        showToast('Sample request updated', 'success');
    };

    const handleDeleteSample = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete Sample Request',
            message: 'Delete this sample request? This action cannot be undone.',
            confirmText: 'Delete',
            variant: 'danger',
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/samples/${id}`, { method: 'DELETE' });
        if (res.ok) {
            refreshSamples();
            showToast('Sample request deleted', 'success');
        } else {
            showToast('Failed to delete sample request', 'danger');
        }
    };

    const handleMarkRead = async (id: string) => {
        await authFetch(`${API_BASE}/samples/${id}/read`, { method: 'POST' });
        refreshSamples();
    };

    const handleMarkUnread = async (id: string) => {
        await authFetch(`${API_BASE}/samples/${id}/read`, { method: 'DELETE' });
        refreshSamples();
    };

    const handleMarkAllRead = async () => {
        await authFetch(`${API_BASE}/samples/read-all`, { method: 'POST' });
        refreshSamples();
    };

    return (
        <SampleRequestView
            customers={customers}
            samples={samples}
            onCreateSample={handleCreateSample}
            onEditSample={handleEditSample}
            onUpdateStatus={handleUpdateSampleStatus}
            onUpdateColorStatus={handleUpdateColorStatus}
            onDeleteSample={handleDeleteSample}
            onMarkRead={handleMarkRead}
            onMarkUnread={handleMarkUnread}
            onMarkAllRead={handleMarkAllRead}
        />
    );
}
