import { useState, useRef, useEffect, useMemo } from 'react';

interface Option {
    value: string;
    label: string;
    subLabel?: string;
    category?: string;
}

interface SearchableSelectProps {
    options: Option[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    required?: boolean;
    categories?: string[];
    testId?: string;
    onSearch?: (term: string) => void;
    size?: 'sm' | 'md';
}

const font = 'Tahoma, "Segoe UI", sans-serif';

export default function SearchableSelect({
    options, value, onChange, placeholder, disabled, className,
    required, categories, testId, onSearch, size = 'md',
}: SearchableSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeCategory, setActiveCategory] = useState<string | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const selectedOption = options.find(o => o.value === value);
    const h = size === 'sm' ? 18 : 20;

    useEffect(() => {
        const onMouseDown = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, []);

    useEffect(() => {
        if (!isOpen) {
            setSearchTerm('');
        } else {
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [isOpen]);

    const filteredOptions = useMemo(() => {
        let result = activeCategory ? options.filter(o => o.category === activeCategory) : options;
        const q = searchTerm.toLowerCase();
        return result.filter(o =>
            o.label.toLowerCase().includes(q) ||
            (o.subLabel && o.subLabel.toLowerCase().includes(q))
        ).slice(0, 50);
    }, [options, searchTerm, activeCategory]);

    const handleSelect = (val: string) => {
        onChange(val);
        setIsOpen(false);
        setSearchTerm('');
    };

    return (
        <div
            ref={containerRef}
            data-testid={testId}
            className={className}
            style={{ position: 'relative', width: '100%' }}
        >
            {/* Trigger — looks like a native XP select */}
            <div
                onClick={() => !disabled && setIsOpen(!isOpen)}
                data-testid={testId ? `${testId}-trigger` : undefined}
                style={{
                    position: 'relative',
                    display: 'flex', alignItems: 'center',
                    height: h,
                    fontFamily: font, fontSize: 11,
                    border: '1px solid #7f9db9',
                    borderTopColor: '#5a7fa8', borderLeftColor: '#5a7fa8',
                    background: disabled ? '#f0efe6' : 'white',
                    paddingLeft: 4, paddingRight: 18,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    userSelect: 'none',
                    boxSizing: 'border-box',
                    outline: isOpen ? '1px dotted #316ac5' : 'none',
                    outlineOffset: -2,
                    overflow: 'hidden',
                    color: selectedOption ? '#000' : '#888',
                }}
            >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedOption ? selectedOption.label : (placeholder || 'Select...')}
                </span>
                {selectedOption?.subLabel && (
                    <span style={{
                        fontFamily: '"Courier New", monospace', fontSize: 9, color: '#555',
                        marginLeft: 5, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80,
                    }}>
                        {selectedOption.subLabel}
                    </span>
                )}
                {/* XP-style dropdown arrow button */}
                <div style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0, width: 17,
                    background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)',
                    borderLeft: '1px solid #7f9db9',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 7, color: '#444', flexShrink: 0,
                    pointerEvents: 'none',
                }}>
                    ▼
                </div>
            </div>

            {/* Hidden input for HTML5 required validation */}
            <input
                tabIndex={-1}
                style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 0, opacity: 0, pointerEvents: 'none' }}
                value={value}
                onChange={() => {}}
                required={required}
            />

            {/* Dropdown panel */}
            {isOpen && (
                <div
                    data-testid={testId ? `${testId}-dropdown` : undefined}
                    style={{
                        position: 'absolute',
                        top: '100%', left: 0,
                        minWidth: '100%', width: 'max-content', maxWidth: 340,
                        background: 'white',
                        border: '1px solid #7f9db9',
                        borderTop: 'none',
                        boxShadow: '2px 2px 4px rgba(0,0,0,0.28)',
                        zIndex: 9999,
                        display: 'flex', flexDirection: 'column',
                        maxHeight: 280,
                    }}
                >
                    {/* Search row */}
                    <div style={{
                        padding: '3px 4px',
                        borderBottom: '1px solid #c0bdb5',
                        background: '#f5f4ee',
                        display: 'flex', gap: 4, alignItems: 'center',
                        flexShrink: 0,
                    }}>
                        {categories && categories.length > 0 && (
                            <select
                                style={{
                                    fontFamily: font, fontSize: 10,
                                    border: '1px solid #7f9db9', height: 18,
                                    padding: '0 2px', background: 'white', flexShrink: 0,
                                }}
                                value={activeCategory || ''}
                                onChange={e => setActiveCategory(e.target.value || null)}
                            >
                                <option value="">All</option>
                                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                            </select>
                        )}
                        <input
                            ref={inputRef}
                            type="text"
                            placeholder="Search..."
                            value={searchTerm}
                            onChange={e => {
                                setSearchTerm(e.target.value);
                                if (onSearch) onSearch(e.target.value);
                            }}
                            onClick={e => e.stopPropagation()}
                            data-testid={testId ? `${testId}-search` : undefined}
                            style={{
                                fontFamily: font, fontSize: 11,
                                border: '1px solid #7f9db9',
                                borderTopColor: '#5a7fa8',
                                background: 'white',
                                height: 18,
                                padding: '0 4px',
                                outline: 'none',
                                flex: 1,
                                minWidth: 0,
                            }}
                        />
                    </div>

                    {/* Options */}
                    <div style={{ overflowY: 'auto', flex: 1 }}>
                        {filteredOptions.length === 0 ? (
                            <div style={{ padding: '5px 8px', fontSize: 10, color: '#888', fontStyle: 'italic', fontFamily: font }}>
                                No matches found
                            </div>
                        ) : (
                            filteredOptions.map(option => {
                                const selected = option.value === value;
                                return (
                                    <div
                                        key={option.value}
                                        onClick={() => handleSelect(option.value)}
                                        data-testid={testId ? `${testId}-option-${option.value}` : undefined}
                                        style={{
                                            display: 'flex', alignItems: 'baseline', gap: 6,
                                            padding: '2px 6px',
                                            cursor: 'pointer',
                                            background: selected ? '#316ac5' : 'white',
                                            color: selected ? 'white' : '#000',
                                            borderBottom: '1px solid #f0efe6',
                                            fontFamily: font, fontSize: 11,
                                            minHeight: 20,
                                        }}
                                        onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = '#d0e4f8'; }}
                                        onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = 'white'; }}
                                    >
                                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {option.label}
                                        </span>
                                        {option.subLabel && (
                                            <span style={{
                                                fontFamily: '"Courier New", monospace', fontSize: 9,
                                                color: selected ? 'rgba(255,255,255,0.75)' : '#555',
                                                flexShrink: 0,
                                            }}>
                                                {option.subLabel}
                                            </span>
                                        )}
                                        {option.category && (
                                            <span style={{
                                                fontSize: 9,
                                                background: selected ? 'rgba(255,255,255,0.2)' : '#e8e4d8',
                                                color: selected ? '#fff' : '#555',
                                                padding: '0 4px', flexShrink: 0,
                                            }}>
                                                {option.category}
                                            </span>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
