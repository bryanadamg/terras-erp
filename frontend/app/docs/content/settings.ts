import { DocPage } from '../docsContent';

export const settingsPage: DocPage = {
    slug: 'settings',
    title: 'Settings',
    subtitle: 'Device preferences, your own account, the company profile, the production quantity formula, and database backups.',
    badges: ['Preferences', 'My Account', 'Company Profile', 'Quantity Formula', 'Backups', 'Snapshots'],
    sections: [
        {
            heading: 'Opening Settings',
            body: 'Settings is not in the sidebar list. Open it by clicking your name and avatar at the bottom of the sidebar (on a phone, from the top of the mobile screen). The page has up to four tabs. The last tab you used is remembered while the browser tab stays open.',
            table: {
                headers: ['Tab', 'Who sees it', 'What it holds'],
                rows: [
                    ['**General**', 'Everyone', 'System Preferences for this device, the Company Profile (admins), and the Production Quantity Formula (admins edit, others read)'],
                    ['**My Account**', 'Everyone', 'Your avatar, username, full name and password'],
                    ['**Database & Backups**', 'Administrators', 'System status, live event feed health, scheduled backups, database connection, snapshots, and the database wipe'],
                    ['**Access Control**', 'Administrators', 'Roles and users. See the User Management page.'],
                ],
            },
            callout: { type: 'info', text: 'Routing and work centres are under Engineering → Routing, warehouse locations under Inventory → Locations, and print templates under Administration → Print Layouts. They are no longer part of Settings.' },
        },
        {
            heading: 'General → System Preferences',
            body: 'These three settings are stored in this browser only, so each PC, tablet or phone keeps its own choice. Click Save Preferences to apply them.',
            items: [
                'Application Name: the name shown in the browser tab and on the loading screen. Only administrators can change it, and it applies to the device it was changed on.',
                'Interface Scale: shrinks or enlarges the whole interface so more rows fit on screen without browser zoom. 80% is the default. Phones and printouts always render at 100%.',
                'Display Timezone: the zone that dates and times (for example in the stock ledger) are shown in on this device.',
            ],
        },
        {
            heading: 'General → Company Profile (administrators)',
            body: 'The company details printed in the letterhead of documents such as the Surat Jalan, Purchase Order and Sales Order Confirmation. Upload the logo in the logo box, fill in the fields, and click Save Profile.',
            items: [
                'Company Logo, Company Name, Address, Phone, Email, Website, Tax ID / NPWP.',
                'Weighing Tolerance (%): how far a scale reading may differ from the book quantity and still count as on target. Allowed range 0 to 10, default 2.',
                'A work order or manufacturing order counts as complete once the logged quantity reaches the target less this tolerance (a 19 kg order that weighs out at 18.8 kg is complete at 2%).',
                'When a packing order is closed, any lot it holds that has only a weighing gap left on the desk (within the tolerance of that lot\'s quantity) is written off as a measurement variance, not as scrap. If any held lot still has more than that left, the close is refused and nothing is written off.',
            ],
        },
        {
            heading: 'General → Production Quantity Formula',
            body: 'This formula turns the sizes a customer ordered into the sizes to actually make. It is applied when a planner clicks Apply in the New Production Run window. Each size has an expression. The result is then multiplied by the tolerance % the planner types and rounded up. Administrators can edit it here or from the gear button beside Apply in the Production Run window. Both places edit the same factory-wide rule.',
            items: [
                'A size name (S, M, L, 2XL, ...) means the quantity ordered for that size.',
                'qty means the quantity ordered for the row\'s own size.',
                'The "other" row is the fallback. It is used by any size without its own row and by recipes with no size breakdown. Leave a size row blank to use it.',
                'Allowed in an expression: size names, qty, numbers, + - * / ( ) and the functions min(), max(), round(), ceil(), floor(), abs(). Anything else is flagged in red and cannot be saved.',
                'The Ordered and Makes columns plus Test tolerance % are a scratch pad for trying the formula on a sample order. Nothing there is saved.',
                'Reset to default restores the original rule below. Click Save Formula to keep your changes.',
            ],
            table: {
                headers: ['Size', 'Default expression'],
                rows: [
                    ['S', '0'],
                    ['M', '(S + M) / 2'],
                    ['L', '(S + M) / 2 + L'],
                    ['other', 'qty'],
                ],
            },
        },
        {
            heading: 'My Account',
            body: 'Every user can change their own avatar, username, full name and password here. One Save Account button saves all three groups.',
            items: [
                'Avatar: hover an option to try it on, or use Shuffle for a new face. If you never save one, your role\'s avatar template (if any) and your username decide it.',
                'Password: enter your current password, then the new one twice. Leave the new password blank to keep the old one.',
            ],
        },
        {
            heading: 'Database & Backups → System Status and Live Event Feed',
            body: 'The System Status panel shows five tiles: WebSocket (the live update feed), Backend API, Database (with response time), Redis (the event bus) and DB Storage (database size). Use Refresh to re-check them. The Live Event Feed panel shows counters since the server last restarted: connected clients, events published and delivered, failures, dropped slow clients and catch-up replays.',
            callout: { type: 'tip', text: 'Watch the Unpublished backlog figure. If it stays above zero for more than a few seconds, updates are not reaching other screens, so people may be looking at stale data until they reload.' },
        },
        {
            heading: 'Database & Backups → Scheduled Backups',
            items: [
                'Enabled: turns automatic backups on or off.',
                'Frequency: Daily or Weekly. Weekly adds a Day of Week.',
                'Time and Timezone: when the backup runs.',
                'Keep Last: how many scheduled snapshots to keep. Older scheduled ones are deleted automatically. Manual snapshots are never deleted by this rule.',
                'The panel shows the last run time and result (hover a FAILED chip to see the error) and the next run time.',
                'Run Now takes a scheduled backup immediately. Save Schedule stores the settings.',
            ],
        },
        {
            heading: 'Database & Backups → Snapshots',
            body: 'A snapshot is a single file holding the whole database plus every uploaded image and PDF: company logo, sample photos, BOM design files and scanned delivery notes. A restored snapshot therefore brings its attachments back with it.',
            items: [
                'New Snapshot takes one now. Upload adds a snapshot file from your computer, for example one taken on another server.',
                'The list shows each snapshot\'s file name, Origin (MANUAL or SCHEDULED), creation time and size.',
                'Download saves a copy to your computer. Keep copies off the server too.',
                'Delete removes the snapshot file from the server permanently.',
                'Restore replaces all current data with the snapshot and writes its uploaded files back over the ones on disk.',
            ],
            steps: [
                'Click Restore on the snapshot and confirm.',
                'A progress window shows the current phase, a percentage, the seconds elapsed and how many files have been written. Do not close the window or navigate away while it runs. Any administrator can watch the progress.',
                'When it reports Restore Complete, click Reload App so the screen stops showing data from before the restore. Stay Here keeps the page open without reloading.',
                'If it reports Restore Failed or loses contact with the server, read the message before trying again. The restore may still have finished.',
            ],
            callout: { type: 'warning', text: 'Restoring overwrites every record entered since the snapshot was taken, for every user. Take a fresh snapshot first if you might need today\'s data.' },
        },
        {
            heading: 'Database & Backups → Database Infrastructure',
            body: 'Shows the current database connection. An administrator can type another database address (or pick one from Saved Profiles) and click Switch Connection to point the whole system at a different database without restarting the server. Switching changes the data every user sees, so it is meant for maintenance and testing, not day-to-day work.',
        },
        {
            heading: 'Database & Backups → Danger Zone',
            body: 'Wipe & Reset Database permanently deletes every row in the current database and rebuilds it blank with only the starting data. Use it before loading a snapshot from another environment. You must re-enter your password to confirm, and it cannot be undone.',
            callout: { type: 'warning', text: 'Take and download a snapshot before wiping. There is no way back without one.' },
        },
    ],
};
