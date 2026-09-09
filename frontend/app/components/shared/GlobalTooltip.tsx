'use client';

/**
 * One document-level layer that replaces EVERY native tooltip in the app.
 *
 * There are ~800 `title=` attributes across the views and ~90 places that clip
 * text to a fixed-width cell. Rewriting each into a `<Tooltip>` wrapper would be
 * a many-hundred-line diff that drifts again the moment someone types `title=`
 * out of habit — which they will, because that is what the attribute is for.
 *
 * So the attribute stays the API and this component changes what it renders:
 *
 *   - Every `title` in the document is PARKED on `data-original-title` as soon as
 *     it appears, and the themed surface is rendered from there on hover/focus,
 *     at the element rather than at the cursor.
 *   - Hovering CLIPPED text with no title shows the full text. That case had no
 *     affordance at all before: an ellipsis with nothing behind it.
 *
 * Parking is up front, not on hover, and that is the whole trick. Blink captures
 * the tooltip string when the pointer's hit test runs and hands it to the browser
 * process with its own delay; removing the attribute *during* the hover does not
 * cancel that pending bubble, so the OS drew a second, system-chrome copy of the
 * same text next to ours a beat later. There is no "suppress it now" hook — the
 * only reliable move is for the attribute never to be on the node when the
 * pointer arrives. (Bootstrap's tooltip does the same at construction time.)
 *
 * What it deliberately does NOT touch:
 *   - Titles on form-native UI (`<option>`, `<select>`) and iframes: the browser
 *     is the only thing that can render those, so they keep the attribute.
 *   - A titled ANCESTOR of a `[data-no-tip]` zone. `Chip` / `CodeChip` mark
 *     themselves so their own popout (the chip re-drawn unclipped, in place) is
 *     the only surface — hovering a chip must not also open the clickable row's
 *     bubble. Titles *inside* a zone (a chip's own × button) still get ours.
 *
 * Accessibility: `title` is the accessible name for icon-only controls, so it is
 * not simply deleted — it is parked (Bootstrap's own tooltip does the same),
 * mirrored to `aria-label` when the element has no other name, and the surface is
 * a real `role="tooltip"` wired up with `aria-describedby`. Focus opens it as well
 * as hover, so it is reachable from the keyboard — which the native tooltip never
 * was.
 *
 * Mounted once in `layout.tsx`, inside ThemeProvider (it reads the theme) and
 * outside anything that unmounts per route.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { AnchorRect, FloatingLayer, TooltipSurface, isClipped } from './Tooltip';
import { layoutRectOf } from './uiScale';

const DELAY_MS = 380;
/** How far up from the hovered node to look for a clipped box. Text is usually
 *  clipped by its own span or the cell one or two levels up, never further. */
const CLIP_DEPTH = 3;
/** Longest clipped string worth echoing on hover. Past this it is prose, not a label. */
const MAX_CLIP_TEXT = 180;

/** Where a lifted `title` lives. Same attribute name Bootstrap's tooltip uses. */
const PARKED = 'data-original-title';
/** Marks an `aria-label` we added, so it can be taken back off with the title. */
const OWN_ARIA = 'data-tip-aria';

type Live = { el: HTMLElement; rect: AnchorRect; text: string };

const TIP_ID = 'app-tooltip-surface';

/** Does the element already have a name a screen reader can read without `title`? */
const hasOwnName = (el: HTMLElement) =>
    !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.textContent || '').trim());

const isFormNative = (el: Element) => {
    const t = el.tagName;
    return t === 'OPTION' || t === 'SELECT' || t === 'IFRAME';
};

/** Move one element's `title` out of the browser's reach. Idempotent. */
const park = (el: HTMLElement) => {
    const t = el.getAttribute('title');
    if (t === null || isFormNative(el)) return;
    if (!t.trim()) { el.removeAttribute('title'); return; }
    el.setAttribute(PARKED, t);
    // Keep the element named: for an icon-only button the title WAS the name.
    if (!hasOwnName(el)) { el.setAttribute('aria-label', t); el.setAttribute(OWN_ARIA, '1'); }
    el.removeAttribute('title');
};

const parkSubtree = (root: Node) => {
    if (!(root instanceof HTMLElement)) return;
    if (root.hasAttribute('title')) park(root);
    root.querySelectorAll<HTMLElement>('[title]').forEach(park);
};

/** The text this element would have shown natively, parked or not yet parked. */
const titleTextOf = (el: HTMLElement) => (el.getAttribute(PARKED) || el.getAttribute('title') || '');

const TITLED_SEL = `[${PARKED}],[title]`;

