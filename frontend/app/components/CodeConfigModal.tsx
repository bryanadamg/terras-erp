import { useState, useEffect, Fragment } from 'react';

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

// ─── Pipeline Segment Types ───────────────────────────────────────────────────

export type Segment =
  | { type: 'prefix';    value: string }
  | { type: 'item' }
  | { type: 'attribute'; name: string }
  | { type: 'year' }
  | { type: 'month' }
  | { type: 'suffix';    value: string }
  | { type: 'counter' }

export const CHIP_COLORS: Record<string, string> = {
  prefix:    '#2563eb',
  item:      '#059669',
  attribute: '#7c3aed',
  year:      '#b45309',
  month:     '#be185d',
  suffix:    '#0e7490',
  counter:   '#475569',
};

// XP classic dark text colors per chip type (dark on light gradient)
export const CHIP_COLORS_CLASSIC_TEXT: Record<string, string> = {
  prefix:    '#00327a',
  item:      '#003a00',
  attribute: '#320070',
  year:      '#4a2e00',
  month:     '#5c0028',
  suffix:    '#003344',
  counter:   '#333333',
};

export function normalizeCounter(segs: Segment[]): Segment[] {
  const without = segs.filter(s => s.type !== 'counter');
  return [...without, { type: 'counter' }];
}

export function getDefaultSegments(type: string): Segment[] {
  const defaultPrefixes: Record<string, string> = {
    BOM: 'BOM', WO: 'WO', PO: 'PO', SO: 'SO', SAMPLE: 'SMP', ITEM: 'ITM',
  };
  const prefix = defaultPrefixes[type] ?? 'CODE';
  const segs: Segment[] = [{ type: 'prefix', value: prefix }];
  if (type === 'BOM' || type === 'WO') segs.push({ type: 'item' });
  if (type === 'PO' || type === 'SAMPLE') segs.push({ type: 'year' });
  segs.push({ type: 'counter' });
  return segs;
}

export function configToSegments(
  cfg: CodeConfig,
  attributes: { id: any; name: string; values: { id: any; value: string }[] }[]
): Segment[] {
  const safe: any = { ...cfg };
  if (typeof safe.variantAttributeName === 'string') {
    safe.variantAttributeNames = [safe.variantAttributeName].filter(Boolean);
    delete safe.variantAttributeName;
  }
  if (!safe.variantAttributeNames) safe.variantAttributeNames = [];

  const segs: Segment[] = [];
  if (safe.prefix)          segs.push({ type: 'prefix', value: safe.prefix });
  if (safe.includeItemCode)  segs.push({ type: 'item' });

  if (safe.includeVariant && safe.variantAttributeNames.length > 0) {
    const seen = new Set<string>();
    for (const name of safe.variantAttributeNames) {
      if (seen.has(name)) continue;
      if (!attributes.find(a => a.name === name)) continue;
      seen.add(name);
      segs.push({ type: 'attribute', name });
    }
  }

  if (safe.includeYear)    segs.push({ type: 'year' });
  if (safe.includeMonth)   segs.push({ type: 'month' });
  if (safe.suffix)         segs.push({ type: 'suffix', value: safe.suffix });
  segs.push({ type: 'counter' });
  return segs;
}

export function segmentsToConfig(segs: Segment[], separator: string): CodeConfig {
  const normalized = normalizeCounter(segs);
  return {
    prefix:                (normalized.find(s => s.type === 'prefix') as any)?.value ?? '',
    suffix:                (normalized.find(s => s.type === 'suffix') as any)?.value ?? '',
    separator,
    includeItemCode:       normalized.some(s => s.type === 'item'),
    includeVariant:        normalized.some(s => s.type === 'attribute'),
    variantAttributeNames: normalized.filter(s => s.type === 'attribute').map((s: any) => s.name),
    includeYear:           normalized.some(s => s.type === 'year'),
    includeMonth:          normalized.some(s => s.type === 'month'),
  };
}

