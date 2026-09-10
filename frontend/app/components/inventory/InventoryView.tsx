import React, { useState, useEffect, useMemo, memo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import CodeConfigModal, { CodeConfig, buildCodeWithCounter } from '../shared/CodeConfigModal';
import BulkImportModal from './BulkImportModal';
import HistoryPane from '../shared/HistoryPane';
import ModalWrapper from '../shared/ModalWrapper';
import Pager from '../shared/Pager';
import { useToast } from '../shared/Toast';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { useData } from '../../context/DataContext';
import { useUser } from '../../context/UserContext';
import { XPEmptyState, TableSkeleton, useTableSkeletonMetrics, useSortable, XPActionButton, MenuTriggerButton, FloatingMenu, useFloatingMenu, FormSection, FieldLabel, StatusChip, CodeChip, xpFont, rowStateBg, CHIP_RADIUS, xpInput as xpInputBase, xpBtn as xpBtnBase, BTN_TONES, XP_BTN } from '../shared/xpTheme';
import { xpBevel as sharedXpBevel, xpTitleBar as sharedXpTitleBar, xpToolbar as sharedXpToolbar, SearchField, ToolbarButton, pageFillStyle } from '../shared/shellTheme';
import TreeSelect, { buildCategoryTree, buildLocationPickerTree } from '../shared/TreeSelect';
import { Tabs, TabDef } from '../shared/Tabs';
import { lvThead, useRowSelection, RowCheckbox, SelectAllCheckbox, LV_CHECK_COL_W, SortableTh, lvThSticky, lvTdRuled, lvZebra, Dash } from '../shared/listViewTheme';

// XP-style category badge colours derived from category name
function getCategoryTabIcon(name: string): string {
    const l = (name || '').toLowerCase();
    if (l.includes('raw') || l.includes('material')) return 'bi-droplet-half';
    if (l.includes('wip') || l.includes('work in progress')) return 'bi-gear';
    if (l.includes('finish') || l.includes('good') || l.includes('product')) return 'bi-check2-circle';
    if (l.includes('access') || l.includes('hardware')) return 'bi-tools';
    if (l.includes('pack')) return 'bi-box-seam';
    if (l.includes('beam')) return 'bi-diagram-3';
    return 'bi-folder2';
}

function getCategoryXPStyle(category: string): { bg: string; border: string; color: string } {
    const l = (category || '').toLowerCase();
    if (l.includes('raw') || l.includes('material'))   return { bg: '#fff3e0', border: '#b36b00', color: '#4a2c00' };
    if (l.includes('finish') || l.includes('good') || l.includes('product')) return { bg: '#e8f5e9', border: '#2e7d32', color: '#1b4620' };
    if (l.includes('access') || l.includes('hardware')) return { bg: '#fce4ec', border: '#b71c1c', color: '#6b0000' };
    if (l.includes('pack'))  return { bg: '#e8eaf6', border: '#3949ab', color: '#1a237e' };
    if (l.includes('semi'))  return { bg: '#fff8e1', border: '#c77800', color: '#4a3000' };
    return { bg: '#e8e8e8', border: '#6a6a6a', color: '#222222' };
}

// Memoized Row Component
const InventoryRow = memo(({ item, rowIndex, isEditing, isSelected, onToggleSelect, onViewHistory, onMenu, classic }: any) => {
    // Selected and being-edited are the two shared row states — same fills as
    // every other list (see rowStateBg). This row used to invert to XP selection
    // blue with white text, which meant re-colouring the code chip, the category
    // chip and every link inside it.
    const rowBg = isSelected ? rowStateBg('selected', classic)
        : isEditing ? rowStateBg('highlighted', classic)
        : classic ? lvZebra(true, rowIndex) : undefined;

    const tdBase: React.CSSProperties = classic ? lvTdRuled(true) : {};

    const categoryDisplay = item.category_path?.length ? item.category_path.join(' / ') : (item.category || '');
    const catStyle = classic ? getCategoryXPStyle(categoryDisplay) : null;

    return (
        <tr
            style={{ background: rowBg, ...(classic ? { borderBottom: '1px solid #c0bdb5' } : {}) }}
        >
            <td style={classic ? { ...tdBase, width: LV_CHECK_COL_W, textAlign: 'center' } : { width: LV_CHECK_COL_W }} className={classic ? '' : 'ps-3'}>
                <RowCheckbox classic={classic} checked={isSelected} onChange={() => onToggleSelect(item.id)} label={item.code} />
            </td>
            <td style={classic ? { ...tdBase, width: '110px' } : undefined} className={classic ? '' : 'ps-4'}>
                <CodeChip code={item.code} classic={classic} />
            </td>
            <td style={classic ? { ...tdBase, fontWeight: 'bold' } : undefined}>
                {item.name}
            </td>
            <td style={tdBase}>
                {categoryDisplay ? (
                    classic ? (
                        <span style={{ borderRadius: CHIP_RADIUS,
                            background: catStyle!.bg,
                            border: `1px solid ${catStyle!.border}`,
                            color: catStyle!.color,
                            padding: '1px 5px',
                            fontSize: '9px',
                            fontFamily: xpFont,
                            fontWeight: 'bold',
                            whiteSpace: 'nowrap',
                        }}>
                            {categoryDisplay}
                        </span>
                    ) : (
                        <span className="badge bg-light text-dark border">{categoryDisplay}</span>
                    )
                ) : null}
            </td>
            <td style={classic ? { ...tdBase, width: '55px' } : { width: '55px' }}>
                {classic ? (
                    <span style={{ color: '#333', fontSize: '9px' }}>{item.uom}</span>
                ) : (
                    <span className="text-muted small">{item.uom}</span>
                )}
            </td>
            <td style={tdBase}>
                {item.source_sample_code ? (
                    classic ? (
                        <a
                            href={`/samples?highlight=${item.source_sample_id}`}
                            style={{ color: '#0047c8', fontSize: '9px', fontFamily: xpFont, textDecoration: 'underline', cursor: 'pointer' }}
                            onClick={e => e.stopPropagation()}
                        >
                            ↖ {item.source_sample_code}{item.source_color_name ? ` · ${item.source_color_name}` : ''}
                        </a>
                    ) : (
                        <a
                            href={`/samples?highlight=${item.source_sample_id}`}
                            className="text-primary small fw-medium text-decoration-none"
                            onClick={e => e.stopPropagation()}
                        >
                            <i className="bi bi-arrow-up-left"></i> {item.source_sample_code}{item.source_color_name ? ` · ${item.source_color_name}` : ''}
                        </a>
                    )
                ) : (
                    <Dash classic={classic} />
                )}
            </td>
            <td style={{ ...tdBase, width: '70px' }}>
                {(() => {
                    const vt = item.variant_type;
                    const status = vt === 'color' ? 'COLOR' : vt === 'combo' ? 'COMBO' : 'NONE';
                    const label = vt === 'color' ? 'Color' : vt === 'combo' ? 'Combo' : 'None';
                    return <StatusChip status={status} label={label} tint />;
                })()}
            </td>
            <td style={tdBase}>
                {item.weight_per_unit != null ? (
                    classic ? (
                        <span style={{ color: '#333', fontSize: '9px', whiteSpace: 'nowrap' }}>
                            {item.weight_per_unit} {item.weight_unit || ''}
                        </span>
                    ) : (
                        <span className="text-muted small">{item.weight_per_unit} {item.weight_unit || ''}</span>
                    )
                ) : (
                    <Dash classic={classic} />
                )}
            </td>
            <td style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'right' } : undefined}>
                <div className={classic ? '' : 'd-flex gap-1 justify-content-end'} style={classic ? { display: 'flex', gap: '2px', justifyContent: 'flex-end' } : undefined}>
                    <XPActionButton classic={classic} tone="neutral" icon="bi-clock-history" title="View History" onClick={() => onViewHistory(item.id)} />
                    <MenuTriggerButton classic={classic} onClick={e => onMenu(String(item.id), e)} />
                </div>
            </td>
        </tr>
    );
});

InventoryRow.displayName = 'InventoryRow';

