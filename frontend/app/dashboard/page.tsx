'use client';

import DashboardView from '../components/dashboard/DashboardView';
import MobileDashboardView from '../components/mobile/DashboardView';
import { useEffect } from 'react';
import { useData } from '../context/DataContext';
import { useUser } from '../context/UserContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function DashboardPage() {
    const {
        items, stockBalance, dashboardWorkOrders, salesOrders, dashboardKPIs,
        dashboardSummary, dashboardOutlook, dashboardKpiHistory, itemIndex, loading, fetchData,
    } = useData();
    const { currentUser } = useUser();
    const isMobile = useIsMobile();

    // Login sets currentUser while the URL is still /login, so DataContext's
    // first fetch targets 'login' and skips every dashboard payload; the
    // router.push that follows fetches nothing. Ask for it here. fetchData
    // dedupes in-flight targets, so a sidebar click or cold start that already
    // asked costs no second round-trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (currentUser) fetchData('dashboard'); }, [currentUser]);

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
                loading={loading.dashboardWorkOrders || loading.dashboard}
            />
    );
}
