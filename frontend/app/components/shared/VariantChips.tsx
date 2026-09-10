'use client';

import { VariantChip } from './xpTheme';

/**
 * Variant chips — combo / size / colour-variant / colour-spec for one MO or WO.
 *
 * Extracted from the WO list so every screen that answers "which variant is this?"
 * (WO table, weaving loom card, machine monitor) renders the same badges in the same
 * order. Colour and geometry come from `VariantChip`/`VARIANT_TONE` in xpTheme — this
 * component owns only the ORDER and the field mapping, never a palette of its own
 * (it used to, which is why a shade read slate here and pink on the lot pickers).
 *
 * `scale` picks the density: 'xs' for dense table rows, 'sm' for cards/headers.
 */
export interface VariantChipsProps {
    combo?: string | null;
    size?: string | null;
    /** `Colors` variant attribute value (e.g. "Black") — not the Color Library shade. */
    colorVariant?: string | null;
    /** Hex on that attribute value, when it carries one — same swatch the shade chip gets. */
    colorVariantHex?: string | null;
    /** Color Library shade this row produces. */
    colorCode?: string | null;
    colorName?: string | null;
    colorHex?: string | null;
    /** Pending lab dip code — shown only while the shade has no approved colour yet. */
    labdipCode?: string | null;
    scale?: 'xs' | 'sm';
    classic?: boolean;
    style?: React.CSSProperties;
}

export default function VariantChips({
    combo, size, colorVariant, colorVariantHex, colorCode, colorName, colorHex, labdipCode,
    scale = 'xs', classic, style,
}: VariantChipsProps) {
    if (!combo && !size && !colorVariant && !colorCode && !labdipCode) return null;

    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...style }}>
            {combo && (
                <VariantChip kind="combo" classic={classic} size={scale} title={`Combo: ${combo}`}>{combo}</VariantChip>
            )}
            {size && (
                <VariantChip kind="size" classic={classic} size={scale} title={`Size: ${size}`}>{size}</VariantChip>
            )}
            {colorVariant && (
                <VariantChip
                    kind="color" classic={classic} size={scale}
                    // The attribute value carries its own hex on the Attributes page; a
                    // colour chip with no swatch when one exists is just a lost cue.
                    swatch={colorVariantHex || null}
                    icon={null}
                    title={`Variant: ${colorVariant}`}
                >{colorVariant}</VariantChip>
            )}
            {colorCode ? (
                <VariantChip
                    kind="color" classic={classic} size={scale}
                    swatch={colorHex || null}
                    icon={colorHex ? undefined : 'bi-palette'}
                    title={`Color: ${colorCode}${colorName && colorName !== colorCode ? ` — ${colorName}` : ''}`}
                >{colorCode}</VariantChip>
            ) : labdipCode ? (
                <VariantChip
                    kind="pending" classic={classic} size={scale}
                    title={`Color still in lab dip (${labdipCode}) — dyeing is blocked until approved`}
                >{labdipCode}</VariantChip>
            ) : null}
        </span>
    );
}
