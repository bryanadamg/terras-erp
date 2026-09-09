/**
 * Pure pixel-math helpers for the designer canvas's drag interactions. No React,
 * no layout mutation — just "given these measured rects and this pointer
 * position, what column/row/width does that correspond to".
 */

export function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

/**
 * Parse a resolved `grid-template-columns`/`rows` value ("48px 32px 40px") into
 * pixel track sizes. Browsers always resolve `repeat(12, 1fr)` to concrete pixel
 * tracks once painted, so this is exact — no need to reimplement `fr` math.
 */
export function parseTracks(value: string): number[] {
    return value
        .split(' ')
        .map(s => parseFloat(s))
        .filter(n => !Number.isNaN(n));
}

/** Cumulative pixel offset of the start of each track, plus a trailing total. */
export function trackOffsets(tracks: number[], gap: number): number[] {
    const offsets: number[] = [0];
    let pos = 0;
    tracks.forEach(t => { pos += t + gap; offsets.push(pos); });
    return offsets;
}

/** 1-based column index that pixel offset `x` (relative to the grid's left edge) falls in. */
export function xToColumn(x: number, colWidth: number, gap: number, colCount = 12): number {
    const stride = colWidth + gap;
    const col = Math.floor(x / stride) + 1;
    return clamp(col, 1, colCount);
}

/**
 * 1-based row index for pixel offset `y` (relative to the grid's top edge), given
 * the live-measured row track heights. Beyond the last track, returns
 * `tracks.length + 1` — dragging past the bottom starts a new row rather than
 * snapping back to the last one.
 */
export function yToRow(y: number, rowTracks: number[], gap: number): number {
    const offsets = trackOffsets(rowTracks, gap);
    for (let i = 0; i < rowTracks.length; i++) {
        if (y < offsets[i + 1] - gap / 2) return i + 1;
    }
    return rowTracks.length + 1;
}

export function colWidthFromRect(rectWidth: number, gap: number, colCount = 12): number {
    return (rectWidth - gap * (colCount - 1)) / colCount;
}

/**
 * Rect of `el`, expressed relative to `container`'s top-left corner, in the
 * container's own LAYOUT pixels.
 *
 * `zoom` is the designer's view scale (the `transform: scale()` on the sheet).
 * `getBoundingClientRect` reports screen pixels, which a scaled ancestor has
 * already multiplied — but the overlay writes these numbers straight back into
 * `style.left`/`top`, which are layout pixels inside that same scaled box. Dividing
 * here is what keeps the two unit systems in step; pass 1 (the default) when the
 * surface is unscaled.
 */
export function rectRelativeTo(el: Element, container: Element, zoom = 1): DOMRect {
    const r = el.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const z = zoom || 1;
    return new DOMRect(
        (r.left - c.left) / z,
        (r.top - c.top) / z,
        r.width / z,
        r.height / z,
    );
}

/** A pointer position in `container`'s layout pixels. Same zoom caveat as above. */
export function localPoint(
    clientX: number, clientY: number, container: Element, zoom = 1,
): { x: number; y: number } {
    const c = container.getBoundingClientRect();
    const z = zoom || 1;
    return { x: (clientX - c.left) / z, y: (clientY - c.top) / z };
}
