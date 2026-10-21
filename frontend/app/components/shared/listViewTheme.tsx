'use client';
import React from 'react';
import { xpFont, modernFont, BUTTON_RADIUS, BTN_TONES, xpBtn } from './xpTheme';
import {
    CHECK_COL_W, EXPANDER_COL_W,
    RowCheckboxCell as UIRowCheckboxCell, ExpanderCell as UIExpanderCell,
} from '@bryanadamg/terras-ui/components/Table';
import type { BtnTone } from './xpTheme';
import { toLayoutPx } from '@bryanadamg/terras-ui/scale';

// Re-exported so list-view call sites can type a tone without reaching past this module.
export type { BtnTone };

// Shared dual-theme (classic XP / modern) style helpers for master-data list views
// (Color Library, Combo Library, Colors variant, …). xpTheme's xpBtn/xpInput are
// classic-only; these carry both branches so the library views don't each re-declare
// the same style objects. Prefix `lv` (list-view) avoids clashing with xpTheme exports.

// Aliases, not second definitions: these used to declare their own stacks, and
// LV_XP_FONT's ('Tahoma, "Segoe UI", sans-serif') dropped Arial, so a list view
// and a form fell back to different faces wherever Tahoma was missing.
// xpTheme owns both stacks — keep these as re-exports for the existing call sites.
export const LV_XP_FONT = xpFont;
export const LV_MODERN_FONT = modernFont;

// `extra` must be spread last — callers pass an explicit `width` to sit an input in
// a toolbar row, and the default `width: '100%'` would otherwise silently win and
// blow every field out to full width (stacking a one-line filter bar into N rows).
export const lvInput = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily: LV_XP_FONT, fontSize: 11, border: '1px solid #7f9db9', borderRadius: BUTTON_RADIUS,
    background: 'white', padding: '1px 6px', outline: 'none', height: 20, width: '100%', boxSizing: 'border-box',
    ...extra,
});

// Classic faces come from xpTheme's BTN_TONES (single source, shared with the
// classic-only `xpBtn`); only the modern half lives here.

// THE button face, both themes, all four intents. `extra` still spreads last so a
// caller can size or disable it; it is not the place to repaint the face.
// `flexShrink: 0` on both branches for the reason spelled out on `xpTheme.xpBtn`:
// a button is sized by its label, and a long flexible sibling must not squeeze it
// until that label wraps. `extra` spreads last, so a deliberately flexible button
// still overrides it.
export const lvBtn = (tone: BtnTone = 'default', extra: React.CSSProperties = {}): React.CSSProperties =>
    xpBtn({ ...BTN_TONES[tone], ...extra });

// Emphasised primary button (blue), dual-theme. Kept as the name most call sites
// already use; it is just `lvBtn('primary')`.
export const lvPrimaryBtn = (extra: React.CSSProperties = {}): React.CSSProperties =>
    lvBtn('primary', extra);

export const lvLabel = (): React.CSSProperties => ({ fontFamily: LV_XP_FONT, fontSize: 11, color: '#000', display: 'block', marginBottom: 2 });

export const lvTh = (): React.CSSProperties => ({
    padding: '2px 6px', borderRight: '1px solid #9090a0', textAlign: 'left', whiteSpace: 'nowrap',
    fontFamily: LV_XP_FONT, fontSize: 11, fontWeight: 'bold', color: '#000',
});

// Table header-row style. The classic bevel gradient + modern flat band were being
// hand-written at every `<thead>`; `sticky` keeps the header pinned when the table
// body is its own scroll region.
export const lvThead = (sticky = false): React.CSSProperties => ({
    ...({ background: 'linear-gradient(to bottom, #f0ede4, #d8d4c8)', borderBottom: '1px solid #9090a0' }),
    ...(sticky ? { position: 'sticky' as const, top: 0, zIndex: 1 } : {}),
});

// A header cell that paints its own band. In modern `lvTh` already carries the
// band; in classic the gradient lives on the row (`lvThead`), so a cell that must
// look right on its own — sticky headers, and any table whose `<thead>` styling
// is applied per-cell — needs both. Ten views wrote this pair out by hand, four
// of them with a different padding than the other six.
export const lvThBanded = (extra: React.CSSProperties = {}): React.CSSProperties =>
    ({ ...lvTh(), ...lvThead(), ...extra });

