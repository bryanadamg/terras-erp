import { CODE_FONT } from './xpTheme';

// Audit `changes` is {field: [old, new]} (backend audit_service). Rows written before
// that convention can still hold a bare value, which renders as-is.
const fmt = (v: unknown) =>
    v === null || v === undefined || v === '' ? <i style={{ color: '#999' }}>empty</i>
        : typeof v === 'object' ? JSON.stringify(v) : String(v);

const isPair = (v: unknown): v is [unknown, unknown] => Array.isArray(v) && v.length === 2;

export const hasAuditChanges = (changes: any) =>
    !!changes && typeof changes === 'object' && Object.keys(changes).length > 0;

export default function AuditChanges({ changes, style }: { changes: any; style?: React.CSSProperties }) {
    if (!hasAuditChanges(changes)) return null;
    return (
        <div style={{
            fontFamily: CODE_FONT, fontSize: 10, background: '#fff', border: '1px solid #7f9db9',
            boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)', padding: '4px 6px', maxHeight: 160,
            overflow: 'auto', ...style,
        }}>
            {Object.entries(changes).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 1, wordBreak: 'break-word' }}>
                    <span style={{ color: '#1a4a8a', fontWeight: 'bold' }}>{k}</span>
                    <span style={{ color: '#808080' }}>: </span>
                    {isPair(v) ? (
                        <>
                            <span style={{ color: '#8b0000' }}>{fmt(v[0])}</span>
                            <span style={{ color: '#808080' }}> → </span>
                            <span style={{ color: '#006400' }}>{fmt(v[1])}</span>
                        </>
                    ) : <span>{fmt(v)}</span>}
                </div>
            ))}
        </div>
    );
}
