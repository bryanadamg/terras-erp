'use client';
import React from 'react';

import type {
    PrintLayout, Band, GridBand, GridItem, FieldSpec, KeyValueBand, KeyValueRow,
    TableBand, TableColumn, TallyBand, SignatureBand, SpacerBand, Align, CellStyle,
} from './types';
import type { PrintContext } from './renderContext';
import { resolveField, fieldDef } from './fieldRegistry';
import { rowSource } from './rowSources';
import { CODE_FONT, PRINT_SERIF_FONT } from '../xpTheme';

/**
 * Renders a print layout to JSX.
 *
 * This is the single render path — the on-screen preview, the hidden print
 * portal, and the designer canvas all call this with the same layout object. That
 * is deliberate: the old print modals hand-maintained two copies of each document
 * (screen + portal) with different padding and widths, and they drifted. One
 * renderer means the preview is the printout.
 *
 * Styling constants below are lifted from the KartuKerjaCard*.tsx bodies this
 * replaces, so an untouched default layout prints byte-identically.
 */

const LBL_CELL: React.CSSProperties = {
    background: '#f0f0f0', border: '1px solid #bbb', padding: '3px 6px',
    fontSize: 9, color: '#333', fontWeight: 'bold', whiteSpace: 'nowrap',
};
const VAL_CELL: React.CSSProperties = {
    border: '1px solid #bbb', padding: '3px 6px', fontSize: 11, color: '#000',
};
const MINI_LABEL: React.CSSProperties = {
    fontSize: 8, color: '#555', fontWeight: 'bold', letterSpacing: '0.5px',
};
const UNIT: React.CSSProperties = { fontSize: 9, color: '#666', fontWeight: 'normal' };
const TH: React.CSSProperties = { border: '1px solid #bbb', padding: '2px 5px' };
// `wordBreak` matters under the fixed table layout a set column width switches on:
// without it a long unbroken item code overflows its cell instead of widening it.
// Top-aligned: a multi-line cell (item name + variant lines) must not float its
// one-line neighbours to the middle of the row.
const TD: React.CSSProperties = { border: '1px solid #bbb', padding: '2px 5px', wordBreak: 'break-word', verticalAlign: 'top' };

const EM_DASH = '—';

/**
 * Per-print overrides keyed by band id. The print modal's "Step Materials" /
 * "Signature Line" checkboxes drive this, so a one-off print can drop a band
 * without editing the saved template.
 */
export type BandVisibilityOverrides = Record<string, boolean>;

interface Props {
    layout: PrintLayout;
    ctx: PrintContext;
    docType: string;
    bandOverrides?: BandVisibilityOverrides;
    /**
     * Designer hooks. `selectedId` outlines the active band/item; `onSelect` fires
     * on click. Both omitted when printing.
     */
    selectedId?: string | null;
    onSelect?: (id: string) => void;
}

// ── value rendering ────────────────────────────────────────────────────────────

function fmtNumber(v: any, decimals: number | undefined, emptyText: string): string {
    if (v == null || v === '' || Number.isNaN(Number(v))) return emptyText;
    return decimals != null ? Number(v).toFixed(decimals) : String(v);
}

/**
 * A resolved field rendered with its placement styling. `field` is optional because
 * a grid cell that holds a `stack` carries no field of its own.
 */
