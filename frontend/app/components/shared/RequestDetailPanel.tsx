'use client';
import React from 'react';
import { FormSection } from '@bryanadamg/terras-ui/components/FormSection';
import { Table, EmptyRow } from '@bryanadamg/terras-ui/components/Table';

// ─────────────────────────────────────────────────────────────────────────────
// Shared expanded-row detail panel for request-style pages (Sample Requests,
// Lab Dip Requests). Two cards side by side on the panel's own ground:
//   LEFT  — the request's variants/colors as a terras-ui Table
//   RIGHT — grouped label/value sections
// Built only from terras-ui parts and tokens, so it follows the active theme.
// Cards size to their content — a one-variant request no longer leaves a void.
// ─────────────────────────────────────────────────────────────────────────────

export interface DetailColumn {
    header: React.ReactNode;
    width?: number;                         // fixed px width (via <colgroup>); omit → flexible
    align?: 'left' | 'center' | 'right';
}

export interface DetailRow {
    key: string;
    stripeColor?: string;                   // status rail on the first cell
    background?: string;                    // optional row tint
    cells: React.ReactNode[];               // one entry per column
}

export interface DetailField {
    label: React.ReactNode;
    value: React.ReactNode;
    full?: boolean;                         // span both grid columns
}

export interface DetailSection {
    title: React.ReactNode;
    fields: DetailField[];
}

// Status → rail colour (theme status tokens). Superset covering both pages.
const STATUS_RAIL: Record<string, string> = {
    PENDING:       'var(--terras-status-gray, #9e9e9e)',
    IN_PROGRESS:   'var(--terras-status-amber, #c77800)',
    IN_PRODUCTION: 'var(--terras-status-amber, #c77800)',
    SENT:          'var(--terras-status-blue, #3a5faa)',
    APPROVED:      'var(--terras-status-green, #27713a)',
    REJECTED:      'var(--terras-status-red, #a01a1a)',
};
export const getStatusStripe = (status: string): { borderLeftColor: string; background?: string } =>
    ({ borderLeftColor: STATUS_RAIL[status] || STATUS_RAIL.PENDING });

interface Props {
    leftTitle: React.ReactNode;
    leftWidth?: string;                     // default '56%'
    columns: DetailColumn[];
    rows: DetailRow[];
    emptyText?: string;
    sections: DetailSection[];
    minHeight?: number;                     // default 160 (ignored when `height` is set)
    height?: number;                        // fixed panel height; panes scroll internally past it
}

// Cards nested in a list row take a tinted header instead of the solid form blue:
// solid bars stacked under the list's own chrome read too heavy. The header reads its
// ground from this var, so overriding it on the card restyles just that bar.
const TINT = { '--terras-form-section-blue': 'var(--terras-chip-blue-bg, #dce4f5)' } as React.CSSProperties;
const CARD: React.CSSProperties = { ...TINT, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column' };
// Label beside value, two pairs per line — scans faster than label-over-value here.
const FIELD_GRID: React.CSSProperties = { margin: 0, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '4px 20px', fontFamily: 'var(--terras-font-classic)' };
const FIELD_LABEL: React.CSSProperties = { width: 110, flexShrink: 0, fontSize: 'var(--terras-fs-sm, 10px)', fontWeight: 'bold', color: 'var(--terras-win-text-2, #333)' };
const FIELD_VALUE: React.CSSProperties = { margin: 0, minWidth: 0, fontSize: 'var(--terras-fs-base, 11px)', color: 'var(--terras-win-text, #000)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const tintTitle = (t: React.ReactNode) => <span style={{ color: 'var(--terras-chip-blue-text, #0d2a6e)' }}>{t}</span>;

export default function RequestDetailPanel({
    leftTitle, leftWidth = '56%', columns, rows, emptyText = 'No rows.', sections, minHeight = 160, height,
}: Props) {
    // A fixed height clamps the panel and lets each card scroll its own overflow —
    // cards still size to their content (max 100%), so a short table leaves no void;
    // otherwise it grows with content (minHeight floor). min-width: 0 on the cards
    // stops their content width feeding back into the outer list table's layout.
    const fixed = height != null;
    const outer: React.CSSProperties = {
        display: 'flex', gap: 8, padding: 8, alignItems: 'flex-start',
        boxSizing: 'border-box', ...(fixed ? { height, overflow: 'hidden' } : { minHeight }),
    };
    const scroll: React.CSSProperties = fixed ? { overflowY: 'auto', flex: '0 1 auto', minHeight: 0 } : {};
    const last = columns.length - 1;

    return (
        <div style={outer}>
            <FormSection title={tintTitle(leftTitle)} style={{ ...CARD, width: leftWidth, flexShrink: 0, ...(fixed ? { maxHeight: '100%' } : {}) }} bodyStyle={{ padding: 0, ...scroll }}>
                <Table style={{ tableLayout: 'fixed', borderLeft: 'none', borderTop: 'none' }}>
                    <colgroup>
                        {columns.map((col, i) => <col key={i} style={col.width ? { width: col.width } : undefined} />)}
                    </colgroup>
                    <thead>
                        <tr>
                            {columns.map((col, i) => (
                                <th key={i} style={{ textAlign: col.align || 'left', ...(i === last ? { borderRight: 'none' } : {}) }}>{col.header}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && <EmptyRow colSpan={columns.length}>{emptyText}</EmptyRow>}
                        {rows.map((row, ri) => (
                            <tr key={row.key}>
                                {row.cells.map((cell, ci) => (
                                    // Wrap, don't spill: a long name grows the row instead of painting over the next cell.
                                    <td key={ci} className="terras-cell-wrap" style={{
                                        overflowWrap: 'anywhere',
                                        textAlign: columns[ci]?.align || 'left',
                                        background: row.background,
                                        ...(ci === last ? { borderRight: 'none' } : {}),
                                        ...(ri === rows.length - 1 ? { borderBottom: 'none' } : {}),
                                        // Inset shadow, not border: zero width, so the rail can't shift the columns.
                                        ...(ci === 0 && row.stripeColor ? { boxShadow: `inset 3px 0 0 ${row.stripeColor}`, paddingLeft: 11 } : {}),
                                    }}>{cell}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </FormSection>

            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, ...(fixed ? { overflowY: 'auto', maxHeight: '100%' } : {}) }}>
                {sections.map((sec, si) => (
                    <FormSection key={si} title={tintTitle(sec.title)} style={{ ...TINT, margin: 0, flexShrink: 0 }} bodyStyle={{ padding: '6px 10px' }}>
                        <dl style={FIELD_GRID}>
                            {sec.fields.map((f, fi) => {
                                const empty = f.value == null || f.value === '' || f.value === '—';
                                return (
                                    <div key={fi} style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0, ...(f.full ? { gridColumn: '1 / -1' } : {}) }}>
                                        <dt style={FIELD_LABEL}>{f.label}</dt>
                                        <dd style={{ ...FIELD_VALUE, ...(empty ? { color: 'var(--terras-win-text-3, #666)' } : {}) }}>{empty ? '—' : f.value}</dd>
                                    </div>
                                );
                            })}
                        </dl>
                    </FormSection>
                ))}
            </div>
        </div>
    );
}
