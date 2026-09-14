'use client';
import React from 'react';
import { xpFont, modernFont, ChipTone, ChipSeg, BUTTON_RADIUS, PANEL_RADIUS, XP_BTN } from './xpTheme';
import UIFilterChipBar from '@bryanadamg/terras-ui/components/FilterChipBar';
import UISegmentedBar from '@bryanadamg/terras-ui/components/SegmentedBar';
import { SearchField as UISearchField } from '@bryanadamg/terras-ui/components/Field';
import { segAt as uiSegAt } from '@bryanadamg/terras-ui/styles';

// Shared "classic outer window" chrome — bevel container + colored title bar +
// toolbar strip. Every dual-theme table/detail view (Sales Orders, Packing,
// Partners, Sample Requests, BOM, Inventory, Purchase Orders, Stock On-Hand,
// Settings tabs, …) hand-declared near-identical copies of these three style
// objects (same `boxShadow: '2px 2px 4px rgba(0,0,0,0.3)'` bevel, same blue
// title-bar gradient, same toolbar strip) — this is the single source now.
// Migrate a view's local copy when you touch it; don't hand-roll a new one.

// `overflow: hidden` is part of the chrome, not a caller concern: the title bar,
// toolbar and table inside are all square-cornered, so without the clip they poke
// out of PANEL_RADIUS. It clips at the padding box (radius minus the 2px bevel),
// which is what makes the bar's corner read as one curve with the frame's.
export const xpBevel = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    boxShadow: '2px 2px 4px rgba(0,0,0,0.3)', background: '#ece9d8',
    borderRadius: PANEL_RADIUS, overflow: 'hidden',
    ...extra,
});

// Title-bar tones. Blue is the default window chrome; the others exist for
// dashboard-style panel stacks where the bar itself carries the severity of what
// it heads (alerts = red, production = amber, informational = grey). Same five
// semantic families as STATUS_FAMILY — don't add a sixth hue here.
export type ShellTone = 'blue' | 'red' | 'amber' | 'green' | 'grey';

export const TITLE_TONES: Record<ShellTone, { background: string; border: string }> = {
    blue:  { background: 'var(--xp-title-blue)', border: 'var(--xp-title-blue-border)' },
    red:   { background: 'linear-gradient(to right, #990000 0%, #cc2222 100%)', border: '#550000' },
    amber: { background: 'linear-gradient(to right, #c07000 0%, #e09830 100%)', border: '#804000' },
    green: { background: 'linear-gradient(to right, #1a7a1a 0%, #2ea42e 100%)', border: '#0a4a0a' },
    grey:  { background: 'linear-gradient(to bottom, #6a6a6a, #4a4a4a)',        border: '#222222' },
};

export const xpTitleBar = (extra: React.CSSProperties = {}, tone: ShellTone = 'blue'): React.CSSProperties => ({
    background: TITLE_TONES[tone].background, color: '#ffffff',
    fontFamily: xpFont, fontSize: 12, fontWeight: 'bold', padding: '4px 8px',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)', borderBottom: `1px solid ${TITLE_TONES[tone].border}`,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 26,
    ...extra,
});

export const xpToolbar = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898',
    padding: '3px 6px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const,
    ...extra,
});

// ── Toolbar contents ─────────────────────────────────────────────────────────
// `xpToolbar` above is the strip; these three are what goes IN it. Every list
// view was hand-rolling the same three things with a different look each time:
// a search box (5 distinct shapes across ~17 views — loose icon + xpInput,
// bootstrap `input-group`, absolutely-positioned icon + `paddingLeft: 24`, a
// bordered mobile flex row, and ManufacturingSearchBar's own copy), a status
// filter chip row (3 shapes), and a "N orders" count (4 font/color combos, two
// of which used a `'Tahoma, Arial, sans-serif'` stack that isn't `xpFont`).
// Use these; don't re-declare the shapes per view.

/**
 * Search box for a list toolbar. One shape in both themes: icon inset on the
 * left, clear "x" on the right once there's a value (previously only
 * ManufacturingSearchBar offered it). `grow` makes it flex to fill the toolbar
 * row up to `width`; otherwise `width` is fixed.
 */
