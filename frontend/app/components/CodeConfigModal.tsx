import { useState, useEffect, useRef, Fragment } from 'react';
import { useTheme } from '../context/ThemeContext';

export interface CodeConfig {
    prefix: string;
    suffix: string;
    separator: string;
    includeItemCode: boolean;
    includeVariant: boolean;
    variantAttributeNames?: string[]; // Array of selected attribute names
    includeYear: boolean;
    includeMonth: boolean;
    segmentOrder?: string[]; // Ordered list of non-counter segment types
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

  const order: string[] = safe.segmentOrder ?? ['prefix', 'item', 'attribute', 'year', 'month', 'suffix'];
  const segs: Segment[] = [];
  let attrNameIndex = 0;

  for (const type of order) {
    switch (type) {
      case 'prefix':
        if (safe.prefix) segs.push({ type: 'prefix', value: safe.prefix });
        break;
      case 'item':
        if (safe.includeItemCode) segs.push({ type: 'item' });
        break;
      case 'attribute': {
        if (safe.includeVariant) {
          const name = safe.variantAttributeNames[attrNameIndex++];
          if (name && attributes.find((a: any) => a.name === name)) {
            segs.push({ type: 'attribute', name });
          }
        }
        break;
      }
      case 'year':
        if (safe.includeYear) segs.push({ type: 'year' });
        break;
      case 'month':
        if (safe.includeMonth) segs.push({ type: 'month' });
        break;
      case 'suffix':
        if (safe.suffix) segs.push({ type: 'suffix', value: safe.suffix });
        break;
    }
  }

  segs.push({ type: 'counter' });
  return segs;
}

export function segmentsToConfig(segs: Segment[], separator: string): CodeConfig {
  const normalized = normalizeCounter(segs);
  return {
    prefix:                normalized.find((s): s is Extract<Segment, { type: 'prefix' }> => s.type === 'prefix')?.value ?? '',
    suffix:                normalized.find((s): s is Extract<Segment, { type: 'suffix' }> => s.type === 'suffix')?.value ?? '',
    separator,
    includeItemCode:       normalized.some(s => s.type === 'item'),
    includeVariant:        normalized.some(s => s.type === 'attribute'),
    variantAttributeNames: (normalized.filter((s): s is Extract<Segment, { type: 'attribute' }> => s.type === 'attribute')).map(s => s.name),
    includeYear:           normalized.some(s => s.type === 'year'),
    includeMonth:          normalized.some(s => s.type === 'month'),
    segmentOrder:          normalized.filter(s => s.type !== 'counter').map(s => s.type),
  };
}

export function buildCodeParts(
  config: CodeConfig,
  itemCode = '',
  variantNames: string[] = []
): string[] {
  const now = new Date();
  const order = config.segmentOrder ?? ['prefix', 'item', 'attribute', 'year', 'month', 'suffix'];
  const parts: string[] = [];
  let attrIndex = 0;
  for (const type of order) {
    switch (type) {
      case 'prefix':    if (config.prefix) parts.push(config.prefix); break;
      case 'item':      if (config.includeItemCode && itemCode) parts.push(itemCode); break;
      case 'attribute': { const v = variantNames[attrIndex++]; if (config.includeVariant && v) parts.push(v); break; }
      case 'year':      if (config.includeYear) parts.push(String(now.getFullYear())); break;
      case 'month':     if (config.includeMonth) parts.push(String(now.getMonth() + 1).padStart(2, '0')); break;
      case 'suffix':    if (config.suffix) parts.push(config.suffix); break;
    }
  }
  return parts;
}

