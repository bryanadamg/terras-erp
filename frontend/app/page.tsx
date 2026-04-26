'use client';

import DashboardView from './components/dashboard/DashboardView';
import { useData } from './context/DataContext';

export default function RootPage() {
    const {
        items, locations, stockBalance, workOrders,
        stockEntries, samples, salesOrders, dashboardKPIs
    } = useData();

    return (
            <DashboardView
                items={items}
                locations={locations}
                stockBalance={stockBalance}
                workOrders={workOrders}
                stockEntries={stockEntries}
                samples={samples}
                salesOrders={salesOrders}
                kpis={dashboardKPIs}
            />
    );
}