export function SearchField({
    value, onChange, placeholder = 'Search...', width = 200, grow = false,
    icon = 'bi-search', title, autoFocus = false, style,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    /** Fixed width, or the max width when `grow`. */
    width?: number;
    grow?: boolean;
    /** bootstrap-icons class — `bi-person`, `bi-upc-scan`, … for a non-generic field. */
    icon?: string;
    title?: string;
    autoFocus?: boolean;
    style?: React.CSSProperties;
}) {
    return (
        <UISearchField
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            width={width}
            grow={grow}
            // The package takes the icon as a NODE (it ships no icon set); this app
            // draws with bootstrap-icons, so the class string stays the prop the 36
            // call sites pass and the element is built here.
            icon={icon ? <i className={`bi ${icon}`} /> : undefined}
            title={title}
            autoFocus={autoFocus}
            style={style}
        />
    );
}

/**
 * The "N orders" / "N stations" tally that sits at the end of a list toolbar.
 * `right` pushes it to the far end of the flex row (the common case).
 */
export function ToolbarCount({ children, right = false, style }: {
    children: React.ReactNode;
    right?: boolean;
    style?: React.CSSProperties;
}) {
    return (
        <span style={{
            flexShrink: 0, whiteSpace: 'nowrap',
            ...(right ? { marginLeft: 'auto' } : {}),
            ...({ fontFamily: xpFont, fontSize: 11, color: '#333333' }),
            ...style,
        }}>
            {children}
        </span>
    );
}

// Toolbar-level labeled action buttons — "Create X" / "New X" / "Print" / "Import"
// / "Refresh" — the buttons a list toolbar ends with. Every view that had one of
// these hand-rolled its own copy of the same handful of gradients (a bold green
// "create" CTA, a bold blue "launch" CTA for a distinct action like Production
// Run, and a plain white/grey "neutral" for Print/Import/Refresh) once per
// theme branch. Use this instead of inlining another one.
export type ToolbarButtonTone = 'create' | 'launch' | 'neutral' | 'danger';

