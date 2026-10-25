'use client';

import React, { useEffect, useId } from 'react';
import UIModal from '@bryanadamg/terras-ui/components/Modal';
import UIWindowCloseButton from '@bryanadamg/terras-ui/components/WindowCloseButton';
import type { ShellTone } from '@bryanadamg/terras-ui/types';
import { MODAL_Z } from './zLayers';

// Shared z-index tier for anything that must render as an overlay but can't use
// ModalWrapper directly (e.g. a full-screen designer canvas with its own custom
// chrome) — keeps it in the same stacking order as regular modals instead of an
// arbitrary one-off number. Defined in `zLayers` alongside the tiers above it and
// re-exported here, which is where every caller already imports it from.
export { MODAL_Z };

// Fired on every drag-move of a modeless modal panel. The panel's position is
// updated by mutating the DOM transform directly (no React re-render, no native
// resize/scroll event) — anything anchoring a portaled overlay to the panel
// (e.g. SearchableSelect, TreeSelect dropdowns) must listen for this to stay glued.
export const MODAL_REPOSITION_EVENT = UIModal.REPOSITION_EVENT;

// ── Window focus: the page chrome behind an open window goes "inactive" ──────
// XP's own answer to "which window am I typing in": the focused window keeps the
// saturated blue title bar, everything behind it desaturates. Without it the app
// header, the list panel's title bar and the dialog's title bar all painted the
// SAME blue gradient, so a modal read as part of the page it floated over.
// The signal is one class on <body>; the dimming itself is CSS custom properties
// (--xp-title-blue / --xp-title-blue-border in globals.css) read by the shared
// chrome primitives — `PageTitleBar`/`xpTitleBar`/`TITLE_TONES` in shellTheme.tsx
// and `.classic-header` — so no view declares the gradient and none had to change.
// terras-ui's title bars read --terras-title-blue, which globals.css bridges onto
// the same pair. A window must not dim itself: globals.css pins every
// [role="dialog"] back to the active blue.
const CHROME_INACTIVE_CLASS = 'window-chrome-inactive';
let openWindowCount = 0;

/**
 * Marks the page chrome inactive while `active` is true. Refcounted, so nested
 * windows (levels 1-3) and print dialogs stack without the first one to close
 * un-dimming the page under the others.
 */
export function useInactiveChromeWhileOpen(active: boolean) {
    useEffect(() => {
        if (!active || typeof document === 'undefined') return;
        openWindowCount += 1;
        document.body.classList.add(CHROME_INACTIVE_CLASS);
        return () => {
            openWindowCount = Math.max(0, openWindowCount - 1);
            if (openWindowCount === 0) document.body.classList.remove(CHROME_INACTIVE_CLASS);
        };
    }, [active]);
}

/**
 * The window close button — one face for every window title bar (ModalWrapper's
 * dialogs AND PrintModalShell's print previews). A thin adapter over terras-ui's
 * WindowCloseButton, which was extracted from this file and moved the red hover
 * out of React state into a `.terras-win-close` rule in terras-ui/chrome, and
 * lifts like every other button here through the package's own `.terras-btn`.
 * Print modals used to render a bare text glyph with no chrome at all, which is
 * the drift this replaces — a print preview is a window, so its close button is
 * the same close button.
 */
export function WindowCloseButton({ onClose }: { onClose: () => void }) {
    return <UIWindowCloseButton onClose={onClose} />;
}

interface ModalWrapperProps {
    isOpen: boolean;
    onClose: () => void;
    title: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    level?: 1 | 2 | 3;
    size?: 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
    variant?: 'primary' | 'success' | 'warning' | 'info' | 'danger' | 'dark' | 'secondary';
    /**
     * Modeless window: no backdrop, background page stays interactive,
     * panel is draggable by its title bar. Ignored on mobile (falls back
     * to a normal blocking modal). Used for creation/edit forms and
     * ConfirmModal (all confirm() dialogs, including delete confirmations).
     */
    modeless?: boolean;
    /**
     * Full-bleed strip between the title bar and the padded body — for chrome that
     * belongs to the WINDOW rather than to its content: a tab strip, a mode switch,
     * a toolbar. Passing tabs as `children` instead leaves them floating inside the
     * body's 12/14px padding, so their background stops short of the frame on three
     * sides and reads as a loose band rather than window chrome.
     */
    banner?: React.ReactNode;
    /**
     * Set false when children manage their own internal scroll regions
     * (e.g. a designer with its own scrollable panels) — prevents a
     * second, near-empty scrollbar on the body wrapper itself.
     */
    bodyScroll?: boolean;
}