function FieldValue({ item, ctx, docType }: {
    item: Omit<FieldSpec, 'field'> & { field?: string };
    ctx: PrintContext;
    docType: string;
}) {
    if (!item.field) return null;
    const def = fieldDef(docType, item.field);
    const resolved = resolveField(item.field, ctx);

    if (def?.kind === 'qr') {
        const size = item.qrSize ?? 140;
        const framed = item.qrFrame !== false;
        return (
            <div style={{ ...(framed ? { border: '2px solid #000', padding: 4 } : {}), textAlign: 'center', display: 'inline-block' }}>
                {resolved.qrDataUrl ? (
                    <img
                        src={resolved.qrDataUrl}
                        alt="QR"
                        style={{ width: size, height: size, display: 'block', imageRendering: 'pixelated' }}
                    />
                ) : (
                    <div style={{
                        width: size, height: size, background: '#eee', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: 7, color: '#888',
                    }}>...</div>
                )}
                {item.qrCaption !== '' && (
                    <div style={{ fontSize: 6, color: '#555', marginTop: 1 }}>
                        {item.qrCaption ?? 'Scan in ERP Scanner'}
                    </div>
                )}
            </div>
        );
    }

    if (def?.kind === 'blank') {
        return <div style={{ borderBottom: '1px solid #000', minHeight: 14 }}>&nbsp;</div>;
    }

    if (def?.kind === 'barcode') {
        if (resolved.empty) return null;
        const right = item.align === 'right';
        return (
            <div style={{ display: 'flex', justifyContent: right ? 'flex-end' : item.align === 'center' ? 'center' : 'flex-start' }}>
                <DecorativeBarcode value={resolved.text} height={item.imageHeight ?? 42} />
            </div>
        );
    }

    if (def?.kind === 'image') {
        if (!resolved.imageUrl) return null;
        const centred = item.align === 'center';
        return (
            <img src={resolved.imageUrl} alt="" style={{
                display: 'block', maxHeight: item.imageHeight ?? 34, maxWidth: '100%', objectFit: 'contain',
                marginLeft: centred || item.align === 'right' ? 'auto' : undefined,
                marginRight: centred ? 'auto' : undefined,
            }} />
        );
    }

    // A static field prints its placement's own text; a data field prints its value,
    // or the placement's `emptyText` in place of the dash when there is none.
    const text = def?.kind === 'static'
        ? (item.text ?? '')
        : (resolved.empty && item.emptyText !== undefined ? item.emptyText : resolved.text);

    // `unit` is only appended when there is an actual value — "— kg" reads as broken.
    const unit = item.unit !== undefined ? item.unit : def?.unit;
    const showUnit = !!unit && !resolved.empty;

    const style: React.CSSProperties = {
        fontSize: item.fontSize ?? 11,
        fontWeight: item.bold ? 'bold' : 'normal',
        fontFamily: (item.mono ?? def?.mono) ? CODE_FONT : item.serif ? PRINT_SERIF_FONT : undefined,
        letterSpacing: item.letterSpacing != null ? `${item.letterSpacing}px` : undefined,
        textAlign: item.align,
        color: item.color,
        lineHeight: (item.fontSize ?? 11) >= 17 ? 1.05 : undefined,
        wordBreak: 'break-word',
        whiteSpace: text.includes('\n') ? 'pre-line' : undefined,
        textTransform: item.uppercase ? 'uppercase' : undefined,
        ...(item.maxLines
            ? {
                display: '-webkit-box',
                WebkitLineClamp: item.maxLines,
                WebkitBoxOrient: 'vertical' as any,
                overflow: 'hidden',
            }
            : {}),
    };

    return (
        <div style={style}>
            {item.prefix && <span style={{ fontWeight: item.prefixBold ? 'bold' : 'normal' }}>{item.prefix}</span>}
            {text}
            {showUnit && <span style={UNIT}>{` ${unit}`}</span>}
        </div>
    );
}

/**
 * Bar strip derived from the value — decoration that reads as "document number",
 * NOT a scannable symbology. Lifted from the old PO print so a ported PO looks the
 * same; anything that must scan uses the `qr` kind.
 */
function DecorativeBarcode({ value, height }: { value: string; height: number }) {
    const bars: { w: number; on: boolean }[] = [];
    for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        bars.push({ w: (c % 3) + 1, on: true }, { w: (c % 2) + 1, on: false }, { w: ((c >> 2) % 3) + 1, on: true }, { w: 1, on: false });
    }
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', height }}>
            {bars.map((b, i) => <div key={i} style={{ width: b.w * 1.4, height: '100%', background: b.on ? '#000' : 'transparent' }} />)}
        </div>
    );
}

