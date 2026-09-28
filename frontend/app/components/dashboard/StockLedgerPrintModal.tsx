'use client';
import React, { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { useTimezone } from '../../context/TimezoneContext';
import { STATIC_BASE } from '../shared/apiBase';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import TemplatePrintPortal from '../shared/printTemplate/TemplatePrintPortal';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { paperDimsMm } from '../shared/printTemplate/paper';
import type { PrintLayout, TableBand } from '../shared/printTemplate/types';
import { buildStockLedgerContext, STOCK_LEDGER_DOC } from '../shared/printTemplate/doctypes/stockLedger';

// The document is a print template (defaults/stockLedger.ts, editable in Print
// Layouts). The column checkboxes are print-time only: they drop columns of the
// layout's ledger table for this print and re-spread the widths over the rest.

const TABLE_BAND = 'sl_table';
const COLUMNS_STORAGE_KEY = 'stock_ledger_print_columns';

function withHiddenColumns(layout: PrintLayout, hidden: Record<string, boolean>): PrintLayout {
    return {
        ...layout,
        bands: layout.bands.map(b => {
            if (b.id !== TABLE_BAND || b.type !== 'table') return b;
            const cols = (b as TableBand).columns.filter(c => hidden[c.field] !== false);
            // Scale percentage widths back up to 100% so dropped columns don't leave a gap.
            const pct = cols.map(c => (c.width?.endsWith('%') ? parseFloat(c.width) : NaN));
            const sum = pct.reduce((s, p) => s + p, 0);
            const scaled = pct.every(p => p > 0)
                ? cols.map((c, i) => ({ ...c, width: `${(pct[i] / sum * 100).toFixed(2)}%` }))
                : cols;
            return { ...b, columns: scaled };
        }),
    };
}

export default function StockLedgerPrintModal({
    entries, locations, companyProfile, periodLabel, totals, filtersSummary, onClose,
}: {
    entries: any[];
    locations: any[];
    companyProfile: any;
    periodLabel: string;
    totals: { total: number; totalIn: number; totalOut: number };
    filtersSummary: string;
    onClose: () => void;
}) {
    const { formatDateTime } = useTimezone();
    const { printTemplates } = useData() as any;
    const hiddenCount = Math.max(0, totals.total - entries.length);

    // Keyed by column field; `false` = hidden for print. Absent = shown.
    const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>(() => {
        try {
            const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
            return saved ? JSON.parse(saved) : {};
        } catch { return {}; }
    });

    const baseLayout = resolveLayout(STOCK_LEDGER_DOC, printTemplates)!;
    const tableBand = baseLayout.bands.find(b => b.id === TABLE_BAND && b.type === 'table' && b.show !== false) as TableBand | undefined;
    const columnChoices = tableBand?.columns || [];
    const toggleCol = (key: string) => {
        setVisibleCols(prev => {
            const shownCount = columnChoices.filter(c => prev[c.field] !== false).length;
            if (prev[key] !== false && shownCount <= 1) return prev; // keep at least one column
            const next = { ...prev, [key]: prev[key] === false };
            try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch {}
            return next;
        });
    };
    const layout = useMemo(() => withHiddenColumns(baseLayout, visibleCols), [baseLayout, visibleCols]);

    const ctx = useMemo(() => buildStockLedgerContext({
        entries, locations, periodLabel, filtersSummary, totals, formatDateTime, companyProfile,
        companyName: companyProfile?.name,
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
    }), [entries, locations, periodLabel, filtersSummary, totals, formatDateTime, companyProfile]);
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);

    const handlePrint = () => {
        window.addEventListener('afterprint', () => onClose(), { once: true });
        window.print();
    };

    return (
        <>
            <PrintModalShell
                title={`Print Stock Ledger — ${entries.length.toLocaleString()} movement(s)${hiddenCount > 0 ? ` of ${totals.total.toLocaleString()}` : ''}`}
                onClose={onClose}
                modeless
                width="calc(var(--app-vw) * 96 / 100)"
                maxWidth={1300}
                height="calc(var(--app-vh) * 90 / 100)"
                bevel={false}
                layoutDocType={STOCK_LEDGER_DOC}
            >
                    <div style={{ padding: '6px 12px', borderBottom: '1px solid #dee2e6', background: '#f8f9fa', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 11 }}>
                        <span style={{ color: '#555', fontWeight: 'bold' }}>Columns:</span>
                        {columnChoices.length === 0 && (
                            <span style={{ color: '#999' }} title="Hidden by the saved print layout — change it in Print Layouts.">No ledger table in the saved print layout</span>
                        )}
                        {columnChoices.map(c => (
                            <label key={c.field} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#333' }}>
                                <input type="checkbox" checked={visibleCols[c.field] !== false} onChange={() => toggleCol(c.field)} />
                                {c.label.replace(/\n/g, ' ')}
                            </label>
                        ))}
                    </div>

                    <div style={{ flex: 1, background: '#e0e0e0', overflow: 'auto', padding: 16, display: 'flex', alignItems: 'flex-start' }}>
                        {/* True size; auto margins centre it without clipping when wider than the pane. */}
                        <div style={{
                            background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                            width: `${paperW}mm`, minHeight: `${paperH}mm`, padding: `${layout.paper.marginMm}mm`,
                            boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                        }}>
                            <TemplateRenderer layout={layout} ctx={ctx} docType={STOCK_LEDGER_DOC} />
                        </div>
                    </div>

                    <PrintModalFooter note="Paper size, orientation and margins come from Print Layouts — no need to change the browser print dialog." onClose={onClose} onPrint={handlePrint} />
            </PrintModalShell>

            <TemplatePrintPortal layout={layout} ctx={ctx} docType={STOCK_LEDGER_DOC} />
        </>
    );
}
