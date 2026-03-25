'use client';

import MainLayout from '../components/MainLayout';
import SampleRequestView from '../components/SampleRequestView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/Toast';

export default function SamplesPage() {
    const { items, attributes, salesOrders, samples, fetchData, authFetch } = useData();
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

    return (
        <MainLayout>
            <SampleRequestView
                items={items}
                attributes={attributes}
                salesOrders={salesOrders}
                samples={samples}
                onCreateSample={handleCreateSample}
                onUpdateStatus={handleUpdateSampleStatus}
                onDeleteSample={handleDeleteSample}
            />
        </MainLayout>
    );
}