const TOOLBAR_BTN_CLASSIC: Record<ToolbarButtonTone, React.CSSProperties> = {
    create:  { background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', fontWeight: 'bold' },
    launch:  { background: 'linear-gradient(to bottom, #5a9ae0, #0058e6)', borderColor: '#003080 #001840 #001840 #003080', color: '#ffffff', fontWeight: 'bold' },
    neutral: { background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#000000' },
    danger:  { background: 'linear-gradient(to bottom, #ff6060, #cc0000)', borderColor: '#800000 #4a0000 #4a0000 #800000', color: '#ffffff' },
};

const TOOLBAR_BTN_MODERN: Record<ToolbarButtonTone, string> = {
    create: 'btn-success text-white',
    launch: 'btn-primary',
    neutral: 'btn-outline-secondary',
    danger: 'btn-danger',
};

export function ToolbarButton({
    tone = 'neutral', icon, children, onClick, disabled = false, testId, printable = false, title, style,
}: {
    /** create = green CTA ("Add X"/"Create"/"New Lot"). launch = blue CTA for a
     * second, distinct create-like action on the same toolbar (e.g. "New
     * Production Run" next to a green "New MO"). neutral = Print/Import/Refresh. */
    tone?: ToolbarButtonTone;
    icon?: string; // bootstrap-icon suffix, e.g. 'bi-plus-lg'
    children: React.ReactNode;
    onClick: (e: React.MouseEvent) => void;
    disabled?: boolean;
    testId?: string;
    /** Tags the modern button `btn-print` (picked up by the classic-theme CSS
     * override) — pass for the Print action specifically. */
    printable?: boolean;
    title?: string;
    style?: React.CSSProperties;
}) {
    return (
        <button
            type="button"
            data-testid={testId}
            className={XP_BTN}
            onClick={onClick}
            disabled={disabled}
            title={title}
            style={{
                fontFamily: xpFont, fontSize: '11px', padding: '2px 10px',
                cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
                border: '1px solid', borderRadius: BUTTON_RADIUS,
                ...TOOLBAR_BTN_CLASSIC[tone],
                ...style,
            }}
        >
            {icon && <i className={`bi ${icon}`} style={{ marginRight: 4 }}></i>}
            {children}
        </button>
    );
}

export type FilterChipOption = {
    value: string;
    label?: React.ReactNode;
    count?: number;
    /** Selected-fill colour when the value carries its own semantics (In=green, Out=red). */
    tone?: ChipTone;
    title?: string;
    /** Disables just this segment — a per-row/per-value lock, distinct from the bar-level `disabled`. */
    disabled?: boolean;
};

/** Segment position for the i-th of `len` members of a flush group. Re-exported
 *  from terras-ui so the two bars below and the package's own segment geometry
 *  can't disagree about which end is which. */
export const segAt = (i: number, len: number): ChipSeg => uiSegAt(i, len);

/**
 * Status-filter row for a list toolbar — **segmented**: the buttons sit flush
 * against each other as one control, not as loose pills. That is the app-wide
 * shape for "pick one of these" (see also `SegmentedBar` for stateless action
 * groups); don't re-space it per view.
 *
 * Built on `ToggleChip` so a selected filter looks like every other selected
 * thing in the app — the views that hand-rolled this (SO/PO/Samples inline XP
 * gradient, Lab Dips' own `primaryToolbarBtn`, the libraries' `lvPrimaryBtn`,
 * Dispatch's `#d0e4ff` xpBtn, the Calendar's bootstrap-only pair) each had a
 * different "selected" blue. Pass `count` on an option to render "PENDING (4)".
 *
 * `value` takes an array for multi-select bars (the Calendar's status set); the
 * caller does the add/remove in `onChange`.
 *
 * Now a thin adapter over terras-ui's FilterChipBar, which was extracted from
 * this one — identical option shape, identical geometry, and it builds on the
 * same `ToggleChip` this app already gets from the package. The 23 call sites
 * are untouched.
 */
export function FilterChipBar({ options, value, onChange, disabled, trailing, flat, style }: {
    /** Plain strings, or `{ value, label, count, tone }` for a tally / coloured fill. */
    options: (string | FilterChipOption)[];
    /** Selected value, or the selected set when the bar is multi-select. */
    value: string | string[] | null;
    onChange: (v: string) => void;
    /** Disables every segment — a whole-bar lock (permission, busy, row locked). */
    disabled?: boolean;
    /** Extra segment(s) appended after the options, flush with the last one — an
     * "undo"/clear action that isn't itself a selectable value. */
    trailing?: React.ReactNode;
    /** Flat idle face instead of the raised XP gradient — see `ToggleChip`. */
    flat?: boolean;
    style?: React.CSSProperties;
}) {
    return (
        <UIFilterChipBar
            options={options}
            value={value}
            onChange={onChange}
            disabled={disabled}
            trailing={trailing}
            flat={flat}
            style={style}
        />
    );
}

export type SegmentedAction = { key: string; label: React.ReactNode; onClick: () => void; title?: string; disabled?: boolean };

/**
 * The stateless sibling of `FilterChipBar`: a flush group of plain actions with
 * no selected member — the date-range presets ("Today | 7d | 30d | Month") that
 * ReportsView and MachineOutputReportView each hand-rolled twice (once per
 * theme). Same segment geometry, so a preset row and a filter row read as the
 * same control. Also a terras-ui adapter; the package adds a whole-bar and a
 * per-action `disabled` this never had.
 *
 * If a member should stay lit after the click it is a filter, not an action —
 * use `FilterChipBar`.
 */
export function SegmentedBar({ actions, disabled, style }: {
    actions: SegmentedAction[];
    /** Disables every segment. */
    disabled?: boolean;
    style?: React.CSSProperties;
}) {
    return <UISegmentedBar actions={actions} disabled={disabled} style={style} />;
}

export type ShellFill = 'page' | 'flex' | false;

// The standing height convention for a top-level list route: fill the viewport
// below the app chrome and let the table inside own the scrolling.
//
// `--app-vh` — never `100vh`. On mobile Safari/Chrome `100vh` counts the URL bar
// that is not actually there, so the page ran taller than the window and the
// pager fell off the bottom; layout.tsx keeps `--app-vh` in sync with the real
// viewport. `minHeight: 0` is load-bearing too: without it a flex child with an
// overflowing table refuses to shrink and the scroll pane collapses.
//
// Twelve views wrote this object out by hand rather than going through
// ShellWindow; `pageFillStyle`/`flexFillStyle` let those keep their own JSX while
// still reading the convention from one place.
export const pageFillStyle: React.CSSProperties =
    { display: 'flex', flexDirection: 'column', height: 'calc(var(--app-vh) - 80px)', minHeight: 0 };

export const flexFillStyle: React.CSSProperties =
    { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 };

const fillStyleFor = (fill: ShellFill): React.CSSProperties =>
    fill === 'page' ? pageFillStyle
    : fill === 'flex' ? flexFillStyle
    : {};

/** Inner scroll region: the table's own pane inside a page-filled shell. */
export const scrollAreaStyle: React.CSSProperties =
    { flex: 1, minHeight: 0, overflow: 'auto' };

// Modern-theme counterpart of `xpBevel`, for the ~9 page shells that don't wear a
// bootstrap `card` in modern (Colors, Color/Combo Library, Attributes, Lab Dips,
// Dyeing & Setting, …). They each hand-declared this same flat frame with
// `borderRadius: 9`, which is off the radius scale — the shell tier is
// PANEL_RADIUS (8), the same number a dialog and `.card.shell-window` use, so a
// page frame and the dialog over it read as one chrome language.
// `overflow: hidden` is part of the frame for the same reason it is in `xpBevel`:
// the square title bar/toolbar inside must be clipped by the corner.
export const modernBevel = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    border: '1px solid #dbe1ea', borderRadius: PANEL_RADIUS, background: '#f8fafc',
    overflow: 'hidden',
    ...extra,
});

