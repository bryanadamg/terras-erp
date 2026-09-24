'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import MobileShell from '../mobile/MobileShell';
import { useUser } from '../../context/UserContext';
import { useData } from '../../context/DataContext';
import { useLanguage } from '../../context/LanguageContext';
import { useRouter, usePathname } from 'next/navigation';
import { useTheme } from '../../context/ThemeContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import AppLoadBar from './AppLoadBar';
import { BootSidebar, BootHeader } from './BootShell';
import { ListPageSkeleton } from './pageSkeletons';
import { routeTitle, PREFETCH_ROUTES, ROUTE_PERMISSIONS } from './navConfig';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import AccessDenied from './AccessDenied';
import LiveFeedIndicator from './LiveFeedIndicator';
import LogoutButton from '@bryanadamg/terras-ui/components/LogoutButton';

export default function MainLayout({ children }: { children: React.ReactNode }) {
    const { currentUser, logout, loading, hasPermission, hasAnyPermission } = useUser();
    const { handleTabHover } = useData();
    const { language, setLanguage, t } = useLanguage();
    const { uiStyle } = useTheme();
    const router = useRouter();
    const pathname = usePathname();

    const [appName, setAppName] = useState('Terras ERP');
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const isMobile = useIsMobile();

    // Route identity and its label, resolved above the early returns below so the
    // browser tab title is stamped on every route — login and the mobile shell
    // included. Users run several Terras tabs at once, so "Terras ERP" alone on
    // all of them tells them nothing about which tab holds what.
    const activeTab = !pathname || pathname === '/' ? 'dashboard' : pathname.substring(1).replace(/\//g, '-');
    const pageTitle = routeTitle(activeTab, t);
    // Docs pages own their own title (their layout knows the article name), so
    // they opt out here rather than get overwritten by the section label.
    useDocumentTitle(pathname?.startsWith('/docs') ? null : pageTitle, appName);

    useEffect(() => {
        setMounted(true);
        const savedName = localStorage.getItem('app_name'); if (savedName) setAppName(savedName);
    }, []);

    // Auth Protection Logic
    useEffect(() => {
        if (mounted && !loading) {
            // 1. If authenticated and on root, go to dashboard
            if (currentUser && pathname === '/') {
                router.push('/dashboard');
            }
            // 2. If unauthenticated on any non-login, non-docs route, go to login
            else if (!currentUser && pathname !== '/login' && !pathname.startsWith('/docs')) {
                router.push('/login');
            }
        }
    }, [currentUser, loading, pathname, router, mounted]);

    // Route prefetch — nav uses router.push on <div>s (not <Link>), so Next never
    // prefetched the target route's JS chunk; every click paid the chunk+RSC load
    // before the page could paint. Warm the chunk ahead of the click:
    //  (a) on hover, alongside the existing data prefetch (handleTabHover);
    //  (b) once after mount for the common routes, so a fast click with no hover
    //      pause is still warm. Deferred so it doesn't compete with the first paint.
    const prefetchRoute = (tab: string) => (tab === 'dashboard' ? '/dashboard' : `/${tab}`);
    const handleTabHoverPrefetch = React.useCallback((tab: string) => {
        try { router.prefetch(prefetchRoute(tab)); } catch {}
        handleTabHover(tab);
    }, [router, handleTabHover]);

    useEffect(() => {
        if (!mounted || loading || !currentUser || isMobile) return;
        const id = setTimeout(() => { PREFETCH_ROUTES.forEach(r => { try { router.prefetch(r); } catch {} }); }, 1500);
        return () => clearTimeout(id);
    }, [mounted, loading, currentUser, isMobile, router]);

    // Allow Login Page and Docs pages to render without layout wrappers.
    // Checked BEFORE the boot gate: these two own their whole viewport, so an
    // unauthenticated cold start must not paint an app shell it is about to
    // throw away. Login runs its own boot indicator.
    if (pathname === '/login' || pathname.startsWith('/docs')) {
        return <>{children}</>;
    }

    // SSR / boot state — paint the chrome instead of covering it. The boot
    // placeholders swap for the real Sidebar/header IN PLACE below, so the route
    // under `page-body` keeps its tree position and never remounts. (Returning a
    // separate shell component here changed the root element type, so every page
    // mounted once inside it, then again inside the real layout: two skeletons
    // and two rounds of fetches per cold start.)
    //
    // The route renders inside the boot chrome rather than being replaced by it:
    // it owns a shape-matched skeleton gated on DataContext's `loading.*`, and
    // Next's per-segment `loading.tsx` only fires if the segment mounts.
    //
    // The exception is a cold start with no token: mounting the page would fire a
    // round of fetches that can only 401 while the redirect to /login is already
    // in flight. Before hydration no effect has run, so nothing can fetch yet and
    // the page draws freely; after it, the token has to be there.
    const booting = !mounted || loading;
    const canFetch = !mounted || !!localStorage.getItem('access_token');

    // Protect all other routes
    if (!booting && !currentUser) return null;

    // Route guard — hiding a sidebar leaf never stopped a typed URL, so the route
    // itself is checked against the same navConfig permissions the sidebar uses.
    // Routes absent from ROUTE_PERMISSIONS (dashboard, scanner, settings, the
    // mobile screens) stay open to any authenticated user. The API enforces its
    // own checks; this is the UI half so a blocked page reads as blocked instead
    // of as an empty list full of 403s.
    const routePerms = ROUTE_PERMISSIONS[activeTab];
    const routeBlocked = !!routePerms && !hasAnyPermission(...routePerms);
    const pageBody = routeBlocked ? <AccessDenied codes={routePerms} /> : children;

    // Mobile: render the XP mobile shell instead of sidebar layout
    if (!booting && isMobile) {
        return <MobileShell appName={appName}>{pageBody}</MobileShell>;
    }

    const handleSetActiveTab = (tab: string) => {
        const route = tab === 'dashboard' ? '/' : `/${tab}`;
        router.push(route);
        setIsMobileSidebarOpen(false);
    };

    return (
        <div className={`app-container ui-style-${uiStyle}`} aria-busy={booting || undefined}>
            {booting ? <BootSidebar appName={appName} /> : <Sidebar 
                activeTab={activeTab} 
                setActiveTab={handleSetActiveTab} 
                onTabHover={handleTabHoverPrefetch}
                appName={appName} 
                isOpen={isMobileSidebarOpen} 
            />}

            <div className="main-content flex-grow-1 overflow-y-auto overflow-x-hidden bg-light">
                {booting ? <BootHeader /> : <div className="app-header sticky-top bg-white border-bottom shadow-sm px-4 d-flex justify-content-between align-items-center no-print classic-header">
                    <div className="d-flex align-items-center gap-3">
                        <button className="btn btn-link d-md-none p-0 text-dark" onClick={() => setIsMobileSidebarOpen(true)}><i className="bi bi-list fs-3"></i></button>
                        <h5 className="mb-0 fw-bold text-dark d-none d-md-block text-uppercase letter-spacing-1">{pageTitle}</h5>
                    </div>
                    
                    <div className="d-flex align-items-center gap-2 gap-md-3">
                        <LiveFeedIndicator />
                        <button data-testid="scanner-btn" className="btn btn-sm btn-light" onClick={() => router.push('/scanner')} title="Scan QR Code"><i className="bi bi-qr-code-scan"></i></button>
                        <div className="d-flex align-items-center me-1">
                            <select 
                                data-testid="language-select"
                                className="form-select form-select-sm py-0 ps-1 pe-3 bg-transparent border-0"
                                style={{height: '24px', fontSize: '11px', minWidth: '60px'}}
                                value={language}
                                onChange={(e) => setLanguage(e.target.value as any)}
                            >
                                <option value="en">EN</option>
                                <option value="id">ID</option>
                            </select>
                        </div>

                        {/* terras-ui's own control: it carries the flat red face this
                            header used to paint from globals.css, and defaults both
                            `title` and `data-testid` so the three Terras apps can't
                            word them differently. The icon is a slot and the label is
                            children, so the narrow-header collapse stays a Bootstrap
                            class here rather than moving into the package. */}
                        <LogoutButton onClick={logout} icon={<i className="bi bi-box-arrow-right"></i>}>
                            <span className="d-none d-sm-inline">LOGOUT</span>
                        </LogoutButton>
                    </div>
                </div>}

                {!booting && <AppLoadBar />}

                {/* `page-body` carries the horizontal gutter (--content-pad); it used to
                    sit on .main-content, which inset the sticky app header away from the
                    sidebar and the viewport top. Header chrome stays full-bleed. */}
                <div className="page-body">
                    {booting ? (canFetch ? children : <ListPageSkeleton />) : pageBody}
                </div>
            </div>
        </div>
    );
}