export function getSegmentPreviewValue(
  seg: Segment,
  attributes: { id: any; name: string; values: { id: any; value: string }[] }[]
): string {
  switch (seg.type) {
    case 'prefix':    return seg.value || 'PREFIX';
    case 'item':      return 'ITEM001';
    case 'attribute': {
      const attr = attributes.find(a => a.name === seg.name);
      return attr?.values[0]?.value.toUpperCase() ?? 'VAR';
    }
    case 'year':    return String(new Date().getFullYear());
    case 'month':   return String(new Date().getMonth() + 1).padStart(2, '0');
    case 'suffix':  return seg.value || 'SUFFIX';
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

function getTypeName(type: string): string {
  const names: Record<string, string> = {
    BOM: 'BOM', WO: 'Work Order', PO: 'Purchase Order',
    SO: 'Sales Order', SAMPLE: 'Sample Request', ITEM: 'Item',
  };
  return names[type] ?? 'Document';
}

function SegmentChipDefault({
  seg, index, activeGap, separator,
  onDragStart, onDragEnd,
  onGapDragOver, onGapDragLeave, onGapDrop,
  onRemove, onPrefixChange, onSuffixChange,
}: {
  seg: Segment; index: number; activeGap: number | null; separator: string;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onGapDragOver: (e: React.DragEvent, g: number) => void;
  onGapDragLeave: () => void;
  onGapDrop: (e: React.DragEvent, g: number) => void;
  onRemove: () => void;
  onPrefixChange: (v: string) => void;
  onSuffixChange: (v: string) => void;
}) {
  const color = CHIP_COLORS[seg.type] ?? '#64748b';
  const isCounter = seg.type === 'counter';
  const isPrefix = seg.type === 'prefix';
  const isSuffix = seg.type === 'suffix';
  const isEditable = isPrefix || isSuffix;

  return (
    <Fragment>
      {/* Gap indicator before this chip — doubles as separator char display */}
      <div
        onDragOver={e => onGapDragOver(e, index)}
        onDragLeave={onGapDragLeave}
        onDrop={e => onGapDrop(e, index)}
        style={{
          width: activeGap === index ? '16px' : '4px',
          minWidth: activeGap === index ? '16px' : '4px',
          height: '36px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '12px', fontWeight: 700, color: '#4b5563',
          background: activeGap === index ? `${color}22` : 'transparent',
          borderLeft: activeGap === index ? `2px solid ${color}` : 'none',
          transition: 'width 0.1s, background 0.1s',
          cursor: 'crosshair', userSelect: 'none', flexShrink: 0,
        }}
      >
        {activeGap !== index && index > 0 ? separator : ''}
      </div>

      {/* Chip */}
      <div
        draggable={!isCounter}
        onDragStart={isCounter ? undefined : onDragStart}
        onDragEnd={isCounter ? undefined : onDragEnd}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
          cursor: isCounter ? 'default' : 'grab',
          opacity: isCounter ? 0.75 : 1,
          flexShrink: 0,
        }}
      >
        <div style={{
          background: color,
          color: '#fff',
          borderRadius: '5px',
          padding: isEditable ? '3px 6px' : '4px 10px',
          display: 'flex', alignItems: 'center', gap: '5px',
          minHeight: '28px',
        }}>
          {!isCounter && (
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '11px', cursor: 'grab' }}>⠿</span>
          )}

          {isPrefix && (
            <input
              value={(seg as Extract<Segment, { type: 'prefix' }>).value}
              onChange={e => onPrefixChange(e.target.value)}
              placeholder="PREFIX"
              style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,0.4)',
                borderRadius: '3px', color: '#fff', fontFamily: "'Courier New', monospace",
                fontSize: '12px', fontWeight: 700, letterSpacing: '1px',
                width: Math.max(50, (seg as Extract<Segment, { type: 'prefix' }>).value.length * 9 + 12) + 'px',
                padding: '1px 4px', outline: 'none',
              }}
            />
          )}
          {isSuffix && (
            <input
              value={(seg as Extract<Segment, { type: 'suffix' }>).value}
              onChange={e => onSuffixChange(e.target.value)}
              placeholder="SUFFIX"
              style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,0.4)',
                borderRadius: '3px', color: '#fff', fontFamily: "'Courier New', monospace",
                fontSize: '12px', fontWeight: 700, letterSpacing: '1px',
                width: Math.max(50, (seg as Extract<Segment, { type: 'suffix' }>).value.length * 9 + 12) + 'px',
                padding: '1px 4px', outline: 'none',
              }}
            />
          )}
          {!isEditable && (
            <span style={{
              fontFamily: "'Courier New', monospace", fontSize: '12px', fontWeight: 700,
              letterSpacing: '0.5px', color: '#fff',
            }}>
              {seg.type === 'item' ? 'ITEM001'
               : seg.type === 'attribute' ? (seg as Extract<Segment, { type: 'attribute' }>).name.toUpperCase()
               : seg.type === 'year' ? new Date().getFullYear()
               : seg.type === 'month' ? String(new Date().getMonth() + 1).padStart(2, '0')
               : '001'}
            </span>
          )}

          {!isCounter && (
            <button
              type="button"
              onClick={onRemove}
              style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)',
                cursor: 'pointer', padding: '0 0 0 3px', fontSize: '13px', lineHeight: 1,
              }}
            >×</button>
          )}
        </div>
        {/* Label below chip */}
        <div style={{
          fontSize: '9px', fontWeight: 600,
          color: isCounter ? '#64748b' : color,
          letterSpacing: '0.3px',
        }}>
          {seg.type === 'attribute' ? (seg as Extract<Segment, { type: 'attribute' }>).name
           : seg.type === 'counter' ? 'counter'
           : seg.type}
        </div>
      </div>
    </Fragment>
  );
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
  const [segments, setSegments] = useState<Segment[]>(() => getDefaultSegments(type));
  const [separator, setSeparator] = useState('-');
  const [activeGap, setActiveGap] = useState<number | null>(null);
  const { uiStyle: currentStyle } = useTheme();
  const dragRef = useRef<{
    sourceZone: 'track' | 'palette';
    index: number;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (initialConfig) {
      setSegments(configToSegments(initialConfig, attributes));
      setSeparator(initialConfig.separator ?? '-');
    } else {
      setSegments(getDefaultSegments(type));
      setSeparator('-');
    }
  }, [isOpen, initialConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(segmentsToConfig(segments, separator));
    onClose();
  };

  // ─── DnD Handlers ─────────────────────────────────────────────────────────

  const handleTrackDragStart = (e: React.DragEvent, index: number) => {
    dragRef.current = { sourceZone: 'track', index };
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePaletteDragStart = (e: React.DragEvent, palIndex: number) => {
    dragRef.current = { sourceZone: 'palette', index: palIndex };
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    dragRef.current = null;
    setActiveGap(null);
  };

  const handleGapDragOver = (e: React.DragEvent, gapIndex: number) => {
    e.preventDefault();
    setActiveGap(gapIndex);
  };

  const handleGapDragLeave = () => setActiveGap(null);

  const handleGapDrop = (e: React.DragEvent, gapIndex: number) => {
    e.preventDefault();
    setActiveGap(null);
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.sourceZone === 'track') {
      setSegments(prev => insertAtGap(prev, prev[drag.index], gapIndex, drag.index));
    } else {
      const palette = getAvailablePalette(segments, attributes);
      const seg = palette[drag.index];
      if (seg) setSegments(prev => insertAtGap(normalizeCounter(prev), seg, gapIndex));
    }
    dragRef.current = null;
  };

  const handlePaletteDragOver = (e: React.DragEvent) => e.preventDefault();

  const handlePaletteDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setActiveGap(null);
    const drag = dragRef.current;
    if (drag?.sourceZone === 'track') {
      setSegments(prev => normalizeCounter(removeSegment(prev, drag.index)));
    }
    dragRef.current = null;
  };

  const handlePaletteChipClick = (seg: Segment) => {
    setSegments(prev => {
      const norm = normalizeCounter(prev);
      return insertAtGap(norm, seg, norm.length - 1);
    });
  };

  const handleRemoveFromTrack = (index: number) => {
    setSegments(prev => normalizeCounter(removeSegment(prev, index)));
  };

  const handlePrefixChange = (value: string) => {
    setSegments(prev => prev.map(s => s.type === 'prefix' ? { ...s, value: value.toUpperCase() } : s));
  };

  const handleSuffixChange = (value: string) => {
    setSegments(prev => prev.map(s => s.type === 'suffix' ? { ...s, value: value.toUpperCase() } : s));
  };

  const classic = currentStyle === 'classic';
  const palette = getAvailablePalette(segments, attributes);

  if (classic) {
    const xpGap = (gapIndex: number) => (
      <div
        key={`xp-gap-${gapIndex}`}
        onDragOver={e => handleGapDragOver(e, gapIndex)}
        onDragLeave={handleGapDragLeave}
        onDrop={e => handleGapDrop(e, gapIndex)}
        style={{
          width: activeGap === gapIndex ? '16px' : '4px',
          minWidth: activeGap === gapIndex ? '16px' : '4px',
          height: '32px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '11px', fontWeight: 700, color: '#555555',
          background: activeGap === gapIndex ? '#cce0ff' : 'transparent',
          borderLeft: activeGap === gapIndex ? '2px solid #0058e6' : 'none',
          transition: 'width 0.1s',
          cursor: 'crosshair', userSelect: 'none', flexShrink: 0,
          fontFamily: 'Tahoma, Arial, sans-serif',
        }}
      >
        {activeGap !== gapIndex && gapIndex > 0 ? separator : ''}
      </div>
    );

    const xpChip = (seg: Segment, i: number) => {
      const isCounter = seg.type === 'counter';
      const isPrefix = seg.type === 'prefix';
      const isSuffix = seg.type === 'suffix';
      const textColor = CHIP_COLORS_CLASSIC_TEXT[seg.type] ?? '#333';
      const label = seg.type === 'attribute'
        ? (seg as Extract<Segment, { type: 'attribute' }>).name
        : seg.type === 'prefix' ? 'prefix'
        : seg.type === 'suffix' ? 'suffix'
        : seg.type === 'item' ? 'item code'
        : seg.type;
      return (
        <Fragment key={`xp-chip-${seg.type}-${seg.type === 'attribute' ? (seg as Extract<Segment, { type: 'attribute' }>).name : seg.type === 'prefix' || seg.type === 'suffix' ? (seg as Extract<Segment, { type: 'prefix' }>).value : ''}-${i}`}>
          {xpGap(i)}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', flexShrink: 0 }}>
            <div
              draggable={!isCounter}
              onDragStart={isCounter ? undefined : e => handleTrackDragStart(e, i)}
              onDragEnd={isCounter ? undefined : handleDragEnd}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                background: isCounter
                  ? 'linear-gradient(to bottom, #e0e0e0, #c0c0c0)'
                  : 'linear-gradient(to bottom, #ffffff, #d4d0c8)',
                border: '1px solid',
                borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                padding: isPrefix || isSuffix ? '2px 5px' : '2px 8px',
                fontFamily: "'Courier New', monospace",
                fontSize: '11px', fontWeight: 'bold',
                color: isCounter ? '#333' : textColor,
                cursor: isCounter ? 'default' : 'grab',
                opacity: isCounter ? 0.85 : 1,
                userSelect: 'none', minHeight: '22px',
              }}
            >
              {!isCounter && (
                <span style={{ color: '#666', fontSize: '9px' }}>⠿</span>
              )}
              {isPrefix && (
                <input
                  value={(seg as Extract<Segment, { type: 'prefix' }>).value}
                  onChange={e => handlePrefixChange(e.target.value)}
                  placeholder="PREFIX"
                  style={{
                    fontFamily: "'Courier New', monospace", fontSize: '11px', fontWeight: 'bold',
                    color: textColor, background: '#fff',
                    border: '1px solid', borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                    boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)',
                    padding: '1px 3px',
                    width: Math.max(40, (seg as Extract<Segment, { type: 'prefix' }>).value.length * 7 + 10) + 'px',
                    outline: 'none',
                  }}
                />
              )}
              {isSuffix && (
                <input
                  value={(seg as Extract<Segment, { type: 'suffix' }>).value}
                  onChange={e => handleSuffixChange(e.target.value)}
                  placeholder="SUFFIX"
                  style={{
                    fontFamily: "'Courier New', monospace", fontSize: '11px', fontWeight: 'bold',
                    color: textColor, background: '#fff',
                    border: '1px solid', borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                    boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)',
                    padding: '1px 3px',
                    width: Math.max(40, (seg as Extract<Segment, { type: 'suffix' }>).value.length * 7 + 10) + 'px',
                    outline: 'none',
                  }}
                />
              )}
              {!isPrefix && !isSuffix && (
                <span>
                  {seg.type === 'item' ? 'ITEM001'
                   : seg.type === 'attribute' ? (seg as Extract<Segment, { type: 'attribute' }>).name.toUpperCase()
                   : seg.type === 'year' ? new Date().getFullYear()
                   : seg.type === 'month' ? String(new Date().getMonth() + 1).padStart(2, '0')
                   : '001'}
                </span>
              )}
              {!isCounter && (
                <button
                  type="button"
                  onClick={() => handleRemoveFromTrack(i)}
                  style={{
                    background: 'linear-gradient(to bottom, #fff, #d4d0c8)',
                    border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                    color: '#800000', cursor: 'pointer', fontSize: '9px', lineHeight: 1,
                    padding: '0 3px', fontWeight: 'bold',
                  }}
                >×</button>
              )}
            </div>
            <div style={{ fontSize: '8px', color: '#333', fontFamily: 'Tahoma, Arial, sans-serif' }}>
              {label}
            </div>
          </div>
        </Fragment>
      );
    };

    const xpPaletteChip = (seg: Segment, i: number) => {
      const attrName = seg.type === 'attribute' ? (seg as Extract<Segment, { type: 'attribute' }>).name : '';
      const label = seg.type === 'attribute' ? `+ ${attrName}`
                  : seg.type === 'prefix' ? '+ Prefix'
                  : seg.type === 'suffix' ? '+ Suffix'
                  : seg.type === 'item' ? '+ Item Code'
                  : seg.type === 'year' ? '+ Year'
                  : seg.type === 'month' ? '+ Month'
                  : `+ ${seg.type}`;
      return (
        <div
          key={`xp-pal-${seg.type}-${attrName || i}`}
          draggable
          onDragStart={e => handlePaletteDragStart(e, i)}
          onDragEnd={handleDragEnd}
          onClick={() => handlePaletteChipClick(seg)}
          style={{
            padding: '2px 8px',
            border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
            background: 'linear-gradient(to bottom, #fff, #d4d0c8)',
            fontFamily: "'Courier New', monospace", fontSize: '10px',
            color: CHIP_COLORS_CLASSIC_TEXT[seg.type] ?? '#333',
            cursor: 'grab', userSelect: 'none',
          }}
        >
          {label}
        </div>
      );
    };

    return (
      <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 20100,
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: '540px', maxWidth: '96vw',
          border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
          boxShadow: '3px 3px 8px rgba(0,0,0,0.4)',
          background: '#ece9d8', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px',
        }}>
          {/* XP Title Bar */}
          <div style={{
            background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)',
            color: '#fff', padding: '4px 6px 4px 8px', fontWeight: 'bold', fontSize: '12px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)', borderBottom: '1px solid #003080',
            userSelect: 'none',
          }}>
            <span>
              <i className="bi bi-gear-fill" style={{ marginRight: '6px' }}></i>
              Configure {getTypeName(type)} Code
            </span>
            <button onClick={onClose} style={{
              background: 'linear-gradient(to bottom, #d9a0a0, #b03030)',
              border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
              color: '#fff', fontWeight: 'bold', fontSize: '9px',
              width: '16px', height: '16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}>✕</button>
          </div>

          {/* Body */}
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

            {/* Separator row */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontWeight: 'bold', fontSize: '10px' }}>Separator:</span>
              <select
                value={separator}
                onChange={e => setSeparator(e.target.value)}
                style={{
                  fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px',
                  border: '1px solid', borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                  boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)',
                  padding: '1px 4px', background: '#fff',
                }}
              >
                <option value="-">Dash (-)</option>
                <option value="_">Underscore (_)</option>
                <option value="/">Slash (/)</option>
                <option value="">None</option>
              </select>
            </div>

            {/* Track */}
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '3px' }}>
                Code Sequence <span style={{ fontWeight: 'normal', color: '#666' }}>(drag to reorder)</span>
              </div>
              <div style={{
                background: '#fff', border: '1px solid',
                borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.12)',
                padding: '7px 8px', display: 'flex', alignItems: 'flex-end',
                flexWrap: 'wrap', gap: '2px', minHeight: '46px',
              }}>
                {segments.map((seg, i) => xpChip(seg, i))}
              </div>
            </div>

            {/* Palette */}
            {palette.length > 0 && (
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '3px' }}>
                  Available <span style={{ fontWeight: 'normal', color: '#666' }}>(drag or click to add)</span>
                </div>
                <div
                  onDragOver={handlePaletteDragOver}
                  onDrop={handlePaletteDrop}
                  style={{
                    background: '#f5f3ee', border: '1px solid',
                    borderColor: '#808080 #dfdfdf #dfdfdf #808080',
                    boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.08)',
                    padding: '6px 8px', display: 'flex', flexWrap: 'wrap', gap: '5px',
                    minHeight: '30px',
                  }}
                >
                  {palette.map((seg, i) => xpPaletteChip(seg, i))}
                </div>
              </div>
            )}

            {/* XP Preview */}
            <div style={{
              background: '#fff', border: '2px solid',
              borderColor: '#808080 #dfdfdf #dfdfdf #808080',
              boxShadow: 'inset 2px 2px 0 rgba(0,0,0,0.1)',
              padding: '7px 10px',
            }}>
              <div style={{ fontSize: '9px', color: '#555', marginBottom: '3px', fontWeight: 'bold',
                            textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <i className="bi bi-eye" style={{ marginRight: '4px' }}></i>Preview
              </div>
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: '14px',
                            fontWeight: 'bold', color: '#000', letterSpacing: '0.5px' }}>
                {getPreview(segments, separator, attributes)}
              </div>
            </div>

          </div>

          {/* XP Footer */}
          <div style={{
            borderTop: '1px solid #b0aaa0', padding: '7px 12px',
            display: 'flex', justifyContent: 'flex-end', gap: '6px', background: '#ece9d8',
          }}>
            <button onClick={onClose} style={{
              fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', padding: '4px 18px',
              background: 'linear-gradient(to bottom, #fff, #d4d0c8)',
              border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', cursor: 'pointer',
            }}>Cancel</button>
            <button onClick={handleSave} style={{
              fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', padding: '4px 18px',
              fontWeight: 'bold', background: 'linear-gradient(to bottom, #6699cc, #3366aa)',
              border: '1px solid', borderColor: '#99bbee #224477 #224477 #99bbee',
              color: '#fff', cursor: 'pointer',
            }}>Save Configuration</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Default (Modern) Mode ────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)',
      zIndex: 20100, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div className={`ui-style-${currentStyle}`} style={{
        width: '600px', maxWidth: '96vw',
        background: '#fff', borderRadius: '12px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2), 0 4px 16px rgba(0,0,0,0.08)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>

        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a9e 100%)',
          padding: '14px 18px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '30px', height: '30px', borderRadius: '7px',
              background: 'rgba(255,255,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <i className="bi bi-gear-fill" style={{ color: '#fff', fontSize: '13px' }}></i>
            </div>
            <div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: '13px', lineHeight: 1.2 }}>
                Configure {getTypeName(type)} Code
              </div>
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '11px', marginTop: '1px' }}>
                Drag segments to build your ID format
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px',
            color: 'rgba(255,255,255,0.75)', cursor: 'pointer',
            padding: '2px 8px 4px', fontSize: '18px', lineHeight: 1,
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>

          {/* Separator row */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280' }}>Separator:</label>
            <select
              className="form-select form-select-sm"
              style={{ width: 'auto' }}
              value={separator}
              onChange={e => setSeparator(e.target.value)}
            >
              <option value="-">Dash ( - )</option>
              <option value="_">Underscore ( _ )</option>
              <option value="/">Slash ( / )</option>
              <option value="">None</option>
            </select>
          </div>

          {/* Active Track */}
          <div>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af',
                          textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px' }}>
              Code Sequence
              <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: '6px', color: '#cbd5e1',
                             fontSize: '10px' }}>
                drag to reorder — click × to remove
              </span>
            </div>
            <div style={{
              background: segments.filter(s => s.type !== 'counter').length === 0
                ? 'transparent' : '#f8fafc',
              border: segments.filter(s => s.type !== 'counter').length === 0
                ? '1.5px dashed #cbd5e1' : '1.5px solid #e2e8f0',
              borderRadius: '8px',
              padding: '10px 12px',
              display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: '2px',
              minHeight: '60px',
            }}>
              {segments.length === 1 && segments[0].type === 'counter' ? (
                <span style={{ color: '#94a3b8', fontSize: '12px', margin: 'auto' }}>
                  Drag segments here
                </span>
              ) : null}
              {segments.map((seg, i) => (
                <SegmentChipDefault
                  key={`${seg.type}-${seg.type === 'attribute' ? (seg as any).name : seg.type === 'prefix' || seg.type === 'suffix' ? (seg as any).value : ''}-${i}`}
                  seg={seg}
                  index={i}
                  activeGap={activeGap}
                  separator={separator}
                  onDragStart={e => handleTrackDragStart(e, i)}
                  onDragEnd={handleDragEnd}
                  onGapDragOver={handleGapDragOver}
                  onGapDragLeave={handleGapDragLeave}
                  onGapDrop={handleGapDrop}
                  onRemove={() => handleRemoveFromTrack(i)}
                  onPrefixChange={handlePrefixChange}
                  onSuffixChange={handleSuffixChange}
                />
              ))}
            </div>
          </div>

          {/* Palette */}
          {palette.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af',
                            textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px' }}>
                Available Segments
                <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: '6px', color: '#cbd5e1', fontSize: '10px' }}>
                  drag onto track or click to add
                </span>
              </div>
              <div
                onDragOver={handlePaletteDragOver}
                onDrop={handlePaletteDrop}
                style={{
                  background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px',
                  padding: '10px 12px', display: 'flex', flexWrap: 'wrap', gap: '8px', minHeight: '44px',
                }}
              >
                {palette.map((seg, i) => {
                  const color = CHIP_COLORS[seg.type] ?? '#64748b';
                  const label = seg.type === 'attribute'
                    ? (seg as Extract<Segment, { type: 'attribute' }>).name
                    : seg.type === 'prefix' ? 'Prefix'
                    : seg.type === 'suffix' ? 'Suffix'
                    : seg.type === 'item' ? 'Item Code'
                    : seg.type === 'year' ? 'Year'
                    : seg.type === 'month' ? 'Month'
                    : seg.type;
                  return (
                    <div
                      key={`pal-${seg.type}-${seg.type === 'attribute' ? (seg as Extract<Segment, { type: 'attribute' }>).name : i}`}
                      draggable
                      onDragStart={e => handlePaletteDragStart(e, i)}
                      onDragEnd={handleDragEnd}
                      onClick={() => handlePaletteChipClick(seg)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '5px',
                        padding: '4px 10px', borderRadius: '5px', cursor: 'grab',
                        border: `1.5px solid ${color}`, background: '#fff',
                        color: color, fontSize: '12px', fontWeight: 600,
                        fontFamily: "'Courier New', monospace", letterSpacing: '0.3px',
                        userSelect: 'none',
                      }}
                    >
                      <span style={{ fontSize: '10px', opacity: 0.6 }}>⊕</span>
                      {label}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Preview bar */}
          <div style={{ background: '#1e293b', borderRadius: '7px', padding: '9px 13px',
                        display: 'flex', alignItems: 'center', gap: '8px' }}>
            <i className="bi bi-code-slash" style={{ color: '#64748b', fontSize: '12px', flexShrink: 0 }}></i>
            <span style={{ fontFamily: "'Courier New', monospace", fontSize: '14px', fontWeight: 700,
                           color: '#e2e8f0', letterSpacing: '1.2px' }}>
              {getPreview(segments, separator, attributes)}
            </span>
          </div>

        </div>

        {/* Footer */}
        <div style={{
          padding: '11px 20px', borderTop: '1px solid #f1f5f9',
          display: 'flex', justifyContent: 'flex-end', gap: '8px',
          background: '#fafafa', flexShrink: 0,
        }}>
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-sm btn-primary px-4" onClick={handleSave}>
            Save Configuration
          </button>
        </div>

      </div>
    </div>
  );
}
