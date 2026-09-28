// Stock ledger reference_type → friendly label + chip tone, shared by the ledger
// view and its print modal. Unknown types fall back to a title-cased label and a
// neutral tone so new movement sources still render.
export type RefMeta = { label: string; tone: { background: string; borderColor: string; color: string } };

// Stored reference_type strings are mixed-case by history (PACKING vs Beam Mount vs
// manual) and some are queried by exact value server-side, so they are normalized
// here for display rather than rewritten in the ledger.
const T = {
    neutral: { background: '#e6e3da', borderColor: '#a8a292', color: '#444' },
    blue:    { background: '#dde8f5', borderColor: '#7f9db9', color: '#1a3d7a' },
    purple:  { background: '#e6ddf2', borderColor: '#9a82c0', color: '#4a2a7a' },
    green:   { background: '#dcefe0', borderColor: '#7faf87', color: '#1a5e2a' },
    teal:    { background: '#d6eef0', borderColor: '#6fb0b8', color: '#15565e' },
    amber:   { background: '#fbeccf', borderColor: '#c8a23a', color: '#6a4a00' },
    red:     { background: '#f6dcdc', borderColor: '#c08080', color: '#7a1a1a' },
};

const REF_META: Record<string, RefMeta> = {
    'manual':                 { label: 'Opening / Manual',    tone: T.neutral },
    'adjustment':             { label: 'Stock Adjustment',    tone: T.neutral },
    'Lot Opening':            { label: 'Lot Opening',         tone: T.neutral },
    'Manufacturing Order':    { label: 'Manufacturing',       tone: T.blue },
    'Work Order':             { label: 'Work Order',          tone: T.purple },
    'Staging':                { label: 'Staging',             tone: T.purple },
    'Beam Mount':             { label: 'Beam Mount',          tone: T.purple },
    'Beam Dismount':          { label: 'Beam Dismount',       tone: T.purple },
    'Beam Merge':             { label: 'Beam Merge',          tone: T.purple },
    'Beam Leftover':          { label: 'Beam Leftover',       tone: T.purple },
    'Beam Leftover Variance': { label: 'Beam Variance',       tone: T.purple },
    'Goods Receipt':          { label: 'Goods Receipt',       tone: T.green },
    'Purchase Order':         { label: 'Purchase Order',      tone: T.teal },
    'PACKING':                { label: 'Packing',             tone: T.teal },
    'PACKING_MATERIAL':       { label: 'Packing Material',    tone: T.teal },
    'PICKING':                { label: 'Picking / Dispatch',  tone: T.teal },
    'Transfer':               { label: 'Transfer',            tone: T.amber },
    'Split':                  { label: 'Lot Split',           tone: T.amber },
    'Lot Reassign':           { label: 'Lot Reassign',        tone: T.amber },
    'QC_REJECT':              { label: 'QC Reject',           tone: T.red },
    'PACKING_REJECT':         { label: 'Packing Reject',      tone: T.red },
    'QC Dispose':             { label: 'QC Dispose',          tone: T.red },
};

export const refMeta = (t: string): RefMeta =>
    REF_META[t] || { label: (t || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()), tone: T.neutral };

// Reference ids are often UUIDs — show a short head, keep the full value on hover.
export const shortRef = (id: string) => {
    if (!id) return '';
    const looksUuid = id.length > 14 && /[0-9a-f-]{12,}/i.test(id);
    return looksUuid ? id.slice(0, 8) + '…' : id;
};
