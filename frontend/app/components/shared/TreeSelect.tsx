'use client';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MODAL_REPOSITION_EVENT } from './ModalWrapper';
import { layoutRectOf, layoutViewport } from '@bryanadamg/terras-ui/scale';
import { xpFont, BUTTON_RADIUS } from './xpTheme';

export interface TreeSelectOption {
  value: string;
  label: string;
  subLabel?: string;       // dimmed secondary text (e.g. location code)
  children?: TreeSelectOption[];
  selectable?: boolean;    // default: true when value is non-empty
}

interface Props {
  options: TreeSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  size?: 'sm';
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

// Walk the tree and return breadcrumb labels for the selected value
function getSelectedPath(options: TreeSelectOption[], target: string, ancestors: string[] = []): string[] | null {
  for (const o of options) {
    if (o.value === target) return [...ancestors, o.label];
    if (o.children) {
      const found = getSelectedPath(o.children, target, [...ancestors, o.label]);
      if (found) return found;
    }
  }
  return null;
}

// Collect all group values that have children (for default expand)
function collectGroupValues(options: TreeSelectOption[], out: Set<string> = new Set()): Set<string> {
  for (const o of options) {
    if (o.children?.length) {
      out.add(o.value);
      collectGroupValues(o.children, out);
    }
  }
  return out;
}

export default function TreeSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  allowEmpty = false,
  emptyLabel = '— All —',
  size,
  disabled,
  style,
  className,
}: Props) {

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => collectGroupValues(options));
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number; above: boolean; maxHeight: number }>({ top: 0, left: 0, width: 0, above: false, maxHeight: 320 });

  const computePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    // Layout px throughout — the panel is position:fixed, so screen-px values
    // would be re-multiplied by the interface scale. See uiScale.ts.
    const r = layoutRectOf(el);
    const margin = 8;
    const desired = 320;
    const spaceBelow = layoutViewport().height - r.bottom - margin;
    const spaceAbove = r.top - margin;
    // Flip above only when below is cramped AND above genuinely has more room —
    // otherwise clamp maxHeight to whichever side we land on so the panel never
    // renders past the viewport edge (it was previously fixed at 320 regardless
    // of actual space, which cut it off behind the taskbar on short screens).
    const above = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(80, Math.min(desired, above ? spaceAbove : spaceBelow));
    setDropPos({
      top: above ? r.top : r.bottom,
      left: r.left,
      width: r.width,
      above,
      maxHeight,
    });
  }, []);

  // Auto-expand newly added groups
  useEffect(() => {
    setExpanded(prev => {
      const groups = collectGroupValues(options);
      let changed = false;
      for (const g of groups) if (!prev.has(g)) { changed = true; break; }
      if (!changed) return prev;
      return new Set([...prev, ...groups]);
    });
  }, [options]);

  // Recompute position on open; close on outside click, ESC, scroll
  useEffect(() => {
    if (!open) return;
    computePos();
    const onMouse = (e: MouseEvent) => {
      const t = e.target as Node;
      const inContainer = ref.current?.contains(t);
      const inPanel = panelRef.current?.contains(t);
      if (!inContainer && !inPanel) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => { computePos(); };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', computePos);
    window.addEventListener(MODAL_REPOSITION_EVENT, computePos);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', computePos);
      window.removeEventListener(MODAL_REPOSITION_EVENT, computePos);
    };
  }, [open, computePos]);

  const toggleGroup = (val: string) => {
    setExpanded(prev => {
      const s = new Set(prev);
      s.has(val) ? s.delete(val) : s.add(val);
      return s;
    });
  };

  const select = (val: string) => {
    onChange(val);
    setOpen(false);
  };

  // Compute trigger label: full breadcrumb path or placeholder
  const triggerLabel = useMemo(() => {
    if (!value && allowEmpty) return emptyLabel;
    if (!value) return placeholder;
    const path = getSelectedPath(options, value);
    return path ? path.join(' / ') : placeholder;
  }, [value, options, allowEmpty, emptyLabel, placeholder]);

  // ── XP styles ──────────────────────────────────────────────────────────────
  const xpFontStyle = { fontFamily: xpFont, fontSize: 11 } as const;
  const xpTrigger: React.CSSProperties = {
    ...xpFontStyle,
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    height: 20,
    padding: '0 22px 0 4px',
    border: '1px solid #7f9db9',
    borderRadius: BUTTON_RADIUS,
    background: disabled ? '#f0f0f0' : '#fff',
    color: value ? '#000' : '#777',
    cursor: disabled ? 'default' : 'pointer',
    textAlign: 'left',
    position: 'relative',
    boxSizing: 'border-box',
    outline: 'none',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  };
  // ── Recursive node renderer ─────────────────────────────────────────────────
  const renderNode = (opt: TreeSelectOption, depth: number): React.ReactNode => {
    const hasKids = (opt.children?.length ?? 0) > 0;
    const isExp = expanded.has(opt.value);
    const canSelect = opt.selectable !== false && !!opt.value;
    const isSelected = !!value && opt.value === value;

    return (
      <div key={opt.value || `_d${depth}`}>
        <div
          style={{
            ...xpFontStyle,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 2 + depth * 14,
            paddingRight: 4,
            paddingTop: 2,
            paddingBottom: 2,
            margin: '0 2px',
            borderRadius: BUTTON_RADIUS,
            cursor: canSelect || hasKids ? 'pointer' : 'default',
            background: isSelected ? 'linear-gradient(to bottom,#3c8cf0,#1a5fd0)' : 'transparent',
            // A node that can't be picked (e.g. a transfer's own source location)
            // is greyed but still expandable so its children stay reachable.
            color: isSelected ? '#fff' : (canSelect || hasKids ? '#000' : '#9a9a9a'),
            userSelect: 'none',
            gap: 2,
          }}
          onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = '#dde8f8'; }}
          onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          onClick={() => {
            if (hasKids) toggleGroup(opt.value);
            if (canSelect) select(opt.value);
          }}
        >
          {/* Chevron or spacer */}
          {hasKids ? (
            <span
              style={{ width: 14, flexShrink: 0, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
              onClick={e => { e.stopPropagation(); toggleGroup(opt.value); }}
            >
              <i
                className={`bi bi-chevron-${isExp ? 'down' : 'right'}`}
                style={{ fontSize: 8, color: isSelected ? '#cde' : '#555' }}
              />
            </span>
          ) : (
            <span style={{ width: 14, flexShrink: 0 }} />
          )}

          {/* L-line connector for children */}
          {depth > 0 && (
            <span style={{
              width: 10, height: 10, flexShrink: 0, marginRight: 2,
              borderLeft: `1px solid ${isSelected ? '#8ab' : '#ccc'}`,
              borderBottom: `1px solid ${isSelected ? '#8ab' : '#ccc'}`,
              marginBottom: 4,
            }} />
          )}

          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {opt.label}
          </span>
          {opt.subLabel && (
            <span style={{ fontSize: 10, color: isSelected ? '#cde' : '#888', flexShrink: 0, marginLeft: 4 }}>
              {opt.subLabel}
            </span>
          )}
          {hasKids && (
            <span style={{ fontSize: 9, color: isSelected ? '#cde' : '#aaa', flexShrink: 0, marginLeft: 2 }}>
              ({opt.children!.length})
            </span>
          )}
        </div>
        {hasKids && isExp && opt.children!.map(c => renderNode(c, depth + 1))}
      </div>
    );

    // Bootstrap
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const emptyRow = allowEmpty && (
    <div
      style={{
        ...xpFontStyle,
        padding: '2px 4px',
        margin: '0 2px',
        borderRadius: BUTTON_RADIUS,
        cursor: 'pointer',
        background: !value ? 'linear-gradient(to bottom,#3c8cf0,#1a5fd0)' : 'transparent',
        color: !value ? '#fff' : '#777',
        fontStyle: 'italic',
        userSelect: 'none',
      }}
      onMouseEnter={e => { if (value) (e.currentTarget as HTMLDivElement).style.background = '#dde8f8'; }}
      onMouseLeave={e => { if (value) (e.currentTarget as HTMLDivElement).style.background = ''; }}
      onClick={() => select('')}
    >
      {emptyLabel}
    </div>
  );

  const portalStyle: React.CSSProperties = {
    position: 'fixed',
    top: dropPos.top,
    left: dropPos.left,
    zIndex: 99999,
    minWidth: dropPos.width,
    maxHeight: dropPos.maxHeight,
    overflowY: 'auto',
    padding: '2px 0',
    transform: dropPos.above ? 'translateY(-100%)' : undefined,
  };

  const panel = open ? createPortal(
    <div ref={panelRef} style={{
      ...portalStyle,
      maxWidth: 400,
      background: '#fff',
      border: '1px solid #7f9db9',
      borderRadius: BUTTON_RADIUS,
      boxShadow: '2px 2px 4px rgba(0,0,0,0.25)',
    }}>
      {emptyRow}
      {options.map(o => renderNode(o, 0))}
    </div>,
    document.body
  ) : null;

  return (
    <div ref={ref} style={{ position: 'relative', ...style }} className={className}>
      <button
        ref={triggerRef}
        type="button"
        style={xpTrigger}
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', ...xpFontStyle, color: (value || (allowEmpty && !value)) ? '#000' : '#777' }}>
          {triggerLabel}
        </span>
        <i
          className={`bi bi-chevron-${open ? 'up' : 'down'}`}
          style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', fontSize: 9, color: '#555', pointerEvents: 'none' }}
        />
      </button>
      {panel}
    </div>
  );

}

