'use client';

import BOMView from '../components/bom/BOMView';
import { useData } from '../context/DataContext';
import { useConfirm } from '../context/ConfirmContext';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function BOMPage() {
    const { items, attributes, sizes, boms, operations, workCenters, partners, companyProfile, fetchData, authFetch, filters } = useData();
    const { confirm } = useConfirm();
    const searchParams = useSearchParams();
    const [initialCreateState, setInitialCreateState] = useState<any>(null);
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    useEffect(() => {
        if (searchParams.get('action') === 'create_bom') {
            setInitialCreateState({
                item_id: searchParams.get('item_id'),
                attribute_value_ids: searchParams.get('attribute_value_ids')
            });
        }
    }, [searchParams]);

    const handleClearInitialState = () => {
        setInitialCreateState(null);
    };

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

    const handleDeleteBOM = async (id: string) => {
        const confirmed = await confirm({
            title: 'Delete BOM',
            message: 'Are you sure you want to delete this BOM? This action cannot be undone.',
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;

        const res = await authFetch(`${API_BASE}/boms/${id}`, { method: 'DELETE' });
        if (res.ok) fetchData();
        return res;
    };

    const handleUploadBOMPhoto = async (bomId: string, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await authFetch(`${API_BASE}/boms/${bomId}/sample-photo`, { method: 'POST', body: formData });
        if (res.ok) fetchData();
    };

    const handleUploadBOMDesign = async (bomId: string, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await authFetch(`${API_BASE}/boms/${bomId}/design-file`, { method: 'POST', body: formData });
        if (res.ok) fetchData();
    };

    const handleDeleteMultipleBOMs = async (ids: string[]) => {
        const confirmed = await confirm({
            title: 'Delete BOMs',
            message: `Delete ${ids.length} BOM(s)? This action cannot be undone.`,
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;

        await Promise.all(ids.map(id => authFetch(`${API_BASE}/boms/${id}`, { method: 'DELETE' })));
        fetchData();
    };

    return (
            <BOMView
                items={items}
                attributes={attributes}
                sizes={sizes}
                boms={boms}
                operations={operations}
                workCenters={workCenters}
                partners={partners}
                onCreateBOM={handleCreateBOM}
                onUploadBOMPhoto={handleUploadBOMPhoto}
                onUploadBOMDesign={handleUploadBOMDesign}
                onDeleteBOM={handleDeleteBOM}
                onDeleteMultipleBOMs={handleDeleteMultipleBOMs}
                onSearchItem={filters.setItemSearch}
                onCreateItem={handleCreateItem}
                locations={[]}
                companyProfile={companyProfile}
                initialCreateState={initialCreateState}
                onClearInitialState={handleClearInitialState}
            />
    );
}
