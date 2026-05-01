import { DocPage } from '../docsContent';

export const samplesPage: DocPage = {
    slug: 'samples',
    title: 'Samples & PLM',
    subtitle: 'Manage the product lifecycle for new product development — from sample requests through to approved production.',
    badges: ['Sample Requests', 'PLM', 'Approval Workflow', 'Design Attachments'],
    sections: [
        {
            heading: 'Overview',
            body: 'The Samples & PLM module supports the prototype-to-production workflow. When a new product or variant is under development, a Sample Request captures the specification, tracks production of physical samples, and manages the approval process — all without creating production inventory records prematurely.',
        },
        {
            heading: 'Sample Requests',
            body: 'A Sample Request is raised when a customer or internal team needs a physical sample produced. It contains the item specification, requested quantity, target delivery date, and a reference to any associated Sales Order. Sample Requests are editable at any stage before approval, allowing the specification to be refined as development progresses.',
        },
        {
            heading: 'Design Attachments',
            body: 'Each Sample Request can have a design file attached — either an image (JPG, PNG, JPEG) or an Excel specification file. The attachment appears on the printed Sample Request document and provides the manufacturing team with the visual or technical reference needed to produce the sample.',
        },
        {
            heading: 'Workflow Stages',
            items: [
                'Requested — sample production order raised; specification being finalised',
                'In Production — sample is actively being manufactured on the shop floor',
                'Ready — sample produced and available for review',
                'Approved — signed off by the reviewer; ready for transition to full production BOM',
                'Rejected — failed evaluation; notes added for required revisions; request can be revised and re-submitted',
            ],
        },
        {
            heading: 'Print Templates',
            body: 'Sample Requests have a dedicated A4 print template showing the item details, variant specification, requested quantities, design attachment, and approval notes. The layout is optimised for sharing with production teams or attaching to physical samples.',
        },
        {
            heading: 'Linking to Sales Orders',
            body: 'A Sample Request can be linked to a Sales Order to track which customer demand triggered the development. This traceability ensures that approved samples can be promoted to standard production items and that the originating customer order can be fulfilled once production is ready.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Raise Sample Requests with full item and variant specifications',
                'Attach image or Excel design files to the request',
                'Edit the request at any stage before approval',
                'Advance the request through workflow stages (Requested → In Production → Ready → Approved/Rejected)',
                'Add reviewer notes at the Approved or Rejected stage',
                'Print the Sample Request as a formatted A4 document',
                'Link the request to a parent Sales Order for traceability',
            ],
        },
    ],
};