// ── Tree builder helpers ──────────────────────────────────────────────────────

/**
 * Build tree options for a FILTER dropdown (warehouses selectable as "All of X").
 * value encoding: '' = all, 'wh:<id>' = warehouse-wide, 'loc:<id>' = specific zone/bin
 * Matches StockOnHandView's onLocSelect() parsing convention.
 */
export function buildLocationFilterTree(locations: any[]): TreeSelectOption[] {
  const warehouses = (locations || []).filter((l: any) => l.location_type === 'warehouse');
  return warehouses.map((w: any) => {
    const zones = locations.filter((l: any) => l.parent_id === w.id);
    return {
      value: `wh:${w.id}`,
      label: w.name,
      selectable: true,
      children: zones.map((z: any) => {
        const bins = locations.filter((l: any) => l.parent_id === z.id);
        return {
          value: `loc:${z.id}`,
          label: z.name,
          selectable: true,
          children: bins.length > 0 ? bins.map((b: any) => ({
            value: `loc:${b.id}`,
            label: b.name,
            subLabel: b.code,
            selectable: true,
          })) : undefined,
        };
      }),
    };
  });
}

/**
 * Build tree options for a PICKER dropdown (select any location, any level).
 * Warehouses, zones, and bins are all selectable.
 * value = location UUID
 *
 * `excludeId` (e.g. a transfer's source location) is greyed out but KEPT in the
 * tree — pre-filtering it out of `locations` would orphan every descendant that
 * hangs off it by parent_id, which silently blocks the legal moves within the
 * same warehouse/zone (zone -> its own bin, warehouse -> any bin under it).
 */
