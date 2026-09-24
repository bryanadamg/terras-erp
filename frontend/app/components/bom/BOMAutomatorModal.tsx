import React, { useState, useEffect, useCallback, memo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import ModalWrapper from '../shared/ModalWrapper';
import { CODE_FONT, xpFont, CHIP_RADIUS, xpInput as xpInputBase, xpBtn as xpBtnBase, BTN_TONES, LegendPanel, XP_BTN } from '../shared/xpTheme';
import { API_BASE } from '../shared/apiBase';


interface AutoBOMProfile {
    id: string;
    name: string;
    levels: string[][];
    inherit_attributes?: boolean[] | null;
}

interface BOMAutomatorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onApply: (levels: string[][], inheritAttributes: boolean[]) => void;
    /** Human-readable list of the root BOM's assigned attribute values, e.g.
     *  "Combo: Navy Stripe". Empty when the root has none — the inherit checkboxes
     *  then have nothing to offer and are disabled. */
    rootAttributeSummary?: string;
}

const DUMMY_CODE = "9698/22";
const DEFAULT_LEVELS = [['WIP CBG {CODE}'], ['WIP CSBG {CODE}'], ['WIP WARPING {CODE}']];
// Attribute inheritance is opt-in per level: a generated child carries no Combo/
// attribute value unless its level is explicitly ticked.
const DEFAULT_INHERIT = DEFAULT_LEVELS.map(() => false);

// Remembers the last profile the user loaded, so it becomes the suggested template on
// the next open. Holds a profile id; a stale id (profile deleted elsewhere) simply
// misses the lookup and falls through to the first profile.
const LAST_PROFILE_KEY = 'bom_automator_last_profile';

// Pads/trims a stored flag list to match the level count. Legacy profiles have none.
const normalizeInherit = (flags: boolean[] | null | undefined, levelCount: number): boolean[] =>
    Array.from({ length: levelCount }, (_, i) => !!flags?.[i]);

// --- XP style helpers ---
const xpBtn: React.CSSProperties = xpBtnBase({ whiteSpace: 'nowrap', minWidth: 60 });

const xpBtnPrimary: React.CSSProperties = xpBtnBase({ ...BTN_TONES.primary, minWidth: 80 });

const xpBtnDanger: React.CSSProperties = xpBtnBase({ ...BTN_TONES.danger, minWidth: 'auto', padding: '1px 6px', fontSize: 10 });

const xpInput: React.CSSProperties = xpInputBase({ borderTopColor: '#5a7fa8', padding: '0 4px', width: '100%' });

const LEVEL_BADGE_COLORS = ['#316ac5', '#2a7a2a', '#b46a00', '#7a2a7a', '#7a4a00'];

