'use client';
import React from 'react';

import type {
    PrintLayout, Band, GridBand, GridItem, FieldSpec, KeyValueBand,
    TableBand, TallyBand, SignatureBand, SpacerBand, Align,
} from '../shared/printTemplate/types';
import { FIELD_MANIFESTS } from '../shared/printTemplate/fieldRegistry';
import { paperPortraitMm, CUSTOM_MIN_MM, CUSTOM_MAX_MM } from '../shared/printTemplate/paper';
import { rowSource } from '../shared/printTemplate/rowSources';
import { describeBand, bandTypeLabel } from '../shared/printTemplate/bandLabel';
import { xpFont } from '../shared/xpTheme';
import { Row, TextField, NumberField, CheckField, SelectField, InspectorGroup, ListRowControls } from './controls';

/**
 * Property editor for whatever is selected on the canvas: the document, a band, or
 * one cell inside a band.
 *
 * Every control writes a whole new layout object through `onChange` — the layout is
 * plain JSON and small, so immutable replacement keeps undo/redo and dirty-tracking
 * trivial compared with mutating in place.
 */

const ALIGN_OPTS: { value: Align; label: string }[] = [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
];

const clone = (l: PrintLayout): PrintLayout => JSON.parse(JSON.stringify(l));

function move<T>(arr: T[], from: number, to: number): T[] {
    if (to < 0 || to >= arr.length) return arr;
    const next = arr.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
}

export interface Selection {
    /** Band id, or null for the document itself. */
    bandId: string | null;
    /** Index of the selected cell/row within the band, if any. */
    itemIndex?: number;
    /** Index within a stacked cell's field list, if any. */
    stackIndex?: number;
}

interface Props {
    layout: PrintLayout;
    docType: string;
    selection: Selection;
    onChange: (next: PrintLayout) => void;
    onSelect: (sel: Selection) => void;
    classic: boolean;
}

