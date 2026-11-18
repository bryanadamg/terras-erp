'use client';
import React from 'react';
import UIButton from '@bryanadamg/terras-ui/components/Button';
import UIWindow from '@bryanadamg/terras-ui/components/Window';
import { bevel } from '@bryanadamg/terras-ui/styles';
import type { ButtonTone, ShellTone } from '@bryanadamg/terras-ui/types';
import { SearchField as UISearchField } from '@bryanadamg/terras-ui/components/Field';

// Shared "classic outer window" chrome — bevel container + colored title bar +
// toolbar strip. Every dual-theme table/detail view (Sales Orders, Packing,
// Partners, Sample Requests, BOM, Inventory, Purchase Orders, Stock On-Hand,
// Settings tabs, …) hand-declared near-identical copies of these three style
// objects (same `boxShadow: '2px 2px 4px rgba(0,0,0,0.3)'` bevel, same blue
// title-bar gradient, same toolbar strip). Those primitives now live in
// terras-ui: import `bevel` / `titleBar` / `toolbar` from its `styles`, and
// `FilterChipBar`, `SegmentedBar` and `Window`'s `Count` from its components.
// Only what adds this app's wiring (bootstrap icons, the --app-vh page height)
// stays here.

// Title-bar tones. Blue is the default window chrome; the others exist for
// dashboard-style panel stacks where the bar itself carries the severity of what
// it heads (alerts = red, production = amber, informational = grey). Same five
// semantic families as STATUS_FAMILY — don't add a sixth hue here. The bars
// themselves paint from terras-ui's tokens; this table is for chrome that has to
// match a bar without being one (SectionHomeView's tiles).
export type { ShellTone };

export const TITLE_TONES: Record<ShellTone, { background: string; border: string }> = {
    blue:  { background: 'var(--xp-title-blue)', border: 'var(--xp-title-blue-border)' },
    red:   { background: 'linear-gradient(to right, #990000 0%, #cc2222 100%)', border: '#550000' },
    amber: { background: 'linear-gradient(to right, #c07000 0%, #e09830 100%)', border: '#804000' },
    green: { background: 'linear-gradient(to right, #1a7a1a 0%, #2ea42e 100%)', border: '#0a4a0a' },
    grey:  { background: 'linear-gradient(to bottom, #6a6a6a, #4a4a4a)',        border: '#222222' },
};

// ── Toolbar contents ─────────────────────────────────────────────────────────
// terras-ui's `toolbar` style is the strip; these are what goes IN it. Every list
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

// Toolbar-level labeled action buttons — "Create X" / "New X" / "Print" / "Import"
// / "Refresh" — the buttons a list toolbar ends with. Every view that had one of
// these hand-rolled its own copy of the same handful of gradients (a bold green
// "create" CTA, a bold blue "launch" CTA for a distinct action like Production
// Run, and a plain white/grey "neutral" for Print/Import/Refresh) once per
// theme branch. Use this instead of inlining another one.
export type ToolbarButtonTone = 'create' | 'launch' | 'neutral' | 'danger';

// Toolbar intents onto terras-ui's four button tones: the green CTA is `success`,
// the blue second CTA is `primary`. Same faces as every other button in the app,
// rather than the toolbar's own brighter blue and red.
const TOOLBAR_TONE: Record<ToolbarButtonTone, ButtonTone> = {
    create: 'success', launch: 'primary', neutral: 'default', danger: 'danger',
};

export function ToolbarButton({
    tone = 'neutral', icon, children, onClick, disabled = false, testId, title, style,
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
    /** No-op since the modern theme went; still accepted so the Print call sites compile. */
    printable?: boolean;
    title?: string;
    style?: React.CSSProperties;
}) {
    return (
        <UIButton
            tone={TOOLBAR_TONE[tone]}
            icon={icon ? <i className={`bi ${icon}`} /> : undefined}
            data-testid={testId}
            onClick={onClick}
            disabled={disabled}
            title={title}
            style={style}
        >
            {children}
        </UIButton>
    );
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
    // `--shell-inset`: the height the inset shell's gutters and card border take
    // on desktop (globals.css); unset (0) on phones and in print.
    { display: 'flex', flexDirection: 'column', height: 'calc(var(--app-vh) - 80px - var(--shell-inset, 0px))', minHeight: 0 };

export const flexFillStyle: React.CSSProperties =
    { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 };

const fillStyleFor = (fill: ShellFill): React.CSSProperties =>
    fill === 'page' ? pageFillStyle
    : fill === 'flex' ? flexFillStyle
    : {};

/** Inner scroll region: the table's own pane inside a page-filled shell. */
export const scrollAreaStyle: React.CSSProperties =
    { flex: 1, minHeight: 0, overflow: 'auto' };

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
): React.CSSProperties => (bevel({ ...fillStyleFor(fill), ...extra }));

/**
 * Outer-window shell: classic bevel or modern bootstrap card, sized per the
 * standing height convention. Replaces the
 * `style={bevel}` block hand-copied at the top of ~20 views.
 */
export function ShellWindow({ fill = 'page', className, style, children }: {
    /** 'page' = calc(var(--app-vh) - 80px) for a top-level route. 'flex' = flex:1 when nested
     *  under an already-sized parent. false = caller manages its own sizing. */
    fill?: ShellFill;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}) {
    // The package's own `fill` sizes 'page' as height: 100%; this app's page
    // convention is the --app-vh one above, so the sizing stays here. `fill={false}`
    // was a plain block here and stays one (the package frame is always a flex column).
    return (
        <UIWindow
            fill={false}
            className={className}
            style={{ ...(fill === false ? { display: 'block' } : fillStyleFor(fill)), ...style }}
        >
            {children}
        </UIWindow>
    );
}

/**
 * Section title bar inside a page (e.g. the Dashboard's panels): icon + title +
 * right-side actions, tinted by `tone`. Not for a page's own title — the app
 * header already carries that, so a top-of-page bar would just repeat it.
 */
export function ShellTitleBar({ icon, title, right, tone = 'blue' }: {
    icon: string;                 // bootstrap-icons class, e.g. "bi-people-fill"
    title: React.ReactNode;
    right?: React.ReactNode;      // action button(s) — e.g. "+ Add"
    tone?: ShellTone;             // classic-only bar color; modern keeps the white card-header
}) {
    return <UIWindow.TitleBar icon={<i className={`bi ${icon}`} />} title={title} right={right} tone={tone} />;
}
