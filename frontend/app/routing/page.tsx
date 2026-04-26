'use client';

import RoutingView from '../components/settings/RoutingView';
import { useData } from '../context/DataContext';

export default function RoutingPage() {
    const { workCenters, operations, fetchData, authFetch } = useData();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const handleCreateWorkCenter = async (p: any) => {
        const res = await authFetch(`${API_BASE}/work-centers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
    };

    const handleCreateOperation = async (p: any) => {
        const res = await authFetch(`${API_BASE}/operations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
    };

    return (
            <RoutingView 
                workCenters={workCenters} 
                operations={operations} 
                onCreateWorkCenter={handleCreateWorkCenter} 
                onCreateOperation={handleCreateOperation} 
            />
    );
}