export default function InspectorPanel({ layout, docType, selection, onChange, onSelect, classic }: Props) {
    const fields = FIELD_MANIFESTS[docType] || [];
    const fieldOpts = fields.map(f => ({ value: f.key, label: f.label }));

    const bandIndex = layout.bands.findIndex(b => b.id === selection.bandId);
    const band = bandIndex >= 0 ? layout.bands[bandIndex] : null;

    /** Replace the selected band with `patch` applied. */
    const patchBand = (patch: Record<string, any>) => {
        if (bandIndex < 0) return;
        const next = clone(layout);
        Object.assign(next.bands[bandIndex], patch);
        onChange(next);
    };

    /** Mutate the selected band through a callback; the band is already a clone. */
    const editBand = (fn: (b: any) => void) => {
        if (bandIndex < 0) return;
        const next = clone(layout);
        fn(next.bands[bandIndex]);
        onChange(next);
    };

    // ── Document ──────────────────────────────────────────────────────────────
    if (!band) {
        return (
            <>
                <InspectorGroup title="Paper" classic={classic}>
                    <Row label="Size" classic={classic}>
                        <SelectField
                            classic={classic}
                            value={layout.paper.size}
                            options={[
                                { value: 'A4', label: 'A4 (210 x 297mm)' },
                                { value: 'A5', label: 'A5 (148 x 210mm)' },
                                { value: 'A6', label: 'A6 (105 x 148mm)' },
                                { value: 'custom', label: 'Custom...' },
                            ]}
                            onChange={v => {
                                const n = clone(layout);
                                n.paper.size = v as any;
                                // Seed the custom fields from whatever sheet was showing, so
                                // picking Custom starts from the current page instead of blank
                                // inputs that would render a collapsed sheet mid-edit.
                                if (v === 'custom' && (!n.paper.widthMm || !n.paper.heightMm)) {
                                    const [w, h] = paperPortraitMm(layout.paper);
                                    n.paper.widthMm = w;
                                    n.paper.heightMm = h;
                                }
                                onChange(n);
                            }}
                        />
                    </Row>
                    {layout.paper.size === 'custom' && (
                        <>
                            <Row label="Width" classic={classic} title="Portrait sheet width — orientation swaps it">
                                <NumberField
                                    classic={classic} suffix="mm" min={CUSTOM_MIN_MM} max={CUSTOM_MAX_MM}
                                    value={layout.paper.widthMm ?? paperPortraitMm(layout.paper)[0]}
                                    onChange={v => { const n = clone(layout); n.paper.widthMm = v; onChange(n); }}
                                />
                            </Row>
                            <Row label="Height" classic={classic} title="Portrait sheet height — orientation swaps it">
                                <NumberField
                                    classic={classic} suffix="mm" min={CUSTOM_MIN_MM} max={CUSTOM_MAX_MM}
                                    value={layout.paper.heightMm ?? paperPortraitMm(layout.paper)[1]}
                                    onChange={v => { const n = clone(layout); n.paper.heightMm = v; onChange(n); }}
                                />
                            </Row>
                        </>
                    )}
                    <Row label="Orientation" classic={classic}>
                        <SelectField
                            classic={classic}
                            value={layout.paper.orientation}
                            options={[
                                { value: 'portrait', label: 'Portrait' },
                                { value: 'landscape', label: 'Landscape' },
                            ]}
                            onChange={v => { const n = clone(layout); n.paper.orientation = v as any; onChange(n); }}
                        />
                    </Row>
                    <Row label="Page margin" classic={classic} title="Area the printer cannot reach">
                        <NumberField
                            classic={classic} suffix="mm" min={0} max={30}
                            value={layout.paper.marginMm}
                            onChange={v => { const n = clone(layout); n.paper.marginMm = v ?? 0; onChange(n); }}
                        />
                    </Row>
                    <Row label="Inner padding" classic={classic} title="Breathing room the design asks for, inside the page margin the printer cannot reach">
                        <NumberField
                            classic={classic} suffix="mm" min={0} max={30}
                            value={layout.paddingMm}
                            onChange={v => { const n = clone(layout); n.paddingMm = v; onChange(n); }}
                        />
                    </Row>
                </InspectorGroup>

                <InspectorGroup title="Type" classic={classic}>
                    <Row label="Font" classic={classic}>
                        <SelectField
                            classic={classic}
                            value={layout.fontFamily ?? 'Arial, sans-serif'}
                            options={[
                                { value: 'Arial, sans-serif', label: 'Arial' },
                                { value: '"Times New Roman", serif', label: 'Times New Roman' },
                                { value: 'Tahoma, sans-serif', label: 'Tahoma' },
                                { value: '"Courier New", monospace', label: 'Courier New' },
                            ]}
                            onChange={v => { const n = clone(layout); n.fontFamily = v; onChange(n); }}
                        />
                    </Row>
                </InspectorGroup>

                <div style={{
                    fontFamily: classic ? xpFont : undefined, fontSize: 10,
                    color: '#888', fontStyle: 'italic',
                }}>
                    Select a section on the left, or click any field on the paper, to edit it.
                </div>
            </>
        );
    }

    // ── Band-level properties shared by every band type ───────────────────────
    // Heading names the section the way the list does — "grid band" told you the
    // shape of the thing you had just clicked, which you could already see.
    const bandCommon = (
        <>
            <InspectorGroup
                title={`Section ${bandIndex + 1} — ${bandTypeLabel(band)}`}
                classic={classic}
            >
                <div style={{
                    fontFamily: classic ? xpFont : undefined, fontSize: 11, fontWeight: 'bold',
                    marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }} title={describeBand(band, docType)}>
                    {describeBand(band, docType)}
                </div>
                <Row label="Caption" classic={classic} title="Small heading printed above the section. Leave empty for none.">
                    <TextField
                        classic={classic}
                        value={band.title}
                        placeholder="(none)"
                        onChange={v => patchBand({ title: v || undefined })}
                    />
                </Row>
                {band.title && (
                    <CheckField
                        classic={classic} label="Caption in CAPITALS"
                        checked={!!band.titleUppercase}
                        onChange={v => patchBand({ titleUppercase: v || undefined })}
                    />
                )}
                <Row label="Space below" classic={classic}>
                    <NumberField
                        classic={classic} suffix="px" min={0} max={60}
                        value={band.marginBottom}
                        onChange={v => patchBand({ marginBottom: v })}
                    />
                </Row>
            </InspectorGroup>

            {/* Raw CSS shorthands. Kept — they are the fastest way to draw a rule or a
                box, and this page has one admin user — but demoted, because they were
                the first four controls you met on selecting anything. */}
            <InspectorGroup title="Frame (CSS)" classic={classic} collapsible>
                <Row label="Border" classic={classic} title="CSS border, e.g. 1px solid #000">
                    <TextField classic={classic} value={band.box} placeholder="(none)" mono
                        onChange={v => patchBand({ box: v || undefined })} />
                </Row>
                <Row label="Rule above" classic={classic} title="CSS border, e.g. 1px solid #000">
                    <TextField classic={classic} value={band.borderTop} placeholder="(none)" mono
                        onChange={v => patchBand({ borderTop: v || undefined })} />
                </Row>
                <Row label="Rule below" classic={classic} title="CSS border, e.g. 1px solid #000">
                    <TextField classic={classic} value={band.borderBottom} placeholder="(none)" mono
                        onChange={v => patchBand({ borderBottom: v || undefined })} />
                </Row>
                <Row label="Padding" classic={classic} title="CSS padding, e.g. 4px 8px">
                    <TextField classic={classic} value={band.padding} placeholder="(none)" mono
                        onChange={v => patchBand({ padding: v || undefined })} />
                </Row>
            </InspectorGroup>
        </>
    );

    // ── Grid band: cell list + selected-cell editor ───────────────────────────
    const gridEditor = () => {
        const g = band as GridBand;
        const sel = selection.itemIndex;
        const item: GridItem | null = sel != null ? g.items[sel] : null;

        const patchItem = (patch: Record<string, any>) => {
            if (sel == null) return;
            editBand(b => Object.assign(b.items[sel], patch));
        };
        const patchStackField = (patch: Record<string, any>) => {
            if (sel == null || selection.stackIndex == null) return;
            editBand(b => Object.assign(b.items[sel].stack[selection.stackIndex!], patch));
        };

        const stackField: FieldSpec | null =
            item?.stack && selection.stackIndex != null ? item.stack[selection.stackIndex] : null;

        /** Styling controls shared by a plain cell and a stacked field. */
        const styleControls = (spec: FieldSpec | GridItem, apply: (p: Record<string, any>) => void) => (
            <>
                <Row label="Field" classic={classic}>
                    <SelectField classic={classic} value={spec.field as any} options={fieldOpts}
                        onChange={v => apply({ field: v })} />
                </Row>
                <Row label="Font size" classic={classic}>
                    <NumberField classic={classic} suffix="px" min={4} max={72}
                        value={spec.fontSize} onChange={v => apply({ fontSize: v })} />
                </Row>
                <Row label="Align" classic={classic}>
                    <SelectField classic={classic} value={spec.align ?? 'left'} options={ALIGN_OPTS}
                        onChange={v => apply({ align: v })} />
                </Row>
                <Row label="Colour" classic={classic}>
                    <TextField classic={classic} value={spec.color} placeholder="#000" mono
                        onChange={v => apply({ color: v || undefined })} />
                </Row>
                <CheckField classic={classic} label="Bold" checked={!!spec.bold}
                    onChange={v => apply({ bold: v || undefined })} />
                <CheckField classic={classic} label="Monospace" checked={!!spec.mono}
                    onChange={v => apply({ mono: v || undefined })} />
                <CheckField classic={classic} label="Show caption above value" checked={!!spec.showLabel}
                    onChange={v => apply({ showLabel: v || undefined })} />
                {spec.showLabel && (
                    <Row label="Caption" classic={classic}>
                        <TextField classic={classic} value={spec.label} placeholder="(field name)"
                            onChange={v => apply({ label: v || undefined })} />
                    </Row>
                )}
                <Row label="Unit" classic={classic} title="Printed after the value in small type. Empty removes it.">
                    <TextField classic={classic} value={spec.unit} placeholder="(default)"
                        onChange={v => apply({ unit: v })} />
                </Row>
                <CheckField classic={classic} label="Hide when empty (no dash)" checked={!!spec.hideWhenEmpty}
                    onChange={v => apply({ hideWhenEmpty: v || undefined })} />
                {spec.field === 'wo.qr' && (
                    <>
                        <Row label="QR size" classic={classic}>
                            <NumberField classic={classic} suffix="px" min={40} max={400}
                                value={spec.qrSize} onChange={v => apply({ qrSize: v })} />
                        </Row>
                        <Row label="QR caption" classic={classic}>
                            <TextField classic={classic} value={spec.qrCaption} placeholder="Scan in ERP Scanner"
                                onChange={v => apply({ qrCaption: v })} />
                        </Row>
                    </>
                )}
            </>
        );

        return (
            <>
                <InspectorGroup
                    title="Cells"
                    classic={classic}
                    right={
                        <button
                            onClick={() => editBand(b => {
                                const maxRow = b.items.reduce((m: number, it: GridItem) => Math.max(m, it.row), 0);
                                b.items.push({ field: fields[0]?.key || '__blank', col: 1, span: 12, row: maxRow + 1 });
                            })}
                            title="Add a cell"
                            style={{
                                fontFamily: classic ? xpFont : undefined, fontSize: 10, lineHeight: 1,
                                padding: '1px 4px', cursor: 'pointer', borderRadius: 3,
                                background: classic ? 'linear-gradient(to bottom,#fff,#d4d0c8)' : '#f8f9fa',
                                border: '1px solid', borderColor: classic ? '#dfdfdf #808080 #808080 #dfdfdf' : '#ced4da',
                            }}
                        >
                            <i className="bi bi-plus" /> Add
                        </button>
                    }
                >
                    {g.items.map((it, i) => {
                        const selected = sel === i && selection.stackIndex == null;
                        const name = it.stack
                            ? `Stack (${it.stack.length})`
                            : (fields.find(f => f.key === it.field)?.label || it.field || '(none)');
                        return (
                            <div key={i}>
                                <div
                                    onClick={() => onSelect({ bandId: band.id, itemIndex: i })}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                                        fontFamily: classic ? xpFont : undefined, fontSize: 11,
                                        padding: '2px 3px', marginBottom: 1,
                                        background: selected ? (classic ? '#0058e6' : '#0d6efd') : 'transparent',
                                        color: selected ? '#fff' : (classic ? '#2b2822' : '#212529'),
                                    }}
                                >
                                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {name}
                                        <span style={{ opacity: 0.6, marginLeft: 4 }}>
                                            r{it.row} c{it.col}-{it.col + it.span - 1}
                                        </span>
                                    </span>
                                    <ListRowControls
                                        classic={classic}
                                        canUp={i > 0} canDown={i < g.items.length - 1}
                                        onUp={() => editBand(b => { b.items = move(b.items, i, i - 1); })}
                                        onDown={() => editBand(b => { b.items = move(b.items, i, i + 1); })}
                                        onRemove={() => {
                                            editBand(b => { b.items.splice(i, 1); });
                                            onSelect({ bandId: band.id });
                                        }}
                                    />
                                </div>
                                {/* Stacked fields are nested one level; click to edit one. */}
                                {it.stack && it.stack.map((sf, si) => {
                                    const sSel = sel === i && selection.stackIndex === si;
                                    return (
                                        <div
                                            key={si}
                                            onClick={() => onSelect({ bandId: band.id, itemIndex: i, stackIndex: si })}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                                                fontFamily: classic ? xpFont : undefined, fontSize: 10.5,
                                                padding: '1px 3px 1px 16px', marginBottom: 1,
                                                background: sSel ? (classic ? '#0058e6' : '#0d6efd') : 'transparent',
                                                color: sSel ? '#fff' : '#555',
                                            }}
                                        >
                                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {fields.find(f => f.key === sf.field)?.label || sf.field}
                                            </span>
                                            <ListRowControls
                                                classic={classic}
                                                canUp={si > 0} canDown={si < it.stack!.length - 1}
                                                onUp={() => editBand(b => { b.items[i].stack = move(b.items[i].stack, si, si - 1); })}
                                                onDown={() => editBand(b => { b.items[i].stack = move(b.items[i].stack, si, si + 1); })}
                                                onRemove={() => {
                                                    editBand(b => { b.items[i].stack.splice(si, 1); });
                                                    onSelect({ bandId: band.id, itemIndex: i });
                                                }}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </InspectorGroup>

                <InspectorGroup title="Grid" classic={classic}>
                    <Row label="Gap" classic={classic}>
                        <NumberField classic={classic} suffix="px" min={0} max={40}
                            value={g.gap} onChange={v => patchBand({ gap: v })} />
                    </Row>
                    <Row label="Cell border" classic={classic} title="Draws a box around every cell (the Qty/Ends look)">
                        <TextField classic={classic} value={g.cellBox} placeholder="(none)" mono
                            onChange={v => patchBand({ cellBox: v || undefined })} />
                    </Row>
                    <Row label="Vertical" classic={classic}>
                        <SelectField classic={classic} value={g.alignItems ?? 'start'}
                            options={[
                                { value: 'start', label: 'Top' },
                                { value: 'center', label: 'Middle' },
                                { value: 'end', label: 'Bottom' },
                            ]}
                            onChange={v => patchBand({ alignItems: v })} />
                    </Row>
                </InspectorGroup>

                {stackField && (
                    <InspectorGroup title="Stacked field" classic={classic}>
                        {styleControls(stackField, patchStackField)}
                    </InspectorGroup>
                )}

                {item && !stackField && (
                    <>
                        <InspectorGroup title="Position" classic={classic}>
                            <Row label="Column" classic={classic} title="1-12 across the page">
                                <NumberField classic={classic} min={1} max={12}
                                    value={item.col} onChange={v => patchItem({ col: v ?? 1 })} />
                            </Row>
                            <Row label="Width" classic={classic} title="Number of the 12 columns this cell spans">
                                <NumberField classic={classic} suffix="/12" min={1} max={12}
                                    value={item.span} onChange={v => patchItem({ span: v ?? 1 })} />
                            </Row>
                            <Row label="Row" classic={classic} title="Cells sharing a row sit side by side">
                                <NumberField classic={classic} min={1} max={20}
                                    value={item.row} onChange={v => patchItem({ row: v ?? 1 })} />
                            </Row>
                        </InspectorGroup>

                        {item.stack ? (
                            <InspectorGroup
                                title="Stack"
                                classic={classic}
                                right={
                                    <button
                                        onClick={() => editBand(b => { b.items[sel!].stack.push({ field: fields[0]?.key || '__blank' }); })}
                                        title="Add a field to this stack"
                                        style={{
                                            fontFamily: classic ? xpFont : undefined, fontSize: 10, lineHeight: 1,
                                            padding: '1px 4px', cursor: 'pointer', borderRadius: 3,
                                            background: classic ? 'linear-gradient(to bottom,#fff,#d4d0c8)' : '#f8f9fa',
                                            border: '1px solid', borderColor: classic ? '#dfdfdf #808080 #808080 #dfdfdf' : '#ced4da',
                                        }}
                                    >
                                        <i className="bi bi-plus" /> Field
                                    </button>
                                }
                            >
                                <Row label="Line gap" classic={classic}>
                                    <NumberField classic={classic} suffix="px" min={0} max={20}
                                        value={item.stackGap} onChange={v => patchItem({ stackGap: v })} />
                                </Row>
                                <Row label="Align" classic={classic}>
                                    <SelectField classic={classic} value={item.align ?? 'left'} options={ALIGN_OPTS}
                                        onChange={v => patchItem({ align: v })} />
                                </Row>
                                <div style={{ fontFamily: classic ? xpFont : undefined, fontSize: 10, color: '#888', fontStyle: 'italic' }}>
                                    Pick a field under this stack in the Cells list to style it.
                                </div>
                            </InspectorGroup>
                        ) : (
                            <InspectorGroup title="Field" classic={classic}>
                                {styleControls(item, patchItem)}
                            </InspectorGroup>
                        )}
                    </>
                )}
            </>
        );
    };

    // ── Key/value band ────────────────────────────────────────────────────────
    const keyValueEditor = () => {
        const kv = band as KeyValueBand;
        const sel = selection.itemIndex;
        const row = sel != null ? kv.rows[sel] : null;
        const patchRow = (patch: Record<string, any>) => {
            if (sel == null) return;
            editBand(b => Object.assign(b.rows[sel], patch));
        };

        return (
            <>
                <InspectorGroup
                    title="Rows"
                    classic={classic}
                    right={
                        <button
                            onClick={() => editBand(b => b.rows.push({ field: fields[0]?.key || '__blank', span: 1 }))}
                            title="Add a row"
                            style={{
                                fontFamily: classic ? xpFont : undefined, fontSize: 10, lineHeight: 1,
                                padding: '1px 4px', cursor: 'pointer', borderRadius: 3,
                                background: classic ? 'linear-gradient(to bottom,#fff,#d4d0c8)' : '#f8f9fa',
                                border: '1px solid', borderColor: classic ? '#dfdfdf #808080 #808080 #dfdfdf' : '#ced4da',
                            }}
                        >
                            <i className="bi bi-plus" /> Add
                        </button>
                    }
                >
                    {kv.rows.map((r, i) => {
                        const selected = sel === i;
                        return (
                            <div
                                key={i}
                                onClick={() => onSelect({ bandId: band.id, itemIndex: i })}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                                    fontFamily: classic ? xpFont : undefined, fontSize: 11,
                                    padding: '2px 3px', marginBottom: 1,
                                    background: selected ? (classic ? '#0058e6' : '#0d6efd') : 'transparent',
                                    color: selected ? '#fff' : (classic ? '#2b2822' : '#212529'),
                                }}
                            >
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {r.label || fields.find(f => f.key === r.field)?.label || r.field}
                                    <span style={{ opacity: 0.6, marginLeft: 4 }}>
                                        {(r.span ?? 1) >= 3 ? 'full' : 'half'}
                                    </span>
                                </span>
                                <ListRowControls
                                    classic={classic}
                                    canUp={i > 0} canDown={i < kv.rows.length - 1}
                                    onUp={() => editBand(b => { b.rows = move(b.rows, i, i - 1); })}
                                    onDown={() => editBand(b => { b.rows = move(b.rows, i, i + 1); })}
                                    onRemove={() => {
                                        editBand(b => { b.rows.splice(i, 1); });
                                        onSelect({ bandId: band.id });
                                    }}
                                />
                            </div>
                        );
                    })}
                </InspectorGroup>

                <InspectorGroup title="Table" classic={classic}>
                    <Row label="Label width" classic={classic}>
                        <TextField classic={classic} value={kv.labelWidth} placeholder="24%"
                            onChange={v => patchBand({ labelWidth: v || undefined })} />
                    </Row>
                    <Row label="Label size" classic={classic}>
                        <NumberField classic={classic} suffix="px" min={4} max={24}
                            value={kv.labelFontSize} onChange={v => patchBand({ labelFontSize: v })} />
                    </Row>
                    <Row label="Value size" classic={classic}>
                        <NumberField classic={classic} suffix="px" min={4} max={24}
                            value={kv.valueFontSize} onChange={v => patchBand({ valueFontSize: v })} />
                    </Row>
                </InspectorGroup>

                {row && (
                    <InspectorGroup title="Row" classic={classic}>
                        <Row label="Field" classic={classic}>
                            <SelectField classic={classic} value={row.field as any} options={fieldOpts}
                                onChange={v => patchRow({ field: v })} />
                        </Row>
                        <Row label="Label" classic={classic}>
                            <TextField classic={classic} value={row.label} placeholder="(field name)"
                                onChange={v => patchRow({ label: v || undefined })} />
                        </Row>
                        <Row label="Width" classic={classic} title="Full rows take a whole line; half rows pair up two per line">
                            <SelectField classic={classic}
                                value={(row.span ?? 1) >= 3 ? 'full' : 'half'}
                                options={[{ value: 'half', label: 'Half line (pairs up)' }, { value: 'full', label: 'Full line' }]}
                                onChange={v => patchRow({ span: v === 'full' ? 3 : 1 })} />
                        </Row>
                        <Row label="Font size" classic={classic}>
                            <NumberField classic={classic} suffix="px" min={4} max={24}
                                value={row.fontSize} onChange={v => patchRow({ fontSize: v })} />
                        </Row>
                        <Row label="Unit" classic={classic}>
                            <TextField classic={classic} value={row.unit} placeholder="(default)"
                                onChange={v => patchRow({ unit: v })} />
                        </Row>
                        <CheckField classic={classic} label="Bold value" checked={!!row.bold}
                            onChange={v => patchRow({ bold: v || undefined })} />
                        <CheckField classic={classic} label="Hide row when empty" checked={!!row.hideWhenEmpty}
                            onChange={v => patchRow({ hideWhenEmpty: v || undefined })} />
                        <CheckField classic={classic} label="Underline for hand fill-in" checked={!!row.fill}
                            onChange={v => patchRow({ fill: v || undefined })} />
                    </InspectorGroup>
                )}
            </>
        );
    };

    // ── Table band ────────────────────────────────────────────────────────────
    const tableEditor = () => {
        const tb = band as TableBand;
        const source = rowSource(tb.source);
        const available = source?.columns || [];
        const sel = selection.itemIndex;
        const col = sel != null ? tb.columns[sel] : null;
        const patchCol = (patch: Record<string, any>) => {
            if (sel == null) return;
            editBand(b => Object.assign(b.columns[sel], patch));
        };
        const unused = available.filter(a => !tb.columns.some(c => c.field === a.field));

        return (
            <>
                <InspectorGroup title="Columns" classic={classic}>
                    {tb.columns.map((c, i) => {
                        const selected = sel === i;
                        return (
                            <div
                                key={i}
                                onClick={() => onSelect({ bandId: band.id, itemIndex: i })}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                                    fontFamily: classic ? xpFont : undefined, fontSize: 11,
                                    padding: '2px 3px', marginBottom: 1,
                                    background: selected ? (classic ? '#0058e6' : '#0d6efd') : 'transparent',
                                    color: selected ? '#fff' : (classic ? '#2b2822' : '#212529'),
                                }}
                            >
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {c.label}
                                    {c.width && <span style={{ opacity: 0.6, marginLeft: 4 }}>{c.width}</span>}
                                </span>
                                <ListRowControls
                                    classic={classic}
                                    canUp={i > 0} canDown={i < tb.columns.length - 1}
                                    onUp={() => editBand(b => { b.columns = move(b.columns, i, i - 1); })}
                                    onDown={() => editBand(b => { b.columns = move(b.columns, i, i + 1); })}
                                    onRemove={tb.columns.length > 1 ? () => {
                                        editBand(b => { b.columns.splice(i, 1); });
                                        onSelect({ bandId: band.id });
                                    } : undefined}
                                />
                            </div>
                        );
                    })}
                    {unused.length > 0 && (
                        <div style={{ marginTop: 5 }}>
                            <div style={{ fontFamily: classic ? xpFont : undefined, fontSize: 10, color: '#888', marginBottom: 2 }}>
                                Available:
                            </div>
                            {unused.map(a => (
                                <button
                                    key={a.field}
                                    onClick={() => editBand(b => b.columns.push({
                                        field: a.field, label: a.label,
                                        align: a.numeric ? 'right' : 'left',
                                        ...(a.numeric ? { decimals: 2 } : {}),
                                    }))}
                                    style={{
                                        fontFamily: classic ? xpFont : undefined, fontSize: 10,
                                        padding: '1px 4px', marginRight: 3, marginBottom: 3, cursor: 'pointer',
                                        borderRadius: 0,
                                        background: classic ? 'linear-gradient(to bottom,#fff,#d4d0c8)' : '#f8f9fa',
                                        border: '1px solid',
                                        borderColor: classic ? '#dfdfdf #808080 #808080 #dfdfdf' : '#ced4da',
                                    }}
                                >
                                    <i className="bi bi-plus" /> {a.label}
                                </button>
                            ))}
                        </div>
                    )}
                </InspectorGroup>

                <InspectorGroup title="Table" classic={classic}>
                    <Row label="Font size" classic={classic}>
                        <NumberField classic={classic} suffix="px" min={4} max={24}
                            value={tb.fontSize} onChange={v => patchBand({ fontSize: v })} />
                    </Row>
                    <CheckField classic={classic} label="Hide section when no rows" checked={tb.hideWhenEmpty !== false}
                        onChange={v => patchBand({ hideWhenEmpty: v })} />
                    <div style={{ fontFamily: classic ? xpFont : undefined, fontSize: 10, color: '#888', fontStyle: 'italic' }}>
                        Rows come from: {source?.label || tb.source}. This table grows with the
                        data and splits across pages on its own.
                    </div>
                </InspectorGroup>

                {col && (
                    <InspectorGroup title="Column" classic={classic}>
                        <Row label="Heading" classic={classic}>
                            <TextField classic={classic} value={col.label}
                                onChange={v => patchCol({ label: v })} />
                        </Row>
                        <Row label="Width" classic={classic} title="Percentage, e.g. 22%. Empty shares the leftover space.">
                            <TextField classic={classic} value={col.width} placeholder="(auto)"
                                onChange={v => patchCol({ width: v || undefined })} />
                        </Row>
                        <Row label="Align" classic={classic}>
                            <SelectField classic={classic} value={col.align ?? 'left'} options={ALIGN_OPTS}
                                onChange={v => patchCol({ align: v })} />
                        </Row>
                        <Row label="Decimals" classic={classic}>
                            <NumberField classic={classic} min={0} max={6}
                                value={col.decimals} onChange={v => patchCol({ decimals: v })} />
                        </Row>
                        <Row label="When empty" classic={classic} title="Printed when there is no value. Empty string leaves the cell blank for hand entry.">
                            <TextField classic={classic} value={col.emptyText} placeholder="—"
                                onChange={v => patchCol({ emptyText: v })} />
                        </Row>
                        <CheckField classic={classic} label="Bold" checked={!!col.bold}
                            onChange={v => patchCol({ bold: v || undefined })} />
                    </InspectorGroup>
                )}
            </>
        );
    };

    // ── Tally band (hand fill-in grids) ───────────────────────────────────────
    const tallyEditor = () => {
        const tl = band as TallyBand;
        const isBoxes = !!tl.boxes;
        return (
            <>
                <InspectorGroup title="Style" classic={classic}>
                    <Row label="Kind" classic={classic}>
                        <SelectField classic={classic}
                            value={isBoxes ? 'boxes' : 'columns'}
                            options={[
                                { value: 'boxes', label: 'Numbered boxes' },
                                { value: 'columns', label: 'Columns with headings' },
                            ]}
                            onChange={v => {
                                if (v === 'boxes') patchBand({ boxes: tl.boxes ?? 12, boxesPerRow: tl.boxesPerRow ?? 6 });
                                else patchBand({
                                    boxes: undefined, boxesPerRow: undefined,
                                    columns: tl.columns?.length ? tl.columns : [{ label: 'No.', width: '14%', autoNumber: true }, { label: 'Value' }],
                                    rows: tl.rows || 3,
                                });
                            }} />
                    </Row>
                    <Row label="Font size" classic={classic}>
                        <NumberField classic={classic} suffix="px" min={4} max={24}
                            value={tl.fontSize} onChange={v => patchBand({ fontSize: v })} />
                    </Row>
                    <Row label="Cell height" classic={classic} title="How much room the operator gets to write">
                        <NumberField classic={classic} suffix="px" min={8} max={80}
                            value={tl.cellHeight} onChange={v => patchBand({ cellHeight: v })} />
                    </Row>
                </InspectorGroup>

                {isBoxes ? (
                    <InspectorGroup title="Boxes" classic={classic}>
                        <Row label="Count" classic={classic}>
                            <NumberField classic={classic} min={1} max={60}
                                value={tl.boxes} onChange={v => patchBand({ boxes: v ?? 1 })} />
                        </Row>
                        <Row label="Per row" classic={classic}>
                            <NumberField classic={classic} min={1} max={12}
                                value={tl.boxesPerRow} onChange={v => patchBand({ boxesPerRow: v ?? 1 })} />
                        </Row>
                    </InspectorGroup>
                ) : (
                    <>
                        <InspectorGroup
                            title="Columns"
                            classic={classic}
                            right={
                                <button
                                    onClick={() => editBand(b => b.columns.push({ label: 'Value' }))}
                                    title="Add a column"
                                    style={{
                                        fontFamily: classic ? xpFont : undefined, fontSize: 10, lineHeight: 1,
                                        padding: '1px 4px', cursor: 'pointer', borderRadius: 3,
                                        background: classic ? 'linear-gradient(to bottom,#fff,#d4d0c8)' : '#f8f9fa',
                                        border: '1px solid', borderColor: classic ? '#dfdfdf #808080 #808080 #dfdfdf' : '#ced4da',
                                    }}
                                >
                                    <i className="bi bi-plus" /> Add
                                </button>
                            }
                        >
                            {(tl.columns || []).map((c, i) => (
                                <div key={i} style={{ marginBottom: 5, paddingBottom: 4, borderBottom: '1px dotted #ccc' }}>
                                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 3 }}>
                                        <TextField classic={classic} value={c.label}
                                            onChange={v => editBand(b => { b.columns[i].label = v; })} />
                                        <ListRowControls
                                            classic={classic}
                                            canUp={i > 0} canDown={i < (tl.columns.length - 1)}
                                            onUp={() => editBand(b => { b.columns = move(b.columns, i, i - 1); })}
                                            onDown={() => editBand(b => { b.columns = move(b.columns, i, i + 1); })}
                                            onRemove={tl.columns.length > 1 ? () => editBand(b => { b.columns.splice(i, 1); }) : undefined}
                                        />
                                    </div>
                                    <Row label="Width" classic={classic}>
                                        <TextField classic={classic} value={c.width} placeholder="(auto)"
                                            onChange={v => editBand(b => { b.columns[i].width = v || undefined; })} />
                                    </Row>
                                    <CheckField classic={classic} label="Pre-print row numbers" checked={!!c.autoNumber}
                                        onChange={v => editBand(b => { b.columns[i].autoNumber = v || undefined; })} />
                                </div>
                            ))}
                        </InspectorGroup>

                        <InspectorGroup title="Rows" classic={classic}>
                            <Row label="Count" classic={classic}>
                                <NumberField classic={classic} min={1} max={40}
                                    value={tl.rows} onChange={v => patchBand({ rows: v ?? 1 })} />
                            </Row>
                            <CheckField classic={classic} label="Total row at the bottom" checked={!!tl.totalRow}
                                onChange={v => patchBand({ totalRow: v ? { label: 'Jumlah', totalLabel: 'Total' } : undefined })} />
                            {tl.totalRow && (
                                <>
                                    <Row label="Label" classic={classic}>
                                        <TextField classic={classic} value={tl.totalRow.label}
                                            onChange={v => editBand(b => { b.totalRow.label = v; })} />
                                    </Row>
                                    <Row label="Total label" classic={classic}>
                                        <TextField classic={classic} value={tl.totalRow.totalLabel}
                                            onChange={v => editBand(b => { b.totalRow.totalLabel = v; })} />
                                    </Row>
                                </>
                            )}
                        </InspectorGroup>
                    </>
                )}
            </>
        );
    };

    // ── Signature band ────────────────────────────────────────────────────────
    const signatureEditor = () => {
        const sg = band as SignatureBand;
        return (
            <>
                <InspectorGroup
                    title="Signature boxes"
                    classic={classic}
                    right={
                        <button
                            onClick={() => editBand(b => b.boxes.push({ caption: 'DISETUJUI', width: 100, height: 26 }))}
                            title="Add a signature box"
                            style={{
                                fontFamily: classic ? xpFont : undefined, fontSize: 10, lineHeight: 1,
                                padding: '1px 4px', cursor: 'pointer', borderRadius: 3,
                                background: classic ? 'linear-gradient(to bottom,#fff,#d4d0c8)' : '#f8f9fa',
                                border: '1px solid', borderColor: classic ? '#dfdfdf #808080 #808080 #dfdfdf' : '#ced4da',
                            }}
                        >
                            <i className="bi bi-plus" /> Add
                        </button>
                    }
                >
                    {sg.boxes.map((b2, i) => (
                        <div key={i} style={{ marginBottom: 5, paddingBottom: 4, borderBottom: '1px dotted #ccc' }}>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 3 }}>
                                <TextField classic={classic} value={b2.caption}
                                    onChange={v => editBand(b => { b.boxes[i].caption = v; })} />
                                <ListRowControls
                                    classic={classic}
                                    canUp={i > 0} canDown={i < sg.boxes.length - 1}
                                    onUp={() => editBand(b => { b.boxes = move(b.boxes, i, i - 1); })}
                                    onDown={() => editBand(b => { b.boxes = move(b.boxes, i, i + 1); })}
                                    onRemove={() => editBand(b => { b.boxes.splice(i, 1); })}
                                />
                            </div>
                            <Row label="Width" classic={classic}>
                                <NumberField classic={classic} suffix="px" min={30} max={300}
                                    value={b2.width} onChange={v => editBand(b => { b.boxes[i].width = v; })} />
                            </Row>
                            <Row label="Height" classic={classic}>
                                <NumberField classic={classic} suffix="px" min={10} max={120}
                                    value={b2.height} onChange={v => editBand(b => { b.boxes[i].height = v; })} />
                            </Row>
                        </div>
                    ))}
                </InspectorGroup>

                <InspectorGroup title="Small print (left)" classic={classic}>
                    {(sg.footerFields || []).map((f, i) => (
                        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 3 }}>
                            <SelectField classic={classic} value={f.field as any} options={fieldOpts}
                                onChange={v => editBand(b => { b.footerFields[i].field = v; })} />
                            <div style={{ width: 52, flexShrink: 0 }}>
                                <NumberField classic={classic} suffix="px" min={4} max={16}
                                    value={f.fontSize} onChange={v => editBand(b => { b.footerFields[i].fontSize = v; })} />
                            </div>
                            <ListRowControls
                                classic={classic} canUp={false} canDown={false}
                                onUp={() => {}} onDown={() => {}}
                                onRemove={() => editBand(b => { b.footerFields.splice(i, 1); })}
                            />
                        </div>
                    ))}
                    <button
                        onClick={() => editBand(b => {
                            b.footerFields = b.footerFields || [];
                            b.footerFields.push({ field: fields[0]?.key || '__blank', fontSize: 6 });
                        })}
                        style={{
                            fontFamily: classic ? xpFont : undefined, fontSize: 10,
                            padding: '1px 4px', cursor: 'pointer', borderRadius: 3,
                            background: classic ? 'linear-gradient(to bottom,#fff,#d4d0c8)' : '#f8f9fa',
                            border: '1px solid', borderColor: classic ? '#dfdfdf #808080 #808080 #dfdfdf' : '#ced4da',
                        }}
                    >
                        <i className="bi bi-plus" /> Add line
                    </button>
                </InspectorGroup>
            </>
        );
    };

    const spacerEditor = () => (
        <InspectorGroup title="Spacer" classic={classic}>
            <Row label="Min height" classic={classic}>
                <NumberField classic={classic} suffix="px" min={0} max={200}
                    value={(band as SpacerBand).minHeight}
                    onChange={v => patchBand({ minHeight: v })} />
            </Row>
            <div style={{ fontFamily: classic ? xpFont : undefined, fontSize: 10, color: '#888', fontStyle: 'italic' }}>
                Absorbs leftover height so whatever follows sits at the bottom of the page.
            </div>
        </InspectorGroup>
    );

    return (
        <>
            {band.type !== 'spacer' && bandCommon}
            {band.type === 'grid' && gridEditor()}
            {band.type === 'keyvalue' && keyValueEditor()}
            {band.type === 'table' && tableEditor()}
            {band.type === 'tally' && tallyEditor()}
            {band.type === 'signature' && signatureEditor()}
            {band.type === 'spacer' && spacerEditor()}
        </>
    );
}
