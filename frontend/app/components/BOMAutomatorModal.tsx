import React, { useState, useEffect, useCallback, memo } from 'react';
import { useLanguage } from '../context/LanguageContext';

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

// Memoized Sub-component for the Preview
const BranchingPreview = memo(({ levels }: { levels: string[][] }) => (
    <div className="bg-light rounded p-3 border">
        <h6 className="extra-small fw-bold text-uppercase text-muted mb-3 letter-spacing-1">
            <i className="bi bi-diagram-3 me-2"></i>Branching Preview
        </h6>
        <div className="font-monospace small overflow-auto py-2" style={{ maxHeight: '200px' }}>
            <div className="d-flex align-items-center mb-2">
                <div className="bg-primary bg-opacity-10 text-primary px-2 py-1 rounded border border-primary border-opacity-25 fw-bold">
                    {DUMMY_CODE} <span className="opacity-50 fw-normal ms-1">(Root)</span>
                </div>
            </div>
            {levels.map((lvl, lIdx) => (
                <div key={lIdx} style={{ paddingLeft: `${(lIdx + 1) * 24}px` }} className="border-start border-2 border-primary border-opacity-10 my-1">
                    {lvl.map((p, pIdx) => (
                        <div key={pIdx} className="d-flex align-items-center gap-2 mb-1">
                            <span className="text-primary opacity-25">├──</span>
                            <span className="bg-white text-dark px-2 py-1 border rounded" style={{ fontSize: '0.7rem', minWidth: '120px' }}>
                                {p.replace('{CODE}', DUMMY_CODE) || '...'}
                            </span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    </div>
));

BranchingPreview.displayName = 'BranchingPreview';

// Memoized Level Card with no-hover to prevent scroll lag
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
}) => (
    <div className="position-relative">
        {lIdx > 0 && (
            <div className="position-absolute start-50 top-0 translate-middle-x" style={{ height: '24px', width: '2px', backgroundColor: '#dee2e6', marginTop: '-24px' }}></div>
        )}
        
        <div className="card no-hover border-primary border-opacity-10 overflow-hidden shadow-none border">
            <div className="card-header bg-primary bg-opacity-5 py-2 px-3 d-flex justify-content-between align-items-center border-0">
                <div className="d-flex align-items-center">
                    <span className="badge bg-primary text-white me-2">L{lIdx + 1}</span>
                    <span className="small fw-bold text-primary-emphasis">Processing Level</span>
                </div>
                <button 
                    className="btn btn-sm btn-link text-danger p-0 opacity-75" 
                    onClick={() => onRemoveLevel(lIdx)} 
                >
                    <i className="bi bi-trash"></i>
                </button>
            </div>
            <div className="card-body p-3 bg-white">
                <div className="d-flex flex-column gap-2">
                    {lvl.map((pattern, pIdx) => (
                        <div key={pIdx} className="input-group input-group-sm">
                            <span className="input-group-text bg-light border-end-0 text-muted" style={{ width: '35px' }}>{pIdx + 1}</span>
                            <input 
                                type="text" 
                                className="form-control border-primary border-opacity-10" 
                                value={pattern} 
                                onChange={(e) => onPatternChange(lIdx, pIdx, e.target.value)}
                                placeholder="Pattern e.g. WIP {CODE}"
                            />
                            {lvl.length > 1 && (
                                <button className="btn btn-outline-danger border-primary border-opacity-10" onClick={() => onRemovePattern(lIdx, pIdx)}>
                                    <i className="bi bi-dash-lg"></i>
                                </button>
                            )}
                        </div>
                    ))}
                    <button className="btn btn-sm btn-link text-primary text-decoration-none p-0 mt-1 d-flex align-items-center small fw-bold" onClick={() => onAddPattern(lIdx)}>
                        <i className="bi bi-plus-circle-fill me-2"></i> Add branching item
                    </button>
                </div>
            </div>
        </div>
    </div>
));

LevelCard.displayName = 'LevelCard';

const BOMAutomatorModal = memo(({ isOpen, onClose, onApply }: BOMAutomatorModalProps) => {
    const { t } = useLanguage();
    const [levels, setLevels] = useState<string[][]>(DEFAULT_LEVELS);
    const [profiles, setProfiles] = useState<AutoBOMProfile[]>([]);
    const [profileName, setProfileName] = useState('');
    const [currentStyle, setCurrentStyle] = useState('default');

    useEffect(() => {
        if (!isOpen) return;

        const savedProfiles = localStorage.getItem('bom_auto_profiles');
        if (savedProfiles) {
            try {
                setProfiles(JSON.parse(savedProfiles));
            } catch (e) {
                console.error("Invalid profiles in localstorage");
            }
        }
        
        const lastLevels = localStorage.getItem('bom_auto_levels_active');
        if (lastLevels) {
            try {
                setLevels(JSON.parse(lastLevels));
            } catch (e) {}
        }

        const savedStyle = localStorage.getItem('ui_style');
        if (savedStyle) setCurrentStyle(savedStyle);
    }, [isOpen]);

    const handlePatternChange = useCallback((lIdx: number, pIdx: number, value: string) => {
        setLevels(prev => prev.map((lvl, i) => 
            i === lIdx ? lvl.map((p, j) => j === pIdx ? value : p) : lvl
        ));
    }, []);

    const addLevel = useCallback(() => {
        setLevels(prev => [...prev, ['']]);
    }, []);

    const removeLevel = useCallback((index: number) => {
        setLevels(prev => prev.filter((_, i) => i !== index));
    }, []);

    const addPatternToLevel = useCallback((lIdx: number) => {
        setLevels(prev => prev.map((lvl, i) => 
            i === lIdx ? [...lvl, ''] : lvl
        ));
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

    return (
        <div className="modal d-block" data-testid="bom-automator-modal" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 20100, position: 'fixed', inset: 0 }}>
            <div className={`modal-dialog modal-lg modal-dialog-centered ui-style-${currentStyle}`}>
                <div className="modal-content border-0 shadow-lg overflow-hidden" style={{ borderRadius: currentStyle === 'classic' ? '0' : '8px' }}>
                    <div className="modal-header bg-dark text-white border-0 py-2">
                        <h5 className="modal-title d-flex align-items-center small fw-bold">
                            <i className="bi bi-magic me-2"></i>
                            BOM AUTOMATION WIZARD
                        </h5>
                        <button type="button" className="btn-close btn-close-white px-2" onClick={onClose}></button>
                    </div>
                    
                    <div className="modal-body p-0" style={{ maxHeight: '70vh', overflowY: 'auto', backgroundColor: '#fff' }}>
                        
                        {/* Profile Management Section */}
                        <div className="p-3 bg-light border-bottom">
                            <div className="row g-2 align-items-center">
                                <div className="col-md-7">
                                    <div className="d-flex flex-wrap gap-1">
                                        {profiles.map(p => (
                                            <div key={p.id} className="btn-group btn-group-sm bg-white border rounded shadow-none">
                                                <button className="btn btn-outline-secondary border-0 py-0" style={{fontSize: '11px'}} onClick={() => handleLoadProfile(p)}>
                                                    {p.name}
                                                </button>
                                                <button className="btn btn-outline-danger border-0 py-0 px-1" style={{fontSize: '11px'}} onClick={(e) => handleDeleteProfile(e, p.id)}>
                                                    <i className="bi bi-x"></i>
                                                </button>
                                            </div>
                                        ))}
                                        {profiles.length === 0 && <span className="text-muted extra-small italic">No saved configurations.</span>}
                                    </div>
                                </div>
                                <div className="col-md-5">
                                    <div className="input-group input-group-sm">
                                        <input 
                                            type="text" 
                                            className="form-control" 
                                            placeholder="New Profile Name..." 
                                            value={profileName}
                                            onChange={e => setProfileName(e.target.value)}
                                        />
                                        <button className="btn btn-primary" type="button" onClick={handleSaveProfile} disabled={!profileName.trim()}>
                                            Save
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-3 bg-white border-bottom">
                            <p className="text-muted mb-3 extra-small">
                                Configure naming patterns per processing level. Use <code>{'{CODE}'}</code> as a placeholder.
                            </p>
                            <BranchingPreview levels={levels} />
                        </div>

                        <div className="p-3">
                            <div className="d-flex flex-column gap-3">
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
                                
                                <div className="text-center py-1">
                                    <button className="btn btn-sm btn-outline-primary border-dashed px-4 bg-primary bg-opacity-5 rounded-pill" onClick={addLevel} style={{ borderStyle: 'dashed' }}>
                                        <i className="bi bi-plus-lg me-2"></i>Add Next Level
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="modal-footer bg-light border-top p-2 px-3">
                        <button type="button" className="btn btn-sm btn-link text-muted text-decoration-none" onClick={onClose}>{t('cancel')}</button>
                        <button data-testid="generate-structure-btn" type="button" className="btn btn-sm btn-primary px-4 fw-bold shadow-sm" onClick={handleSaveAndApply}>
                            <i className="bi bi-lightning-charge-fill me-1"></i>GENERATE STRUCTURE
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

BOMAutomatorModal.displayName = 'BOMAutomatorModal';

export default BOMAutomatorModal;
