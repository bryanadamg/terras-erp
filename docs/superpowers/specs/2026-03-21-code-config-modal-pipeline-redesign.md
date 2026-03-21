# CodeConfigModal — Pipeline Builder Redesign

**Date:** 2026-03-21
**Status:** Approved for implementation
**Scope:** `frontend/app/components/CodeConfigModal.tsx` only

---

## Background

The CodeConfigModal lets users configure how IDs are auto-generated for any record type (BOM, WO, PO, SO, SAMPLE, ITEM). It is used by **anyone creating a record**, not just admins — making clarity and speed the top priorities. The current UI presents toggles in a flat list with a static fixed segment order. Users cannot reorder segments.

---

## Goal

Replace the toggle-list interaction with a **drag-and-drop pipeline builder**: an ordered track of segment chips the user assembles from a palette. Segment order directly determines the generated code structure.

Both the **default (modern)** and **XP classic** visual themes must be supported with full fidelity to their respective aesthetics.

---

## Interaction Model

### Two Zones

| Zone | Description |
|------|-------------|
| **Active Track** | Segments currently included in the code, in order. Drag to reorder. Click × to remove (returns to palette). |
| **Palette** | Segments not currently in use. Drag onto track to add. Clicking a palette chip also adds it to the end of the track. |

### Segment Types

| Type | Preview Value | Editable | Tint (default) | Tint (classic) |
|------|--------------|----------|----------------|----------------|
| `prefix` | User-typed value | Inline text input on chip | Blue `#2563eb` | XP blue bevel |
| `item` | `ITEM001` | No | Green `#059669` | XP green bevel |
| `attribute` | First attribute value or `VAR` | No (attribute name shown as label) | Purple `#7c3aed` | XP purple bevel |
| `year` | `2026` | No | Amber `#b45309` | XP amber bevel |
| `month` | `03` | No | Rose `#be185d` | XP rose bevel |
| `suffix` | User-typed value | Inline text input on chip | Teal `#0e7490` | XP teal bevel |
| `counter` | `001` | No — fixed, always last | Gray `#475569` | XP gray bevel |

Each attribute in `attributes[]` is its own draggable chip (e.g. "Color", "Size" are separate). `variantAttributeNames` order in the saved config matches the order attribute chips appear in the track.

**`attributes[]` shape** (from the `attributes: any[]` prop):
```ts
{ id: string | number; name: string; values: { id: string | number; value: string }[] }
```
The attribute chip's preview value is `attr.values[0]?.value.toUpperCase() ?? 'VAR'`. If the same attribute appears more than once in `initialConfig.variantAttributeNames` (a data integrity issue), only the first occurrence is used.

The **counter chip is always pinned to the end** of the track. It has no drag handle and no remove button.

### Separator

A single dropdown rendered in a slim toolbar row **above the track**, right-aligned. Label: "Separator:". The old "Code Structure" row (prefix / separator / suffix inputs) is removed — prefix and suffix are now chips on the track. The separator dropdown is the only persistent top-of-body control.

### Prefix / Suffix Inline Editing

When a prefix or suffix chip is on the track, it shows an inline `<input>` inside the chip body. The input auto-upcases.

**Multiplicity rule:** `prefix` and `suffix` may each appear **at most once** in the track. While a prefix chip is on the track, the prefix chip is hidden from the palette (not shown at all — it is "consumed"). Same for suffix. Removing the chip from the track returns it to the palette. If suffix is removed, its typed value is discarded.

---

## Internal State Model

Replace the flat `config` booleans with an ordered `segments` array. `separator` remains unchanged.

```ts
type Segment =
  | { type: 'prefix';    value: string }
  | { type: 'item' }
  | { type: 'attribute'; name: string }
  | { type: 'year' }
  | { type: 'month' }
  | { type: 'suffix';    value: string }
  | { type: 'counter' }               // always last, not draggable

interface InternalState {
  segments: Segment[];
  separator: string;
}
```

### Deriving from `initialConfig` (load)

| `initialConfig` field | → Segment |
|-----------------------|-----------|
| `prefix` (non-empty) | `{ type: 'prefix', value }` |
| `includeItemCode` | `{ type: 'item' }` |
| `includeVariant && variantAttributeNames[]` | one `{ type: 'attribute', name }` per entry |
| `includeYear` | `{ type: 'year' }` |
| `includeMonth` | `{ type: 'month' }` |
| `suffix` (non-empty) | `{ type: 'suffix', value }` |
| always | `{ type: 'counter' }` at end |

**Default initial segments when no `initialConfig`** (mirrors existing component defaults):

| type | BOM | WO | PO | SO | SAMPLE | ITEM |
|------|-----|----|----|----|--------|------|
| prefix | BOM | WO | PO | SO | SMP | ITM |
| item | ✓ | ✓ | — | — | — | — |
| year | — | — | ✓ | — | ✓ | — |
| counter | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Initial segment array order: `[prefix, item (if applicable), year (if applicable), counter]`.

