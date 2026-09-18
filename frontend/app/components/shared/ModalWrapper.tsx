'use client';

import React, { useRef, useEffect, useId } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { toLayoutPx } from '@bryanadamg/terras-ui/scale';
import UIWindowCloseButton from '@bryanadamg/terras-ui/components/WindowCloseButton';
import { xpFont, XP_BTN, WINDOW_RADIUS, WINDOW_RADIUS_INNER } from './xpTheme';
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
export const MODAL_REPOSITION_EVENT = 'terras-modal-reposition';

// Stack of open modals so Escape only closes the topmost one (nested levels 1-3).
const escStack: Array<() => void> = [];
let escListenerAttached = false;

function ensureEscListener() {
    if (escListenerAttached || typeof window === 'undefined') return;
    escListenerAttached = true;
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && escStack.length > 0) {
            e.stopPropagation();
            escStack[escStack.length - 1]();
        }
    });
}

// ── Window focus: the page chrome behind an open window goes "inactive" ──────
// XP's own answer to "which window am I typing in": the focused window keeps the
// saturated blue title bar, everything behind it desaturates. Without it the app
// header, the list panel's title bar and the dialog's title bar all painted the
// SAME blue gradient, so a modal read as part of the page it floated over.
// The signal is one class on <body>; the dimming itself is CSS custom properties
// (--xp-title-blue / --xp-title-blue-border in globals.css) read by the shared
// chrome primitives — `PageTitleBar`/`xpTitleBar`/`TITLE_TONES` in shellTheme.tsx
// and `.classic-header` — so no view declares the gradient and none had to change.
// Windows keep a literal gradient instead: a window must not dim itself.
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
 * out of React state into a `.terras-win-close` rule in terras-ui/chrome. It
 * keeps `.xp-btn` as well, so it still lifts like every other button here.
 * Print modals used to render a bare text glyph with no chrome at all, which is
 * the drift this replaces — a print preview is a window, so its close button is
 * the same close button.
 */
export function WindowCloseButton({ onClose }: { onClose: () => void }) {
    return <UIWindowCloseButton onClose={onClose} className={`${XP_BTN} terras-btn terras-win-close`} />;
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

// Window title-bar gradients, exported because chrome OUTSIDE a window sometimes
// has to match one: the weaving monitor's loom card paints its status strip with
// the same gradient the machine window opens with, so the window reads as that
// tile zoomed in. Don't fork a near-copy of these values in a view.
export const xpTitleGradients: Record<string, string> = {
    primary: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)',
    success: 'linear-gradient(to right, #1a6e1a 0%, #3ab83a 100%)',
    warning: 'linear-gradient(to right, #8e5000 0%, #c87c00 100%)',
    info:    'linear-gradient(to right, #006e8e 0%, #00a8c8 100%)',
    danger:  'linear-gradient(to right, #8e0000 0%, #c84040 100%)',
    dark:    'linear-gradient(to right, #1a1a2e 0%, #3a3a5e 100%)',
    // Grey = the inactive family (same role it plays in STATUS_FAMILY). For a window
    // whose subject is idle — a loom with no run — so the window matches the grey
    // tile it opened from instead of announcing itself in dialog blue.
    secondary: 'linear-gradient(to right, #6a6a6a 0%, #a8a8a8 100%)',
};

const xpTitleBorders: Record<string, string> = {
    primary: '#003080', success: '#0a4e0a', warning: '#5e3000',
    info: '#004a5e', danger: '#5e0000', dark: '#0a0a1e', secondary: '#4a4a4a',
};

const xpSizeWidths: Record<string, number> = { sm: 340, md: 480, lg: 640, xl: 820, xxl: 1100 };

