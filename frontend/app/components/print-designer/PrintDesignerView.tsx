'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useData } from '../../context/DataContext';
import { useTheme } from '../../context/ThemeContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useToast } from '../shared/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { ShellWindow, ShellTitleBar, xpToolbar, ToolbarButton } from '../shared/shellTheme';
import { PanelSkeleton, XPActionButton, Chip, familyTint, xpFont } from '../shared/xpTheme';

import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import { buildPrintContext } from '../shared/printTemplate/renderContext';
import { fetchDyeingPrintData, isDyeingWorkOrder, type DyeingPrintData } from '../shared/printTemplate/dyeingPrintData';
import type { PrintLayout, Band } from '../shared/printTemplate/types';
import { DOC_TYPE_LABELS, EDITABLE_DOC_TYPES, defaultLayout, resolveLayout, isCustomised } from '../shared/printTemplate/templateStore';
import { docTypeForWorkCenter } from '../shared/printTemplate/defaults/kartuKerja';
import { paperDimsMm, paperSizeLabel } from '../shared/printTemplate/paper';
import { describeBand, bandTypeLabel } from '../shared/printTemplate/bandLabel';
import InspectorPanel, { type Selection } from './InspectorPanel';
import DesignerCanvas from './DesignerCanvas';
import DesignerTestPrint from './DesignerTestPrint';
import { SelectField } from './controls';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api')
    .replace(/\/api$/, '') + '/api';

const clone = (l: PrintLayout): PrintLayout => JSON.parse(JSON.stringify(l));

/** CSS pixels per millimetre at 96dpi — the sheet is quoted in mm, Fit works in px. */
const MM_PX = 96 / 25.4;

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const ZOOM_MIN = ZOOM_STEPS[0];
const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** Selection <-> the "bandId:itemIndex:stackIndex" id strings TemplateRenderer's
 *  click-to-select emits (DesignerCanvas's drag handles pass Selection objects
 *  directly and never go through this). */
function parseSelectId(id: string): Selection {
    const [bandId, itemIndex, stackIndex] = id.split(':');
    if (stackIndex != null) return { bandId, itemIndex: Number(itemIndex), stackIndex: Number(stackIndex) };
    if (itemIndex != null) return { bandId, itemIndex: Number(itemIndex) };
    return { bandId };
}
function selectionToId(sel: Selection): string | null {
    if (sel.itemIndex == null) return sel.bandId;
    if (sel.stackIndex == null) return `${sel.bandId}:${sel.itemIndex}`;
    return `${sel.bandId}:${sel.itemIndex}:${sel.stackIndex}`;
}

/**
 * Print layout designer.
 *
 * Three panes: band list (left), true-size paper preview (centre), property
 * inspector (right). The preview is the same `TemplateRenderer` the printout uses,
 * fed a real work order — so what is on screen is what comes out of the printer,
 * rather than a separate mock that can drift.
 */
