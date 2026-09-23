'use client';
import React from 'react';
import { xpFont, modernFont, SortMark, SortState, BUTTON_RADIUS, BTN_TONES } from './xpTheme';
import type { BtnTone } from './xpTheme';

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
const LV_CLASSIC_TONES = BTN_TONES;

const LV_MODERN_TONES: Record<BtnTone, React.CSSProperties> = {
    default: {},
    primary: { fontWeight: 600, background: '#2563eb', color: '#fff', border: 'none' },
    success: { fontWeight: 600, background: '#16a34a', color: '#fff', border: 'none' },
    danger:  { fontWeight: 600, background: '#dc2626', color: '#fff', border: 'none' },
};

// THE button face, both themes, all four intents. `extra` still spreads last so a
// caller can size or disable it; it is not the place to repaint the face.
// `flexShrink: 0` on both branches for the reason spelled out on `xpTheme.xpBtn`:
// a button is sized by its label, and a long flexible sibling must not squeeze it
// until that label wraps. `extra` spreads last, so a deliberately flexible button
// still overrides it.
export const lvBtn = (tone: BtnTone = 'default', extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily: LV_XP_FONT, fontSize: 11, padding: '2px 10px', cursor: 'pointer',
    background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
    border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#000',
    borderRadius: BUTTON_RADIUS, flexShrink: 0, ...LV_CLASSIC_TONES[tone], ...extra,
});

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
export function SortableTh({ sort, colKey, onSort, children, style, className, title, colSpan }: {
    sort?: SortState;
    colKey?: string | null;
    onSort?: (key: string) => void;
    children?: React.ReactNode;
    style?: React.CSSProperties;
    className?: string;
    title?: string;
    colSpan?: number;
}) {
    if (!colKey || !onSort) {
        return <th className={className} colSpan={colSpan} title={title} style={style}>{children}</th>;
    }
    const key = colKey;
    const dir = sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none';
    return (
        <th
            className={className}
            colSpan={colSpan}
            title={title ?? 'Sort'}
            aria-sort={dir as React.AriaAttributes['aria-sort']}
            style={{ ...style, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => onSort(key)}
        >
            {children}<SortMark sort={sort ?? null} colKey={key} />
        </th>
    );
}

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
export const LV_CHECK_COL_W = 28;

export const lvCheckTd = (base: React.CSSProperties = {}): React.CSSProperties => ({
    ...lvTd(),
    ...base,
    width: LV_CHECK_COL_W, textAlign: 'center', padding: '3px 4px', verticalAlign: 'middle',
});

export interface RowSelection<T> {
    /** key → row, for the bulk action and the row's own `checked` test. */
    selected: Record<string, T>;
    keys: string[];
    items: T[];
    entries: [string, T][];
    count: number;
    isSelected: (row: T) => boolean;
    isSelectedKey: (key: string) => boolean;
    toggle: (row: T) => void;
    /** For rows handed to a memoised child that only knows the id. */
    toggleKey: (key: string) => void;
    deselectKey: (key: string) => void;
    /** Header checkbox: adds/removes every eligible row on the current page. */
    togglePage: () => void;
    allPageSelected: boolean;
    /** Some — but not all — of this page is selected: the indeterminate state. */
    someSelected: boolean;
    /** Eligible rows on this page; 0 means the header checkbox has nothing to do. */
    pageEligibleCount: number;
    clear: () => void;
}

export function useRowSelection<T>(
    rows: T[],
    keyOf: (row: T) => string,
    opts: { selectable?: (row: T) => boolean } = {},
): RowSelection<T> {
    const [selected, setSelected] = React.useState<Record<string, T>>({});
    const { selectable } = opts;
    const eligible = selectable ? rows.filter(selectable) : rows;

    const isSelectedKey = (key: string) => !!selected[key];
    const isSelected = (row: T) => isSelectedKey(keyOf(row));

    const setRow = (row: T, on: boolean) => setSelected(prev => {
        const next = { ...prev };
        const k = keyOf(row);
        if (on) next[k] = row; else delete next[k];
        return next;
    });

    const allPageSelected = eligible.length > 0 && eligible.every(r => !!selected[keyOf(r)]);
    const anyPageSelected = eligible.some(r => !!selected[keyOf(r)]);

    return {
        selected,
        keys: Object.keys(selected),
        items: Object.values(selected),
        entries: Object.entries(selected) as [string, T][],
        count: Object.keys(selected).length,
        isSelected,
        isSelectedKey,
        toggle: (row: T) => setRow(row, !isSelected(row)),
        toggleKey: (key: string) => {
            const row = rows.find(r => keyOf(r) === key);
            if (row) setRow(row, !isSelectedKey(key));
        },
        deselectKey: (key: string) => setSelected(prev => { const n = { ...prev }; delete n[key]; return n; }),
        togglePage: () => setSelected(prev => {
            const next = { ...prev };
            if (allPageSelected) { for (const r of eligible) delete next[keyOf(r)]; }
            else { for (const r of eligible) next[keyOf(r)] = r; }
            return next;
        }),
        allPageSelected,
        someSelected: anyPageSelected && !allPageSelected,
        pageEligibleCount: eligible.length,
        clear: () => setSelected({}),
    };
}

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

const checkboxStyle = (enabled: boolean): React.CSSProperties =>
    ({ margin: 0, cursor: enabled ? 'pointer' : 'not-allowed', verticalAlign: 'middle' });

// The hover ring lives in globals.css (`.lv-check`), not in the style object: an
// inline style can't express `:hover`, and every call site is a bare `<input>`
// with no wrapper to hang a mouseenter on. Both themes get a branch there.
const checkboxClass = () => ('lv-check');

export function RowCheckbox({ checked, onChange, disabled, title, label }: {
    checked: boolean; onChange: () => void;
    disabled?: boolean; title?: string; label?: string;
}) {
    return (
        <input
            type="checkbox"
            className={checkboxClass()}
            style={checkboxStyle(!disabled)}
            checked={checked}
            disabled={disabled}
            title={title}
            aria-label={label ? `Select ${label}` : 'Select row'}
            onChange={onChange}
            // The row around it is usually clickable (expand / open): a tick must
            // never also fire that.
            onClick={e => e.stopPropagation()}
        />
    );
}

/** Header checkbox. Owns the `indeterminate` ref-poke: four views each derived
 *  the partial state from their own `someSelected` expression, and Stock On-Hand
 *  had no partial state at all — its header read as fully unchecked with half
 *  the page ticked. */
export function SelectAllCheckbox({ allSelected, someSelected, onChange, disabled, title }: {
    allSelected: boolean; someSelected: boolean; onChange: () => void;
    disabled?: boolean; title?: string;
}) {
    return (
        <input
            type="checkbox"
            className={checkboxClass()}
            style={checkboxStyle(!disabled)}
            checked={allSelected}
            disabled={disabled}
            ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={onChange}
            title={title ?? (allSelected ? 'Clear selection on this page' : 'Select every row on this page')}
            aria-label={allSelected ? 'Clear selection on this page' : 'Select every row on this page'}
        />
    );
}

/** `<td>` + row checkbox, geometry fixed like ExpanderCell. */
export function RowCheckboxCell({ tdStyle, tdClassName, ...cb }: React.ComponentProps<typeof RowCheckbox> & { tdStyle?: React.CSSProperties; tdClassName?: string }) {
    return (
        <td style={lvCheckTd(tdStyle)} className={tdClassName}>
            <RowCheckbox {...cb} />
        </td>
    );
}

/** `<th>` + select-all checkbox. */
export function SelectAllCell({ tdStyle, tdClassName, ...cb }: React.ComponentProps<typeof SelectAllCheckbox> & { tdStyle?: React.CSSProperties; tdClassName?: string }) {
    return (
        <th style={lvCheckTd(tdStyle)} className={tdClassName}>
            <SelectAllCheckbox {...cb} />
        </th>
    );
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
export const LV_EXPANDER_COL_W = 22;

// `base` is the caller's own cell style (their `tdBase`/`xpTd` with its borders
// and font). It is spread BEFORE the column geometry so the width/alignment of
// the expander column can never drift, while the table keeps its own gridlines.
export const lvExpanderTd = (base: React.CSSProperties = {}): React.CSSProperties => ({
    ...lvTd(),
    ...base,
    width: LV_EXPANDER_COL_W, textAlign: 'center', padding: '3px 4px', verticalAlign: 'middle',
});

export interface ExpandToggleProps {
    expanded: boolean;
    /** Same handler the row's onClick uses. Always pass it: the button stops
     *  propagation, so a row-clickable table does not toggle twice, and the
     *  expander becomes tab-reachable instead of mouse-only. */
    onToggle: () => void;
    /** What is being disclosed, for the screen-reader label ("Show lot lineage"). */
    label?: string;
    /** id of the panel element, for aria-controls. */
    panelId?: string;
    /** `alert` recolours the open glyph when the panel holds a problem
     *  (a Production Run with a material shortfall). */
    tone?: 'default' | 'alert';
    style?: React.CSSProperties;
}

export function ExpandToggle({ expanded, onToggle, label = 'details', panelId, tone = 'default', style }: ExpandToggleProps) {
    const color = tone === 'alert' && expanded ? '#c00000' : ('#0058e6');
    return (
        <button
            type="button"
            // The row itself is usually clickable too; without this the click
            // would toggle twice and land back where it started.
            onClick={e => { e.stopPropagation(); onToggle(); }}
            aria-expanded={expanded}
            aria-controls={panelId}
            title={`${expanded ? 'Hide' : 'Show'} ${label}`}
            aria-label={`${expanded ? 'Hide' : 'Show'} ${label}`}
            className="lv-chev-btn"
            style={{
                background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, color, flexShrink: 0, ...style,
            }}
        >
            {/* Always the right-chevron glyph; "down" is a 90° CSS rotation of it
                (globals.css `.lv-chev`), so hovering can preview the open state
                and spring back when the pointer leaves without a click. Swapping
                bi-chevron-right→bi-chevron-down would have no state to animate
                between. */}
            <i
                className={`bi bi-chevron-right lv-chev${expanded ? ' lv-chev-open' : ''}`}
                style={{ fontSize: 9 }}
                aria-hidden="true"
            />
        </button>
    );
}

/** The dedicated first column: geometry + toggle in one, so a list only ever
 *  writes `<ExpanderCell … />` instead of a `<td>` wrapping an `<i>`. */
export function ExpanderCell({ tdStyle, tdClassName, ...toggle }: ExpandToggleProps & { tdStyle?: React.CSSProperties; tdClassName?: string }) {
    return (
        <td style={lvExpanderTd(tdStyle)} className={tdClassName}>
            <ExpandToggle {...toggle} />
        </td>
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
// Once frozen the colgroup carries one extra `<col>` past the last header cell: an
// empty filler column that owns all the slack. Every real column is then
// independent, the way a spreadsheet behaves — dragging one moves nothing else.
// The two alternatives both failed in use: stretching the table to 100% with no
// filler spreads the surplus over EVERY column, which inflates the narrow ones (a
// 78px Actions column grows and its right-aligned buttons drift off the row), and
// making one real column absorb it means every drag visibly resizes that column
// too. The filler is not a ragged edge either — `tr` backgrounds paint the whole
// row box, so the header band and the zebra run out over it. The table never
// shrinks below the width it had before the first drag either, so pulling a column
// in feeds the filler rather than dragging the whole grid off the pane's edge.
//
// Widths persist per `storageKey` in localStorage. A stored set whose length no
// longer matches the table is discarded rather than mapped — columns were added or
// removed, and a shifted-by-one width set is worse than no width set.
const COLW_MIN = 28;
/** How close to a column border the pointer has to be, in px, to grab it. */
const COLW_GRAB = 5;
/** How far it then has to travel before the drag counts as a drag. */
const COLW_DRAG_START = 3;
// `v5`: the stored shape and the layout maths have both changed more than once, and
// a stale set loads silently because only its length is checked.
const colwStore = (key: string) => `lv.colw.v5.${key}`;

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
export function useColumnWidths(storageKey: string, defaults?: (number | string)[]): ColumnWidths {
    const ref = React.useRef<HTMLTableElement | null>(null);
    const [widths, setWidths] = React.useState<number[] | null>(null);
    const [nearBorder, setNearBorder] = React.useState(false);
    /** The table's full width the first time it was measured — what it spans when it
     *  is laying itself out normally, before any column was dragged. The table is
     *  never allowed below it, so narrowing a column parks the difference in the
     *  filler instead of pulling the whole grid in off the right of the pane.
     *  `max(100%)` alone did not hold that line: on a shrink-to-fit container the
     *  percentage resolves against the table's own width, which is no floor at all. */
    const fullWidth = React.useRef(0);
    const drag = React.useRef<{ i: number; x: number; base: number[]; moved: boolean } | null>(null);
    /** Set by a drag, read by the click that follows it — see `onClickCapture`. */
    const swallowClick = React.useRef(false);

    // localStorage is read in an effect, not during render: these pages are client
    // components but Next still renders them on the server, and a stored width set
    // would hydrate against default-width markup.
    React.useEffect(() => {
        try {
            const raw = localStorage.getItem(colwStore(storageKey));
            if (!raw) return;
            const { w, full } = JSON.parse(raw) ?? {};
            if (Array.isArray(w) && w.length && w.every((n: any) => typeof n === 'number')
                && (!defaults || w.length === defaults.length)) {
                setWidths(w);
                // Restored too, or a reload would drop the floor and the grid would
                // come back pulled in off the pane wherever a column was narrowed.
                if (typeof full === 'number') fullWidth.current = full;
            }
        } catch { /* private mode / bad JSON — the table's own layout is fine */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageKey, defaults?.length]);

    const save = (w: number[] | null) => {
        try {
            if (w) localStorage.setItem(colwStore(storageKey), JSON.stringify({ w, full: fullWidth.current }));
            else localStorage.removeItem(colwStore(storageKey));
        } catch { /* ignore */ }
    };

    const reset = () => { setWidths(null); fullWidth.current = 0; save(null); };

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
     *  gaps between borders partitions the table exactly. */
    const measure = (cells: HTMLTableCellElement[]): number[] => {
        let prev = cells[0].getBoundingClientRect().left;
        return cells.map(c => {
            const right = c.getBoundingClientRect().right;
            const w = right - prev;
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
        fullWidth.current = Math.max(fullWidth.current, base.reduce((a, b) => a + b, 0));
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
        next[d.i] = Math.max(COLW_MIN, Math.round(d.base[d.i] + dx));
        setWidths(next);
    };

    const onPointerUp = (e: React.PointerEvent<HTMLTableElement>) => {
        if (!drag.current) return;
        swallowClick.current = drag.current.moved;
        drag.current = null;
        try { ref.current?.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
        setWidths(w => { save(w); return w; });
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
                // splits it into equal columns. Under 100% the table fills its pane
                // and the filler column takes the slack; over it the table grows and
                // the pane scrolls, with the filler at zero. Either way the real
                // columns keep exactly the widths they were dragged to. `minWidth`
                // is left to the call site's own floor.
                ...(widths ? {
                    tableLayout: 'fixed' as const,
                    width: `max(100%, ${Math.max(fullWidth.current, widths.reduce((a, b) => a + b, 0))}px)`,
                } : {}),
                ...(nearBorder || drag.current ? { cursor: 'col-resize' as const } : {}),
            },
        }),
        cols: () => {
            const real = (defaults ?? widths ?? []).map((d, i) => (
                <col key={i} style={{ width: widths ? widths[i] : (defaults ? (d as number | string) : undefined) }} />
            ));
            // The filler exists only once the columns are frozen; before that the
            // table is still laying itself out and there is no slack to park.
            return widths ? [...real, <col key="filler" />] : real;
        },
        reset,
    };
}

/** A `<table>` whose columns the user can drag, and the way to opt a grid in:
 *  swap the tag, keep the style, keep the children. It owns the `<colgroup>`, so
 *  a grid that hand-writes one passes those widths as `defaults` and deletes it.
 *  `colKey` is the localStorage key — unique per grid, stable across releases. */
export function ResizableTable({ colKey, defaults, style, className, children }: {
    colKey: string;
    defaults?: (number | string)[];
    style?: React.CSSProperties;
    className?: string;
    children?: React.ReactNode;
}) {
    const colw = useColumnWidths(colKey, defaults);
    return (
        <table className={className} {...colw.table(style)}>
            <colgroup>{colw.cols()}</colgroup>
            {children}
        </table>
    );
}
