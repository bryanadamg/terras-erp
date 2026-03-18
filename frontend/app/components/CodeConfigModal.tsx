import { useState, useEffect } from 'react';

export interface CodeConfig {
    prefix: string;
    suffix: string;
    separator: string;
    includeItemCode: boolean;
    includeVariant: boolean;
    variantAttributeNames?: string[]; // Array of selected attribute names
    includeYear: boolean;
    includeMonth: boolean;
}

interface CodeConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    type: 'BOM' | 'WO' | 'PO' | 'SO' | 'SAMPLE' | 'ITEM';
    onSave: (config: CodeConfig) => void;
    initialConfig?: CodeConfig;
    attributes: any[];
}

export default function CodeConfigModal({ isOpen, onClose, type, onSave, initialConfig, attributes }: CodeConfigModalProps) {
    const getDefaultPrefix = () => {
        switch(type) {
            case 'BOM': return 'BOM';
            case 'WO': return 'WO';
            case 'PO': return 'PO';
            case 'SO': return 'SO';
            case 'SAMPLE': return 'SMP';
            case 'ITEM': return 'ITM';
            default: return 'CODE';
        }
    };

    const [config, setConfig] = useState<CodeConfig>({
        prefix: getDefaultPrefix(),
        suffix: '',
        separator: '-',
        includeItemCode: type === 'BOM' || type === 'WO',
        includeVariant: false,
        variantAttributeNames: [],
        includeYear: type === 'PO' || type === 'SAMPLE',
        includeMonth: false,
    });

    const [currentStyle, setCurrentStyle] = useState('default');

    useEffect(() => {
        const savedStyle = localStorage.getItem('ui_style');
        if (savedStyle) setCurrentStyle(savedStyle);

        if (isOpen && initialConfig) {
            // Migration for old config (single string to array)
            const safeConfig = { ...initialConfig };
            if (typeof (safeConfig as any).variantAttributeName === 'string') {
                safeConfig.variantAttributeNames = [(safeConfig as any).variantAttributeName].filter(Boolean);
                delete (safeConfig as any).variantAttributeName;
            } else if (!safeConfig.variantAttributeNames) {
                safeConfig.variantAttributeNames = [];
            }
            setConfig(safeConfig);
        }
    }, [isOpen, initialConfig]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave(config);
        onClose();
    };

    const toggleAttribute = (attrName: string) => {
        const current = config.variantAttributeNames || [];
        if (current.includes(attrName)) {
            setConfig({ ...config, variantAttributeNames: current.filter(n => n !== attrName) });
        } else {
            setConfig({ ...config, variantAttributeNames: [...current, attrName] });
        }
    };

    // Preview Logic
    const getPreview = () => {
        const parts = [];
        if (config.prefix) parts.push(config.prefix);
        if (config.includeItemCode) parts.push('ITEM001');

        if (config.includeVariant) {
            if (config.variantAttributeNames && config.variantAttributeNames.length > 0) {
                // Find sample values for each selected attribute
                config.variantAttributeNames.forEach(attrName => {
                    const attr = attributes.find(a => a.name === attrName);
                    const val = attr && attr.values.length > 0 ? attr.values[0].value.toUpperCase() : 'VAR';
                    parts.push(val);
                });
            } else {
                parts.push('VARIANT');
            }
        }

        if (config.includeYear) parts.push(new Date().getFullYear());
        if (config.includeMonth) parts.push(String(new Date().getMonth() + 1).padStart(2, '0'));
        if (config.suffix) parts.push(config.suffix);
        parts.push('001'); // Counter example
        return parts.join(config.separator);
    };

    const getTypeName = () => {
        switch(type) {
            case 'BOM': return 'BOM';
            case 'WO': return 'Work Order';
            case 'PO': return 'Purchase Order';
            case 'SO': return 'Sales Order';
            case 'SAMPLE': return 'Sample Request';
            case 'ITEM': return 'Item';
            default: return 'Document';
        }
    };

    return (
        <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 20100, position: 'fixed', inset: 0 }}>
            <div className={`modal-dialog modal-dialog-centered ui-style-${currentStyle}`}>
                <div className="modal-content shadow">
                    <div className="modal-header bg-light">
                        <h5 className="modal-title">
                            <i className="bi bi-gear-fill me-2 text-primary"></i>
                            Configure {getTypeName()} Code
                        </h5>
                        <button type="button" className="btn-close" onClick={onClose}></button>
                    </div>
                    <div className="modal-body">
                        <p className="text-muted small mb-4">
                            Customize how the system auto-generates unique codes for your {getTypeName().toLowerCase()}.
                        </p>

                        <div className="row g-3 mb-3">
                            <div className="col-md-4">
                                <label className="form-label small fw-bold">Prefix</label>
                                <input
                                    className="form-control form-control-sm"
                                    value={config.prefix}
                                    onChange={e => setConfig({...config, prefix: e.target.value.toUpperCase()})}
                                    placeholder="e.g. BOM"
                                />
                            </div>
                            <div className="col-md-4">
                                <label className="form-label small fw-bold">Separator</label>
                                <select
                                    className="form-select form-select-sm"
                                    value={config.separator}
                                    onChange={e => setConfig({...config, separator: e.target.value})}
                                >
                                    <option value="-">Dash (-)</option>
                                    <option value="_">Underscore (_)</option>
                                    <option value="/">Slash (/)</option>
                                    <option value="">None</option>
                                </select>
                            </div>
                            <div className="col-md-4">
                                <label className="form-label small fw-bold">Suffix</label>
                                <input
                                    className="form-control form-control-sm"
                                    value={config.suffix}
                                    onChange={e => setConfig({...config, suffix: e.target.value.toUpperCase()})}
                                    placeholder="Optional"
                                />
                            </div>
                        </div>

                        <div className="mb-3">
                            <label className="form-label small fw-bold">Dynamic Variables</label>
                            <div className="d-flex flex-wrap gap-2">
                                <div className="form-check form-check-inline border rounded p-2 pe-3 bg-light">
                                    <input
                                        className="form-check-input ms-1"
                                        type="checkbox"
                                        checked={config.includeItemCode}
                                        onChange={e => setConfig({...config, includeItemCode: e.target.checked})}
                                        id="chkItem"
                                    />
                                    <label className="form-check-label small ms-1" htmlFor="chkItem">Item Code</label>
                                </div>
                                <div className={`form-check form-check-inline border rounded p-2 pe-3 bg-light ${config.includeVariant ? 'border-primary' : ''}`}>
                                    <input
                                        className="form-check-input ms-1"
                                        type="checkbox"
                                        checked={config.includeVariant}
                                        onChange={e => setConfig({...config, includeVariant: e.target.checked})}
                                        id="chkVar"
                                    />
                                    <label className="form-check-label small ms-1" htmlFor="chkVar">Variant Attributes</label>
                                </div>
                                <div className="form-check form-check-inline border rounded p-2 pe-3 bg-light">
                                    <input
                                        className="form-check-input ms-1"
                                        type="checkbox"
                                        checked={config.includeYear}
                                        onChange={e => setConfig({...config, includeYear: e.target.checked})}
                                        id="chkYear"
                                    />
                                    <label className="form-check-label small ms-1" htmlFor="chkYear">Year (YYYY)</label>
                                </div>
                                <div className="form-check form-check-inline border rounded p-2 pe-3 bg-light">
                                    <input
                                        className="form-check-input ms-1"
                                        type="checkbox"
                                        checked={config.includeMonth}
                                        onChange={e => setConfig({...config, includeMonth: e.target.checked})}
                                        id="chkMonth"
                                    />
                                    <label className="form-check-label small ms-1" htmlFor="chkMonth">Month (MM)</label>
                                </div>
                            </div>
                        </div>

                        {config.includeVariant && (
                            <div className="mb-3 fade-in p-3 bg-light rounded border border-primary border-opacity-25 config-attributes-section">
                                <label className="form-label small fw-bold text-primary mb-2">Select Attributes for Code Generation</label>
                                <div className="d-flex flex-wrap gap-2" style={{maxHeight: '150px', overflowY: 'auto'}}>
                                    {attributes.map(attr => (
                                        <div key={attr.id} className="form-check">
                                            <input
                                                className="form-check-input"
                                                type="checkbox"
                                                id={`attr-${attr.id}`}
                                                checked={config.variantAttributeNames?.includes(attr.name)}
                                                onChange={() => toggleAttribute(attr.name)}
                                            />
                                            <label className="form-check-label small" htmlFor={`attr-${attr.id}`}>
                                                {attr.name}
                                            </label>
                                        </div>
                                    ))}
                                    {attributes.length === 0 && <span className="text-muted small fst-italic">No attributes defined</span>}
                                </div>
                                <div className="form-text small mt-2">Selected attributes will be appended in order.</div>
                            </div>
                        )}

                        <div className="alert alert-primary d-flex align-items-center mb-0">
                            <i className="bi bi-eye me-2 fs-5"></i>
                            <div>
                                <div className="small text-uppercase fw-bold opacity-75">Preview</div>
                                <div className="font-monospace fw-bold fs-5">{getPreview()}</div>
                            </div>
                        </div>
                    </div>
                    <div className="modal-footer bg-light">
                        <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
                        <button type="button" className="btn btn-sm btn-primary px-4" onClick={handleSave}>Save Configuration</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
