---
title: BOM Table UI/UX Redesign
date: 2026-03-21
status: approved
---

# BOM Table UI/UX Redesign

## Overview

Apply the Windows XP visual treatment from `ManufacturingView` to `BOMView`, improving contrast and readability throughout the existing table structure. Add a live search/filter bar to the toolbar. No new columns, no new expand panels — this is a styling and usability pass.

## Scope

**File:** `frontend/app/components/BOMView.tsx`

**In scope:**
- XP window chrome (outer shell, title bar, bevel borders)
- Toolbar redesign (XP-style buttons, search/filter input)
- Table header styling (XP gradient, column dividers)
- Row styling (alternating backgrounds, selected state, column dividers)
- Materials tree contrast improvements (qty, item code, item name, sub-BOM badge, nested indent)
- Classic vs default mode parity (classic = XP, default = existing Bootstrap)

**Out of scope:**
- New columns
- Expand-in-place detail panels
- Pagination
- Any backend changes

## Design

### Mode Awareness

`BOMView` already reads `ui_style` from `localStorage` and stores it in `currentStyle` (loaded in a `useEffect` on mount, initial value `'default'`). All new styling branches on `currentStyle === 'classic'` — identical pattern to `ManufacturingView`.

**Flash of unstyled content:** `currentStyle` initialises as `'default'` before the `useEffect` fires, meaning the component briefly renders in default mode on first load. This is the same behaviour as `ManufacturingView` and is acceptable — no special handling needed.

**JSX structure:** The existing `<div className="row g-4 fade-in">` outer wrapper is **kept as-is**. Inside it, the existing `<div className="col-12">` wrapper is also **kept as-is**. The `<div className="card h-100 shadow-sm border-0">` becomes mode-aware using one element with conditional props:

```jsx
<div
  style={currentStyle === 'classic' ? { border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', boxShadow: '2px 2px 4px rgba(0,0,0,0.3)', background: '#ece9d8', borderRadius: 0 } : undefined}
  className={currentStyle === 'classic' ? '' : 'card h-100 shadow-sm border-0'}
>
```

The inner `<div className="card-body p-0">` wrapper (currently wrapping the `table-responsive`) becomes mode-aware similarly — in classic mode its `className` is `''` (empty) so Bootstrap's padding/border resets do not apply:

```jsx
<div className={currentStyle === 'classic' ? '' : 'card-body p-0'} style={{ maxHeight: 'calc(100vh - 150px)', overflowY: 'auto' }}>
```

### Window Chrome

The card element becomes mode-aware:

**Classic mode:**
```
border: 2px solid
border-color: #dfdfdf #808080 #808080 #dfdfdf   (XP bevel)
box-shadow: 2px 2px 4px rgba(0,0,0,0.3)
background: #ece9d8
border-radius: 0
```

**Default mode:** unchanged — `className="card h-100 shadow-sm border-0"`.

### Title Bar

Replaces the existing `card-header bg-white` div.

**Classic:**
```
background: linear-gradient(to right, #0058e6 0%, #08a5ff 100%)
color: #fff
font: bold 12px Tahoma, Arial, sans-serif
padding: 4px 8px
box-shadow: inset 0 1px 0 rgba(255,255,255,0.3)
border-bottom: 1px solid #003080
```

**Default:** existing `card-header bg-white` div — no change.

### Toolbar Layout

The toolbar is a single flex row (`display: flex; justify-content: space-between; align-items: center`) matching the `ManufacturingView` title bar pattern.

**Left side** (flex row, `gap: 8px`, `align-items: center`):
1. Title icon + text — icon: `bi-diagram-3-fill` (matching the BOM Designer modal header); text: `t('active_boms')` (existing i18n key). In classic mode: white bold Tahoma 12px. In default mode: keeps existing `h5.card-title` styling.
2. Search input (new)
3. Selected-count label (conditional — `selectedIds.size > 0`)
4. Delete Selected button (conditional — `selectedIds.size > 0`)
5. Clear selection link (conditional — `selectedIds.size > 0`) — this is the **same existing** "Clear" `btn-link` element; no duplication. In classic mode it renders as a plain text link (`color: #000; text-decoration: underline; background: none; border: none; cursor: pointer; font-family: Tahoma, Arial, sans-serif; font-size: 11px`).

