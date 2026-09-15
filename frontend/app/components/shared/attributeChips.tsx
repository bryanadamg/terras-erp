'use client';

import { VariantChip, colorHexFor } from './xpTheme';

/**
 * Chips for a raw `attribute_value_ids` list — the loose variant attributes a BOM
 * line, MO node or planned component carries, as opposed to the named
 * combo/size/colour set `VariantChips` renders for a whole MO.
 *
 * Resolution lives here rather than in each caller because the hex FALLBACK is a
 * rule, not a detail: a value with a stored `hex` is a shade, a value whose text
 * maps in `colorHexFor` is a shade too, everything else is a loose attribute. Three
 * views had grown their own copy of that if-chain, which is how the same value
 * started chipping as a colour on one screen and as a material on another.
 */
export const attributeValueName = (attributes: any[], valId: string): string => {
    for (const attr of attributes || []) {
        const val = (attr.values || []).find((v: any) => v.id === valId);
        if (val) return val.value;
    }
    return valId;
};

export const attributeValueHex = (attributes: any[], valId: string): string | null => {
    for (const attr of attributes || []) {
        const val = (attr.values || []).find((v: any) => v.id === valId);
        if (val) return val.hex || colorHexFor(val.value) || null;
    }
    return null;
};

export default function AttributeValueChips({
    valueIds, attributes, size = 'xs', style,
}: {
    valueIds?: string[] | null;
    /** The attributes master from DataContext — values are resolved by id. */
    attributes: any[];
    size?: 'xs' | 'sm' | 'md';
    style?: React.CSSProperties;
}) {
    const ids = (valueIds || []).filter(Boolean);
    if (ids.length === 0) return null;
    return (
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 3, ...style }}>
            {ids.map(id => {
                const label = attributeValueName(attributes, id);
                const hex = attributeValueHex(attributes, id);
                return (
                    <VariantChip
                        key={id} kind={hex ? 'color' : 'material'} size={size}
                        swatch={hex} icon={null} truncate title={label}
                    >{label}</VariantChip>
                );
            })}
        </span>
    );
}
