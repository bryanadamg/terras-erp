import { DocPage } from '../docsContent';

export const usersPage: DocPage = {
    slug: 'users',
    title: 'User Management',
    subtitle: 'Roles, permissions, scope restrictions, user accounts and sign-in rules.',
    badges: ['Roles', 'Permissions', 'Scopes', 'Users', 'Sign-in', 'Lockout'],
    sections: [
        {
            heading: 'Where to manage access',
            body: 'Open Settings (click your name at the bottom of the sidebar) → Access Control. Only administrators see this tab. It shows the Roles panel on top and the Users panel below it, so you can answer "why can this user do X?" without switching screens.',
        },
        {
            heading: 'How access is decided',
            items: [
                'Each user has at most one role. A role is a named set of permissions, such as Store Manager or Operator.',
                'An administrator can also grant a user extra permissions directly, without creating a new role for one person.',
                'A user\'s effective permissions are everything their role grants plus their direct grants.',
                'Scope restrictions (work centre types, categories, locations) are set on the role, not per user. They narrow where the role\'s actions apply.',
                'Full System Access (admin.access) passes every check. It comes with the Administrator role and is not ticked in the grid.',
                'A sidebar section or page you have no permission for is hidden, and typing its address shows an Access Denied screen.',
            ],
        },
        {
            heading: 'Permission codes',
            body: 'Permissions are written as resource.action, one checkbox per action in the role or user permission grid, for example work_order.create, sales_order.print or lot.qc_reject.',
            items: [
                'View is the base permission for every row. A page only opens with its <resource>.view, so a user who can create but not view is stuck on Access Denied. The grid therefore ticks View automatically when you grant any other action on that row, and keeps it ticked while one is still granted.',
                'work_order.create adds work orders and uses Plan Beaming. work_order.log records production, work_order.stage issues materials to a work order, and work_order.print_card / print_label print the Kartu Kerja and labels.',
                'shipment.verify is the loading-deck check on Warehouse → Dispatch. Give it to a different person than the one who stages the Surat Jalan: the system will not let the same person do both.',
                'pick_list.scan lets a picker confirm cartons on a pick list through QUICK SCAN without any other pick list rights.',
                'packing_order.log records packed cartons (and saves the sampled weight, locations and machine on the pack screen); packing_order.edit also changes and closes the order. pick_list.create / edit / delete manage pick lists, and shipment.create stages a Surat Jalan on the Dispatch deck.',
                'quarantine.set_status is the release decision that lets a held lot be packed. It is kept apart from the lot permissions on purpose.',
                'The Dashboard is open to everyone and shows only the widgets the user’s other permissions cover (stock, sales, manufacturing, samples). stock_ledger.view opens the Stock Ledger report. production_output.view and production_output.export read the Production Output report and download it as Excel.',
                'system_admin.edit edits Settings → General: the company profile, logo and the per-size quantity formula. Users, roles and backups stay with Administrators.',
                'print_layout.edit opens Administration → Print Layouts. audit_log.view opens Audit Logs.',
            ],
        },
        {
            heading: 'Built-in roles',
            body: 'A new installation starts with these roles. You can edit them or add your own.',
            table: {
                headers: ['Role', 'Covers'],
                rows: [
                    ['**Administrator**', 'Everything, including Settings → Database & Backups and Access Control'],
                    ['**Store Manager**', 'Items, attributes, categories, units, combos, packaging, lots, quarantine, stock on-hand, booking stock, locations, purchase orders and suppliers, stock ledger, reports and production output'],
                    ['**Production Manager**', 'BOMs, routing, production runs, manufacturing and work orders, weaving and dyeing monitors, the production calendar, beams, the Dyeing & Setting section (recipes, dyeing and setting orders, colours, lab dips), stock ledger, reports and production output'],
                    ['**Operator**', 'View, log and stage work orders; view the weaving and dyeing monitors'],
                    ['**QC Inspector**', 'Quarantine Packing (view and set status), QC reject of lots, and read-only views of stock, orders, items, reports and production output'],
                ],
            },
        },
        {
            heading: 'Roles panel',
            body: 'The Roles table shows each role\'s name, description, permissions, scope and number of users. Click a role\'s user count to filter the Users panel below to that role; click it again to clear the filter. Expand a row to see its permissions grouped by area and its scope restrictions.',
            steps: [
                'Click Add Role (or Edit on an existing one).',
                'Enter the Role Name and an optional Description.',
                'Tick its permissions in the grid.',
                'Optionally set an avatar template: pin the avatar slots that must look a certain way for this role (the Executive preset pins hat and accessories). Users who never saved their own avatar get these pinned slots; everyone keeps their own face.',
                'Set any scope restrictions (below) and save.',
            ],
            callout: { type: 'info', text: 'A role that is still assigned to users cannot be deleted. Move those users to another role first.' },
        },
        {
            heading: 'Scope restrictions',
            body: 'Scopes appear in the role form once the role holds a matching permission. Leaving every chip off means unrestricted. Turning one or more on limits the role to those choices.',
            table: {
                headers: ['Scope', 'Limits', 'Example'],
                rows: [
                    ['**Work Order Station Scope**', 'Work order actions, dyeing, setting and weaving runs, and beam dismount, to the chosen work centre types', 'A dye-house operator role scoped to DYEING cannot log or stage a weaving work order'],
                    ['**Item/Stock Category Scope**', 'Creating, editing and deleting items, and stock on-hand entries, adjustments and moves, to the chosen item categories', 'A yarn store role can only post stock for yarn items'],
                    ['**Lot Management Location Scope**', 'Lot actions to the chosen locations. Picking a warehouse covers every bin inside it', 'A finished-goods clerk can split or reject lots only in the finished-goods warehouse'],
                ],
            },
        },
        {
            heading: 'Users panel',
            body: 'The Users table lists username, full name, role, effective permissions (direct grants are marked), last sign-in time and status. Search by username or name, and filter by All, Active or Inactive.',
            steps: [
                'Click Add User (or Edit on an existing user).',
                'Choose an avatar, then enter the Username and Full Name.',
                'Pick a Role, or No Role.',
                'Set a password. You can show it or generate a random one. When editing, leave the password unchanged or reset it.',
                'Tick any extra permissions. Chips already granted by the selected role are locked, so the grid only adds on top of the role.',
                'Save.',
            ],
            items: [
                'Users are deactivated, not deleted, so their history in the audit log and on documents stays intact. A deactivated user cannot sign in. Reactivate restores access.',
                'You cannot deactivate your own account, and the system will not deactivate or demote the last active Administrator.',
                'Users change their own name, avatar and password under Settings → My Account. Changing your own password requires your current password.',
            ],
        },
        {
            heading: 'Signing in',
            items: [
                'The login screen remembers the last username used on this device and fills it in. It also shows the name, role and avatar from the last successful sign-in on this device. These come from the device itself, never from the server, so the login screen does not reveal whether an account exists.',
                'After 10 failed sign-ins for the same account, that account is locked for 15 minutes and the screen says "Too many failed sign-ins — try again in 15 minutes". A successful sign-in resets the count. There is no early unlock: wait out the 15 minutes.',
                'A wrong password and a deactivated account both show "Invalid username or password".',
                'A session lasts 24 hours. After that, or when the session is otherwise no longer valid, you are sent back to the login screen.',
                'The footer of the login screen shows whether the server is online and which version is running, and links to this documentation.',
            ],
            callout: { type: 'tip', text: 'On a shared shop-floor PC, always use LOGOUT at the top right when you finish, so the next person does not work under your name.' },
        },
    ],
};
