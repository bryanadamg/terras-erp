'use client';

import React, { useEffect, useState } from 'react';
import UIBootSplash, { useBootIndicator } from '@bryanadamg/terras-ui/components/BootSplash';
import type { BootPhase } from '../../context/UserContext';

/**
 * Boot screen for the case where there is no chrome to draw yet — the login
 * route and the Electron cold start. Authenticated routes get BootShell
 * instead, which paints the real app frame rather than covering it.
 *
 * A thin adapter over terras-ui's BootSplash, which was extracted from this file:
 * same four checkpoints (see BootPhase in UserContext), same palette, and the
 * same two timing guards in `useBootIndicator` — nothing shows for the first
 * 250ms of a boot, and once shown it stays up for at least 400ms. Re-exported so
 * login/page.tsx keeps importing both from here.
 *
 * The *data* load that follows login is a different, separately measured thing
 * — that one is AppLoadBar's strip inside the shell. Don't merge them: this
 * runs before there is a shell to put a strip in.
 */
export { useBootIndicator };

export default function BootSplash({ phase }: { phase: BootPhase }) {
    // The renamed-app label lives in this app's storage; the package reads none.
    const [appName, setAppName] = useState('Terras ERP');
    useEffect(() => {
        const saved = localStorage.getItem('app_name');
        if (saved) setAppName(saved);
    }, []);
    return <UIBootSplash phase={phase} appName={appName} />;
}
