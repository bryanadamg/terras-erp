import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useLanguage } from '../../context/LanguageContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useData } from '../../context/DataContext';
import { useDebouncedCommit } from '../../context/usePaginatedList';
import {
    xpFont, xpBtn, xpInput, xpSelect, xpSep,
    TableSkeleton, useTableSkeletonMetrics, XPEmptyState, useSortable, CodeChip, CHIP_RADIUS, XP_BTN } from '../shared/xpTheme';
import TreeSelect, { buildLocationFilterTree, expandLocationFilterValue, buildCategoryTree, expandCategoryFilterValue } from '../shared/TreeSelect';
import Pager from '../shared/Pager';
import { xpBevel as sharedXpBevel, xpTitleBar as sharedXpTitleBar, xpToolbar as sharedXpToolbar, SearchField, FilterChipBar, SegmentedBar, FilterChipOption, pageFillStyle, flexFillStyle } from '../shared/shellTheme';
import { lvThead, SortableTh, lvZebra, Dash } from '../shared/listViewTheme';
import { qtyFmt } from '../shared/format';
import { STATIC_BASE } from '../shared/apiBase';

const StockLedgerPrintModal = dynamic(() => import('./StockLedgerPrintModal'), { ssr: false });

const PAGE_SIZE = 50;
const PRINT_LIMIT = 1000;

// Friendly label + colour per reference_type. Unknown types fall back to a
// title-cased label and a neutral pill so new movement sources still render.
type RefMeta = { label: string; classic: { bg: string; border: string; color: string }; modern: string };
const REF_META: Record<string, RefMeta> = {
    'manual':              { label: 'Manual Adjustment', classic: { bg: '#e6e3da', border: '#a8a292', color: '#444' }, modern: 'text-bg-secondary' },
    'Manufacturing Order': { label: 'Manufacturing',     classic: { bg: '#dde8f5', border: '#7f9db9', color: '#1a3d7a' }, modern: 'text-bg-primary' },
    'Work Order':          { label: 'Work Order',        classic: { bg: '#e6ddf2', border: '#9a82c0', color: '#4a2a7a' }, modern: 'text-bg-dark' },
    'Goods Receipt':       { label: 'Goods Receipt',     classic: { bg: '#dcefe0', border: '#7faf87', color: '#1a5e2a' }, modern: 'text-bg-success' },
    'Purchase Order':      { label: 'Purchase Order',    classic: { bg: '#d6eef0', border: '#6fb0b8', color: '#15565e' }, modern: 'text-bg-info' },
    'Transfer':            { label: 'Transfer',          classic: { bg: '#fbeccf', border: '#c8a23a', color: '#6a4a00' }, modern: 'text-bg-warning' },
};
const refMeta = (t: string): RefMeta =>
    REF_META[t] || { label: (t || '').replace(/_/g, ' '), classic: { bg: '#e0dfd8', border: '#b0a898', color: '#333' }, modern: 'text-bg-light border' };

// Reference ids are often UUIDs — show a short head, keep the full value on hover.
const shortRef = (id: string) => {
    if (!id) return '';
    const looksUuid = id.length > 14 && /[0-9a-f-]{12,}/i.test(id);
    return looksUuid ? id.slice(0, 8) + '…' : id;
};

