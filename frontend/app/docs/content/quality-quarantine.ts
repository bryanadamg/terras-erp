import { DocPage } from '../docsContent';

export const qualityQuarantinePage: DocPage = {
    slug: 'quality-quarantine',
    title: 'Quality & Quarantine',
    subtitle: 'Grade rejected material, send it to a defect store, recycle or write it off, and hold finished lots on the Quarantine Packing desk until QC releases them.',
    badges: ['Quality Grades', 'Reject Locations', 'Dispose / Reassign', 'Quarantine Locations', 'Quarantine Packing', 'Held Lots'],
    sections: [
        {
            heading: 'Quality Grades',
            body: 'Every lot carries a quality grade, not just pass/fail. A reject can be scrap, or a downgrade that keeps the material usable. The grade decides whether planning counts the lot and whether operators can still pick it.',
            table: {
                headers: ['Grade', 'Meaning', 'Counted in MRP netting?', 'Selectable in pickers?'],
                rows: [
                    ['Good', 'Normal stock', 'Yes', 'Yes'],
                    ['Reject (usable)', 'Downgraded but still fit for use, e.g. a rejected warp beam that can be re-mounted', 'No', 'Yes, with a warning'],
                    ['Rejected', 'Scrap-bound', 'No', 'No'],
                    ['Disposed', 'Written off; no stock remains', 'No', 'No'],
                ],
            },
            callout: {
                type: 'info',
                text: 'Every reject form has a "Still usable (downgrade, not scrap)" tick. Ticking it grades the material Reject (usable) instead of Rejected.',
            },
        },
        {
            heading: 'Where Rejects Are Recorded',
            items: [
                'Inventory → Lot: Reject on a lot takes a quantity, a defect store and a reason. Rejecting less than the whole lot splits the rejected part off as its own Rejected sub-lot, and the rest stays Good.',
                'Work order / MO completion log: a logged output entry can be rejected from its log entry.',
                'Packing: a pack entry\'s cartons can be QC-rejected (all or chosen ones), and loose offcuts that never became a carton are logged as "Rejected, not boxed" at pack time (see Packing & Dispatch).',
                'A rejected lot cannot be split or rejected again.',
            ],
        },
        {
            heading: 'Where Rejected Stock Goes',
            body: 'A rejected lot is moved out of the good stock location into a defect store. The destination is chosen automatically, in this order:',
            steps: [
                'The location picked on the reject form, if one was chosen. Leaving it on "Auto" uses the rules below.',
                'The Reject Loc of the producing work centre (for packing, the packing machine). Set it in Engineering → Routing on a work centre TYPE or GROUP and every MACHINE under it inherits it, for example all of Weaving routes to "Gd Greige BS".',
                'The item\'s Default reject location (Inventory → Item Inventory), used when the work centre has none.',
            ],
            callout: {
                type: 'warning',
                text: 'If none of the three is set, the lot is still graded as rejected but stays where it is. Set the reject locations up front so rejects never sit on the good shelf.',
            },
        },
        {
            heading: 'Disposing or Recycling a Rejected Lot',
            body: 'On Inventory → Lot, the Dispose action on a rejected or usable-reject lot offers two choices:',
            items: [
                'Write off: removes the remaining stock and marks the lot Disposed. This cannot be undone.',
                'Assign to another item: moves all or part of the lot into a new Good lot of a different item (for example a beam rejected for one cloth that is fine warp for a coarser one), optionally to another location. The original rejection stays on record, and the new lot traces back to the rejected one.',
            ],
        },
        {
            heading: 'Quarantine Locations',
            body: 'Separately from grading, a location can be flagged as a quarantine hold area with the shield button in Inventory → Locations. The flag is inherited downward, so every bin under a flagged warehouse or zone is quarantined too. Flag the top-level store once and that is enough.',
        },
        {
            heading: 'Quarantine Status and Release',
            body: 'A lot in a quarantine location carries a Quarantine Status. The standard values are OK, Bulk Sample and Waiting Approval, and a plant can add its own. Only OK releases a lot. Every other status, including ones added later, keeps it on hold.',
            callout: {
                type: 'warning',
                text: 'Packing out of a quarantine location is checked when the pack is logged. Any lot whose status is not OK is refused, even if it was fine when the packing order was created. For a lot-tracked item, stock in a quarantine location that has no lot is blocked too.',
            },
        },
        {
            heading: 'The Quarantine Packing Desk',
            body: 'Warehouse → Quarantine Packing is the QC hold desk that comes before Packing Orders. It lists stock held in quarantine, grouped by manufacturing order, with the item, sales order, colour, variant (size and combo), lot count, Qty Held, Released qty and a status rollup.',
            items: [
                'Expand a group to see its lots: lot, producing WO, qty, location (full warehouse / zone / bin path), status, and when it was decided.',
                'Set a status with one click per lot, or tick several lots (or a whole MO) and apply it to all of them at once. The clear button takes a lot back to undecided. Setting a status needs the quarantine status permission.',
                'Lots stay in place while you work. Lots decided in this sitting stay under "Awaiting decision" until the next refresh, and decided lots are grouped by the day they were decided.',
                'Filter by status, including "No status yet" and "Mixed", and search by MO, lot, item or SO. Show packed brings back lots already packed out, as read-only history.',
                'Once a lot has been packed into cartons, its status is locked and can no longer be changed.',
            ],
        },
        {
            heading: 'Pack from the Desk and Claimed Lots',
            body: 'Pack on a group opens a New Packing Order, filled in with that group\'s released stock that is not yet claimed. The order holds those lots:',
            items: [
                'A held lot can only be packed by the packing order that holds it.',
                'That order cannot be closed until the held lots are packed out, apart from a leftover within the weighing tolerance.',
                'Open packing orders claim released stock up to what they still owe. A claim chip such as "PCK-00003 · 2 of 8" shows how much of a lot is taken. A partly claimed lot stays active for its free remainder, and a fully claimed lot is greyed out.',
                'Once an order has packed what it was for, it stops claiming. Its leftover released stock is offered to the next Pack.',
            ],
        },
        {
            heading: 'Reject Reporting',
            body: 'Reports → Production Output shows good output, QC reject qty and reject % per machine and per work order. Packing has its own views by packer and by packing order. See Reports & Dashboard.',
        },
        {
            heading: 'Key Actions',
            items: [
                'Reject a lot, a completion or packed cartons as scrap, or downgrade them to usable',
                'Set reject locations on work centre types or groups and on items so rejects route to the defect store automatically',
                'Write off a rejected lot, or reassign it to another item as good stock',
                'Flag a warehouse or zone as a quarantine hold area',
                'Release lots on the Quarantine Packing desk by setting their status to OK, then Pack them into a packing order that holds them',
            ],
        },
    ],
};
