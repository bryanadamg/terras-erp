'use client';

import ReportsView from '../components/dashboard/ReportsView';
import { useData } from '../context/DataContext';

export default function ReportsPage() {
    const { stockEntries, items, locations, categories, pagination, fetchData } = useData();

    return (
            <ReportsView 
                stockEntries={stockEntries} 
                items={items} 
                locations={locations} 
                categories={categories} 
                currentPage={pagination.reportPage} 
                totalItems={pagination.reportTotal} 
                pageSize={pagination.pageSize} 
                onPageChange={pagination.setReportPage}
                onRefresh={fetchData}
            />
    );
}
