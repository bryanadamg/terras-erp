'use client';

import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import UIPager from '@bryanadamg/terras-ui/components/Pager';

interface PagerProps {
    page: number;
    total: number;
    pageSize: number;
    onPageChange: (page: number) => void;
    /** Render nothing when total is 0 (ManufacturingView's old renderPager did this). Default: always render. */
    hideWhenEmpty?: boolean;
    /** Replaces the default "from-to of total" text — e.g. a selection-count summary. */
    leftContent?: React.ReactNode;
    className?: string;
}

/**
 * Shared prev/next paginator footer — now a thin adapter over terras-ui's Pager,
 * which owns the arithmetic (page count, row window, which end is reached) and
 * the strip's chrome. Kept as a local module so the ~10 call sites keep importing
 * `shared/Pager` and stay untouched.
 *
 * Two things stay here because they are app facts, not package concerns: the
 * bootstrap-icon chevrons on Prev/Next (the package has no icon-set opinion) and
 * `no-print`, which every pager in this app carries. The classic/modern split
 * that used to fork the whole component is now CSS — `.ui-style-classic` retones
 * the --terras-* vars — so only the label wording still reads the theme.
 */
export default function Pager({ page, total, pageSize, onPageChange, hideWhenEmpty, leftContent, className }: PagerProps) {
    const { uiStyle } = useTheme();
    const classic = uiStyle === 'classic';

    return (
        <UIPager
            page={page}
            total={total}
            pageSize={pageSize}
            onPageChange={onPageChange}
            hideWhenEmpty={hideWhenEmpty}
            leftContent={leftContent ?? (classic ? undefined : <>Showing {summaryRange(page, total, pageSize)}</>)}
            className={`no-print ${className || ''}`}
            prevLabel={<><i className="bi bi-chevron-left me-1"></i>{classic ? 'Prev' : 'Previous'}</>}
            nextLabel={<>Next<i className="bi bi-chevron-right ms-1"></i></>}
        />
    );
}

/** Modern's summary reads "Showing 1-20 of 97"; classic drops the verb. */
function summaryRange(page: number, total: number, pageSize: number): string {
    const pages = Math.max(1, Math.ceil((total || 0) / pageSize));
    const clamped = Math.min(Math.max(page || 1, 1), pages);
    const from = total ? (clamped - 1) * pageSize + 1 : 0;
    const to = Math.min(clamped * pageSize, total || 0);
    return `${from}-${to} of ${total || 0}`;
}
