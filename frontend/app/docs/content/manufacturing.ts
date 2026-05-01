import { DocPage } from '../docsContent';

export const manufacturingPage: DocPage = {
    slug: 'manufacturing',
    title: 'Manufacturing',
    subtitle: 'Plan, execute, and track production with Manufacturing Orders, Work Orders, and Production Runs.',
    badges: ['Manufacturing Orders', 'Work Orders', 'Production Runs', 'MES', 'Target vs Actual'],
    sections: [
        {
            heading: 'Manufacturing Orders (MO)',
            body: 'A Manufacturing Order (MO) is the top-level production document. It specifies what finished good to produce, in what quantity, and by when. MOs can be created manually or directly from a Sales Order line via the individual "Produce" button. An MO is linked to a BOM and optionally to a parent Sales Order.',
        },
        {
            heading: 'Work Orders (WO)',
            body: 'Work Orders are the execution-level documents under a Manufacturing Order. Each WO represents a single production step or sub-assembly. While an MO tracks the overall production goal, WOs track the actual work happening on the shop floor — including operator assignment, material consumption, and output recording.',
        },
        {
            heading: 'MO → WO Hierarchy',
            body: 'When you run the BOM Automator from an MO, it generates a child Work Order for each sub-assembly level in the BOM tree. The hierarchy is: MO (what to make) → WO for each level (how to make it). Parent-child relationships are maintained so progress can be rolled up to the MO level.',
        },
        {
            heading: 'Production Runs',
            body: 'A Production Run groups multiple Work Orders into a scheduled batch. Runs appear on the production calendar with colour-coded status indicators. This is useful for planning daily or weekly production schedules across multiple MOs.',
        },
        {
            heading: 'Dual-Track Timestamps',
            body: 'Every Work Order records four timestamps: Target Start, Target End (the plan), Actual Start, and Actual End (what happened). The difference between target and actual gives the schedule variance. All four timestamps are visible on the MO detail view and on printed work order documents.',
        },
        {
            heading: 'Work Order Statuses',
            items: [
                'Draft — created but not yet released to the shop floor',
                'Released — approved and visible to operators',
                'In Progress — at least one operation has been started',
                'Completed — all operations finished and output recorded; materials auto-deducted',
                'Cancelled — withdrawn before completion; no stock movements occur',
            ],
        },
        {
            heading: 'Material Interlocks',
            body: 'Before a Work Order can be started, the system checks that sufficient component stock is available at the designated source location. If any component is short, the WO is blocked and the shortage is highlighted. This prevents phantom production that would result in negative stock.',
        },
        {
            heading: 'Material Auto-Deduction',
            body: 'When a Work Order is marked Completed, the system automatically creates negative stock ledger entries for all BOM components (at the actual quantities consumed) and a positive ledger entry for the finished good output at the designated target location. This keeps stock balances in sync with actual production without manual entry.',
        },
        {
            heading: 'Shop Floor QR Terminal',
            body: 'The /scanner page provides a mobile-optimised operator interface. Each printed Work Order includes a QR code. Operators scan the QR code with a phone or handheld device to pull up that WO and update its status — without needing to log in to the full desktop UI. Status changes broadcast to all connected users via WebSocket.',
        },
        {
            heading: 'Print Templates',
            body: 'Each Work Order and Manufacturing Order has an A4 print template with the QR code, BOM component list, routing steps, target quantities, and due dates. Individual WOs within an MO can be printed separately so operators have the exact sheet for their step only.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Create Manufacturing Orders manually or from Sales Order lines',
                'Run the BOM Automator to generate child Work Orders for all sub-assembly levels',
                'Create Production Runs to batch and schedule WOs',
                'Track WO status from Draft through to Completed',
                'Use material interlock checks before starting production',
                'Mark WOs complete to trigger automatic material deduction and output posting',
                'Scan QR codes at the shop floor terminal to update status from mobile devices',
                'Print individual MO and WO sheets with QR codes and component lists',
            ],
        },
    ],
};