**Right side:**
6. New BOM button — label text: `t('create_recipe')` (existing i18n key, unchanged in both modes). Existing `<i className="bi bi-plus-lg me-2">` icon: keep the icon but in classic mode replace `me-2` with an inline `marginRight: '4px'` to avoid Bootstrap spacing utilities inside the XP-styled button.

The existing two-div flex layout in `card-header` (`d-flex justify-content-between align-items-center`) is reused as-is in default mode. In classic mode it is replaced with the XP title bar `div` (same flex layout, XP styles applied).

**Toolbar DOM structure (both modes):**
```
<div [outer toolbar flex — justify-content:space-between]>
  <div [left side — d-flex align-items-center gap-2]>
    <span/i [title icon + text]>
    <input [search input — NEW, placed here, outside the inner selection group]>
    <div [inner selection group — d-flex align-items-center gap-2, conditional on selectedIds.size > 0]>
      <span [selected count label]>
      <button [Delete Selected]>
      <button [Clear link]>
    </div>
  </div>
  <button [New BOM — right side]>
</div>
```
The search input sits **outside** the inner selection group but inside the left-side flex div. The inner `<div className="d-flex align-items-center gap-2">` grouping for items 3–5 is **preserved unchanged** (same element, same classes in default mode; classes removed in classic mode per the XP button styling).

**Selected-count label in classic mode:** same text `{selectedIds.size} selected` as default. Style: `font-family: Tahoma, Arial, sans-serif; font-size: 11px; color: #fff` (white text against the blue title bar).

**Search behaviour:**
- Local `useState<string>('')` for the search query. Not persisted.
- `filteredBOMs` computed with `useMemo` (dependencies: `[boms, searchQuery]`): filters `boms` where `bom.code` or `(bom.item_name || getItemName(bom.item_id))` contains the query string (case-insensitive).
- `filteredBOMs` is used in place of `boms` in the table render loop (`boms.map(...)` at the `<tbody>` must become `filteredBOMs.map(...)`).
- The `allSelected` and `someSelected` `const` declarations (currently referencing `boms.length` and `boms.map`) must be updated to reference `filteredBOMs`:
- `allSelected = filteredBOMs.length > 0 && filteredBOMs.every(b => selectedIds.has(b.id))`
- `someSelected = filteredBOMs.some(b => selectedIds.has(b.id)) && !allSelected`

This ensures the indeterminate state (some but not all filtered rows selected) correctly reflects only the visible filtered rows. A selection that covers all filtered rows but not all `boms` shows `allSelected=true` — this is correct for the filtered context.
- `toggleSelectAll` deselect behaviour: when `allSelected` is true (all filtered rows selected), clicking select-all should deselect **only the filtered rows** (not clear the entire Set, to preserve hidden selections). Implementation: `setSelectedIds(prev => { const next = new Set(prev); filteredBOMs.forEach(b => next.delete(b.id)); return next; })`. When selecting, map `filteredBOMs` instead of `boms`.
- `handleBulkDelete` passes `[...selectedIds]` to `onDeleteMultipleBOMs` — no change needed to the delete logic. The existing post-delete `setSelectedIds(new Set())` is kept — it clears all selections after deletion, which is correct UX (selected items no longer exist after delete).
- When the search query changes, `selectedIds` is **not cleared** — selections outside the current filter are preserved (hidden but not lost). This matches typical ERP table behaviour.
- `useMemo` must be added to the React import alongside the existing `useState` and `useEffect`.

**Classic search input:**
```
font-family: Tahoma, Arial, sans-serif
font-size: 11px
border: 1px solid #808080
box-shadow: inset 1px 1px 0 rgba(0,0,0,0.15)
padding: 2px 6px
background: #fff
color: #000
placeholder: "Search BOMs..."
```

**Classic buttons:**

New BOM:
```
background: linear-gradient(to bottom, #5ec85e, #2d7a2d)
border: 1px solid; border-color: #1a5e1a #0a3e0a #0a3e0a #1a5e1a
color: #fff
font: bold 11px Tahoma, Arial, sans-serif
padding: 2px 10px
cursor: pointer
```