// Pin-only header row, for `<thead>`s that already get their band elsewhere —
// Bootstrap's `.table-light` in the modern branch, or a classic gradient written
// on the `<tr>`/`<th>`. Sticky must sit on the row-group that owns the band or the
// body rows scroll through a transparent header.
export const LV_STICKY_THEAD: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 5 };

// Same, pinned to the top of the table's own scroll pane. `zIndex` keeps it over
// chips and sticky first columns.
export const lvThSticky = (extra: React.CSSProperties = {}): React.CSSProperties =>
    ({ ...lvThBanded(), position: 'sticky', top: 0, zIndex: 5, ...extra });

export const lvTd = (): React.CSSProperties => ({
    padding: '4px 6px', borderRight: '1px solid #c0bdb5', verticalAlign: 'middle', fontFamily: LV_XP_FONT, fontSize: 11,
});

// Body cell with a horizontal rule under it, for lists that separate rows on the
// cell instead of on the row (they don't use `lvRow`).
export const lvTdRuled = (extra: React.CSSProperties = {}): React.CSSProperties =>
    ({ ...lvTd(), borderBottom: '1px solid #d0cdc8', ...extra });

// ── Sub-tables (mini-tables inside an expanded row) ───────────────────────────
// A different job from lvTh/lvTd, which dress the *main* list. A table nested
// inside an already-striped list needs to read as subordinate to it: flatter,
// tighter, and with NO zebra — two stripe patterns one inside the other read as
// two competing grids. Row separation is a hairline rule instead.
//
// ~13 expanded-row panels nest a table like this and each used to hand-write the
// same chrome, which had already drifted (four files repeating one XP gradient
// string, one of them with different literals). Pair `lvSubTable` on the
// `<table>` with `lvSubTh`/`lvSubTd` on the cells.

// `dense` is a genuinely second size, not a tuning knob: a few panels put the
// sub-table in one column of a multi-column grid (pick list cartons, pack log,
// dye recipe chemical lines) where the default would force truncation. Use it
// only for a table sharing its row with other panes — a full-width sub-table
// should stay at the default size.
export const lvSubTh = (dense = false): React.CSSProperties => ({
    padding: dense ? '2px 5px' : '3px 8px', fontSize: dense ? 9 : 10,
    fontWeight: 'bold', color: '#1a3d6b',
    background: '#e4e0d4', borderBottom: '1px solid #b0a898',
    textAlign: 'left', whiteSpace: 'nowrap', fontFamily: LV_XP_FONT,
});

// Vertical padding is 3px rather than the 2px some call sites used, because
// several of these tables carry chips, selects and checkboxes rather than plain
// text. On a text-only row the extra pixel is imperceptible.
export const lvSubTd = (dense = false): React.CSSProperties => ({
    padding: dense ? '2px 5px' : '3px 8px', fontSize: dense ? 9 : 10, color: '#333',
    borderTop: '1px solid #e6e3da', fontFamily: LV_XP_FONT,
});

/**
 * Sub-table row fill. Two decisions in one place, because they interact:
 *
 * - `zebra` is opt-IN. A striped sub-table nested in a striped list reads as two
 *   competing grids, so most of these are flat and separated by the cell rule in
 *   lvSubTd. Turn it on where the table is wide and scan-heavy enough to earn it
 *   (the Production Run material grid is 10 columns — stripes help there).
 * - `fill` is a semantic row colour: rejected, picked, packed, selected. It
 *   always wins over the stripe, so a meaningful row never gets overpainted by
 *   decoration and callers don't have to hand-write that precedence each time.
 *
 * The stripe is deliberately lighter than lvRow's, so an inner table never
 * out-contrasts the list it sits inside.
 */
export const lvSubRow = (
    idx: number,
    { zebra = false, fill }: { zebra?: boolean; fill?: string } = {},
): React.CSSProperties | undefined => {
    if (fill) return { background: fill };
    if (zebra) return { background: idx % 2 === 0 ? '#fff' : ('#f7f5f0') };
    return undefined;
};

export const lvSubTable = (): React.CSSProperties => ({
    width: '100%', borderCollapse: 'collapse', background: '#fff',
    border: '1px solid #c0bdb5',
});

// Small uppercase title above a sub-table. Distinct from LvSectionCaption, which
// is a full-bleed band for stacked top-level sections; this is a quiet label for
// a mini-table, and is what makes a panel holding two of them legible.
export const lvSubCaption = (): React.CSSProperties => ({
    fontFamily: LV_XP_FONT,
    fontSize: 10, fontWeight: 'bold', color: '#444',
    textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 3,
});

