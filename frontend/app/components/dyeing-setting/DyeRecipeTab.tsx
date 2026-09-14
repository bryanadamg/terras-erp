'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import DyeRecipePrintView from './DyeRecipePrintView';
import { useToast } from '../shared/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { usePaginatedFetch } from '../../context/usePaginatedList';
import { useUser } from '../../context/UserContext';
import CodeConfigModal, { CodeConfig } from '../shared/CodeConfigModal';
import ModalWrapper from '../shared/ModalWrapper';
import SearchableSelect from '../shared/SearchableSelect';
import Pager from '../shared/Pager';
import { StatusChip, FormSection, useFloatingMenu, MenuTriggerButton, FloatingMenu, ExpandedRowPanel, CodeChip, ColorSwatchChip, xpFont, TableSkeleton, useTableSkeletonMetrics, rowStateBg, CHIP_RADIUS, FORM_SECTION_BLUE, xpInput as xpInputBase, xpBtn as xpBtnBase } from '../shared/xpTheme';
import { lvTh, lvTd, lvSep, lvLabel, lvThead, lvSubTh, lvSubTd, lvSubRow, ExpanderCell, TableEmpty, lvRow, lvSubTable } from '../shared/listViewTheme';
import { ToolbarButton, SearchField, ToolbarCount } from '../shared/shellTheme';
import { API_BASE } from '../shared/apiBase';

const modernFont = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const xpInput: React.CSSProperties = xpInputBase({ padding: '1px 4px' });
const modernInput: React.CSSProperties = {
    fontFamily: modernFont, fontSize: 13, border: '1px solid #cbd3df',
    borderRadius: 7, background: '#fff', color: '#1e293b',
    padding: '4px 8px', outline: 'none', height: 'auto',
};
const xpBtn: React.CSSProperties = xpBtnBase({ fontSize: 10, padding: '2px 8px' });
const modernBtn: React.CSSProperties = {
    fontFamily: modernFont, fontSize: 12.5, fontWeight: 500, padding: '5px 12px',
    background: '#fff', color: '#334155', border: '1px solid #cbd3df',
    borderRadius: 7, cursor: 'pointer',
};
const xpSectionHeader: React.CSSProperties = {
    background: FORM_SECTION_BLUE,
    color: 'white', padding: '3px 8px',
    fontFamily: xpFont, fontSize: 11, fontWeight: 'bold',
};
const modernSectionHeader: React.CSSProperties = {
    background: '#eef1f6', color: '#475569',
    textTransform: 'uppercase', fontWeight: 700, fontSize: 11,
    letterSpacing: '0.04em', padding: '7px 12px',
    borderBottom: '1px solid #dbe1ea', fontFamily: modernFont,
};
const xpPanel: React.CSSProperties = {
    border: '1px solid #7f9db9', background: 'white',
};
const modernPanel: React.CSSProperties = {
    border: '1px solid #dbe1ea', background: '#fff', borderRadius: 9,
};

const inputStyle = (): React.CSSProperties => xpInput;
const btnStyle = (): React.CSSProperties => xpBtn;
const primaryBtnStyle = (): React.CSSProperties => xpBtn;

const LINE_TYPES = ['DYE', 'AUXILIARY', 'SALT', 'OTHER'];
const RECIPE_PAGE_SIZE = 25;

interface RecipeLine {
    id?: string;
    chemical_type: string;
    item_id: string;
    qty_per_100kg: number | string;
    qty_per_liter: number | null;
    uom_id?: string | null;
    sort_order: number | string;
}

interface RecipeForm {
    code: string;
    name: string;
    color_standard: string;
    color_id: string;
    substrate_type: string;
    /** Litres of water per kg of substrate (1:10 -> "10"). Kept as a string like
     *  every other numeric field on this form; '' means "not specified". */
    liquor_ratio: string;
    notes: string;
    is_active: boolean;
    lines: RecipeLine[];
}

const emptyForm = (): RecipeForm => ({
    code: '',
    name: '',
    color_standard: '',
    color_id: '',
    substrate_type: '',
    liquor_ratio: '',
    notes: '',
    is_active: true,
    lines: [],
});

interface Props {
    items: any[];
    attributes: any[];
    /** Typed rather than bare `Function` so usePaginatedFetch accepts it. */
    authFetch: (url: string, options?: any) => Promise<Response>;
    // Deep-link from Color Library "create recipe for this color" button: opens the
    // create panel pre-selected on this color. Cleared via onColorConsumed once opened.
    initialColorId?: string | null;
    onColorConsumed?: () => void;
}

