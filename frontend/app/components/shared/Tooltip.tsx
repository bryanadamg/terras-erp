'use client';

/**
 * Hover surfaces — THE tooltip and THE clipped-chip popout for the whole app.
 *
 * Why not the native `title=` attribute (which ~600 call sites still use): the OS
 * tooltip is unstyleable, appears after a fixed ~1s delay at the mouse rather than
 * at the element, renders in the OS font, and cannot show a chip. It also can't
 * solve the actual problem in a dense table — a chip clipped to a fixed-width
 * column ("PR-2026-08-000…") makes the reader hover, wait, and then read the value
 * as plain OS text somewhere else on screen.
 *
 * So there are two surfaces here, and they are deliberately different jobs:
 *
 *   1. `Tooltip` — explanatory text about something that is NOT clipped (a header
 *      explaining a column, an icon button's name). Styled per theme: XP's pale
 *      yellow box in classic, a dark slate bubble in modern.
 *   2. The clipped-chip POPOUT (driven from `Chip`/`CodeChip` in xpTheme via
 *      `useHoverAnchor` + `FloatingLayer` here) — the chip itself re-renders,
 *      unclipped, animating out of its own position. Nothing to read elsewhere:
 *      the thing under the cursor just finishes itself.
 *
 * Positioning goes through `uiScale`'s layout-px helpers, and every layer is a
 * `document.body` portal: a table cell that clips its chip would clip an inline
 * tooltip exactly the same way, and `position: fixed` inside the root zoom is off
 * by the scale factor unless the measured rect is converted first.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../context/ThemeContext';
import { layoutRectOf, uiZoom } from './uiScale';
import { xpFont, modernFont } from './typography';
import { TOOLTIP_Z } from './zLayers';

export type AnchorRect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

/** Hover dwell before a TEXT bubble opens, everywhere (this file, GlobalTooltip,
 *  a chip's title surface). Deliberately near the native tooltip's own delay: a
 *  bubble is an answer to "what is this?", and anything faster fires on the mouse
 *  merely crossing a dense table on its way somewhere else, which is what made the
 *  old 260-380ms spread feel like the UI was talking over the user.
 *
 *  NOT used for the clipped-chip popout — see POPOUT_DELAY. */
export const TIP_DELAY = 650;

/** Dwell before a clipped chip re-draws itself unclipped. Much shorter on purpose:
 *  it is not an explanation, it is the label the reader is already trying to read
 *  finishing itself in place. */
export const POPOUT_DELAY = 260;

/** Hover/focus state machine for anything that floats off an element.
 *
 * Measures the trigger at hover time (never on render — a table row measured on
 * mount is wrong the moment a column resizes) and hands back the rect in layout
 * px. `shouldOpen` is the escape hatch the popout needs: it only wants to appear
 * when the label is actually clipped, which can only be known from the live DOM. */
export function useHoverAnchor(opts?: {
    /** A function is read AFTER `shouldOpen` has run, so a caller that picks its
     *  surface there (chip popout vs. tooltip) can pick the matching dwell too. */
    delay?: number | (() => number);
    enabled?: boolean;
    /** Called with the trigger on hover; return false to suppress this open. */
    shouldOpen?: (el: HTMLElement) => boolean;
}) {
    const { delay = TIP_DELAY, enabled = true, shouldOpen } = opts || {};
    // The anchor ELEMENT rides along with its rect: the layer re-measures it at
    // layout time to place itself exactly on top (see FloatingLayer). A rect alone
    // is a snapshot in one unit space; the element is the ground truth.
    const [open, setOpen] = useState<{ el: HTMLElement; rect: AnchorRect } | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    const close = useCallback(() => { clear(); setOpen(null); }, []);
    useEffect(() => () => clear(), []);

    // A fixed-position layer does not follow its anchor, so anything that can move
    // the anchor dismisses it instead of letting it hang over stale content. Scroll
    // is captured because the anchor usually sits in a scrolling table body, not on
    // the window.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        window.addEventListener('pointerdown', close, true);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close);
            window.removeEventListener('pointerdown', close, true);
            window.removeEventListener('keydown', onKey);
        };
    }, [open, close]);

    const openFrom = useCallback((el: HTMLElement) => {
        if (!enabled || !el) return;
        if (shouldOpen && !shouldOpen(el)) return;
        clear();
        const ms = typeof delay === 'function' ? delay() : delay;
        timer.current = setTimeout(() => setOpen({ el, rect: layoutRectOf(el) }), ms);
    }, [enabled, delay, shouldOpen]);

    const handlers = {
        onMouseEnter: (e: React.MouseEvent) => openFrom(e.currentTarget as HTMLElement),
        onMouseLeave: close,
        // Keyboard parity: tabbing to a clipped code shows it the same way hovering does.
        onFocus: (e: React.FocusEvent) => openFrom(e.currentTarget as HTMLElement),
        onBlur: close,
    };

    return { rect: open?.rect ?? null, anchorEl: open?.el ?? null, isOpen: !!open, close, handlers, openFrom };
}

