// Single source of truth for the app's navigation taxonomy.
// Consumed by:
//  - Sidebar.tsx         → section headers + nav items (permission-gated)
//  - MainLayout.tsx      → page + browser-tab titles (routeTitle) + route-chunk prefetch
//  - SectionHomeView.tsx → section meta (label/icon/accent) + quick links
// Add a page here and every consumer picks it up — do not hand-edit their lists.

export interface NavLeaf {
    tab: string;          // route slug (also the activeTab key)
    label: string;        // English fallback label
    i18nKey?: string;     // LanguageContext key; label used when key missing
    icon: string;         // bootstrap-icons class
    // Leaf visible only with this permission. An array means ANY of them, same
    // semantics as NavSection.permissions — used where one page serves two roles
    // holding different codes. Read it through leafPermissions(), never directly.
    permission?: string | string[];
}

/** Normalized ANY-of permission list for a leaf. Empty = open to everyone. */
export function leafPermissions(leaf: NavLeaf): string[] {
    if (!leaf.permission) return [];
    return Array.isArray(leaf.permission) ? leaf.permission : [leaf.permission];
}

export interface NavSection {
    key: string;          // section slug → /sections/<key>
    label: string;
    i18nKey?: string;
    icon: string;
    accent: 'blue' | 'green' | 'amber' | 'grey';
    permissions?: string[]; // section visible if user has ANY of these (omit = public)
    items: NavLeaf[];
}

