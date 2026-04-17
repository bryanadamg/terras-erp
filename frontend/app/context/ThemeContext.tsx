'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface ThemeContextType {
    uiStyle: string;
    setUiStyle: (style: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [uiStyle, setUiStyleState] = useState('classic');

    useEffect(() => {
        const saved = localStorage.getItem('ui_style');
        if (saved) setUiStyleState(saved);
    }, []);

    const setUiStyle = (style: string) => {
        setUiStyleState(style);
        localStorage.setItem('ui_style', style);
    };

    return (
        <ThemeContext.Provider value={{ uiStyle, setUiStyle }}>
            {children}
        </ThemeContext.Provider>
    );
}

const defaultTheme: ThemeContextType = {
    uiStyle: 'classic',
    setUiStyle: () => {},
};

export const useTheme = (): ThemeContextType => {
    const context = useContext(ThemeContext);
    return context ?? defaultTheme;
};
