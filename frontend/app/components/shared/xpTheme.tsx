'use client';

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { layoutRectOf, layoutScroll } from './uiScale';
import { xpFont, modernFont, CODE_FONT, PRINT_FONT, PRINT_SERIF_FONT } from './typography';
import { FloatingLayer, Tooltip, TooltipSurface, useHoverAnchor, isClipped } from './Tooltip';
import UIToggleChip from '@bryanadamg/terras-ui/components/ToggleChip';

/**
 * Shared Windows XP "classic" theme primitives.
 * Single source of truth for status colors and the inline XP style helpers
 * that were previously duplicated per view.
 */

// The font stacks live in ./typography so Tooltip (which this file imports) can
// use them without an import cycle. Re-exported here: every existing
// `import { xpFont } from '../shared/xpTheme'` still resolves to the same const.
export { xpFont, modernFont, CODE_FONT, PRINT_FONT, PRINT_SERIF_FONT } from './typography';

// ── Identifier typography ─────────────────────────────────────────────────────
// Codes are UNBOXED — plain monospace text. The box the items/BOM tables used to
// draw around a code read as a control, not as data, and made a dense table look
// like a row of buttons. Weight, size and color carry the tier instead:
//   tier 1 — the code that identifies THIS row (item code on the items table, BOM
//            code on the BOM table, mo.code on the MO table). Bold, full size.
//   tier 2 — a code pointing at ANOTHER entity from inside the row (item code under
//            an item name, BOM code under a PR, a parent/contributing MO). Regular
//            weight, muted, one step smaller.
// Status is never a code — use StatusChip. And a code never gets a fill or a border:
// those are reserved for status families and interactive controls, so a boxed code
// reads as a state or a button.
// `link` is the one exception to the no-chrome rule: a code that JUMPS somewhere
// else (root MO on the WO table, contributing MOs on a PR) renders as a blue tinted
// badge. The tint is the affordance — it says "this cell is a door", which a plain
// underline in a dense table does not. It never collides with status color because
// blue-on-pale-blue is not in STATUS_FAMILY's chip set at this size, and a nav code
// always sits in its own column.
export function CodeChip({ code, classic, tier = 1, tone = 'default', link = false, title, style, className, onClick }: {
    code: React.ReactNode; classic: boolean; tier?: 1 | 2;
    tone?: 'default' | 'accent'; link?: boolean; title?: string;
    style?: React.CSSProperties; className?: string; onClick?: () => void;
}) {
    const base: React.CSSProperties = { fontFamily: CODE_FONT, whiteSpace: 'nowrap' };
    const selfRef = useRef<HTMLSpanElement>(null);
    const tip = title ?? (typeof code === 'string' ? code : undefined);
    const mode = useRef<'pop' | 'tip' | null>(null);
    // A code is the one label a reader must have in full — "PR-2026-08-000…" is
    // not a shorter code, it is no code. So a clipped one pops out whole; an
    // unclipped one only floats a tooltip if the caller wrote something the code
    // itself doesn't already say.
    const { rect, anchorEl, handlers } = useHoverAnchor({
        delay: 260,
        shouldOpen: () => {
            if (isClipped(selfRef.current)) { mode.current = 'pop'; return true; }
            if (title) { mode.current = 'tip'; return true; }
            return false;
        },
    });

    const boxStyle: React.CSSProperties = link
        ? {
            ...base,
            fontSize: classic ? 10 : 11,
            fontWeight: 'bold',
            color: '#0058e6',
            background: '#e8f0fe',
            border: '1px solid #b0c8f8',
            borderRadius: CODE_CHIP_RADIUS,
            padding: '0 5px',
            cursor: 'pointer',
            display: 'inline-block',
            ...style,
        }
        : tier === 2
            ? { ...base, fontSize: classic ? 9 : 10.5, color: '#666', ...style }
            : {
                ...base,
                fontSize: classic ? 11 : 12,
                fontWeight: 'bold',
                color: tone === 'accent' ? '#000055' : '#000',
                ...style,
            };

    return (
        <>
            <span ref={selfRef} className={className} {...handlers} data-no-tip="" onClick={onClick} style={boxStyle}>{code}</span>
            {rect && (mode.current === 'pop'
                ? (
                    <FloatingLayer rect={rect} anchorEl={anchorEl} placement="over" className="chip-pop-anim">
                        <span style={{
                            ...boxStyle,
                            margin: 0,
                            // Uncapped width assumed the full code always fits on one
                            // screen-wide line; an exceptionally long code (a BOM code
                            // with a full variant suffix, say) instead ran the popout
                            // straight off the viewport edge. Cap and let it wrap.
                            maxWidth: 'min(480px, 90vw)', whiteSpace: 'normal', wordBreak: 'break-word', overflow: 'visible', textOverflow: 'clip',
                            // A tier-2/plain code has no fill of its own, so the
                            // popout has to supply one or it reads as text printed
                            // over the row underneath it.
                            ...(link ? null : { background: classic ? '#ffffe1' : '#ffffff', border: '1px solid', borderColor: classic ? '#000' : '#cbd5e1', borderRadius: CODE_CHIP_RADIUS, padding: '0 5px' }),
                            boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
                        }}>{code}</span>
                    </FloatingLayer>
                )
                : (
                    <FloatingLayer rect={rect} anchorEl={anchorEl} className="tip-anim">
                        <TooltipSurface classic={classic}>{tip}</TooltipSurface>
                    </FloatingLayer>
                ))}
        </>
    );
}

// Every domain status collapses into one of five semantic families, so a status
// means the same color everywhere regardless of which module (SO/PO/MO/sample)
// it came from. Add a new domain status here — not a new per-view color map.
export type StatusFamily = 'gray' | 'amber' | 'blue' | 'green' | 'red';

export const STATUS_FAMILY: Record<string, StatusFamily> = {
    DRAFT: 'gray', CLOSED: 'gray',
    PENDING: 'gray',
    PARTIAL: 'amber', RECEIVING: 'amber', ON_HOLD: 'amber',
    // A weaving run parked while another WO on the same loom is prioritised. Amber
    // like ON_HOLD: open work, deliberately not moving — not a failure (red) and not
    // in flight (blue).
    PAUSED: 'amber',
    CONFIRMED: 'blue', IN_PROGRESS: 'blue', READY: 'blue', SENT: 'blue',
    IN_PRODUCTION: 'blue', STAGED: 'blue',
    // Loom prep walk (weaving monitor): STAGED (warp up) → DRAW_IN → TUNING → the
    // run itself. All three are prep-in-flight, so all three read blue; IDLE falls
    // through to gray via PENDING and a live run shows RUNNING/IN_PROGRESS green-ish.
    DRAW_IN: 'blue', TUNING: 'blue', IDLE: 'gray',
    // Dye vessel (dyeing monitor): a batch is loaded and waiting to start. Amber for
    // the same reason ON_HOLD is — open work sitting still, waiting on the floor.
    LOADED: 'amber',
    // DELIVERED is blue, not green: on an MO it means "planned qty met, order still
    // open for logging". Green is reserved for closed/terminal.
    DELIVERED: 'blue',
    // Pick list: PICKING is work in flight, PICKED means every carton is scanned
    // and the list is waiting on QC/dispatch — attention, not done.
    PICKING: 'blue', PICKED: 'amber',
    // A packed carton that still has stock at its location. Consumed cartons fall
    // through to DISPATCHED/SENT via the pick list that took them.
    IN_STOCK: 'green',
    COMPLETED: 'green', DONE: 'green', RECEIVED: 'green', APPROVED: 'green',
    ACTIVE: 'green', DISPATCHED: 'green',
    CANCELLED: 'red', REJECTED: 'red',
    // Derived display status (dashboard WO monitor): a PENDING/IN_PROGRESS order
    // past its target_end_date. Not a stored status — no backend row ever has it.
    OVERDUE: 'red',
    ARCHIVED: 'gray', INACTIVE: 'gray',
    // Audit-log action verbs (backend log_activity() call sites) — same 5-family
    // palette, not a domain status, but reuses it for one consistent chip everywhere.
    // Full set as of 2026-07: grep `log_activity(` across backend/app for the source list.
    CREATE: 'green', REACTIVATE: 'green', COMPLETE: 'green', COMPLETION: 'green', DISPATCH: 'green',
    UPDATE: 'amber',
    STATUS_CHANGE: 'blue', UPDATE_STATUS: 'blue', UPDATE_ITEM_STATUS: 'blue', UPDATE_COLOR_STATUS: 'blue',
    UPDATE_DIP_STATUS: 'blue', STAGE: 'blue', TRANSFER: 'blue', IMPORT: 'blue', REASSIGN: 'blue',
    DELETE: 'red', DEACTIVATE: 'red', REJECT: 'red', DISPOSE: 'red',
    PRINT: 'gray', SPLIT: 'gray', ARCHIVE: 'gray', REBUILD: 'gray',
    // Scheduled Backups panel (Settings → Database & Backups): audit verbs for the
    // recurring backup job, plus the "Manual"/"Scheduled" snapshot-origin tag and
    // "Success"/"Failed" last-run tag it renders in the same StatusChip.
    DB_BACKUP_SCHEDULE_UPDATE: 'amber', DB_BACKUP_SCHEDULED_RUN: 'green', DB_BACKUP_SCHEDULED_FAILED: 'red',
    SCHEDULED: 'blue', MANUAL: 'gray', SUCCESS: 'green', FAILED: 'red',
    // Item.variant_type tags (Inventory table "Type" column) — not a lifecycle
    // status, but reuses the same 5-family palette for a consistent chip.
    // NONE doubles as the Quarantine Packing "not dispositioned yet" rollup.
    NONE: 'gray', COLOR: 'blue', COMBO: 'amber',
    // Quarantine dispositions (values of the `Quarantine Status` attribute — the
    // list is client-extensible, so an added value falls through to gray until
    // someone maps it here). OK is the only one that releases a lot to packing;
    // MIXED is the derived MO rollup when its lots disagree.
    OK: 'green', BULK_SAMPLE: 'blue', WAITING_APPROVAL: 'amber', MIXED: 'amber',
    // A quarantine lot already drawn by packing — terminal, its disposition is frozen.
    PACKED: 'green',
    // A released quarantine lot already claimed by an open packing order — locked
    // like PACKED, but reversible: cancelling/deleting that order frees it again.
    CLAIMED: 'amber',
    // Work-queue readiness verdicts (services/work_queue_service.py). Derived, never
    // stored. Blue = the PIC may start it (RUNNING/STAGED/READY already blue above);
    // amber = waiting on something with a known answer; red = nothing to run on.
    RUNNING: 'blue',
    WAITING_UPSTREAM: 'amber',
    SHORT: 'red', NO_MATERIALS: 'gray',
    // An open order with no work order cut for it. Amber, not red: nothing is
    // broken, someone just has to release it before the floor can touch it.
    NOT_RELEASED: 'amber',
    // Lot quality_status beyond REJECTED: still usable keeps its warning colour,
    // disposed is terminal and out of every picker.
    REJECT_USABLE: 'amber', DISPOSED: 'gray',
};

const FAMILY_SOLID: Record<StatusFamily, string> = {
    gray: '#666666', amber: '#b8860b', blue: '#0058e6', green: '#2d7a2d', red: '#c00000',
};

const FAMILY_CHIP: Record<StatusFamily, { background: string; borderColor: string; color: string }> = {
    gray:  { background: '#d4d0c8', borderColor: '#808080', color: '#333333' },
    amber: { background: '#c77800', borderColor: '#7a4a00', color: '#ffffff' },
    blue:  { background: '#0058e6', borderColor: '#003080', color: '#ffffff' },
    green: { background: '#2d7a2d', borderColor: '#1a5e1a', color: '#ffffff' },
    red:   { background: '#c00000', borderColor: '#800000', color: '#ffffff' },
};

// Pastel/tinted chip — same family hues, light background + dark text. Use in
// dense contexts (expanded rows, secondary lists) where a solid chip is too loud.
const FAMILY_TINT: Record<StatusFamily, { background: string; borderColor: string; color: string }> = {
    gray:  { background: '#e8e8e8', borderColor: '#7a7a7a', color: '#222222' },
    amber: { background: '#fff3cd', borderColor: '#b8860b', color: '#5d3800' },
    blue:  { background: '#dce4f5', borderColor: '#3a5faa', color: '#0d2a6e' },
    green: { background: '#d4edda', borderColor: '#27713a', color: '#0c3a1a' },
    red:   { background: '#f8d7da', borderColor: '#a01a1a', color: '#4a0000' },
};