// ── bands ──────────────────────────────────────────────────────────────────────

function GridBandView({ band, ctx, docType, selectedId, onSelect }: {
    band: GridBand; ctx: PrintContext; docType: string;
    selectedId?: string | null; onSelect?: (id: string) => void;
}) {
    return (
        <div data-tpl-grid={band.id} style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(12, 1fr)',
            gap: band.gap ?? 6,
            alignItems: band.alignItems ?? 'start',
        }}>
            {band.items.map((item, i) => {
                const itemId = `${band.id}:${i}`;

                // Stacked cell: several fields at their natural spacing in one grid
                // cell, so a tall sibling (the QR) can't stretch them apart.
                const stack: FieldSpec[] | null = item.stack
                    ? item.stack.filter(f => !(f.hideWhenEmpty && resolveField(f.field, ctx).empty))
                    : null;

                if (!stack && item.hideWhenEmpty && item.field && resolveField(item.field, ctx).empty) return null;
                if (stack && stack.length === 0) return null;

                return (
                    <div
                        key={itemId}
                        data-tpl-cell={itemId}
                        onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(itemId); } : undefined}
                        style={{
                            gridColumn: `${item.col} / span ${item.span}`,
                            gridRow: `${item.row} / span ${item.rowSpan ?? 1}`,
                            minWidth: 0,
                            ...(item.valign ? { alignSelf: item.valign } : {}),
                            ...(band.cellBox ? { border: band.cellBox, padding: '3px 8px' } : {}),
                            ...(item.align === 'right' ? { textAlign: 'right' as const } : {}),
                            ...(selectedId === itemId ? { outline: '2px solid #0058e6', outlineOffset: 1 } : {}),
                            cursor: onSelect ? 'pointer' : undefined,
                            ...(stack ? {
                                display: 'flex',
                                flexDirection: 'column' as const,
                                gap: item.stackGap ?? 1,
                            } : {}),
                        }}
                    >
                        {stack
                            ? stack.map((f, fi) => {
                                const fDef = fieldDef(docType, f.field);
                                const fLabel = f.label ?? fDef?.label ?? '';
                                const sfId = `${itemId}:${fi}`;
                                return (
                                    <div
                                        key={fi}
                                        data-tpl-stackfield={sfId}
                                        onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(sfId); } : undefined}
                                        style={{ minWidth: 0, ...(selectedId === sfId ? { outline: '2px solid #0058e6', outlineOffset: 1 } : {}) }}
                                    >
                                        {f.showLabel && fLabel && <div style={MINI_LABEL}>{fLabel}</div>}
                                        <FieldValue item={f} ctx={ctx} docType={docType} />
                                    </div>
                                );
                            })
                            : (() => {
                                const def = fieldDef(docType, item.field);
                                const label = item.label ?? def?.label ?? '';
                                return (
                                    <>
                                        {item.showLabel && label && <div style={MINI_LABEL}>{label}</div>}
                                        <FieldValue item={item} ctx={ctx} docType={docType} />
                                    </>
                                );
                            })()}
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Label/value grid. Rows with `span >= 3` take a full line; consecutive half rows
 * pair up two-per-line, reproducing the 4-cell table the old cards drew.
 */
