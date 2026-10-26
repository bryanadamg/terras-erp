// Single source of truth for how the Permissions settings page renders the
// resource x action grid. Mirrors the Permissions config spreadsheet layout —
// section groupings and row order match it so the settings page reads the same
// way the spreadsheet did. Permission codes here (`${resource}.${action.code}`)
// must match the backend taxonomy seeded in init_db.py / the granular
// permission migration (2afd23590ae8_granular_permission_taxonomy.py).

export interface PermissionMatrixAction {
    code: string;
    label: string;
}

export type PermissionScope = 'category' | 'location' | 'work_center_type';

export interface PermissionMatrixResource {
    resource: string;
    label: string;
    scope?: PermissionScope;
}

export interface PermissionMatrixSection {
    section: string;
    resources: PermissionMatrixResource[];
}

const A = (code: string, label: string): PermissionMatrixAction => ({ code, label });

export const CREATE = A('create', 'Create');
export const EDIT = A('edit', 'Edit');
export const DELETE = A('delete', 'Delete');
// Labelled plain "View", not "View only": it is the *base* read grant every other
// action on that row needs (the route guard and the list GETs check it), not a
// read-only mode. Reading it as a mode is what made admins tick Create/Edit and
// leave View off, producing a user who holds work_order.create but can't reach
// the page the button lives on. PermissionsPicker now grants it implicitly.
export const VIEW = A('view', 'View');

export const PERMISSION_MATRIX: PermissionMatrixSection[] = [
    {
        section: 'Sales & Purchase',
        resources: [
            { resource: 'sales_order', label: 'Sales Order' },
            { resource: 'customer', label: 'Customer' },
            { resource: 'supplier', label: 'Supplier' },
            { resource: 'sample_request', label: 'Sample Request' },
            { resource: 'purchase_order', label: 'Purchase Order' },
        ],
    },
    {
        section: 'Item Inventory',
        resources: [
            { resource: 'item', label: 'Per Categories', scope: 'category' },
            { resource: 'attribute', label: 'Attribute' },
            { resource: 'category', label: 'Categorie' },
            { resource: 'uom', label: 'Unit Of Measure' },
            { resource: 'combo_library', label: 'Combo Library' },
            { resource: 'packaging_type', label: 'Packaging Type' },
        ],
    },
    {
        section: 'Stock',
        resources: [
            { resource: 'lot', label: 'Lot Management', scope: 'location' },
            { resource: 'quarantine', label: 'Quarantine Packing' },
            { resource: 'stock_on_hand', label: 'Stock In Hand', scope: 'category' },
            { resource: 'booking_stock', label: 'Booking Stock' },
            { resource: 'location', label: 'Location' },
            { resource: 'stock_ledger', label: 'Stock Ledger' },
        ],
    },
    {
        section: 'Manufacturing',
        resources: [
            { resource: 'bom', label: 'Bill of Material' },
            { resource: 'routing', label: 'Routing and Ops' },
            { resource: 'production_run', label: 'Production Run' },
            { resource: 'manufacturing_order', label: 'Manufacture Order' },
            { resource: 'work_order', label: 'Work Order', scope: 'work_center_type' },
            { resource: 'weaving_monitor', label: 'Weaving Monitor' },
            { resource: 'dyeing_monitor', label: 'Dyeing Monitor' },
            { resource: 'calendar', label: 'Calender' },
            { resource: 'beam', label: 'Beam' },
        ],
    },
    {
        section: 'Dyeing & Setting',
        resources: [
            { resource: 'dye_recipe', label: 'Dye Recipe' },
            { resource: 'dye_order', label: 'Dye Order' },
            { resource: 'setting_order', label: 'Setting Order' },
            { resource: 'color_code', label: 'Color Code' },
            { resource: 'color_variant', label: 'Color Variant' },
            { resource: 'lab_dip_request', label: 'Lab Dip Request' },
            { resource: 'yarn_lab_dip', label: 'Yarn Lab Dip' },
        ],
    },
    {
        section: 'Platform',
        resources: [
            { resource: 'reports', label: 'Dashboard & Reports' },
            { resource: 'production_output', label: 'Production Output' },
            { resource: 'audit_log', label: 'Audit Log' },
            { resource: 'print_layout', label: 'Print Lay Out' },
            { resource: 'system_admin', label: 'System Admin' },
        ],
    },
];

