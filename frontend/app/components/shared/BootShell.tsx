'use client';

import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import { SkeletonBar } from './xpTheme';
import { SIDEBAR_BG } from './Sidebar';

/**
 * App chrome, painted immediately while the session is still resolving.
 *
 * Shell-first instead of a blocking splash: the sidebar/header/content frame is
 * the same in every route and needs no auth to draw, so drawing it costs
 * nothing and the shell never "arrives" — only its contents do. That removes
 * the full-screen → full-app jump, and there is no layout shift because this
 * reuses MainLayout's own class names (`app-container`, `sidebar`,
 * `main-content`, `app-header`), which is also why both themes and the <768px
 * off-canvas sidebar rules apply to it for free.
 *
 * Deliberately not interactive: nav rows are placeholders, not disabled real
 * links, because permissions aren't known yet and a nav that reshuffles once
 * they load is worse than one that fades in already correct.
 *
 * BootSplash still covers the case with no chrome to draw (login, Electron cold
 * start). This covers every authenticated route.
 */

// Deterministic label widths — a fixed cycle, not Math.random(), so nothing
// reshuffles between the SSR pass and hydration.
const NAV_WIDTHS = ['64%', '48%', '72%', '55%', '68%', '43%', '76%', '52%', '60%', '45%'];

export default function BootShell({ appName = 'Terras ERP' }: { appName?: string }) {
    const { uiStyle } = useTheme();

    return (
        <div className={`app-container ui-style-${uiStyle}`} aria-busy="true">
            <div
                className="sidebar"
                style={{ background: SIDEBAR_BG }}
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

                <div style={{ padding: '8px 8px' }}>
                    {NAV_WIDTHS.map((w, i) => (
                        <div
                            key={i}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '5px 6px',
                            }}
                        >
                            <SkeletonBar width={12} height={12} />
                            <SkeletonBar width={w} height={8} />
                        </div>
                    ))}
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

                <div className="px-0 py-3">
                    <div style={{ padding: '0 10px' }}>
                        {/* Toolbar strip: search + filters + action button */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                            <SkeletonBar width={200} height={18} />
                            <SkeletonBar width={110} height={18} />
                            <span style={{ flex: 1 }} />
                            <SkeletonBar width={100} height={18} />
                        </div>

                        {/* Table body stand-in — generic, since the route isn't known yet */}
                        <div
                            style={{
                                border: '1px solid #919b9c',
                                background: '#fff',
                            }}
                        >
                            {Array.from({ length: 10 }).map((_, r) => (
                                <div
                                    key={r}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 16,
                                        padding: '6px 8px',
                                        borderBottom: '1px solid #e3e1dc',
                                    }}
                                >
                                    {['18%', '26%', '14%', '20%', '12%'].map((w, c) => (
                                        <SkeletonBar
                                            key={c}
                                            width={w}
                                            height={8}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
