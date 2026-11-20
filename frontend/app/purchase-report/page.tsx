'use client';

import PurchaseReportView from '../components/purchasing/PurchaseReportView';

// Self-fetching: queries /purchase-orders/report/{lines|receipts} with its own filters.
export default function PurchaseReportPage() {
    return <PurchaseReportView />;
}