// Per-resource action lists (order matches the spreadsheet's column order for
// that row). Resources not listed here fall back to CREATE/EDIT/DELETE/VIEW.
export const RESOURCE_ACTIONS: Record<string, PermissionMatrixAction[]> = {
    sales_order: [CREATE, EDIT, DELETE, A('create_pr', 'Create PR'), A('print', 'Print'), VIEW, A('close', 'Closed SO')],
    customer: [A('create', 'Add'), EDIT, DELETE, VIEW],
    supplier: [A('create', 'Add'), EDIT, DELETE, VIEW],
    sample_request: [CREATE, EDIT, DELETE, A('update_status', 'Update Status'), A('print', 'Print'), VIEW],
    purchase_order: [CREATE, EDIT, DELETE, A('receive_goods', 'Received Good'), A('print', 'Print'), VIEW, A('close', 'Closed PO')],

    item: [CREATE, EDIT, DELETE, A('import', 'Import'), VIEW],
    attribute: [CREATE, EDIT, DELETE, VIEW],
    category: [CREATE, EDIT, DELETE, VIEW],
    uom: [CREATE, EDIT, DELETE, VIEW],
    combo_library: [CREATE, EDIT, DELETE, VIEW],
    // No plain DELETE: a type used by any carton is deactivated instead, because
    // deleting it would blank the box name on labels and notes already printed.
    packaging_type: [CREATE, EDIT, A('archive', 'Delete/Deactivate'), VIEW],

    lot: [CREATE, A('split', 'Split'), DELETE, A('qc_reject', 'QC Reject'), VIEW],
    // set_status is the release-to-packing decision, so it is its own grant
    // rather than being folded into an edit right.
    quarantine: [A('set_status', 'Set Status'), VIEW],
    stock_on_hand: [CREATE, A('adjust', 'Adjust'), A('move', 'Move'), VIEW],
    booking_stock: [VIEW],
    location: [CREATE, EDIT, DELETE, VIEW],
    stock_ledger: [A('print', 'Print'), VIEW],

    bom: [CREATE, EDIT, DELETE, VIEW],
    routing: [CREATE, EDIT, DELETE, VIEW],
    production_run: [CREATE, EDIT, DELETE, A('print', 'Print'), VIEW],
    manufacturing_order: [CREATE, EDIT, DELETE, A('print', 'Print'), VIEW, A('close', 'Closed Order')],
    // CREATE gates both "+ Add Work Order" and "Plan Beaming" (WorkOrderPanel) —
    // it was missing from this row, so work_order.create existed in the backend
    // taxonomy with no checkbox anywhere that could grant it.
    work_order: [CREATE, A('log', 'Log'), EDIT, DELETE, A('print_card', 'Print Kartu Kerja'), VIEW, A('print_label', 'Print Label'), A('stage', 'Stage')],
    weaving_monitor: [A('start', 'Start'), A('stop', 'Stop'), VIEW],
    // View only: a dye batch is started and completed from the Dyeing Orders tab
    // under work_order.log, so this grid owns no lifecycle verbs of its own.
    dyeing_monitor: [VIEW],
    calendar: [EDIT, VIEW],
    beam: [A('unmount', 'Unmount'), VIEW],

    dye_recipe: [CREATE, EDIT, DELETE, A('print', 'Print'), VIEW],
    dye_order: [VIEW],
    setting_order: [VIEW],
    color_code: [CREATE, EDIT, A('archive', 'Archive'), A('create_recipe', 'Create Dyeing Recipe'), VIEW],
    color_variant: [CREATE, EDIT, DELETE],
    lab_dip_request: [CREATE, EDIT, DELETE, A('update_status', 'Update Status'), A('print', 'Print'), VIEW],
    yarn_lab_dip: [VIEW],

    // reports.view gates the Dashboard and the Reports nav section (navConfig).
    // It is seeded and enforced but had no row here, so it could only be handed
    // out by the seeded roles — never from the Roles/User modals.
    reports: [VIEW],
    // Production Output report — Excel export is its own grant so a role can read
    // the shop-floor numbers without being able to take the data off the system.
    production_output: [A('export', 'Export Excel'), VIEW],
    audit_log: [VIEW],
    print_layout: [EDIT],
    system_admin: [CREATE, A('edit', 'edit'), DELETE],
};

export function permissionCode(resource: string, actionCode: string): string {
    return `${resource}.${actionCode}`;
}

// ── Action intent → chip colour ───────────────────────────────────────────────
// Both the read-only breakdown (role/user rows) and the editable picker (role /
// user modals) render actions as chips tinted by what the action does, so a
// destructive grant is findable without reading every label. One table here so
// the two views can never drift apart.