export function buildLocationPickerTree(locations: any[], excludeId?: string): TreeSelectOption[] {
  const ex = excludeId ? String(excludeId) : null;
  const pick = (l: any): boolean => !ex || String(l.id) !== ex;
  const warehouses = (locations || []).filter((l: any) => l.location_type === 'warehouse');
  return warehouses.map((w: any) => {
    const zones = locations.filter((l: any) => l.parent_id === w.id);
    return {
      value: w.id,
      label: w.name,
      subLabel: w.code,
      selectable: pick(w),
      children: zones.map((z: any) => {
        const bins = locations.filter((l: any) => l.parent_id === z.id);
        return {
          value: z.id,
          label: z.name,
          subLabel: z.code,
          selectable: pick(z),
          children: bins.length > 0 ? bins.map((b: any) => ({
            value: b.id,
            label: b.name,
            subLabel: b.code,
            selectable: pick(b),
          })) : undefined,
        };
      }),
    };
  });
}

/**
 * Expand a buildLocationFilterTree() select value ('wh:<id>' or 'loc:<id>') into
 * the full list of matching location ids (the node itself + all descendants),
 * so a server-side filter can match stock recorded at any depth below it.
 */
export function expandLocationFilterValue(locations: any[], value: string): string[] {
  if (!value) return [];
  const id = value.startsWith('wh:') || value.startsWith('loc:') ? value.slice(value.indexOf(':') + 1) : value;
  const childrenOf: Record<string, string[]> = {};
  for (const l of (locations || [])) {
    if (l.parent_id) (childrenOf[l.parent_id] ||= []).push(String(l.id));
  }
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    for (const c of (childrenOf[cur] || [])) stack.push(c);
  }
  return out;
}

/**
 * Build tree options for item category selection.
 * All categories are selectable. Builds from flat array with parent_id.
 */
export function buildCategoryTree(categories: any[]): TreeSelectOption[] {
  const roots = (categories || []).filter((c: any) => !c.parent_id);
  const childrenOf = (parentId: string): any[] =>
    categories.filter((c: any) => c.parent_id === parentId);

  const toOpt = (cat: any): TreeSelectOption => {
    const kids = childrenOf(cat.id);
    return {
      value: cat.id,
      label: cat.name,
      selectable: true,
      children: kids.length > 0 ? kids.map(toOpt) : undefined,
    };
  };
  return roots.map(toOpt);
}

/**
 * Expand a buildCategoryTree() value into the category itself plus every
 * descendant id, so a server-side filter matches items filed under any child
 * category (picking "Yarn" must also return "Yarn / Cotton").
 */
export function expandCategoryFilterValue(categories: any[], value: string): string[] {
  if (!value) return [];
  const childrenOf: Record<string, string[]> = {};
  for (const c of (categories || [])) {
    if (c.parent_id) (childrenOf[c.parent_id] ||= []).push(String(c.id));
  }
  const out: string[] = [];
  const stack = [String(value)];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    for (const c of (childrenOf[cur] || [])) stack.push(c);
  }
  return out;
}