/** Body portal placed against an anchor, clamped into the viewport.
 *
 * Placement is computed in SCREEN px against the anchor's live rect, written back
 * in layout px, and then CORRECTED against where the layer actually landed. That
 * second pass is the whole point: `position: fixed` under the root `zoom`, inside a
 * transformed ancestor, or in a browser that measures zoom differently all land at
 * a slightly different place than the arithmetic predicts, and `placement="over"`
 * has no tolerance for "slightly" — the popout must sit exactly on the chip it is
 * completing, not a row below it. Measuring the result removes the guesswork
 * instead of modelling every containing-block rule.
 */
export function FloatingLayer({ rect, anchorEl, placement = 'bottom', align = 'start', offset = 5, zIndex = TOOLTIP_Z, className, style, children }: {
    rect: AnchorRect;
    /** The live trigger. Preferred over `rect` when present — see above. */
    anchorEl?: HTMLElement | null;
    placement?: 'bottom' | 'top' | 'over';
    align?: 'start' | 'center';
    offset?: number;
    zIndex?: number;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [placed, setPlaced] = useState(false);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const z = uiZoom();
        // Everything in this block is screen px (what getBoundingClientRect returns).
        const a = anchorEl && anchorEl.isConnected
            ? anchorEl.getBoundingClientRect()
            : { top: rect.top * z, left: rect.left * z, bottom: rect.bottom * z, right: rect.right * z, width: rect.width * z, height: rect.height * z };
        const box = el.getBoundingClientRect();
        const gap = offset * z, edge = 4 * z;
        const vw = window.innerWidth, vh = window.innerHeight;

        let top = placement === 'over' ? a.top
            : placement === 'top' ? a.top - box.height - gap
                : a.bottom + gap;
        if (placement === 'bottom' && top + box.height > vh - edge) top = a.top - box.height - gap;
        if (placement === 'top' && top < edge) top = a.bottom + gap;
        top = Math.max(edge, Math.min(top, Math.max(edge, vh - box.height - edge)));

        let left = align === 'center' ? a.left + a.width / 2 - box.width / 2 : a.left;
        left = Math.max(edge, Math.min(left, Math.max(edge, vw - box.width - edge)));

        el.style.top = `${top / z}px`;
        el.style.left = `${left / z}px`;
        const landed = el.getBoundingClientRect();
        if (Math.abs(landed.top - top) > 0.5 || Math.abs(landed.left - left) > 0.5) {
            el.style.top = `${(top + (top - landed.top)) / z}px`;
            el.style.left = `${(left + (left - landed.left)) / z}px`;
        }
        setPlaced(true);
    }, [rect, anchorEl, placement, align, offset]);

    if (typeof document === 'undefined') return null;
    return createPortal(
        <div
            ref={ref}
            className={className}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                zIndex,
                pointerEvents: 'none',
                visibility: placed ? 'visible' : 'hidden',
                // FLEX, not the default block. A block wrapper lays its child out as
                // an inline box on a LINE BOX sized from the inherited font — so the
                // chip clone sat a few px below the wrapper's own top edge, and
                // "place the wrapper on the chip" put the clone below the chip. Flex
                // makes the wrapper's border box exactly the child's border box.
                display: 'flex',
                alignItems: 'flex-start',
                ...style,
            }}
        >
            {children}
        </div>,
        document.body,
    );
}

