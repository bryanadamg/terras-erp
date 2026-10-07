/**
 * Is this item a warp beam? Same three signals as backend `beam_service.is_beam_item`
 * — Beam category, a BEAM- code, or `ends` set — so a beam recognised by code or
 * ends alone is still a beam on screen (stock, pickers, lot output). The category
 * may sit anywhere on the path, as every screen-side copy this replaced allowed.
 */
export function isBeamItemRecord(item: any): boolean {
    if (!item) return false;
    return (item.category_path || []).some((c: string) => (c || '').toLowerCase() === 'beam')
        || String(item.code || '').startsWith('BEAM-')
        || item.ends != null;
}
