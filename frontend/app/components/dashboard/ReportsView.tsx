import { useState, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useLanguage } from '../../context/LanguageContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useData } from '../../context/DataContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import {
    xpFont, xpBtn, xpInput, xpSelect, xpSep, CODE_FONT,
    TableSkeleton, useTableSkeletonMetrics, XPEmptyState, useServerSort, CodeChip, Chip, REF_TONES, XP_BTN, SKEL_PAGE_ROWS } from '../shared/xpTheme';
import { LotChips, lotSizeLabel, lotColorLabel } from '../shared/LotChips';
import TreeSelect, { buildLocationFilterTree, expandLocationFilterValue, buildCategoryTree, expandCategoryFilterValue } from '../shared/TreeSelect';
import Pager from '../shared/Pager';
import { xpBevel as sharedXpBevel, xpTitleBar as sharedXpTitleBar, xpToolbar as sharedXpToolbar, SearchField, FilterChipBar, SegmentedBar, FilterChipOption, pageFillStyle, flexFillStyle } from '../shared/shellTheme';
import { lvThead, SortableTh, lvZebra, Dash, ResizableTable } from '../shared/listViewTheme';
import { qtyFmt } from '../shared/format';
import { API_BASE } from '../shared/apiBase';

import { refMeta, shortRef } from './ledgerRef';
const StockLedgerPrintModal = dynamic(() => import('./StockLedgerPrintModal'), { ssr: false });

const PAGE_SIZE = 50;
const PRINT_LIMIT = 1000;

// Ledger movements carry the rawest numbers in the app — 4dp so a small
// correction entry is not rounded away.
const fmtQty = qtyFmt(4);
const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Does the row carry any variant identity for LotChips to draw?
const hasIdentity = (e: any) => !!(lotSizeLabel(e) || lotColorLabel(e) || e.variant_attributes?.length);

// Signed packaging deltas → e.g. "+2 boxes". Only nonzero units shown.
const pkgDelta = (e: any): { n: number; label: string }[] => {
    const out: { n: number; label: string }[] = [];
    const c = e.qty_cones_change || 0, b = e.qty_boxes_change || 0, d = e.qty_drums_change || 0;
    if (c) out.push({ n: c, label: Math.abs(c) === 1 ? 'cone' : 'cones' });
    if (b) out.push({ n: b, label: Math.abs(b) === 1 ? 'box' : 'boxes' });
    if (d) out.push({ n: d, label: Math.abs(d) === 1 ? 'drum' : 'drums' });
    return out;
};