const familyOf = (status?: string): StatusFamily => STATUS_FAMILY[(status || '').toUpperCase()] || 'gray';

// Solid accent color per status — for text, border-left strips, progress bars.
// Computed from STATUS_FAMILY so every known status resolves consistently;
// an unlisted status is absent here (callers already fall back via `??`/`||`).
export const STATUS_COLORS: Record<string, string> = Object.fromEntries(
    Object.keys(STATUS_FAMILY).map((status) => [status, FAMILY_SOLID[STATUS_FAMILY[status]]])
);

// Chip (badge) palette per status — background / border / text. Solid variant.
export const STATUS_CHIP: Record<string, { background: string; borderColor: string; color: string }> = Object.fromEntries(
    Object.keys(STATUS_FAMILY).map((status) => [status, FAMILY_CHIP[STATUS_FAMILY[status]]])
);

export const statusColor = (status?: string): string => FAMILY_SOLID[familyOf(status)];

// Same five accents, addressed by family instead of by status — for the places
// where the thing being colored is a *measurement*, not a status: on-target vs
// below-target numbers, an accent stat, a chart series. Use this rather than
// re-declaring `const GREEN = '#2d7a2d'` in a view; the palette stays in one place
// and stays inside DESIGN.md's semantic layer.
export const familyColor = (family: StatusFamily): string => FAMILY_SOLID[family];

// Pale wash of the same five accents, by family — for panel/row backgrounds that
// carry a health signal (dashboard health panels, alert rows). Same reason as
// familyColor: don't re-declare `const OK_BG = '#e8f5e9'` per view.
export const familyTint = (family: StatusFamily) => FAMILY_TINT[family];

// Tint colors only (no layout/border-radius opinions) — for call sites that
// render their own badge shape but want the shared per-status palette.
export const statusTint = (status?: string) => FAMILY_TINT[familyOf(status)];

// ── Chip geometry ─────────────────────────────────────────────────────────────
// ONE corner radius for every small tinted badge in the app — status chips, count
// pills, variant/colour/combo chips, qty chips, tag chips, permission chips. Views
// used to pick their own: modern radii of 3, 4, 5, 6, 8, 10 and 999 were all in
// use, classic was 0 or 2, and ~60 chips set none at all — so two chips in the SAME
// table cell rendered one square and one pill. Radius encodes nothing here, so the
// drift was pure noise.
//
// Deliberately NOT theme-aware: a `classic ? a : b` radius is what produced the
// drift in the first place (every view re-picked both halves), and 1-2px of corner
// is invisible against XP chrome. One number, both themes. Import it; never
// hand-write a chip radius.
export const CHIP_RADIUS = 3;

export const CODE_CHIP_RADIUS = CHIP_RADIUS;

// Interactive-chrome corner radius — same single-constant rule as CHIP_RADIUS,
// and the same reason: one number, or every view re-picks. Covers the controls a
// user acts on — toolbar buttons, xpBtn, modal footer actions, row action
// buttons, the "..." trigger, toggle chips, text inputs/selects, and the top
// corners of a tab. Static chrome stays square: panels, bevel windows, title
// bars, table cells, progress tracks.
export const BUTTON_RADIUS = 3;

// Window-chrome corner radius — the outer frame of a floating window (modal /
// dialog panel), which XP itself rounded while leaving docked panels square.
// Bigger than BUTTON_RADIUS on purpose: it is what separates a window that
// floats above the page from the flat chrome behind it. One number, both
// themes; the inner surfaces it clips use WINDOW_RADIUS_INNER (radius minus
// the 2px bevel border, so the corner reads as one curve, not two).
//
// This is the TOP of the radius scale, and the scale only ever steps DOWN as you
// nest: window 8 > FormSection 6 > buttons/inputs/chips 3. Concentric corners —
// a box nested inside a rounder frame pinches the gap between the two curves and
// reads as bulging out of it, which is exactly what an 8px FormSection inside a
// 6px dialog did. Never let an inner radius exceed the frame that clips it.
export const WINDOW_RADIUS = 8;
export const WINDOW_RADIUS_INNER = WINDOW_RADIUS - 2;

// Docked-panel corner radius — the outer shell of a page/table view (`xpBevel` /
// `ShellWindow`), which sits IN the page rather than floating over it. Same value
// as WINDOW_RADIUS and the same tier of the scale: a view shell and a dialog are
// both "the frame everything else sits in", so they must not read as two
// different chrome languages on the same screen. XP itself left docked panels
// square; that is the one XP detail this app deliberately drops, because the
// square page shell under a rounded dialog looked like unfinished chrome.
//
// The shell must clip (`overflow: hidden`) or the square title bar pokes out of
// the rounded corners. With the 2px classic bevel, CSS clips the padding box at
// radius-minus-border-width automatically, so the title bar lands on 6 and the
// corner reads as one curve without any WINDOW_RADIUS_INNER-style arithmetic.
//
// NOT the global app header (`.classic-header`): that bar is full-bleed chrome
// pinned to the top of the viewport, so it stays square on purpose.
export const PANEL_RADIUS = WINDOW_RADIUS;

// The class that carries the shared button hover/press motion (see the BUTTONS
// block in globals.css). Tag any classic button with it instead of hand-rolling
// onMouseEnter/onMouseLeave state — it animates filter/transform/box-shadow only,
// so it layers over whatever inline gradient face the button paints.
export const XP_BTN = 'xp-btn';

// Same idea for tab strips, but a separate class on purpose: `.xp-btn`'s hover
// lifts the button off the surface, which is exactly wrong for a tab seated in
// its strip with an open bottom seam. `.xp-tab` wipes an underline in instead
// (see the TABS block in globals.css). Pair it with XP_TAB_ACTIVE on the
// selected tab so it opts out of the hover.
export const XP_TAB = 'xp-tab';
export const XP_TAB_ACTIVE = 'xp-tab-active';

// StatusChip is the XP-flavoured chip used in BOTH themes (it always renders on
// xpFont), so it takes the classic geometry in both rather than threading a
// `classic` flag through its ~100 call sites. 2px vs 4px at 9px type is invisible;
// what matters is that no chip is square while its neighbour is a pill.
export const statusChipStyle = (status?: string, extra: React.CSSProperties = {}, tint = false): React.CSSProperties => {
    const c = tint ? FAMILY_TINT[familyOf(status)] : FAMILY_CHIP[familyOf(status)];
    return {
        display: 'inline-block', fontSize: 9, fontWeight: 'bold',
        padding: '1px 6px', borderRadius: CHIP_RADIUS, border: '1px solid',
        fontFamily: xpFont, whiteSpace: 'nowrap',
        background: c.background, borderColor: c.borderColor, color: c.color,
        ...extra,
    };
};

// THE chip primitive. Any small bordered+tinted inline badge goes through this so
// geometry (radius, padding, gap, border, nowrap) lives in one place and only the
// palette varies per call site. Pass `tone` for the palette (background/borderColor/
// color — from statusTint, workCenterChipStyle, or a literal), `icon` for a leading
// bootstrap-icon class, `swatch` for a colour dot, `onRemove` for a pick-list "x".
// Don't re-roll a chip span in a view; if a variant is missing, add it here.
export function Chip({
    children, classic, tone, icon, swatch, title, onRemove, onClick, bold, size = 'sm', truncate, style,
}: {
    children: React.ReactNode;
    classic?: boolean;
    tone?: { background?: string; borderColor?: string; color?: string };
    icon?: string;
    swatch?: string | null;
    title?: string;
    onRemove?: () => void;
    onClick?: () => void;
    bold?: boolean;
    size?: 'xs' | 'sm' | 'md';
    /** Clip the label to the container instead of overflowing it (fixed-width table
     *  cells). The chip never grows past its parent; the text ellipses, the icon,
     *  swatch and remove button stay. Pair with a `title` carrying the full text. */
    truncate?: boolean;
    style?: React.CSSProperties;
}) {
    const fs = size === 'xs' ? (classic ? 9 : 9.5) : size === 'md' ? (classic ? 11 : 12) : (classic ? 10 : 11);
    const labelRef = useRef<HTMLSpanElement>(null);
    // Which surface this hover wants. Decided in shouldOpen against the live DOM
    // (a chip is only clipped at some column widths), read back on render — by
    // then the rect state has committed, so the ref is already correct.
    const mode = useRef<'pop' | 'tip' | null>(null);
    const { rect, anchorEl, handlers } = useHoverAnchor({
        delay: 260,
        enabled: !!truncate || !!title,
        shouldOpen: () => {
            // A clipped chip completes itself; an unclipped one with a title
            // explains itself. Never both — the popout already shows the text the
            // title would have repeated.
            if (truncate && isClipped(labelRef.current)) { mode.current = 'pop'; return true; }
            if (title) { mode.current = 'tip'; return true; }
            return false;
        },
    });

    const chipStyle: React.CSSProperties = {
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: tone?.background ?? (classic ? '#f0ede4' : '#eef1f4'),
        border: '1px solid',
        borderColor: tone?.borderColor ?? (classic ? '#b0a898' : '#dee2e6'),
        color: tone?.color ?? (classic ? '#333' : '#495057'),
        borderRadius: CHIP_RADIUS,
        padding: size === 'md' ? '1px 7px' : '1px 6px',
        fontFamily: classic ? xpFont : modernFont,
        fontSize: fs,
        fontWeight: bold ? 700 : 400,
        lineHeight: 1.45,
        whiteSpace: 'nowrap',
        cursor: onClick ? 'pointer' : undefined,
        ...(truncate ? { maxWidth: '100%', minWidth: 0, overflow: 'hidden' } : null),
        ...style,
    };

    const inner = (clipped: boolean) => (
        <>
            {icon && <i className={`bi ${icon}`} style={{ fontSize: fs - 1.5, opacity: 0.8 }} />}
            {swatch && <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, display: 'inline-block', background: swatch, border: '1px solid rgba(0,0,0,0.25)' }} />}
            {truncate
                ? <span ref={clipped ? labelRef : undefined} style={{ overflow: clipped ? 'hidden' : 'visible', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{children}</span>
                : children}
            {onRemove && (
                <button type="button" onClick={e => { e.stopPropagation(); onRemove(); }} title="Remove"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: classic ? '#a00' : '#dc2626', fontWeight: 'bold', lineHeight: 1, padding: 0, marginLeft: 1, fontSize: fs + 2 }}>×</button>
            )}
        </>
    );

    return (
        <>
            <span {...handlers} data-no-tip="" onClick={onClick} style={chipStyle}>{inner(true)}</span>
            {rect && (mode.current === 'pop'
                ? (
                    // Same chip, unclipped, over its own position — it grows out of
                    // where it already was instead of arriving as a second badge.
                    <FloatingLayer rect={rect} anchorEl={anchorEl} placement="over" className="chip-pop-anim">
                        {/* margin: 0 — a caller's margin is spacing from its NEIGHBOUR
                            in the row; on the popout, which is placed absolutely on the
                            chip, the same margin is a pure offset off the target. */}
                        <span style={{ ...chipStyle, margin: 0, maxWidth: 'none', overflow: 'visible', boxShadow: '0 2px 8px rgba(0,0,0,0.22)' }}>{inner(false)}</span>
                    </FloatingLayer>
                )
                : (
                    <FloatingLayer rect={rect} anchorEl={anchorEl} className="tip-anim">
                        <TooltipSurface classic={!!classic}>{title}</TooltipSurface>
                    </FloatingLayer>
                ))}
        </>
    );
}

// ---------------------------------------------------------------------------
// Variant identity — THE tone map and THE chip for "which variant is this?"
//
// Size / combo / shade / pending-labdip / loose attribute / location / order / qty
// were each being re-coloured per view (WO list, netting plan, BOM list, lot
// pickers, SO table, batches, quarantine all had their own palette), so the same
// shade read pink on one page, slate on the next and beige on a third. The map
// lives here and nothing picks its own hue: a shade is a shade everywhere. Swap a
// hue HERE and every page follows — never per view.
// ---------------------------------------------------------------------------
export const VARIANT_TONE = {
    // Shade chips are the NEUTRAL slate ones and size takes the pink: a shade often
    // carries its own colour swatch, and a real swatch sitting on a tinted fill reads
    // as a colour clash rather than as the colour of the goods. Neutral behind the
    // swatch keeps the swatch the only colour in the chip.
    size: { color: '#8a3a5a', background: '#fdeaf1', borderColor: '#e8bcd0' },
    combo: { color: '#5a4499', background: '#efeaff', borderColor: '#cabbec' },
    color: { color: '#3d4d5c', background: '#e8edf0', borderColor: '#b8c4cc' },
    pending: { color: '#7a4500', background: '#fdf3d8', borderColor: '#e0c080' },
    material: { color: '#3a6b2a', background: '#e8f0e2', borderColor: '#b8d0a8' },
    location: { color: '#0058e6', background: '#e8f0ff', borderColor: '#a8c8f0' },
    order: { color: '#444444', background: '#eceae2', borderColor: '#c4c2ba' },
    qty: { color: '#1a5e1a', background: '#e4f3e4', borderColor: '#a8d0a8' },
} as const;