/** The tooltip box itself. Classic is the XP tooltip (pale blue, 1px black,
 *  Tahoma); modern is a dark bubble. Exported for the rare caller that drives its
 *  own anchor and only wants the surface. */
export function TooltipSurface({ classic, children, maxWidth = 320, id }: { classic: boolean; children: React.ReactNode; maxWidth?: number; id?: string }) {
    return (
        <div
            id={id}
            role="tooltip"
            className="tip-surface"
            style={{
                maxWidth,
                // Titles are frequently multi-line (the MO progress cell lists every
                // step), and '\n' in a native title is the only reason those read at
                // all. pre-line keeps that working here.
                whiteSpace: 'pre-line',
                fontFamily: classic ? xpFont : modernFont,
                fontSize: classic ? 11 : 11.5,
                lineHeight: 1.4,
                padding: classic ? '2px 5px' : '5px 8px',
                borderRadius: classic ? 0 : 4,
                background: classic ? '#e1f0ff' : '#1f2937',
                color: classic ? '#000' : '#f8fafc',
                border: classic ? '1px solid #000' : '1px solid rgba(255,255,255,0.08)',
                boxShadow: classic ? '2px 2px 3px rgba(0,0,0,0.2)' : '0 6px 16px rgba(15,23,42,0.28)',
            }}
        >
            {children}
        </div>
    );
}

const chain = (...fns: (((e: any) => void) | undefined)[]) => (e: any) => fns.forEach(f => f && f(e));

/**
 * Wrap ONE element to give it the app tooltip instead of the OS one.
 *
 *   <Tooltip content="Steps completed on the MOs behind this line"><th>MO Progress</th></Tooltip>
 *
 * The child is cloned with hover/focus handlers — no wrapper element is added, so
 * table and flex layouts are untouched. The child must be a DOM element (or a
 * component that forwards mouse/focus props).
 */
export function Tooltip({ content, children, placement = 'bottom', align = 'start', delay = TIP_DELAY, disabled = false, maxWidth }: {
    content: React.ReactNode;
    children: React.ReactElement;
    placement?: 'bottom' | 'top';
    align?: 'start' | 'center';
    delay?: number;
    disabled?: boolean;
    maxWidth?: number;
}) {
    const { uiStyle } = useTheme();
    const classic = uiStyle === 'classic';
    const empty = content === null || content === undefined || content === '';
    const { rect, anchorEl, handlers } = useHoverAnchor({ delay, enabled: !disabled && !empty });
    const tipId = React.useId();
    const child = React.Children.only(children) as React.ReactElement<any>;
    const cloned = React.cloneElement(child, {
        // Points a screen reader at the surface while it is up, the same way the
        // global layer does for a plain `title`.
        'aria-describedby': rect ? tipId : child.props['aria-describedby'],
        // Tells GlobalTooltip to keep its hands off: this element already owns a
        // surface, and the global one would stack a second bubble on top of it.
        'data-no-tip': '',
        onMouseEnter: chain(child.props.onMouseEnter, handlers.onMouseEnter),
        onMouseLeave: chain(child.props.onMouseLeave, handlers.onMouseLeave),
        onFocus: chain(child.props.onFocus, handlers.onFocus),
        onBlur: chain(child.props.onBlur, handlers.onBlur),
    } as any);

    return (
        <>
            {cloned}
            {rect && (
                <FloatingLayer rect={rect} anchorEl={anchorEl} placement={placement} align={align} className="tip-anim">
                    <TooltipSurface classic={classic} maxWidth={maxWidth} id={tipId}>{content}</TooltipSurface>
                </FloatingLayer>
            )}
        </>
    );
}

/** True when `el` (or the label span inside it) is clipped by its container.
 *  The 1px slack absorbs sub-pixel widths at non-100% interface scale. */
export function isClipped(el: HTMLElement | null): boolean {
    if (!el) return false;
    return el.scrollWidth > el.clientWidth + 1;
}