export type PermissionIntent = 'create' | 'edit' | 'delete' | 'print' | 'view';

const INTENT_BY_ACTION: Record<string, PermissionIntent> = {
    create: 'create', create_pr: 'create', create_recipe: 'create',
    edit: 'edit', adjust: 'edit', move: 'edit', split: 'edit', stage: 'edit',
    log: 'edit', import: 'edit', update_status: 'edit', set_status: 'edit',
    receive_goods: 'edit', unmount: 'edit', start: 'edit',
    delete: 'delete', archive: 'delete', qc_reject: 'delete', close: 'delete', stop: 'delete',
    print: 'print', print_card: 'print', print_label: 'print', export: 'print',
    view: 'view',
};

export const INTENT_CHIP: Record<PermissionIntent, { bg: string; border: string; fg: string }> = {
    create: { bg: '#e2f3e2', border: '#7bb07b', fg: '#1a5e2a' },
    edit: { bg: '#dde8f5', border: '#7f9db9', fg: '#1a3d7a' },
    delete: { bg: '#f7e2e2', border: '#c08a8a', fg: '#8e0000' },
    print: { bg: '#fff3d6', border: '#c8a04a', fg: '#7a5000' },
    view: { bg: '#eeece6', border: '#bab5a8', fg: '#5c5749' },
};

/** Intent of a bare action code (`delete`) or a full permission code (`item.delete`). */
export function actionIntent(actionOrCode: string): PermissionIntent {
    const action = actionOrCode.includes('.') ? actionOrCode.split('.')[1] : actionOrCode;
    return INTENT_BY_ACTION[action] || 'edit';
}

// Resource (permission code prefix) -> section label, for regrouping a flat
// permission list the same way the matrix organizes it.
const RESOURCE_SECTION: Map<string, string> = new Map(
    PERMISSION_MATRIX.flatMap(sec => sec.resources.map(r => [r.resource, sec.section] as const))
);

const RESOURCE_LABEL: Map<string, string> = new Map(
    PERMISSION_MATRIX.flatMap(sec => sec.resources.map(r => [r.resource, r.label] as const))
);

/**
 * Splits `sales_order.print` into the matrix's own words — "Sales Order" /
 * "Print". A permission list rendered as one chip per stored description
 * ("Print Purchase Orders", "View Purchase Orders", "Close Purchase Orders")
 * repeats the resource on every chip, which is what made a 54-permission role
 * read as a wall. Rendering resource once with its actions beside it says the
 * same thing in a fifth of the marks. Falls back to the stored description when
 * a code isn't in the matrix.
 */
export function describePermission(code: string, description?: string): { resource: string; action: string } {
    const [resource, action] = code.split('.');
    const resourceLabel = RESOURCE_LABEL.get(resource);
    if (!resourceLabel) return { resource: 'Other', action: description || code };
    const actionLabel = (RESOURCE_ACTIONS[resource] || [CREATE, EDIT, DELETE, VIEW])
        .find(a => a.code === action)?.label;
    return { resource: resourceLabel, action: actionLabel || action.replace(/_/g, ' ') };
}

/** Buckets a permission list by resource, in matrix order, keeping each resource's actions together. */
export function groupPermissionsByResource<T extends { code: string; description?: string }>(
    permissions: T[],
): { resource: string; permissions: T[] }[] {
    const byResource = new Map<string, T[]>();
    const order: string[] = [];
    for (const p of permissions) {
        const { resource } = describePermission(p.code, p.description);
        if (!byResource.has(resource)) { byResource.set(resource, []); order.push(resource); }
        byResource.get(resource)!.push(p);
    }
    return order.map(r => ({ resource: r, permissions: byResource.get(r)! }));
}

/** Buckets a flat permission list into PERMISSION_MATRIX section order (unmatched codes fall into "Other"). */
export function groupPermissionsBySection<T extends { code: string }>(permissions: T[]): { section: string; permissions: T[] }[] {
    const bySection = new Map<string, T[]>();
    for (const p of permissions) {
        const section = RESOURCE_SECTION.get(p.code.split('.')[0]) || 'Other';
        if (!bySection.has(section)) bySection.set(section, []);
        bySection.get(section)!.push(p);
    }
    const order = [...PERMISSION_MATRIX.map(s => s.section), 'Other'];
    return order
        .filter(s => bySection.has(s))
        .map(s => ({ section: s, permissions: bySection.get(s)! }));
}
