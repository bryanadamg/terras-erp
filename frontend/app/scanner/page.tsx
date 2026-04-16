'use client';

import QRScannerView from '../components/QRScannerView';
import { useData } from '../context/DataContext';
import { useRouter } from 'next/navigation';
import { useToast } from '../components/Toast';
import { useEffect, useState } from 'react';

export default function ScannerPage() {
    const { items, boms, locations, attributes, stockBalance, fetchData, authFetch } = useData();
    const router = useRouter();
    const { showToast } = useToast();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const [localWorkOrders, setLocalWorkOrders] = useState<any[]>([]);
    const [localBoms, setLocalBoms] = useState<any[]>(boms);
    const [localStockBalance, setLocalStockBalance] = useState<any[]>(stockBalance);
    const [loading, setLoading] = useState(true);

    // Fetch all data directly on mount — independent of which page was visited before
    useEffect(() => {
        const load = async () => {
            try {
                const [woRes, bomsRes, balanceRes] = await Promise.all([
                    authFetch(`${API_BASE}/work-orders?skip=0&limit=9999`),
                    authFetch(`${API_BASE}/boms`),
                    authFetch(`${API_BASE}/stock/balance`),
                ]);
                if (woRes.ok) { const d = await woRes.json(); setLocalWorkOrders(d.items || []); }
                if (bomsRes.ok) { setLocalBoms(await bomsRes.json()); }
                if (balanceRes.ok) { setLocalStockBalance(await balanceRes.json()); }
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const handleUpdateWOStatus = async (woId: string, status: string) => {
        const res = await authFetch(`${API_BASE}/work-orders/${woId}/status?status=${status}`, { method: 'PUT' });
        if (res.ok) { fetchData(); return true; }
        else { const err = await res.json(); showToast(`Error: ${err.detail}`, 'danger'); return false; }
    };

    if (loading) {
        return (
            <div className="d-flex align-items-center justify-content-center h-100 py-5">
                <div className="text-center text-muted">
                    <div className="spinner-border mb-3" role="status"></div>
                    <div className="small">Loading work orders...</div>
                </div>
            </div>
        );
    }

    return (
            <div className="container-fluid py-2 h-100">
                <div className="row justify-content-center">
                    <div className="col-md-8 col-lg-6">
                        <QRScannerView
                            workOrders={localWorkOrders}
                            items={items}
                            boms={localBoms}
                            locations={locations}
                            attributes={attributes}
                            stockBalance={localStockBalance}
                            onUpdateStatus={handleUpdateWOStatus}
                            onClose={() => router.push('/manufacturing')}
                        />
                    </div>
                </div>
            </div>
    );
}
