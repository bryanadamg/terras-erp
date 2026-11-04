import { DocPage } from '../docsContent';

export const stockPage: DocPage = {
    slug: 'stock',
    title: 'Stock & Locations',
    subtitle: 'See what is physically where (Stock On-Hand), what is still free once open orders are counted (Booking Stock), how the warehouse is laid out (Locations), every movement ever posted (Stock Ledger), and the shop-floor scanner.',
    badges: ['Stock On-Hand', 'Booking Stock', 'Locations', 'Stock Ledger', 'Alt Units', 'Weighing Tolerance', 'Scanner'],
    sections: [
        {
            heading: 'Where these screens live',
            table: {
                headers: ['Sidebar', 'What it is for'],
                rows: [
                    ['**Inventory → Stock On-Hand**', 'The physical stock grid: book, adjust and move stock, export to Excel.'],
                    ['**Inventory → Booking Stock**', 'Plant-wide availability after open MOs and sales order reservations are counted.'],
                    ['**Inventory → Locations**', 'The store → zone → bin layout, and the quarantine hold flag.'],
                    ['**Reports → Stock Ledger**', 'Every stock movement, filterable and printable.'],
                    ['**QUICK SCAN** (top of the sidebar)', 'The camera scanner for work order cards, pick lists, cartons and packing orders.'],
                ],
            },
            body: 'Lots themselves (numbering, splitting, QC reject, labels) are on Inventory → Lot; see the Inventory & Items page.',
        },
        {
            heading: 'How stock is kept',
            items: [
                'Every movement writes a permanent ledger line, and the on-hand balance is updated at the same moment, so the grid and the ledger always agree. Ledger lines are never edited or deleted. A mistake is corrected with a new movement.',
                'Stock is held per item + location + variant (combo, colour, size, attributes) + lot. Two shades of the same item, or two lots in the same bin, are separate rows.',
                'Stock can never go negative. A movement that would take more than is there is refused with "Insufficient stock". When stock is taken out without naming a lot, it comes from unlotted stock first and then from the oldest lots.',
                'Packaging counts (cones, boxes, drums) are tallied next to the quantity. They are independent counts, not unit conversions, so the base quantity is always the figure that counts.',
                'Alt (selling) units: a packed carton, or a lot entered with an alt count, also shows its count in that unit under the base quantity, for example 10 kg / 12 Pcs, with the length of one unit (2 Pic @ 36 Yd). Conversions come from Inventory → Attributes → Units of Measure.',
            ],
        },
        {
            heading: 'Stock On-Hand grid',
            body: 'One row per balance (item, location, variant, lot). Columns: Item, Ends, Item Category, Location (the full Warehouse / Zone / Bin path, so two zones\' A1 bins never look the same), Lot, MO, WO, Attributes (size, combo, shade with its Colors name, e.g. 00001-B-6 · NAVY), Qty, UOM, Packaging and Notes. Click a header to sort.',
            items: [
                'Filters: search (item, location, lot, MO, WO, notes), Category (includes sub-categories) and Location. Picking a warehouse includes its zones and bins and stock booked directly on the warehouse.',
                'Click a lot\'s MO or WO chip to show only the lots that order produced. The chip appears in the toolbar; remove it to clear.',
                'QC-rejected lots stay in the grid because they are physically there, but the row is tinted and flagged. Tick Hide rejected to read the grid as usable stock.',
                'The footer shows the row count, how many rejected rows (and their quantity) are included, the total kg of all kg-stocked rows matching the filters (not just this page), and the total number of SKUs in stock before filtering.',
                'Export Excel downloads every row matching the current filters, not just the visible page.',
            ],
        },
        {
            heading: 'Booking, adjusting and moving stock',
            table: {
                headers: ['Action', 'How it works'],
                rows: [
                    ['**+ (New Stock Entry)**', 'For stock with no row yet, such as opening balances. Pick the item and its attributes, a lot (no lot, + New lot which is numbered automatically, or an existing lot of that item, whose variant is used), location, quantity (negative to subtract), optional containers, a reason (Opening balance, Manual entry, Correction, Found stock, Other) and a note.'],
                    ['**Adjust** (sliders icon)', 'Cycle count or correction on one row. Set to (count) types the counted figure; Adjust by (+/-) types the change. Containers are optional. Reason: Cycle count, Damaged / Loss, Correction, Found stock, Scrap or Other.'],
                    ['**Move** (arrows icon)', 'Transfers part or all of a row to another location, with the containers that go with it. Lot, colour and variant travel with the stock.'],
                    ['**Move N selected**', 'Tick several rows, pick one destination, and move them all in one go. Each row keeps its own lot and variant. Containers only move with a whole-row move; for part of a row with containers, use the single Move.'],
                    ['**Rebuild balances**', 'Admins only. Recalculates every balance from the ledger, for when balances look out of date.'],
                ],
            },
            callout: {
                type: 'info',
                text: 'A lot-tracked item can only be moved by naming the lot. If your role is limited to certain categories, you can only book or move stock of items in those categories.',
            },
        },
        {
            heading: 'Booking Stock',
            body: 'Booking Stock answers "is there enough for everything already planned?". For each item and variant, Net Free = On Hand + Incoming − Required − Reserved, counted across the whole plant. Rows are coloured Shortfall (net free below zero), Tight (exactly zero) or OK, and the toolbar counts shortfall and tight rows.',
            table: {
                headers: ['Column', 'Meaning'],
                rows: [
                    ['**On Hand**', 'Good stock across every location. Rejected, reject-usable and disposed lots are not counted.'],
                    ['**Incoming**', 'What open MOs (Pending, In Progress, Delivered) still have left to produce. An MO\'s output that is promised to a sales order is not offered to other demand. Open purchase orders are not counted.'],
                    ['**Required**', 'What open MOs still need, from the BOM lines copied onto each MO when it was created. It shrinks as production is logged. Editing a BOM does not change orders already in progress.'],
                    ['**Reserved**', 'Finished goods on hand but already promised to an open sales order, either by a Production Run that covered part of the order from stock or by Allocate from stock on the sales order. The hold ends at goods issue, when the order reaches Sent, Delivered or Cancelled, or when it is released from the sales order.'],
                ],
            },
            items: [
                'Expand a row to see exactly which MOs are Required by, which are Incoming from, and which sales orders it is Reserved by, so a shortfall can be traced to its cause.',
                'Sizes are counted separately: one item can appear once per size.',
                'How is Booking Stock calculated? opens an explanation panel (English and Indonesian tabs) you can keep open while reading the table.',
                'Figures are recalculated in the background after any stock, MO, WO or Production Run change, so a number can be a few seconds behind the floor.',
            ],
            callout: {
                type: 'warning',
                text: 'Booking Stock is not per location, and it is not the Work Queue. A positive figure does not mean the stock is at the machine that needs it, or that it has not already been claimed by an earlier order in the queue.',
            },
        },
        {
            heading: 'Locations',
            body: 'Locations are laid out as Stores → Zones → Bins in three columns. Pick a store to see its zones, and a zone to see its bins. Stock is normally kept in bins, but a store or zone with nothing under it can hold stock too.',
            items: [
                'Add with the input at the top of each column. A store needs a code; zone and bin codes are built from the parent\'s code and the name. The add box stays open so you can enter a run of bins.',
                'Rename and delete are on each row. A location with sub-locations cannot be deleted, and system stores (the seeded ones) cannot be renamed or deleted.',
                'Drag a bin onto another zone to move it. Moves that would nest deeper than store › zone › bin are refused.',
                'The shield button on a store makes it a quarantine hold area for all its zones and bins. Stock held there appears on Warehouse → Quarantine Packing and cannot be packed until its lot is released. See Quality & Quarantine.',
                'Work centers and items name their own default input, output, putaway and reject locations; those are set on the work center (Routing) and on the item.',
            ],
            callout: { type: 'info', text: 'Locations are always shown by their full path (for example Finished Goods / GD FINISH GOODS 1 / A1) on stock, ledger, MO and quarantine screens.' },
        },
        {
            heading: 'Weighing tolerance',
            body: 'Scale readings never match the book to the gram. Settings → General → Weighing Tolerance (%) (default 2%, up to 10%) sets how far a reading may differ and still count as on target.',
            items: [
                'A work order step that weighs out within the tolerance under its target counts as met and can be completed.',
                'On a packing order, cartons weighing a little more than the lots\' book quantity are accepted within the tolerance, and the extra is spread across the lots in proportion, so one small lot does not trip the limit. A leftover on a held lot that is within the tolerance is written off as a weighing gap when the order is closed.',
                'Past the tolerance, the action is still refused, with a message naming the limit.',
            ],
        },
        {
            heading: 'Stock Ledger',
            body: 'Reports → Stock Ledger lists every movement: date, item, variant (size, combo, shade chips), category, location (full path), lot, movement (+/−) and source. It opens on the last 30 days.',
            items: [
                'Filters: search item or reference, location, category, source and direction (All / In / Out). Dates use From/To or the Today, 7d, 30d and Month presets.',
                'Sources include Opening / Manual, Stock Adjustment, Lot Opening, Goods Receipt, Manufacturing, Work Order, Staging, Beam Mount / Dismount / Leftover, Transfer, Lot Split, Lot Reassign, QC Reject, QC Dispose, Packing, Packing Material, Packing Reject and Picking / Dispatch.',
                'The summary strip totals movements, in, out and net for the filtered set.',
                'Print prints up to 1,000 rows with the same filters, using the Stock Ledger layout from Administration → Print Layouts.',
            ],
        },
        {
            heading: 'Scanner (QUICK SCAN)',
            body: 'QUICK SCAN at the top of the sidebar (or the QR button on the header) opens one scanner for every floor code. Point the camera at the code, or type it in. The scanner sends you to the right screen.',
            table: {
                headers: ['Code scanned', 'Opens'],
                rows: [
                    ['**Kartu Kerja QR** (work order)', 'The work order step. On a phone: Log Hasil Produksi with the actual quantity, lot or beam number (blank = automatic), operator, notes, machine, and material consumption (planned vs actual, with a lot picker per material). Lots staged to another WO are shown but cannot be used. On a desktop: start or complete the step, with a material check before starting.'],
                    ['**PL-** pick list', 'The pick screen, to scan cartons onto the order. Needs pick permission.'],
                    ['**PU-** carton', 'Picks the carton if a pick list is open, otherwise identifies the carton.'],
                    ['**PCK-** packing order', 'The packing screen, to log cartons packed. Needs packing permission.'],
                ],
            },
            items: [
                'Staging by scan is on the work order itself: Production → Work Orders → Stage opens a scan mode for bag and beam labels. A staged lot is kept for that work order only.',
                'On a phone, Inventory → Stock On-Hand opens a read-only stock browser with item search and a per-location breakdown.',
                'Phone browsers only open the camera on a secure (https) address. If the camera will not start on the plant network, ask your administrator; the server can be set up with LAN HTTPS, and each phone installs its certificate once.',
            ],
        },
    ],
};
