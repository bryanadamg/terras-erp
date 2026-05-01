import { DocPage } from '../docsContent';

export const usersPage: DocPage = {
    slug: 'users',
    title: 'User Management',
    subtitle: 'Create and manage user accounts, roles, and permissions.',
    badges: ['Users', 'Roles', 'Permissions', 'RBAC', 'Category Restrictions'],
    sections: [
        {
            heading: 'Users',
            body: 'Each person who accesses Teras ERP has a user account with a unique username and password. Administrators can create, edit, deactivate, and delete user accounts from Settings → Users. Deactivating a user prevents login without deleting their history.',
        },
        {
            heading: 'Authentication',
            body: 'Teras ERP uses OAuth2 with JWT tokens for authentication. On login, the server issues a signed access token that is stored in the browser\'s localStorage. The token is sent as a Bearer header on every API request. Tokens expire after a configurable period, requiring re-login.',
        },
        {
            heading: 'Roles',
            body: 'Roles are named collections of permissions (e.g. "Warehouse Operator", "Sales Manager", "Admin"). Assigning a role to a user grants all permissions contained in that role. Roles can be created and edited from the Users panel.',
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
            items: [
                'admin.access — full system access; bypasses all permission checks',
                'inventory.view — read access to items, attributes, categories, UOM',
                'inventory.edit — create and edit items, attributes, categories, UOM',
                'stock.view — view stock balances and ledger',
                'stock.edit — create stock entries and transfers',
                'manufacturing.view — view Manufacturing Orders and Work Orders',
                'manufacturing.edit — create and update MOs and WOs; use the BOM Automator',
                'sales.view — view Sales Orders and customer records',
                'sales.edit — create and update Sales Orders and customer records',
                'purchase.view — view Purchase Orders and supplier records',
                'purchase.edit — create and update Purchase Orders; record goods receipts',
                'reports.view — access Dashboard and Reports screens',
                'samples.view — view Sample Requests',
                'samples.edit — create and update Sample Requests',
            ],
        },
    ],
};