export type VariantKind = keyof typeof VARIANT_TONE;

// Reference tones — the badges that name a REFERENCE rather than a variant: an
// item's category, the warehouse and bin a balance sits in, the lot it belongs to,
// the supplier lot it came in on, the MO that produced it. These hexes were
// declared inline in the stock and ledger tables (twice each, once per theme);
// they keep their colours and lose the duplication. Render them with `<Chip>`.
export const REF_TONES = {
    category:    { color: '#2a464a', background: '#e4eef0', borderColor: '#8fb3bb' },
    warehouse:   { color: '#4a4a2a', background: '#eef0e4', borderColor: '#b7bb8f' },
    bin:         { color: '#3a2a4a', background: '#e8e1f0', borderColor: '#a890c0' },
    lot:         { color: '#5a3c00', background: '#fff8dc', borderColor: '#c8a000' },
    supplierLot: { color: '#4a4438', background: '#f0ece0', borderColor: '#b0a890' },
    producedBy:  { color: '#2a4a2a', background: '#e4f0e4', borderColor: '#8fbb8f' },
} as const;

/** The tone triple for `<Chip tone={...}>`, for the few callers that need the raw palette. */
export const variantChipTone = (kind: VariantKind) => VARIANT_TONE[kind];

// Default leading icon per kind. A size chip always wears the ruler, a combo the
// grid, a pending shade the eyedropper — pass `icon` to override, `icon={null}`
// to drop it (a chip that carries a colour swatch doesn't want one).
const VARIANT_ICON: Partial<Record<VariantKind, string>> = {
    size: 'bi-rulers',
    combo: 'bi-grid-3x3-gap',
    pending: 'bi-eyedropper',
    location: 'bi-geo-alt',
};

/** One variant-identity badge. Geometry comes from `Chip`, colour from `VARIANT_TONE`. */
export function VariantChip({
    kind, children, classic, swatch, icon, mono, title, size = 'xs', bold = true, onRemove, onClick, truncate, style,
}: {
    kind: VariantKind;
    children: React.ReactNode;
    classic?: boolean;
    swatch?: string | null;
    /** Override the kind's default icon; `null` renders none. */
    icon?: string | null;
    /** Chip holds a CODE (supplier lot, producing order) — takes the app-wide code face. */
    mono?: boolean;
    title?: string;
    size?: 'xs' | 'sm' | 'md';
    bold?: boolean;
    onRemove?: () => void;
    onClick?: () => void;
    /** Clip the label to the parent's width instead of overflowing it. */
    truncate?: boolean;
    style?: React.CSSProperties;
}) {
    // A swatch already says "this is a colour", so the palette icon would be noise.
    const ic = icon === null ? undefined : (icon ?? (swatch ? undefined : VARIANT_ICON[kind]));
    return (
        <Chip
            classic={classic}
            tone={VARIANT_TONE[kind]}
            size={size}
            bold={bold}
            icon={ic}
            swatch={swatch}
            title={title}
            onRemove={onRemove}
            onClick={onClick}
            truncate={truncate}
            style={mono ? { fontFamily: CODE_FONT, ...style } : style}
        >{children}</Chip>
    );
}

// Document-origin badges — the SO/PO/PR/MO/WO references that hang off a row as
// secondary provenance ("where did this come from"), not as the row's own identity
// (that stays a bare `CodeChip`). Several sit side by side, so the prefix + tone is
// what separates them at a glance; the tone map lives here so PR is the same purple
// on every page instead of being re-picked per view.
export const ORIGIN_TONES = {
    wo: { color: '#1d5c2e', background: '#e4f2e6', borderColor: '#a8ccb0' },
    mo: { color: '#444444', background: '#eceae2', borderColor: '#c4c2ba' },
    pr: { color: '#5a4499', background: '#efeaff', borderColor: '#cabbec' },
    so: { color: '#0058e6', background: '#e8f0ff', borderColor: '#a8c8f0' },
    po: { color: '#7a4500', background: '#fdf3d8', borderColor: '#e0c080' },
} as const;

export type OriginKind = keyof typeof ORIGIN_TONES;

const ORIGIN_TITLE: Record<OriginKind, string> = {
    wo: 'Work Order', mo: 'Manufacturing Order', pr: 'Production Run',
    so: 'Sales Order', po: 'Purchase Order',
};

/** One origin reference as a badge. `prefix` false drops the "PR "/"SO " label when
 *  the code already carries it (MO-00012) or the column header says which it is. */
export function OriginChip({ kind, code, classic, prefix = true, title, size = 'xs', truncate, style }: {
    kind: OriginKind;
    code: React.ReactNode;
    classic?: boolean;
    prefix?: boolean;
    title?: string;
    size?: 'xs' | 'sm' | 'md';
    /** Clip to the parent's (narrow column) width; hover pops the full chip. */
    truncate?: boolean;
    style?: React.CSSProperties;
}) {
    return (
        <Chip
            classic={classic}
            tone={ORIGIN_TONES[kind]}
            size={size}
            bold
            truncate={truncate}
            title={title ?? `${ORIGIN_TITLE[kind]}: ${typeof code === 'string' ? code : ''}`.trim()}
            style={{ fontFamily: CODE_FONT, gap: 3, ...style }}
        >
            {prefix ? `${kind.toUpperCase()} ${code}` : code}
        </Chip>
    );
}

/** Origin badges on one line — the row never grows taller, the table scrolls.
 *  data-no-tip covers the whole cluster, not just each chip: the gaps between
 *  chips sit inside a titled ancestor row in some callers, and without this the
 *  pointer drifting across a gap re-steals/restores that title mid-hover —
 *  racing against a chip's own tooltip and showing both at once. */
export function OriginChipRow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <div data-no-tip="" style={{ display: 'flex', flexWrap: 'nowrap', gap: 3, alignItems: 'center', whiteSpace: 'nowrap', ...style }}>
            {children}
        </div>
    );
}

export function StatusChip({ status, label, style, tint, title }: { status: string; label?: string; style?: React.CSSProperties; tint?: boolean; title?: string }) {
    const chip = (
        <span style={statusChipStyle(status, style, tint)}>
            {(label ?? status).replace(/_/g, ' ').toUpperCase()}
        </span>
    );
    // Status chips are never clipped (they're short and nowrap), so the only hover
    // surface they need is the explanatory one.
    return title ? <Tooltip content={title}>{chip}</Tooltip> : chip;
}

// Count pill — "<n> approved" as one tinted, bounded unit instead of loose numbers
// separated by "|". For status-bar tallies where the reader scans for a status and
// wants its number, not a sentence. Uses the same 5-family tint palette as
// StatusChip, so a status reads the same color wherever it appears.
export function StatusCountPill({ status, count, label, classic, title }: {
    status: string; count: number; label?: string; classic?: boolean; title?: string;
}) {
    const c = statusTint(status);
    const pill = (
        <span
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: classic ? '0 6px' : '1px 9px',
                borderRadius: CHIP_RADIUS,
                border: '1px solid', borderColor: c.borderColor,
                background: c.background, color: c.color,
                fontFamily: classic ? xpFont : modernFont,
                fontSize: classic ? 10 : 11,
                lineHeight: classic ? '15px' : '17px',
                whiteSpace: 'nowrap',
            }}
        >
            <strong style={{ fontWeight: 700 }}>{count}</strong>
            <span style={{ opacity: 0.85 }}>{(label ?? status).replace(/_/g, ' ').toLowerCase()}</span>
        </span>
    );
    return title ? <Tooltip content={title}>{pill}</Tooltip> : pill;
}

// Work-center chip palette keyed on center_type (case-insensitive). Falls back
// to sniffing the work-center *name* for a process word when the type is
// GENERAL/blank, then to a neutral gray. Single source for the WO panel/list
// and the BOM list — do not hand-copy this palette per view.
const WC_CHIP: Record<string, { background: string; color: string; borderColor: string }> = {
    BEAMING:   { background: '#fce8ff', color: '#660088', borderColor: '#dda8f0' },
    WARPING:   { background: '#fff3cc', color: '#664400', borderColor: '#f0d888' },
    DYEING:    { background: '#cce4ff', color: '#004b99', borderColor: '#99c4ee' },
    SETTING:   { background: '#ffeacc', color: '#994d00', borderColor: '#e8c488' },
    WEAVING:   { background: '#e8d8ff', color: '#440099', borderColor: '#c4a8ee' },
    FINISHING: { background: '#d4f0d4', color: '#005500', borderColor: '#99cc99' },
    CUTTING:   { background: '#fff0cc', color: '#886600', borderColor: '#ddcc88' },
};
// Process synonyms (incl. Indonesian) aliased onto the canonical keys above.
const WC_ALIAS: Record<string, keyof typeof WC_CHIP> = {
    CELUP: 'DYEING', TENUN: 'WEAVING', FINISH: 'FINISHING', POTONG: 'CUTTING',
};
const WC_NEUTRAL = { background: '#e4e2dc', color: '#444444', borderColor: '#c4c2ba' };

// AttributeValue has no stored hex, so variant color swatches are derived
// from the value text via this EN+ID name map (display aid only; the text
// label always stays for unmapped values). Single source — do not re-copy
// this map into individual views (was duplicated in BOMView before).
export const COLOR_HEX: Record<string, string> = {
    red: '#d32f2f', merah: '#d32f2f',
    blue: '#1565c0', biru: '#1565c0',
    green: '#2e7d32', hijau: '#2e7d32',
    yellow: '#f9a825', kuning: '#f9a825',
    black: '#111111', hitam: '#111111',
    white: '#fbfbf7', putih: '#fbfbf7',
    grey: '#757575', gray: '#757575', abu: '#757575',
    orange: '#ef6c00', oranye: '#ef6c00', jingga: '#ef6c00',
    purple: '#6a1b9a', ungu: '#6a1b9a',
    pink: '#ec407a',
    brown: '#5d4037', coklat: '#5d4037', cokelat: '#5d4037',
    navy: '#1a237e', dongker: '#1a237e',
    gold: '#c9a227', emas: '#c9a227',
    silver: '#b0bec5', perak: '#b0bec5',
    cream: '#efe7d2', krem: '#efe7d2',
    maroon: '#7b1f2b', marun: '#7b1f2b',
    tosca: '#12a4a4', toska: '#12a4a4',
    tan: '#d2b48c', beige: '#e8dcc0',
};
export function colorHexFor(name?: string): string | null {
    if (!name) return null;
    const k = name.trim().toLowerCase();
    if (COLOR_HEX[k]) return COLOR_HEX[k];
    for (const tok of k.split(/[\s\-_/]+/)) if (COLOR_HEX[tok]) return COLOR_HEX[tok];
    return null;
}

// Colour code vs colour name: in real data they are near-identical ("318" / "318",
// "HITAM MERAH CABAI" / "HITAM MERAH CABAI"), so the `{code} — {name}` label every
// view used to build was mostly duplicated text that overflowed narrow cells. The
// CODE is the display label everywhere; the name only survives on the tooltip, and
// only when it actually says something the code does not.
export const colorLabel = (code?: string | null, name?: string | null): string =>
    (code || name || '').trim();
export const colorTitle = (code?: string | null, name?: string | null): string => {
    const c = (code || '').trim(), n = (name || '').trim();
    return c && n && n.toLowerCase() !== c.toLowerCase() ? `${c} — ${n}` : (c || n);
};

// A shade's hex can live in two places that don't always agree: the Color
// Library row (`Color.hex`, the FG's `color_id`) and the mirrored `Colors`
// variant attribute value (`AttributeValue.hex`, picked on the Attributes
// page) that rides along on `variant_attributes`. Either caller may have only
// one of the two on hand, so every swatch resolves through this one fallback
// chain instead of each screen picking whichever field it happened to load —
// that drift is what made the same shade show a dot on one table and not the
// other.
export const resolveColorHex = (
    primaryHex?: string | null,
    attrs?: { system_role?: string | null; hex?: string | null }[] | null,
): string | null => primaryHex || (attrs || []).find(a => a.system_role === 'color')?.hex || null;

