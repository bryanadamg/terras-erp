import { DocPage } from '../docsContent';

export const purchasePage: DocPage = {
    slug: 'purchase',
    title: 'Purchase Orders',
    subtitle: 'Manage supplier orders and goods receipts to replenish inventory.',
    badges: ['Suppliers', 'PO', 'Goods Receipt', 'Auto Stock Update'],
    sections: [
        {
            heading: 'Suppliers (Partners)',
            body: 'Suppliers are managed under the Partners module alongside customers. Each supplier record holds the company name, contact person, address, phone, and email. A partner can act as both a customer and a supplier.',
        },
        {
            heading: 'Creating a Purchase Order',
            body: 'A Purchase Order (PO) is raised to a supplier for specific items and quantities. The PO header contains the supplier, order date, and expected delivery date. Line items reference the inventory catalogue so that receipts automatically update the correct item balances.',
        },
        {
            heading: 'Goods Receipt',
            body: 'When goods arrive, you record a receipt against the Purchase Order. Each line can be received in full or partially. The receipt creates stock ledger entries (of type Receipt) and atomically updates the `stock_balances` table for the received items at the designated target location.',
        },
        {
            heading: 'Automated Stock Update',
            body: 'The one-click "Receive" workflow removes the need for a separate stock entry step. Receiving a PO line immediately increments the item balance at the specified warehouse location, making the stock available for production and fulfilment instantly.',
        },
        {
            heading: 'Order Statuses',
            items: [
                'Draft — being prepared, not yet sent to supplier',
                'Sent — issued to supplier; awaiting delivery',
                'Partially Received — some lines received, remainder outstanding',
                'Received — all lines received and closed',
                'Cancelled — withdrawn before receipt',
            ],
        },
        {
            heading: 'Print Templates',
            body: 'Each Purchase Order has an A4 print template with the supplier\'s name and address (auto-resolved from the partner record), all line items with descriptions and quantities, and order totals. Suitable for emailing or printing for supplier acknowledgement.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Create and manage supplier (partner) records',
                'Raise Purchase Orders with multiple line items',
                'Record full or partial goods receipts against PO lines',
                'Auto-update stock balances at the target location on receipt',
                'Track PO status from Draft through to fully Received',
                'Print purchase order documents for supplier confirmation',
            ],
        },
    ],
};
