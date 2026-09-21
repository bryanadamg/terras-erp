// QC reject vocabulary shared by every view that shows a rejected lot or a
// rejected production/packing log. Mirrors services/reject_service.py — the two
// reject grades and what each one still allows must read the same everywhere.
//
//   REJECTED       scrap-bound: out of availability netting AND out of every
//                  consumption/staging picker
//   REJECT_USABLE  downgraded: also out of availability netting, but still
//                  offered in pickers (a rejected warp beam re-mounts on some
//                  items). Never treat it as good stock.
//   DISPOSED       written off, no stock left

/** Either reject grade — the lot is quarantined and is no longer good stock. */
export const isRejectGrade = (status?: string | null): boolean =>
    status === 'REJECTED' || status === 'REJECT_USABLE';

/** Short badge text for a quality status ('' for GOOD / unknown). */
export const rejectGradeLabel = (status?: string | null): string =>
    status === 'REJECT_USABLE' ? 'REJECT · USABLE'
    : status === 'REJECTED' ? 'REJECTED'
    : status === 'DISPOSED' ? 'DISPOSED'
    : '';

/**
 * Tooltip for a rejected completion log: what happened, why, and which defect
 * store the scrap was moved into. A missing location is normal — the reject
 * either predates reject routing or the output was un-lotted and written off.
 */
export const rejectTitle = (
    c: { reject_reason?: string | null; reject_location_name?: string | null },
    lead = 'Rejected',
): string => [
    lead,
    c.reject_reason || null,
    c.reject_location_name ? `→ ${c.reject_location_name}` : null,
].filter(Boolean).join(' · ');
