import { DocPage } from '../docsContent';

export const settingsPage: DocPage = {
    slug: 'settings',
    title: 'Settings',
    subtitle: 'Configure company profile, database connections, routing, and application preferences.',
    badges: ['Company Profile', 'Database', 'Backups', 'Routing', 'Print Layouts', 'UI Preferences'],
    sections: [
        {
            heading: 'Company Profile',
            body: 'Set your company name, address, phone, email, and logo under Settings → Company Profile. These details are automatically pulled into all printed documents — Sales Orders, Purchase Orders, Manufacturing Orders, BOM sheets, and Sample Requests — so you do not need to enter them per-document.',
        },
        {
            heading: 'Routing & Work Centres',
            body: 'Define the manufacturing operations (routing steps) and the work centres where they are performed under Settings → Routing. Examples: "Weave" at work centre "Weaving Floor", "Dye" at work centre "Dye House". Routing steps are assigned to BOMs and appear on printed Work Orders to guide shop floor operators.',
            items: [
                'Each work centre has a type (GENERAL, BEAMING, WEAVING, DYEING, SETTING, …) that drives type-specific behaviour — e.g. a DYEING centre auto-resolves dye recipes for its Work Orders.',
                'Work centres can define default input and output stock locations, which flow onto the Work Orders assigned to them.',
                'Work centres can be organised into parent/child groups, and the Work Order list can be filtered by group so each floor area gets its own queue.',
            ],
        },
        {
            heading: 'Database Infrastructure',
            body: 'Terras ERP supports hot-swapping the active database connection without a server restart. From the Settings panel, administrators can configure and test alternate PostgreSQL database URLs, switch the active connection, take point-in-time snapshot backups, and schedule those backups to run automatically on a recurring basis.',
        },
        {
            heading: 'UI Preferences',
            body: 'The application visual style can be switched per-device between two themes — Classic (a Windows-XP-styled look) and Modern (a flatter, Bootstrap-style look) — plus an independent interface scale for denser or larger screens. Theme and scale are stored in local browser settings, so the choice is per-device, not per-account. The application title displayed in the browser tab can also be customised.',
        },
        {
            heading: 'Print Layouts',
            body: 'Print Layouts lets an administrator adjust the branded A4 print templates used across the system (Sales Orders, Purchase Orders, Manufacturing Orders, BOM sheets, Sample Requests, Kartu Celup) without touching code.',
        },
        {
            heading: 'Locations Administration',
            body: 'Physical warehouse locations are managed under Settings → Locations (or Stock → Locations) on a master-detail screen. You can add, rename, and deactivate locations, and group them under location categories (drag a location onto a category to reassign). Deactivated locations are hidden from stock entry pickers but their historical ledger entries are retained.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Set company name, address, and logo for printed documents',
                'Define routing steps and work centres (with type, input/output locations, and groups) for BOM and WO operations',
                'Group warehouse locations under location categories',
                'Configure and hot-swap database connections without a restart',
                'Take point-in-time database snapshots, and schedule them to run automatically',
                'Switch the UI theme (Classic / Modern) and interface scale',
                'Adjust branded A4 print layouts from Print Layouts',
                'Customise the application title',
            ],
        },
    ],
};
