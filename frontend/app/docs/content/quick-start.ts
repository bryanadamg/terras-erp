import { DocPage } from '../docsContent';

export const quickStartPage: DocPage = {
    slug: 'quick-start',
    title: 'Quick Start Guide',
    subtitle: 'Your first day: signing in, finding your way, the one-time setup, and one order from start to dispatch.',
    sections: [
        {
            heading: '1. Sign in',
            body: 'Open the Terras ERP address your administrator gave you and sign in with your username and password. The login screen remembers the last username used on that device. After 10 wrong passwords the account is locked for 15 minutes. You land on the Dashboard.',
            items: [
                'Switch the language with EN / ID in the header at any time.',
                'Open Settings from your name at the bottom of the sidebar. Under My Account, set your own password and avatar. Under General, choose an Interface Scale and Display Timezone for this device.',
                'On a phone or tablet, use the browser\'s Install or Add to Home Screen to keep Terras as an app.',
            ],
        },
        {
            heading: '2. Find your screens',
            body: 'The sidebar only shows the sections your role allows. A typical day by role:',
            table: {
                headers: ['Role', 'Start here'],
                rows: [
                    ['**Sales admin**', 'Sales → Sales Orders, Customers, Sample Requests'],
                    ['**Purchasing**', 'Procurement → Purchase Orders, Suppliers'],
                    ['**Planner / PPIC**', 'Production → Production Runs, Manufacturing Orders, Work Orders'],
                    ['**Shop-floor PIC / operator**', 'Production → Work Queue, plus QUICK SCAN to log output'],
                    ['**Dye house**', 'Dyeing & Setting, Production → Dyeing Monitor'],
                    ['**Warehouse / store**', 'Inventory → Stock On-Hand and Lot, Procurement → Purchase Orders (receiving)'],
                    ['**QC**', 'Warehouse → Quarantine Packing'],
                    ['**Packing and loading**', 'Warehouse → Packing Orders, Pick Lists, Dispatch'],
                    ['**Supervisor / manager**', 'Dashboard, Reports → Production Output, Weaving Monitor'],
                ],
            },
        },
        {
            heading: '3. One-time setup (administrators)',
            body: 'Do this once before the first order, roughly in this order.',
            steps: [
                'Settings → General → Company Profile: company name, logo, address, Tax ID and weighing tolerance. These appear on every printed document.',
                'Settings → Access Control: adjust the built-in roles if needed and create a user for each person.',
                'Inventory → Locations: build the warehouse / zone / bin tree, including any quarantine hold area and defect store.',
                'Inventory → Attributes: set up attributes (such as Size), item categories and units of measure. Use Inventory → Combo Library and Dyeing & Setting → Colors for combos and colours.',
                'Inventory → Packaging: the carton and box types the packing floor uses, with their tare weights.',
                'Inventory → Item Inventory: create yarns, chemicals, greige and finished goods. Only items in the Finished Goods category can go on a sales order.',
                'Engineering → Routing: the work centre tree (type, optional group, machine) with each one\'s input and output locations.',
                'Engineering → BOM: the recipe for each product, with sizes and variants.',
                'Sales → Customers and Procurement → Suppliers.',
                'Inventory → Stock On-Hand → New Stock Entry: opening stock per item, location and lot.',
                'Optional: Administration → Print Layouts to adjust the printed documents and labels.',
            ],
        },
        {
            heading: '4. One order, start to finish',
            steps: [
                'Sales → Sales Orders: create the order with its lines, sizes and colours.',
                'Click Create Production Run on the order. Free stock is used first, so only the shortfall is made. Print the Material Pull Sheet for the store.',
                'Missing yarn or chemicals: raise a purchase order in Procurement → Purchase Orders and click Receive Goods when it arrives, with the supplier lot and delivery note.',
                'Production → Work Queue: choose your work centre type to see which work orders can start now based on material on hand. Print the Kartu Kerja.',
                'Stage the input lots to the work order, then log output by scanning the Kartu Kerja QR with QUICK SCAN. Each logged bag, beam or lot gets its own label to print.',
                'Dyeing & Setting: run the dyeing and setting orders with their Kartu Celup.',
                'Warehouse → Quarantine Packing: QC releases the lots that are good to pack.',
                'Warehouse → Packing Orders: pack released lots into cartons and print the carton labels.',
                'Warehouse → Pick Lists: pick the cartons for the sales order, by scanning or on screen.',
                'Warehouse → Dispatch: group the picked pick lists into a shipment, print the Surat Jalan, have a second person verify the carton count, then dispatch. The goods leave stock and the sales order moves to SENT once every line is shipped.',
            ],
            callout: { type: 'tip', text: 'You never set a sales order to READY, PARTIAL or SENT by hand. The system works these out from what has been packed and dispatched.' },
        },
        {
            heading: '5. Keep an eye on things',
            items: [
                'Dashboard: late and at-risk orders, action items, work order progress, deadlines and stock risk.',
                'Production → Weaving Monitor and Dyeing Monitor: machine output against target.',
                'Reports → Production Output: good and reject quantity per machine. Reports → Stock Ledger: every stock movement.',
                'Administration → Audit Logs: who changed what and when.',
                'Something wrong or confusing? Use the feedback button in the header and attach a screenshot.',
            ],
        },
    ],
};