Delete Selected:
```
background: linear-gradient(to bottom, #fff, #d4d0c8)
border: 1px solid; border-color: #dfdfdf #808080 #808080 #dfdfdf
color: #000
font: 11px Tahoma, Arial, sans-serif
padding: 2px 10px
cursor: pointer
```

**Default mode:** `btn-primary btn-sm` for New BOM, `btn-danger btn-sm` for Delete Selected — unchanged from today.

### Table Header

**Classic:**
```
background: linear-gradient(to bottom, #ffffff, #d4d0c8)
border-bottom: 2px solid #808080
font: bold 10px Tahoma, Arial, sans-serif
color: #000
letter-spacing: 0.2px
```
Column header cells separated by `border-right: 1px solid #b0aaa0`.

**Default:** existing `thead.table-light` — no change.

### Row Styling

**Classic:**

| State    | Background  | Border-bottom        |
|----------|-------------|----------------------|
| Normal   | `#ffffff`   | `1px solid #c0bdb5`  |
| Alt row  | `#f5f3ee`   | `1px solid #c0bdb5`  |
| Selected | `#d8e4f8`   | `1px solid #c0bdb5`  |

Row index for alternating is based on position in `filteredBOMs` array.
Column cells separated by `border-right: 1px solid #c0bdb5`.

**Table element `className` by mode:**
- Classic: `className=""` with `style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px' }}` — `borderCollapse: 'collapse'` is required so column divider `border-right` on cells renders as single borders, not double.
- Default: `className="table table-hover align-middle mb-0"` (unchanged)

**Row `className` and `style` by mode:**
- Classic: `className=""`, `style={{ background: rowBg, borderBottom: '1px solid #c0bdb5' }}` where `rowBg` is `selectedIds.has(bom.id) ? '#d8e4f8' : index % 2 === 0 ? '#ffffff' : '#f5f3ee'`
- Default: `className={selectedIds.has(bom.id) ? 'table-active' : ''}` (unchanged)

**Default:** Bootstrap `table-hover` + `table-active` for selected — unchanged.

### Materials Tree (in-cell)

Applied in **both modes** for improved readability. The existing `renderBOMTree` function is updated in-place.

| Element       | Style                                                                                                     | Scope        |
|---------------|-----------------------------------------------------------------------------------------------------------|--------------|
| Qty           | `color: #0058e6; font-weight: bold; min-width: 22px` (current code has `minWidth: 20px` — this is an intentional 2px increase for alignment). Remove `fw-bold text-primary` from `className`; apply all styles via inline `style` only to avoid Bootstrap `text-primary` colour override | both modes   |
| Item code     | `font-family: 'Courier New', monospace; font-size: 9px; color: #555` — the item code span (line 143) has classes `text-truncate text-muted extra-small font-monospace me-1` (order may vary). Replace all of these with `className="text-truncate me-1"` + inline `style={{ fontFamily: "'Courier New', monospace", fontSize: '9px', color: '#555' }}`. Removing `extra-small` is intentional — its font-size effect is superseded by `fontSize: '9px'`. | both modes   |
| Item name     | `color: #000`                                                                                             | both modes   |
| Sub-BOM badge | `background: #fff3cd; border: 1px solid #b8860b; color: #6b4e00; font-size: 8px; font-weight: bold` — replaces current `badge bg-secondary` on line 153 | both modes |
| Nested indent | `border-left: 2px solid #b0aaa0; margin-left: 14px; padding-left: 6px; margin-top: 4px` — replaces `ms-2 ps-2 border-start border-light-subtle mt-1` in **both modes**; `marginTop: 4px` preserves the spacing that Bootstrap `mt-1` provides; use inline `style` only | both modes   |
| Expand caret  | Existing `bi-caret-right-fill` / `bi-caret-down-fill` — kept. In classic mode: remove `text-muted` from `className` and add `style={{ color: '#0058e6' }}`. In default mode: keep `className="... text-muted"` unchanged. | mode-aware |

**Inner line item wrapper (`d-flex align-items-center gap-1 border-bottom pb-1 border-light w-100 overflow-hidden`, line 141):** In classic mode, remove `border-bottom`, `pb-1`, and `border-light` from `className` (they produce a washed-out border against the XP row backgrounds). Replace with `style={{ paddingBottom: '2px', borderBottom: '1px solid #e0ddd4' }}`. In default mode, keep the Bootstrap classes unchanged.