// Memoized Sub-component for the Preview
const BranchingPreview = memo(({ levels }: { levels: string[][] }) => (
    <div style={{
        border: '2px inset #aaa',
        background: 'white',
        padding: '6px',
        fontFamily: CODE_FONT,
        fontSize: 10,
        lineHeight: 1.8,
        minHeight: 120,
        overflowY: 'auto',
        flex: 1,
    }}>
        <div style={{ color: '#000080', fontWeight: 'bold' }}><i className="bi bi-box-seam" style={{ marginRight: 4 }} />{DUMMY_CODE}</div>
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
    inherit,
    attributeSummary,
    onRemoveLevel,
    onAddPattern,
    onRemovePattern,
    onPatternChange,
    onInheritChange
}: {
    lIdx: number;
    lvl: string[];
    inherit: boolean;
    attributeSummary: string;
    onRemoveLevel: (idx: number) => void;
    onAddPattern: (idx: number) => void;
    onRemovePattern: (lIdx: number, pIdx: number) => void;
    onPatternChange: (lIdx: number, pIdx: number, val: string) => void;
    onInheritChange: (lIdx: number, value: boolean) => void;
}) => {
    const badgeColor = LEVEL_BADGE_COLORS[lIdx % LEVEL_BADGE_COLORS.length];

    return (
        <LegendPanel title={`Level ${lIdx + 1}`} style={{ marginBottom: 6 }}>
            <div style={{ padding: '0 8px 8px' }}>
            {/* Card header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{
                    background: badgeColor, color: 'white',
                    fontSize: 9, fontWeight: 'bold', padding: '1px 6px',
                    borderRadius: CHIP_RADIUS, fontFamily: xpFont,
                }}>L{lIdx + 1}</span>
                <span style={{ flex: 1, fontSize: 10, color: '#555', fontFamily: xpFont }}>
                    Processing Level
                </span>
                <button className={XP_BTN} style={xpBtnDanger} onClick={() => onRemoveLevel(lIdx)}>
                    X Remove
                </button>
            </div>

            {/* Pattern rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {lvl.map((pattern, pIdx) => (
                    <div key={pIdx} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <span style={{ borderRadius: CHIP_RADIUS,
                            background: '#ddd', border: '1px solid #aaa',
                            padding: '1px 5px', fontSize: 10, minWidth: 18,
                            textAlign: 'center', fontFamily: xpFont,
                        }}>{pIdx + 1}</span>
                        <input
                            type="text"
                            style={{ ...xpInput, flex: 1 }}
                            value={pattern}
                            onChange={(e) => onPatternChange(lIdx, pIdx, e.target.value)}
                            placeholder="e.g. WIP {CODE}"
                        />
                        {lvl.length > 1 && (
                            <button className={XP_BTN} style={{ ...xpBtn, minWidth: 'auto', padding: '0 6px', fontSize: 12 }}
                                onClick={() => onRemovePattern(lIdx, pIdx)}>−</button>
                        )}
                    </div>
                ))}
            </div>

            <button
                style={{
                    background: 'none', border: 'none',
                    color: '#0000aa', fontSize: 10, cursor: 'pointer',
                    padding: '4px 0 0', fontFamily: xpFont,
                    textDecoration: 'underline',
                }}
                onClick={() => onAddPattern(lIdx)}
            >
                + Add branching item
            </button>

            {/* Attribute inheritance is per level and opt-in — see DEFAULT_INHERIT. */}
            <label
                style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    marginTop: 6, paddingTop: 5, borderTop: '1px solid #e0ddd4',
                    fontSize: 10, color: attributeSummary ? '#333' : '#999',
                    cursor: attributeSummary ? 'pointer' : 'default',
                    fontFamily: xpFont,
                }}
                title={attributeSummary
                    ? `Children on this level are created with the root's ${attributeSummary}`
                    : 'The root BOM has no attribute values assigned — nothing to inherit'}
            >
                <input
                    type="checkbox"
                    checked={inherit}
                    disabled={!attributeSummary}
                    onChange={e => onInheritChange(lIdx, e.target.checked)}
                    style={{ margin: 0 }}
                />
                Inherit attributes from root
                {attributeSummary && (
                    <span style={{ color: '#000080', fontWeight: 'bold' }}>({attributeSummary})</span>
                )}
            </label>
            </div>
        </LegendPanel>
    );
});
LevelCard.displayName = 'LevelCard';

