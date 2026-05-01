import { DocPage } from '../docsContent';

export const settingsPage: DocPage = {
    slug: 'settings',
    title: 'Settings',
    subtitle: 'Configure company profile, database connections, routing, and application preferences.',
    badges: ['Company Profile', 'Database', 'Routing', 'UI Preferences'],
    sections: [
        {
            heading: 'Company Profile',
            body: 'Set your company name, address, phone, email, and logo under Settings → Company Profile. These details are automatically pulled into all printed documents — Sales Orders, Purchase Orders, Manufacturing Orders, BOM sheets, and Sample Requests — so you do not need to enter them per-document.',
        },
        {
            heading: 'Routing & Work Centres',
            body: 'Define the manufacturing operations (routing steps) and the work centres where they are performed under Settings → Routing. Examples: "Cut" at work centre "Cutting Room", "Sew" at work centre "Sewing Floor". Routing steps are assigned to BOMs and appear on printed Work Orders to guide shop floor operators.',
        },
        {
            heading: 'Database Infrastructure',
            body: 'Teras ERP supports hot-swapping the active database connection without a server restart. From the Settings panel, administrators can configure and test alternate database URLs (PostgreSQL or SQLite), switch the active connection, and manage point-in-time snapshot backups.',
        },
        {
            heading: 'UI Preferences',
            body: 'The application visual style can be changed per-session. Three themes are available: Modern, Compact, and Classic (Windows XP). Theme selection is stored in local browser settings. The application title displayed in the browser tab can also be customised.',
        },
        {
            heading: 'Locations Administration',
            body: 'Physical warehouse locations are managed under Settings → Locations (or Stock → Locations). You can add, rename, and deactivate locations. Deactivated locations are hidden from stock entry pickers but their historical ledger entries are retained.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Set company name, address, and logo for printed documents',
                'Define routing steps and work centres for BOM and WO operations',
                'Configure and hot-swap database connections without a restart',
                'Take point-in-time database snapshots for backup and recovery',
                'Change the UI theme (Modern / Compact / Classic)',
                'Customise the application title',
            ],
        },
    ],
};
