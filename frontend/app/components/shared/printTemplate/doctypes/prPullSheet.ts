/**
 * Production Run Material Pull Sheet — data side of the template. Layout:
 * defaults/prPullSheet.ts.
 *
 * The requirement rows are NOT on the production run record: the print modal
 * fetches /production-runs/{id}/material-requirements and hands them in. So the
 * designer's sample run shows the header with an empty material table.
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import { txt, type PrintContext } from '../renderContext';
import { lotSizeLabel } from '../../LotChips';

export const PR_PULL_SHEET_DOC = 'pr_pull_sheet';

export const PR_FIELDS: FieldDef[] = [
    { key: 'pr.code', label: 'Production Run No', kind: 'text', group: 'Production Run', mono: true },
    { key: 'pr.products', label: 'Production Run (BOM items)', kind: 'text', group: 'Production Run' },
    { key: 'pr.sales_order', label: 'Sales Order (empty without one)', kind: 'text', group: 'Production Run' },
    { key: 'pr.customer', label: 'Customer (from the Sales Order)', kind: 'text', group: 'Production Run' },
    { key: 'pr.due_date', label: 'Due Date', kind: 'date', group: 'Production Run' },
    // The identity grid pairs Due Date with Sales Order when there is one, and gives
    // it the full row when there isn't — two placements, each empty in the other case.
    { key: 'pr.due_date_beside_so', label: 'Due Date (only when a Sales Order is set)', kind: 'date', group: 'Production Run' },
    { key: 'pr.due_date_alone', label: 'Due Date (only when no Sales Order)', kind: 'date', group: 'Production Run' },
    { key: 'pr.status', label: 'Status', kind: 'text', group: 'Production Run' },
    { key: 'pr.notes', label: 'Notes', kind: 'text', group: 'Production Run' },
    { key: 'pr.materials_note', label: 'Loading / no requirements message', kind: 'text', group: 'Production Run' },
    { key: 'pr.date', label: 'Tanggal (dd/mm/yyyy)', kind: 'date', group: 'Document' },
    { key: 'pr.printed', label: 'Printed (date + time)', kind: 'text', group: 'Document' },
    { key: 'pr.footer', label: 'Footer small print (No. PR / Printed)', kind: 'text', group: 'Document' },
    { key: 'pr.letterhead_name', label: 'Company name (only when no logo)', kind: 'text', group: 'Document' },
];

export function resolvePRPullSheetField(key: string, ctx: PrintContext): ResolvedField {
    const d = ctx.doc || {};
    const pr = d.pr || {};
    const hasSO = !!pr.sales_order_id;
    switch (key) {
        case 'pr.code': return txt(pr.code);
        case 'pr.products': return txt(d.products);
        case 'pr.sales_order': return hasSO ? { text: pr.sales_order_code || '—', empty: false } : txt('');
        case 'pr.customer': return txt(pr.so_customer_name);
        case 'pr.due_date': return txt(d.dueDate);
        case 'pr.due_date_beside_so': return hasSO ? { text: d.dueDate || '—', empty: false } : txt('');
        case 'pr.due_date_alone': return hasSO ? txt('') : { text: d.dueDate || '—', empty: false };
        case 'pr.status': return txt(pr.status);
        case 'pr.notes': return txt(pr.notes);
        case 'pr.materials_note': return txt(
            d.isLoading ? 'Loading material requirements...'
                : d.rowCount === 0 ? 'No component requirements found for this Production Run.' : '',
        );
        case 'pr.date': return txt(ctx.printDate);
        case 'pr.printed': return txt(d.printed);
        case 'pr.footer': return txt(`No. PR: ${pr.code || ''}\nPrinted: ${d.printed}`);
        case 'pr.letterhead_name': return txt(ctx.companyLogoUrl ? '' : ctx.companyName);
        default: return { text: '', empty: true };
    }
}

const PR_PULL_LINES: RowSourceDef = {
    id: 'pr_pull_lines',
    label: 'Material requirements (grouped by source location)',
    docTypes: [PR_PULL_SHEET_DOC],
    seedColumns: ['code', 'material', 'still_required'],
    columns: [
        { field: 'code', label: 'Code' },
        { field: 'material', label: 'Material (+ size, variant)' },
        { field: 'location', label: 'Source Location' },
        { field: 'uom', label: 'UOM' },
        { field: 'ends', label: 'Ends (Utas)' },
        { field: 'still_required', label: 'Still Required' },
        { field: 'available', label: 'Available' },
        { field: 'shortfall', label: 'Shortfall' },
    ],
    resolve: (ctx) => ({ rows: ctx.doc?.rows || [] }),
};

export const PR_ROW_SOURCES: RowSourceDef[] = [PR_PULL_LINES];

export function buildPRPullSheetContext({
    pr, reqs = [], isLoading = false, getLocationName, getAttributeValueName, formatDate,
    companyProfile, companyName, companyLogoUrl, tzFormatCustom,
}: {
    pr: any;
    reqs?: any[];
    isLoading?: boolean;
    getLocationName: (id: any) => string;
    getAttributeValueName: (id: any) => string;
    formatDate: (d: any) => string;
    companyProfile?: any;
    companyName?: string;
    companyLogoUrl?: string;
    tzFormatCustom: (iso: string, opts: Intl.DateTimeFormatOptions, locale?: string) => string;
}): PrintContext {
    const p = pr || {};

    // Group by resolved source location — one run of lines per store, each under a
    // full-width location heading row (`_group`), stores in name order.
    const byKey = new Map<string, any[]>();
    for (const r of reqs) {
        const key = r.location_id || '__unassigned__';
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key)!.push(r);
    }
    const groups = Array.from(byKey.entries())
        .map(([key, rows]) => ({ key, label: key === '__unassigned__' ? 'Unassigned Location' : getLocationName(key), rows }))
        .sort((a, b) => a.label.localeCompare(b.label));

    const rows: Record<string, any>[] = [];
    for (const g of groups) {
        rows.push({
            _key: `loc-${g.key}`, _group: g.label,
            _groupStyle: { color: '#003080', textTransform: 'uppercase', letterSpacing: '0.3px', fontSize: 9, background: '#fff', paddingTop: 5 },
        });
        for (const r of g.rows) {
            const attrs: string[] = (r.attribute_value_ids || []).map(getAttributeValueName).filter(Boolean);
            rows.push({
                _key: `${r.item_id}-${(r.attribute_value_ids || []).join(',')}-${r.size_label || ''}`,
                code: r.item_code,
                // Sizes net separately, so the picker is told which pile to pull.
                material: [r.item_name, r.size_label ? `(${r.size_label})` : '', attrs.length ? `[${attrs.join(', ')}]` : '']
                    .filter(Boolean).join(' '),
                location: g.label,
                uom: r.uom,
                ends: r.ends != null ? String(r.ends) : '—',
                still_required: Number(r.total_required).toFixed(3),
                available: Number(r.qty_available).toFixed(3),
                shortfall: r.shortfall > 0 ? Number(r.shortfall).toFixed(3) : '—',
                ...(r.shortfall > 0 ? { _style: { shortfall: { color: '#c00000', bold: true, background: '#fdecea' } } } : {}),
            });
        }
    }

    // Read off the run's root MOs, not its BOM entries: the MOs carry the size and
    // shade snapshot each entry was split into ("JC 81 RED — L 22.572 · XL 27.086").
    const byProduct = new Map<string, string[]>();
    for (const m of (p.manufacturing_orders || []) as any[]) {
        if (m.parent_mo_id || m.is_shared_component) continue;
        const name = [m.item_name || m.item_code, ...(m.attribute_value_ids || []).map(getAttributeValueName)]
            .filter(Boolean).join(' ');
        const size = lotSizeLabel(m);
        if (!byProduct.has(name)) byProduct.set(name, []);
        if (size) byProduct.get(name)!.push(`${size} ${Number(Number(m.qty).toFixed(3))}`);
    }
    const products = byProduct.size > 0
        ? Array.from(byProduct, ([name, sizes]) => (sizes.length ? `${name} — ${sizes.join(' · ')}` : name)).join(' / ')
        : p.bom_entries?.length > 0
            ? p.bom_entries.map((e: any) => e.bom?.item_name || e.bom?.item_code || e.bom?.code).filter(Boolean).join(' / ')
            : (p.bom?.item_name || p.bom?.item_code || p.bom?.code || '');
    const now = new Date().toISOString();

    return {
        workOrder: null,
        parentMO: null,
        doc: {
            pr: p,
            products,
            dueDate: formatDate(p.target_end_date) || '',
            rows,
            rowCount: reqs.length,
            isLoading,
            // Beam lines carry a warp-ends spec; nothing else does. The modal shows
            // the table band with the Ends column only when this run has one.
            showEnds: reqs.some((r: any) => r.ends != null),
            printed: tzFormatCustom(now, { dateStyle: 'short', timeStyle: 'short' }, 'id-ID'),
        },
        companyName,
        companyLogoUrl,
        companyProfile,
        printDate: tzFormatCustom(now, { day: '2-digit', month: '2-digit', year: 'numeric' }, 'id-ID'),
        formatDate,
        moAttributeValue: () => '',
    };
}