// Variant -> terras-ui title tone. The package carries five tones, the same five
// families as STATUS_FAMILY; `info` and `dark` were the two this app had beyond
// them, and fold into blue and grey.
const VARIANT_TONE: Record<NonNullable<ModalWrapperProps['variant']>, ShellTone> = {
    primary: 'blue', info: 'blue', success: 'green', warning: 'amber',
    danger: 'red', dark: 'grey', secondary: 'grey',
};

// Window title-bar gradients, exported because chrome OUTSIDE a window sometimes
// has to match one: the weaving monitor's loom card paints its status strip with
// the same gradient the machine window opens with, so the window reads as that
// tile zoomed in. Read off the same tokens the window's title bar paints from;
// blue is the never-dimmed one, because the window it matches never dims.
export const xpTitleGradients: Record<string, string> = Object.fromEntries(
    Object.entries(VARIANT_TONE).map(([variant, tone]) =>
        [variant, tone === 'blue' ? 'var(--xp-title-blue-active)' : `var(--terras-title-${tone})`]),
);

const xpSizeWidths: Record<string, number> = { sm: 340, md: 480, lg: 640, xl: 820, xxl: 1100 };

/**
 * The app's dialog — a thin adapter over terras-ui's Modal, which was extracted
 * from this one and owns the chrome, the Escape stack, the focus trap, the
 * backdrop and the modeless drag. Kept as a local module so the ~45 call sites
 * keep their `isOpen`/`size`/`variant`/`banner` props and stay untouched.
 *
 * What stays here is app-side: the window-focus dimming, the size scale, the
 * `.ui-style-classic` body that Bootstrap's control overrides key off, and the
 * `banner` strip, which sits outside the scrolling body so its background reaches
 * both frame edges.
 */
export default function ModalWrapper({
    isOpen, onClose, title, children, footer, banner,
    level = 1, size = 'md', variant = 'primary', modeless = false, bodyScroll = true
}: ModalWrapperProps) {
    const titleId = useId();

    useInactiveChromeWhileOpen(isOpen);

    if (!isOpen) return null;

    return (
        <UIModal
            onClose={onClose}
            modeless={modeless}
            layer={level}
            tone={VARIANT_TONE[variant] || 'blue'}
            width={xpSizeWidths[size] || 480}
            aria-labelledby={titleId}
            // A dialog renders where it is mounted, often inside a clickable row
            // or card — a click inside it must not reach that parent's handler.
            onClick={e => e.stopPropagation()}
            style={{
                maxWidth: 'calc(var(--app-vw) * 96 / 100)',
                // Modeless panels open just under the header. Inert on a blocking
                // dialog, which is not positioned.
                top: 56,
                // The panel can render as a direct child of a Bootstrap .row, whose
                // `.row > *` rule injects gutter padding/margin — neutralize it.
                padding: 0,
            }}
            bodyStyle={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'none' }}
            title={
                <span id={titleId} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title}
                </span>
            }
            footer={footer && (
                // Buttons don't shrink (see lvBtn/xpBtn), so a footer too narrow for
                // them wraps to a second row instead of overflowing the window.
                // `alignItems: center` keeps a one-line button aligned with a hint
                // that has wrapped to two or three.
                <div style={{
                    flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
                    flexWrap: 'wrap', gap: 4, rowGap: 6,
                }}>
                    {footer}
                </div>
            )}
        >
            {/* Full-bleed window chrome (tab strip, toolbar) — outside the scroll
                region so its background reaches both frame edges. */}
            {banner && <div className="ui-style-classic" style={{ flexShrink: 0 }}>{banner}</div>}

            {/* Body — ui-style-classic triggers CSS overrides for Bootstrap controls */}
            <div
                className="ui-style-classic"
                style={{
                    padding: '12px 14px', overflowY: bodyScroll ? 'auto' : 'hidden',
                    background: 'linear-gradient(to bottom, #f1efe5 0%, #e5e2d3 100%)',
                    flex: 1, minHeight: 0,
                }}
            >
                {children}
            </div>
        </UIModal>
    );
}