export const NAV_SECTIONS: NavSection[] = [
    {
        key: 'sales', label: 'Sales', i18nKey: 'sales', icon: 'bi-graph-up', accent: 'green',
        // pick_list.scan is deliberately absent: the picker's only surface is the
        // QUICK SCAN button, which sits above the sections and is always visible.
        // Listing it here would open an otherwise empty Sales section for them.
        permissions: ['sales_order.view', 'customer.view', 'sample_request.view', 'sales.manage', 'quarantine.view', 'shipment.view'],
        items: [
            { tab: 'sales-orders', label: 'Sales Orders', i18nKey: 'sales_orders', icon: 'bi-file-text', permission: 'sales_order.view' },
            // Packing Orders / Pick Lists are a separate feature not covered by the
            // Permissions config spreadsheet — still gated on the legacy blob code.
            // QC hold desk feeding Packing Orders — sits immediately before it in
            // the flow, so it sits immediately above it here.
            { tab: 'quarantine-packing', label: 'Quarantine Packing', icon: 'bi-shield-exclamation', permission: 'quarantine.view' },
            { tab: 'packing', label: 'Packing Orders', icon: 'bi-box2', permission: 'sales.manage' },
            { tab: 'pick-lists', label: 'Pick Lists', icon: 'bi-clipboard-check', permission: 'sales.manage' },
            // No Pick Scanner leaf: the floor half of a pick list is reached by
            // scanning the PL- QR at QUICK SCAN, which routes to it. A dedicated
            // entry only asked the picker to choose a scanner before scanning.
            // Loading deck. Deliberately its own page and not a Pick Lists tab: the
            // Surat Jalan check must be done by someone other than the picker, so
            // the two surfaces carry different permissions.
            { tab: 'dispatch', label: 'Dispatch', icon: 'bi-truck', permission: ['shipment.view', 'sales.manage'] },
            { tab: 'customers', label: 'Customers', i18nKey: 'customers', icon: 'bi-people', permission: 'customer.view' },
            { tab: 'samples', label: 'Sample Requests', i18nKey: 'sample_requests', icon: 'bi-flask', permission: 'sample_request.view' },
            { tab: 'sample-report', label: 'Sample Report', i18nKey: 'sample_report', icon: 'bi-clipboard-data', permission: 'sample_request.view' },
        ],
    },
    {
        key: 'procurement', label: 'Procurement', i18nKey: 'procurement', icon: 'bi-cart3', accent: 'amber',
        permissions: ['purchase_order.view', 'supplier.view'],
        items: [
            { tab: 'purchase-orders', label: 'Purchase Orders', i18nKey: 'purchase_orders', icon: 'bi-bag', permission: 'purchase_order.view' },
            { tab: 'suppliers', label: 'Suppliers', i18nKey: 'suppliers', icon: 'bi-truck', permission: 'supplier.view' },
        ],
    },
    {
        key: 'inventory', label: 'Inventory', i18nKey: 'inventory', icon: 'bi-box-seam', accent: 'blue',
        permissions: ['item.view', 'stock_on_hand.view', 'lot.view', 'location.view', 'combo_library.view', 'packaging_type.view', 'booking_stock.view'],
        items: [
            { tab: 'inventory', label: 'Item Inventory', i18nKey: 'item_inventory', icon: 'bi-list-check', permission: 'item.view' },
            { tab: 'item-metadata', label: 'Attributes', i18nKey: 'attributes', icon: 'bi-tag', permission: 'attribute.view' },
            { tab: 'combos', label: 'Combo Library', icon: 'bi-grid-3x3-gap', permission: 'combo_library.view' },
            // The box master the pack screens pick from — bounded reference data
            // (a handful of rows), sitting beside the other masters rather than
            // buried in Settings, because its tare weights are a floor-facing
            // number the packing supervisor maintains.
            { tab: 'packaging-types', label: 'Packaging', icon: 'bi-box2', permission: 'packaging_type.view' },
            { tab: 'batches', label: 'Lot', icon: 'bi-upc-scan', permission: 'lot.view' },
            // Stock entry/transfer/adjust duties were merged into Stock On-Hand
            // (commit e6f38da), and /stock-on-hand was later folded into this
            // same /stock route (stock/page.tsx renders StockOnHandView on
            // desktop, the mobile bottom-tab's read-only browse view on mobile)
            // so the URL matches the nav slug instead of redirecting.
            { tab: 'stock', label: 'Stock On-Hand', i18nKey: 'stock_on_hand', icon: 'bi-boxes', permission: 'stock_on_hand.view' },
            { tab: 'booking-stock', label: 'Booking Stock', i18nKey: 'booking_stock', icon: 'bi-bookmark-check', permission: 'booking_stock.view' },
            { tab: 'locations', label: 'Locations', i18nKey: 'locations', icon: 'bi-geo-alt', permission: 'location.view' },
        ],
    },
    {
        key: 'engineering', label: 'Engineering', i18nKey: 'engineering', icon: 'bi-gear', accent: 'blue',
        permissions: ['bom.view', 'routing.view'],
        items: [
            { tab: 'bom', label: 'BOM', i18nKey: 'bom', icon: 'bi-diagram-3', permission: 'bom.view' },
            { tab: 'routing', label: 'Routing', i18nKey: 'routing', icon: 'bi-shuffle', permission: 'routing.view' },
        ],
    },
    {
        // Execution, not design: what the planner releases and the PIC runs.
        key: 'production', label: 'Production', i18nKey: 'production', icon: 'bi-gear-wide-connected', accent: 'blue',
        permissions: ['production_run.view', 'manufacturing_order.view', 'work_order.view', 'weaving_monitor.view', 'dyeing_monitor.view'],
        items: [
            { tab: 'production-runs', label: 'Production Runs', icon: 'bi-collection-play', permission: 'production_run.view' },
            { tab: 'manufacturing-orders', label: 'Manufacturing Orders', i18nKey: 'manufacturing_orders', icon: 'bi-list-task', permission: 'manufacturing_order.view' },
            { tab: 'work-orders', label: 'Work Orders', i18nKey: 'work_orders', icon: 'bi-tools', permission: 'work_order.view' },
            // Shop-floor dispatch list (one work-center type at a time). Sits under
            // Work Orders because it is the same rows read by the PIC instead of
            // the planner — see services/work_queue_service.py.
            { tab: 'work-queue', label: 'Work Queue', icon: 'bi-list-ol', permission: 'work_order.view' },
            { tab: 'weaving-monitor', label: 'Weaving Monitor', i18nKey: 'weaving_monitor', icon: 'bi-speedometer2', permission: 'weaving_monitor.view' },
            // Sits beside the loom grid rather than in Dyeing & Setting: this is a
            // machine-floor tool like Work Queue, whereas that section is
            // recipes, colours and lab dips.
            { tab: 'dyeing-monitor', label: 'Dyeing Monitor', i18nKey: 'dyeing_monitor', icon: 'bi-droplet-half', permission: 'dyeing_monitor.view' },
        ],
    },
    {
        key: 'dyeing', label: 'Dyeing & Setting', icon: 'bi-droplet-half', accent: 'blue',
        // color_variant.* is listed alongside the .view codes because the section gate
        // (Sidebar) hides the whole section when none match — without it a variant-only
        // role could reach /colors by URL but never see it in the nav.
        permissions: ['dye_recipe.view', 'color_code.view', 'lab_dip_request.view', 'yarn_lab_dip.view',
            'color_variant.create', 'color_variant.edit', 'color_variant.delete'],
        items: [
            { tab: 'dyeing-setting', label: 'Dyeing & Setting', icon: 'bi-palette', permission: 'dye_recipe.view' },
            // Two tabs, two grants: the Color Code catalog (color_code.view) and the
            // Colors-variant list (color_variant.*). ANY-of, because a role granted only
            // variant management could otherwise not reach the page its grant is for; the
            // page hides whichever tab the user has no grant for.
            { tab: 'colors', label: 'Colors', icon: 'bi-palette2', permission: ['color_code.view', 'color_variant.create', 'color_variant.edit', 'color_variant.delete'] },
            { tab: 'lab-dips', label: 'Lab Dip Requests', icon: 'bi-droplet', permission: 'lab_dip_request.view' },
            { tab: 'lab-dips-yarn', label: 'Yarn Lab Dips', icon: 'bi-droplet-half', permission: 'yarn_lab_dip.view' },
            { tab: 'lab-dip-report', label: 'Lab Dip Report', i18nKey: 'lab_dip_report', icon: 'bi-clipboard-data', permission: 'lab_dip_request.view' },
        ],
    },
    {
        key: 'reports', label: 'Reports', i18nKey: 'reports', icon: 'bi-bar-chart', accent: 'grey',
        permissions: ['stock_ledger.view', 'production_output.view', 'reports.view', 'audit_log.view'],
        items: [
            { tab: 'reports', label: 'Stock Ledger', i18nKey: 'stock_ledger', icon: 'bi-journal-text', permission: 'stock_ledger.view' },
            { tab: 'machine-report', label: 'Production Output', i18nKey: 'machine_report', icon: 'bi-clipboard-data', permission: 'production_output.view' },
            { tab: 'audit-logs', label: 'Audit Logs', icon: 'bi-clipboard-check', permission: 'audit_log.view' },
        ],
    },
    {
        key: 'administration', label: 'Administration', i18nKey: 'administration', icon: 'bi-sliders', accent: 'grey',
        permissions: ['print_layout.edit', 'admin.access'],
        items: [
            { tab: 'print-designer', label: 'Print Layouts', i18nKey: 'print_designer', icon: 'bi-printer', permission: 'print_layout.edit' },
        ],
    },
];

