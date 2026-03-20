---
title: Work Order Print Preview Redesign
date: 2026-03-21
status: approved
---

# Work Order Print Preview Redesign

## Overview

Replace the current full-screen overlay print preview with a modal dialog that has a settings panel on the left and a live document preview on the right. Add print customization options (section toggles and custom header fields) that persist in `localStorage`.

## Scope

**Primary file:** `frontend/app/components/ManufacturingView.tsx`
**Supporting files:** `frontend/app/globals.css` (print CSS updates)

**`PrintHeader.tsx` is NOT used** in the new `PrintPreviewModal`. The modal renders its own always-visible company header (not `d-none d-print-block`). `PrintHeader.tsx` and the existing `WorkOrderPrintTemplate` remain untouched for the list-print path (`handlePrintList`).

**In scope:**
- New `PrintPreviewModal` component (extracted from `WorkOrderPrintTemplate`)
- Left panel: section toggles + custom header fields
- Right panel: scaled live document preview
- Settings persistence via `localStorage`
- Print button triggers `window.print()` from within the modal

**Out of scope:**
- Paper size / margin controls (delegated to browser print dialog)
- PDF export
- Any backend changes

---

## Design

### Current vs New Flow

**Current:** Print button → `setPrintingWO(wo)` → full-screen `position: fixed` overlay with `z-index: 2000` → `window.print()` → `setPrintingWO(null)`.

**New:** Print button → `setPrintPreviewWO(wo)` → modal dialog (left settings + right preview) → Print button in modal footer calls `window.print()` → modal closes.

The existing `WorkOrderPrintTemplate` component and `handlePrintList` (list print) are unaffected.

---

### State: Print Settings

A new `printSettings` state object, persisted to `localStorage` under key **`wo_print_settings`**:

```ts
interface PrintSettings {
  showBOMTable: boolean;       // default: true
  showTimeline: boolean;       // default: true
  showChildWOs: boolean;       // default: false
  showSignatureLine: boolean;  // default: true
  headerCompanyName: string;   // default: companyProfile.name || ''
  headerDepartment: string;    // default: ''
  headerApprovedBy: string;    // default: ''
  headerReference: string;     // default: ''
}
```

Loaded from `localStorage` via `useEffect` on component mount — the same `useEffect` that already loads `wo_code_config` and `ui_style`. Using `useEffect` (not a `useState` initializer) is required in Next.js 14 because `localStorage` is undefined during server-side rendering; the `useEffect` only runs client-side. Saved to `localStorage` whenever any field changes (debounce not needed — inputs are infrequent).

`headerCompanyName` is initialized from `localStorage` (or `''` if absent). Both the Company Name input control and the document header use `printSettings.headerCompanyName || companyProfile?.name || ''` as their displayed value. This means: if the user has no saved value, both the input and the document show the company profile name; once the user edits the input, `onChange` stores the new value into `printSettings.headerCompanyName`, which then takes precedence. A stored non-empty value always wins over the profile default.

---

### Component: PrintPreviewModal

A new inner component defined inside `ManufacturingView` (same pattern as `WOExpandedPanel` and `WorkOrderPrintTemplate`), with the following prop interface:

```ts
function PrintPreviewModal({
  wo,
  onClose,
  printSettings,
  onPrintSettingsChange,
}: {
  wo: any;
  onClose: () => void;
  printSettings: PrintSettings;
  onPrintSettingsChange: (updated: PrintSettings) => void;
})
```

**Outer shell:** `position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 2000; display: flex; align-items: center; justify-content: center`. Clicking the backdrop closes the modal.

**Modal box:** `background: #fff; width: 90vw; max-width: 960px; height: 88vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.4)`. XP bevel border in classic mode. The modal box is a column flex container with three children: modal header, body row (flex: 1; overflow: hidden), and modal footer.

**Body row** (between header and footer): `display: flex; flex-direction: row; flex: 1; overflow: hidden`. Contains the left panel and right panel side-by-side.

#### Modal Header

Classic mode:
```
background: linear-gradient(to right, #0058e6, #08a5ff)
color: #fff; font: bold 12px Tahoma; padding: 5px 10px
```
Default mode: `bg-primary text-white px-3 py-2`.

Content: `🖨 Print Work Order — {wo.code}` on the left; `✕` close button on the right.

#### Left Panel (settings)

`width: 230px; min-width: 230px; border-right: 1px solid #dee2e6; background: #f8f9fa; padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px`

**Section toggles group:**

Label: `font-size: 10px; font-weight: bold; text-transform: uppercase; color: #212529; letter-spacing: 0.5px` (near-black for contrast).

