import { useTimezone } from '../../context/TimezoneContext';
import { colorHexFor } from '../shared/xpTheme';
// One definition of "what does this attribute value look like" — see attributeChips.
import { attributeValueName, attributeValueHex } from '../shared/attributeChips';
// Pure, closure-free calculation shared with the floor scanner — see moHelpers.
import { calculateRequiredQty } from '../shared/moHelpers';

export interface ManufacturingHelpersInput {
    items: any[];
    boms: any[];
    locations: any[];
    workCenters: any[];
    attributes: any[];
    stockBalance: any[];
    itemIndex?: Record<string, any>;
}

// Pure lookup / formatting / calculation helpers shared by the Production Runs
// and Manufacturing Orders tabs. No local UI state lives here — everything is
// derived from the props passed in, so both tabs get identical behavior.
export function useManufacturingHelpers({
    items, boms, locations, workCenters, attributes, stockBalance, itemIndex,
}: ManufacturingHelpersInput) {
    const { formatDate: tzFormatDate, formatDateTime: tzFormatDateTime } = useTimezone();

    const uomBadgeStyle: React.CSSProperties = { background: '#dde8f5', border: '1px solid #7f9db9', color: '#336', fontSize: 9, padding: '0 4px', whiteSpace: 'nowrap', fontWeight: 'normal' };

    const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || itemIndex?.[String(id)]?.name || id;
    const getItemCode = (id: string) => items.find((i: any) => i.id === id)?.code || itemIndex?.[String(id)]?.code || id;
    const getItemUom = (id: string) => items.find((i: any) => i.id === id)?.uom || '';
    const getItemEnds = (id: string) => { const v = items.find((i: any) => i.id === id)?.ends; return v != null ? v : null; };
    const getBOMCode = (id: string) => boms.find((b: any) => b.id === id)?.code || id;
    const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || id;
    const getWCName = (id: string) => workCenters.find((w: any) => w.id === id)?.name || id;

    const getAttributeValueName = (valId: string) => attributeValueName(attributes, valId);

    // Swatch hex for an attribute value, so a colour value chips as a shade (with its
    // dot) instead of a generic attribute. Falls back to the name-derived palette in
    // xpTheme, same rule the BOM list and SO table use.
    const getAttributeValueHex = (valId: string): string | null => attributeValueHex(attributes, valId);

    const getBomSizeLabel = (bomId: string, bomSizeId: string, snapshot?: any): string => {
        const src = snapshot || (() => {
            const bom = boms.find((b: any) => b.id === bomId);
            return bom ? (bom.sizes || []).find((s: any) => s.id === bomSizeId) : null;
        })();
        if (!src) return '';
        const parts: string[] = [];
        const sizeName = src.size_name || src.size?.name;
        if (sizeName) parts.push(sizeName);
        if (src.label) parts.push(src.label);
        if (src.target_measurement != null) {
            let meas = `${parseFloat(src.target_measurement)}`;
            if (src.measurement_min != null && src.measurement_max != null) {
                meas += ` (${parseFloat(src.measurement_min)}–${parseFloat(src.measurement_max)})`;
            }
            parts.push(meas + ' cm');
        }
        return parts.join(' — ') || '';
    };

    const formatDate = (date: string | null) => {
        if (!date) return '-';
        return tzFormatDate(date);
    };

    const formatDateTime = (date: string | null) => {
        if (!date) return '-';
        return tzFormatDateTime(date);
    };

    const getDueDateWarning = (wo: any) => {
        if (wo.status === 'COMPLETED' || wo.status === 'CANCELLED') return null;
        if (!wo.target_end_date) return null;
        const due = new Date(wo.target_end_date);
        const now = new Date();
        const diffDays = (due.getTime() - now.getTime()) / (1000 * 3600 * 24);
        if (diffDays < 0) return { type: 'danger', icon: 'bi-exclamation-octagon-fill', text: 'Overdue!' };
        if (diffDays < 2) return { type: 'warning', icon: 'bi-exclamation-triangle-fill', text: 'Due Soon' };
        return null;
    };

    // NOTE: no checkStockAvailability here. Nothing on the MO/PR side consumed it —
    // every caller wants getStockAcrossLocations below, which rolls up plant-wide
    // rather than asking about one bin. The single-location check is
    // `stockAtLocation` in shared/moHelpers, where the floor scanner reads it too.

    const getBeamBatchCount = (item_id: string) => {
        const keys = new Set<string>();
        for (const s of (stockBalance as any[])) {
            if (String(s.item_id) !== String(item_id)) continue;
            if (!s.batch_key) continue;
            if (parseFloat(s.qty) <= 0) continue;
            keys.add(s.batch_key);
        }
        return keys.size;
    };

    // Batch-identity items (beams, other lot-tracked items) always book stock with
    // attribute_value_ids=[] — the batch/lot itself is the identity, attrs are
    // intentionally not stamped (see backend api/manufacturing.py, beam_service.py).
    // A BOM line variant filter must not be applied to these or on-hand batch stock
    // never matches and always reads as "No Stock".
    const isBatchIdentityItem = (item_id: string) => {
        const item = items.find((i: any) => String(i.id) === String(item_id));
        if (!item) return false;
        if (item.lot_tracked) return true;
        const leafCategory = (item.category_path || [])[item.category_path?.length - 1];
        return (leafCategory || '').toLowerCase() === 'beam';
    };

    const getStockAcrossLocations = (item_id: string, attribute_value_ids: string[] = [], required_qty: number) => {
        const effectiveAttrIds = isBatchIdentityItem(item_id) ? [] : attribute_value_ids;
        const targetKey = [...effectiveAttrIds].map(String).sort().join(',');
        const byLocation: Record<string, number> = {};
        for (const s of (stockBalance as any[])) {
            if (String(s.item_id) !== String(item_id)) continue;
            if (parseFloat(s.qty) <= 0) continue;
            if (effectiveAttrIds.length > 0) {
                const sKey = [...(s.attribute_value_ids || [])].map(String).sort().join(',');
                if (sKey !== targetKey) continue;
            }
            byLocation[s.location_id] = (byLocation[s.location_id] || 0) + parseFloat(s.qty);
        }
        const total = Object.values(byLocation).reduce((a, b) => a + b, 0);
        const locs = Object.entries(byLocation).map(([locId, qty]) => ({
            locId,
            code: (locations as any[]).find((l: any) => l.id === locId)?.code || locId,
            qty,
        })).sort((a, b) => b.qty - a.qty);
        return { total, isEnough: total >= required_qty, locs };
    };

    return {
        uomBadgeStyle,
        getItemName, getItemCode, getItemUom, getItemEnds,
        getBOMCode, getLocationName, getWCName,
        getAttributeValueName, getAttributeValueHex, getBomSizeLabel,
        formatDate, formatDateTime, getDueDateWarning,
        calculateRequiredQty, getStockAcrossLocations,
        getBeamBatchCount, isBatchIdentityItem,
    };
}
