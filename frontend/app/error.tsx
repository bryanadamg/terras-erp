'use client';

// Route-level error boundary. Next renders it inside the root layout, so the
// MainLayout shell (sidebar, header, logout) survives a crashing page instead
// of the whole app dropping to Next's bare "Application error" screen. Next
// clears it on the next navigation, so a sidebar click recovers too.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from './context/LanguageContext';
import { useUser } from './context/UserContext';
import { ShellWindow, ShellTitleBar, ToolbarButton } from './components/shared/shellTheme';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    const { t } = useLanguage();
    const { logout } = useUser();
    const router = useRouter();

    useEffect(() => { console.error(error); }, [error]);

    return (
        <ShellWindow>
            <ShellTitleBar icon="bi-exclamation-triangle-fill" title={t('page_error_title')} tone="red" />
            <div style={{ padding: 16, fontSize: 12 }}>
                <p>{t('page_error_body')}</p>
                {/* Shown so a screenshot sent to support carries the actual failure. */}
                <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', opacity: 0.7 }}>{error.message}{error.digest ? ` (${error.digest})` : ''}</pre>
                <div style={{ display: 'flex', gap: 6 }}>
                    <ToolbarButton tone="launch" icon="bi-arrow-clockwise" onClick={reset}>{t('try_again')}</ToolbarButton>
                    <ToolbarButton icon="bi-speedometer2" onClick={() => router.push('/dashboard')}>{t('dashboard')}</ToolbarButton>
                    <ToolbarButton tone="danger" icon="bi-box-arrow-right" onClick={logout}>{t('logout')}</ToolbarButton>
                </div>
            </div>
        </ShellWindow>
    );
}
