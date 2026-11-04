import { DocPage } from '../docsContent';

export const salesOrdersPage: DocPage = {
    slug: 'sales-orders',
    title: 'Sales Orders',
    subtitle: 'Record customer demand in Sales → Sales Orders, plan it into production or cover it from stock, and follow it to delivery.',
    badges: ['Customers', 'Order Lines', 'Alt Selling Unit', 'Allocate from Stock', 'Production Run', 'Fulfilment', 'Lineage'],
    sections: [
        {
            heading: 'Customers',
            body: 'Sales → Customers is the customer directory. Each customer holds a name, address, contact person, phone, fax and email, and can be marked active or inactive. The list shows 25 per page, the search box matches name, contact, phone, email and address, and rows can be edited or deleted from the row menu or deleted in bulk with the checkboxes. Suppliers are a separate list under Procurement → Suppliers. Creating, editing and deleting each need their own permission.',
        },
        {
            heading: 'Creating an Order',
            body: 'Click Create on Sales → Sales Orders. The header takes the PO number (must be unique), the Customer PO Ref, the order date and the customer, picked from the Customers list so its address prints on the paperwork. Then add one line per item. Only items in the Finished Goods category can be ordered.',
            items: [
                'Quantity is entered as length: Yard, Meter or Gross Yd (144 yd). The other two fill in from the one you type.',
                'Kilogram is calculated automatically from the item\'s weight per yard (marked AUTO). Click AUTO to type it in by hand, and click again to go back to the calculated figure.',
                'Alt Unit is the unit the customer actually orders in (Pcs, Pic, Gross...), with the length of one unit. The alt count and the yardage stay locked to each other, so changing one updates the other.',
                'Variants (for example combo) are picked per line. Color Code takes an approved colour, or a pending lab dip if the colour is not approved yet. Tick No Color Swatch when the customer has not sent a physical swatch, and untick it once the swatch arrives.',
                'Size / Measurement picks the size. It shows with its target and range, for example L-72 (70-74).',
                'BOM is optional. If you leave it empty, the planner chooses the recipe on the Production Run.',
                'Each line has a requested delivery date and an internal confirmation date (Req / Conf), plus a free-text Stock Notes field.',
            ],
            callout: {
                type: 'warning',
                text: 'If an item is stocked by weight but has no weight per yard on its item master, the ordered yardage cannot be converted. The line then shows "no weight" instead of a progress bar, and it cannot be planned or reach Ready. Fix it by setting the weight per unit on the item.',
            },
        },
        {
            heading: 'The Order Table',
            body: 'Each order is one row with its lines listed underneath. You can search by PO number or customer, filter by status (All, Pending, Ready, Partial, Sent, Delivered) and sort by customer, date or status. Print Table prints the filtered list as the Sales Order table report.',
            table: {
                headers: ['Column', 'What it shows'],
                rows: [
                    ['**PO / chips**', 'The PO number and customer ref. Green chips link to the order\'s Production Runs. A "... from stock" chip shows how much of the order is covered by finished goods already in stock, in the alt unit and kg. Clicking it opens the lineage.'],
                    ['**Size / Alt Unit / Req-Conf**', 'Each line\'s size, the ordered qty in Yd, m and kg, the alt-unit count, and the two delivery dates. A late line (past its requested date and not ready) is highlighted.'],
                    ['**Production Output**', 'How much of the line has been produced: finished goods plus the greige and beams behind them, with the current production stage.'],
                    ['**Fulfilment**', 'Three bars, Made, Packed and Shipped, each measured against the ordered qty in the line\'s alt selling unit when it has one. A bar turns green once that stage covers the order. A line with no activity yet reads "not started".'],
                    ['**Status**', 'The order status. Under it, the code of every shipment that has carried goods from this order appears as a green truck chip.'],
                ],
            },
        },
        {
            heading: 'Row Actions',
            items: [
                'Lineage: shown once the order has a Production Run or stock covering it (see below).',
                'Allocate from stock: available while the order is Pending, Ready or Partial.',
                'Create Production Run: available while the order is Pending. It opens a new Production Run filled in from the order\'s lines. Lines already covered by an existing run, or by stock allocated to them, are left out. If nothing is left to produce, it tells you so.',
                'Mark as Delivered: on a Sent order, once the customer has the goods.',
                'Close short: on a Partial order (see Closing an Order).',
                'Menu: Edit (only while the order is Pending or Ready), Print, and Delete. An order cannot be deleted while manufacturing orders still refer to it.',
            ],
        },
        {
            heading: 'Allocate from Stock',
            body: 'If the shelf can already fill an order, you can promise cartons to it without producing anything. Allocate from stock lists each line with its Ordered, Shipped, Allocated, Still needed and Selected figures, and the packed cartons that match the line\'s item, colour, variants and size. For each carton it shows the code, location, size, date packed and qty (with the length of one selling unit, for example 2 Pic @ 36 Yd). Tick cartons yourself, or use the wand button to pick the oldest cartons until the line is covered.',
            items: [
                'Only cartons packed to stock (or packed for an order that is no longer open) are offered. Cartons that are pinned to another order or already on a live pick list are not offered.',
                'Cartons are whole boxes. The last carton you pick may go over what is needed, but you cannot add another carton after the line is covered.',
                'You cannot allocate more than is actually free. Stock already promised to open manufacturing orders or to other orders does not count as free.',
                'Allocated cartons are held for this order. No other order can take them, and this order\'s pick list suggests them first.',
                'Allocated cartons count as packed stock on hand, so an order covered this way can reach Ready without a packing order.',
                'A Production Run created later plans only what the allocation does not cover.',
                'Each allocated carton has a release button that puts it back into the free pool.',
            ],
        },
        {
            heading: 'Production Lineage',
            body: 'The Lineage button opens a tree of everything the order set in motion: its Production Runs, Manufacturing Orders, Work Orders and beams, with each MO\'s status and progress. If part of the order is covered from stock, a "Covered from stock" table appears first. It shows each reservation\'s item, variant, the qty reserved, shipped and still held, and the run or allocation it came from. Each held reservation can be released back to the free pool so other orders can plan against it.',
        },
        {
            heading: 'Order Statuses',
            body: 'Pending, Ready, Partial and Sent are calculated automatically from packed and shipped cartons. You never set them by hand. Delivered is the only status a person sets.',
            table: {
                headers: ['Status', 'Meaning'],
                rows: [
                    ['Pending', 'Not every line has enough packed cartons in stock to ship yet, and nothing has shipped'],
                    ['Ready', 'Every line has enough packed or allocated cartons physically in stock to fill it'],
                    ['Partial', 'At least one shipment has gone out, but not every line is fully shipped'],
                    ['Sent', 'Every line has been fully shipped through Warehouse → Dispatch'],
                    ['Delivered', 'Closed by a person: either the customer has everything, or the order was closed short with a reason'],
                ],
            },
            callout: {
                type: 'info',
                text: 'Each line is judged in the unit the customer ordered in. An order for 2880 Pcs is Ready when 2880 Pcs are packed, whatever the cartons weigh. Finishing production alone never makes an order Ready. The cartons have to be packed and in stock.',
            },
        },
        {
            heading: 'Closing an Order',
            items: [
                'Sent → Delivered: use Mark as Delivered.',
                'Partial → Delivered (short-close): use Close short and enter a reason in the Close Short window. The reason is required and is kept in the order\'s audit history.',
                'An order cannot be closed before anything has shipped (Pending or Ready).',
                'Closing needs the sales order close permission.',
                'Closing releases any stock still held for the order: allocated cartons and stock covered from stock.',
            ],
        },
        {
            heading: 'Printing',
            body: 'Print in the row menu prints the Sales Order Confirmation. It includes the customer\'s name and address, and the lines with variants, size, qty in Yd with the alt unit under it, and totals. Print Table on the toolbar prints the Sales Order table report for the current filter. Both layouts can be edited in Administration → Print Layouts.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Maintain customers in Sales → Customers',
                'Create an order with lines in Yd, kg and the customer\'s alt unit, plus colour, combo and size',
                'Allocate packed cartons from stock to cover lines without producing them',
                'Create a Production Run for the rest of the order',
                'Follow each line\'s Made, Packed and Shipped bars, and the shipments that carried it',
                'Open Lineage to trace the order down to runs, MOs, WOs, beams and stock reservations',
                'Mark a Sent order Delivered, or close a Partial order short with a reason',
                'Fulfil the order through Warehouse → Packing Orders, Pick Lists and Dispatch (see Packing & Dispatch)',
            ],
        },
    ],
};
