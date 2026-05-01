import { DocPage } from '../docsContent';

export const stockPage: DocPage = {
    slug: 'stock',
    title: 'Stock & Locations',
    subtitle: 'Track physical inventory across warehouse locations with a full transaction ledger.',
    badges: ['Locations', 'Stock Balances', 'Ledger', 'Scanner', 'Transfers'],
    sections: [
        {
            heading: 'Locations',
            body: 'Locations represent physical storage areas within your facility — warehouses, bays, bins, or any named space. You can define as many locations as needed. Stock balances are maintained per item-variant-location combination, so the same item can have different quantities in different locations.',
        },
        {
            heading: 'Stock Balances',
            body: 'Balances are materialised (pre-calculated) and stored in a dedicated `stock_balances` table. This provides O(1) lookups — there is no need to sum ledger entries on every read. Balances are updated atomically when stock entries are created, so the balance is always consistent with the ledger.',
        },
        {
            heading: 'Variant-Level Tracking',
            body: 'Every stock balance is keyed by item ID, location ID, and a variant key (a sorted, comma-joined string of selected AttributeValue UUIDs). This means stock is tracked separately for each variant combination — for example, "Red / Large" and "Blue / Large" of the same item have independent balances.',
        },
        {
            heading: 'Stock Ledger',
            body: 'Every stock movement creates an immutable ledger entry. The ledger is the source of truth for all stock history. Entries are tagged with a transaction type — Receipt, Issue, Adjustment, Transfer, or Production (auto-deducted by a completed Work Order). The ledger cannot be edited or deleted.',
        },
        {
            heading: 'Stock Entries',
            body: 'Stock entries are created manually for receipts, issues, and adjustments. Each entry specifies the item, variant, location, quantity (positive for in, negative for out), and an optional reference note.',
        },
        {
            heading: 'Transfers',
            body: 'A stock transfer moves quantity from one location to another. Under the hood it creates two ledger entries — a negative entry at the source and a positive entry at the destination — so the total stock quantity across the system is preserved.',
        },
        {
            heading: 'Scanner Terminal',
            body: 'The /scanner page is a mobile-optimised interface for the shop floor. Operators can use a barcode scanner or the device camera (via html5-qrcode) to scan item barcodes, record stock movements, and update work order status without navigating the full desktop UI. Authentication and permissions apply as normal.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Create and manage warehouse locations',
                'Record stock receipts, issues, and manual adjustments',
                'Transfer stock between locations',
                'View current balance per item, variant, and location',
                'Browse the full ledger history with filtering by item, location, type, and date',
                'Use the scanner terminal for barcode-based stock operations on mobile devices',
            ],
        },
    ],
};
