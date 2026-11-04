import { DocPage } from '../docsContent';

export const packingDispatchPage: DocPage = {
    slug: 'packing-dispatch',
    title: 'Packing & Dispatch',
    subtitle: 'The Warehouse section: pack finished goods into cartons, pick cartons for a sales order, and load them onto a Surat Jalan under a two-person check.',
    badges: ['Packing Orders', 'Held Lots', 'Carton Labels', 'Pick Lists', 'To Pick Board', 'Dispatch', 'Four-Eyes Check', 'Surat Jalan'],
    sections: [
        {
            heading: 'The Warehouse Flow',
            body: 'The Warehouse section lists its screens in the order goods move through them. Each step has its own document and is usually done by a different person:',
            steps: [
                'Quarantine Packing: QC releases held lots so they can be packed (see Quality & Quarantine).',
                'Packing Orders: the packer turns bulk finished goods into numbered cartons (PU-...), each one a lot with its own label.',
                'Pick Lists: the planner chooses which cartons go to a sales order, and the picker scans them in. A pick list ends at Picked. Nothing has left the building yet.',
                'Dispatch: the loading deck groups picked lists for one customer onto a shipment and prints the Surat Jalan. A second person verifies the load, and only then is it dispatched. Dispatch is the only step that takes the goods out of stock.',
            ],
        },
        {
            heading: 'Creating a Packing Order',
            body: 'Click New in Warehouse → Packing Orders. The form has these sections:',
            items: [
                'Demand: optionally pick a sales order (the dropdown is searchable) and the order line being packed. The line fixes the item, colour and variants, and its selling unit is shown. Leave the sales order empty to pack to stock.',
                'What to Pack: the finished good, the target, the qty per carton, the package type (default "Carton"), the alt unit and the alt count per carton.',
                'Sampled weight (g/y or g/m): this starts from the item master\'s weight. Replace it with what the operator actually measured on the goods. Every kg figure on the order is converted with it, and a hint line shows the conversion, for example "1 Pcs = 5 Yard = 0.6 kg".',
                'Pack basis, for alt-unit orders: Count means the packer counts pieces into each box and then weighs it. Weigh only means the packer weighs each box and the piece count is worked out from the sampled weight.',
                'Locations & Machine: Pack from (where the bulk goods are), Store cartons at (where sealed cartons go), and an optional packing machine. Only PACKING work centres are offered. The machine is filled in for every pack entry.',
                'Held Lots: tick lots at the pack-from location to hold them for this order (see below). Use as target sets the target to what the ticked lots hold.',
            ],
            callout: {
                type: 'info',
                text: 'When the order has an alt unit, the alt count is the real target and the kg target is only an estimate (it is greyed out). An order for 50 Pcs is finished when 50 Pcs are boxed, whatever they weigh on the scale.',
            },
        },
        {
            heading: 'Packing for an Order vs. to Stock',
            body: 'Linking a packing order to a sales order is only a tag. Packing can run to stock with no sales order at all. A carton packed against one order can still be picked for another. The exception is a carton pinned to an order with Allocate from stock (Sales → Sales Orders): only that order can pick it. For a sized order line, only lots of that size can be packed, and the lot picker is locked to the line\'s size, colour and combo.',
        },
        {
            heading: 'Held Lots',
            body: 'A held lot belongs to one packing order. Lots get held when you tick them on the New Packing Order form, or when you click Pack on the Quarantine Packing desk.',
            items: [
                'Only the packing order that holds a lot can pack from it. Any other order trying to draw it is refused with "held by PCK-...".',
                'The order cannot be closed while a held lot still has stock at the pack-from location. The only exception is a small leftover inside the weighing tolerance (Settings → Company Profile), which is written off as a scale difference.',
                'Once every held lot is packed out, the order counts as Delivered even if the cloth came in lighter than the target.',
                'The hold ends when the order is closed.',
            ],
        },
        {
            heading: 'Logging a Pack',
            body: 'Open an order with Pack. The panel shows the order\'s progress (pieces above kilos, with packing scrap in red), the colour and the pack-from location. To log one pack entry:',
            steps: [
                'Pick the source lots to pack from (for lot-tracked items). Lots held by this order are pre-selected.',
                'Add carton lines: how many cartons, and how much goes in each. On a counted order you type the piece count and weigh the box. On a weigh-only order you type the scale reading and the count is worked out. Expand a line to enter each carton\'s own net weight, which prints as N.W. on the label.',
                'Pick the packaging for every line from the Packaging master (Inventory → Packaging). Its tare is added to the net weight to give the gross weight. For a custom box, weigh the empty box and enter its tare.',
                'Add a note to a line if needed. It prints on the label of every carton on that line.',
                'If material left the pack-from bin but never became a carton (offcuts, stains, wet goods), enter it under "Rejected, not boxed" with a reason. It goes to the defect store and never counts as packed.',
                'Optionally set the machine, operator and notes, then log. The footer shows the Boxed, Rejected, Drawn and Gross totals.',
            ],
            callout: {
                type: 'warning',
                text: 'Logging stays blocked until every carton is weighed, every line has a box picked, every custom box has a tare, and any location or sampled-weight change has been saved. A carton cannot hold two sizes. If one carton would mix lots of two sizes, the pack is refused, so pack the sizes in separate cartons or separate entries. If the cartons weigh slightly more than the lots\' book qty, a gap within the weighing tolerance is accepted and spread across the lots.',
            },
        },
        {
            heading: 'Rejecting Packed Cartons',
            body: 'Each row in Previous Entries has a QC Reject action. You can reject the whole entry or only chosen cartons, give a reason, and tick "Still usable" for a downgrade instead of scrap. Rejected cartons move to the packing machine\'s defect store and come off the packed qty. If the order had already been fulfilled, it reopens to In Progress.',
        },
        {
            heading: 'Packing Order Statuses',
            table: {
                headers: ['Status', 'Meaning'],
                rows: [
                    ['Pending', 'Created, nothing packed yet'],
                    ['In Progress', 'At least one pack entry logged'],
                    ['Delivered', 'Target met (in pieces on an alt-unit order), or every held lot packed out. More cartons can still be logged.'],
                    ['Completed', 'Closed with Close Order. No more cartons can be packed.'],
                ],
            },
            body: 'The list shows each order\'s item, variant, sales order, status, a progress bar, the selling unit, the stock unit and the carton count. Search matches code, item, colour, sales order and customer. An order can only be deleted while nothing has been packed on it.',
        },
        {
            heading: 'Carton Labels and the Kartu Packing',
            items: [
                'Carton label (A6 landscape): style code, colour code, colour, combo, size, content, PO no, lot no, N.W., G.W. and note, with a QR code and a PU- barcode for handheld scanners. You can print one label, the labels of one pack entry, or every carton on the order (Print Carton Labels in the row menu). Labels can be reprinted later from Inventory → Lot.',
                'Kartu Packing: the packing card (Packing Card button, or Print Packing Card in the menu). It prints the item, WARNA (the colour variant), KODE WARNA (the colour code), size, variant and the conversion basis.',
                'Both layouts can be edited in Administration → Print Layouts.',
            ],
        },
        {
            heading: 'The To Pick Board',
            body: 'Warehouse → Pick Lists opens on the To Pick tab, which lists open sales orders (Pending, Ready and Partial) scored for picking. Orders with the earliest delivery date come first, and undated orders come last.',
            table: {
                headers: ['Column', 'What it shows'],
                rows: [
                    ['**Sales Order / Customer**', 'PO, customer ref, status, and an "open pick list" tag if the order already has one in progress'],
                    ['**Items**', 'Each line\'s item with its colour, combo and size chips'],
                    ['**Delivery due**', 'The order\'s due date'],
                    ['**Outstanding**', 'What is still owed, in the order\'s selling unit with kg under it, and how many lines are still open'],
                    ['**Ready**', 'Packed qty available to pick now, and how many cartons that is'],
                    ['**Coverage**', 'Of what is still owed, how much is packed and waiting'],
                    ['**Fulfilment**', 'The whole order: made, packed and shipped'],
                ],
            },
            callout: {
                type: 'tip',
                text: 'Switch the filter from All orders to Ready to pick to hide orders with nothing packed yet. Every column header except Items sorts, and the search box matches SO, customer and item. The Pick button is active only on orders that have cartons ready to pick.',
            },
        },
        {
            heading: 'Choosing Cartons',
            body: 'Pick opens Pick Cartons for the order, with whole cartons already suggested for each line.',
            items: [
                'The suggestion order is: cartons allocated to this order from stock first, then cartons packed in the line\'s own selling unit, then everything else, oldest first within each group.',
                'Each line has a coverage bar in the customer\'s unit. It shows what is already picked (green), what this pick adds (blue, red if it goes over), and what is still owed.',
                'Untick any carton you do not want before creating the list.',
                'Only cartons of a size the line orders are offered or accepted. A carton of another size is refused.',
                'If the last box would overship, Split this box ships part of it as a new carton and leaves the rest in the finished-goods store. The split amount starts at what is actually owed.',
                'Create pick list keeps you on the To Pick board.',
            ],
        },
        {
            heading: 'Working a Pick List',
            body: 'The Pick Lists tab is the register. It shows each list\'s code, sales order, customer, status, cartons scanned, delivery note and dispatch date, with a search across code, SO, customer and Surat Jalan number. Open a list (or scan its PL- QR at QUICK SCAN) to work it:',
            items: [
                'Scan or type each carton number (PU-...). The list moves from Draft to Picking on the first scan and to Picked once every carton is scanned. A carton that was not suggested can be scanned in if it matches a line\'s item and size and is not committed elsewhere.',
                'A rejected carton, or a carton already on another pick list or allocated to another order, is refused at the scan.',
                'Tick QC Passed. The inspector name is filled in with the person at the screen. A list cannot be staged until QC has passed.',
                'Ordered, Remaining and carton quantities are shown in the order line\'s alt unit. Order lines that this list does not cover are folded away.',
                'One sales order can have several pick lists. This is how a partial shipment works.',
                'A list that is already loaded on a shipment cannot be edited until it is taken off that shipment. A dispatched list cannot be deleted.',
                'Kartu Picking (printer icon on the row) prints the cartons and summary in the alt unit, with the shipment number. Its layout is in Administration → Print Layouts.',
            ],
        },
        {
            heading: 'Dispatch: The Loading Deck',
            body: 'Warehouse → Dispatch shows Picked pick lists "On Deck" at the top and shipments below. Filter by All, On Deck, Staged, Verified, Dispatched or Cancelled, and search by Surat Jalan number, code or vehicle.',
            table: {
                headers: ['Step', 'What happens', 'Who'],
                rows: [
                    ['Stage on Deck', 'Pick one or more Picked, QC-passed, fully scanned lists for a single customer. This creates the shipment as Staged, takes the next Surat Jalan number, and opens the print preview.', 'Loading-deck staff'],
                    ['Verify Load', 'Scan every carton against the shipment. Confirm Load unlocks when all cartons are ticked, or when "Pass with discrepancy" is ticked with a note (for a short or over load agreed with the customer).', 'A different person with the verify permission'],
                    ['Confirm Dispatch', 'Takes the goods out of finished-goods stock carton by carton, marks the pick lists Dispatched, releases their stock holds, and updates the sales order to Partial or Sent', 'Dispatch permission'],
                ],
            },
            callout: {
                type: 'warning',
                text: 'Four eyes: the person who staged a shipment cannot verify it. Only Administrators may verify their own shipment, for when no second checker is available. Staging and verifying move no stock, so a shipment can wait at Staged or Verified without anything leaving the ledger.',
            },
        },
        {
            heading: 'Correcting a Shipment',
            items: [
                'While a shipment is Staged, Edit (row menu) changes the delivery date, carrier, driver and which pick lists are on it. Any pick list you remove goes back on deck.',
                'A Verified shipment cannot be edited. Use Reopen to undo the verification, fix the shipment, and verify again.',
                'Cancel sends the pick lists back on deck. A dispatched shipment cannot be cancelled or deleted.',
                'One Surat Jalan goes to one customer. Pick lists for different customers cannot share a shipment.',
            ],
        },
        {
            heading: 'Surat Jalan and Perincian',
            body: 'Print Surat Jalan opens a preview. There you fill in the delivery date, vehicle no, driver, carrier and notes, which are saved as you leave each field, plus the Prepared By name. The Surat Jalan number comes from the series when the shipment is staged and cannot be changed on the shipment. If you edit the number in the preview, the change prints on that paper only. The sheet prints the legal delivery note: colour as name with code, for example NAVY ( 00001-B-6 ), combo, size, qty in the order line\'s alt unit, and the gross (Bruto) total. Below a tear line comes the Perincian, a ruled carton-by-carton breakdown showing each carton\'s alt count with its kg. Paper size, margins and layout are set in Administration → Print Layouts.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Create a packing order for a sales order line or to stock, with a sampled weight and a Count or Weigh only basis',
                'Hold specific lots for one packing order, and pack them out before closing',
                'Log cartons with packaging, tare, per-carton net weight and notes, and log loose rejects with a reason',
                'QC-reject packed cartons as scrap or as a usable downgrade',
                'Print carton labels and the Kartu Packing',
                'Pick from the To Pick board, untick or split suggested cartons, scan cartons, and pass QC',
                'Stage pick lists onto a shipment, print the Surat Jalan with Perincian, verify with a second person, and dispatch',
            ],
        },
    ],
};
