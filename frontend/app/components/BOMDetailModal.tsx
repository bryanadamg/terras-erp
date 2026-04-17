'use client';

import { useState, useEffect } from 'react';
import ModalWrapper from './ModalWrapper';
import { useTheme } from '../context/ThemeContext';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';

interface BOMDetailModalProps {
    bom: any | null;
    isOpen: boolean;
    onClose: () => void;
    boms: any[];
    items: any[];
    locations: any[];
    attributes: any[];
    operations: any[];
    workCenters: any[];
}

type Tab = 'overview' | 'materials' | 'routing';
type StockMap = Record<string, number>; // item_id → total qty on hand (all locations summed)

export default function BOMDetailModal({
    bom, isOpen, onClose, boms, items, locations, attributes, operations, workCenters,
}: BOMDetailModalProps) {
    const [activeTab, setActiveTab] = useState<Tab>('overview');
    const [stockMap, setStockMap] = useState<StockMap>({});
    const [loadingStock, setLoadingStock] = useState(false);
    const { uiStyle } = useTheme();
    const classic = uiStyle === 'classic';

    useEffect(() => {
        if (!isOpen || !bom) return;
        setActiveTab('overview');
        setStockMap({});

        const token = localStorage.getItem('access_token');
        setLoadingStock(true);
        fetch(`${API_BASE}/stock/balance`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(r => r.ok ? r.json() : [])
            .then((balances: any[]) => {
                const map: StockMap = {};
                for (const b of balances) {
                    const id = String(b.item_id);
                    map[id] = (map[id] || 0) + (b.qty || 0);
                }
                setStockMap(map);
            })
            .catch(() => {})
            .finally(() => setLoadingStock(false));
    }, [isOpen, bom?.id]);

    if (!bom) return null;

    // ── Lookup helpers ────────────────────────────────────────────────────
    const getItemName = (id: string, name?: string) =>
        name || items.find((i: any) => i.id === id)?.name || id;
    const getItemCode = (id: string, code?: string) =>
        code || items.find((i: any) => i.id === id)?.code || id;
    const getOpName = (id: string) =>
        operations.find((o: any) => o.id === id)?.name || id;
    const getWcName = (id: string | null) =>
        id ? (workCenters.find((w: any) => w.id === id)?.name || id) : '—';
    const getAttrValues = (ids: string[]) => {
        if (!ids?.length || !attributes) return '—';
        const names = ids.map(valId => {
            for (const attr of attributes) {
                const val = attr.values?.find((v: any) => v.id === valId);
                if (val) return val.value;
            }
            return null;
        }).filter(Boolean);
        return names.length ? names.join(', ') : '—';
    };

    // ── Derived values ────────────────────────────────────────────────────
    const lines: any[] = bom.lines || [];
    const ops: any[] = (bom.operations || []).slice().sort((a: any, b: any) => a.sequence - b.sequence);
    const totalMinutes = ops.reduce((sum: number, op: any) => sum + (op.time_minutes || 0), 0);
    const subBOMCount = lines.filter((l: any) => boms.some((b: any) => b.item_id === l.item_id)).length;

    // ── Stock indicators ──────────────────────────────────────────────────
    type StockLevel = 'ok' | 'low' | 'out';
    const stockLevel = (line: any): StockLevel => {
        if (loadingStock) return 'ok';
        const onHand = stockMap[String(line.item_id)] ?? null;
        if (onHand === null) return 'ok';
        if (onHand === 0) return 'out';
        if (!line.is_percentage && onHand < line.qty) return 'low';
        return 'ok';
    };
    const stockColors: Record<StockLevel, { dot: string; border: string; text: string }> = {
        ok:  { dot: '#00aa00', border: '#005500', text: '#004400' },
        low: { dot: '#ccaa00', border: '#886600', text: '#553300' },
        out: { dot: '#cc0000', border: '#660000', text: '#660000' },
    };

    // ── Classic shared styles ─────────────────────────────────────────────
    const xpInset: React.CSSProperties = {
        background: '#fff',
        border: '2px solid',
        borderColor: '#808080 #dfdfdf #dfdfdf #808080',
        padding: '8px 10px',
        marginBottom: 8,
    };
    const xpSectionHeading: React.CSSProperties = {
        background: 'linear-gradient(to bottom, #fff 0%, #d6d3ce 100%)',
        border: '1px solid #808080',
        borderTopColor: '#fff',
        borderLeftColor: '#fff',
        fontSize: 11,
        fontWeight: 'bold',
        color: '#000',
        padding: '3px 8px',
        marginBottom: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
    };
    const xpTh: React.CSSProperties = {
        background: 'linear-gradient(to bottom, #ffffff 0%, #d6d3ce 100%)',
        border: '1px solid #808080',
        borderTopColor: '#fff',
        borderLeftColor: '#fff',
        padding: '3px 7px',
        textAlign: 'left',
        fontWeight: 'bold',
        color: '#000',
        whiteSpace: 'nowrap',
        fontFamily: 'Tahoma, Arial, sans-serif',
        fontSize: 11,
    };
    const xpTd: React.CSSProperties = {
        border: '1px solid #d6d3ce',
        padding: '3px 7px',
        verticalAlign: 'middle',
        color: '#000',
        fontFamily: 'Tahoma, Arial, sans-serif',
        fontSize: 11,
        whiteSpace: 'nowrap',
    };
    const xpFooterTd: React.CSSProperties = {
        ...xpTd,
        background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)',
        fontWeight: 'bold',
        borderTop: '1px solid #808080',
    };

    // ── Tab bar ───────────────────────────────────────────────────────────
    const tabItems: { key: Tab; label: string; count?: number }[] = [
        { key: 'overview',  label: 'Overview' },
        { key: 'materials', label: 'Materials', count: lines.length },
        { key: 'routing',   label: 'Routing',   count: ops.length },
    ];

    const renderTabBar = () => {
        if (classic) {
            return (
                <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', padding: '0 2px', position: 'relative', zIndex: 1 }}>
                    {tabItems.map(tab => {
                        const active = activeTab === tab.key;
                        return (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                style={{
                                    padding: active ? '3px 14px 5px' : '4px 14px 5px',
                                    background: active
                                        ? '#ece9d8'
                                        : 'linear-gradient(to bottom, #f0f0e8 0%, #d4d0c8 100%)',
                                    border: '1px solid #808080',
                                    borderBottom: 'none',
                                    borderTop: active ? '2px solid #dfdfdf' : '1px solid #808080',
                                    borderLeft: active ? '2px solid #dfdfdf' : '1px solid #808080',
                                    fontFamily: 'Tahoma, Arial, sans-serif',
                                    fontSize: 11,
                                    fontWeight: active ? 'bold' : 'normal',
                                    color: '#000',
                                    cursor: 'pointer',
                                    position: 'relative',
                                    bottom: -1,
                                    zIndex: active ? 2 : 1,
                                }}
                            >
                                {tab.label}
                                {tab.count !== undefined && (
                                    <span style={{ fontSize: 10, color: active ? '#222' : '#555', marginLeft: 3 }}>
                                        ({tab.count})
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            );
        }
        return (
            <ul className="nav nav-tabs mb-3">
                {tabItems.map(tab => (
                    <li key={tab.key} className="nav-item">
                        <button
                            className={`nav-link${activeTab === tab.key ? ' active' : ''}`}
                            onClick={() => setActiveTab(tab.key)}
                        >
                            {tab.label}
                            {tab.count !== undefined && (
                                <span className="badge bg-secondary ms-1" style={{ fontSize: '0.7rem' }}>
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    </li>
                ))}
            </ul>
        );
    };

    // ── Overview tab ──────────────────────────────────────────────────────
    const renderOverview = () => {
        const fieldLabel: React.CSSProperties = classic
            ? { fontSize: 10, color: '#444', marginBottom: 1, fontFamily: 'Tahoma, Arial, sans-serif' }
            : { fontSize: '0.75rem', color: '#6b7280', marginBottom: 2 };
        const fieldValue: React.CSSProperties = classic
            ? { fontSize: 12, color: '#000', fontWeight: 600, fontFamily: 'Tahoma, Arial, sans-serif' }
            : { fontSize: '0.9rem', fontWeight: 600, color: '#111' };
        const fieldMono: React.CSSProperties = classic
            ? { fontFamily: "'Courier New', monospace", color: '#0000cc', fontSize: 12 }
            : { fontFamily: 'monospace', color: '#2563eb', fontSize: '0.9rem' };
        const gridWrap: React.CSSProperties = {
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: classic ? '8px 20px' : '12px 24px',
        };
        const summaryNums = [
            { value: lines.length,           label: 'Materials' },
            { value: ops.length,             label: 'Operations' },
            { value: totalMinutes.toFixed(0),label: 'Total Min.' },
            { value: subBOMCount,            label: 'Sub-BOMs' },
        ];

        return (
            <>
                {classic && <div style={xpSectionHeading}>📦 Bill of Materials Information</div>}
                <div style={classic ? xpInset : { background: '#f9fafb', borderRadius: 6, padding: '12px 16px', marginBottom: 12 }}>
                    <div style={gridWrap}>
                        <div>
                            <div style={fieldLabel}>BOM Code</div>
                            <div style={{ ...fieldValue, ...fieldMono }}>{bom.code}</div>
                        </div>
                        <div>
                            <div style={fieldLabel}>Status</div>
                            <div style={{ ...fieldValue, color: bom.active ? '#005500' : '#880000' }}>
                                <span style={{
                                    display: 'inline-block', width: 8, height: 8,
                                    background: bom.active ? '#00aa00' : '#cc0000',
                                    border: `1px solid ${bom.active ? '#005500' : '#660000'}`,
                                    marginRight: 5, verticalAlign: 'middle',
                                }} />
                                {bom.active ? 'Active' : 'Inactive'}
                            </div>
                        </div>
                        <div>
                            <div style={fieldLabel}>Finished Good</div>
                            <div style={fieldValue}>{getItemName(bom.item_id, bom.item_name)}</div>
                            <div style={fieldMono}>{getItemCode(bom.item_id, bom.item_code)}</div>
                        </div>
                        <div>
                            <div style={fieldLabel}>Variant / Attributes</div>
                            <div style={{ ...fieldValue, fontWeight: 'normal', fontSize: classic ? 11 : undefined }}>
                                {getAttrValues(bom.attribute_value_ids || [])}
                            </div>
                        </div>
                        <div>
                            <div style={fieldLabel}>Output Quantity</div>
                            <div style={fieldValue}>
                                {Number(bom.qty).toFixed(4)}
                                <span style={{ color: '#666', fontWeight: 'normal', marginLeft: 4, fontSize: classic ? 11 : '0.85rem' }}>
                                    PCS
                                </span>
                            </div>
                        </div>
                        <div>
                            <div style={fieldLabel}>Tolerance</div>
                            <div style={fieldValue}>±{Number(bom.tolerance_percentage).toFixed(2)}%</div>
                        </div>
                        {bom.description && (
                            <div style={{ gridColumn: '1 / -1' }}>
                                <div style={fieldLabel}>Description</div>
                                <div style={{ ...fieldValue, fontWeight: 'normal', fontSize: classic ? 11 : '0.875rem', color: '#444' }}>
                                    {bom.description}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {classic && <div style={xpSectionHeading}>📊 Quick Summary</div>}
                {!classic && (
                    <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                        Quick Summary
                    </div>
                )}
                <div style={classic
                    ? { ...xpInset, marginBottom: 0 }
                    : { background: '#f9fafb', borderRadius: 6, padding: '10px 16px' }
                }>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', textAlign: 'center' }}>
                        {summaryNums.map((s, i) => (
                            <div key={s.label} style={{ borderLeft: i > 0 ? `1px solid ${classic ? '#d0d0d0' : '#e5e7eb'}` : undefined, padding: '4px 0' }}>
                                <div style={{ fontSize: classic ? 20 : 22, fontWeight: 'bold', color: '#0000cc', fontFamily: 'Tahoma, Arial, sans-serif' }}>
                                    {s.value}
                                </div>
                                <div style={{ fontSize: 10, color: '#555' }}>{s.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </>
        );
    };

    // ── Materials tab ─────────────────────────────────────────────────────
    const renderMaterials = () => (
        <>
            {classic && <div style={xpSectionHeading}>⚙ Component Materials</div>}
            <table style={classic ? {
                width: '100%', borderCollapse: 'collapse', border: '1px solid #808080',
                background: '#fff', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: 11,
            } : undefined}
                className={classic ? '' : 'table table-sm table-bordered'}
            >
                <thead>
                    <tr>
                        <th style={classic ? xpTh : undefined}>Item Code</th>
                        <th style={classic ? xpTh : undefined}>Item Name</th>
                        <th style={classic ? { ...xpTh, textAlign: 'right' } : { textAlign: 'right' }}>Qty Req.</th>
                        <th style={classic ? xpTh : undefined}>Stock</th>
                        <th style={classic ? xpTh : undefined}>Source Loc.</th>
                        <th style={classic ? xpTh : undefined}>Attributes</th>
                    </tr>
                </thead>
                <tbody>
                    {lines.map((line: any) => {
                        const isSubBOM = boms.some((b: any) => b.item_id === line.item_id);
                        const level = stockLevel(line);
                        const sc = stockColors[level];
                        const onHand = stockMap[String(line.item_id)];

                        return (
                            <tr key={line.id}>
                                <td style={classic ? xpTd : undefined}>
                                    <span style={classic ? {
                                        fontFamily: "'Courier New', monospace", color: '#0000cc',
                                        fontSize: 11, background: '#f0f0f0', padding: '0 3px',
                                        border: '1px solid #d0d0d0',
                                    } : undefined}
                                        className={classic ? '' : 'badge bg-light text-primary border font-monospace me-1'}
                                    >
                                        {getItemCode(line.item_id, line.item_code)}
                                    </span>
                                    {isSubBOM && (
                                        <span style={classic ? {
                                            background: '#e6eeff', border: '1px solid #0058e6',
                                            color: '#003080', fontSize: 9, padding: '0 3px',
                                            fontWeight: 'bold', marginLeft: 3,
                                        } : undefined}
                                            className={classic ? '' : 'badge bg-primary-subtle text-primary ms-1'}
                                        >
                                            Sub
                                        </span>
                                    )}
                                </td>
                                <td style={classic ? xpTd : undefined}>
                                    {getItemName(line.item_id, line.item_name)}
                                </td>
                                <td style={classic ? { ...xpTd, textAlign: 'right', fontWeight: 'bold' } : { textAlign: 'right' }}>
                                    {line.is_percentage ? (
                                        <span style={classic ? {
                                            background: '#fffbe6', border: '1px solid #c8a800',
                                            color: '#553300', fontSize: 9, padding: '0 3px',
                                        } : undefined}
                                            className={classic ? '' : 'badge bg-warning-subtle text-warning-emphasis'}
                                        >
                                            {Number(line.qty).toFixed(2)}%
                                        </span>
                                    ) : Number(line.qty).toFixed(4)}
                                </td>
                                <td style={classic ? xpTd : undefined}>
                                    {loadingStock ? (
                                        <span style={{ color: '#888', fontSize: 10 }}>…</span>
                                    ) : (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                                            <span style={{
                                                display: 'inline-block', width: 9, height: 9, flexShrink: 0,
                                                background: sc.dot, border: `1px solid ${sc.border}`,
                                            }} />
                                            <span style={{ fontSize: 11, fontWeight: 'bold', color: sc.text, fontFamily: 'Tahoma, Arial, sans-serif' }}>
                                                {onHand !== undefined ? Number(onHand).toFixed(0) : '—'}
                                            </span>
                                        </div>
                                    )}
                                </td>
                                <td style={classic ? xpTd : undefined}>
                                    {line.source_location_id ? (
                                        <span style={classic ? {
                                            background: '#eef8ee', border: '1px solid #4a9a4a',
                                            color: '#1a5a1a', fontSize: 9, padding: '0 3px',
                                        } : undefined}
                                            className={classic ? '' : 'badge bg-success-subtle text-success-emphasis'}
                                        >
                                            {locations.find((l: any) => l.id === line.source_location_id)?.name || line.source_location_id}
                                        </span>
                                    ) : '—'}
                                </td>
                                <td style={classic ? { ...xpTd, color: '#555', fontSize: 10 } : { fontSize: '0.8rem', color: '#6b7280' }}>
                                    {getAttrValues(line.attribute_value_ids || [])}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
                <tfoot>
                    <tr>
                        <td colSpan={2} style={classic ? { ...xpFooterTd, textAlign: 'right', color: '#555' } : { textAlign: 'right', color: '#6b7280', fontSize: '0.8rem' }}>
                            {lines.length} line{lines.length !== 1 ? 's' : ''} — {subBOMCount} sub-assembl{subBOMCount === 1 ? 'y' : 'ies'}
                        </td>
                        <td colSpan={4} style={classic ? xpFooterTd : undefined} />
                    </tr>
                </tfoot>
            </table>
            <div style={{ marginTop: 6, fontSize: 10, color: '#555', paddingLeft: 2 }}>
                Stock:&nbsp;
                <span style={{ color: stockColors.ok.text,  fontWeight: 'bold' }}>■</span> Sufficient &nbsp;
                <span style={{ color: stockColors.low.text, fontWeight: 'bold' }}>■</span> Below req. &nbsp;
                <span style={{ color: stockColors.out.text, fontWeight: 'bold' }}>■</span> Out of stock
            </div>
        </>
    );

    // ── Routing tab ───────────────────────────────────────────────────────
    const renderRouting = () => {
        if (ops.length === 0) {
            return (
                <div style={{ color: '#888', fontStyle: 'italic', padding: '12px 0', fontSize: classic ? 11 : undefined }}>
                    No routing operations defined for this BOM.
                </div>
            );
        }
        return (
            <>
                {classic && <div style={xpSectionHeading}>🔧 Manufacturing Routing</div>}
                <table style={classic ? {
                    width: '100%', borderCollapse: 'collapse', border: '1px solid #808080',
                    background: '#fff', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: 11,
                } : undefined}
                    className={classic ? '' : 'table table-sm table-bordered'}
                >
                    <thead>
                        <tr>
                            <th style={classic ? { ...xpTh, textAlign: 'center', width: 48 } : { width: 60, textAlign: 'center' }}>Seq.</th>
                            <th style={classic ? xpTh : undefined}>Operation</th>
                            <th style={classic ? xpTh : undefined}>Work Center</th>
                            <th style={classic ? { ...xpTh, textAlign: 'right', width: 90 } : { textAlign: 'right', width: 100 }}>Time (min)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {ops.map((op: any) => (
                            <tr key={op.id}>
                                <td style={classic ? { ...xpTd, textAlign: 'center' } : { textAlign: 'center' }}>
                                    <span style={{
                                        background: '#0058e6', color: '#fff',
                                        padding: '1px 6px', fontSize: 10, fontWeight: 'bold',
                                        fontFamily: 'Tahoma, Arial, sans-serif',
                                    }}>
                                        {op.sequence}
                                    </span>
                                </td>
                                <td style={classic ? xpTd : undefined}>{getOpName(op.operation_id)}</td>
                                <td style={classic ? xpTd : undefined}>{getWcName(op.work_center_id)}</td>
                                <td style={classic ? { ...xpTd, textAlign: 'right', fontWeight: 'bold' } : { textAlign: 'right', fontWeight: 600 }}>
                                    {Number(op.time_minutes).toFixed(2)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colSpan={3} style={classic
                                ? { ...xpFooterTd, textAlign: 'right', color: '#555' }
                                : { textAlign: 'right', color: '#6b7280', fontSize: '0.85rem' }
                            }>
                                Total estimated time:
                            </td>
                            <td style={classic
                                ? { ...xpFooterTd, textAlign: 'right' }
                                : { textAlign: 'right', fontWeight: 600 }
                            }>
                                {totalMinutes.toFixed(2)}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </>
        );
    };

    // ── Panel wrapper (classic raised border under tabs) ──────────────────
    const panelStyle: React.CSSProperties = classic ? {
        background: '#ece9d8',
        border: '1px solid #808080',
        borderTop: '2px solid #dfdfdf',
        borderLeft: '2px solid #dfdfdf',
        padding: 10,
        marginTop: -1,
        position: 'relative',
        zIndex: 1,
    } : { paddingTop: 4 };

    return (
        <ModalWrapper
            isOpen={isOpen}
            onClose={onClose}
            title={
                <>
                    <i className="bi bi-list-ul me-1" />
                    {bom.code} — {getItemName(bom.item_id, bom.item_name)}
                </>
            }
            size="xl"
            variant="primary"
            footer={
                <button
                    onClick={onClose}
                    style={classic ? {
                        background: 'linear-gradient(to bottom, #fff 0%, #e1e0d8 100%)',
                        border: '1px solid',
                        borderColor: '#fff #808080 #808080 #fff',
                        padding: '3px 14px',
                        fontFamily: 'Tahoma, Arial, sans-serif',
                        fontSize: 11,
                        color: '#000',
                        cursor: 'pointer',
                        minWidth: 75,
                    } : undefined}
                    className={classic ? '' : 'btn btn-sm btn-secondary'}
                >
                    Close
                </button>
            }
        >
            {renderTabBar()}
            <div style={panelStyle}>
                {activeTab === 'overview'  && renderOverview()}
                {activeTab === 'materials' && renderMaterials()}
                {activeTab === 'routing'   && renderRouting()}
            </div>
        </ModalWrapper>
    );
}