export const lvSep = (): React.CSSProperties =>
    ({ width: 1, height: 20, background: '#a0988c', margin: '0 2px' });

// The zebra stripe on its own, for rows that compose their background out of
// several states (selected / expanded / QC-tinted / stripe) and so cannot take
// `lvRow` wholesale. ~24 rows wrote this ternary inline, and they had drifted:
// the lot list striped bluish `#f0f0f8` and sales orders used `#fafafa` in modern
// where every other list used `#f8fafc`.
export const lvZebra = (idx: number): string =>
    idx % 2 === 0 ? '#fff' : ('#f5f3ee');

// Row background stripe (zebra), dual-theme + border.
export const lvRow = (idx: number): React.CSSProperties => ({
    background: lvZebra(idx),
    borderBottom: '1px solid #c0bdb5',
});

// ── Empty value ──────────────────────────────────────────────────────────────
// The placeholder for a cell with no value. The app had settled on an em dash in
// ~280 places and a plain hyphen in ~69 — often in neighbouring columns of the
// same table, where the hyphen reads as a minus sign next to a quantity.
export const EMPTY_DASH = '\u2014';

export function Dash({ style }: { style?: React.CSSProperties }) {
    return <span style={{ color: '#999', ...style }}>{EMPTY_DASH}</span>;
}

// ── Empty list row ───────────────────────────────────────────────────────────
// "Nothing here" inside a table body. Twenty-odd lists wrote their own version of
// this cell and drifted on all of it: padding 8 / 16 / 20 / 24px, colour #555 /
// #666 / #888 / .text-muted, italic or not. Pair with `TableSkeleton` — skeleton
// while the first fetch is in flight, this once it has resolved empty, so "no
// data yet" never flashes as "there is no data".
//
// `tdStyle` takes the list's own cell style (its borders/gridlines); the
// alignment, padding and muted italic come from here.
export function TableEmpty({ colSpan, message, icon, tdStyle }: {
    colSpan: number;
    message: React.ReactNode;
    icon?: string;
    tdStyle?: React.CSSProperties;
}) {
    return (
        <tr>
            <td
                colSpan={colSpan}
                style={{
                    ...tdStyle,
                    textAlign: 'center', padding: '20px 8px', fontStyle: 'italic',
                    color: '#666',
                    fontFamily: LV_XP_FONT,
                    fontSize: 11,
                }}
            >
                {icon && <i className={`bi ${icon}`} style={{ display: 'block', fontSize: 18, opacity: 0.45, marginBottom: 6 }} aria-hidden="true" />}
                {message}
            </td>
        </tr>
    );
}

// ── Sortable column header ────────────────────────────────────────────────────
// `useSortable`/`useServerSort` give the state and `SortMark` the arrow, but the
// header cell itself was hand-written 45 times across 6 lists — each repeating
// `cursor: 'pointer'` + `title="Sort"` + `onClick={() => toggleSort(key)}` +
// `<SortMark/>`, and only some of them adding `userSelect: 'none'` (without it a
// double-click on the label selects the text instead of sorting twice).
//
// `style`/`className` stay per-call because the header chrome is still
// per-table (see lvTh); this owns only the sort behaviour and its affordances.
//
// A null/absent `colKey` renders a plain, inert header — so a table whose
// columns come from a config array (weaving output report, work-order list,
// booking stock) keeps ONE component call instead of branching the whole cell on
// `c.sortKey ? <th sortable> : <th>`.
// Extracted into terras-ui's Table module as-is: pointer, no text selection (a
// double-click would select the label instead of sorting twice), the "Sort"
// title, aria-sort and the arrow.
export { SortableTh } from '@bryanadamg/terras-ui/components/Table';

// ── Row multi-select ──────────────────────────────────────────────────────────
// The checkbox half of a bulk-action list. Six views grew their own copy of this
// and drifted on all three axes: the state shape (`Set<id>` / `Record<key,row>`),
// the "all selected" test (`size === rows.length`, which is wrong the moment a
// selection outlives a page), and the checkbox chrome (bare input vs
// `form-check-input`, 28/32/40px columns).
//
// `useRowSelection` keeps the ROW OBJECT, not just its id, because every bulk
// action downstream needs the row (print a WO card, move a stock line) and a
// selection that survives paging can no longer look it up in the visible page.
// Select-all is deliberately page-scoped — ticking 4000 filtered rows in one
// click is never what the user meant — while individually selected rows on other
// pages stay selected.
// Extracted into terras-ui's Table module from here: the hook, the two boxes
// (the header box owns the indeterminate ref-poke) and the hover ring, now
// chrome.css `.terras-check` (was `.lv-check`).
export const LV_CHECK_COL_W = CHECK_COL_W;
export type { RowSelection } from '@bryanadamg/terras-ui/components/Table';
export { useRowSelection, RowCheckbox, SelectAllCheckbox } from '@bryanadamg/terras-ui/components/Table';

