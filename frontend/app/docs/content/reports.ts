import { DocPage } from '../docsContent';

export const reportsPage: DocPage = {
    slug: 'reports',
    title: 'Reports & Dashboard',
    subtitle: 'Real-time KPIs, production performance analytics, and inventory intelligence.',
    badges: ['KPIs', 'Live Data', 'Smart Advisor', 'WebSocket', 'Analytics'],
    sections: [
        {
            heading: 'Dashboard',
            body: 'The Dashboard is the first screen after login and provides a live operational summary. It shows active work orders, current stock levels for key items, the open sales order pipeline, and key performance indicators. Data is pushed via WebSocket — the page updates automatically without a refresh whenever relevant data changes anywhere in the system.',
        },
        {
            heading: 'KPI Grid',
            body: 'The KPI grid across the top of the Dashboard shows four headline metrics at a glance: total active SKUs, items below reorder level (low-stock alerts), active Manufacturing Orders, and open Sales Orders. Each KPI is a clickable shortcut to the relevant module.',
        },
        {
            heading: 'Smart Advisor',
            body: 'The Smart Advisor analyses current operational data and surfaces actionable items. It runs a recursive material coverage analysis against open Manufacturing Orders to calculate Production Yield (what percentage of open orders can be started with current stock) and Delivery Readiness (what percentage of open SO lines have sufficient finished goods or production in progress to fulfil). Low-stock and overdue items are listed with direct links.',
        },
        {
            heading: 'Production Calendar',
            body: 'The Calendar view on the Dashboard visualises Production Runs over time. Each run is displayed as a colour-coded event based on its status (Scheduled, In Progress, Completed). This gives production managers an at-a-glance view of the manufacturing schedule.',
        },
        {
            heading: 'WebSocket Event Stream',
            body: 'Manufacturing status changes, stock movements, and order updates are broadcast to connected clients in real-time via a Redis pub/sub WebSocket endpoint at /api/ws/events. The connection is authenticated with the same login token as the rest of the API, and each event is delivered only to users whose permissions cover it — a picker is not sent manufacturing events. The frontend DataContext subscribes on load and triggers targeted data refetches when relevant events arrive, keeping all views current without polling.',
        },
        {
            heading: 'Reports',
            body: 'The Reports section provides pre-built tabular reports. Available reports include stock movement history, production output summary, sales performance by customer or item, and purchase history by supplier. Reports support filtering by date range, location, item category, and partner.',
        },
        {
            heading: 'Production Output & QC Reject',
            body: 'The Production Output report answers "what did we make, and how much was rejected". Four views share one date range: Per Machine and Per Group roll output up the work-centre tree; Per Work Order is the result sheet for a finished order (target, hasil, QC reject, reject % of hasil) with a "Completed WOs only" filter; Packing reports the same columns per packing order, since packing rejects have no machine to peg to. Expanding any row lists its reject events — quantity, reason, who rejected it, and the defect store the scrap was moved into. Everything exports to Excel.',
        },
        {
            heading: 'Reject Locations',
            body: 'QC-rejected stock never stays on the good shelf — it is transferred to a defect store, routed automatically by the producing work centre or the item\'s default reject location. See Quality & Quarantine for the full grading and routing rules, including the "still usable" downgrade that keeps a rejected lot selectable elsewhere instead of scrapping it outright.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Monitor live KPIs from the Dashboard without refreshing',
                'Read Smart Advisor recommendations for stock shortages, overdue orders, and production readiness',
                'View the production calendar to track scheduled and active runs',
                'Run pre-built tabular reports for stock, production, sales, and purchasing',
                'Report output and QC reject per machine, per work order, or per packing order',
                'Filter all reports by date range, location, category, or partner',
            ],
        },
    ],
};
