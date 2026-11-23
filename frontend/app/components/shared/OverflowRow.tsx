'use client';
import React, { useLayoutEffect, useRef, useState } from 'react';

// One line of items that shows as many as fit the cell's width, then "+n more".
// Every item stays rendered (overflow ones are visibility:hidden and clipped), so
// widths are always measurable and a resize can bring items back without a reflow loop.

const GAP = 10;
const MORE_W = 58; // room kept for "+nn more" once anything overflows

/** How many items fit in `avail` px, given each item's right edge; reserves MORE_W when not all fit. */
export function fitCount(rights: number[], avail: number): number {
    if (!rights.length || rights[rights.length - 1] <= avail) return rights.length;
    const n = rights.filter(r => r <= avail - MORE_W).length;
    return Math.max(1, n);
}

interface Props {
    items: { key: string; node: React.ReactNode; label?: string }[];
    onMore?: () => void;
}

export default function OverflowRow({ items, onMore }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(items.length);
    const sig = items.map(it => it.label ?? it.key).join('|'); // re-measure when the items change, not just their count

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const measure = () => {
            const kids = Array.from(el.children).slice(0, items.length) as HTMLElement[];
            setVisible(fitCount(kids.map(k => k.offsetLeft + k.offsetWidth), el.clientWidth));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [sig, items.length]);

    const hidden = items.length - visible;
    const last = ref.current?.children[visible - 1] as HTMLElement | undefined;

    return (
        <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: GAP, overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 }}>
            {items.map((it, i) => (
                <span key={it.key} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', ...(i >= visible ? { visibility: 'hidden' } : {}) }}>{it.node}</span>
            ))}
            {hidden > 0 && (
                <button type="button"
                    title={items.slice(visible).map(it => it.label).filter(Boolean).join('\n') || 'Show all'}
                    onClick={e => { e.stopPropagation(); onMore?.(); }}
                    style={{ position: 'absolute', left: last ? last.offsetLeft + last.offsetWidth + GAP : 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10, color: 'var(--terras-win-blue, #0054e3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                    +{hidden} more
                </button>
            )}
        </div>
    );
}
