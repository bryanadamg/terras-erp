import { DocPage } from '../docsContent';

export const overviewPage: DocPage = {
    slug: 'overview',
    title: 'Terras ERP — System Overview',
    subtitle: 'One system for a textile mill: orders, materials, production on the floor, wet processing, packing and delivery.',
    badges: ['Sales', 'Procurement', 'Inventory', 'Engineering', 'Production', 'Dyeing & Setting', 'Warehouse', 'Reports', 'Administration'],
    sections: [
        {
            heading: 'What is Terras ERP?',
            body: 'Terras ERP follows the fabric through the mill: a sales order becomes a production run, the run explodes into manufacturing orders and work orders for warping, beaming, weaving, dyeing and setting, every bag, beam, lot and carton is tracked as it moves, and the finished goods are packed, picked and dispatched with a Surat Jalan. Stock, status and readiness are worked out from what was actually logged on the floor, so every screen shows the same picture. It runs in the web browser on PCs, tablets and phones, served from the factory\'s own server.',
        },
        {
            heading: 'Getting around',
            items: [
                'The sidebar groups screens into sections. Click a section heading to open its home page with quick links; click an entry to open that screen. You only see sections and screens your role allows.',
                'Dashboard sits at the top of the sidebar and is where you land after signing in.',
                'QUICK SCAN (the blue button at the top of the sidebar, or the QR icon in the header) opens the camera scanner. It reads any floor code (a Kartu Kerja QR, a pick list, a carton or a packing order) and opens the right screen for it.',
                'Settings opens from your name and avatar at the bottom of the sidebar.',
                'The header holds the live-update warning (when needed), the scanner, the feedback button, the EN / ID language switch and LOGOUT.',
            ],
        },
        {
            heading: 'Module map (sidebar)',
            table: {
                headers: ['Section', 'Screens', 'What it is for'],
                rows: [
                    ['**Sales**', 'Sales Orders, Customers, Sample Requests, Sample Report', 'Customer orders with sizes, colours and alt units; creating production runs from an order; allocating packed stock; fulfilment progress; sample (SPK Sample) development'],
                    ['**Procurement**', 'Purchase Orders, Suppliers', 'Buying yarn, chemicals and materials; receiving goods with supplier lot and delivery note'],
                    ['**Inventory**', 'Item Inventory, Attributes, Combo Library, Packaging, Lot, Stock On-Hand, Booking Stock, Locations', 'Item master; attributes, categories and units; combos; carton and box types; lots, beams and cartons; stock by location with entry, adjust and move; free stock after every open order\'s claims; the warehouse / zone / bin tree'],
                    ['**Engineering**', 'BOM, Routing', 'Recipes (bills of materials) with sizes and variants; operations and the work centre tree (type, group, machine)'],
                    ['**Production**', 'Production Runs, Manufacturing Orders, Work Orders, Work Queue, Weaving Monitor, Dyeing Monitor', 'Planning and releasing production, the shop-floor queue ranked by material readiness, loom efficiency and dye-vessel output'],
                    ['**Dyeing & Setting**', 'Dyeing & Setting, Colors, Lab Dip Requests, Yarn Lab Dips, Lab Dip Report', 'Dye recipes and the Kartu Celup, dyeing and setting orders, the colour catalogue, and lab dip colour approval for fabric and yarn'],
                    ['**Warehouse**', 'Quarantine Packing, Packing Orders, Pick Lists, Dispatch', 'The floor side of fulfilment in order: release held lots, pack into cartons, pick cartons for an order, then stage, verify and dispatch a shipment with its Surat Jalan'],
                    ['**Reports**', 'Stock Ledger, Production Output', 'Every stock movement with filters and print; good and reject quantity per machine or work order, with Excel export'],
                    ['**Administration**', 'Print Layouts, Audit Logs', 'Designing every printed document and label; the history of who changed what'],
                ],
            },
        },
        {
            heading: 'How the pieces connect',
            steps: [
                'Sales takes the order (Sales → Sales Orders). Missing materials are bought in Procurement.',
                'The planner creates a production run from the order. The system checks free stock first, so components already on hand are not made again, then creates the manufacturing orders and their work orders.',
                'Operators see their next jobs in Production → Work Queue, print the Kartu Kerja, stage materials and log output by scanning its QR. Logged output becomes traceable bags, beams and lots with their own labels, so any lot can be traced back to its yarn.',
                'Lots put away in a quarantine location are held until QC releases them (Warehouse → Quarantine Packing).',
                'Packing turns released lots into labelled cartons (Warehouse → Packing Orders).',
                'A pick list pulls the cartons for a sales order (Warehouse → Pick Lists).',
                'The loading deck groups pick lists into a shipment, prints the Surat Jalan, has a second person verify the carton count, and dispatches (Warehouse → Dispatch). Only dispatch takes the goods out of stock, and the sales order status follows automatically.',
            ],
        },
        {
            heading: 'Dashboard',
            body: 'The landing page leads with what is owed to customers. Tiles count Late, At Risk, Ready and Open Orders, Active and Pending work orders, and Low Stock items. Below them: Delivery Outlook (open sales orders with how much can ship now), Action Items (late orders, material gaps, overdue work orders, low stock, work orders ready to release), Work Order Monitoring with progress bars, a Production Deadlines calendar, and Stock Risk (items below their reorder level). Panels you have no permission for are left out.',
        },
        {
            heading: 'Works the same on every screen',
            items: [
                'Live updates: when someone logs a completion, receives goods or dispatches a shipment, other open screens refresh by themselves. If the connection drops, a LIVE UPDATES OFF chip appears in the header; the page catches up when the connection returns. Reload if the chip stays.',
                'Feedback button (speech-bubble icon in the header): describe a problem or idea and attach up to 3 screenshots (attach or paste). Click a screenshot to black out anything private. Reports are anonymous unless you tick "Include my name". If the inbox cannot be reached, the report is saved on the server and sent automatically later, and an unsent message is kept while the browser tab stays open.',
                'Column widths: drag the edge of a column heading on list tables to widen or narrow it. Tables open on their standard widths each time.',
                'Remembered tabs: a page with tabs reopens on the tab you last used, for as long as the browser tab stays open.',
                'Language: switch between English (EN) and Indonesian (ID) from the header. The choice applies to the whole interface.',
                'Install as an app: browsers that support it offer Install (or Add to Home Screen). The installed app opens in its own window with the Terras icon.',
                'Phones: on a small screen the app switches to a mobile layout with Home, Scan, Production and Stock tabs at the bottom.',
                'Scanning on phones: phone browsers only open the camera over a secure (https) connection. If your administrator has turned on LAN HTTPS, open the system at its https:// address and install the server\'s certificate on each phone once, from http://<server address>/ca.crt.',
                'Help: this documentation is linked from the login screen.',
            ],
        },
    ],
};
