import { DocPage } from '../docsContent';

export const inventoryPage: DocPage = {
    slug: 'inventory',
    title: 'Inventory & Items',
    subtitle: 'The item master and its reference lists (Attributes, Categories, Units of Measure, Combo Library, Packaging), and the Lot page where every physical lot, beam and carton is listed, traced, split, rejected and relabelled.',
    badges: ['Item Inventory', 'Attributes', 'Categories', 'UOM', 'Combo Library', 'Packaging', 'Lot'],
    sections: [
        {
            heading: 'Where these screens live',
            body: 'Everything on this page sits in the sidebar\'s Inventory group. Stock On-Hand, Booking Stock and Locations are in the same group and are covered on the Stock & Locations page.',
            table: {
                headers: ['Sidebar', 'What it is for'],
                rows: [
                    ['**Inventory → Item Inventory**', 'The item master: every yarn, greige, beam, dyed fabric, finished good and packing material.'],
                    ['**Inventory → Attributes**', 'One window with three tabs: Attributes, Categories and Units of Measure.'],
                    ['**Inventory → Combo Library**', 'The searchable list of combos (yarn-dyed patterns) used as a variant.'],
                    ['**Inventory → Packaging**', 'The boxes and bags cartons are packed in, with their empty (tare) weight.'],
                    ['**Inventory → Lot**', 'Every lot in the plant: goods-receipt lots, beams, greige, dyed lots, hand-made lots and packed cartons.'],
                ],
            },
        },
        {
            heading: 'Item Inventory',
            body: 'One row per item, with code, name, category, UOM, source sample, type and weight per unit. Tabs across the top filter by top-level category (the tab you last used is remembered); the Category picker narrows to any sub-category. Click a row\'s expander to see its change history in place: date and time, action, who did it, and each changed field as old → new. Edit and Delete are in the row\'s ⋯ menu, and ticked rows can be deleted together.',
        },
        {
            heading: 'Creating or editing an item',
            items: [
                'Basic Info: item code, name, category and UOM. The code is suggested automatically; the gear icon next to it sets the pattern (prefix, separator, suffix, year/month, and optionally the variant).',
                'Packaging & Weight: Packaging Units lists the units defined to pack into this item\'s UOM (for example 1 Pic = 36 Yard for a yard-stocked item) and you tick the ones it can also be counted or sold in. Weight / Unit takes gsm, g/m², oz/yd² or g/y. The g/y figure is what converts yards to kilos, for example when a lot is entered as a piece count only.',
                'Inventory Settings: Lot tracked; Make-to-stock (decoupling point), which means planning never creates an MO for it automatically; Reorder point (low-stock warning, 10 if left blank); Default source location (where it is staged from); Default putaway location (pre-fills the MO\'s putaway bin); Default reject location (its defect store when the producing work center has none).',
                'Variant Type (finished-goods categories only): None, Color (the ordered shade is picked from the Colors library) or Combo (picked from the Combo Library, and gates the BOM).',
                'Also Create Beam Item (raw-material categories only): ticking it also creates BEAM-<code> in the Beam category with its own name and UOM, so the beam for this yarn exists from the start. Its BOM is set up in the BOM Designer.',
                'An item created from a sample request\'s Create Item button opens with the code filled in and shows which sample and colour it came from.',
            ],
            callout: {
                type: 'info',
                text: 'If your role is limited to certain categories, you can only create, edit or delete items (and move their stock) in those categories.',
            },
        },
        {
            heading: 'Importing items',
            steps: [
                'Open the arrow next to Import and choose Download Template. It is a CSV file with the columns Code, Name, UOM, Category.',
                'Fill one row per item. Code, Name and UOM are required. A UOM or category name that does not exist yet is created for you.',
                'Click Import and pick the file. The upload starts straight away and you can keep working.',
                'A strip above the table shows how many items were imported and lists each failed row with its reason, for example a missing field or a code that already exists. Good rows are saved even when other rows fail.',
            ],
            callout: { type: 'warning', text: 'Only .csv files are accepted. Save an Excel sheet as CSV first.' },
        },
        {
            heading: 'Variants',
            body: 'A variant is one item in one combination of attribute values, for example a greige in combo NAVY WHITE, or a finished fabric in shade 00001-B-6 · NAVY. Stock, BOM lines, sales order lines and purchase lines are all kept per variant, so two shades of the same item are separate stock that never mix. The order you pick the values in makes no difference. Size works the same way and is shown everywhere as size-target (range), for example L-72 (70-74).',
        },
        {
            heading: 'Attributes tab',
            body: 'The attribute list is on the left and the selected attribute\'s values are on the right, edited in place.',
            items: [
                'New Attribute opens a small window for the name and the first values (Enter adds each one).',
                'Click a value to rename it (Enter saves, Esc undoes). Type in the New value box and press Enter or Add to add one; the +N button adds the next number in a numbered list. Each value has its own delete button.',
                'System attributes carry a lock badge and show where they are used (for example Quarantine QC Status, Dyeing Rope Speed, Dye Recipe · Wash Bath). Their names cannot be changed or deleted because the system looks them up, but you can manage their values.',
                'Combo, Color Code and Colors are not listed here. Manage them in Inventory → Combo Library and Dyeing & Setting → Colors, so the same list is never edited in two places.',
            ],
        },
        {
            heading: 'Categories tab',
            body: 'Categories are shown as three columns, one per level (up to three levels deep). Picking a category in one column lists its sub-categories in the next, and the + at the top of each column adds a category at that level. The status bar shows how many items are filed directly in the selected category and how many including its sub-categories.',
            items: [
                'Rename and delete are on each row. A category with sub-categories cannot be deleted until those are gone, and system categories cannot be deleted at all.',
                'Deleting a category leaves its items uncategorized. It does not delete them.',
            ],
        },
        {
            heading: 'Units of Measure tab',
            body: 'Units are listed on the left. New UOM opens a window to create one (for example Cone, Box, Pcs). Selecting a unit shows what one of it holds and what packs into it.',
            items: [
                'Add a conversion with the bar 1 <unit> = N <other unit>, for example 1 Roll = 144 Yard or 1 Pic = 36 Yard. That makes the unit a packaging choice on items stocked in the other unit, and it is how alt (selling) units such as Pic, Pcs or Gross convert to the stock unit.',
                'System units carry a lock badge and cannot be deleted. If a save fails, the message tells you why.',
            ],
        },
        {
            heading: 'Combo Library',
            body: 'Combos (yarn-dyed patterns such as BLACK WHITE or NVYRED) are kept in their own searchable library because a mill has too many to manage as a plain attribute list. Each combo is still a normal variant value behind the scenes, so BOM, sales order and sample pickers work the same way.',
            items: [
                'Switch between List and Swatches (the choice is remembered). A colour strip is drawn from the colour words in the combo\'s name.',
                'The colour-family chips filter to every combo containing that colour, so the counts overlap on purpose. OTHER finds names with no colour word in them.',
                'New Combo takes a code, name, description and status (active or archived).',
                'The Usage column counts where a combo is used. A combo in use can only be archived; one that is not in use can be deleted.',
            ],
        },
        {
            heading: 'Packaging',
            body: 'The master list of boxes and bags the packing screens pick from (for example Box S/M/L/XL and Plastic Bag). Each type has a code, name, tare in kg (the empty box\'s weight), sort order and status.',
            items: [
                'Tare is added to each carton\'s net weight to give the gross (bruto) weight printed on the carton label and totalled on the Surat Jalan.',
                'Mark one type as Weighed at packing (custom box) for odd boxes. It has no stored tare, and the packer types the tare for each carton.',
                'Changing a tare never alters cartons already packed. Each carton keeps the tare it was packed with, and the new figure applies from the next pack.',
                'Deleting a type that cartons already use deactivates it instead, so history stays intact.',
            ],
        },
        {
            heading: 'Lot page',
            body: 'Inventory → Lot lists every lot. A lot is a physical, traceable quantity: a supplier lot from goods receipt, a beam, a bag of greige, a dyed lot, a hand-made lot or a packed carton. Lot numbers show where a lot came from.',
            table: {
                headers: ['Prefix', 'Lot'],
                rows: [
                    ['**GR-**', 'Goods receipt from a purchase order (keeps the supplier\'s lot number)'],
                    ['**BM-**', 'Warp beam from a BEAMING work order'],
                    ['**GRG-**', 'Greige from a WEAVING work order'],
                    ['**DYE-**', 'Dyed lot from a DYEING work order'],
                    ['**SET-**', 'Set lot from a SETTING work order'],
                    ['**LOT-**', 'Output of any other lot-tracked work order'],
                    ['**BAT-**', 'Hand-made lot created with New Lot'],
                    ['**PU-**', 'Packed carton from a packing order'],
                    ['**RCY-**', 'Rejected stock reassigned to another item'],
                    ['**…-S1, …-R1**', 'A piece split off a lot (S) or a rejected portion of it (R)'],
                ],
            },
        },
        {
            heading: 'Finding a lot',
            items: [
                'Type tabs: All, Goods Receipt, one tab per production type set up in Routing (Beaming, Weaving, Dyeing and so on, using their Routing names), and Packing. The tab you last used is remembered.',
                'Filters: search (lot, item, WO/MO/PR, sales order), Item, Category (includes sub-categories), Location (a warehouse or zone includes everything under it) and Status: Active (the default), Depleted or All.',
                'Columns: Lot Number, Item, Ends, Attributes (size, combo and shade chips), Origin (sales order or PO), WO, MO, PR, Location (store / zone / bin), Remaining, Notes and Created (date and who). Click a header to sort.',
                'Expand a row to see its lineage: the lots it was made from, back to raw fibre on the left, and what it became on the right (beam → greige → dyed lot → …).',
            ],
        },
        {
            heading: 'New Lot (hand-made lot)',
            body: 'Use New Lot to bring in a lot that was not produced or received through the system, for example opening stock or a lot found during a count. The number is assigned automatically (BAT-YYYYMMDD-NNNN).',
            items: [
                'Item: search the whole item list.',
                'Ends, Size, the item\'s own attributes plus Combo and Colors, and Color Code (searches the colour library): optional, so the lot carries the same identity as a produced one.',
                'Quantity: the opening stock in the item\'s UOM. When you enter a quantity, Location is required and the stock is booked there. Attributes and colour code are only saved together with an opening quantity.',
                'Alt Qty: a count in another unit, for example 12 Pcs beside 10 kg. Pick the unit and its conversion (1 Pcs = N Yard). If you type both numbers, both are kept as entered. If you type only the alt count, the kg is calculated from the conversion and the item\'s g/y (and you are told if the item has no g/y set).',
                'Notes: free text.',
            ],
        },
        {
            heading: 'Row actions',
            table: {
                headers: ['Action', 'What it does'],
                rows: [
                    ['**Split** (scissors)', 'Peels part of a good lot into a new good sub-lot (-S1, -S2 …) in the same place and opens its label for printing. The quantity must be less than what remains.'],
                    ['**QC reject**', 'Grades the whole lot, or just a quantity of it, as rejected. A partial reject moves the rejected quantity into a new -R sub-lot and the rest stays good. See below.'],
                    ['**Dispose / Reassign**', 'Only on rejected lots. Write-off scraps the remaining stock (cannot be undone). Reassign moves it onto a new good lot of a different item, for example a beam rejected for one cloth that can still warp a coarser one.'],
                    ['**⋯ → Print Label**', 'Reprints the lot\'s label: the carton sticker for a PU- carton, the bag or beam card for a lot logged from a work order, otherwise the plain lot label. Every lot can be reprinted.'],
                    ['**⋯ → Delete**', 'Deletes the lot record. Stock linked to it loses its lot reference.'],
                ],
            },
            callout: { type: 'info', text: 'If your role is limited to certain locations, you can only act on lots stocked there.' },
        },
        {
            heading: 'QC reject rules',
            items: [
                'Move to defect store: leave it on Auto and the stock goes to the producing work center\'s reject location (inherited from its group or type), then the item\'s Default reject location. If neither is set, the stock stays where it is, flagged. You can also pick a location yourself.',
                'Still usable (downgrade, not scrap): the lot is kept out of planning but can still be picked for consumption and staging, with a warning. Use it for a rejected beam that can be re-mounted for certain items. Unticked, the lot is scrap-bound and drops out of every picker.',
                'If the lot came from a work order log, the rejected quantity no longer counts toward the MO\'s progress, and an MO that had auto-completed reopens. Create a new work order to make up the shortfall.',
                'A rejected lot keeps its grade. Dispose writes the stock off; Reassign turns it into a good lot of another item (RCY-…) while the original keeps its reject record, and the trace links the two. The new lot starts with no colour, combo or size, but keeps its ends and production origin.',
            ],
        },
        {
            heading: 'Lot tracking rules',
            items: [
                'Tick Lot tracked on an item to make every movement carry a lot. Goods receipt asks for the supplier\'s lot number, and moving a lot-tracked item asks which lot to move.',
                'Weaving, dyeing and setting output always gets its own lot (GRG-, DYE-, SET-), even when the item is not lot-tracked. The operator can type a lot or beam number when logging; left blank, it is numbered automatically.',
                'When logging production, the operator picks which lot was consumed for each material line. A lot staged to one work order cannot be used by another.',
                'A quarantine lot claimed by a packing order can only be drawn by that packing order. See Packing & Dispatch.',
            ],
        },
    ],
};
