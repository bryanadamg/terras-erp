'use client';

/**
 * Hover surfaces — the styled tooltip, the chip popouts' floating layer and the
 * hover-intent hook they share. Extracted into terras-ui's Tooltip module from
 * this file: same delays (TIP_DELAY 900, POPOUT_DELAY 260), same flip/clamp
 * placement in layout px under the interface scale, same body portal on the
 * tooltip tier (100000, as zLayers' TOOLTIP_Z was). Re-exported so xpTheme's
 * chips, GlobalTooltip and the views importing `./Tooltip` stay put.
 */
export {
    Tooltip, TooltipSurface, FloatingLayer, useHoverAnchor, isClipped, TIP_DELAY, POPOUT_DELAY,
} from '@bryanadamg/terras-ui/components/Tooltip';
export type { AnchorRect } from '@bryanadamg/terras-ui/components/Tooltip';
