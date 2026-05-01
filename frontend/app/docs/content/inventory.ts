import { DocPage } from '../docsContent';

export const inventoryPage: DocPage = {
    slug: 'inventory',
    title: 'Inventory & Items',
    subtitle: 'Manage your product catalogue — items, variants, attributes, categories, and units of measure.',
    badges: ['Items', 'Variants', 'Attributes', 'Categories', 'UOM'],
    sections: [
        {
            heading: 'Items',
            body: 'An Item is any product, raw material, component, or sub-assembly tracked by the system. Each item has a unique code, a description, a category, and a unit of measure. Items can be marked active or inactive — inactive items are hidden from operational screens but retained for historical records.',
        },
        {
            heading: 'Bulk Import',
            body: 'Items can be imported in bulk via the Excel upload feature on the Inventory page. The import template maps columns to item fields. Validation errors are surfaced per-row before any data is committed.',
        },
        {
            heading: 'Attributes',
            body: 'Attributes define the dimensions of variation for an item (e.g. "Colour", "Size", "Material"). Each attribute has a set of allowed values. Attributes are defined globally under Inventory → Attributes and can be assigned to any item.',
        },
        {
            heading: 'Variants',
            body: 'A variant is a specific combination of attribute values for an item (e.g. "Red / Large / Cotton"). Stock, BOM lines, sales order lines, and purchase order lines all operate at the variant level. The internal variant key is a sorted, comma-joined list of AttributeValue UUIDs — this ensures consistent identity regardless of the order attribute values are selected.',
        },
        {
            heading: 'Categories',
            body: 'Categories group items for reporting and access control. Administrators can restrict individual users to one or more categories — a restricted user will only see items belonging to their allowed categories throughout the entire system (inventory lists, BOM pickers, order line item pickers, etc.).',
        },
        {
            heading: 'Units of Measure (UOM)',
            body: 'Every item is assigned a UOM. UOM is used consistently across BOM quantities, stock entries, and purchase/sales orders. Custom conversion factors allow non-standard units — for example, a "Roll" UOM with a factor of 50 means one Roll equals 50 of the base unit (metres). System UOMs (kg, metre, unit, litre) cannot be deleted.',
        },
        {
            heading: 'Item History',
            body: 'Each item has a chronological history pane accessible from its detail view. The history shows every field change as a JSON diff, including who made the change and when. This provides a complete audit trail at the item level, independent of the global audit log.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Create, edit, and deactivate items',
                'Assign attributes to an item and generate variant combinations',
                'Assign category and UOM',
                'Define UOMs with custom conversion factors',
                'Bulk import items via Excel upload',
                'View current stock balance per item and variant from the item detail page',
                'Browse the full chronological change history for any item',
            ],
        },
    ],
};
