import { useState, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import CodeConfigModal, { CodeConfig, buildCodeWithCounter } from '../shared/CodeConfigModal';
import { useToast } from '../shared/Toast';
import { useLanguage } from '../../context/LanguageContext';
import SearchableSelect from '../shared/SearchableSelect';
import ModalWrapper from '../shared/ModalWrapper';
const SalesPrintModal = dynamic(() => import('./SalesPrintModal'), { ssr: false });
const SOTablePrintModal = dynamic(() => import('./SOTablePrintModal'), { ssr: false });
import { useTheme } from '../../context/ThemeContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useData } from '../../context/DataContext';
import { useUser } from '../../context/UserContext';
import { nextSortState, StatusChip, statusTint, TableSkeleton, useTableSkeletonMetrics, ProgressBar, useFloatingMenu, MenuTriggerButton, FloatingMenu, XPActionButton, FormSection, FieldLabel, xpBtn, xpInput as xpInputBase, CodeChip, CODE_FONT, xpFont, CHIP_RADIUS, CODE_CHIP_RADIUS, Chip, VariantChip, VariantKind, variantChipTone, colorLabel, colorHexFor, BTN_TONES, XP_BTN } from '../shared/xpTheme';

import { qtyFmt } from '../shared/format';
import { useComboSearch, useFinishedGoodsSearch } from '../shared/useEntitySearch';
import Pager from '../shared/Pager';
import { Tooltip } from '../shared/Tooltip';
import { ShellWindow, ShellTitleBar, xpToolbar, SearchField, FilterChipBar, ToolbarCount, ToolbarButton } from '../shared/shellTheme';
import { useRouter } from 'next/navigation';
import { lvThead, SortableTh, lvThSticky, lvTdRuled, lvZebra } from '../shared/listViewTheme';

// One width per column, in render order, and the ONLY place they are declared —
// the <colgroup> below feeds them to both themes at once (the modern one used to
// declare none at all, so every added column stole width from its neighbours).
//
// They are honoured because the table is laid out `table-layout: fixed` at no less
// than their total: under the default `auto` layout a <th> width is merely a hint,
// and one long item name was enough to make the browser reflow every other column
// narrower instead of overflowing. Fixed + minWidth means a narrow window scrolls
// horizontally and a wide one shares the slack out, but nothing is ever squeezed
// below the width declared here.
const SO_COL_WIDTHS = [
    150, // PO# / Ref
    180, // Customer
    72,  // Date
    215, // Item
    132, // Size
    205, // Qty
    110, // Alt Unit
    110, // Stock Notes
    88,  // Req / Conf
    152, // Production Output
    92,  // Fulfilment
    80,  // Status
    75,  // Actions
];
const SO_TABLE_MIN_WIDTH = SO_COL_WIDTHS.reduce((a, b) => a + b, 0);

// The production-output bar IS the link to the MO. A code chip above it ate the column's
// width and truncated the code to noise ("PR-2026-08-00010-00…"), so the code now
// lives only in the hover tooltip and the bar itself is the click target.
function MOProgressLink({ pct, tone, onClick }: { pct: number; tone: 'green' | 'blue'; onClick: () => void }) {
    const [hover, setHover] = useState(false);
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                cursor: 'pointer',
                outline: 'none',
                borderRadius: 2,
                boxShadow: hover ? '0 0 0 2px rgba(0, 88, 230, 0.28)' : undefined,
                filter: hover ? 'brightness(1.1)' : undefined,
            }}
        >
            <ProgressBar pct={pct} tone={tone} height={6} />
        </div>
    );
}

// Ordered qty is the emphasised number on a line, so it keeps its own blue fill —
// VARIANT_TONE entries mean "variant identity", which a quantity is not. The metre
// echo takes the neutral Chip default and KG the shared qty green.
const QTY_ORDERED_TONE = { color: '#003ea6', background: '#dce8ff', borderColor: '#9ab0e0' };

