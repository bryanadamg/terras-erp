'use client';
import React from 'react';
import { useData } from '../../context/DataContext';
import { CodeChip, CODE_FONT, colorHexFor, CHIP_RADIUS, VariantChip, VariantKind } from '../shared/xpTheme';
import { qtyFmt } from '../shared/format';
import { API_BASE } from '../shared/apiBase';


// Size / color / combo identity of a row. Several rows carry the same item name
// (one per size on a BOM entry, one per consolidated component key), so the chips
// are the only thing distinguishing them in the list.
export interface NettingChip {
    kind: 'size' | 'color' | 'combo' | 'attr' | string;
    label: string;
    hex?: string | null;
    group?: string | null;
}

export interface NettingNode {
    level: number;
    is_root: boolean;
    item_id: string;
    item_code: string;
    item_name: string;
    uom: string;
    net_from_location_id: string | null;
    net_from_location_name: string;
    gross_required: number;
    on_hand: number;
    incoming: number;
    required_other: number;
    reserved_other?: number;   // on-hand promised to OTHER open sales orders
    net_free: number;
    net_qty: number;
    decision: string; // MAKE_ROOT | MAKE | RESIZE | SKIP | FORCED | DECOUPLED
    chips?: NettingChip[];
}

// Fetches the dry-run netting plan from the backend (debounced). Both the MO
// panel and the PR modal use this so the preview is always what creation will do.
export function useNettingPreview(path: string, body: any, enabled: boolean) {
    const { authFetch } = useData();
    const [nodes, setNodes] = React.useState<NettingNode[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const bodyKey = JSON.stringify(body);

    React.useEffect(() => {
        if (!enabled) { setNodes([]); setError(null); setLoading(false); return; }
        let cancelled = false;
        setLoading(true); setError(null);
        const t = setTimeout(async () => {
            try {
                const res = await authFetch(`${API_BASE}${path}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: bodyKey,
                });
                if (cancelled) return;
                if (!res.ok) { setError('Could not compute the plan.'); setNodes([]); }
                else setNodes(await res.json());
            } catch {
                if (!cancelled) { setError('Could not compute the plan.'); setNodes([]); }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, 400);
        return () => { cancelled = true; clearTimeout(t); };
    }, [path, bodyKey, enabled, authFetch]);

    return { nodes, loading, error };
}

const DECISION: Record<string, { label: string; bg: string; fg: string; bd: string }> = {
    MAKE_ROOT: { label: 'Make (FG)', bg: '#eff6ff', fg: '#1d4ed8', bd: '#bfdbfe' },
    MAKE: { label: 'Make', bg: '#dcfce7', fg: '#15803d', bd: '#86efac' },
    RESIZE: { label: 'Resize', bg: '#fef3c7', fg: '#92400e', bd: '#fbbf24' },
    SKIP: { label: 'In stock', bg: '#f1f5f9', fg: '#64748b', bd: '#cbd5e1' },
    FORCED: { label: 'Forced', bg: '#fff7ed', fg: '#c2410c', bd: '#fdba74' },
    DECOUPLED: { label: 'Pooled separately', bg: '#faf5ff', fg: '#7e22ce', bd: '#e9d5ff' },
};

const num = qtyFmt(2);

// Chip kinds map onto the app-wide VARIANT_TONE — no local palette (this table
// used to have one, so a shade here was slate while the lot pickers drew it pink).
const CHIP_KIND: Record<string, VariantKind> = {
    size: 'size', color: 'color', combo: 'combo', attr: 'material',
};

function IdentityChips({ chips }: { chips?: NettingChip[] }) {
    if (!chips || chips.length === 0) return null;
    return (
        <>
            {chips.map((c, i) => {
                const kind = CHIP_KIND[c.kind] || 'material';
                const swatch = kind === 'color' ? (c.hex || colorHexFor(c.label)) : null;
                return (
                    <VariantChip
                        key={i} kind={kind} swatch={swatch}
                        title={c.group ? `${c.group}: ${c.label}` : c.label}
                    >
                        {kind === 'size' ? c.label.toUpperCase() : c.label}
                    </VariantChip>
                );
            })}
        </>
    );
}

export default function NettingPlanTable({
    nodes, loading, error,
}: { nodes: NettingNode[]; loading?: boolean; error?: string | null }) {

    const box: React.CSSProperties = {
        border: '1px solid #808080',
        borderRadius: 0, overflow: 'hidden', background: '#fff',
    };

    if (loading) return <div style={{ ...box, padding: 14, fontSize: 12, color: '#64748b' }}>Calculating net requirements…</div>;
    if (error) return <div style={{ ...box, padding: 14, fontSize: 12, color: '#dc2626' }}>{error}</div>;
    if (!nodes || nodes.length === 0)
        return <div style={{ ...box, padding: 14, fontSize: 12, color: '#94a3b8' }}>Pick a recipe and quantity to preview the plan.</div>;

    const made = nodes.filter(n => n.decision !== 'SKIP' && n.decision !== 'DECOUPLED').length;
    const skipped = nodes.filter(n => n.decision === 'SKIP').length;
    const decoupled = nodes.filter(n => n.decision === 'DECOUPLED').length;
    // With >1 finished good the component pool is consolidated/shared across them,
    // so it can't hang under a single root — section it and drop the misleading
    // "child of the last root" indent (component indent baselines at level 1).
    const multiRoot = nodes.filter(n => n.is_root).length > 1;
    const indentOf = (n: NettingNode) => (n.is_root ? 0 : (multiRoot ? n.level - 1 : n.level));
    const firstComponentIdx = nodes.findIndex(n => !n.is_root);

    const th = (align: 'left' | 'right'): React.CSSProperties => ({
        padding: '4px 6px', fontSize: 10, fontWeight: 600, textAlign: align, whiteSpace: 'nowrap',
        color: '#444',
    });
    const tdNum: React.CSSProperties = {
        padding: '4px 6px', textAlign: 'right', fontFamily: CODE_FONT, color: '#000',
    };

    return (
        <div style={box}>
            <div style={{
                display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px',
                background: '#e8e6df',
                borderBottom: '1px solid #808080', fontSize: 11,
            }}>
                <strong style={{ fontSize: 11 }}>Creation plan</strong>
                <span style={{ marginLeft: 'auto', color: '#15803d', fontWeight: 600 }}>{made} to make</span>
                {skipped > 0 && <span style={{ color: '#64748b' }}>· {skipped} covered by stock</span>}
                {decoupled > 0 && <span style={{ color: '#7e22ce' }}>· {decoupled} pooled separately</span>}
            </div>

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #808080'}}>
                            <th style={th('left')}>Component</th>
                            <th style={th('left')}>Decision</th>
                            <th style={th('left')}>Net from</th>
                            <th style={th('right')}>Required</th>
                            <th style={th('right')}>On hand</th>
                            <th style={th('right')}>Reserved</th>
                            <th style={th('right')}>Net free</th>
                            <th style={th('right')}>Make</th>
                        </tr>
                    </thead>
                    <tbody>
                        {nodes.map((n, i) => {
                            const d = DECISION[n.decision] || DECISION.MAKE;
                            const dim = n.decision === 'SKIP';
                            const divider = multiRoot && i === firstComponentIdx ? (
                                <tr key={`div-${i}`}>
                                    <td colSpan={8} style={{
                                        padding: '4px 10px', fontSize: 9, fontWeight: 700,
                                        letterSpacing: '0.06em', textTransform: 'uppercase',
                                        color: '#666',
                                        background: '#e8e6df',
                                        borderTop: '1px solid #808080',
                                        borderBottom: '1px solid #c0bdb5',
                                    }}>
                                        Shared components — consolidated across all finished goods above
                                    </td>
                                </tr>
                            ) : null;
                            return (
                                <React.Fragment key={i}>
                                {divider}
                                <tr style={{
                                    borderBottom: '1px solid #c0bdb5',
                                    background: i % 2 ? ('#f5f3ee') : 'transparent',
                                    opacity: dim ? 0.65 : 1,
                                }}>
                                    <td style={{ padding: `4px 6px 4px ${8 + indentOf(n) * 16}px` }}>
                                        <div style={{
                                            fontWeight: n.is_root ? 700 : 500,
                                            color: '#000',
                                            textDecoration: dim ? 'line-through' : 'none',
                                        }}>
                                            {indentOf(n) > 0 && <span style={{ color: '#cbd5e1' }}>└ </span>}{n.item_name}
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3, marginTop: 1 }}>
                                            <CodeChip code={n.item_code} tier={2} />
                                            <IdentityChips chips={n.chips} />
                                        </div>
                                    </td>
                                    <td style={{ padding: '4px 6px' }}>
                                        <span style={{
                                            fontSize: 9, fontWeight: 600, background: d.bg, color: d.fg,
                                            border: `1px solid ${d.bd}`, padding: '1px 6px',
                                            borderRadius: CHIP_RADIUS, whiteSpace: 'nowrap',
                                        }}>{d.label}</span>
                                    </td>
                                    <td style={{ padding: '4px 6px', color: '#475569', whiteSpace: 'nowrap' }}>
                                        {n.net_from_location_name || '—'}
                                    </td>
                                    <td style={tdNum}>{num(n.gross_required)}</td>
                                    <td style={tdNum}>{num(n.on_hand)}</td>
                                    {/* Reserved is the difference between "there is stock" and
                                        "there is stock you may plan against" — without it a
                                        planner reads On hand 400 / Net free 0 as a bug. */}
                                    <td style={{ ...tdNum, color: (n.reserved_other || 0) > 0 ? '#b45309' : '#cbd5e1' }}
                                        title={(n.reserved_other || 0) > 0
                                            ? 'Held for other open sales orders — on hand, but already promised'
                                            : undefined}>
                                        {num(n.reserved_other || 0)}
                                    </td>
                                    <td style={{ ...tdNum, color: n.net_free > 0 ? '#15803d' : '#94a3b8' }}
                                        title={`on hand ${num(n.on_hand)} + incoming ${num(n.incoming)} − other orders ${num(n.required_other)} − reserved ${num(n.reserved_other || 0)}`}>
                                        {num(n.net_free)}
                                    </td>
                                    <td style={{ ...tdNum, fontWeight: 700, color: n.net_qty > 0 ? ('#000') : '#cbd5e1' }}>
                                        {num(n.net_qty)}
                                    </td>
                                </tr>
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div style={{
                padding: '5px 10px', fontSize: 9, color: '#94a3b8',
                borderTop: '1px solid #c0bdb5',
            }}>
                Net free = on hand + incoming − demand from other open orders − stock reserved to other sales orders, at the source location (rolled up across its spots). Components covered by stock are not produced; on a sales-order run, the covered finished goods are reserved to that order so a later order cannot plan against the same stock. "Pooled separately" items are decoupling points — their demand is recorded but no order is created here; replenish them on a standalone pooled order.
            </div>
        </div>
    );
}
