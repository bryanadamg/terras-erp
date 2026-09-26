// Stock ledger reference_type → friendly label + chip tone, shared by the ledger
// view and its print modal. Unknown types fall back to a title-cased label and a
// neutral tone so new movement sources still render.
export type RefMeta = { label: string; tone: { background: string; borderColor: string; color: string } };

const REF_META: Record<string, RefMeta> = {
    'manual':              { label: 'Manual Adjustment', tone: { background: '#e6e3da', borderColor: '#a8a292', color: '#444' } },
    'Manufacturing Order': { label: 'Manufacturing',     tone: { background: '#dde8f5', borderColor: '#7f9db9', color: '#1a3d7a' } },
    'Work Order':          { label: 'Work Order',        tone: { background: '#e6ddf2', borderColor: '#9a82c0', color: '#4a2a7a' } },
    'Goods Receipt':       { label: 'Goods Receipt',     tone: { background: '#dcefe0', borderColor: '#7faf87', color: '#1a5e2a' } },
    'Purchase Order':      { label: 'Purchase Order',    tone: { background: '#d6eef0', borderColor: '#6fb0b8', color: '#15565e' } },
    'Transfer':            { label: 'Transfer',          tone: { background: '#fbeccf', borderColor: '#c8a23a', color: '#6a4a00' } },
};

export const refMeta = (t: string): RefMeta =>
    REF_META[t] || { label: (t || '').replace(/_/g, ' '), tone: { background: '#e0dfd8', borderColor: '#b0a898', color: '#333' } };

// Reference ids are often UUIDs — show a short head, keep the full value on hover.
export const shortRef = (id: string) => {
    if (!id) return '';
    const looksUuid = id.length > 14 && /[0-9a-f-]{12,}/i.test(id);
    return looksUuid ? id.slice(0, 8) + '…' : id;
};
