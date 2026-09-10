'use client';
import React from 'react';
import { xpFont, CODE_FONT } from '../shared/xpTheme';

/**
 * Dense form controls for the print designer's inspector.
 *
 * The inspector shows dozens of properties in a narrow column, so these are
 * deliberately tighter than the app's standard form controls (FormSection /
 * FieldLabel) — those are sized for full-page create/edit forms and would push the
 * inspector to twice the scroll length. Both themes still read correctly.
 */

const inputBase = (classic: boolean): React.CSSProperties => classic
    ? {
        fontFamily: xpFont, fontSize: 11, border: '1px solid #7f9db9',
        boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)', padding: '1px 4px',
        background: '#fff', color: '#000', height: 19, width: '100%',
        boxSizing: 'border-box', outline: 'none', borderRadius: 0,
    }
    : {
        fontSize: 12, border: '1px solid #ced4da', borderRadius: 4,
        padding: '2px 6px', width: '100%', boxSizing: 'border-box', color: '#000',
    };

export function Row({ label, classic, children, title }: {
    label: string; classic: boolean; children: React.ReactNode; title?: string;
}) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }} title={title}>
            <div style={{
                width: 74, flexShrink: 0,
                fontFamily: classic ? xpFont : undefined,
                fontSize: classic ? 11 : 11.5,
                color: classic ? '#2b2822' : '#495057',
            }}>
                {label}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        </div>
    );
}

export function TextField({ value, onChange, classic, placeholder, mono }: {
    value: string | undefined;
    onChange: (v: string) => void;
    classic: boolean;
    placeholder?: string;
    mono?: boolean;
}) {
    return (
        <input
            type="text"
            value={value ?? ''}
            placeholder={placeholder}
            onChange={e => onChange(e.target.value)}
            style={{ ...inputBase(classic), ...(mono ? { fontFamily: CODE_FONT } : {}) }}
        />
    );
}

/**
 * Numeric field. Empty input clears the property (emits undefined) rather than
 * writing 0 — the difference matters because most layout numbers fall back to a
 * sensible renderer default when absent.
 */
export function NumberField({ value, onChange, classic, min, max, step, suffix }: {
    value: number | undefined;
    onChange: (v: number | undefined) => void;
    classic: boolean;
    min?: number; max?: number; step?: number;
    suffix?: string;
}) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
                type="number"
                value={value ?? ''}
                min={min} max={max} step={step ?? 1}
                onChange={e => {
                    const raw = e.target.value;
                    if (raw === '') return onChange(undefined);
                    const n = Number(raw);
                    onChange(Number.isNaN(n) ? undefined : n);
                }}
                style={inputBase(classic)}
            />
            {suffix && (
                <span style={{
                    fontFamily: classic ? xpFont : undefined, fontSize: 10,
                    color: '#888', flexShrink: 0,
                }}>
                    {suffix}
                </span>
            )}
        </div>
    );
}

export function CheckField({ checked, onChange, classic, label }: {
    checked: boolean; onChange: (v: boolean) => void; classic: boolean; label: string;
}) {
    return (
        <label style={{
            display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
            fontFamily: classic ? xpFont : undefined,
            fontSize: classic ? 11 : 11.5,
            color: classic ? '#2b2822' : '#495057',
            marginBottom: 3,
        }}>
            <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
            {label}
        </label>
    );
}

export function SelectField<T extends string>({ value, options, onChange, classic }: {
    value: T | undefined;
    options: { value: T; label: string }[];
    onChange: (v: T) => void;
    classic: boolean;
}) {
    return (
        <select
            value={value ?? ''}
            onChange={e => onChange(e.target.value as T)}
            style={{ ...inputBase(classic), height: classic ? 19 : undefined }}
        >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    );
}

/**
 * Section divider inside the inspector column.
 *
 * `collapsible` groups start closed: they hold the properties that are correct to
 * expose but wrong to lead with (raw CSS shorthands), and an inspector that opens on
 * six blank CSS boxes reads as a form to fill in rather than as chrome to ignore.
 */
export function InspectorGroup({ title, classic, children, right, collapsible }: {
    title: string; classic: boolean; children: React.ReactNode;
    right?: React.ReactNode;
    collapsible?: boolean;
}) {
    const [open, setOpen] = React.useState(false);
    const shown = !collapsible || open;
    return (
        <div style={{ marginBottom: 10 }}>
            <div
                onClick={collapsible ? () => setOpen(o => !o) : undefined}
                style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    fontFamily: classic ? xpFont : undefined,
                    fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                    color: classic ? '#4a4436' : '#6c757d',
                    borderBottom: classic ? '1px solid #c0bdb5' : '1px solid #dee2e6',
                    paddingBottom: 2, marginBottom: shown ? 5 : 0,
                    cursor: collapsible ? 'pointer' : undefined,
                }}
            >
                <span>
                    {collapsible && (
                        <i
                            className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`}
                            style={{ marginRight: 3, fontSize: 8 }}
                        />
                    )}
                    {title}
                </span>
                {right}
            </div>
            {shown && children}
        </div>
    );
}

/** Up / down / remove cluster used by every reorderable list in the inspector. */
export function ListRowControls({ classic, onUp, onDown, onRemove, canUp, canDown }: {
    classic: boolean;
    onUp: () => void; onDown: () => void; onRemove?: () => void;
    canUp: boolean; canDown: boolean;
}) {
    const btn = (icon: string, onClick: () => void, disabled: boolean, title: string, danger?: boolean) => (
        <button
            onClick={e => { e.stopPropagation(); onClick(); }}
            disabled={disabled}
            title={title}
            style={{
                fontFamily: classic ? xpFont : undefined, fontSize: 10, lineHeight: 1,
                padding: '1px 3px', cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.35 : 1, borderRadius: 0,
                background: classic ? 'linear-gradient(to bottom,#fff,#d4d0c8)' : '#f8f9fa',
                border: '1px solid',
                borderColor: danger ? '#c00000' : (classic ? '#dfdfdf #808080 #808080 #dfdfdf' : '#ced4da'),
                color: danger ? '#c00000' : '#000',
            }}
        >
            <i className={`bi ${icon}`} />
        </button>
    );
    return (
        <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
            {btn('bi-chevron-up', onUp, !canUp, 'Move up')}
            {btn('bi-chevron-down', onDown, !canDown, 'Move down')}
            {onRemove && btn('bi-x', onRemove, false, 'Remove', true)}
        </span>
    );
}
