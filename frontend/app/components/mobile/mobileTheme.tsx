'use client';

import React from 'react';
import { xpFont as XP_FONT, BUTTON_RADIUS, XP_BTN } from '../shared/xpTheme';
import {
    xpBevel, xpTitleBar, xpToolbar, ShellTone,
    SearchField, FilterChipBar, FilterChipOption,
} from '../shared/shellTheme';

// Mobile chrome, built on the SAME classic primitives the desktop views use
// (`xpBevel` / `xpTitleBar` / `xpToolbar` / `SearchField` / `FilterChipBar`), so a
// phone screen reads as the same product as the sidebar app instead of as a
// separate skin. Before this, each of the six mobile views carried its own
// `xpPanel` + `xpSectionLabel` + `xpBtn` copy and a section heading was plain grey
// uppercase text — nothing like the blue-gradient window headers on the desktop.
//
// Only the *sizing* is mobile here: touch targets and type come up a step via the
// `.mobile-field` / `.mobile-seg` classes in globals.css. Colors, borders,
// gradients and fonts all come from the shared source — never re-declare them.

export const MOBILE_BG = '#ece9d8';   // --win-bg, same as the classic desktop page
export const MOBILE_FACE = '#f5f4ef'; // raised card face inside a panel

/**
 * Inline status banner — the scan screens' error / confirmation strip.
 *
 * The three scan views each carried their own copy of this div, and they had
 * drifted: two paddings, two font sizes, bold on one screen only, and two
 * different greens. Severity comes from the shared `ShellTone` vocabulary rather
 * than a fresh palette, so a red strip on the floor is the same red as a red
 * panel header. This is the *inline* surface (it stays put while the packer works
 * a form); a transient message on a desktop view is still `useToast`.
 */
const NOTICE_TONES: Record<ShellTone, { background: string; border: string; color: string }> = {
    red:   { background: '#ffe8e8', border: '#cc0000', color: '#880000' },
    green: { background: '#eef7ee', border: '#2d7a2d', color: '#0a3e0a' },
    amber: { background: '#fff4e5', border: '#d9a441', color: '#7a4a00' },
    blue:  { background: '#eaf1fb', border: '#7f9db9', color: '#00309c' },
    grey:  { background: '#f5f4ef', border: '#aca899', color: '#555555' },
};

export function MobileNotice({ tone = 'red', strong = false, children, style }: {
    tone?: ShellTone;
    /** Floor-critical lines (a scan result the packer reads at arm's length). */
    strong?: boolean;
    children: React.ReactNode;
    style?: React.CSSProperties;
}) {
    const t = NOTICE_TONES[tone];
    return (
        <div style={{
            fontFamily: XP_FONT,
            fontSize: strong ? 13 : 12,
            fontWeight: strong ? 'bold' : 'normal',
            background: t.background,
            border: `1px solid ${t.border}`,
            color: t.color,
            padding: '7px 10px',
            marginBottom: 10,
            ...style,
        }}>
            {children}
        </div>
    );
}

/** Raised card — a row/tile inside a `MobilePanel`. */
export const mobileCard = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    border: '2px solid',
    borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
    background: MOBILE_FACE,
    borderRadius: 0,
    ...extra,
});

/** Sunken white surface — lists, breakdowns, readouts. */
export const mobileInset = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    border: '2px solid',
    borderColor: '#808080 #dfdfdf #dfdfdf #808080',
    background: '#ffffff',
    borderRadius: 0,
    ...extra,
});

/**
 * Groupbox window: bevel + blue-gradient title bar + body. The mobile counterpart
 * of `ShellWindow` + `ShellTitleBar` — one per screen section, replacing the
 * borderless "SYSTEM STATUS" text labels the mobile views used to head sections
 * with. `tone` follows `ShellTone` so a panel can carry severity (red alerts,
 * amber production) exactly like a desktop dashboard panel stack.
 */