// THE colour swatch box — the square (not chip) form, for a swatch column or a
// colour card. Three faces, and the difference between them is load-bearing:
//   saved hex   → solid fill, solid border
//   derived hex → same fill, DASHED border ("this is what the name implies, but
//                 nobody has saved a swatch") — the honest middle state, since
//                 `colorHexFor` already colours these values on the BOM list and
//                 lab-dip chips, so hiding it here is the drift, not the fix
//   neither     → checkerboard, i.e. genuinely no colour
// Pass `onPick` for an editable swatch: it renders the hidden `<input type=color>`
// itself, which three call sites used to each hand-roll.
//
// `bands` is the fourth face and a different kind of value: several colours that
// together ARE the thing (a combo's `BLACK WHITE`, `NVYRED`), drawn as hard-stop
// bands. It keeps a SOLID border even though nothing is saved, because a combo has
// no hex field to be missing — the strip is a depiction, not a stand-in for one.
export function SwatchBox({ hex, derived, bands, size = 18, classic, title, onPick, style }: {
    hex?: string | null;
    /** Fallback shade implied by the name; rendered dashed to stay distinguishable. */
    derived?: string | null;
    /** Two or more hexes drawn as equal hard-stop bands. Wins over hex/derived; a
     *  single entry just fills the box. Pair with a wider `style.width`. */
    bands?: string[];
    size?: number;
    classic?: boolean;
    title?: string;
    onPick?: (hex: string) => void;
    style?: React.CSSProperties;
}) {
    const strip = (bands || []).filter(Boolean);
    if (strip.length) {
        const step = 100 / strip.length;
        return (
            <span
                title={title ?? `${strip.length} colour${strip.length !== 1 ? 's' : ''}`}
                style={{
                    display: 'inline-block', width: size, height: size, boxSizing: 'border-box',
                    borderRadius: classic ? 2 : 4, verticalAlign: 'middle',
                    border: '1px solid rgba(0,0,0,0.35)',
                    background: strip.length === 1
                        ? strip[0]
                        : `linear-gradient(90deg, ${strip.map((c, i) => `${c} ${(i * step).toFixed(3)}% ${((i + 1) * step).toFixed(3)}%`).join(', ')})`,
                    ...style,
                }}
            />
        );
    }
    const shown = hex || derived || null;
    const face: React.CSSProperties = {
        display: 'inline-block', width: size, height: size, boxSizing: 'border-box',
        borderRadius: classic ? 2 : 4, verticalAlign: 'middle', position: 'relative',
        background: shown || 'transparent',
        border: hex ? '1px solid rgba(0,0,0,0.35)' : `1px dashed ${classic ? '#a0988c' : '#94a3b8'}`,
        ...(shown ? null : {
            border: `1px solid ${classic ? '#a0988c' : '#94a3b8'}`,
            backgroundImage: 'linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%)',
            backgroundSize: '8px 8px', backgroundPosition: '0 0, 4px 4px',
        }),
        ...(onPick ? { cursor: 'pointer' } : null),
        ...style,
    };
    const tip = title ?? (hex ? hex : derived ? `${derived} — derived from the name, no swatch saved` : 'No swatch');
    if (!onPick) return <span title={tip} style={face} />;
    return (
        <label title={onPick ? `${tip}${hex ? ' — click to change' : ' — click to set'}` : tip} style={face}>
            <input
                type="color"
                value={shown || '#cccccc'}
                onChange={e => onPick(e.target.value)}
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            />
        </label>
    );
}

// Swatch + label chip for a color-attribute value (e.g. "ABU", "HITAM").
// `hex` overrides the derived lookup with a stored AttributeValue.hex, when known.
// `onRemove` renders a small "x" for removable pick-lists (e.g. lab dip request colors).
// Colour chip keyed off a label (Color Library rows, lab-dip colours, quarantine
// group shade). Thin wrapper on `VariantChip` — it exists only for the `hex`
// fallback: most callers hold a name and no hex, so the swatch is derived from the
// name via `colorHexFor`. It used to carry its own beige/gray palette, which is why
// the same shade read pink on the lot pickers and beige here.
export function ColorSwatchChip({ label, classic, hex: hexOverride, onRemove, size = 'sm', title }: {
    label: string; classic: boolean; hex?: string | null; onRemove?: () => void;
    size?: 'xs' | 'sm' | 'md'; title?: string;
}) {
    return (
        <VariantChip
            kind="color"
            classic={classic}
            size={size}
            swatch={hexOverride ?? colorHexFor(label)}
            title={title ?? `Color: ${label}`}
            onRemove={onRemove}
        >{label}</VariantChip>
    );
}

export function workCenterChipStyle(centerType?: string | null, name?: string | null): React.CSSProperties {
    const t = (centerType || '').toUpperCase();
    const hit = WC_CHIP[t] || (WC_ALIAS[t] && WC_CHIP[WC_ALIAS[t]]);
    if (hit) return { ...hit };
    // type gave nothing (GENERAL/blank) — sniff the name for a known process word
    const n = (name || '').toUpperCase();
    for (const key of Object.keys(WC_CHIP)) if (n.includes(key)) return { ...WC_CHIP[key] };
    for (const alias of Object.keys(WC_ALIAS)) if (n.includes(alias)) return { ...WC_CHIP[WC_ALIAS[alias]] };
    return { ...WC_NEUTRAL };
}

// Fully-decorated work-center type chip. `workCenterChipStyle` only returns the
// palette (background/color/borderColor) — callers used to hand-roll the border,
// padding and font on top, and one that forgot rendered as bare colored text.
// Use this component for any work-center type badge.
export function WorkCenterChip({ type, name, label }: { type?: string | null; name?: string | null; label?: string }) {
    const text = label ?? type ?? '';
    if (!text) return null;
    return (
        <span style={{
            ...workCenterChipStyle(type, name),
            display: 'inline-block', borderWidth: 1, borderStyle: 'solid',
            borderRadius: CHIP_RADIUS,
            fontSize: 9, padding: '1px 6px', whiteSpace: 'nowrap',
            fontFamily: xpFont, fontWeight: 'bold', lineHeight: 1.5,
        }}>{text}</span>
    );
}

// Location code badge. `in` (blue) is where material comes FROM, `out` (green)
// where it goes TO — the same pair the WO row's "Route" cell and the staging
// screens read left-to-right. `neutral` for a location with no direction (a stock
// bin in a list).
//
// This palette was hand-rolled in three places with the same literals and only one
// of them set a radius, so two location chips in the same panel rendered one
// rounded and one square. Goes through Chip so geometry and the clipped-label
// popout come from one place — a bin code is exactly the kind of text that gets
// cut off in a narrow cell.
const LOCATION_CHIP_TONES = {
    in: { background: '#e8f0fe', color: '#1a56c4', borderColor: '#b0c8f8' },
    out: { background: '#e6f4ea', color: '#1a6e2e', borderColor: '#a8d8b0' },
    neutral: { background: '#f0efe9', color: '#444', borderColor: '#c8c6be' },
} as const;

export function LocationChip({
    code, direction = 'in', classic, title, size = 'xs', children, style,
}: {
    /** Location code. Renders '?' when absent, matching the WO route cell. */
    code?: string | null;
    direction?: keyof typeof LOCATION_CHIP_TONES;
    classic?: boolean;
    title?: string;
    size?: 'xs' | 'sm' | 'md';
    /** Trailing detail inside the chip, e.g. the qty at that location. */
    children?: React.ReactNode;
    style?: React.CSSProperties;
}) {
    return (
        <Chip
            classic={classic}
            tone={LOCATION_CHIP_TONES[direction]}
            size={size}
            title={title}
            truncate
            style={style}
        >
            {code || '?'}{children}
        </Chip>
    );
}

// Rounded, bordered track + filled bar for at-a-glance completion (receiving
// progress, MO/WO progress, lineage) — the ONE progress bar shape for the
// whole app; new progress UI should use this instead of hand-rolling a
// track/fill pair. Tone defaults by fill level so callers don't have to
// compute it themselves (gray = 0%, amber = partial, green = 100%); pass one
// explicitly to override — e.g. `blue` for a generic "in progress" bar (per
// STATUS_FAMILY's IN_PROGRESS mapping), `red` for a shortfall bar.
// `hatched` gives the diagonal-stripe fill (MO Production Progress look);
// `secondaryPct`/`secondaryTone` stacks a second segment after the first
// (e.g. "planned" after "done"). `label`: 'outside' = trailing "NN%" text,
// 'inside' = centered overlay text, 'none' (default) = bar only.
const PROGRESS_FILL_DK: Record<StatusFamily, string> = { gray: '#c8c3b6', amber: '#c77800', blue: '#0058e6', green: '#2d7a2d', red: '#c00000' };
const PROGRESS_FILL_LT: Record<StatusFamily, string> = { gray: '#e2ddd0', amber: '#f5d060', blue: '#4a8fe8', green: '#6fce6f', red: '#e88a8a' };

/** The solid colour a `ProgressBar` segment paints, for a legend or key that sits
 *  beside one. Exported so a caller names the bar's own colour instead of
 *  hand-copying a hex that then drifts when the palette moves. */
export const progressToneColor = (tone: StatusFamily) => PROGRESS_FILL_DK[tone];

function progressBarFill(tone: StatusFamily, hatched: boolean): string {
    if (!hatched) return PROGRESS_FILL_DK[tone];
    return `repeating-linear-gradient(45deg,${PROGRESS_FILL_DK[tone]},${PROGRESS_FILL_DK[tone]} 3px,${PROGRESS_FILL_LT[tone]} 3px,${PROGRESS_FILL_LT[tone]} 6px)`;
}

