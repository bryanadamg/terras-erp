import { useState, useEffect, useRef, Fragment } from 'react';

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
    prefix:                normalized.find((s): s is Extract<Segment, { type: 'prefix' }> => s.type === 'prefix')?.value ?? '',
    suffix:                normalized.find((s): s is Extract<Segment, { type: 'suffix' }> => s.type === 'suffix')?.value ?? '',
    separator,
    includeItemCode:       normalized.some(s => s.type === 'item'),
    includeVariant:        normalized.some(s => s.type === 'attribute'),
    variantAttributeNames: (normalized.filter((s): s is Extract<Segment, { type: 'attribute' }> => s.type === 'attribute')).map(s => s.name),
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
  const [currentStyle, setCurrentStyle] = useState('default');
  const dragRef = useRef<{
    sourceZone: 'track' | 'palette';
    index: number;
  } | null>(null);

  useEffect(() => {
    const savedStyle = localStorage.getItem('ui_style');
    if (savedStyle) setCurrentStyle(savedStyle);

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

  // TODO: replace with real render in Tasks 3–7
  const classic = currentStyle === 'classic';
  const preview = getPreview(segments, separator, attributes);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 20100,
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', padding: 24, borderRadius: 8, maxWidth: 400 }}>
        <p><strong>Pipeline builder — wiring verified</strong></p>
        <p>Type: {type} | Style: {classic ? 'classic' : 'default'}</p>
        <p>Segments: {segments.map(s => s.type).join(' → ')}</p>
        <p>Preview: <code>{preview}</code></p>
        <button onClick={onClose}>Close</button>
        <button onClick={handleSave} style={{ marginLeft: 8 }}>Save</button>
      </div>
    </div>
  );
}