export function MobilePanel({
    icon, title, right, tone = 'blue', pad = 8, bodyStyle, style, children,
}: {
    icon?: string;              // bootstrap-icons class
    title: React.ReactNode;
    right?: React.ReactNode;    // action(s) in the title bar
    tone?: ShellTone;
    /** Body padding; 0 for a flush list that draws its own row rules. */
    pad?: number;
    bodyStyle?: React.CSSProperties;
    style?: React.CSSProperties;
    children: React.ReactNode;
}) {
    return (
        <div style={{ ...xpBevel(), ...style }}>
            <div style={xpTitleBar({ fontSize: 12, minHeight: 26, padding: '5px 8px' }, tone)}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    {icon && <i className={`bi ${icon}`} aria-hidden="true" />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
                </span>
                {right && <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>{right}</span>}
            </div>
            <div style={{ padding: pad, ...bodyStyle }}>{children}</div>
        </div>
    );
}

/**
 * Screen-level heading bar for a full-screen mobile flow (the scan terminals):
 * the same blue-gradient bar a desktop window wears, with an optional meta line
 * and a right-side action. The scan views used to head themselves with plain
 * bold text, so they read as a different app from every list screen.
 */
export function MobileScreenBar({ icon, title, meta, right, tone = 'blue' }: {
    icon?: string;
    title: React.ReactNode;
    meta?: React.ReactNode;
    right?: React.ReactNode;
    tone?: ShellTone;
}) {
    return (
        <div style={{ ...xpBevel(), marginBottom: 10 }}>
            <div style={xpTitleBar({ fontSize: 13, minHeight: 30, padding: '5px 8px' }, tone)}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    {icon && <i className={`bi ${icon}`} aria-hidden="true" />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {meta && <span style={{ fontFamily: XP_FONT, fontSize: 10, fontWeight: 'normal', opacity: 0.85 }}>{meta}</span>}
                    {right}
                </span>
            </div>
        </div>
    );
}

/** Toolbar strip inside a panel — search / filters / count, same as a desktop list. */
export function MobileToolbar({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
    return <div style={xpToolbar({ padding: '5px 6px', gap: 5, ...style })}>{children}</div>;
}

/** Shared `SearchField`, touch-sized. */
export function MobileSearchField(props: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    icon?: string;
    autoFocus?: boolean;
    title?: string;
}) {
    return (
        <div className="mobile-field" style={{ display: 'flex', flex: 1, minWidth: 0 }}>
            <SearchField {...props} grow width={9999} style={{ flex: 1, maxWidth: 'none' }} />
        </div>
    );
}

/** Shared `FilterChipBar`, touch-sized and stretched across the row. */
export function MobileFilterBar({ options, value, onChange }: {
    options: (string | FilterChipOption)[];
    value: string | string[] | null;
    onChange: (v: string) => void;
}) {
    return (
        <div className="mobile-seg" style={{ display: 'flex', width: '100%' }}>
            <FilterChipBar options={options} value={value} onChange={onChange} style={{ flex: 1, display: 'flex' }} />
        </div>
    );
}

/** Empty / placeholder row inside a panel. */
export function MobileEmpty({ children }: { children: React.ReactNode }) {
    return (
        <div style={mobileInset({ padding: 18, textAlign: 'center', color: '#666', fontFamily: XP_FONT, fontSize: 12 })}>
            {children}
        </div>
    );
}

export type MobileBtnTone = 'create' | 'launch' | 'neutral' | 'danger';

const BTN_TONES: Record<MobileBtnTone, React.CSSProperties> = {
    create:  { background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#fff', fontWeight: 'bold' },
    launch:  { background: 'linear-gradient(to bottom, #5a9ae0, #0058e6)', borderColor: '#003080 #001840 #001840 #003080', color: '#fff', fontWeight: 'bold' },
    neutral: { background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#000' },
    danger:  { background: 'linear-gradient(to bottom, #ff6060, #cc0000)', borderColor: '#800000 #4a0000 #4a0000 #800000', color: '#fff', fontWeight: 'bold' },
};

/**
 * Touch-sized button in the shared toolbar tones (`ToolbarButton`'s classic
 * palette). Kept separate from `ToolbarButton` only because a floor button needs
 * a finger-sized hit box; the faces are the same four.
 */
export function MobileButton({
    tone = 'neutral', icon, children, onClick, disabled = false, title, compact = false, style,
}: {
    tone?: MobileBtnTone;
    icon?: string;
    children?: React.ReactNode;
    onClick: (e: React.MouseEvent) => void;
    disabled?: boolean;
    title?: string;
    /** In-title-bar size, for an action sitting in a panel header. */
    compact?: boolean;
    style?: React.CSSProperties;
}) {
    return (
        <button
            type="button"
            className={XP_BTN}
            onClick={onClick}
            disabled={disabled}
            title={title}
            style={{
                fontFamily: XP_FONT,
                fontSize: compact ? 11 : 12,
                padding: compact ? '2px 8px' : '7px 12px',
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                border: '1px solid',
                borderRadius: BUTTON_RADIUS,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                ...BTN_TONES[tone],
                ...style,
            }}
        >
            {icon && <i className={`bi ${icon}`} aria-hidden="true" />}
            {children}
        </button>
    );
}
