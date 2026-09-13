'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useData } from '../../context/DataContext';
import { Tabs, TabDef } from '../shared/Tabs';
import DyeRecipeTab from './DyeRecipeTab';
import DyeingOrdersTab from './DyeingOrdersTab';
import SettingOrdersTab from './SettingOrdersTab';
import { xpFont, FORM_SECTION_BLUE, xpInput as xpInputBase, xpBtn as xpBtnBase } from '../shared/xpTheme';
import { viewShellStyle, PageTitleBar } from '../shared/shellTheme';

// ── XP Style Constants ─────────────────────────────────────────────────────────
const modernFont = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const xpInput: React.CSSProperties = xpInputBase({ padding: '1px 4px' });
const xpBtn: React.CSSProperties = xpBtnBase({ fontSize: 10, padding: '2px 8px' });
const xpSectionHeader: React.CSSProperties = {
    background: FORM_SECTION_BLUE,
    color: 'white', padding: '3px 8px',
    fontFamily: xpFont, fontSize: 11, fontWeight: 'bold',
};
const xpPanel: React.CSSProperties = {
    border: '1px solid #7f9db9', background: 'white',
};

// ── Tab definitions ───────────────────────────────────────────────────────────
type TabKey = 'recipes' | 'dyeing' | 'setting';

const TABS: TabDef<TabKey>[] = [
    { key: 'recipes', label: 'Dye Recipes',     icon: 'bi-journal-text' },
    { key: 'dyeing',  label: 'Dyeing Orders',   icon: 'bi-droplet-half' },
    { key: 'setting', label: 'Setting Orders',  icon: 'bi-thermometer-half' },
];

export default function DyeingSettingView() {
    const { authFetch, items, attributes } = useData();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<TabKey>('recipes');
    const [recipes, setRecipes] = useState<any[]>([]);

    // Deep-link from Color Library "create recipe for this color": force the recipes
    // tab and hand the color id to DyeRecipeTab, which opens its create panel on it.
    const recipeColorId = searchParams.get('recipe_color_id');
    useEffect(() => { if (recipeColorId) setActiveTab('recipes'); }, [recipeColorId]);

    // ── Fetch recipes ─────────────────────────────────────────────────────────
    // Lookup feed, NOT a list: DyeingOrdersTab resolves each run's recipe_id out of
    // this array (and offers it as a picker), so it must be the whole set. `size=0`
    // is the uncapped contract on /dye-recipes — the paged window belongs to the
    // Dye Recipes list view only.
    const fetchRecipes = useCallback(async () => {
        try {
            const res = await authFetch('/api/dye-recipes?size=0');
            if (res.ok) {
                const data = await res.json();
                setRecipes(Array.isArray(data) ? data : (data.items ?? []));
            }
        } catch {
            // silent
        }
    }, [authFetch]);

    // Load recipes on mount
    useEffect(() => { fetchRecipes(); }, [fetchRecipes]);

    // Refresh recipes when switching to dyeing tab
    const handleTabChange = (tab: TabKey) => {
        setActiveTab(tab);
        if (tab === 'dyeing') {
            fetchRecipes();
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div style={viewShellStyle(true, 'page', { fontFamily: xpFont })}>
            {/* Title bar */}
            <PageTitleBar classic icon="bi-droplet-fill" title="Dyeing & Setting" />

            {/* Tabs bar */}
            <Tabs tabs={TABS} activeKey={activeTab} onChange={handleTabChange} classic />

            {/* Content area */}
            <div style={{
                flex: 1,
                background: '#fff',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
            }}>
                {activeTab === 'recipes' && (
                    <DyeRecipeTab
                        items={items}
                        attributes={attributes || []}
                        authFetch={authFetch}
                        initialColorId={recipeColorId}
                        onColorConsumed={() => router.replace('/dyeing-setting')}
                    />
                )}
                {activeTab === 'dyeing' && (
                    <DyeingOrdersTab
                        items={items}
                        recipes={recipes}
                        authFetch={authFetch}
                    />
                )}
                {activeTab === 'setting' && (
                    <SettingOrdersTab
                        items={items}
                        authFetch={authFetch}
                    />
                )}
            </div>
        </div>
    );
}
