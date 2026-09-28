'use client';
import React, { useState } from 'react';
import { xpFont, rowStateBg, XP_BTN } from './xpTheme';
import { lvInput, lvBtn } from './listViewTheme';
import { xpToolbar } from './shellTheme';

// ── Column browser ───────────────────────────────────────────────────────────
// Fixed-depth hierarchy editor: one column per level, each column is the children
// of the selection to its left (Finder / Explorer "columns" view). Used by
// Categories (3 levels) and Locations (store → zone → bin). Both were hand-rolled
// with different row, header, add-form and hover-action shapes on each level;
// these primitives are the one shape. Pages own the data and the selection chain,
// this file owns only the chrome.

/** Row container. Columns share the width equally; stacks on narrow screens
 *  (`.column-panes` in globals.css). */
export function ColumnPanes({ children }: { children: React.ReactNode }) {
    return <div className="column-panes" style={{ flex: 1, minHeight: 0 }}>{children}</div>;
}

/** One level. `onAdd` shows the header "+"; `adding` is the form under the header. */
export function ColumnPane({ title, count, onAdd, addTitle, adding, dimmed, last, label, children }: {
    title: React.ReactNode;
    count?: number;
    onAdd?: () => void;
    addTitle?: string;
    adding?: React.ReactNode;
    /** Nothing selected upstream — pane is unreachable. */
    dimmed?: boolean;
    last?: boolean;
    label?: string;
    children: React.ReactNode;
}) {
    return (
        <div
            className="column-pane"
            role="listbox"
            aria-label={label}
            style={{
                flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
                borderRight: last ? 'none' : '1px solid #a0988c',
                background: dimmed ? '#f5f4ef' : '#fff',
            }}
        >
            <div style={xpToolbar({ flexShrink: 0, flexWrap: 'nowrap', justifyContent: 'space-between' })}>
                <span style={{ fontFamily: xpFont, fontSize: 11, fontWeight: 'bold', color: '#003080', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title}{count !== undefined && <span style={{ color: '#888', fontWeight: 'normal' }}> ({count})</span>}
                </span>
                {onAdd && (
                    <button type="button" className={XP_BTN} style={lvBtn('success', { padding: '1px 6px' })} title={addTitle} onClick={onAdd}>
                        <i className="bi bi-plus-lg" />
                    </button>
                )}
            </div>
            {adding}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{children}</div>
        </div>
    );
}

/** Inline add form under a pane header. Enter submits (native form), Esc cancels. */
export function ColumnAddBar({ onSubmit, onCancel, submitDisabled, hint, children }: {
    onSubmit: () => void;
    onCancel: () => void;
    submitDisabled?: boolean;
    /** Small line under the inputs, e.g. the code that will be generated. */
    hint?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <form
            onSubmit={e => { e.preventDefault(); if (!submitDisabled) onSubmit(); }}
            onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
            style={{ padding: '4px 6px', background: '#eef3fb', borderBottom: '1px solid #b0c4de' }}
        >
            <div style={{ display: 'flex', gap: 4 }}>
                {children}
                <button type="submit" className={XP_BTN} style={lvBtn('success', { padding: '1px 6px' })} disabled={submitDisabled}>Add</button>
            </div>
            {hint && <div style={{ marginTop: 3, fontFamily: xpFont, fontSize: 10, color: '#666' }}>{hint}</div>}
        </form>
    );
}

/** Text input for ColumnAddBar / ColumnRenameRow. `invalid` = red border + reason tooltip. */
export function ColumnInput({ invalid, style, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: string | false | null }) {
    return (
        <input
            {...rest}
            title={invalid || rest.title}
            style={lvInput({ flex: 1, minWidth: 0, ...(invalid ? { borderColor: '#c00000' } : {}), ...style })}
        />
    );
}

/** A row swapped for an input while renaming. Enter / blur commits, Esc cancels. */
export function ColumnRenameRow({ value, onChange, onCommit, onCancel }: {
    value: string; onChange: (v: string) => void; onCommit: () => void; onCancel: () => void;
}) {
    return (
        <div style={{ display: 'flex', padding: '2px 6px', background: rowStateBg('expanded'), borderBottom: '1px solid #eceae2' }}>
            <ColumnInput
                autoFocus
                value={value}
                onChange={e => onChange(e.target.value)}
                onBlur={onCommit}
                onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); onCommit(); }
                    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
                }}
                aria-label="Name"
            />
        </div>
    );
}