/**
 * THE outer frame of a top-level view, both themes, sized per `fill`. Same job as
 * `ShellWindow` but as a style object, for the views that keep their own JSX
 * (they need the classic/modern branch inline, or a `className` of their own).
 *
 * Use this instead of writing the bevel out by hand: a hand-rolled copy is how
 * BOM/MO/PR/WO/Colors/Attributes/Lab Dips all missed the shell radius (BOM had
 * `borderRadius: 0` pinned) while every migrated view rounded.
 */
export const viewShellStyle = (
    fill: ShellFill = 'page', extra: React.CSSProperties = {},
): React.CSSProperties => (xpBevel({ ...fillStyleFor(fill), ...extra }));

/**
 * Outer-window shell: classic bevel or modern bootstrap card, sized per the
 * standing height convention. Replaces the
 * `style={xpBevel}` block hand-copied at the top of ~20 views.
 */
export function ShellWindow({ fill = 'page', className, style, children }: {
    /** 'page' = calc(var(--app-vh) - 80px) for a top-level route. 'flex' = flex:1 when nested
     *  under an already-sized parent. false = caller manages its own sizing. */
    fill?: ShellFill;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}) {
    const fillStyle = fillStyleFor(fill);
    return (
        <div
            style={{ ...xpBevel(), ...fillStyle, ...style }}
            className={className}
        >
            {children}
        </div>
    );
}

/**
 * Page title bar — icon + label, no actions, no bootstrap card chrome. The shape
 * seven page shells (Colors, Color Library, Combo Library, Attributes, Settings,
 * Dyeing & Setting, Lab Dips) each declared by hand, byte-for-byte the same pair
 * of style objects: classic = the blue gradient bar, modern = a pale flat header
 * with a blue icon. That is why the window-focus swap had to touch seven files;
 * with this, the gradient appears in exactly two places in the whole app
 * (`TITLE_TONES` here, and ModalWrapper/PrintModalShell for a window that must
 * NOT dim itself).
 *
 * Use `ShellTitleBar` instead when the bar carries right-side actions or needs
 * the bootstrap card-header look in modern.
 */
export function PageTitleBar({ icon, title, right, style }: {
    icon: string;                 // bootstrap-icons class, e.g. "bi-palette2"
    title: React.ReactNode;
    right?: React.ReactNode;
    style?: React.CSSProperties;
}) {
    // Classic geometry comes from `xpTitleBar`, not a second set of numbers: this
    // used to carry its own `padding: '6px 12px'` / `fontSize: 13`, which rendered
    // the seven PageTitleBar pages (Colors, Color/Combo Library, Attributes, Lab
    // Dips, Dyeing & Setting, Settings) with a visibly taller bar than every
    // xpTitleBar page next to them. One bar height, app-wide.
    const base: React.CSSProperties = xpTitleBar({ justifyContent: 'flex-start', gap: 8, flexShrink: 0 });
    return (
        <div style={{ ...base, ...style }}>
            <i className={`bi ${icon}`} style={undefined} />
            {title}
            {right && <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>{right}</span>}
        </div>
    );
}

/**
 * Title bar: icon + title (+ optional modern-only subtitle caption) + right-side
 * actions. Classic renders the blue-gradient bar; modern renders a bootstrap
 * card-header with an h5 + optional caption — matches SalesOrderView, PartnersView,
 * SampleRequestView, PackingView, BOMView, and the Settings tabs.
 */
export function ShellTitleBar({ icon, title, subtitle, right, tone = 'blue' }: {
    icon: string;                 // bootstrap-icons class, e.g. "bi-people-fill"
    title: React.ReactNode;
    subtitle?: React.ReactNode;   // modern-only caption line under the title
    right?: React.ReactNode;      // action button(s) — e.g. "+ Add"
    tone?: ShellTone;             // classic-only bar color; modern keeps the white card-header
}) {
    return (
        <div style={xpTitleBar({}, tone)}>
            <span><i className={`bi ${icon}`} style={{ marginRight: 6 }} />{title}</span>
            {right}
        </div>
    );
}
