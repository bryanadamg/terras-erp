'use client';

import StockEntryView from '../components/stock/StockEntryView';
import MobileStockView from '../components/mobile/StockView';
import { useData } from '../context/DataContext';
import { useToast } from '../components/shared/Toast';
import { useIsMobile } from '../hooks/useIsMobile';

export default function StockEntryPage() {
    const { items, locations, attributes, stockBalance, fetchData, authFetch } = useData();
    const { showToast } = useToast();
    const isMobile = useIsMobile();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const handleAddStock = async (p: any) => {
        const res = await authFetch(`${API_BASE}/stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
        if (res.ok) { showToast('Stock Entry recorded', 'success'); fetchData(); }
    };

    if (isMobile) {
        return <MobileStockView items={items} locations={locations} stockBalance={stockBalance} />;
    }

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
