'use client';

import AuditLogsView from '../components/settings/AuditLogsView';
import { useData } from '../context/DataContext';

export default function AuditLogsPage() {
    const { auditLogs, pagination, filters } = useData();

    return (
            <AuditLogsView 
                auditLogs={auditLogs} 
                currentPage={pagination.auditPage} 
                totalItems={pagination.auditTotal} 
                pageSize={pagination.pageSize} 
                onPageChange={pagination.setAuditPage} 
                filterType={filters.auditType} 
                onFilterChange={filters.setAuditType} 
            />
    );
}
