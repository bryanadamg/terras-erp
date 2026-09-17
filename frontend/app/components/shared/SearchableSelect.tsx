'use client';

// Type-to-search single select — a thin adapter over terras-ui's Combobox, which
// was extracted from this file: same trigger well, same portaled popup, same
// 100-row render cap, and it listens for the same `terras-modal-reposition`
// event so a popup opened from a modeless dialog stays glued while the panel is
// dragged. Its unit conversion defaults are terras-ui's `scale` module, which is
// what `uiScale.ts` re-exports, so there is nothing to pass for interface scale.
//
// Kept as the import path because ~19 call sites import `SearchableSelect`, and
// the prop shape is unchanged.
import Combobox, { ComboboxOption } from '@bryanadamg/terras-ui/components/Combobox';

export type { ComboboxOption as Option };

export default Combobox;
