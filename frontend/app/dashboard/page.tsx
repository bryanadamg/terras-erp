'use client';

import DashboardView from '../components/dashboard/DashboardView';
import MobileDashboardView from '../components/mobile/DashboardView';
import { useData } from '../context/DataContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function DashboardPage() {
    const {
        items, locations, stockBalance, workOrders,
        stockEntries, samples, salesOrders, dashboardKPIs
    } = useData();
    const isMobile = useIsMobile();

    if (isMobile) {
        return (
            <MobileDashboardView
                items={items}
                stockBalance={stockBalance}
                workOrders={workOrders}
                salesOrders={salesOrders}
                kpis={dashboardKPIs}
            />
        );
    }

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
