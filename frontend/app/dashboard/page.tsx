'use client';

import DashboardView from '../components/dashboard/DashboardView';
import MobileDashboardView from '../components/mobile/DashboardView';
import { useData } from '../context/DataContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function DashboardPage() {
    const {
        items, stockBalance, dashboardWorkOrders, salesOrders, dashboardKPIs,
        dashboardSummary, dashboardOutlook, dashboardKpiHistory, itemIndex, loading,
    } = useData();
    const isMobile = useIsMobile();

    if (isMobile) {
        return (
            <MobileDashboardView
                items={items}
                stockBalance={stockBalance}
                workOrders={dashboardWorkOrders}
                salesOrders={salesOrders}
                kpis={dashboardKPIs}
                summary={dashboardSummary}
                itemIndex={itemIndex}
            />
        );
    }

    return (
            <DashboardView
                items={items}
                workOrders={dashboardWorkOrders}
                kpis={dashboardKPIs}
                summary={dashboardSummary}
                itemIndex={itemIndex}
                kpiHistory={dashboardKpiHistory}
                outlook={dashboardOutlook}
                loading={loading.manufacturingOrders}
            />
    );
}
