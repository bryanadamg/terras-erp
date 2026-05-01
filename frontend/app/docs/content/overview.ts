import { DocPage } from '../docsContent';

export const overviewPage: DocPage = {
    slug: 'overview',
    title: 'Teras ERP — System Overview',
    subtitle: 'A complete manufacturing and inventory management system for factory operations.',
    badges: ['Inventory', 'Manufacturing', 'BOM', 'Sales', 'Purchase', 'Reports'],
    sections: [
        {
            heading: 'What is Teras ERP?',
            body: 'Teras ERP is a full-stack Enterprise Resource Planning system purpose-built for manufacturing businesses. It connects every stage of your operation — from raw material procurement through multi-level production to finished goods delivery — in a single, integrated platform.',
        },
        {
            heading: 'Core Capabilities',
            items: [
                'Real-time inventory tracking across multiple warehouse locations with O(1) stock lookups',
                'Multi-level Manufacturing Orders (MO) and Work Orders (WO) with MES-level production tracking',
                'Recursive Bill of Materials (BOM) supporting nested assemblies, percentage-based quantities, and tolerance controls',
                'BOM Automator wizard for one-click generation of child MOs across all assembly levels',
                'Sales and Purchase order lifecycle management with print-ready A4 templates',
                'PLM Sample Request workflow for new product development with design file attachments',
                'Live KPI dashboard and Smart Advisor with WebSocket-powered real-time updates',
                'Role-based access control (RBAC) with granular per-user category restrictions',
                'Full audit trail with immutable change logs and JSON field diffs',
            ],
        },
        {
            heading: 'Technology',
            body: 'The backend runs on FastAPI (Python 3.11+) with PostgreSQL 15 and Redis 7. The frontend is built with Next.js 14 and React 18. Real-time events are broadcast via Redis pub/sub and WebSockets. All services ship as Docker containers.',
        },
        {
            heading: 'Module Map',
            items: [
                'Inventory — Items, Attributes, Variants, Categories, UOM',
                'Stock — Locations, Stock Balances, Ledger, Scanner Terminal',
                'BOM Designer — Recursive BOMs, Routing, Percentage Quantities, Automator',
                'Manufacturing — Manufacturing Orders, Work Orders, Production Runs',
                'Sales — Sales Orders, Customer Management, Produce-to-Order',
                'Purchase — Purchase Orders, Supplier Management, Goods Receipt',
                'Samples & PLM — Sample Masters, Sample Requests, Approval Workflow',
                'Dashboard & Reports — KPIs, Smart Advisor, Analytics',
                'Administration — Settings, Users, Roles, Audit Logs',
            ],
        },
    ],
};
