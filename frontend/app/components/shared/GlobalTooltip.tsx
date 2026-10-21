'use client';

// Parks native `title`s app-wide and echoes clipped text in the styled bubble —
// extracted into terras-ui's Tooltip module from this file, unchanged. A default
// export kept for layout.tsx, a server component importing across the client
// boundary (hence import-then-export rather than a re-export).
import { GlobalTooltip } from '@bryanadamg/terras-ui/components/Tooltip';

export default GlobalTooltip;
