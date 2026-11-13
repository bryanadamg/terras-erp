import { DocPage } from '../docsContent';

export const manufacturingPage: DocPage = {
    slug: 'manufacturing',
    title: 'Production',
    subtitle: 'Production Runs, Manufacturing Orders, Work Orders, the Work Queue and the Weaving Monitor: planning a run, staging material, mounting beams and logging output.',
    badges: ['Production Runs', 'MRP Netting', 'Manufacturing Orders', 'Work Orders', 'Staging', 'Beams', 'Work Queue', 'Weaving Monitor', 'Labels & SPK'],
    sections: [
        {
            heading: 'Three Levels of Production',
            steps: [
                'Production Run (PR) — the planner\'s container, under Production → Production Runs. One run holds one or more BOM entries (recipe + variant + sizes or total qty). Creating it nets the demand against stock and creates the Manufacturing Orders that are still needed.',
                'Manufacturing Order (MO) — the plan for one item, variant and size. It copies its BOM lines at creation, so later BOM edits never change it. Sub-assemblies (beams, greige) get their own component MOs, shared across the whole run where possible.',
                'Work Order (WO) — one routing step of an MO on a work centre (Beaming, Weaving, Dyeing, Setting…). WOs are what the floor stages, prints (Kartu Kerja) and logs output against; logging a WO is what moves stock.',
            ],
        },
        {
            heading: 'Creating a Production Run',
            body: 'Click New Production Run, or create the run from a sales order so its lines arrive pre-filled and locked.',
            items: [
                'Run Code is generated (PR-<sales order> or PR-<item>) and can be overwritten. Set Target Start / Target End.',
                'Each BOM Entry: Product Recipe (BOM), then any attributes the item carries, then Qty per Size (inputs are labelled like L-72 (70-74)) or Total Quantity. + Add BOM adds another entry, so several sizes, combos or colours plan together in one run.',
                'Color Code: for a colour-type finished good made to stock, search the colour library right on the entry. On a run from a sales order the colour comes from the order.',
                'Ordering a size without a recipe: a sales order may order sizes and leave the recipe open. The run then shows "Ordered: L 100, M 80 — pick the recipe to plan it"; pick the BOM here and the sizes land on that BOM\'s rows. A size the chosen BOM does not have is flagged "that qty is not planned".',
                'Force create even if in stock: skips stock netting for that entry, for deliberate stock building (e.g. greige stockpiling).',
                'Net requirement preview (right panel) shows, before you save, exactly what will be made and what stock will cover.',
            ],
        },
        {
            heading: 'Production Quantity Formula',
            body: 'On a run created from a sales order, the Quantity Tolerance box turns ordered quantities into quantities to make. Type a Tolerance %, then Apply: each size is computed from its formula, multiplied by (1 + tolerance %) and rounded up. The formula is plant-wide and is shown next to the button; Formula opens it. Administrators can edit it there or under Settings → General; everyone else can view it.',
            table: {
                headers: ['Size', 'Default formula', 'Meaning'],
                rows: [
                    ['S', '0', 'S is not made separately'],
                    ['M', '(S + M) / 2', 'Half of the S and M orders together'],
                    ['L', '(S + M) / 2 + L', 'The other half of S and M, plus the L order'],
                    ['Other sizes', 'qty', 'As ordered (also used for BOMs without sizes)'],
                ],
            },
            callout: {
                type: 'info',
                text: 'In a formula, a size name (S, M, 2XL…) means the qty ordered for that size and "qty" means the qty ordered for the size being computed. + − × ÷, brackets and min, max, round, ceil, floor, abs are allowed. A size the BOM does not carry counts as 0.',
            },
        },
        {
            heading: 'MRP Netting — What Gets Made',
            body: 'When a run is created, every finished good and every sub-assembly is netted against free stock before an order is created for it. Covered items get no order (and nothing below them is exploded); partly covered ones are resized to the shortfall. Stock claimed by one line is no longer free for the next, so two lines of the same run can never both count the same pile.',
            code:
`Net free = on hand in the item's store
         + incoming from other open MOs
         − demand of other open MOs
         − stock reserved to other sales orders`,
            items: [
                'Store scope: on-hand counts only inside the item\'s store — its Default putaway location (set on the item) and everything under it. A remnant left at a machine is treated as still in use, not as free stock that cancels a new order.',
                'Beam items with no putaway location net in the BEAMING output store (Gudang Beam). Any other item with none nets plant-wide.',
                'Netting is per size and per variant: an M roll never covers an XL order.',
                'Output of another root MO that is tied to a sales order is promised to that order and never counts as incoming for a new order. Stock-building MOs (no sales order) do count.',
                'QC-rejected and downgraded lots never count as free stock.',
                'A New MO created directly on Manufacturing Orders is make-to-order: its own quantity is never netted, only its components are.',
            ],
        },
        {
            heading: 'Reading the Net Requirement Preview',
            table: {
                headers: ['Decision', 'Meaning'],
                rows: [
                    ['Make (FG)', 'A finished-goods MO will be created'],
                    ['Make', 'A component MO will be created for the full requirement'],
                    ['Resize', 'Stock covers part of it; the MO is created for the shortfall only'],
                    ['In stock', 'Fully covered by free stock; no MO is created'],
                    ['Forced', 'Force create was ticked; netting was skipped'],
                    ['Pooled separately', 'A make-to-stock component (MRP planning = Pool on the BOM line): the demand is recorded but no order is created in this run — replenish it on its own pooled order'],
                ],
            },
            callout: {
                type: 'info',
                text: 'Columns: Net from (the store the item was netted in), Required, On hand, Reserved (on hand but promised to another sales order — hover for which), Net free and Make.',
            },
        },
        {
            heading: 'Reserved Finished Goods',
            body: 'On a run tied to a sales order, finished goods covered from stock are reserved to that order, so the next sales order cannot plan against the same pile. A reservation holds only while its sales order is still open (Pending, Ready or Partial); a sent, delivered or cancelled order releases it automatically. Reserved stock shows on Inventory → Booking Stock. A sales order can also reserve stock before any run with Allocate from stock (see Sales Orders); a later run then only plans the remainder.',
        },
        {
            heading: 'Shared Sub-Assemblies',
            body: 'Below the finished goods, demand for the same sub-assembly is added up across every entry of the run and turned into one component MO, level by level (the beams under the greige are pooled the same way). Demand is merged when it is the same item on the same sub-BOM and the same size; a sized sub-assembly gets one MO per size, and a component whose recipe differs per combo gets one MO per combo.',
            code:
`Run PR-SO-0123
  Fabric [NAVY]  1,000 kg ─┐
  Fabric [RED]     600 kg ─┼─► one Greige MO  (1,600 × 105% = 1,680 kg, less free stock)
  Fabric [BLACK]   400 kg ─┘        └─► one Warp Beam MO for that greige`,
            callout: {
                type: 'tip',
                text: 'The shared component MO carries no sales order of its own; its SO is traced through the root orders it feeds. Each root MO keeps its own colour, so finished goods are credited per colour.',
            },
        },
        {
            heading: 'Production Runs List',
            items: [
                'Filter by All SO / With SO / No SO and All Progress / 100% / Under 100%; search by code, style or BOM.',
                'Expand a run for Material Requirements: Req (fix) at full order qty (with what is still required after issues below it), Produced, Available (good stock only), Free (after other orders\' claims), Incoming (this run\'s own component MOs), Status and MOs.',
                'Status per line: SHORT (nothing on hand, nothing scheduled — needs action), NO WO (the producing MO has no work order yet), NOT STARTED, IN PROGRESS, DONE. The header flags SHORTFALL DETECTED and PRODUCTION x/y DONE.',
                'Print Material Pull Sheet — the store request for the run, sectioned by source location so each store sees only its own lines. It carries the customer, each product\'s sizes and quantities, and warp ends on beam lines.',
                'Deleting a run (⋯ menu) deletes its Manufacturing Orders with it.',
            ],
        },
        {
            heading: 'Manufacturing Orders',
            body: 'Production → Manufacturing Orders lists root orders (List or Calendar view). Expand one to see its order tree on the left — the root and every sub-assembly or shared component MO under it — and the selected order on the right, in two tabs: BOM & Stock and Work Order (n).',
            items: [
                'BOM & Stock: the recipe copied when the order was created (stock Low / Out flags per line), the Timeline (target vs. actual start and end), and Output: each lot produced with the input lots it consumed.',
                'Production Progress: Done, Reject and Yield, Planned (still open on work orders), Left (not yet covered by any WO), Over, and Max — the most that may be logged. The pencil sets the overdelivery tolerance for this order, or unlimited.',
                'Edit attributes (Pending orders only), Set / confirm color (Pending or In Progress; a colour still in lab dip blocks dyeing until it is approved or set), and Set putaway bin — where this order\'s output will be stored. The suggested bin follows the item\'s default putaway location, then a bin already holding the item, then an empty one.',
                'Print prints the SPK Produksi for the selected order.',
            ],
        },
        {
            heading: 'Manufacturing Order Status',
            steps: [
                'PENDING — created, nothing cut yet. Start (or cutting its first Work Order) moves it on. Starting never requires stock on hand: stock is checked when material is staged and consumed.',
                'IN_PROGRESS — work orders exist and output can be logged.',
                'DELIVERED — logged output has reached the order qty (allowing the weighing tolerance short). The order stays open: the floor can keep logging (spare beams, extra bags) up to the overdelivery limit, and the loom keeps running.',
                'COMPLETED — closed with Close Order. No more logging. Reopen returns it to IN_PROGRESS. Closing and reopening both need the close permission.',
                'CANCELLED — withdrawn; nothing more can be logged.',
            ],
            callout: {
                type: 'info',
                text: 'Finishing production does not make a sales order shippable. The sales order turns Ready only when packed cartons are in stock — see Packing & Dispatch.',
            },
        },
        {
            heading: 'Work Orders',
            body: 'Work orders are cut by hand from the MO\'s Work Order tab: + Add Work Order (routing step, machine, target qty, hours, dates, input and output locations, next destination "Tujuan"), or Plan Beaming to cut many BEAMING WOs at once (qty per beam, ends, repeat rows, notes / beam ID; the machine may be left blank so the WO is pegged to the group). A WO takes its locations from its machine, or from the machine\'s group or type when the machine has none. Cutting a DYEING WO needs an active dye recipe for the order\'s colour — see Dyeing & Setting.',
            items: [
                'Production → Work Orders lists every WO with tabs All / Beaming / Weaving / Dyeing / Setting / Others, and filters for status, work centre (type, group or machine), component and "Un-printed only" (Kartu Kerja or labels not yet printed).',
                'Target / Done shows each WO\'s progress bar. On bag-fed steps (dyeing, setting) staged lots not yet processed appear as a second segment, with "staged x" underneath, so a partly staged order never reads done.',
                'Expand a row for its info, locations, components and completion log, and to print bag or beam labels per entry or all at once.',
                'Print Selected bulk-prints Kartu Kerja cards (each with the WO\'s QR code). Card and Label chips on each row show what has been printed.',
                'Status menu: PENDING / IN PROGRESS / COMPLETED / CANCELLED, plus the staging state. Completing below target is allowed after a warning.',
                'Once output has been logged on a WO, its machine, routing step and locations are frozen — cancel it and cut a new one instead. A cancelled WO must be reopened before it can be edited.',
            ],
            callout: {
                type: 'info',
                text: 'A WO moves to IN_PROGRESS on its first logged output, and to COMPLETED automatically once its own logged output reaches its target qty (within the weighing tolerance); its loom run stops with it. WOs are independent: they can be logged in any order.',
            },
        },
        {
            heading: 'Staging Material to a Work Order',
            body: 'Stage moves a step\'s materials from their store to the WO\'s input location. Each material comes from its BOM-line source, else the item\'s default issue location. The staging state reads Not staged, Partially staged or Staged.',
            items: [
                'Staging moves whole lots — a 12.5 kg bag against a 12.4 kg step puts all 12.5 kg on the line. The excess is shown as a warning, never cut off.',
                'A staged lot is reserved to the WO it was staged to. Another WO sharing the same input location (for example the M and L sizes of one order on one machine) cannot consume it. Staging the same lot to another WO moves the claim; a completed or cancelled WO releases it.',
                'Return: a staged lot can be sent back to a store from the staging window. Only what is still physically on the line goes back.',
                'Scan-to-stage (Dyeing, Setting and Weaving WOs): scan the printed bag or beam labels with the camera or a scanner gun instead of picking lots. Bags stage in kg; beams are mounted on the loom.',
            ],
        },
        {
            heading: 'Warp Beams: Mount, Weave, Dismount',
            body: 'A warp beam is a lot (BM-…) that belongs to the loom, not to one WO. It is mounted once and feeds every WO that runs on that loom — size S, then M, then L — without re-staging.',
            steps: [
                'Mount — from the weaving WO\'s scan-to-stage, or from the loom\'s detail on the Weaving Monitor (Mount beam: search, type the code, fire a scanner gun or use the camera). Only beams in stock and on no other loom are offered.',
                'Weave — logging weaving output deducts warp from the mounted beams oldest-first; the operator never picks a beam. A beam that runs out is taken off the loom automatically.',
                'Dismount — every dismount is weigh-and-relot: strip the leftover warp, weigh it and choose where it goes. The weighed kg become a new LFT-… lot that any loom can mount later, the old beam is retired at 0, and any scale-vs-book difference is written off on the old beam. Entering 0 means nothing was left. The new lot\'s label (with its warp ends and yarn components) opens for printing right away. Available from Leftover on the WO row and from the Weaving Monitor.',
            ],
        },
        {
            heading: 'Logging Output (Completions)',
            body: 'Log (on a WO row or the MO\'s Work Order tab) records one output entry — typically one weighed bag or one beam.',
            items: [
                'Enter the qty, and optionally Cones, Boxes, Operator and Notes. The lot number (BM- beam, GRG- greige, DYE- dyed, SET- set, LOT- other) is generated, or type your own. Weaving, dyeing and setting output always gets a lot.',
                'Machine: pick the actual machine, limited to the WO\'s own group or type. Left blank it uses the WO\'s machine. Production reports and the Weaving Monitor count the output against this machine.',
                'Material Consumption: Planned, Actual and Variance per material. Actual defaults to output × BOM %, capped at what the picked lots hold (output that weighs more than its substrate, as dyeing adds weight, does not over-consume). Edit it, or add a substitute item.',
                'Lot-tracked materials need a lot picked. Lots scanned onto this WO are pre-ticked; lots staged to another WO are not offered. On dyeing and setting several bags can be ticked and the draw is spread oldest-first.',
                'Output goes to the MO\'s putaway bin if one is set, else the WO\'s output location.',
                'Overdelivery: a log that would take the order past qty + tolerance is refused; raise the tolerance on the MO to log more.',
                'After saving, the new bag\'s or beam\'s label opens for printing straight away.',
            ],
            callout: {
                type: 'tip',
                text: 'Weighing tolerance (Settings → General, company profile, default 2%): a step or order that weighs out this far under its target counts as met, so a 19 kg order logged at 18.8 kg still completes. The same tolerance applies when closing packing orders.',
            },
        },
        {
            heading: 'Labels and Production Printouts',
            table: {
                headers: ['Printout', 'Printed from', 'Carries'],
                rows: [
                    ['Kartu Kerja', 'Work Orders (row menu or Print Selected)', 'The WO card with its QR code, materials with their attributes, colour variant and code, combo and size'],
                    ['Bag label', 'After logging, or the WO row', 'Lot number and QR, current weight (BERAT, with the produced weight noted as Awal if the lot is empty), cone count, consumed components, size, colour and combo'],
                    ['Beam label', 'After logging a beam, or the WO row', 'Beam number, warp ends, components, and the destination machine (TUJUAN MESIN)'],
                    ['Lot label', 'After a beam dismount, or Inventory → Lot', 'Leftover lot number, weight, warp ends and the beam yarn components'],
                    ['SPK Produksi', 'Manufacturing Orders → Print', 'The MO sheet exploded from the order\'s copied recipe, with the size and its target, customer, machine, Toleransi and the Lebar / Tarikan / Panjang Tulisan / Bandul fields beside their mentah side'],
                    ['Material Pull Sheet', 'Production Runs → Print Material Pull Sheet', 'Store request per source location, customer, sizes and quantities, warp ends on beam lines'],
                ],
            },
            callout: {
                type: 'info',
                text: 'All of these layouts are edited under Administration → Print Layouts.',
            },
        },
        {
            heading: 'Work Queue — "What Can I Start Next?"',
            body: 'Production → Work Queue is the PIC\'s dispatch list: the open work orders of one work-centre type (chips across the top), in scheduled order, each with a material verdict. Stock is allocated in that order — the first order claims what it needs and the next one sees only what is left — so two orders sharing one greige pile never both read Ready. Material already staged is taken out of the pool first. Orders are dated by the WO\'s target start, then its target end, then the MO\'s dates, then the sales order due date, then creation date.',
            table: {
                headers: ['Verdict', 'Meaning'],
                rows: [
                    ['RUNNING', 'Already started on the floor'],
                    ['STAGED', 'Material is physically on the line — start any time'],
                    ['READY', 'Enough free stock is allocated to this order — stage it and go'],
                    ['PARTIAL', 'Some material is available, not all of it'],
                    ['WAITING UPSTREAM', 'The material is on a production order that has not finished yet'],
                    ['SHORT', 'No free stock and nothing incoming'],
                    ['NO MATERIALS', 'No BOM materials resolved for this step'],
                    ['NOT RELEASED', 'The MO exists but has no work order, so nobody can start it — cut the WO to release it. It still competes for stock with everyone else.'],
                ],
            },
            items: [
                'Columns: Work Order, Order / Item, Variant (colour swatch, combo and size chips), Work Centre, Qty, Gating Material, Need, Have, Scheduled, Verdict. WO and MO codes link to their pages.',
                'Sort By date or By readiness, or click Have to sort by how much of its gating material each order holds. Overdue shows only orders past their planned date and not yet started. Search by WO, order, item or variant.',
                'Expand a row for the material table: Required, Staged, Free pool, Allocated, Incoming, with each component\'s attributes as chips. Stock is matched per size and per variant.',
                'Material on hand (collapsible) shows the stock side of the same allocation: On hand, Claimed, Free, Short, Orders and Lots per material.',
                'Only the step\'s main material decides the verdict — greige for dyeing, yarn for warping, mounted beams (counted against the loom\'s beam slots) for weaving. Short auxiliary chemicals are flagged on the row but never block it.',
                'The queue is read-only: stage, mount and log from Work Orders or the scanner.',
            ],
        },
        {
            heading: 'Weaving Monitor',
            body: 'Production → Weaving Monitor shows every loom as a card, grouped by work-centre group, with each group\'s running count, below-target and late counts and average efficiency in its header. Filter by group or "running only". Export Excel (title bar) downloads the looms the filter shows, one row per run with its efficiency, kg, due date and projected completion.',
            items: [
                'Loom steps: idle → staged (warp mounted) → Draw-in → Tuning → running. Draw-in and Tuning are confirmed by hand (Undo step reverses a mis-click); Start Run is allowed only after both. Taking the warp off drops the loom back to idle.',
                'Start Run: pick the WO on that machine (or an MO), lines, rate (g/min/line) and target efficiency %. A loom can run several WOs side by side, one run each. Runs can be paused (paused days are excluded), resumed and stopped; a run stops by itself when its WO is completed or cancelled.',
                'Target per day = 24 h × rate per line × lines. Efficiency = actual output ÷ (target per day × fully elapsed working days). Actual output is read from logged completions on that machine.',
                'Projected completion is worked out from the WO qty and compared with the WO due date; a late projection is flagged with a hint to add a machine or working days.',
                'Click a card for the loom\'s detail: performance, run history, beams on the loom (mount and dismount) and its calendar.',
                'Calendar: working weekdays per machine or per group, plus holidays; Import holidays loads Indonesian national holidays. A working day counts as 24 h (three shifts).',
            ],
            callout: {
                type: 'info',
                text: 'The Dyeing Monitor sits beside it under Production and works the same way for dye vessels — see Dyeing & Setting.',
            },
        },
        {
            heading: 'Scanning on the Floor',
            body: 'Every Kartu Kerja carries the WO\'s QR code. Scanning it at QUICK SCAN (the scanner) on a phone opens that WO\'s log form — quantity, lots to consume and materials used; on a desktop the scan terminal shows the WO and lets you start or complete it. The same scanner also takes pick-list, carton and packing-order codes and routes each to its own screen.',
        },
        {
            heading: 'Sales Order Traceability',
            body: 'A run created from a sales order carries that order\'s code to its MOs and the lots they produce, shown as SO badges on Production Runs, Manufacturing Orders and Inventory → Lot. The sales order\'s Lineage view traces SO → Production Run → MO → WO → beam.',
        },
    ],
};