// XP bevel button helper
const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => xpBtnBase({ background: 'linear-gradient(to bottom, #ffffff, #ece9d8)', height: '22px', display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', ...extra });

export default function InventoryView({
    items,
    attributes,
    uoms,
    onCreateItem,
    onUpdateItem,
    onDeleteItem,
    onDeleteMultipleItems,
    onCreateCategory,
    onDownloadTemplate,
    onImportItems,
    onRefresh,
    forcedCategory,
    currentPage,
    totalItems,
    pageSize,
    onPageChange,
    searchTerm,
    onSearchChange,
}: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const router = useRouter();

  const { categories, locations, loading: dataLoading, filters: { categoryL1, setCategoryL1, categoryL2, setCategoryL2, categoryL3, setCategoryL3, itemSearch, setItemSearch } } = useData();
  const { hasPermission, hasAnyPermission } = useUser();
  const canManage = hasAnyPermission('item.create', 'item.edit');
  const canDelete = hasPermission('item.delete');
  const { openId: openMenuId, pos: menuPos, toggle: toggleMenu, close: closeMenu } = useFloatingMenu();
  // UI State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const { uiStyle: currentStyle } = useTheme();

  // Config State
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [codeConfig, setCodeConfig] = useState<CodeConfig>({
      prefix: 'ITM',
      suffix: '',
      separator: '-',
      includeItemCode: false,
      includeVariant: false,
      variantAttributeNames: [],
      includeYear: false,
      includeMonth: false
  });

  // Creation State
  const [newItem, setNewItem] = useState({ code: '', name: '', uom: '', source_sample_id: '', source_color_id: '', source_sample_code: '', source_color_name: '', attribute_ids: [] as string[], variant_type: '' as string, weight_per_unit: '' as string | number, weight_unit: 'g/y', packaging_factor_ids: [] as string[], ends: '' as string | number, lot_tracked: false, is_decoupling_point: false, min_stock_level: '' as string | number, default_source_location_id: '' as string, default_putaway_location_id: '' as string, default_reject_location_id: '' as string });
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);

  // Beam item creation state
  const [createBeam, setCreateBeam] = useState(false);
  const [beamName, setBeamName] = useState('');
  const [beamUom, setBeamUom] = useState('');
  const [beamEnds, setBeamEnds] = useState('');

  // Editing State
  const [editingItem, setEditingItem] = useState<any>(null);
  const [historyEntityId, setHistoryEntityId] = useState<string | null>(null);

  const [newCategoryName, setNewCategoryName] = useState('');
  const [showCatInput, setShowCatInput] = useState(false);

  // Tree memos for TreeSelect components
  const catTreeOptions = useMemo(() => buildCategoryTree(categories), [categories]);
  const locPickerTreeOptions = useMemo(() => buildLocationPickerTree(locations || []), [locations]);

  // Quick-filter tabs, one per root category — same pattern as the Work Orders page
  const categoryTabs: TabDef<string>[] = useMemo(() => [
      { key: 'ALL', label: 'All', icon: 'bi-collection' },
      ...categories
          .filter((c: any) => !c.parent_id)
          .map((c: any) => ({ key: c.id, label: c.name, icon: getCategoryTabIcon(c.name) })),
  ], [categories]);

  const handleCategoryTabChange = (key: string) => {
      setCategoryL2(''); setCategoryL3('');
      setCategoryL1(key === 'ALL' ? '' : key);
  };

  // Filter-level category: maps single TreeSelect value back to L1/L2/L3 DataContext state
  const handleCategoryTreeChange = (id: string) => {
    if (!id) { setCategoryL1(''); setCategoryL2(''); setCategoryL3(''); return; }
    const cat = categories.find((c: any) => c.id === id);
    if (!cat) return;
    if (!cat.parent_id) {
      setCategoryL1(id);
    } else {
      const parent = categories.find((c: any) => c.id === cat.parent_id);
      if (!parent?.parent_id) {
        setCategoryL1(cat.parent_id); setCategoryL2(id);
      } else {
        setCategoryL1(parent.parent_id); setCategoryL2(cat.parent_id); setCategoryL3(id);
      }
    }
  };

  // Form-level category state (for create/edit modals)
  const [formCatL1, setFormCatL1] = useState('');
  const [formCatL2, setFormCatL2] = useState('');
  const [formCatL3, setFormCatL3] = useState('');

  const effectiveFormCategoryId: string | null = formCatL3 || formCatL2 || formCatL1 || null;

  // Maps single TreeSelect value back to formCat L1/L2/L3
  const handleFormCategoryChange = (id: string) => {
    if (!id) { setFormCatL1(''); setFormCatL2(''); setFormCatL3(''); return; }
    const cat = categories.find((c: any) => c.id === id);
    if (!cat) return;
    if (!cat.parent_id) {
      setFormCatL1(id); setFormCatL2(''); setFormCatL3('');
    } else {
      const parent = categories.find((c: any) => c.id === cat.parent_id);
      if (!parent?.parent_id) {
        setFormCatL1(cat.parent_id); setFormCatL2(id); setFormCatL3('');
      } else {
        setFormCatL1(parent.parent_id); setFormCatL2(cat.parent_id); setFormCatL3(id);
      }
    }
  };
  const isBeamCategory = !!effectiveFormCategoryId && (categories.find((c: any) => c.id === effectiveFormCategoryId)?.name || '').toLowerCase() === 'beam';

  const isRawMaterialCategory = !!formCatL1 && (categories.find((c: any) => c.id === formCatL1)?.name || '').toLowerCase().includes('raw');

  // Variant Type (Color/Combo) is a finished-goods concept — only surface the
  // selector when the chosen category tree is Finished Goods.
  const isFinishedGoodsCategory = !!formCatL1 && (categories.find((c: any) => c.id === formCatL1)?.name || '').toLowerCase().includes('finished');

  // Initialize form category state when editing an item
  useEffect(() => {
      if (!editingItem) return;
      const cat = categories.find((c: any) => c.id === editingItem.category_id);
      if (!cat) { setFormCatL1(''); setFormCatL2(''); setFormCatL3(''); return; }
      if (cat.level === 1) {
          setFormCatL1(cat.id); setFormCatL2(''); setFormCatL3('');
      } else if (cat.level === 2) {
          setFormCatL1(cat.parent_id || ''); setFormCatL2(cat.id); setFormCatL3('');
      } else {
          const level2 = categories.find((c: any) => c.id === cat.parent_id);
          setFormCatL1(level2?.parent_id || ''); setFormCatL2(cat.parent_id || ''); setFormCatL3(cat.id);
      }
  }, [editingItem?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
      const savedConfig = localStorage.getItem('item_code_config');
      if (savedConfig) {
          try {
              setCodeConfig(JSON.parse(savedConfig));
          } catch (e) {
              console.error("Invalid config in localstorage");
          }
      }
  }, []);

  // Sync beam name when item name changes and beam name hasn't been manually edited
  const [beamNameManuallyEdited, setBeamNameManuallyEdited] = useState(false);
  useEffect(() => {
      if (!beamNameManuallyEdited) setBeamName(newItem.name ? `Beam - ${newItem.name}` : '');
  }, [newItem.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
      if (!beamUom) setBeamUom(newItem.uom);
  }, [newItem.uom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill create modal when arriving from SampleRequestView's Create Item button
  useEffect(() => {
      const sourceSampleId = searchParams.get('source_sample_id');
      const sourceColorId = searchParams.get('source_color_id');
      const suggestedCode = searchParams.get('suggested_code');
      const sourceSampleCode = searchParams.get('source_sample_code');
      const sourceColorName = searchParams.get('source_color_name');

      if (sourceSampleId && suggestedCode) {
          const autoCode = suggestItemCode();
          setNewItem(prev => ({
              ...prev,
              code: autoCode,
              name: autoCode,
              source_sample_id: sourceSampleId,
              source_color_id: sourceColorId || '',
              source_sample_code: sourceSampleCode || '',
              source_color_name: sourceColorName || '',
          }));
          setIsCreateOpen(true);
          router.replace('/inventory');
      }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveConfig = (newConfig: CodeConfig) => {
      setCodeConfig(newConfig);
      localStorage.setItem('item_code_config', JSON.stringify(newConfig));
      const suggested = suggestItemCode(newConfig);
      setNewItem(prev => ({ ...prev, code: suggested, name: nameManuallyEdited ? prev.name : suggested }));
  };

  const suggestItemCode = (config = codeConfig) => {
      let counter = 1;
      let code = buildCodeWithCounter(config, counter);
      while (items.some((i: any) => i.code === code)) {
          counter++;
          code = buildCodeWithCounter(config, counter);
      }
      return code;
  };

  const openCreateModal = () => {
      if (!newItem.code) {
          const suggested = suggestItemCode();
          setNewItem(prev => ({ ...prev, code: suggested, name: nameManuallyEdited ? prev.name : suggested }));
      }
      setIsCreateOpen(true);
  };

  // --- Item Handlers ---

  const handleSubmitItem = async (e: React.FormEvent) => {
      e.preventDefault();
      const payload: any = { ...newItem };
      delete payload.category;
      payload.category_id = effectiveFormCategoryId;
      if (!payload.source_sample_id) delete payload.source_sample_id;
      if (!payload.source_color_id) delete payload.source_color_id;
      delete payload.source_sample_code;
      delete payload.source_color_name;
      if (payload.weight_per_unit === '' || payload.weight_per_unit === null) { delete payload.weight_per_unit; delete payload.weight_unit; }
      if (payload.ends === '' || payload.ends === null) { delete payload.ends; } else { payload.ends = parseInt(payload.ends); }
      if (payload.min_stock_level === '' || payload.min_stock_level === null || payload.min_stock_level === undefined) { delete payload.min_stock_level; } else { payload.min_stock_level = parseFloat(payload.min_stock_level); }
      if (!payload.default_source_location_id) { delete payload.default_source_location_id; }
      if (!payload.default_putaway_location_id) { delete payload.default_putaway_location_id; }
      if (!payload.default_reject_location_id) { delete payload.default_reject_location_id; }
      if (!payload.variant_type) delete payload.variant_type;

      const res = await onCreateItem(payload);

      if (res && res.status === 400) {
          let baseCode = newItem.code;
          const baseMatch = baseCode.match(/^(.*)-(\d+)$/);
          if (baseMatch) baseCode = baseMatch[1];

          let counter = 1;
          let suggestedCode = `${baseCode}-${counter}`;

          while (items.some((i: any) => i.code === suggestedCode)) {
              counter++;
              suggestedCode = `${baseCode}-${counter}`;
          }

          showToast(`Item Code "${newItem.code}" already exists. Suggesting: ${suggestedCode}`, 'warning');
          setNewItem({ ...newItem, code: suggestedCode });
      } else if (res && res.ok) {
          if (createBeam && isRawMaterialCategory) {
              const wipCategory = categories.find((c: any) => (c.name || '').toLowerCase().includes('wip') || (c.name || '').toLowerCase().includes('work in progress'));
              const beamCategory = categories.find((c: any) => (c.name || '').toLowerCase() === 'beam');
              const beamPayload: any = {
                  code: `BEAM-${newItem.code}`,
                  name: beamName || `Beam - ${newItem.name}`,
                  uom: beamUom || newItem.uom,
                  category_id: beamCategory?.id || wipCategory?.id || effectiveFormCategoryId,
                  attribute_ids: [],
                  ...(beamEnds ? { ends: parseInt(beamEnds) } : {}),
              };
              const beamRes = await onCreateItem(beamPayload);
              if (beamRes && beamRes.ok) {
                  showToast(`Created "${newItem.code}" and "BEAM-${newItem.code}"`, 'success');
              } else {
                  showToast(`Item created but beam item failed — create BEAM-${newItem.code} manually`, 'warning');
              }
          } else {
              showToast('Item created successfully', 'success');
          }
          setNewItem({ code: '', name: '', uom: '', source_sample_id: '', source_color_id: '', source_sample_code: '', source_color_name: '', attribute_ids: [], variant_type: '', weight_per_unit: '', weight_unit: 'g/y', packaging_factor_ids: [], ends: '', lot_tracked: false, is_decoupling_point: false, min_stock_level: '', default_source_location_id: '', default_putaway_location_id: '', default_reject_location_id: '' });
          setFormCatL1(''); setFormCatL2(''); setFormCatL3('');
          setNameManuallyEdited(false);
          setCreateBeam(false); setBeamName(''); setBeamUom(''); setBeamEnds('');
          setIsCreateOpen(false);
      } else {
          showToast('Failed to create item. See console.', 'danger');
          console.error("Create Item Failed", res);
      }
  };

  const handleUpdateItemSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingItem) return;

      const payload: any = {
          code: editingItem.code,
          name: editingItem.name,
          uom: editingItem.uom,
          category_id: effectiveFormCategoryId,
          attribute_ids: editingItem.attribute_ids || [],
          variant_type: editingItem.variant_type || null,
          packaging_factor_ids: editingItem.packaging_factor_ids || [],
          source_sample_id: editingItem.source_sample_id || null,
          source_color_id: editingItem.source_color_id || null,
          weight_per_unit: editingItem.weight_per_unit || null,
          weight_unit: editingItem.weight_per_unit ? (editingItem.weight_unit || 'gsm') : null,
          lot_tracked: !!editingItem.lot_tracked,
          is_decoupling_point: !!editingItem.is_decoupling_point,
          min_stock_level: (editingItem.min_stock_level === '' || editingItem.min_stock_level === null || editingItem.min_stock_level === undefined) ? null : parseFloat(editingItem.min_stock_level),
          default_source_location_id: editingItem.default_source_location_id || null,
          default_putaway_location_id: editingItem.default_putaway_location_id || null,
          default_reject_location_id: editingItem.default_reject_location_id || null,
      };

      onUpdateItem(editingItem.id, payload);
      setEditingItem(null);
  };

  const toggleAttribute = (id: string, isEdit: boolean) => {
      if (isEdit) {
          const current = editingItem.attribute_ids || [];
          if (current.includes(id)) {
              setEditingItem({...editingItem, attribute_ids: current.filter((a:string) => a !== id)});
          } else {
              setEditingItem({...editingItem, attribute_ids: [...current, id]});
          }
      } else {
          const current = newItem.attribute_ids;
          if (current.includes(id)) {
              setNewItem({...newItem, attribute_ids: current.filter(a => a !== id)});
          } else {
              setNewItem({...newItem, attribute_ids: [...current, id]});
          }
      }
  };

  const handleAddCategory = () => {
      if (newCategoryName) {
          onCreateCategory(newCategoryName);
          setNewCategoryName('');
          setShowCatInput(false);
      }
  };

  // Derived
  const activeEditingItem = editingItem ? items.find((i: any) => i.id === editingItem.id) : null;

  const filteredItems = useMemo(() => {
      if (!forcedCategory) return items;
      // When forcedCategory is set, filter by category_path or fallback to category string
      return items.filter((i: any) => {
          if (i.category_path?.length) return i.category_path.includes(forcedCategory);
          return i.category === forcedCategory;
      });
  }, [items, forcedCategory]);

  const sortCols = useMemo(() => ({
      code:     (i: any) => i.code,
      name:     (i: any) => i.name,
      category: (i: any) => i.category,
      weight:   (i: any) => i.weight_per_unit ?? null,
  }), []);
  const { sorted: sortedItems, sort, toggle: toggleSort } = useSortable(filteredItems, sortCols);

  // Skeleton sizing: measure one real row so the placeholders shown on the next
  // load are exactly as tall as the rows that replace them.
  const listBodyRef = useRef<HTMLTableSectionElement>(null);
  const skel = useTableSkeletonMetrics('items', listBodyRef, sortedItems.length > 0);

  // Select-all is page-scoped and ticked rows keep their row object, so the
  // per-page reset this used to need (selection was ids against one page) is gone.
  const sel = useRowSelection<any>(sortedItems, (i: any) => i.id);

  const handleBulkDelete = async () => {
      if (onDeleteMultipleItems) {
          await onDeleteMultipleItems(sel.keys);
          sel.clear();
      }
  };

  const handleEdit = (item: any) => {
      setEditingItem({...item, attribute_ids: item.attribute_ids || [], packaging_factor_ids: (item.packaging_factor_ids || []).map(String)});
  };

  const classic = currentStyle === 'classic';

  // Variant Type selector (None / Color / Combo) — replaces the old per-item
  // attribute checkbox. 'color' -> SO picker reads the Color Library; 'combo' ->
  // Combo Library (gates BOM). Shared by the create and edit forms.
  const renderVariantTypeSelector = (value: string, onChange: (v: string) => void, keyPrefix: string) => {
      const opts = [
          { val: '', label: 'None', hint: 'No color/combo variant' },
          { val: 'color', label: 'Color', hint: 'Ordered shade picked from Color Library' },
          { val: 'combo', label: 'Combo', hint: 'Woven combo picked from Combo Library' },
      ];
      return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {opts.map(o => (
                  <label
                      key={o.val || 'none'}
                      htmlFor={`${keyPrefix}-vt-${o.val || 'none'}`}
                      style={classic ? { display: 'flex', alignItems: 'center', gap: 6, fontFamily: xpFont, fontSize: '11px', color: '#000', cursor: 'pointer' } : undefined}
                      className={classic ? '' : 'form-check d-flex align-items-center gap-2'}
                  >
                      <input
                          type="radio"
                          id={`${keyPrefix}-vt-${o.val || 'none'}`}
                          name={`${keyPrefix}-variant-type`}
                          className={classic ? '' : 'form-check-input'}
                          style={classic ? { cursor: 'pointer', margin: 0 } : { marginTop: 0 }}
                          checked={(value || '') === o.val}
                          onChange={() => onChange(o.val)}
                      />
                      <span><b>{o.label}</b> <span style={{ color: classic ? '#888' : undefined, fontSize: classic ? '10px' : undefined }} className={classic ? '' : 'text-muted small'}>— {o.hint}</span></span>
                  </label>
              ))}
          </div>
      );
  };

  // ── XP shared inline styles ──────────────────────────────────────────────
  const xpBevel: React.CSSProperties = sharedXpBevel();
  const xpTitleBar: React.CSSProperties = sharedXpTitleBar();
  const xpToolbar: React.CSSProperties = sharedXpToolbar();

  const xpInput: React.CSSProperties = xpInputBase({ boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)' });

  const xpSelect: React.CSSProperties = {
      fontFamily: xpFont,
      fontSize: 11,
      border: '1px solid #7f9db9',
      background: '#fff',
      padding: '2px 4px',
  };

  const xpSep: React.CSSProperties = {
      width: '1px',
      height: '20px',
      background: '#a0988c',
      margin: '0 2px',
      flexShrink: 0,
  };

  const xpTableHeader: React.CSSProperties = lvThead(true);

  const xpThCell: React.CSSProperties = lvThSticky(true);

  const xpStatusBar: React.CSSProperties = {
      background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)',
      borderTop: '1px solid #b0a898',
      padding: '2px 8px',
      fontFamily: xpFont,
      fontSize: '10px',
      color: '#222222',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
  };

  return (
    <div className="row g-4 fade-in">
      <CodeConfigModal
           isOpen={isConfigOpen}
           onClose={() => setIsConfigOpen(false)}
           type="ITEM"
           onSave={handleSaveConfig}
           initialConfig={codeConfig}
           attributes={attributes}
       />

       <BulkImportModal
           isOpen={isImportOpen}
           onClose={() => setIsImportOpen(false)}
           onImport={onImportItems}
           onDownloadTemplate={onDownloadTemplate}
           title="Bulk Import Items"
       />

      {/* Create Modal */}
      <ModalWrapper
          isOpen={isCreateOpen}
          modeless
          onClose={() => { setIsCreateOpen(false); setNameManuallyEdited(false); setFormCatL1(''); setFormCatL2(''); setFormCatL3(''); setCreateBeam(false); setBeamName(''); setBeamUom(''); setBeamNameManuallyEdited(false); }}
          title={<span data-testid="modal-title"><i className="bi bi-box-seam me-2"></i>{t('create')} {forcedCategory ? t('sample_masters') : t('item_inventory')}</span>}
          variant="primary"
          size="md"
          footer={
              <>
                  <button
                      type="button"
                      style={classic ? xpBtn() : undefined}
                      className={classic ? XP_BTN : 'btn btn-secondary'}
                      onClick={() => { setIsCreateOpen(false); setNameManuallyEdited(false); setFormCatL1(''); setFormCatL2(''); setFormCatL3(''); setCreateBeam(false); setBeamName(''); setBeamUom(''); setBeamNameManuallyEdited(false); }}
                  >{t('cancel')}</button>
                  <button
                      data-testid="submit-create-item"
                      type="button"
                      style={classic ? xpBtn({ ...BTN_TONES.primary }) : undefined}
                      className={classic ? XP_BTN : 'btn btn-primary fw-bold px-4'}
                      onClick={() => (document.getElementById('create-item-form') as HTMLFormElement)?.requestSubmit()}
                  >{createBeam && isRawMaterialCategory ? 'Create 2 Items' : t('create')}</button>
              </>
          }
      >
          <form id="create-item-form" onSubmit={handleSubmitItem} data-testid="create-item-modal">
            <FormSection title="Basic Info" classic={classic}>
              <div className="mb-3" style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                      <FieldLabel classic={classic}>{t('item_code')}</FieldLabel>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <input data-testid="item-code-input" style={classic ? { ...xpInput, flex: 1, minWidth: 0 } : undefined} className={classic ? '' : 'form-control'} placeholder="ITM-001" value={newItem.code} onChange={e => {
                              const code = e.target.value;
                              setNewItem(prev => ({ ...prev, code, name: nameManuallyEdited ? prev.name : code }));
                          }} required />
                          <i className="bi bi-gear-fill text-muted" style={{cursor: 'pointer', flexShrink: 0}} onClick={() => setIsConfigOpen(true)} title="Configure Auto-Suggestion"></i>
                      </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                      <FieldLabel classic={classic}>{t('item_name')}</FieldLabel>
                      <input data-testid="item-name-input" style={classic ? { ...xpInput, width: '100%' } : undefined} className={classic ? '' : 'form-control'} placeholder="Product Name" value={newItem.name} onChange={e => {
                          setNameManuallyEdited(true);
                          setNewItem(prev => ({ ...prev, name: e.target.value }));
                      }} required />
                  </div>
              </div>
              <div className="mb-1" style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                      <FieldLabel classic={classic}>{t('categories')}</FieldLabel>
                      <TreeSelect
                          options={catTreeOptions}
                          value={effectiveFormCategoryId || ''}
                          onChange={handleFormCategoryChange}
                          allowEmpty
                          emptyLabel="— None —"
                          size="sm"
                          style={{ width: '100%' }}
                      />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                      <FieldLabel classic={classic}>{t('uom')}</FieldLabel>
                      <select data-testid="uom-select" style={classic ? { ...xpInput, height: 'auto', padding: '2px 4px', width: '100%' } : undefined} className={classic ? '' : 'form-select'} value={newItem.uom} onChange={e => setNewItem({...newItem, uom: e.target.value, packaging_factor_ids: []})} required>
                          <option value="">Unit...</option>
                          {(uoms || []).map((u: any) => <option key={u.id} value={u.name}>{u.name}</option>)}
                      </select>
                  </div>
              </div>
            </FormSection>

            <FormSection title="Packaging & Weight" classic={classic}>
              {/* Packaging Units */}
              <div className="mb-3">
                {classic ? (
                  <div>
                    <FieldLabel classic={classic} hint={!newItem.uom ? undefined : 'Extra units this item can also be counted/received in'}>Packaging Units</FieldLabel>
                    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
                      {(() => {
                        const factors = (uoms || []).flatMap((u: any) => (u.factors || []).filter((f: any) => f.to_uom_name === newItem.uom));
                        if (!newItem.uom) return <span style={{ fontSize: '10px', color: '#aaa', fontStyle: 'italic' }}>Select a UoM first</span>;
                        if (factors.length === 0) return <span style={{ fontSize: '10px', color: '#aaa', fontStyle: 'italic' }}>No packaging units defined for this UoM</span>;
                        return factors.map((f: any) => {
                          const active = newItem.packaging_factor_ids.includes(String(f.id));
                          return (
                            <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '56px 1fr', alignItems: 'center' }}>
                              <span style={{ fontFamily: xpFont, fontSize: '11px', color: '#000' }}>{f.from_uom_name}</span>
                              <div>
                                <button type="button"
                                  style={{
                                    fontFamily: xpFont, fontSize: '10px',
                                    padding: '0 5px', height: '18px', cursor: 'pointer',
                                    borderRadius: 0, border: '1px solid',
                                    borderColor: active ? '#1a3a7a #0a2a5a #0a2a5a #1a3a7a' : '#dfdfdf #808080 #808080 #dfdfdf',
                                    background: active ? 'linear-gradient(to bottom, #316ac5, #1a4a8a)' : 'linear-gradient(to bottom, #ffffff, #d4d0c8)',
                                    color: active ? '#fff' : '#000',
                                  }}
                                  onClick={() => setNewItem(prev => ({
                                    ...prev,
                                    packaging_factor_ids: active
                                      ? prev.packaging_factor_ids.filter((id: string) => id !== String(f.id))
                                      : [...prev.packaging_factor_ids, String(f.id)],
                                  }))}
                                >
                                  &times;{parseFloat(f.value)} {newItem.uom}
                                </button>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="form-label small text-muted">Packaging Units</label>
                    <div className="border rounded p-2" style={{ background: '#f8f9fa' }}>
                      {(() => {
                        const factors = (uoms || []).flatMap((u: any) => (u.factors || []).filter((f: any) => f.to_uom_name === newItem.uom));
                        if (!newItem.uom) return <small className="text-muted fst-italic">Select a UoM first</small>;
                        if (factors.length === 0) return <small className="text-muted fst-italic">No packaging units defined for this UoM</small>;
                        return (
                          <div className="d-flex flex-column gap-1">
                            {factors.map((f: any) => {
                              const active = newItem.packaging_factor_ids.includes(String(f.id));
                              return (
                                <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '56px 1fr', alignItems: 'center' }}>
                                  <small className="text-muted">{f.from_uom_name}</small>
                                  <button type="button"
                                    className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}`}
                                    style={{ fontSize: 10, padding: '1px 6px', width: 'fit-content' }}
                                    onClick={() => setNewItem(prev => ({
                                      ...prev,
                                      packaging_factor_ids: active
                                        ? prev.packaging_factor_ids.filter((id: string) => id !== String(f.id))
                                        : [...prev.packaging_factor_ids, String(f.id)],
                                    }))}
                                  >
                                    &times;{parseFloat(f.value)} {newItem.uom}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              <div className="row g-2 mb-1">
                  <div className="col-5">
                      <FieldLabel classic={classic}>Weight / Unit</FieldLabel>
                      <input
                          style={classic ? xpInput : undefined}
                          className={classic ? '' : 'form-control'}
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="e.g. 280"
                          value={newItem.weight_per_unit}
                          onChange={e => setNewItem({...newItem, weight_per_unit: e.target.value})}
                      />
                  </div>
                  <div className="col-4">
                      <FieldLabel classic={classic}>Unit</FieldLabel>
                      <select
                          style={classic ? { ...xpInput, height: 'auto', padding: '2px 4px', width: '100%' } : undefined}
                          className={classic ? '' : 'form-select'}
                          value={newItem.weight_unit}
                          onChange={e => setNewItem({...newItem, weight_unit: e.target.value})}
                      >
                          <option value="gsm">gsm</option>
                          <option value="g/m²">g/m²</option>
                          <option value="oz/yd²">oz/yd²</option>
                          <option value="g/y">g/y</option>
                      </select>
                  </div>
              </div>
            </FormSection>

            <FormSection title="Inventory Settings" classic={classic}>
              <div className="mb-1">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                          style={classic ? { cursor: 'pointer' } : undefined}
                          className={classic ? '' : 'form-check-input'}
                          type="checkbox"
                          id="new-lot-tracked"
                          checked={newItem.lot_tracked}
                          onChange={e => setNewItem({ ...newItem, lot_tracked: e.target.checked })}
                      />
                      <label
                          style={classic ? { fontFamily: xpFont, fontSize: '11px', fontWeight: 'bold', color: '#2b2822', cursor: 'pointer', margin: 0 } : { margin: 0 }}
                          className={classic ? '' : 'form-check-label small fw-semibold'}
                          htmlFor="new-lot-tracked"
                      >Lot tracked</label>
                  </div>
                  <div
                      style={classic ? { fontFamily: xpFont, fontSize: 10, color: '#938c76', fontStyle: 'italic', margin: '1px 0 3px 20px' } : undefined}
                      className={classic ? '' : 'text-muted small fst-italic mb-1'}
                  >Every receipt, production output and transfer requires a lot number</div>
              </div>

              <div className="mb-1">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                          style={classic ? { cursor: 'pointer' } : undefined}
                          className={classic ? '' : 'form-check-input'}
                          type="checkbox"
                          id="new-decoupling-point"
                          checked={newItem.is_decoupling_point}
                          onChange={e => setNewItem({ ...newItem, is_decoupling_point: e.target.checked })}
                      />
                      <label
                          style={classic ? { fontFamily: xpFont, fontSize: '11px', fontWeight: 'bold', color: '#2b2822', cursor: 'pointer', margin: 0 } : { margin: 0 }}
                          className={classic ? '' : 'form-check-label small fw-semibold'}
                          htmlFor="new-decoupling-point"
                      >Make-to-stock (decoupling point)</label>
                  </div>
                  <div
                      style={classic ? { fontFamily: xpFont, fontSize: 10, color: '#938c76', fontStyle: 'italic', margin: '1px 0 3px 20px' } : undefined}
                      className={classic ? '' : 'text-muted small fst-italic mb-1'}
                  >Never auto-planned inside a parent order — demand is pooled and produced on its own standalone order</div>
              </div>

              <div className="mb-3">
                  <FieldLabel classic={classic} hint="Flags low stock when total on-hand drops below this. Blank = default (10).">Reorder point (min stock)</FieldLabel>
                  <input
                      type="number" min="0" step="any"
                      style={classic ? { ...xpInput, height: 'auto', padding: '2px 4px', width: '100%' } : undefined}
                      className={classic ? '' : 'form-control'}
                      value={newItem.min_stock_level}
                      onChange={e => setNewItem({ ...newItem, min_stock_level: e.target.value })}
                      placeholder="10"
                  />
              </div>

              <div className="mb-1">
                  <FieldLabel classic={classic} hint="Where this item is normally pulled from when staging to production">Default source location</FieldLabel>
                  <TreeSelect
                      options={locPickerTreeOptions}
                      value={newItem.default_source_location_id}
                      onChange={id => setNewItem({ ...newItem, default_source_location_id: id })}
                      allowEmpty
                      emptyLabel="— None —"
                      size="sm"
                      style={{ width: '100%' }}
                  />
              </div>

              <div className="mb-1">
                  <FieldLabel classic={classic} hint="Preferred bin for this item's production output — pre-fills the MO putaway suggestion">Default putaway location</FieldLabel>
                  <TreeSelect
                      options={locPickerTreeOptions}
                      value={newItem.default_putaway_location_id}
                      onChange={id => setNewItem({ ...newItem, default_putaway_location_id: id })}
                      allowEmpty
                      emptyLabel="— None —"
                      size="sm"
                      style={{ width: '100%' }}
                  />
              </div>

              <div className="mb-1">
                  <FieldLabel classic={classic} hint="Defect store for QC-rejected stock of this item — used when the producing work centre has no reject location of its own">Default reject location</FieldLabel>
                  <TreeSelect
                      options={locPickerTreeOptions}
                      value={newItem.default_reject_location_id}
                      onChange={id => setNewItem({ ...newItem, default_reject_location_id: id })}
                      allowEmpty
                      emptyLabel="— None —"
                      size="sm"
                      style={{ width: '100%' }}
                  />
              </div>
            </FormSection>

            {isFinishedGoodsCategory && (
              <FormSection title="Variant Type" classic={classic}>
                  {renderVariantTypeSelector(newItem.variant_type, (v) => setNewItem({ ...newItem, variant_type: v }), 'new')}
              </FormSection>
            )}

              {newItem.source_sample_id && (
                  <div className="mb-3">
                      {classic ? (
                          <div style={{ border: '1px solid #7f9db9', background: '#dce4f5', padding: '4px 8px', fontFamily: xpFont, fontSize: '11px', color: '#0d2a6e' }}>
                              ↖ Derived from sample: <strong>{newItem.source_sample_code}{newItem.source_color_name ? ` · ${newItem.source_color_name}` : ''}</strong>
                          </div>
                      ) : (
                          <div className="alert alert-info py-2 px-3 mb-0 small">
                              <i className="bi bi-arrow-up-left me-1"></i>
                              Derived from sample: <strong>{newItem.source_sample_code}{newItem.source_color_name ? ` · ${newItem.source_color_name}` : ''}</strong>
                          </div>
                      )}
                  </div>
              )}

              {isRawMaterialCategory && (
                  <div className="mb-0">
                      {classic ? (
                          <div style={{ border: '1px solid #aca899', borderRadius: 3, padding: '10px 8px 8px', background: '#f5f4ee', position: 'relative', marginTop: 4 }}>
                              <span style={{ position: 'absolute', top: -8, left: 8, background: '#f5f4ee', padding: '0 4px', fontFamily: xpFont, fontSize: '10px', color: '#444' }}>Also Create Beam Item</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: createBeam ? 8 : 0 }}>
                                  <input
                                      type="checkbox"
                                      id="create-beam-check"
                                      checked={createBeam}
                                      onChange={e => { setCreateBeam(e.target.checked); setBeamNameManuallyEdited(false); }}
                                      style={{ cursor: 'pointer' }}
                                  />
                                  <label htmlFor="create-beam-check" style={{ fontFamily: xpFont, fontSize: '11px', color: '#000', cursor: 'pointer', margin: 0 }}>
                                      Create beam item <strong>BEAM-{newItem.code || '...'}</strong>
                                  </label>
                              </div>
                              {createBeam && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                                          <div style={{ flex: 1 }}>
                                              <label style={{ fontFamily: xpFont, fontSize: '10px', color: '#555', display: 'block', marginBottom: 2 }}>Beam Name</label>
                                              <input
                                                  style={{ fontFamily: xpFont, fontSize: '11px', border: '1px solid #7f9db9', boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.15)', padding: '2px 4px', background: '#fff', color: '#000', width: '100%' }}
                                                  value={beamName}
                                                  onChange={e => { setBeamNameManuallyEdited(true); setBeamName(e.target.value); }}
                                                  placeholder={`Beam - ${newItem.name}`}
                                              />
                                          </div>
                                          <div style={{ width: 80 }}>
                                              <label style={{ fontFamily: xpFont, fontSize: '10px', color: '#555', display: 'block', marginBottom: 2 }}>UOM</label>
                                              <select
                                                  style={{ fontFamily: xpFont, fontSize: '11px', border: '1px solid #7f9db9', padding: '2px 4px', background: '#fff', color: '#000', width: '100%' }}
                                                  value={beamUom}
                                                  onChange={e => setBeamUom(e.target.value)}
                                              >
                                                  <option value="">-- same --</option>
                                                  {(uoms || []).map((u: any) => <option key={u.id} value={u.name}>{u.name}</option>)}
                                              </select>
                                          </div>
                                      </div>
                                      <div style={{ fontFamily: xpFont, fontSize: '9px', color: '#888' }}>
                                          Code: BEAM-{newItem.code || '...'} · Category: Beam (WIP) · BOM defined manually in BOM Designer
                                      </div>
                                  </div>
                              )}
                          </div>
                      ) : (
                          <div className="border rounded p-2 bg-light">
                              <div className="form-check mb-0">
                                  <input
                                      className="form-check-input"
                                      type="checkbox"
                                      id="create-beam-check"
                                      checked={createBeam}
                                      onChange={e => { setCreateBeam(e.target.checked); setBeamNameManuallyEdited(false); }}
                                  />
                                  <label className="form-check-label small" htmlFor="create-beam-check">
                                      Also create beam item <strong>BEAM-{newItem.code || '...'}</strong>
                                  </label>
                              </div>
                              {createBeam && (
                                  <div className="mt-2 d-flex gap-2 align-items-end">
                                      <div className="flex-grow-1">
                                          <label className="form-label small text-muted mb-1">Beam Name</label>
                                          <input
                                              className="form-control form-control-sm"
                                              value={beamName}
                                              onChange={e => { setBeamNameManuallyEdited(true); setBeamName(e.target.value); }}
                                              placeholder={`Beam - ${newItem.name}`}
                                          />
                                      </div>
                                      <div style={{ width: 90 }}>
                                          <label className="form-label small text-muted mb-1">UOM</label>
                                          <select
                                              className="form-select form-select-sm"
                                              value={beamUom}
                                              onChange={e => setBeamUom(e.target.value)}
                                          >
                                              <option value="">-- same --</option>
                                              {(uoms || []).map((u: any) => <option key={u.id} value={u.name}>{u.name}</option>)}
                                          </select>
                                      </div>
                                  </div>
                              )}
                              {createBeam && (
                                  <small className="text-muted d-block mt-1">Code: BEAM-{newItem.code || '...'} · Category: Beam (WIP) · BOM defined manually</small>
                              )}
                          </div>
                      )}
                  </div>
              )}
          </form>
      </ModalWrapper>

      {/* LEFT COLUMN: Items List */}
      <div className="col-12 order-2 order-md-1">
        {/* ── Outer shell: XP bevel in classic, Bootstrap card in default ── */}
        <div
          style={classic ? { ...xpBevel, ...pageFillStyle } : pageFillStyle}
          className={classic ? '' : 'card h-100 border-0 shadow-sm shell-window'}
        >
          {/* ── Title bar ── */}
          {classic ? (
            <div style={xpTitleBar}>
              {/* Left: title + selection info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>
                  <i className="bi bi-box-seam" style={{ marginRight: '6px' }}></i>
                  {forcedCategory ? t('sample_masters') : t('item_inventory')}
                </span>
                {sel.count > 0 && (
                  <span style={{ fontSize: '10px', color: '#cce8ff', fontWeight: 'normal' }}>
                    — {sel.count} selected
                  </span>
                )}
              </div>
              {/* Right: action buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {canDelete && sel.count > 0 && (
                  <>
                    <button
                      className={XP_BTN}
                      style={xpBtn({ ...BTN_TONES.danger })}
                      onClick={handleBulkDelete}
                    >
                      <i className="bi bi-trash"></i> Delete ({sel.count})
                    </button>
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cce8ff', textDecoration: 'underline', fontFamily: xpFont, fontSize: '10px', padding: 0 }}
                      onClick={sel.clear}
                    >
                      Clear
                    </button>
                    <div style={xpSep}></div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="card-header bg-white">
              <div className="d-flex justify-content-between align-items-center mb-3">
                  <div>
                      <h5 className="card-title mb-0">{forcedCategory ? t('sample_masters') : t('item_inventory')}</h5>
                      <p className="text-muted small mb-0 mt-1">
                          {forcedCategory ? 'Manage product samples and prototypes' : 'Master list of all products and materials'}
                      </p>
                      {canDelete && sel.count > 0 && (
                          <div className="d-flex align-items-center gap-2 mt-2">
                              <span className="text-muted small">{sel.count} selected</span>
                              <button className="btn btn-sm btn-danger" onClick={handleBulkDelete}>
                                  <i className="bi bi-trash me-1"></i>Delete Selected
                              </button>
                              <button className="btn btn-sm btn-link text-secondary p-0" onClick={sel.clear}>
                                  Clear
                              </button>
                          </div>
                      )}
                  </div>
              </div>
              {/* Filter Bar */}
              <div className="row g-2 align-items-center bg-light p-2 rounded border">
                  <div className="col-md-5">
                      <SearchField classic={false} value={searchTerm} onChange={onSearchChange} placeholder={`${t('search')}...`} width={420} grow style={{ display: 'flex', width: '100%' }} />
                  </div>
                  {!forcedCategory && (
                  <>
                  <div className="col-md-3">
                      <TreeSelect
                          options={catTreeOptions}
                          value={categoryL3 || categoryL2 || categoryL1}
                          onChange={handleCategoryTreeChange}
                          allowEmpty
                          emptyLabel="All Categories"
                          size="sm"
                      />
                  </div>
                  <div className="col-md-1">
                      <button className="btn btn-sm btn-outline-secondary w-100" onClick={() => { setCategoryL1(''); setCategoryL2(''); setCategoryL3(''); }} disabled={!categoryL1 && !categoryL2 && !categoryL3}>Clear</button>
                  </div>
                  </>
                  )}
                  {canManage && (
                  <div className={forcedCategory ? 'col-md-7 d-flex justify-content-end gap-2' : 'col-md-3 d-flex justify-content-end gap-2'}>
                      <ToolbarButton classic={false} tone="neutral" icon="bi-upload" onClick={() => setIsImportOpen(true)}>Import</ToolbarButton>
                      <ToolbarButton classic={false} tone="create" icon="bi-plus-lg" testId="create-item-btn" onClick={openCreateModal}>{t('create')}</ToolbarButton>
                  </div>
                  )}
              </div>
            </div>
          )}

          {/* ── Category quick-filter tabs ── */}
          {!forcedCategory && (
              <Tabs<string> tabs={categoryTabs} activeKey={categoryL1 || 'ALL'} onChange={handleCategoryTabChange} classic={classic} />
          )}

          {/* ── XP Toolbar (search + filter) ── */}
          {classic && (
            <div style={{ ...xpToolbar, gap: 8 }}>
              <SearchField classic value={searchTerm} onChange={onSearchChange} placeholder={`${t('search')} items…`} width={200} />
              {!forcedCategory && (
                <>
                  <span style={{ fontSize: 10, color: '#555', whiteSpace: 'nowrap', fontFamily: xpFont }}>Category:</span>
                  <TreeSelect
                    options={catTreeOptions}
                    value={categoryL3 || categoryL2 || categoryL1}
                    onChange={handleCategoryTreeChange}
                    allowEmpty
                    emptyLabel="All"
                    style={{ width: 200 }}
                  />
                  <button className={XP_BTN} style={xpBtn()} onClick={() => { setCategoryL1(''); setCategoryL2(''); setCategoryL3(''); }}>
                    Clear
                  </button>
                </>
              )}
              <div style={{ marginLeft: 'auto', fontFamily: xpFont, fontSize: '10px', color: '#555555' }}>
                {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''} on page
              </div>
              {canManage && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <ToolbarButton classic tone="neutral" icon="bi-upload" onClick={() => setIsImportOpen(true)}>Import</ToolbarButton>
                  <ToolbarButton classic tone="create" icon="bi-plus-lg" testId="create-item-btn" onClick={openCreateModal}>{t('create')}</ToolbarButton>
                </div>
              )}
            </div>
          )}

          {/* ── Table ── */}
          <div className={classic ? '' : 'card-body p-0'} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <div className={classic ? '' : 'table-responsive'}>
              <table
                className={classic ? '' : 'table table-hover align-middle mb-0'}
                style={classic ? {
                    width: '100%',
                    borderCollapse: 'separate',
                    borderSpacing: 0,
                    fontFamily: xpFont,
                    fontSize: '11px',
                    background: '#ffffff',
                } : undefined}
              >
                <thead>
                  <tr
                    style={classic ? xpTableHeader : undefined}
                    className={classic ? '' : 'table-light'}
                  >
                    <th style={classic ? { ...xpThCell, width: LV_CHECK_COL_W, textAlign: 'center' } : { width: LV_CHECK_COL_W }} className={classic ? '' : 'ps-3'}>
                        <SelectAllCheckbox classic={classic} allSelected={sel.allPageSelected} someSelected={sel.someSelected} onChange={sel.togglePage} />
                    </th>
                    <SortableTh sort={sort} colKey="code" onSort={toggleSort} style={classic ? { ...xpThCell, width: '110px' } : {}} className={classic ? '' : 'ps-4'}>{t('item_code')}</SortableTh>
                    <SortableTh sort={sort} colKey="name" onSort={toggleSort} style={classic ? { ...xpThCell } : {}}>{t('item_name')}</SortableTh>
                    <SortableTh sort={sort} colKey="category" onSort={toggleSort} style={classic ? { ...xpThCell, width: '110px' } : {}}>{t('categories')}</SortableTh>
                    <th style={classic ? { ...xpThCell, width: '55px' } : { width: '55px' }}>{t('uom')}</th>
                    <th style={classic ? { ...xpThCell, width: '90px' } : undefined}>{t('source_sample')}</th>
                    <th style={classic ? { ...xpThCell, width: '70px' } : { width: '70px' }}>{t('item_type')}</th>
                    <SortableTh sort={sort} colKey="weight" onSort={toggleSort} style={classic ? { ...xpThCell, width: '90px' } : { width: '90px' }}>{t('weight_per_unit')}</SortableTh>
                    <th style={classic ? { ...xpThCell, width: '80px', borderRight: 'none' } : { width: '80px' }}>{t('actions')}</th>
                  </tr>
                </thead>
                <tbody ref={listBodyRef}>
                  {sortedItems.map((item: any, idx: number) => (
                    <InventoryRow
                        key={item.id}
                        item={item}
                        rowIndex={idx}
                        isEditing={editingItem?.id === item.id}
                        isSelected={sel.isSelectedKey(item.id)}
                        onToggleSelect={sel.toggleKey}
                        onViewHistory={setHistoryEntityId}
                        onMenu={toggleMenu}
                        classic={classic}
                    />
                  ))}
                  {filteredItems.length === 0 && dataLoading.items && (
                    <TableSkeleton rows={8} cols={skel.cols ?? 9} classic={classic} rowHeight={skel.rowHeight} fillHeight={skel.fillHeight} />
                  )}
                  {filteredItems.length === 0 && !dataLoading.items && (
                    <tr>
                      <td
                        colSpan={9}
                        style={classic ? { padding: 0, background: '#ffffff' } : undefined}
                        className={classic ? '' : 'text-center text-muted py-5'}
                      >
                        {classic ? (
                          <XPEmptyState message="No items found" icon="bi-box-seam">
                            <button className={XP_BTN} style={{ ...xpBtn(), marginTop: 10 }} onClick={openCreateModal}>
                              <i className="bi bi-plus-lg" style={{ marginRight: 4 }} />{t('create')}
                            </button>
                          </XPEmptyState>
                        ) : 'No items found'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Footer / Pagination ── */}
          <Pager
            page={currentPage}
            total={totalItems}
            pageSize={pageSize}
            onPageChange={onPageChange}
            leftContent={classic
              ? (sel.count > 0
                  ? `${sel.count} of ${totalItems} item${totalItems !== 1 ? 's' : ''} selected`
                  : `${totalItems} item${totalItems !== 1 ? 's' : ''} total`)
              : undefined}
          />
        </div>
      </div>

      {/* Edit Modal */}
      <ModalWrapper
          isOpen={!!activeEditingItem}
          modeless
          onClose={() => setEditingItem(null)}
          title={<span><i className="bi bi-pencil-square me-2"></i>{t('edit')} Item</span>}
          variant="primary"
          size="md"
          footer={activeEditingItem ? (
              classic ? (
                <>
                  <button type="button" className={XP_BTN} style={xpBtn()} onClick={() => setEditingItem(null)}>{t('cancel')}</button>
                  <button
                    type="button"
                    className={XP_BTN}
                    style={xpBtn({ ...BTN_TONES.success, padding: '2px 16px' })}
                    onClick={() => (document.getElementById('edit-item-form') as HTMLFormElement)?.requestSubmit()}
                  >{t('save')}</button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-sm btn-light text-muted" onClick={() => setEditingItem(null)}>{t('cancel')}</button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm px-3"
                    onClick={() => (document.getElementById('edit-item-form') as HTMLFormElement)?.requestSubmit()}
                  >{t('save')}</button>
                </>
              )
          ) : undefined}
      >
          {activeEditingItem && (
                <form id="edit-item-form" onSubmit={handleUpdateItemSubmit}>
                  <FormSection title="Basic Info" classic={classic}>
                    <div className="mb-3">
                        <FieldLabel classic={classic}>{t('item_code')}</FieldLabel>
                        <input
                          className={classic ? '' : 'form-control'}
                          style={classic ? { ...xpInput, width: '100%', boxSizing: 'border-box' } : undefined}
                          value={editingItem.code}
                          onChange={e => setEditingItem({...editingItem, code: e.target.value})}
                          required
                        />
                    </div>
                    <div className="mb-3">
                        <FieldLabel classic={classic}>{t('item_name')}</FieldLabel>
                        <input
                          className={classic ? '' : 'form-control'}
                          style={classic ? { ...xpInput, width: '100%', boxSizing: 'border-box' } : undefined}
                          value={editingItem.name}
                          onChange={e => setEditingItem({...editingItem, name: e.target.value})}
                          required
                        />
                    </div>
                    <div className="mb-3">
                        <FieldLabel classic={classic}>{t('categories')}</FieldLabel>
                        <TreeSelect
                            options={catTreeOptions}
                            value={effectiveFormCategoryId || ''}
                            onChange={handleFormCategoryChange}
                            allowEmpty
                            emptyLabel="— None —"
                            size="sm"
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div className="mb-1">
                        <FieldLabel classic={classic}>{t('uom')}</FieldLabel>
                        <select
                          className={classic ? '' : 'form-select'}
                          style={classic ? { ...xpSelect, width: '100%', boxSizing: 'border-box', height: '22px' } : undefined}
                          value={editingItem.uom}
                          onChange={e => setEditingItem({...editingItem, uom: e.target.value, packaging_factor_ids: []})}
                          required
                        >
                            <option value="">Unit...</option>
                            {(uoms || []).map((u: any) => <option key={u.id} value={u.name}>{u.name}</option>)}
                        </select>
                    </div>
                  </FormSection>

                  <FormSection title="Packaging & Weight" classic={classic}>
                    {/* Packaging Units */}
                    <div className="mb-3">
                      {classic ? (
                        <div>
                          <FieldLabel classic={classic}>Packaging Units</FieldLabel>
                          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
                            {(() => {
                              const factors = (uoms || []).flatMap((u: any) => (u.factors || []).filter((f: any) => f.to_uom_name === editingItem.uom));
                              if (!editingItem.uom) return <span style={{ fontSize: '10px', color: '#aaa', fontStyle: 'italic' }}>Select a UoM first</span>;
                              if (factors.length === 0) return <span style={{ fontSize: '10px', color: '#aaa', fontStyle: 'italic' }}>No packaging units defined for this UoM</span>;
                              return factors.map((f: any) => {
                                const active = (editingItem.packaging_factor_ids || []).includes(String(f.id));
                                return (
                                  <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '56px 1fr', alignItems: 'center' }}>
                                    <span style={{ fontFamily: xpFont, fontSize: '11px', color: '#000' }}>{f.from_uom_name}</span>
                                    <div>
                                      <button type="button"
                                        style={{
                                          fontFamily: xpFont, fontSize: '10px',
                                          padding: '0 5px', height: '18px', cursor: 'pointer',
                                          borderRadius: 0, border: '1px solid',
                                          borderColor: active ? '#1a3a7a #0a2a5a #0a2a5a #1a3a7a' : '#dfdfdf #808080 #808080 #dfdfdf',
                                          background: active ? 'linear-gradient(to bottom, #316ac5, #1a4a8a)' : 'linear-gradient(to bottom, #ffffff, #d4d0c8)',
                                          color: active ? '#fff' : '#000',
                                        }}
                                        onClick={() => setEditingItem((prev: any) => ({
                                          ...prev,
                                          packaging_factor_ids: active
                                            ? (prev.packaging_factor_ids || []).filter((id: string) => id !== String(f.id))
                                            : [...(prev.packaging_factor_ids || []), String(f.id)],
                                        }))}
                                      >
                                        &times;{parseFloat(f.value)} {editingItem.uom}
                                      </button>
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <label className="form-label small text-muted">Packaging Units</label>
                          <div className="border rounded p-2" style={{ background: '#f8f9fa' }}>
                            {(() => {
                              const factors = (uoms || []).flatMap((u: any) => (u.factors || []).filter((f: any) => f.to_uom_name === editingItem.uom));
                              if (!editingItem.uom) return <small className="text-muted fst-italic">Select a UoM first</small>;
                              if (factors.length === 0) return <small className="text-muted fst-italic">No packaging units defined for this UoM</small>;
                              return (
                                <div className="d-flex flex-column gap-1">
                                  {factors.map((f: any) => {
                                    const active = (editingItem.packaging_factor_ids || []).includes(String(f.id));
                                    return (
                                      <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '56px 1fr', alignItems: 'center' }}>
                                        <small className="text-muted">{f.from_uom_name}</small>
                                        <button type="button"
                                          className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}`}
                                          style={{ fontSize: 10, padding: '1px 6px', width: 'fit-content' }}
                                          onClick={() => setEditingItem((prev: any) => ({
                                            ...prev,
                                            packaging_factor_ids: active
                                              ? (prev.packaging_factor_ids || []).filter((id: string) => id !== String(f.id))
                                              : [...(prev.packaging_factor_ids || []), String(f.id)],
                                          }))}
                                        >
                                          &times;{parseFloat(f.value)} {editingItem.uom}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="row g-2 mb-1">
                        <div className="col-6">
                            <FieldLabel classic={classic}>Weight / Unit</FieldLabel>
                            <input
                              className={classic ? '' : 'form-control'}
                              style={classic ? { ...xpInput, width: '100%', boxSizing: 'border-box' } : undefined}
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="e.g. 280"
                              value={editingItem.weight_per_unit || ''}
                              onChange={e => setEditingItem({...editingItem, weight_per_unit: e.target.value})}
                            />
                        </div>
                        <div className="col-6">
                            <FieldLabel classic={classic}>Weight Unit</FieldLabel>
                            <select
                              className={classic ? '' : 'form-select'}
                              style={classic ? { ...xpSelect, width: '100%', boxSizing: 'border-box', height: '22px' } : undefined}
                              value={editingItem.weight_unit || 'gsm'}
                              onChange={e => setEditingItem({...editingItem, weight_unit: e.target.value})}
                            >
                                <option value="gsm">gsm</option>
                                <option value="g/m²">g/m²</option>
                                <option value="oz/yd²">oz/yd²</option>
                                <option value="g/y">g/y</option>
                            </select>
                        </div>
                    </div>
                  </FormSection>

                  <FormSection title="Inventory Settings" classic={classic}>
                    <div className="mb-1">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              className={classic ? '' : 'form-check-input'}
                              style={classic ? { cursor: 'pointer' } : undefined}
                              type="checkbox"
                              id="edit-lot-tracked"
                              checked={!!editingItem.lot_tracked}
                              onChange={e => setEditingItem({ ...editingItem, lot_tracked: e.target.checked })}
                            />
                            <label
                              className={classic ? '' : 'form-check-label small fw-semibold'}
                              style={classic ? { fontFamily: xpFont, fontSize: '11px', fontWeight: 'bold', color: '#2b2822', cursor: 'pointer', margin: 0 } : { margin: 0 }}
                              htmlFor="edit-lot-tracked"
                            >Lot tracked</label>
                        </div>
                        <div
                          style={classic ? { fontFamily: xpFont, fontSize: 10, color: '#938c76', fontStyle: 'italic', margin: '1px 0 3px 20px' } : undefined}
                          className={classic ? '' : 'text-muted small fst-italic mb-1'}
                        >Every receipt, production output and transfer requires a lot number</div>
                    </div>

                    <div className="mb-1">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              className={classic ? '' : 'form-check-input'}
                              style={classic ? { cursor: 'pointer' } : undefined}
                              type="checkbox"
                              id="edit-decoupling-point"
                              checked={!!editingItem.is_decoupling_point}
                              onChange={e => setEditingItem({ ...editingItem, is_decoupling_point: e.target.checked })}
                            />
                            <label
                              className={classic ? '' : 'form-check-label small fw-semibold'}
                              style={classic ? { fontFamily: xpFont, fontSize: '11px', fontWeight: 'bold', color: '#2b2822', cursor: 'pointer', margin: 0 } : { margin: 0 }}
                              htmlFor="edit-decoupling-point"
                            >Make-to-stock (decoupling point)</label>
                        </div>
                        <div
                          style={classic ? { fontFamily: xpFont, fontSize: 10, color: '#938c76', fontStyle: 'italic', margin: '1px 0 3px 20px' } : undefined}
                          className={classic ? '' : 'text-muted small fst-italic mb-1'}
                        >Never auto-planned inside a parent order — demand is pooled and produced on its own standalone order</div>
                    </div>

                    <div className="mb-3">
                        <FieldLabel classic={classic} hint="Flags low stock when total on-hand drops below this. Blank = default (10).">Reorder point (min stock)</FieldLabel>
                        <input
                          type="number" min="0" step="any"
                          className={classic ? '' : 'form-control'}
                          style={classic ? { ...xpSelect, width: '100%', boxSizing: 'border-box', height: '22px' } : undefined}
                          value={editingItem.min_stock_level ?? ''}
                          onChange={e => setEditingItem({ ...editingItem, min_stock_level: e.target.value })}
                          placeholder="10"
                        />
                    </div>

                    <div className="mb-1">
                        <FieldLabel classic={classic} hint="Where this item is normally pulled from when staging to production">Default source location</FieldLabel>
                        <TreeSelect
                          options={locPickerTreeOptions}
                          value={editingItem.default_source_location_id ?? ''}
                          onChange={id => setEditingItem({ ...editingItem, default_source_location_id: id || null })}
                          allowEmpty
                          emptyLabel="— None —"
                          size="sm"
                          style={{ width: '100%' }}
                        />
                    </div>

                    <div className="mb-1">
                        <FieldLabel classic={classic} hint="Preferred bin for this item's production output — pre-fills the MO putaway suggestion">Default putaway location</FieldLabel>
                        <TreeSelect
                          options={locPickerTreeOptions}
                          value={editingItem.default_putaway_location_id ?? ''}
                          onChange={id => setEditingItem({ ...editingItem, default_putaway_location_id: id || null })}
                          allowEmpty
                          emptyLabel="— None —"
                          size="sm"
                          style={{ width: '100%' }}
                        />
                    </div>

                    <div className="mb-1">
                        <FieldLabel classic={classic} hint="Defect store for QC-rejected stock of this item — used when the producing work centre has no reject location of its own">Default reject location</FieldLabel>
                        <TreeSelect
                          options={locPickerTreeOptions}
                          value={editingItem.default_reject_location_id ?? ''}
                          onChange={id => setEditingItem({ ...editingItem, default_reject_location_id: id || null })}
                          allowEmpty
                          emptyLabel="— None —"
                          size="sm"
                          style={{ width: '100%' }}
                        />
                    </div>
                  </FormSection>

                  {(isFinishedGoodsCategory || editingItem.variant_type) && (
                    <FormSection title="Variant Type" classic={classic}>
                        {renderVariantTypeSelector(editingItem.variant_type || '', (v) => setEditingItem({ ...editingItem, variant_type: v }), 'edit')}
                    </FormSection>
                  )}
                </form>
          )}
      </ModalWrapper>

      {openMenuId && (() => {
          const menuItem = sortedItems.find((i: any) => String(i.id) === openMenuId);
          if (!menuItem) return null;
          return (
              <FloatingMenu
                  pos={menuPos}
                  items={[
                      { key: 'edit', label: 'Edit', icon: 'bi-pencil-square', hidden: !canManage, onClick: () => { closeMenu(); handleEdit(menuItem); } },
                      { key: 'delete', label: 'Delete', icon: 'bi-trash', danger: true, hidden: !canDelete, onClick: () => { closeMenu(); onDeleteItem(menuItem.id); } },
                  ]}
              />
          );
      })()}

      {historyEntityId && (
          <HistoryPane
              entityType="Item"
              entityId={historyEntityId}
              onClose={() => setHistoryEntityId(null)}
          />
      )}
    </div>
  );
}