**Note on sub-BOM badge:** The current code (line 153) uses `badge bg-secondary`. The new yellow style (`#fff3cd` / `#b8860b` / `#6b4e00`) matches the style already used in `ManufacturingView` (line 521) for the same concept and is applied in both modes.

## Implementation Notes

- Add `useMemo` to the React import on line 1.
- `filteredBOMs` uses `useMemo` with `[boms, searchQuery]` as dependencies.
- Name-based filtering uses `bom.item_name || getItemName(bom.item_id)` to handle both denormalised and live-resolved names.
- No changes to `BOMDesigner`, `BOMForm`, `BOMAutomatorModal`, or any backend files.
- Inside `renderBOMTree`, the `boms.find(...)` call that locates sub-BOMs for tree expansion must **stay as `boms`** (the full unfiltered prop), not `filteredBOMs`. This is intentional: sub-BOMs of visible rows must still be findable even if the sub-BOM's parent is filtered out.
- The `<div className="table-responsive">` wrapper (line 225): in classic mode change its `className` to `""` (empty) to avoid `overflow-x: auto` interfering with the XP bevel border rendering. The scroll behaviour is handled by the `maxHeight`/`overflowY` on the card-body wrapper instead.
- `currentStyle` is already loaded from `localStorage` on mount — no new state needed.
- **Empty filter state:** when `filteredBOMs.length === 0` and `searchQuery` is non-empty, render a single `<tr><td colSpan={6}>` (6 columns: checkbox, BOM code, finished good, routing, materials, delete) spanning all columns, with the message: `No BOMs match your search.` (centred, `color: #888`, `font-size: 11px`). No special treatment needed when `boms` itself is empty (existing empty-table behaviour is unchanged).

## Acceptance Criteria

- [ ] Classic mode renders XP window chrome (bevel border, `#ece9d8` background, outer shell) matching `ManufacturingView` pattern
- [ ] Classic mode title bar shows blue gradient, white bold text, inset highlight
- [ ] Default mode card/header is visually unchanged
- [ ] Toolbar has a search input that live-filters the BOM list by BOM code or item name (case-insensitive)
- [ ] Select-all checkbox selects/deselects only the currently filtered rows
- [ ] Bulk delete operates on `selectedIds` set regardless of current filter
- [ ] Selections outside the current filter are preserved when search query changes
- [ ] New BOM button is XP-styled (green gradient) in classic mode
- [ ] Delete Selected button is XP-styled (grey gradient) in classic mode
- [ ] Clear selection link is visible when `selectedIds.size > 0` (same condition as today), in both modes
- [ ] Table header has XP gradient (`#ffffff` → `#d4d0c8`) in classic mode
- [ ] Rows alternate `#fff` / `#f5f3ee` in classic mode; selected rows show `#d8e4f8`
- [ ] Column dividers (`1px solid #c0bdb5`) visible between cells in classic mode
- [ ] Materials tree qty is blue (`#0058e6`) and bold in both modes
- [ ] Item codes in materials tree are monospace grey (`#555`) in both modes
- [ ] Item names in materials tree are black (`#000`) in both modes
- [ ] Sub-BOM badge renders yellow (`#fff3cd` / `#b8860b` / `#6b4e00`) in both modes
- [ ] Nested sub-BOM indent uses `border-left: 2px solid #b0aaa0` in both modes
- [ ] Expand caret is `#0058e6` in classic mode; unchanged (`text-muted`) in default mode
- [ ] `card-body` wrapper has no Bootstrap classes in classic mode (no unwanted padding/border resets)
- [ ] When search returns zero results, a "No BOMs match your search" message is shown in the table body
- [ ] Select-all checkbox is unchecked (not checked) when the filtered list is empty
- [ ] Deselect-all (when all filtered rows are selected) removes only filtered rows from selection, preserving any hidden selections
- [ ] Select-all checkbox shows indeterminate state when some (but not all) filtered rows are selected
- [ ] `maxHeight: calc(100vh - 150px)` and `overflowY: auto` on the table scroll wrapper is preserved in classic mode
