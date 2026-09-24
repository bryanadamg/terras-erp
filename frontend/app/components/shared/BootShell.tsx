'use client';

import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import { SkeletonBar, TableBlockSkeleton, BUTTON_RADIUS } from './xpTheme';
import { xpTitleBar, xpToolbar, viewShellStyle, scrollAreaStyle } from './shellTheme';
import { SIDEBAR_BG } from './Sidebar';
import { NAV_SECTIONS } from './navConfig';

/**
 * App chrome, painted immediately while the session is still resolving.
 *
 * Shell-first instead of a blocking splash: the sidebar/header/content frame is
 * the same in every route and needs no auth to draw, so drawing it costs
 * nothing and the shell never "arrives" — only its contents do. That removes
 * the full-screen → full-app jump, and there is no layout shift because this
 * reuses MainLayout's own class names (`app-container`, `sidebar`,
 * `main-content`, `app-header`, `page-body`) and the same shell primitives a
 * real list route wears (`viewShellStyle` / `xpTitleBar` / `xpToolbar`), which
 * is also why both themes and the <768px off-canvas sidebar rules apply to it
 * for free.
 *
 * Shape comes from the real thing, not from hand-tuned numbers: the nav list is
 * generated off `NAV_SECTIONS` (static, no permissions needed) and the content
 * panel fills the viewport through `viewShellStyle('page')`, the same height
 * convention every top-level list route uses. A short floating box over a sea
 * of empty page is what this replaced.
 *
 * Deliberately not interactive: nav rows are placeholders, not disabled real
 * links, because permissions aren't known yet and a nav that reshuffles once
 * they load is worse than one that fades in already correct.
 *
 * BootSplash still covers the case with no chrome to draw (login, Electron cold
 * start). This covers every authenticated route.
 */

// Same palette constants the real sidebar uses for its sub rows / footer.
const SUB_BG = '#bcc9e8';

// Deterministic label widths — a fixed cycle, not Math.random(), so nothing
// reshuffles between the SSR pass and hydration.
const NAV_WIDTHS = ['64%', '48%', '72%', '55%', '68%', '43%', '76%', '52%', '60%', '45%'];
const navWidth = (i: number) => NAV_WIDTHS[i % NAV_WIDTHS.length];

function NavRow({ i, sub }: { i: number; sub?: boolean }) {
    return (
        <div
            style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: sub ? '4px 8px 4px 22px' : '5px 8px 5px 14px',
                background: sub ? SUB_BG : 'transparent',
                borderLeft: '3px solid transparent',
                borderBottom: '1px solid #c0ccee',
                height: sub ? 22 : 24,
            }}
        >
            <SkeletonBar width={14} height={11} />
            <SkeletonBar width={navWidth(i)} height={8} />
        </div>
    );
}

export default function BootShell({ appName = 'Terras ERP', children }: {
    appName?: string;
    /**
     * The route's own body. The chrome here is a placeholder because nav is
     * permission-filtered and permissions aren't known yet — but the ROUTE knows
     * what it is about to render, so it draws its own skeleton and this shell
     * only frames it. Omitted (pre-auth, when mounting the page would fire a
     * round of tokenless fetches) it falls back to the generic list shape.
     */
    children?: React.ReactNode;
}) {
    const { uiStyle } = useTheme();

    return (
        <div className={`app-container ui-style-${uiStyle}`} aria-busy="true">
            <div
                className="sidebar"
                style={{ background: SIDEBAR_BG, display: 'flex', flexDirection: 'column' }}
            >
                {/* Same brand block as Sidebar.tsx: real height var, real colors, the
                    actual icon asset (a static file, so it needs no auth to draw). */}
                <div
                    style={{
                        background: 'var(--xp-title-flat)',
                        padding: '0 10px',
                        borderBottom: '1px solid var(--xp-title-blue-border)',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
                        display: 'flex', alignItems: 'center', flexShrink: 0,
                        height: 'var(--app-header-h)',
                    }}
                >
                    <img
                        className="app-brand-icon"
                        src="/icons/icon-192.png"
                        alt={appName}
                        style={{
                            width: 20,
                            height: 20,
                            flexShrink: 0,
                            borderRadius: 3,
                        }}
                    />
                </div>

                <div style={{ flex: 1, overflow: 'hidden' }}>
                    {/* QUICK SCAN button block */}
                    <div style={{ padding: '8px 8px 4px' }}>
                        <div
                            className="xp-skel"
                            style={{ height: 24, width: '100%', borderRadius: BUTTON_RADIUS }}
                        />
                    </div>

                    <NavRow i={0} />

                    {NAV_SECTIONS.map((section, s) => (
                        <React.Fragment key={section.key}>
                            <div
                                style={{
                                    background: 'linear-gradient(to right, #0058e6, #003080)',
                                    padding: '4px 8px',
                                    borderTop: '1px solid #7090cc',
                                    borderBottom: '1px solid #003080',
                                    display: 'flex', alignItems: 'center', gap: 5,
                                    height: 20,
                                }}
                            >
                                <SkeletonBar width={72} height={7} />
                            </div>
                            {section.items.map((item, i) => (
                                <NavRow key={item.tab} i={s + i + 1} sub />
                            ))}
                        </React.Fragment>
                    ))}
                </div>

                {/* Footer ID card — same band as Sidebar's, so the bottom edge
                    doesn't jump when the real user card arrives. */}
                <div
                    style={{
                        background: '#c0cade',
                        borderTop: '1px solid #9098b8',
                        padding: '6px 8px',
                        flexShrink: 0,
                        display: 'flex', alignItems: 'center', gap: 7,
                    }}
                >
                    <SkeletonBar width={30} height={30} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <SkeletonBar width="70%" height={8} />
                        <SkeletonBar width="40%" height={7} />
                    </div>
                </div>
            </div>

            <div className="main-content flex-grow-1 overflow-y-auto overflow-x-hidden bg-light">
                <div
                    className="app-header sticky-top bg-white border-bottom shadow-sm px-4 d-flex justify-content-between align-items-center no-print classic-header"
                >
                    <SkeletonBar width={160} height={9} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <SkeletonBar width={28} height={16} />
                        <SkeletonBar width={40} height={16} />
                        <SkeletonBar width={90} height={16} />
                    </div>
                </div>

                {/* Same gutter class and same page-filling window a real list
                    route renders — title bar, toolbar strip, then the table. */}
                <div className="page-body">
                    {children ?? (
                    <div style={viewShellStyle('page')}>
                        <div style={xpTitleBar()}>
                            <SkeletonBar width={140} height={8} />
                            <SkeletonBar width={54} height={8} />
                        </div>
                        <div style={xpToolbar()}>
                            <SkeletonBar width={200} height={18} />
                            <SkeletonBar width={110} height={18} />
                            <span style={{ flex: 1 }} />
                            <SkeletonBar width={100} height={18} />
                        </div>
                        {/* Rows enough to reach the bottom of a tall screen,
                            clipped rather than scrolled. This shell is the
                            server-rendered HTML — it is on screen before any JS
                            has hydrated, so the row count can't be measured off
                            the panel the way a live list's TableSkeleton
                            measures `fillHeight`. A fixed count that stops
                            mid-panel reads as a table that ends early, so the
                            count overshoots and `hidden` absorbs the rest. */}
                        <div style={{ ...scrollAreaStyle, overflow: 'hidden' }}>
                            <TableBlockSkeleton cols={6} rows={60} />
                        </div>
                    </div>
                    )}
                </div>
            </div>
        </div>
    );
}