Each toggle:
```jsx
<label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#212529', cursor: 'pointer' }}>
  <input type="checkbox" checked={...} onChange={...} />
  Label text
</label>
```

QR Code toggle: `disabled`, `opacity: 0.5`; label appended with `(always on)` in `font-size: 10px; color: #555`.

Toggles (in order):
1. QR Code — always on, disabled
2. BOM / Materials Table — `showBOMTable`
3. Timeline — `showTimeline`
4. Child Work Orders — `showChildWOs`
5. Signature Line — `showSignatureLine`

**Divider:** `<hr style={{ margin: '0', borderColor: '#dee2e6' }} />`

**Header fields group:**

Label: same style as section toggles label (`color: #212529`).

Each field:
```jsx
<div>
  <div style={{ fontSize: '10px', color: '#212529', marginBottom: '3px', fontWeight: '500' }}>Field Name</div>
  <input type="text" value={...} onChange={...}
    style={{ width: '100%', fontSize: '11px', padding: '3px 6px', border: '1px solid #ced4da', boxSizing: 'border-box', color: '#000' }}
  />
</div>
```

Fields (in order):
1. Company Name (`headerCompanyName`) — pre-filled from company profile
2. Department (`headerDepartment`)
3. Approved By (`headerApprovedBy`)
4. Reference No. (`headerReference`)

**Footer note** (pinned to bottom of left panel): `font-size: 10px; color: #555; margin-top: auto; padding-top: 8px; border-top: 1px solid #dee2e6` — text: `"Paper size & margins set in browser print dialog."`

#### Right Panel (preview)

`flex: 1; background: #e0e0e0; overflow-y: auto; padding: 16px; display: flex; justify-content: center`

Contains a **paper sheet** div:
```
background: #fff
width: 100%; max-width: 560px
padding: 24px 28px
box-shadow: 0 2px 10px rgba(0,0,0,0.25)
font-size: 9px; line-height: 1.5; color: #000
font-family: Arial, sans-serif
```

The paper sheet renders the live document (see Document Layout below). It updates reactively as settings change.

#### Modal Footer

`padding: 8px 12px; border-top: 1px solid #dee2e6; background: #f8f9fa; display: flex; justify-content: space-between; align-items: center`

Left: `font-size: 10px; color: #666` — `"Settings saved automatically"`

Right buttons (XP-styled in classic mode, Bootstrap in default):
- **Close** — grey XP button / `btn btn-sm btn-secondary`; calls `onClose()`
- **Print** — green XP button / `btn btn-sm btn-success`; calls `window.print()` then `onClose()`

---

### Document Layout (paper sheet content)

The document rendered in the preview and sent to the printer is the same JSX, controlled by `printSettings`.

#### Always rendered:

**Company header row** (two columns, separated by `border-bottom: 2px solid #000`):
- Left: If `companyProfile.logo_url` is set, show `<img>` (max-height: 64px, max-width: 200px, object-fit: contain) instead of the text name. Otherwise show `headerCompanyName` text (bold, 14px, `color: #0058e6`). Below the logo/name: address, phone, email from `companyProfile` (10px, `color: #555`).
- Right (text-right): "WORK ORDER" title (bold, 16px, uppercase), Department if set, Reference No. if set

**WO identity row** (QR + details, always rendered):
- QR code image (90×90px, `border: 2px solid #000`)
- WO code (monospace, 14px, bold, blue), status badge, then a 2-column grid: Item name, Qty, Target Start/End, Actual Start/End — only if `showTimeline` is true (see below)

#### Conditional sections:

**Timeline** (`showTimeline`): Controls two blocks in the WO identity row — (1) the target/actual date grid (`grid-template-columns: 1fr 1fr` with four date cells) and (2) the top flex-row that shows the status badge inline with start/end dates. When `showTimeline` is false, both blocks are hidden; only Item name and Qty remain visible.

**BOM / Materials Table** (`showBOMTable`): The full BOM table with Code, Component, Specs, Source, Required Qty. When off, the section is not rendered. Uses `renderPrintBOMLines`, which must be **hoisted** from inside `WorkOrderPrintTemplate` to the outer `ManufacturingView` scope (see Integration section) so both `WorkOrderPrintTemplate` and `PrintPreviewModal` can call it.

**Child Work Orders** (`showChildWOs`): The child WOs section at the bottom. When off, not rendered. Uses `renderChildWOsPrint`, which must likewise be **hoisted** from inside `WorkOrderPrintTemplate` to the outer `ManufacturingView` scope.

