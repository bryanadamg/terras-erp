'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { docsSidebar, getPageBySlug } from './docsContent';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useIsMobile } from '@bryanadamg/terras-ui/components/MobileShell';
import { modernFont } from '../components/shared/xpTheme';

// Same public, pre-auth identity as the login screen (docs is reachable without
// signing in), not the in-app classic/modern theme — a visitor comparing this
// page to login should see one brand, not two unrelated UIs.
const brandFont = `var(--font-display), ${modernFont}`;
const BG_GRADIENT = 'linear-gradient(135deg, #0d1f5c 0%, #1a3fa8 40%, #0a246a 100%)';

// Next.js route layout files only allow a fixed set of exports (default,
// metadata, ...) — a plain named export here fails typed-route generation.
// Kept local; page.tsx (the light reading pane) has its own separate palette.
const DOCS_COLORS = {
    bright: '#ffffff',
    body: '#c7d7f0',
    muted: '#9fb8dc',
    faint: '#7f9ecb',
    accent: '#4a90d9',
    accentDark: '#2563c4',
    border: 'rgba(166,202,240,0.18)',
    borderStrong: 'rgba(166,202,240,0.35)',
    panel: 'rgba(255,255,255,0.04)',
    panelHover: 'rgba(255,255,255,0.07)',
    active: 'rgba(74,144,217,0.24)',
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const isMobile = useIsMobile();
    const [drawerOpen, setDrawerOpen] = useState(false);

    const currentSlug = pathname.split('/docs/')[1] ?? 'overview';
    // MainLayout deliberately leaves the tab title to us — the article name is
    // more useful on a help tab than a flat "Docs".
    useDocumentTitle(`${getPageBySlug(currentSlug)?.title ?? 'Docs'} — Docs`);

    const goTo = (slug: string) => {
        router.push(`/docs/${slug}`);
        setDrawerOpen(false);
    };

    const sidebarBody = (
        <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 0' }}>
                {docsSidebar.map(section => (
                    <div key={section.title}>
                        <div style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: DOCS_COLORS.faint,
                            textTransform: 'uppercase',
                            letterSpacing: 1.5,
                            padding: '12px 16px 6px',
                        }}>
                            {section.title}
                        </div>
                        {section.items.map(item => {
                            const isActive = item.slug === currentSlug;
                            return (
                                <div
                                    key={item.slug}
                                    onClick={() => goTo(item.slug)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 9,
                                        padding: '7px 16px',
                                        margin: '0 8px',
                                        borderRadius: 4,
                                        cursor: 'pointer',
                                        fontSize: 12.5,
                                        color: isActive ? '#ffffff' : DOCS_COLORS.body,
                                        background: isActive ? DOCS_COLORS.active : 'transparent',
                                        border: isActive ? `1px solid ${DOCS_COLORS.accent}` : '1px solid transparent',
                                        boxShadow: isActive ? '0 0 10px rgba(74,144,217,0.35)' : 'none',
                                        fontWeight: isActive ? 600 : 400,
                                        transition: 'background 0.12s, border-color 0.12s',
                                    }}
                                    onMouseEnter={e => {
                                        if (!isActive) (e.currentTarget as HTMLElement).style.background = DOCS_COLORS.panelHover;
                                    }}
                                    onMouseLeave={e => {
                                        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
                                    }}
                                >
                                    <span style={{ fontSize: 14, color: isActive ? DOCS_COLORS.accent : DOCS_COLORS.faint, width: 16, textAlign: 'center' }}>
                                        <i className={`bi ${item.icon}`} />
                                    </span>
                                    {item.label}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>

            {/* Footer */}
            <div style={{ flexShrink: 0, borderTop: `1px solid ${DOCS_COLORS.border}`, padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 2 }}>
                    <span style={{ fontFamily: brandFont, fontWeight: 600, fontSize: 13, color: DOCS_COLORS.bright }}>Terras</span>
                    <span style={{ fontFamily: brandFont, fontWeight: 500, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: DOCS_COLORS.faint }}>ERP</span>
                </div>
                <div style={{ fontSize: 10, color: DOCS_COLORS.faint }}>Help &amp; Documentation</div>
            </div>
        </>
    );

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: 'var(--app-vh)',
            fontFamily: modernFont,
            fontSize: 13,
            background: BG_GRADIENT,
            overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 20px',
                height: 56,
                flexShrink: 0,
                background: 'linear-gradient(to bottom, rgba(255,255,255,0.08) 0%, transparent 100%)',
                borderBottom: `1px solid ${DOCS_COLORS.border}`,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    {isMobile && (
                        <button
                            onClick={() => setDrawerOpen(o => !o)}
                            aria-label="Toggle navigation"
                            style={{
                                background: 'rgba(255,255,255,0.08)',
                                border: `1px solid ${DOCS_COLORS.border}`,
                                borderRadius: 4,
                                color: DOCS_COLORS.bright,
                                width: 32, height: 32,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer',
                                flexShrink: 0,
                            }}
                        >
                            <i className="bi bi-list" style={{ fontSize: 18 }} />
                        </button>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <span style={{ fontFamily: brandFont, fontSize: 18, fontWeight: 600, color: DOCS_COLORS.bright }}>
                                Terras
                            </span>
                            <span style={{ fontFamily: brandFont, fontSize: 10, fontWeight: 500, letterSpacing: 2, textTransform: 'uppercase', color: DOCS_COLORS.faint }}>
                                ERP
                            </span>
                        </div>
                        {!isMobile && (
                            <div style={{ fontSize: 10, color: DOCS_COLORS.muted, letterSpacing: 2, textTransform: 'uppercase' }}>
                                Help &amp; Documentation
                            </div>
                        )}
                    </div>
                </div>
                <button
                    onClick={() => router.push('/login')}
                    style={{
                        background: 'rgba(255,255,255,0.1)',
                        border: `1px solid ${DOCS_COLORS.borderStrong}`,
                        borderRadius: 4,
                        color: DOCS_COLORS.bright,
                        fontSize: 11.5,
                        padding: '6px 14px',
                        cursor: 'pointer',
                        flexShrink: 0,
                    }}
                >
                    <i className="bi bi-box-arrow-in-right" style={{ marginRight: 6 }} />
                    {isMobile ? '' : 'Sign In'}
                </button>
            </div>

            {/* Body */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>

                {/* Sidebar — fixed column on desktop, slide-in drawer on mobile */}
                {isMobile ? (
                    <>
                        {drawerOpen && (
                            <div
                                onClick={() => setDrawerOpen(false)}
                                style={{ position: 'absolute', inset: 0, background: 'rgba(0,6,30,0.55)', zIndex: 20 }}
                            />
                        )}
                        <div style={{
                            position: 'absolute', top: 0, bottom: 0, left: 0,
                            width: 250,
                            transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
                            transition: 'transform 0.2s ease',
                            background: '#0d1a4a',
                            borderRight: `1px solid ${DOCS_COLORS.border}`,
                            display: 'flex',
                            flexDirection: 'column',
                            zIndex: 21,
                            boxShadow: drawerOpen ? '4px 0 20px rgba(0,0,0,0.4)' : 'none',
                        }}>
                            {sidebarBody}
                        </div>
                    </>
                ) : (
                    <div style={{
                        width: 240,
                        flexShrink: 0,
                        background: 'rgba(255,255,255,0.03)',
                        borderRight: `1px solid ${DOCS_COLORS.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                    }}>
                        {sidebarBody}
                    </div>
                )}

                {/* Content area — a light "paper" reading surface. The brand
                    gradient is for chrome (header/sidebar); long paragraphs and
                    tables in light text on a saturated blue read poorly, so the
                    article itself gets a flat, high-contrast background instead. */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    background: '#f8fafc',
                    padding: isMobile ? '20px 18px' : '32px 44px',
                }}>
                    {children}
                </div>
            </div>
        </div>
    );
}
