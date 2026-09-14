'use client';

import React from 'react';
import { xpFont, CHIP_RADIUS } from './xpTheme';
import { lvSubRow } from './listViewTheme';
import { actionIntent, INTENT_CHIP } from './permissionMatrix';

/**
 * The two shapes every permission surface is built from — the read-only
 * breakdown on role/user rows and the editable picker in the role/user modals.
 *
 * Both used to hand-roll their own chip and their own section box, which is how
 * "the panel I configure a role in" and "the panel I audit it in" ended up
 * looking like different objects. One chip, one section table, both themes.
 *
 * The chip is intent-tinted (create green / edit blue / delete red / print
 * amber / view grey) so a destructive grant is findable without reading labels,
 * and carries a glyph as well as colour so the on/off distinction survives for
 * anyone who can't separate the tints.
 */

export type PermissionChipState =
    /** granted, and clickable off (picker) */
    | 'on'
    /** not granted, clickable on (picker) */
    | 'off'
    /** granted, not removable here — inherited from the role (user picker) */
    | 'locked'
    /** granted, not interactive at all (read-only breakdown) */
    | 'static';

export function PermissionChip({ label, code, state, classic, direct = false, title, onClick }: {
    label: string;
    /** Permission code (`item.delete`) or bare action code (`delete`) — drives the tint. */
    code: string;
    state: PermissionChipState;
    classic: boolean;
    /** User rows: granted directly rather than through the role. */
    direct?: boolean;
    title?: string;
    onClick?: () => void;
}) {
    const c = INTENT_CHIP[actionIntent(code)];
    const on = state !== 'off';
    const interactive = state === 'on' || state === 'off';
    const style: React.CSSProperties = {
        fontFamily: xpFont,
        fontSize: 9.5,
        lineHeight: 1.6,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        background: on ? c.bg : '#f6f5f1',
        border: `1px solid ${direct ? '#00006e' : on ? c.border : '#d5d1c6'}`,
        color: direct ? '#00006e' : on ? c.fg : '#8d8779',
        fontWeight: on ? 'bold' : 'normal',
        opacity: state === 'locked' ? 0.7 : 1,
        padding: '1px 6px',
        borderRadius: CHIP_RADIUS,
        whiteSpace: 'nowrap',
        cursor: interactive ? 'pointer' : 'default',
    };

    const glyph = state === 'locked' ? 'bi-lock-fill' : state === 'off' ? 'bi-dash' : 'bi-check2';
    const body = (
        <>
            {state !== 'static' && (
                <i className={`bi ${glyph}`} style={{ fontSize: 8, opacity: on ? 1 : 0.55 }} />
            )}
            {label}
        </>
    );

    if (!interactive) return <span title={title} style={style}>{body}</span>;

    return (
        <button type="button" aria-pressed={state === 'on'} onClick={onClick} title={title} style={style}>
            {body}
        </button>
    );
}

export interface PermissionSectionRow {
    key: string;
    label: string;
    /** Second line under the label, e.g. a scope note ("by category"). */
    hint?: string;
    chips: React.ReactNode;
}

/**
 * One permission section as a bordered mini-table — the drill-down shape the
 * Booking Stock row detail uses. Header carries the section name plus whatever
 * the caller pins right (a granted count, All/Clear links); the body is one row
 * per resource, resource stated once with its action chips beside it.
 */
export function PermissionSectionTable({
    title, right, classic, rows, labelWidth = '38%', rowPaddingLeft, onHeaderClick, headerActive = true, style,
}: {
    title: React.ReactNode;
    right?: React.ReactNode;
    classic: boolean;
    rows: PermissionSectionRow[];
    labelWidth?: number | string;
    rowPaddingLeft?: number;
    /** Makes the header bar a click target (collapse toggle in the picker). */
    onHeaderClick?: () => void;
    /** Dims the header when the section has nothing granted. */
    headerActive?: boolean;
    style?: React.CSSProperties;
}) {
    const font = xpFont;
    const size = 10;
    return (
        <div style={{
            border: '1px solid #c0bdb5',
            borderRadius: 0,
            background: '#fff',
            overflow: 'hidden',
            // Never let a flex-column parent squash a section down to its first
            // row — the picker's scroll box is exactly that shape.
            flexShrink: 0,
            ...style,
        }}>
            <div
                onClick={onHeaderClick}
                style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: headerActive ? '#eef1f5' : '#f4f3ef',
                    borderBottom: '1px solid #b8c2cc',
                    padding: '5px 12px',
                    cursor: onHeaderClick ? 'pointer' : 'default',
                }}
            >
                <span style={{
                    fontFamily: font, fontSize: size, fontWeight: 'bold', color: '#33475b',
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                    display: 'flex', alignItems: 'center', gap: 5,
                }}>{title}</span>
                {right && <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>{right}</span>}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                    {/* Zebra on: with no header row and two ragged-height cells,
                        the stripe is the only thing tying a label to its chips.
                        Cell styling stays bespoke — this is a label/value list
                        rendered as a table, not a data grid, so lvSubTd's uniform
                        text metrics would fight the chip column. */}
                    {rows.map((r, i) => (
                        <tr key={r.key} style={lvSubRow(true, i, { zebra: true })}>
                            <td style={{
                                fontFamily: font, fontSize: size, color: '#000',
                                lineHeight: 1.5,
                                padding: '6px 10px',
                                // Body text lines up with the section header's label,
                                // not tight against the card edge.
                                paddingLeft: rowPaddingLeft ?? 12,
                                width: labelWidth,
                                verticalAlign: 'top',
                                borderRight: '1px solid #e6e3db',
                            }}>
                                {r.label}
                                {r.hint && (
                                    <div style={{ fontStyle: 'italic', color: '#9a948a', fontSize: 9}}>{r.hint}</div>
                                )}
                            </td>
                            <td style={{ padding: '5px 10px' }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{r.chips}</div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** Granted-of-total pill used in both permission panels' section headers. */
export function PermissionCountPill({ granted, total, classic }: { granted: number; total: number; classic: boolean }) {
    return (
        <span style={{
            fontFamily: xpFont,
            fontSize: 9,
            color: granted ? '#1a3d7a' : '#8b8578',
            background: '#fff',
            border: `1px solid ${granted ? '#a9bdd6' : '#d5d1c6'}`,
            borderRadius: CHIP_RADIUS,
            padding: '0 4px',
            fontWeight: 'normal',
        }}>{granted} / {total}</span>
    );
}
