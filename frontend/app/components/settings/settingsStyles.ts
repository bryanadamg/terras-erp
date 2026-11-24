import type React from 'react';
import { xpFont } from '../shared/xpTheme';

// Layout rhythm + data-table look for the Settings tabs.
//
// The panel chrome that used to live here (xpBevel + a per-panel colored
// xpTitleBar) is gone on purpose: every tab already sits inside the Settings
// window, so a second bevelled window per panel was chrome inside chrome, and
// the seven title-bar hues (blue / teal / green / orange / red …) gave eight
// peers the same maximum volume with no hierarchy. Groups now render through
// `SettingsPanel` (one FormSection header language). Don't reintroduce a
// per-panel window bar here.

// Two intervals, deliberately far apart, so grouping is legible without boxes:
// GAP separates one group from the next, FIELD_GAP holds fields together inside
// a group. Anything between them reads as "everything is equally related".
export const SETTINGS_GAP = 16;
export const SETTINGS_FIELD_GAP = 10;

// Every tab is one full-height panel — a section menu or list down its left
// edge, the selected content beside it (`MasterDetail` in settingsParts). The
// old two-column band of free-floating panels (settingsColumns/settingsCol)
// went with it.

/**
 * Field row that reflows by available width instead of by bootstrap column
 * count. `col-md-6` left a half-width hole whenever a group had an odd number
 * of fields; auto-fit collapses the empty track instead.
 */
export const settingsGrid = (min = 220): React.CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
    gap: SETTINGS_FIELD_GAP,
    alignItems: 'start',
});

/**
 * Trailing action row for a settings form. Submit buttons were `width: 100%`,
 * which reads as a mobile primary action and pushed every form's most
 * destructive-adjacent control to full bleed; the rule is right-aligned, sized
 * to its label, with generous space above the rule that separates it.
 */
// retires its last caller (shared/QtyFormulaEditor.tsx).
export const settingsActions = (): React.CSSProperties => ({
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: SETTINGS_GAP,
    paddingTop: SETTINGS_FIELD_GAP,
    borderTop: '1px solid #dedbd2',
});

/** Muted helper line under a field or beside an action. */
export const settingsHint = (): React.CSSProperties => ({
    fontFamily: xpFont,
    fontSize: 10,
    color: '#6b6558',
    marginTop: 3,
});

export const xpTableHeader: React.CSSProperties = {
    background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)',
    borderBottom: '2px solid #808080',
    fontSize: '10px',
    fontWeight: 'bold',
    color: '#000000',
};

export const xpThCell: React.CSSProperties = {
    padding: '3px 6px',
    borderRight: '1px solid #b0aaa0',
    textAlign: 'left' as const,
    whiteSpace: 'nowrap' as const,
    fontFamily: xpFont,
};

export const tdBase: React.CSSProperties = {
    padding: '4px 6px',
    borderRight: '1px solid #c0bdb5',
    borderBottom: '1px solid #d0cdc8',
    verticalAlign: 'top' as const,
    fontFamily: xpFont,
    fontSize: '11px',
};