function KeyValueBandView({ band, ctx, docType, selectedId, onSelect }: {
    band: KeyValueBand; ctx: PrintContext; docType: string;
    selectedId?: string | null; onSelect?: (id: string) => void;
}) {
    const visible: { row: KeyValueRow; index: number }[] = [];
    band.rows.forEach((row, index) => {
        const resolved = resolveField(row.field, ctx);
        if (row.hideWhenEmpty && resolved.empty) return;
        visible.push({ row, index });
    });

    // Pack into table rows.
    const lines: { row: KeyValueRow; index: number }[][] = [];
    let pending: { row: KeyValueRow; index: number }[] = [];
    visible.forEach(entry => {
        const full = (entry.row.span ?? 1) >= 3;
        if (full) {
            if (pending.length) { lines.push(pending); pending = []; }
            lines.push([entry]);
        } else {
            pending.push(entry);
            if (pending.length === 2) { lines.push(pending); pending = []; }
        }
    });
    if (pending.length) lines.push(pending);

    // `plain` drops the ruled grid for unboxed "Label : value" lines.
    const plain = band.variant === 'plain';
    const rule = band.ruleColor ? `1px solid ${band.ruleColor}` : undefined;
    const lblStyle: React.CSSProperties = plain
        ? { padding: '0 8px 0 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontSize: band.labelFontSize ?? 9, fontWeight: band.labelBold ? 'bold' : undefined }
        : {
            ...LBL_CELL, fontSize: band.labelFontSize ?? 9,
            ...(rule ? { border: rule, color: '#000' } : {}),
            ...(band.labelBackground ? { background: band.labelBackground === 'none' ? 'transparent' : band.labelBackground } : {}),
        };
    const valStyle: React.CSSProperties = plain
        ? { padding: '0 12px 0 0', verticalAlign: 'top', fontSize: band.valueFontSize ?? 9 }
        : { ...VAL_CELL, fontSize: band.valueFontSize ?? 11, ...(rule ? { border: rule } : {}) };

    const renderCell = ({ row, index }: { row: KeyValueRow; index: number }, halfCount: number) => {
        const def = fieldDef(docType, row.field);
        const resolved = resolveField(row.field, ctx);
        const cellId = `${band.id}:${index}`;
        const full = (row.span ?? 1) >= 3;
        const unit = row.unit !== undefined ? row.unit : def?.unit;
        const showUnit = !!unit && !resolved.empty;
        const selected = selectedId === cellId;

        return (
            <React.Fragment key={cellId}>
                <td
                    data-tpl-kvrow={cellId}
                    data-tpl-kvlabel="1"
                    style={{
                        ...lblStyle,
                        width: full || halfCount === 1 ? band.labelWidth ?? (plain ? undefined : '24%') : undefined,
                        ...(selected ? { outline: '2px solid #0058e6' } : {}),
                        cursor: onSelect ? 'pointer' : undefined,
                    }}
                    onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(cellId); } : undefined}
                >
                    {row.label === '{auto}' ? (resolved.label ?? def?.label ?? '') : (row.label ?? def?.label ?? '')}
                </td>
                <td
                    data-tpl-kvrow={cellId}
                    colSpan={full ? 3 : 1}
                    onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(cellId); } : undefined}
                    style={{
                        ...valStyle,
                        fontSize: row.fontSize ?? valStyle.fontSize,
                        fontWeight: row.bold ? 'bold' : 'normal',
                        fontFamily: row.mono ? CODE_FONT : undefined,
                        textAlign: row.align,
                        whiteSpace: 'pre-line',
                        ...(row.fill ? { borderBottom: '1px solid #000' } : {}),
                        ...(selected ? { outline: '2px solid #0058e6' } : {}),
                    }}
                >
                    {plain && (band.separator ?? ': ')}
                    {row.field === '__blank' ? '\u00a0'
                        : row.field === '__text' ? (row.text ?? '')
                            : (resolved.empty && row.emptyText !== undefined ? row.emptyText : resolved.text)}
                    {showUnit && <span style={UNIT}>{` ${unit}`}</span>}
                </td>
            </React.Fragment>
        );
    };

    return (
        <table style={{
            width: band.width ?? (plain ? undefined : '100%'), borderCollapse: 'collapse',
            marginLeft: band.width && band.blockAlign !== 'left' && band.blockAlign ? 'auto' : undefined,
            marginRight: band.width && band.blockAlign === 'center' ? 'auto' : undefined,
        }}>
            <tbody>
                {lines.map((line, li) => (
                    <tr key={li}>{line.map(entry => renderCell(entry, line.length))}</tr>
                ))}
            </tbody>
        </table>
    );
}

