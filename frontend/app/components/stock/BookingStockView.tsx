'use client';

import { useState, useCallback, useMemo, useRef, Fragment } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import { xpFont, xpBtn, TableSkeleton, useTableSkeletonMetrics, useSortable, ExpandedRowPanel, expandedRowFrame, CodeChip, CODE_FONT, rowStateBg, CHIP_RADIUS, XP_BTN, VariantChip } from '../shared/xpTheme';
import { xpBevel as sharedXpBevel, xpTitleBar as sharedXpTitleBar, xpToolbar as sharedXpToolbar, SearchField, pageFillStyle } from '../shared/shellTheme';
import Pager from '../shared/Pager';
import { lvThead, lvSubTh, lvSubTd, lvSubTable, lvSubRow, lvSubCaption, ExpanderCell, LV_EXPANDER_COL_W, SortableTh, lvThSticky, lvZebra, TableEmpty } from '../shared/listViewTheme';
import { EPS, HEALTH, healthOf, TERM } from './bookingStockTheme';
import BookingStockInfoModal from './BookingStockInfoModal';

// Booking Stock: per-item material availability across all ongoing MOs.
//   net_free = on_hand + incoming - required
// Incoming = outstanding output of in-flight production MOs (production-only;
// purchase orders are not yet counted). Self-fetches /stock/availability.

const fmtQty = (n: number) =>
    Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

type Row = {
    item_id: string;
    item_code: string;
    item_name: string;
    uom: string;
    attribute_value_ids: string[];
    // Size bucket this row nets in (null = the unsized/generic pool). Netting is
    // size-aware, so one item+variant can appear once per size — without this chip
    // those rows are indistinguishable.
    size_label?: string | null;
    location_id: string;
    location_name: string;
    qty_on_hand: number;
    qty_required: number;
    qty_incoming: number;
    qty_reserved: number;
    qty_net_free: number;
    demand_mos: { mo_id: string; mo_code: string; mo_qty: number; required_qty: number }[];
    supply_mos: { mo_id: string; mo_code: string; mo_qty: number; incoming_qty: number }[];
    reserved_sos: { sales_order_id: string; so_number: string; reserved_qty: number }[];
};

