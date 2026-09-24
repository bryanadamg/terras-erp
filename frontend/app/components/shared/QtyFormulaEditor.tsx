'use client';

/**
 * The production quantity formula editor, minus its chrome.
 *
 * Two places open it — the Settings panel (`settings/QtyFormulaPanel`) and the
 * gear beside Apply in the Production Run modal (`shared/QtyFormulaModal`) —
 * because the moment a planner wants a different formula is the moment they are
 * creating a run, not a week earlier in Settings. Both edit the same plant-wide
 * rule set, so the fields and the tester live here once and each caller only
 * decides where the Save button goes (an inline form row vs. a modal footer).
 *
 * `useQtyFormulaEditor` owns the state and the save; `QtyFormulaEditorFields`
 * renders it. Split rather than one component with a placement prop so the
 * modal can put Save in its footer, where a dialog's primary action belongs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from './Toast';
import { xpInput, FieldLabel } from './xpTheme';
import { API_BASE } from './apiBase';
import {
    DEFAULT_QTY_FORMULA,
    QTY_FORMULA_FALLBACK,
    QTY_FORMULA_SELF,
    QtyFormulaRule,
    evaluateExpression,
    validateExpression,
} from './qtyFormula';


// Ordered qtys the tester starts with: enough of a spread that a formula which
// silently ignores a size shows it immediately.
const SAMPLE = [10, 20, 30, 40, 0, 0, 0];

// XP data-table cells. Duplicated from settingsStyles rather than imported: a
// shared component reaching into a Settings-only stylesheet would make every
// caller of this editor depend on the Settings tab.
const TH: React.CSSProperties = {
    padding: '3px 6px',
    borderRight: '1px solid #b0aaa0',
    textAlign: 'left',
    whiteSpace: 'nowrap',
};
const TH_ROW: React.CSSProperties = {
    background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)',
    borderBottom: '2px solid #808080',
    fontSize: 10,
    fontWeight: 'bold',
    color: '#000',
};
const TD: React.CSSProperties = {
    padding: '4px 6px',
    borderRight: '1px solid #c0bdb5',
    borderBottom: '1px solid #d0cdc8',
    verticalAlign: 'top',
    fontSize: 11,
};

export type QtyFormulaEditor = ReturnType<typeof useQtyFormulaEditor>;

export function useQtyFormulaEditor(onSaved?: (rules: QtyFormulaRule[]) => void) {
    const { authFetch } = useData();
    const { showToast } = useToast();

    const [sizes, setSizes] = useState<string[]>([]);
    const [functions, setFunctions] = useState<string[]>([]);
    const [exprs, setExprs] = useState<Record<string, string>>({});
    const [defaults, setDefaults] = useState<QtyFormulaRule[]>(DEFAULT_QTY_FORMULA);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Tester inputs: the ordered qty per size, and the tolerance a planner would
    // type in the Production Run modal. Scratch pad — never saved.
    const [sample, setSample] = useState<Record<string, string>>({});
    const [tolerance, setTolerance] = useState('0');

    const load = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/settings/qty-formula`);
            if (!res.ok) throw new Error('load failed');
            const d = await res.json();
            const names: string[] = d.sizes || [];
            setSizes(names);
            setFunctions(d.functions || []);
            setDefaults(d.defaults?.length ? d.defaults : DEFAULT_QTY_FORMULA);
            const next: Record<string, string> = {};
            for (const r of (d.rules || [])) next[r.size_name] = r.expression;
            setExprs(next);
            setSample(prev => (Object.keys(prev).length ? prev : Object.fromEntries(
                names.map((n, i) => [n, String(SAMPLE[i] ?? 0)])
            )));
        } catch {
            showToast('Could not load the quantity formula', 'error');
        } finally {
            setLoading(false);
        }
    }, [authFetch, showToast]);

    useEffect(() => { load(); }, [load]);

    const rows = useMemo(() => [...sizes, QTY_FORMULA_FALLBACK], [sizes]);

    const errors = useMemo(() => {
        const out: Record<string, string> = {};
        for (const name of rows) {
            const expr = (exprs[name] || '').trim();
            if (!expr) continue;
            const err = validateExpression(expr, sizes);
            if (err) out[name] = err;
        }
        return out;
    }, [rows, exprs, sizes]);

    const hasErrors = Object.keys(errors).length > 0;

    // What the current draft would produce for the sample order. Mirrors the
    // modal's Apply: evaluate, scale by the tolerance, round up, blank zeroes.
    const preview = useMemo(() => {
        const factor = 1 + (parseFloat(tolerance) || 0) / 100;
        const ordered: Record<string, number> = {};
        for (const n of sizes) ordered[n.toUpperCase()] = parseFloat(sample[n] || '0') || 0;
        const fallback = (exprs[QTY_FORMULA_FALLBACK] || '').trim() || QTY_FORMULA_SELF;

        const out: Record<string, string> = {};
        for (const n of sizes) {
            const expr = (exprs[n] || '').trim() || fallback;
            try {
                const value = evaluateExpression(expr, {
                    ...ordered,
                    [QTY_FORMULA_SELF]: ordered[n.toUpperCase()] ?? 0,
                }) * factor;
                out[n] = value > 0 ? String(Math.ceil(value)) : '—';
            } catch {
                out[n] = '!';
            }
        }
        return out;
    }, [sizes, sample, exprs, tolerance]);

    const save = useCallback(async (): Promise<boolean> => {
        if (hasErrors) { showToast('Fix the highlighted expressions first', 'error'); return false; }
        setSaving(true);
        try {
            const rules = rows
                .map(name => ({ size_name: name, expression: (exprs[name] || '').trim() }))
                .filter(r => r.expression);
            const res = await authFetch(`${API_BASE}/settings/qty-formula`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rules }),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => null);
                throw new Error(d?.detail || 'Save failed');
            }
            const d = await res.json();
            const next: Record<string, string> = {};
            for (const r of (d.rules || [])) next[r.size_name] = r.expression;
            setExprs(next);
            showToast('Quantity formula saved', 'success');
            onSaved?.(d.rules || []);
            return true;
        } catch (e: any) {
            showToast(e?.message || 'Save failed', 'error');
            return false;
        } finally {
            setSaving(false);
        }
    }, [authFetch, exprs, hasErrors, onSaved, rows, showToast]);

    const reset = useCallback(() => {
        const next: Record<string, string> = {};
        for (const r of defaults) next[r.size_name] = r.expression;
        setExprs(next);
    }, [defaults]);

    return {
        sizes, functions, rows, exprs, setExprs, errors, hasErrors,
        sample, setSample, tolerance, setTolerance, preview,
        loading, saving, save, reset,
    };
}

export function QtyFormulaEditorFields({ editor, canEdit, hint }: {
    editor: QtyFormulaEditor;
    canEdit: boolean;
    /** Muted-text style from the caller, so a Settings panel and a dialog match their surroundings. */
    hint: React.CSSProperties;
}) {
    const {
        sizes, functions, rows, exprs, setExprs, errors,
        sample, setSample, tolerance, setTolerance, preview, loading,
    } = editor;

    const input = (
        value: string,
        onChange: (v: string) => void,
        extra: React.CSSProperties = {},
        invalid = false,
    ) => (
        <input
            value={value}
            disabled={!canEdit}
            onChange={e => onChange(e.target.value)}
            style={xpInput({ width: '100%', ...extra, ...(invalid ? { borderColor: '#c00', background: '#fff5f5' } : {}) })}
        />
    );

    if (loading) return <div style={{ ...hint, marginTop: 10 }}>Loading…</div>;

    return (
        <>
            <div style={hint}>
                Applied by the Apply button in a Production Run, turning the sizes a customer
                ordered into the sizes to make. Each result is then multiplied by the tolerance %
                the planner types and rounded up. A size name means the quantity ordered for that
                size; <code>{QTY_FORMULA_SELF}</code> means the quantity ordered for the row&apos;s own
                size, which is what the <code>{QTY_FORMULA_FALLBACK}</code> row uses. Leave a row
                blank to fall back to that row. Allowed: size names,{' '}
                <code>{QTY_FORMULA_SELF}</code>, numbers, <code>+ - * / ( )</code> and{' '}
                {functions.map(f => <code key={f} style={{ marginRight: 4 }}>{f}()</code>)}.
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
                <thead style={TH_ROW}>
                    <tr>
                        <th style={{ ...TH, width: 70 }}>Size</th>
                        <th style={TH}>Expression</th>
                        <th style={{ ...TH, width: 90 }}>Ordered</th>
                        <th style={{ ...TH, width: 80 }}>Makes</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(name => {
                        const isFallback = name === QTY_FORMULA_FALLBACK;
                        return (
                            <tr key={name}>
                                <td style={{ ...TD, fontWeight: 'bold' }}>
                                    {isFallback ? 'other' : name}
                                </td>
                                <td style={TD}>
                                    {input(
                                        exprs[name] || '',
                                        v => setExprs(prev => ({ ...prev, [name]: v })),
                                        { fontFamily: 'monospace' },
                                        !!errors[name],
                                    )}
                                    {errors[name] && (
                                        <div style={{ fontSize: 10, color: '#c00', marginTop: 2 }}>{errors[name]}</div>
                                    )}
                                    {isFallback && !errors[name] && (
                                        <div style={hint}>
                                            Used by any size with no row of its own, and by recipes with no
                                            size breakdown at all.
                                        </div>
                                    )}
                                </td>
                                <td style={TD}>
                                    {isFallback ? null : input(
                                        sample[name] ?? '',
                                        v => setSample(prev => ({ ...prev, [name]: v })),
                                        { textAlign: 'right' },
                                    )}
                                </td>
                                <td style={{ ...TD, textAlign: 'right', fontWeight: 'bold' }}>
                                    {isFallback ? null : preview[name]}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 10 }}>
                <div style={{ width: 120 }}>
                    <FieldLabel>Test tolerance %</FieldLabel>
                    <input
                        value={tolerance}
                        onChange={e => setTolerance(e.target.value)}
                        style={xpInput({ width: '100%', textAlign: 'right' })}
                    />
                </div>
                <div style={{ ...hint, flex: 1 }}>
                    The Ordered and Makes columns are a scratch pad — nothing here is saved with
                    the formula.
                </div>
            </div>

            {!canEdit && (
                <div style={{ ...hint, marginTop: 10 }}>
                    Only admins can change the production quantity formula.
                </div>
            )}
            {sizes.length === 0 && (
                <div style={{ ...hint, marginTop: 10 }}>No sizes are configured yet.</div>
            )}
        </>
    );
}
