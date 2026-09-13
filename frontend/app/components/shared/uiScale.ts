/**
 * Interface-scale (root `zoom`) unit helpers — now a re-export of terras-ui's
 * `scale` module, which owns both halves of the feature: the scale value (list,
 * default, storage key, `<html>` attribute) and these unit converters. The
 * package's copy was ported from this file, so the behaviour is unchanged; this
 * module stays as the import path so the ~20 call sites are untouched.
 *
 * The CSS half is `@bryanadamg/terras-ui/scale.css`, imported in layout.tsx —
 * import both or neither.
 *
 * Why the converters exist at all: under a root zoom the DOM's pixel APIs split
 * into two different units, and mixing them silently misplaces things by the
 * zoom factor.
 *
 *   SCREEN px (divided by zoom already — what the user physically sees)
 *     getBoundingClientRect(), MouseEvent.clientX/Y, window.innerWidth/Height,
 *     window.scrollX/Y
 *
 *   LAYOUT px (the unit every CSS length is written in, then multiplied by zoom)
 *     clientHeight/offsetHeight/scrollHeight, getComputedStyle() values,
 *     and anything you assign to style.top / style.width / a React style prop
 *
 * So a dropdown positioned with `top: rect.bottom` lands at 80% of the way down
 * the page at 80% scale. Convert first: `top: toLayoutPx(rect.bottom)`.
 */

export {
    uiZoom,
    toLayoutPx,
    layoutRectOf,
    layoutViewport,
    layoutScroll,
} from '@bryanadamg/terras-ui/scale';