export default function ModalWrapper({
    isOpen, onClose, title, children, footer, banner,
    level = 1, size = 'md', variant = 'primary', modeless = false, bodyScroll = true
}: ModalWrapperProps) {
    const isMobile = useIsMobile();
    const backdropMouseDown = useRef(false);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const panelRef = useRef<HTMLDivElement>(null);
    const dragOffset = useRef({ x: 0, y: 0 });

    const floating = modeless && !isMobile;
    const titleId = useId();

    useInactiveChromeWhileOpen(isOpen);

    useEffect(() => {
        if (!isOpen) return;
        ensureEscListener();
        const close = () => onCloseRef.current();
        escStack.push(close);
        return () => {
            const idx = escStack.indexOf(close);
            if (idx !== -1) escStack.splice(idx, 1);
        };
    }, [isOpen]);

    // Reset drag position each time the window is reopened
    useEffect(() => {
        if (!isOpen) dragOffset.current = { x: 0, y: 0 };
    }, [isOpen]);

    // Focus trap: move focus into the dialog on open, cycle Tab/Shift+Tab within
    // it, restore focus to whatever was focused before on close. Without this,
    // keyboard users can tab straight through to background page content.
    const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    useEffect(() => {
        if (!isOpen) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const getFocusable = () => panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? null;

        const raf = requestAnimationFrame(() => {
            const items = getFocusable();
            if (items && items.length > 0) items[0].focus();
            else panelRef.current?.focus();
        });

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;
            const items = getFocusable();
            if (!items || items.length === 0) { e.preventDefault(); return; }
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            previouslyFocused?.focus?.();
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const modalZIndex = MODAL_Z[level];

    // Drag updates the DOM node directly — no React re-renders during pointermove,
    // transform is compositor-only, so this stays smooth on old hardware.
    const startDrag = (e: React.PointerEvent) => {
        if (!floating || !panelRef.current) return;
        if ((e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const base = { ...dragOffset.current };
        const el = panelRef.current;
        const onMove = (ev: PointerEvent) => {
            // Pointer deltas are screen px, the translate is layout px — without
            // the conversion the panel trails the cursor at any scale but 100%.
            dragOffset.current = {
                x: base.x + toLayoutPx(ev.clientX - startX),
                y: base.y + toLayoutPx(ev.clientY - startY),
            };
            el.style.transform = `translate(calc(-50% + ${dragOffset.current.x}px), ${dragOffset.current.y}px)`;
            window.dispatchEvent(new Event(MODAL_REPOSITION_EVENT));
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    const floatingPos: React.CSSProperties = {
        position: 'fixed',
        left: '50%',
        top: 56,
        transform: `translate(calc(-50% + ${dragOffset.current.x}px), ${dragOffset.current.y}px)`,
        zIndex: modalZIndex,
        // The panel can render as a direct child of a Bootstrap .row, whose
        // `.row > *` rule injects gutter padding/margin — neutralize it.
        padding: 0,
        margin: 0,
    };

    const dialog = (
        <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            style={{
                width: xpSizeWidths[size] || 480, maxWidth: 'calc(var(--app-vw) * 96 / 100)',
                border: '2px solid',
                borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                boxShadow: floating ? '5px 5px 16px rgba(0,0,0,0.45)' : '4px 4px 12px rgba(0,0,0,0.55)',
                background: '#ece9d8',
                borderRadius: WINDOW_RADIUS,
                display: 'flex', flexDirection: 'column',
                maxHeight: floating ? 'calc(var(--app-vh) - 80px)' : 'calc(var(--app-vh) * 92 / 100)',
                ...(floating ? floatingPos : {}),
            }}
            onClick={e => e.stopPropagation()}
        >
            {/* XP Title Bar */}
            <div
                onPointerDown={floating ? startDrag : undefined}
                style={{
                    background: xpTitleGradients[variant] || xpTitleGradients.primary,
                    // Top corners follow the frame; the inner radius is the
                    // frame's minus its 2px bevel so the two read as one curve.
                    borderRadius: `${WINDOW_RADIUS_INNER}px ${WINDOW_RADIUS_INNER}px 0 0`,
                    color: '#ffffff',
                    fontFamily: xpFont,
                    fontSize: '12px', fontWeight: 'bold',
                    padding: '4px 6px 4px 8px',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
                    borderBottom: `1px solid ${xpTitleBorders[variant] || '#003080'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    minHeight: '26px', gap: 6,
                    userSelect: 'none' as const,
                    flexShrink: 0,
                    cursor: floating ? 'move' : undefined,
                    touchAction: floating ? 'none' : undefined,
                }}>
                <span id={titleId} style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                    {title}
                </span>
                <WindowCloseButton onClose={onClose} />
            </div>

            {/* Full-bleed window chrome (tab strip, toolbar) — outside the body so
                its background reaches both frame edges. */}
            {banner && <div className="ui-style-classic" style={{ flexShrink: 0 }}>{banner}</div>}

            {/* Body — ui-style-classic triggers CSS overrides for Bootstrap controls */}
            <div
                className="ui-style-classic"
                style={{
                    padding: '12px 14px', overflowY: bodyScroll ? 'auto' : 'hidden',
                    background: 'linear-gradient(to bottom, #f1efe5 0%, #e5e2d3 100%)', flex: 1,
                    // Whichever surface sits last carries the bottom corners.
                    ...(footer ? null : { borderRadius: `0 0 ${WINDOW_RADIUS_INNER}px ${WINDOW_RADIUS_INNER}px` }),
                }}
            >
                {children}
            </div>

            {/* Footer */}
            {footer && (
                <div style={{
                    background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)',
                    borderTop: '1px solid #b0a898',
                    borderRadius: `0 0 ${WINDOW_RADIUS_INNER}px ${WINDOW_RADIUS_INNER}px`,
                    padding: '6px 10px',
                    // Buttons no longer shrink (see lvBtn/xpBtn), so a footer too
                    // narrow for them wraps to a second row instead of overflowing
                    // the window. `alignItems: center` keeps a one-line button
                    // aligned with a hint that has wrapped to two or three.
                    display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
                    flexWrap: 'wrap', gap: 4, rowGap: 6,
                    flexShrink: 0,
                }}>
                    {footer}
                </div>
            )}
        </div>
    );

    if (floating) return dialog;

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: modalZIndex,
                backgroundColor: 'rgba(0,0,0,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseDown={e => { backdropMouseDown.current = e.target === e.currentTarget; }}
            onClick={() => { if (backdropMouseDown.current) onClose(); }}
        >
            {dialog}
        </div>
    );

}
