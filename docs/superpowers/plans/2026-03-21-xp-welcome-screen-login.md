# XP Welcome Screen Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate landing page + login page with a single Windows XP–styled Welcome Screen that IS the entry point for unauthenticated users.

**Architecture:** The `/login` route becomes the sole unauthenticated entry point, rendering a full-screen XP Welcome Screen. Unauthenticated visits to `/` are redirected to `/login`. The existing `LandingPage` component is no longer rendered. The login flow is two-step: username field with live autocomplete (populated from existing `/api/users` endpoint) → password field appears on confirmation → submit.

**Tech Stack:** Next.js 14 App Router, React 18, Bootstrap 5 (minimal — mostly custom CSS-in-JSX inline styles matching existing XP theme pattern), existing `UserContext` login/user APIs.

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Rewrite | `frontend/app/login/page.tsx` | Full XP Welcome Screen, two-step flow |
| Modify | `frontend/app/page.tsx` | Remove LandingPage for unauthenticated users |
| Modify | `frontend/app/components/MainLayout.tsx` | Redirect unauthenticated `/` → `/login` |
| Update | `frontend/e2e/auth.spec.ts` | Update tests for two-step login flow |
| Delete | `frontend/app/components/LandingPage.tsx` | No longer rendered — remove to avoid dead code |

---

## Task 1: Update routing — remove LandingPage from unauthenticated flow

**Files:**
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/app/components/MainLayout.tsx`

### Context
Currently `page.tsx` renders `<LandingPage />` for unauthenticated users, and `MainLayout.tsx` only redirects unauthenticated users to `/login` if they are on a non-root, non-login route. We need both to redirect unauthenticated users at `/` to `/login`.

- [ ] **Step 1: Update `MainLayout.tsx` auth protection**

In `frontend/app/components/MainLayout.tsx`, find the auth protection `useEffect` (around line 29–40). Change the redirect condition so that unauthenticated users at `/` are also sent to `/login`:

```tsx
// Auth Protection Logic
useEffect(() => {
    if (mounted && !loading) {
        // 1. If authenticated and on root, go to dashboard
        if (currentUser && pathname === '/') {
            router.push('/dashboard');
        }
        // 2. If unauthenticated on any non-login route, go to login
        else if (!currentUser && pathname !== '/login') {
            router.push('/login');
        }
    }
}, [currentUser, loading, pathname, router, mounted]);
```

Also update the "allow without layout wrappers" condition (around line 48) to only allow `/login`:

```tsx
// Allow Login Page to render without layout wrappers
if (pathname === '/login') {
    return <>{children}</>;
}
```

- [ ] **Step 2: Simplify `page.tsx`**

Replace the entire contents of `frontend/app/page.tsx` with a minimal authenticated-only dashboard render. The unauthenticated path is now handled by the MainLayout redirect above:

```tsx
'use client';

import MainLayout from './components/MainLayout';
import DashboardView from './components/DashboardView';
import { useData } from './context/DataContext';

