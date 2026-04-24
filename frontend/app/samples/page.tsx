'use client';

import SampleRequestView from '../components/SampleRequestView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/Toast';

export default function SamplesPage() {
    const { partners, samples, fetchData, authFetch } = useData();
    const customers = partners.filter((p: any) => p.type === 'CUSTOMER');
    const { showToast } = useToast();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const handleCreateSample = async (p: any) => {
        const res = await authFetch(`${API_BASE}/samples`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
    };

    const handleUpdateSampleStatus = async (id: string, status: string) => {
        const res = await authFetch(`${API_BASE}/samples/${id}/status?status=${status}`, { method: 'PUT' });
        if (res.ok) fetchData();
    };

    const handleUpdateColorStatus = async (sampleId: string, colorId: string, status: string) => {
        const res = await authFetch(`${API_BASE}/samples/${sampleId}/colors/${colorId}/status?status=${status}`, { method: 'PUT' });
        if (res.ok) fetchData();
    };

    const handleDeleteSample = async (id: string) => {
        if (!window.confirm('Delete this sample request? This action cannot be undone.')) return;
        const res = await authFetch(`${API_BASE}/samples/${id}`, { method: 'DELETE' });
        if (res.ok) {
            fetchData();
            showToast('Sample request deleted', 'success');
        } else {
            showToast('Failed to delete sample request', 'danger');
        }
    };

    const handleMarkRead = async (id: string) => {
        await authFetch(`${API_BASE}/samples/${id}/read`, { method: 'POST' });
        fetchData('samples');
    };

    const handleMarkUnread = async (id: string) => {
        await authFetch(`${API_BASE}/samples/${id}/read`, { method: 'DELETE' });
        fetchData('samples');
    };

    const handleMarkAllRead = async () => {
        await authFetch(`${API_BASE}/samples/read-all`, { method: 'POST' });
        fetchData('samples');
    };

    return (
        <SampleRequestView
            customers={customers}
            samples={samples}
            onCreateSample={handleCreateSample}
            onUpdateStatus={handleUpdateSampleStatus}
            onUpdateColorStatus={handleUpdateColorStatus}
            onDeleteSample={handleDeleteSample}
            onMarkRead={handleMarkRead}
            onMarkUnread={handleMarkUnread}
            onMarkAllRead={handleMarkAllRead}
        />
    );
}