// Row of a checkbox PICKER list — the lot pickers in the WO completion, WO
// staging and packing-log modals, which are `<label>` stacks rather than tables.
// Three files had byte-identical copies of this style object. Deliberately a
// lighter fill than a data row's `rowStateBg('selected')`: these lists are 10px
// dense and sit inside a form, where the full selection blue reads as an error.
export const lvPickerRow = (on: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'flex-start', gap: 5, padding: '3px 5px', cursor: 'pointer',
    borderBottom: '1px solid #eceae2',
    background: on ? ('#e6f0ff') : 'transparent',
});

/** `<td>` + row checkbox. The package cell fixes only the column geometry; this
 *  list's gridline (lvTd's right rule and 11px face) goes underneath it. */
export function RowCheckboxCell({ tdStyle, ...rest }: React.ComponentProps<typeof UIRowCheckboxCell>) {
    return <UIRowCheckboxCell {...rest} tdStyle={{ ...lvTd(), ...tdStyle }} />;
}

// ── Row-detail disclosure ─────────────────────────────────────────────────────
// One expander for every list row that opens a detail panel below itself. This
// used to be hand-written at ~17 call sites in five different glyphs (thin
// chevron, solid caret, and the literals `►`, `▶`, `▼`) at 8–11px in five
// colours, so no two lists disclosed a row the same way and none of them was
// keyboard-reachable or announced its state.
//
// Chevron-right/down ONLY. The solid `bi-caret-*-fill` is deliberately NOT
// used here: it means *tree hierarchy* (RoutingView, PermissionsPicker,
// CategoriesView, TreeSelect), which is a different affordance from "this row
// has a detail panel". Up/down chevrons mean a card/section fold, also not this.
//
// COLUMN ORDER IS FIXED. A list's leading control columns are, in this order:
//
//     [ checkbox (LV_CHECK_COL_W, only if the list has bulk actions) ]
//     [ chevron  (LV_EXPANDER_COL_W, only if the row expands)        ]
//     [ first data column — the row's code/identity                  ]
//
// The chevron gets its OWN column; never park it inside a data cell. Four
// Engineering lists each picked a different arrangement of the same three
// things (checkbox→chevron-in-code-cell, chevron→code, code→chevron-in-second-
// cell, checkbox→chevron→code) so no two tables had their controls in the same
// place. Pair `ExpanderCell` with `rowStateBg('expanded')` on the row —
// the two halves of the same convention. `ExpandToggle` on its own is for a
// non-table disclosure, not for smuggling the glyph back into a data cell.
export const LV_EXPANDER_COL_W = EXPANDER_COL_W;

/** The dedicated chevron column, over terras-ui's ExpanderCell (extracted from
 *  here). Puts back what the package can't know: the bootstrap chevron (it ships
 *  an SVG, no icon set), this app's #0058e6 (its default is XP's #0054e3), and
 *  lvTd's gridline under the column geometry. `fontSize: 9` on the button keeps
 *  the rotating wrapper glyph-sized, as when the <i> itself rotated. */
export function ExpanderCell({ tdStyle, tone = 'default', expanded, style, ...rest }: React.ComponentProps<typeof UIExpanderCell>) {
    return (
        <UIExpanderCell
            icon={<i className="bi bi-chevron-right" style={{ fontSize: 9 }} aria-hidden="true" />}
            {...rest}
            expanded={expanded}
            tone={tone}
            style={{ color: tone === 'alert' && expanded ? '#c00000' : '#0058e6', fontSize: 9, ...style }}
            tdStyle={{ ...lvTd(), ...tdStyle }}
        />
    );
}

