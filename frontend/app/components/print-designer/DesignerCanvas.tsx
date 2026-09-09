'use client';
import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';

import type {
    PrintLayout, Band, GridBand, GridItem, KeyValueBand, TableBand, TallyBand, SignatureBand,
} from '../shared/printTemplate/types';
import { fieldDef } from '../shared/printTemplate/fieldRegistry';
import type { Selection } from './InspectorPanel';
import { clamp, parseTracks, xToColumn, yToRow, colWidthFromRect, rectRelativeTo, localPoint } from './dragGeometry';

/**
 * Direct-manipulation overlay for the print designer's paper preview.
 *
 * Renders on top of the real `TemplateRenderer` output (found via the `data-tpl-*`
 * attributes baked into it) as small grip/resize handles plus a few indicator
 * elements. Nothing here touches React state during a drag — indicators are
 * positioned by mutating their own DOM style directly (the same technique
 * `PrintModalShell`'s window-drag already uses), so dragging stays smooth
 * regardless of how large the layout is. The layout only changes once, on
 * pointer-up, via `onMutate` — which is also why one drag gesture is one undo step.
 *
 * Escape cancels a drag in progress without committing anything.
 *
 * Handles are drawn only for the band under the pointer or in the selection (unless
 * `alwaysShowHandles`). Every field and row carrying a permanent blue grip buried
 * the design under its own chrome — on an A6 card the grips outnumbered the fields.
 *
 * Everything measured here is divided by `zoom` and everything written back is in
 * layout pixels, because the sheet is scaled with `transform` — see
 * `rectRelativeTo` for why the two unit systems have to be reconciled in one place.
 */

const GRIP_SIZE = 15;

/**
 * Grips are quoted in on-screen pixels and divided by the view scale, so a handle
 * stays the same physical size (and stays grabbable) at 50% as at 200% — zooming is
 * for reading the design, not for shrinking its controls.
 */
const gripStyle = (x: number, y: number, active: boolean, zoom = 1): React.CSSProperties => ({
    position: 'absolute', left: x, top: y,
    width: GRIP_SIZE / zoom, height: GRIP_SIZE / zoom,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: active ? '#0058e6' : 'rgba(0,88,230,0.75)',
    color: '#fff', fontSize: 9 / zoom, lineHeight: 1, borderRadius: 2 / zoom,
    cursor: 'grab', pointerEvents: 'auto', userSelect: 'none', zIndex: 5,
    boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
});

interface Rects {
    grids: Map<string, DOMRect>;      // band id -> grid container rect
    gaps: Map<string, number>;        // band id -> grid gap px
    bands: Map<string, DOMRect>;      // band id -> band wrapper rect
    cells: Map<string, DOMRect>;      // "bandId:itemIndex" -> grid cell rect
    stackFields: Map<string, DOMRect>; // "bandId:itemIndex:stackIndex" -> rect
    kvRows: Map<string, DOMRect>;     // "bandId:rowIndex" -> row rect (label td)
    tableCols: Map<string, DOMRect>;  // "bandId:colIndex" -> th rect
    tallyCols: Map<string, DOMRect>;  // "bandId:colIndex" -> th rect
    sigBoxes: Map<string, DOMRect>;   // "bandId:boxIndex" -> box rect
}

function measure(paper: HTMLElement, zoom = 1): Rects {
    const rects: Rects = {
        grids: new Map(), gaps: new Map(), bands: new Map(), cells: new Map(),
        stackFields: new Map(), kvRows: new Map(), tableCols: new Map(),
        tallyCols: new Map(), sigBoxes: new Map(),
    };
    paper.querySelectorAll('[data-tpl-grid]').forEach(el => {
        const id = el.getAttribute('data-tpl-grid')!;
        rects.grids.set(id, rectRelativeTo(el, paper, zoom));
        // Computed gap is already a layout px value (it is not scaled by the
        // transform the way a measured rect is), so it needs no correction.
        rects.gaps.set(id, parseFloat(getComputedStyle(el).columnGap) || 0);
    });
    paper.querySelectorAll('[data-tpl-band]').forEach(el => {
        rects.bands.set(el.getAttribute('data-tpl-band')!, rectRelativeTo(el, paper, zoom));
    });
    paper.querySelectorAll('[data-tpl-cell]').forEach(el => {
        rects.cells.set(el.getAttribute('data-tpl-cell')!, rectRelativeTo(el, paper, zoom));
    });
    paper.querySelectorAll('[data-tpl-stackfield]').forEach(el => {
        rects.stackFields.set(el.getAttribute('data-tpl-stackfield')!, rectRelativeTo(el, paper, zoom));
    });
    // Two <td>s share one data-tpl-kvrow id (label + value); keep the label cell's
    // rect since that is the row's full-height anchor for the grip.
    paper.querySelectorAll('[data-tpl-kvrow][data-tpl-kvlabel]').forEach(el => {
        rects.kvRows.set(el.getAttribute('data-tpl-kvrow')!, rectRelativeTo(el, paper, zoom));
    });
    paper.querySelectorAll('[data-tpl-tablecol]').forEach(el => {
        rects.tableCols.set(el.getAttribute('data-tpl-tablecol')!, rectRelativeTo(el, paper, zoom));
    });
    paper.querySelectorAll('[data-tpl-tallycol]').forEach(el => {
        rects.tallyCols.set(el.getAttribute('data-tpl-tallycol')!, rectRelativeTo(el, paper, zoom));
    });
    paper.querySelectorAll('[data-tpl-sigbox]').forEach(el => {
        rects.sigBoxes.set(el.getAttribute('data-tpl-sigbox')!, rectRelativeTo(el, paper, zoom));
    });
    return rects;
}

