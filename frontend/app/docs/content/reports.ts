import { DocPage } from '../docsContent';

export const reportsPage: DocPage = {
    slug: 'reports',
    title: 'Reports & Dashboard',
    subtitle: 'The Dashboard you land on after login, the Stock Ledger and the Production Output report.',
    badges: ['Dashboard', 'Delivery Outlook', 'Production Deadlines', 'Stock Ledger', 'Production Output', 'QC Reject %', 'Excel Export'],
    sections: [
        {
            heading: 'Dashboard',
            body: 'The Dashboard is the first screen after login. It starts with what is owed to customers, when it is due and how much of it can actually ship, then shows production in progress and the stock that could hold it up. It updates on its own as orders, production and stock change. Each panel only appears if your role can see that area: a role without sales access gets no delivery panel, and one without stock access gets no stock panel.',
        },
        {
            heading: 'KPI Tiles',
            table: {
                headers: ['Tile', 'Counts'],
                rows: [
                    ['**Late**', 'Open sales orders whose earliest line due date has passed and that are not yet 100% shippable. Framed red when above zero.'],
                    ['**At Risk**', 'Open sales orders with at least one line where less has been produced than ordered.'],
                    ['**Ready**', 'Open sales orders that are 100% shippable.'],
                    ['**Open Orders**', 'Sales orders in Pending, Ready or Partial.'],
                    ['**Active WO / Pending WO**', 'Work orders in progress / waiting to start. Active WO turns amber when a manufacturing order is overdue.'],
                    ['**Low Stock**', 'Items whose total on-hand stock is below their reorder point (the item\'s minimum stock level, 10 if not set). Red when any of them is out of stock.'],
                ],
            },
            callout: {
                type: 'info',
                text: '"Shippable" means cartons already packed and still in stock plus cartons already dispatched. Bulk that has come off the machine but hasn\'t been packed doesn\'t count, which is the same rule that sets a sales order to Ready.',
            },
        },
        {
            heading: 'Delivery Outlook',
            body: 'Open sales orders, worst first: late orders, then the soonest due, then the least covered. Each row shows the code, customer, due date (the earliest line due date), a Shippable bar and a status chip that reads LATE, SHORT (some line under-produced) or the order\'s own status. Hover the bar to see "shippable of ordered" and the % produced. The footer shows Delivery Readiness, which is Ready orders as a share of open orders.',
        },
        {
            heading: 'Action Items',
            body: 'A short to-do list built from the same data. Hover the ? on any entry for a plain-language explanation of what is wrong and what to do about it. The list covers:',
            items: [
                'Items that are out of stock (critical) or below reorder point (warning), plus "N more items low" when there are more than fit.',
                'Up to three overdue manufacturing orders (target end date passed and not completed).',
                'Up to three late sales orders, with the % shippable.',
                'Up to two sales orders with a material gap (lines produced short of the order).',
                'How many work orders are pending and ready to release.',
            ],
        },
        {
            heading: 'Production Panels',
            items: [
                'Work Order Monitoring lists up to eight open manufacturing orders (in progress and pending), overdue first, with a progress bar, qty and due date. Overdue ones show a red OVERDUE chip. The footer shows Production Yield (qty of completed orders as a share of everything started) and Delivery Readiness.',
                'Production Deadlines is a month calendar that puts a dot on the day each manufacturing order is due (its target end date, or its start date if it has no end date yet). Dots are coloured by status (pending, in progress, completed), and you hover a dot for the order code. Use the arrows to change month.',
                'Stock Risk shows up to ten low-stock items, most short first, each with a bar against its reorder point and "Out of stock" when it has none.',
                'KPI Trends (30 days) shows a small line chart and the 30-day change for Low Stock, Active WO, Pending WO and Open Orders.',
            ],
        },
        {
            heading: 'Stock Ledger (Reports → Stock Ledger)',
            body: 'Every stock movement ever posted, one row per movement. Rows are never edited or deleted. A correction is a new movement. It opens on the last 30 days. Use the Today, 7d, 30d and Month presets or the date fields to change that, and the clear (×) button for all time.',
            items: [
                'Filters: search (item name or code, or a reference), location (picking a warehouse includes its zones and bins), category, source (the type of movement, listed from what has actually been posted) and direction (In or Out).',
                'The summary strip shows Movements, total In, total Out and Net for the current filter.',
                'Columns: date and time, item, Variant (size, combo, shade swatch and other attributes, drawn the same way as in the lot pickers), category, location as the full Warehouse / Zone / Bin path, lot (internal lot plus a SUP chip for the supplier lot), the signed movement in the item\'s unit (plus any cones, boxes or drums moved), and the source with its reference.',
                'Sorting by date, item, category, location or movement sorts the whole ledger on the server, not just the 50 rows on the page.',
                'Sources include Goods Receipt, Manufacturing, Work Order, Staging, Beam Mount / Dismount / Merge / Leftover (labelled with the loom), Packing, Packing Material, Picking / Dispatch, Transfer, Lot Split, Lot Reassign, QC Reject, Packing Reject, QC Dispose, Stock Adjustment and Opening / Manual.',
            ],
            callout: {
                type: 'tip',
                text: 'Print (printer icon) prints the current filter and sort, up to 1,000 movements. The title says "N of total" when the list was cut, so narrow the dates if you need it complete. Untick the columns you don\'t want, and your choice is remembered. The layout itself is edited in Administration → Print Layouts.',
            },
        },
        {
            heading: 'Production Output (Reports → Production Output)',
            body: 'Answers "what did we make, and how much was rejected". It opens on the last 7 days, with Today, Yesterday, 7d, 30d and Month presets. A work-centre picker limits it to a type, a group or a single machine. Pick one of five views:',
            table: {
                headers: ['View', 'One row per'],
                rows: [
                    ['**Per Machine**', 'Machine: type, output, share bar, QC reject, reject %, yield, number of WOs and logs, last log.'],
                    ['**Per Group**', 'Machine group. Each machine counts toward its group, or toward its type when it sits directly under the type. Expanding a row lists its machines.'],
                    ['**Per Work Order**', 'Work order (the result sheet): item, machine, status, target, hasil (good output), QC reject, reject %. Tick "Completed WOs only" for finished orders.'],
                    ['**Packing**', 'Packing order: item, status, target, output, cartons (rejected cartons shown as -N), QC reject.'],
                    ['**Per Packer**', 'The user account that logged the packing: output, cartons, days active, average per day, orders. Logs with only a typed name and no account are labelled as such and counted in the "No account" tile.'],
                ],
            },
        },
        {
            heading: 'Reading the Production Output Numbers',
            items: [
                'Reject % = QC reject ÷ good output (hasil), the shop-floor formula: 10 rejected against 100 good reads 10%. It is shown in bold red at 5% or more.',
                'Yield = good ÷ (good + reject).',
                'Output is credited to the machine the operator picked on the completion log. The work order\'s own machine is only used for old logs that have none, so a WO assigned to a group still lands on the real loom.',
                'Packing is reported separately from the machine views and is never added into them.',
                'A row that mixes items with different units shows "mixed" instead of a unit.',
                '"Hide machines with no output" (machine and group views) and "With rejects only" trim the list.',
                'Expand any row to see its breakdown by item, its work orders (or, for packers, by day and by packing order) and every QC reject event: when, which WO and lot, qty, the defect store it was moved to, the reason and who rejected it. Packing rejects go to the packing machine\'s defect store.',
            ],
            callout: {
                type: 'info',
                text: 'The report reloads by itself whenever a completion, reject or work-order status change is logged, so a supervisor can leave it open during a shift. Export to Excel downloads exactly the rows on screen, in the current sort. Export is a separate permission from viewing the report.',
            },
        },
        {
            heading: 'Related Monitors',
            items: [
                'Production → Weaving Monitor shows loom efficiency: actual output against the target from rate × lines × 24 h, on working days only.',
                'Production → Dyeing Monitor shows dye vessels: time-based output and bath phase history per work order.',
                'Defect stores and reject grades are explained on the Quality & Quarantine page.',
            ],
        },
    ],
};
