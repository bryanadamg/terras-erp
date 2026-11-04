import { DocPage } from '../docsContent';

export const dyeingSettingPage: DocPage = {
    slug: 'dyeing-setting',
    title: 'Dyeing & Setting',
    subtitle: 'Dye recipes, colour codes, lab dips, dye baths, the Dyeing Monitor and stenter setting: from an approved shade to a dyed, set lot.',
    badges: ['Dye Recipes', 'Dyeing Orders', 'Setting Orders', 'Dyeing Monitor', 'Kartu Celup', 'Colors', 'Lab Dips', 'Yarn Lab Dips'],
    sections: [
        {
            heading: 'Screens in This Area',
            table: {
                headers: ['Screen', 'Where', 'What it is for'],
                rows: [
                    ['**Dye Recipes**', 'Dyeing & Setting → Dyeing & Setting, tab Dye Recipes', 'The recipe library: one recipe per colour code, with dyes, chemicals, Bak Cuci and finishing steps.'],
                    ['**Dyeing Orders**', 'Dyeing & Setting → Dyeing & Setting, tab Dyeing Orders', 'Every dyeing work order, grouped by shade and vessel. This is where a bath is set up and where QC records the shade.'],
                    ['**Setting Orders**', 'Dyeing & Setting → Dyeing & Setting, tab Setting Orders', 'Every setting (stenter) work order, grouped by shade and machine. Set the machine up, start and complete runs, record width, GSM and shrinkage.'],
                    ['**Dyeing Monitor**', 'Production → Dyeing Monitor', 'The vessel clock. Stamp Color matching, Start and Complete per bath, and compare run time against the time the load needs.'],
                    ['**Colors**', 'Dyeing & Setting → Colors', 'Two tabs: Color Codes (the shade library) and Colors (Variant) (the short colour list used on items, BOMs and stock).'],
                    ['**Lab Dip Requests**', 'Dyeing & Setting → Lab Dip Requests', 'Colour approval for finished goods. An approved variant becomes a colour code.'],
                    ['**Yarn Lab Dips**', 'Dyeing & Setting → Yarn Lab Dips', 'The same approval flow for raw-material yarn, with its own numbering.'],
                    ['**Lab Dip Report**', 'Dyeing & Setting → Lab Dip Report', 'How many variants were dipped, re-dipped, rejected and approved over a date range.'],
                ],
            },
            callout: {
                type: 'info',
                text: 'Dyeing Orders lists work orders cut at a DYEING (or CELUP) work centre and Setting Orders lists those cut at a SETTING work centre. The type is set on the work centre in Engineering → Routing. If your role is limited to certain work-centre types, you can only set up, stamp or record runs on work orders of those types.',
            },
        },
        {
            heading: 'How a Dye Order Flows',
            steps: [
                'The colour is approved through a lab dip (or entered directly in Colors → Color Codes), and a dye recipe is made for that colour code.',
                'The planner cuts the dyeing work order. The system matches the recipe and creates bath #1 on the order automatically (see the next section).',
                'Greige lots are staged (scanned) to the work order.',
                'On Dyeing Orders the supervisor sets up the bath: water volume, ropes, speed and load, for one order or for the whole shade group in one vessel. The dose sheet is weighed from that bath.',
                'At the vessel the operator stamps Color matching, Start and Complete on the Dyeing Monitor.',
                'The output is logged on the work order (Production → Work Orders) like any other step. That log creates the dyed DYE- lot and books it into stock.',
                'QC records the shade result (PASS, FAIL or REWORK) on Dyeing Orders.',
                'The dyed lots go on to setting, where Setting Orders records the stenter run and the measured width, GSM and shrinkage.',
            ],
        },
        {
            heading: 'Cutting a Dyeing Work Order',
            body: 'When a work order is created on a DYEING work centre, the system looks for the recipe before it saves the order:',
            items: [
                'If the manufacturing order carries a Color Library colour code, it takes the active recipe made for that colour code.',
                'Otherwise (older orders without a colour code) it takes the active recipe whose attribute values exactly match the manufacturing order\'s attributes.',
                'The matched recipe is saved on the work order as its planned recipe, and bath #1 is created with status PENDING and the work order qty as its load. No water volume, ropes or speed are set at this point; those are set on Dyeing Orders.',
                'The match only happens when the work order is created. Moving an existing work order to a dyeing work centre later does not create a bath.',
                'Setting work orders are not given a run automatically. Their first run is created on Setting Orders.',
            ],
            callout: {
                type: 'warning',
                text: 'The recipe is required. Creating the dyeing work order is refused when no active recipe matches ("No active dyeing recipe found for this order\'s color"), when the order has neither a colour nor attributes, or when its colour is still in lab dip ("Color still in lab dip: approve the lab dip or set an approved color on the MO"). Greige can be woven while the lab dip is pending, but dyeing cannot be cut until the shade is approved.',
            },
        },
        {
            heading: 'Dye Recipes',
            body: 'A recipe is the standard formula for one colour code. Click New Recipe on the Dye Recipes tab, or use the create-recipe button on a row in Colors → Color Codes, which opens a new recipe already set to that colour.',
            table: {
                headers: ['Field', 'Notes'],
                rows: [
                    ['Color Code', 'Pick the Color Library shade the recipe is made for. The name and colour standard are filled in from it.'],
                    ['Recipe Code', 'Generated as prefix + colour code + a 5-digit counter. Configure changes the prefix and separator. The code can still be edited.'],
                    ['Color Standard', 'The matching reference, for example a Pantone or customer shade number.'],
                    ['Substrate Type', 'The cloth the recipe is designed for, for example Cotton or Polyester.'],
                    ['Liquor Ratio (1 : x)', 'The recipe\'s standard litres of water per kg of cloth, for reference.'],
                    ['Active', 'Inactive recipes are never matched to new dyeing work orders.'],
                    ['Notes', 'Free text.'],
                ],
            },
            callout: {
                type: 'tip',
                text: 'The recipe list shows each recipe\'s colour code with its swatch and its Colors variant. Expand a row to see its chemical lines, Bak Cuci and finishing. The row ⋯ menu has Edit, Print Recipe Card and Delete.',
            },
        },
        {
            heading: 'Chemical Lines and Dose Basis',
            body: 'Each chemical line has a type, an item, a rate and a sort order. Fill in exactly one rate column per line. A line with both filled cannot be saved, because it would have no single dose.',
            table: {
                headers: ['Rate column', 'Basis', 'Dose', 'Use for'],
                rows: [
                    ['**Qty/100kg**', 'Weight on fabric', 'rate × load kg ÷ 100', 'Dyestuff. Shade depth follows the weight of the cloth, so the dose does not change with the water volume.'],
                    ['**g/L**', 'Bath concentration', 'rate × bath litres (Volume Air), in grams', 'Salt, soda ash, alkali and auxiliaries. A bigger bath needs proportionally more.'],
                ],
            },
        },
        {
            heading: 'Chemical Types',
            body: 'The type decides how a line is labelled on the Kartu Celup. Dyes print first.',
            table: {
                headers: ['Type', 'Typical use', 'Printed as'],
                rows: [
                    ['DYE', 'The colorant', 'Dyes 1, Dyes 2 …'],
                    ['AUXILIARY', 'Levelling agent, wetting agent and other process chemicals', 'Chem 1, Chem 2 …'],
                    ['SALT', 'Glauber\'s salt, common salt', 'Chem n'],
                    ['OTHER', 'Anything else', 'Chem n'],
                ],
            },
        },
        {
            heading: 'Bak Cuci and Finishing',
            body: 'Bak Cuci (wash bath) steps and Finishing steps are picked from lists, not typed. The lists are the Wash Bath and Finishing Step system attributes, maintained on Inventory → Attributes. Each Bak Cuci step has a bath number. Both print on the Kartu Celup below the chemical table.',
        },
        {
            heading: 'Dyeing Orders',
            body: 'One row per dyeing work order. You can filter by status and vessel and search by WO or MO number. The columns are WO, MO, Product, Variant (size, shade and colour code chips), Vessel, Recipe, Substrate, Bath (L), Target / Done, Baths and Shade.',
            items: [
                'Rows are grouped by shade on a vessel. Each group header shows the shade, the vessel, how many orders are on this page, their total qty, and two buttons: Print Kartu Celup (n) and Set Up Bath (n).',
                'Orders with no shade yet group by their lab dip code.',
                'Sorting by a column header turns grouping off, because the group would no longer be contiguous.',
                'Ticking nothing means the button covers the whole group. Tick rows to act on only those orders.',
                'The Shade column shows the worst result across the order\'s baths: FAIL, then REWORK, then PASS.',
                'Expand a row to see the order chain and every bath on the order (recipe, substrate, liquor ratio, actual litres, status, shade, Matching / Started / Completed times). A chip marks a bath shared with other work orders.',
                'Create Run in the expanded row cuts an extra bath, for a re-dye or a second pass. Bath #1 already exists, so normally you configure that one.',
            ],
        },
        {
            heading: 'Setting Up a Bath',
            body: 'The bath is configured on the run, not on the work order. Use the sliders button on a bath row, or Set Up Bath on a group header.',
            table: {
                headers: ['Field', 'Notes'],
                rows: [
                    ['Recipe', 'Pre-selected with the recipe matched to the order.'],
                    ['Substrate Qty', 'The load in kg. Defaults to the work order qty.'],
                    ['Input Lot', 'Optional lot reference.'],
                    ['Liquor Ratio', 'Litres of water per kg. Used to work out the volume when Volume Air is left blank.'],
                    ['Volume Air (L)', 'The water actually in the vessel. An entered volume always wins over the ratio, and every g/L chemical is weighed against it.'],
                    ['Line (ropes)', 'How many ropes the vessel runs this load on.'],
                    ['Speed (yd/min per rope)', 'Picked by shade depth from the Dyeing Speed list (values such as Tua (3)). Ropes × speed is the vessel rate the Dyeing Monitor uses.'],
                    ['Speed, Tekanan, Temperature, Duration, Operator, Notes', 'Process parameters for the Kartu Celup and the record.'],
                ],
            },
            callout: {
                type: 'info',
                text: 'Set Up Bath on a group sets up one vessel for several orders at once. The volume, recipe, ropes and speed are typed once and recorded whole on every order\'s run. Each order keeps its own load (its own WO qty), clock and monitor row. All orders in one bath must be on the same vessel and the same shade; a mixed selection is refused. A group of one opens the normal single-bath panel.',
            },
        },
        {
            heading: 'Dose Sheet and Chemicals Used',
            items: [
                'While you type the load and volume, a live preview under the form shows the Weigh Out quantity for every recipe line.',
                'Saving a volume fills the bath: the run moves to IN_PROGRESS and its dose sheet is fixed. That fixed sheet is what the operator was told to weigh.',
                'Reopen the bath with the sliders button to record the actual quantity of each chemical. The sheet shows Weigh Out, Actual and Variance.',
                'If the bath is topped up later, every chemical not yet weighed is re-dosed against the new volume. A chemical with an actual quantity is never changed.',
                'A closed bath cannot be edited.',
            ],
        },
        {
            heading: 'Bath Status',
            body: 'The run status is never typed. It is worked out from what has been recorded and from the work order:',
            table: {
                headers: ['Status', 'When'],
                rows: [
                    ['PENDING', 'Bath created, nothing recorded yet.'],
                    ['COLOR_MATCHING', 'Color matching was stamped on the monitor; the bath is not filled yet.'],
                    ['IN_PROGRESS', 'A bath volume was recorded or Start was pressed.'],
                    ['COMPLETED', 'The bath was closed (Complete on the monitor, or the shade result was recorded), or its work order was completed.'],
                    ['CANCELLED', 'The work order was cancelled.'],
                ],
            },
        },
        {
            heading: 'Recording the Shade Result',
            body: 'The eyedropper button on a bath (or on the work order row) opens the Shade Result panel. QC is a separate act, usually by a different person after the batch has come off the vessel.',
            steps: [
                'Choose PASS, FAIL or REWORK and add optional shade notes.',
                'The bath as recorded and the chemicals used are shown read-only for reference.',
                'Save. If the bath was not already closed on the monitor, it is closed now. A bath closed at the vessel keeps the time it actually finished.',
            ],
            callout: {
                type: 'info',
                text: 'Set the bath up first, so the panel has a dose sheet to show. Once the shade is recorded it is locked. There is no output lot field: the dyed lot is created when the work order output is logged, and the run picks it up automatically, giving one lot per physical dye batch.',
            },
        },
        {
            heading: 'Printing the Kartu Celup',
            items: [
                'Per bath, from Dyeing Orders: Print Kartu Celup (n) on a group header prints one filled card for the whole vessel. It lists the WO numbers, MO numbers, item names, colour codes (or the lab dip code marked pending), sizes, colour variants and combos, the total load, the water volume, liquor ratio, machine, speed, pressure, ropes and lots. Doses are weighed against the summed load and the vessel\'s water.',
                'If no bath volume has been recorded yet, the g/L lines print their rates for the floor to weigh rather than grams.',
                'Blank, from Dye Recipes: the row ⋯ menu → Print Recipe Card prints the recipe for the floor to fill in by hand.',
                'Tick boxes in the preview leave out Bak Cuci, Finishing or the signature band for this print only. The layout itself is edited in Administration → Print Layouts.',
                'The dyeing Kartu Kerja printed from the work order also shows the recipe and its weighed doses.',
            ],
        },
        {
            heading: 'Dyeing Monitor',
            body: 'Production → Dyeing Monitor has one row per dye bath, across every dyeing work order. It is a timer: the operator presses buttons at the vessel, and the screen shows whether the vessel ran long enough at its speed for the load it was given.',
            items: [
                'Filter by machine or machine group, search, and use the status chips: All, Running, Loaded, Completed, No bath. A counter shows how many batches still need setup (no speed picked).',
                'Buttons per row: Color matching (before the bath starts, optional), Start, Complete and Set rate (speed per rope and rope count, picked from the same Dyeing Speed list). The stamp buttons need permission to log work orders.',
                'Columns: MO, Work Order and bath number, Item, Variant, Vessel, Status, Speed (yd/min × ropes = rate), Run time, Run time vs expected, Color matching, Start and Complete times.',
                'Expand a row to see every bath the work order has had (a re-dye is a second bath), with each phase (matching, dyeing, complete) and the time between stamps. Beside it, the calculation behind the output bar is written out step by step.',
                'A dyeing work order that was closed without its bath ever being started is listed greyed out as No bath, so nothing silently disappears.',
                'The page refreshes itself every minute and on live updates.',
            ],
        },
        {
            heading: 'Monitor Output Bar',
            body: 'Expected time = the load in yards ÷ (yd/min per rope × ropes). The load is the lots staged to the work order, or the work order qty if nothing is staged, converted to yards through the item\'s g/y. The bar is run time (Start to Complete) against that expected time.',
            table: {
                headers: ['Shown', 'Meaning'],
                rows: [
                    ['Blue bar', 'The batch is still running.'],
                    ['Green bar', 'Completed and ran at least the full expected time.'],
                    ['Amber bar', 'Completed but came off short of the expected time.'],
                    ['No speed picked', 'Use Set rate (or the bath setup) to pick the yd/min.'],
                    ['No lines set', 'The rope count is missing.'],
                    ['No g/y on the item', 'Yards cannot be worked out from the item\'s stock unit.'],
                ],
            },
        },
        {
            heading: 'Logging Dyed and Set Output: the Lot Picker',
            body: 'Dyed and set output is logged on the work order (Production → Work Orders) like any other step. For dyeing and setting the input arrives as many bags, so the log form shows a checkbox list of lots:',
            items: [
                'Lots scanned onto this work order at staging are pre-ticked and marked "staged". Other lots on the line are left unticked for you to pick.',
                'Lots staged to a different work order are locked and only listed as a warning. Only that work order can consume them.',
                'On a sized order, lots of other sizes are folded away under "Show n lots of other sizes", and All selects only lots of the order\'s size (or unsized lots).',
                'The qty drawn is spread over the ticked lots oldest first. A lot gives up only what this log used and keeps the rest.',
                'Dyed output always gets a traceable DYE- lot and set output a SET- lot, even when the item itself is not lot-tracked.',
            ],
        },
        {
            heading: 'Setting Orders',
            body: 'One row per setting work order, grouped by shade on a machine, with filters for status and machine. Expand a row to see its runs: machine, substrate, temperature, speed, set width, overfeed, actual width, actual GSM, shrinkage %, status, output lot and times.',
            steps: [
                'Set up a run: Set Up Machine (n) on a group header applies one setup to several orders, or use Create Run in a row\'s expanded panel for one order. An order that already has an open run has that run updated; a closed run is left as history.',
                'Fields: Machine Name, Temperature (°C), Speed (m/min), Width (cm), Overfeed (%), Operator and Notes. A single-order run also takes the Input Lot and Substrate Qty (defaults to the WO qty).',
                'Press Start on the run.',
                'Press Complete and enter the Output Lot Number (required) plus the measured Actual Width (cm), Actual GSM and Actual Shrinkage (%). An existing lot number is linked; a new one creates the lot for the order\'s item.',
            ],
            callout: {
                type: 'info',
                text: 'A shared setup is one machine running one colour, so a mix of machines or shades is refused. Each order keeps its own load and output lot; only the machine settings are shared.',
            },
        },
        {
            heading: 'Colors → Color Codes',
            body: 'The shade library, with tens of thousands of codes. Each code is a shade a recipe is made for and an order is placed against.',
            items: [
                'Filters: search (code, name, Pantone, customer code), status (active / archived), Colors variant, customer, item and source (From Lab Dip FG, From Lab Dip Yarn, Manual Entry).',
                'Columns: Code, Name, Color Variant, Colour Index, L*a*b*, Customer (House when none), Cust. Code, From Lab Dip (opens the request), Item, Recipes (count) and Status.',
                'Row buttons: complete the L*a*b* measurement, and create a dyeing recipe for this colour.',
                'New Color (needs permission to create colour codes) takes code, name, Colors variant, item, CIELAB values with illuminant/observer, Pantone ref, Colour Index, swatch hex, substrate, customer, customer colour code, spectrophotometer notes and notes. If the save is refused (for example a duplicate code), the form stays open with the reason.',
                'Item: link a shade straight to the item it was dipped for. Use this for shades lab-dipped outside the system; shades approved through a lab dip are linked automatically.',
                'The ⋯ menu deletes a code that nothing uses yet. A code that is in use is archived instead, so its history still resolves.',
            ],
        },
        {
            heading: 'Colors → Colors (Variant)',
            body: 'The short, curated colour list (for example NAVY, BIRU, MERAH) used as the colour variant on items, BOMs, orders and stock. It is a different list from the Color Codes library.',
            items: [
                'Switch between List (with inline rename) and Swatches (a swatch grid). Your choice is remembered.',
                'Family chips (blue, red, and so on, with counts) filter the list. Missing swatch shows values with no saved hex; their swatch is guessed from the name.',
                'New Color, Rename and Delete each need their own permission. A colour still used by items cannot be deleted.',
                'Colour chips across the app (WO lists, monitors, packing, sales orders, stock) show this swatch next to the colour code.',
            ],
        },
        {
            heading: 'Lab Dip Requests and Yarn Lab Dips',
            body: 'A lab dip request collects the colours to be matched for one or more items, and tracks each colour (a variant) to approval. Finished-goods requests are numbered LD-YYYY-#####. Yarn requests are on their own screen, pick raw-material items and are numbered LDY-YYYY-#####, so the two books never share a sequence.',
            steps: [
                'Create a request: Request Type (NEW, RESUBMIT or STRIKE_OFF), Customer (optional; none means Internal), Season / Project, the items, and the colours from the Colors variant list (per item, or for the whole request). Optionally link an Approved Dye Recipe and add notes.',
                'Each item becomes a variant with a code such as 00001-A, 00001-B (yarn: Y00001-A).',
                'Move each variant through Pending → In Progress → Approved or Rejected from its row in the expanded request.',
                'The request\'s own status (Draft, Submitted, Approved, Rejected) is set from the dropdown in the expanded row.',
            ],
            callout: {
                type: 'tip',
                text: 'The list is searched, filtered by created date and sorted by column header across all pages. Rows with an attached photo show a paperclip. The footer counts variants, not requests, by status.',
            },
        },
        {
            heading: 'Approving, Rejecting and Revoking a Variant',
            items: [
                'Approve asks for a Set Index (required), which completes the colour code (for example 00001-B-6), the Colors variant to link (filled in when the request picked exactly one), optional notes and an optional photo. Approve & Save Color adds the code to Colors → Color Codes for the request\'s customer (or as a House colour).',
                'On approval, manufacturing orders and sales order lines that were placed against that lab dip code get the new colour automatically, so their dyeing work orders can be cut.',
                'Reject asks for a reason (Color mismatch, Shade too dark, Shade too light, Quality defect, and so on), optional notes and an optional photo. Every rejection is logged; the "Rejected n×" chip opens the history.',
                'A rejected variant can be reopened to In Progress for another round. Its rejection history is kept.',
                'An approved variant is locked. Its only exit is Revoke Approval, used when the customer rejects after approval. Revoking archives the colour code and removes it from the orders that were waiting on this lab dip.',
                'Revoking is refused once the colour has been used: by a dye recipe, a stock movement, a packing order, a stock reservation, a production run entry, or an order line that picked it by hand. At that point only a new lab dip can replace it.',
            ],
        },
        {
            heading: 'Lab Dip Report',
            body: 'Counts attempts, not current status. A variant rejected twice before approval counts as 3 dips, 2 rejections and 1 approval. Choose a date range, customer, book (All, Finished Goods, Yarn) and grouping (by customer, book or month).',
            items: [
                'Tiles: Variants, Requests, Dipped, Approved, Rejected, Approval Rate (approvals ÷ approved + rejected) and Dips / Variant (above 1 means re-dips).',
                'A summary table per group and a variant table (request, customer, variant, item, dipped, rejected, approved, current status, last activity).',
                'Export CSV downloads the variant table.',
            ],
        },
        {
            heading: 'Lot Traceability',
            body: 'The dyed lot is created once, by the work order output log, which also books it into stock; the dyeing run links to it. Several bags from one bath trace back through the lots they consumed. Setting runs link their input and output lots the same way. The result is a chain from yarn through greige, dyeing and setting to the finished lot.',
        },
    ],
};
