'use client';

import LocationsView from '../components/LocationsView';
import { useData } from '../context/DataContext';
import { useConfirm } from '../context/ConfirmContext';

export default function LocationsPage() {
    const { locations, fetchData, authFetch } = useData();
    const { confirm } = useConfirm();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const handleCreateLocation = async (p: any) => {
        const res = await authFetch(`${API_BASE}/locations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
        return res;
    };

    const handleDeleteLocation = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete Location', message: 'Are you sure you want to delete this location?',
            confirmText: 'Delete', variant: 'danger',
        });
        if (!confirmed) return;
        const res = await authFetch(`${API_BASE}/locations/${id}`, { method: 'DELETE' });
        if (res.ok) fetchData();
    };

    return (
            <LocationsView
                locations={locations}
                onCreateLocation={handleCreateLocation}
                onDeleteLocation={handleDeleteLocation}
                onRefresh={fetchData}
            />
    );
}
