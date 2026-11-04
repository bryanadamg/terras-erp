import { DocPage } from '../docsContent';

export const samplesPage: DocPage = {
    slug: 'samples',
    title: 'Samples & PLM',
    subtitle: 'Sample requests from specification to customer sign-off, per colour or combo, and the report that counts every attempt.',
    badges: ['Sample Requests', 'Sample Report', 'SPK Sample', 'Unread Tracking', 'Approval Photos'],
    sections: [
        {
            heading: 'Overview',
            body: 'Sales → Sample Requests holds the development work for a new or repeat article: what to make, from which materials, in which colours or combos, and what the customer said about each one. Sales → Sample Report counts that activity over a date range. A sample request creates no stock and no production orders. Once a colour is approved, you create the production item from it.',
        },
        {
            heading: 'Creating a Sample Request',
            body: 'Click New Sample Request. The form has four sections:',
            table: {
                headers: ['Section', 'Fields'],
                rows: [
                    ['**Identity**', 'Request Code (generated; the gear icon sets the code format; it cannot be changed after saving), Request Date, Category, Customer (optional; none means Internal/Prototype), Project, Customer Article Code, Internal Article Code.'],
                    ['**Colors & Specs**', 'Width, and the variants to sample: choose Color (from the Colors variant list, shown with its swatch) or Combo (searched from the Combo Library). Each entry is marked New or Repeat.'],
                    ['**Materials**', 'Main, Middle and Bottom Material, Weft and Warp, picked from the item catalogue rather than typed; Original Weight and Production Weight with units; Additional Information (for example PRINTING ROTARY).'],
                    ['**Logistics**', 'Sample Quantity, Per-Sample Size, Est. Completion Date, Completion Notes, a Sample Photo (image) and a Design file (PDF, image or Excel).'],
                ],
            },
            callout: {
                type: 'tip',
                text: 'Categories (New Sample, Re Sample, Yardage by default) come from the Sample Category list on Inventory → Attributes, so you can add your own there.',
            },
        },
        {
            heading: 'The List',
            items: [
                'Columns: Request Code, Category, Customer, Article / Project, Specs, Status, Colors (a count per colour status) and Actions.',
                'Filters: search (code, article, project), status chips (All, In Prod, Sent, Approved, Rejected), category and created-date range. Clear resets them. Filtering and paging run on the server, so every request can be reached.',
                'A paperclip on a row means it has an attached photo.',
                'Expand a row to see the full specification, attachments and the per-colour table.',
                'The footer counts colours by status (Pending, In Production, Sent, Approved, Rejected) across the whole filtered set, not just the page.',
                'The row ⋯ menu has Edit Request, Print SPK Sample and View Event Log.',
            ],
        },
        {
            heading: 'Unread Requests',
            body: 'Each user has their own read state, so the team can see what changed since they last looked.',
            items: [
                'An unread request has a coloured rail on its first cell.',
                'Opening (expanding) a row marks it read. Mark All as Read clears every request.',
                'Any edit or colour status change makes the request unread again for everyone except the person who made the change.',
                'The toolbar shows "n unread". Click it to show only unread requests, and click again to show all.',
            ],
        },
        {
            heading: 'Request Status',
            body: 'The request as a whole is moved with the Update Status button on its row:',
            table: {
                headers: ['Action', 'Status'],
                rows: [
                    ['(new request)', 'DRAFT'],
                    ['Mark In Production', 'IN_PRODUCTION'],
                    ['Mark Sent to Client', 'SENT'],
                    ['Client Approved', 'APPROVED'],
                    ['Client Rejected', 'REJECTED'],
                ],
            },
            callout: {
                type: 'info',
                text: 'The same menu has Delete Request. The status filter on the list works on this request-level status. Each colour also has its own status, described next.',
            },
        },
        {
            heading: 'Colour (Variant) Status',
            body: 'Each colour or combo on a request is decided on its own, from the colour table in the expanded row:',
            items: [
                'Pending → In Production → Sent (to the customer) → Approve or Reject. In Production and Sent can be toggled back to Pending.',
                'Approve takes optional notes and an optional proof photo.',
                'Reject requires a reason (Color mismatch, Shade too dark, Shade too light, Quality defect, Wrong material, Measurement out of spec, Hand-feel / texture, Customer changed requirement, Other) and takes optional notes and a photo.',
                'An approved colour is locked.',
                'A rejected colour can be reopened to In Production for another attempt. Every attempt is logged, and the hover on the colour shows how many process runs, rejections and approvals it has had.',
                'The Photo column shows the proof photo for the colour\'s current status.',
            ],
        },
        {
            heading: 'After the Decision',
            items: [
                '+ Item on an approved colour opens Inventory → Item Inventory with a new item pre-filled (suggested code = request code + colour) and linked to the sample. The row then shows "Item: CODE", and the BOM designer shows the linked sample on that item.',
                '+ New Sample on a rejected colour clones the request with all its specifications into a new request for that colour. The new request gets a revision code (ROOT-R1, ROOT-R2, and so on) and the Re Sample category.',
            ],
        },
        {
            heading: 'Printing the SPK Sample',
            body: 'Print SPK Sample in the row ⋯ menu prints the sample work order on A4: customer, article codes, project, dates, width, materials, weights, quantity, completion notes and the sample photo, a box for attaching the physical sample, and an OK / NOT OK checklist with one line per colour. Enter the prepared-by name before printing. The tick boxes leave out the sample box or the checklist for this print only. The layout is edited in Administration → Print Layouts.',
        },
        {
            heading: 'Sample Report',
            body: 'Sales → Sample Report counts attempts, not current status. A colour rejected twice before approval counts as 3 processes, 2 rejections and 1 approval.',
            items: [
                'Filters: date range, customer, category, and grouping (by customer, category or month).',
                'Tiles: Variants, Processed (times put In Production), Sent, Approved, Rejected, Approval Rate (approvals ÷ approved + rejected) and Runs / Variant (above 1 means remakes).',
                'A summary table per group, and a variant table: sample, customer, variant, processed, sent, rejected, approved, current status and last activity.',
                'Export CSV downloads the variant table.',
            ],
        },
        {
            heading: 'Key Actions',
            items: [
                'Raise a sample request with specifications, materials from the catalogue, and colours or combos marked New or Repeat',
                'Attach a sample photo and a design file (PDF, image or Excel)',
                'Move the request through Draft, In Production, Sent and Client Approved / Rejected',
                'Approve or reject each colour with a note and a proof photo, and reopen a rejected colour for another attempt',
                'Create the production item from an approved colour, or a revision request from a rejected one',
                'Track unread changes and filter to unread only',
                'Print the SPK Sample and review attempt counts on the Sample Report',
            ],
        },
    ],
};
