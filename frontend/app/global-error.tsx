'use client';

// Last-resort boundary for a crash in the root layout itself (providers,
// MainLayout, sidebar) — app/error.tsx can't catch those since it renders
// inside that layout. It replaces the whole document, so no providers or theme
// are available: plain markup, and logout done by hand.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
    const logout = () => {
        localStorage.removeItem('access_token');
        window.location.href = '/login';
    };
    return (
        <html lang="en">
            <body style={{ fontFamily: 'Tahoma, sans-serif', padding: 24, fontSize: 13 }}>
                <h2 style={{ fontSize: 16 }}>Terras ERP ran into a problem</h2>
                <p>The application failed to load. Reload to try again, or log out and sign in again.</p>
                <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', opacity: 0.7 }}>{error.message}{error.digest ? ` (${error.digest})` : ''}</pre>
                <button onClick={() => window.location.reload()} style={{ marginRight: 8 }}>Reload</button>
                <button onClick={logout}>Logout</button>
            </body>
        </html>
    );
}