export default function ReportsView(_props: any) {
    const { t } = useLanguage();
    const { formatDate: tzDate, formatTime: tzTime } = useTimezone();
    const { authFetch, locations = [], categories = [], itemIndex, companyProfile } = useData();

    // Filters. Default to the trailing 30 days, not all-time — an unbounded ledger
    // query scans the whole (ever-growing) stock_ledger history for its count/sum
    // aggregates. "All time" is still one click away via the preset/clear button.
    const [startDate, setStartDate] = useState(() => {
        const s = new Date(); s.setDate(s.getDate() - 29); return fmtDate(s);
    });
    const [endDate, setEndDate] = useState(() => fmtDate(new Date()));
    const [locationFilter, setLocationFilter] = useState(''); // TreeSelect value: '' | 'wh:<id>' | 'loc:<id>'
    const [categoryFilter, setCategoryFilter] = useState(''); // TreeSelect value: '' | '<category id>'
    const [refTypeFilter, setRefTypeFilter] = useState('');
    const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
    // Sorted in SQL: a windowed list sorted client-side shows the wrong rows.
    const { sort, toggleSort } = useServerSort();

    // Any params change restarts at page 1 inside the hook.
    const params = {
        start_date: startDate,
        end_date: endDate ? `${endDate}T23:59:59` : '',
        location_id: locationFilter ? expandLocationFilterValue(locations, locationFilter).join(',') : '',
        category_id: categoryFilter ? expandCategoryFilterValue(categories, categoryFilter).join(',') : '',
        reference_type: refTypeFilter,
        direction,
        sort_by: sort?.key,
        sort_dir: sort ? (sort.dir === 1 ? 'asc' : 'desc') : '',
    };
    const {
        rows, total, meta, loading, error, page, setPage,
        search, searchInput, setSearch, refetch,
    } = usePaginatedFetch({ endpoint: `${API_BASE}/stock`, authFetch, pageSize: PAGE_SIZE, params });
    const totalIn: number = meta.total_in || 0;
    const totalOut: number = meta.total_out || 0;
    const refTypes: string[] = meta.reference_types || [];

    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);

    const locFilterTreeOptions = useMemo(() => buildLocationFilterTree(locations || []), [locations]);
    const catFilterTreeOptions = useMemo(() => buildCategoryTree(categories || []), [categories]);
    const getItemName = (e: any) => e.item_name || itemIndex?.[String(e.item_id)]?.name || e.item_id;
    const getItemCode = (e: any) => e.item_code || itemIndex?.[String(e.item_id)]?.code || '';
    const getLocName = (e: any) => e.location_name || locations.find((l: any) => l.id === e.location_id)?.name || e.location_id;
    // A location's parent warehouse name (locations carry parent_name; matches Stock On-Hand).
    const locMap = useMemo(() => {
        const m: Record<string, any> = {};
        for (const l of (locations || [])) m[l.id] = l;
        return m;
    }, [locations]);
    const getWarehouseName = (e: any): string => locMap[e.location_id]?.parent_name || '';
    const skel = useTableSkeletonMetrics('stock-ledger-classic', listBodyRef, rows.length > 0);

    const net = totalIn + totalOut;
    const hasFilters = !!(search || startDate || endDate || locationFilter || categoryFilter || refTypeFilter || direction);

    const applyPreset = (kind: 'today' | '7d' | '30d' | 'month' | 'all') => {
        const now = new Date();
        if (kind === 'all') { setStartDate(''); setEndDate(''); return; }
        const end = fmtDate(now);
        let start = end;
        if (kind === '7d') { const s = new Date(now); s.setDate(s.getDate() - 6); start = fmtDate(s); }
        else if (kind === '30d') { const s = new Date(now); s.setDate(s.getDate() - 29); start = fmtDate(s); }
        else if (kind === 'month') { start = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)); }
        setStartDate(start); setEndDate(end);
    };

    const clearFilters = () => {
        setSearch(''); setStartDate(''); setEndDate('');
        setLocationFilter(''); setCategoryFilter(''); setRefTypeFilter(''); setDirection('');
    };

    const [printOpen, setPrintOpen] = useState(false);
    const [printLoading, setPrintLoading] = useState(false);
    const [printEntries, setPrintEntries] = useState<any[]>([]);

    const periodLabel = `${startDate || 'All time'} → ${endDate || 'now'}`;
    const locFilterName = useMemo(() => {
        if (!locationFilter) return '';
        const id = locationFilter.slice(locationFilter.indexOf(':') + 1);
        return locations.find((l: any) => l.id === id)?.name || '';
    }, [locationFilter, locations]);
    const catFilterName = useMemo(() => {
        if (!categoryFilter) return '';
        return (categories || []).find((c: any) => String(c.id) === categoryFilter)?.name || '';
    }, [categoryFilter, categories]);
    const filtersSummary = [
        search && `Search: "${search}"`,
        catFilterName && `Category: ${catFilterName}`,
        locationFilter && `Location: ${locFilterName || 'filtered'}`,
        refTypeFilter && `Source: ${refMeta(refTypeFilter).label}`,
        direction && `Direction: ${direction === 'in' ? 'In only' : 'Out only'}`,
    ].filter(Boolean).join(' · ');

    const handlePrint = async () => {
        setPrintLoading(true);
        try {
            // Same filters as the list, capped: a print of the whole history would
            // hang the browser, and the template flags the cut.
            const p = new URLSearchParams();
            for (const [k, v] of Object.entries(params)) if (v) p.set(k, String(v));
            if (search) p.set('search', search);
            p.set('page', '1');
            p.set('size', String(PRINT_LIMIT));
            const res = await authFetch(`${API_BASE}/stock?${p.toString()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setPrintEntries(data.items || []);
            setPrintOpen(true);
        } catch (e) {
            // fall back to a plain browser print of the current page if the fetch fails
            window.print();
        } finally {
            setPrintLoading(false);
        }
    };

    // ── Shared row content (mode-agnostic data) ──────────────────────────────
    // Column rules: every cell carries a right divider so the grid reads as a
    // ledger, not a list. The last cell drops it (the table border closes it).
    const xpCell: React.CSSProperties = { padding: '4px 8px', fontFamily: xpFont, borderRight: '1px solid #e0ddd3' };

    // ── XP "stat tile" for the summary strip ─────────────────────────────────
    // Label and value sit on ONE line: the strip is a readout, not a dashboard,
    // and a stacked tile ate a third of the ledger's vertical space.
    const statTile = (label: string, value: string, color: string) => (
        <div style={{
            flex: 1, minWidth: 96, background: '#ffffff',
            border: '1px solid', borderColor: '#808080 #ffffff #ffffff #808080',
            padding: '1px 8px', fontFamily: xpFont,
            display: 'flex', alignItems: 'baseline', gap: 6,
        }}>
            <span style={{ fontSize: 9, color: '#777', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 'bold', color, marginLeft: 'auto' }}>{value}</span>
        </div>
    );

    // Direction filter + date presets — one definition, both themes render them
    // through the shared segmented bars.
    const directionOptions: FilterChipOption[] = [
        { value: '', label: 'All' },
        { value: 'in', label: 'In', tone: 'green' },
        { value: 'out', label: 'Out', tone: 'red' },
    ];
    const presetActions = ([
        ['today', 'Today'], ['7d', '7d'], ['30d', '30d'], ['month', 'Month'],
    ] as const).map(([k, label]) => ({ key: k, label, onClick: () => applyPreset(k) }));

    // Two stacked toolbar rows: line 1 = search + dropdowns, line 2 = date
    // range + actions. Only the lower row draws the separator so the pair
    // reads as one band (classic only — modern nests both rows inside the
    // card-header instead).
    const titleBar: React.CSSProperties = sharedXpTitleBar();
    const toolbar: React.CSSProperties = sharedXpToolbar({ padding: '4px 6px', gap: '5px', flexWrap: 'nowrap', overflowX: 'auto' });
    const toolbarTop: React.CSSProperties = { ...toolbar, borderBottom: 'none', paddingBottom: 0 };
    const th: React.CSSProperties = {
        ...lvThead(),
        fontSize: '10px', fontWeight: 'bold', color: '#000', fontFamily: xpFont, padding: '3px 8px',
        position: 'sticky', top: 0, textAlign: 'left', borderRight: '1px solid #b0a898',
    };
    const lbl: React.CSSProperties = { fontFamily: xpFont, fontSize: '11px', color: '#444' };

    // ── Filter toolbar rows — shared content, per-branch wrapper/controls ────
    const toolbarRow1 = <div style={toolbarTop} className="no-print">
            <SearchField value={searchInput} onChange={setSearch} placeholder="Search item or reference..." width={200} />
            <div style={xpSep} />
            <TreeSelect
                options={locFilterTreeOptions}
                value={locationFilter}
                onChange={setLocationFilter}
                allowEmpty
                emptyLabel="All Locations"
                style={{ width: 150 }}
            />
            <TreeSelect
                options={catFilterTreeOptions}
                value={categoryFilter}
                onChange={setCategoryFilter}
                allowEmpty
                emptyLabel="All Categories"
                style={{ width: 150 }}
            />
            <select style={xpSelect({ width: 150 })} value={refTypeFilter} onChange={e => setRefTypeFilter(e.target.value)}>
                <option value="">All Sources</option>
                {refTypes.map(rt => <option key={rt} value={rt}>{refMeta(rt).label}</option>)}
            </select>
            <FilterChipBar
                options={directionOptions}
                value={direction}
                onChange={v => setDirection(v as '' | 'in' | 'out')}
            />
            <div style={{ flex: 1 }} />
        </div>;

    const toolbarRow2 = <div style={toolbar} className="no-print">
            <span style={lbl}>{t('from')}:</span>
            <input type="date" style={xpInput({ width: 122 })} value={startDate} onChange={e => setStartDate(e.target.value)} />
            <span style={lbl}>{t('to')}:</span>
            <input type="date" style={xpInput({ width: 122 })} value={endDate} onChange={e => setEndDate(e.target.value)} />
            <SegmentedBar actions={presetActions} />
            <div style={{ flex: 1 }} />
            {hasFilters && <button className={XP_BTN} style={xpBtn({ fontSize: '10px', padding: '1px 6px' })} onClick={clearFilters} title="Clear filters"><i className="bi bi-x-lg" /></button>}
            <button className={XP_BTN} style={xpBtn({ padding: '1px 6px' })} onClick={refetch} title="Refresh"><i className="bi bi-arrow-clockwise" /></button>
            <button className={XP_BTN} style={xpBtn({ padding: '1px 6px' })} onClick={handlePrint} disabled={printLoading} title={printLoading ? 'Loading...' : t('print')}><i className={printLoading ? 'bi bi-hourglass-split' : 'bi bi-printer'} /></button>
        </div>;

    // ── Summary strip — one stat list, per-branch tile rendering ─────────────
    const stats = [
        { label: 'Movements', value: total.toLocaleString(), color: '#1a3d7a', cls: 'text-primary' },
        { label: 'In', value: `+${fmtQty(totalIn)}`, color: '#1a5e1a', cls: 'text-success' },
        { label: 'Out', value: fmtQty(totalOut), color: '#c00000', cls: 'text-danger' },
        { label: 'Net', value: `${net > 0 ? '+' : ''}${fmtQty(net)}`, color: net >= 0 ? '#1a5e1a' : '#c00000', cls: net >= 0 ? 'text-success' : 'text-danger' },
    ];

    // ── Row rendering — one function, per-cell ternaries ─────────────────────
    const renderRow = (e: any, i: number) => {
        const rm = refMeta(e.reference_type);
        const up = e.qty_change >= 0;
        const pkg = pkgDelta(e);
        return <tr key={e.id} style={{ background: lvZebra(i), borderBottom: '1px solid #e0ddd3' }}>
                <td style={{ ...xpCell, whiteSpace: 'nowrap' }}>
                    <div style={{ fontSize: '11px', color: '#000' }}>{tzDate(e.created_at)}</div>
                    <div style={{ fontSize: '10px', color: '#777' }}>{tzTime(e.created_at)}</div>
                </td>
                <td style={{ ...xpCell, overflow: 'hidden' }}>
                    <div title={getItemName(e)} style={{ fontSize: '11px', fontWeight: 'bold', color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getItemName(e)}</div>
                    <CodeChip code={getItemCode(e)} tier={2} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }} />
                </td>
                <td style={xpCell}>
                    {/* Size, combo, shade (hex swatch), then the rest — the same
                        chips every lot picker draws. Supplier lot sits in Lot. */}
                    {hasIdentity(e) ? <LotChips batch={{ ...e, vendor_lot: null }} /> : <Dash />}
                </td>
                <td style={{ ...xpCell, fontSize: '11px', maxWidth: 140 }}>
                    {e.item_category_name
                        ? <Chip tone={REF_TONES.category} truncate size="xs">{e.item_category_name}</Chip>
                        : <Dash />}
                </td>
                <td style={{ ...xpCell, fontSize: '11px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxWidth: '100%' }}>
                        {getWarehouseName(e) && <Chip tone={REF_TONES.warehouse} truncate size="xs">{getWarehouseName(e)}</Chip>}
                        <Chip tone={REF_TONES.bin} truncate size="xs">{getLocName(e)}</Chip>
                    </div>
                </td>
                <td style={{ ...xpCell, fontSize: '11px', overflow: 'hidden' }}>
                    {e.batch_number ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start', maxWidth: '100%' }}>
                            <Chip tone={REF_TONES.lot} truncate size="xs">{e.batch_number}</Chip>
                            {e.vendor_lot && (
                                <Chip tone={REF_TONES.supplierLot} truncate size="xs" title={`Supplier lot: ${e.vendor_lot}`} style={{ fontFamily: CODE_FONT }}>
                                    SUP {e.vendor_lot}
                                </Chip>
                            )}
                        </div>
                    ) : <Dash />}
                </td>
                <td style={{ ...xpCell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: '11px', fontWeight: 'bold', color: up ? '#1a5e1a' : '#c00000' }}>
                        <span style={{ marginRight: 3, fontSize: 9 }}>{up ? '▲' : '▼'}</span>
                        {up ? '+' : ''}{fmtQty(e.qty_change)}
                        <span style={{ fontWeight: 'normal', fontSize: '10px', color: '#888', marginLeft: 3 }}>{e.item_uom}</span>
                    </span>
                    {pkg.length > 0 && (
                        <div style={{ fontSize: '9px', color: '#999' }}>
                            {pkg.map((q, k) => <span key={k}>{k > 0 ? ', ' : ''}{q.n > 0 ? '+' : ''}{q.n} {q.label}</span>)}
                        </div>
                    )}
                </td>
                <td style={{ ...xpCell, borderRight: 'none', whiteSpace: 'nowrap' }}>
                    <Chip tone={rm.tone} size="xs">{rm.label}</Chip>
                    <span style={{ fontSize: '10px', color: '#999', marginLeft: 4 }} title={e.reference_id}>#{e.reference_label || shortRef(e.reference_id)}</span>
                </td>
            </tr>;
    };

    // ── Table body — shared error/empty/rows ternary, per-branch chrome ──────
    const tableBody = error ? (
        <XPEmptyState icon="bi-exclamation-triangle" message={`Could not load ledger — ${error}`} />) : !loading && rows.length === 0 ? (
        <XPEmptyState icon="bi-journal-x" message={hasFilters ? 'No movements match these filters' : 'No stock movements recorded yet'}>
                {hasFilters && <button className={XP_BTN} style={{ ...xpBtn(), marginTop: 10 }} onClick={clearFilters}>Clear filters</button>}
            </XPEmptyState>) : (
        <div className={undefined} style={undefined}>
            <ResizableTable className={undefined} style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead className={undefined} style={undefined}>
                    <tr>
                        <SortableTh sort={sort} colKey="date" onSort={toggleSort} style={th}>{t('date')}</SortableTh>
                        <SortableTh sort={sort} colKey="item" onSort={toggleSort} style={th}>Item</SortableTh>
                        <th style={th}>Variant</th>
                        <SortableTh sort={sort} colKey="category" onSort={toggleSort} style={th}>Category</SortableTh>
                        <SortableTh sort={sort} colKey="location" onSort={toggleSort} style={th}>{t('locations')}</SortableTh>
                        <th style={th}>Lot</th>
                        <SortableTh sort={sort} colKey="qty" onSort={toggleSort} style={{ ...th, textAlign: 'right' }}>Movement</SortableTh>
                        <th className={undefined} style={{ ...th, borderRight: 'none' }}>Source</th>
                    </tr>
                </thead>
                {/* Skeleton lives inside the real table so the header stays
                    put and the placeholder rows inherit its columns. */}
                <tbody ref={listBodyRef}>
                    {loading
                        ? <TableSkeleton rows={SKEL_PAGE_ROWS} cols={skel.cols ?? 8} tdStyle={xpCell} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                        : rows.map((e: any, i: number) => renderRow(e, i))}
                </tbody>
            </ResizableTable>
        </div>
    );

    return (
        <>
        <div className={'fade-in print-container'} style={pageFillStyle}>
            <div style={sharedXpBevel(flexFillStyle)}>
                <div style={titleBar} className="no-print">
                        <span><i className="bi bi-journal-text" style={{ marginRight: 6 }} />{t('stock_ledger')}</span>
                        <span style={{ fontSize: '10px', opacity: 0.85 }}>{total.toLocaleString()} movements</span>
                    </div>
                {toolbarRow1}
                {toolbarRow2}

                {/* Summary strip */}
                <div className={'no-print'} style={{ display: 'flex', gap: 5, padding: '3px 6px', background: '#ece9d8', borderBottom: '1px solid #b0a898' }}>
                    {stats.map((s, i) => <div key={s.label}>{statTile(s.label, s.value, s.color)}</div>)}
                </div>

                {/* Print header */}
                <div className={'print-header d-none d-print-block'} style={{ padding: '16px 12px 8px', borderBottom: '1px solid #b0a898' }}>
                    <h2 style={{ fontFamily: xpFont, marginBottom: 4 }} className={undefined}>{t('stock_ledger')}</h2>
                    <p style={{ fontFamily: xpFont, fontSize: '12px', color: '#444', margin: 0 }} className={undefined}>Period: {periodLabel}</p>
                    <p style={{ fontFamily: xpFont, fontSize: '11px', color: '#666', margin: 0 }} className={undefined}>
                        <>{total} movements &nbsp;·&nbsp; In +{fmtQty(totalIn)} &nbsp;·&nbsp; Out {fmtQty(totalOut)} &nbsp;·&nbsp; Net {fmtQty(net)}</>
                    </p>
                </div>

                {/* Table */}
                <div className={undefined} style={{ flex: 1, overflowY: 'auto', background: '#fff', minHeight: 0 }}>
                    {tableBody}
                </div>

                <Pager page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} className={'no-print'} />
            </div>
        </div>
        {printOpen && (
            <StockLedgerPrintModal
                entries={printEntries}
                locations={locations}
                companyProfile={companyProfile}
                periodLabel={periodLabel}
                totals={{ total, totalIn, totalOut }}
                filtersSummary={filtersSummary}
                onClose={() => setPrintOpen(false)}
            />
        )}
        </>
    );
}