function TableBandView({ band, ctx, rows, onSelect }: {
    band: TableBand; ctx: PrintContext; rows: Record<string, any>[];
    onSelect?: (id: string) => void;
}) {
    const source = rowSource(band.source);
    if (!source) return null;

    const fontSize = band.fontSize ?? 9;
    const rule = `1px solid ${band.ruleColor ?? '#bbb'}`;
    const th: React.CSSProperties = { ...TH, border: rule };
    const td: React.CSSProperties = { ...TD, border: rule };
    const headerBg = band.headerBackground === 'none' ? undefined : (band.headerBackground ?? '#f0f0f0');
    const cellStyle = (col: TableColumn, own?: CellStyle): React.CSSProperties => ({
        ...(col.dotted ? { ...TD, border: 'none', borderBottom: '1px dotted #777' } : td),
        textAlign: col.align ?? 'left',
        fontWeight: (own?.bold ?? col.bold) ? 'bold' : 'normal',
        fontFamily: col.mono ? CODE_FONT : undefined,
        color: own?.color ?? col.color,
        ...(own?.background ? { background: own.background } : {}),
    });
    const padRows = Math.max(0, (band.minRows ?? 0) - rows.length);
    const footerCells = band.columns.map(col => {
        const f = col.footer;
        if (!f) return null;
        const value = f.field ? resolveField(f.field, ctx) : null;
        return `${f.text ?? ''}${value && !value.empty ? value.text : ''}`;
    });
    const hasFooter = band.columns.some(c => c.footer)
        && !(band.hideBlankFooter && footerCells.every(t => !t || !t.trim()));
    let dataIndex = 0;

    return (
        <table style={{
            width: '100%', borderCollapse: 'collapse', fontSize,
            // A `width` on a th is only a suggestion under the auto table algorithm —
            // the browser widens the column anyway once the content doesn't fit, which
            // is most rows on an A6 card. So a width dragged in the designer printed
            // back at whatever the content wanted. Fixed layout only when the client
            // actually set one, so untouched tables keep sizing to their content.
            ...(band.columns.some(c => c.width) ? { tableLayout: 'fixed' as const } : {}),
        }}>
            <thead>
                <tr style={{ background: headerBg }}>
                    {band.columns.map((col, ci) => (
                        <th
                            key={col.field}
                            data-tpl-tablecol={`${band.id}:${ci}`}
                            onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(`${band.id}:${ci}`); } : undefined}
                            style={{ ...th, textAlign: col.headerAlign ?? col.align ?? 'left', width: col.width, whiteSpace: 'pre-line' }}
                        >
                            {col.label}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.length === 0 && band.emptyMessage && (
                    <tr>
                        <td colSpan={band.columns.length} style={{ ...td, textAlign: 'center', fontStyle: 'italic', color: '#666' }}>
                            {band.emptyMessage}
                        </td>
                    </tr>
                )}
                {rows.map((row, ri) => row._group != null ? (
                    <tr key={row._key ?? `g-${ri}`}>
                        <td colSpan={band.columns.length} style={{ ...td, fontWeight: 'bold', background: '#f4f4f4', ...(row._groupStyle || {}) }}>
                            {row._group}
                        </td>
                    </tr>
                ) : (
                    <tr key={row._key ?? ri} style={band.stripe && (dataIndex++ % 2 === 1) ? { background: band.stripe } : undefined}>
                        {band.columns.map(col => {
                            const raw = row[col.field];
                            const style = cellStyle(col, row._style?.[col.field]);
                            // Composite item cell: mono code then name, as the old card drew it.
                            if (col.field === 'item' && raw && typeof raw === 'object') {
                                return (
                                    <td key={col.field} style={style}>
                                        {raw.code && (
                                            <span style={{ fontFamily: CODE_FONT, color: '#555', marginRight: 4, fontSize: fontSize - 1 }}>
                                                {raw.code}
                                            </span>
                                        )}
                                        {raw.name}
                                    </td>
                                );
                            }
                            // Composite description cell: bold title, then detail lines under it.
                            if (raw && typeof raw === 'object' && 'title' in raw) {
                                return (
                                    <td key={col.field} style={style}>
                                        <div style={{ fontWeight: 'bold' }}>{raw.title}</div>
                                        {(raw.lines || []).map((ln: string, li: number) => (
                                            <div key={li} style={{ marginTop: 2, ...(col.mutedDetail ? { color: '#666', fontSize: fontSize - 1 } : {}) }}>{ln}</div>
                                        ))}
                                    </td>
                                );
                            }
                            const isNumeric = source.columns.find(c => c.field === col.field)?.numeric;
                            const text = isNumeric
                                ? fmtNumber(raw, col.decimals ?? 2, col.emptyText ?? EM_DASH)
                                : (raw == null || raw === '' ? (col.emptyText ?? EM_DASH) : String(raw));
                            return <td key={col.field} style={style}>{text}</td>;
                        })}
                    </tr>
                ))}
                {Array.from({ length: padRows }, (_, pi) => (
                    <tr key={`pad-${pi}`}>
                        {band.columns.map(col => <td key={col.field} style={{ ...cellStyle(col), height: band.padRowHeight }}>&nbsp;</td>)}
                    </tr>
                ))}
                {hasFooter && (
                    <tr>
                        {band.columns.map(col => {
                            const f = col.footer;
                            if (!f) return <td key={col.field} style={{ ...TD, border: 'none' }} />;
                            const value = f.field ? resolveField(f.field, ctx) : null;
                            return (
                                <td key={col.field} style={{
                                    ...(f.border === false ? { ...TD, border: 'none' } : td),
                                    textAlign: f.align ?? col.align ?? 'left',
                                    fontWeight: f.bold ? 'bold' : 'normal',
                                    whiteSpace: 'nowrap',
                                }}>
                                    {f.text}{value && !value.empty ? value.text : ''}
                                </td>
                            );
                        })}
                    </tr>
                )}
            </tbody>
        </table>
    );
}

