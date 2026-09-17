'use client';

// Shown in place of a page's content when the signed-in user lacks the permission
// that route requires (MainLayout gates on navConfig's ROUTE_PERMISSIONS). The
// shell stays around it — sidebar, header, logout — so the user can navigate away
// instead of hitting a dead end.
//
// A thin adapter over terras-ui's AccessDenied, which was extracted from this
// file and owns the panel. Routing stays here: the package has no router
// opinion, so `onBack` is a callback rather than a href.
import { useRouter } from 'next/navigation';
import UIAccessDenied from '@bryanadamg/terras-ui/components/AccessDenied';

export default function AccessDenied({ codes }: { codes: string[] }) {
    const router = useRouter();

    // The codes are shown so an admin reading a user's screen share knows exactly
    // which chip to tick on the Permissions tab.
    return (
        <UIAccessDenied
            codes={codes}
            icon={<i className="bi bi-lock-fill" />}
            onBack={() => router.push('/dashboard')}
            backLabel="Back to Dashboard"
        />
    );
}