export default function DyeRecipeTab({ items, attributes, authFetch, initialColorId, onColorConsumed }: Props) {
    const router = useRouter();
    const { hasPermission, hasAnyPermission } = useUser();
    const canManage = hasAnyPermission('dye_recipe.create', 'dye_recipe.edit', 'dye_recipe.delete');
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const { openId: menuOpenId, pos: menuPos, toggle: menuToggle, close: menuClose } = useFloatingMenu(160);

    // Server-paginated: the endpoint used to return every recipe as a bare list and
    // this view sliced it client-side, which stops scaling at a few hundred rows.
    // `search` is the hook's own debounced box, sent as `?search=` (code or name).
    const {
        rows: recipes, total, loading, page, setPage,
        searchInput: searchText, setSearch: setSearchText, refetch: loadRecipes,
    } = usePaginatedFetch<any>({
        endpoint: `${API_BASE}/dye-recipes`,
        authFetch,
        pageSize: RECIPE_PAGE_SIZE,
        onError: msg => showToast(`Failed to load recipes: ${msg}`, 'danger'),
    });

    const [selectedId, setSelectedId] = useState<string | null>(null);
    // The selected recipe's row is retained, not looked up in the current page: the
    // print modal reads it, and with a server window paging away from the row you
    // picked would blank it mid-session.
    const [selectedRow, setSelectedRow] = useState<any | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [editingRecipe, setEditingRecipe] = useState<any | null>(null);
    const [form, setForm] = useState<RecipeForm>(emptyForm());
    const [saving, setSaving] = useState(false);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const toggleExpand = (id: string) => setExpandedIds(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });
    // Bak Cuci / Finishing steps are picked from the system attributes "Wash Bath"
    // and "Finishing Step" (values curated on the Attributes page), not typed free.
    const [washBaths, setWashBaths] = useState<Array<{bath_number: number; attribute_value_id: string; description: string}>>([]);
    const [finishingSteps, setFinishingSteps] = useState<Array<{attribute_value_id: string; description: string; sort_order: number}>>([]);
    const [showPrint, setShowPrint] = useState(false);
    const [showCodeConfig, setShowCodeConfig] = useState(false);
    const [codeConfig, setCodeConfig] = useState<CodeConfig | null>(null);
    const [allChemicalItems, setAllChemicalItems] = useState<any[]>([]);
    const [colors, setColors] = useState<any[]>([]);

    // Skeleton sizing: measure one real row so the placeholders shown on the next
    // load are exactly as tall as the rows that replace them.
    const listBodyRef = useRef<HTMLTableSectionElement>(null);
    const skel = useTableSkeletonMetrics('dye-recipes', listBodyRef, recipes.length > 0);

    useEffect(() => {
        // Active colors for the recipe's shade picker (capped; future: server typeahead at 30k).
        authFetch(`${API_BASE}/colors?status=active&size=500`)
            .then((res: Response) => res.ok ? res.json() : null)
            .then((data: any) => { if (data) setColors(data.items ?? []); })
            .catch(() => {});
    }, [authFetch]);

    const colorOptions = React.useMemo(() =>
        [{ value: '', label: 'No library color' },
         ...colors.map((c: any) => ({ value: c.id, label: c.code ? `${c.code} — ${c.name}` : c.name }))],
    [colors]);

    // Bak Cuci / Finishing pickers read the two system attributes; values are
    // curated on the Attributes page (Item Metadata), never created from here.
    const stepValues = React.useCallback((role: string) => {
        const attr = (attributes || []).find((a: any) => a.system_role === role);
        return (attr?.values || []) as any[];
    }, [attributes]);
    const washBathOptions = React.useMemo(() =>
        [{ value: '', label: 'Select bath…' },
         ...stepValues('wash_bath').map((v: any) => ({ value: String(v.id), label: v.value }))],
    [stepValues]);
    const finishingOptions = React.useMemo(() =>
        [{ value: '', label: 'Select finishing step…' },
         ...stepValues('finishing_step').map((v: any) => ({ value: String(v.id), label: v.value }))],
    [stepValues]);
    const valueLabel = (options: Array<{value: string; label: string}>, id: string) =>
        options.find(o => o.value === id)?.label || '';


    useEffect(() => {
        authFetch(`${API_BASE}/preferences/code_config_DYE`)
            .then((res: Response) => res.ok ? res.json() : null)
            .then((data: any) => { if (data?.value) setCodeConfig(data.value); })
            .catch(() => {});
    }, [authFetch]);

    useEffect(() => {
        authFetch(`${API_BASE}/items?skip=0&limit=2000&search=`)
            .then((res: Response) => res.ok ? res.json() : null)
            .then((data: any) => {
                if (!data) return;
                const all: any[] = Array.isArray(data) ? data : (data.items || []);
                setAllChemicalItems(all.filter((it: any) =>
                    it.category_path && it.category_path.some((p: string) => p === 'Chemical' || p === 'Dye')
                ));
            })
            .catch(() => {});
    }, [authFetch]);

    // Recipe code base = configurable prefix + selected color's code (Configure edits
    // prefix/separator). Counter is a 5-digit suffix, incremented per base.
    const recipeCodeBase = useCallback((colorCode: string): string => {
        const sep = codeConfig?.separator || '—';
        const prefix = codeConfig?.prefix || 'DR';
        return [prefix, colorCode].filter(Boolean).join(sep);
    }, [codeConfig]);

    // Auto-generate code + derive name/standard from the selected Library Color
    // (new recipes only — a recipe is made FOR one color code).
    useEffect(() => {
        if (editingRecipe) return;
        const color = colors.find((c: any) => String(c.id) === String(form.color_id));
        if (!color) {
            setForm(f => (f.code || f.name ? { ...f, code: '', name: '', color_standard: '' } : f));
            return;
        }
        const sep = codeConfig?.separator || '—';
        const base = recipeCodeBase(color.code || '');
        let cancelled = false;
        (async () => {
            // The next counter has to be the max across EVERY recipe on this base, not
            // just the rows on screen — the list is server-paginated now, so scanning
            // the loaded page would hand out a duplicate code. `search=<base>` narrows
            // it to the codes that can possibly match, `size=0` takes all of them.
            let codes: string[] = [];
            try {
                const res = await authFetch(`${API_BASE}/dye-recipes?size=0&search=${encodeURIComponent(base)}`);
                if (res.ok) {
                    const data = await res.json();
                    codes = ((data.items || []) as any[]).map(r => String(r.code || ''));
                }
            } catch { /* fall through: counter restarts at 1, save then 400s on dup code */ }
            if (cancelled) return;
            const matchingCounters = codes
                .map(code => code.match(/^(.+)[-_ ](\d{5})$/))
                .filter(m => !!m && m[1] === base)
                .map(m => parseInt(m![2], 10) || 0);
            const counter = matchingCounters.length > 0 ? Math.max(...matchingCounters) + 1 : 1;
            setForm(f => ({
                ...f,
                code: [base, String(counter).padStart(5, '0')].join(sep),
                name: color.name || color.code || '',
                color_standard: color.pantone_ref || color.code || '',
            }));
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.color_id, codeConfig, editingRecipe, colors]);

    // Deep-link prefill: Color Library sends a color_id → open the create panel
    // pre-selected on it. Ensure the color is in the picker list (fetch the single
    // color if it's outside the capped active-colors page), then open + consume.
    useEffect(() => {
        if (!initialColorId) return;
        let cancelled = false;
        (async () => {
            if (!colors.some((c: any) => String(c.id) === String(initialColorId))) {
                try {
                    const res = await authFetch(`${API_BASE}/colors/${initialColorId}`);
                    if (res.ok) {
                        const c = await res.json();
                        if (!cancelled && c?.id) {
                            setColors(prev => prev.some(p => String(p.id) === String(c.id)) ? prev : [c, ...prev]);
                        }
                    }
                } catch { /* ignore — badge/code just won't derive */ }
            }
            if (cancelled) return;
            setEditingRecipe(null);
            setWashBaths([]);
            setFinishingSteps([]);
            setForm({ ...emptyForm(), color_id: String(initialColorId) });
            setSelectedId(null);
            setSelectedRow(null);
            setShowForm(true);
            onColorConsumed?.();
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialColorId]);

    // Prefer the retained row; fall back to the page for a selection made before it
    // was retained.
    const selectedRecipe = selectedRow
        ?? recipes.find((r: any) => String(r.id) === String(selectedId))
        ?? null;

    const openCreate = () => {
        setEditingRecipe(null);
        setForm(emptyForm());
        setWashBaths([]);
        setFinishingSteps([]);
        setShowForm(true);
        setSelectedId(null);
        setSelectedRow(null);
    };

    const openEdit = (recipe: any) => {
        setEditingRecipe(recipe);
        setForm({
            code: recipe.code || '',
            name: recipe.name || '',
            color_standard: recipe.color_standard || '',
            color_id: recipe.color_id || '',
            substrate_type: recipe.substrate_type || '',
            liquor_ratio: recipe.liquor_ratio != null ? String(recipe.liquor_ratio) : '',
            notes: recipe.notes || '',
            is_active: recipe.is_active !== false,
            lines: (recipe.lines || []).map((l: any) => ({
                id: l.id,
                chemical_type: l.chemical_type || 'OTHER',
                item_id: String(l.item_id || ''),
                qty_per_100kg: l.qty_per_100kg ?? '',
                qty_per_liter: l.qty_per_liter ?? null,
                uom_id: l.uom_id || null,
                sort_order: l.sort_order ?? '',
            })),
        });
        setWashBaths((recipe.wash_baths || []).map((wb: any) => ({
            bath_number: wb.bath_number,
            attribute_value_id: wb.attribute_value_id ? String(wb.attribute_value_id) : '',
            description: wb.description || '',
        })));
        setFinishingSteps((recipe.finishing_steps || []).map((fs: any) => ({
            attribute_value_id: fs.attribute_value_id ? String(fs.attribute_value_id) : '',
            description: fs.description || '',
            sort_order: fs.sort_order,
        })));
        setShowForm(true);
    };

    const handleCancel = () => {
        setShowForm(false);
        setEditingRecipe(null);
        setForm(emptyForm());
        setWashBaths([]);
        setFinishingSteps([]);
    };

    const handleSave = async () => {
        if (!form.color_id) {
            showToast('Select a Library Color to create a recipe for.', 'warning');
            return;
        }
        if (!form.code.trim() || !form.name.trim()) {
            showToast('Code could not be generated — pick a color with a code.', 'warning');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                ...form,
                color_id: form.color_id || null,
                // Blank stays null: "no standard ratio", which makes WO creation ask
                // the planner for a bath volume instead of proposing one.
                liquor_ratio: String(form.liquor_ratio ?? '').trim() === ''
                    ? null : (parseFloat(String(form.liquor_ratio)) || null),
                lines: form.lines.map((l, idx) => ({
                    ...l,
                    // Blank stays null, not 0 — null is what marks "this line is rated in g/L instead".
                    qty_per_100kg: String(l.qty_per_100kg ?? '').trim() === '' ? null : (parseFloat(String(l.qty_per_100kg)) || 0),
                    qty_per_liter: l.qty_per_liter,
                    sort_order: parseInt(String(l.sort_order)) || idx + 1,
                })),
                // Unpicked rows are dropped — a bath/finishing step is its attribute value.
                wash_baths: washBaths
                    .filter(wb => !!wb.attribute_value_id)
                    .map(wb => ({ bath_number: wb.bath_number, attribute_value_id: wb.attribute_value_id, description: wb.description })),
                finishing_steps: finishingSteps
                    .filter(fs => !!fs.attribute_value_id)
                    .map((fs, idx) => ({ attribute_value_id: fs.attribute_value_id, description: fs.description, sort_order: fs.sort_order ?? idx })),
            };
            let res;
            if (editingRecipe) {
                res = await authFetch(`${API_BASE}/dye-recipes/${editingRecipe.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            } else {
                res = await authFetch(`${API_BASE}/dye-recipes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            }
            if (res.ok) {
                const saved = await res.json();
                loadRecipes();
                setShowForm(false);
                setEditingRecipe(null);
                setForm(emptyForm());
                setWashBaths([]);
                setFinishingSteps([]);
                setSelectedId(String(saved.id || (editingRecipe ? editingRecipe.id : '')));
                setSelectedRow(saved?.id ? saved : null);
                showToast(editingRecipe ? 'Recipe updated.' : 'Recipe created.', 'success');
            } else {
                const err = await res.json().catch(() => ({}));
                showToast('Save failed: ' + (err.detail || res.statusText), 'danger');
            }
        } catch (e: any) {
            showToast('Save error: ' + e.message, 'danger');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (recipe: any) => {
        const confirmed = await confirm({
            title: 'Delete Recipe',
            message: `Delete recipe "${recipe.code} - ${recipe.name}"? This cannot be undone.`,
            confirmText: 'Delete',
            variant: 'danger',
        });
        if (!confirmed) return;
        try {
            const res = await authFetch(`${API_BASE}/dye-recipes/${recipe.id}`, { method: 'DELETE' });
            if (res.ok) {
                loadRecipes();
                setSelectedId(null);
                setSelectedRow(null);
                setShowForm(false);
                showToast('Recipe deleted.', 'success');
            } else {
                const err = await res.json().catch(() => ({}));
                showToast('Delete failed: ' + (err.detail || res.statusText), 'danger');
            }
        } catch (e: any) {
            showToast('Delete error: ' + e.message, 'danger');
        }
    };

    const addLine = () => {
        setForm(f => ({
            ...f,
            lines: [
                ...f.lines,
                {
                    chemical_type: 'DYE',
                    item_id: '',
                    qty_per_100kg: '',
                    qty_per_liter: null,
                    uom_id: null,
                    sort_order: f.lines.length + 1,
                },
            ],
        }));
    };

    const removeLine = (idx: number) => {
        setForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
    };

    const updateLine = (idx: number, field: keyof RecipeLine, value: any) => {
        setForm(f => ({
            ...f,
            lines: f.lines.map((l, i) => i === idx ? { ...l, [field]: value } : l),
        }));
    };

    // Table header cells build on the shared listViewTheme `lvTh` so nested recipe
    // tables match the library tables; classic adds the XP thead gradient/underline
    // that lvTh leaves to the parent thead.
    const thStyle = (extra?: React.CSSProperties): React.CSSProperties => ({ ...lvTh(), ...lvThead(), ...extra });

    // Expandable-row detail: full recipe breakdown (chemical lines, wash baths,
    // finishing, attribute matches) shown inline under the table row.
    const renderDetail = (recipe: any) => {
        // Dense inline panel — matches WorkOrderListView's expanded-row skin
        // (flat single-tone columns, tiny uppercase headers, no card chrome).
        // Dense sub-table: it occupies one column of the three-pane grid below.
        const subTh = lvSubTh();
        const subTd = lvSubTd();
        const panelStyle: React.CSSProperties = {
            display: 'grid', gridTemplateColumns: '260px minmax(180px, 1fr) 260px',
            border: '1px solid #7f9db9',
            fontFamily: xpFont, fontSize: 10,
        };
        const colHeaderStyle: React.CSSProperties = {
            fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', color: '#555',
            letterSpacing: 0.5, borderBottom: '1px solid #c0bdb5', paddingBottom: 2, marginBottom: 4, width: '100%',
        };
        const infoRow = (label: string, val: React.ReactNode) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1, fontSize: 9, gap: 6 }}>
                <span style={{ color: '#888', flexShrink: 0 }}>{label}</span>
                <span style={{ fontWeight: 'bold', color: '#222', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
            </div>
        );
        const emptyStyle: React.CSSProperties = { color: '#aaa', fontStyle: 'italic', fontSize: 9 };
        return (
            <div style={panelStyle}>

                {/* Recipe Info */}
                <div style={{ borderRight: '1px solid #c0bdb5', padding: '6px 8px', background: '#f5f4ef' }}>
                    <div style={colHeaderStyle}>Recipe Info</div>
                    {infoRow('Color Standard', recipe.color_standard || '—')}
                    {infoRow('Substrate Type', recipe.substrate_type || '—')}
                    {infoRow('Liquor Ratio', recipe.liquor_ratio != null ? `1 : ${Number(recipe.liquor_ratio).toFixed(2)}` : '—')}
                    {recipe.notes && (
                        <div style={{ marginTop: 4, padding: '2px 5px', background: '#fffbe6', border: '1px solid #e0d080', fontSize: 9, fontStyle: 'italic', color: '#666' }}>
                            {recipe.notes}
                        </div>
                    )}
                    {recipe.attribute_value_ids?.length > 0 && (
                        <div style={{ marginTop: 5 }}>
                            <div style={{ color: '#888', fontSize: 9, marginBottom: 2 }}>Attribute Match</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 4px' }}>
                                {recipe.attribute_value_ids.map((vid: string) => {
                                    let label = vid;
                                    for (const attr of attributes) {
                                        const v = (attr.values || []).find((av: any) => String(av.id) === String(vid));
                                        if (v) { label = `${attr.name}: ${v.value}`; break; }
                                    }
                                    return (
                                        <span key={vid} style={{ borderRadius: CHIP_RADIUS,
                                            background: '#e8f0fe', color: '#1a56c4', border: '1px solid #b0c8f8',
                                            padding: '0 4px', fontSize: 9,
                                        }}>{label}</span>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Chemical Lines */}
                <div style={{ borderRight: '1px solid #c0bdb5', padding: '6px 8px', background: '#f5f4ef', overflow: 'hidden' }}>
                    <div style={colHeaderStyle}>Chemical Lines ({(recipe.lines || []).length})</div>
                    {(!recipe.lines || recipe.lines.length === 0) ? (
                        <div style={emptyStyle}>No chemical lines defined.</div>
                    ) : (
                        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                            <table style={{ ...lvSubTable(), border: 'none' }}>
                                <thead>
                                    <tr>
                                        <th style={{ ...subTh, width: 20 }}>#</th>
                                        <th style={{ ...subTh, width: 60 }}>Type</th>
                                        <th style={subTh}>Item</th>
                                        <th style={{ ...subTh, textAlign: 'right', width: 60 }}>Qty</th>
                                        <th style={{ ...subTh, width: 55 }}>Unit</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(recipe.lines || []).map((line: any, idx: number) => {
                                        const linkedItem = items.find(it => String(it.id) === String(line.item_id));
                                        // g/L and /100kg are alternate rate bases — show whichever the line carries
                                        // (mirrors the fallback in DyeRecipePrintView).
                                        const rate = line.qty_per_liter ?? line.qty_per_100kg ?? null;
                                        const rateUnit = line.uom_name || (line.qty_per_liter != null ? 'g/L' : line.qty_per_100kg != null ? '/100kg' : '—');
                                        return (
                                            <tr key={idx} style={lvSubRow(idx)}>
                                                <td style={{ ...subTd, color: '#666' }}>{idx + 1}</td>
                                                <td style={subTd}>
                                                    <span style={{ borderRadius: CHIP_RADIUS,
                                                        background: typeColor(line.chemical_type).bg,
                                                        color: typeColor(line.chemical_type).fg,
                                                        padding: '0 4px', fontWeight: 'bold', fontSize: 8,
                                                        border: `1px solid ${typeColor(line.chemical_type).border}`,
                                                    }}>
                                                        {line.chemical_type || '—'}
                                                    </span>
                                                </td>
                                                <td style={{ ...subTd, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }} title={line.item_name || linkedItem?.name}>
                                                    {line.item_name || linkedItem?.name || (line.item_id || '—')}
                                                </td>
                                                <td style={{ ...subTd, textAlign: 'right', fontWeight: 'bold', color: '#000080' }}>
                                                    {rate != null ? Number(rate).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
                                                </td>
                                                <td style={{ ...subTd, color: '#555' }}>{rateUnit}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Wash Baths + Finishing */}
                <div style={{ padding: '6px 8px', background: '#f5f4ef' }}>
                    <div style={colHeaderStyle}>Bak Cuci</div>
                    {(!recipe.wash_baths || recipe.wash_baths.length === 0)
                        ? <div style={emptyStyle}>None.</div>
                        : (recipe.wash_baths || []).map((wb: any, i: number) => (
                            <div key={i} style={{ fontSize: 9, color: '#222', padding: '1px 0' }}>
                                <b>{wb.bath_number}.</b> {wb.description || '—'}
                            </div>
                        ))}
                    <div style={{ borderTop: '1px solid #e0ddd8', margin: '5px 0 3px' }} />
                    <div style={colHeaderStyle}>Finishing</div>
                    {(!recipe.finishing_steps || recipe.finishing_steps.length === 0)
                        ? <div style={emptyStyle}>None.</div>
                        : (recipe.finishing_steps || []).map((fs: any, i: number) => (
                            <div key={i} style={{ fontSize: 9, color: '#222', padding: '1px 0' }}>
                                {i + 1}. {fs.description || '—'}
                            </div>
                        ))}
                </div>

            </div>
        );
    };

    return (
        <>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...xpPanel, border: 'none' }}>
            {/* Toolbar */}
            <div style={{ background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
                <SearchField classic value={searchText} onChange={setSearchText} placeholder="Search code or name…" width={240} />
                <ToolbarCount right>
                    {total.toLocaleString()} recipe{total !== 1 ? 's' : ''}
                </ToolbarCount>
                {canManage && (
                    <>
                        <span style={lvSep()} />
                        <ToolbarButton tone="create" icon="bi-plus-lg" onClick={openCreate}>New Recipe</ToolbarButton>
                    </>
                )}
            </div>

            {/* Table */}
            <div style={{ flex: 1, minHeight: 0, background: '#fff', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                    <thead style={lvThead()}>
                        <tr>
                            <th style={{ ...lvTh(), width: 30 }}></th>
                            <th style={{ ...lvTh(), width: 150 }}>Code</th>
                            <th style={{ ...lvTh(), width: 130 }}>Color Code</th>
                            <th style={{ ...lvTh(), width: 150 }}>Color Variant</th>
                            <th style={lvTh()}>Name</th>
                            <th style={{ ...lvTh(), width: 150 }}>Color Standard</th>
                            <th style={{ ...lvTh(), width: 110 }}>Substrate</th>
                            <th style={{ ...lvTh(), width: 55, textAlign: 'center' }}>Lines</th>
                            <th style={{ ...lvTh(), width: 80 }}>Status</th>
                            <th style={{ ...lvTh(), width: 44, textAlign: 'right', borderRight: 'none' }}></th>
                        </tr>
                    </thead>
                    <tbody ref={listBodyRef}>
                        {recipes.length === 0 && (loading ? (
                            <TableSkeleton rows={8} cols={skel.cols ?? 10} tdStyle={lvTd()} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                        ) : (
                            <TableEmpty colSpan={10} tdStyle={lvTd()} message="No recipes found." />
                        ))}
                        {recipes.map((recipe: any, idx: number) => {
                            const rid = String(recipe.id);
                            const expanded = expandedIds.has(rid);
                            const lineCount = (recipe.lines || []).length;
                            return (
                                <React.Fragment key={rid}>
                                    <tr style={{ ...lvRow(idx), ...(expanded ? { background: rowStateBg('expanded') } : {}), cursor: 'pointer' }} onClick={() => toggleExpand(rid)}>
                                        <ExpanderCell expanded={expanded} onToggle={() => toggleExpand(rid)} label="recipe detail" />
                                        <td style={lvTd()}>
                                            <CodeChip code={recipe.code} tone="accent" />
                                        </td>
                                        <td style={lvTd()}>
                                            {recipe.color_code ? (
                                                <span
                                                    onClick={e => { e.stopPropagation(); router.push(`/colors?search=${encodeURIComponent(recipe.color_code)}`); }}
                                                    title={`Open ${recipe.color_code} in the Color Library`}
                                                    style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
                                                >
                                                    <ColorSwatchChip label={recipe.color_code} hex={recipe.color_hex} title={`Open ${recipe.color_code} in the Color Library`} />
                                                </span>
                                            ) : <span style={{ color: '#aaa' }}>—</span>}
                                        </td>
                                        <td style={lvTd()}>
                                            {recipe.color_variant_label ? (
                                                <ColorSwatchChip label={recipe.color_variant_label} hex={recipe.color_variant_hex} />
                                            ) : <span style={{ color: '#aaa' }}>—</span>}
                                        </td>
                                        <td style={lvTd()}>{recipe.name}</td>
                                        <td style={lvTd()}>{recipe.color_standard || <span style={{ color: '#aaa' }}>—</span>}</td>
                                        <td style={lvTd()}>{recipe.substrate_type || <span style={{ color: '#aaa' }}>—</span>}</td>
                                        <td style={{ ...lvTd(), textAlign: 'center' }}>{lineCount}</td>
                                        <td style={lvTd()}>
                                            <StatusChip status={recipe.is_active !== false ? 'active' : 'inactive'} />
                                        </td>
                                        <td style={{ ...lvTd(), borderRight: 'none', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                            <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end', alignItems: 'center' }}>
                                                <MenuTriggerButton onClick={e => menuToggle(rid, e)} />
                                            </div>
                                        </td>
                                    </tr>
                                    {expanded && (
                                        <tr>
                                            <td colSpan={10} style={{ padding: 0 }}>
                                                <ExpandedRowPanel>
                                                    {renderDetail(recipe)}
                                                </ExpandedRowPanel>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <Pager page={page} total={total} pageSize={RECIPE_PAGE_SIZE} onPageChange={setPage} hideWhenEmpty />

            {/* ── Row ⋯ menu: Edit / Print / Delete ── */}
            {menuOpenId && (() => {
                const recipe = recipes.find((r: any) => String(r.id) === menuOpenId);
                if (!recipe) return null;
                return (
                    <FloatingMenu
                        pos={menuPos}
                        items={[
                            { key: 'edit', label: 'Edit', icon: 'bi-pencil', hidden: !canManage, onClick: () => { menuClose(); openEdit(recipe); } },
                            { key: 'print', label: 'Print Recipe Card', icon: 'bi-printer', onClick: () => { menuClose(); setSelectedId(String(recipe.id)); setSelectedRow(recipe); setShowPrint(true); } },
                            { key: 'delete', label: 'Delete', icon: 'bi-trash', danger: true, hidden: !canManage, onClick: () => { menuClose(); handleDelete(recipe); } },
                        ]}
                    />
                );
            })()}

                <ModalWrapper
                    isOpen={showForm}
                    onClose={handleCancel}
                    modeless
                    size="xl"
                    title={editingRecipe ? 'Edit Recipe' : 'New Recipe'}
                    footer={
                        <>
                            <button style={{ ...xpBtn, padding: '3px 10px' }} onClick={handleCancel} disabled={saving}>
                                Cancel
                            </button>
                            <button
                                style={{
                                    ...xpBtn,
                                    background: saving ? '#b0b8d0' : 'linear-gradient(to bottom, #4a7fd0, #2a5ab0)',
                                    color: 'white',
                                    borderColor: '#1a3d90 #0a1e60 #0a1e60 #1a3d90',
                                    fontWeight: 'bold',
                                    padding: '3px 14px',
                                }}
                                onClick={handleSave}
                                disabled={saving}
                            >
                                {saving ? 'Saving...' : 'Save'}
                            </button>
                        </>
                    }
                >
                    {/* ── Recipe Info ── */}
                    {/* A recipe is made FOR one Library Color. The color drives the recipe
                        code + name + color standard, so those are read-only here — the
                        panel only asks for the color plus recipe-specific fields. */}
                    <FormSection title="Recipe Info">
                        <div style={{ marginBottom: 8 }}>
                            <label style={lvLabel()}>
                                Library Color <span style={{ color: 'red'}}>*</span>
                            </label>
                            <SearchableSelect
                                options={colorOptions}
                                value={form.color_id}
                                onChange={(v: string) => setForm(f => ({ ...f, color_id: v }))}
                                placeholder="Select color code to make recipe for…"
                            />
                            <div style={{ fontSize: 10, color: '#666', marginTop: 3 }}>
                                Recipe code, name and color standard are taken from the selected color.
                            </div>
                        </div>
                        {form.color_id && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginBottom: 8 }}>
                                <div>
                                    <label style={lvLabel()}>Recipe Code</label>
                                    <div style={{ display: 'flex', gap: 4 }}>
                                        <input
                                            readOnly
                                            style={{ ...inputStyle(), flex: 1, background: '#ece9d8', color: '#333'}}
                                            value={form.code}
                                            placeholder="(auto)"
                                        />
                                        <button
                                            type="button"
                                            style={{ ...xpBtn, fontSize: 10, padding: '1px 6px', flexShrink: 0, whiteSpace: 'nowrap' }}
                                            onClick={() => setShowCodeConfig(true)}
                                            title="Configure code format"
                                        >Configure</button>
                                    </div>
                                </div>
                                <div>
                                    <label style={lvLabel()}>Color Standard</label>
                                    <input
                                        readOnly
                                        style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box', background: '#ece9d8', color: '#333'}}
                                        value={form.color_standard || '—'}
                                    />
                                </div>
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '6px 12px' }}>
                            <div>
                                <label style={lvLabel()}>Substrate Type</label>
                                <input
                                    style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
                                    value={form.substrate_type}
                                    onChange={e => setForm(f => ({ ...f, substrate_type: e.target.value }))}
                                    placeholder="e.g. Cotton, Polyester"
                                />
                            </div>
                            {/* The recipe's standard bath, as litres of water per kg of
                                substrate. Cutting a dyeing WO multiplies it by the load to
                                propose the bath, which is what lets the Kartu Kerja print
                                weighed grams for the g/L lines instead of bare rates. */}
                            <div>
                                <label style={lvLabel()}>Liquor Ratio (1 : x)</label>
                                <input
                                    type="number" min="0" step="any"
                                    style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
                                    value={form.liquor_ratio}
                                    onChange={e => setForm(f => ({ ...f, liquor_ratio: e.target.value }))}
                                    placeholder="e.g. 10 = 10 L per kg"
                                    title="Litres of water per kg of substrate. Work order creation uses this to propose the bath volume."
                                />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#333', fontSize: undefined}}>
                                    <input
                                        type="checkbox"
                                        checked={form.is_active}
                                        onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                                        style={{ margin: 0 }}
                                    />
                                    Active
                                </label>
                            </div>
                        </div>
                        <div style={{ marginTop: 8 }}>
                            <label style={lvLabel()}>Notes</label>
                            <textarea
                                style={{
                                    ...inputStyle(), height: 'auto', width: '100%',
                                    boxSizing: 'border-box', resize: 'vertical', minHeight: 48, padding: '2px 4px',
                                }}
                                value={form.notes}
                                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                rows={3}
                                placeholder="Optional notes"
                            />
                        </div>
                    </FormSection>

                    {/* ── Chemical Lines ── */}
                    <FormSection title="Chemical Lines">
                        <div style={{ border: '1px solid #7f9db9' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10}}>
                                <thead>
                                    <tr style={{ background: '#eef2f8' }}>
                                        <th style={thStyle({ width: 24 })}>#</th>
                                        <th style={thStyle({ width: 80 })}>Type</th>
                                        <th style={thStyle()}>Item</th>
                                        <th
                                            style={thStyle({ width: 80 })}
                                            title="Weight-on-fabric basis: the dose follows the substrate weight, not the bath. Use it for dyestuff. Fill this OR g/L, never both."
                                        >Qty/100kg</th>
                                        <th
                                            style={thStyle({ width: 80, fontSize: 11})}
                                            title="Bath concentration: the dose is this rate times the run's bath volume (Volume Air). Use it for salt, soda ash, alkali, auxiliaries. Fill this OR Qty/100kg, never both."
                                        >g/L</th>
                                        <th style={thStyle({ width: 50 })}>Sort</th>
                                        <th style={thStyle({ textAlign: 'center', width: 28 })}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.lines.length === 0 && (
                                        <tr>
                                            <td colSpan={7} style={{ padding: '6px', color: '#888', textAlign: 'center' }}>
                                                No lines. Click "Add Line" to begin.
                                            </td>
                                        </tr>
                                    )}
                                    {form.lines.map((line, idx) => (
                                        <tr key={idx} style={{ background: idx % 2 === 0 ? 'white' : '#f7f9fc'}}>
                                            <td style={{ padding: '2px 4px', color: '#666', borderBottom: undefined}}>{idx + 1}</td>
                                            <td style={{ padding: '2px 4px', borderBottom: undefined}}>
                                                <select
                                                    style={{ ...inputStyle(), height: 20, width: '100%' }}
                                                    value={line.chemical_type}
                                                    onChange={e => updateLine(idx, 'chemical_type', e.target.value)}
                                                >
                                                    {LINE_TYPES.map(t => (
                                                        <option key={t} value={t}>{t}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td style={{ padding: '2px 4px', borderBottom: undefined}}>
                                                <SearchableSelect
                                                    options={allChemicalItems.map((item: any) => ({
                                                        value: String(item.id),
                                                        label: item.name,
                                                        subLabel: item.code,
                                                    }))}
                                                    value={line.item_id}
                                                    onChange={val => updateLine(idx, 'item_id', val)}
                                                    placeholder="-- select item --"
                                                    size="sm"
                                                />
                                            </td>
                                            <td style={{ padding: '2px 4px', borderBottom: undefined}}>
                                                <input
                                                    type="number"
                                                    style={{ ...inputStyle(), width: '100%' }}
                                                    value={line.qty_per_100kg}
                                                    onChange={e => updateLine(idx, 'qty_per_100kg', e.target.value)}
                                                    placeholder="0"
                                                    min={0}
                                                    step="any"
                                                />
                                            </td>
                                            <td style={{ padding: '2px 4px', borderBottom: undefined}}>
                                                <input
                                                    type="number"
                                                    style={{ ...inputStyle(), width: '100%' }}
                                                    value={line.qty_per_liter ?? ''}
                                                    onChange={e => updateLine(idx, 'qty_per_liter', e.target.value ? parseFloat(e.target.value) : null)}
                                                    placeholder="0"
                                                    min={0}
                                                    step="any"
                                                />
                                            </td>
                                            <td style={{ padding: '2px 4px', borderBottom: undefined}}>
                                                <input
                                                    type="number"
                                                    style={{ ...inputStyle(), width: '100%' }}
                                                    value={line.sort_order}
                                                    onChange={e => updateLine(idx, 'sort_order', e.target.value)}
                                                    placeholder={String(idx + 1)}
                                                    min={1}
                                                />
                                            </td>
                                            <td style={{ padding: '2px 4px', textAlign: 'center', borderBottom: undefined}}>
                                                <button
                                                    style={{ ...xpBtn, padding: '0px 5px', fontSize: 10, color: '#aa0000' }}
                                                    onClick={() => removeLine(idx)}
                                                    title="Remove line"
                                                >X</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div style={{ padding: '4px 6px', borderTop: '1px solid #e8eef5', background: '#f7f9fc'}}>
                                <button style={btnStyle()} onClick={addLine}>Add Line</button>
                            </div>
                        </div>
                    </FormSection>

                    {/* ── Bak Cuci ── */}
                    <FormSection title="Bak Cuci">
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10}}>
                            <thead>
                                <tr style={{ background: '#eef2f8' }}>
                                    <th style={thStyle({ width: 50 })}>No.</th>
                                    <th style={thStyle()}>Description</th>
                                    <th style={thStyle({ width: 36 })}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {washBaths.map((wb, i) => (
                                    <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f7f9fc'}}>
                                        <td style={{ padding: '2px 4px', borderBottom: undefined}}>
                                            <input type="number" style={{ ...inputStyle(), width: '100%' }}
                                                value={wb.bath_number}
                                                onChange={e => { const u = [...washBaths]; u[i] = { ...u[i], bath_number: parseInt(e.target.value) || i + 1 }; setWashBaths(u); }} />
                                        </td>
                                        <td style={{ padding: '2px 4px', borderBottom: undefined}}>
                                            <SearchableSelect
                                                options={washBathOptions}
                                                value={wb.attribute_value_id}
                                                onChange={(v: string) => {
                                                    const u = [...washBaths];
                                                    u[i] = { ...u[i], attribute_value_id: v, description: valueLabel(washBathOptions, v) };
                                                    setWashBaths(u);
                                                }}
                                                placeholder="Select bath…"
                                                size="sm"
                                            />
                                        </td>
                                        <td style={{ padding: '2px 4px', textAlign: 'center', borderBottom: undefined}}>
                                            <button style={{ ...xpBtn, padding: '0px 5px', fontSize: 10, color: '#aa0000' }}
                                                onClick={() => setWashBaths(washBaths.filter((_, j) => j !== i))}>×</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <button style={{ ...xpBtn, marginTop: 4, fontSize: 10 }}
                            onClick={() => setWashBaths([...washBaths, { bath_number: washBaths.length + 1, attribute_value_id: '', description: '' }])}>+ Add Bath</button>
                        {washBathOptions.length <= 1 && (
                            <div style={{ marginTop: 4, fontSize: 10, color: '#666'}}>
                                No bath values defined yet — add them to the &quot;Wash Bath&quot; attribute under Inventory &gt; Item Metadata.
                            </div>
                        )}
                    </FormSection>

                    {/* ── Finishing ── */}
                    <FormSection title="Finishing">
                        {finishingSteps.map((fs, i) => (
                            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                                <div style={{ flex: 1 }}>
                                    <SearchableSelect
                                        options={finishingOptions}
                                        value={fs.attribute_value_id}
                                        onChange={(v: string) => {
                                            const u = [...finishingSteps];
                                            u[i] = { ...u[i], attribute_value_id: v, description: valueLabel(finishingOptions, v) };
                                            setFinishingSteps(u);
                                        }}
                                        placeholder="Select finishing step…"
                                        size="sm"
                                    />
                                </div>
                                <button style={{ ...xpBtn, padding: '0px 5px', fontSize: 10, color: '#aa0000', flexShrink: 0 }}
                                    onClick={() => setFinishingSteps(finishingSteps.filter((_, j) => j !== i))}>×</button>
                            </div>
                        ))}
                        <button style={{ ...xpBtn, fontSize: 10 }}
                            onClick={() => setFinishingSteps([...finishingSteps, { attribute_value_id: '', description: '', sort_order: finishingSteps.length }])}>+ Add Finishing Step</button>
                        {finishingOptions.length <= 1 && (
                            <div style={{ marginTop: 4, fontSize: 10, color: '#666'}}>
                                No finishing values defined yet — add them to the &quot;Finishing Step&quot; attribute under Inventory &gt; Item Metadata.
                            </div>
                        )}
                    </FormSection>

                </ModalWrapper>

        </div>

        {showPrint && selectedRecipe && (
            <DyeRecipePrintView
                recipe={selectedRecipe}
                onClose={() => setShowPrint(false)}
            />
        )}

        {showCodeConfig && (
            <CodeConfigModal
                isOpen={showCodeConfig}
                onClose={() => setShowCodeConfig(false)}
                type="DYE"
                attributes={attributes}
                initialConfig={codeConfig || undefined}
                onSave={cfg => {
                    setCodeConfig(cfg);
                    authFetch(`${API_BASE}/preferences/code_config_DYE`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ value: cfg }),
                    }).catch(() => {});
                    setShowCodeConfig(false);
                }}
            />
        )}
        </>
    );
}

function DetailField({ label, value }: { label: string; value?: string | null }) {
    return (
        <div>
            <div style={{ fontSize: 10, color: '#555', marginBottom: 1}}>{label}</div>
            <div style={{
                fontFamily: xpFont, fontSize: 11,
                color: value ? '#1a1a1a' : '#aaa',
                background: '#f7f9fc', border: '1px solid #c8d8e8',
                padding: '1px 5px', minHeight: 18,
            }}>
                {value || '—'}
            </div>
        </div>
    );
}

function typeColor(type: string): { bg: string; fg: string; border: string } {
    switch ((type || '').toUpperCase()) {
        case 'DYE':       return { bg: '#d0e4ff', fg: '#1a3d90', border: '#7fa8e8' };
        case 'AUXILIARY': return { bg: '#d8f0d8', fg: '#1a5a1a', border: '#7fbb7f' };
        case 'SALT':      return { bg: '#fff0c0', fg: '#7a5000', border: '#d4a800' };
        default:          return { bg: '#ececec', fg: '#444', border: '#b0b0b0' };
    }
}
