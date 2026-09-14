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

// No measure cap on the panels: a capped column left a dead beige gutter down
// the right of every tab, which reads as broken rather than as breathing room.
// Panels span the tab like every other section page; field width is held in
// check by `settingsGrid` splitting the row into more columns instead.

export const settingsStack: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: SETTINGS_GAP,
};

/**
 * Two (or more) columns of panels, side by side, collapsing to a stack when
 * there isn't room for them.
 *
 * Every tab used to be ONE column of full-bleed panels, which on a 1700px
 * screen gave a two-field password form 1600px of width and made the page tall
 * instead of wide — a lot of empty beige on the right of every panel and a
 * scroll to reach the save button. A measure cap was tried and rejected (see
 * the note above: it just moved the empty space into one gutter). The fix is to
 * use the width for a second column of panels.
 *
 * COLUMNS, not a grid of panels: grid rows are as tall as their tallest cell,
 * so a short panel beside a tall one leaves a hole under it. A column of cards
 * has no such row, and its ragged bottom edge is what a column of cards looks
 * like everywhere else.
 *
 * `basis` is the width below which this column stops sharing the row and wraps
 * to full width — set it from the column's widest real content (a 9-tab avatar
 * picker needs more than a pair of text inputs). `grow` splits the leftover
 * width once every basis is satisfied.
 *
 * Wide data tables (the users/roles grids, the snapshots list) stay full-bleed
 * one-per-row: half of a screen is not enough for eight columns, and squeezing
 * them is a worse trade than the empty space was.
 */
export const settingsColumns: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: SETTINGS_GAP,
    alignItems: 'flex-start',
};

export const settingsCol = (basis: number, grow = 1): React.CSSProperties => ({
    flex: `${grow} 1 ${basis}px`,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: SETTINGS_GAP,
});

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
