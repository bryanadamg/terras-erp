'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import LoginScreen from '@bryanadamg/terras-ui/components/LoginScreen';
import { useUser } from '../context/UserContext';
import PixelAvatar from '../components/shared/PixelAvatar';
import { recallAvatar, recallIdentity } from '../components/shared/avatarCache';
import BootSplash, { useBootIndicator } from '../components/shared/BootSplash';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api')
    .replace(/\/api$/, '') + '/api';

const LAST_USERNAME_KEY = 'teras_last_username';

type SystemStatus = 'checking' | 'ok' | 'degraded' | 'offline';

/**
 * Server health for the footer dot. Stays here rather than in the package: the
 * endpoints, the poll interval and the degraded/offline rule are this app's,
 * and LoginScreen deliberately takes the verdict as a prop instead of fetching.
 */
function useSystemStatus() {
    const [status, setStatus] = useState<SystemStatus>('checking');
    const [version, setVersion] = useState<string | null>(null);
    const [startedAt, setStartedAt] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const check = async () => {
            try {
                const [healthRes, readyRes] = await Promise.all([
                    fetch(`${API_BASE}/health`),
                    fetch(`${API_BASE}/health/ready`),
                ]);
                if (cancelled) return;
                if (healthRes.ok) {
                    const data = await healthRes.json();
                    setVersion(data.version ?? null);
                    setStartedAt(data.started_at ?? null);
                }
                setStatus(healthRes.ok && readyRes.ok ? 'ok' : healthRes.ok ? 'degraded' : 'offline');
            } catch {
                if (!cancelled) setStatus('offline');
            }
        };

        check();
        const t = setInterval(check, 30000);
        return () => { cancelled = true; clearInterval(t); };
    }, []);

    return { status, version, startedAt };
}

// The suite panel's icon set. The package ships the module list and its order
// (they are suite identity, the same in every Terras app) but no icon set, so
// the faces are supplied here from the bootstrap-icons the rest of the app uses.
const SUITE_ICONS: Record<string, React.ReactNode> = {
    cms: <i className="bi bi-file-earmark-richtext-fill" />,
    pim: <i className="bi bi-tags-fill" />,
    hris: <i className="bi bi-person-badge-fill" />,
    accounting: <i className="bi bi-calculator-fill" />,
    mrp: <i className="bi bi-gear-wide-connected" />,
    inventory: <i className="bi bi-boxes" />,
    scm: <i className="bi bi-truck" />,
    wms: <i className="bi bi-building" />,
    crm: <i className="bi bi-people-fill" />,
    psa: <i className="bi bi-briefcase-fill" />,
};

// Which tiles light up: the two modules this app actually is.
const ACTIVE_MODULES = ['mrp', 'inventory'];

export default function LoginPage() {
    const { currentUser, login, loading, bootPhase } = useUser();
    const router = useRouter();

    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    const { status: systemStatus, version, startedAt } = useSystemStatus();

    // Boot gate: hydration, plus the /users/me round-trip when a token is
    // already stored (without it, a returning user sees the login form flash
    // before being bounced to the dashboard).
    const booting = !mounted || loading;
    const showBoot = useBootIndicator(booting);

    useEffect(() => {
        if (mounted && !loading && currentUser) router.push('/dashboard');
    }, [currentUser, loading, mounted, router]);

    // Read once, after the boot gate — LoginScreen seeds its field and badge from
    // this on the first render only, so it must not arrive late. localStorage is
    // gated on `mounted` because it does not exist during prerender and reading
    // it while rendering would desync the hydrated markup.
    const initialUsername = useMemo(
        () => (mounted ? window.localStorage.getItem(LAST_USERNAME_KEY) || '' : ''),
        [mounted],
    );

    const lastUpdated = startedAt
        ? new Date(startedAt).toLocaleString('en-US', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })
        : undefined;

    // Splash only once the wait has earned it; below SHOW_DELAY the screen stays
    // empty rather than flashing. `showBoot` can outlast `booting` — that's the
    // min-visible floor holding a splash that did appear.
    if (showBoot) return <BootSplash phase={mounted ? bootPhase : 'hydrating'} />;
    if (booting) return null;

    return (
        <LoginScreen
            module="ERP"
            blurb={<>Production · Stock · Sales<br />BOM · Work Orders · Reports</>}
            docsHref="/docs"
            docsLabel="View Documentation"
            docsIcon={<i className="bi bi-journal-text" />}
            suiteIcons={SUITE_ICONS}
            activeModules={ACTIVE_MODULES}
            initialUsername={initialUsername}
            // Device-cached name/role from the last successful sign-in — never a
            // pre-auth lookup, which would confirm that a given account exists.
            identityFor={recallIdentity}
            avatar={({ username, size }) => (
                <PixelAvatar avatarId={recallAvatar(username)} seed={username || 'teras'} size={size} />
            )}
            onUsernameConfirmed={u => window.localStorage.setItem(LAST_USERNAME_KEY, u)}
            onSubmit={async (username, password) => {
                const result = await login(username, password);
                if (result === true) return true;
                return result === 'network_error'
                    ? 'Cannot reach server — check your connection'
                    : 'Invalid username or password';
            }}
            status={systemStatus}
            version={version ?? undefined}
            lastUpdated={lastUpdated}
        />
    );
}
