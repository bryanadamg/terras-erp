'use client';

import MainLayout from '../components/MainLayout';
import BOMView from '../components/BOMView';
import { useData } from '../context/DataContext';

export default function BOMPage() {
    const { items, attributes, boms, operations, workCenters, fetchData, authFetch, filters } = useData();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const handleCreateBOM = async (p: any) => {
        const res = await authFetch(`${API_BASE}/boms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
        return res;
    };

    const handleCreateItem = async (p: any) => {
        const res = await authFetch(`${API_BASE}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) fetchData();
        return res;
    };

    return (
        <MainLayout>
            <BOMView 
                items={items} 
                attributes={attributes} 
                boms={boms} 
                operations={operations} 
                workCenters={workCenters} 
                onCreateBOM={handleCreateBOM} 
                onSearchItem={filters.setItemSearch}
                onCreateItem={handleCreateItem}
                locations={[]} 
            />
        </MainLayout>
    );
}