export function ProgressBar({
    pct, tone, hatched = false, height = 10, width, title,
    secondaryPct, secondaryTone = 'gray',
    tertiaryPct, tertiaryTone = 'gray',
    markerPct, markerTitle,
    label = 'none',
}: {
    pct: number;
    tone?: StatusFamily;
    hatched?: boolean;
    height?: number;
    width?: number | string;
    title?: string;
    /** Second segment stacked after the primary fill (e.g. "planned" after "done"). */
    secondaryPct?: number;
    secondaryTone?: StatusFamily;
    /** Third segment stacked after the secondary fill (e.g. a 3-stage pipeline —
     *  shipped -> packed -> made). Ignored unless secondaryPct is also set. */
    tertiaryPct?: number;
    tertiaryTone?: StatusFamily;
    /** Threshold tick drawn over the track (e.g. a target efficiency the fill is
     *  measured against). Not a second fill — it marks a line, not an amount. */
    markerPct?: number;
    markerTitle?: string;
    /** 'outside' = bar + trailing "NN%" text (flex row); 'inside' = centered overlay label; 'none' (default) = bar only. */
    label?: 'outside' | 'inside' | 'none';
}) {
    const t: StatusFamily = tone || (pct >= 100 ? 'green' : pct > 0 ? 'amber' : 'gray');
    const clamped = Math.max(0, Math.min(100, pct));
    const secClamped = secondaryPct != null ? Math.max(0, Math.min(100 - clamped, secondaryPct)) : 0;
    const terClamped = tertiaryPct != null ? Math.max(0, Math.min(100 - clamped - secClamped, tertiaryPct)) : 0;
    const pctLabel = Math.round(clamped);

    const track = (
        <div style={{ flex: label === 'outside' ? 1 : undefined, border: '1px solid #7f9db9', borderRadius: 3, height, width: label === 'outside' ? undefined : (width ?? '100%'), background: '#e9e9e9', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${clamped}%`, background: progressBarFill(t, hatched), transition: 'width 0.2s' }} />
            {secondaryPct != null && (
                <div style={{ position: 'absolute', top: 0, left: `${clamped}%`, height: '100%', width: `${secClamped}%`, background: progressBarFill(secondaryTone, hatched), transition: 'width 0.2s, left 0.2s' }} />
            )}
            {tertiaryPct != null && (
                <div style={{ position: 'absolute', top: 0, left: `${clamped + secClamped}%`, height: '100%', width: `${terClamped}%`, background: progressBarFill(tertiaryTone, hatched), transition: 'width 0.2s, left 0.2s' }} />
            )}
            {markerPct != null && (
                <Tooltip content={markerTitle}>
                    <div
                        style={{
                            position: 'absolute', top: 0, bottom: 0,
                            left: `${Math.max(0, Math.min(100, markerPct))}%`,
                            width: 2, background: '#000',
                        }}
                    />
                </Tooltip>
            )}
            {label === 'inside' && (
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{
                        fontSize: Math.max(8, height - 7), fontWeight: 'bold', color: '#fff',
                        background: 'rgba(0,0,0,0.45)', borderRadius: 3, padding: '0 5px', lineHeight: `${height - 4}px`,
                    }}>
                        {pctLabel}%
                    </span>
                </span>
            )}
        </div>
    );

    // The bar carries long, multi-line explanations (MO step lists, receiving
    // breakdowns) — exactly the content the OS tooltip renders worst.
    const tipped = title ? <Tooltip content={title} maxWidth={380}>{track}</Tooltip> : track;
    if (label !== 'outside') return tipped;

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {tipped}
            <span style={{ fontSize: 10, fontFamily: CODE_FONT, minWidth: 32 }}>{pctLabel}%</span>
        </div>
    );
}

// ── Inline style helpers (XP widgets) ────────────────────────────────────────

// The four button intents. `default` is the bare XP face `xpBtn` already paints, so
// it is empty; the other three are patches you spread over it (or hand to
// `lvBtn(classic, tone)`, which owns the modern half). ~19 local copies used to
// carry their own blue/green/red — three different blues and three different greens
// across BOMDesigner, the WO modals and the print modals — which is why the faces
// live here now. Adding a fifth tone is almost never the answer.
export type BtnTone = 'default' | 'primary' | 'success' | 'danger';

export const BTN_TONES: Record<BtnTone, React.CSSProperties> = {
    default: {},
    primary: { background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)', color: '#fff', borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a', fontWeight: 'bold' },
    success: { background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', color: '#fff', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', fontWeight: 'bold' },
    danger:  { background: 'linear-gradient(to bottom, #c84040, #8e0000)', color: '#fff', borderColor: '#8e0000 #5e0000 #5e0000 #8e0000', fontWeight: 'bold' },
};

export const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily: xpFont, fontSize: '11px', padding: '2px 10px', cursor: 'pointer',
    background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)', border: '1px solid',
    borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#000000', borderRadius: BUTTON_RADIUS,
    // A button is sized by its label, never by what is next to it. Flex items
    // shrink by default, so a long sibling — a modal footer's "why this is
    // disabled" hint, a toolbar's filter summary — squeezed the buttons until
    // their labels wrapped, and a wrapped label is a taller button: the row ended
    // up with four different button heights. `extra` still spreads last, so a call
    // site that genuinely wants a flexible button (`flex: 1` on a mobile full-width
    // action) keeps overriding this.
    flexShrink: 0,
    ...extra,
});

export const xpInput = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily: xpFont, fontSize: '11px', border: '1px solid #7f9db9', borderRadius: BUTTON_RADIUS,
    padding: '1px 6px', background: '#ffffff', color: '#000000', height: '20px', outline: 'none',
    ...extra,
});

export const xpLabel = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily: xpFont, fontSize: '11px', display: 'block', marginBottom: 2,
    ...extra,
});

export const xpSelect = (extra: React.CSSProperties = {}): React.CSSProperties =>
    xpInput({ height: '22px', ...extra });

export const xpSep: React.CSSProperties = {
    width: '1px', height: '20px', background: '#a0988c', margin: '0 2px', flexShrink: 0,
};

export const xpPanel = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    background: '#f0f0e8', border: '1px solid',
    borderColor: '#ffffff #808080 #808080 #ffffff', borderRadius: 0,
    ...extra,
});

const MODAL_FOOTER_CLASSIC_TONES: Record<'success' | 'primary' | 'danger', React.CSSProperties> = {
    success: { background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#8fe08f #0a3e0a #0a3e0a #8fe08f', color: '#fff' },
    primary: { background: 'linear-gradient(to bottom, #6090e0, #2050c0)', borderColor: '#90b8f0 #102060 #102060 #90b8f0', color: '#fff' },
    danger:  { background: 'linear-gradient(to bottom, #e08080, #c03030)', borderColor: '#f0b0b0 #801010 #801010 #f0b0b0', color: '#fff' },
};

// THE standard footer for create/edit modals (PR, MO, and similar full-form
// modals): a muted Cancel + a solid bevel-gradient submit button. Classic
// theme needs the same manual bevel branch as XPActionButton/ConfirmModal —
// the global .btn-success/.btn-primary CSS override flattens color to plain
// gray, which is why a Bootstrap-only button looks unstyled in Classic.
// Don't hand-roll Cancel/Create buttons per modal — use this.
//
// `onSubmit` is optional: a read-only/dismiss-only modal passes just `onCancel`
// (with `cancelLabel="Close"`). `onExtra` adds ONE muted side action to the left of
// Cancel — for the MO Set-Color modal's "Clear", which previously existed only in
// the modern branch as a `btn-outline-danger` with no classic counterpart, so in
// Classic there was no way to clear a colour at all.
export function ModalFooterActions({
    classic,
    onCancel, cancelLabel = 'Cancel',
    onSubmit, submitLabel, submittingLabel = 'Saving...', submitting = false,
    variant = 'success', disabled = false,
    onExtra, extraLabel,
}: {
    classic: boolean;
    onCancel: () => void;
    cancelLabel?: string;
    onSubmit?: () => void;
    submitLabel?: string;
    submittingLabel?: string;
    submitting?: boolean;
    variant?: 'success' | 'primary' | 'danger';
    disabled?: boolean;
    onExtra?: () => void;
    extraLabel?: string;
}) {
    if (classic) {
        const tone = MODAL_FOOTER_CLASSIC_TONES[variant];
        return (
            <>
                {onExtra && extraLabel && (
                    <button
                        type="button"
                        className={XP_BTN}
                        onClick={onExtra}
                        style={{
                            fontFamily: xpFont, fontSize: 11, padding: '3px 16px', cursor: 'pointer',
                            borderRadius: BUTTON_RADIUS, border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                            background: 'linear-gradient(to bottom, #fff, #d4d0c8)', color: '#8a1a1a',
                        }}
                    >
                        {extraLabel}
                    </button>
                )}
                <button
                    type="button"
                    className={XP_BTN}
                    onClick={onCancel}
                    style={{
                        fontFamily: xpFont, fontSize: 11, padding: '3px 16px', cursor: 'pointer',
                        borderRadius: BUTTON_RADIUS, border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                        background: 'linear-gradient(to bottom, #fff, #d4d0c8)', color: '#000',
                    }}
                >
                    {cancelLabel}
                </button>
                {onSubmit && submitLabel && (
                    <button
                        type="button"
                        className={XP_BTN}
                        onClick={onSubmit}
                        disabled={submitting || disabled}
                        style={{
                            fontFamily: xpFont, fontSize: 11, fontWeight: 'bold', padding: '3px 20px', cursor: submitting || disabled ? 'default' : 'pointer',
                            borderRadius: BUTTON_RADIUS, border: '1px solid', opacity: submitting || disabled ? 0.6 : 1,
                            ...tone,
                        }}
                    >
                        {(submitting ? submittingLabel : submitLabel).toUpperCase()}
                    </button>
                )}
            </>
        );
    }
    return (
        <>
            {onExtra && extraLabel && (
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={onExtra}>
                    {extraLabel}
                </button>
            )}
            <button type="button" className="btn btn-sm btn-link text-muted text-decoration-none" onClick={onCancel}>
                {cancelLabel}
            </button>
            {onSubmit && submitLabel && (
                <button type="button" className={`btn btn-sm btn-${variant} px-4 fw-bold shadow-sm`} onClick={onSubmit} disabled={submitting || disabled}>
                    {submitting ? submittingLabel : submitLabel}
                </button>
            )}
        </>
    );
}

// The one header colour for every FormSection, both themes.
export const FORM_SECTION_BLUE = '#3a6fc4';

// Corner radius of a form group box. The middle tier of the nesting scale (see
// WINDOW_RADIUS): bigger than BUTTON_RADIUS because it is the container holding
// that 3px chrome, smaller than WINDOW_RADIUS because a dialog frame is what
// contains IT. Still one number for both themes, same rule as
// CHIP_RADIUS/BUTTON_RADIUS. The box must clip (`overflow: hidden`) or the square
// header bar pokes out of the rounded corners.
export const SECTION_RADIUS = 6;

// Groups related fields in a create/edit form under a labeled section.
// THE standard section chrome for every sectioned create/edit panel (Colors, Lab Dip,
// Sample Request, Inventory, …). Classic: raised bevel box with a flat blue header
// bar (white text). Modern: the same flat blue bar over a bordered white card.
// Do not hand-roll per-page group boxes — use this so all forms stay identical.
// `style` / `bodyStyle` exist for callers that own their own vertical rhythm
// (a gap-spaced stack passes `marginBottom: 0`) or that put a full-bleed table
// where the 10px form padding would inset it (`bodyStyle={{ padding: 0 }}`).
// They are overrides on this one chrome — not a licence to re-declare the box.
export function FormSection({ title, classic, children, style, bodyStyle }: {
    title: React.ReactNode;
    classic: boolean;
    children: React.ReactNode;
    style?: React.CSSProperties;
    bodyStyle?: React.CSSProperties;
}) {
    const box: React.CSSProperties = classic
        ? { border: '1px solid #c0bdb5', boxShadow: 'inset 1px 1px 0 #fff, 1px 1px 0 #c0bdb5', borderRadius: SECTION_RADIUS, overflow: 'hidden', marginBottom: 10, ...style }
        : { background: '#fff', border: '1px solid #dbe1ea', borderRadius: SECTION_RADIUS, marginBottom: 10, overflow: 'hidden', ...style };
    // Flat blue header in BOTH themes so every sectioned form reads the same. Solid,
    // not a gradient: the old left-to-right fade washed out to near-white by the right
    // edge, so a long title lost contrast halfway across and each box read as a
    // different colour depending on how wide it was.
    const header: React.CSSProperties = classic
        ? { background: FORM_SECTION_BLUE, color: '#fff', fontFamily: xpFont, fontSize: 10, fontWeight: 'bold', padding: '3px 8px', letterSpacing: '0.5px', textTransform: 'uppercase' as const }
        : { background: FORM_SECTION_BLUE, color: '#fff', fontFamily: modernFont, fontSize: 11, fontWeight: 700, padding: '6px 12px', letterSpacing: '0.04em', textTransform: 'uppercase' as const };
    return (
        <div style={box}>
            <div style={header}>{title}</div>
            <div style={{ background: '#fff', padding: '10px', ...bodyStyle }}>{children}</div>
        </div>
    );
}

// Fieldset-style panel with a floating legend notched into its top border — the
// grouping chrome used inside *operator log modals* (WO completion, packing),
// where FormSection's solid blue header bar would read as a page-level section
// and compete with the modal's own title bar. Was hand-rolled three times inside
// WOCompletionModal before this; `right` holds an optional action (e.g. "Print
// All Bag Labels") pinned to the legend line. `legendStyle` overrides the legend
// span itself (background must match a `style` background override, e.g. a
// tinted "Tip" box, or the default beige patch shows through behind the label).
export function LegendPanel({ title, right, children, style, legendStyle }: {
    title: React.ReactNode;
    right?: React.ReactNode;
    children: React.ReactNode;
    style?: React.CSSProperties;
    legendStyle?: React.CSSProperties;
}) {
    return (
        <div style={{ border: '1px solid #aca899', borderRadius: SECTION_RADIUS, background: '#f5f4ee', position: 'relative', paddingTop: 10, ...style }}>
            {/* One flex row for legend + right, both vertically centered on the same
                band — two independently-tuned absolute offsets drifted apart (the
                legend's own fix left `right` still straddling the border a
                different amount, so it visibly cut through whatever sat there). */}
            <div style={{
                position: 'absolute', top: -10, left: 0, right: 0, height: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 6px', pointerEvents: 'none',
            }}>
                {/* Own border + background (not just a colour-matched patch masking
                    the panel border) so the label reads as a distinct chip instead
                    of the panel's 1px border visibly cutting through the glyphs'
                    ascenders. */}
                <span style={{
                    pointerEvents: 'auto', background: '#fff', border: '1px solid #aca899',
                    borderRadius: 2, padding: '1px 5px', lineHeight: 1.3,
                    fontFamily: xpFont, fontSize: 10, fontWeight: 'bold', color: '#000080',
                    ...legendStyle,
                }}>
                    {title}
                </span>
                {right && <span style={{ pointerEvents: 'auto' }}>{right}</span>}
            </div>
            {children}
        </div>
    );
}

// Selected-chip tones. Blue is the default; the others exist for filters whose
// value carries its own semantics (ledger In/Out). Same five families as
// STATUS_FAMILY — don't add a sixth hue.
export type ChipTone = 'blue' | 'green' | 'red' | 'amber';

/** Position inside a segmented (flush) group — see `FilterChipBar`/`SegmentedBar`. */
export type ChipSeg = 'first' | 'mid' | 'last' | 'only';

// Pressed/unpressed button — THE on-off chip shape (weekday pickers, filter chips,
// segmented pickers). Now a thin adapter over terras-ui's ToggleChip, whose props
// (`on`/`tone`/`seg`/`flat`/`toneIdle`/`minWidth`) and tone union are identical to
// the ones this used to declare, so the ~42 call sites are untouched.
//
// Two things the package deliberately does differently, both wins:
//   - hover/press are CSS (`.terras-toggle:hover`), not React state. This used to
//     hold two useState hooks per chip; a segmented bar of eight held sixteen.
//   - modern is no longer bootstrap's solid/outline button pair — both themes now
//     come off the same --terras-* tokens, retoned by `.ui-style-classic`.
//
// `classic` is still accepted so no call site had to change, but it is inert: the
// theme is decided by the CSS class on the tree above, not by a prop.
export function ToggleChip({ on, onClick, classic: _classic, disabled = false, minWidth, title, seg, tone = 'blue', flat = false, toneIdle = false, children }: {
    on: boolean;
    onClick: () => void;
    /** @deprecated Inert — terras-ui reads the theme from `.ui-style-classic`. */
    classic?: boolean;
    disabled?: boolean;
    minWidth?: number;
    title?: string;
    seg?: ChipSeg;
    tone?: ChipTone;
    flat?: boolean;
    toneIdle?: boolean;
    children: React.ReactNode;
}) {
    const chip = (
        <UIToggleChip
            on={on}
            onClick={onClick}
            disabled={disabled}
            minWidth={minWidth}
            seg={seg}
            tone={tone}
            flat={flat}
            toneIdle={toneIdle}
        >{children}</UIToggleChip>
    );
    // The app's floating Tooltip, not the package's native `title` — the rest of
    // this file hangs hover text off the same GlobalTooltip layer, and a native
    // tooltip mid-strip would be the only one that looks different.
    return title ? <Tooltip content={title}>{chip}</Tooltip> : chip;
}

// Mon-first weekday picker (0=Mon … 6=Sun) — the working-days control on every
// production calendar. Both the per-machine monitor and the group batch-apply form
// had their own copy with different chrome (XP gradient buttons vs list-view
// buttons), so the same setting looked like two different controls; this is the
// one shape. Labels are fixed English abbreviations, matching the backend's
// weekday indexes.
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function WeekdayToggle({ value, onToggle, classic, disabled = false }: {
    value: number[];
    onToggle: (day: number) => void;
    classic: boolean;
    disabled?: boolean;
}) {
    return (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {WEEKDAY_LABELS.map((label, idx) => (
                <ToggleChip
                    key={label}
                    on={value.includes(idx)}
                    onClick={() => onToggle(idx)}
                    classic={classic}
                    disabled={disabled}
                    minWidth={classic ? 48 : 52}
                >
                    {label}
                </ToggleChip>
            ))}
        </div>
    );
}

// Icon + text (+ optional right-aligned trailing content) for a FormSection `title`.
// Pass as `title` so every group box shares the one header layout instead of each
// call site re-inventing the flex row.
export function SectionTitle({ icon, children, right }: { icon: string; children: React.ReactNode; right?: React.ReactNode }) {
    return (
        <span style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 6 }}>
            <i className={`bi ${icon}`} />{children}
            {right && <span style={{ marginLeft: 'auto', fontWeight: 'normal', textTransform: 'none', letterSpacing: 0 }}>{right}</span>}
        </span>
    );
}

// Field label with optional muted/italic helper caption below it — keeps the
// instruction text visually lighter than the label so a form of many fields
// doesn't read as one dense block of same-weight text.
//
// `hint` renders; `title` hovers. A caption earns its line only when the reader
// needs it every time (an empty-means-X rule they choose on, a figure they are
// correcting); the explanation of WHY a field works the way it does is read once
// and then costs a line forever, so it goes in `title` and the global tooltip
// layer renders it. A form of ten fields with ten captions reads as prose, which
// is the state this prop exists to get out of.
export function FieldLabel({ children, hint, title, classic, right }: { children: React.ReactNode; hint?: string; title?: string; classic: boolean; right?: React.ReactNode }) {
    return (
        <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <label
                    title={title}
                    style={classic ? { fontFamily: xpFont, fontSize: 11, fontWeight: 'bold', color: '#2b2822', margin: 0 } : undefined}
                    className={classic ? '' : 'form-label small fw-semibold mb-0'}
                >
                    {children}
                </label>
                {right}
            </div>
            {hint && (
                <div
                    style={classic ? { fontFamily: xpFont, fontSize: 10, color: '#938c76', fontStyle: 'italic', marginBottom: 3 } : undefined}
                    className={classic ? '' : 'text-muted small fst-italic mb-1'}
                >
                    {hint}
                </div>
            )}
        </>
    );
}

/**
 * Validation / submit-failure banner for a form or modal body. Three files had
 * byte-identical copies of this div (RoleFormModal, UserFormModal, and the color
 * variant modal, whose copy had already drifted to a different modern palette and
 * lost xpFont in classic) — which is the whole reason it lives here now. Renders
 * nothing for an empty message, so call sites need no `&&` guard.
 *
 * Not for status callouts (a "late" badge, a scanner error): those carry icons and
 * their own reds. This is specifically "what you just submitted was rejected".
 */
export function FormError({ children, classic, style }: {
    children?: React.ReactNode;
    classic: boolean;
    style?: React.CSSProperties;
}) {
    if (!children) return null;
    return (
        <div
            role="alert"
            className={classic ? '' : 'alert alert-danger py-2 small'}
            style={classic
                ? { background: '#f5e8e8', border: '1px solid #8e0000', color: '#8e0000', padding: '4px 8px', fontSize: 11, marginBottom: 10, fontFamily: xpFont, ...style }
                : { marginBottom: 10, ...style }}
        >
            {children}
        </div>
    );
}

// ── Loading / empty states ───────────────────────────────────────────────────

/**
 * XP-boot-style loading indicator: three blue blocks sliding across a track.
 * Keyframes + classes live in globals.css (.xp-loading-*).
 */
export function XPLoading({ label = 'Loading...', fullScreen = false }: { label?: string; fullScreen?: boolean }) {
    const inner = (
        <div style={{ textAlign: 'center', fontFamily: xpFont, userSelect: 'none' }}>
            <div style={{ fontSize: 12, fontWeight: 'bold', color: '#1a3d90', marginBottom: 8 }}>{label}</div>
            <div className="xp-loading-track">
                <div className="xp-loading-blocks">
                    <span /><span /><span />
                </div>
            </div>
        </div>
    );
    if (!fullScreen) return <div style={{ padding: '32px 0', display: 'flex', justifyContent: 'center' }}>{inner}</div>;
    return (
        <div style={{
            position: 'fixed', inset: 0, background: '#ece9d8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
            {inner}
        </div>
    );
}

// ── Skeleton placeholders ───────────────────────────────────────────────────
//
// A shimmering stand-in that carries the shape of what is coming beats a centred
// marquee that says only "something is happening". Not list-only: see the
// non-list skeletons further down (CardGridSkeleton / TableBlockSkeleton /
// PanelSkeleton) for grids, whole-table swaps and detail panes.
//
// XPLoading survives only where there is genuinely no shape to promise — a
// transient wait inside a flow whose next screen depends on what comes back
// (ScanDispatcher resolving a scanned code) — and for in-button spinners, which
// are Bootstrap's and stay as they are. Shimmer keyframes: globals.css .xp-skel.

/** One shimmering placeholder bar. */
export function SkeletonBar({ width = '100%', height = 9 }: { width?: number | string; height?: number }) {
    return <span className="xp-skel" style={{ display: 'block', width, height, borderRadius: 2 }} />;
}

// Deterministic width pattern — a fixed cycle, not Math.random(), so the
// skeleton doesn't reshuffle on every re-render while the fetch is in flight.
const SKEL_WIDTHS = ['72%', '46%', '61%', '38%', '83%', '54%', '67%', '43%'];
const skelWidth = (row: number, col: number) => SKEL_WIDTHS[(row * 3 + col * 5) % SKEL_WIDTHS.length];

/**
 * Placeholder rows for a table body. Emits real <tr>/<td> so the bars land in
 * the table's own columns — drop it straight into <tbody> in place of the
 * empty-state row.
 *
 * Pass the view's OWN cell style as `tdStyle` (its `tdBase`, `lvTd(classic)`,
 * …) rather than letting this re-derive one: padding, borders and font size
 * then match the real rows by construction, not by a copied guess that drifts
 * when the view is restyled.
 *
 * `cols` and `rowHeight` both come from `useTableSkeletonMetrics`, which reads
 * them off the real table. Hand-counted column numbers go stale the moment
 * anyone adds a column — and a skeleton one column short leaves a blank strip
 * where the last column should be.
 */
export function TableSkeleton({ rows = 6, cols, classic = false, tdStyle, rowHeight, fillHeight }: {
    /** Row count when `fillHeight` is unknown. */
    rows?: number;
    /** Column count — measure it with `useTableSkeletonMetrics`, don't count by hand. */
    cols: number;
    classic?: boolean;
    /** The view's real cell style. */
    tdStyle?: React.CSSProperties;
    /** Measured height of a real row, in px. */
    rowHeight?: number;
    /** Free height below the header, in px — rows are generated to fill it. */
    fillHeight?: number;
}) {
    const base: React.CSSProperties = tdStyle ?? {
        padding: classic ? '4px 6px' : '8px 10px',
        borderBottom: classic ? '1px solid #c0bdb5' : '1px solid #e6eaf1',
        fontSize: classic ? 11 : 13,
    };
    // Falls back to a typical row before any measurement exists (first-ever view
    // of a table), so even that load is close rather than text-height thin.
    const h = rowHeight ?? (typeof base.height === 'number' ? base.height : (classic ? 26 : 38));
    // Bar tracks the row's text size, so a dense classic table doesn't get
    // modern-sized bars (and vice versa).
    const fontPx = parseFloat(String(base.fontSize ?? (classic ? 11 : 13))) || (classic ? 11 : 13);
    const barHeight = Math.max(8, Math.round(fontPx * 0.8));
    // Fill the visible body rather than stopping mid-panel: a fixed row count
    // leaves dead space under the skeleton on a tall screen, which reads as "the
    // table ends here". Capped so a very tall viewport can't spawn hundreds.
    const rowCount = fillHeight && h > 0
        ? Math.min(40, Math.max(3, Math.ceil(fillHeight / h)))
        : rows;

    return (
        <>
            {Array.from({ length: rowCount }, (_, r) => (
                <tr key={`skel-${r}`} style={{ background: classic ? (r % 2 === 0 ? '#ffffff' : '#f5f3ee') : undefined }}>
                    {Array.from({ length: cols }, (_, c) => (
                        <td key={c} style={{ ...base, height: h, boxSizing: 'border-box', verticalAlign: 'middle' }}>
                            <SkeletonBar width={skelWidth(r, c)} height={barHeight} />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}

// ── Skeletons for non-list shapes ───────────────────────────────────────────
//
// TableSkeleton above only fits a <tbody>. The views that aren't lists — the
// loom grid, the report tables that are swapped out header and all, the drill-in
// detail panes — used to fall back to XPLoading's centred marquee, which says
// only "something is happening" and then jumps to a full page of content.
//
// Same rule as TableSkeleton: the stand-in must carry the shape of what is
// coming. Pass the real geometry (column count, card min-width, gaps) from the
// view — a skeleton that doesn't line up with the thing that replaces it is
// worse than no skeleton, because the shift reads as a bug. Where a view has no
// stable shape to promise, keep XPLoading.

/**
 * Stand-in for a card grid — same `auto-fill / minmax` track as the real grid,
 * so cards land in the same columns at every viewport width.
 *
 * `count` is how many placeholder cards to draw: enough to fill the fold, not
 * the real count (unknown while loading).
 */
export function CardGridSkeleton({
    count = 8, minWidth = 250, gap = 12, classic = false,
    headerStrip = true, bodyLines = 3, bar = true, bodyHeight,
}: {
    count?: number;
    /** Must match the real grid's minmax() floor. */
    minWidth?: number;
    gap?: number;
    classic?: boolean;
    /** Draw the coloured title strip cards carry across their top. */
    headerStrip?: boolean;
    bodyLines?: number;
    /** Draw a progress-bar-shaped block under the lines. */
    bar?: boolean;
    /** Force a card body height when the real card is taller than the lines imply. */
    bodyHeight?: number;
}) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`, gap }}>
            {Array.from({ length: count }, (_, i) => (
                <div
                    key={i}
                    style={classic
                        ? { border: '2px solid', borderColor: '#ffffff #808080 #808080 #ffffff', background: '#ece9d8' }
                        : { border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', overflow: 'hidden' }}
                >
                    {headerStrip && (
                        <div
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                                padding: classic ? '4px 7px' : '8px 12px',
                                background: classic ? '#a6a6a6' : '#f1f5f9',
                                borderBottom: `1px solid ${classic ? '#00000033' : '#e2e8f0'}`,
                            }}
                        >
                            <SkeletonBar width={skelWidth(i, 0)} height={classic ? 9 : 11} />
                            <SkeletonBar width={44} height={classic ? 9 : 11} />
                        </div>
                    )}
                    <div
                        style={{
                            padding: classic ? '7px 8px' : '12px',
                            background: '#fff',
                            display: 'flex', flexDirection: 'column', gap: classic ? 6 : 8,
                            minHeight: bodyHeight,
                        }}
                    >
                        {Array.from({ length: bodyLines }, (_, l) => (
                            <SkeletonBar key={l} width={skelWidth(i, l + 1)} height={classic ? 8 : 10} />
                        ))}
                        {bar && <SkeletonBar width="100%" height={classic ? 10 : 12} />}
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * Stand-in for a whole table *including* its header — for the views where the
 * loader replaces the `<table>` element itself, so there is no live `<thead>`
 * for TableSkeleton to sit under.
 *
 * Prefer TableSkeleton wherever the real header does render: it measures the
 * live table, this one is told. Pass the same `cols` the view is about to
 * render, and bump it for any leading spacer/expander column.
 */
export function TableBlockSkeleton({
    cols = 6, rows = 10, classic = false, header = true, rowHeight,
}: {
    cols?: number;
    rows?: number;
    classic?: boolean;
    header?: boolean;
    rowHeight?: number;
}) {
    const h = rowHeight ?? (classic ? 22 : 38);
    const pad = classic ? '4px 6px' : '8px 10px';
    const cellWidths = ['62%', '78%', '45%', '70%', '52%', '84%', '58%', '40%'];

    return (
        <div style={{ width: '100%' }}>
            {header && (
                <div
                    style={{
                        display: 'flex', gap: 0,
                        background: classic ? '#ece9d8' : '#f8fafc',
                        borderBottom: `1px solid ${classic ? '#b0a898' : '#e2e8f0'}`,
                    }}
                >
                    {Array.from({ length: cols }, (_, c) => (
                        <div key={c} style={{ flex: 1, padding: pad, minWidth: 0 }}>
                            <SkeletonBar width={cellWidths[(c * 3) % cellWidths.length]} height={classic ? 8 : 10} />
                        </div>
                    ))}
                </div>
            )}
            {Array.from({ length: rows }, (_, r) => (
                <div
                    key={r}
                    style={{
                        display: 'flex',
                        height: h, alignItems: 'center',
                        background: classic ? (r % 2 === 0 ? '#ffffff' : '#f5f3ee') : '#fff',
                        borderBottom: `1px solid ${classic ? '#e3e1dc' : '#eef2f7'}`,
                    }}
                >
                    {Array.from({ length: cols }, (_, c) => (
                        <div key={c} style={{ flex: 1, padding: pad, minWidth: 0 }}>
                            <SkeletonBar width={skelWidth(r, c)} height={classic ? 8 : 10} />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

/**
 * Stand-in for a detail pane: an optional section caption over label/value
 * rows. For drill-in panels and modal tabs, where what arrives is a block of
 * fields rather than rows or cards.
 */
export function PanelSkeleton({
    sections = 2, rows = 4, classic = false, caption = true,
}: {
    sections?: number;
    /** Label/value rows per section. */
    rows?: number;
    classic?: boolean;
    caption?: boolean;
}) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: classic ? 12 : 18, padding: classic ? 8 : 12 }}>
            {Array.from({ length: sections }, (_, s) => (
                <div key={s}>
                    {caption && (
                        <div
                            style={{
                                padding: classic ? '3px 6px' : '0 0 8px',
                                background: classic ? '#ece9d8' : undefined,
                                borderBottom: `1px solid ${classic ? '#b0a898' : '#e2e8f0'}`,
                                marginBottom: classic ? 8 : 10,
                            }}
                        >
                            <SkeletonBar width={s % 2 ? 120 : 150} height={classic ? 9 : 11} />
                        </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: classic ? 7 : 10 }}>
                        {Array.from({ length: rows }, (_, r) => (
                            <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                <SkeletonBar width={classic ? 92 : 120} height={classic ? 8 : 10} />
                                <SkeletonBar width={skelWidth(s + r, r)} height={classic ? 8 : 10} />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

// Measured row heights, keyed by table. Module-level so a remount reuses the
// value; sessionStorage so a reload does too. Column counts are NOT cached —
// they are read straight off the live <thead>, which is always rendered.
const rowHeightCache = new Map<string, number>();

export interface TableSkeletonMetrics {
    /** Height of a real row in px — undefined until one has been measured. */
    rowHeight?: number;
    /** Column count read from the table's own <thead>. */
    cols?: number;
    /** Free height under the header inside the scroll container, in px. */
    fillHeight?: number;
}

/** Nearest scrollable ancestor — the box the skeleton has to fill. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
    let node = el.parentElement;
    while (node) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') return node;
        node = node.parentElement;
    }
    return null;
}

/**
 * Reads a table's real geometry so its skeleton matches it.
 *
 * Two measurements, with different timing:
 *
 * - **cols** comes from the live `<thead>`, which renders whether or not there
 *   is data — so it is correct on the very first paint, including the first
 *   ever. This is the point: a hand-counted `cols` silently goes stale when
 *   someone adds a column, and the skeleton then leaves a blank strip where the
 *   new column sits.
 * - **rowHeight** needs a real row to exist, so the first-ever view of a table
 *   falls back to TableSkeleton's static estimate. It is cached (module Map +
 *   sessionStorage), so every later load — repeat navigation, reload, filter
 *   change — is pixel-exact.
 * - **fillHeight** is the free space under the header inside the scroll
 *   container, re-measured on resize. Without it a fixed row count leaves dead
 *   space under the skeleton on a tall screen, which reads as a table that
 *   simply ends early.
 *
 *   const bodyRef = useRef<HTMLTableSectionElement>(null);
 *   const skel = useTableSkeletonMetrics('sales-orders', bodyRef, rows.length > 0);
 *   …
 *   <tbody ref={bodyRef}>
 *       {rows.length === 0 && (loading
 *           ? <TableSkeleton cols={skel.cols ?? 12} classic={classic} tdStyle={tdBase} rowHeight={skel.rowHeight} />
 *           : <tr>…</tr>)}
 *
 * `key` must be stable per table, and distinct between two tables whose rows
 * are shaped differently (the classic and modern branches of one view share a
 * key only when their rows are the same height).
 */
export function useTableSkeletonMetrics(
    key: string,
    bodyRef: React.RefObject<HTMLElement | null>,
    hasRows: boolean,
): TableSkeletonMetrics {
    // Both start undefined on server and client alike — reading the cache during
    // render would make the first client paint disagree with the SSR markup.
    const [height, setHeight] = useState<number | undefined>(undefined);
    const [cols, setCols] = useState<number | undefined>(undefined);
    const [fillHeight, setFillHeight] = useState<number | undefined>(undefined);

    useEffect(() => {
        const cached = rowHeightCache.get(key) ?? (() => {
            try {
                const stored = Number(window.sessionStorage.getItem(`skel-row-h:${key}`));
                return Number.isFinite(stored) && stored > 0 ? stored : undefined;
            } catch { return undefined; }
        })();
        if (cached) {
            rowHeightCache.set(key, cached);
            setHeight(prev => prev ?? cached);
        }
    }, [key]);

    useEffect(() => {
        const body = bodyRef.current;
        if (!body) return;
        const table = body.closest('table');

        // Column count: the header row of this tbody's own table. Summing colSpan
        // rather than counting cells keeps grouped headers honest.
        const headRow = table?.querySelector('thead tr:last-of-type');
        if (headRow) {
            const measuredCols = Array.from(headRow.children)
                .reduce((n, th) => n + ((th as HTMLTableCellElement).colSpan || 1), 0);
            if (measuredCols > 0) setCols(prev => (prev === measuredCols ? prev : measuredCols));
        }

        // Free height under the header, tracked across viewport/panel resizes.
        const scroller = scrollParentOf(body);
        let observer: ResizeObserver | undefined;
        if (scroller) {
            const measureFill = () => {
                // clientHeight is layout px but getBoundingClientRect is screen px —
                // subtracting one from the other only agrees at 100% scale. Convert
                // the rect side. See uiScale.ts.
                const head = table?.querySelector('thead');
                const headH = head ? layoutRectOf(head).height : 0;
                const free = Math.round(scroller.clientHeight - headH);
                setFillHeight(prev => (prev === free ? prev : (free > 0 ? free : undefined)));
            };
            measureFill();
            observer = new ResizeObserver(measureFill);
            observer.observe(scroller);
        }

        // Row height, once there is a real row to measure. Every exit below runs
        // through the one cleanup so the observer is never left attached.
        const row = hasRows ? body.querySelector('tr') : null;
        if (row) {
            // Layout px, so the cached value stays valid across scale changes.
            const measured = Math.round(layoutRectOf(row).height);
            // 0 while the tab/table is display:none — don't cache that.
            if (measured > 0 && rowHeightCache.get(key) !== measured) {
                rowHeightCache.set(key, measured);
                try { window.sessionStorage.setItem(`skel-row-h:${key}`, String(measured)); } catch { /* private mode */ }
                setHeight(measured);
            }
        }

        return () => observer?.disconnect();
    }, [hasRows, key, bodyRef]);

    return { rowHeight: height, cols, fillHeight };
}

/** Placeholder rows for a non-table list pane (the dyeing/setting WO rails). */
export function ListSkeleton({ rows = 5, padding = '6px 8px' }: { rows?: number; padding?: string }) {
    return (
        <div>
            {Array.from({ length: rows }, (_, r) => (
                <div key={`skel-${r}`} style={{ padding, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <SkeletonBar width={skelWidth(r, 0)} />
                    <SkeletonBar width={skelWidth(r, 1)} height={7} />
                </div>
            ))}
        </div>
    );
}

// ── Status bar (classic Windows bottom strip) ───────────────────────────────

export function XPStatusBar({ children, right, style }: { children: React.ReactNode; right?: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
            background: 'linear-gradient(to bottom, #f4f2ea, #e3e1d6)',
            border: '1px solid', borderColor: '#808080 #ffffff #ffffff #808080',
            padding: '2px 8px', marginTop: 4,
            fontFamily: xpFont, fontSize: 10, color: '#333333',
            userSelect: 'none',
            ...style,
        }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
            {right && <span style={{ flexShrink: 0 }}>{right}</span>}
        </div>
    );
}

// ── Client-side table sorting ────────────────────────────────────────────────

export type SortState = { key: string; dir: 1 | -1 } | null;

const isNil = (v: any) => v === null || v === undefined || v === '';

function compareValues(a: any, b: any): number {
    if (isNil(a) && isNil(b)) return 0;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * The header-click transition, shared by client-side and server-side sorting:
 * unsorted -> asc -> desc -> unsorted, and a click on a different column starts
 * that column at asc. Pure, so a view whose sort state lives somewhere other than
 * local state (DataContext, a URL param) gets the same behaviour as useSortable.
 */
export function nextSortState(prev: SortState, key: string): SortState {
    if (prev?.key !== key) return { key, dir: 1 };
    return prev.dir === 1 ? { key, dir: -1 } : null;
}

/**
 * Sort state for a list the SERVER sorts — the view holds one page, so a column
 * header has to change a query param rather than reorder the rows in memory.
 * Sorting a page client-side puts the wrong rows on page 1 entirely, so reach for
 * this (not useSortable) whenever the rows arrive windowed.
 */
export function useServerSort(initial: SortState = null) {
    const [sort, setSort] = useState<SortState>(initial);
    const toggleSort = useCallback((key: string) => setSort(prev => nextSortState(prev, key)), []);
    return { sort, setSort, toggleSort };
}

/**
 * Sort rows client-side by a column key. `columns` maps key -> accessor.
 * toggle() cycles asc -> desc -> off per column. Empty values sort last in both directions.
 * Only correct when the view holds the WHOLE set — for a windowed list use useServerSort.
 */
export function useSortable<T>(rows: T[], columns: Record<string, (row: T) => any>, initialSort: SortState = null) {
    const [sort, setSort] = useState<SortState>(initialSort);

    const sorted = useMemo(() => {
        if (!sort || !columns[sort.key]) return rows;
        const acc = columns[sort.key];
        return [...rows].sort((ra, rb) => {
            const a = acc(ra), b = acc(rb);
            if (isNil(a) !== isNil(b)) return isNil(a) ? 1 : -1;
            return compareValues(a, b) * sort.dir;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, sort]);

    const toggle = (key: string) => setSort(prev => nextSortState(prev, key));

    return { sorted, sort, toggle };
}

/** Arrow indicator for a sortable column header. */
export function SortMark({ sort, colKey }: { sort: SortState; colKey: string }) {
    if (sort?.key !== colKey) return null;
    return <span style={{ marginLeft: 3, fontSize: 8 }}>{sort.dir === 1 ? '▲' : '▼'}</span>;
}

export function XPEmptyState({ message, icon = 'bi-inbox', children }: { message: string; icon?: string; children?: React.ReactNode }) {
    return (
        <div style={{
            background: '#ffffff', border: '1px solid',
            borderColor: '#808080 #ffffff #ffffff #808080',
            padding: '28px 16px', textAlign: 'center',
            fontFamily: xpFont, color: '#666666',
        }}>
            <i className={`bi ${icon}`} style={{ fontSize: 22, color: '#a0a0a0', display: 'block', marginBottom: 6 }} />
            <div style={{ fontSize: 11, fontStyle: 'italic' }}>{message}</div>
            {children}
        </div>
    );
}

// ── Row-actions "more" menu (⋯) ─────────────────────────────────────────────
// Fixed-position dropdown, keyed by row id, closed on outside click/scroll.
// One id open at a time — fits table rows where only one menu should ever
// be open. Was duplicated per-view (Samples' action dropdown, PO's ⋯ menu)
// before being pulled out here; migrate a view's local copy when you touch it.

export function useFloatingMenu(menuWidth = 175) {
    const [openId, setOpenId] = useState<string | null>(null);
    const [pos, setPos] = useState({ top: 0, left: 0 });

    useEffect(() => {
        const handleGlobalClick = (event: any) => {
            if (!event.target.closest('.xp-menu-trigger') && !event.target.closest('.xp-floating-menu')) {
                setOpenId(null);
            }
        };
        const handleScroll = () => setOpenId(null);
        document.addEventListener('click', handleGlobalClick);
        window.addEventListener('scroll', handleScroll, true);
        return () => {
            document.removeEventListener('click', handleGlobalClick);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, []);

    const toggle = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (openId === id) { setOpenId(null); return; }
        // Measured in screen px, written back as CSS px — convert, or the menu
        // drifts by the interface-scale factor. See uiScale.ts.
        const rect = layoutRectOf(e.currentTarget as HTMLElement);
        const scroll = layoutScroll();
        setPos({ top: rect.bottom + scroll.y + 2, left: rect.right + scroll.x - menuWidth });
        setOpenId(id);
    };

    return { openId, pos, toggle, close: () => setOpenId(null) };
}

/** "⋯" trigger button — square icon button in classic, link-style in modern. Always tagged .xp-menu-trigger so useFloatingMenu's outside-click check sees it. */
export function MenuTriggerButton({ classic, onClick, title = 'More actions' }: { classic: boolean; onClick: (e: React.MouseEvent) => void; title?: string }) {
    if (classic) {
        return (
            <Tooltip content={title}><button
                type="button"
                className={`xp-menu-trigger ${XP_BTN}`}
                onClick={onClick}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, background: 'none', border: '1px solid transparent', borderRadius: BUTTON_RADIUS, cursor: 'pointer', color: '#555', fontSize: '12px' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#7f9db9'; (e.currentTarget as HTMLButtonElement).style.background = '#e8f0f8'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
            >
                <i className="bi bi-three-dots"></i>
            </button></Tooltip>
        );
    }
    return (
        <Tooltip content={title}><button type="button" className="btn btn-sm btn-link text-muted p-0 d-inline-flex align-items-center justify-content-center xp-menu-trigger" style={{ width: 26, height: 26 }} onClick={onClick}>
            <i className="bi bi-three-dots fs-6"></i>
        </button></Tooltip>
    );
}

// ── Flat table-row action button ────────────────────────────────────────────
// The compact, flat (non-beveled) icon/label button used in table action
// columns — WO table, Lot Management, dyeing Stage/Log. Classic renders a
// single-border flat button (NOT the raised 4-color XP bevel, which reads as
// chunky/glossy at this size); modern maps the tone onto btn-outline-*.
// Pair with MenuTriggerButton for the "⋯" overflow in the same column.
export type XPActionTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

const XP_ACTION_TONES: Record<XPActionTone, { bg: string; border: string; fg: string }> = {
    neutral: { bg: 'linear-gradient(to bottom, #f0efe6, #dddbd0)', border: '#909090', fg: '#333333' },
    primary: { bg: 'linear-gradient(to bottom, #cfe0ff, #8fb3e8)', border: '#335599', fg: '#0a2a66' },
    success: { bg: 'linear-gradient(to bottom, #b0e8b0, #70c870)', border: '#0a3e0a', fg: '#004000' },
    warning: { bg: 'linear-gradient(to bottom, #ffe0b0, #e8b060)', border: '#99631a', fg: '#663300' },
    danger:  { bg: 'linear-gradient(to bottom, #f0c0c0, #d07070)', border: '#992222', fg: '#600000' },
};

const XP_ACTION_MODERN: Record<XPActionTone, string> = {
    neutral: 'btn-outline-secondary',
    primary: 'btn-outline-primary',
    success: 'btn-outline-success',
    warning: 'btn-outline-warning',
    danger:  'btn-outline-danger',
};

export function XPActionButton({
    classic, tone = 'neutral', icon, label, title, onClick, disabled = false, className,
}: {
    classic: boolean;
    tone?: XPActionTone;
    icon?: string;               // bootstrap-icon class, e.g. 'bi-box-seam'
    label?: React.ReactNode;     // optional text; icon-only when omitted
    title?: string;
    onClick: (e: React.MouseEvent) => void;
    disabled?: boolean;
    className?: string;          // extra classes — pass 'xp-menu-trigger' when this button opens a FloatingMenu
}) {
    const iconEl = icon ? <i className={`bi ${icon}`} /> : null;
    // Icon-only action buttons are the densest tooltip consumer in the app (a whole
    // action column of them), so they take the styled surface rather than the OS
    // one that arrives a second later in a different font.
    const tip = (btn: React.ReactElement) => title ? <Tooltip content={title}>{btn}</Tooltip> : btn;
    if (classic) {
        const t = XP_ACTION_TONES[tone];
        return tip(
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                className={[XP_BTN, className].filter(Boolean).join(' ')}
                style={{
                    fontFamily: xpFont, fontSize: 11, lineHeight: 1, padding: '2px 4px',
                    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
                    background: t.bg, border: `1px solid ${t.border}`, color: t.fg,
                    display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: BUTTON_RADIUS,
                }}
            >
                {iconEl}{label}
            </button>
        );
    }
    return tip(
        <button
            type="button"
            className={`btn ${XP_ACTION_MODERN[tone]} d-inline-flex align-items-center py-0 px-1`}
            style={{ fontSize: 11, gap: 4 }}
            onClick={onClick}
            disabled={disabled}
        >
            {iconEl}{label}
        </button>
    );
}

export type FloatingMenuItem = {
    key: string;
    label: React.ReactNode;
    icon?: string;
    onClick: () => void;
    danger?: boolean;
    title?: string;
    hidden?: boolean;
};

/** Renders at `pos` (from useFloatingMenu) — pair with a `.xp-menu-trigger`-tagged button. */
export function FloatingMenu({ pos, items, minWidth = 175 }: { pos: { top: number; left: number }; items: FloatingMenuItem[]; minWidth?: number }) {
    const visible = items.filter(i => !i.hidden);
    if (!visible.length) return null;
    return (
        <div
            className="xp-floating-menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, minWidth, background: '#fff', border: '1px solid #808080', boxShadow: '2px 2px 4px rgba(0,0,0,.25)' }}
        >
            {visible.map(item => (
                <button
                    type="button"
                    key={item.key}
                    title={item.title}
                    onClick={item.onClick}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left' as const,
                        background: 'none', border: 'none', padding: '6px 10px', fontSize: 11,
                        fontFamily: xpFont, cursor: 'pointer', color: item.danger ? '#aa0000' : '#222',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = item.danger ? '#fff0f0' : '#e8f0f8'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                >
                    {item.icon && <i className={`bi ${item.icon}`}></i>} {item.label}
                </button>
            ))}
        </div>
    );
}

// ── Expanded-row panel ──────────────────────────────────────────────────────
// Standard shape for any "expand this table row" detail panel (WO tree/detail,
// PR material requirements, and any future one). Two cues, no depth:
//   • a saturated left rail in the row-selection blue — pegs the panel to the
//     highlighted row it dropped out of, so the two read as one unit;
//   • heavy top/bottom rules — bracket the expansion as a break in the list.
// The body stays the same flat white as the rows, so wide content gets the full
// row width instead of a nested frame eating padding on both sides. This
// replaced an inset/recessed frame whose stacked shadows read as muddy rather
// than deep, especially against Classic's beige — no depth shadows here.
//
// The frame is painted with `inset` box-shadow, NOT `border`, and that is load-
// bearing: this panel lives in a `<td colSpan>` spanning every column, so any
// border or padding it declares feeds into that cell's min-content width, which
// auto table layout then distributes back across all the columns — the row above
// visibly jumps sideways on expand. Shadows never participate in layout, so the
// panel costs zero width. A call site that overrides `padding` must keep its left
// value >= RAIL_W — the rail paints inside the padding box, so with less reserve
// it sits on top of the content's first few pixels.
// Always pair the two: ExpandedRowPanel is the frame, ExpandedRowPanelBody the
// padded content box.
const RAIL_W = { classic: 4, modern: 3 };
const RULE_W = 2;

/** The rail + edge rules as a paint-only frame. Exported for the two views whose panel can't be a component (absolutely positioned, or a two-pane workspace keeping its own grounds) — they apply this to the `<td>` and must stay in sync with the component. `railColor` overrides the selection blue where the rail carries meaning (e.g. health on Booking Stock). */
export function expandedRowFrame(classic: boolean, railColor?: string): React.CSSProperties {
    const rail = classic ? RAIL_W.classic : RAIL_W.modern;
    const rule = classic ? '#808080' : '#adb5bd';
    return {
        boxShadow: [
            `inset ${rail}px 0 0 0 ${railColor || (classic ? '#316ac5' : '#2f6feb')}`,
            `inset 0 ${RULE_W}px 0 0 ${rule}`,
            `inset 0 -${RULE_W}px 0 0 ${rule}`,
        ].join(', '),
    };
}

// ---------------------------------------------------------------------------
// Row state backgrounds
// ---------------------------------------------------------------------------
// Three states a list row can be in, three grounds — never mix them up:
//   expanded    this row's detail panel is open below it. Selection blue, light.
//   selected    checked for a bulk action. Same hue, darker, so a selected row
//               that is also expanded still reads as selected.
//   highlighted transient attention only — scroll target, search hit. Amber.
// Blue is the expand convention app-wide (matches the ExpandedRowPanel rail);
// amber never means "open". Every list that expands a row must paint
// rowStateBg('expanded', classic) and nothing hand-rolled.
export type RowState = 'expanded' | 'selected' | 'highlighted';

const ROW_STATE_BG: Record<RowState, { classic: string; modern: string }> = {
    expanded: { classic: '#d6e4f7', modern: '#eef2ff' },
    selected: { classic: '#b8d0ef', modern: '#dbe4ff' },
    highlighted: { classic: '#fff8c4', modern: '#fef9c3' },
};

export const rowStateBg = (state: RowState, classic: boolean): string =>
    classic ? ROW_STATE_BG[state].classic : ROW_STATE_BG[state].modern;

export function ExpandedRowPanel({ classic, children, style }: { classic: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <div style={{
            ...expandedRowFrame(classic),
            background: '#fff',
            padding: classic ? 5 : 6,
            ...style,
        }}>
            {children}
        </div>
    );
}

/** Padded, transparent content box inside an ExpandedRowPanel — the panel already supplies the ground, so this adds no second background or frame. Pass `style` to override padding/border for layouts that need their own (e.g. a fixed-height two-pane body). */
export function ExpandedRowPanelBody({ classic, children, style }: { classic: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <div style={{
            padding: classic ? '4px 8px' : '6px 12px',
            ...style,
        }}>
            {children}
        </div>
    );
}

