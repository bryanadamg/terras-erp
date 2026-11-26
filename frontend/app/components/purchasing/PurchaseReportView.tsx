'use client';
// Purchase Report — two views over the purchasing record, both filtered by date
// range, supplier, category and a free search:
//   lines    — every PO line: what was ordered from whom, at what price
//   receipts — every goods-receipt line: what actually came in, when, and into
//              which warehouse (e.g. everything received into the Raw Material store)
// Self-fetching; export and print use the same server filter as the grid.
import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useData } from '../../context/DataContext';
import { useUser } from '../../context/UserContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useToast } from '../shared/Toast';
import { saveResponse } from '../shared/download';
import { API_BASE } from '../shared/apiBase';
import { fmtMoney, qtyFmt } from '../shared/format';
import { xpFont, xpBtn, xpSelect, xpSep, XPEmptyState, CodeChip, StatusChip, TableSkeleton, XP_BTN } from '../shared/xpTheme';
import { field as xpInput, toolbar as sharedXpToolbar } from '@bryanadamg/terras-ui/styles';
import { FilterChipBar } from '@bryanadamg/terras-ui/components/FilterChipBar';
import { Count as ToolbarCount } from '@bryanadamg/terras-ui/components/Window';
import TreeSelect, { buildLocationFilterTree, expandLocationFilterValue, buildCategoryTree, expandCategoryFilterValue } from '../shared/TreeSelect';
import SearchableSelect from '@bryanadamg/terras-ui/components/Combobox';
import { SearchField, pageFillStyle, flexFillStyle } from '../shared/shellTheme';
import { lvThSticky, lvTdRuled, lvZebra, ResizableTable, Dash } from '../shared/listViewTheme';
import { ExcelButton } from '../shared/ExportExcelButton';

const PurchaseReportPrintModal = dynamic(() => import('./PurchaseReportPrintModal'), { ssr: false });