export function getSegmentPreviewValue(
  seg: Segment,
  attributes: { id: any; name: string; values: { id: any; value: string }[] }[]
): string {
  switch (seg.type) {
    case 'prefix':    return seg.value || 'PREFIX';
    case 'item':      return 'ITEM001';
    case 'attribute': {
      const attr = attributes.find(a => a.name === (seg as any).name);
      return attr?.values[0]?.value.toUpperCase() ?? 'VAR';
    }
    case 'year':    return String(new Date().getFullYear());
    case 'month':   return String(new Date().getMonth() + 1).padStart(2, '0');
    case 'suffix':  return (seg as any).value || 'SUFFIX';
    case 'counter': return '001';
  }
}

export function getPreview(
  segs: Segment[],
  separator: string,
  attributes: { id: any; name: string; values: { id: any; value: string }[] }[]
): string {
  const normalized = normalizeCounter(segs);
  return normalized.map(s => getSegmentPreviewValue(s, attributes)).join(separator);
}

export function getAvailablePalette(
  segs: Segment[],
  attributes: { id: any; name: string; values: { id: any; value: string }[] }[]
): Segment[] {
  const palette: Segment[] = [];
  if (!segs.some(s => s.type === 'prefix'))
    palette.push({ type: 'prefix', value: '' });
  if (!segs.some(s => s.type === 'suffix'))
    palette.push({ type: 'suffix', value: '' });
  const statics: Segment['type'][] = ['item', 'year', 'month'];
  for (const t of statics) {
    if (!segs.some(s => s.type === t)) palette.push({ type: t } as Segment);
  }
  for (const attr of attributes) {
    if (!segs.some(s => s.type === 'attribute' && (s as any).name === attr.name))
      palette.push({ type: 'attribute', name: attr.name });
  }
  return palette;
}

export function removeSegment(segs: Segment[], index: number): Segment[] {
  return segs.filter((_, i) => i !== index);
}