**Signature Line** (`showSignatureLine`): A footer row with `Printed: {date}` on the left and an `Authorized Signature` line on the right. When off, just the printed date is shown.

---

### Print DOM Strategy (Portal)

The paper sheet must print correctly while the modal chrome (backdrop, settings panel, header, footer) is hidden. Hiding the backdrop with `display: none` would also hide all its children — so the paper sheet **must not be a child of the backdrop element**.

**Implementation:** There are two separate instances of the document content:

1. **Preview instance** — rendered inside the right panel div (visible to the user, updates reactively as settings change).
2. **Print instance** — rendered via `ReactDOM.createPortal` into `document.body` as a sibling to the rest of the app. This is a second, independent render of the same document JSX, also driven by `printSettings` so it stays in sync with the preview.

Both instances share the same JSX document layout and the same `printSettings`/`qrDataUrl`/`childQrUrls` state — they differ only in their container. The backdrop and modal box remain in the normal component tree. This means `ManufacturingView.tsx` must import `createPortal` from `react-dom`.

The portal (print instance) is positioned offscreen during normal view (`position: fixed; left: -9999px; top: 0`) so it does not interfere with the UI, and is repositioned by CSS when `window.print()` fires. The preview instance is never shown during print (its parent — `#__next` — is hidden by the body class CSS rule).

### Print CSS

Add to `globals.css` `@media print` block:

```css
/* Hide everything during print when the WO print preview modal is open */
body.wo-print-preview-active > *:not(.wo-print-paper-portal) {
  display: none !important;
}
body.wo-print-preview-active .wo-print-paper-portal {
  display: block !important;
  position: static !important;
  left: 0 !important;
  width: 100% !important;
}
body.wo-print-preview-active .wo-print-paper-portal .wo-print-paper {
  box-shadow: none !important;
  padding: 20px !important;
  max-width: 100% !important;
  width: 100% !important;
}
```

The rules are scoped to `body.wo-print-preview-active` so they only fire while the modal is open. `PrintPreviewModal` adds this class to `document.body` on mount (`document.body.classList.add('wo-print-preview-active')`) and removes it on unmount (`document.body.classList.remove('wo-print-preview-active')`), via a `useEffect` cleanup. This means `handlePrintList` (which calls `window.print()` without opening the modal) is unaffected — the body class will not be present.

The portal `<div>` carries `className="wo-print-paper-portal"` as its **only class** and is rendered via `createPortal` into `document.body`. Do not add any other classes to this div. The print CSS sets it to `position: static; width: 100%` — its containing block will be `body`, which `globals.css` constrains to `width: 210mm` at print time. No additional width style is needed on the portal div itself. The existing `.print-container` rule is **not** used on the paper sheet to avoid the `position: absolute` conflict.

The existing `globals.css` `@media print` rule `.btn { display: none !important }` does not affect the paper sheet content — it affects the modal chrome, which is hidden by the `body.wo-print-preview-active > *:not(...)` rule anyway. No change to the `.btn` rule is needed.

---

### Integration into ManufacturingView

- The existing `const { authFetch } = useData()` destructure (line 35) must be updated to `const { authFetch, companyProfile } = useData()` so the company profile is available for the document header inside `PrintPreviewModal`. `PrintPreviewModal` is defined inside `ManufacturingView` and accesses `companyProfile` via closure — it is **not** passed as a prop.
- Hoist `renderPrintBOMLines` and `renderChildWOsPrint` from inside `WorkOrderPrintTemplate` to the outer `ManufacturingView` function scope, so both `WorkOrderPrintTemplate` and `PrintPreviewModal` can call them.
  - `renderPrintBOMLines` accesses `boms`, `getItemCode`, `getItemName`, `getAttributeValueName`, and `getLocationName` from the `ManufacturingView` scope by closure. It also uses `wo.qty`, `wo.source_location_id`, and `wo.location_id` from the enclosing `WorkOrderPrintTemplate` scope — after hoisting, `wo` is no longer in scope. **Add `wo` as the first parameter:** `renderPrintBOMLines(wo: any, lines: any[], level = 0, currentParentQty = 1, currentBOM: any)`. Update the internal recursive call at line 640 to pass `wo` as the first argument. Call sites: `renderPrintBOMLines(wo, bom.lines, 0, 1, bom)` in both `WorkOrderPrintTemplate` and `PrintPreviewModal`.
  - `renderChildWOsPrint` must accept the QR URL map as an explicit parameter: `renderChildWOsPrint(children: any[], qrUrls: Record<string, string>)`.
  - **Update the existing `WorkOrderPrintTemplate` call site** (currently `renderChildWOsPrint(wo.child_wos)`) to `renderChildWOsPrint(wo.child_wos, qrDataUrls)`.
  - The new `PrintPreviewModal` call site uses `renderChildWOsPrint(wo.child_wos, childQrUrls)`.
