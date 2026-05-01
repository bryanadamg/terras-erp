import { DocPage } from '../docsContent';

export const auditLogsPage: DocPage = {
    slug: 'audit-logs',
    title: 'Audit Logs',
    subtitle: 'A complete, tamper-evident record of all system activity.',
    badges: ['Audit Trail', 'Compliance', 'Change History', 'JSON Diffs'],
    sections: [
        {
            heading: 'What is Logged?',
            body: 'Every create, update, and delete operation performed by any user is recorded in the audit log. The log captures the user who performed the action, the exact timestamp, the affected entity type and ID, the action name, and the before/after field values as a JSON diff.',
        },
        {
            heading: 'JSON Field Diffs',
            body: 'For update operations, the audit log entry includes a structured diff of what changed — which fields were modified, what the old value was, and what the new value is. This allows administrators to reconstruct the exact state of any record at any point in time by replaying the diff history.',
        },
        {
            heading: 'Viewing Audit Logs',
            body: 'Navigate to Audit Logs from the sidebar. The list is filterable by user, date range, entity type (e.g. ManufacturingOrder, Item, StockEntry), and action (create, update, delete). Each row can be expanded to reveal the full change detail including the JSON diff.',
        },
        {
            heading: 'Item-Level History',
            body: 'In addition to the global audit log, each Item has an inline history pane accessible from its detail view. This pane shows only the changes relevant to that specific item in chronological order, making it easy to trace the history of a single product without filtering the global log.',
        },
        {
            heading: 'Immutability & Compliance',
            body: 'Audit log entries are append-only. There is no UI to edit or delete audit entries. This immutability makes the log suitable for compliance, accountability, and dispute resolution in regulated manufacturing environments. Only database administrators with direct server access can alter the underlying data.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Browse all system activity in the global Audit Logs view',
                'Filter by user, date range, entity type, and action',
                'Expand any log entry to see the full JSON field diff',
                'View per-item history directly from the item detail page',
            ],
        },
    ],
};