export default function PrintDesignerView() {
    const { printTemplates, refreshPrintTemplates, companyProfile, attributes, authFetch } = useData() as any;
    const { uiStyle } = useTheme();
    const { formatCustom } = useTimezone();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const classic = uiStyle === 'classic';

    const [docType, setDocType] = useState<string>(EDITABLE_DOC_TYPES[0]);
    const [draft, setDraft] = useState<PrintLayout | null>(null);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [selection, setSelection] = useState<Selection>({ bandId: null });
    const paperRef = useRef<HTMLDivElement>(null);
    const canvasPaneRef = useRef<HTMLDivElement>(null);

    // Which section the pointer is over, whether that pointer is on the paper or on
    // the section list — one piece of state so both surfaces highlight together and
    // the list stops being a column of unplaceable names.
    const [hoverBandId, setHoverBandId] = useState<string | null>(null);

    // View scale for the sheet. An A6 card at true size is ~10px per field, which is
    // readable but not editable; the drag layer divides by this (see DesignerCanvas).
    const [zoom, setZoom] = useState(1);
    const [alwaysHandles, setAlwaysHandles] = useState(false);
    const [testPrinting, setTestPrinting] = useState(false);

    // Sample work orders, grouped by the doc type they would print with, so the
    // preview always shows real content for the layout being edited.
    const [samples, setSamples] = useState<{ wo: any; mo: any }[]>([]);
    const [sampleId, setSampleId] = useState<string>('');
    const [loadingSamples, setLoadingSamples] = useState(true);

    // Reset the draft whenever the edited document changes, or a save elsewhere
    // lands. Unsaved edits are guarded by the doc-type switch handler below.
    useEffect(() => {
        const resolved = resolveLayout(docType, printTemplates) || defaultLayout(docType);
        setDraft(resolved ? clone(resolved) : null);
        setDirty(false);
        setSelection({ bandId: null });
    }, [docType, printTemplates]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // all_levels pulls component MOs too, and each MO carries its bom +
                // completions — the WO list endpoint's flat rows have no bom, which
                // would leave the materials band permanently empty in the preview.
                const res = await authFetch(`${API_BASE}/manufacturing-orders?all_levels=true&limit=40`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const pairs: { wo: any; mo: any }[] = [];
                for (const mo of (data.items || [])) {
                    for (const wo of (mo.work_orders || [])) pairs.push({ wo, mo });
                }
                if (!cancelled) setSamples(pairs);
            } catch (e) {
                if (!cancelled) setSamples([]);
            } finally {
                if (!cancelled) setLoadingSamples(false);
            }
        })();
        return () => { cancelled = true; };
    }, [authFetch]);

    const matchingSamples = useMemo(
        () => samples.filter(s => docTypeForWorkCenter(s.wo.work_center_type) === docType),
        [samples, docType]
    );

    // Prefer a work order that actually routes to this document type; fall back to
    // any WO so the canvas is never blank just because the floor has no such step yet.
    const previewPool = matchingSamples.length ? matchingSamples : samples;
    const active = previewPool.find(s => s.wo.id === sampleId) || previewPool[0];

    useEffect(() => {
        if (active && active.wo.id !== sampleId) setSampleId(active.wo.id);
    }, [active, sampleId]);

    // The dyeing card's dose band feeds off the sample WO's own bath. Without this
    // the band would `hideWhenEmpty` itself in the canvas and the client could not
    // see, move or restyle a band that prints on the floor.
    const [sampleDyeing, setSampleDyeing] = useState<DyeingPrintData | null>(null);
    useEffect(() => {
        let cancelled = false;
        if (!active?.wo || !isDyeingWorkOrder(active.wo)) { setSampleDyeing(null); return; }
        fetchDyeingPrintData(authFetch, API_BASE, active.wo)
            .then(data => { if (!cancelled) setSampleDyeing(data); });
        return () => { cancelled = true; };
    }, [active?.wo, authFetch]);

    const ctx = useMemo(() => buildPrintContext({
        workOrder: active?.wo || {},
        parentMO: active?.mo || {},
        // A placeholder QR keeps the cell's true printed size visible without
        // pulling the qrcode library into the designer bundle.
        qrDataUrl: '',
        companyName: companyProfile?.name,
        department: '',
        attributes,
        tzFormatCustom: formatCustom,
        dyeing: sampleDyeing,
    }), [active, companyProfile, attributes, formatCustom, sampleDyeing]);

    // Undo/redo history. Each entry is a full layout snapshot taken right BEFORE
    // a change is applied — so undo replaces the current draft with the top of
    // this stack, and redo needs the draft we just moved away from, which is why
    // undo also pushes onto `future` on its way out. Kept in refs (not state) so
    // pushing doesn't itself trigger a render; only `setDraft` does that.
    const past = useRef<PrintLayout[]>([]);
    const future = useRef<PrintLayout[]>([]);
    const draftRef = useRef<PrintLayout | null>(draft);
    draftRef.current = draft;

    const update = useCallback((next: PrintLayout) => {
        if (draftRef.current) past.current.push(draftRef.current);
        future.current = [];
        setDraft(next);
        setDirty(true);
    }, []);

    /** Clone the current draft, apply `fn`, commit as one undo step. Used by the
     *  drag canvas — a whole drag gesture (move/resize/reorder) is one undo entry. */
    const mutate = useCallback((fn: (d: PrintLayout) => void) => {
        if (!draftRef.current) return;
        const next = clone(draftRef.current);
        fn(next);
        update(next);
    }, [update]);

    const undo = useCallback(() => {
        const prev = past.current.pop();
        if (!prev || !draftRef.current) return;
        future.current.push(draftRef.current);
        setDraft(prev);
        setDirty(true);
    }, []);

    const redo = useCallback(() => {
        const next = future.current.pop();
        if (!next || !draftRef.current) return;
        past.current.push(draftRef.current);
        setDraft(next);
        setDirty(true);
    }, []);

    // Reset history whenever the edited document changes (switching documents
    // already discards the draft via the effect above; the stacks must not
    // survive across documents or undo would apply another doc's edit here).
    useEffect(() => {
        past.current = [];
        future.current = [];
    }, [docType]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod) return;
            const key = e.key.toLowerCase();
            if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
            else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [undo, redo]);

    const switchDocType = async (next: string) => {
        if (dirty) {
            const ok = await confirm({
                title: 'Discard unsaved changes?',
                message: 'You have unsaved layout changes. Switching documents will discard them.',
                confirmText: 'Discard',
                variant: 'danger',
            });
            if (!ok) return;
        }
        setDocType(next);
    };

    const save = async () => {
        if (!draft) return;
        setSaving(true);
        try {
            const res = await authFetch(`${API_BASE}/print-templates/${docType}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ layout: draft, paper: draft.paper }),
            });
            if (!res.ok) {
                const detail = await res.text();
                throw new Error(detail || `HTTP ${res.status}`);
            }
            await refreshPrintTemplates();
            setDirty(false);
            showToast('Print layout saved. Every workstation picks it up immediately.', 'success');
        } catch (e: any) {
            showToast(`Save failed: ${e.message || e}`, 'danger');
        } finally {
            setSaving(false);
        }
    };

    const reset = async () => {
        const ok = await confirm({
            title: 'Reset to factory design?',
            message: 'This deletes your saved layout for this document and restores the built-in design. It cannot be undone.',
            confirmText: 'Reset',
            variant: 'danger',
        });
        if (!ok) return;
        try {
            const res = await authFetch(`${API_BASE}/print-templates/${docType}`, { method: 'DELETE' });
            // 404 = never customised, which is the state we want anyway.
            if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
            await refreshPrintTemplates();
            const builtIn = defaultLayout(docType);
            setDraft(builtIn ? clone(builtIn) : null);
            setDirty(false);
            setSelection({ bandId: null });
            showToast('Restored the built-in design.', 'info');
        } catch (e: any) {
            showToast(`Reset failed: ${e.message || e}`, 'danger');
        }
    };

    const revertDraft = () => {
        const resolved = resolveLayout(docType, printTemplates) || defaultLayout(docType);
        setDraft(resolved ? clone(resolved) : null);
        setDirty(false);
        setSelection({ bandId: null });
    };

    // ── Band list operations ──────────────────────────────────────────────────
    const moveBand = (index: number, delta: number) => {
        if (!draft) return;
        const to = index + delta;
        if (to < 0 || to >= draft.bands.length) return;
        const next = clone(draft);
        const [b] = next.bands.splice(index, 1);
        next.bands.splice(to, 0, b);
        update(next);
    };

    const toggleBand = (index: number) => {
        if (!draft) return;
        const next = clone(draft);
        const b = next.bands[index];
        b.show = b.show === false ? true : false;
        update(next);
    };

    if (!draft) {
        return (
            <ShellWindow classic={classic}>
                <ShellTitleBar classic={classic} icon="bi-printer" title="Print Layout Designer" />
                <div style={{ padding: 24 }}>No editable document types are registered.</div>
            </ShellWindow>
        );
    }

    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(draft.paper);

    const stepZoom = (dir: 1 | -1) => {
        const i = ZOOM_STEPS.findIndex(z => z >= zoom - 0.001);
        const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i < 0 ? ZOOM_STEPS.length - 1 : i) + dir))];
        setZoom(next);
    };

    /**
     * Scale the sheet to the pane. Both sides are measured in *screen* pixels:
     * `getBoundingClientRect` on the (app-scaled) pane already reports them, and the
     * sheet is `ui-scale-exempt`, so its millimetres are true 96dpi CSS pixels.
     */
    const fitZoom = () => {
        const pane = canvasPaneRef.current?.getBoundingClientRect();
        if (!pane) return;
        const padding = 40;   // the pane's own padding, both sides
        const caption = 22;   // the paper-size caption above the sheet
        const zw = (pane.width - padding) / (paperW * MM_PX);
        const zh = (pane.height - padding - caption) / (paperH * MM_PX);
        const z = Math.min(zw, zh);
        if (!Number.isFinite(z) || z <= 0) return;
        setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100)));
    };

    const customised = isCustomised(docType, printTemplates);

    const paneBg = classic ? '#ece9d8' : '#f8f9fa';
    const paneBorder = classic ? '1px solid #b0a898' : '1px solid #dee2e6';

    // Header and zoom-strip actions come from the shared primitives — this view used
    // to hand-roll both, which is how it ended up with `borderRadius: 0` buttons next
    // to the app's BUTTON_RADIUS ones and a modern `btn-secondary` where every other
    // toolbar uses an outline.
    //
    // ToolbarButton for the header: labeled document actions, the same vocabulary as
    // every list toolbar ("create" is its green CTA tone, which Save wants). The zoom
    // strip takes XPActionButton instead — the compact flat one — because those are
    // dense repeated controls, not document actions.

    return (
        // The window itself follows the app's interface scale like every other page.
        // Only the sheet below opts out to 1:1 (see the `ui-scale-exempt` comments
        // there) — exempting the whole window left the toolbar, band list and
        // inspector rendering 20% larger than the chrome around them.
        <ShellWindow classic={classic}>
            <ShellTitleBar
                classic={classic}
                icon="bi-printer"
                title="Print Layout Designer"
                subtitle="Choose which fields appear on each printed document, and how they are sized and placed."
                right={
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <ToolbarButton
                            classic={classic} icon="bi-arrow-90deg-left"
                            onClick={undo} disabled={past.current.length === 0}
                        >
                            Undo
                        </ToolbarButton>
                        <ToolbarButton
                            classic={classic} icon="bi-arrow-90deg-right"
                            onClick={redo} disabled={future.current.length === 0}
                        >
                            Redo
                        </ToolbarButton>
                        {dirty && (
                            <ToolbarButton classic={classic} icon="bi-arrow-counterclockwise" onClick={revertDraft}>
                                Revert
                            </ToolbarButton>
                        )}
                        {/* Prints the draft, so it needs no save first — that is the point. */}
                        <ToolbarButton
                            classic={classic} icon="bi-printer" printable
                            onClick={() => setTestPrinting(true)}
                            disabled={!active || testPrinting}
                        >
                            Test print
                        </ToolbarButton>
                        <ToolbarButton
                            classic={classic} tone="danger" icon="bi-trash"
                            onClick={reset} disabled={!customised}
                        >
                            Reset to default
                        </ToolbarButton>
                        {/* Dirty state also sits in the status bar, but that is the far corner
                            from Save — the one place the state actually changes what you do. */}
                        {dirty && (
                            <Chip classic={classic} tone={familyTint('amber')}>Unsaved</Chip>
                        )}
                        <ToolbarButton
                            classic={classic} tone="create" icon="bi-check-lg"
                            onClick={save} disabled={!dirty || saving}
                        >
                            {saving ? 'Saving...' : 'Save layout'}
                        </ToolbarButton>
                    </span>
                }
            />

            {/* Toolbar: which document, which work order to preview with */}
            <div style={classic ? xpToolbar() : undefined} className={classic ? undefined : 'px-3 py-2 border-bottom bg-light'}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: classic ? xpFont : undefined, fontSize: 11, fontWeight: 'bold' }}>Document:</span>
                    <div style={{ width: 300 }}>
                        <SelectField
                            classic={classic}
                            value={docType as any}
                            options={EDITABLE_DOC_TYPES.map(d => ({ value: d, label: DOC_TYPE_LABELS[d] || d }))}
                            onChange={v => switchDocType(v)}
                        />
                    </div>

                    <Chip classic={classic} tone={familyTint(customised ? 'green' : 'gray')}>
                        {customised ? 'Customised' : 'Built-in default'}
                    </Chip>

                    <span style={{ flex: 1 }} />

                    <span style={{ fontFamily: classic ? xpFont : undefined, fontSize: 11, fontWeight: 'bold' }}>Preview with:</span>
                    <div style={{ width: 260 }}>
                        {loadingSamples ? (
                            <span style={{ fontFamily: classic ? xpFont : undefined, fontSize: 11, color: '#666' }}>Loading work orders...</span>
                        ) : previewPool.length === 0 ? (
                            <span style={{ fontFamily: classic ? xpFont : undefined, fontSize: 11, color: '#a33' }}>No work orders found</span>
                        ) : (
                            <SelectField
                                classic={classic}
                                value={sampleId as any}
                                options={previewPool.map(s => ({
                                    value: s.wo.id,
                                    label: `${s.wo.code || s.wo.name || 'WO'} — ${s.wo.work_center_name || 'no machine'}`,
                                }))}
                                onChange={v => setSampleId(v)}
                            />
                        )}
                    </div>
                </div>
                {!loadingSamples && matchingSamples.length === 0 && previewPool.length > 0 && (
                    <div style={{
                        fontFamily: classic ? xpFont : undefined, fontSize: 10,
                        color: '#8a6d00', marginTop: 4,
                    }}>
                        <i className="bi bi-exclamation-triangle" style={{ marginRight: 4 }} />
                        No work order currently routes to this document type, so the preview
                        uses another work order. Field values will look wrong; the layout is still correct.
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {/* ── Left: bands ─────────────────────────────────────────── */}
                <div style={{
                    width: 210, minWidth: 210, borderRight: paneBorder,
                    background: paneBg, overflowY: 'auto', padding: 8,
                }}>
                    <div style={{
                        fontFamily: classic ? xpFont : undefined, fontSize: 10, fontWeight: 'bold',
                        textTransform: 'uppercase', letterSpacing: '0.4px',
                        color: classic ? '#4a4436' : '#6c757d', marginBottom: 5,
                    }}>
                        Sections, top to bottom
                    </div>

                    <div
                        onClick={() => setSelection({ bandId: null })}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                            fontFamily: classic ? xpFont : undefined, fontSize: 11,
                            padding: '3px 4px', marginBottom: 4,
                            background: selection.bandId === null ? (classic ? '#0058e6' : '#0d6efd') : 'transparent',
                            color: selection.bandId === null ? '#fff' : (classic ? '#2b2822' : '#212529'),
                            fontWeight: 'bold',
                        }}
                    >
                        <i className="bi bi-file-earmark" />
                        Whole document
                    </div>

                    {draft.bands.map((band, i) => {
                        const selected = selection.bandId === band.id;
                        const hovered = hoverBandId === band.id && !selected;
                        const hidden = band.show === false;
                        return (
                            <div
                                key={band.id}
                                onClick={() => setSelection({ bandId: band.id })}
                                onMouseEnter={() => setHoverBandId(band.id)}
                                onMouseLeave={() => setHoverBandId(cur => (cur === band.id ? null : cur))}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                                    fontFamily: classic ? xpFont : undefined, fontSize: 11,
                                    padding: '3px 4px', marginBottom: 2,
                                    background: selected
                                        ? (classic ? '#0058e6' : '#0d6efd')
                                        : (hovered ? (classic ? '#d6e6ff' : '#e7f1ff') : 'transparent'),
                                    color: selected ? '#fff' : (hidden ? '#999' : (classic ? '#2b2822' : '#212529')),
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={!hidden}
                                    onClick={e => e.stopPropagation()}
                                    onChange={() => toggleBand(i)}
                                    title={hidden ? 'Show this section' : 'Hide this section'}
                                />
                                {/* The number is the print order, so the list reads against the
                                    sheet without counting rows. */}
                                <span style={{
                                    flexShrink: 0, fontSize: 9, opacity: 0.55,
                                    width: 12, textAlign: 'right',
                                }}>
                                    {i + 1}
                                </span>
                                <span
                                    title={describeBand(band, docType)}
                                    style={{
                                        flex: 1, minWidth: 0, overflow: 'hidden',
                                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        textDecoration: hidden ? 'line-through' : undefined,
                                    }}
                                >
                                    {describeBand(band, docType)}
                                </span>
                                {/* Shape, not name — appending it to the name is what produced
                                    the "Grid Grid" rows this replaced. */}
                                <span style={{
                                    flexShrink: 0, fontSize: 9, opacity: 0.55, marginRight: 2,
                                }}>
                                    {bandTypeLabel(band)}
                                </span>
                                <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
                                    <button
                                        onClick={e => { e.stopPropagation(); moveBand(i, -1); }}
                                        disabled={i === 0}
                                        title="Move up"
                                        style={{
                                            fontSize: 10, lineHeight: 1, padding: '1px 3px', borderRadius: 0,
                                            cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.35 : 1,
                                            background: classic ? 'linear-gradient(to bottom,#fff,#d4d0c8)' : '#fff',
                                            border: '1px solid', borderColor: classic ? '#dfdfdf #808080 #808080 #dfdfdf' : '#ced4da',
                                        }}
                                    >
                                        <i className="bi bi-chevron-up" />
                                    </button>
                                    <button
                                        onClick={e => { e.stopPropagation(); moveBand(i, 1); }}
                                        disabled={i === draft.bands.length - 1}
                                        title="Move down"
                                        style={{
                                            fontSize: 10, lineHeight: 1, padding: '1px 3px', borderRadius: 0,
                                            cursor: i === draft.bands.length - 1 ? 'default' : 'pointer',
                                            opacity: i === draft.bands.length - 1 ? 0.35 : 1,
                                            background: classic ? 'linear-gradient(to bottom,#fff,#d4d0c8)' : '#fff',
                                            border: '1px solid', borderColor: classic ? '#dfdfdf #808080 #808080 #dfdfdf' : '#ced4da',
                                        }}
                                    >
                                        <i className="bi bi-chevron-down" />
                                    </button>
                                </span>
                            </div>
                        );
                    })}

                    <div style={{
                        fontFamily: classic ? xpFont : undefined, fontSize: 10, color: '#888',
                        fontStyle: 'italic', marginTop: 8, borderTop: paneBorder, paddingTop: 6,
                    }}>
                        Hovering a section here outlines it on the paper, and hovering the paper
                        highlights it here. Unticking hides a section from the printout but keeps
                        its design, so you can bring it back later.
                        <br /><br />
                        Handles appear on the section under the pointer: drag
                        the <i className="bi bi-arrows-move" /> above a field to move it, its
                        right-edge handle to resize, or the <i className="bi bi-grip-vertical" /> grip
                        on a row/column/section to reorder. Ctrl+Z undoes.
                    </div>
                </div>

                {/* ── Centre: paper ───────────────────────────────────────── */}
                <div
                    ref={canvasPaneRef}
                    style={{
                        flex: 1, minWidth: 0, background: classic ? '#808080' : '#e9ecef',
                        overflow: 'auto', padding: 16,
                        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
                    }}
                >
                    {loadingSamples ? (
                        // Sheet-shaped placeholder at the real paper size, so the canvas
                        // doesn't resize under the designer when the sample WO lands.
                        <div>
                            <div style={{ height: 10, marginBottom: 4 }} />
                            {/* ui-scale-exempt on the placeholder too, or it stands at 80%
                                and the sheet jumps size when the sample WO lands — the very
                                resize this placeholder exists to prevent. */}
                            <div className="ui-scale-exempt" style={{
                                background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
                                width: `${paperW}mm`, height: `${paperH}mm`,
                                padding: `${draft.paper.marginMm}mm`, boxSizing: 'border-box',
                            }}>
                                <PanelSkeleton sections={3} rows={4} classic={classic} caption />
                            </div>
                        </div>
                    ) : (
                        <div>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                gap: 6, marginBottom: 4,
                                fontFamily: classic ? xpFont : undefined, fontSize: 10,
                                color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                            }}>
                                <XPActionButton
                                    classic={classic} icon="bi-dash-lg" title="Zoom out"
                                    onClick={() => stepZoom(-1)} disabled={zoom <= ZOOM_MIN}
                                />
                                <XPActionButton
                                    classic={classic} label={`${Math.round(zoom * 100)}%`}
                                    title="Back to true size (100%)"
                                    onClick={() => setZoom(1)} disabled={zoom === 1}
                                />
                                <XPActionButton
                                    classic={classic} icon="bi-plus-lg" title="Zoom in"
                                    onClick={() => stepZoom(1)} disabled={zoom >= ZOOM_MAX}
                                />
                                <XPActionButton
                                    classic={classic} label="Fit"
                                    title="Scale the sheet to fit this pane"
                                    onClick={fitZoom}
                                />
                                <span style={{ opacity: 0.5 }}>|</span>
                                <label
                                    title="Show every section's handles at once, instead of only the one under the pointer"
                                    style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={alwaysHandles}
                                        onChange={e => setAlwaysHandles(e.target.checked)}
                                    />
                                    All handles
                                </label>
                                <span style={{ opacity: 0.5 }}>|</span>
                                <span>
                                    {paperSizeLabel(draft.paper)} {draft.paper.orientation} — {paperW} x {paperH}mm
                                    {draft.paper.marginMm ? ` (page margin ${draft.paper.marginMm}mm)` : ''}
                                </span>
                            </div>
                            {/* True-size sheet, then scaled by the view zoom. The inner box is
                                the printable area: the page margin is drawn as the gap, so what
                                is inside is exactly what the printer can reach.

                                ui-scale-exempt is load-bearing here, and this is the whole of
                                the page that needs it. Two reasons: a sheet quoted in mm is
                                only honest at 1:1, and DesignerCanvas measures with
                                getBoundingClientRect (screen px) then writes straight into
                                style.left/top (layout px) — units that agree only at effective
                                zoom 1, or every grip and drop target lands off by the scale.
                                The canvas renders inside `paperRef` and measures everything
                                relative to it (no portal, nothing fixed), so the whole drag
                                layer sits inside this boundary.

                                The designer's own zoom is a `transform` on the sheet INSIDE that
                                boundary, with the same factor handed to DesignerCanvas so it can
                                divide measurements back into layout pixels. The app's interface
                                scale stays cancelled either way — one known factor to correct for
                                beats two multiplied ones. The outer box reserves the scaled
                                footprint, or the pane would scroll to the 1:1 size. */}
                            <div
                                className="ui-scale-exempt"
                                style={{
                                    width: `${paperW * zoom}mm`, height: `${paperH * zoom}mm`,
                                    flexShrink: 0,
                                }}
                            >
                                <div
                                    onClick={() => setSelection({ bandId: null })}
                                    style={{
                                        background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
                                        width: `${paperW}mm`, height: `${paperH}mm`,
                                        padding: `${draft.paper.marginMm}mm`,
                                        boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                                        transform: zoom === 1 ? undefined : `scale(${zoom})`,
                                        transformOrigin: 'top left',
                                    }}
                                >
                                    <div
                                        ref={paperRef}
                                        style={{
                                            flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
                                            outline: '1px dashed rgba(0,0,0,0.15)', outlineOffset: 0,
                                            position: 'relative',
                                        }}
                                    >
                                        <TemplateRenderer
                                            layout={draft}
                                            ctx={ctx}
                                            docType={docType}
                                            selectedId={selectionToId(selection)}
                                            onSelect={id => setSelection(parseSelectId(id))}
                                        />
                                        {/* Drag/resize/reorder overlay — measures the TemplateRenderer
                                            output above via its data-tpl-* attributes and sits on top of
                                            it. See DesignerCanvas.tsx for why nothing here touches layout
                                            state until pointer-up (one drag = one undo step). */}
                                        <DesignerCanvas
                                            layout={draft}
                                            docType={docType}
                                            paperRef={paperRef}
                                            selection={selection}
                                            onSelect={setSelection}
                                            onMutate={mutate}
                                            zoom={zoom}
                                            hoverBandId={hoverBandId}
                                            onHoverBand={setHoverBandId}
                                            alwaysShowHandles={alwaysHandles}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Right: inspector ────────────────────────────────────── */}
                <div style={{
                    width: 260, minWidth: 260, borderLeft: paneBorder,
                    background: paneBg, overflowY: 'auto', padding: 8,
                }}>
                    <InspectorPanel
                        layout={draft}
                        docType={docType}
                        selection={selection}
                        onChange={update}
                        onSelect={setSelection}
                        classic={classic}
                    />
                </div>
            </div>

            <div style={{
                padding: '4px 10px', borderTop: paneBorder,
                background: classic ? 'linear-gradient(to bottom,#f4f2ea,#e3e1d6)' : '#f8f9fa',
                fontFamily: classic ? xpFont : undefined, fontSize: 10,
                color: dirty ? '#8a6d00' : '#666',
                display: 'flex', justifyContent: 'space-between',
            }}>
                <span>
                    {dirty
                        ? 'Unsaved changes — nothing on the floor has changed yet.'
                        : 'Saved. Operators print this design.'}
                </span>
                <span>{draft.bands.length} sections</span>
            </div>

            {/* Mounted only while printing: it adds a body class that hides the rest of
                the page, so it must not exist a moment longer than the print. */}
            {testPrinting && active && (
                <DesignerTestPrint
                    draft={draft}
                    workOrder={active.wo}
                    parentMO={active.mo}
                    companyName={companyProfile?.name}
                    attributes={attributes}
                    dyeing={sampleDyeing}
                    onDone={() => setTestPrinting(false)}
                />
            )}
        </ShellWindow>
    );
}