### Deriving `CodeConfig` on save (backward compatibility)

The `onSave(config: CodeConfig)` signature is **unchanged**. Before calling it, derive:

```ts
{
  prefix:                segments.find(s => s.type === 'prefix')?.value ?? '',
  suffix:                segments.find(s => s.type === 'suffix')?.value ?? '',
  separator,
  includeItemCode:       segments.some(s => s.type === 'item'),
  includeVariant:        segments.some(s => s.type === 'attribute'),
  variantAttributeNames: segments.filter(s => s.type === 'attribute').map(s => s.name),
  includeYear:           segments.some(s => s.type === 'year'),
  includeMonth:          segments.some(s => s.type === 'month'),
}
```

---

## Drag-and-Drop Implementation

Use the **HTML5 native drag-and-drop API** — no external dependencies.

### Drag state storage

Use a `useRef<{ sourceZone: 'track' | 'palette'; index: number; segmentType: string } | null>` to store the active drag. Do **not** use `dataTransfer.setData` for cross-zone data — `dataTransfer` payload is inaccessible during `dragover` in some browsers, which is needed for drop-indicator activation. The ref is set in `onDragStart` and cleared in `onDragEnd`.

### Draggable elements

- `draggable="true"` on every track chip except the counter
- `draggable="true"` on every palette chip
- Counter chip: no `draggable`, no × button, always rendered last

### Drop gap indicators

Between each pair of adjacent track chips (and before the first chip), render a `<div class="drop-gap">` element. The gap after the counter is **not rendered** — drops always land before the counter.

Gap activation:
- Each gap div handles `onDragOver={(e) => { e.preventDefault(); setActiveGap(gapIndex); }}` and `onDragLeave={() => setActiveGap(null)}`
- `activeGap` is a `useState<number | null>` tracking which gap is highlighted
- Active gap visual: a `2px` solid vertical bar in the chip color (default) or `#0058e6` (classic), with a small expansion animation; the gap div widens from `4px` to `16px`
- Only the hovered gap activates — not all gaps simultaneously
- `activeGap` is reset to `null` in **three places**: `onDrop` on a gap, `onDrop` on the palette, and `onDragEnd` on the dragged element (covers cancel/escape/drop-outside cases)

**Gap divs double as separator character display.** Each gap div renders the separator character as its text content when inactive. When active (dragged-over), the character disappears and the gap expands + highlights. If `separator` is `""` (None), the gap renders no character in either state. This unified approach avoids hit-area conflicts between separator chars and gap targets:

```
gap div (inactive): width 4px, shows separator char centered, color #4b5563 (default) / #555 (classic)
gap div (active):   width 16px, no char, shows colored vertical bar, background accent
```

### Drop handlers

**Drop on a gap (insert into track):**
```
onDrop on gap[i]:
  e.preventDefault()
  if sourceZone === 'track':
    remove segment at sourceIndex from array → newArray
    insertAt = sourceIndex < i ? i - 1 : i   // adjust for removal shift
    insert segment at insertAt in newArray
  if sourceZone === 'palette':
    insert segment at i (before counter)
  setActiveGap(null)
```

**Drop on palette zone (remove from track):**
```
onDrop on palette:
  e.preventDefault()
  if sourceZone === 'track': remove segment at sourceIndex

palette zone must also handle:
  onDragOver={(e) => e.preventDefault()}   // required for browser to accept the drop
```

**Click on palette chip (no drag needed):**
Append the segment to the track immediately before the counter.

**Click × on a track chip:**
Remove segment from track. If it is a `prefix` or `suffix`, the chip reappears in the palette.

### Counter position enforcement

The counter is always the last element of the `segments` array. After every drop/add/remove operation, ensure `segments[segments.length - 1].type === 'counter'` — enforce this as an invariant in the state-update helpers rather than relying on render order. If a bug somehow puts counter elsewhere, a normalization pass in `getPreview()` and `handleSave()` re-moves it to the end.

---

## Visual Design

### Default (Modern) Mode

**Track panel**
- Background: `#f8fafc`, border: `1.5px solid #e2e8f0`, border-radius: `8px`
- Empty state: dashed border `#cbd5e1`, placeholder text "Drag segments here"

**Segment chips (on track)**
- Background: solid chip color (e.g. `#2563eb` for prefix)
- Text: **white** — high contrast on all chip colors ✓
- Drag handle: `⠿` in `rgba(255,255,255,0.55)` — white on color ✓
- Label below chip: chip color at full opacity (e.g. `#2563eb`) on `#f8fafc` background — AA compliant ✓
- Remove button: `×` inline at chip end, `rgba(255,255,255,0.7)` — white on color ✓
- Inline input (prefix/suffix): white text, transparent background, `1px solid rgba(255,255,255,0.4)` border

