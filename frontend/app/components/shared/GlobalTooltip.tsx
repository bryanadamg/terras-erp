'use client';

/**
 * One document-level layer with two jobs, neither of which is "render `title=`".
 *
 *   1. SUPPRESS the native tooltip. Every `title` in the document is PARKED on
 *      `data-original-title` as soon as it appears, so the OS never draws its
 *      grey box. ~800 of them across the views, and being followed around by a
 *      system bubble on every stray hover is exactly the noise this removes.
 *      The string is kept (not deleted) and mirrored to `aria-label` when the
 *      element has no other accessible name, because for an icon-only button the
 *      title WAS the name — so screen readers still read it.
 *   2. Give CLIPPED text a hover. Text cut off by its column ("PR-2026-08-000…")
 *      had no affordance at all: an ellipsis with nothing behind it. Hovering it
 *      echoes the full value at the element. This is the surface that earns its
 *      keep — it answers a question the reader is already asking.
 *
 * A `title=` no longer opens anything here. It is an explanation nobody asked
 * for, fired by the mouse merely crossing the element, and at ERP table density
 * that made the UI feel like it was talking over the user. Deliberate
 * explanatory text is now an explicit `<Tooltip content>` (Tooltip.tsx) at the
 * one call site that wants it — opt-in, not ambient.
 *
 * Parking is up front, not on hover, and that is the whole trick. Blink captures
 * the tooltip string when the pointer's hit test runs and hands it to the browser
 * process with its own delay; removing the attribute *during* the hover does not
 * cancel that pending bubble. There is no "suppress it now" hook — the only
 * reliable move is for the attribute never to be on the node when the pointer
 * arrives. (Bootstrap's tooltip does the same at construction time.)
 *
 * What it deliberately does NOT touch:
 *   - Titles on form-native UI (`<option>`, `<select>`) and iframes: the browser
 *     is the only thing that can render those, so they keep the attribute.
 *   - Anything inside `[data-no-tip]`. `Chip` / `CodeChip` mark themselves so
 *     their own popout — the chip re-drawn unclipped, in place — is the only
 *     surface, rather than getting a second, worse copy of the same text.
 *
 * Mounted once in `layout.tsx`, outside anything that unmounts per route.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnchorRect, FloatingLayer, POPOUT_DELAY, TooltipSurface, isClipped } from './Tooltip';
import { layoutRectOf } from '@bryanadamg/terras-ui/scale';

/** Same dwell as the chip popout, and for the same reason: this is not an
 *  explanation the reader asked for, it is the label they are already trying to
 *  read finishing itself. `<Tooltip>`'s longer TIP_DELAY stays for real prose. */
const DELAY_MS = POPOUT_DELAY;
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

export default function GlobalTooltip() {
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

            // Clipped text is the ONLY thing this layer opens for. A `title=` is
            // parked (below) so the OS never draws it, but it no longer renders a
            // bubble either — see the header note.
            //
            // A zone owns its own surface (a chip re-draws itself unclipped), so it
            // is skipped here rather than getting a second, worse copy.
            let el: HTMLElement | null = null;
            let text = '';
            if (!target.closest('[data-no-tip]')) {
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
        <FloatingLayer rect={live.rect} anchorEl={live.el} placement="bottom" className="tip-anim">
            <TooltipSurface maxWidth={360} id={TIP_ID}>{live.text}</TooltipSurface>
        </FloatingLayer>
    );
}