type Kind = 'lines' | 'receipts';
const fmtQty = qtyFmt(3);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function PurchaseReportView() {
    const { authFetch, partners = [], locations = [], categories = [] } = useData();
    const { hasPermission } = useUser();
    const { formatDate, timezone } = useTimezone();
    const { showToast } = useToast();
    const canExport = hasPermission('purchase_order.export');
    const canPrint = hasPermission('purchase_order.print');

    const [kind, setKind] = useState<Kind>('receipts');
    const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return ymd(d); });
    const [dateTo, setDateTo] = useState(() => ymd(new Date()));
    const [supplierId, setSupplierId] = useState('');
    const [locationFilter, setLocationFilter] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [status, setStatus] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    useEffect(() => { const h = setTimeout(() => setSearch(searchInput), 300); return () => clearTimeout(h); }, [searchInput]);

    const [rows, setRows] = useState<any[]>([]);
    const [amount, setAmount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [printOpen, setPrintOpen] = useState(false);
    const [exporting, setExporting] = useState(false);

    const params = useMemo(() => {
        const p = new URLSearchParams();
        if (dateFrom) p.set('date_from', dateFrom);
        if (dateTo) p.set('date_to', dateTo);
        if (supplierId) p.set('supplier_id', supplierId);
        if (search.trim()) p.set('search', search.trim());
        if (categoryFilter) p.set('category_id', expandCategoryFilterValue(categories, categoryFilter).join(','));
        if (kind === 'receipts' && locationFilter) p.set('location_id', expandLocationFilterValue(locations, locationFilter).join(','));
        if (kind === 'lines' && status) p.set('status', status);
        return p;
    }, [kind, dateFrom, dateTo, supplierId, search, categoryFilter, locationFilter, status, categories, locations]);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        authFetch(`${API_BASE}/purchase-orders/report/${kind}?${params.toString()}`)
            .then((r: Response) => (r.ok ? r.json() : Promise.reject(r)))
            .then((body: any) => { if (alive) { setRows(body.items || []); setAmount(body.amount || 0); } })
            .catch(() => { if (alive) { setRows([]); setAmount(0); showToast('Could not load the report', 'danger'); } })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, params]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const p = new URLSearchParams(params);
            p.set('tz', timezone);
            const res = await authFetch(`${API_BASE}/purchase-orders/report/${kind}/export?${p.toString()}`);
            if (!res.ok) { showToast('Export failed', 'danger'); return; }
            await saveResponse(res, kind === 'lines' ? 'purchase-order-lines.xlsx' : 'goods-received.xlsx');
        } finally {
            setExporting(false);
        }
    };

    const suppliers = (partners || []).filter((p: any) => p.type === 'SUPPLIER');
    const supplierName = suppliers.find((p: any) => p.id === supplierId)?.name;
    const locTree = useMemo(() => buildLocationFilterTree(locations || []), [locations]);
    const catTree = useMemo(() => buildCategoryTree(categories || []), [categories]);
    const periodLabel = `${dateFrom || 'All time'} → ${dateTo || 'now'}`;
    const filtersSummary = [
        supplierName && `Supplier: ${supplierName}`,
        search.trim() && `Search: "${search.trim()}"`,
        kind === 'lines' && status && `Status: ${status}`,
    ].filter(Boolean).join(' · ');

    const th = lvThSticky();
    const td = lvTdRuled();
    const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
    const money = (n: any) => (n == null ? <Dash /> : fmtMoney(Number(n)));
    const lbl: React.CSSProperties = { fontFamily: xpFont, fontSize: '11px', color: '#444' };

    const cols = kind === 'lines'
        ? ['Date', 'PO Number', 'Supplier', 'Item', 'Category', 'Ordered', 'Received', 'Unit Price', 'Amount', 'Status']
        : ['Date', 'PO Number', 'Supplier', 'Delivery Note', 'Item', 'Warehouse', 'Qty', 'Lot', 'Unit Price', 'Amount'];

    const itemCell = (r: any) => (
        <td style={td}>
            <div style={{ fontWeight: 'bold' }}>{r.item_name}</div>
            <CodeChip code={r.item_code} tier={2} />
            {r.variant && <span style={{ marginLeft: 4, fontSize: 10, color: '#666' }}>{r.variant}</span>}
        </td>
    );
    const priceCell = (r: any) => (
        <td style={num} title={r.unit_price_excl_vat != null && r.unit_price_excl_vat !== r.unit_price ? `Excl. VAT: ${fmtMoney(r.unit_price_excl_vat)}` : undefined}>
            {money(r.unit_price)}
            {r.unit_price_excl_vat != null && r.unit_price_excl_vat !== r.unit_price && (
                <div style={{ fontSize: 9, color: '#777' }}>excl. {fmtMoney(r.unit_price_excl_vat)}</div>
            )}
        </td>
    );

    return (
        <div style={pageFillStyle}>
            {printOpen && (
                <PurchaseReportPrintModal kind={kind} rows={rows} amount={amount}
                    periodLabel={periodLabel} filtersSummary={filtersSummary} onClose={() => setPrintOpen(false)} />
            )}
            <div style={{ ...sharedXpToolbar({ padding: '4px 6px', gap: '5px', flexWrap: 'wrap' }), borderBottom: 'none', paddingBottom: 0 }} className="no-print">
                <FilterChipBar
                    options={[{ value: 'receipts', label: 'Goods Received' }, { value: 'lines', label: 'PO Lines' }]}
                    value={kind}
                    onChange={v => setKind(v as Kind)}
                />
                <div style={xpSep} />
                <SearchField value={searchInput} onChange={setSearchInput} placeholder="Search item, PO# or DN…" width={190} />
                <div style={{ width: 180 }}>
                    <SearchableSelect
                        options={[{ value: '', label: 'All suppliers' }, ...suppliers.map((s: any) => ({ value: s.id, label: s.name }))]}
                        value={supplierId} onChange={setSupplierId} placeholder="All suppliers"
                    />
                </div>
                {kind === 'receipts' && (
                    <TreeSelect options={locTree} value={locationFilter} onChange={setLocationFilter}
                        allowEmpty emptyLabel="All Warehouses" style={{ width: 170 }} />
                )}
                <TreeSelect options={catTree} value={categoryFilter} onChange={setCategoryFilter}
                    allowEmpty emptyLabel="All Categories" style={{ width: 150 }} />
                {kind === 'lines' && (
                    <select style={xpSelect({ width: 120 })} value={status} onChange={e => setStatus(e.target.value)}>
                        <option value="">All statuses</option>
                        <option value="DRAFT">Draft</option>
                        <option value="RECEIVING">Receiving</option>
                        <option value="RECEIVED">Received</option>
                    </select>
                )}
            </div>
            <div style={sharedXpToolbar({ padding: '4px 6px', gap: '5px', flexWrap: 'wrap' })} className="no-print">
                <span style={lbl}>From:</span>
                <input type="date" style={xpInput({ width: 122 })} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                <span style={lbl}>To:</span>
                <input type="date" style={xpInput({ width: 122 })} value={dateTo} onChange={e => setDateTo(e.target.value)} />
                <ToolbarCount>{rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'} · Rp {fmtMoney(amount)}</ToolbarCount>
                <div style={{ flex: 1 }} />
                {canExport && <ExcelButton busy={exporting} disabled={!rows.length} onClick={handleExport} />}
                {canPrint && <button className={XP_BTN} style={xpBtn({ padding: '1px 6px' })} onClick={() => setPrintOpen(true)} disabled={!rows.length} title="Print"><i className="bi bi-printer" /></button>}
            </div>

            <div style={{ ...flexFillStyle, overflow: 'auto' }}>
                {!loading && rows.length === 0 ? (
                    <XPEmptyState icon="bi-bag-x" message="Nothing matches these filters" />
                ) : (
                    <ResizableTable style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', fontFamily: xpFont, fontSize: 11 }}>
                        <thead>
                            <tr>{cols.map(c => <th key={c} style={th}>{c}</th>)}</tr>
                        </thead>
                        <tbody>
                            {loading && rows.length === 0 && <TableSkeleton rows={12} cols={cols.length} tdStyle={td} />}
                            {rows.map((r, i) => (
                                <tr key={i} style={{ background: lvZebra(i) }}>
                                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.date ? formatDate(r.date) : ''}</td>
                                    <td style={td}><CodeChip code={r.po_number} tone="accent" /></td>
                                    <td style={td}>{r.supplier || <Dash />}</td>
                                    {kind === 'lines' ? (<>
                                        {itemCell(r)}
                                        <td style={td}>{r.category || <Dash />}</td>
                                        <td style={num}>{fmtQty(r.qty)} {r.uom}</td>
                                        <td style={num}>{fmtQty(r.qty_received)} {r.uom}</td>
                                        {priceCell(r)}
                                        <td style={{ ...num, fontWeight: 'bold' }}>{money(r.amount)}</td>
                                        <td style={td}><StatusChip status={r.status} tint /></td>
                                    </>) : (<>
                                        <td style={td}>{r.delivery_note || <Dash />}</td>
                                        {itemCell(r)}
                                        <td style={td}>{r.warehouse || <Dash />}</td>
                                        <td style={{ ...num, fontWeight: 'bold' }}>{fmtQty(r.qty)} {r.uom}</td>
                                        <td style={{ ...td, fontSize: 10 }}>
                                            {r.lot || <Dash />}
                                            {r.supplier_lot && <div style={{ color: '#777' }}>Sup: {r.supplier_lot}</div>}
                                        </td>
                                        {priceCell(r)}
                                        <td style={num}>{money(r.amount)}</td>
                                    </>)}
                                </tr>
                            ))}
                        </tbody>
                    </ResizableTable>
                )}
            </div>
        </div>
    );
}
