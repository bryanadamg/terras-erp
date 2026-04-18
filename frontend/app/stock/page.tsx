'use client';

import StockEntryView from '../components/StockEntryView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/Toast';

export default function StockEntryPage() {
    const { items, locations, attributes, stockBalance, fetchData, authFetch } = useData();
    const { showToast } = useToast();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const handleAddStock = async (p: any) => {
        const res = await authFetch(`${API_BASE}/stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) { showToast('Stock Entry recorded', 'success'); fetchData(); }
    };

    return (
            <StockEntryView 
                items={items} 
                locations={locations} 
                attributes={attributes} 
                stockBalance={stockBalance} 
                onRecordStock={handleAddStock}
            />
    );
}