/** Resolve a nav entry's display label: i18n when the key exists, else the English fallback. */
export const navLabel = (t: (k: string) => string, entry: { label: string; i18nKey?: string }) =>
    entry.i18nKey && t(entry.i18nKey) !== entry.i18nKey ? t(entry.i18nKey) : entry.label;

/**
 * Route slug → the nav entry that names it, covering leaves and section homes
 * plus the handful of pages with no sidebar leaf of their own (reached from the
 * header, QUICK SCAN, a redirect or a typed URL).
 */
const ROUTE_ENTRIES: Record<string, { label: string; i18nKey?: string }> = Object.fromEntries([
    ...NAV_SECTIONS.flatMap(s => s.items.map(i => [i.tab, i] as const)),
    ...NAV_SECTIONS.map(s => [`sections-${s.key}`, s] as const),
    ['dashboard', { label: 'Dashboard', i18nKey: 'dashboard' }] as const,
    ['settings', { label: 'Settings', i18nKey: 'settings' }] as const,
    ['scanner', { label: 'Scanner', i18nKey: 'scanner' }] as const,
    ['login', { label: 'Login', i18nKey: 'login' }] as const,
]);

/**
 * Human label for a route slug — translation first, then the taxonomy's English
 * label, then the slug title-cased. Shared by the header heading and the browser
 * tab title (useDocumentTitle) so the two can never drift.
 */
export function routeTitle(activeTab: string, t: (key: string) => string): string {
    const entry = ROUTE_ENTRIES[activeTab];
    // i18n key from the taxonomy when it declares one, else the slug's own key
    // (work-queue → work_queue) — several leaves are translated without an i18nKey.
    const key = entry?.i18nKey || activeTab.replace(/-/g, '_');
    if (t(key) !== key) return t(key);
    return entry?.label || activeTab.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Route slug → the permissions that open it, ANY of which is enough.
 * Sidebar hiding alone never stopped a typed URL, so MainLayout gates the route
 * itself off this map. Same source as the sidebar, so a page can never be
 * hidden-but-reachable or reachable-but-hidden.
 *
 * Keys are activeTab slugs (`sales-orders`, `sections-sales`), matching the
 * pathname→activeTab mapping in MainLayout. A route absent from the map is open
 * to any authenticated user — dashboard, scanner, settings and the mobile screens
 * are deliberately not listed.
 */
export const ROUTE_PERMISSIONS: Record<string, string[]> = Object.fromEntries([
    ...NAV_SECTIONS.flatMap(s => s.items
        .map(i => [i.tab, leafPermissions(i)] as const)
        .filter(([, codes]) => codes.length > 0)),
    ...NAV_SECTIONS
        .filter(s => s.permissions?.length)
        .map(s => [`sections-${s.key}`, s.permissions as string[]] as const),
]);

/** Every route worth warming after login: sidebar destinations + section homes. */
export const PREFETCH_ROUTES: string[] = [
    '/dashboard', '/scanner', '/settings',
    ...NAV_SECTIONS.flatMap(s => s.items.map(i => `/${i.tab}`)),
    ...NAV_SECTIONS.map(s => `/sections/${s.key}`),
];