export default function RootPage() {
    const {
        items, locations, stockBalance, workOrders,
        stockEntries, samples, salesOrders, dashboardKPIs
    } = useData();

    return (
        <MainLayout>
            <DashboardView
                items={items}
                locations={locations}
                stockBalance={stockBalance}
                workOrders={workOrders}
                stockEntries={stockEntries}
                samples={samples}
                salesOrders={salesOrders}
                kpis={dashboardKPIs}
            />
        </MainLayout>
    );
}
```

- [ ] **Step 3: Delete `LandingPage.tsx`**

Delete `frontend/app/components/LandingPage.tsx` — it is no longer imported anywhere.

- [ ] **Step 4: Verify no other imports of LandingPage exist**

Run:
```bash
grep -r "LandingPage" frontend/app/
```
Expected: no output (no remaining imports).

---

## Task 2: Rewrite `login/page.tsx` as XP Welcome Screen

**Files:**
- Rewrite: `frontend/app/login/page.tsx`

### Context
The new login page is a full-screen XP Welcome Screen. Key design elements (matching existing LandingPage XP patterns):
- Background: `linear-gradient(135deg, #0d1f5c 0%, #1a3fa8 40%, #0a246a 100%)`
- Top stripe: Teras ERP branding left, module list right, separated by subtle border
- Bottom stripe: clock only (live, updates every second)
- Center: left side = instruction text + vertical divider + right side = avatar + form fields
- Two-step flow: username input with dropdown suggestions → password input reveals on confirmation
- Preserve all `data-testid` attributes for E2E tests: `username-input`, `password-input`, `login-submit`, `login-error`

### Username autocomplete
Fetch `GET /api/users` on mount (no auth required — endpoint is public). Extract `{username, full_name}` from response. Filter client-side as user types. Show dropdown of matches. On Enter or clicking a suggestion: set selectedUser, clear input, show password step.

### Step confirmation (important for E2E compat)
When username field value is an **exact match** (case-insensitive) to a known username, the password step becomes active automatically. This allows Playwright to `fill('username-input', 'admin')` → password field appears without needing to click a suggestion.

- [ ] **Step 1: Write the full replacement for `frontend/app/login/page.tsx`**

```tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '../context/UserContext';

interface UserHint {
    username: string;
    full_name: string;
}

const AVATAR_COLORS = [
    'linear-gradient(135deg,#4a90d9,#2563c4)',
    'linear-gradient(135deg,#6a4da0,#4a2d80)',
    'linear-gradient(135deg,#2a8a60,#1a6040)',
    'linear-gradient(135deg,#c04a20,#8a2a10)',
    'linear-gradient(135deg,#a04090,#702860)',
];

function getAvatarColor(username: string): string {
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function LoginPage() {
    const { currentUser, login, loading } = useUser();
    const router = useRouter();

    const [mounted, setMounted] = useState(false);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [userHints, setUserHints] = useState<UserHint[]>([]);

    // Step 1: username
    const [usernameInput, setUsernameInput] = useState('');
    const [suggestions, setSuggestions] = useState<UserHint[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [highlightedIdx, setHighlightedIdx] = useState(0);

    // Step 2: password
    const [step, setStep] = useState<'username' | 'password'>('username');
    const [selectedUsername, setSelectedUsername] = useState('');
    const [password, setPassword] = useState('');

    const [loginError, setLoginError] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);

    const passwordRef = useRef<HTMLInputElement>(null);
    const usernameRef = useRef<HTMLInputElement>(null);
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';

    useEffect(() => { setMounted(true); }, []);

    // Clock
    useEffect(() => {
        const t = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(t);
    }, []);

    // Redirect if already logged in
    useEffect(() => {
        if (mounted && !loading && currentUser) router.push('/dashboard');
    }, [currentUser, loading, mounted, router]);

    // Fetch user hints on mount
    useEffect(() => {
        if (!mounted) return;
        fetch(`${API_BASE}/users`)
            .then(r => r.ok ? r.json() : [])
            .then((users: { username: string; full_name: string }[]) => {
                setUserHints(users.map(u => ({ username: u.username, full_name: u.full_name })));
            })
            .catch(() => {});
    }, [mounted, API_BASE]);

    // Filter suggestions as user types
    useEffect(() => {
        if (!usernameInput.trim()) {
            setSuggestions([]);
            return;
        }
        const q = usernameInput.toLowerCase();
        const filtered = userHints.filter(u => u.username.toLowerCase().includes(q));
        setSuggestions(filtered);
        setHighlightedIdx(0);

        // Auto-advance if exact match
        const exact = userHints.find(u => u.username.toLowerCase() === q);
        if (exact) {
            setSelectedUsername(exact.username);
            setStep('password');
            setShowSuggestions(false);
        }
    }, [usernameInput, userHints]);

    // Focus password when step changes
    useEffect(() => {
        if (step === 'password') {
            setTimeout(() => passwordRef.current?.focus(), 50);
        }
    }, [step]);

    const confirmUsername = (username: string) => {
        setSelectedUsername(username);
        setStep('password');
        setShowSuggestions(false);
        setLoginError('');
    };

    const handleUsernameKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            setHighlightedIdx(i => Math.min(i + 1, suggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            setHighlightedIdx(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (suggestions[highlightedIdx]) confirmUsername(suggestions[highlightedIdx].username);
            else if (usernameInput.trim()) confirmUsername(usernameInput.trim());
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoggingIn(true);
        setLoginError('');
        const success = await login(selectedUsername, password);
        if (!success) {
            setLoginError('Invalid credentials');
            setIsLoggingIn(false);
        }
    };

    const handleBack = () => {
        setStep('username');
        setSelectedUsername('');
        setPassword('');
        setLoginError('');
        setUsernameInput('');
        setTimeout(() => usernameRef.current?.focus(), 50);
    };

    const formatTime = (d: Date) =>
        d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const formatDate = (d: Date) =>
        d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    if (!mounted || loading) {
        return (
            <div className="d-flex justify-content-center align-items-center vh-100 bg-dark text-info fw-bold font-monospace">
                SYSTEM_CHECK...
            </div>
        );
    }

    const screen: React.CSSProperties = {
        position: 'fixed', inset: 0,
        background: 'linear-gradient(135deg, #0d1f5c 0%, #1a3fa8 40%, #0a246a 100%)',
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        userSelect: 'none',
    };

    const stripeBase: React.CSSProperties = {
        flexShrink: 0,
        display: 'flex', alignItems: 'center',
        padding: '0 6%',
    };

    return (
        <div style={screen} onClick={() => setShowSuggestions(false)}>

            {/* Top stripe */}
            <div style={{
                ...stripeBase,
                height: '22%',
                background: 'linear-gradient(to bottom, rgba(255,255,255,0.08) 0%, transparent 100%)',
                borderBottom: '1px solid rgba(166,202,240,0.15)',
                justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 'clamp(20px,3.5vw,42px)', fontWeight: 300, letterSpacing: 3, color: 'white', textShadow: '0 2px 12px rgba(0,80,200,0.8)' }}>
                        Teras ERP
                    </div>
                    <div style={{ fontSize: 'clamp(8px,1.1vw,13px)', color: '#a0c2f5', letterSpacing: 5, textTransform: 'uppercase' }}>
                        Manufacturing &amp; Inventory
                    </div>
                </div>
                <div style={{ fontSize: 'clamp(7px,0.9vw,11px)', color: '#6a8ab8', textAlign: 'right', lineHeight: 1.9, letterSpacing: 1 }}>
                    Production · Stock · Sales<br />
                    BOM · Work Orders · Reports
                </div>
            </div>

            {/* Center */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

                {/* Left: instruction */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '0 4%' }}>
                    <div style={{ width: '60%', height: 1, background: 'linear-gradient(to right, transparent, rgba(166,202,240,0.5), transparent)' }} />
                    <div style={{ fontSize: 'clamp(9px,1.2vw,14px)', color: '#8aace0', letterSpacing: 1 }}>
                        {step === 'username' ? 'Type your username to sign in' : 'Enter your password to continue'}
                    </div>
                </div>

                {/* Vertical divider */}
                <div style={{ width: 1, alignSelf: 'stretch', margin: '0 2%', background: 'linear-gradient(to bottom, transparent, rgba(166,202,240,0.35), transparent)' }} />

                {/* Right: form */}
                <div style={{ minWidth: '38%', maxWidth: '420px', padding: '0 5%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>

                    {/* Avatar */}
                    <div style={{
                        width: 'clamp(40px,6vw,64px)', height: 'clamp(40px,6vw,64px)',
                        background: step === 'password' ? getAvatarColor(selectedUsername) : 'linear-gradient(135deg,#4a8abf,#2a5a9f)',
                        borderRadius: 6, border: '2px solid rgba(255,255,255,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                        transition: 'background 0.3s',
                    }}>
                        <div style={{ width: '50%', height: '50%', background: 'rgba(255,255,255,0.75)', borderRadius: '50%' }} />
                    </div>

                    {step === 'password' && (
                        <div style={{ fontSize: 'clamp(10px,1.3vw,15px)', color: 'white', fontWeight: 600 }}>
                            {selectedUsername}
                        </div>
                    )}

                    <form
                        onSubmit={step === 'password' ? handleSubmit : (e) => { e.preventDefault(); if (suggestions[highlightedIdx]) confirmUsername(suggestions[highlightedIdx].username); }}
                        style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Username step */}
                        {step === 'username' && (
                            <div style={{ position: 'relative' }}>
                                <div style={{ fontSize: 'clamp(9px,1.1vw,12px)', color: '#c0d8f8', marginBottom: 4 }}>Username</div>
                                <input
                                    ref={usernameRef}
                                    id="username-input"
                                    data-testid="username-input"
                                    type="text"
                                    autoFocus
                                    autoComplete="off"
                                    value={usernameInput}
                                    onChange={e => { setUsernameInput(e.target.value); setShowSuggestions(true); }}
                                    onKeyDown={handleUsernameKeyDown}
                                    onFocus={() => setShowSuggestions(true)}
                                    style={{
                                        width: '100%', height: 'clamp(24px,3vw,36px)',
                                        background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(166,202,240,0.6)',
                                        borderRadius: 3, color: 'white', padding: '0 8px',
                                        fontSize: 'clamp(9px,1.1vw,13px)', outline: 'none',
                                    }}
                                    required
                                />
                                {showSuggestions && suggestions.length > 0 && (
                                    <div style={{
                                        position: 'absolute', top: '100%', left: 0, right: 0,
                                        background: 'rgba(8,24,80,0.97)', border: '1px solid rgba(166,202,240,0.35)',
                                        borderTop: 'none', borderRadius: '0 0 3px 3px',
                                        zIndex: 100, overflow: 'hidden',
                                    }}>
                                        {suggestions.map((u, i) => (
                                            <div
                                                key={u.username}
                                                onMouseDown={() => confirmUsername(u.username)}
                                                style={{
                                                    padding: 'clamp(4px,0.6vw,8px) 10px',
                                                    fontSize: 'clamp(9px,1.1vw,12px)',
                                                    color: i === highlightedIdx ? 'white' : '#b0cce8',
                                                    background: i === highlightedIdx ? 'rgba(37,99,196,0.7)' : 'transparent',
                                                    cursor: 'pointer',
                                                    display: 'flex', alignItems: 'center', gap: 8,
                                                    borderBottom: i < suggestions.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                                                }}
                                            >
                                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4a90d9', flexShrink: 0 }} />
                                                <span style={{ fontWeight: 600 }}>{u.username}</span>
                                                {u.full_name && <span style={{ opacity: 0.6 }}>— {u.full_name}</span>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Password step */}
                        {step === 'password' && (
                            <div>
                                <div style={{ fontSize: 'clamp(9px,1.1vw,12px)', color: '#e8c870', marginBottom: 4 }}>Password</div>
                                <input
                                    ref={passwordRef}
                                    id="password-input"
                                    data-testid="password-input"
                                    type="password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    style={{
                                        width: '100%', height: 'clamp(24px,3vw,36px)',
                                        background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(232,200,112,0.5)',
                                        borderRadius: 3, color: 'white', padding: '0 8px',
                                        fontSize: 'clamp(9px,1.1vw,13px)', outline: 'none',
                                    }}
                                    required
                                />
                            </div>
                        )}

                        {loginError && (
                            <div
                                data-testid="login-error"
                                style={{
                                    fontSize: 'clamp(8px,1vw,11px)', color: '#ff9080',
                                    background: 'rgba(180,40,20,0.25)', border: '1px solid rgba(180,40,20,0.4)',
                                    borderRadius: 3, padding: '4px 8px',
                                }}
                            >
                                {loginError}
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: step === 'password' ? 'space-between' : 'flex-end', gap: 8, marginTop: 4 }}>
                            {step === 'password' && (
                                <button
                                    type="button"
                                    onClick={handleBack}
                                    style={{
                                        background: 'linear-gradient(to bottom,#607090,#404860)',
                                        border: '1px solid rgba(100,130,180,0.4)', borderRadius: 3,
                                        color: 'white', fontSize: 'clamp(8px,1vw,12px)',
                                        padding: 'clamp(3px,0.5vw,6px) clamp(10px,2vw,20px)',
                                        cursor: 'pointer',
                                    }}
                                >
                                    ← Back
                                </button>
                            )}
                            <button
                                type="submit"
                                data-testid="login-submit"
                                disabled={isLoggingIn}
                                style={{
                                    background: isLoggingIn
                                        ? 'linear-gradient(to bottom,#3a6090,#1a3a6a)'
                                        : 'linear-gradient(to bottom,#4a90d9,#2563c4)',
                                    border: '1px solid #0a246a', borderRadius: 3,
                                    color: 'white', fontSize: 'clamp(8px,1vw,12px)',
                                    padding: 'clamp(3px,0.5vw,6px) clamp(10px,2vw,20px)',
                                    cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
                                }}
                            >
                                {isLoggingIn ? 'Signing in...' : step === 'username' ? 'Next →' : 'Sign In →'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Bottom stripe: clock only */}
            <div style={{
                ...stripeBase,
                height: '12%',
                background: 'linear-gradient(to top, rgba(0,0,60,0.7) 0%, transparent 100%)',
                borderTop: '1px solid rgba(166,202,240,0.1)',
                justifyContent: 'flex-end',
            }}>
                <div style={{ textAlign: 'right', fontSize: 'clamp(8px,1vw,12px)', color: '#8aaac8', lineHeight: 1.6 }}>
                    {formatTime(currentTime)}<br />
                    {formatDate(currentTime)}
                </div>
            </div>

        </div>
    );
}
```

- [ ] **Step 2: Verify the page renders by starting the dev server**

```bash
cd frontend && npm run dev
```

Navigate to `http://localhost:3000/login`. You should see the XP Welcome Screen. Verify:
- Blue gradient background fills viewport
- Top stripe: "Teras ERP" left, module list right
- Bottom stripe: live clock, no "Turn off computer"
- Username input in center-right with suggestions dropdown on typing
- After typing a valid username (or exact match), password field appears
- "← Back" returns to username step

- [ ] **Step 3: Check unauthenticated redirect**

While the dev server is running, visit `http://localhost:3000/`. Verify you are redirected to `/login` (not shown the LandingPage XP desktop simulation).

---

## Task 3: Update E2E tests for two-step login flow

**Files:**
- Modify: `frontend/e2e/auth.spec.ts`

### Context
The existing tests do:
```ts
await page.getByTestId('username-input').fill('admin');
await page.getByTestId('password-input').fill('password');
```
The `password-input` only appears after the username is confirmed. Since the auto-advance triggers on exact match when `fill` fires `onChange`, the transition happens immediately. However, Playwright's `fill` is synchronous from its perspective — we need to wait for the password input to appear before trying to fill it.

Also: `SYSTEM_CHECK...` is still in the new code so that existing wait is compatible.

- [ ] **Step 1: Update `auth.spec.ts` — add wait for password step**

Replace all login sequences with a helper that waits for `password-input` to appear:

```ts
import { test, expect, Page } from '@playwright/test';

async function loginAs(page: Page, username: string, password: string) {
    await page.goto('/login');
    await page.waitForSelector('text=SYSTEM_CHECK...', { state: 'hidden', timeout: 15000 });
    await page.getByTestId('username-input').fill(username);
    // Wait for password step to appear (exact match triggers auto-advance)
    await page.getByTestId('password-input').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByTestId('password-input').fill(password);
    await page.getByTestId('login-submit').click();
}

test.describe('Authentication & RBAC', () => {

    test('unauthenticated user is redirected to login', async ({ page }) => {
        await page.goto('/dashboard');
        await expect(page).toHaveURL('/login');
    });

    test('unauthenticated user at root is redirected to login', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveURL('/login');
    });

    test('successful login and logout', async ({ page }) => {
        await loginAs(page, 'admin', 'password');
        await expect(page).toHaveURL('/dashboard', { timeout: 15000 });
        await expect(page.getByTestId('username-display')).toContainText('admin');
        await page.getByTestId('logout-btn').click();
        await expect(page).toHaveURL('/login');
    });

    test('viewer role cannot access settings', async ({ page }) => {
        await loginAs(page, 'admin', 'password');
        await expect(page).toHaveURL('/dashboard');
        await expect(page.getByTestId('settings-btn')).toBeVisible();
        await page.goto('/settings');
        await expect(page.locator('text=Database Infrastructure')).toBeVisible();
    });

    test('invalid login shows error', async ({ page }) => {
        await page.goto('/login');
        await page.waitForSelector('text=SYSTEM_CHECK...', { state: 'hidden', timeout: 15000 });
        await page.getByTestId('username-input').fill('wrong');
        // 'wrong' won't match any user — manually click Next
        await page.getByTestId('login-submit').click();
        // Should advance with the typed username ('wrong') since no exact match
        await page.getByTestId('password-input').waitFor({ state: 'visible', timeout: 5000 });
        await page.getByTestId('password-input').fill('wrong');
        await page.getByTestId('login-submit').click();
        await expect(page.getByTestId('login-error')).toBeVisible();
        await expect(page.getByTestId('login-error')).toContainText('Invalid credentials');
    });

    test('back button returns to username step', async ({ page }) => {
        await page.goto('/login');
        await page.waitForSelector('text=SYSTEM_CHECK...', { state: 'hidden', timeout: 15000 });
        await page.getByTestId('username-input').fill('admin');
        await page.getByTestId('password-input').waitFor({ state: 'visible', timeout: 5000 });
        await page.getByRole('button', { name: '← Back' }).click();
        await expect(page.getByTestId('username-input')).toBeVisible();
        await expect(page.getByTestId('password-input')).not.toBeVisible();
    });

});
```

- [ ] **Step 2: Run E2E tests**

Ensure the dev server and backend are running, then:
```bash
cd frontend && npx playwright test e2e/auth.spec.ts --headed
```
Expected: all 5 tests pass.

- [ ] **Step 3: If "invalid login" test fails — adjust step confirmation for unknown usernames**

The `invalid login` test types `'wrong'` (not a known username) and clicks Next. In the current implementation, exact-match auto-advance won't fire for unknown usernames. The `login-submit` button in step 1 says "Next →" and submits the form, which calls `confirmUsername(usernameInput.trim())`. Verify this path works.

If the password input does not appear after clicking "Next →" for an unknown username, update the username form submit handler in `login/page.tsx`:

```tsx
// In the form's onSubmit for step === 'username':
onSubmit={step === 'password'
    ? handleSubmit
    : (e) => {
        e.preventDefault();
        const match = suggestions[highlightedIdx] || { username: usernameInput.trim(), full_name: '' };
        if (match.username) confirmUsername(match.username);
    }
}
```

---

## Notes

- The `/api/users` endpoint is already public (no auth required). No backend changes needed.
- `LandingPage.tsx` can be committed as deleted — it is completely replaced by this feature.
- The clock at bottom-right uses the user's local time via `new Date()`, matching existing LandingPage behavior.
- Avatar colors are deterministic per username (hash-based), so the same user always gets the same color.
