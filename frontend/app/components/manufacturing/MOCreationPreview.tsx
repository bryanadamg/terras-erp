'use client';
import React from 'react';
import { useTheme } from '../../context/ThemeContext';

interface MOCreationPreviewProps {
    bomId: string;
    qty: number;
    locationCode: string;
    sourceLocationCode: string;
    createNested: boolean;
    boms: any[];
    locations: any[];
    stockBalance: any[];
    depth?: number;
}

const MAX_DEPTH = 6;

const DEPTH_COLORS = ['#15803d', '#1e40af', '#6d28d9', '#b45309', '#0e7490'];

function calcRequired(parentQty: number, line: any, bom: any): number {
    let req: number;
    if (line.percentage > 0) {
        req = (parentQty * line.percentage) / 100;
    } else {
        req = parentQty * parseFloat(line.qty || 0);
    }
    const tol = parseFloat(bom?.tolerance_percentage || 0);
    if (tol > 0) req = req * (1 + tol / 100);
    return req;
}

function getAvailable(stockBalance: any[], itemId: string, locationId: string, attributeValueIds: string[] = []): number {
    if (!locationId) return 0;
    const targetKey = [...attributeValueIds].map(String).sort().join(',');
    return stockBalance
        .filter((s: any) => {
            if (String(s.item_id) !== String(itemId)) return false;
            if (String(s.location_id) !== String(locationId)) return false;
            if (attributeValueIds.length > 0) {
                const sKey = [...(s.attribute_value_ids || [])].map(String).sort().join(',');
                return sKey === targetKey;
            }
            return true;
        })
        .reduce((sum: number, s: any) => sum + parseFloat(s.qty), 0);
}

