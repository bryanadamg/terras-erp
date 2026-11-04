import { DocPage } from '../docsContent';

export const purchasePage: DocPage = {
    slug: 'purchase',
    title: 'Purchase Orders',
    subtitle: 'Order from suppliers, receive the goods into a warehouse and print the PO, from Procurement → Purchase Orders and Procurement → Suppliers.',
    badges: ['Suppliers', 'Purchase Orders', 'Goods Receipt', 'Supplier Lots', 'Surat Jalan', 'PO Print'],
    sections: [
        {
            heading: 'Suppliers',
            body: 'Procurement → Suppliers is the supplier directory. It works the same way as Sales → Customers, but each record belongs to one list only: a company you both buy from and sell to needs a supplier record and a customer record.',
            items: [
                'Fields: Name, Address, Contact Person (the Attn printed on the PO), Phone / Telp, Fax and Email. The PO print takes all of them from this record.',
                'The list shows 25 suppliers per page with Name, Contact (person and phone), Email, Address and Status. The search box matches name, contact person, phone, email and address.',
                'Edit a supplier to untick Active. Inactive suppliers stay in the list and on old POs, but you can\'t pick them on a new PO.',
                'Tick rows to delete several suppliers at once. A supplier that is used on purchase orders or other records can\'t be deleted, and the message tells you how many were removed and how many were kept. Mark it inactive instead.',
                'The status bar counts the whole directory (total and active), not just the page or search result.',
                'Create, edit and delete are separate permissions, so a role can be allowed to add suppliers without being able to remove them.',
            ],
        },
        {
            heading: 'The Purchase Order List',
            body: 'Procurement → Purchase Orders lists every PO, newest first. Search by PO number or supplier name, and filter with the status chips (All, Draft, Receiving, Received). The chip counts cover every PO in the system, not just the page you\'re on.',
            table: {
                headers: ['Column', 'What it shows'],
                rows: [
                    ['**Received**', 'Progress bar plus "lines fully received / total lines". The percentage is weighted by line value (qty × price), so a cheap line in cones doesn\'t count as much as an expensive line in kg. When no line has a price, it falls back to the share of lines received.'],
                    ['**Total**', 'Sum of qty × unit price over all lines, in Rupiah.'],
                    ['**Status**', 'Draft, Receiving or Received. A Receiving PO also shows "Nd overdue" in red when a line that is still short has passed its Expected By date.'],
                    ['**Expand (▸)**', 'Order Lines (received vs ordered, full or short) and the Receipt History.'],
                ],
            },
            callout: {
                type: 'tip',
                text: 'The green arrow button on a row opens Receive Goods. The ⋯ menu holds Edit (Draft only), Close PO (short-received), Print and Delete.',
            },
        },
        {
            heading: 'Creating a Purchase Order',
            steps: [
                'Click Create. A PO number is suggested from your numbering pattern (gear icon next to the field: prefix, year, month, counter). You can overwrite it. If the number is already taken, the save is refused and the next free suffix is suggested.',
                'Pick the Supplier (active suppliers only), the Date and the Receiving Warehouse. The warehouse becomes the default for every receipt against this PO.',
                'Fill in the Document Details that print on the PO: SSN, Rate Variant (Kurs Pajak or KTBI, plus its value), Code, Payment term, Category, VAT % (untick Include for a PO with no VAT line; 11% by default), Discount (Rp) and Notes.',
                'Add lines: search for the item, enter Qty, Price (Rp) and an optional Expected By date, and pick variant values (for example colour) for items that have attributes, or leave them on Any. You can edit the qty of an added line in place.',
                'Save. The PO starts as Draft.',
            ],
            callout: {
                type: 'info',
                text: 'Only a Draft PO can be edited. Once the first goods are received the PO is locked, so it always matches what was booked into stock.',
            },
        },
        {
            heading: 'Status Flow',
            table: {
                headers: ['Status', 'Meaning'],
                rows: [
                    ['**Draft**', 'Created and editable. Nothing has been received yet.'],
                    ['**Receiving**', 'At least one receipt has been booked, but some line is still short.'],
                    ['**Received**', 'Every line has received its ordered qty, or the PO was closed short.'],
                ],
            },
            body: 'Close PO (short-received) in the ⋯ menu marks a Draft or Receiving PO as Received when the supplier won\'t deliver the rest. The short lines keep their actual received qty, and the close is recorded in the audit log.',
        },
        {
            heading: 'Receiving Goods',
            body: 'One receipt is one delivery. Click the green arrow on the PO row and fill in the Receive Goods form:',
            items: [
                'Receipt Date (today by default), Receiving Warehouse (defaults to the PO\'s warehouse and can be changed per delivery; it is required) and Notes, e.g. "short delivery, weighed on arrival".',
                'Delivery Note No. (the supplier\'s Surat Jalan number, free text), Delivery Note Date (the date on the note, which can differ from the receipt date) and an optional scan of the note as a PDF or image.',
                'For each line, This Receipt starts blank. Type only what actually arrived and leave lines that didn\'t come empty. You can see Ordered and Rcvd So Far beside it.',
                'Packaging counts: Boxes on any line, Cones on raw-material (yarn) lines, Drums on chemical and dye lines. They are added to the stock\'s packaging counts.',
                'Lot No. is the supplier\'s lot number. It is required for lot-tracked items and optional for the rest.',
            ],
            callout: {
                type: 'warning',
                text: 'Confirm Receipt posts the stock straight away. The received qty is added at the receiving warehouse (as a Goods Receipt movement in the Stock Ledger) and is available to production and sales from that moment. There is no separate stock-entry step.',
            },
        },
        {
            heading: 'Supplier Lots',
            body: 'When a supplier lot number is entered, the receipt books the stock into a lot. If the same supplier has delivered the same lot number for the same item before (and that lot is still graded Good), the new qty is added to that existing lot instead of creating a second one. Otherwise a new internal lot numbered GR-<date>-<code> is created and carries the supplier lot alongside it. In stock screens the supplier lot shows as a SUP chip next to the internal lot.',
        },
        {
            heading: 'Receipt History',
            body: 'Expanding a PO lists every delivered line as its own row, oldest first: date, DN number with a paperclip link that opens the attached Surat Jalan scan, item, qty received with its unit, and Boxes, Cones, Drums, Supplier Lot and Notes. Those last columns only appear when at least one receipt on the PO used them.',
        },
        {
            heading: 'Printing the PO',
            body: 'Choose Print in the ⋯ menu. The preview shows the PO exactly as it will print.',
            items: [
                'The supplier block (company, Attn, address, telp, fax, email) comes from the supplier record. The document fields, prices, VAT and discount come from the PO itself. Fix them there, not in the print screen.',
                'Only the rate you chose prints: Kurs Pajak on a Kurs Pajak PO, KTBI on a KTBI PO. The VAT line is left out when the PO has no VAT.',
                'Type the Prepared by, Examined by and Approved by names and tick or untick Footer Notes. These are remembered for your next print.',
                'Paper size, margins and the layout itself are a print template that an admin edits in Administration → Print Layouts.',
            ],
        },
    ],
};
