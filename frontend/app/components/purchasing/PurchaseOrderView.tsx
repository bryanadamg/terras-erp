import { useState, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import CodeConfigModal, { CodeConfig, buildCodeWithCounter } from '../shared/CodeConfigModal';
import { useToast } from '../shared/Toast';
import { useLanguage } from '../../context/LanguageContext';
import SearchableSelect from '../shared/SearchableSelect';
import TreeSelect, { buildLocationPickerTree } from '../shared/TreeSelect';
const PurchaseOrderPrintModal = dynamic(() => import('./PurchaseOrderPrintModal'), { ssr: false });
import ModalWrapper from '../shared/ModalWrapper';
import { useTheme } from '../../context/ThemeContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useData } from '../../context/DataContext';
import { useUser } from '../../context/UserContext';
import { useSortable, StatusChip, TableSkeleton, useTableSkeletonMetrics, ProgressBar, useFloatingMenu, MenuTriggerButton, FloatingMenu, FormSection, FieldLabel, ExpandedRowPanel, xpBtn, xpInput as xpInputBase, CodeChip, xpFont, rowStateBg, CHIP_RADIUS, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { xpBevel as sharedXpBevel, xpTitleBar as sharedXpTitleBar, xpToolbar as sharedXpToolbar, SearchField, FilterChipBar, ToolbarCount, ToolbarButton } from '../shared/shellTheme';
import Pager from '../shared/Pager';
import { lvThead, lvSubTh, lvSubTd, lvSubTable, lvSubCaption, ExpanderCell, SortableTh, lvThSticky, lvTdRuled, lvZebra } from '../shared/listViewTheme';

export default function PurchaseOrderView({ items, itemResults, onSearchItems, attributes, purchaseOrders, partners, locations, onCreatePO, onEditPO, onDeletePO, onCreateReceipt, onClosePO, companyProfile }: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  // Search / status / page all live in DataContext, which owns the server fetch —
  // `/purchase-orders` is paginated + filtered server-side, so `purchaseOrders`
  // is ONE page, never the whole table.
  const {
      itemIndex, loading: dataLoading, poStatusCounts,
      // aliased: `poTotal` is already this file's per-order money total helper
      pagination: { poPage, setPoPage, poTotal: poRowTotal, pageSize: poPageSize },
      filters: { poSearch: searchTerm, setPoSearch: setSearchTerm, poStatusFilter: statusFilter, setPoStatusFilter: setStatusFilter },
  } = useData();
  const { formatDate: tzDate } = useTimezone();
  const { hasPermission, hasAnyPermission } = useUser();
  const canManage = hasAnyPermission('purchase_order.create', 'purchase_order.edit', 'purchase_order.delete', 'purchase_order.close');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPOId, setEditingPOId] = useState<string | null>(null);
  const [printingPO, setPrintingPO] = useState<any>(null);
  const { uiStyle: currentStyle } = useTheme();
  // Backend origin for static files (delivery-note attachments live at /static, not /api)
  const STATIC_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace(/\/api$/, '');

  // Receipt modal state
  const [receiptTarget, setReceiptTarget] = useState<any>(null);
  const [receiptLineQtys, setReceiptLineQtys] = useState<Record<string, number | ''>>({});
  const [receiptLineBoxes, setReceiptLineBoxes] = useState<Record<string, number | ''>>({});
  const [receiptLineCones, setReceiptLineCones] = useState<Record<string, number | ''>>({});
  const [receiptLineDrums, setReceiptLineDrums] = useState<Record<string, number | ''>>({});
  const [receiptLineLots, setReceiptLineLots] = useState<Record<string, string>>({});
  const [receiptDate, setReceiptDate] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [receiptLocationId, setReceiptLocationId] = useState('');
  const [receiptDnNumber, setReceiptDnNumber] = useState('');
  const [receiptDnDate, setReceiptDnDate] = useState('');
  const [receiptDnFile, setReceiptDnFile] = useState<File | null>(null);

  // Expanded rows for order-line + receipt detail
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  // Floating "more actions" menu (Edit / Close PO / Print / Delete)
  const { openId: openMenuId, pos: menuPos, toggle: toggleMenu, close: closeMenu } = useFloatingMenu();

  const openReceiptModal = (po: any) => {
    // Leave "This Receipt" blank — operator enters actual received qty manually.
    setReceiptLineQtys({});
    setReceiptLineBoxes({});
    setReceiptLineCones({});
    setReceiptLineDrums({});
    setReceiptLineLots({});
    setReceiptDate(new Date().toISOString().split('T')[0]);
    setReceiptNotes('');
    setReceiptLocationId(po.target_location_id || '');
    setReceiptDnNumber('');
    setReceiptDnDate('');
    setReceiptDnFile(null);
    setReceiptTarget(po);
  };

  const handleReceiptSubmit = () => {
    if (!receiptTarget) return;
    const lines = Object.entries(receiptLineQtys)
      .filter(([, qty]) => qty !== '' && Number(qty) > 0)
      .map(([po_line_id, qty_received]) => {
        const itemId = receiptTarget.lines.find((l: any) => l.id === po_line_id)?.item_id;
        const catType = itemId ? getItemCatType(itemId) : null;
        const numOrNull = (v: number | '' | undefined) => (v !== '' && v !== undefined ? Number(v) : null);
        return {
          po_line_id,
          qty_received: Number(qty_received),
          qty_boxes: numOrNull(receiptLineBoxes[po_line_id]),
          qty_cones: catType === 'raw' ? numOrNull(receiptLineCones[po_line_id]) : null,
          qty_drums: (catType === 'chemical' || catType === 'dye') ? numOrNull(receiptLineDrums[po_line_id]) : null,
          vendor_lot: (receiptLineLots[po_line_id] || '').trim() || null,
        };
      });
    if (lines.length === 0) { showToast('Enter qty for at least one line', 'error'); return; }
    if (!receiptLocationId) { showToast('Select a receiving warehouse', 'error'); return; }
    onCreateReceipt(
      receiptTarget.id,
      {
        receipt_date: receiptDate || null,
        notes: receiptNotes || null,
        location_id: receiptLocationId || null,
        delivery_note_number: receiptDnNumber.trim() || null,
        delivery_note_date: receiptDnDate || null,
        lines,
      },
      receiptDnFile,
    );
    setReceiptTarget(null);
  };

  // ── XP shared inline styles ──────────────────────────────────────────────
  const xpBevel: React.CSSProperties = sharedXpBevel();
  const xpTitleBar: React.CSSProperties = sharedXpTitleBar({ flexWrap: 'wrap' as const, gap: '4px' });
  const xpToolbar: React.CSSProperties = sharedXpToolbar();

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

  // Order-lines / receipt-history mini-tables inside the expanded row. These used
  // to be a classic-only const pair plus Bootstrap classNames for modern; both
  // themes now come from the shared sub-table helpers.
  const subTh = lvSubTh(true);
  const subTd = lvSubTd(true);

  const freshPO = () => ({
      po_number: '',
      supplier_id: '',
      target_location_id: '',
      order_date: new Date().toISOString().split('T')[0],
      ssn: '',
      rate_mode: 'kurs_pajak',
      kurs_pajak: '',
      ktbi: '',
      code: '',
      payment_term: '',
      category: '',
      vat_percent: 11 as number,
      discount: 0 as number,
      notes: '',
      lines: [] as any[],
  });

  const [newPO, setNewPO] = useState(freshPO);
  // VAT is optional — the checkbox gates whether vat_percent is sent at all
  // (null = no VAT line) rather than clearing the % field, so re-checking it
  // restores whatever rate was last entered instead of resetting to a default.
  const [vatEnabled, setVatEnabled] = useState(true);

  const [newLine, setNewLine] = useState({ item_id: '', qty: 0, unit_price: '' as number | '', due_date: '', attribute_value_ids: [] as string[] });

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [codeConfig, setCodeConfig] = useState<CodeConfig>({
      prefix: 'PO',
      suffix: '',
      separator: '-',
      includeItemCode: false,
      includeVariant: false,
      variantAttributeNames: [],
      includeYear: true,
      includeMonth: true
  });

  useEffect(() => {
      const savedConfig = localStorage.getItem('real_po_code_config');
      if (savedConfig) {
          try { setCodeConfig(JSON.parse(savedConfig)); } catch (e) {}
      }
  }, []);

  const handleSaveConfig = (newConfig: CodeConfig) => {
      setCodeConfig(newConfig);
      localStorage.setItem('real_po_code_config', JSON.stringify(newConfig));
      setNewPO(prev => ({ ...prev, po_number: suggestPOCode(newConfig) }));
  };

  // `purchaseOrders` is one server page, so this collision scan can propose a code
  // that already exists further down the table. Uniqueness is owned by the server
  // (POST /purchase-orders 400s with "PO Number already exists"), which handleSubmit
  // surfaces as a toast, so the worst case is one rejected save — not a duplicate.
  const suggestPOCode = (config = codeConfig) => {
      let counter = 1;
      let code = buildCodeWithCounter(config, counter);
      while (purchaseOrders.some((s: any) => s.po_number === code)) {
          counter++;
          code = buildCodeWithCounter(config, counter);
      }
      return code;
  };

  useEffect(() => {
      if (isCreateOpen && !newPO.po_number) {
          setNewPO(prev => ({ ...prev, po_number: suggestPOCode() }));
      }
  }, [isCreateOpen]);

  const handleAddLine = () => {
      if (!newLine.item_id || newLine.qty <= 0) return;
      const line = { ...newLine, unit_price: newLine.unit_price === '' ? null : Number(newLine.unit_price) };
      setNewPO({ ...newPO, lines: [...newPO.lines, line] });
      setNewLine({ item_id: '', qty: 0, unit_price: '', due_date: '', attribute_value_ids: [] });
  };

  const handleRemoveLine = (index: number) => {
      setNewPO({ ...newPO, lines: newPO.lines.filter((_, i) => i !== index) });
  };

  // Edit an already-added line's qty in place (no remove + re-add).
  const handleLineQtyChange = (index: number, val: string) => {
      const qty = parseFloat(val) || 0;
      setNewPO(prev => ({
          ...prev,
          lines: prev.lines.map((l: any, i: number) => (i === index ? { ...l, qty } : l)),
      }));
  };

  const handleValueChange = (valId: string, attrId: string) => {
      const attr = attributes.find((a: any) => a.id === attrId);
      if (!attr) return;
      const otherValues = newLine.attribute_value_ids.filter(vid => !attr.values.some((v: any) => v.id === vid));
      setNewLine({...newLine, attribute_value_ids: valId ? [...otherValues, valId] : otherValues});
  };

  const handleEditOpen = (po: any) => {
      setEditingPOId(po.id);
      setNewPO({
          po_number: po.po_number,
          supplier_id: po.supplier_id || '',
          target_location_id: po.target_location_id || '',
          order_date: po.order_date ? po.order_date.split('T')[0] : new Date().toISOString().split('T')[0],
          ssn: po.ssn || '',
          rate_mode: po.rate_mode || 'kurs_pajak',
          kurs_pajak: po.kurs_pajak || '',
          ktbi: po.ktbi || '',
          code: po.code || '',
          payment_term: po.payment_term || '',
          category: po.category || '',
          vat_percent: po.vat_percent != null ? Number(po.vat_percent) : 11,
          discount: po.discount != null ? Number(po.discount) : 0,
          notes: po.notes || '',
          lines: (po.lines || []).map((l: any) => ({
              item_id: l.item_id,
              qty: Number(l.qty),
              unit_price: l.unit_price != null ? Number(l.unit_price) : '',
              due_date: l.due_date ? l.due_date.split('T')[0] : '',
              attribute_value_ids: l.attribute_value_ids || [],
          })),
      });
      setVatEnabled(po.vat_percent != null);
      setIsCreateOpen(true);
  };

  const closeModal = () => { setIsCreateOpen(false); setEditingPOId(null); setNewPO(freshPO()); setVatEnabled(true); };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      const payload = {
          ...newPO,
          supplier_id: newPO.supplier_id || null,
          target_location_id: newPO.target_location_id || null,
          order_date: newPO.order_date || null,
          vat_percent: vatEnabled ? (Number(newPO.vat_percent) || 0) : null,
          discount: Number(newPO.discount) || 0,
          lines: newPO.lines.map((line: any) => ({
              ...line,
              unit_price: line.unit_price === '' ? null : Number(line.unit_price),
              due_date: line.due_date || null,
          })),
      };

      if (editingPOId) {
          const res = await onEditPO(editingPOId, payload);
          if (res && res.ok) {
              closeModal();
              showToast('Purchase Order updated', 'success');
          } else if (res) {
              const err = await res.json().catch(() => ({}));
              showToast(err.detail || 'Failed to update PO', 'error');
          }
          return;
      }

      const res = await onCreatePO(payload);
      if (res && res.status === 400) {
          // Paired with suggestPOCode's page-scoped scan: the server owns uniqueness,
          // so a collision it rejects is recovered here by suffixing rather than left
          // for the user to resolve by hand. Mirrors SalesOrderView's create branch.
          let basePO = newPO.po_number;
          const baseMatch = basePO.match(/^(.*)-(\d+)$/);
          if (baseMatch) basePO = baseMatch[1];
          let counter = 1;
          let suggested = `${basePO}-${counter}`;
          while (purchaseOrders.some((p: any) => p.po_number === suggested)) { counter++; suggested = `${basePO}-${counter}`; }
          showToast(`PO# "${newPO.po_number}" already exists. Suggesting: ${suggested}`, 'warning');
          setNewPO({ ...newPO, po_number: suggested });
      } else if (res && res.ok) {
          closeModal();
          showToast('Purchase Order created', 'success');
      } else if (res) {
          const err = await res.json().catch(() => ({}));
          showToast(err.detail || 'Failed to create PO', 'error');
      }
  };

  // The item picker is a server-side, purchasing-scoped typeahead (itemResults +
  // onSearchItems), so it scales past any client-side cap and doesn't depend on
  // whatever the shared /items page happens to have cached from other tabs.
  // Accumulate every item seen (the context page plus each search page) into a
  // cache so already-added lines and edit-mode lines keep resolving their
  // name/code/uom/category even after they scroll out of the current search page.
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

  const getItemName = (id: string) => resolveItem(id)?.name || itemIndex?.[String(id)]?.name || id;
  const getItemCode = (id: string) => resolveItem(id)?.code || itemIndex?.[String(id)]?.code || id;
  const getItem = (id: string) => resolveItem(id);
  const getItemUom = (id: string) => getItem(id)?.uom || '';
  // Classify by seeded system categories: "Raw Material", "Chemical", "Dye".
  // Falls back to itemIndex (/items/lookup, EVERY item) — resolveItem only covers
  // the current /items page + search results, so PO lines on off-page items used
  // to classify as null and silently lose their Cones/Drums receipt input.
  const getItemCatPath = (id: string): string[] =>
      getItem(id)?.category_path || itemIndex?.[String(id)]?.category_path || [];
  const getItemCatType = (id: string): 'raw' | 'chemical' | 'dye' | null => {
      const path = getItemCatPath(id).map((s: string) => s.toLowerCase());
      if (path.some((p: string) => p.includes('dye'))) return 'dye';
      if (path.some((p: string) => p.includes('chemical'))) return 'chemical';
      if (path.some((p: string) => p.includes('raw material'))) return 'raw';
      return null;
  };
  const getItemCatLabel = (id: string) => {
      const path = getItemCatPath(id);
      return path.length ? path[path.length - 1] : '';
  };

  const getBoundAttributes = (itemId: string) => {
      const item = resolveItem(itemId);
      if (!item || !item.attribute_ids) return [];
      return attributes.filter((a: any) => item.attribute_ids.includes(a.id));
  };

  const currentBoundAttrs = getBoundAttributes(newLine.item_id);

  const getAttributeValueName = (valId: string) => {
      for (const attr of attributes) {
          const val = attr.values.find((v: any) => v.id === valId);
          if (val) return val.value;
      }
      return valId;
  };

  const handlePrintPO = (po: any) => {
      setPrintingPO(po);
  };

  const suppliers = partners.filter((p: any) => p.type === 'SUPPLIER' && p.active);
  const getSupplierName = (id: string) => partners.find((p: any) => p.id === id)?.name || id;

  const STATUS_FILTERS = ['ALL', 'DRAFT', 'RECEIVING', 'RECEIVED'];

  const locPickerTreeOptions = useMemo(() => buildLocationPickerTree(locations || []), [locations]);

  // Value-weighted receiving progress — normalizes across lines of mismatched
  // UOM (kg, cones, drums…) using line value instead of raw qty. Falls back to
  // a plain fraction-of-lines-received when no line on the PO has a price.
  const poProgress = (po: any) => {
      const lines = po.lines || [];
      const totalLines = lines.length;
      const fullLines = lines.filter((l: any) => (l.qty_received || 0) >= l.qty).length;
      const orderedValue = lines.reduce((s: number, l: any) => s + l.qty * (l.unit_price || 0), 0);
      const receivedValue = lines.reduce((s: number, l: any) => s + Math.min(l.qty_received || 0, l.qty) * (l.unit_price || 0), 0);
      const pct = totalLines === 0 ? 0 : orderedValue > 0 ? Math.round((receivedValue / orderedValue) * 100) : Math.round((fullLines / totalLines) * 100);
      return { pct, fullLines, totalLines };
  };

  const poTotal = (po: any) => (po.lines || []).reduce((s: number, l: any) => s + l.qty * (l.unit_price || 0), 0);
  const fmtRp = (n: number) => `Rp ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Days past the latest still-short line's due date — only meaningful while RECEIVING.
  const poOverdueDays = (po: any): number | null => {
      if (po.status !== 'RECEIVING') return null;
      const today = Date.now();
      let maxDays = 0;
      for (const l of po.lines || []) {
          if (!l.due_date || (l.qty_received || 0) >= l.qty) continue;
          const days = Math.floor((today - new Date(l.due_date).getTime()) / 86400000);
          if (days > maxDays) maxDays = days;
      }
      return maxDays > 0 ? maxDays : null;
  };

  // Whole-table counts straight from the server's unfiltered GROUP BY — the chips
  // must keep showing every PO in the system, not just the loaded page.
  const statusCounts = useMemo(() => {
      const allTime = Object.values(poStatusCounts).reduce((a: number, b: number) => a + b, 0);
      return Object.fromEntries(
          STATUS_FILTERS.map(s => [s, s === 'ALL' ? allTime : (poStatusCounts[s] || 0)])
      );
  }, [poStatusCounts]);

  const poSortCols = useMemo(() => ({
      po:       (po: any) => po.po_number,
      supplier: (po: any) => getSupplierName(po.supplier_id),
      date:     (po: any) => po.order_date || po.created_at,
      total:    (po: any) => poTotal(po),
      received: (po: any) => poProgress(po).pct,
      status:   (po: any) => po.status,
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [partners, purchaseOrders]);
  // Filtering/pagination now happen server-side (DataContext fetches the
  // committed/debounced search + status + page); sorting stays client-side over
  // just the current page's ~50 rows.
  const { sorted: pageOrders, sort: poSort, toggle: togglePOSort } = useSortable(purchaseOrders, poSortCols);

  // Skeleton sizing: measure one real row so the placeholders shown on the next
  // load are exactly as tall as the rows that replace them.
  const listBodyRef = useRef<HTMLTableSectionElement>(null);
  const skel = useTableSkeletonMetrics('purchase-orders', listBodyRef, pageOrders.length > 0);

  const statusBadge = (status: string) => <StatusChip status={status} tint />;

  return (
    <div className="fade-in">
       {/* Print Overlay */}
       {printingPO && (
           <PurchaseOrderPrintModal
               po={printingPO}
               onClose={() => setPrintingPO(null)}
               currentStyle={currentStyle}
               companyProfile={companyProfile}
               items={items}
               attributes={attributes}
               partners={partners}
           />
       )}

       <CodeConfigModal
           isOpen={isConfigOpen}
           onClose={() => setIsConfigOpen(false)}
           type="PO"
           onSave={handleSaveConfig}
           initialConfig={codeConfig}
           attributes={attributes}
       />

       {/* Create PO Modal */}
       <ModalWrapper
           isOpen={isCreateOpen}
           modeless
           onClose={closeModal}
           title={<><i className={`bi ${editingPOId ? 'bi-pencil' : 'bi-cart-plus'}`} style={{marginRight:6}}></i>{editingPOId ? 'Edit Purchase Order' : 'Create Purchase Order'}</>}
           variant="success"
           size="xl"
           footer={<>
                   <button type="button" className={XP_BTN} style={xpBtn()} onClick={closeModal}>{t('cancel')}</button>
                   <button type="submit" form="create-po-form" className={XP_BTN} style={xpBtn({ ...BTN_TONES.success, padding: '2px 16px' })}><i className="bi bi-floppy" style={{marginRight:4}}></i>{editingPOId ? 'Update' : t('save')} PO</button>
               </>}
       >
           <form onSubmit={handleSubmit} id="create-po-form">
               <FormSection title="Order Details" classic>
                   <div className="row g-3">
                       <div className="col-md-4">
                           <FieldLabel classic right={<i className="bi bi-gear-fill" style={{cursor:'pointer',color:'#555',fontSize:'11px'}} onClick={() => setIsConfigOpen(true)} title="Configure Auto-Suggestion"></i>}>PO Number</FieldLabel>
                           <input className="form-control" style={xpInput()} placeholder="Auto-generated" value={newPO.po_number} onChange={e => setNewPO({...newPO, po_number: e.target.value})} required />
                       </div>
                       <div className="col-md-5">
                           <FieldLabel classic>Supplier</FieldLabel>
                           <SearchableSelect options={suppliers.map((c: any) => ({ value: c.id, label: c.name, subLabel: c.address }))} value={newPO.supplier_id} onChange={(val) => setNewPO({...newPO, supplier_id: val})} placeholder="Select Supplier…" required />
                       </div>
                       <div className="col-md-3">
                           <FieldLabel classic>Date</FieldLabel>
                           <input type="date" className="form-control" style={xpInput({width:'100%',height:'22px'})} value={newPO.order_date} onChange={e => setNewPO({...newPO, order_date: e.target.value})} required />
                       </div>
                       <div className="col-md-12">
                           <FieldLabel classic>Receiving Warehouse</FieldLabel>
                           <TreeSelect options={locPickerTreeOptions} value={newPO.target_location_id} onChange={(val) => setNewPO({...newPO, target_location_id: val})} placeholder="Select receiving location…" size="sm" style={{ width: '100%' }} />
                       </div>
                   </div>
               </FormSection>

               {/* ── PO Document Details (rendered on the printed PO) ── */}
               <FormSection title="Document Details" classic>
                   <div className="row g-2">
                       <div className="col-md-4">
                           <FieldLabel classic>SSN</FieldLabel>
                           <input className="form-control" style={xpInput()} placeholder="e.g. BI 084/KMK/26/06/09" value={newPO.ssn} onChange={e => setNewPO({...newPO, ssn: e.target.value})} />
                       </div>
                       <div className="col-md-4">
                           <FieldLabel classic>Rate Variant</FieldLabel>
                           <select className="form-select form-select-sm" style={xpInput({height:'22px',borderRadius:0,width:'100%'})} value={newPO.rate_mode} onChange={e => setNewPO({...newPO, rate_mode: e.target.value})}>
                               <option value="kurs_pajak">Kurs Pajak</option>
                               <option value="ktbi">KTBI</option>
                           </select>
                       </div>
                       {newPO.rate_mode === 'ktbi' ? (
                           <div className="col-md-4">
                               <FieldLabel classic>KTBI</FieldLabel>
                               <input className="form-control" style={xpInput()} placeholder="e.g. KTBI value" value={newPO.ktbi} onChange={e => setNewPO({...newPO, ktbi: e.target.value})} />
                           </div>
                       ) : (
                           <div className="col-md-4">
                               <FieldLabel classic>Kurs Pajak</FieldLabel>
                               <input className="form-control" style={xpInput()} placeholder="e.g. Rp 17.805 (09.06.26)" value={newPO.kurs_pajak} onChange={e => setNewPO({...newPO, kurs_pajak: e.target.value})} />
                           </div>
                       )}
                       <div className="col-md-4">
                           <FieldLabel classic>Code</FieldLabel>
                           <input className="form-control" style={xpInput()} value={newPO.code} onChange={e => setNewPO({...newPO, code: e.target.value})} />
                       </div>
                       <div className="col-md-4">
                           <FieldLabel classic>Payment</FieldLabel>
                           <input className="form-control" style={xpInput()} placeholder="e.g. Net 45 days" value={newPO.payment_term} onChange={e => setNewPO({...newPO, payment_term: e.target.value})} />
                       </div>
                       <div className="col-md-4">
                           <FieldLabel classic>Category</FieldLabel>
                           <input className="form-control" style={xpInput()} placeholder="e.g. dsc" value={newPO.category} onChange={e => setNewPO({...newPO, category: e.target.value})} />
                       </div>
                       <div className="col-md-3">
                           <FieldLabel classic right={
                               <label style={{display:'flex',alignItems:'center',gap:4,fontWeight:'normal',cursor:'pointer',fontSize:'10px',color:'#555'}}>
                                   <input type="checkbox" checked={vatEnabled} onChange={e => setVatEnabled(e.target.checked)} />
                                   Include
                               </label>
                           }>VAT %</FieldLabel>
                           <input type="number" className="form-control" disabled={!vatEnabled} style={xpInput({opacity:vatEnabled?1:0.5})} value={newPO.vat_percent} onChange={e => setNewPO({...newPO, vat_percent: parseFloat(e.target.value) || 0})} />
                       </div>
                       <div className="col-md-3">
                           <FieldLabel classic>Discount (Rp)</FieldLabel>
                           <input type="number" className="form-control" style={xpInput()} value={newPO.discount} onChange={e => setNewPO({...newPO, discount: parseFloat(e.target.value) || 0})} />
                       </div>
                       <div className="col-md-6">
                           <FieldLabel classic>Notes</FieldLabel>
                           <input className="form-control" style={xpInput()} placeholder="Optional notes printed on the PO" value={newPO.notes} onChange={e => setNewPO({...newPO, notes: e.target.value})} />
                       </div>
                   </div>
               </FormSection>

               <FormSection title="Order Items" classic>
                   <div className="row g-2 mb-2">
                       <div className="col-4">
                           <FieldLabel classic>Item</FieldLabel>
                           <SearchableSelect options={(itemResults || []).map((item: any) => ({ value: item.id, label: item.name, subLabel: item.code }))} value={newLine.item_id} onChange={(val) => setNewLine({...newLine, item_id: val, attribute_value_ids: []})} onSearch={onSearchItems} placeholder="Select Item…" />
                       </div>
                       <div className="col-2">
                           <FieldLabel classic>Qty</FieldLabel>
                           <input type="number" className="form-control" style={xpInput()} placeholder="0" value={newLine.qty || ''} onChange={e => setNewLine({...newLine, qty: parseFloat(e.target.value)})} />
                       </div>
                       <div className="col-2">
                           <FieldLabel classic>Price (Rp)</FieldLabel>
                           <input type="number" min="0" step="0.01" className="form-control" style={xpInput()} placeholder="0.00" value={newLine.unit_price} onChange={e => setNewLine({...newLine, unit_price: e.target.value === '' ? '' : parseFloat(e.target.value)})} />
                       </div>
                       <div className="col-2">
                           <FieldLabel classic>Expected By</FieldLabel>
                           <input type="date" className="form-control" style={xpInput({width:'100%',height:'22px'})} value={newLine.due_date} onChange={e => setNewLine({...newLine, due_date: e.target.value})} />
                       </div>
                       <div className="col-2 d-flex align-items-end">
                           <button type="button" style={xpBtn({ ...BTN_TONES.success, width: '100%', padding: '2px 6px' })} className={XP_BTN} onClick={handleAddLine} disabled={!newLine.item_id || newLine.qty <= 0}>
                               <i className="bi bi-plus-lg" style={{marginRight:3}}></i>{'Add'}
                           </button>
                       </div>
                       {currentBoundAttrs.length > 0 && (
                           <div className="col-12 mt-1">
                               <div style={{background:'#ffffff',border:'1px solid #b0a898',padding:'4px 6px'}}>
                                   <div style={{fontFamily:xpFont,fontSize:'10px',fontWeight:'bold',color:'#444',marginBottom:4}}>Variants</div>
                                   <div className="row g-2">
                                       {currentBoundAttrs.map((attr: any) => (
                                           <div key={attr.id} className="col-md-4">
                                               <select className="form-select form-select-sm" style={{fontFamily:xpFont,fontSize:'11px',border:'1px solid #7f9db9',height:'22px',borderRadius:0,padding:'1px 4px',background:'#ffffff',outline:'none'}} value={newLine.attribute_value_ids.find(vid => attr.values.some((v: any) => v.id === vid)) || ''} onChange={e => handleValueChange(e.target.value, attr.id)}>
                                                   <option value="">Any {attr.name}</option>
                                                   {attr.values.map((v: any) => <option key={v.id} value={v.id}>{v.value}</option>)}
                                               </select>
                                           </div>
                                       ))}
                                   </div>
                               </div>
                           </div>
                       )}
                   </div>
                   <div>
                       {newPO.lines.map((line: any, idx) => (
                           <div key={idx} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'3px 6px',background:lvZebra(true,idx),border:'1px solid #c0bdb5',marginBottom:2,fontFamily:xpFont,fontSize:'11px'}}>
                               <div>
                                   <span style={{fontWeight:'bold'}}>{getItemName(line.item_id)}</span>
                                   <span style={{color:'#555',marginLeft:8,fontSize:'10px'}}>{getItemCode(line.item_id)}</span>
                                   {getItemUom(line.item_id) && <span style={{display:'inline-block',marginLeft:8,padding:'1px 6px',fontSize:'9px',fontWeight:'bold',background:'#dfe8f5',border:'1px solid #7f9db9',color:'#1a3d6b',borderRadius: CHIP_RADIUS,textTransform:'uppercase'}}>{getItemUom(line.item_id)}</span>}
                                   {getItemCatLabel(line.item_id) && <span style={{display:'inline-block',marginLeft:4,padding:'1px 6px',fontSize:'9px',fontWeight:'bold',background:'#f0e8d8',border:'1px solid #b8a060',color:'#6b4e1a',borderRadius: CHIP_RADIUS}}>{getItemCatLabel(line.item_id)}</span>}
                                   {line.due_date && <span style={{color:'#666',marginLeft:8,fontSize:'10px'}}><i className="bi bi-calendar2" style={{marginRight:3}}></i>{tzDate(line.due_date)}</span>}
                                   {(line.attribute_value_ids||[]).length>0 && <div style={{color:'#666',fontSize:'10px',fontStyle:'italic'}}>{(line.attribute_value_ids||[]).map(getAttributeValueName).join(', ')}</div>}
                               </div>
                               <div style={{display:'flex',alignItems:'center',gap:6}}>
                                   {line.unit_price != null && line.unit_price !== '' && <span style={{color:'#555',fontSize:'10px'}}>@ Rp {Number(line.unit_price).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>}
                                   <span style={{fontWeight:'bold'}}>×</span>
                                   <input type="number" min="0" step="any"
                                       style={xpInput({width:70, textAlign:'right'})}
                                       value={line.qty || ''}
                                       onChange={e => handleLineQtyChange(idx, e.target.value)}
                                       title="Quantity ordered"
                                   />
                                   {getItemUom(line.item_id) && <span style={{color:'#777',fontSize:'9px',fontWeight:'bold',textTransform:'uppercase'}}>{getItemUom(line.item_id)}</span>}
                                   <button type="button" style={{...xpBtn(),border:'1px solid transparent',background:'transparent',padding:'1px 5px'}} className={XP_BTN} onClick={() => handleRemoveLine(idx)}>
                                       <i className="bi bi-x-circle" style={{color:'#c00000'}}></i>
                                   </button>
                               </div>
                           </div>
                       ))}
                       {newPO.lines.length === 0 && <div style={{textAlign:'center',padding:'8px',fontFamily:xpFont,fontSize:'11px',color:'#888',fontStyle:'italic'}}>No items added yet</div>}
                   </div>
               </FormSection>
           </form>
       </ModalWrapper>

       {/* Receive Goods Modal */}
       <ModalWrapper
           isOpen={!!receiptTarget}
           modeless
           onClose={() => setReceiptTarget(null)}
           title={<><i className="bi bi-box-arrow-in-down" style={{marginRight:6}}></i>Receive Goods — {receiptTarget?.po_number}</>}
           variant="success"
           size="xl"
           footer={<>
                   <button type="button" className={XP_BTN} style={xpBtn()} onClick={() => setReceiptTarget(null)}>Cancel</button>
                   <button type="button" className={XP_BTN} style={xpBtn({ ...BTN_TONES.success, padding: '2px 16px' })} onClick={handleReceiptSubmit}><i className="bi bi-check-lg" style={{marginRight:4}}></i>Confirm Receipt</button>
               </>}
       >
           {receiptTarget && (
               <div>
                   <div className="row g-2 mb-3">
                       <div className="col-md-3">
                           <label style={{fontFamily:xpFont,fontSize:'11px',color:'#000',display:'block',marginBottom:2}}>Receipt Date</label>
                           <input type="date" className="form-control" style={xpInput({width:'100%',height:'22px'})} value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
                       </div>
                       <div className="col-md-4">
                           <label style={{fontFamily:xpFont,fontSize:'11px',color:'#000',display:'block',marginBottom:2}}>Receiving Warehouse</label>
                           <TreeSelect options={locPickerTreeOptions} value={receiptLocationId} onChange={(val) => setReceiptLocationId(val)} placeholder="Select warehouse…" size="sm" style={{ width: '100%' }} />
                       </div>
                       <div className="col-md-5">
                           <label style={{fontFamily:xpFont,fontSize:'11px',color:'#000',display:'block',marginBottom:2}}>Notes</label>
                           <input type="text" className="form-control" style={xpInput()} placeholder="e.g. Short delivery, weighed on arrival" value={receiptNotes} onChange={e => setReceiptNotes(e.target.value)} />
                       </div>
                   </div>
                   <div className="row g-2 mb-3">
                       <div className="col-md-3">
                           <label style={{fontFamily:xpFont,fontSize:'11px',color:'#000',display:'block',marginBottom:2}}>Delivery Note No. <span style={{color:'#888'}}>(Surat Jalan)</span></label>
                           <input type="text" className="form-control" style={xpInput({width:'100%'})} placeholder="Supplier's DN number" value={receiptDnNumber} onChange={e => setReceiptDnNumber(e.target.value)} />
                       </div>
                       <div className="col-md-3">
                           <label style={{fontFamily:xpFont,fontSize:'11px',color:'#000',display:'block',marginBottom:2}}>Delivery Note Date</label>
                           <input type="date" className="form-control" style={xpInput({width:'100%',height:'22px'})} value={receiptDnDate} onChange={e => setReceiptDnDate(e.target.value)} />
                       </div>
                       <div className="col-md-6">
                           <label style={{fontFamily:xpFont,fontSize:'11px',color:'#000',display:'block',marginBottom:2}}>Attach Delivery Note <span style={{color:'#888'}}>(PDF / image)</span></label>
                           <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="form-control" style={xpInput({width:'100%'})} onChange={e => setReceiptDnFile(e.target.files?.[0] || null)} />
                       </div>
                   </div>
                   <div style={{overflowX:'auto'}}>
                   <table style={{width:'100%',borderCollapse:'collapse',fontFamily:xpFont,fontSize:'11px'}}>
                       <thead>
                           <tr style={{background:'linear-gradient(to bottom,#ffffff,#d4d0c8)',borderBottom:'2px solid #808080',fontSize:'10px',fontWeight:'bold'}}>
                               <th style={xpThCell}>Item</th>
                               <th style={{...xpThCell,textAlign:'right' as const}}>Ordered</th>
                               <th style={{...xpThCell,textAlign:'right' as const}}>Rcvd So Far</th>
                               <th style={{...xpThCell,textAlign:'right' as const}}>This Receipt</th>
                               <th style={{...xpThCell,textAlign:'right' as const}}>Boxes</th>
                               <th style={{...xpThCell,textAlign:'right' as const}}>Cones</th>
                               <th style={{...xpThCell,textAlign:'right' as const}}>Drum</th>
                               <th style={{...xpThCell,borderRight:'none'}}>Lot No.</th>
                           </tr>
                       </thead>
                       <tbody>
                           {receiptTarget.lines.map((line: any, idx: number) => (
                               <tr key={line.id} style={{background:lvZebra(true,idx),borderBottom:'1px solid #d0cdc8'}}>
                                   <td style={tdBase}>
                                       <div style={{fontWeight:'bold'}}>{line.item_name || getItemName(line.item_id)}</div>
                                       <div style={{fontSize:'10px',color:'#666'}}>{line.item_code || getItemCode(line.item_id)}</div>
                                   </td>
                                   <td style={{...tdBase,textAlign:'right' as const}}>{line.qty}</td>
                                   <td style={{...tdBase,textAlign:'right' as const}}>{line.qty_received || 0}</td>
                                   <td style={{...tdBase,textAlign:'right' as const}}>
                                       <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:4}}>
                                           <input
                                               type="number"
                                               min="0"
                                               step="0.001"
                                               style={xpInput({width:90,textAlign:'right'})}
                                               placeholder="—"
                                               value={receiptLineQtys[line.id] ?? ''}
                                               onChange={e => setReceiptLineQtys(prev => ({ ...prev, [line.id]: e.target.value === '' ? '' : parseFloat(e.target.value) || 0 }))}
                                           />
                                           <span style={{fontSize:'9px',fontWeight:'bold',color:'#1a3d6b',textTransform:'uppercase'}}>{line.item_uom || getItemUom(line.item_id)}</span>
                                       </div>
                                   </td>
                                   <td style={{...tdBase,textAlign:'right' as const}}>
                                       <input
                                           type="number"
                                           min="0"
                                           step="1"
                                           placeholder="—"
                                           style={xpInput({width:60,textAlign:'right'})}
                                           value={receiptLineBoxes[line.id] ?? ''}
                                           onChange={e => setReceiptLineBoxes(prev => ({ ...prev, [line.id]: e.target.value === '' ? '' : parseInt(e.target.value) || 0 }))}
                                       />
                                   </td>
                                   <td style={{...tdBase,textAlign:'right' as const}}>
                                       {getItemCatType(line.item_id) === 'raw' ? (
                                           <input
                                               type="number"
                                               min="0"
                                               step="1"
                                               placeholder="—"
                                               style={xpInput({width:60,textAlign:'right'})}
                                               value={receiptLineCones[line.id] ?? ''}
                                               onChange={e => setReceiptLineCones(prev => ({ ...prev, [line.id]: e.target.value === '' ? '' : parseInt(e.target.value) || 0 }))}
                                           />
                                       ) : <span style={{color:'#bbb'}}>—</span>}
                                   </td>
                                   <td style={{...tdBase,textAlign:'right' as const}}>
                                       {(getItemCatType(line.item_id) === 'chemical' || getItemCatType(line.item_id) === 'dye') ? (
                                           <input
                                               type="number"
                                               min="0"
                                               step="1"
                                               placeholder="—"
                                               style={xpInput({width:60,textAlign:'right'})}
                                               value={receiptLineDrums[line.id] ?? ''}
                                               onChange={e => setReceiptLineDrums(prev => ({ ...prev, [line.id]: e.target.value === '' ? '' : parseInt(e.target.value) || 0 }))}
                                           />
                                       ) : <span style={{color:'#bbb'}}>—</span>}
                                   </td>
                                   <td style={{...tdBase,borderRight:'none'}}>
                                       <input
                                           type="text"
                                           placeholder="Supplier lot (optional)"
                                           style={xpInput({width:120})}
                                           value={receiptLineLots[line.id] ?? ''}
                                           onChange={e => setReceiptLineLots(prev => ({ ...prev, [line.id]: e.target.value }))}
                                       />
                                   </td>
                               </tr>
                           ))}
                       </tbody>
                   </table>
                   </div>
               </div>
           )}
       </ModalWrapper>

       {/* ── Outer shell ── */}
       <div
           style={xpBevel}
       >
           {/* ── Title bar ── */}
           <div style={xpTitleBar}>
                   <span>
                       <i className="bi bi-truck" style={{ marginRight: 6 }}></i>
                       {t('purchase_orders')}
                   </span>
               </div>

           {/* ── Secondary toolbar: search + status filters + count + actions ── */}
           <div
               style={xpToolbar}
           >
               <SearchField classic value={searchTerm} onChange={setSearchTerm} placeholder="Search PO# or supplier…" width={240} grow />
               <div style={xpSep}></div>
               <FilterChipBar
                   classic
                   options={STATUS_FILTERS.map(s => ({ value: s, count: statusCounts[s] }))}
                   value={statusFilter}
                   onChange={setStatusFilter}
               />
               <div style={xpSep}></div>
               <ToolbarCount classic>
                   {poRowTotal} order{poRowTotal !== 1 ? 's' : ''}
               </ToolbarCount>
               {canManage && (
                   <ToolbarButton classic tone="create" icon="bi-plus-lg" style={{ marginLeft: 'auto' }} onClick={() => setIsCreateOpen(true)}>
                       {t('create')}
                   </ToolbarButton>
               )}
           </div>

           {/* ── Table ── */}
           <div>
               {/* vertical scroll must live on the same element as overflow-x,
                   otherwise sticky headers bind to the inner wrapper and never stick */}
               <div className="table-responsive" style={{ height: 'calc(var(--app-vh) - 160px)', overflowY: 'auto' }}>
                   <table
                       style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}
                   >
                       <thead style={xpTableHeader}>
                           <tr>
                               <th style={{ ...xpThCell, width: '20px' }}></th>
                               <SortableTh sort={poSort} colKey="po" onSort={togglePOSort} style={{ ...xpThCell, width: '130px' }}>PO Number</SortableTh>
                               <SortableTh sort={poSort} colKey="supplier" onSort={togglePOSort} style={{ ...xpThCell }}>Supplier</SortableTh>
                               <SortableTh sort={poSort} colKey="date" onSort={togglePOSort} style={{ ...xpThCell, width: '90px' }}>Date</SortableTh>
                               <th style={{ ...xpThCell, width: '70px' }}>Items</th>
                               <SortableTh sort={poSort} colKey="received" onSort={togglePOSort} style={{ ...xpThCell, width: '150px' }}>Received</SortableTh>
                               <SortableTh sort={poSort} colKey="total" onSort={togglePOSort} style={{ ...xpThCell, width: '110px', textAlign: 'right' as const }}>Total</SortableTh>
                               <SortableTh sort={poSort} colKey="status" onSort={togglePOSort} style={{ ...xpThCell, width: '90px' }}>Status</SortableTh>
                               <th style={{ ...xpThCell, textAlign: 'right' as const, borderRight: 'none', width: '96px' }}>Actions</th>
                           </tr>
                       </thead>
                       <tbody ref={listBodyRef}>
                           {pageOrders.map((po: any, rowIndex: number) => (
                               <>
                               <tr
                                   key={po.id}
                                   style={{ background: expandedRows[po.id] ? rowStateBg('expanded', true) : lvZebra(true, rowIndex), borderBottom: expandedRows[po.id] ? 'none' : '1px solid #c0bdb5' }}
                               >
                                   <ExpanderCell classic expanded={!!expandedRows[po.id]} label="items & receipts"
                                       onToggle={() => setExpandedRows(prev => ({ ...prev, [po.id]: !prev[po.id] }))}
                                       tdStyle={tdBase} tdClassName={''} />
                                   <td style={tdBase}>
                                       <CodeChip code={po.po_number} classic tone="accent" style={{ fontWeight: 'bold' }} />
                                   </td>
                                   <td style={tdBase}>{getSupplierName(po.supplier_id)}</td>
                                   <td style={{ ...tdBase, fontSize: '10px' }}>
                                       {tzDate(po.order_date)}
                                   </td>
                                   <td style={tdBase}>
                                       <span
                                               onClick={() => setExpandedRows(prev => ({ ...prev, [po.id]: !prev[po.id] }))}
                                               style={{ borderRadius: CHIP_RADIUS, background: '#e8e8e8', border: '1px solid #6a6a6a', color: '#222', padding: '1px 5px', fontSize: '9px', fontFamily: xpFont, fontWeight: 'bold', cursor: 'pointer' }}
                                               title="Click to view item breakdown"
                                           >
                                               {po.lines.length} item{po.lines.length !== 1 ? 's' : ''}
                                           </span>
                                   </td>
                                   <td style={tdBase}>
                                       {(() => {
                                           const { pct, fullLines, totalLines } = poProgress(po);
                                           return (
                                               <>
                                                   <ProgressBar pct={pct} />
                                                   <div style={{ fontSize: '9px', color: '#666', marginTop: 2, fontFamily: xpFont, fontVariantNumeric: 'tabular-nums' }}>
                                                       {fullLines}/{totalLines} line{totalLines !== 1 ? 's' : ''} · {pct}%
                                                   </div>
                                               </>
                                           );
                                       })()}
                                   </td>
                                   <td style={{ ...tdBase, textAlign: 'right' as const }}>
                                       <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '10px'}}>{fmtRp(poTotal(po))}</span>
                                   </td>
                                   <td style={tdBase}>
                                       {statusBadge(po.status)}
                                       {poOverdueDays(po) != null && (
                                           <span style={{ display: 'block', color: '#c00000', fontSize: '9px', fontWeight: 'bold', marginTop: 2, fontFamily: xpFont }}>
                                               ● {poOverdueDays(po)}d overdue
                                           </span>
                                       )}
                                   </td>
                                   <td style={{ ...tdBase, borderRight: 'none', textAlign: 'right' as const }}>
                                       <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end', alignItems: 'center' }}>
                                           {canManage && po.status !== 'RECEIVED' && (
                                               <button
                                                       className={XP_BTN}
                                                       style={xpBtn({ ...BTN_TONES.success, padding: 0, width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' })}
                                                       title="Receive Goods"
                                                       onClick={() => openReceiptModal(po)}
                                                   >
                                                       <i className="bi bi-box-arrow-in-down"></i>
                                                   </button>)}
                                           <MenuTriggerButton classic onClick={(e) => toggleMenu(po.id, e)} />
                                       </div>
                                   </td>
                               </tr>
                               {/* Expanded: order lines + receipt history */}
                               {expandedRows[po.id] && (
                                   <tr key={`${po.id}-receipts`}>
                                       <td colSpan={9} style={{ padding: 0 }}>
                                           <ExpandedRowPanel classic style={{ padding: '6px 16px 8px 20px', fontFamily: xpFont, fontSize: '11px' }}>
                                           <div style={{ marginBottom: 10 }}>
                                               <div style={lvSubCaption(true)}>Order Lines</div>
                                               <table style={{ ...lvSubTable(true), maxWidth: 560 }}>
                                                   <thead>
                                                       <tr>
                                                           <th style={subTh}>Item</th>
                                                           <th style={{ ...subTh, textAlign: 'right' }}>Received</th>
                                                           <th style={{ ...subTh, textAlign: 'right' }}>Ordered</th>
                                                           <th style={subTh}>Status</th>
                                                       </tr>
                                                   </thead>
                                                   <tbody>
                                                       {po.lines.map((line: any) => {
                                                           const full = (line.qty_received || 0) >= line.qty;
                                                           return (
                                                               <tr key={line.id}>
                                                                   <td style={{ ...subTd, fontWeight: 600 }}>{line.item_name || getItemName(line.item_id)}</td>
                                                                   <td style={{ ...subTd, textAlign: 'right', fontWeight: 'bold' }}>{line.qty_received || 0}</td>
                                                                   <td style={{ ...subTd, textAlign: 'right' }}>{line.qty}</td>
                                                                   <td style={{ ...subTd, color: full ? '#2d7a2d' : '#b8860b', fontWeight: 'bold' }}>
                                                                       {full ? 'full' : 'short'}
                                                                   </td>
                                                               </tr>
                                                           );
                                                       })}
                                                   </tbody>
                                               </table>
                                           </div>
                                           {(po.receipts || []).length === 0 ? (
                                               <span style={{ color: '#888', fontStyle: 'italic' }}>No receipts recorded yet.</span>
                                           ) : (() => {
                                               // One row per delivered line, newest last — replaces a table-per-delivery
                                               // layout that repeated the same header 7x for 7 single-line deliveries.
                                               const allLines = (po.receipts || []).flatMap((receipt: any) =>
                                                   (receipt.lines || []).map((l: any) => ({ ...l, _receipt: receipt }))
                                               );
                                               const hasDn = allLines.some((l: any) => l._receipt.delivery_note_number);
                                               const hasBoxes = allLines.some((l: any) => l.qty_boxes != null);
                                               const hasCones = allLines.some((l: any) => l.qty_cones != null);
                                               const hasDrums = allLines.some((l: any) => l.qty_drums != null);
                                               const hasLots = allLines.some((l: any) => l.vendor_lot);
                                               const hasNotes = allLines.some((l: any) => l._receipt.notes);
                                               const numR = { textAlign: 'right' as const };
                                               return (
                                                   <div>
                                                       <div style={lvSubCaption(true)}>
                                                           Receipt History — {(po.receipts || []).length} {(po.receipts || []).length === 1 ? 'delivery' : 'deliveries'}
                                                       </div>
                                                       <table style={{ ...lvSubTable(true), maxWidth: 760 }}>
                                                           <thead>
                                                               <tr>
                                                                   <th style={subTh}>Date</th>
                                                                   {hasDn && <th style={subTh}>DN</th>}
                                                                   <th style={subTh}>Item</th>
                                                                   <th style={{ ...subTh, ...numR }}>Received</th>
                                                                   {hasBoxes && <th style={{ ...subTh, ...numR }}>Boxes</th>}
                                                                   {hasCones && <th style={{ ...subTh, ...numR }}>Cones</th>}
                                                                   {hasDrums && <th style={{ ...subTh, ...numR }}>Drums</th>}
                                                                   {hasLots && <th style={subTh}>Supplier Lot</th>}
                                                                   {hasNotes && <th style={subTh}>Notes</th>}
                                                               </tr>
                                                           </thead>
                                                           <tbody>
                                                               {allLines.map((rl: any) => (
                                                                   <tr key={rl.id}>
                                                                       <td style={subTd}>{tzDate(rl._receipt.receipt_date)}</td>
                                                                       {hasDn && (
                                                                           <td style={subTd}>
                                                                               {rl._receipt.delivery_note_number || <span style={{ color: '#bbb' }}>—</span>}
                                                                               {rl._receipt.delivery_note_url && (
                                                                                   <a href={`${STATIC_BASE}${rl._receipt.delivery_note_url}`} target="_blank" rel="noopener noreferrer" title="View DN"
                                                                                      style={{ marginLeft: 4, color: '#0046d5' }}>
                                                                                       <i className="bi bi-paperclip" />
                                                                                   </a>
                                                                               )}
                                                                           </td>
                                                                       )}
                                                                       <td style={{ ...subTd, fontWeight: 600 }}>{rl.item_name || getItemName(rl.item_id)}</td>
                                                                       <td style={{ ...subTd, ...numR, fontWeight: 'bold' }}>
                                                                           {rl.qty_received}
                                                                           <span style={{ marginLeft: 3, color: '#888', fontSize: '9px', textTransform: 'uppercase' }}>{rl.item_uom || getItemUom(rl.item_id)}</span>
                                                                       </td>
                                                                       {hasBoxes && <td style={{ ...subTd, ...numR }}>{rl.qty_boxes != null ? rl.qty_boxes : <span style={{ color: '#bbb' }}>—</span>}</td>}
                                                                       {hasCones && <td style={{ ...subTd, ...numR }}>{rl.qty_cones != null ? rl.qty_cones : <span style={{ color: '#bbb' }}>—</span>}</td>}
                                                                       {hasDrums && <td style={{ ...subTd, ...numR }}>{rl.qty_drums != null ? rl.qty_drums : <span style={{ color: '#bbb' }}>—</span>}</td>}
                                                                       {hasLots && <td style={subTd}>{rl.vendor_lot || <span style={{ color: '#bbb' }}>—</span>}</td>}
                                                                       {hasNotes && <td style={{ ...subTd, fontStyle: 'italic', color: '#666' }}>{rl._receipt.notes || ''}</td>}
                                                                   </tr>
                                                               ))}
                                                           </tbody>
                                                       </table>
                                                   </div>
                                               );
                                           })()}
                                           </ExpandedRowPanel>
                                       </td>
                                   </tr>
                               )}
                               </>
                           ))}
                           {pageOrders.length === 0 && (dataLoading.purchaseOrders ? (
                               <TableSkeleton rows={8} cols={skel.cols ?? 9} classic tdStyle={tdBase} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                           ) : (
                               <tr>
                                   <td
                                       colSpan={9}
                                       style={{ ...tdBase, borderRight: 'none', textAlign: 'center', padding: '24px 8px', color: '#888', fontStyle: 'italic' }}
                                   >
                                       {searchTerm || statusFilter !== 'ALL'
                                           ? 'No orders match the current filter.'
                                           : 'No Purchase Orders found. Create one to get started.'}
                                   </td>
                               </tr>
                           ))}
                       </tbody>
                   </table>
               </div>
           </div>

           {/* Floating "more actions" menu — Edit / Close PO / Print / Delete */}
           {openMenuId && (() => {
               const menuPo = pageOrders.find((p: any) => p.id === openMenuId);
               if (!menuPo) return null;
               return (
                   <FloatingMenu
                       pos={menuPos}
                       items={[
                           {
                               key: 'edit', icon: 'bi-pencil', label: 'Edit',
                               hidden: !(canManage && menuPo.status === 'DRAFT'),
                               onClick: () => { closeMenu(); handleEditOpen(menuPo); },
                           },
                           {
                               key: 'close', icon: 'bi-check2-circle', label: 'Close PO (short-received)',
                               title: 'Close PO — mark as received even if quantities are short',
                               hidden: !(canManage && menuPo.status !== 'RECEIVED' && menuPo.status !== 'CANCELLED'),
                               onClick: () => { closeMenu(); onClosePO(menuPo.id); },
                           },
                           {
                               key: 'print', icon: 'bi-printer', label: 'Print',
                               onClick: () => { closeMenu(); handlePrintPO(menuPo); },
                           },
                           {
                               key: 'delete', icon: 'bi-trash', label: 'Delete', danger: true,
                               hidden: !canManage,
                               onClick: () => { closeMenu(); onDeletePO(menuPo.id); },
                           },
                       ]}
                   />
               );
           })()}

           <Pager page={poPage} total={poRowTotal} pageSize={poPageSize} onPageChange={setPoPage} hideWhenEmpty />

           {/* ── Status bar ── */}
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
                   <span>{Object.values(poStatusCounts).reduce((a: number, b: number) => a + b, 0)} total</span>
                   <span>|</span>
                   <span>{poStatusCounts.DRAFT || 0} draft</span>
                   <span>|</span>
                   <span>{poStatusCounts.RECEIVING || 0} in progress</span>
                   <span>|</span>
                   <span>{poStatusCounts.RECEIVED || 0} received</span>
               </div>
       </div>
    </div>
  );
}