- Replace `const [printingWO, setPrintingWO] = useState<any>(null)` with `const [printPreviewWO, setPrintPreviewWO] = useState<any>(null)`.
- Remove `const [qrDataUrl, setQrDataUrl] = useState<string>('')` (singular) — this was used solely to pre-generate the main WO QR for the old overlay. The separate `const [qrDataUrls, setQrDataUrls] = useState<Record<string, string>>({})` (plural) is **retained unchanged**.
- Because `WorkOrderPrintTemplate` uses `qrDataUrl` (singular) at its QR `<img>` src, it can no longer rely on the outer state once that state is removed. Update `WorkOrderPrintTemplate` to manage its own QR: add `const [localQrUrl, setLocalQrUrl] = useState('')` inside `WorkOrderPrintTemplate`, and a `useEffect([wo.code])` that calls `QRCode.toDataURL(wo.code).then(setLocalQrUrl)`. Replace the `<img src={qrDataUrl} ...>` with `<img src={localQrUrl} ...>`. This makes `WorkOrderPrintTemplate` self-contained and removes the dependency on the outer state.
- The existing `handlePrintWO(wo)` function simplifies to: `setPrintPreviewWO(wo)` only (no QR pre-generation).
- `{printingWO && <WorkOrderPrintTemplate wo={printingWO} />}` is replaced with `{printPreviewWO && <PrintPreviewModal wo={printPreviewWO} onClose={() => setPrintPreviewWO(null)} printSettings={printSettings} onPrintSettingsChange={setPrintSettings} />}`.
- `printSettings` state and its `localStorage` load/save lives in `ManufacturingView` and is passed as props `printSettings` + `onPrintSettingsChange` to `PrintPreviewModal`. This keeps settings at the page level so they persist across multiple print dialogs in one session.
- `ManufacturingView` must import `createPortal` from `react-dom`.

**QR generation inside `PrintPreviewModal`:**

`PrintPreviewModal` has local state:
```ts
const [qrDataUrl, setQrDataUrl] = useState('');         // main WO QR
const [childQrUrls, setChildQrUrls] = useState<Record<string, string>>({});  // child WO QRs
```

`PrintPreviewModal` receives `printSettings` as a prop and destructures it: `const { showChildWOs, ... } = printSettings`. Because `printSettings` is loaded from `localStorage` in `ManufacturingView` before the modal mounts, `showChildWOs` already reflects the saved value when the modal opens.

A `useEffect([])` fires on mount: generates `QRCode.toDataURL(wo.code)` for the main WO into `qrDataUrl`. A second `useEffect([showChildWOs, wo.child_wos])` fires whenever `showChildWOs` changes (including on mount if it is `true`): when `showChildWOs` is `true`, iterate `wo.child_wos` and use the functional updater form `setChildQrUrls(prev => { ... })` to generate QRs for any codes not yet in `prev` — this avoids adding `childQrUrls` as a dependency and the stale-closure problem that would cause. When `showChildWOs` is `false`, do nothing (existing QR URLs are kept in state so re-enabling is instant).

`renderChildWOsPrint(wo.child_wos, childQrUrls)` is called inside the modal, passing the local `childQrUrls` map. The existing `WorkOrderPrintTemplate` call site passes `qrDataUrls` (the outer plural map) per the hoisting instruction above.

---

## Acceptance Criteria

- [ ] Clicking Print on a WO row opens a modal dialog (not a full-screen overlay)
- [ ] Modal has a left settings panel and a right document preview panel
- [ ] QR code is always rendered; its toggle is visible but disabled
- [ ] Section toggles (BOM Table, Timeline, Child WOs, Signature Line) immediately update the preview
- [ ] All settings panel labels and option text use `color: #212529` (near-black) for readable contrast
- [ ] Custom header fields (Company Name, Department, Approved By, Reference No.) render in the document header
- [ ] Company Name is pre-filled from company profile on first use
- [ ] Settings persist in `localStorage` under key `wo_print_settings`
- [ ] Clicking Print button calls `window.print()` and closes the modal
- [ ] Settings panel and modal chrome are hidden during printing; only the paper sheet prints
- [ ] Clicking the backdrop or Close button dismisses the modal without printing
- [ ] XP classic mode applies bevel border and gradient header to the modal
- [ ] `handlePrintList` and `WorkOrderPrintTemplate` are unmodified and continue to work as before (list-print regression)
