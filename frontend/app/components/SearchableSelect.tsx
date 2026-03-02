import { useState, useRef, useEffect, useMemo } from 'react';

interface Option {
    value: string;
    label: string;
    subLabel?: string;
    category?: string; // Added for filtering
}

interface SearchableSelectProps {
    options: Option[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    required?: boolean;
    categories?: string[]; // Optional list of categories to filter by
    testId?: string;
}

export default function SearchableSelect({ options, value, onChange, placeholder, disabled, className, required, categories, testId }: SearchableSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeCategory, setActiveCategory] = useState<string | null>(null);
    const [showCategoryMenu, setShowCategoryMenu] = useState(false);
    
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const selectedOption = options.find(o => o.value === value);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setShowCategoryMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!isOpen) {
            setSearchTerm('');
            // Optional: Reset category on close? keeping it for now allows "sticky" filtering
        } else if (inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const filteredOptions = useMemo(() => {
        let result = options;
        if (activeCategory) {
            result = result.filter(o => o.category === activeCategory);
        }
        return result.filter(option => 
            option.label.toLowerCase().includes(searchTerm.toLowerCase()) || 
            (option.subLabel && option.subLabel.toLowerCase().includes(searchTerm.toLowerCase()))
        ).slice(0, 50);
    }, [options, searchTerm, activeCategory]);

    const handleSelect = (optionValue: string) => {
        onChange(optionValue);
        setIsOpen(false);
        setSearchTerm('');
    };

    return (
        <div className={`position-relative ${className || ''}`} ref={containerRef} data-testid={testId}>
            <div 
                className={`form-control d-flex align-items-center justify-content-between ${disabled ? 'bg-light' : 'bg-white'} ${isOpen ? 'border-primary ring-2' : ''}`}
                style={{ cursor: disabled ? 'not-allowed' : 'pointer', minHeight: '38px', paddingRight: '30px' }}
                onClick={() => !disabled && setIsOpen(!isOpen)}
                data-testid={testId ? `${testId}-trigger` : undefined}
            >
                <div className="text-truncate w-100">
                    {selectedOption ? (
                        <span>
                            {selectedOption.label} 
                            {selectedOption.subLabel && <small className="text-muted ms-2">({selectedOption.subLabel})</small>}
                        </span>
                    ) : (
                        <span className="text-muted">{placeholder || 'Select...'}</span>
                    )}
                </div>
                <i className="bi bi-chevron-down small text-muted position-absolute end-0 me-3"></i>
            </div>

            {/* Hidden Input for HTML5 Validation */}
            <input 
                tabIndex={-1}
                className="position-absolute opacity-0" 
                style={{bottom: 0, left: 0, width: '100%', height: 0}}
                value={value} 
                onChange={() => {}}
                required={required} 
            />

            {isOpen && (
                <div className="position-absolute top-100 start-0 w-100 bg-white border rounded shadow-sm mt-1 z-3" style={{maxHeight: '300px', overflowY: 'auto'}} data-testid={testId ? `${testId}-dropdown` : undefined}>
                    {/* Search & Filter Header */}
                    <div className="p-2 border-bottom sticky-top bg-white d-flex gap-2 align-items-center">
                        {/* Filter Button (Only if categories exist) */}
                        {categories && categories.length > 0 && (
                            <div className="position-relative">
                                <button 
                                    className={`btn btn-sm ${activeCategory ? 'btn-primary' : 'btn-outline-secondary'} px-2`}
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setShowCategoryMenu(!showCategoryMenu); }}
                                    title="Filter by Category"
                                >
                                    <i className="bi bi-funnel-fill"></i>
                                </button>
                                {/* Inline Category Menu */}
                                {showCategoryMenu && (
                                    <div className="position-absolute top-100 start-0 mt-1 bg-white border rounded shadow p-1" style={{width: '200px', zIndex: 1050}}>
                                        <button 
                                            className={`btn btn-sm w-100 text-start border-0 ${!activeCategory ? 'bg-light fw-bold' : ''}`}
                                            onClick={(e) => { e.stopPropagation(); setActiveCategory(null); setShowCategoryMenu(false); }}
                                        >
                                            All Categories
                                        </button>
                                        <hr className="my-1"/>
                                        {categories.map(cat => (
                                            <button 
                                                key={cat}
                                                className={`btn btn-sm w-100 text-start border-0 ${activeCategory === cat ? 'bg-primary text-white' : ''}`}
                                                onClick={(e) => { e.stopPropagation(); setActiveCategory(cat); setShowCategoryMenu(false); }}
                                            >
                                                {cat}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Search Input with Active Filter Badge */}
                        <div className="input-group input-group-sm">
                            {activeCategory && (
                                <span className="input-group-text bg-primary text-white border-primary px-2" style={{fontSize: '0.75rem'}}>
                                    {activeCategory}
                                    <i 
                                        className="bi bi-x ms-2 cursor-pointer" 
                                        style={{cursor: 'pointer'}} 
                                        onClick={(e) => { e.stopPropagation(); setActiveCategory(null); }}
                                    ></i>
                                </span>
                            )}
                            <input
                                ref={inputRef}
                                type="text"
                                className="form-control"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                data-testid={testId ? `${testId}-search` : undefined}
                            />
                        </div>
                    </div>

                    {filteredOptions.length > 0 ? (
                        filteredOptions.map((option) => (
                            <div 
                                key={option.value}
                                className={`px-3 py-2 cursor-pointer ${option.value === value ? 'bg-primary text-white' : 'hover-bg-light text-dark'}`}
                                onClick={() => handleSelect(option.value)}
                                style={{cursor: 'pointer'}}
                                data-testid={testId ? `${testId}-option-${option.value}` : undefined}
                            >
                                <div className="fw-medium">{option.label}</div>
                                <div className="d-flex justify-content-between small">
                                    {option.subLabel && <span className={`${option.value === value ? 'text-white-50' : 'text-muted'}`}>{option.subLabel}</span>}
                                    {option.category && <span className={`badge ${option.value === value ? 'bg-white text-primary' : 'bg-secondary bg-opacity-10 text-secondary'}`}>{option.category}</span>}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="p-3 text-center text-muted small">
                            {activeCategory ? `No ${activeCategory} items found` : 'No matches found'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