export function insertAtGap(
  segs: Segment[],
  seg: Segment,
  gapIndex: number,
  sourceIndex?: number
): Segment[] {
  const without = sourceIndex !== undefined ? removeSegment(segs, sourceIndex) : segs;
  const insertAt = sourceIndex !== undefined && sourceIndex < gapIndex
    ? gapIndex - 1
    : gapIndex;
  const result = [...without];
  result.splice(insertAt, 0, seg);
  return normalizeCounter(result);
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
        const parts: (string | number)[] = [];
        if (config.prefix) parts.push(config.prefix);
        if (config.includeItemCode) parts.push('ITEM001');

        if (config.includeVariant) {
            if (config.variantAttributeNames && config.variantAttributeNames.length > 0) {
                // Find sample values for each selected attribute
                config.variantAttributeNames.forEach(attrName => {
                    const attr = attributes.find((a: any) => a.name === attrName);
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

    const getPreviewSegments = () => {
        const segments: { label: string; value: string; color: string }[] = [];
        if (config.prefix) segments.push({ label: 'Prefix', value: config.prefix, color: '#2563eb' });
        if (config.includeItemCode) segments.push({ label: 'Item', value: 'ITEM001', color: '#059669' });
        if (config.includeVariant) {
            if (config.variantAttributeNames && config.variantAttributeNames.length > 0) {
                config.variantAttributeNames.forEach(attrName => {
                    const attr = attributes.find((a: any) => a.name === attrName);
                    const val = attr && attr.values.length > 0 ? attr.values[0].value.toUpperCase() : 'VAR';
                    segments.push({ label: attrName, value: val, color: '#7c3aed' });
                });
            } else {
                segments.push({ label: 'Variant', value: 'VARIANT', color: '#7c3aed' });
            }
        }
        if (config.includeYear) segments.push({ label: 'Year', value: String(new Date().getFullYear()), color: '#d97706' });
        if (config.includeMonth) segments.push({ label: 'Month', value: String(new Date().getMonth() + 1).padStart(2, '0'), color: '#dc2626' });
        if (config.suffix) segments.push({ label: 'Suffix', value: config.suffix, color: '#0891b2' });
        segments.push({ label: '#', value: '001', color: '#64748b' });
        return segments;
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

    const classic = currentStyle === 'classic';

    // ─── Classic (XP) Mode ────────────────────────────────────────────────────
    if (classic) {
        return (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 20100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{
                    width: '480px',
                    border: '2px solid',
                    borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                    boxShadow: '3px 3px 8px rgba(0,0,0,0.4)',
                    background: '#ece9d8',
                    borderRadius: 0,
                    fontFamily: 'Tahoma, Arial, sans-serif',
                    fontSize: '11px',
                }}>
                    {/* XP Title Bar */}
                    <div style={{
                        background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)',
                        color: '#fff',
                        padding: '4px 6px 4px 8px',
                        fontWeight: 'bold',
                        fontSize: '12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        userSelect: 'none',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
                        borderBottom: '1px solid #003080',
                    }}>
                        <span>
                            <i className="bi bi-gear-fill" style={{ marginRight: '6px' }}></i>
                            Configure {getTypeName()} Code
                        </span>
                        <button
                            onClick={onClose}
                            style={{
                                background: 'linear-gradient(to bottom, #d9a0a0, #b03030)',
                                border: '1px solid',
                                borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                                color: '#fff',
                                fontWeight: 'bold',
                                fontSize: '10px',
                                width: '18px',
                                height: '18px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                lineHeight: 1,
                                padding: 0,
                                flexShrink: 0,
                            }}
                        >✕</button>
                    </div>

                    {/* Body */}
                    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <p style={{ color: '#444', fontSize: '10px', margin: 0 }}>
                            Customize how the system auto-generates unique codes for your {getTypeName().toLowerCase()}.
                        </p>

                        {/* Fields row */}
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '2px', fontSize: '10px' }}>Prefix</div>
                                <input
                                    value={config.prefix}
                                    onChange={e => setConfig({...config, prefix: e.target.value.toUpperCase()})}
                                    placeholder={`e.g. ${getDefaultPrefix()}`}
                                    style={{
                                        width: '100%',
                                        fontFamily: "'Courier New', monospace",
                                        fontSize: '11px',
                                        border: '1px solid',
                                        borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                                        boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)',
                                        padding: '2px 5px',
                                        background: '#fff',
                                        boxSizing: 'border-box',
                                        letterSpacing: '1px',
                                        fontWeight: 'bold',
                                    }}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '2px', fontSize: '10px' }}>Separator</div>
                                <select
                                    value={config.separator}
                                    onChange={e => setConfig({...config, separator: e.target.value})}
                                    style={{
                                        width: '100%',
                                        fontFamily: 'Tahoma, Arial, sans-serif',
                                        fontSize: '11px',
                                        border: '1px solid',
                                        borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                                        boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)',
                                        padding: '2px 4px',
                                        background: '#fff',
                                    }}
                                >
                                    <option value="-">Dash (-)</option>
                                    <option value="_">Underscore (_)</option>
                                    <option value="/">Slash (/)</option>
                                    <option value="">None</option>
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '2px', fontSize: '10px' }}>Suffix</div>
                                <input
                                    value={config.suffix}
                                    onChange={e => setConfig({...config, suffix: e.target.value.toUpperCase()})}
                                    placeholder="Optional"
                                    style={{
                                        width: '100%',
                                        fontFamily: "'Courier New', monospace",
                                        fontSize: '11px',
                                        border: '1px solid',
                                        borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                                        boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)',
                                        padding: '2px 5px',
                                        background: '#fff',
                                        boxSizing: 'border-box',
                                        letterSpacing: '1px',
                                        fontWeight: 'bold',
                                    }}
                                />
                            </div>
                        </div>

                        {/* Dynamic Variables */}
                        <div>
                            <div style={{ fontWeight: 'bold', marginBottom: '3px', fontSize: '10px' }}>Dynamic Variables</div>
                            <div style={{
                                background: '#fff',
                                border: '1px solid',
                                borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                                boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)',
                                padding: '5px 8px',
                                display: 'flex',
                                flexWrap: 'wrap' as const,
                                gap: '10px',
                            }}>
                                {[
                                    { id: 'chkItem', label: 'Item Code', key: 'includeItemCode' as const },
                                    { id: 'chkVar', label: 'Variant Attributes', key: 'includeVariant' as const },
                                    { id: 'chkYear', label: 'Year (YYYY)', key: 'includeYear' as const },
                                    { id: 'chkMonth', label: 'Month (MM)', key: 'includeMonth' as const },
                                ].map(({ id, label, key }) => (
                                    <label key={id} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', userSelect: 'none' as const }}>
                                        <input
                                            type="checkbox"
                                            id={id}
                                            checked={config[key]}
                                            onChange={e => setConfig({...config, [key]: e.target.checked})}
                                        />
                                        <span>{label}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Attributes (if variant selected) */}
                        {config.includeVariant && (
                            <div>
                                <div style={{ fontWeight: 'bold', marginBottom: '3px', fontSize: '10px', color: '#0058e6' }}>
                                    <i className="bi bi-tags-fill" style={{ marginRight: '4px' }}></i>
                                    Select Attributes for Code Generation
                                </div>
                                <div style={{
                                    background: '#fff',
                                    border: '1px solid',
                                    borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                                    boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)',
                                    padding: '5px 8px',
                                    maxHeight: '90px',
                                    overflowY: 'auto' as const,
                                    display: 'flex',
                                    flexWrap: 'wrap' as const,
                                    gap: '10px',
                                }}>
                                    {attributes.map((attr: any) => (
                                        <label key={attr.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', userSelect: 'none' as const }}>
                                            <input
                                                type="checkbox"
                                                id={`attr-${attr.id}`}
                                                checked={config.variantAttributeNames?.includes(attr.name)}
                                                onChange={() => toggleAttribute(attr.name)}
                                            />
                                            <span>{attr.name}</span>
                                        </label>
                                    ))}
                                    {attributes.length === 0 && (
                                        <span style={{ color: '#888', fontStyle: 'italic' }}>No attributes defined</span>
                                    )}
                                </div>
                                <div style={{ color: '#666', fontSize: '10px', marginTop: '2px' }}>Selected attributes will be appended in order.</div>
                            </div>
                        )}

                        {/* Preview — XP inset box */}
                        <div style={{
                            background: '#fff',
                            border: '2px solid',
                            borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                            boxShadow: 'inset 2px 2px 0 rgba(0,0,0,0.1)',
                            padding: '8px 10px',
                        }}>
                            <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
                                <i className="bi bi-eye" style={{ marginRight: '5px' }}></i>Preview
                            </div>
                            <div style={{
                                fontFamily: "'Courier New', monospace",
                                fontSize: '15px',
                                fontWeight: 'bold',
                                color: '#000',
                                letterSpacing: '0.5px',
                            }}>
                                {getPreview()}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div style={{
                        borderTop: '1px solid #b0aaa0',
                        padding: '8px 12px',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: '6px',
                        background: '#ece9d8',
                    }}>
                        <button
                            onClick={onClose}
                            style={{
                                fontFamily: 'Tahoma, Arial, sans-serif',
                                fontSize: '11px',
                                padding: '4px 18px',
                                cursor: 'pointer',
                                background: 'linear-gradient(to bottom, #fff, #d4d0c8)',
                                border: '1px solid',
                                borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                                color: '#000',
                            }}
                        >Cancel</button>
                        <button
                            onClick={handleSave}
                            style={{
                                fontFamily: 'Tahoma, Arial, sans-serif',
                                fontSize: '11px',
                                padding: '4px 18px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                background: 'linear-gradient(to bottom, #6699cc, #3366aa)',
                                border: '1px solid',
                                borderColor: '#99bbee #224477 #224477 #99bbee',
                                color: '#fff',
                            }}
                        >Save Configuration</button>
                    </div>
                </div>
            </div>
        );
    }

    // ─── Default (Modern) Mode ────────────────────────────────────────────────
    const segments = getPreviewSegments();

    const dynamicVars = [
        { id: 'chkItem', label: 'Item Code', key: 'includeItemCode' as const, color: '#059669', icon: 'bi-box' },
        { id: 'chkVar',  label: 'Variant',   key: 'includeVariant'  as const, color: '#7c3aed', icon: 'bi-tags' },
        { id: 'chkYear', label: 'Year',       key: 'includeYear'     as const, color: '#d97706', icon: 'bi-calendar' },
        { id: 'chkMonth',label: 'Month',      key: 'includeMonth'    as const, color: '#dc2626', icon: 'bi-calendar2' },
    ];

    return (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 20100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className={`ui-style-${currentStyle}`} style={{
                width: '520px',
                maxWidth: '95vw',
                background: '#fff',
                borderRadius: '12px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.2), 0 4px 16px rgba(0,0,0,0.08)',
                overflow: 'hidden',
            }}>
                {/* Header */}
                <div style={{
                    background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a9e 100%)',
                    padding: '14px 18px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                            width: '30px',
                            height: '30px',
                            borderRadius: '7px',
                            background: 'rgba(255,255,255,0.15)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}>
                            <i className="bi bi-gear-fill" style={{ color: '#fff', fontSize: '13px' }}></i>
                        </div>
                        <div>
                            <div style={{ color: '#fff', fontWeight: 600, fontSize: '13px', lineHeight: 1.2 }}>Configure {getTypeName()} Code</div>
                            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '11px', marginTop: '1px' }}>Auto-generation rules</div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'rgba(255,255,255,0.1)',
                            border: 'none',
                            borderRadius: '6px',
                            color: 'rgba(255,255,255,0.75)',
                            cursor: 'pointer',
                            padding: '2px 8px 4px',
                            fontSize: '18px',
                            lineHeight: 1,
                        }}
                    >×</button>
                </div>

                {/* Body */}
                <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

                    {/* — Code Structure ————————————————————————————————— */}
                    <div>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.9px', marginBottom: '8px' }}>
                            Code Structure
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Prefix</label>
                                <input
                                    className="form-control form-control-sm"
                                    value={config.prefix}
                                    onChange={e => setConfig({...config, prefix: e.target.value.toUpperCase()})}
                                    placeholder={`e.g. ${getDefaultPrefix()}`}
                                    style={{ fontFamily: "'Courier New', monospace", fontWeight: 700, letterSpacing: '1.5px', fontSize: '12px' }}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Separator</label>
                                <select
                                    className="form-select form-select-sm"
                                    value={config.separator}
                                    onChange={e => setConfig({...config, separator: e.target.value})}
                                >
                                    <option value="-">Dash  ( - )</option>
                                    <option value="_">Underscore  ( _ )</option>
                                    <option value="/">Slash  ( / )</option>
                                    <option value="">None</option>
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Suffix</label>
                                <input
                                    className="form-control form-control-sm"
                                    value={config.suffix}
                                    onChange={e => setConfig({...config, suffix: e.target.value.toUpperCase()})}
                                    placeholder="Optional"
                                    style={{ fontFamily: "'Courier New', monospace", fontWeight: 700, letterSpacing: '1.5px', fontSize: '12px' }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* — Dynamic Variables (pill toggles) ————————————————— */}
                    <div>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.9px', marginBottom: '8px' }}>
                            Dynamic Variables
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '7px' }}>
                            {dynamicVars.map(({ id, label, key, color, icon }) => {
                                const active = config[key];
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setConfig({...config, [key]: !active})}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '5px',
                                            padding: '5px 13px',
                                            borderRadius: '20px',
                                            cursor: 'pointer',
                                            border: `1.5px solid ${active ? color : '#e5e7eb'}`,
                                            background: active ? `${color}18` : '#f9fafb',
                                            color: active ? color : '#6b7280',
                                            fontSize: '12px',
                                            fontWeight: active ? 600 : 400,
                                            transition: 'all 0.13s',
                                        }}
                                    >
                                        <i className={`bi ${icon}`} style={{ fontSize: '11px' }}></i>
                                        {label}
                                        {active && (
                                            <i className="bi bi-check-circle-fill" style={{ fontSize: '10px', marginLeft: '1px' }}></i>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* — Attributes panel (shown when Variant is active) ——— */}
                    {config.includeVariant && (
                        <div style={{
                            background: '#f5f3ff',
                            border: '1.5px solid #e9d5ff',
                            borderRadius: '8px',
                            padding: '11px 13px',
                        }}>
                            <div style={{ fontSize: '11px', fontWeight: 600, color: '#7c3aed', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <i className="bi bi-tags-fill"></i>
                                Select Attributes for Code Generation
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '6px', maxHeight: '110px', overflowY: 'auto' as const }}>
                                {attributes.map((attr: any) => {
                                    const selected = config.variantAttributeNames?.includes(attr.name);
                                    return (
                                        <button
                                            key={attr.id}
                                            type="button"
                                            onClick={() => toggleAttribute(attr.name)}
                                            style={{
                                                padding: '3px 11px',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '11px',
                                                border: `1.5px solid ${selected ? '#7c3aed' : '#c4b5fd'}`,
                                                background: selected ? '#7c3aed' : '#fff',
                                                color: selected ? '#fff' : '#6d28d9',
                                                fontWeight: selected ? 600 : 400,
                                                transition: 'all 0.12s',
                                            }}
                                        >
                                            {selected && <i className="bi bi-check me-1" style={{ fontSize: '10px' }}></i>}
                                            {attr.name}
                                        </button>
                                    );
                                })}
                                {attributes.length === 0 && (
                                    <span style={{ color: '#9ca3af', fontSize: '12px', fontStyle: 'italic' }}>No attributes defined</span>
                                )}
                            </div>
                            <div style={{ fontSize: '10px', color: '#a78bfa', marginTop: '7px' }}>Selected attributes will be appended in order.</div>
                        </div>
                    )}

                    {/* — Live Preview ————————————————————————————————————— */}
                    <div style={{
                        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                        border: '1.5px solid #e2e8f0',
                        borderRadius: '10px',
                        padding: '13px 15px',
                    }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.9px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <i className="bi bi-eye" style={{ fontSize: '11px' }}></i>
                            Live Preview
                        </div>

                        {/* Segment chips */}
                        <div style={{ display: 'flex', flexWrap: 'wrap' as const, alignItems: 'flex-end', gap: '3px', marginBottom: '10px' }}>
                            {segments.map((seg, i) => (
                                <Fragment key={i}>
                                    {i > 0 && config.separator && (
                                        <span style={{
                                            color: '#94a3b8',
                                            fontSize: '14px',
                                            fontFamily: "'Courier New', monospace",
                                            fontWeight: 700,
                                            padding: '0 1px',
                                            alignSelf: 'center',
                                            marginBottom: '14px',
                                        }}>
                                            {config.separator}
                                        </span>
                                    )}
                                    <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '2px' }}>
                                        <div style={{
                                            background: seg.color,
                                            color: '#fff',
                                            fontFamily: "'Courier New', monospace",
                                            fontSize: '12px',
                                            fontWeight: 700,
                                            padding: '4px 9px',
                                            borderRadius: '5px',
                                            letterSpacing: '0.5px',
                                            whiteSpace: 'nowrap' as const,
                                        }}>
                                            {seg.value}
                                        </div>
                                        <div style={{ fontSize: '9px', color: seg.color, fontWeight: 600, letterSpacing: '0.3px', opacity: 0.85 }}>
                                            {seg.label}
                                        </div>
                                    </div>
                                </Fragment>
                            ))}
                        </div>

                        {/* Full code string on dark background */}
                        <div style={{
                            background: '#1e293b',
                            borderRadius: '7px',
                            padding: '9px 13px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}>
                            <i className="bi bi-code-slash" style={{ color: '#64748b', fontSize: '12px', flexShrink: 0 }}></i>
                            <span style={{
                                fontFamily: "'Courier New', monospace",
                                fontSize: '14px',
                                fontWeight: 700,
                                color: '#e2e8f0',
                                letterSpacing: '1.2px',
                            }}>
                                {getPreview()}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '11px 20px',
                    borderTop: '1px solid #f1f5f9',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '8px',
                    background: '#fafafa',
                }}>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-sm btn-primary px-4" onClick={handleSave}>Save Configuration</button>
                </div>
            </div>
        </div>
    );
}
