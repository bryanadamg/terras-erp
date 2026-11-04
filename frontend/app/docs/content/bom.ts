import { DocPage } from '../docsContent';

export const bomPage: DocPage = {
    slug: 'bom',
    title: 'BOM & Routing',
    subtitle: 'Engineering → BOM and Engineering → Routing: the recipes every order is made from, and the work-centre tree they run on.',
    badges: ['Multi-level BOM', 'Sizes', 'Combo Variants', 'Routing Steps', 'MRP Planning', 'Work Centres', 'BOM Automator'],
    sections: [
        {
            heading: 'What a BOM Is',
            body: 'A Bill of Materials (BOM) is the recipe for one item: what goes into it, in what proportion, at which routing step, and on which sizes. BOMs are multi-level — a component can have its own BOM (greige under a dyed fabric, a warp beam under the greige, yarn under the beam), and the designer shows the whole tree at once. When a Production Run or Manufacturing Order is created, it copies (snapshots) the BOM lines, so editing a BOM later never changes orders already on the floor.',
        },
        {
            heading: 'The BOM List',
            items: [
                'Engineering → BOM lists every recipe. Toggle Root BOMs (finished goods only) or All BOMs (sub-assemblies included); search by code or item.',
                'Expand a row to read BOM Details: code, variant, customer, machine, wastage and overdelivery %, components with their required qty and warp ends, Detail Teknis, Measurements and Size Measurements (target / min / max).',
                'Icons on each row flag what a recipe carries: components, warp ends (utas), batch output, sized BOM, weaving/textile spec.',
                'Print BOM prints the BOM sheet; its layout is edited under Administration → Print Layouts.',
                'The ⋯ menu holds Edit and Delete.',
            ],
        },
        {
            heading: 'The BOM Designer',
            body: 'Create Recipe (or Edit) opens the designer: the Structure tree on the left, the selected node\'s editor on the right. Selecting a node in the tree edits that level\'s BOM; the whole tree is saved together.',
            items: [
                'BOM Header — BOM Code (the gear on the root sets the code pattern), Finished Item, Batch Size (shown as Warp Ends (Utas) on a beam node), Wastage %, Overdelivery %, the item\'s attributes (e.g. Combo), Customer and Machine.',
                'Measurements (cm) — the sizes this recipe makes (see Sizes below).',
                'Detail Teknis — Kerapatan / Picks, Sisir no., Pemakaian Obat U/ Setting, sample maker, Berat Bahan Mateng and Berat Bahan Mentah; plus a product sample photo and a Design / Susunan Rumusan file.',
                'Bahan Keluar Dari Mesin (Lebar, Panjang Tulisan, Panjang Tarikan, Tarikan Bandul 1 kg / 9 kg) and Bahan Dari Celup / Setting — the greige-side and finished-side specs printed side by side on the SPK Produksi.',
                'Components — the material lines (see Component Lines below). Re-apply to children copies the current node\'s fields down to every child BOM.',
                'Routing Steps — sequence, work centre and operation type for each step of the process.',
                'Node badges: Existing Recipe (the item already has a BOM for this variant), New Inventory Record (saving will create the item), Shared Recipe (an existing BOM reused here — shown read-only and never overwritten; open that BOM to change it).',
                'Saving shows a confirmation listing every node and whether it will be created, updated or skipped, plus any new items that will be created along the way.',
            ],
        },
        {
            heading: 'Component Lines',
            body: 'Each component line names an item and how much of it is needed. Two ways of stating the quantity:',
            columns: [
                {
                    label: 'Percentage (%)',
                    items: [
                        'Quantity is a % of the parent\'s output: 1,000 kg of fabric with greige at 105% needs 1,050 kg of greige.',
                        'If the component has its own active BOM, it is made, not bought: planning creates a component Manufacturing Order for it (unless stock covers it — see MRP netting on the Manufacturing page).',
                        'When output is logged, the component is deducted automatically as output × %. The operator can correct the actual figure on the log.',
                    ],
                },
                {
                    label: 'Fixed Qty (Qty / Ends)',
                    items: [
                        'Quantity per unit of the parent\'s output; it scales with the order qty and is what staging asks for.',
                        'On a beam node the column reads Ends: the warp ends each yarn contributes to the beam.',
                        'It does not create a component order, and it is not auto-deducted when output is logged: the operator enters the qty actually used on the log.',
                    ],
                },
            ],
        },
        {
            heading: 'Per-Line Settings',
            table: {
                headers: ['Setting', 'Options', 'What it does'],
                rows: [
                    ['Step', 'A routing step, or Any step', 'The routing step that consumes this material. A Work Order cut for that step stages and consumes only its own step\'s materials; a WO with no step uses the whole recipe.'],
                    ['MRP planning', 'Auto (inherit) / Pool (MTS) / Make here', 'Auto follows the item master\'s setting. Pool (make-to-stock) records the demand but creates no component order inside the run — replenish it on a separate pooled order. Make here always creates the component order inside the run, even for a make-to-stock item.'],
                    ['Combo', 'Inherited from the parent', 'A combo on the line makes each combo of the component its own recipe and its own component order. A component whose recipe has no combo is pooled across all combos.'],
                ],
            },
        },
        {
            heading: 'Sizes',
            body: 'The Measurements panel has two modes: sized (pick a standard size and give its Target, Min and Max in cm) or free labels (type your own label with the same three figures). A sized BOM plans one Manufacturing Order per size that has a quantity; sizes left at 0 are skipped. Everywhere a size appears — chips, run inputs, labels, SPK, Kartu Kerja, packing and Surat Jalan — it reads {size}-{target} ({min}-{max}), for example L-72 (70-74).',
            callout: {
                type: 'info',
                text: 'Sizes and stock are matched by size name across the whole chain. A sales order can order sizes before a recipe is chosen; the sizes are mapped onto the BOM picked on the Production Run. A size range filled in on the BOM after its orders were cut still reaches those orders and their lots.',
            },
        },
        {
            heading: 'Variants: Combos and Colours',
            body: 'A BOM can carry attribute values from the item (for example Combo = Navy Stripe). An item may have one BOM per combo plus a combo-less recipe shared by all combos; planning picks the recipe matching the order\'s combo, and falls back to the shared one. Colour for dyed goods is not a separate BOM: the Color Code is chosen on the sales order or on the Production Run, the same greige BOM is used for every colour, and the dye chemicals come from the dye recipe (Kartu Celup) matched to that colour — see Dyeing & Setting.',
            code:
`BOM-FAB  → Fabric (any colour)       chosen colour: Color Code on SO / run
  └─ Greige      105%                 [one shared greige BOM for every colour]

BOM-GRG  → Greige
  ├─ Warp Beam   60%                  [sub-assembly — has its own BOM]
  └─ Weft Yarn   42%

BOM-BM   → Warp Beam  (Warp Ends 4,800)
  └─ Yarn 30s    Ends 4,800           [warp ends per yarn]`,
        },
        {
            heading: 'Tolerances',
            table: {
                headers: ['Field', 'Side', 'Effect'],
                rows: [
                    ['Wastage %', 'Input', 'Inflates every component requirement in availability checks and material planning, to cover expected process loss. Printed as Toleransi on the SPK.'],
                    ['Overdelivery %', 'Output', 'How far past the order qty the floor may log output. Copied onto every new MO and editable per order on the MO. Beam orders have no ceiling.'],
                ],
            },
        },
        {
            heading: 'BOM Automator',
            body: 'Automate All Levels (under the Structure tree, root node selected) builds the sub-assembly levels of a new BOM tree for you. Each Processing Level is one tier of child BOM nodes, named from a pattern such as "WIP CBG {CODE}" where {CODE} is the root code; + Add branching item adds sibling nodes on the same level. Children get no attribute values unless "Inherit attributes from root" is ticked on that level. The Structure Preview shows the result before it is applied, and a level layout can be saved as a named profile (profiles are personal) and reused. The Automator only builds BOM nodes — it creates no orders.',
        },
        {
            heading: 'Routing: the Work-Centre Tree',
            body: 'Engineering → Routing has two tabs: Work Centers and Standard Operations. Work centres form a three-level tree:',
            table: {
                headers: ['Level', 'Example', 'Used for'],
                rows: [
                    ['Type (root)', 'WEAVING, DYEING', 'A process family. Its Type (GENERAL, BEAMING, WARPING, WEAVING, DYEING, SETTING, FINISHING, CUTTING, PACKING) decides which Work Order tab, Work Queue and monitor its machines appear in.'],
                    ['Group (optional)', 'Loom Hall A', 'A bank of machines. Set one production calendar and one set of locations for all of them at once.'],
                    ['Machine', 'Loom 07', 'A physical station. Work orders, BOM routing steps and the monitors point at machines.'],
                ],
            },
            items: [
                'Input Location — where a step\'s materials are staged and consumed from. Output Location — where its output is put away. Reject Location — the defect store for QC-rejected output from that centre.',
                'Locations cascade down: a machine left blank uses its group\'s, then its type\'s. Each field cascades on its own, so a loom can override only its output and still use the hall\'s defect store.',
                'Beam Slots (weaving machines) — the number of beam positions on the loom. A weaving Work Order is beam-ready when that many beams are mounted.',
                'Standard Operations — the operation types (code + name, e.g. OP-10 Cutting) that BOM routing steps refer to.',
                'Filtering the Work Order list by a type or group, and the production reports, take in the whole subtree, so a machine sitting directly under a type and one inside a group are both counted.',
            ],
        },
        {
            heading: 'Key Actions',
            items: [
                'Design a multi-level recipe in one tree and save it with a create/update/skip preview',
                'Use % lines for made components and fixed-qty / Ends lines for per-unit materials and warp yarn',
                'Assign each material to the routing step that consumes it',
                'Choose Auto / Pool / Make here per line to control whether a component order is created inside a run',
                'Define sizes with target and range so one run creates one order per size',
                'Keep one greige recipe for every colour; give a combo its own recipe only when the combo changes the construction',
                'Set wastage (input) and overdelivery (output) tolerances independently',
                'Build sub-assembly levels quickly with the BOM Automator and saved profiles',
                'Maintain the TYPE → GROUP → MACHINE tree with inherited input, output and reject locations',
            ],
        },
    ],
};
