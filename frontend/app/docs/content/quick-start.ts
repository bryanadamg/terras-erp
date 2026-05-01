import { DocPage } from '../docsContent';

export const quickStartPage: DocPage = {
    slug: 'quick-start',
    title: 'Quick Start Guide',
    subtitle: 'Get up and running with Teras ERP in minutes.',
    sections: [
        {
            heading: '1. Log In',
            body: 'Navigate to the Teras ERP URL provided by your administrator. Enter your username and password on the Welcome Screen. After logging in you will land on the Dashboard, which shows live KPIs and the Smart Advisor summary.',
        },
        {
            heading: '2. Configure Administration Data',
            body: 'Before creating items or orders, set up the core reference data your operation depends on.',
            items: [
                'Settings → Company Profile — set your company name, address, and logo (used on print templates)',
                'Stock → Locations — define your physical storage areas (e.g. "Main Warehouse", "Dispatch Bay", "QC Hold")',
                'Inventory → Categories — group items for reporting and access control',
                'Inventory → UOM — define units of measure with conversion factors (e.g. Roll → metres, Piece → units)',
                'Inventory → Attributes — define variation axes such as Colour, Size, Material',
                'Settings → Users — create user accounts and assign roles',
            ],
        },
        {
            heading: '3. Create Items',
            body: 'Go to Inventory → Items to define your products, raw materials, and components. For each item, assign a category, a unit of measure, and optionally a set of attributes to enable variant tracking.',
        },
        {
            heading: '4. Add Opening Stock',
            body: 'Use Stock to record opening inventory balances for your items. Each stock entry specifies the item, variant, location, and quantity. Balances are updated in real-time as transactions occur.',
        },
        {
            heading: '5. Build a BOM',
            body: 'Navigate to BOM Designer to define the Bill of Materials for your manufactured products. Add components, set quantities (fixed or percentage-based), and attach a routing with production steps. Use the BOM Automator to generate child MO structures automatically once the BOM is ready.',
        },
        {
            heading: '6. Create a Sales Order',
            body: 'Go to Sales → Sales Orders to capture customer demand. Add line items referencing your finished goods, select size/variant if applicable, and confirm the order. Each line item has an individual "Produce" button that creates a Manufacturing Order linked to that SO line.',
        },
        {
            heading: '7. Manufacture',
            body: 'Open Manufacturing → Manufacturing Orders to see MOs created from sales or planned production. Run the BOM Automator to generate child Work Orders for sub-assemblies. Track each WO through the shop floor — operators can scan the QR code on the printed work order at the /scanner terminal to update status in real-time.',
        },
        {
            heading: '8. Receive Purchased Goods',
            body: 'When components arrive from a supplier, open the Purchase Order and click Receive. This creates a stock ledger entry and increments the balance at the target location automatically.',
        },
    ],
};