**Separator between chips**
- Character: `color: #4b5563` (not light gray `#94a3b8`) on `#f8fafc` — AA compliant ✓

**Palette panel**
- Background: `#f1f5f9`, border: `1px solid #e2e8f0`
- Palette chips: outlined style — `border: 1.5px solid <chip-color>`, background white, text `<chip-color>`
- All palette chip text uses the full-saturation chip color on white — AA compliant ✓

**Preview bar**
- Background: `#1e293b`, text: `#f1f5f9` monospace — high contrast ✓

### XP Classic Mode

**Track panel**
- White background, inset border `#808080 #dfdfdf #dfdfdf #808080`, inner shadow

**Segment chips (on track)**
- Per-category tinted XP raised-button gradient (light tint → mid tint)
- Text: **dark color** (e.g. `#00327a` for blue prefix, `#003a00` for green item, `#320070` for purple) — dark on light ✓
- Drag handle: `⠿` in `#666666` — dark gray on light chip bg ✓
- Label below chip: `#333333` — dark on `#ece9d8` ✓
- Remove button: `×` as a small XP button with bevel border
- Inline input (prefix/suffix): standard XP inset input field styling

**Separator between chips**
- `#555555` bold — dark on light ✓

**Palette panel**
- `#f5f3ee` background with XP inset border
- Palette chips: XP raised-button style, category tint, dark text ✓

**Preview**
- Deeply inset 2px bevel box, white bg, black Courier New text ✓

**Counter chip (both modes)**
- Visually distinct: muted/grayed, no drag handle glyph, no × button
- Default: `#64748b` bg, white text ✓
- Classic: `linear-gradient(#e0e0e0, #c0c0c0)`, `#333` text ✓

---

## Contrast Checklist

All text elements must meet WCAG AA (4.5:1 for normal text, 3:1 for large/bold):

| Element | Foreground | Background | Status |
|---------|-----------|-----------|--------|
| Chip text (default) | `#ffffff` | chip color (min luminance ~0.2) | ✓ |
| Chip drag handle (default) | `rgba(255,255,255,0.55)` | chip color | ✓ |
| Segment label below chip (default) | chip color (full opacity) | `#f8fafc` | ✓ |
| Separator char (default) | `#4b5563` | `#f8fafc` | ✓ |
| Palette chip text (default) | chip color (full) | `#ffffff` | ✓ |
| Preview text (default) | `#f1f5f9` | `#1e293b` | ✓ |
| Chip text (classic) | `#00327a` / `#003a00` / `#320070` etc. | light gradient (~`#f0ecff`) | ✓ |
| Drag handle (classic) | `#666666` | light chip bg | ✓ |
| Label below chip (classic) | `#333333` | `#ece9d8` | ✓ |
| Preview text (classic) | `#000000` | `#ffffff` | ✓ |

---

## Re-open Behavior

The `useEffect` hook watches `[isOpen, initialConfig]`. Every time the modal opens (`isOpen` becomes true), the segments state is **fully re-derived from `initialConfig`** (or from the type-defaults table if `initialConfig` is absent). No segment state persists across open/close cycles — this matches the current component's behavior.

The existing legacy-migration guard must be preserved inside the re-derive logic:
```ts
// Migrate old single-string variantAttributeName → variantAttributeNames[]
if (typeof safeConfig.variantAttributeName === 'string') {
  safeConfig.variantAttributeNames = [safeConfig.variantAttributeName].filter(Boolean);
  delete safeConfig.variantAttributeName;
}
```
Apply this before converting `initialConfig` to segments.

**Stale attribute names:** If a name in `initialConfig.variantAttributeNames` does not match any entry in `attributes[]`, silently drop it — do not create a segment for it. This prevents phantom chips with no palette entry and no resolvable preview value.

---

## Modal Dimensions

| Mode | Width | Max-width |
|------|-------|-----------|
| Default (modern) | `600px` | `96vw` |
| Classic (XP) | `540px` | `96vw` |

Both modes: no fixed height. Content scrolls within `modal-body` (or equivalent) if chips wrap to multiple lines. The track and palette panels each use `flex-wrap: wrap` and expand vertically. The preview bar is always visible at the bottom of the body (no scroll needed for it — it is inside the body flow, not sticky).

---

## Scope & Non-Goals

**In scope:**
- `CodeConfigModal.tsx` — full rewrite of render logic and state
- Both visual modes (default + XP classic)
- Backward-compatible `CodeConfig` interface for `onSave`
- Migration from old `initialConfig` format

**Not in scope:**
- No new API endpoints
- No changes to callers of `CodeConfigModal`
- No changes to the `CodeConfig` type exported by the module
- No drag-and-drop library additions — native HTML5 DnD only