function TallyBandView({ band }: { band: TallyBand }) {
    // Numbered write-in boxes ("Cek / 10 mnt").
    if (band.boxes) {
        const perRow = band.boxesPerRow ?? 6;
        return (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${perRow}, 1fr)`, gap: 2 }}>
                {Array.from({ length: band.boxes }, (_, i) => (
                    <div key={i} style={{
                        border: '1px solid #aaa', padding: '3px 4px',
                        fontSize: band.fontSize ?? 8, color: '#555',
                        minHeight: band.cellHeight ?? 22,
                    }}>
                        {i + 1}:
                    </div>
                ))}
            </div>
        );
    }

    // Column tally ("Jumlah Kantong/Box & Berat"). Auto-numbered cells count
    // sequentially in reading order across every autoNumber column.
    const cols = band.columns;
    const autoPerRow = cols.filter(c => c.autoNumber).length;
    const fontSize = band.fontSize ?? 9;

    return (
        <table style={{
            width: '100%', borderCollapse: 'collapse', fontSize,
            // Same reason as the data table: a set column width has to be honoured, or
            // the designer's column-border drag doesn't survive the print. Empty
            // hand-fill cells make this especially visible — with the auto algorithm
            // they all collapse to equal widths regardless of what was set.
            ...(cols.some(c => c.width) ? { tableLayout: 'fixed' as const } : {}),
        }}>
            <thead>
                <tr style={{ background: '#f0f0f0' }}>
                    {cols.map((c, i) => (
                        <th key={i} data-tpl-tallycol={`${band.id}:${i}`} style={{ ...TH, width: c.width }}>{c.label}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {Array.from({ length: band.rows }, (_, r) => {
                    let autoSeen = 0;
                    return (
                        <tr key={r}>
                            {cols.map((c, i) => {
                                if (c.autoNumber) {
                                    const n = r * autoPerRow + (++autoSeen);
                                    return (
                                        <td key={i} style={{ ...TD, padding: '3px 5px', textAlign: 'center', color: '#888' }}>
                                            {n}
                                        </td>
                                    );
                                }
                                return <td key={i} style={{ ...TD, padding: '3px 5px', minHeight: band.cellHeight }}>&nbsp;</td>;
                            })}
                        </tr>
                    );
                })}
                {band.totalRow && (
                    <tr>
                        <td colSpan={Math.max(1, cols.length - 2)} style={{ ...TD, padding: '3px 5px', fontWeight: 'bold', textAlign: 'right' }}>
                            {band.totalRow.label}
                        </td>
                        {cols.length >= 2 && (
                            <>
                                <td style={{ ...TD, padding: '3px 5px', fontWeight: 'bold', textAlign: 'right' }}>
                                    {band.totalRow.totalLabel ?? ''}
                                </td>
                                <td style={{ ...TD, padding: '3px 5px' }}>&nbsp;</td>
                            </>
                        )}
                    </tr>
                )}
            </tbody>
        </table>
    );
}

function SignatureBandView({ band, ctx, docType }: { band: SignatureBand; ctx: PrintContext; docType: string }) {
    if (band.variant === 'block') {
        return (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: band.fontSize ?? 9, textAlign: band.align }}>
                {band.boxes.map((box, i) => (
                    // One point short of an equal share, so neighbouring captions never touch.
                    <div key={i} data-tpl-sigbox={`${band.id}:${i}`} style={{ width: `${Math.floor(100 / Math.max(1, band.boxes.length)) - 1}%`, textAlign: box.align }}>
                        <div>{box.caption}</div>
                        <div style={{ height: box.height ?? 40 }} />
                        {(box.fields || []).map((f, fi) => {
                            const r = resolveField(f, ctx);
                            return r.empty ? null : <div key={fi} style={{ fontWeight: fi === 0 && band.boldFirstLine !== false ? 'bold' : 'normal' }}>{r.text}</div>;
                        })}
                    </div>
                ))}
            </div>
        );
    }
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
                {(band.footerFields || []).map((f, i) => {
                    const resolved = resolveField(f.field, ctx);
                    return (
                        <div key={i} style={{
                            fontSize: f.fontSize ?? 6, color: '#999', lineHeight: 1.3,
                            whiteSpace: 'pre-line',
                        }}>
                            {resolved.text}
                        </div>
                    );
                })}
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
                {band.boxes.map((box, i) => (
                    <div key={i} data-tpl-sigbox={`${band.id}:${i}`} style={{ textAlign: 'center' }}>
                        <div style={{
                            borderBottom: '1px solid #000',
                            height: box.height ?? 26,
                            width: box.width ?? 100,
                            marginBottom: 2,
                        }} />
                        <div style={{ fontSize: 8, fontWeight: 'bold' }}>{box.caption}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── band dispatcher ────────────────────────────────────────────────────────────

function BandView(props: {
    band: Band; ctx: PrintContext; docType: string;
    selectedId?: string | null; onSelect?: (id: string) => void;
}) {
    const { band, ctx, docType, selectedId, onSelect } = props;

    if (band.type === 'spacer') {
        // Returns before the wrapper below (a spacer has no caption or border to
        // draw), so it has to carry its own gap — the inspector edits it like any
        // other band's.
        const spacer = band as SpacerBand;
        return <div style={{ flexGrow: 1, minHeight: spacer.minHeight ?? 6, marginBottom: band.marginBottom ?? 0 }} />;
    }

    // Table bands resolve their rows HERE, not inside TableBandView. The child
    // returning null is invisible to this component (the element itself is always
    // truthy), which orphaned the band title above an empty table — the old cards
    // gated title and table together, and so must this.
    let rows: Record<string, any>[] | null = null;
    let autoTitle: string | undefined;
    if (band.type === 'table') {
        const source = rowSource((band as TableBand).source);
        if (!source) return null;
        const resolved = source.resolve(ctx, band as TableBand);
        rows = resolved.rows;
        autoTitle = resolved.autoTitle;
        if ((band as TableBand).hideWhenEmpty !== false && rows.length === 0) return null;
    }

    let content: React.ReactNode = null;
    switch (band.type) {
        case 'grid':
            content = <GridBandView band={band} ctx={ctx} docType={docType} selectedId={selectedId} onSelect={onSelect} />;
            break;
        case 'keyvalue':
            content = <KeyValueBandView band={band} ctx={ctx} docType={docType} selectedId={selectedId} onSelect={onSelect} />;
            break;
        case 'table':
            content = <TableBandView band={band} ctx={ctx} rows={rows || []} onSelect={onSelect} />;
            break;
        case 'tally':
            content = <TallyBandView band={band} />;
            break;
        case 'signature':
            content = <SignatureBandView band={band} ctx={ctx} docType={docType} />;
            break;
    }

    if (content === null) return null;

    // '{auto}' defers to the row source's suggested title.
    const title = band.title === '{auto}' ? autoTitle : band.title;

    const selected = selectedId === band.id;

    return (
        <div
            data-tpl-band={band.id}
            style={{
                marginBottom: band.marginBottom ?? 6,
                position: 'relative',
                ...(selected ? { outline: '2px dashed #0058e6', outlineOffset: 2 } : {}),
            }}
            onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(band.id); } : undefined}
        >
            {title && (
                <div style={{
                    fontSize: 8, fontWeight: 'bold', color: '#555', marginBottom: 2,
                    ...(band.titleUppercase ? { textTransform: 'uppercase' as const, letterSpacing: '0.3px' } : {}),
                }}>
                    {title}
                </div>
            )}
            {/* Longhands come after the `border` shorthand so they win when a band sets
                both. `borderTop` was missing here, which silently dropped the rule above
                every default's signature band and made the inspector's "Rule above"
                field edit nothing. */}
            {/* Longhands only when set: React writes an undefined style key as '', and
                `borderTop: ''` after the shorthand wipes the box's top edge. */}
            <div style={{
                border: band.box,
                ...(band.borderTop !== undefined ? { borderTop: band.borderTop } : {}),
                ...(band.borderBottom !== undefined ? { borderBottom: band.borderBottom } : {}),
                padding: band.padding,
            }}>
                {content}
            </div>
        </div>
    );
}

export default function TemplateRenderer({
    layout, ctx, docType, bandOverrides, selectedId, onSelect,
}: Props) {
    return (
        <div style={{
            fontFamily: layout.fontFamily ?? 'Arial, sans-serif',
            color: '#000',
            lineHeight: 1.3,
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            // Content inset in mm so preview and paper agree. The wrapper's print CSS
            // forces `padding: 0` on the paper element, so the inset has to live here
            // on the document root rather than on the card wrapper.
            padding: layout.paddingMm ? `${layout.paddingMm}mm` : undefined,
            boxSizing: 'border-box',
        }}>
            {layout.bands.map(band => {
                // A print-time override can only SUBTRACT a band, never resurrect one
                // the saved layout hides. It used to outrank `show`, and since the
                // modal's checkboxes default to `true` (and persist in localStorage),
                // that made "hide this band" in the designer a no-op on paper for
                // exactly the two bands the modal names.
                if (band.show === false) return null;
                if (bandOverrides?.[band.id] === false) return null;
                return (
                    <BandView
                        key={band.id}
                        band={band}
                        ctx={ctx}
                        docType={docType}
                        selectedId={selectedId}
                        onSelect={onSelect}
                    />
                );
            })}
        </div>
    );
}
