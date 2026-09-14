'use client';

import React, { useEffect, useState } from 'react';
import { useData } from '../../context/DataContext';
import { Chip, familyTint } from './xpTheme';

/**
 * "Live updates off" badge for the app chrome.
 *
 * A dead WebSocket is otherwise completely silent: pages still render, they just
 * stop moving, and the only place `wsStatus` was ever surfaced is a status tile on
 * Settings > Database — which nobody on the floor opens. An operator watching a
 * board has no way to tell "nothing happened" from "I stopped being told".
 *
 * Renders NOTHING while the feed is healthy, so it costs no chrome in the normal
 * case. It also waits out a grace period before appearing: the socket is briefly
 * not-open on every page load and on each reconnect hop, and a badge that blinks
 * on every hiccup is one people learn to ignore.
 */

// Long enough to cover a normal connect and a fast reconnect, short enough that a
// genuinely dead feed is flagged before the user has read a whole screen.
const GRACE_MS = 5000;

export default function LiveFeedIndicator({ compact = false }: { compact?: boolean }) {
    const { wsStatus } = useData();
    const [show, setShow] = useState(false);

    useEffect(() => {
        if (wsStatus === 'open') { setShow(false); return; }
        const t = setTimeout(() => setShow(true), GRACE_MS);
        return () => clearTimeout(t);
    }, [wsStatus]);

    if (!show) return null;

    return (
        <Chip
            size={compact ? 'xs' : 'sm'}
            icon="bi-wifi-off"
            tone={familyTint('amber')}
            title="This page is not receiving live updates. It will catch up on its own when the connection returns; reload the page if this stays here."
        >
            {compact ? 'NO LIVE' : 'LIVE UPDATES OFF'}
        </Chip>
    );
}