export default function GlobalTooltip() {
    const { uiStyle } = useTheme();
    const classic = uiStyle === 'classic';
    const [live, setLive] = useState<Live | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Element currently carrying our `aria-describedby`, so it can be cleaned up. */
    const described = useRef<HTMLElement | null>(null);

    const hide = useCallback(() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        const d = described.current;
        if (d && d.isConnected && d.getAttribute('aria-describedby') === TIP_ID) d.removeAttribute('aria-describedby');
        described.current = null;
        setLive(null);
    }, []);

    // Park every title in the document, and keep parking the ones React renders
    // later. Attribute-filtered so our own `data-original-title` / `aria-label`
    // writes can't feed the observer back into itself.
    useEffect(() => {
        parkSubtree(document.body);
        const obs = new MutationObserver(records => {
            for (const r of records) {
                if (r.type === 'attributes') {
                    if (r.target instanceof HTMLElement) park(r.target);
                } else {
                    r.addedNodes.forEach(parkSubtree);
                }
            }
        });
        obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
        return () => {
            obs.disconnect();
            // Hand the attributes back if this ever unmounts, so the app is not
            // left with tooltips that nothing renders.
            document.querySelectorAll<HTMLElement>(`[${PARKED}]`).forEach(el => {
                const t = el.getAttribute(PARKED) as string;
                if (!el.getAttribute('title')) el.setAttribute('title', t);
                el.removeAttribute(PARKED);
                if (el.getAttribute(OWN_ARIA) === '1') { el.removeAttribute('aria-label'); el.removeAttribute(OWN_ARIA); }
            });
        };
    }, []);

    useEffect(() => {
        const onOver = (e: Event) => {
            const target = e.target as HTMLElement | null;
            if (!target || !(target instanceof HTMLElement)) return;
            if (isFormNative(target)) { if (live) hide(); return; }

            // A title anywhere up the chain wins: it is an author's explanation,
            // which beats echoing text the reader can already half-see.
            const zone = target.closest('[data-no-tip]');
            const titled = target.closest(TITLED_SEL) as HTMLElement | null;
            // Inside a zone that owns its own surface, only a nested control's own
            // title still speaks (a chip's × button); the clickable ROW's title
            // behind the chip does not — that pair is what stacked two bubbles.
            const usable = titled && (!zone || (titled !== zone && zone.contains(titled)));

            let el: HTMLElement | null = null;
            let text = '';
            if (usable && titleTextOf(titled as HTMLElement).trim()) {
                el = titled;
                text = titleTextOf(titled as HTMLElement);
            } else if (!zone) {
                // Otherwise: is the thing under the cursor cut off? (A clipped chip
                // re-draws itself unclipped, so zones are skipped here too.)
                let node: HTMLElement | null = target;
                for (let i = 0; i < CLIP_DEPTH && node; i++, node = node.parentElement) {
                    if (!isClipped(node)) continue;
                    const t = (node.textContent || '').trim();
                    // A label cut off by its column is worth showing. A scroll
                    // container (the reader can already scroll it) or a whole
                    // paragraph is not — that would be a wall of text on hover.
                    if (t.length < 2 || t.length > MAX_CLIP_TEXT) continue;
                    const cs = getComputedStyle(node);
                    // Single-line ellipsis truncation only: a wrapping block's
                    // scrollWidth can drift a few px past clientWidth from zoom
                    // rounding alone (the login screen scales with CSS zoom) with
                    // nothing actually cut off. nowrap is the real truncation signature.
                    if (cs.whiteSpace !== 'nowrap') continue;
                    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
                    el = node;
                    text = t;
                    break;
                }
            }
            if (!el || !text) { if (live || timer.current) hide(); return; }
            if (live && live.el === el) return;

            if (timer.current) clearTimeout(timer.current);
            const anchor = el;
            const content = text;
            timer.current = setTimeout(() => {
                if (!anchor.isConnected) return;
                anchor.setAttribute('aria-describedby', TIP_ID);
                described.current = anchor;
                setLive({ el: anchor, rect: layoutRectOf(anchor), text: content });
            }, DELAY_MS);
        };

        const onOut = (e: MouseEvent) => {
            const to = e.relatedTarget as Node | null;
            const anchor = live?.el ?? described.current;
            if (anchor && to && anchor.contains(to)) return;
            hide();
        };

        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };

        document.addEventListener('mouseover', onOver, true);
        document.addEventListener('mouseout', onOut, true);
        // Same handlers on focus: a keyboard user tabbing onto an icon button gets
        // the explanation a mouse user gets by hovering it.
        document.addEventListener('focusin', onOver, true);
        document.addEventListener('focusout', hide, true);
        document.addEventListener('pointerdown', hide, true);
        window.addEventListener('scroll', hide, true);
        window.addEventListener('resize', hide);
        window.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mouseover', onOver, true);
            document.removeEventListener('mouseout', onOut, true);
            document.removeEventListener('focusin', onOver, true);
            document.removeEventListener('focusout', hide, true);
            document.removeEventListener('pointerdown', hide, true);
            window.removeEventListener('scroll', hide, true);
            window.removeEventListener('resize', hide);
            window.removeEventListener('keydown', onKey);
        };
    }, [live, hide]);

    if (!live) return null;
    return (
        <FloatingLayer rect={live.rect} anchorEl={live.el} className="tip-anim">
            <TooltipSurface classic={classic} maxWidth={360} id={TIP_ID}>{live.text}</TooltipSurface>
        </FloatingLayer>
    );
}
