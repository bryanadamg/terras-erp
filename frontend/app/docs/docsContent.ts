// ─── Types ───────────────────────────────────────────────────────────────────

export interface DocSection {
    title: string;
    items: DocItem[];
}

export interface DocItem {
    slug: string;
    label: string;
    icon: string;
}

export interface DocPage {
    slug: string;
    title: string;
    subtitle: string;
    badges?: string[];
    sections: DocPageSection[];
}

export interface DocPageSection {
    heading: string;
    body?: string;
    items?: string[];
}

// ─── Sidebar Navigation ───────────────────────────────────────────────────────

export const docsSidebar: DocSection[] = [
    {
        title: 'Getting Started',
        items: [
            { slug: 'overview', label: 'Overview', icon: '🏠' },
            { slug: 'quick-start', label: 'Quick Start', icon: '⚡' },
        ],
    },
    {
        title: 'Modules',
        items: [
            { slug: 'inventory', label: 'Inventory & Items', icon: '📦' },
            { slug: 'stock', label: 'Stock & Locations', icon: '🗄️' },
            { slug: 'bom', label: 'BOM Designer', icon: '🔩' },
            { slug: 'manufacturing', label: 'Manufacturing', icon: '🏭' },
            { slug: 'sales-orders', label: 'Sales Orders', icon: '🛒' },
            { slug: 'purchase', label: 'Purchase Orders', icon: '🚚' },
            { slug: 'samples', label: 'Samples & PLM', icon: '🧪' },
            { slug: 'reports', label: 'Reports & Dashboard', icon: '📈' },
        ],
    },
    {
        title: 'Administration',
        items: [
            { slug: 'settings', label: 'Settings', icon: '⚙️' },
            { slug: 'users', label: 'User Management', icon: '👥' },
            { slug: 'audit-logs', label: 'Audit Logs', icon: '📋' },
        ],
    },
];

// ─── Page Content (imported from individual section files) ───────────────────

import { overviewPage } from './content/overview';
import { quickStartPage } from './content/quick-start';
import { inventoryPage } from './content/inventory';
import { stockPage } from './content/stock';
import { bomPage } from './content/bom';
import { manufacturingPage } from './content/manufacturing';
import { salesOrdersPage } from './content/sales-orders';
import { purchasePage } from './content/purchase';
import { samplesPage } from './content/samples';
import { reportsPage } from './content/reports';
import { settingsPage } from './content/settings';
import { usersPage } from './content/users';
import { auditLogsPage } from './content/audit-logs';

export const docsPages: Record<string, DocPage> = {
    overview: overviewPage,
    'quick-start': quickStartPage,
    inventory: inventoryPage,
    stock: stockPage,
    bom: bomPage,
    manufacturing: manufacturingPage,
    'sales-orders': salesOrdersPage,
    purchase: purchasePage,
    samples: samplesPage,
    reports: reportsPage,
    settings: settingsPage,
    users: usersPage,
    'audit-logs': auditLogsPage,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getPageBySlug(slug: string): DocPage | null {
    return docsPages[slug] ?? null;
}

export function getAllSlugs(): string[] {
    return Object.keys(docsPages);
}