/**
 * One entry. `selected` = the selection itself (solid); `onPath` = an ancestor of
 * it (pale, stays lit so the chain reads left to right). `actions` are revealed on
 * hover — same rule as every other row action on the item-metadata pages.
 * `highlight` is a drop-target cue. Extra props (drag handlers…) pass through.
 */
export function ColumnRow({
    icon, iconColor = '#c8a030', label, sub, selected, onPath, trailing, actions, chevron, highlight, dragging,
    onSelect, title, ...rest
}: {
    icon: string;
    iconColor?: string;
    label: React.ReactNode;
    sub?: React.ReactNode;
    selected?: boolean;
    onPath?: boolean;
    /** Always-visible badges (counts, lock, flags). */
    trailing?: React.ReactNode;
    /** Hover-revealed buttons (XPActionButton). */
    actions?: React.ReactNode;
    chevron?: boolean;
    highlight?: boolean;
    dragging?: boolean;
    onSelect?: () => void;
    title?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect' | 'title'>) {
    const [hover, setHover] = useState(false);
    const lit = selected || onPath;
    return (
        <div
            {...rest}
            role="option"
            aria-selected={!!lit}
            tabIndex={0}
            title={title}
            onClick={onSelect}
            onKeyDown={e => { if (onSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(); } }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px',
                cursor: onSelect ? 'pointer' : rest.draggable ? 'grab' : 'default',
                fontFamily: xpFont, fontSize: 11, userSelect: 'none',
                borderBottom: '1px solid #eceae2',
                background: highlight ? '#ffe9a8' : dragging ? '#fff7d6'
                    : selected ? rowStateBg('selected') : onPath ? '#e8eef8' : hover ? rowStateBg('expanded') : 'transparent',
                borderLeft: `3px solid ${selected ? '#316ac5' : onPath ? '#9db6dc' : 'transparent'}`,
                outline: highlight ? '1px dashed #b8860b' : undefined,
                fontWeight: lit ? 'bold' : 'normal',
            }}
        >
            <i className={`bi ${icon}`} style={{ color: iconColor }} />
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                {sub && <span style={{ display: 'block', fontSize: 10, color: '#777', fontWeight: 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
            </span>
            {actions && (
                <span style={{ display: 'flex', gap: 3, opacity: hover ? 1 : 0, transition: 'opacity 0.1s' }} onClick={e => e.stopPropagation()}>
                    {actions}
                </span>
            )}
            {trailing}
            {chevron && <i className="bi bi-chevron-right" style={{ fontSize: 9, color: lit ? '#316ac5' : '#bbb' }} />}
        </div>
    );
}

/** Small grey count at the end of a row. */
export function ColumnCount({ n, title }: { n: number; title?: string }) {
    if (!n) return null;
    return <span title={title} style={{ fontSize: 10, color: '#777', fontWeight: 'normal', minWidth: 14, textAlign: 'right' }}>{n}</span>;
}

export function ColumnEmpty({ children }: { children: React.ReactNode }) {
    return <div style={{ padding: '20px 10px', textAlign: 'center', color: '#888', fontStyle: 'italic', fontFamily: xpFont, fontSize: 11 }}>{children}</div>;
}

/** Bottom strip: where the selection sits (left) and what it holds (right). */
export function ColumnStatusBar({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
    return (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(to bottom,#e8e6df,#d5d3cc)', borderTop: '1px solid #b0a898', padding: '3px 8px', fontFamily: xpFont, fontSize: 11, color: '#333' }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{left}</span>
            {right && <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{right}</span>}
        </div>
    );
}
