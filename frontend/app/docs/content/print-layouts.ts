import { DocPage } from '../docsContent';

export const printLayoutsPage: DocPage = {
    slug: 'print-layouts',
    title: 'Print Layouts',
    subtitle: 'Design the printed documents, cards and labels yourself: which fields appear, where, how big, and on what paper.',
    badges: ['Print Designer', 'Templates', 'Labels', 'Letterhead', 'Test Print'],
    sections: [
        {
            heading: 'What Print Layouts is for',
            body: 'Administration → Print Layouts is the print designer. Every document listed below prints from a layout you can change here without any programming. A saved layout is company-wide: every workstation uses it from the moment it is saved. A document nobody has edited uses its built-in design, and a chip next to the document picker says Customised or Built-in default.',
            items: [
                'Opening the designer needs the print_layout.edit permission.',
                'If a saved layout is ever damaged, printing falls back to the built-in design, so the floor can always print.',
                'Company name, logo, address, phone, email and Tax ID come from Settings → General → Company Profile. Change them there, not in each layout.',
            ],
        },
        {
            heading: 'Documents you can design',
            table: {
                headers: ['Document (as named in the designer)', 'Printed from'],
                rows: [
                    ['**Kartu Kerja — Weaving / Tenun**', 'Work orders on a weaving work centre'],
                    ['**Kartu Kerja — Beaming**', 'Work orders on a beaming work centre'],
                    ['**Kartu Kerja — Dyeing / Celup**', 'Work orders on a dyeing work centre'],
                    ['**Kartu Kerja — General (Warping / Setting / Finishing)**', 'Work orders on any other work centre'],
                    ['**SPK Produksi (manufacturing order)**', 'Production → Manufacturing Orders'],
                    ['**Material Pull Sheet (production run)**', 'Production → Production Runs'],
                    ['**Bill of Materials**', 'Engineering → BOM'],
                    ['**Kartu Celup (dye recipe)**', 'Dyeing & Setting → Dye Recipes and Dyeing Orders'],
                    ['**Bag output label**', 'Work order log entries and Inventory → Lot'],
                    ['**Warp beam label**', 'Beaming work order log entries and Inventory → Lot'],
                    ['**Lot label**', 'Inventory → Lot, beam staging and leftover beams'],
                    ['**Kartu Packing (packing order card)**', 'Warehouse → Packing Orders'],
                    ['**Carton label**', 'Warehouse → Packing Orders and Inventory → Lot'],
                    ['**Kartu Picking (pick list card)**', 'Warehouse → Pick Lists'],
                    ['**Surat Jalan (delivery note)**', 'Warehouse → Dispatch'],
                    ['**Sales Order Confirmation**', 'Sales → Sales Orders (one order)'],
                    ['**Sales Order table report**', 'Sales → Sales Orders (the list)'],
                    ['**Purchase Order**', 'Procurement → Purchase Orders'],
                    ['**SPK Sample**', 'Sales → Sample Requests'],
                    ['**Stock Ledger report**', 'Reports → Stock Ledger'],
                ],
            },
            callout: { type: 'info', text: 'Which Kartu Kerja a work order prints is decided by the type of its work centre, so a weaving loom always prints the Weaving / Tenun card.' },
        },
        {
            heading: 'Designing a layout',
            steps: [
                'Pick the document in the toolbar.',
                'Pick a record to preview it with. The list holds recent real records (shipments, purchase orders, lots, and so on). For a Kartu Kerja you pick a work order; if no work order currently routes to that card type, the preview borrows another one, so the values look wrong but the layout is still right.',
                'Change the layout: select a section on the left, edit it in the inspector on the right, or drag things on the paper.',
                'Click Test print to print the unsaved draft on real paper. This checks how your printer\'s margins treat it, and nothing is marked as printed.',
                'Click Save layout. Until then the toolbar shows Unsaved, and Revert drops your changes.',
            ],
            items: [
                'Undo and Redo are in the toolbar and on Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y). One drag is one undo step.',
                'Switching to another document with unsaved changes asks before discarding them.',
                'Reset to default deletes your saved layout for that document and brings back the built-in design. It cannot be undone.',
            ],
        },
        {
            heading: 'Opening the designer from a print preview',
            body: 'If you hold print_layout.edit, print previews of these documents show an Edit layout button. It closes the preview and opens the designer on that document, previewing the very record you were about to print. Fix what was wrong, save, and print again.',
        },
        {
            heading: 'Sections',
            body: 'A layout is a stack of sections printed top to bottom. The left pane lists them by what they contain. The add button inserts a new section after the selected one. Each section can be hidden (it stays in the layout, so showing it again loses nothing), moved up or down, duplicated with its design, or deleted. Every section can have a small caption above it and a frame: border, rule above, rule below and padding.',
            table: {
                headers: ['Section type', 'Use it for'],
                rows: [
                    ['**Grid**', 'Placing fields freely on a 12-column grid: headers, the big machine name, metric boxes, QR codes. A cell can hold one field or a stack of fields.'],
                    ['**Label / value**', 'Rows of label and value. Boxed grid (shaded label cells) for cards, or plain "Label : value" lines for a letterhead. A narrowed block width makes a totals box that sits to one side.'],
                    ['**Data table**', 'Rows from the document: order lines, BOM components, cartons, ledger movements. Choose and size the columns, add a footer cell under any column (for a total), pad with blank rows for hand notes, stripe every second row, and set the message printed when there are no rows.'],
                    ['**Hand fill-in**', 'Blank grids the operator writes on: numbered boxes, or columns with headings, with an optional Jumlah / Total row.'],
                    ['**Signatures**', 'A signing line with the caption under it, or equal columns with the caption on top (the "Hormat Kami" block of a delivery note).'],
                    ['**Spacer**', 'Empty space that pushes later sections down to the bottom of the page.'],
                ],
            },
            callout: { type: 'tip', text: 'Long tables run onto the next page by themselves: each row is kept whole and the heading row is repeated at the top of every page.' },
        },
        {
            heading: 'Fields',
            body: 'The field list beside the paper shows every field the document can carry, grouped and searchable. Click a field to add it to the selected section. Fields already on the layout stay listed but dimmed, because one field may appear twice (a code in the header and again in the footer).',
            items: [
                'Per field: font size, bold, monospace, serif, letter spacing, uppercase, alignment and colour.',
                'A small caption label above the value, with your own label text if the default does not suit.',
                'A prefix before the value ("No : "), a unit after it, the text printed when the value is empty (or nothing), hide-when-empty, and a maximum number of lines.',
                'Text (type your own) prints fixed wording. Blank (hand fill-in) leaves a line to write on.',
                'QR codes have a size, a caption and an optional frame. Images such as the company logo have a height.',
            ],
        },
        {
            heading: 'Letterhead, barcodes and QR codes',
            items: [
                'Letterhead fields (company logo, name, address, phone, email) can be placed on any document.',
                'The Purchase Order offers a decorative PO-number barcode. It is for appearance only, not for scanning.',
                'Labels carry real scannable codes: a QR and a Code 128 barcode of the lot number on bag, beam and lot labels, and of the carton number on carton labels. The Kartu Kerja and Kartu Packing carry the QR code that QUICK SCAN reads to log production.',
            ],
        },
        {
            heading: 'Paper, type and the canvas',
            items: [
                'Paper: A4, A5, A6 or Custom (width and height in mm), portrait or landscape.',
                'Page margin is the area the printer cannot reach. Inner padding is extra breathing room inside it.',
                'Base font for the whole document: Arial, Times New Roman, Tahoma or Courier New.',
                'On the paper, drag a cell\'s grip to move it and its edge to resize it. Press Escape to cancel a drag.',
                'Zoom in and out, click the percentage to return to true size, or Fit to fit the sheet in the pane. Handles normally show only on the section under the pointer; a toggle shows them all at once.',
            ],
        },
        {
            heading: 'Things the data decides',
            body: 'Some styling comes from the record rather than the layout, so you do not have to design it: a shortfall can print in red, and a pull sheet groups its rows under a full-width heading per location. When a single print run mixes documents, such as bag and beam labels from one batch of log entries, each sheet prints in its own layout and in the original order.',
        },
    ],
};
