'use client';

import LocationsView from '../components/settings/LocationsView';
import { useData } from '../context/DataContext';
import { useConfirm } from '../context/ConfirmContext';
import { API_BASE } from '../components/shared/apiBase';

export default function LocationsPage() {
    const { locations, fetchData, authFetch } = useData();
    const { confirm } = useConfirm();

    const fetchLocations = async (): Promise<any[]> => {
        try {
            const res = await authFetch(`${API_BASE}/locations`);
            if (res.ok) return res.json();
        } catch {}
        return locations;
    };

    const handleCreateLocation = async (p: any) => {
        const res = await authFetch(`${API_BASE}/locations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
        return res;
    };

    const handleUpdateLocation = async (id: string, body: any) => {
        const res = await authFetch(`${API_BASE}/locations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return err.detail || 'Failed to delete location';
        }
        fetchData();
    };

    return (
            <LocationsView
                locations={locations}
                onCreateLocation={handleCreateLocation}
                onUpdateLocation={handleUpdateLocation}
                onDeleteLocation={handleDeleteLocation}
                onRefresh={fetchData}
                fetchLocations={fetchLocations}
            />
    );
}
