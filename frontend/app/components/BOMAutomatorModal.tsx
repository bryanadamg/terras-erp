import React, { useState, useEffect, useCallback, memo } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';

interface AutoBOMProfile {
    id: string;
    name: string;
    levels: string[][];
}

interface BOMAutomatorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onApply: (levels: string[][]) => void;
}

const DUMMY_CODE = "9698/22";
const DEFAULT_LEVELS = [['WIP CBG {CODE}'], ['WIP CSBG {CODE}'], ['WIP WARPING {CODE}']];

// --- XP style helpers ---
const xpBtn: React.CSSProperties = {
    fontFamily: 'Tahoma, "Segoe UI", sans-serif',
    fontSize: 11,
    padding: '2px 10px',
    background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)',
    borderTop: '1px solid #fff',
    borderLeft: '1px solid #fff',
    borderRight: '1px solid #555',
    borderBottom: '1px solid #555',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    minWidth: 60,
    color: '#000',
};

const xpBtnPrimary: React.CSSProperties = {
    ...xpBtn,
    background: 'linear-gradient(to bottom, #b4d0f8, #7aacf0)',
    borderTopColor: '#c8e0ff',
    borderLeftColor: '#c8e0ff',
    fontWeight: 'bold',
    color: '#00007a',
    minWidth: 80,
};

const xpBtnDanger: React.CSSProperties = {
    ...xpBtn,
    background: 'linear-gradient(to bottom, #f8d0d0, #e0a0a0)',
    color: '#800000',
    minWidth: 'auto',
    padding: '1px 6px',
    fontSize: 10,
};

const xpInput: React.CSSProperties = {
    fontFamily: 'Tahoma, "Segoe UI", sans-serif',
    fontSize: 11,
    border: '1px solid #7f9db9',
    borderTopColor: '#5a7fa8',
    background: 'white',
    height: 20,
    padding: '0 4px',
    outline: 'none',
    width: '100%',
};

const xpGroupbox = (label: string): { wrapper: React.CSSProperties; labelStyle: React.CSSProperties } => ({
    wrapper: {
        border: '1px solid #aca899',
        borderRadius: 3,
        padding: '12px 8px 8px',
        background: '#f5f4ee',
        position: 'relative',
        marginBottom: 6,
    },
    labelStyle: {
        position: 'absolute',
        top: -8,
        left: 8,
        background: '#f5f4ee',
        padding: '0 4px',
        fontSize: 10,
        fontWeight: 'bold',
        color: '#000080',
        fontFamily: 'Tahoma, "Segoe UI", sans-serif',
    },
});

const LEVEL_BADGE_COLORS = ['#316ac5', '#2a7a2a', '#b46a00', '#7a2a7a', '#7a4a00'];

// Memoized Sub-component for the Preview
const BranchingPreview = memo(({ levels }: { levels: string[][] }) => (
    <div style={{
        border: '2px inset #aaa',
        background: 'white',
        padding: '6px',
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: 10,
        lineHeight: 1.8,
        minHeight: 120,
        overflowY: 'auto',
        flex: 1,
    }}>
        <div style={{ color: '#000080', fontWeight: 'bold' }}>📦 {DUMMY_CODE}</div>
        {levels.map((lvl, lIdx) => (
            lvl.map((p, pIdx) => (
                <div key={`${lIdx}-${pIdx}`} style={{ paddingLeft: `${(lIdx + 1) * 14}px`, color: lIdx === 0 ? '#333' : '#555' }}>
                    {lIdx === 0 ? '├─ ' : '│ ├─ '}{p.replace('{CODE}', DUMMY_CODE) || '...'}
                </div>
            ))
        ))}
    </div>
));
BranchingPreview.displayName = 'BranchingPreview';