// ── Section caption ───────────────────────────────────────────────────────────
// Small uppercase band that names a table/panel inside a view that stacks more
// than one of them, with optional right-aligned meta (row counts, hints). Keeps
// stacked sections visually parallel instead of one captioned and one bare.
export function LvSectionCaption({ icon, children, right, style }: {
    icon?: string; children: React.ReactNode; right?: React.ReactNode; style?: React.CSSProperties;
}) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            fontFamily: LV_XP_FONT,
            fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.4,
            padding: '4px 8px',
            ...({ color: '#2b2822', background: '#e6e2d6', borderTop: '1px solid #c0bdb5', borderBottom: '1px solid #c0bdb5' }),
            ...style,
        }}>
            {icon && <i className={`bi ${icon}`} />}
            {children}
            {right && (
                <span style={{ marginLeft: 'auto', fontWeight: 'normal', textTransform: 'none', letterSpacing: 0, opacity: 0.8 }}>
                    {right}
                </span>
            )}
        </div>
    );
}


// ── Resizable columns ─────────────────────────────────────────────────────────
// Excel-style column drag, wired to the `<table>` rather than to each `<th>`: one
// pointerdown handler works out which border you grabbed from the header cells'
// own geometry. A per-header grip meant every column of every grid needed an edit
// to opt in, which is most of the cost of putting this on twenty pages.
//
// Nothing changes until the first drag. The table keeps its own layout — auto
// layout still sizes columns to content — and only when a border is dragged do we
// measure the header, freeze every column to px and switch to `tableLayout: fixed`.
// Freezing up front would have been the visible regression: fixed layout with no
// widths splits the table into equal columns.
//
// Once frozen the table is exactly as wide as its columns add up to, and every
// column is independent the way a spreadsheet behaves — dragging one moves nothing
// else. Narrowing a column therefore narrows the grid, and the pane's own
// background shows beside it. The two alternatives both failed in use: stretching
// the table to 100% spreads the surplus over EVERY column, which inflates the
// narrow ones (a 78px Actions column grows and its right-aligned buttons drift off
// the row), and parking the slack in an empty filler `<col>` only looks seamless on
// a grid that stripes its `tr`s — the ones that set the zebra per `td` (most of
// them) grew a column of blank white rows past the last real cell instead.
//
// Widths are NOT persisted: every page load opens on the table's own layout.
// Restoring stored px widths froze a grid sized for another window width, sidebar
// state or UI scale, so it came back narrower (or wider) than its pane.
const COLW_MIN = 28;
/** How close to a column border the pointer has to be, in px, to grab it. */
const COLW_GRAB = 5;
/** How far it then has to travel before the drag counts as a drag. */
const COLW_DRAG_START = 3;

export interface ColumnWidths {
    /** Spread onto the `<table>`, passing the style it would have had. */
    table: (style?: React.CSSProperties) => React.ComponentProps<'table'>;
    /** The `<col>` elements. A table with no `<colgroup>` needs one wrapping this. */
    cols: () => React.ReactNode;
    /** Back to the table's own layout; also what double-clicking a border does. */
    reset: () => void;
}

/** `defaults` is only needed by a grid that already hand-writes a `<colgroup>` —
 *  it is what the columns render as before the first drag. */
