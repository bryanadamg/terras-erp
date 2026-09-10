'use client';
import React, { useMemo, useState } from 'react';

import { FIELD_MANIFESTS, type FieldDef } from '../shared/printTemplate/fieldRegistry';
import type { Band } from '../shared/printTemplate/types';
import { bandAcceptsFields, placedFieldKeys } from '../shared/printTemplate/bandOps';
import { describeBand } from '../shared/printTemplate/bandLabel';
import { xpFont } from '../shared/xpTheme';

/**
 * The fields a document *can* carry, as a list you can add from.
 *
 * Every placeable field was already declared in `fieldRegistry` and reachable from
 * the inspector's per-cell Field dropdown — but only after selecting an existing
 * cell, which means the answer to "how do I add a field that isn't on the card" was
 * "add a cell you don't want, then repoint it". This is that list, grouped by the
 * `group` each field already declares, sitting next to the paper.
 *
 * Fields already on the card stay listed, dimmed: a field may legitimately appear
 * twice (a code in the header and again in the footer, a blank line per row), and
 * hiding placed ones is how "where did my field go" starts.
 *
 * Placing is a click, not a drag onto the paper — a drop target inside the drag
 * overlay is a much larger change, and the section a field lands in is stated
 * above the list so a click is never a guess.
 */
export default function FieldPalette({
    docType, bands, targetBand, classic, onPlace,
}: {
    docType: string;
    bands: Band[];
    /** The section a click adds to — the current selection. */
    targetBand: Band | null;
    classic: boolean;
    onPlace: (fieldKey: string) => void;
}) {
    const [search, setSearch] = useState('');
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

    const fields = FIELD_MANIFESTS[docType] || [];
    const placed = useMemo(() => placedFieldKeys(bands), [bands]);

    const groups = useMemo(() => {
        const byGroup = new Map<string, FieldDef[]>();
        fields.forEach(f => {
            const key = f.group || 'Other';
            if (!byGroup.has(key)) byGroup.set(key, []);
            byGroup.get(key)!.push(f);
        });
        return Array.from(byGroup.entries());
    }, [fields]);

    // A search flattens the groups: typing "qty" to then hunt through six collapsed
    // headings for the match would defeat the search.
    const q = search.trim().toLowerCase();
    const matches = q
        ? fields.filter(f => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q))
        : null;

    const canPlace = bandAcceptsFields(targetBand);

    const label = (text: string, extra?: React.CSSProperties) => ({
        fontFamily: classic ? xpFont : undefined,
        fontSize: 10, color: classic ? '#4a4436' : '#6c757d',
        ...extra,
    });

    const fieldRow = (f: FieldDef) => {
        const already = placed.has(f.key);
        return (
            <button
                key={f.key}
                type="button"
                disabled={!canPlace}
                onClick={() => onPlace(f.key)}
                title={already
                    ? `${f.label} — already on the card. Click to add another.`
                    : `Add ${f.label} to this section`}
                style={{
                    display: 'flex', alignItems: 'center', gap: 4, width: '100%',
                    textAlign: 'left', background: 'none', border: 'none',
                    padding: '2px 3px 2px 10px', borderRadius: 0,
                    fontFamily: classic ? xpFont : undefined, fontSize: 11,
                    color: !canPlace ? '#aaa' : (already ? '#8a8a8a' : (classic ? '#2b2822' : '#212529')),
                    cursor: canPlace ? 'pointer' : 'default',
                }}
                onMouseEnter={e => { if (canPlace) e.currentTarget.style.background = classic ? '#d6e6ff' : '#e7f1ff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
            >
                <i className="bi bi-plus" style={{ flexShrink: 0, opacity: canPlace ? 0.7 : 0.3 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.label}
                </span>
                {already && <span style={{ flexShrink: 0, fontSize: 9, opacity: 0.7 }}>on card</span>}
            </button>
        );
    };

    return (
        <div style={{ marginTop: 10, borderTop: classic ? '1px solid #b0a898' : '1px solid #dee2e6', paddingTop: 6 }}>
            <div style={label('', { fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 })}>
                Add a field
            </div>

            {/* Where a click lands, stated before the click. */}
            <div style={label('', { marginBottom: 4, fontStyle: canPlace ? undefined : 'italic' })}>
                {canPlace
                    ? <>Into: <span style={{ fontWeight: 'bold' }}>{describeBand(targetBand!, docType)}</span></>
                    : targetBand
                        ? `A ${targetBand.type} section holds no free fields — select a grid or label/value section.`
                        : 'Select a grid or label/value section first.'}
            </div>

            <input
                type="text"
                value={search}
                placeholder="Search fields..."
                onChange={e => setSearch(e.target.value)}
                style={classic
                    ? {
                        fontFamily: xpFont, fontSize: 11, border: '1px solid #7f9db9',
                        boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)', padding: '1px 4px',
                        background: '#fff', color: '#000', height: 19, width: '100%',
                        boxSizing: 'border-box', outline: 'none', borderRadius: 0, marginBottom: 4,
                    }
                    : {
                        fontSize: 12, border: '1px solid #ced4da', borderRadius: 4,
                        padding: '2px 6px', width: '100%', boxSizing: 'border-box',
                        color: '#000', marginBottom: 4,
                    }}
            />

            {matches
                ? (matches.length === 0
                    ? <div style={label('', { fontStyle: 'italic', padding: '2px 3px' })}>No field matches.</div>
                    : matches.map(fieldRow))
                : groups.map(([group, list]) => {
                    const open = !!openGroups[group];
                    return (
                        <div key={group}>
                            <button
                                type="button"
                                onClick={() => setOpenGroups(o => ({ ...o, [group]: !o[group] }))}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 3, width: '100%',
                                    textAlign: 'left', background: 'none', border: 'none',
                                    padding: '2px 3px', borderRadius: 0, cursor: 'pointer',
                                    fontFamily: classic ? xpFont : undefined, fontSize: 11,
                                    color: classic ? '#2b2822' : '#212529',
                                }}
                            >
                                <i className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`} style={{ fontSize: 8 }} />
                                {group}
                                <span style={{ opacity: 0.55, fontSize: 9 }}>{list.length}</span>
                            </button>
                            {open && list.map(fieldRow)}
                        </div>
                    );
                })}
        </div>
    );
}