// Memoized Level Card — XP groupbox style
const LevelCard = memo(({
    lIdx,
    lvl,
    onRemoveLevel,
    onAddPattern,
    onRemovePattern,
    onPatternChange
}: {
    lIdx: number;
    lvl: string[];
    onRemoveLevel: (idx: number) => void;
    onAddPattern: (idx: number) => void;
    onRemovePattern: (lIdx: number, pIdx: number) => void;
    onPatternChange: (lIdx: number, pIdx: number, val: string) => void;
}) => {
    const badgeColor = LEVEL_BADGE_COLORS[lIdx % LEVEL_BADGE_COLORS.length];
    const gb = xpGroupbox(`Level ${lIdx + 1}`);

    return (
        <div style={gb.wrapper}>
            <span style={gb.labelStyle}>Level {lIdx + 1}</span>

            {/* Card header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{
                    background: badgeColor, color: 'white',
                    fontSize: 9, fontWeight: 'bold', padding: '1px 6px',
                    borderRadius: 1, fontFamily: 'Tahoma, sans-serif',
                }}>L{lIdx + 1}</span>
                <span style={{ flex: 1, fontSize: 10, color: '#555', fontFamily: 'Tahoma, sans-serif' }}>
                    Processing Level
                </span>
                <button style={xpBtnDanger} onClick={() => onRemoveLevel(lIdx)}>
                    🗑 Remove
                </button>
            </div>

            {/* Pattern rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {lvl.map((pattern, pIdx) => (
                    <div key={pIdx} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <span style={{
                            background: '#ddd', border: '1px solid #aaa',
                            padding: '1px 5px', fontSize: 10, minWidth: 18,
                            textAlign: 'center', fontFamily: 'Tahoma, sans-serif',
                        }}>{pIdx + 1}</span>
                        <input
                            type="text"
                            style={{ ...xpInput, flex: 1 }}
                            value={pattern}
                            onChange={(e) => onPatternChange(lIdx, pIdx, e.target.value)}
                            placeholder="e.g. WIP {CODE}"
                        />
                        {lvl.length > 1 && (
                            <button style={{ ...xpBtn, minWidth: 'auto', padding: '0 6px', fontSize: 12 }}
                                onClick={() => onRemovePattern(lIdx, pIdx)}>−</button>
                        )}
                    </div>
                ))}
            </div>

            <button
                style={{
                    background: 'none', border: 'none',
                    color: '#0000aa', fontSize: 10, cursor: 'pointer',
                    padding: '4px 0 0', fontFamily: 'Tahoma, sans-serif',
                    textDecoration: 'underline',
                }}
                onClick={() => onAddPattern(lIdx)}
            >
                + Add branching item
            </button>
        </div>
    );
});
LevelCard.displayName = 'LevelCard';

const BOMAutomatorModal = memo(({ isOpen, onClose, onApply }: BOMAutomatorModalProps) => {
    const { t } = useLanguage();
    const [levels, setLevels] = useState<string[][]>(DEFAULT_LEVELS);
    const [profiles, setProfiles] = useState<AutoBOMProfile[]>([]);
    const [profileName, setProfileName] = useState('');
    const { uiStyle: currentStyle } = useTheme();

    useEffect(() => {
        if (!isOpen) return;
        const savedProfiles = localStorage.getItem('bom_auto_profiles');
        if (savedProfiles) {
            try { setProfiles(JSON.parse(savedProfiles)); } catch (e) { console.error("Invalid profiles in localstorage"); }
        }
        const lastLevels = localStorage.getItem('bom_auto_levels_active');
        if (lastLevels) {
            try { setLevels(JSON.parse(lastLevels)); } catch (e) {}
        }
    }, [isOpen]);

    const handlePatternChange = useCallback((lIdx: number, pIdx: number, value: string) => {
        setLevels(prev => prev.map((lvl, i) =>
            i === lIdx ? lvl.map((p, j) => j === pIdx ? value : p) : lvl
        ));
    }, []);

    const addLevel = useCallback(() => { setLevels(prev => [...prev, ['']]); }, []);

    const removeLevel = useCallback((index: number) => {
        setLevels(prev => prev.filter((_, i) => i !== index));
    }, []);

    const addPatternToLevel = useCallback((lIdx: number) => {
        setLevels(prev => prev.map((lvl, i) => i === lIdx ? [...lvl, ''] : lvl));
    }, []);

    const removePatternFromLevel = useCallback((lIdx: number, pIdx: number) => {
        setLevels(prev => prev.map((lvl, i) =>
            i === lIdx ? lvl.filter((_, j) => j !== pIdx) : lvl
        ));
    }, []);

    const handleSaveProfile = useCallback(() => {
        if (!profileName.trim()) return;
        const newProfile: AutoBOMProfile = {
            id: Math.random().toString(36).substr(2, 9),
            name: profileName,
            levels: levels
        };
        setProfiles(prev => {
            const updated = [...prev, newProfile];
            localStorage.setItem('bom_auto_profiles', JSON.stringify(updated));
            return updated;
        });
        setProfileName('');
    }, [profileName, levels]);

    const handleLoadProfile = useCallback((profile: AutoBOMProfile) => {
        setLevels(profile.levels);
    }, []);

    const handleDeleteProfile = useCallback((e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setProfiles(prev => {
            const updated = prev.filter(p => p.id !== id);
            localStorage.setItem('bom_auto_profiles', JSON.stringify(updated));
            return updated;
        });
    }, []);

    const handleSaveAndApply = useCallback(() => {
        localStorage.setItem('bom_auto_levels_active', JSON.stringify(levels));
        onApply(levels);
        onClose();
    }, [levels, onApply, onClose]);

    if (!isOpen) return null;

    const gb = xpGroupbox('Saved Profiles');
    const gbPreview = xpGroupbox('Structure Preview');
    const gbTip = xpGroupbox('💡 Tip');

    return (
        <div
            data-testid="bom-automator-modal"
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(0,0,0,0.55)',
                zIndex: 20100,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
        >
            <div style={{
                width: 680,
                maxWidth: '96vw',
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'Tahoma, "Segoe UI", sans-serif',
                fontSize: 11,
                boxShadow: '4px 4px 16px rgba(0,0,0,0.6)',
                border: '1px solid #0a246a',
            }}>
                {/* XP Title Bar */}
                <div style={{
                    background: 'linear-gradient(to right, #0a246a 0%, #3a72d0 45%, #0a246a 100%)',
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '3px 4px 3px 8px',
                    height: 22, flexShrink: 0,
                }}>
                    <span style={{ color: 'white', fontSize: 11, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 5 }}>
                        ⚡ BOM Automator — Configure Structure
                    </span>
                    <div style={{ display: 'flex', gap: 2 }}>
                        <button onClick={onClose} style={{
                            width: 16, height: 14,
                            background: 'linear-gradient(to bottom, #f0f0e0, #d0cfc0)',
                            borderTop: '1px solid #fff', borderLeft: '1px solid #fff',
                            borderRight: '1px solid #555', borderBottom: '1px solid #555',
                            fontSize: 9, cursor: 'pointer', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', fontWeight: 'bold',
                        }}>_</button>
                        <button style={{
                            width: 16, height: 14,
                            background: 'linear-gradient(to bottom, #f0f0e0, #d0cfc0)',
                            borderTop: '1px solid #fff', borderLeft: '1px solid #fff',
                            borderRight: '1px solid #555', borderBottom: '1px solid #555',
                            fontSize: 9, cursor: 'pointer', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                        }}>□</button>
                        <button onClick={onClose} style={{
                            width: 16, height: 14,
                            background: 'linear-gradient(to bottom, #d06060, #a03030)',
                            borderTop: '1px solid #e08080', borderLeft: '1px solid #e08080',
                            borderRight: '1px solid #600', borderBottom: '1px solid #600',
                            fontSize: 9, color: 'white', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold',
                        }}>✕</button>
                    </div>
                </div>

                {/* Body: two columns */}
                <div style={{
                    background: '#ece9d8',
                    display: 'flex',
                    gap: 8,
                    padding: 8,
                    flex: 1,
                    overflow: 'hidden',
                    minHeight: 0,
                }}>
                    {/* Left: config + levels (scrollable) */}
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, paddingRight: 4 }}>

                        {/* Saved Profiles */}
                        <div style={gb.wrapper}>
                            <span style={gb.labelStyle}>Saved Profiles</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6, minHeight: 20 }}>
                                {profiles.length === 0 && (
                                    <span style={{ fontSize: 10, color: '#888', fontStyle: 'italic' }}>No saved configurations.</span>
                                )}
                                {profiles.map(p => (
                                    <div key={p.id} style={{ display: 'flex', border: '1px solid #aaa' }}>
                                        <button
                                            style={{ ...xpBtn, minWidth: 'auto', borderRight: 'none', fontSize: 10, padding: '1px 8px' }}
                                            onClick={() => handleLoadProfile(p)}
                                        >
                                            {p.name}
                                        </button>
                                        <button
                                            style={{ ...xpBtnDanger, borderLeft: 'none', borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                                            onClick={(e) => handleDeleteProfile(e, p.id)}
                                        >✕</button>
                                    </div>
                                ))}
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <input
                                    type="text"
                                    style={{ ...xpInput, flex: 1 }}
                                    placeholder="New profile name..."
                                    value={profileName}
                                    onChange={e => setProfileName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSaveProfile()}
                                />
                                <button
                                    style={profileName.trim() ? xpBtnPrimary : { ...xpBtn, opacity: 0.5 }}
                                    onClick={handleSaveProfile}
                                    disabled={!profileName.trim()}
                                >
                                    Save
                                </button>
                            </div>
                        </div>

                        {/* Level Cards */}
                        <div style={{ fontSize: 10, fontWeight: 'bold', color: '#000080', marginBottom: 2 }}>
                            Processing Levels
                        </div>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 4 }}>
                            Use <code style={{ background: '#f0e8a0', padding: '0 3px', border: '1px solid #d0c860' }}>{'{CODE}'}</code> as a placeholder — replaced with the parent item code on generation.
                        </div>

                        {levels.map((lvl, lIdx) => (
                            <LevelCard
                                key={lIdx}
                                lIdx={lIdx}
                                lvl={lvl}
                                onRemoveLevel={removeLevel}
                                onAddPattern={addPatternToLevel}
                                onRemovePattern={removePatternFromLevel}
                                onPatternChange={handlePatternChange}
                            />
                        ))}

                        <button
                            style={{
                                ...xpBtn, width: '100%',
                                borderStyle: 'dashed',
                                borderColor: '#888',
                                fontSize: 10, textAlign: 'center',
                            }}
                            onClick={addLevel}
                        >
                            + Add Next Level
                        </button>
                    </div>

                    {/* Right: preview panel */}
                    <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>

                        <div style={{ ...gbPreview.wrapper, flex: 1, display: 'flex', flexDirection: 'column' }}>
                            <span style={gbPreview.labelStyle}>Structure Preview</span>
                            <div style={{ fontSize: 10, color: '#555', marginBottom: 6 }}>
                                Preview with code: <strong>{DUMMY_CODE}</strong>
                            </div>
                            <BranchingPreview levels={levels} />
                        </div>

                        <div style={{ ...gbTip.wrapper, background: '#fffbe6', borderColor: '#d4b000' }}>
                            <span style={{ ...gbTip.labelStyle, background: '#fffbe6', color: '#806000' }}>💡 Tip</span>
                            <div style={{ fontSize: 10, color: '#555', lineHeight: 1.6 }}>
                                Each level becomes a child BOM node. Branching items at the same level are created as siblings under the parent.
                            </div>
                        </div>
                    </div>
                </div>

                {/* XP Footer */}
                <div style={{
                    background: '#ece9d8',
                    borderTop: '1px solid #aca899',
                    padding: '5px 8px',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: 6,
                    flexShrink: 0,
                }}>
                    <button style={xpBtn} onClick={onClose}>{t('cancel')}</button>
                    <button
                        data-testid="generate-structure-btn"
                        style={xpBtnPrimary}
                        onClick={handleSaveAndApply}
                    >
                        ⚡ Generate Structure
                    </button>
                </div>
            </div>
        </div>
    );
});

BOMAutomatorModal.displayName = 'BOMAutomatorModal';

export default BOMAutomatorModal;
