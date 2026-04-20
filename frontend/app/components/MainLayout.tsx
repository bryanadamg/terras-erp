'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import MobileShell from './mobile/MobileShell';
import { useUser } from '../context/UserContext';
import { useData } from '../context/DataContext';
import { useLanguage } from '../context/LanguageContext';
import { useRouter, usePathname } from 'next/navigation';
import { useTheme } from '../context/ThemeContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function MainLayout({ children }: { children: React.ReactNode }) {
    const { currentUser, logout, loading, hasPermission } = useUser();
    const { handleTabHover } = useData();
    const { language, setLanguage } = useLanguage();
    const { uiStyle } = useTheme();
    const router = useRouter();
    const pathname = usePathname();

    const [appName, setAppName] = useState('Terras ERP');
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const isMobile = useIsMobile();

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

    // SSR / Initial Loading State
    if (!mounted || loading) {
        return <div className="d-flex justify-content-center align-items-center vh-100 bg-light text-muted fw-bold">INITIALIZING_TERRAS_CORE...</div>;
    }

    // Allow Login Page and Docs pages to render without layout wrappers
    if (pathname === '/login' || pathname.startsWith('/docs')) {
        return <>{children}</>;
    }

    // Protect all other routes
    if (!currentUser) return null;

    // Mobile: render the XP mobile shell instead of sidebar layout
    if (isMobile) {
        return <MobileShell appName={appName}>{children}</MobileShell>;
    }

    // Map pathname to activeTab for Sidebar highlighting
    const activeTab = !pathname || pathname === '/' ? 'dashboard' : pathname.substring(1).replace(/\//g, '-');

    const handleSetActiveTab = (tab: string) => {
        const route = tab === 'dashboard' ? '/' : `/${tab}`;
        router.push(route);
        setIsMobileSidebarOpen(false);
    };

    return (
        <div className={`app-container ui-style-${uiStyle}`}>
            <Sidebar 
                activeTab={activeTab} 
                setActiveTab={handleSetActiveTab} 
                onTabHover={handleTabHover} 
                appName={appName} 
                isOpen={isMobileSidebarOpen} 
            />

            <div className="main-content flex-grow-1 overflow-auto bg-light">
                <div className={`app-header sticky-top bg-white border-bottom shadow-sm px-4 d-flex justify-content-between align-items-center no-print ${uiStyle === 'classic' ? 'classic-header' : ''}`}>
                    <div className="d-flex align-items-center gap-3">
                        <button className="btn btn-link d-md-none p-0 text-dark" onClick={() => setIsMobileSidebarOpen(true)}><i className="bi bi-list fs-3"></i></button>
                        <h5 className="mb-0 fw-bold text-dark d-none d-md-block text-uppercase letter-spacing-1">{activeTab.replace(/-/g, ' ')}</h5>
                    </div>
                    
                    <div className="d-flex align-items-center gap-2 gap-md-3">
                        <button data-testid="scanner-btn" className={`btn btn-sm ${uiStyle === 'classic' ? 'btn-light' : 'btn-outline-secondary'}`} onClick={() => router.push('/scanner')} title="Scan QR Code"><i className="bi bi-qr-code-scan"></i></button>
                        {hasPermission('admin.access') && <button data-testid="settings-btn" className={`btn btn-sm ${uiStyle === 'classic' ? 'btn-light' : 'btn-outline-info'}`} onClick={() => router.push('/settings')} title="Settings"><i className="bi bi-gear-fill"></i></button>}
                        
                        <div className="d-flex align-items-center me-1">
                            <select 
                                data-testid="language-select"
                                className={`form-select form-select-sm py-0 ps-1 pe-3 ${uiStyle === 'classic' ? 'bg-transparent border-0' : 'rounded-pill border-0 bg-light'}`}
                                style={{height: '24px', fontSize: '11px', minWidth: '60px'}}
                                value={language}
                                onChange={(e) => setLanguage(e.target.value as any)}
                            >
                                <option value="en">EN</option>
                                <option value="id">ID</option>
                            </select>
                        </div>

                        <div className="dropdown">
                            <button data-testid="user-dropdown" className="btn btn-sm btn-light border d-flex align-items-center gap-2 rounded-pill px-2" data-bs-toggle="dropdown" id="userDropdown">
                                <i className="bi bi-person-circle text-primary"></i><span className="small fw-bold d-none d-sm-inline" data-testid="username-display">{currentUser?.username}</span>
                            </button>
                            <ul className="dropdown-menu dropdown-menu-end shadow border-0 mt-2" aria-labelledby="userDropdown">
                                <li className="px-3 py-2 border-bottom mb-1"><div className="small fw-bold">{currentUser?.full_name}</div></li>
                                <li><button className="dropdown-item py-2 small" onClick={() => router.push('/settings')}><i className="bi bi-gear me-2"></i>Preferences & Admin</button></li>
                                <li><hr className="dropdown-divider" /></li>
                                <li><button data-testid="dropdown-logout-btn" className="dropdown-item py-2 small text-danger" onClick={logout}><i className="bi bi-box-arrow-right me-2"></i>Logout</button></li>
                            </ul>
                        </div>

                        <button data-testid="logout-btn" className={`btn btn-sm btn-outline-danger d-none d-md-flex align-items-center gap-2`} onClick={logout} title="Terminate Session">
                            <i className="bi bi-box-arrow-right"></i>
                            <span className="small fw-bold">LOGOUT</span>
                        </button>
                    </div>
                </div>

                <div className="p-4">
                    {children}
                </div>
            </div>
        </div>
    );
}
