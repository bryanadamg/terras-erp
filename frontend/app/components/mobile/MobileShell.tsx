'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useUser } from '../../context/UserContext';
import { useLanguage } from '../../context/LanguageContext';
import { xpFont as XP_FONT, modernFont, BUTTON_RADIUS } from '../shared/xpTheme';
import { toolbar as xpToolbar } from '@bryanadamg/terras-ui/styles';
import { routeTitle } from '../shared/navConfig';
import { MOBILE_BG } from './mobileTheme';
import AppLoadBar from '../shared/AppLoadBar';
import PixelAvatar from '../shared/PixelAvatar';
import LiveFeedIndicator from '../shared/LiveFeedIndicator';

// Mobile chrome mirrors the desktop shell, one level down:
//   blue-gradient window bar (globals.css `--win-header-grad`, the same bar
//   `.classic-header` paints on the desktop) -> toolbar strip carrying the page
//   title -> content -> tab bar in the SIDEBAR palette (the tab bar is the
//   phone's sidebar, so it uses the sidebar's blues, not a grey taskbar).
// This used to be a navy `#1a1a2e -> #3a3a5e` bar over grey tabs, which belonged
// to no other screen in the app.
const HEADER_GRAD  = 'var(--xp-title-blue)';   // shared with desktop chrome; dims while a window is open
const SIDEBAR_BG   = '#d6dff7';   // Sidebar.tsx SIDEBAR_BG
const NAV_COLOR    = '#003080';   // Sidebar.tsx ACTIVE_COLOR / NAV_COLOR
const NAV_RULE     = '#c0ccee';   // Sidebar.tsx nav item borderBottom
const ACTIVE_GRAD  = 'linear-gradient(to bottom, #0058e6, #003080)'; // sidebar section header

const TABS = [
    { id: 'home',       label: 'Home',       icon: 'bi-house-fill',    route: '/dashboard'     },
    { id: 'scan',       label: 'Scan',       icon: 'bi-qr-code-scan',  route: '/scanner'       },
    { id: 'production', label: 'Production', icon: 'bi-gear-fill',     route: '/work-orders'   },
    { id: 'stock',      label: 'Stock',      icon: 'bi-box-seam-fill', route: '/stock'         },
];

function getActiveTab(pathname: string): string {
    if (pathname === '/' || pathname === '/dashboard') return 'home';
    if (pathname === '/scanner') return 'scan';
    if (pathname === '/work-orders') return 'production';
    if (pathname === '/stock' || pathname === '/inventory') return 'stock';
    return '';
}

// The white-gradient XP button face the desktop header uses (`.classic-header
// .btn-sm` in globals.css) — inline here because the mobile bar isn't inside
// `.classic-header`.
const headerBtn: React.CSSProperties = {
    background: 'linear-gradient(to bottom, #ffffff 0%, #ebeadb 100%)',
    border: '1px solid #707070',
    borderRadius: BUTTON_RADIUS,
    color: '#00309c',
    fontFamily: XP_FONT,
    fontSize: 10,
    fontWeight: 'bold',
    height: 24,
    padding: '0 7px',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    cursor: 'pointer',
    boxShadow: '1px 1px 0 rgba(0,0,0,0.1)',
};

export default function MobileShell({
    children,
    appName,
}: {
    children: React.ReactNode;
    appName?: string;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const { currentUser, logout } = useUser();
    const { language, setLanguage, t } = useLanguage();
    const activeTab = getActiveTab(pathname);

    const routeKey = !pathname || pathname === '/' ? 'dashboard' : pathname.substring(1).replace(/\//g, '-');
    const pageTitle = routeTitle(routeKey, t);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'var(--app-dvh)', background: MOBILE_BG, overflow: 'hidden' }}>

            {/* Window bar — same gradient/chrome as the desktop `.classic-header` */}
            <div style={{
                background: HEADER_GRAD,
                color: '#fff',
                padding: '4px 6px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 6,
                minHeight: 34,
                flexShrink: 0,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
                borderBottom: '1px solid #00309c',
            }}>
                <img
                    className="app-brand-icon"
                    src="/icons/icon-192.png"
                    alt={appName || 'Terras ERP'}
                    data-no-tip
                    style={{ width: 24, height: 24, borderRadius: 5, flexShrink: 0 }}
                />

                <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                    <select
                        data-testid="language-select"
                        value={language}
                        onChange={e => setLanguage(e.target.value as any)}
                        style={{
                            background: '#ffffff', border: '1px solid #7f9db9', borderRadius: 0,
                            color: '#000', fontFamily: XP_FONT, fontSize: 10, height: 24, padding: '0 2px',
                        }}
                    >
                        <option value="en">EN</option>
                        <option value="id">ID</option>
                    </select>

                    <button
                        data-testid="user-dropdown"
                        onClick={() => router.push('/settings')}
                        title="Settings"
                        style={headerBtn}
                    >
                        <PixelAvatar avatarId={currentUser?.avatar_id} seed={currentUser?.username} template={currentUser?.role?.default_avatar_id} size={14} />
                        <span data-testid="username-display">{currentUser?.username}</span>
                    </button>

                    <button
                        data-testid="logout-btn"
                        onClick={logout}
                        title="Terminate Session"
                        style={{
                            ...headerBtn,
                            background: '#ff4d4d',
                            border: '1px solid #800000',
                            color: '#ffffff',
                        }}
                    >
                        <i className="bi bi-box-arrow-right" aria-hidden="true" />
                    </button>
                </span>
            </div>

            {/* Page-title strip — the desktop's toolbar band under the chrome */}
            <div style={xpToolbar({ padding: '3px 8px', flexShrink: 0, flexWrap: 'nowrap', justifyContent: 'space-between' })}>
                <span style={{
                    fontFamily: XP_FONT, fontSize: 11, fontWeight: 'bold', color: '#333333',
                    textTransform: 'uppercase', letterSpacing: 0.5,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {pageTitle}
                </span>
                {/* Compact: this strip is the only spare chrome on a phone, and the
                    floor is exactly who needs to know the feed died. */}
                <LiveFeedIndicator compact />
            </div>

            <AppLoadBar />

            {/* Scrollable Content */}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                {children}
            </div>

            {/* Tab bar — the phone's sidebar, in the sidebar's palette */}
            <div style={{
                display: 'flex',
                background: SIDEBAR_BG,
                borderTop: `2px solid ${NAV_COLOR}`,
                flexShrink: 0,
            }}>
                {TABS.map((tab, i) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => router.push(tab.route)}
                            style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 2,
                                padding: '6px 4px 8px',
                                minHeight: 54,
                                border: 'none',
                                borderRight: i < TABS.length - 1 ? `1px solid ${NAV_RULE}` : 'none',
                                background: isActive ? ACTIVE_GRAD : 'transparent',
                                color: isActive ? '#ffffff' : NAV_COLOR,
                                cursor: 'pointer',
                                fontFamily: XP_FONT,
                                fontSize: 10,
                                fontWeight: isActive ? 'bold' : 'normal',
                                boxShadow: isActive ? 'inset 0 1px 0 rgba(255,255,255,0.3)' : 'none',
                            }}
                        >
                            <i className={`bi ${tab.icon}`} style={{ fontSize: 20 }} aria-hidden="true" />
                            {tab.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
