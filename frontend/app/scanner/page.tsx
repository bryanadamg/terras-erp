'use client';

import QRScannerView from '../components/shared/QRScannerView';
import MobileScannerView from '../components/mobile/ScannerView';
import { useData } from '../context/DataContext';
import { useRouter } from 'next/navigation';
import { useToast } from '../components/shared/Toast';
import { useIsMobile } from '../hooks/useIsMobile';
import { useEffect, useState, useCallback } from 'react';

export default function ScannerPage() {
    const { items, boms, locations, attributes, stockBalance, workCenters, fetchData, authFetch } = useData();
    const router = useRouter();
    const { showToast } = useToast();
    const isMobile = useIsMobile();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const [localMOs, setLocalMOs] = useState<any[]>([]);
    const [localBoms, setLocalBoms] = useState<any[]>(boms);
    const [localStockBalance, setLocalStockBalance] = useState<any[]>(stockBalance);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(async () => {
        const [moRes, bomsRes, balanceRes] = await Promise.all([
            authFetch(`${API_BASE}/manufacturing-orders?skip=0&limit=9999`),
            authFetch(`${API_BASE}/boms`),
            authFetch(`${API_BASE}/stock/balance`),
        ]);
        if (moRes.ok) { const d = await moRes.json(); setLocalMOs(Array.isArray(d) ? d : (d.items || [])); }
        if (bomsRes.ok) { setLocalBoms(await bomsRes.json()); }
        if (balanceRes.ok) { setLocalStockBalance(await balanceRes.json()); }
    }, [authFetch, API_BASE]);

    useEffect(() => {
        const load = async () => {
            try { await reload(); }
            finally { setLoading(false); }
        };
        load();
    }, []);

    // Legacy desktop scanner still uses work-orders via onUpdateStatus
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
                    <div className="small">Loading orders...</div>
                </div>
            </div>
        );
    }

    if (isMobile) {
        return (
            <MobileScannerView
                manufacturingOrders={localMOs}
                items={items}
                boms={localBoms}
                locations={locations}
                stockBalance={localStockBalance}
                workCenters={workCenters}
                authFetch={authFetch}
                onRefresh={reload}
                onClose={() => router.push('/manufacturing-orders')}
            />
        );
    }

    return (
        <div className="container-fluid py-2 h-100">
            <div className="row justify-content-center">
                <div className="col-md-8 col-lg-6">
                    <QRScannerView
                        workOrders={localMOs}
                        items={items}
                        boms={localBoms}
                        locations={locations}
                        attributes={attributes}
                        stockBalance={localStockBalance}
                        onUpdateStatus={handleUpdateWOStatus}
                        onClose={() => router.push('/manufacturing-orders')}
                    />
                </div>
            </div>
        </div>
    );
}