export function useColumnWidths(defaults?: (number | string)[]): ColumnWidths {
    const ref = React.useRef<HTMLTableElement | null>(null);
    const [widths, setWidths] = React.useState<number[] | null>(null);
    const [nearBorder, setNearBorder] = React.useState(false);
    const drag = React.useRef<{ i: number; x: number; base: number[]; moved: boolean } | null>(null);
    /** Set by a drag, read by the click that follows it — see `onClickCapture`. */
    const swallowClick = React.useRef(false);

    const reset = () => setWidths(null);

    /** The header row the borders are measured from, or null if this table has a
     *  shape we can't resize (no header, or a spanned cell — a spanned header has
     *  no one-to-one border to drag). */
    const headerCells = (): HTMLTableCellElement[] | null => {
        const row = ref.current?.tHead?.rows?.[0];
        if (!row || !row.cells.length) return null;
        const cells = Array.from(row.cells);
        if (cells.some(c => c.colSpan > 1)) return null;
        if (defaults && cells.length !== defaults.length) return null;
        return cells;
    };

    /** Each column's width, taken from where its RIGHT BORDER sits rather than from
     *  the cell's own box. Under `border-collapse: collapse` neighbouring cells share
     *  a border, so their rects overlap by a pixel each and summing them overshoots
     *  the table by a pixel per column — enough to push the table past its pane and
     *  pop a horizontal scrollbar the instant the widths are applied. Measuring the
     *  gaps between borders partitions the table exactly.
     *
     *  Returned in LAYOUT px. Rects come back in screen px, already divided by the
     *  root interface zoom, while a `<col>` width is a CSS length that gets multiplied
     *  by it again — writing a rect straight into one shrank every real column to 80%
     *  of itself and dumped the rest into the filler, which read as the table
     *  collapsing the moment a border was grabbed. See terras-ui/scale. */
    const measure = (cells: HTMLTableCellElement[]): number[] => {
        let prev = cells[0].getBoundingClientRect().left;
        return cells.map(c => {
            const right = c.getBoundingClientRect().right;
            const w = toLayoutPx(right - prev);
            prev = right;
            return w;
        });
    };

    /** Index of the column whose right border is under `clientX`, or -1. */
    const borderAt = (clientX: number, clientY: number): number => {
        const cells = headerCells();
        const head = ref.current?.tHead?.getBoundingClientRect();
        if (!cells || !head) return -1;
        if (clientY < head.top || clientY > head.bottom) return -1;
        return cells.findIndex(c => Math.abs(clientX - c.getBoundingClientRect().right) <= COLW_GRAB);
    };

    const onPointerDown = (e: React.PointerEvent<HTMLTableElement>) => {
        const i = borderAt(e.clientX, e.clientY);
        if (i < 0) return;
        const cells = headerCells();
        if (!cells) return;
        e.preventDefault();  // or the drag starts a text selection instead
        const base = widths ?? measure(cells);
        drag.current = { i, x: e.clientX, base, moved: false };
        ref.current?.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLTableElement>) => {
        const d = drag.current;
        if (!d) { setNearBorder(borderAt(e.clientX, e.clientY) >= 0); return; }
        const dx = e.clientX - d.x;
        // Below the threshold nothing is applied at all: pressing a border, or the
        // pixel of jitter in a click, would otherwise freeze the table to px and
        // switch it to fixed layout — the whole grid visibly resettling before the
        // user has dragged anything.
        if (!d.moved && Math.abs(dx) < COLW_DRAG_START) return;
        d.moved = true;
        const next = d.base.slice();
        next[d.i] = Math.max(COLW_MIN, Math.round(d.base[d.i] + toLayoutPx(dx)));
        setWidths(next);
    };

    const onPointerUp = (e: React.PointerEvent<HTMLTableElement>) => {
        if (!drag.current) return;
        swallowClick.current = drag.current.moved;
        drag.current = null;
        try { ref.current?.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    };

    return {
        table: (style?: React.CSSProperties) => ({
            ref,
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
            // The drag ends on pointerup, but a click still follows it and would
            // reach the header's sort handler. Capturing it at the table, before it
            // reaches the cell, is the only place that sees it first.
            onClickCapture: (e: React.MouseEvent) => {
                if (!swallowClick.current) return;
                swallowClick.current = false;
                e.preventDefault();
                e.stopPropagation();
            },
            onDoubleClick: (e: React.MouseEvent) => {
                if (borderAt(e.clientX, e.clientY) < 0) return;
                e.stopPropagation();
                reset();
            },
            style: {
                ...style,
                // Only once frozen: `fixed` on a table that never declared widths
                // splits it into equal columns. The width is the columns' own sum, so
                // there is no surplus to hand out and every column keeps exactly the
                // width it was dragged to; past the pane the container scrolls.
                // `minWidth` is left to the call site's own floor.
                ...(widths ? {
                    tableLayout: 'fixed' as const,
                    width: widths.reduce((a, b) => a + b, 0),
                    // The call site's floor is for its *default* widths; left on, a
                    // grid dragged narrower than it would be stretched back out and
                    // fixed layout would share the surplus over every column again.
                    minWidth: 0,
                } : {}),
                ...(nearBorder || drag.current ? { cursor: 'col-resize' as const } : {}),
            },
        }),
        cols: () => (defaults ?? widths ?? []).map((d, i) => (
            <col key={i} style={{ width: widths ? widths[i] : (defaults ? (d as number | string) : undefined) }} />
        )),
        reset,
    };
}

/** A `<table>` whose columns the user can drag, and the way to opt a grid in:
 *  swap the tag, keep the style, keep the children. It owns the `<colgroup>`, so
 *  a grid that hand-writes one passes those widths as `defaults` and deletes it.
 */
export function ResizableTable({ defaults, style, className, children }: {
    defaults?: (number | string)[];
    style?: React.CSSProperties;
    className?: string;
    children?: React.ReactNode;
}) {
    const colw = useColumnWidths(defaults);
    return (
        <table className={className} {...colw.table(style)}>
            <colgroup>{colw.cols()}</colgroup>
            {children}
        </table>
    );
}