// Ledger movements carry the rawest numbers in the app — 4dp so a small
// correction entry is not rounded away.
const fmtQty = qtyFmt(4);
const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
    const { authFetch, locations = [], attributes = [], categories = [], itemIndex, companyProfile } = useData();

    const API_BASE = useMemo(() => {
        return STATIC_BASE.replace(/\/api$/, '') + '/api';
    }, []);

    // Filters
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    // Default to the trailing 30 days, not all-time — an unbounded ledger query
    // scans the whole (ever-growing) stock_ledger history for its count/sum
    // aggregates. "All time" is still one click away via the preset/clear button.
    const [startDate, setStartDate] = useState(() => {
        const s = new Date(); s.setDate(s.getDate() - 29); return fmtDate(s);
    });
    const [endDate, setEndDate] = useState(() => fmtDate(new Date()));
    const [locationFilter, setLocationFilter] = useState(''); // TreeSelect value: '' | 'wh:<id>' | 'loc:<id>'
    const [categoryFilter, setCategoryFilter] = useState(''); // TreeSelect value: '' | '<category id>'
    const [refTypeFilter, setRefTypeFilter] = useState('');
    const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
    const [page, setPage] = useState(1);

    // Server result
    const [entries, setEntries] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [totalIn, setTotalIn] = useState(0);
    const [totalOut, setTotalOut] = useState(0);
    const [refTypes, setRefTypes] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them. Classic and modern
    // rows differ in height, so they cache under separate keys.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);

    // Debounce the free-text search; reset to page 1 on every new term.
    useDebouncedCommit(search, debouncedSearch, v => { setDebouncedSearch(v); setPage(1); });

    // Any non-page filter change snaps back to the first page.
    const onFilter = (setter: (v: any) => void) => (v: any) => { setter(v); setPage(1); };

    const fetchLedger = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const p = new URLSearchParams();
            p.set('skip', String((page - 1) * PAGE_SIZE));
            p.set('limit', String(PAGE_SIZE));
            if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim());
            if (startDate) p.set('start_date', startDate);
            if (endDate) p.set('end_date', `${endDate}T23:59:59`);
            if (locationFilter) p.set('location_id', expandLocationFilterValue(locations, locationFilter).join(','));
            if (categoryFilter) p.set('category_id', expandCategoryFilterValue(categories, categoryFilter).join(','));
            if (refTypeFilter) p.set('reference_type', refTypeFilter);
            if (direction) p.set('direction', direction);

            const res = await authFetch(`${API_BASE}/stock?${p.toString()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setEntries(data.items || []);
            setTotal(data.total || 0);
            setTotalIn(data.total_in || 0);
            setTotalOut(data.total_out || 0);
            if (Array.isArray(data.reference_types) && data.reference_types.length) setRefTypes(data.reference_types);
        } catch (e: any) {
            setError(e.message || 'Failed to load ledger');
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, [API_BASE, authFetch, page, debouncedSearch, startDate, endDate, locationFilter, locations, categoryFilter, categories, refTypeFilter, direction]);

    useEffect(() => { fetchLedger(); }, [fetchLedger]);

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
    const getAttrName = (valId: string) => {
        for (const attr of attributes) {
            const v = attr.values?.find((x: any) => x.id === valId);
            if (v) return v.value;
        }
        return valId;
    };

    // Sort the loaded page client-side; the server already scoped + ordered it.
    const sortCols = useMemo(() => ({
        date:     (e: any) => e.created_at,
        item:     (e: any) => e.item_name || e.item_code || '',
        category: (e: any) => e.item_category_name || '',
        location: (e: any) => e.location_name || '',
        qty:      (e: any) => e.qty_change,
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), []);
    const { sorted: rows, sort, toggle } = useSortable(entries, sortCols);
    const skel = useTableSkeletonMetrics('stock-ledger-classic', listBodyRef, rows.length > 0);

    const net = totalIn + totalOut;
    const hasFilters = !!(debouncedSearch || startDate || endDate || locationFilter || categoryFilter || refTypeFilter || direction);

    const applyPreset = (kind: 'today' | '7d' | '30d' | 'month' | 'all') => {
        const now = new Date();
        if (kind === 'all') { setStartDate(''); setEndDate(''); setPage(1); return; }
        const end = fmtDate(now);
        let start = end;
        if (kind === '7d') { const s = new Date(now); s.setDate(s.getDate() - 6); start = fmtDate(s); }
        else if (kind === '30d') { const s = new Date(now); s.setDate(s.getDate() - 29); start = fmtDate(s); }
        else if (kind === 'month') { start = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)); }
        setStartDate(start); setEndDate(end); setPage(1);
    };

    const clearFilters = () => {
        setSearch(''); setDebouncedSearch(''); setStartDate(''); setEndDate('');
        setLocationFilter(''); setCategoryFilter(''); setRefTypeFilter(''); setDirection(''); setPage(1);
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
        debouncedSearch && `Search: "${debouncedSearch}"`,
        catFilterName && `Category: ${catFilterName}`,
        locationFilter && `Location: ${locFilterName || 'filtered'}`,
        refTypeFilter && `Source: ${refMeta(refTypeFilter).label}`,
        direction && `Direction: ${direction === 'in' ? 'In only' : 'Out only'}`,
    ].filter(Boolean).join(' · ');

    const handlePrint = async () => {
        setPrintLoading(true);
        try {
            const p = new URLSearchParams();
            p.set('skip', '0');
            p.set('limit', String(PRINT_LIMIT));
            if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim());
            if (startDate) p.set('start_date', startDate);
            if (endDate) p.set('end_date', `${endDate}T23:59:59`);
            if (locationFilter) p.set('location_id', expandLocationFilterValue(locations, locationFilter).join(','));
            if (categoryFilter) p.set('category_id', expandCategoryFilterValue(categories, categoryFilter).join(','));
            if (refTypeFilter) p.set('reference_type', refTypeFilter);
            if (direction) p.set('direction', direction);

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
            <SearchField value={search} onChange={setSearch} placeholder="Search item or reference..." width={200} />
            <div style={xpSep} />
            <TreeSelect
                options={locFilterTreeOptions}
                value={locationFilter}
                onChange={onFilter(setLocationFilter)}
                allowEmpty
                emptyLabel="All Locations"
                style={{ width: 150 }}
            />
            <TreeSelect
                options={catFilterTreeOptions}
                value={categoryFilter}
                onChange={onFilter(setCategoryFilter)}
                allowEmpty
                emptyLabel="All Categories"
                style={{ width: 150 }}
            />
            <select style={xpSelect({ width: 150 })} value={refTypeFilter} onChange={e => onFilter(setRefTypeFilter)(e.target.value)}>
                <option value="">All Sources</option>
                {refTypes.map(rt => <option key={rt} value={rt}>{refMeta(rt).label}</option>)}
            </select>
            <FilterChipBar
                options={directionOptions}
                value={direction}
                onChange={v => onFilter(setDirection)(v as '' | 'in' | 'out')}
            />
            <div style={{ flex: 1 }} />
        </div>;

    const toolbarRow2 = <div style={toolbar} className="no-print">
            <span style={lbl}>{t('from')}:</span>
            <input type="date" style={xpInput({ width: 122 })} value={startDate} onChange={e => onFilter(setStartDate)(e.target.value)} />
            <span style={lbl}>{t('to')}:</span>
            <input type="date" style={xpInput({ width: 122 })} value={endDate} onChange={e => onFilter(setEndDate)(e.target.value)} />
            <SegmentedBar actions={presetActions} />
            <div style={{ flex: 1 }} />
            {hasFilters && <button className={XP_BTN} style={xpBtn({ fontSize: '10px', padding: '1px 6px' })} onClick={clearFilters} title="Clear filters"><i className="bi bi-x-lg" /></button>}
            <button className={XP_BTN} style={xpBtn({ padding: '1px 6px' })} onClick={fetchLedger} title="Refresh"><i className="bi bi-arrow-clockwise" /></button>
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
                <td style={xpCell}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{getItemName(e)}</div>
                    <div style={{ fontSize: '10px', color: '#777', fontVariant: 'all-small-caps' }}>{getItemCode(e)}</div>
                    {e.attribute_value_ids?.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2 }}>
                            {e.attribute_value_ids.map((vid: string) => (
                                <span key={vid} style={{ borderRadius: CHIP_RADIUS, background: '#dde8f5', border: '1px solid #7f9db9', padding: '0 4px', fontSize: '9px', color: '#333' }}>{getAttrName(vid)}</span>
                            ))}
                        </div>
                    )}
                </td>
                <td style={{ ...xpCell, fontSize: '11px' }}>
                    {e.item_category_name
                        ? <span title={e.item_category_name} style={{ borderRadius: CHIP_RADIUS, display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom', background: '#e4eef0', border: '1px solid #8fb3bb', padding: '0 5px', fontSize: '10px', color: '#2a464a' }}>{e.item_category_name}</span>
                        : <Dash />}
                </td>
                <td style={{ ...xpCell, fontSize: '11px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {getWarehouseName(e) && (
                            <span style={{ borderRadius: CHIP_RADIUS, background: '#eef0e4', border: '1px solid #b7bb8f', padding: '0 5px', fontSize: '10px', color: '#4a4a2a' }}>
                                {getWarehouseName(e)}
                            </span>
                        )}
                        <span style={{ borderRadius: CHIP_RADIUS, background: '#e8e1f0', border: '1px solid #a890c0', padding: '0 5px', fontSize: '10px', color: '#3a2a4a' }}>
                            {getLocName(e)}
                        </span>
                    </div>
                </td>
                <td style={{ ...xpCell, fontSize: '11px' }}>
                    {e.batch_number
                        ? <span style={{ borderRadius: CHIP_RADIUS, background: '#fff8dc', border: '1px solid #c8a000', padding: '0 5px', fontSize: '10px', color: '#5a3c00' }}>{e.batch_number}</span>
                        : <Dash />}
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
                    <span style={{ borderRadius: CHIP_RADIUS, background: rm.classic.bg, border: `1px solid ${rm.classic.border}`, padding: '0 5px', fontSize: '10px', color: rm.classic.color }}>{rm.label}</span>
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
            <table className={undefined} style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead className={undefined} style={undefined}>
                    <tr>
                        <SortableTh sort={sort} colKey="date" onSort={toggle} style={th} className={undefined}>{t('date')}</SortableTh>
                        <SortableTh sort={sort} colKey="item" onSort={toggle} style={th}>Item</SortableTh>
                        <SortableTh sort={sort} colKey="category" onSort={toggle} style={th}>Category</SortableTh>
                        <SortableTh sort={sort} colKey="location" onSort={toggle} style={th}>{t('locations')}</SortableTh>
                        <th style={th}>Lot</th>
                        <SortableTh sort={sort} colKey="qty" onSort={toggle} className={undefined} style={{ ...th, textAlign: 'right' }}>Movement</SortableTh>
                        <th className={undefined} style={{ ...th, borderRight: 'none' }}>Source</th>
                    </tr>
                </thead>
                {/* Skeleton lives inside the real table so the header stays
                    put and the placeholder rows inherit its columns. */}
                <tbody ref={listBodyRef}>
                    {loading
                        ? <TableSkeleton rows={10} cols={skel.cols ?? 7} tdStyle={xpCell} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                        : rows.map((e: any, i: number) => renderRow(e, i))}
                </tbody>
            </table>
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
                attributes={attributes}
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
