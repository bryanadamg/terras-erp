'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '../context/UserContext';
import { useIsMobile } from '../hooks/useIsMobile';

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
    const isMobile = useIsMobile();

    const [mounted, setMounted] = useState(false);
    const [currentTime, setCurrentTime] = useState(new Date());

    const [usernameInput, setUsernameInput] = useState('');

    const [step, setStep] = useState<'username' | 'password'>('username');
    const [selectedUsername, setSelectedUsername] = useState('');
    const [password, setPassword] = useState('');

    const [loginError, setLoginError] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);

    const passwordRef = useRef<HTMLInputElement>(null);
    const usernameRef = useRef<HTMLInputElement>(null);

    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        const t = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        if (mounted && !loading && currentUser) router.push('/dashboard');
    }, [currentUser, loading, mounted, router]);

    useEffect(() => {
        if (step === 'password') {
            setTimeout(() => passwordRef.current?.focus(), 50);
        }
    }, [step]);

    const confirmUsername = (username: string) => {
        setSelectedUsername(username);
        setStep('password');
        setLoginError('');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoggingIn(true);
        setLoginError('');
        const result = await login(selectedUsername, password);
        if (result !== true) {
            setLoginError(result === 'network_error' ? 'Cannot reach server — check your connection' : 'Invalid username or password');
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

    if (isMobile) {
        return (
            <div
                style={{
                    position: 'fixed', inset: 0,
                    background: 'linear-gradient(135deg, #0d1f5c 0%, #1a3fa8 40%, #0a246a 100%)',
                    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                    display: 'flex', flexDirection: 'column', overflow: 'auto',
                }}
            >
                {/* Mobile header */}
                <div style={{ padding: '32px 28px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 300, letterSpacing: 3, color: 'white', marginBottom: 4 }}>
                        Teras ERP
                    </div>
                    <div style={{ fontSize: 11, color: '#a0c2f5', letterSpacing: 4, textTransform: 'uppercase' }}>
                        Manufacturing &amp; Inventory
                    </div>
                </div>

                {/* Mobile form card */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 28px 40px' }}>
                    <div style={{
                        background: 'rgba(255,255,255,0.07)',
                        border: '1px solid rgba(166,202,240,0.2)',
                        borderRadius: 12, padding: '28px 24px',
                    }}>
                        {/* Avatar */}
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
                            <div style={{
                                width: 56, height: 56,
                                background: step === 'password' ? getAvatarColor(selectedUsername) : 'linear-gradient(135deg,#4a8abf,#2a5a9f)',
                                borderRadius: 8, border: '2px solid rgba(255,255,255,0.3)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                            }}>
                                <div style={{ width: '50%', height: '50%', background: 'rgba(255,255,255,0.75)', borderRadius: '50%' }} />
                            </div>
                        </div>

                        {step === 'password' && (
                            <div style={{ textAlign: 'center', fontSize: 16, color: 'white', fontWeight: 600, marginBottom: 16 }}>
                                {selectedUsername}
                            </div>
                        )}

                        <div style={{ fontSize: 13, color: '#8aace0', textAlign: 'center', marginBottom: 20 }}>
                            {step === 'username' ? 'Enter your username to sign in' : 'Enter your password to continue'}
                        </div>

                        <form
                            onSubmit={step === 'password'
                                ? handleSubmit
                                : (e) => {
                                    e.preventDefault();
                                    if (usernameInput.trim()) confirmUsername(usernameInput.trim());
                                }
                            }
                            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                        >
                            {step === 'username' && (
                                <div>
                                    <div style={{ fontSize: 12, color: '#c0d8f8', marginBottom: 6 }}>Username</div>
                                    <input
                                        ref={usernameRef}
                                        id="username-input"
                                        data-testid="username-input"
                                        type="text"
                                        autoComplete="username"
                                        value={usernameInput}
                                        onChange={e => setUsernameInput(e.target.value)}
                                        style={{
                                            width: '100%', height: 48,
                                            background: 'rgba(255,255,255,0.12)',
                                            border: '1px solid rgba(166,202,240,0.6)',
                                            borderRadius: 6, color: 'white', padding: '0 14px',
                                            fontSize: 16, outline: 'none', boxSizing: 'border-box',
                                        }}
                                        required
                                    />
                                </div>
                            )}

                            {step === 'password' && (
                                <div>
                                    <div style={{ fontSize: 12, color: '#e8c870', marginBottom: 6 }}>Password</div>
                                    <input
                                        ref={passwordRef}
                                        id="password-input"
                                        data-testid="password-input"
                                        type="password"
                                        autoComplete="current-password"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        style={{
                                            width: '100%', height: 48,
                                            background: 'rgba(255,255,255,0.12)',
                                            border: '1px solid rgba(232,200,112,0.5)',
                                            borderRadius: 6, color: 'white', padding: '0 14px',
                                            fontSize: 16, outline: 'none', boxSizing: 'border-box',
                                        }}
                                        required
                                    />
                                </div>
                            )}

                            {loginError && (
                                <div
                                    data-testid="login-error"
                                    style={{
                                        fontSize: 13, color: '#ff9080',
                                        background: 'rgba(180,40,20,0.25)',
                                        border: '1px solid rgba(180,40,20,0.4)',
                                        borderRadius: 6, padding: '10px 12px',
                                    }}
                                >
                                    {loginError}
                                </div>
                            )}

                            <div style={{
                                display: 'flex',
                                justifyContent: step === 'password' ? 'space-between' : 'flex-end',
                                gap: 10, marginTop: 4,
                            }}>
                                {step === 'password' && (
                                    <button
                                        type="button"
                                        onClick={handleBack}
                                        style={{
                                            background: 'linear-gradient(to bottom,#607090,#404860)',
                                            border: '1px solid rgba(100,130,180,0.4)', borderRadius: 6,
                                            color: 'white', fontSize: 14,
                                            padding: '12px 20px',
                                            cursor: 'pointer', flex: 1,
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
                                        border: '1px solid #0a246a', borderRadius: 6,
                                        color: 'white', fontSize: 15, fontWeight: 600,
                                        padding: '14px 20px',
                                        cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                                        flex: 1,
                                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
                                    }}
                                >
                                    {isLoggingIn ? 'Signing in...' : step === 'username' ? 'Next →' : 'Sign In →'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                {/* Mobile clock */}
                <div style={{ padding: '0 28px 24px', textAlign: 'center', fontSize: 12, color: '#8aaac8', lineHeight: 1.6 }}>
                    {formatTime(currentTime)} · {formatDate(currentTime)}
                </div>
            </div>
        );
    }

    const stripeBase: React.CSSProperties = {
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 6%',
    };

    return (
        <div
            style={{
                position: 'fixed', inset: 0,
                background: 'linear-gradient(135deg, #0d1f5c 0%, #1a3fa8 40%, #0a246a 100%)',
                fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                userSelect: 'none',
            }}
        >
            {/* Top stripe */}
            <div style={{
                ...stripeBase,
                height: '22%',
                background: 'linear-gradient(to bottom, rgba(255,255,255,0.08) 0%, transparent 100%)',
                borderBottom: '1px solid rgba(166,202,240,0.15)',
                justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{
                        fontSize: 'clamp(20px,3.5vw,42px)', fontWeight: 300,
                        letterSpacing: 3, color: 'white',
                        textShadow: '0 2px 12px rgba(0,80,200,0.8)',
                    }}>
                        Teras ERP
                    </div>
                    <div style={{
                        fontSize: 'clamp(8px,1.1vw,13px)', color: '#a0c2f5',
                        letterSpacing: 5, textTransform: 'uppercase',
                    }}>
                        Manufacturing &amp; Inventory
                    </div>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <div style={{ fontSize: 'clamp(7px,0.9vw,11px)', color: '#6a8ab8', lineHeight: 1.9, letterSpacing: 1 }}>
                        Production · Stock · Sales<br />
                        BOM · Work Orders · Reports
                    </div>
                    <a
                        href="/docs"
                        style={{
                            fontSize: 'clamp(7px,0.85vw,10px)',
                            color: '#7ab0e8',
                            textDecoration: 'none',
                            border: '1px solid rgba(122,176,232,0.3)',
                            borderRadius: 2,
                            padding: 'clamp(1px,0.3vw,3px) clamp(4px,0.8vw,8px)',
                        }}
                    >
                        📋 View Documentation
                    </a>
                </div>
            </div>

            {/* Center */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

                {/* Left: instruction */}
                <div style={{
                    flex: 1, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 8, padding: '0 4%',
                }}>
                    <div style={{
                        width: '60%', height: 1,
                        background: 'linear-gradient(to right, transparent, rgba(166,202,240,0.5), transparent)',
                    }} />
                    <div style={{ fontSize: 'clamp(9px,1.2vw,14px)', color: '#8aace0', letterSpacing: 1 }}>
                        {step === 'username' ? 'Type your username to sign in' : 'Enter your password to continue'}
                    </div>
                </div>

                {/* Vertical divider */}
                <div style={{
                    width: 1, alignSelf: 'stretch', margin: '0 2%',
                    background: 'linear-gradient(to bottom, transparent, rgba(166,202,240,0.35), transparent)',
                }} />

                {/* Right: form */}
                <div style={{
                    minWidth: '38%', maxWidth: '420px', padding: '0 5%',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                }}>
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
                        onSubmit={step === 'password'
                            ? handleSubmit
                            : (e) => {
                                e.preventDefault();
                                if (usernameInput.trim()) confirmUsername(usernameInput.trim());
                            }
                        }
                        style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}
                    >
                        {step === 'username' && (
                            <div>
                                <div style={{ fontSize: 'clamp(9px,1.1vw,12px)', color: '#c0d8f8', marginBottom: 4 }}>
                                    Username
                                </div>
                                <input
                                    ref={usernameRef}
                                    id="username-input"
                                    data-testid="username-input"
                                    type="text"
                                    autoFocus
                                    autoComplete="username"
                                    value={usernameInput}
                                    onChange={e => setUsernameInput(e.target.value)}
                                    style={{
                                        width: '100%', height: 'clamp(24px,3vw,36px)',
                                        background: 'rgba(255,255,255,0.15)',
                                        border: '1px solid rgba(166,202,240,0.6)',
                                        borderRadius: 3, color: 'white', padding: '0 8px',
                                        fontSize: 'clamp(9px,1.1vw,13px)', outline: 'none',
                                    }}
                                    required
                                />
                            </div>
                        )}

                        {step === 'password' && (
                            <div>
                                <div style={{ fontSize: 'clamp(9px,1.1vw,12px)', color: '#e8c870', marginBottom: 4 }}>
                                    Password
                                </div>
                                <input
                                    ref={passwordRef}
                                    id="password-input"
                                    data-testid="password-input"
                                    type="password"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    style={{
                                        width: '100%', height: 'clamp(24px,3vw,36px)',
                                        background: 'rgba(255,255,255,0.15)',
                                        border: '1px solid rgba(232,200,112,0.5)',
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
                                    background: 'rgba(180,40,20,0.25)',
                                    border: '1px solid rgba(180,40,20,0.4)',
                                    borderRadius: 3, padding: '4px 8px',
                                }}
                            >
                                {loginError}
                            </div>
                        )}

                        <div style={{
                            display: 'flex',
                            justifyContent: step === 'password' ? 'space-between' : 'flex-end',
                            gap: 8, marginTop: 4,
                        }}>
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