export default function SalesOrderView({ items, attributes, boms, salesOrders, partners, onCreateSO, onDeleteSO, onEditSO, onUpdateSOStatus, onGenerateWO }: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingSOId, setEditingSOId] = useState<string | null>(null);
  const [printingSO, setPrintingSO] = useState<any>(null);
  const [isTablePrintOpen, setIsTablePrintOpen] = useState(false);
  const [printOrders, setPrintOrders] = useState<any[] | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const { uiStyle: currentStyle } = useTheme();
  const {
      companyProfile, uoms, authFetch, itemIndex, loading: dataLoading, soStatusCounts, soQuery,
      refreshSalesOrders,
      pagination: { soPage, setSoPage, soTotal, pageSize: soPageSize },
      filters: { soSearch: searchTerm, setSoSearch: setSearchTerm, soCustomerSearch: customerSearch, setSoCustomerSearch: setCustomerSearch, soStatusFilter: statusFilter, setSoStatusFilter: setStatusFilter, soSort, setSoSort },
  } = useData();
  const { hasPermission, hasAnyPermission } = useUser();
  const canManage = hasAnyPermission('sales_order.create', 'sales_order.edit', 'sales_order.delete', 'sales_order.close');

  // Floating "more actions" menu (Edit / Print / Delete)
  const { openId: openMenuId, pos: menuPos, toggle: toggleMenu, close: closeMenu } = useFloatingMenu();

  // Lineage (SO → PR → MO → WO → beam) trace modal
  const router = useRouter();
  const lineageEnvBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
  const LINEAGE_API_BASE = lineageEnvBase.endsWith('/api') ? lineageEnvBase : `${lineageEnvBase}/api`;

  // Both line-form pickers are server-side typeaheads that live *inside* the
  // create/edit modal, so they prime only once it opens. Priming on mount cost two
  // requests per page load for dropdowns nobody could see, and they queued ahead of
  // the fetches the visible table was blocked on.
  const pickersActive = isCreateOpen || editingSOId !== null;

  // The item picker is Finished-Goods-scoped server-side, so it scales past any
  // client-side cap on `items`.
  const { results: itemResults, onSearch: onSearchItems } = useFinishedGoodsSearch({ enabled: pickersActive });

  // Combo Library governs which combos are offered — server-searched (thousands of
  // combos won't fit in a client-rendered <select>), scoped to active combos only.
  const { results: comboResults, onSearch: onSearchCombos } = useComboSearch({ enabled: pickersActive });
  const [lineageSO, setLineageSO] = useState<any>(null);
  const [lineageData, setLineageData] = useState<any>(null);
  const [lineageLoading, setLineageLoading] = useState(false);
  // Stock this order took instead of producing. Fetched alongside the lineage
  // because it answers the same question the lineage modal is opened to answer —
  // "where is my order?" — for the half that has no MO to show.
  const [lineageReservations, setLineageReservations] = useState<any[]>([]);

  const openLineage = async (so: any) => {
    setLineageSO(so);
    setLineageData(null);
    setLineageReservations([]);
    setLineageLoading(true);
    try {
      const [res, resvRes] = await Promise.all([
        authFetch(`${LINEAGE_API_BASE}/sales-orders/${so.id}/lineage`),
        authFetch(`${LINEAGE_API_BASE}/sales-orders/${so.id}/reservations`),
      ]);
      if (res.ok) setLineageData(await res.json());
      else showToast('Failed to load lineage', 'danger');
      // Reservations are supplementary — a failure here must not blank the
      // lineage the user actually clicked for.
      if (resvRes.ok) setLineageReservations(((await resvRes.json()) || {}).reservations || []);
    } catch {
      showToast('Failed to load lineage', 'danger');
    } finally {
      setLineageLoading(false);
    }
  };

  const releaseReservation = async (soId: string, resId: string) => {
    const res = await authFetch(`${LINEAGE_API_BASE}/sales-orders/${soId}/reservations/${resId}/release`, { method: 'POST' });
    if (res.ok) {
      setLineageReservations(((await res.json()) || {}).reservations || []);
      showToast('Stock released back to the free pool', 'success');
      refreshSalesOrders?.();
    } else {
      showToast('Could not release the reservation', 'danger');
    }
  };

  const closeLineage = () => { setLineageSO(null); setLineageData(null); setLineageReservations([]); };
  const goToMO = (code: string) => { closeLineage(); router.push(`/manufacturing-orders?mo=${encodeURIComponent(code)}`); };
  const goToPR = (code: string) => { closeLineage(); router.push(`/production-runs?pr=${encodeURIComponent(code)}`); };

  const lineageStatusBadge = (s: string) => {
    const { background: bg, borderColor: bd, color: fg } = statusTint(s);
    return (
      <span style={{ fontSize: '0.68rem', background: bg, border: `1px solid ${bd}`, color: fg, padding: '0 6px', borderRadius: CHIP_RADIUS, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
        {(s || 'PENDING').replace('_', ' ')}
      </span>
    );
  };

  // Clickable code chip (MO / PR). onClick navigates to the relevant page.
  // Deliberate exception to the CodeChip tiering: inside the lineage tree the tint
  // encodes WHICH ENTITY the code belongs to (green = PR, blue = MO), which is the
  // whole point of the view. Elsewhere a code must not carry a fill. Font stays on
  // CODE_FONT so it still matches the rest of the app.
  const lineageCodeChip = (code: string, onClick: () => void, scheme: 'mo' | 'pr') => {
    const colors = scheme === 'pr'
      ? { bg: '#e4f5e4', bd: '#90c090', fg: '#1a5e1a' }
      : { bg: '#dce8ff', bd: '#9ab0e0', fg: '#003ea6' };
    return (
      <button
        type="button"
        onClick={onClick}
        title={`Open ${code}`}
        style={{
          fontFamily: CODE_FONT, fontWeight: 'bold', fontSize: '0.72rem',
          background: colors.bg, border: `1px solid ${colors.bd}`, color: colors.fg,
          padding: '1px 7px', borderRadius: CODE_CHIP_RADIUS, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(0.93)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.filter = 'none'; }}
      >
        <i className={`bi ${scheme === 'pr' ? 'bi-collection-play' : 'bi-box'}`} style={{ fontSize: '0.7rem' }}></i>
        {code}
        <i className="bi bi-box-arrow-up-right" style={{ fontSize: '0.6rem', opacity: 0.6 }}></i>
      </button>
    );
  };

  const lineageChip = (text: React.ReactNode, bg: string, bd: string, fg: string, icon?: string) => (
    <span style={{ fontSize: '0.68rem', background: bg, border: `1px solid ${bd}`, color: fg, padding: '0 6px', borderRadius: CHIP_RADIUS, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {icon && <i className={`bi ${icon}`} style={{ fontSize: '0.62rem' }}></i>}{text}
    </span>
  );

  // Blue while running, green at 100 — the STATUS_FAMILY reading of IN_PROGRESS
  // vs COMPLETED, not ProgressBar's default gray/amber/green fill ramp.
  const lineageProgressBar = (pct: number) => (
    <div style={{ maxWidth: 175 }}>
      <ProgressBar pct={pct} tone={pct >= 100 ? 'green' : 'blue'} height={7} label="outside" />
    </div>
  );

  // Flatten an MO subtree into typed rows (mo / beam) with an indent level.
  // WOs are omitted (too many); their output beams are re-parented directly under the MO.
  const flattenMO = (mo: any, level: number, isComponent: boolean, out: any[]) => {
    out.push({ kind: 'mo', level, mo, isComponent });
    (mo.work_orders || []).forEach((wo: any) => {
      (wo.beams || []).forEach((bm: any) => out.push({ kind: 'beam', level: level + 1, beam: bm }));
    });
    (mo.component_mos || []).forEach((c: any) => flattenMO(c, level + 1, true, out));
    return out;
  };

  const lineageTd = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    padding: '3px 8px', borderBottom: classic ? '1px solid #e2dfd6' : '1px solid #eee',
    verticalAlign: 'middle', ...extra,
  });

  const renderLineageRow = (row: any, key: string) => {
    const indent = 6 + row.level * 16;
    const itemStyle: React.CSSProperties = { fontSize: '0.68rem', color: '#999' };
    if (row.kind === 'mo') {
      const mo = row.mo;
      const wos = mo.work_orders || [];
      const done = wos.filter((w: any) => w.status === 'COMPLETED').length;
      // DELIVERED = planned qty met (order merely not closed yet) — counts as done.
      const pct = wos.length ? Math.round((done / wos.length) * 100) : (['COMPLETED', 'DELIVERED'].includes(mo.status) ? 100 : 0);
      return (
        <tr key={key} style={{ background: row.isComponent ? (classic ? '#f3f6ff' : '#f7faff') : (classic ? '#fff' : undefined) }}>
          <td style={lineageTd({ paddingLeft: indent })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {lineageCodeChip(mo.code, () => goToMO(mo.code), 'mo')}
              {row.isComponent && lineageChip(`SHARED${mo.dep_qty != null ? ` · ${mo.dep_qty}` : ''}`, '#eef4ff', '#b8ccf0', '#003ea6', 'bi-diagram-2')}
            </div>
          </td>
          <td style={lineageTd()}><span style={itemStyle}>{mo.item_code}</span></td>
          <td style={lineageTd({ textAlign: 'right', fontFamily: CODE_FONT, fontSize: '0.72rem' })}>{mo.qty}</td>
          <td style={lineageTd()}>{lineageStatusBadge(mo.status)}</td>
          <td style={lineageTd({ minWidth: 120 })}>{lineageProgressBar(pct)}</td>
        </tr>
      );
    }
    // beam
    const bm = row.beam;
    return (
      <tr key={key}>
        <td style={lineageTd({ paddingLeft: indent })}>
          <span title={`Beam ${bm.batch_number}`} style={{ fontSize: '0.68rem', background: '#fdf3e0', border: '1px solid #e0c08a', color: '#8a5a00', padding: '1px 7px', borderRadius: CHIP_RADIUS, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <i className="bi bi-box-seam"></i><span style={{ fontFamily: CODE_FONT, fontWeight: 'bold' }}>{bm.batch_number}</span>
          </span>
        </td>
        <td style={lineageTd()}><span style={itemStyle}>{bm.item_code}{bm.ends != null ? ` · ${bm.ends}e` : ''}</span></td>
        <td style={lineageTd({ textAlign: 'right' })}></td>
        <td style={lineageTd()}>
          <span style={{ fontSize: '0.68rem', fontWeight: 'bold', color: bm.remaining > 0 ? '#1a5e1a' : '#999' }}>{bm.remaining > 0 ? `${bm.remaining} left` : 'depleted'}</span>
        </td>
        <td style={lineageTd()}></td>
      </tr>
    );
  };


  const classic = currentStyle === 'classic';

  // ── XP shared inline styles ──────────────────────────────────────────────
  // Local wrapper keeps this form's inset-shadow input treatment while sourcing
  // the base style from the shared xpTheme factory (was a hand-duplicated object).
  const xpInput = (extra: React.CSSProperties = {}): React.CSSProperties =>
      xpInputBase({ boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)', ...extra });

  const xpSep: React.CSSProperties = {
      width: '1px',
      height: '20px',
      background: '#a0988c',
      margin: '0 2px',
      flexShrink: 0,
  };

  const xpTableHeader: React.CSSProperties = lvThead(true);

  const xpThCell: React.CSSProperties = lvThSticky(true);

  const tdBase: React.CSSProperties = lvTdRuled(true);


  const [newSO, setNewSO] = useState({
      po_number: '',
      customer_po_ref: '',
      customer_name: '',
      order_date: new Date().toISOString().split('T')[0],
      lines: [] as any[]
  });

  const [newLine, setNewLine] = useState({
      item_id: '', qty: 0, due_date: '', attribute_value_ids: [] as string[],
      ket_stock: '', internal_confirmation_date: '', qty_kg: '', qty2: '', uom2: '',
      uom2_factor: null as number | null,
      bom_id: '',
      // The ordered size, stated without a recipe: `size_token` is the folded
      // size name the pickers key on, size_id/size_label are what the server
      // stores. A BOMSize id would pin the BOM, which is now the PR's call —
      // except for measurement-only free sizes (157 cm, no name), which have no
      // recipe-independent identity and so still ride on `bom_size_id`.
      size_token: '',
      size_id: '',
      size_label: '',
      bom_size_id: '',
      color_id: '',
      color_label: '',
      color_hex: '',
      labdip_variant_code: '',
      labdip_item_id: '',
      labdip_label: '',
      // Customer ordered the shade but hasn't sent the physical swatch. Cleared
      // by editing the SO line once it arrives; display-only, gates nothing.
      no_color_swatch: false,
  });
  const [colorSearch, setColorSearch] = useState('');
  const [colorResults, setColorResults] = useState<any[]>([]);
  const [colorFocused, setColorFocused] = useState(false);
  // Pending shades (lab dips still in progress) for the selected item — orderable
  // before approval; the minted color backfills onto the MO once approved.
  const [labdipResults, setLabdipResults] = useState<any[]>([]);
  const [lastDeliveryDates, setLastDeliveryDates] = useState({ due_date: '', internal_confirmation_date: '' });
  const [qtyMeter, setQtyMeter] = useState('');
  const [qtyGrossYd, setQtyGrossYd] = useState('');
  const [kgAuto, setKgAuto] = useState(true);

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [codeConfig, setCodeConfig] = useState<CodeConfig>({
      prefix: 'SO',
      suffix: '',
      separator: '-',
      includeItemCode: false,
      includeVariant: false,
      variantAttributeNames: [],
      includeYear: true,
      includeMonth: true
  });

  useEffect(() => {
      const savedConfig = localStorage.getItem('so_code_config');
      if (savedConfig) {
          try { setCodeConfig(JSON.parse(savedConfig)); } catch (e) {}
      }
  }, []);

  const handleSaveConfig = (newConfig: CodeConfig) => {
      setCodeConfig(newConfig);
      localStorage.setItem('so_code_config', JSON.stringify(newConfig));
      setNewSO(prev => ({ ...prev, po_number: suggestSOCode(newConfig) }));
  };

  const suggestSOCode = (config = codeConfig) => {
      let counter = 1;
      let code = buildCodeWithCounter(config, counter);
      while (salesOrders.some((s: any) => s.po_number === code)) {
          counter++;
          code = buildCodeWithCounter(config, counter);
      }
      return code;
  };

  useEffect(() => {
      if (isCreateOpen && !newSO.po_number) {
          setNewSO(prev => ({ ...prev, po_number: suggestSOCode() }));
      }
  }, [isCreateOpen]);

  const handleAddLine = () => {
      if (!newLine.item_id || newLine.qty <= 0) return;
      const variantErr = variantGateError(newLine);
      if (variantErr) { showToast(variantErr, 'warning'); return; }
      // The BOM is optional here. Sales orders a size, not a recipe: with several
      // candidate BOMs the planner picks one on the Production Run, where the
      // shop-floor context lives. When the pick IS made here it still rides along
      // — one item can own several attribute-less BOMs (a root per shade) and
      // nothing else tells them apart — the PR pre-fill just no longer needs it.
      setNewSO({ ...newSO, lines: [...newSO.lines, { ...newLine,
          bom_id: newLine.bom_id || null,
          size_id: newLine.size_id || null,
          size_label: newLine.size_label || null,
          bom_size_id: newLine.bom_size_id || null,
      }] });
      const nextDates = { due_date: newLine.due_date, internal_confirmation_date: newLine.internal_confirmation_date };
      setLastDeliveryDates(nextDates);
      setNewLine({ item_id: '', qty: 0, due_date: nextDates.due_date, attribute_value_ids: [], ket_stock: '', internal_confirmation_date: nextDates.internal_confirmation_date, qty_kg: '', qty2: '', uom2: '', uom2_factor: null, bom_id: '', size_token: '', size_id: '', size_label: '', bom_size_id: '', color_id: '', color_label: '', color_hex: '', labdip_variant_code: '', labdip_item_id: '', labdip_label: '', no_color_swatch: false });
      setQtyMeter('');
      setQtyGrossYd('');
      setKgAuto(true);
  };

  // Toggle in place on an already-added line: the swatch usually arrives after
  // the order is placed, so unchecking must not mean remove-and-re-add.
  const handleLineSwatchToggle = (index: number) => {
      setNewSO(prev => ({
          ...prev,
          lines: prev.lines.map((l: any, i: number) => i === index ? { ...l, no_color_swatch: !l.no_color_swatch } : l),
      }));
  };

  const handleRemoveLine = (index: number) => {
      setNewSO({ ...newSO, lines: newSO.lines.filter((_, i) => i !== index) });
  };

  const handleLineDateChange = (index: number, field: 'due_date' | 'internal_confirmation_date', value: string) => {
      setNewSO(prev => ({
          ...prev,
          lines: prev.lines.map((l: any, i: number) => i === index ? { ...l, [field]: value } : l),
      }));
  };

  // Edit an already-added line's qty in place (no remove + re-add). Recomputes
  // the same length/weight derivatives Add Line would have produced.
  const handleLineQtyChange = (index: number, ydStr: string) => {
      const yd = parseFloat(ydStr) || 0;
      setNewSO(prev => ({
          ...prev,
          lines: prev.lines.map((l: any, i: number) => {
              if (i !== index) return l;
              const m = yd > 0 ? Math.round(yd * 0.9144 * 100) / 100 : 0;
              const kg = calcKgAuto(l.item_id, yd, m);
              // Alt count follows the base qty, same lock as the draft-line form.
              const alt = altCountForYd(l.uom2, l.uom2_factor ?? null, yd);
              return { ...l, qty: yd, qty_kg: kg !== null ? kg : l.qty_kg, ...(alt !== undefined ? { qty2: alt } : {}) };
          }),
      }));
  };

  // Edit an already-added line's alt unit in place. Without this the Alt Unit
  // column could only ever be set on a brand-new line: reopening an order to
  // change it did nothing, since the form's alt-unit inputs bind to newLine.
  // Changing the unit clears the factor (factors belong to the UOM master), and
  // qty/kg follow the conversion exactly as Add Line derives them.
  const handleLineAltChange = (index: number, patch: { qty2?: string; uom2?: string; uom2_factor?: number | null }) => {
      setNewSO(prev => ({
          ...prev,
          lines: prev.lines.map((l: any, i: number) => {
              if (i !== index) return l;
              const next: any = { ...l, ...patch };
              if (patch.uom2 !== undefined) next.uom2_factor = null;
              const conv = deriveFromAlt(next.uom2, parseFloat(next.qty2) || 0, next.uom2_factor ?? null);
              if (conv) {
                  const kg = calcKgAuto(l.item_id, conv.yd, conv.m);
                  next.qty = conv.yd;
                  if (kg !== null) next.qty_kg = kg;
              }
              return next;
          }),
      }));
  };

  const comboAttr = (attributes || []).find((a: any) => a.system_role === 'combo');
  const colorAttr = (attributes || []).find((a: any) => a.system_role === 'color');

  // A variant FG ordered without its variant identity is unbuildable: a color line
  // with neither an approved color_id nor a pending lab dip code has no shade for
  // the DYEING recipe match, and a combo line with no Combo value can't pick a BOM.
  // Returns an error message, or null when the line is complete.
  const variantGateError = (line: any): string | null => {
      const vt = resolveItem(line.item_id)?.variant_type || '';
      if (vt === 'color' && !line.color_id && !line.labdip_variant_code) {
          return 'This is a color item — pick an approved color code or a pending lab dip code.';
      }
      if (vt === 'combo' && comboAttr) {
          const hasCombo = (line.attribute_value_ids || []).some((vid: string) => comboAttr.values?.some((v: any) => v.id === vid));
          if (!hasCombo) return 'This is a combo item — select a Combo before adding the line.';
      }
      return null;
  };

  const handleValueChange = (valId: string, attrId: string) => {
      const attr = attributes.find((a: any) => a.id === attrId);
      if (!attr) return;
      const otherValues = newLine.attribute_value_ids.filter(vid => !attr.values.some((v: any) => v.id === vid));
      const newAttrValues = valId ? [...otherValues, valId] : otherValues;
      // Changing Combo invalidates the current BOM selection; auto-pick if only one matches
      const comboChanged = comboAttr && comboAttr.id === attrId;
      let bomOverride: { bom_id?: string; size_token?: string; size_id?: string; size_label?: string; bom_size_id?: string } = {};
      if (comboChanged) {
          const filteredBoms = getItemBoms(newLine.item_id, newAttrValues);
          bomOverride = {
              bom_id: filteredBoms.length === 1 ? filteredBoms[0].id : '',
              size_token: '', size_id: '', size_label: '', bom_size_id: '',
          };
      }
      setNewLine({ ...newLine, attribute_value_ids: newAttrValues, ...bomOverride });
  };

  // The item picker is a server-side, finished-goods-scoped typeahead (itemResults + onSearchItems),
  // so it scales past any client-side cap. Accumulate every item seen (the context page plus each
  // search page) into a cache so the creation modal's weight / attribute / BOM lookups keep
  // resolving items that fall outside the current search page.
  const [itemCache, setItemCache] = useState<Record<string, any>>({});
  useEffect(() => {
      const merge = (arr: any[]) => {
          if (!arr?.length) return;
          setItemCache(prev => { const n = { ...prev }; for (const it of arr) n[it.id] = it; return n; });
      };
      merge(items); merge(itemResults);
  }, [items, itemResults]);
  const resolveItem = (id: string) =>
      itemCache[id] || (items || []).find((i: any) => i.id === id) || (itemResults || []).find((i: any) => i.id === id);

  const getItemWeight = (id: string) => resolveItem(id)?.weight_per_unit ?? null;
  const getItemWeightUnit = (id: string): string => resolveItem(id)?.weight_unit ?? '';

  // Only g/y and g/m can auto-calculate KG from a length qty alone.
  // gsm / g/m² require fabric width, so auto-calc is disabled for those.
  const isAutoCalcSupported = (id: string) => {
      const w = getItemWeight(id);
      const unit = getItemWeightUnit(id);
      return !!w && (unit === 'g/y' || unit === 'g/m');
  };

  const calcKgAuto = (id: string, yd: number, m: number): string | null => {
      const w = getItemWeight(id);
      const unit = getItemWeightUnit(id);
      if (!w || yd <= 0) return null;
      if (unit === 'g/y') return String(Math.round(w * yd / 1000 * 1000) / 1000);
      if (unit === 'g/m' && m > 0) return String(Math.round(w * m / 1000 * 1000) / 1000);
      return null;
  };

  const calcYdFromKg = (id: string, kg: number): { yd: number; m: number } | null => {
      const w = getItemWeight(id);
      const unit = getItemWeightUnit(id);
      if (!w || kg <= 0) return null;
      if (unit === 'g/y') {
          const yd = Math.round(kg * 1000 / w * 100) / 100;
          const m = Math.round(yd * 0.9144 * 100) / 100;
          return { yd, m };
      }
      if (unit === 'g/m') {
          const m = Math.round(kg * 1000 / w * 100) / 100;
          const yd = Math.round(m / 0.9144 * 100) / 100;
          return { yd, m };
      }
      return null;
  };

  const handleLineItemChange = (val: string) => {
      const m = parseFloat(qtyMeter) || 0;
      const kg = kgAuto ? calcKgAuto(val, newLine.qty, m) : null;
      // Item change resets attributes, so no Combo filter yet — show all BOMs for item
      const itemBoms = (boms || []).filter((b: any) => b.item_id === val);
      const autoBomId = itemBoms.length === 1 ? itemBoms[0].id : '';
      setNewLine({ ...newLine, item_id: val, attribute_value_ids: [], bom_id: autoBomId, size_token: '', size_id: '', size_label: '', bom_size_id: '', color_id: '', color_label: '', color_hex: '', labdip_variant_code: '', labdip_item_id: '', labdip_label: '', no_color_swatch: false, qty_kg: kg !== null ? kg : newLine.qty_kg });
  };

  // Combo (system_role='combo') gates BOM selection: if a Combo value is chosen on
  // the SO line, only BOMs that carry that same Combo attribute value are shown.
  // All other attributes (e.g. Colors) remain annotations and do not filter BOMs.
  const getItemBoms = (itemId: string, attrValueIds: string[] = []) => {
      if (!boms || !itemId) return [];
      const forItem = boms.filter((b: any) => b.item_id === itemId);
      if (!comboAttr) return forItem;
      const comboValueId = attrValueIds.find(vid => comboAttr.values?.some((v: any) => v.id === vid));
      if (!comboValueId) return forItem;
      return forItem.filter((b: any) => (b.attribute_value_ids || []).map(String).includes(String(comboValueId)));
  };

  // The size NAME (S/M/L/…) stays text in the cell, the measurement rides under
  // it as a chip so the two read apart.
  const formatBomSizeMeasurement = (bs: any): string => {
      if (bs.measurement_min != null && bs.measurement_max != null) {
          return `${parseFloat(bs.measurement_min)} cm - ${parseFloat(bs.measurement_max)} cm`;
      }
      if (bs.target_measurement != null) return `${parseFloat(bs.target_measurement)} cm`;
      return '';
  };

  // ── Size, stated without a recipe ───────────────────────────────────────────
  // Sizes physically live on BOMSize rows, so a size list used to require a BOM
  // pick first — which is exactly what forced sales to choose the recipe. The
  // options here are the UNION of every candidate BOM's sizes, folded by size
  // name (the identity netting and lot snapshots already key on), so the list
  // shows with no BOM chosen and the PR resolves the name against whichever BOM
  // the planner picks. Measurement rides along only when every candidate agrees
  // on it — two BOMs can call the same size 60 cm and 67 cm, and the honest
  // answer before the recipe is known is to show neither.
  const sizeToken = (bs: any): string =>
      String(bs?.size_name || bs?.size?.name || bs?.label || '').trim().toLowerCase();

  const getSizeOptions = (itemId: string, bomId: string, attrValueIds: string[] = []) => {
      const candidates = getItemBoms(itemId, attrValueIds);
      // A retired recipe must not contribute a phantom size to the union. An
      // explicit pick is honoured either way — an old line may name one.
      const scope = bomId
          ? boms.filter((b: any) => b.id === bomId)
          : candidates.filter((b: any) => b.active !== false);
      const byToken = new Map<string, any>();
      // Measurement-only free sizes (157 cm, no name) carry no identity a second
      // BOM could share, so they cannot be offered before the recipe is known —
      // they stay on the legacy per-BOM pointer and appear only once one BOM owns
      // the choice.
      const nameless: any[] = [];
      for (const bom of scope) {
          for (const bs of (bom.sizes || [])) {
              const measurement = formatBomSizeMeasurement(bs);
              const token = sizeToken(bs);
              if (!token) {
                  if (scope.length === 1 && measurement) {
                      nameless.push({
                          value: `bs:${bs.id}`,
                          bom_size_id: bs.id,
                          token: '',
                          name: measurement,
                          measurement: '',
                          sort_order: bs.sort_order ?? 0,
                      });
                  }
                  continue;
              }
              const existing = byToken.get(token);
              if (!existing) {
                  byToken.set(token, {
                      value: token,
                      token,
                      name: bs.size_name || bs.size?.name || bs.label || token,
                      size_id: bs.size_id || '',
                      // Free-mode BOMs have no Size master row; the label IS the
                      // identity, so it is what the line stores.
                      size_label: bs.size_id ? '' : (bs.label || ''),
                      measurement,
                      sort_order: bs.sort_order ?? bs.size?.sort_order ?? 0,
                  });
                  continue;
              }
              if (existing.measurement !== measurement) existing.measurement = '';
              if (!existing.size_id && bs.size_id) existing.size_id = bs.size_id;
          }
      }
      return [...byToken.values(), ...nameless]
          .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
  };

  // What an already-saved line's size reads as. `size_display` is resolved
  // server-side (generic pick first, legacy BOMSize pointer second); the
  // measurement is only knowable once a single BOM owns the line.
  const findBomSize = (bomSizeId: string) => {
      for (const bom of boms) {
          const bs = (bom.sizes || []).find((x: any) => x.id === bomSizeId);
          if (bs) return bs;
      }
      return null;
  };

  const getLineSizeParts = (line: any): { name: string; measurement: string } => {
      const name = line.size_display || '';
      if (!name) {
          // Nameless (measurement-only) size: the legacy pointer is the only
          // thing that identifies it, and the measurement is its label.
          const bs = line.bom_size_id ? findBomSize(line.bom_size_id) : null;
          return bs ? { name: formatBomSizeMeasurement(bs), measurement: '' } : { name: '', measurement: '' };
      }
      const scope = line.bom_id ? boms.filter((b: any) => b.id === line.bom_id) : [];
      for (const bom of scope) {
          const bs = (bom.sizes || []).find((x: any) => sizeToken(x) === name.trim().toLowerCase());
          if (bs) return { name, measurement: formatBomSizeMeasurement(bs) };
      }
      return { name, measurement: '' };
  };

  // ── Dual-UoM lock ───────────────────────────────────────────────────────────
  // Base qty (Yd) and the alt count are two views of ONE number, joined by the
  // factor off the UOM master. Whichever side is typed, the other follows —
  // otherwise a line reads "600 Yd" beside "6 Gross x144 Yd = 864 Yd", which is
  // self-contradictory, and nothing downstream can tell which figure was ordered.
  // The factor's target unit is not on the SO line, so it is resolved by value.
  const ydPerAlt = (uom2: string, factorVal: number | null): number | null => {
      if (!factorVal || !uom2) return null;
      const uomObj = (uoms || []).find((u: any) => u.name === uom2);
      const factorObj = (uomObj?.factors || []).find((f: any) => parseFloat(f.value) === factorVal);
      const toUnit = (factorObj?.to_uom_name || '').toLowerCase();
      const yd = toUnit === 'm' || toUnit === 'meter' ? factorVal / 0.9144 : factorVal;
      return yd > 0 ? yd : null;
  };

  // The alt count a base qty works out to. `undefined` means "this line has no
  // resolvable factor" — leave qty2 untouched rather than blanking a free-text alt
  // (the "600 yard" lines carry a unit with no factor and must survive a qty edit).
  const altCountForYd = (uom2: string, factorVal: number | null, yd: number): string | undefined => {
      const per = ydPerAlt(uom2, factorVal);
      if (!per) return undefined;
      if (yd <= 0) return '';
      return String(Math.round(yd / per * 10000) / 10000);
  };

  const handleQtyYardChange = (ydStr: string) => {
      const yd = parseFloat(ydStr) || 0;
      const m = yd > 0 ? Math.round(yd * 0.9144 * 100) / 100 : 0;
      const gross = yd > 0 ? Math.round(yd / 144 * 10000) / 10000 : 0;
      setQtyMeter(m > 0 ? String(m) : '');
      setQtyGrossYd(gross > 0 ? String(gross) : '');
      const kg = kgAuto ? calcKgAuto(newLine.item_id, yd, m) : null;
      const alt = altCountForYd(newLine.uom2, newLine.uom2_factor, yd);
      setNewLine({ ...newLine, qty: yd, qty_kg: kg !== null ? kg : newLine.qty_kg, ...(alt !== undefined ? { qty2: alt } : {}) });
  };

  const handleQtyMeterChange = (mStr: string) => {
      setQtyMeter(mStr);
      const m = parseFloat(mStr) || 0;
      const yd = m > 0 ? Math.round(m / 0.9144 * 100) / 100 : 0;
      const gross = yd > 0 ? Math.round(yd / 144 * 10000) / 10000 : 0;
      setQtyGrossYd(gross > 0 ? String(gross) : '');
      const kg = kgAuto ? calcKgAuto(newLine.item_id, yd, m) : null;
      const alt = altCountForYd(newLine.uom2, newLine.uom2_factor, yd);
      setNewLine({ ...newLine, qty: yd, qty_kg: kg !== null ? kg : newLine.qty_kg, ...(alt !== undefined ? { qty2: alt } : {}) });
  };

  const handleQtyGrossYdChange = (grossStr: string) => {
      setQtyGrossYd(grossStr);
      const gross = parseFloat(grossStr) || 0;
      const yd = gross > 0 ? Math.round(gross * 144 * 100) / 100 : 0;
      const m = yd > 0 ? Math.round(yd * 0.9144 * 100) / 100 : 0;
      setQtyMeter(m > 0 ? String(m) : '');
      const kg = kgAuto ? calcKgAuto(newLine.item_id, yd, m) : null;
      const alt = altCountForYd(newLine.uom2, newLine.uom2_factor, yd);
      setNewLine({ ...newLine, qty: yd, qty_kg: kg !== null ? kg : newLine.qty_kg, ...(alt !== undefined ? { qty2: alt } : {}) });
  };

  const toggleKgAuto = () => {
      const newAuto = !kgAuto;
      setKgAuto(newAuto);
      if (newAuto) {
          const m = parseFloat(qtyMeter) || 0;
          const kg = calcKgAuto(newLine.item_id, newLine.qty, m);
          if (kg !== null) setNewLine(prev => ({ ...prev, qty_kg: kg }));
      }
  };

  const handleQtyKgChange = (kgStr: string) => {
      setNewLine(prev => ({ ...prev, qty_kg: kgStr }));
      if (!kgAuto) return;
      const kg = parseFloat(kgStr) || 0;
      const result = calcYdFromKg(newLine.item_id, kg);
      if (!result) return;
      const { yd, m } = result;
      const gross = yd > 0 ? Math.round(yd / 144 * 10000) / 10000 : 0;
      setQtyMeter(m > 0 ? String(m) : '');
      setQtyGrossYd(gross > 0 ? String(gross) : '');
      setNewLine(prev => {
          const alt = altCountForYd(prev.uom2, prev.uom2_factor, yd);
          return { ...prev, qty_kg: kgStr, qty: yd, ...(alt !== undefined ? { qty2: alt } : {}) };
      });
  };

  // qty2 x factor -> Yd. The factor's target unit lives on the UOM master, not on
  // the line, so it is resolved by value. Shared with the in-place line editor.
  const deriveFromAlt = (uom2: string, qty2: number, factorVal: number | null): { yd: number; m: number } | null => {
      const per = ydPerAlt(uom2, factorVal);
      if (!per || qty2 <= 0) return null;
      const yd = Math.round(qty2 * per * 100) / 100;
      return { yd, m: Math.round(yd * 0.9144 * 100) / 100 };
  };

  const applyFactor = (qty2Str: string, factorVal: number | null) => {
      const conv = deriveFromAlt(newLine.uom2, parseFloat(qty2Str as string) || 0, factorVal);
      if (!conv) return;
      const { yd, m } = conv;
      const gross = Math.round(yd / 144 * 10000) / 10000;
      setQtyMeter(m > 0 ? String(m) : '');
      setQtyGrossYd(gross > 0 ? String(gross) : '');
      const kg = kgAuto ? calcKgAuto(newLine.item_id, yd, m) : null;
      setNewLine(prev => ({ ...prev, qty: yd, qty_kg: kg !== null ? kg : prev.qty_kg }));
  };

  // Alt Unit table cell echoes the conversion the line was entered with (qty2 × factor → Yd).
  // The factor's target unit lives on the UOM master, not on the SO line, so resolve it by value.
  const describeUom2 = (line: any): { chip: string; total: string | null; drift: number | null } | null => {
      const factor = line?.uom2_factor != null && line.uom2_factor !== '' ? parseFloat(line.uom2_factor) : null;
      if (!factor || !line?.uom2) return null;
      const qty2 = parseFloat(line.qty2) || 0;
      const uomObj = (uoms || []).find((u: any) => u.name === line.uom2);
      const factorObj = (uomObj?.factors || []).find((f: any) => parseFloat(f.value) === factor);
      const toUnit = (factorObj?.to_uom_name || 'yard').toLowerCase();
      const isMeter = toUnit === 'm' || toUnit === 'meter';
      const totalYd = qty2 > 0
          ? Math.round((isMeter ? qty2 * factor / 0.9144 : qty2 * factor) * 100) / 100
          : null;
      // Rows saved before the two sides were locked together can disagree — the cell
      // would otherwise claim "= 864 Yd" next to a 600 Yd qty. Surface it instead of
      // silently rewriting order history: only a human knows which figure was ordered.
      const baseQty = parseFloat(line?.qty) || 0;
      const drift = totalYd !== null && baseQty > 0 && Math.abs(totalYd - baseQty) > 0.05
          ? Math.round((totalYd - baseQty) * 100) / 100
          : null;
      return { chip: `×${factor} ${isMeter ? 'm' : 'Yd'}`, total: totalYd !== null ? `${totalYd} Yd` : null, drift };
  };

  const handleQty2Change = (val: string) => {
      setNewLine(prev => ({ ...prev, qty2: val }));
      applyFactor(val, newLine.uom2_factor);
  };

  const handleUom2FactorChange = (factorStr: string) => {
      const factorVal = factorStr ? parseFloat(factorStr) : null;
      setNewLine(prev => ({ ...prev, uom2_factor: factorVal }));
      applyFactor(newLine.qty2, factorVal);
  };

  const resetForm = () => {
      setNewSO({ po_number: '', customer_po_ref: '', customer_name: '', order_date: new Date().toISOString().split('T')[0], lines: [] });
      setLastDeliveryDates({ due_date: '', internal_confirmation_date: '' });
      setNewLine({ item_id: '', qty: 0, due_date: '', attribute_value_ids: [], ket_stock: '', internal_confirmation_date: '', qty_kg: '', qty2: '', uom2: '', uom2_factor: null, bom_id: '', size_token: '', size_id: '', size_label: '', bom_size_id: '', color_id: '', color_label: '', color_hex: '', labdip_variant_code: '', labdip_item_id: '', labdip_label: '', no_color_swatch: false });
      setQtyMeter('');
      setQtyGrossYd('');
      setKgAuto(true);
  };

  const handleEditOpen = (so: any) => {
      setEditingSOId(so.id);
      setNewSO({
          po_number: so.po_number,
          customer_po_ref: so.customer_po_ref || '',
          customer_name: so.customer_name,
          order_date: so.order_date ? so.order_date.split('T')[0] : new Date().toISOString().split('T')[0],
          lines: (so.lines || []).map((l: any) => ({
              item_id: l.item_id,
              qty: l.qty,
              due_date: l.due_date ? l.due_date.split('T')[0] : '',
              internal_confirmation_date: l.internal_confirmation_date ? l.internal_confirmation_date.split('T')[0] : '',
              ket_stock: l.ket_stock || '',
              qty_kg: l.qty_kg != null ? String(l.qty_kg) : '',
              qty2: l.qty2 != null ? String(l.qty2) : '',
              uom2: l.uom2 || '',
              uom2_factor: l.uom2_factor ?? null,
              bom_id: l.bom_id || '',
              // `size_display` is the server's resolution of either shape, so it
              // rehydrates a legacy bom_size_id line as the same token.
              size_token: String(l.size_display || '').trim().toLowerCase(),
              size_id: l.size_id || '',
              size_label: l.size_id ? '' : (l.size_label || l.size_display || ''),
              bom_size_id: l.bom_size_id || '',
              attribute_value_ids: l.attribute_value_ids || [],
              color_id: l.color_id || '',
              color_label: colorLabel(l.color_code, l.color_name),
              color_hex: l.color_hex || '',
              labdip_variant_code: l.labdip_variant_code || '',
              labdip_item_id: l.labdip_item_id || '',
              labdip_label: l.labdip_variant_code ? `${l.labdip_variant_code}${l.labdip_status ? ' · ' + l.labdip_status : ''}` : '',
              no_color_swatch: !!l.no_color_swatch,
          })),
      });
      setLastDeliveryDates({ due_date: '', internal_confirmation_date: '' });
      setIsCreateOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      // Re-check every line, not just the one being typed: edit mode loads lines
      // saved before this gate existed, and an item's variant_type can change.
      for (let i = 0; i < newSO.lines.length; i++) {
          const err = variantGateError(newSO.lines[i]);
          if (err) { showToast(`Line ${i + 1} (${getItemCode(newSO.lines[i].item_id, newSO.lines[i].item_code)}): ${err}`, 'warning'); return; }
      }
      const payload = {
          ...newSO,
          customer_po_ref: newSO.customer_po_ref || null,
          order_date: newSO.order_date || null,
          lines: newSO.lines.map((line: any) => {
              const { color_label, color_hex, labdip_label, size_token, size_display, ...rest } = line;
              return {
                  ...rest,
                  due_date: line.due_date || null,
                  internal_confirmation_date: line.internal_confirmation_date || null,
                  qty_kg: line.qty_kg !== '' ? parseFloat(line.qty_kg) || null : null,
                  qty2: line.qty2 !== '' ? parseFloat(line.qty2) || null : null,
                  size_id: line.size_id || null,
                  size_label: line.size_id ? null : (line.size_label || null),
                  bom_size_id: line.bom_size_id || null,
                  color_id: line.color_id || null,
                  labdip_variant_code: line.labdip_variant_code || null,
                  labdip_item_id: line.labdip_item_id || null,
                  no_color_swatch: !!line.no_color_swatch,
              };
          })
      };

      if (editingSOId) {
          const res = await onEditSO(editingSOId, payload);
          if (res && res.ok) {
              setEditingSOId(null);
              resetForm();
              setIsCreateOpen(false);
              showToast('Sales Order updated successfully', 'success');
          } else if (res) {
              const err = await res.json();
              showToast(`Error: ${err.detail}`, 'danger');
          }
          return;
      }

      const res = await onCreateSO(payload);
      if (res && res.status === 400) {
          let basePO = newSO.po_number;
          const baseMatch = basePO.match(/^(.*)-(\d+)$/);
          if (baseMatch) basePO = baseMatch[1];
          let counter = 1;
          let suggestedPO = `${basePO}-${counter}`;
          while (salesOrders.some((s: any) => s.po_number === suggestedPO)) { counter++; suggestedPO = `${basePO}-${counter}`; }
          showToast(`PO# "${newSO.po_number}" already exists. Suggesting: ${suggestedPO}`, 'warning');
          setNewSO({ ...newSO, po_number: suggestedPO });
      } else if (res && res.ok) {
          setNewSO({ po_number: '', customer_po_ref: '', customer_name: '', order_date: new Date().toISOString().split('T')[0], lines: [] });
          setLastDeliveryDates({ due_date: '', internal_confirmation_date: '' });
          setIsCreateOpen(false);
          showToast('Sales Order created successfully', 'success');
      }
  };

  const getItemName = (id: string, embedded?: string) => resolveItem(id)?.name || embedded || itemIndex?.[String(id)]?.name || id;
  const getItemCode = (id: string, embedded?: string) => resolveItem(id)?.code || embedded || itemIndex?.[String(id)]?.code || id;
  const isSample = (id: string) => resolveItem(id)?.category === 'Sample';

  const { formatDate: tzDate, formatCustom: tzFmt } = useTimezone();

  const formatDate = (date: string | null) => {
      if (!date) return '—';
      return tzDate(date);
  };

  const formatShortDate = (date: string | null | undefined) => {
      if (!date) return '';
      try {
          return tzFmt(date, { day: '2-digit', month: '2-digit' }, 'en-GB');
      } catch { return ''; }
  };

  // Variant picker source is driven by the finished-good's variant_type:
  //   'combo' -> the Combo attribute dropdown (gates BOM, unchanged)
  //   'color' -> BOTH the Color Library typeahead (color_id, drives dyeing recipe match)
  //              AND the registered Colors attribute dropdown (attribute_value_ids,
  //              the actual product variant — e.g. Item-A-Black-318)
  //   null    -> no variant picker
  const currentItem = resolveItem(newLine.item_id);
  const currentVariantType: string = currentItem?.variant_type || '';
  const currentBoundAttrs = currentVariantType === 'combo' && comboAttr ? [comboAttr]
      : currentVariantType === 'color' && colorAttr ? [colorAttr]
      : [];

  // Variant gate on the line being composed — greys out Add Line and says why.
  const newLineVariantErr = newLine.item_id ? variantGateError(newLine) : null;
  const addLineDisabled = !newLine.item_id || newLine.qty <= 0 || !!newLineVariantErr;
  const addLineTitle = !newLine.item_id ? 'Select an item first'
      : newLine.qty <= 0 ? 'Enter Qty (Yd) first'
      : newLineVariantErr || 'Add item to order';

  // Color Library typeahead — server-side search (30k+ shades can't be client-cached).
  useEffect(() => {
      if (currentVariantType !== 'color') { setColorResults([]); return; }
      const q = colorSearch.trim();
      const h = setTimeout(async () => {
          try {
              const res = await authFetch(`${LINEAGE_API_BASE}/colors?search=${encodeURIComponent(q)}&size=20`);
              if (res.ok) {
                  const data = await res.json();
                  setColorResults(Array.isArray(data) ? data : (data.items || []));
              }
          } catch { /* transient */ }
      }, 300);
      return () => clearTimeout(h);
  }, [colorSearch, currentVariantType]);

  // Pending lab dip shades for the selected item — orderable before approval.
  useEffect(() => {
      if (currentVariantType !== 'color' || !newLine.item_id) { setLabdipResults([]); return; }
      let cancelled = false;
      (async () => {
          try {
              const res = await authFetch(`${LINEAGE_API_BASE}/lab-dips/pending-variants?item_id=${encodeURIComponent(newLine.item_id)}`);
              if (res.ok && !cancelled) setLabdipResults(await res.json());
          } catch { /* transient */ }
      })();
      return () => { cancelled = true; };
  }, [newLine.item_id, currentVariantType]);

  const selectColor = (c: any) => {
      // Approved shade clears any pending lab dip selection (mutually exclusive).
      setNewLine(prev => ({ ...prev, color_id: c.id, color_label: colorLabel(c.code, c.name), color_hex: c.hex || '', labdip_variant_code: '', labdip_item_id: '', labdip_label: '' }));
      setColorSearch('');
      setColorResults([]);
  };
  const clearColor = () => setNewLine(prev => ({ ...prev, color_id: '', color_label: '', color_hex: '' }));

  const selectLabdip = (v: any) => {
      // Pending shade clears any approved color (mutually exclusive).
      setNewLine(prev => ({ ...prev, labdip_variant_code: v.variant_code, labdip_item_id: v.labdip_item_id, labdip_label: `${v.variant_code} (${v.request_code || 'lab dip'} · ${v.status})`, color_id: '', color_label: '', color_hex: '' }));
      setColorSearch('');
      setColorResults([]);
  };
  const clearLabdip = () => setNewLine(prev => ({ ...prev, labdip_variant_code: '', labdip_item_id: '', labdip_label: '' }));

  const getAttributeValueName = (valId: string) => {
      for (const attr of attributes) {
          const val = attr.values.find((v: any) => v.id === valId);
          if (val) return val.value;
      }
      return valId;
  };

  const getAttributeValueHex = (valId: string): string | null => {
      for (const attr of attributes) {
          const val = attr.values?.find((v: any) => v.id === valId);
          if (val) return val.hex || null;
      }
      return null;
  };

  // Splits a line's attribute_value_ids into "registered color variant" chips
  // (the Colors-attribute value, e.g. Black-318) vs plain-text attrs (size, etc.),
  // and builds a matching chip for the Color Library code if present.
  // A pending lab dip code is the line's colour identity until approval backfills
  // color_id, so it renders as a chip in the same row (amber) instead of vanishing.
  const buildVariantChips = (attrIds: string[], colorLabel?: string | null, colorHex?: string | null, pendingLabdip?: string | null) => {
      const colorValId = colorAttr ? attrIds.find(vid => colorAttr.values?.some((v: any) => v.id === vid)) : undefined;
      // Combo is a variant identity, not a loose attribute — it gates BOM choice, so
      // it reads as a chip alongside colour rather than in the italic attribute line.
      const comboValId = comboAttr ? attrIds.find(vid => comboAttr.values?.some((v: any) => v.id === vid)) : undefined;
      const plainIds = attrIds.filter(vid => vid !== colorValId && vid !== comboValId);
      const chips: { label: string; hex: string | null; kind: VariantKind; icon?: string | null }[] = [];
      if (colorValId) chips.push({ label: getAttributeValueName(colorValId), hex: getAttributeValueHex(colorValId), kind: 'color' });
      if (colorLabel) chips.push({ label: colorLabel, hex: colorHex || null, kind: 'color' });
      else if (pendingLabdip) chips.push({ label: pendingLabdip, hex: null, kind: 'pending' });
      if (comboValId) chips.push({ label: getAttributeValueName(comboValId), hex: null, kind: 'combo' });
      return { chips, plainIds };
  };

  // Shade / combo / size chips are VariantChips like everywhere else, so a shade
  // reads pink and a combo violet here too instead of landing in the neutral
  // default this row used to draw.
  // The Item column is a fixed width (`tableLayout: fixed`), so a long combo name
  // used to run the chip out past the cell's right edge into its neighbour. Chips
  // clip to the cell instead; the full label stays on the tooltip.
  const renderChipRow = (chips: { label: string; hex: string | null; kind: VariantKind; icon?: string | null }[]) => (
      <div style={{display:'flex',flexWrap:'wrap' as const,gap:4,marginTop:2,minWidth:0,maxWidth:'100%'}}>
          {chips.map((c, i) => (
              <VariantChip key={i} kind={c.kind} classic={classic}
                  title={c.kind === 'pending' ? 'Pending lab dip — colour not approved yet' : `${c.label}`}
                  icon={c.icon}
                  swatch={c.hex}
                  truncate
              >{c.label}</VariantChip>
          ))}
      </div>
  );

  // --- Per-line fulfilment (derived server-side by so_fulfilment_service) ---
  // made >= packed >= in-stock/shipped, so the three are drawn as nested stages on
  // one track rather than stacked segments — they are not additive.
  //
  // MEASURED IN THE ALT SELLING UNIT whenever the line carries one. The customer
  // ordered 2880 Pcs and is owed 2880 Pcs; the kilos are what stock happens to
  // move in, and reading a bar in them answers a question nobody asked. It is also
  // the only honest denominator for cloth that does not hold its estimated g/y —
  // the packer reweighs every box, so a physically complete order reads 97% in kg
  // forever. Same rule `packing_service.is_target_met` applies one tier down.
  //
  // The base pair is the fallback, and its own denominator is `qty_ordered_base`,
  // NOT `line.qty`: those numbers are in the item's stock UoM (kg for most FG)
  // while `qty` is the yardage the order was keyed in. Dividing by `qty` showed an
  // 11 kg shipment of a 10 kg order as "11 / 10000" — 0.1% instead of complete.
  // Either denominator is null when it can't be derived (weight-stocked item with
  // no weight-per-yard); that is unknown, not zero, so the bar is withheld rather
  // than drawn empty.
  const lineFulfilment = (line: any) => {
      // An alt reading needs the count AND every stage counted in it — the server
      // sends null, not 0, for a stage it could not count, and mixing one counted
      // stage with three converted ones would draw a bar out of two units.
      const altOrdered = line.qty_ordered_alt;
      const altStages = [line.qty_made_alt, line.qty_packed_alt, line.qty_packed_available_alt, line.qty_dispatched_alt];
      const useAlt = altOrdered != null && Number(altOrdered) > 0 && altStages.every(v => v != null);
      const base = useAlt ? altOrdered : line.qty_ordered_base;
      const ordered = base == null ? null : Number(base) || 0;
      const uom = (useAlt ? line.alt_uom : line.base_uom) || '';
      const made = Number(useAlt ? line.qty_made_alt : line.qty_made) || 0;
      const packed = Number(useAlt ? line.qty_packed_alt : line.qty_packed) || 0;
      const available = Number(useAlt ? line.qty_packed_available_alt : line.qty_packed_available) || 0;
      const shipped = Number(useAlt ? line.qty_dispatched_alt : line.qty_dispatched) || 0;
      const pct = (v: number) => (ordered && ordered > 0 ? Math.min(100, Math.round((v / ordered) * 100)) : 0);
      return { ordered, uom, made, packed, available, shipped, pct, isAlt: useAlt,
          // The kilos still travel, for the tooltip's second line: the planner
          // reading a piece count still has to know what leaves the warehouse.
          baseOrdered: line.qty_ordered_base == null ? null : Number(line.qty_ordered_base) || 0,
          baseUom: line.base_uom || '',
          baseShipped: Number(line.qty_dispatched) || 0,
          baseAvailable: Number(line.qty_packed_available) || 0,
          // Shippable = cartons actually in stock. Dispatched stock has left, so a
          // shipped line reads complete off `shipped`, not off what remains.
          isReady: !!ordered && ordered > 0 && (available >= ordered - 0.0001 || shipped >= ordered - 0.0001) };
  };

  const isLineLate = (line: any) => {
      if (!line.due_date) return false;
      const f = lineFulfilment(line);
      if (f.isReady) return false;
      const due = new Date(line.due_date);
      return !isNaN(due.getTime()) && due.getTime() < Date.now();
  };

  // Pro-rata `made` splits produce values like 1.6666666666666665 — clamp the
  // display to 2dp and drop trailing zeros so whole numbers stay whole.
  const fmtQty = (v: number) => (Math.round(v * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

  const fulfilmentCell = (line: any) => {
      const f = lineFulfilment(line);
      if (f.ordered == null) {
          // Weight-stocked item with no weight-per-yard: say so instead of drawing
          // a 0% bar, since the fix is to fill in the item master.
          return (
              <span title={t('so_no_weight_hint')} style={{ fontFamily:xpFont, fontSize:'9px', color:'#8a6d00', display:'inline-flex', alignItems:'center', gap:3 }}>
                  <i className="bi bi-exclamation-triangle" style={{ fontSize:'8px' }}></i>{t('so_no_weight')}
              </span>
          );
      }
      if (f.ordered <= 0) return <span style={{ fontFamily:xpFont, fontSize:'9px', color:'#ccc' }}>—</span>;
      const u = f.uom ? ` ${f.uom}` : '';
      const bu = f.baseUom ? ` ${f.baseUom}` : '';
      const title = `Made ${fmtQty(f.made)} · Packed ${fmtQty(f.packed)} · In stock ${fmtQty(f.available)} · Shipped ${fmtQty(f.shipped)} — of ${fmtQty(f.ordered)}${u} ordered`
          // Second line only when the bar is in pieces: the kilos are then a
          // different unit from everything above, and the picker still moves them.
          + (f.isAlt && f.baseOrdered != null
              ? `
In stock ${fmtQty(f.baseAvailable)}${bu} · Shipped ${fmtQty(f.baseShipped)}${bu} — of ${fmtQty(f.baseOrdered)}${bu}`
              : '');
      // shipped/packed/made nest (shipped<=packed<=made), so drawn as one stacked
      // bar: green=shipped, blue=packed-not-yet-shipped, gray=made-not-yet-packed.
      const shippedPct = f.pct(f.shipped);
      const packedPct = f.pct(f.packed);
      const madePct = f.pct(f.made);
      return (
          <div title={title} style={{ display:'flex', flexDirection:'column', gap:2, minWidth:78 }}>
              <ProgressBar
                  pct={shippedPct} tone="green"
                  secondaryPct={Math.max(0, packedPct - shippedPct)} secondaryTone="blue"
                  tertiaryPct={Math.max(0, madePct - packedPct)} tertiaryTone="gray"
                  height={6}
              />
              <div style={{ fontFamily:xpFont, fontSize:'9px', color: f.isReady ? (classic ? '#1a5e1a' : '#166534') : '#777' }}>
                  {f.shipped > 0
                      ? `${fmtQty(f.shipped)}${u} shipped`
                      : f.packed > 0
                          ? `${fmtQty(f.available)}${u} packed`
                          : f.made > 0 ? `${fmtQty(f.made)}${u} made` : 'not started'}
              </div>
          </div>
      );
  };

  // --- Per-line production output (derived server-side by so_fulfilment_service) ---
  // How much has been PRODUCED for this line — finished goods AND the components
  // pegged behind them (greige, warp beams) — against Fulfilment's how much has
  // been packed and shipped.
  //
  // The bar is `mp.pct`: one share per BOM level, so four warp beams don't outvote
  // the greige and the finished goods simply by being four rows. Component
  // coverage is measured against the qty THIS order needs of a shared MO, which is
  // why a beam planned for 269 kg can read complete for an order needing 4 kg.
  //
  // The qty line under it stays finished-goods only, and its numerator is
  // `qty_made` (the fulfilment peg) rather than mo_progress's own `made`: on an
  // ambiguous peg — two lines, same item + recipe + size + shade — only
  // `fulfilment_map` splits produced qty pro-rata, so reading the MO-side figure
  // would promise the same output to both lines. Progress fractions are safe to
  // share that way; quantities are not.
  //
  // This column used to count completed work orders. WOs are manual floor dispatch
  // decisions, so that denominator was authored after the fact and the bar ran
  // backwards when a step was added late; it also had no value between 0 and 100
  // for the (common) MO carrying no WOs. Steps survive as the stage line below.
  const moProgressCell = (line: any) => {
      const mp = line.mo_progress;
      // No MO yet is not 0% done — say nothing rather than draw an empty bar.
      if (!mp || !mp.mo_count) {
          return <span style={{ fontFamily:xpFont, fontSize:'9px', color:'#ccc' }} title="No manufacturing order for this line yet">—</span>;
      }
      const f = lineFulfilment(line);
      const u = f.uom ? ` ${f.uom}` : '';
      // MO-side quantities (`mp.mo_qty`, `m.made`) are always in the item's stock
      // UoM — an MO is planned in kg however the customer counts — so they must
      // never be labelled with `u`, which is the alt unit whenever the line has
      // one. Only the `f.*` pair below follows the bar's unit.
      const bu = f.baseUom ? ` ${f.baseUom}` : '';
      // Ordered qty is the denominator the client reads for finished goods ("how
      // much of my order exists"). It is null for a weight-stocked item with no
      // weight-per-yard on its master, so fall back to the MOs' own planned qty.
      const againstLine = f.ordered != null && f.ordered > 0;
      const outQty = againstLine
          ? `${fmtQty(f.made)} / ${fmtQty(f.ordered)}${u}`
          : mp.mo_qty > 0 ? `${fmtQty(mp.made)} / ${fmtQty(mp.mo_qty)}${bu}` : null;
      const pct = mp.pct;
      const shipped = f.pct(f.made) >= 100;
      // Naming the blocking component only reads true for a single-MO line: the
      // counts on the line below are summed across every MO answering it.
      const comps: any[] = mp.mo_count === 1 && mp.mos && mp.mos.length ? (mp.mos[0].components || []) : [];
      const stepLine = (st: any) => `  ${st.status === 'COMPLETED' ? '✓' : st.status === 'IN_PROGRESS' ? '▶' : '·'} ${st.stage || st.name || st.code || ''}`;
      const compLine = (c: any) => `  ${c.pct >= 100 ? '✓' : c.pct > 0 ? '▶' : '·'} ${c.mo_code} — ${fmtQty(c.made)} / ${fmtQty(c.need)} (${c.pct}%)`;
      const title = [
          ...(mp.mos || []).map((m: any) => {
              const head = `${m.mo_code} (${m.mo_status}) — ${fmtQty(m.made)} / ${fmtQty(m.mo_qty)}${bu} made`;
              return [head, ...(m.steps || []).map(stepLine), ...(m.components || []).map(compLine)].join('\n');
          }),
          `Click to open ${mp.mo_code}`,
      ].join('\n');
      return (
          // One tooltip for the whole cell — the breakdown is the same answer
          // whether the reader is over the bar, the qty or the stage line.
          <Tooltip content={title} maxWidth={380}>
          <div style={{ display:'flex', flexDirection:'column', gap:2, minWidth:0 }}>
              {/* Blue while producing, green only once the finished goods are made —
                  a full bar off component progress alone would promise a shippable
                  order that does not exist yet. */}
              <MOProgressLink
                  pct={pct}
                  tone={shipped ? 'green' : 'blue'}
                  onClick={() => goToMO(mp.mo_code)}
              />
              <div style={{ fontFamily:xpFont, fontSize:'9px', color: shipped ? (classic ? '#1a5e1a' : '#166534') : '#777' }}>
                  {pct}%{outQty ? ` · ${outQty}` : ''}
                  {/* The dropped code chip carried the "+N" for extra MOs; the count
                      rides the qty line now so a multi-MO line still reads as one. */}
                  {mp.mo_count > 1 && ` · ${mp.mo_count} MOs`}
              </div>
              {mp.components_total > 0 && (
                  // Where a 0%-finished-goods bar's fill actually comes from. Without
                  // this the client reads component progress as finished output.
                  <div style={{ fontFamily:xpFont, fontSize:'9px', color: mp.components_done >= mp.components_total ? (classic ? '#1a5e1a' : '#166534') : '#8a6d00', whiteSpace:'nowrap' as const, overflow:'hidden', textOverflow:'ellipsis' }}>
                      {mp.components_done}/{mp.components_total} components
                      {comps.length > 0 && mp.components_done < mp.components_total && (() => {
                          const next = comps.find((c: any) => c.pct < 100);
                          return next ? ` · ${next.mo_code.replace(/^MO-/, '')}` : '';
                      })()}
                  </div>
              )}
              {mp.current_stage && (
                  <div style={{ fontFamily:xpFont, fontSize:'9px', color: mp.current_stage_running ? (classic ? '#00327d' : '#0058e6') : '#999', fontWeight: mp.current_stage_running ? 'bold' : undefined, whiteSpace:'nowrap' as const, overflow:'hidden', textOverflow:'ellipsis' }}>
                      {mp.current_stage_running ? 'now' : 'next'}: {mp.current_stage}
                  </div>
              )}
          </div>
          </Tooltip>
      );
  };

  const handlePrintSO = (so: any) => {
      setPrintingSO(so);
  };

  const customers = partners.filter((p: any) => p.type === 'CUSTOMER' && p.active);
  // SO lines can only order Finished Goods — raw/WIP/sample/chemical items are not orderable.
  // Items expose category_path (root-first list of names), not a flat category string.
  // Picker options come from the server typeahead page (already Finished-Goods-scoped);
  // the defensive category filter keeps it correct even if the server contract changes.
  const finishedGoodsItems = useMemo(
      () => (itemResults || []).filter((i: any) => (i.category_path || []).includes('Finished Goods')),
      [itemResults]
  );
  const STATUS_FILTERS = ['ALL', 'PENDING', 'READY', 'PARTIAL', 'SENT', 'DELIVERED'];

  // No client-side re-filter: the server already applies search+customer+status to
  // the page it returned, and `searchTerm`/`customerSearch` here are the *live input
  // echoes* (DataContext debounces the committed value it actually queries with).
  // Re-filtering on the echo blanked the table for the length of the debounce while
  // the Pager still reported the full server total.
  // Filtering, pagination AND sorting all happen server-side. Sorting used to run
  // client-side over the loaded page, which only reordered the 50 rows the server
  // had already picked — clicking "Customer" sorted those 50, not all 62 orders, so
  // page 1 never showed the actual first rows in that order. The header now drives a
  // `sort_by`/`sort_dir` query param (see _SO_SORT_MAP) and the keys below match it.
  const toggleSOSort = (key: string) => setSoSort(nextSortState(soSort, key));
  const pageOrders = salesOrders;

  // Skeleton sizing: measure one real row so the placeholders shown on the next
  // load are exactly as tall as the rows that replace them.
  const listBodyRef = useRef<HTMLTableSectionElement>(null);
  const skel = useTableSkeletonMetrics('sales-orders', listBodyRef, pageOrders.length > 0);

  // The list is now server-paginated, so "print table" needs a dedicated fetch
  // of every order matching the active filter — not just the ~50 on screen.
  const handleOpenTablePrint = async () => {
      setPrintLoading(true);
      try {
          // Same filters AND sort as the screen, every matching row (not just this
          // page) — the shared builder keeps the printout in the order the user is
          // actually looking at.
          const res = await authFetch(`${LINEAGE_API_BASE}/sales-orders?${soQuery(1, { uncapped: true })}`);
          if (res.ok) {
              const d = await res.json();
              setPrintOrders(d.items || []);
              setIsTablePrintOpen(true);
          } else {
              showToast('Failed to load orders for printing', 'danger');
          }
      } finally { setPrintLoading(false); }
  };

  return (
    <>
       {/* Table Print Modal */}
       {isTablePrintOpen && (
           <SOTablePrintModal
               salesOrders={printOrders || []}
               onClose={() => { setIsTablePrintOpen(false); setPrintOrders(null); }}
               currentStyle={currentStyle}
               companyProfile={companyProfile}
               items={items}
               attributes={attributes}
               partners={partners}
           />
       )}

       {/* Single SO Print Modal */}
       {printingSO && (
           <SalesPrintModal
               so={printingSO}
               onClose={() => setPrintingSO(null)}
               currentStyle={currentStyle}
               companyProfile={companyProfile}
               items={items}
               attributes={attributes}
               partners={partners}
           />
       )}

       {/* Production Lineage Modal — SO → PR → MO → WO → beams */}
       {(lineageSO || lineageData) && (
           <ModalWrapper
               isOpen={!!(lineageSO || lineageData)}
               onClose={closeLineage}
               title={<>
                   <i className="bi bi-diagram-3 me-2"></i>Production Lineage — {lineageSO?.po_number}
                   {lineageSO?.customer_name && <span style={{ fontWeight: 'normal', fontSize: '0.85em', marginLeft: 8, opacity: 0.9 }}>{lineageSO.customer_name}</span>}
               </>}
               size="xxl"
               modeless
               footer={<button className={classic ? XP_BTN : 'btn btn-sm btn-secondary'} style={classic ? xpBtn() : undefined} onClick={closeLineage}>Close</button>}
           >
                       <div style={{ fontSize: classic ? 12 : 13, fontFamily: classic ? xpFont : undefined }}>
                           {lineageLoading && <p className="text-muted">Loading lineage...</p>}

                           {/* Covered from stock. Sits ABOVE the PR sections deliberately: this is
                               the part of the order with no MO to trace, so a user hunting for
                               "the rest of my order" meets it before the empty-looking run. */}
                           {!lineageLoading && lineageReservations.length > 0 && (() => {
                               const sectBorder = classic ? '1px solid #b8c4de' : '1px solid #dbe5f5';
                               const thStyle: React.CSSProperties = {
                                   padding: '3px 8px', fontSize: classic ? '0.66rem' : '0.7rem', fontWeight: 'bold',
                                   color: '#555', textAlign: 'left', borderBottom: sectBorder, whiteSpace: 'nowrap',
                               };
                               const tdStyle: React.CSSProperties = {
                                   padding: '3px 8px', fontSize: classic ? '0.7rem' : '0.75rem',
                               };
                               const tdNum: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontFamily: CODE_FONT };
                               const totalHeld = lineageReservations.reduce((a: number, r: any) => a + Number(r.qty_remaining || 0), 0);
                               return (
                                   <div style={{ marginBottom: 16 }}>
                                       <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '5px 8px', background: classic ? '#fdf3e0' : '#fff8ed', border: sectBorder, borderBottom: 'none' }}>
                                           <i className="bi bi-box-seam" style={{ color: '#b45309' }}></i>
                                           <strong style={{ fontSize: '0.75rem' }}>Covered from stock</strong>
                                           <span style={{ color: '#777', fontSize: '0.72rem' }}>
                                               {qtyFmt(2)(totalHeld)} reserved to this order &mdash; no manufacturing order was created for it
                                           </span>
                                       </div>
                                       <table style={{ width: '100%', borderCollapse: 'collapse', border: sectBorder }}>
                                           <thead>
                                               <tr style={{ background: classic ? '#f1f0eb' : '#f8fafc' }}>
                                                   <th style={thStyle}>Item</th>
                                                   <th style={thStyle}>Variant</th>
                                                   <th style={{ ...thStyle, textAlign: 'right' }}>Reserved</th>
                                                   <th style={{ ...thStyle, textAlign: 'right' }}>Shipped</th>
                                                   <th style={{ ...thStyle, textAlign: 'right' }}>Still held</th>
                                                   <th style={thStyle}>From run</th>
                                                   <th style={thStyle}></th>
                                               </tr>
                                           </thead>
                                           <tbody>
                                               {lineageReservations.map((r: any) => (
                                                   <tr key={r.id} style={{ borderTop: classic ? '1px dashed #d0cdc8' : '1px dashed #e4e4e4' }}>
                                                       <td style={tdStyle}>
                                                           <div style={{ fontWeight: 600 }}>{r.item_name}</div>
                                                           <CodeChip code={r.item_code} classic={classic} tier={2} />
                                                       </td>
                                                       <td style={tdStyle}>
                                                           <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 2 }}>
                                                               {r.size_label && <VariantChip kind="size" classic={classic}>{String(r.size_label).toUpperCase()}</VariantChip>}
                                                               {(r.color_code || r.color_name) && (
                                                                   <VariantChip kind="color" classic={classic} swatch={colorHexFor(r.color_name || r.color_code || '')}>
                                                                       {colorLabel(r.color_code, r.color_name)}
                                                                   </VariantChip>
                                                               )}
                                                           </div>
                                                       </td>
                                                       <td style={tdNum}>{qtyFmt(2)(r.qty)} {r.uom}</td>
                                                       <td style={{ ...tdNum, color: '#777' }}>{qtyFmt(2)(r.qty_released)}</td>
                                                       <td style={{ ...tdNum, fontWeight: 700 }}>{qtyFmt(2)(r.qty_remaining)}</td>
                                                       <td style={tdStyle}>
                                                           {r.production_run_code
                                                               ? lineageCodeChip(r.production_run_code, () => goToPR(r.production_run_code), 'pr')
                                                               : <span style={{ color: '#999' }}>&mdash;</span>}
                                                       </td>
                                                       <td style={{ ...tdStyle, textAlign: 'right' }}>
                                                           {canManage && r.status === 'ACTIVE' && (
                                                               <XPActionButton classic={classic} tone="danger" icon="bi-unlock"
                                                                   title="Release this stock back to the free pool - other orders may then plan against it"
                                                                   onClick={() => releaseReservation(lineageSO?.id || r.sales_order_id, r.id)} />
                                                           )}
                                                       </td>
                                                   </tr>
                                               ))}
                                           </tbody>
                                       </table>
                                   </div>
                               );
                           })()}

                           {!lineageLoading && lineageData && (lineageData.production_runs || []).length === 0 && (
                               <p className="text-muted">No Production Runs created from this Sales Order yet. Everything produced for this order will appear here once a PR is created.</p>
                           )}
                           {!lineageLoading && lineageData && (lineageData.production_runs || []).map((pr: any) => {
                               const prMos = pr.manufacturing_orders || [];
                               const rows: any[] = [];
                               prMos.forEach((mo: any) => flattenMO(mo, 0, false, rows));
                               (pr.unpegged_components || []).forEach((mo: any) => flattenMO(mo, 0, true, rows));
                               // Header progress counts EVERY MO in the run — roots plus nested
                               // and unpegged shared components — not just the root MOs, so the
                               // bar matches the rows the user actually sees below it.
                               const allMoRows = rows.filter((r: any) => r.kind === 'mo');
                               const prTotal = allMoRows.length;
                               const prDone = allMoRows.filter((r: any) => ['COMPLETED', 'DELIVERED'].includes(r.mo.status)).length;
                               const prPct = prTotal ? Math.round((prDone / prTotal) * 100) : 0;
                               const thStyle: React.CSSProperties = {
                                   padding: '3px 8px', fontSize: classic ? '0.66rem' : '0.7rem', fontWeight: 'bold',
                                   color: '#555', textAlign: 'left', borderBottom: classic ? '1px solid #b8c4de' : '1px solid #dbe5f5', whiteSpace: 'nowrap',
                               };
                               const sectBorder = classic ? '1px solid #b8c4de' : '1px solid #dbe5f5';
                               return (
                               <div key={pr.id} style={{ marginBottom: 16 }}>
                                   {/* PR section header bar */}
                                   <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '5px 8px', background: classic ? '#e3ebf8' : '#eef3fb', border: sectBorder, borderBottom: 'none' }}>
                                       {lineageCodeChip(pr.code, () => goToPR(pr.code), 'pr')}
                                       {lineageStatusBadge(pr.status)}
                                       <span style={{ color: '#777', fontSize: '0.72rem' }}>{prDone}/{prTotal} MO done</span>
                                       <div style={{ flex: 1, minWidth: 80, maxWidth: 230 }}>
                                           <ProgressBar pct={prPct} tone={prPct >= 100 ? 'green' : 'blue'} height={8} label="outside" />
                                       </div>
                                   </div>
                                   {rows.length === 0 ? (
                                       <div style={{ padding: '8px', color: '#999', fontStyle: 'italic', border: sectBorder }}>No manufacturing orders.</div>
                                   ) : (
                                       <table style={{ width: '100%', borderCollapse: 'collapse', border: sectBorder }}>
                                           <thead>
                                               <tr style={{ background: classic ? '#f0ede4' : '#f7f7f7' }}>
                                                   <th style={thStyle}>Order / Step</th>
                                                   <th style={thStyle}>Item</th>
                                                   <th style={{ ...thStyle, textAlign: 'right' }}>Qty</th>
                                                   <th style={thStyle}>Status</th>
                                                   <th style={thStyle}>Progress</th>
                                               </tr>
                                           </thead>
                                           <tbody>
                                               {rows.map((row: any, ri: number) => renderLineageRow(row, `${pr.id}-${ri}`))}
                                           </tbody>
                                       </table>
                                   )}
                               </div>
                               );
                           })}
                       </div>
           </ModalWrapper>
       )}

       <CodeConfigModal
           isOpen={isConfigOpen}
           onClose={() => setIsConfigOpen(false)}
           type="SO"
           onSave={handleSaveConfig}
           initialConfig={codeConfig}
           attributes={attributes}
       />


       {/* Create / Edit SO Modal */}
       <ModalWrapper
           isOpen={isCreateOpen}
           modeless
           onClose={() => { setIsCreateOpen(false); setEditingSOId(null); resetForm(); }}
           title={<><i className={`bi ${editingSOId ? 'bi-pencil' : 'bi-cart-plus'}`} style={classic ? {marginRight:6} : {marginRight:8}}></i>{editingSOId ? 'Edit Sales Order' : 'Create Sales Order'}</>}
           variant="primary"
           size="lg"
           footer={classic ? (
               <>
                   <button type="button" className={XP_BTN} style={xpBtn()} onClick={() => { setIsCreateOpen(false); setEditingSOId(null); resetForm(); }}>{t('cancel')}</button>
                   <button type="button" className={XP_BTN} style={newSO.lines.length === 0 ? {...xpBtn(), opacity: 0.5} : xpBtn({ ...BTN_TONES.primary, padding: '2px 16px' })} onClick={handleSubmit as any} disabled={newSO.lines.length === 0} title={newSO.lines.length === 0 ? 'Add at least one item first' : undefined}><i className="bi bi-floppy" style={{marginRight:4}}></i>{editingSOId ? 'Update' : t('save')} Order</button>
               </>
           ) : (
               <>
                   <button type="button" className="btn btn-sm btn-link text-muted" onClick={() => { setIsCreateOpen(false); setEditingSOId(null); resetForm(); }}>{t('cancel')}</button>
                   <button type="button" className="btn btn-sm btn-primary px-4 fw-bold" onClick={handleSubmit as any} disabled={newSO.lines.length === 0} title={newSO.lines.length === 0 ? 'Add at least one item first' : undefined}>{editingSOId ? 'Update' : t('save')} Order</button>
               </>
           )}
       >
           <form onSubmit={handleSubmit} id="create-so-form">
               <FormSection title="Order Details" classic={classic}>
               <div className="row g-3">
                   <div className="col-md-4">
                       <FieldLabel classic={classic} right={<i className="bi bi-gear-fill" style={{cursor:'pointer',color:classic?'#555':'',fontSize:classic?'11px':''}} onClick={() => setIsConfigOpen(true)} title="Configure Auto-Suggestion"></i>}>Ref No. (PO#)</FieldLabel>
                       <input className="form-control" style={classic ? xpInput() : undefined} placeholder="Auto-generated" value={newSO.po_number} onChange={e => setNewSO({...newSO, po_number: e.target.value})} required />
                   </div>
                   <div className="col-md-4">
                       <FieldLabel classic={classic}>Customer PO Ref</FieldLabel>
                       <input className="form-control" style={classic ? xpInput() : undefined} placeholder="Customer's own PO reference" value={newSO.customer_po_ref} onChange={e => setNewSO({...newSO, customer_po_ref: e.target.value})} />
                   </div>
                   <div className="col-md-4">
                       <FieldLabel classic={classic}>Date</FieldLabel>
                       <input type="date" className="form-control" style={classic ? xpInput({width:'100%',height:'22px'}) : undefined} value={newSO.order_date} onChange={e => setNewSO({...newSO, order_date: e.target.value})} required />
                   </div>
                   <div className="col-md-12">
                       <FieldLabel classic={classic}>Customer</FieldLabel>
                       <SearchableSelect
                           options={customers.map((c: any) => ({ value: c.name, label: c.name, subLabel: c.address }))}
                           value={newSO.customer_name}
                           onChange={(val) => setNewSO({...newSO, customer_name: val})}
                           placeholder="Select Customer…"
                           required
                       />
                   </div>
               </div>
               </FormSection>

               <FormSection title="Line Items" classic={classic}>
                   {/* Item selector — full width */}
                   <div className="row g-2 mb-2">
                       <div className="col-12">
                           <FieldLabel classic={classic} right={
                               <span
                                   title="Only items in the Finished Goods category can be ordered"
                                   style={{
                                       fontFamily: xpFont, fontSize: classic ? '9px' : '10px',
                                       fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.4px',
                                       background: classic ? '#e8f5e9' : '#e8f5e9', border: '1px solid #2e7d32',
                                       color: '#1b4620', padding: '0 5px', borderRadius: CHIP_RADIUS, whiteSpace: 'nowrap',
                                   }}
                               >
                                   Finished Goods only
                               </span>
                           }>Item</FieldLabel>
                           <SearchableSelect
                               options={finishedGoodsItems.map((item: any) => ({ value: item.id, label: item.name, subLabel: item.code }))}
                               value={newLine.item_id}
                               onChange={handleLineItemChange}
                               onSearch={onSearchItems}
                               placeholder="Select Item…"
                           />
                       </div>

                       {/* 2-column qty / dates grid */}
                       <div className="col-12">
                           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: classic ? 6 : 10 }}>

                               {/* Left: Qty inputs panel */}
                               <div style={{ background: classic ? '#f8f7f2' : 'rgba(0,0,0,0.02)', border: classic ? '1px solid #c0bdb5' : '1px solid #dee2e6', padding: classic ? '6px 8px' : '10px 12px' }}>

                                   {/* LENGTH GROUP */}
                                   <div style={classic ? { border: '1px solid #a0988c', padding: '4px 8px 8px', marginBottom: 8, position: 'relative' } : { marginBottom: 10 }}>
                                       {classic
                                           ? <span style={{ position: 'absolute', top: -7, left: 8, background: '#f8f7f2', padding: '0 4px', fontSize: '10px', fontWeight: 'bold', color: '#444', textTransform: 'uppercase' as const, letterSpacing: '0.4px', fontFamily: xpFont }}>Length</span>
                                           : <div className="text-muted fw-bold mb-2" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Length</div>
                                       }
                                       <div style={{ paddingTop: classic ? 4 : 0, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: classic ? 5 : 8 }}>
                                           <div>
                                               <FieldLabel classic={classic}>Yard</FieldLabel>
                                               <input type="number" className="form-control" style={classic ? xpInput({width:'100%'}) : undefined} placeholder="0" value={newLine.qty || ''} onChange={e => handleQtyYardChange(e.target.value)} />
                                           </div>
                                           <div>
                                               <FieldLabel classic={classic}>Meter</FieldLabel>
                                               <input type="number" className="form-control" style={classic ? xpInput({width:'100%'}) : undefined} placeholder="0" value={qtyMeter} onChange={e => handleQtyMeterChange(e.target.value)} />
                                           </div>
                                           <div>
                                               <FieldLabel classic={classic}><span style={{ whiteSpace: 'nowrap' }}>Gross Yd <span style={{ fontWeight: 'normal', fontSize: '10px', color: '#888' }}>(144 yd)</span></span></FieldLabel>
                                               <input type="number" className="form-control" style={classic ? xpInput({width:'100%'}) : undefined} placeholder="0" value={qtyGrossYd} onChange={e => handleQtyGrossYdChange(e.target.value)} />
                                           </div>
                                       </div>
                                   </div>

                                   {/* WEIGHT GROUP */}
                                   <div style={classic ? { border: '1px solid #a0988c', padding: '4px 8px 8px', marginBottom: 8, position: 'relative' } : { marginBottom: 10 }}>
                                       {classic
                                           ? <span style={{ position: 'absolute', top: -7, left: 8, background: '#f8f7f2', padding: '0 4px', fontSize: '10px', fontWeight: 'bold', color: '#444', textTransform: 'uppercase' as const, letterSpacing: '0.4px', fontFamily: xpFont }}>Weight</span>
                                           : <div className="text-muted fw-bold mb-2" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Weight</div>
                                       }
                                       <div style={{ paddingTop: classic ? 4 : 0 }}>
                                           <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
                                               <div style={{ flex: 1 }}>
                                                   <FieldLabel classic={classic}>Kilogram</FieldLabel>
                                                   <input type="number" className="form-control"
                                                       style={classic ? xpInput({width:'100%'}) : undefined}
                                                       placeholder="0"
                                                       value={newLine.qty_kg}
                                                       onChange={e => handleQtyKgChange(e.target.value)}
                                                   />
                                               </div>
                                               <div style={{ paddingBottom: 1 }}>
                                                   {kgAuto ? (
                                                       <button type="button" onClick={toggleKgAuto} title="Click to enter manually"
                                                           style={classic ? {fontFamily:xpFont,fontSize:'9px',padding:'1px 6px',background:'linear-gradient(to bottom,#4a9ae8,#1a5ec8)',border:'1px solid',borderColor:'#1a3a8a #0a2a6a #0a2a6a #1a3a8a',color:'#fff',cursor:'pointer',borderRadius:0} : undefined}
                                                           className={classic ? '' : 'badge bg-primary border-0'}
                                                       >AUTO</button>
                                                   ) : (
                                                       <button type="button" onClick={toggleKgAuto} title="Click to restore auto calculation"
                                                           style={classic ? {fontFamily:xpFont,fontSize:'9px',padding:'1px 6px',background:'linear-gradient(to bottom,#ffffff,#d4d0c8)',border:'1px solid',borderColor:'#dfdfdf #808080 #808080 #dfdfdf',color:'#000',cursor:'pointer',borderRadius:0} : undefined}
                                                           className={classic ? '' : 'badge bg-secondary border-0'}
                                                       >&larr; Auto</button>
                                                   )}
                                               </div>
                                           </div>
                                           {kgAuto && isAutoCalcSupported(newLine.item_id) && (
                                               <div style={{ fontFamily:xpFont, fontSize:'10px', color:'#666', fontStyle:'italic', marginTop:2 }}>
                                                   {getItemWeightUnit(newLine.item_id) === 'g/y'
                                                       ? `${getItemWeight(newLine.item_id)} g/y ↔ Yd`
                                                       : `${getItemWeight(newLine.item_id)} g/m ↔ m`}
                                               </div>
                                           )}
                                       </div>
                                   </div>

                                   {/* Alt Unit compound input */}
                                   <div>
                                       <FieldLabel classic={classic}>Alt Unit</FieldLabel>
                                       {(() => {
                                           const selectedUom = uoms.find((u: any) => u.name === newLine.uom2);
                                           const factors = selectedUom?.factors || [];
                                           const isSystem = selectedUom?.is_system || false;
                                           const qty2Val = parseFloat(newLine.qty2 as string) || 0;
                                           return classic ? (
                                               <div>
                                                   <div style={{ display: 'flex' }}>
                                                       <input type="number" className="form-control"
                                                           style={xpInput({ flex: 1, borderRight: 'none', minWidth: 0 })}
                                                           placeholder="0" value={newLine.qty2} onChange={e => handleQty2Change(e.target.value)} />
                                                       <select
                                                           style={{ fontFamily:xpFont, fontSize:'11px', border:'1px solid #7f9db9', height:'20px', borderRadius:0, padding:'1px 4px', background:'#ffffff', outline:'none', color:'#000', flexShrink: 0 }}
                                                           value={newLine.uom2} onChange={e => { setNewLine(prev => ({ ...prev, uom2: e.target.value, uom2_factor: null })); }}
                                                       >
                                                           <option value="">Unit</option>
                                                           {uoms.map((u: any) => <option key={u.id} value={u.name}>{u.name}</option>)}
                                                       </select>
                                                   </div>
                                                   {factors.length > 0 && isSystem && (
                                                       <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap' as const, gap: 3 }}>
                                                           {factors.map((f: any) => {
                                                               const fVal = parseFloat(f.value);
                                                               const toUnit = (f.to_uom_name || 'yard').toLowerCase();
                                                               const unitLabel = (toUnit === 'm' || toUnit === 'meter') ? 'm' : 'Yd';
                                                               const totalYd = qty2Val > 0
                                                                   ? Math.round((toUnit === 'm' || toUnit === 'meter' ? qty2Val * fVal / 0.9144 : qty2Val * fVal) * 100) / 100
                                                                   : null;
                                                               const active = newLine.uom2_factor === fVal;
                                                               return (
                                                                   <button key={f.id} type="button"
                                                                       style={{ fontFamily:xpFont, fontSize:'10px', padding:'1px 6px', cursor:'pointer', borderRadius:0, border: active ? '1px solid #1a3a8a' : '1px solid #7f9db9', background: active ? 'linear-gradient(to bottom,#4a9ae8,#1a5ec8)' : 'linear-gradient(to bottom,#fff,#e8e4d8)', color: active ? '#fff' : '#000' }}
                                                                       onClick={() => handleUom2FactorChange(String(fVal))}
                                                                   >
                                                                       ×{fVal} {unitLabel}{totalYd !== null ? ` = ${totalYd} Yd` : ''}{f.label ? ` (${f.label})` : ''}
                                                                   </button>
                                                               );
                                                           })}
                                                       </div>
                                                   )}
                                                   {factors.length > 0 && !isSystem && (
                                                       <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                                                           <span style={{ fontFamily:xpFont, fontSize:'10px', color:'#804800', whiteSpace:'nowrap' }}>1 {newLine.uom2} =</span>
                                                           <select
                                                               style={{ fontFamily:xpFont, fontSize:'11px', border:'1px solid #7f9db9', height:'20px', borderRadius:0, padding:'1px 4px', background: newLine.uom2_factor ? '#fff8e8' : '#ffffff', outline:'none', color:'#000', flex: 1 }}
                                                               value={newLine.uom2_factor ?? ''}
                                                               onChange={e => handleUom2FactorChange(e.target.value)}
                                                           >
                                                               <option value="">— select factor —</option>
                                                               {factors.map((f: any) => <option key={f.id} value={f.value}>{parseFloat(f.value)} {(f.to_uom_name || 'Yard')}{f.label ? ` (${f.label})` : ''}</option>)}
                                                           </select>
                                                       </div>
                                                   )}
                                               </div>
                                           ) : (
                                               <div>
                                                   <div className="input-group input-group-sm">
                                                       <input type="number" className="form-control" placeholder="0" value={newLine.qty2} onChange={e => handleQty2Change(e.target.value)} />
                                                       <select className="form-select" style={{ maxWidth: 80 }} value={newLine.uom2} onChange={e => setNewLine(prev => ({ ...prev, uom2: e.target.value, uom2_factor: null }))}>
                                                           <option value="">Unit</option>
                                                           {uoms.map((u: any) => <option key={u.id} value={u.name}>{u.name}</option>)}
                                                       </select>
                                                   </div>
                                                   {factors.length > 0 && isSystem && (
                                                       <div className="d-flex flex-wrap gap-1 mt-2">
                                                           {factors.map((f: any) => {
                                                               const fVal = parseFloat(f.value);
                                                               const toUnit = (f.to_uom_name || 'yard').toLowerCase();
                                                               const unitLabel = (toUnit === 'm' || toUnit === 'meter') ? 'm' : 'Yd';
                                                               const totalYd = qty2Val > 0
                                                                   ? Math.round((toUnit === 'm' || toUnit === 'meter' ? qty2Val * fVal / 0.9144 : qty2Val * fVal) * 100) / 100
                                                                   : null;
                                                               const active = newLine.uom2_factor === fVal;
                                                               return (
                                                                   <button key={f.id} type="button"
                                                                       className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}`}
                                                                       style={{ fontSize: 11 }}
                                                                       onClick={() => handleUom2FactorChange(String(fVal))}
                                                                   >
                                                                       ×{fVal} {unitLabel}{totalYd !== null ? ` = ${totalYd} Yd` : ''}{f.label ? ` (${f.label})` : ''}
                                                                   </button>
                                                               );
                                                           })}
                                                       </div>
                                                   )}
                                                   {factors.length > 0 && !isSystem && (
                                                       <div className="d-flex align-items-center gap-1 mt-1">
                                                           <span className="text-muted small" style={{ whiteSpace:'nowrap' }}>1 {newLine.uom2} =</span>
                                                           <select className="form-select form-select-sm" style={{ background: newLine.uom2_factor ? '#fff8e8' : undefined }}
                                                               value={newLine.uom2_factor ?? ''}
                                                               onChange={e => handleUom2FactorChange(e.target.value)}
                                                           >
                                                               <option value="">— select factor —</option>
                                                               {factors.map((f: any) => <option key={f.id} value={f.value}>{parseFloat(f.value)} {(f.to_uom_name || 'Yard')}{f.label ? ` (${f.label})` : ''}</option>)}
                                                           </select>
                                                       </div>
                                                   )}
                                               </div>
                                           );
                                       })()}
                                   </div>
                               </div>

                               {/* Right: Dates + Stock Notes */}
                               <div style={{ display: 'flex', flexDirection: 'column', gap: classic ? 5 : 8 }}>
                                   <div>
                                       <FieldLabel classic={classic}>Del. Request</FieldLabel>
                                       <input type="date" className="form-control" style={classic ? xpInput({width:'100%',height:'22px'}) : undefined} value={newLine.due_date} onChange={e => setNewLine({...newLine, due_date: e.target.value})} />
                                   </div>
                                   <div>
                                       <FieldLabel classic={classic}>Del. Confirmation</FieldLabel>
                                       <input type="date" className="form-control" style={classic ? xpInput({width:'100%',height:'22px'}) : undefined} value={newLine.internal_confirmation_date} onChange={e => setNewLine({...newLine, internal_confirmation_date: e.target.value})} />
                                   </div>
                                   <div>
                                       <FieldLabel classic={classic}>Stock Notes</FieldLabel>
                                       <input className="form-control" style={classic ? xpInput({width:'100%'}) : undefined} placeholder="e.g. 1 IKAT 60 PCS" value={newLine.ket_stock} onChange={e => setNewLine({...newLine, ket_stock: e.target.value})} />
                                   </div>
                               </div>

                           </div>
                       </div>

                       {/* Variants */}
                       {currentBoundAttrs.length > 0 && (
                           <div className="col-12 mt-1">
                               <div style={{background:'#ffffff',border:classic?'1px solid #b0a898':'1px solid #dee2e6',padding:classic?'4px 6px':'8px'}}>
                                   <div style={classic ? {fontFamily:xpFont,fontSize:'10px',fontWeight:'bold',color:'#444',marginBottom:4} : undefined} className={classic ? '' : 'text-muted fw-bold mb-2 small'}>Variants</div>
                                   <div className="row g-2">
                                       {currentBoundAttrs.map((attr: any) => {
                                           const isCombo = comboAttr && attr.id === comboAttr.id;
                                           if (isCombo) {
                                               // Combo Library is server-searched (thousands of combos) —
                                               // options come from the current search page, keyed on
                                               // attribute_value_id so selection still writes into
                                               // attribute_value_ids like the plain-select attrs below.
                                               const selectedId = newLine.attribute_value_ids.find((vid: string) => (attr.values || []).some((v: any) => v.id === vid)) || '';
                                               const options: { value: string; label: string; subLabel?: string }[] =
                                                   comboResults.map((c: any) => ({ value: c.attribute_value_id, label: c.name, subLabel: c.code }));
                                               // If the current selection isn't in the loaded search page
                                               // (e.g. editing an existing line), fall back to the label
                                               // already cached on the attribute so it still displays.
                                               if (selectedId && !options.some(o => o.value === selectedId)) {
                                                   const selectedAttrValue = (attr.values || []).find((v: any) => v.id === selectedId);
                                                   if (selectedAttrValue) options.unshift({ value: selectedId, label: selectedAttrValue.value });
                                               }
                                               return (
                                               <div key={attr.id} className="col-md-4">
                                                   <SearchableSelect
                                                       options={options}
                                                       value={selectedId}
                                                       onChange={val => handleValueChange(val, attr.id)}
                                                       onSearch={onSearchCombos}
                                                       placeholder={`Any ${attr.name}`}
                                                       size="sm"
                                                   />
                                               </div>
                                               );
                                           }
                                           // Plain (non-combo) variant attrs — Colors included. `GET /attributes`
                                           // returns every attribute with its full `values` list (no pagination),
                                           // so the whole set is in memory: filter client-side, no onSearch.
                                           const opts = [...(attr.values || [])].sort((a: any, b: any) =>
                                               String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: 'base' }));
                                           const options = [
                                               { value: '', label: `Any ${attr.name}` },
                                               ...opts.map((v: any) => ({ value: v.id, label: v.value })),
                                           ];
                                           return (
                                           <div key={attr.id} className="col-md-4">
                                               <SearchableSelect
                                                   options={options}
                                                   value={newLine.attribute_value_ids.find(vid => opts.some((v: any) => v.id === vid)) || ''}
                                                   onChange={val => handleValueChange(val, attr.id)}
                                                   placeholder={`Any ${attr.name}`}
                                                   size="sm"
                                               />
                                           </div>
                                           );
                                       })}
                                   </div>
                               </div>
                           </div>
                       )}

                       {/* Color Library picker — shown for color-type finished goods.
                           Writes color_id on the line; drives the DYEING recipe match. */}
                       {currentVariantType === 'color' && newLine.item_id && (
                           <div className="col-12 mt-1">
                               <div style={{background:'#ffffff',border:classic?'1px solid #b0a898':'1px solid #dee2e6',padding:classic?'4px 6px':'8px'}}>
                                   <div style={classic ? {fontFamily:xpFont,fontSize:'10px',fontWeight:'bold',color:'#444',marginBottom:4} : undefined} className={classic ? '' : 'text-muted fw-bold mb-2 small'}>Color Code</div>
                                   {newLine.color_id ? (
                                       <div style={{display:'flex',alignItems:'center',gap:8}}>
                                           <span style={classic?{fontFamily:xpFont,fontSize:'11px',color:'#000'}:undefined} className={classic?'':'small'}>{newLine.color_label}</span>
                                           <button type="button" onClick={clearColor} style={classic?{fontFamily:xpFont,fontSize:'10px',border:'1px solid #7f9db9',background:'#ece9d8',padding:'1px 6px',cursor:'pointer'}:undefined} className={classic?'':'btn btn-sm btn-outline-secondary py-0'}>Change</button>
                                       </div>
                                   ) : newLine.labdip_variant_code ? (
                                       <div style={{display:'flex',alignItems:'center',gap:8}}>
                                           <span style={classic?{fontFamily:xpFont,fontSize:'11px',color:'#8a6d00'}:{color:'#8a6d00'}} className={classic?'':'small'}>Pending lab dip: {newLine.labdip_label}</span>
                                           <button type="button" onClick={clearLabdip} style={classic?{fontFamily:xpFont,fontSize:'10px',border:'1px solid #7f9db9',background:'#ece9d8',padding:'1px 6px',cursor:'pointer'}:undefined} className={classic?'':'btn btn-sm btn-outline-secondary py-0'}>Change</button>
                                       </div>
                                   ) : (
                                       <div style={{position:'relative'}}>
                                           <input
                                               type="text"
                                               placeholder="Search approved color, or pick a pending lab dip below..."
                                               value={colorSearch}
                                               onChange={e => setColorSearch(e.target.value)}
                                               onFocus={() => setColorFocused(true)}
                                               onBlur={() => setTimeout(() => setColorFocused(false), 150)}
                                               style={classic?{fontFamily:xpFont,fontSize:'11px',border:'1px solid #7f9db9',height:'22px',borderRadius:0,padding:'1px 4px',background:'#ffffff',outline:'none',width:'100%'}:undefined}
                                               className={classic?'':'form-control form-control-sm'}
                                           />
                                           {colorFocused && (colorResults.length > 0 || labdipResults.length > 0) && (
                                               <div style={{position:'absolute',zIndex:20,top:'100%',left:0,right:0,maxHeight:220,overflowY:'auto',background:'#ffffff',border:'1px solid #7f9db9'}}>
                                                   {labdipResults.length > 0 && (
                                                       <>
                                                           <div style={{padding:'2px 6px',fontFamily:classic?xpFont:undefined,fontSize:'10px',fontWeight:'bold',color:'#8a6d00',background:'#fbf4dd',borderBottom:'1px solid #e8dca8'}}>Pending (Lab Dip) — not yet approved</div>
                                                           {labdipResults.map((v: any) => (
                                                               <div
                                                                   key={v.labdip_item_id}
                                                                   onClick={() => selectLabdip(v)}
                                                                   style={{padding:'3px 6px',cursor:'pointer',fontFamily:classic?xpFont:undefined,fontSize:'11px',borderBottom:'1px solid #eee'}}
                                                                   onMouseDown={e => e.preventDefault()}
                                                               >
                                                                   <b>{v.variant_code}</b>{v.request_code ? <span style={{color:'#888'}}> · {v.request_code}</span> : null}<span style={{color:'#8a6d00'}}> · {v.status}</span>
                                                               </div>
                                                           ))}
                                                       </>
                                                   )}
                                                   {colorResults.length > 0 && (
                                                       <>
                                                           {labdipResults.length > 0 && <div style={{padding:'2px 6px',fontFamily:classic?xpFont:undefined,fontSize:'10px',fontWeight:'bold',color:'#444',background:'#f0f0f0',borderBottom:'1px solid #ddd'}}>Approved Colors</div>}
                                                           {colorResults.map((c: any) => (
                                                               <div
                                                                   key={c.id}
                                                                   onClick={() => selectColor(c)}
                                                                   style={{padding:'3px 6px',cursor:'pointer',fontFamily:classic?xpFont:undefined,fontSize:'11px',borderBottom:'1px solid #eee'}}
                                                                   onMouseDown={e => e.preventDefault()}
                                                               >
                                                                   <b>{c.code}</b>{c.name ? ` — ${c.name}` : ''}{c.pantone_ref ? <span style={{color:'#888'}}> · {c.pantone_ref}</span> : null}
                                                               </div>
                                                           ))}
                                                       </>
                                                   )}
                                               </div>
                                           )}
                                       </div>
                                   )}
                               </div>
                           </div>
                       )}

                       {/* No Color Swatch — the customer ordered a shade without sending the
                           physical swatch. Per line (i.e. per color variant), informational. */}
                       {newLine.item_id && (
                           <div className="col-12 mt-1">
                               <div style={{background:'#ffffff',border:classic?'1px solid #b0a898':'1px solid #dee2e6',padding:classic?'4px 6px':'8px'}}>
                                   <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',margin:0}}>
                                       <input
                                           type="checkbox"
                                           checked={!!newLine.no_color_swatch}
                                           onChange={e => setNewLine({...newLine, no_color_swatch: e.target.checked})}
                                           className={classic?'':'form-check-input mt-0'}
                                           style={classic?{margin:0}:undefined}
                                       />
                                       <span style={classic?{fontFamily:xpFont,fontSize:'11px',color:'#000'}:undefined} className={classic?'':'small'}>No Color Swatch</span>
                                       <span style={classic?{fontFamily:xpFont,fontSize:'10px',color:'#888'}:{color:'#888'}} className={classic?'':'small'}>— customer has not supplied a physical swatch yet</span>
                                   </label>
                               </div>
                           </div>
                       )}

                       {/* BOM + Size / Measurement (Combo gates BOM list; other variants are annotations) */}
                       {(() => {
                           const itemBoms = getItemBoms(newLine.item_id, newLine.attribute_value_ids);
                           if (!itemBoms.length) return null;
                           const sizeOptions = getSizeOptions(newLine.item_id, newLine.bom_id, newLine.attribute_value_ids);
                           const pickSize = (value: string) => {
                               const opt = sizeOptions.find((o: any) => o.value === value);
                               setNewLine({
                                   ...newLine,
                                   size_token: opt?.token || '',
                                   size_id: opt?.size_id || '',
                                   size_label: opt?.token && !opt?.size_id ? (opt?.size_label || opt?.name || '') : '',
                                   bom_size_id: opt?.bom_size_id || '',
                               });
                           };
                           const sizeValue = newLine.size_token || (newLine.bom_size_id ? `bs:${newLine.bom_size_id}` : '');
                           return (
                               <>
                                   {itemBoms.length > 1 && (
                                       <div className="col-12 mt-1">
                                           <div style={{background:'#ffffff',border:classic?'1px solid #b0a898':'1px solid #dee2e6',padding:classic?'4px 6px':'8px'}}>
                                               <div style={classic?{fontFamily:xpFont,fontSize:'10px',fontWeight:'bold',color:'#444',marginBottom:4}:undefined} className={classic?'':'text-muted fw-bold mb-2 small'}>BOM <span style={{fontWeight:'normal',color:'#888'}}>(optional — the Production Run picks one)</span></div>
                                               <select
                                                   className="form-select form-select-sm"
                                                   style={classic?{fontFamily:xpFont,fontSize:'11px',border:'1px solid #7f9db9',height:'22px',borderRadius:0,padding:'1px 4px',background:'#ffffff',outline:'none',width:'100%'}:undefined}
                                                   value={newLine.bom_id}
                                                   onChange={e => setNewLine({...newLine, bom_id: e.target.value, bom_size_id: ''})}
                                               >
                                                   <option value="">Decide on the Production Run</option>
                                                   {itemBoms.map((b: any) => (
                                                       <option key={b.id} value={b.id}>{b.code}{b.description ? ` — ${b.description}` : ''}</option>
                                                   ))}
                                               </select>
                                           </div>
                                       </div>
                                   )}
                                   {sizeOptions.length > 0 && (
                                       <div className="col-12 mt-1">
                                           <div style={{background:'#ffffff',border:classic?'1px solid #b0a898':'1px solid #dee2e6',padding:classic?'4px 6px':'8px'}}>
                                               <div style={classic?{fontFamily:xpFont,fontSize:'10px',fontWeight:'bold',color:'#444',marginBottom:4}:undefined} className={classic?'':'text-muted fw-bold mb-2 small'}>Size / Measurement</div>
                                               <select
                                                   className="form-select form-select-sm"
                                                   style={classic?{fontFamily:xpFont,fontSize:'11px',border:'1px solid #7f9db9',height:'22px',borderRadius:0,padding:'1px 4px',background:'#ffffff',outline:'none',width:'100%'}:undefined}
                                                   value={sizeValue}
                                                   onChange={e => pickSize(e.target.value)}
                                               >
                                                   <option value="">No specific size</option>
                                                   {sizeOptions.map((o: any) => (
                                                       <option key={o.value} value={o.value}>{o.measurement ? `${o.name} — ${o.measurement}` : o.name}</option>
                                                   ))}
                                               </select>
                                           </div>
                                       </div>
                                   )}
                               </>
                           );
                                              })()}
                   </div>

                   {/* Add Line button — full width, bottom of form */}
                   <div style={{ marginTop: classic ? 6 : 10, marginBottom: classic ? 6 : 10 }}>
                       {newLineVariantErr && (
                           <div style={{ fontFamily: classic ? xpFont : undefined, fontSize: classic ? '10px' : '12px', fontWeight: 'bold', color: '#8a6d00', marginBottom: 4 }}>
                               <i className="bi bi-exclamation-triangle me-1"></i>{newLineVariantErr}
                           </div>
                       )}
                       {classic ? (
                           <button type="button"
                               className={XP_BTN}
                               style={addLineDisabled
                                   ? { ...xpBtn(), width: '100%', padding: '3px 0', opacity: 0.5, textAlign: 'center' as const }
                                   : { ...xpBtn({ ...BTN_TONES.success }), width: '100%', padding: '3px 0', textAlign: 'center' as const }}
                               onClick={handleAddLine} disabled={addLineDisabled}
                               title={addLineTitle}
                           >
                               <i className="bi bi-plus-lg" style={{ marginRight: 5 }}></i>Add Line to Order
                           </button>
                       ) : (
                           <button type="button"
                               className={`w-100 btn ${addLineDisabled ? 'btn-outline-secondary' : 'btn-success'}`}
                               style={{ fontWeight: 600 }}
                               onClick={handleAddLine} disabled={addLineDisabled}
                               title={addLineTitle}
                           >
                               <i className="bi bi-plus-lg me-2"></i>Add Line to Order
                           </button>
                       )}
                   </div>

                   {/* Lines list */}
                   <div>
                       {newSO.lines.map((line: any, idx) => (
                           <div key={idx} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:classic?'3px 6px':'8px',background:classic?lvZebra(true,idx):'white',border:classic?'1px solid #c0bdb5':'1px solid #dee2e6',marginBottom:2,fontFamily:classic?xpFont:undefined,fontSize:classic?'11px':undefined,flexWrap:'wrap' as const,gap:classic?4:6}}>
                               <div>
                                   <span style={{fontWeight:'bold'}}>{getItemName(line.item_id, line.item_name)}</span>
                                   <CodeChip code={getItemCode(line.item_id, line.item_code)} classic={classic} tier={2} style={{ marginLeft: 8 }} />
                                   {isSample(line.item_id) && <span style={{ borderRadius: CHIP_RADIUS,background:'#fff8dc',border:'1px solid #c8a000',color:'#4a3000',padding:'0 4px',fontSize:'9px',fontFamily:classic?xpFont:'',marginLeft:6}} className={classic?'':'badge bg-warning text-dark ms-2'}>Sample</span>}
                                   {(() => {
                                       const { chips, plainIds } = buildVariantChips(line.attribute_value_ids || [], line.color_label, line.color_hex, !line.color_id ? line.labdip_variant_code : null);
                                       return (
                                           <>
                                               {plainIds.length > 0 && <div style={{color:classic?'#666':'',fontSize:classic?'10px':'',fontStyle:'italic'}} className={classic?'':'small text-muted fst-italic'}>{plainIds.map(getAttributeValueName).join(', ')}</div>}
                                               {chips.length > 0 && renderChipRow(chips)}
                                           </>
                                       );
                                   })()}
                                   {(() => {
                                       const { name, measurement } = getLineSizeParts(line);
                                       return name ? <div style={{color:classic?'#005':'',fontSize:classic?'10px':'',fontWeight:'bold'}} className={classic?'':'small text-primary fw-semibold'}><i className="bi bi-rulers me-1"></i>{measurement ? `${name} — ${measurement}` : name}</div> : null;
                                   })()}
                                   {line.no_color_swatch && <div style={{color:'#a33',fontSize:classic?'10px':'',fontWeight:'bold'}} className={classic?'':'small fw-semibold'}><i className="bi bi-palette me-1"></i>No Color Swatch</div>}
                               </div>
                               <div style={{display:'flex',alignItems:'center',gap:classic?6:10,flexWrap:'wrap' as const}}>
                                   <div style={{display:'flex',flexDirection:'column',gap:1}}>
                                       <span style={{color:classic?'#999':'',fontSize:'9px'}} className={classic?'':'text-muted'}>Req</span>
                                       <input type="date"
                                           style={classic ? xpInput({width:110, height:'20px'}) : {width:130}}
                                           className={classic?'':'form-control form-control-sm'}
                                           value={line.due_date || ''}
                                           onChange={e => handleLineDateChange(idx, 'due_date', e.target.value)}
                                           title="Delivery Request date"
                                       />
                                   </div>
                                   <div style={{display:'flex',flexDirection:'column',gap:1}}>
                                       <span style={{color:classic?'#999':'',fontSize:'9px'}} className={classic?'':'text-muted'}>Conf</span>
                                       <input type="date"
                                           style={classic ? xpInput({width:110, height:'20px'}) : {width:130}}
                                           className={classic?'':'form-control form-control-sm'}
                                           value={line.internal_confirmation_date || ''}
                                           onChange={e => handleLineDateChange(idx, 'internal_confirmation_date', e.target.value)}
                                           title="Delivery Confirmation date"
                                       />
                                   </div>
                                   <span style={{fontWeight:'bold'}}>×</span>
                                   <input type="number" min="0" step="any"
                                       style={classic ? xpInput({width:70, textAlign:'right'}) : {width:80,textAlign:'right'}}
                                       className={classic?'':'form-control form-control-sm'}
                                       value={line.qty || ''}
                                       onChange={e => handleLineQtyChange(idx, e.target.value)}
                                       title="Quantity ordered (Yd)"
                                   />
                                   <span style={{color:classic?'#777':'',fontSize:classic?'10px':'',fontWeight:'normal'}} className={classic?'':'text-muted small'}>Yd</span>
                                   {(() => {
                                       const lineUom = (uoms || []).find((u: any) => u.name === line.uom2);
                                       const lineFactors = lineUom?.factors || [];
                                       const conv = describeUom2(line);
                                       return (
                                           <div style={{display:'flex',flexDirection:'column',gap:1}}>
                                               <span style={{color: conv?.drift != null ? '#c00000' : (classic?'#999':''), fontSize:'9px', fontWeight: conv?.drift != null ? 'bold' : 'normal'}}
                                                   className={classic || conv?.drift != null ? '' : 'text-muted'}
                                                   title={conv?.drift != null ? `Alt unit works out to ${conv.total}, but this line is ${line.qty} Yd` : undefined}
                                               >
                                                   {conv?.drift != null && <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 2 }}></i>}
                                                   Alt{conv?.total ? ` (= ${conv.total})` : ''}
                                               </span>
                                               <div style={{display:'flex',alignItems:'center',gap:2}}>
                                                   <input type="number" min="0" step="any"
                                                       style={classic ? xpInput({width:52, textAlign:'right'}) : {width:64,textAlign:'right'}}
                                                       className={classic?'':'form-control form-control-sm'}
                                                       placeholder="0"
                                                       value={line.qty2 ?? ''}
                                                       onChange={e => handleLineAltChange(idx, { qty2: e.target.value })}
                                                       title="Quantity in the alternate unit the customer ordered in"
                                                   />
                                                   <select
                                                       style={classic ? { fontFamily:xpFont, fontSize:'11px', border:'1px solid #7f9db9', height:'20px', borderRadius:0, padding:'1px 2px', background:'#fff', outline:'none', color:'#000', width:66 } : {width:80}}
                                                       className={classic?'':'form-select form-select-sm'}
                                                       value={line.uom2 || ''}
                                                       onChange={e => handleLineAltChange(idx, { uom2: e.target.value })}
                                                       title="Alternate unit"
                                                   >
                                                       <option value="">Unit</option>
                                                       {(uoms || []).map((u: any) => <option key={u.id} value={u.name}>{u.name}</option>)}
                                                   </select>
                                                   {lineFactors.length > 0 && (
                                                       <select
                                                           style={classic ? { fontFamily:xpFont, fontSize:'11px', border:'1px solid #7f9db9', height:'20px', borderRadius:0, padding:'1px 2px', background: line.uom2_factor ? '#fff8e8' : '#fff', outline:'none', color:'#000', width:96 } : {width:110}}
                                                           className={classic?'':'form-select form-select-sm'}
                                                           value={line.uom2_factor ?? ''}
                                                           onChange={e => handleLineAltChange(idx, { uom2_factor: e.target.value ? parseFloat(e.target.value) : null })}
                                                           title={`How much one ${line.uom2 || 'alt unit'} is`}
                                                       >
                                                           <option value="">factor</option>
                                                           {lineFactors.map((f: any) => (
                                                               <option key={f.id} value={f.value}>
                                                                   x{parseFloat(f.value)} {(f.to_uom_name || 'Yard')}{f.label ? ` (${f.label})` : ''}
                                                               </option>
                                                           ))}
                                                       </select>
                                                   )}
                                               </div>
                                           </div>
                                       );
                                   })()}
                                   <label style={{display:'flex',alignItems:'center',gap:3,cursor:'pointer',margin:0}} title="Customer has not supplied a physical color swatch — untick once it arrives">
                                       <input type="checkbox" checked={!!line.no_color_swatch} onChange={() => handleLineSwatchToggle(idx)} className={classic?'':'form-check-input mt-0'} style={classic?{margin:0}:undefined} />
                                       <span style={{color:classic?'#777':'',fontSize:'9px'}} className={classic?'':'text-muted'}>No swatch</span>
                                   </label>
                                   <button type="button" style={classic?{...xpBtn(),border:'1px solid transparent',background:'transparent',padding:'1px 5px'}:undefined} className={classic?XP_BTN:'btn btn-sm btn-link text-danger p-0'} onClick={() => handleRemoveLine(idx)}>
                                       <i className="bi bi-x-circle" style={{color:classic?'#c00000':''}}></i>
                                   </button>
                               </div>
                           </div>
                       ))}
                       {newSO.lines.length === 0 && <div style={{textAlign:'center',padding:classic?'8px':'8px',fontFamily:classic?xpFont:'',fontSize:classic?'11px':'',color:classic?'#888':'',fontStyle:'italic'}} className={classic?'':'text-center text-muted small fst-italic py-2'}>No items added yet</div>}
                   </div>
               </FormSection>
           </form>
       </ModalWrapper>

       {/* ── Outer shell ── */}
       <ShellWindow classic={classic} fill="page" className="fade-in">
           <ShellTitleBar
               classic={classic}
               icon="bi-receipt-cutoff"
               title={t('sales_orders')}
               subtitle="Manage incoming customer orders"
           />

           {/* ── Secondary toolbar: search + status filters + count + actions ── */}
           <div
               style={classic ? xpToolbar() : undefined}
               className={classic ? '' : 'px-3 py-2 border-bottom d-flex align-items-center gap-2 flex-wrap bg-white'}
           >
               <SearchField classic={classic} value={searchTerm} onChange={setSearchTerm} placeholder="Search PO#…" width={200} grow />
               <SearchField classic={classic} value={customerSearch} onChange={setCustomerSearch} placeholder="Search Customer…" icon="bi-person" width={200} grow />
               {classic && <div style={xpSep}></div>}
               <FilterChipBar classic={classic} options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />
               {classic && <div style={xpSep}></div>}
               <ToolbarCount classic={classic}>
                   {soTotal} order{soTotal !== 1 ? 's' : ''}
               </ToolbarCount>
               <div style={classic ? { display: 'flex', gap: 4, marginLeft: 'auto' } : undefined} className={classic ? undefined : 'd-flex gap-2 ms-auto'}>
                   <ToolbarButton classic={classic} tone="neutral" icon="bi-printer" printable disabled={printLoading} onClick={handleOpenTablePrint}>
                       {printLoading ? 'Loading…' : 'Print Table'}
                   </ToolbarButton>
                   {canManage && (
                       <ToolbarButton classic={classic} tone="create" icon="bi-plus-lg" onClick={() => setIsCreateOpen(true)}>
                           {t('create')}
                       </ToolbarButton>
                   )}
               </div>
           </div>

           {/* ── Table ── */}
           <div className={classic ? '' : 'card-body p-0'} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
               {/* vertical scroll must live on the same element as overflow-x,
                   otherwise sticky headers bind to the inner wrapper and never stick */}
               <div className="table-responsive" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto' }}>
                   {/* `tableLayout: fixed` + minWidth is what keeps the columns at the
                       widths SO_COL_WIDTHS declares: under the default auto layout the
                       browser treats them as hints and reflows every column to fit the
                       viewport, which is what crammed them. Fixed layout means the
                       overflow goes to the horizontal scroller instead. */}
                   <table
                       className={classic ? '' : 'table table-hover align-middle mb-0'}
                       style={classic
                           ? { width: '100%', minWidth: SO_TABLE_MIN_WIDTH, tableLayout: 'fixed', borderCollapse: 'collapse', background: '#fff' }
                           : { width: '100%', minWidth: SO_TABLE_MIN_WIDTH, tableLayout: 'fixed' }}
                   >
                       <colgroup>
                           {SO_COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
                       </colgroup>
                       <thead style={classic ? xpTableHeader : undefined} className={classic ? '' : 'table-light'}>
                           <tr>
                               <SortableTh sort={soSort} colKey="po" onSort={toggleSOSort} style={classic ? xpThCell : {}} className={classic ? '' : 'ps-3'}>PO# / Ref</SortableTh>
                               <SortableTh sort={soSort} colKey="customer" onSort={toggleSOSort} style={classic ? xpThCell : {}}>Customer</SortableTh>
                               <SortableTh sort={soSort} colKey="date" onSort={toggleSOSort} style={classic ? xpThCell : {}}>Date</SortableTh>
                               <th style={classic ? xpThCell : undefined}>Item</th>
                               <th style={classic ? xpThCell : undefined}>Size</th>
                               <th style={classic ? xpThCell : undefined}>Qty</th>
                               <th style={classic ? xpThCell : undefined}>Alt Unit</th>
                               <th style={classic ? xpThCell : undefined}>Stock Notes</th>
                               <th style={classic ? xpThCell : undefined}>Req / Conf</th>
                               <th style={classic ? xpThCell : undefined} title="How much of this line has been produced: its finished-goods output plus the components pegged behind it (greige, warp beams), one share per manufacturing stage. Fulfilment beside it is what has been packed and shipped.">Production Output</th>
                               <th style={classic ? xpThCell : undefined} title="Made -> packed -> shipped against the ordered qty, measured in the item's stocking unit (not the ordered yardage). READY needs packed cartons in stock.">Fulfilment</th>
                               <SortableTh sort={soSort} colKey="status" onSort={toggleSOSort} style={classic ? xpThCell : {}}>Status</SortableTh>
                               <th style={classic ? { ...xpThCell, textAlign: 'right' as const, borderRight: 'none' } : undefined} className={classic ? '' : 'text-end pe-3'}>Actions</th>
                           </tr>
                       </thead>
                       <tbody ref={listBodyRef}>
                           {pageOrders.flatMap((so: any, rowIndex: number) => {
                               const rowBg = lvZebra(classic, rowIndex);
                               const soLines: any[] = so.lines;
                               const lineCount = Math.max(soLines.length, 1);

                               const soTd = (extra: React.CSSProperties = {}): React.CSSProperties => classic
                                   ? { ...tdBase, background: rowBg, verticalAlign: 'middle', borderBottom: '1px solid #c0bdb5', ...extra }
                                   : { background: rowBg, verticalAlign: 'middle', padding: '6px 10px', borderBottom: '1px solid #dee2e6', ...extra };

                               const lineTd = (isFirst: boolean, isLast: boolean, extra: React.CSSProperties = {}): React.CSSProperties => classic
                                   ? { ...tdBase, background: rowBg, paddingTop: 3, paddingBottom: 3, fontSize: '10px', borderBottom: isLast ? '1px solid #c0bdb5' : 'none', borderTop: isFirst ? 'none' : '1px dashed #d0cdc8', ...extra }
                                   : { background: rowBg, padding: '3px 10px', fontSize: '0.78rem', borderBottom: isLast ? '1px solid #dee2e6' : 'none', borderTop: isFirst ? 'none' : '1px dashed #e4e4e4', ...extra };

                               // Served with the row (see _populate_production_runs). Previously a
                               // client-side filter over the windowed /production-runs feed, which
                               // dropped the chip for any SO whose PR aged past the newest 50.
                               const soPRs: any[] = so.production_runs || [];
                               // On-hand FG this order's PR netted away (see _populate_reserved).
                               // Without the chip an order fully covered from stock shows a PR that
                               // created no MOs, which reads as a failed run.
                               const soReserved: number = Number(so.reserved_qty || 0);

                               const poCellContent = (
                                   <>
                                       <CodeChip code={so.po_number} classic={classic} tone="accent" style={{ fontWeight: 'bold' }} />
                                       {so.customer_po_ref && (
                                           <div style={{ fontFamily:xpFont, fontSize:'10px', color:'#666', marginTop:1 }}>
                                               {so.customer_po_ref}
                                           </div>
                                       )}
                                       {soPRs.length > 0 && (
                                           <div style={{ display:'flex', flexWrap:'wrap' as const, gap:2, marginTop:3 }}>
                                               {/* Shared Chip, not a hand-rolled span: the PR chip is clipped by
                                                   this column, and only Chip knows how to pop the full code out on
                                                   hover. It also drops the per-theme green pair this cell used to
                                                   pick for itself — green is the STATUS_FAMILY green. */}
                                               {soPRs.map((pr: any) => (
                                                   <Chip key={pr.id} classic={classic} tone={statusTint('COMPLETED')} bold truncate
                                                       icon="bi-check-circle" size="xs" title={`Go to ${pr.code}`}
                                                       onClick={() => goToPR(pr.code)} style={{ fontFamily: CODE_FONT }}>
                                                       {pr.code}
                                                   </Chip>
                                               ))}
                                           </div>
                                       )}
                                       {soReserved > 0 && (
                                           <div style={{ display:'flex', flexWrap:'wrap' as const, gap:2, marginTop:3 }}>
                                               <Chip classic={classic} tone={statusTint('PENDING')} bold truncate
                                                   icon="bi-box-seam" size="xs"
                                                   title="Part of this order is covered by finished goods already in stock, reserved to it. That part has no manufacturing order."
                                                   onClick={() => openLineage(so)} style={{ fontFamily: CODE_FONT }}>
                                                   {qtyFmt(2)(soReserved)} from stock
                                               </Chip>
                                           </div>
                                       )}
                                   </>
                               );

                               const statusCellContent = (
                                   <>
                                       <StatusChip status={so.status} tint />
                                       {so.delivered_at && <div className="extra-small text-muted mt-1" style={{ fontSize:'9px' }}>Del: {formatDate(so.delivered_at)}</div>}
                                   </>
                               );

                               // One row, icon-only, right-aligned. Lineage is deliberately
                               // LEFT-most so PR keeps the same slot whether or not a lineage
                               // button is present (buttons flow from the right edge).
                               const actionsCellContent = (
                                   <div style={classic ? { display:'flex', gap:2, justifyContent:'flex-end', alignItems:'center' } : undefined} className={classic ? '' : 'd-flex justify-content-end align-items-center gap-1'}>
                                       {soPRs.length > 0 && (
                                           <XPActionButton classic={classic} tone="neutral" icon="bi-diagram-3"
                                               title="View full production lineage — PR, MO, WO and beams created for this SO"
                                               onClick={() => openLineage(so)} />
                                       )}
                                       {so.status === 'PENDING' && (
                                           <XPActionButton classic={classic} tone="primary" icon="bi-collection-play"
                                               title="Create Production Run" onClick={() => onGenerateWO(so)} />
                                       )}
                                       {canManage && (so.status === 'READY' || so.status === 'PARTIAL') && (
                                           <XPActionButton classic={classic} tone="neutral" icon="bi-send"
                                               title="Mark as Sent" onClick={() => onUpdateSOStatus(so.id, 'SENT')} />
                                       )}
                                       {canManage && so.status === 'SENT' && (
                                           <XPActionButton classic={classic} tone="success" icon="bi-check2-all"
                                               title="Mark as Delivered" onClick={() => onUpdateSOStatus(so.id, 'DELIVERED')} />
                                       )}
                                       <MenuTriggerButton classic={classic} onClick={(e) => toggleMenu(so.id, e)} />
                                   </div>
                               );

                               if (soLines.length === 0) {
                                   return [(
                                       <tr key={so.id}>
                                           <td style={soTd()} className={classic ? '' : 'ps-3'}>{poCellContent}</td>
                                           <td style={soTd()}>{so.customer_name}</td>
                                           <td style={soTd({ fontSize:'10px' })} className={classic ? '' : 'small'}>{tzDate(so.order_date)}</td>
                                           <td colSpan={8} style={classic ? { ...tdBase, background:rowBg, borderBottom:'1px solid #c0bdb5', color:'#aaa', fontStyle:'italic', fontSize:'10px' } : { background:rowBg, padding:'6px 10px', borderBottom:'1px solid #dee2e6', color:'#aaa', fontStyle:'italic', fontSize:'0.78rem' }}>No lines</td>
                                           <td style={soTd()}>{statusCellContent}</td>
                                           <td style={soTd({ textAlign:'right' as const, borderRight:'none' })} className={classic ? '' : 'pe-3 text-end'}>{actionsCellContent}</td>
                                       </tr>
                                   )];
                               }

                               return soLines.map((line: any, li: number) => {
                                   const isFirst = li === 0;
                                   const isLast = li === soLines.length - 1;
                                   return (
                                       <tr key={`${so.id}-${li}`}>
                                           {isFirst && (
                                               <>
                                                   <td rowSpan={lineCount} style={soTd()} className={classic ? '' : 'ps-3'}>{poCellContent}</td>
                                                   <td rowSpan={lineCount} style={soTd()}>{so.customer_name}</td>
                                                   <td rowSpan={lineCount} style={soTd({ fontSize:'10px' })} className={classic ? '' : 'small'}>{tzDate(so.order_date)}</td>
                                               </>
                                           )}

                                           {/* Item */}
                                           <td style={lineTd(isFirst, isLast)}>
                                               <div style={{ fontFamily:xpFont, fontSize:'10px', fontWeight:'bold', lineHeight:1.3 }} className={classic ? '' : 'fw-semibold'}>
                                                   {getItemName(line.item_id, line.item_name)}
                                                   {isSample(line.item_id) && <i className="bi bi-star-fill text-warning ms-1" style={{fontSize:'0.6rem'}}></i>}
                                               </div>
                                               {(() => {
                                                   const lineColor = colorLabel(line.color_code, line.color_name) || null;
                                                   const { chips, plainIds } = buildVariantChips(line.attribute_value_ids || [], lineColor, line.color_hex, line.labdip_variant_code);
                                                   return (
                                                       <>
                                                           {plainIds.length > 0 && (
                                                               <div style={{ fontFamily:xpFont, fontSize:'9px', color:'#666', fontStyle:'italic' }}>
                                                                   {plainIds.map(getAttributeValueName).join(', ')}
                                                               </div>
                                                           )}
                                                           {chips.length > 0 && renderChipRow(chips)}
                                                       </>
                                                   );
                                               })()}
                                               {line.no_color_swatch && (
                                                   <div
                                                       style={{ fontFamily:xpFont, fontSize:'9px', fontWeight:'bold', color:'#a33' }}
                                                       title="Customer has not supplied a physical color swatch"
                                                   >
                                                       <i className="bi bi-palette me-1"></i>No Color Swatch
                                                   </div>
                                               )}
                                           </td>

                                           {/* Size */}
                                           <td style={lineTd(isFirst, isLast)}>
                                               {line.size_display ? (() => {
                                                   const { name, measurement } = getLineSizeParts(line);
                                                   return (
                                                       <div style={{ display:'flex', flexWrap:'nowrap' as const, gap:3, alignItems:'center' }}>
                                                           <VariantChip kind="size" classic={classic} title={`Size: ${name}`}>{name}</VariantChip>
                                                           {measurement && (
                                                               <VariantChip kind="size" classic={classic} icon={null} title={`Measurement: ${measurement}`}>{measurement}</VariantChip>
                                                           )}
                                                       </div>
                                                   );
                                               })() : (
                                                   <span style={{ fontFamily:xpFont, fontSize:'9px', color:'#ccc' }}>—</span>
                                               )}
                                           </td>

                                           {/* Qty */}
                                           <td style={lineTd(isFirst, isLast)}>
                                               <div style={{ display:'flex', flexWrap:'nowrap' as const, gap:3, alignItems:'center' }}>
                                                   <Chip classic={classic} size="xs" bold tone={QTY_ORDERED_TONE} title="Quantity ordered">{line.qty} Yd</Chip>
                                                   <Chip classic={classic} size="xs" title="Same quantity in metres">{Math.round(line.qty * 0.9144 * 100) / 100} m</Chip>
                                                   {line.qty_kg != null && line.qty_kg !== '' && (
                                                       <Chip classic={classic} size="xs" tone={variantChipTone('qty')} title="Quantity in kilograms">{line.qty_kg} KG</Chip>
                                                   )}
                                               </div>
                                           </td>

                                           {/* Alt Unit */}
                                           <td style={lineTd(isFirst, isLast)}>
                                               {line.qty2 != null && line.qty2 !== '' && line.uom2 ? (
                                                   (() => {
                                                       const conv = describeUom2(line);
                                                       return (
                                                           <>
                                                               <div style={{ fontFamily:xpFont, fontSize:'10px', color: classic?'#444':'' }}>{line.qty2} {line.uom2}</div>
                                                               {conv && (
                                                                   <div style={{ fontFamily:xpFont, fontSize:'9px', color: conv.drift !== null ? '#c00000' : (classic?'#003ea6':'#0d6efd'), fontWeight: conv.drift !== null ? 'bold' : 'normal', whiteSpace:'nowrap' }}
                                                                       title={conv.drift !== null
                                                                           ? `Does not match Qty: ${conv.total} from the alt unit vs ${line.qty} Yd ordered (${conv.drift > 0 ? '+' : ''}${conv.drift} Yd). Reopen the order and set whichever side is right.`
                                                                           : `1 ${line.uom2} = ${conv.chip.replace('×','')}`}>
                                                                       {conv.drift !== null && <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: 3 }}></i>}
                                                                       {conv.chip}{conv.total ? ` = ${conv.total}` : ''}
                                                                   </div>
                                                               )}
                                                           </>
                                                       );
                                                   })()
                                               ) : (
                                                   <span style={{ fontFamily:xpFont, fontSize:'9px', color:'#ccc' }}>—</span>
                                               )}
                                           </td>

                                           {/* Stock Notes */}
                                           <td style={lineTd(isFirst, isLast)}>
                                               {line.ket_stock ? (
                                                   <div style={{ fontFamily:xpFont, fontSize:'9px', color: classic?'#555':'#666', fontStyle:'italic' }}>{line.ket_stock}</div>
                                               ) : (
                                                   <span style={{ fontFamily:xpFont, fontSize:'9px', color:'#ccc' }}>—</span>
                                               )}
                                           </td>

                                           {/* Req / Conf */}
                                           <td style={lineTd(isFirst, isLast)}>
                                               {line.due_date ? (
                                                   // Past its requested date with no cartons ready to ship — the one
                                                   // case where the date itself is the alarm, so it carries the tint.
                                                   <div style={{ fontFamily:xpFont, fontSize:'9px',
                                                       color: isLineLate(line) ? (classic?'#a80000':'#dc2626') : (classic?'#555':''),
                                                       fontWeight: isLineLate(line) ? 'bold' : undefined }}
                                                       title={isLineLate(line) ? 'Past requested date and not ready to ship' : undefined}>
                                                       <span style={{ color:'#999' }}>Req</span> {formatShortDate(line.due_date)}
                                                       {isLineLate(line) && <i className="bi bi-exclamation-triangle-fill" style={{ marginLeft:3 }}></i>}
                                                   </div>
                                               ) : null}
                                               {line.internal_confirmation_date ? (
                                                   <div style={{ fontFamily:xpFont, fontSize:'9px', color: classic?'#555':'' }}>
                                                       <span style={{ color:'#999' }}>Conf</span> {formatShortDate(line.internal_confirmation_date)}
                                                   </div>
                                               ) : null}
                                               {!line.due_date && !line.internal_confirmation_date && (
                                                   <span style={{ fontFamily:xpFont, fontSize:'9px', color:'#ccc' }}>—</span>
                                               )}
                                           </td>

                                           {/* MO progress */}
                                           <td style={lineTd(isFirst, isLast, { verticalAlign: 'top' })}>{moProgressCell(line)}</td>

                                           {/* Fulfilment */}
                                           <td style={lineTd(isFirst, isLast, { verticalAlign: 'top' })}>{fulfilmentCell(line)}</td>

                                           {isFirst && (
                                               <>
                                                   <td rowSpan={lineCount} style={soTd()}>{statusCellContent}</td>
                                                   <td rowSpan={lineCount} style={soTd({ textAlign:'right' as const, borderRight:'none' })} className={classic ? '' : 'pe-3 text-end'}>{actionsCellContent}</td>
                                               </>
                                           )}
                                       </tr>
                                   );
                               });
                           })}
                           {pageOrders.length === 0 && (dataLoading.salesOrders ? (
                               <TableSkeleton rows={8} cols={skel.cols ?? 13} classic={classic} tdStyle={tdBase} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                           ) : (
                               <tr>
                                   <td
                                       colSpan={13}
                                       style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'center', padding: '24px 8px', color: '#888', fontStyle: 'italic' } : undefined}
                                       className={classic ? '' : 'text-center py-5 text-muted'}
                                   >
                                       {searchTerm || customerSearch || statusFilter !== 'ALL'
                                           ? 'No orders match the current filter.'
                                           : 'No Sales Orders found. Create one to get started.'}
                                   </td>
                               </tr>
                           ))}
                       </tbody>
                   </table>
               </div>
           </div>

           {/* Floating "more actions" menu — Edit / Print / Delete */}
           {openMenuId && (() => {
               const menuSo = pageOrders.find((s: any) => s.id === openMenuId);
               if (!menuSo) return null;
               return (
                   <FloatingMenu
                       pos={menuPos}
                       items={[
                           {
                               key: 'edit', icon: 'bi-pencil', label: 'Edit',
                               hidden: !(canManage && (menuSo.status === 'PENDING' || menuSo.status === 'READY')),
                               onClick: () => { closeMenu(); handleEditOpen(menuSo); },
                           },
                           {
                               key: 'print', icon: 'bi-printer', label: 'Print',
                               onClick: () => { closeMenu(); handlePrintSO(menuSo); },
                           },
                           {
                               key: 'delete', icon: 'bi-trash', label: 'Delete', danger: true,
                               hidden: !canManage,
                               onClick: () => { closeMenu(); onDeleteSO(menuSo.id); },
                           },
                       ]}
                   />
               );
           })()}

           <Pager page={soPage} total={soTotal} pageSize={soPageSize} onPageChange={setSoPage} hideWhenEmpty />

           {/* ── Status bar ── */}
           {classic && (
               <div style={{
                   background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)',
                   borderTop: '1px solid #b0a898',
                   padding: '2px 8px',
                   display: 'flex',
                   gap: '12px',
                   fontFamily: xpFont,
                   fontSize: '10px',
                   color: '#333',
               }}>
                   <span>{Object.values(soStatusCounts).reduce((a: number, b: number) => a + b, 0)} total</span>
                   <span>|</span>
                   <span>{soStatusCounts.PENDING || 0} pending</span>
                   <span>|</span>
                   <span>{soStatusCounts.DELIVERED || 0} delivered</span>
               </div>
           )}
       </ShellWindow>
    </>
  );
}
