'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
    UI_SCALES as PKG_UI_SCALES,
    DEFAULT_UI_SCALE as PKG_DEFAULT_UI_SCALE,
    readUiScale,
    applyUiScale,
} from '@bryanadamg/terras-ui/scale';

interface ThemeContextType {
    uiStyle: string;
    setUiStyle: (style: string) => void;
    /** Interface scale as a percentage: 70 | 75 | 80 | 90 | 100 | 110. */
    uiScale: number;
    setUiScale: (scale: number) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Classic (Windows XP) is the only interface style. Anything else in storage —
// 'modern', or the older 'default'/'compact' — heals onto it so no one gets
// stranded on a dead style. This stays a list rather than a constant because
// uiStyle and the `ui-style-${uiStyle}` root class are the seam terras-ui
// tokens theme through: a future style plugs in here.
const VALID_STYLES = ['classic'];
const DEFAULT_STYLE = 'classic';
const normalizeStyle = (s: string | null): string =>
    s && VALID_STYLES.includes(s) ? s : DEFAULT_STYLE;

// Interface scale. The app's tables and toolbars were drawn dense, so the
// browser's 100% leaves them looking oversized on a desktop monitor — 80% is
// the default everyone was reaching for manually with Ctrl+minus.
//
// The value, its list, the storage key and the `data-ui-scale` attribute all
// live in terras-ui's `scale` module (paired with terras-ui/scale.css, which
// turns the attribute into the root zoom). This context is only the picker's
// state: re-exported here so the settings UI keeps importing the list from the
// context it already uses, and so the pre-paint boot script in app/layout.tsx —
// which cannot import from a client module — reads the same constants through
// the package's `bootScript` instead of duplicating the list.
export const UI_SCALES = PKG_UI_SCALES;
export const DEFAULT_UI_SCALE = PKG_DEFAULT_UI_SCALE;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [uiStyle, setUiStyleState] = useState(() => {
        if (typeof window === 'undefined') return 'classic';
        const saved = localStorage.getItem('ui_style');
        return normalizeStyle(saved);
    });
    const [uiScale, setUiScaleState] = useState(readUiScale);

    useEffect(() => {
        // Heal a stale stored value so it stops re-applying on every load.
        const saved = localStorage.getItem('ui_style');
        const normalized = normalizeStyle(saved);
        if (saved && saved !== normalized) localStorage.setItem('ui_style', normalized);
    }, []);

    // Re-assert the attribute the boot script already set: covers a stored value
    // that failed to parse there and keeps the DOM in step after setUiScale.
    useEffect(() => {
        applyUiScale(uiScale);
    }, [uiScale]);

    const setUiStyle = (style: string) => {
        const normalized = normalizeStyle(style);
        setUiStyleState(normalized);
        localStorage.setItem('ui_style', normalized);
    };

    // applyUiScale normalizes, persists and stamps <html> in one call, and hands
    // back the value it actually applied — so the state never holds a scale the
    // DOM isn't wearing.
    const setUiScale = (scale: number) => {
        setUiScaleState(applyUiScale(scale));
    };

    return (
        <ThemeContext.Provider value={{ uiStyle, setUiStyle, uiScale, setUiScale }}>
            {children}
        </ThemeContext.Provider>
    );
}

const defaultTheme: ThemeContextType = {
    uiStyle: 'classic',
    setUiStyle: () => {},
    uiScale: DEFAULT_UI_SCALE,
    setUiScale: () => {},
};

export const useTheme = (): ThemeContextType => {
    const context = useContext(ThemeContext);
    return context ?? defaultTheme;
};
