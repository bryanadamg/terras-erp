/**
 * Pick a BOM line's sub-BOM from the same-item candidates: the BOM whose variant
 * attributes match the line's exactly, else the item's attribute-less (base) BOM.
 * Matching on item_id alone picks whichever variant happens to be listed first.
 */
export function matchSubBOM(candidates: any[], line: any): any | undefined {
    if (!candidates.length) return undefined;
    const lineAttrs = [...(line.attribute_value_ids || [])].map(String).sort();
    const exact = candidates.find((b: any) => {
        const bAttrs = [...(b.attribute_value_ids || [])].map(String).sort();
        return bAttrs.length === lineAttrs.length && bAttrs.every((id, idx) => id === lineAttrs[idx]);
    });
    return exact || candidates.find((b: any) => (b.attribute_value_ids || []).length === 0);
}
