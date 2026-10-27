import { DocPage } from '../docsContent';

export const usersPage: DocPage = {
    slug: 'users',
    title: 'User Management',
    subtitle: 'Create and manage user accounts, roles, and permissions.',
    badges: ['Users', 'Roles', 'Permissions', 'RBAC', 'Category Restrictions'],
    sections: [
        {
            heading: 'Users',
            body: 'Each person who accesses Terras ERP has a user account with a unique username and password. Administrators can create, edit, deactivate, and delete user accounts from the Users panel on Settings → Access Control. Deactivating a user prevents login without deleting their history.',
        },
        {
            heading: 'Authentication',
            body: 'Terras ERP uses OAuth2 with JWT tokens for authentication. On login, the server issues a signed access token that is stored in the browser\'s localStorage. The token is sent as a Bearer header on every API request. Tokens expire after a configurable period, requiring re-login.',
        },
        {
            heading: 'Roles',
            body: 'Roles are named collections of permissions (e.g. "Warehouse Operator", "Sales Manager", "Admin"). Assigning a role to a user grants all permissions contained in that role. Roles can be created and edited from the Roles panel on Settings → Access Control, directly above the Users panel — a role\'s user count there filters the Users panel to that role.',
        },
        {
            heading: 'Granular Permissions',
            body: 'Individual permissions can be granted directly to a user, independent of roles. This allows fine-grained access adjustments without creating a specialised role for every edge case. A user\'s effective permissions are the union of all role permissions and any direct grants.',
        },
        {
            heading: 'Category Restrictions',
            body: 'Users can optionally be restricted to specific item categories. A restricted user will only see items belonging to their allowed categories across the entire system — inventory lists, BOM pickers, order line pickers, stock views, and reports. This is useful for separating raw materials teams from finished goods teams, or for limiting supplier-facing access.',
        },
        {
            heading: 'Permission Reference',
            body: 'Permissions are `resource.action` codes — one per checkbox in the Roles / User permission grid (work_order.create, sales_order.print, lot.qc_reject, and so on). The old broad codes (inventory.edit, manufacturing.edit, …) were replaced by this granular set; roles holding them were migrated to the equivalent superset.',
            items: [
                'View is the base grant — every row\'s other actions need it. The page itself is gated on <resource>.view, so a create right without view leaves the user on an Access Denied screen. The grid therefore ticks View automatically when you grant any other action on that row, and keeps it ticked while one is still granted.',
                'work_order.create — add Work Orders and use Plan Beaming; work_order.log records production, work_order.stage issues materials',
                'reports.view — access the Dashboard and the Reports section',
                'production_output.view / .export — read the Production Output report / take it off the system as an Excel file',
                'admin.access — full system access; bypasses every check. Granted by assigning the Administrator role, not from the permission grid.',
            ],
        },
    ],
};
