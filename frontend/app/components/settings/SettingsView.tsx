'use client';

import { useEffect, useRef } from 'react';
import { useUser } from '../../context/UserContext';
import { useRememberedTab } from '../../hooks/useRememberedTab';
import { Tabs, TabDef } from '../shared/Tabs';
import { PageTitleBar, ShellWindow, scrollAreaStyle } from '../shared/shellTheme';
import SettingsGeneralTab from './SettingsGeneralTab';
import SettingsAccountTab from './SettingsAccountTab';
import SettingsDatabaseTab from './SettingsDatabaseTab';
import SettingsAccessTab from './SettingsAccessTab';

type TabKey = 'general' | 'account' | 'database' | 'access';

const modernFont = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export default function SettingsView({
    appName, onUpdateAppName,
    companyProfile, onUpdateCompanyProfile, onUploadLogo,
}: any) {
    const { hasPermission } = useUser();
    const isAdmin = hasPermission('admin.access');

    const tabs: TabDef<TabKey>[] = [
        { key: 'general', label: 'General', icon: 'bi-gear-fill' },
        { key: 'account', label: 'My Account', icon: 'bi-person-fill' },
        ...(isAdmin ? [
            { key: 'database' as TabKey, label: 'Database & Backups', icon: 'bi-database-fill-gear' },
            { key: 'access' as TabKey, label: 'Access Control', icon: 'bi-shield-lock' },
        ] : []),
    ];
    const [activeTab, setActiveTab] = useRememberedTab<TabKey>('settings', 'general', tabs.map(t => t.key));
    const paneRef = useRef<HTMLDivElement>(null);

    // Every tab is mounted at once (see the panes below), so they share one scroll
    // pane — without this, hopping from the bottom of Database & Backups lands you
    // halfway down My Account.
    useEffect(() => { paneRef.current?.scrollTo({ top: 0 }); }, [activeTab]);

    return (
        <div className="fade-in">
            {/* Outer shell on the app's standing page-fill convention (ShellWindow /
                pageFillStyle): the frame is the height of the viewport below the app
                chrome on every tab, and the pane inside it scrolls. It used to be
                sized by its content, so the window itself grew and shrank as you
                moved between tabs — the title bar and tab strip jumping to a new
                place each time. Hand-rolling the frame is also how this file ended up
                on `borderRadius: 9`, one off the shell tier every other view uses. */}
            <ShellWindow fill="page" style={undefined}>
                {/* Title bar */}
                <PageTitleBar icon="bi-sliders" title="Settings" />

                {/* Tabs bar */}
                <Tabs tabs={tabs} activeKey={activeTab} onChange={(key) => setActiveTab(key)} />

                {/* Content area — the one scroll pane, so the chrome above it never moves */}
                <div ref={paneRef} style={{
                    ...scrollAreaStyle,
                    padding: 16,
                    background: '#ece9d8',
                }}>
                    <div style={{ display: activeTab === 'general' ? 'block' : 'none' }}>
                        <SettingsGeneralTab
                            appName={appName}
                            onUpdateAppName={onUpdateAppName}
                            companyProfile={companyProfile}
                            onUpdateCompanyProfile={onUpdateCompanyProfile}
                            onUploadLogo={onUploadLogo}
                        />
                    </div>

                    <div style={{ display: activeTab === 'account' ? 'block' : 'none' }}>
                        <SettingsAccountTab />
                    </div>

                    {isAdmin && (
                        <>
                            <div style={{ display: activeTab === 'database' ? 'block' : 'none' }}>
                                <SettingsDatabaseTab />
                            </div>

                            <div style={{ display: activeTab === 'access' ? 'block' : 'none' }}>
                                <SettingsAccessTab />
                            </div>
                        </>
                    )}
                </div>
            </ShellWindow>
        </div>
    );
}
