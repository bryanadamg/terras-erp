'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useUser } from '../../context/UserContext';

const XP_FONT = 'Tahoma, "Segoe UI", Arial, sans-serif';
const XP_BEIGE = '#ece9d8';

const TABS = [
    { id: 'home',       label: 'Home',       icon: 'bi-house-fill',    route: '/dashboard'     },
    { id: 'scan',       label: 'Scan',       icon: 'bi-qr-code-scan',  route: '/scanner'       },
    { id: 'production', label: 'Production', icon: 'bi-gear-fill',     route: '/manufacturing' },
    { id: 'stock',      label: 'Stock',      icon: 'bi-box-seam-fill', route: '/stock'         },
];

function getActiveTab(pathname: string): string {
    if (pathname === '/' || pathname === '/dashboard') return 'home';
    if (pathname === '/scanner') return 'scan';
    if (pathname === '/manufacturing') return 'production';
    if (pathname === '/stock' || pathname === '/inventory') return 'stock';
    return '';
}

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
    const activeTab = getActiveTab(pathname);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: XP_BEIGE, overflow: 'hidden' }}>

            {/* XP Title Bar */}
            <div style={{
                background: 'linear-gradient(to right, #1a1a2e 0%, #3a3a5e 100%)',
                color: '#fff',
                fontFamily: XP_FONT,
                fontSize: 13,
                fontWeight: 'bold',
                padding: '5px 10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                minHeight: 36,
                flexShrink: 0,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
                borderBottom: '1px solid #0a0a1e',
            }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <i className="bi bi-building-fill" style={{ fontSize: 14, color: '#aaccff' }} />
                    {appName || 'Terras ERP'}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: XP_FONT, fontSize: 11, opacity: 0.9 }}>
                    <i className="bi bi-person-fill" style={{ fontSize: 12 }} />
                    {currentUser?.username}
                    <button
                        onClick={logout}
                        style={{
                            background: 'none',
                            border: '1px solid rgba(255,255,255,0.35)',
                            color: '#fff',
                            fontFamily: XP_FONT,
                            fontSize: 10,
                            padding: '1px 7px',
                            cursor: 'pointer',
                            borderRadius: 2,
                            marginLeft: 2,
                        }}
                    >
                        Logout
                    </button>
                </span>
            </div>

            {/* Scrollable Content */}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                {children}
            </div>

            {/* XP Bottom Tab Bar */}
            <div style={{
                display: 'flex',
                background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)',
                borderTop: '2px solid #dfdfdf',
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
                                borderRight: i < TABS.length - 1 ? '1px solid #c0bdb5' : 'none',
                                background: isActive
                                    ? 'linear-gradient(to bottom, #316ac5, #1a4a8a)'
                                    : 'transparent',
                                color: isActive ? '#fff' : '#333',
                                cursor: 'pointer',
                                fontFamily: XP_FONT,
                                fontSize: 10,
                                fontWeight: isActive ? 'bold' : 'normal',
                                boxShadow: isActive ? 'inset 0 2px 0 rgba(255,255,255,0.15)' : 'none',
                            }}
                        >
                            <i className={`bi ${tab.icon}`} style={{ fontSize: 20 }} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
