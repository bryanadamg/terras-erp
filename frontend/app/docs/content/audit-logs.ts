import { DocPage } from '../docsContent';

export const auditLogsPage: DocPage = {
    slug: 'audit-logs',
    title: 'Audit Logs',
    subtitle: 'Who changed what, and when. The system-wide trail lives in Administration → Audit Logs, and a record\'s own history is available from the record.',
    badges: ['Audit Trail', 'Old → New', 'Entity Filter', 'Item History', 'Event Log'],
    sections: [
        {
            heading: 'What Is Logged',
            body: 'Creating, editing, deleting and changing the status of records is written to the audit log, along with shop-floor actions such as receiving goods, staging, mounting and dismounting beams, packing, picking, verifying, dispatching and cancelling shipments, packing rejects and stock transfers. Status changes the system makes on its own to manufacturing and work orders are recorded too. Each entry stores the time, the user, the action, the type of record and which record it was, a one-line description and, for edits, the fields that changed.',
        },
        {
            heading: 'Reading an Entry',
            table: {
                headers: ['Column', 'What it shows'],
                rows: [
                    ['**Timestamp**', 'Date and time in your time zone.'],
                    ['**User**', 'The person\'s full name (or username). Shows System when no user was involved.'],
                    ['**Action**', 'A coloured chip: Create, Update, Delete and Status Change, or the specific action such as Mount, Pick, Pack, Stage, Verify, Dispatch, Reject, Release, Transfer or Cancel.'],
                    ['**Entity**', 'The type of record in plain words, for example Work Order, Manufacturing Order, Purchase Order, Goods Receipt, Item or Partner.'],
                    ['**Details**', 'The description. A chevron means the entry has field changes. Click the row to open them.'],
                ],
            },
        },
        {
            heading: 'Old → New Changes',
            body: 'The expanded panel lists each changed field as field: old → new, with the old value in red and the new value in green. A field that was blank shows as "empty". This applies everywhere changes are shown: the Audit Logs page, the history pane and the item event log.',
            callout: {
                type: 'info',
                text: 'Entries written before old → new pairs were introduced have been converted where the old value was certain. The few that couldn\'t be converted still show the single value that was recorded.',
            },
        },
        {
            heading: 'Browsing the Audit Logs Page',
            items: [
                'Administration → Audit Logs lists every entry, newest first, a page at a time. The header shows the total number of entries.',
                'The Entity filter lists every type of record that actually appears in the log, so anything that has been logged can be filtered, not just a handful of common ones.',
                'Use Refresh to load entries written since you opened the page.',
                'Browsing the full log needs the Audit Logs permission and admin access.',
            ],
        },
        {
            heading: 'History of a Single Record',
            items: [
                'Item Inventory: expand an item row to see its Event Log, the item\'s last 50 events with date and time, action, who did it and the description. Click an event with changes to see old → new.',
                'Sample Requests: choose View Event Log in a request\'s ⋯ menu to open the history pane on the right. It lists the events with the person\'s name and the real action (Create, Update, Status, or the specific action). Selecting one shows its full detail and changes.',
                'Both read the same audit trail as the Audit Logs page, filtered to that one record. Viewing them needs the Audit Logs permission.',
            ],
        },
        {
            heading: 'Can Entries Be Changed?',
            body: 'No. There is no screen or action that edits or deletes audit entries, and deleting a record leaves its audit history in place, including the Delete entry itself. That makes the log usable for accountability and settling disputes ("who closed this PO short?", "who changed this item\'s unit?").',
        },
    ],
};
