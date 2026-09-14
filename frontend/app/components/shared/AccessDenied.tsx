'use client';

// Shown in place of a page's content when the signed-in user lacks the permission
// that route requires (MainLayout gates on navConfig's ROUTE_PERMISSIONS). The
// shell stays around it — sidebar, header, logout — so the user can navigate away
// instead of hitting a dead end.
import { useRouter } from 'next/navigation';
import { xpFont, xpBtn, XP_BTN } from './xpTheme';

export default function AccessDenied({ codes }: { codes: string[] }) {
    const router = useRouter();
    // The codes are shown so an admin reading a user's screen share knows exactly
    // which chip to tick on the Permissions tab.
    const needed = codes.join(' or ');

    return (
        <div style={{ padding: 16, fontFamily: xpFont }}>
            <div style={{
                background: '#ffffff', border: '1px solid',
                borderColor: '#808080 #ffffff #ffffff #808080',
                padding: '28px 16px', textAlign: 'center', color: '#555',
            }}>
                <i className="bi bi-lock-fill" style={{ fontSize: 24, color: '#a0a0a0', display: 'block', marginBottom: 8 }} />
                <div style={{ fontSize: 12, fontWeight: 'bold', color: '#333' }}>You do not have access to this page</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>Ask an administrator for <b>{needed}</b>.</div>
                <button className={XP_BTN} style={{ ...xpBtn({ padding: '2px 10px' }), marginTop: 12 }} onClick={() => router.push('/dashboard')}>
                    Back to Dashboard
                </button>
            </div>
        </div>
    );

}
