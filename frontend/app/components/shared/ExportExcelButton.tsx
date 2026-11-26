'use client';

// "Export Excel" for any list screen. The screen names its columns once; this
// takes the rows (already fully loaded) or fetches them (every row matching the
// screen's filters, not just the page), maps them through the columns and has
// POST /export/xlsx render the file. Hidden without the screen's export grant.
import React, { useState } from 'react';
import { useData } from '../../context/DataContext';
import { useUser } from '../../context/UserContext';
import { useToast } from './Toast';
import { ToolbarButton } from './shellTheme';
import { API_BASE } from './apiBase';
import { saveResponse } from './download';

export type ExportCell = string | number | null | undefined;
export interface ExportColumn<T = any> {
    label: string;
    value: (row: T) => ExportCell;
}

/** A timestamp as local "YYYY-MM-DD HH:mm" (or a date-only value as-is). The API's
 *  naive timestamps are UTC, so one with no offset is read as UTC. */
export function xlsDateTime(v: string | null | undefined): string | null {
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`);
    if (Number.isNaN(d.getTime())) return v;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Every row of a paginated list endpoint under the given query (size=0 = uncapped). */
export async function fetchAllRows(authFetch: (url: string) => Promise<Response>, endpoint: string, params: Record<string, any> = {}): Promise<any[]> {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '' && v !== false) q.set(k, String(v));
    });
    q.set('page', '1');
    q.set('size', '0');
    const res = await authFetch(`${endpoint}${endpoint.includes('?') ? '&' : '?'}${q}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : (data.items || []);
}

/** The one face of every "Export Excel" button — labelled, neutral, placed in the
 *  toolbar's right-hand action group (after the count, before create/print). */
export function ExcelButton({ busy, disabled, onClick, title }: {
    busy: boolean;
    disabled?: boolean;
    onClick: () => void;
    title?: string;
}) {
    return (
        <ToolbarButton tone="neutral" icon={busy ? 'bi-hourglass-split' : 'bi-file-earmark-excel'} disabled={busy || disabled} onClick={onClick} title={title}>
            {busy ? 'Exporting…' : 'Export Excel'}
        </ToolbarButton>
    );
}

export default function ExportExcelButton<T = any>({ grant, filename, sheet, columns, rows, fetchRows, disabled }: {
    /** `<resource>.export` — the button is hidden without it. */
    grant: string;
    filename: string;
    sheet?: string;
    columns: ExportColumn<T>[];
    /** Rows already fully loaded on the screen… */
    rows?: T[];
    /** …or how to load all of them (see fetchAllRows). */
    fetchRows?: () => Promise<T[]>;
    disabled?: boolean;
}) {
    const { authFetch } = useData() as any;
    const { hasPermission } = useUser();
    const { showToast } = useToast();
    const [busy, setBusy] = useState(false);
    if (!hasPermission(grant)) return null;

    const run = async () => {
        setBusy(true);
        try {
            const data = fetchRows ? await fetchRows() : (rows || []);
            const cell = (v: ExportCell) => (v === undefined || v === '' ? null : v);
            const res = await authFetch(`${API_BASE}/export/xlsx`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant,
                    sheet: (sheet || filename).slice(0, 64),
                    filename,
                    header: columns.map(c => c.label),
                    rows: data.map(r => columns.map(c => cell(c.value(r)))),
                }),
            });
            if (!res.ok) { showToast('Export failed', 'danger'); return; }
            await saveResponse(res, `${filename}.xlsx`);
        } catch {
            showToast('Export failed', 'danger');
        } finally {
            setBusy(false);
        }
    };

    return (
        <ExcelButton busy={busy} disabled={disabled} onClick={run} />
    );
}
