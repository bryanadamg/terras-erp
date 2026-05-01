import { DocPage } from '../docsContent';

export const salesOrdersPage: DocPage = {
    slug: 'sales-orders',
    title: 'Sales Orders',
    subtitle: 'Capture and manage customer demand from creation through fulfilment.',
    badges: ['Customers', 'Orders', 'Variants', 'BOM Link', 'Produce-to-Order'],
    sections: [
        {
            heading: 'Customers (Partners)',
            body: 'Customers are managed under the Partners module. Each customer record holds the company name, contact person, address, phone, email, and order history. The same Partners directory is shared with Suppliers — a record can be both a customer and a supplier.',
        },
        {
            heading: 'Creating a Sales Order',
            body: 'A Sales Order (SO) captures what a customer wants, in what quantities, at what price, and by when. The SO header contains the customer, order date, and expected delivery date. Each line item references a specific item from the inventory catalogue.',
        },
        {
            heading: 'Variant & Size Selection',
            body: 'When adding a line item, if the selected item has attributes (e.g. Colour, Size), a size/variant selector appears. The SO line records the specific variant requested by the customer. This variant is passed through to any Manufacturing Order created from that line, ensuring the correct variant is produced.',
        },
        {
            heading: 'BOM Link',
            body: 'Each SO line can be linked to a specific BOM. When the "Produce" button is clicked for that line, the system creates a Manufacturing Order pre-populated with the linked BOM, the requested variant, and the ordered quantity. This creates a direct traceability chain from customer order to production.',
        },
        {
            heading: 'Produce-to-Order',
            body: 'The SO view shows an individual "Produce" button for each line item. Clicking it opens an MO creation modal pre-filled with the line\'s item, variant, quantity, and BOM link. This allows selective production — you can produce line 1 now and line 2 later — without creating the entire SO\'s production at once.',
        },
        {
            heading: 'Order Statuses',
            items: [
                'Draft — being prepared, not yet confirmed',
                'Confirmed — accepted; lines are locked for fulfilment tracking',
                'Partially Fulfilled — some lines have been shipped',
                'Fulfilled — all lines shipped and closed',
                'Cancelled — withdrawn before fulfilment',
            ],
        },
        {
            heading: 'Print Templates',
            body: 'Each Sales Order has an A4 print template that includes the customer\'s name and address (auto-resolved from the partner record), all line items with variant specifications, quantities, prices, and totals. A full SO table printout is also available for batch summaries.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Create and manage customer (partner) records',
                'Raise Sales Orders with multiple line items',
                'Select size/variant per line when applicable',
                'Link each SO line to a specific BOM for produce-to-order',
                'Click the per-line "Produce" button to create a linked Manufacturing Order',
                'Track fulfilment status at the order and line level',
                'Print individual SO documents or batch table summaries',
            ],
        },
    ],
};