export default function MOCreationPreview({
    bomId,
    qty,
    locationCode,
    sourceLocationCode,
    createNested,
    boms,
    locations,
    stockBalance,
    depth = 0,
}: MOCreationPreviewProps) {
    const { uiStyle } = useTheme();
    const classic = uiStyle === 'classic';

    const bom = boms.find((b: any) => b.id === bomId);
    if (!bom || !qty || qty <= 0 || depth > MAX_DEPTH) return null;

    const outputLoc = locations.find((l: any) => l.code === locationCode);
    const sourceLoc = locations.find((l: any) => l.code === sourceLocationCode);
    const outputLocId = outputLoc?.id;
    const sourceLocId = sourceLoc?.id;

    const accentColor = DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)];

    // Pre-compute all line data
    const lineData = bom.lines.map((line: any) => {
        const req = calcRequired(qty, line, bom);
        const lineLocId = line.source_location_id || sourceLocId || outputLocId;
        const available = getAvailable(stockBalance, line.item_id, lineLocId, line.attribute_value_ids || []);
        const isEnough = available >= req;
        const subBOM = createNested
            ? boms.find((b: any) => b.item_id === line.item_id && b.active !== false)
            : null;
        const lineLoc = locations.find((l: any) => l.id === lineLocId);
        return { line, req, lineLocId, available, isEnough, subBOM, lineLoc };
    });

    const materialLines = lineData.filter((d: any) => !d.subBOM);
    const childLines = lineData.filter((d: any) => d.subBOM);
    const shortCount = materialLines.filter((d: any) => !d.isEnough).length;
    const allOk = shortCount === 0;

    // Card visual vars
    const cardBorder = classic
        ? `1px solid #808080`
        : `1px solid ${accentColor}30`;
    const cardLeftBorder = `3px solid ${accentColor}`;
    const headerBg = classic
        ? (depth === 0 ? 'linear-gradient(to bottom, #fff, #d4d0c8)' : '#e8e6df')
        : (depth === 0
            ? `linear-gradient(135deg, #f0fdf4, #dcfce7)`
            : depth === 1
                ? `linear-gradient(135deg, #eff6ff, #dbeafe)`
                : depth === 2
                    ? `linear-gradient(135deg, #faf5ff, #ede9fe)`
                    : depth === 3
                        ? `linear-gradient(135deg, #fffbeb, #fef3c7)`
                        : `linear-gradient(135deg, #ecfeff, #cffafe)`
        );
    const rowSep = classic ? '#c0bdb5' : '#f1f5f9';
    const oddRowBg = classic ? '#f5f3ee' : '#fafbfc';

    return (
        <div style={{
            border: cardBorder,
            borderLeft: cardLeftBorder,
            borderRadius: classic ? 0 : 5,
            overflow: 'hidden',
            marginBottom: 10,
            boxShadow: classic ? 'none' : '0 1px 4px rgba(0,0,0,0.07)',
            background: 'white',
        }}>
            {/* ── Card header ── */}
            <div style={{
                background: headerBg,
                borderBottom: classic ? '1px solid #808080' : `1px solid ${accentColor}20`,
                padding: '6px 10px',
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
                {/* Depth badge */}
                <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: accentColor,
                    background: `${accentColor}15`,
                    border: `1px solid ${accentColor}35`,
                    padding: '1px 6px',
                    borderRadius: classic ? 0 : 10,
                    flexShrink: 0,
                }}>
                    {depth === 0 ? 'ROOT MO' : `CHILD MO`}
                </span>

                {/* Item name */}
                <span style={{ fontSize: 12, fontWeight: 700, color: classic ? '#000' : '#0f172a' }}>
                    {bom.item_name}
                </span>

                {/* BOM code */}
                <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>
                    [{bom.code}]
                </span>

                {/* Tolerance badge */}
                {bom.tolerance_percentage > 0 && (
                    <span style={{
                        fontSize: 9, background: '#fef3c7', border: '1px solid #fbbf24',
                        color: '#92400e', padding: '1px 5px', borderRadius: classic ? 0 : 3,
                    }}>
                        +{bom.tolerance_percentage}% tol
                    </span>
                )}

                {/* Right side: qty + stock badge */}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {materialLines.length > 0 && (
                        <span style={{
                            fontSize: 9, fontWeight: 600,
                            background: allOk ? '#dcfce7' : '#fef2f2',
                            color: allOk ? '#15803d' : '#dc2626',
                            border: `1px solid ${allOk ? '#86efac' : '#fca5a5'}`,
                            padding: '2px 7px',
                            borderRadius: classic ? 0 : 10,
                        }}>
                            {allOk
                                ? <><i className="bi bi-check-circle-fill me-1"></i>All available</>
                                : <><i className="bi bi-exclamation-circle-fill me-1"></i>{shortCount} short</>
                            }
                        </span>
                    )}
                    {childLines.length > 0 && (
                        <span style={{
                            fontSize: 9, fontWeight: 600,
                            background: '#eff6ff', color: '#1d4ed8',
                            border: '1px solid #bfdbfe',
                            padding: '2px 7px',
                            borderRadius: classic ? 0 : 10,
                        }}>
                            <i className="bi bi-diagram-3 me-1"></i>{childLines.length} child MO{childLines.length > 1 ? 's' : ''}
                        </span>
                    )}
                    <span style={{
                        fontFamily: 'monospace', fontWeight: 700, fontSize: 14,
                        color: accentColor,
                    }}>
                        {qty.toFixed(2)}
                    </span>
                </div>
            </div>

            {/* ── Components table ── */}
            {bom.lines.length > 0 && (
                <div style={{ padding: '6px 10px 0' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                            <tr style={{ borderBottom: classic ? '1px solid #808080' : '1.5px solid #e2e8f0' }}>
                                {[
                                    { label: 'Component', align: 'left' as const },
                                    { label: '%', align: 'right' as const },
                                    { label: 'Required', align: 'right' as const },
                                    { label: 'In Stock', align: 'right' as const },
                                    { label: '', align: 'center' as const },
                                    { label: 'Source', align: 'left' as const },
                                ].map(h => (
                                    <th key={h.label} style={{
                                        padding: '3px 5px 3px 0', fontSize: 10,
                                        color: classic ? '#444' : '#94a3b8',
                                        fontWeight: 600, textAlign: h.align,
                                        whiteSpace: 'nowrap',
                                    }}>{h.label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {lineData.map(({ line, req, available, isEnough, subBOM, lineLoc }: any, i: number) => {
                                const stockLevel = isEnough ? 'ok' : available > 0 ? 'low' : 'out';
                                const dotStyle: Record<string, { dot: string; border: string }> = {
                                    ok:  { dot: '#00aa00', border: '#005500' },
                                    low: { dot: '#ccaa00', border: '#886600' },
                                    out: { dot: '#cc0000', border: '#660000' },
                                };
                                const dc = dotStyle[stockLevel];
                                return (
                                <tr key={line.id} style={{
                                    borderBottom: `1px solid ${rowSep}`,
                                    background: i % 2 === 0 ? 'transparent' : oddRowBg,
                                }}>
                                    {/* Component name */}
                                    <td style={{ padding: '4px 5px 4px 0' }}>
                                        <div style={{ fontWeight: 500, color: classic ? '#000' : '#1e293b' }}>{line.item_name}</div>
                                        <div style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace' }}>{line.item_code}</div>
                                    </td>
                                    {/* % */}
                                    <td style={{ padding: '4px 5px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: '#64748b' }}>
                                        {line.percentage > 0 ? `${parseFloat(line.percentage).toFixed(1)}%` : '—'}
                                    </td>
                                    {/* Required */}
                                    <td style={{ padding: '4px 5px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: classic ? '#000' : '#1e293b' }}>
                                        {req.toFixed(2)}
                                    </td>
                                    {/* In stock */}
                                    <td style={{ padding: '4px 5px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: subBOM ? '#64748b' : (isEnough ? '#004400' : available > 0 ? '#664400' : '#880000') }}>
                                        {subBOM ? '—' : available.toFixed(2)}
                                    </td>
                                    {/* Stock indicator */}
                                    <td style={{ padding: '4px 5px', textAlign: 'center', width: 20 }}>
                                        {subBOM ? (
                                            <i className="bi bi-arrow-return-right" style={{ fontSize: 10, color: '#3b82f6' }}></i>
                                        ) : (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'center' }}>
                                                <span style={{ display: 'inline-block', width: 9, height: 9, background: dc.dot, border: `1px solid ${dc.border}`, flexShrink: 0 }} />
                                                {stockLevel === 'low' && <span style={{ fontSize: 8, background: '#886600', color: '#fff', padding: '0 3px', fontWeight: 'bold' }}>Low</span>}
                                                {stockLevel === 'out' && <span style={{ fontSize: 8, background: '#880000', color: '#fff', padding: '0 3px', fontWeight: 'bold' }}>Out</span>}
                                            </div>
                                        )}
                                    </td>
                                    {/* Source location */}
                                    <td style={{ padding: '4px 0', fontSize: 10, color: '#64748b' }}>
                                        {lineLoc?.name || (line.source_location_id ? '?' : '—')}
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {bom.lines.length === 0 && (
                <div style={{ padding: '12px 10px', color: '#94a3b8', fontSize: 11, textAlign: 'center' }}>
                    No components defined in this BOM
                </div>
            )}

            {/* ── Child MO cards ── */}
            {childLines.length > 0 && depth < MAX_DEPTH && (
                <div style={{
                    margin: '8px 10px 10px',
                    paddingLeft: 10,
                    borderLeft: classic ? '2px solid #808080' : `2px solid ${accentColor}30`,
                }}>
                    <div style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
                        color: classic ? '#666' : '#94a3b8', marginBottom: 6,
                    }}>
                        Sub-assembly MOs
                    </div>
                    {childLines.map(({ line, req, subBOM }: any) => (
                        <MOCreationPreview
                            key={line.id}
                            bomId={subBOM.id}
                            qty={req}
                            locationCode={locationCode}
                            sourceLocationCode={sourceLocationCode}
                            createNested={createNested}
                            boms={boms}
                            locations={locations}
                            stockBalance={stockBalance}
                            depth={depth + 1}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