const BOMAutomatorModal = memo(({ isOpen, onClose, onApply, rootAttributeSummary = '' }: BOMAutomatorModalProps) => {
    const { t } = useLanguage();
    const [levels, setLevels] = useState<string[][]>(DEFAULT_LEVELS);
    // Parallel to `levels` — index i is level i's "inherit root attributes" flag.
    // Kept in step with every levels mutation below.
    const [inheritAttributes, setInheritAttributes] = useState<boolean[]>(DEFAULT_INHERIT);
    const [profiles, setProfiles] = useState<AutoBOMProfile[]>([]);
    const [profileName, setProfileName] = useState('');
    const [saving, setSaving] = useState(false);
    // Which profile the current levels came from, so the chip can show as active and
    // the choice can be remembered for next open. Null = the built-in DEFAULT_LEVELS.
    const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
    const { authFetch } = useData();

    const applyProfile = useCallback((profile: AutoBOMProfile) => {
        setLevels(profile.levels);
        setInheritAttributes(normalizeInherit(profile.inherit_attributes, profile.levels.length));
        setActiveProfileId(profile.id);
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        // Reset to the built-in template first; if the user has saved profiles, the
        // fetch below replaces it with their preferred one before they can interact.
        setLevels(DEFAULT_LEVELS);
        setInheritAttributes(DEFAULT_INHERIT);
        setActiveProfileId(null);
        authFetch(`${API_BASE}/bom-automator-profiles`)
            .then(r => r.ok ? r.json() : [])
            .then((list: AutoBOMProfile[]) => {
                setProfiles(list);
                if (!list.length) return;
                // Preferred default: the profile used last time, else the first by name
                // (the endpoint orders by name, so this is stable across opens).
                const remembered = list.find(p => p.id === localStorage.getItem(LAST_PROFILE_KEY));
                applyProfile(remembered || list[0]);
            })
            .catch(() => setProfiles([]));
    }, [isOpen, authFetch]);

    const handlePatternChange = useCallback((lIdx: number, pIdx: number, value: string) => {
        setLevels(prev => prev.map((lvl, i) =>
            i === lIdx ? lvl.map((p, j) => j === pIdx ? value : p) : lvl
        ));
    }, []);

    const handleInheritChange = useCallback((lIdx: number, value: boolean) => {
        setInheritAttributes(prev => prev.map((v, i) => i === lIdx ? value : v));
    }, []);

    const addLevel = useCallback(() => {
        setLevels(prev => [...prev, ['']]);
        setInheritAttributes(prev => [...prev, false]);
    }, []);

    const removeLevel = useCallback((index: number) => {
        setLevels(prev => prev.filter((_, i) => i !== index));
        setInheritAttributes(prev => prev.filter((_, i) => i !== index));
    }, []);

    const addPatternToLevel = useCallback((lIdx: number) => {
        setLevels(prev => prev.map((lvl, i) => i === lIdx ? [...lvl, ''] : lvl));
    }, []);

    const removePatternFromLevel = useCallback((lIdx: number, pIdx: number) => {
        setLevels(prev => prev.map((lvl, i) =>
            i === lIdx ? lvl.filter((_, j) => j !== pIdx) : lvl
        ));
    }, []);

    const handleSaveProfile = useCallback(async () => {
        if (!profileName.trim() || saving) return;
        setSaving(true);
        try {
            const res = await authFetch(`${API_BASE}/bom-automator-profiles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: profileName.trim(), levels, inherit_attributes: inheritAttributes }),
            });
            if (res.ok) {
                const newProfile: AutoBOMProfile = await res.json();
                // Keep the list name-ordered to match what the endpoint returns, so the
                // "first profile" fallback is the same before and after a reload.
                setProfiles(prev => [...prev, newProfile].sort((a, b) => a.name.localeCompare(b.name)));
                setProfileName('');
                // Just-saved becomes the active template and the next open's default.
                setActiveProfileId(newProfile.id);
                localStorage.setItem(LAST_PROFILE_KEY, newProfile.id);
            }
        } finally {
            setSaving(false);
        }
    }, [profileName, levels, inheritAttributes, saving, authFetch]);

    const handleLoadProfile = useCallback((profile: AutoBOMProfile) => {
        applyProfile(profile);
        localStorage.setItem(LAST_PROFILE_KEY, profile.id);
    }, [applyProfile]);

    const handleDeleteProfile = useCallback(async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        await authFetch(`${API_BASE}/bom-automator-profiles/${id}`, { method: 'DELETE' });
        setProfiles(prev => prev.filter(p => p.id !== id));
        // Drop the remembered pointer if it named this profile — the levels currently
        // on screen stay put, they just no longer belong to a saved profile.
        if (localStorage.getItem(LAST_PROFILE_KEY) === id) localStorage.removeItem(LAST_PROFILE_KEY);
        setActiveProfileId(prev => prev === id ? null : prev);
    }, [authFetch]);

    const handleSaveAndApply = useCallback(() => {
        // A root with no attribute values has nothing to inherit — send all-false so a
        // stale tick from a loaded profile can't stamp anything onto the children.
        onApply(levels, rootAttributeSummary
            ? normalizeInherit(inheritAttributes, levels.length)
            : levels.map(() => false));
        onClose();
    }, [levels, inheritAttributes, rootAttributeSummary, onApply, onClose]);

    if (!isOpen) return null;

    return (
        <ModalWrapper
            isOpen={isOpen}
            onClose={onClose}
            title="BOM Automator — Configure Structure"
            size="lg"
            variant="primary"
            modeless
            footer={<>
                <button className={XP_BTN} style={xpBtn} onClick={onClose}>{t('cancel')}</button>
                <button
                    className={XP_BTN}
                    data-testid="generate-structure-btn"
                    style={xpBtnPrimary}
                    onClick={handleSaveAndApply}
                >
                    Generate Structure
                </button>
            </>}
        >
            <div
                data-testid="bom-automator-modal"
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    maxHeight: 'calc(var(--app-vh) * 70 / 100)',
                    fontFamily: xpFont,
                    fontSize: 11,
                }}
            >
                {/* Body: two columns */}
                <div style={{
                    display: 'flex',
                    gap: 8,
                    overflow: 'hidden',
                    flex: 1,
                    minHeight: 0,
                }}>
                    {/* Left: config + levels (scrollable) */}
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, paddingRight: 4, paddingTop: 10 }}>

                        {/* Saved Profiles */}
                        <LegendPanel title="Saved Profiles" style={{ marginBottom: 6 }}>
                            <div style={{ padding: '0 8px 8px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6, minHeight: 20 }}>
                                {profiles.length === 0 && (
                                    <span style={{ fontSize: 10, color: '#888', fontStyle: 'italic' }}>No saved configurations — showing the built-in template.</span>
                                )}
                                {profiles.map(p => (
                                    <div key={p.id} style={{ display: 'flex', border: '1px solid #aaa' }}>
                                        {/* The loaded profile reads as pressed — on open that is the
                                            remembered/default one, so it is clear where the levels came from. */}
                                        <button
                                            className={XP_BTN}
                                            style={{
                                                ...xpBtn, minWidth: 'auto', borderRight: 'none', fontSize: 10, padding: '1px 8px',
                                                ...(p.id === activeProfileId ? {
                                                    background: 'linear-gradient(to bottom, #b4d0f8, #7aacf0)',
                                                    borderTopColor: '#c8e0ff', borderLeftColor: '#c8e0ff',
                                                    fontWeight: 'bold', color: '#00007a',
                                                } : {}),
                                            }}
                                            onClick={() => handleLoadProfile(p)}
                                        >
                                            {p.name}
                                        </button>
                                        <button
                                            className={XP_BTN}
                                            style={{ ...xpBtnDanger, borderLeft: 'none', borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                                            onClick={(e) => handleDeleteProfile(e, p.id)}
                                        >X</button>
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
                                    className={XP_BTN}
                                    style={profileName.trim() && !saving ? xpBtnPrimary : { ...xpBtn, opacity: 0.5 }}
                                    onClick={handleSaveProfile}
                                    disabled={!profileName.trim() || saving}
                                >
                                    {saving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                            </div>
                        </LegendPanel>

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
                                inherit={!!inheritAttributes[lIdx]}
                                attributeSummary={rootAttributeSummary}
                                onRemoveLevel={removeLevel}
                                onAddPattern={addPatternToLevel}
                                onRemovePattern={removePatternFromLevel}
                                onPatternChange={handlePatternChange}
                                onInheritChange={handleInheritChange}
                            />
                        ))}

                        <button
                            className={XP_BTN}
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
                    <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10 }}>

                        <LegendPanel title="Structure Preview" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                            <div style={{ padding: '0 8px 8px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                <div style={{ fontSize: 10, color: '#555', marginBottom: 6 }}>
                                    Preview with code: <strong>{DUMMY_CODE}</strong>
                                </div>
                                <BranchingPreview levels={levels} />
                            </div>
                        </LegendPanel>

                        <LegendPanel
                            title="Tip"
                            style={{ background: '#fffbe6', borderColor: '#d4b000' }}
                            legendStyle={{ background: '#fffbe6', color: '#806000', borderColor: '#d4b000' }}
                        >
                            <div style={{ padding: '0 8px 8px', fontSize: 10, color: '#555', lineHeight: 1.6 }}>
                                Each level becomes a child BOM node. Branching items at the same level are created as siblings under the parent.
                                <div style={{ marginTop: 6 }}>
                                    Children are generated with <strong>no attribute values</strong> unless you tick
                                    &quot;Inherit attributes from root&quot; on that level.
                                </div>
                            </div>
                        </LegendPanel>
                    </div>
                </div>
            </div>
        </ModalWrapper>
    );
});

BOMAutomatorModal.displayName = 'BOMAutomatorModal';

export default BOMAutomatorModal;
