'use client';

import QRScannerView from '../components/QRScannerView';
import { useData } from '../context/DataContext';
import { useRouter } from 'next/navigation';
import { useToast } from '../components/Toast';

export default function ScannerPage() {
    const { workOrders, items, boms, locations, attributes, stockBalance, fetchData, authFetch } = useData();
    const router = useRouter();
    const { showToast } = useToast();
    const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
    const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

    const handleUpdateWOStatus = async (woId: string, status: string) => {
        const res = await authFetch(`${API_BASE}/work-orders/${woId}/status?status=${status}`, { method: 'PUT' });
        if (res.ok) { fetchData(); return true; } 
        else { const err = await res.json(); showToast(`Error: ${err.detail}`, 'danger'); return false; }
    };

    return (
            <div className="container-fluid py-2 h-100">
                <div className="row justify-content-center">
                    <div className="col-md-8 col-lg-6">
                        <QRScannerView 
                            workOrders={workOrders} 
                            items={items} 
                            boms={boms} 
                            locations={locations} 
                            attributes={attributes} 
                            stockBalance={stockBalance} 
                            onUpdateStatus={handleUpdateWOStatus} 
                            onClose={() => router.push('/manufacturing')} 
                        />
                    </div>
                </div>
            </div>
    );
}