interface Props {
    layout: PrintLayout;
    docType: string;
    paperRef: React.RefObject<HTMLDivElement>;
    selection: Selection;
    onSelect: (sel: Selection) => void;
    /** Clone the layout, apply `fn`, commit the result as one undo step. */
    onMutate: (fn: (draft: PrintLayout) => void) => void;
    /** View scale applied to the sheet. 1 = true size. */
    zoom?: number;
    /** Band under the pointer, shared with the section list so the two highlight together. */
    hoverBandId?: string | null;
    onHoverBand?: (id: string | null) => void;
    /** Draw every band's handles at once instead of only the active band's. */
    alwaysShowHandles?: boolean;
}

export default function DesignerCanvas({
    layout, docType, paperRef, selection, onSelect, onMutate,
    zoom = 1, hoverBandId = null, onHoverBand, alwaysShowHandles = false,
}: Props) {
    const [rects, setRects] = useState<Rects | null>(null);
    const ghostRef = useRef<HTMLDivElement>(null);
    const targetRef = useRef<HTMLDivElement>(null);
    const lineRef = useRef<HTMLDivElement>(null);
    const guideRef = useRef<HTMLDivElement>(null);
    const dragKind = useRef<string | null>(null);

    const remeasure = useCallback(() => {
        if (paperRef.current) setRects(measure(paperRef.current, zoom));
    }, [paperRef, zoom]);

    useLayoutEffect(() => {
        remeasure();
        const onResize = () => remeasure();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layout, docType, selection, remeasure]);

    /**
     * Which band is under the pointer, by delegation on the paper element.
     *
     * Read off the `data-tpl-band` wrapper rather than from invisible hit rects of
     * our own: a hit rect with `pointerEvents: 'auto'` would sit over the rendered
     * output and swallow TemplateRenderer's own click-to-select. Pointer events
     * landing on the overlay itself are ignored, or hovering a grip would clear the
     * hover that drew it.
     */
    useEffect(() => {
        const paper = paperRef.current;
        if (!paper || !onHoverBand) return;
        const move = (e: PointerEvent) => {
            if (dragKind.current) return;
            const t = e.target as Element | null;
            if (!t || typeof t.closest !== 'function') return;
            if (t.closest('[data-designer-overlay]')) return;
            const el = t.closest('[data-tpl-band]');
            onHoverBand(el ? el.getAttribute('data-tpl-band') : null);
        };
        const leave = () => { if (!dragKind.current) onHoverBand(null); };
        paper.addEventListener('pointermove', move);
        paper.addEventListener('pointerleave', leave);
        return () => {
            paper.removeEventListener('pointermove', move);
            paper.removeEventListener('pointerleave', leave);
        };
    }, [paperRef, onHoverBand]);

    if (!rects) return null;

    /** On-screen pixels -> the sheet's layout pixels, for hard-coded offsets. */
    const px = (n: number) => n / zoom;
    const gripSize = px(GRIP_SIZE);

    const bandById = (id: string) => layout.bands.find(b => b.id === id);

    const hideIndicators = () => {
        [ghostRef, targetRef, lineRef, guideRef].forEach(r => {
            if (r.current) r.current.style.display = 'none';
        });
    };

    /**
     * Shared drag bootstrap: pointer capture via window listeners, Escape to cancel.
     *
     * `dx`/`dy` are the TOTAL offset from where the drag began, in the sheet's layout
     * pixels — deliberately not `e.movementX/Y`. Two reasons, both of which showed up
     * as a drag indicator sitting away from the pointer:
     *
     *  - `movementX/Y` are reported in screen pixels and ignore CSS `zoom`, which the
     *    interface scale and `.ui-scale-exempt` both use, so an accumulated position
     *    drifted from the cursor by the scale factor and no per-call division could
     *    reconcile it (the divisor differs from the one the rects need).
     *  - accumulating per-event deltas also drifts on its own, and a consumer that
     *    reads `dx` as a total (the QR resize did) sees only the last mouse move.
     *
     * Deriving both from `clientX/Y` against the live paper rect makes one conversion
     * path — `localPoint` — correct under any zoom/transform combination.
     */
    const startDrag = (
        kind: string,
        start: React.PointerEvent,
        onMove: (dx: number, dy: number, clientX: number, clientY: number) => void,
        onEnd: (cancelled: boolean) => void,
    ) => {
        dragKind.current = kind;
        let cancelled = false;
        // Anchored on the pointerdown, not on the first move: taking it from the first
        // move loses however far the pointer travelled to produce that event, which is
        // the same few pixels of offset this whole conversion exists to remove.
        const origin = localPoint(start.clientX, start.clientY, paperRef.current!, zoom);
        const move = (e: PointerEvent) => {
            const here = localPoint(e.clientX, e.clientY, paperRef.current!, zoom);
            onMove(here.x - origin.x, here.y - origin.y, e.clientX, e.clientY);
        };
        const up = () => finish();
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { cancelled = true; finish(); } };
        const finish = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('keydown', key);
            dragKind.current = null;
            hideIndicators();
            onEnd(cancelled);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('keydown', key);
    };

    // ── Grid cell move (free position, can cross into another grid band) ─────
    const startCellMove = (e: React.PointerEvent, bandId: string, itemIndex: number) => {
        e.preventDefault(); e.stopPropagation();
        onSelect({ bandId, itemIndex });
        const band = bandById(bandId) as GridBand;
        const item = band.items[itemIndex];
        const startRect = rects.cells.get(`${bandId}:${itemIndex}`);
        if (!startRect) return;

        const ghost = ghostRef.current!;
        ghost.style.display = 'block';
        ghost.style.left = `${startRect.x}px`;
        ghost.style.top = `${startRect.y}px`;
        ghost.style.width = `${startRect.width}px`;
        ghost.style.height = `${startRect.height}px`;

        let gx = startRect.x, gy = startRect.y;
        let dropBandId = bandId, dropCol = item.col, dropRow = item.row;

        startDrag('move-cell', e, (dx, dy) => {
            gx = startRect.x + dx; gy = startRect.y + dy;
            ghost.style.left = `${gx}px`;
            ghost.style.top = `${gy}px`;

            const cx = gx + startRect.width / 2;
            const cy = gy + startRect.height / 2;

            // Which grid band (if any) is the pointer's centre over right now?
            let hitBand = bandId;
            let hitRect = rects.grids.get(bandId)!;
            for (const [id, r] of rects.grids) {
                if (cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height) {
                    hitBand = id; hitRect = r; break;
                }
            }
            const gap = rects.gaps.get(hitBand) ?? 6;
            const colWidth = colWidthFromRect(hitRect.width, gap);
            const col = xToColumn(cx - hitRect.x, colWidth, gap);

            const gridEl = paperRef.current!.querySelector(`[data-tpl-grid="${hitBand}"]`) as HTMLElement;
            const rowTracks = gridEl ? parseTracks(getComputedStyle(gridEl).gridTemplateRows) : [];
            const row = yToRow(cy - hitRect.y, rowTracks, gap);

            dropBandId = hitBand; dropCol = col; dropRow = row;

            const target = targetRef.current!;
            target.style.display = 'block';
            target.style.left = `${hitRect.x + (col - 1) * (colWidth + gap)}px`;
            target.style.top = `${hitRect.y}px`;
            target.style.width = `${colWidth * item.span + gap * (item.span - 1)}px`;
            target.style.height = `${startRect.height}px`;
        }, (cancelled) => {
            if (cancelled) return;
            onMutate(draft => {
                const srcBand = draft.bands.find(b => b.id === bandId) as GridBand;
                const [moved] = srcBand.items.splice(itemIndex, 1);
                const dstBand = draft.bands.find(b => b.id === dropBandId) as GridBand;
                moved.col = clamp(dropCol, 1, 13 - moved.span);
                moved.row = Math.max(1, dropRow);
                dstBand.items.push(moved);
            });
            onSelect({ bandId: dropBandId, itemIndex: (bandById(dropBandId) as GridBand).items.length - (dropBandId === bandId ? 0 : 1) });
        });
    };

    // ── Grid cell resize (span, right edge only — col/row stay put) ──────────
    const startCellResize = (e: React.PointerEvent, bandId: string, itemIndex: number) => {
        e.preventDefault(); e.stopPropagation();
        const band = bandById(bandId) as GridBand;
        const item = band.items[itemIndex];
        const gridRect = rects.grids.get(bandId);
        const cellRect = rects.cells.get(`${bandId}:${itemIndex}`);
        if (!gridRect || !cellRect) return;
        const gap = rects.gaps.get(bandId) ?? 6;
        const colWidth = colWidthFromRect(gridRect.width, gap);

        let span = item.span;
        const guide = guideRef.current!;
        guide.style.display = 'block';

        startDrag('resize-span', e, (_dx, _dy, clientX) => {
            const { x } = localPoint(clientX, 0, paperRef.current!, zoom);
            const rightEdge = gridRect.x + (item.col - 1) * (colWidth + gap) + colWidth;
            const deltaCols = Math.round((x - rightEdge) / (colWidth + gap));
            span = clamp(item.span + deltaCols, 1, 13 - item.col);
            guide.style.left = `${gridRect.x + (item.col - 1) * (colWidth + gap) + colWidth * span + gap * (span - 1)}px`;
            guide.style.top = `${cellRect.y}px`;
            guide.style.height = `${cellRect.height}px`;
        }, (cancelled) => {
            if (cancelled || span === item.span) return;
            onMutate(draft => {
                (draft.bands.find(b => b.id === bandId) as GridBand).items[itemIndex].span = span;
            });
        });
    };

    // ── QR box resize (corner handle, adjusts qrSize) ─────────────────────────
    const startQrResize = (
        e: React.PointerEvent, bandId: string, itemIndex: number, stackIndex: number | undefined,
    ) => {
        e.preventDefault(); e.stopPropagation();
        const band = bandById(bandId) as GridBand;
        const item = band.items[itemIndex];
        const target = stackIndex != null ? item.stack![stackIndex] : item;
        const start = target.qrSize ?? 140;
        let size = start;

        // A QR is square, so the corner handle follows the average of both axes — and
        // 1:1 with the pointer, now that `dx`/`dy` are the drag's total offset. The old
        // 3x factor was compensating for per-event deltas that never accumulated.
        startDrag('resize-qr', e, (dx, dy) => {
            size = clamp(Math.round(start + (dx + dy) / 2), 40, 400);
        }, (cancelled) => {
            if (cancelled || size === start) return;
            onMutate(draft => {
                const b = draft.bands.find(x => x.id === bandId) as GridBand;
                const t = stackIndex != null ? b.items[itemIndex].stack![stackIndex] : b.items[itemIndex];
                t.qrSize = size;
            });
        });
    };

    // ── Stack field reorder (vertical list within one cell) ───────────────────
    const startStackReorder = (e: React.PointerEvent, bandId: string, itemIndex: number, stackIndex: number) => {
        e.preventDefault(); e.stopPropagation();
        onSelect({ bandId, itemIndex, stackIndex });
        const item = (bandById(bandId) as GridBand).items[itemIndex];
        const stack = item.stack!;
        const siblingRects = stack.map((_, i) => rects.stackFields.get(`${bandId}:${itemIndex}:${i}`)!);
        let dropIndex = stackIndex;

        const line = lineRef.current!;
        startDrag('reorder-stack', e, (_dx, _dy, _cx, clientY) => {
            const { y } = localPoint(0, clientY, paperRef.current!, zoom);
            dropIndex = siblingRects.findIndex(r => y < r.y + r.height / 2);
            if (dropIndex === -1) dropIndex = stack.length - 1;
            const guideRect = siblingRects[Math.min(dropIndex, siblingRects.length - 1)];
            line.style.display = 'block';
            line.style.left = `${guideRect.x}px`;
            line.style.top = `${dropIndex <= stackIndex ? guideRect.y - px(1) : guideRect.y + guideRect.height - px(1)}px`;
            line.style.width = `${guideRect.width}px`;
            line.style.height = `${px(2)}px`;
        }, (cancelled) => {
            if (cancelled || dropIndex === stackIndex) return;
            onMutate(draft => {
                const it = (draft.bands.find(b => b.id === bandId) as GridBand).items[itemIndex];
                const arr = it.stack!;
                const [moved] = arr.splice(stackIndex, 1);
                arr.splice(dropIndex > stackIndex ? dropIndex - 1 : dropIndex, 0, moved);
            });
        });
    };

    // ── Band reorder (vertical list, whole document) ──────────────────────────
    const startBandReorder = (e: React.PointerEvent, bandId: string) => {
        e.preventDefault(); e.stopPropagation();
        const order = layout.bands.map(b => b.id);
        const startIndex = order.indexOf(bandId);
        const bandRects = order.map(id => rects.bands.get(id)!);
        let dropIndex = startIndex;
        const line = lineRef.current!;

        startDrag('reorder-band', e, (_dx, _dy, _cx, clientY) => {
            const { y } = localPoint(0, clientY, paperRef.current!, zoom);
            let idx = bandRects.findIndex(r => y < r.y + r.height / 2);
            if (idx === -1) idx = order.length - 1;
            dropIndex = idx;
            const guideRect = bandRects[Math.min(dropIndex, bandRects.length - 1)];
            line.style.display = 'block';
            line.style.left = `${guideRect.x}px`;
            line.style.top = `${dropIndex <= startIndex ? guideRect.y - px(1) : guideRect.y + guideRect.height - px(1)}px`;
            line.style.width = `${guideRect.width}px`;
            line.style.height = `${px(2)}px`;
        }, (cancelled) => {
            if (cancelled || dropIndex === startIndex) return;
            onMutate(draft => {
                const [moved] = draft.bands.splice(startIndex, 1);
                draft.bands.splice(dropIndex > startIndex ? dropIndex - 1 : dropIndex, 0, moved);
            });
        });
    };

    // ── Generic horizontal-list reorder: table columns, tally columns, sig boxes ─
    const startHListReorder = (
        e: React.PointerEvent,
        bandId: string,
        listIndex: number,
        rectMap: Map<string, DOMRect>,
        length: number,
        arrayKey: 'columns' | 'boxes',
    ) => {
        e.preventDefault(); e.stopPropagation();
        onSelect({ bandId, itemIndex: listIndex });
        const itemRects = Array.from({ length }, (_, i) => rectMap.get(`${bandId}:${i}`)!);
        let dropIndex = listIndex;
        const line = lineRef.current!;

        startDrag('reorder-hlist', e, (_dx, _dy, clientX) => {
            const { x } = localPoint(clientX, 0, paperRef.current!, zoom);
            let idx = itemRects.findIndex(r => x < r.x + r.width / 2);
            if (idx === -1) idx = length - 1;
            dropIndex = idx;
            const guideRect = itemRects[Math.min(dropIndex, itemRects.length - 1)];
            line.style.display = 'block';
            line.style.top = `${guideRect.y}px`;
            line.style.left = `${dropIndex <= listIndex ? guideRect.x - px(1) : guideRect.x + guideRect.width - px(1)}px`;
            line.style.height = `${guideRect.height}px`;
            line.style.width = `${px(2)}px`;
        }, (cancelled) => {
            if (cancelled || dropIndex === listIndex) return;
            onMutate(draft => {
                const b: any = draft.bands.find(x => x.id === bandId);
                const arr = b[arrayKey];
                const [moved] = arr.splice(listIndex, 1);
                arr.splice(dropIndex > listIndex ? dropIndex - 1 : dropIndex, 0, moved);
            });
        });
    };

    // ── Key/value row reorder (vertical list) ─────────────────────────────────
    const startKvReorder = (e: React.PointerEvent, bandId: string, rowIndex: number) => {
        e.preventDefault(); e.stopPropagation();
        onSelect({ bandId, itemIndex: rowIndex });
        const kv = bandById(bandId) as KeyValueBand;
        const rowRects = kv.rows.map((_, i) => rects.kvRows.get(`${bandId}:${i}`)).filter(Boolean) as DOMRect[];
        let dropIndex = rowIndex;
        const line = lineRef.current!;

        startDrag('reorder-kv', e, (_dx, _dy, _cx, clientY) => {
            const { y } = localPoint(0, clientY, paperRef.current!, zoom);
            let idx = rowRects.findIndex(r => y < r.y + r.height / 2);
            if (idx === -1) idx = rowRects.length - 1;
            dropIndex = idx;
            const guideRect = rowRects[Math.min(dropIndex, rowRects.length - 1)];
            if (!guideRect) return;
            line.style.display = 'block';
            line.style.left = `${guideRect.x}px`;
            line.style.top = `${dropIndex <= rowIndex ? guideRect.y - px(1) : guideRect.y + guideRect.height - px(1)}px`;
            line.style.width = `${guideRect.width}px`;
            line.style.height = `${px(2)}px`;
        }, (cancelled) => {
            if (cancelled || dropIndex === rowIndex) return;
            onMutate(draft => {
                const rows = (draft.bands.find(b => b.id === bandId) as KeyValueBand).rows;
                const [moved] = rows.splice(rowIndex, 1);
                rows.splice(dropIndex > rowIndex ? dropIndex - 1 : dropIndex, 0, moved);
            });
        });
    };

    // ── Column width resize: table/tally column right border, or kv label/value border ─
    const startColResize = (
        e: React.PointerEvent, bandId: string, colIndex: number, kind: 'table' | 'tally' | 'kvlabel',
    ) => {
        e.preventDefault(); e.stopPropagation();
        const guide = guideRef.current!;
        guide.style.display = 'block';
        guide.style.top = '0px';
        guide.style.height = `${paperRef.current!.getBoundingClientRect().height / zoom}px`;

        if (kind === 'kvlabel') {
            const anchorRect = rects.kvRows.get(`${bandId}:0`);
            if (!anchorRect) return;
            // Track the live pointer position during the drag (not the pointerdown
            // position) so the committed width matches where the guide line was
            // actually left, the same pattern as the table/tally branch below.
            let pct = clamp(parseFloat(bandById(bandId) && (bandById(bandId) as KeyValueBand).labelWidth || '24'), 10, 60);

            startDrag('resize-kvlabel', e, (_dx, _dy, clientX) => {
                const { x } = localPoint(clientX, 0, paperRef.current!, zoom);
                pct = clamp(((x - anchorRect.x) / anchorRect.width) * 100, 10, 60);
                guide.style.left = `${x}px`;
                guide.style.width = `${px(2)}px`;
            }, (cancelled) => {
                if (cancelled) return;
                onMutate(draft => {
                    (draft.bands.find(b => b.id === bandId) as KeyValueBand).labelWidth = `${Math.round(pct)}%`;
                });
            });
            return;
        }

        const colRect = kind === 'table' ? rects.tableCols.get(`${bandId}:${colIndex}`) : rects.tallyCols.get(`${bandId}:${colIndex}`);
        if (!colRect) return;
        const tableWidth = kind === 'table'
            ? Array.from(rects.tableCols.entries()).filter(([k]) => k.startsWith(`${bandId}:`)).reduce((sum, [, r]) => sum + r.width, 0)
            : Array.from(rects.tallyCols.entries()).filter(([k]) => k.startsWith(`${bandId}:`)).reduce((sum, [, r]) => sum + r.width, 0);
        let newWidthPx = colRect.width;

        startDrag('resize-col', e, (_dx, _dy, clientX) => {
            const { x } = localPoint(clientX, 0, paperRef.current!, zoom);
            newWidthPx = clamp(x - colRect.x, 20, tableWidth - 20);
            guide.style.left = `${colRect.x + newWidthPx}px`;
            guide.style.width = `${px(2)}px`;
        }, (cancelled) => {
            if (cancelled) return;
            const pct = clamp(Math.round((newWidthPx / tableWidth) * 100), 5, 90);
            onMutate(draft => {
                const b: any = draft.bands.find(x => x.id === bandId);
                b.columns[colIndex].width = `${pct}%`;
            });
        });
    };

    // ── Render handles ─────────────────────────────────────────────────────────
    const handles: React.ReactNode[] = [];
    /** Band outlines: what the section list is pointing at, and what is selected. */
    const outlines: React.ReactNode[] = [];

    layout.bands.forEach(band => {
        const bandRect = rects.bands.get(band.id);
        const selectedBand = selection.bandId === band.id;
        const hovered = hoverBandId === band.id;
        // A band's handles appear when it is the one being worked on. Everything else
        // stays clean paper, so the sheet reads as the printout it is.
        const active = alwaysShowHandles || selectedBand || hovered;

        if (bandRect && (selectedBand || hovered)) {
            outlines.push(
                <div
                    key={`outline-${band.id}`}
                    style={{
                        position: 'absolute',
                        left: bandRect.x - px(2), top: bandRect.y - px(2),
                        width: bandRect.width + px(4), height: bandRect.height + px(4),
                        border: `${px(1)}px ${selectedBand ? 'solid' : 'dashed'} rgba(0,88,230,${selectedBand ? 0.85 : 0.55})`,
                        background: selectedBand ? 'transparent' : 'rgba(0,88,230,0.05)',
                        pointerEvents: 'none', zIndex: 1,
                    }}
                />
            );
        }

        if (!active) return;

        if (bandRect) {
            handles.push(
                <div
                    key={`grip-band-${band.id}`}
                    title="Drag to reorder this section"
                    style={gripStyle(bandRect.x - gripSize - px(3), bandRect.y, selectedBand && selection.itemIndex == null, zoom)}
                    onPointerDown={e => startBandReorder(e, band.id)}
                >
                    <i className="bi bi-grip-vertical" />
                </div>
            );
        }

        if (band.type === 'grid') {
            (band as GridBand).items.forEach((item, i) => {
                const cellId = `${band.id}:${i}`;
                const cellRect = rects.cells.get(cellId);
                if (!cellRect) return;
                const selected = selection.bandId === band.id && selection.itemIndex === i && selection.stackIndex == null;

                handles.push(
                    <div
                        key={`grip-cell-${cellId}`}
                        title="Drag to move"
                        style={gripStyle(cellRect.x, cellRect.y - gripSize - px(2), selected, zoom)}
                        onPointerDown={e => startCellMove(e, band.id, i)}
                    >
                        <i className="bi bi-arrows-move" />
                    </div>
                );

                if (selected) {
                    handles.push(
                        <div
                            key={`resize-cell-${cellId}`}
                            title="Drag to resize width"
                            style={{
                                position: 'absolute',
                                left: cellRect.x + cellRect.width - px(5),
                                top: cellRect.y + cellRect.height / 2 - px(8),
                                width: px(10), height: px(16), borderRadius: px(2),
                                background: '#0058e6', cursor: 'ew-resize',
                                pointerEvents: 'auto', zIndex: 5,
                                boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                            }}
                            onPointerDown={e => startCellResize(e, band.id, i)}
                        />
                    );
                }

                if (item.stack) {
                    item.stack.forEach((sf, si) => {
                        const sfId = `${cellId}:${si}`;
                        const sfRect = rects.stackFields.get(sfId);
                        if (!sfRect) return;
                        const sfSelected = selection.bandId === band.id && selection.itemIndex === i && selection.stackIndex === si;
                        handles.push(
                            <div
                                key={`grip-stack-${sfId}`}
                                title="Drag to reorder within this cell"
                                style={{ ...gripStyle(sfRect.x - gripSize - px(2), sfRect.y, sfSelected, zoom), width: px(12), height: px(12) }}
                                onPointerDown={e => startStackReorder(e, band.id, i, si)}
                            >
                                <i className="bi bi-grip-horizontal" style={{ fontSize: px(8) }} />
                            </div>
                        );
                        if (sf.field === 'wo.qr') {
                            handles.push(
                                <div
                                    key={`resize-qr-${sfId}`}
                                    title="Drag to resize QR"
                                    style={{
                                        position: 'absolute', left: sfRect.x + sfRect.width - px(8), top: sfRect.y + sfRect.height - px(8),
                                        width: px(12), height: px(12), borderRadius: px(2), background: '#0058e6', cursor: 'nwse-resize',
                                        pointerEvents: 'auto', zIndex: 5, boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                                    }}
                                    onPointerDown={e => startQrResize(e, band.id, i, si)}
                                />
                            );
                        }
                    });
                } else if (item.field === 'wo.qr') {
                    handles.push(
                        <div
                            key={`resize-qr-${cellId}`}
                            title="Drag to resize QR"
                            style={{
                                position: 'absolute', left: cellRect.x + cellRect.width - px(8), top: cellRect.y + cellRect.height - px(8),
                                width: px(12), height: px(12), borderRadius: px(2), background: '#0058e6', cursor: 'nwse-resize',
                                pointerEvents: 'auto', zIndex: 5, boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                            }}
                            onPointerDown={e => startQrResize(e, band.id, i, undefined)}
                        />
                    );
                }
            });
        }

        if (band.type === 'keyvalue') {
            (band as KeyValueBand).rows.forEach((_, i) => {
                const rowRect = rects.kvRows.get(`${band.id}:${i}`);
                if (!rowRect) return;
                const selected = selection.bandId === band.id && selection.itemIndex === i;
                handles.push(
                    <div
                        key={`grip-kv-${band.id}:${i}`}
                        title="Drag to reorder"
                        style={gripStyle(rowRect.x - gripSize - px(2), rowRect.y, selected, zoom)}
                        onPointerDown={e => startKvReorder(e, band.id, i)}
                    >
                        <i className="bi bi-grip-vertical" />
                    </div>
                );
                if (i === 0) {
                    handles.push(
                        <div
                            key={`resize-kvlabel-${band.id}`}
                            title="Drag to resize label column"
                            style={{
                                position: 'absolute', left: rowRect.x + rowRect.width - px(3), top: rowRect.y,
                                width: px(6), height: rowRect.height, cursor: 'col-resize',
                                pointerEvents: 'auto', zIndex: 4, background: 'rgba(0,88,230,0.15)',
                            }}
                            onPointerDown={e => startColResize(e, band.id, 0, 'kvlabel')}
                        />
                    );
                }
            });
        }

        if (band.type === 'table') {
            (band as TableBand).columns.forEach((_, i) => {
                const colRect = rects.tableCols.get(`${band.id}:${i}`);
                if (!colRect) return;
                const selected = selection.bandId === band.id && selection.itemIndex === i;
                handles.push(
                    <div
                        key={`grip-tablecol-${band.id}:${i}`}
                        title="Drag to reorder"
                        style={gripStyle(colRect.x, colRect.y - gripSize - px(2), selected, zoom)}
                        onPointerDown={e => startHListReorder(e, band.id, i, rects.tableCols, (band as TableBand).columns.length, 'columns')}
                    >
                        <i className="bi bi-grip-vertical" />
                    </div>
                );
                handles.push(
                    <div
                        key={`resize-tablecol-${band.id}:${i}`}
                        title="Drag to resize column width"
                        style={{
                            position: 'absolute', left: colRect.x + colRect.width - px(3), top: colRect.y,
                            width: px(6), height: colRect.height, cursor: 'col-resize',
                            pointerEvents: 'auto', zIndex: 4, background: 'rgba(0,88,230,0.15)',
                        }}
                        onPointerDown={e => startColResize(e, band.id, i, 'table')}
                    />
                );
            });
        }

        if (band.type === 'tally' && !(band as TallyBand).boxes) {
            ((band as TallyBand).columns || []).forEach((_, i) => {
                const colRect = rects.tallyCols.get(`${band.id}:${i}`);
                if (!colRect) return;
                const selected = selection.bandId === band.id && selection.itemIndex === i;
                handles.push(
                    <div
                        key={`grip-tallycol-${band.id}:${i}`}
                        title="Drag to reorder"
                        style={gripStyle(colRect.x, colRect.y - gripSize - px(2), selected, zoom)}
                        onPointerDown={e => startHListReorder(e, band.id, i, rects.tallyCols, (band as TallyBand).columns.length, 'columns')}
                    >
                        <i className="bi bi-grip-vertical" />
                    </div>
                );
                handles.push(
                    <div
                        key={`resize-tallycol-${band.id}:${i}`}
                        title="Drag to resize column width"
                        style={{
                            position: 'absolute', left: colRect.x + colRect.width - px(3), top: colRect.y,
                            width: px(6), height: colRect.height, cursor: 'col-resize',
                            pointerEvents: 'auto', zIndex: 4, background: 'rgba(0,88,230,0.15)',
                        }}
                        onPointerDown={e => startColResize(e, band.id, i, 'tally')}
                    />
                );
            });
        }

        if (band.type === 'signature') {
            (band as SignatureBand).boxes.forEach((_, i) => {
                const boxRect = rects.sigBoxes.get(`${band.id}:${i}`);
                if (!boxRect) return;
                const selected = selection.bandId === band.id && selection.itemIndex === i;
                handles.push(
                    <div
                        key={`grip-sig-${band.id}:${i}`}
                        title="Drag to reorder"
                        style={gripStyle(boxRect.x, boxRect.y - gripSize - px(2), selected, zoom)}
                        onPointerDown={e => startHListReorder(e, band.id, i, rects.sigBoxes, (band as SignatureBand).boxes.length, 'boxes')}
                    >
                        <i className="bi bi-grip-vertical" />
                    </div>
                );
            });
        }
    });

    return (
        <div data-designer-overlay style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>
            {outlines}
            {handles}
            <div ref={ghostRef} style={{
                position: 'absolute', display: 'none', border: `${px(2)}px dashed #0058e6`,
                background: 'rgba(0,88,230,0.08)', pointerEvents: 'none', zIndex: 6,
            }} />
            <div ref={targetRef} style={{
                position: 'absolute', display: 'none', background: 'rgba(0,88,230,0.18)',
                border: `${px(1)}px solid #0058e6`, pointerEvents: 'none', zIndex: 2,
            }} />
            <div ref={lineRef} style={{
                position: 'absolute', display: 'none', background: '#0058e6',
                pointerEvents: 'none', zIndex: 6,
            }} />
            <div ref={guideRef} style={{
                position: 'absolute', display: 'none', background: '#0058e6',
                pointerEvents: 'none', zIndex: 6,
            }} />
        </div>
    );
}
