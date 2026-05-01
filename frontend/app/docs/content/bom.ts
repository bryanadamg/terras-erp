import { DocPage } from '../docsContent';

export const bomPage: DocPage = {
    slug: 'bom',
    title: 'BOM Designer',
    subtitle: 'Build recursive, multi-level Bills of Materials for any manufactured product.',
    badges: ['Recursive BOM', 'Assemblies', 'Routing', 'Percentage Qty', 'Automator'],
    sections: [
        {
            heading: 'What is a BOM?',
            body: 'A Bill of Materials (BOM) defines the components and sub-assemblies required to manufacture a finished product. Teras ERP supports recursive BOMs — a component can itself have a BOM, enabling multi-level assembly trees of arbitrary depth. The designer renders the full tree structure with expand/collapse navigation.',
        },
        {
            heading: 'Creating a BOM',
            body: 'Navigate to BOM Designer and click New BOM. Select the finished good item, set the output quantity, and begin adding component lines. Each line references an item (with optional variant), a quantity, and a unit of measure. The BOM automatically inherits attribute values from the parent finished good item to its child lines.',
        },
        {
            heading: 'Percentage-Based Quantities',
            body: 'Component quantities can be expressed as a percentage of the parent item\'s output quantity instead of a fixed value. This is useful for recipes where input ratios are fixed regardless of batch size. Validation enforces that the percentages of all components at each node level sum to exactly 100%.',
        },
        {
            heading: 'Wastage Tolerances',
            body: 'Each BOM line can have a wastage tolerance specified as a percentage. This defines the acceptable over-consumption of that component during production. Tolerance values are used by the Smart Advisor to calculate material coverage ranges.',
        },
        {
            heading: 'Inline Editing',
            body: 'Quantity and percentage values are directly editable in the BOM tree view — no separate modal is required. Click any quantity or percentage cell to edit it in place. Changes are saved on blur or Enter.',
        },
        {
            heading: 'Root-Only Filter',
            body: 'The BOM list view has a "Root Only" toggle that filters the list to show only top-level finished goods BOMs, hiding intermediate sub-assembly BOMs. This keeps the list manageable when many sub-assemblies are defined.',
        },
        {
            heading: 'Print at Any Level',
            body: 'Any node in a BOM tree can be printed as a standalone A4 BOM sheet. The printout includes the selected node as the root, its direct components, quantities, and routing steps. This allows shop floor operators to have targeted, level-specific production sheets rather than printing the entire tree.',
        },
        {
            heading: 'Routing',
            body: 'Each BOM can include a routing — an ordered list of manufacturing operations (e.g. "Cut", "Sew", "QC", "Pack"). Routing steps are defined under Settings → Routing and reference work centres. Routing steps appear on printed work orders and are used by the MES interface for operation-level tracking.',
        },
        {
            heading: 'BOM Automator',
            body: 'The BOM Automator is a wizard that analyses a Manufacturing Order\'s BOM tree and automatically generates child Work Orders for every sub-assembly level. It matches the component attribute values to the correct child BOMs and creates a linked MO hierarchy in a single operation. This eliminates the need to manually create sub-assembly orders one by one.',
        },
        {
            heading: 'Attribute Inheritance',
            body: 'When a finished goods item has attributes (e.g. Colour, Size), the BOM Designer propagates those attribute values down to relevant component lines. For example, if you are producing a "Blue / Large" shirt, the fabric component line will automatically filter to the "Blue" variant of the fabric item.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Create and manage BOMs for finished goods and sub-assemblies',
                'Add components with fixed quantities or percentage-based ratios',
                'Set wastage tolerances per component line',
                'Edit quantities and percentages inline without opening a modal',
                'Toggle root-only view to hide sub-assembly BOMs from the list',
                'Print a BOM sheet for any level of the assembly tree',
                'Attach routing steps with work centre assignments',
                'Run the BOM Automator to generate child Work Orders for all sub-assembly levels',
            ],
        },
    ],
};