export default function BookingStockView() {
    const { t } = useLanguage();
    const { authFetch, attributes = [] } = useData();

    const API_BASE = useMemo(() => {
        const env = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
        return env.replace(/\/api$/, '') + '/api';
    }, []);

    const PAGE_SIZE = 50;
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [infoOpen, setInfoOpen] = useState(false);

    // Page window, the 350ms-debounced `?search=` box, loading flag and the
    // stale-response race guard all come from the shared hook
    // (context/usePaginatedList.ts). A search change restarts at page 1 inside the
    // hook, so there is no separate page reset to keep in step here.
    const {
        rows, total, loading, error, page, setPage, searchInput, setSearch, refetch: fetchAvailability,
    } = usePaginatedFetch<Row>({
        endpoint: `${API_BASE}/stock/availability`,
        authFetch,
        pageSize: PAGE_SIZE,
    });

    const getAttrValueName = useCallback((valId: string) => {
        for (const attr of attributes) {
            const v = attr.values?.find((x: any) => x.id === valId);
            if (v) return v.value;
        }
        return valId;
    }, [attributes]);

    const variantLabel = useCallback((ids: string[]) =>
        (ids && ids.length) ? ids.map(getAttrValueName).join(' / ') : '', [getAttrValueName]);

    const { sorted, sort, toggle } = useSortable<Row>(rows, {
        item: (r) => r.item_name,
        variant: (r) => `${variantLabel(r.attribute_value_ids)} ${r.size_label || ''}`,
        on_hand: (r) => r.qty_on_hand,
        incoming: (r) => r.qty_incoming,
        required: (r) => r.qty_required,
        reserved: (r) => r.qty_reserved,
        net_free: (r) => r.qty_net_free,
    });

    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('booking-stock', listBodyRef, sorted.length > 0);

    const shortfallCount = useMemo(() => rows.filter(r => r.qty_net_free < -EPS).length, [rows]);
    const tightCount = useMemo(() => rows.filter(r => r.qty_net_free >= -EPS && r.qty_net_free <= EPS).length, [rows]);

    const rowKey = (r: Row) => `${r.item_id}-${r.attribute_value_ids.join(',')}-${r.size_label || ''}`;
    const toggleRow = (k: string) => setExpanded(prev => {
        const next = new Set(prev);
        next.has(k) ? next.delete(k) : next.add(k);
        return next;
    });

    const COLS: { key: string; label: string; align?: 'right' }[] = [
        { key: 'item', label: t('item') || 'Item' },
        { key: 'location', label: t('location') || 'Location' },
        { key: 'variant', label: t('variant') || 'Variant' },
        { key: 'on_hand', label: t('on_hand') || 'On Hand', align: 'right' },
        { key: 'incoming', label: t('incoming') || 'Incoming', align: 'right' },
        { key: 'required', label: t('required') || 'Required', align: 'right' },
        { key: 'reserved', label: t('reserved') || 'Reserved', align: 'right' },
        { key: 'net_free', label: t('net_free') || 'Net Free', align: 'right' },
    ];

    // ── MO drill-down (shared by both themes) ──────────────────────────────────
    // One side (Required by / Incoming from): mini table + bold total row underneath.
    const detailSide = (
        title: string, color: string, tint: string,
        items: { mo_id: string; mo_code: string; qty: number }[], sign: string, uom: string,
        codeLabel: string = 'MO',
    ) => {
        const total = items.reduce((s, m) => s + m.qty, 0);
        // Shared sub-table chrome, with the header band recoloured per side: this
        // panel's whole point is demand (amber) vs supply (green), so the tint and
        // rule colour are the one thing that deliberately varies per instance.
        const th: React.CSSProperties = { ...lvSubTh(), background: tint, color, borderBottom: `1px solid ${color}` };
        const td = lvSubTd();
        return (
            <div style={{ flex: '1 1 260px', minWidth: 240 }}>
                <div style={{ ...lvSubCaption(), color }}>
                    {title} ({items.length})
                </div>
                <table style={lvSubTable()}>
                    <thead>
                        <tr>
                            <th style={th}>{codeLabel}</th>
                            <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 ? (
                            <tr><td colSpan={2} style={{ ...td, color: '#999', fontStyle: 'italic' }}>—</td></tr>
                        ) : items.map((m, i) => (
                            <tr key={m.mo_id} style={lvSubRow(i)}>
                                <td style={{ ...td, fontFamily: CODE_FONT, color: '#1a3d90' }}>{m.mo_code}</td>
                                <td style={{ ...td, textAlign: 'right', color, whiteSpace: 'nowrap' }}>{sign}{fmtQty(m.qty)}</td>
                            </tr>
                        ))}
                    </tbody>
                    {items.length > 0 && (
                        <tfoot>
                            <tr>
                                <td style={{ ...td, borderTop: `2px solid ${color}`, fontWeight: 'bold', color }}>Total</td>
                                <td style={{ ...td, borderTop: `2px solid ${color}`, textAlign: 'right', fontWeight: 'bold', color, whiteSpace: 'nowrap' }}>
                                    {sign}{fmtQty(total)} {uom}
                                </td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        );
    };

    // The rail is health-coded here rather than selection-blue: this table's whole
    // job is shortfall triage, so the panel inherits the row's health color.
    const renderDetail = (r: Row) => (
        <ExpandedRowPanel style={{
            display: 'flex', gap: 24, flexWrap: 'wrap',
            ...expandedRowFrame(healthOf(r.qty_net_free).color),
            padding: '8px 12px 10px 20px',
        }}>
            {detailSide(
                t('demand_from_mos') || 'Required by', HEALTH.tight.color, '#fff3d6',
                r.demand_mos.map(m => ({ mo_id: m.mo_id, mo_code: m.mo_code, qty: m.required_qty })),
                '', r.uom,
            )}
            {detailSide(
                t('incoming_from_mos') || 'Incoming from', TERM.incoming, '#e2f3e2',
                r.supply_mos.map(m => ({ mo_id: m.mo_id, mo_code: m.mo_code, qty: m.incoming_qty })),
                '+', r.uom,
            )}
            {/* Only when something is held: an empty third pane on every row would
                cost the two real ones their width for nothing. */}
            {(r.reserved_sos || []).length > 0 && detailSide(
                t('reserved_by_sos') || 'Reserved by', TERM.reserved, '#f7e6f2',
                r.reserved_sos.map(x => ({ mo_id: x.sales_order_id, mo_code: x.so_number, qty: x.reserved_qty })),
                '', r.uom, 'SO',
            )}
        </ExpandedRowPanel>
    );

    const xpBevel: React.CSSProperties = sharedXpBevel();
    const xpTitleBar: React.CSSProperties = sharedXpTitleBar();
    const xpToolbar: React.CSSProperties = sharedXpToolbar({ gap: '6px' });
    const xpTableHeader: React.CSSProperties = lvThSticky({ borderRight: '1px solid #b0aa9c' });
    const xpSep: React.CSSProperties = { width: '1px', height: '20px', background: '#a0988c', margin: '0 2px', flexShrink: 0 };

    const colLine: React.CSSProperties = { borderRight: '1px solid #d8d4c8' };
    const numCell: React.CSSProperties = { padding: '4px 8px', textAlign: 'right', fontFamily: xpFont, fontSize: '11px', whiteSpace: 'nowrap', ...colLine };
    const numCellM: React.CSSProperties = { whiteSpace: 'nowrap' };

    return (
        <div className={'fade-in'} style={pageFillStyle}>
            <div style={{ ...xpBevel, display: 'flex', flexDirection: 'column', flex: 1 }} className={undefined}>
                <div style={xpTitleBar} className={undefined}>
                    <span className={undefined}>
                        <i className={'bi bi-bookmark-check'} style={{ marginRight: 6 }} />
                        {t('booking_stock') || 'Booking Stock'}
                    </span>
                    <span style={{ fontSize: '10px', opacity: 0.85 }} className={undefined}>{total} items</span>
                </div>

                <div style={xpToolbar} className={undefined}>
                    <SearchField classic value={searchInput} onChange={setSearch} placeholder="Search item..." width={200} />
                    <div style={xpSep} />
                    <button style={xpBtn()} className={XP_BTN} onClick={fetchAvailability} title={'Refresh'}>
                        <i className={'bi bi-arrow-clockwise'} style={{ marginRight: 4 }} />Refresh
                    </button>
                    {/* Opens modeless, so the explanation can stay up while the reader
                        scrolls the table it describes. */}
                    <button style={xpBtn()} className={XP_BTN}
                        onClick={() => setInfoOpen(true)}
                        title={t('how_booking_stock_calculated') || 'How is Booking Stock calculated?'}>
                        <i className={'bi bi-info-circle'} style={{ marginRight: 4 }} />
                        {t('how_calculated') || 'How is this calculated?'}
                    </button>
                    {/* Legend */}
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, fontFamily: xpFont, fontSize: '10px', color: '#555' }} className={undefined}>
                        <span><i className={'bi bi-square-fill'} style={{ color: HEALTH.short.color, ...({ marginRight: 3 }) }} />Shortfall</span>
                        <span><i className={'bi bi-square-fill'} style={{ color: HEALTH.tight.color, ...({ marginRight: 3 }) }} />Tight</span>
                        <span><i className={'bi bi-square-fill'} style={{ color: HEALTH.ok.color, ...({ marginRight: 3 }) }} />OK</span>
                    </span>
                </div>


                <div style={{ flex: 1, overflowY: 'auto', background: '#ffffff', maxHeight: 'calc(var(--app-vh) - 200px)' }} className={undefined}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }} className={undefined}>
                        <thead className={undefined}>
                            <tr>
                                <th style={{ ...xpTableHeader, width: LV_EXPANDER_COL_W }} />
                                {COLS.map(c => (
                                    <SortableTh key={c.key} sort={sort} colKey={c.key} onSort={toggle}
                                        style={{ ...xpTableHeader, textAlign: c.align || 'left' }}
                                        className={undefined}>
                                        {c.label}
                                    </SortableTh>
                                ))}
                            </tr>
                        </thead>
                        <tbody ref={listBodyRef}>
                            {sorted.map((r, i) => {
                                const k = rowKey(r);
                                const isOpen = expanded.has(k);
                                const variant = variantLabel(r.attribute_value_ids);
                                const h = healthOf(r.qty_net_free);
                                const zebra = lvZebra(i);
                                return (
                                    <Fragment key={k}>
                                        <tr onClick={() => toggleRow(k)} title={'Click for MO breakdown'}
                                            style={{ background: isOpen ? rowStateBg('expanded') : (h === HEALTH.short ? h.tint : zebra), borderBottom: '1px solid #c0bdb5', cursor: 'pointer' }}
                                            className={undefined}>
                                            {/* The health stripe rides the row's leftmost cell, which is now the
                                                chevron column. */}
                                            <ExpanderCell expanded={isOpen} onToggle={() => toggleRow(k)} label="MO breakdown"
                                                tdStyle={{ borderLeft: `3px solid ${h.color}`, fontFamily: xpFont}} />
                                            <td style={{ padding: '4px 8px', fontFamily: xpFont }}>
                                                <>
                                                        <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{r.item_name}</span>
                                                        <div style={{ fontSize: '10px', color: '#666', fontVariant: 'all-small-caps' }}>{r.item_code}</div>
                                                    </>
                                            </td>
                                            <td style={{ padding: '4px 8px', fontFamily: xpFont, fontSize: '11px' }}>
                                                <span style={{ borderRadius: CHIP_RADIUS, background: '#e8e1f0', border: '1px solid #a890c0', padding: '0 5px', fontSize: '10px', color: '#3a2a4a' }} title="Netting is plant-wide, not per-location">
                                                        Plant-wide
                                                    </span>
                                            </td>
                                            <td style={{ padding: '4px 8px', fontFamily: xpFont, fontSize: '10px' }} className={undefined}>
                                                {r.size_label && (
                                                    <VariantChip kind="size"
                                                        title={`Size: ${r.size_label} — netted separately from other sizes`}>
                                                        {r.size_label}
                                                    </VariantChip>
                                                )}
                                                {variant
                                                    ? (<span style={{ background: '#dde8f5', border: '1px solid #7f9db9', padding: '0 5px', color: '#1a3d7a', marginLeft: r.size_label ? 4 : 0 }}>{variant}</span>)
                                                    : (!r.size_label && (<span style={{ color: '#999', fontStyle: 'italic' }}>Standard</span>))}
                                            </td>
                                            <td style={{ ...(numCell), color: TERM.onHand }} className={undefined}>{fmtQty(r.qty_on_hand)}</td>
                                            <td style={{ ...(numCell), color: r.qty_incoming ? TERM.incoming : '#bbb' }} className={undefined}>
                                                {r.qty_incoming ? `+${fmtQty(r.qty_incoming)}` : '—'}
                                            </td>
                                            <td style={{ ...(numCell), color: TERM.required }} className={undefined}>{fmtQty(r.qty_required)}</td>
                                            {/* Dimmed at zero, like Incoming: on most rows nothing is held, and a
                                                column of bright 0.000s would pull the eye off the shortfalls. */}
                                            <td style={{ ...(numCell), color: r.qty_reserved ? TERM.reserved : '#bbb' }}
                                                className={undefined}
                                                title={r.qty_reserved ? 'On hand, but promised to a sales order — expand the row for which' : undefined}>
                                                {r.qty_reserved ? `−${fmtQty(r.qty_reserved)}` : '—'}
                                            </td>
                                            <td style={{ ...(numCell), fontWeight: 'bold', color: h.color }} className={undefined}>
                                                {fmtQty(r.qty_net_free)}
                                                <span style={{ fontWeight: 'normal', fontSize: 9, color: '#999', marginLeft: 4 }}>{r.uom}</span>
                                            </td>
                                        </tr>
                                        {isOpen && (
                                            <tr>
                                                <td colSpan={COLS.length + 1} style={{ padding: 0 }} className={undefined}>
                                                    {renderDetail(r)}
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                            {!loading && sorted.length === 0 && (
                                <TableEmpty colSpan={COLS.length + 1}
                                    message="No components are currently demanded by ongoing MOs." />
                            )}
                            {/* Skeleton in both themes — the modern branch used to show a bare
                                "Loading..." line, which reads as a row rather than as a wait. */}
                            {loading && (
                                <TableSkeleton rows={8} cols={skel.cols ?? COLS.length + 1}
                                    rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                            )}
                        </tbody>
                    </table>
                </div>

                <div style={{
                    background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898',
                    padding: '2px 8px', display: 'flex', gap: 16, alignItems: 'center',
                    fontFamily: xpFont, fontSize: '11px', color: '#333',
                }} className={undefined}>
                    {shortfallCount > 0 && <span style={{ color: HEALTH.short.color }} className={undefined}><b>{shortfallCount}</b> shortfall</span>}
                    {tightCount > 0 && <span style={{ color: HEALTH.tight.color }}><b>{tightCount}</b> tight</span>}
                    {error && <span style={{ color: '#c00000' }}>· {error}</span>}
                    <span style={{ marginLeft: 'auto', color: '#666' }} className={undefined}>Net Free = On Hand + Incoming − Required</span>
                </div>
                <Pager page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />
            </div>

            <BookingStockInfoModal isOpen={infoOpen} onClose={() => setInfoOpen(false)} />
        </div>
    );
}
