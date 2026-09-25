import React, { useState, useEffect } from 'react';
import CodeConfigModal, { CodeConfig, buildCodeParts } from '../shared/CodeConfigModal';
import SearchableSelect from '@bryanadamg/terras-ui/components/Combobox';
import { useToast } from '../shared/Toast';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { useDebouncedCommit } from '../../context/usePaginatedList';
import { useUser } from '../../context/UserContext';
import ModalWrapper from '../shared/ModalWrapper';
import ProductionRunModal from './ProductionRunModal';
import MOCreationPreview from './MOCreationPreview';
import { xpFont, xpInput, xpLabel, ModalFooterActions, VariantChip, colorHexFor, BUTTON_RADIUS, XP_BTN } from '../shared/xpTheme';
import { useManufacturingHelpers } from './useManufacturingHelpers';
import ProductionRunsTab from './ProductionRunsTab';
import ManufacturingOrdersTab from './ManufacturingOrdersTab';
import { pageFillStyle, viewShellStyle, PageTitleBar } from '../shared/shellTheme';
import { API_BASE } from '../shared/apiBase';

export default function ManufacturingView({
    items,
    boms,
    locations,
    attributes,
    manufacturingOrders,
    productionRuns,
    stockBalance,
    workCenters,
    operations,
    onCreateMO,
    onUpdateStatus,
    onDeleteMO,
    onCreateProductionRun,
    onDeleteProductionRun,
    onUpdatePRStatus,
    onCreateWO,
    onUpdateWO,
    onUpdateWOStatus,
    onDeleteWO,
    currentPage,
    totalItems,
    pageSize,
    onPageChange,
    prPage,
    prTotal,
    setPrPage,
    initialCreateState,
    onClearInitialState,
    initialPRState,
    onClearInitialPRState,
    initialTab,
    initialMOFilter,
    initialPRFilter,
}: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { authFetch, companyProfile, pagination, itemIndex } = useData();
  const { hasPermission, hasAnyPermission } = useUser();
  const canManage = hasAnyPermission(
    'manufacturing_order.create', 'manufacturing_order.edit', 'manufacturing_order.delete',
    'production_run.create', 'production_run.edit', 'production_run.delete',
  );
  const {
      moSearch, setMoSearch, prSearch: prSearchCtx, setPrSearch: setPrSearchCtx,
      prSoFilter, setPrSoFilter, prProgressFilter, setPrProgressFilter,
  } = pagination;
  const [viewMode, setViewMode] = useState('list');

  // Which list this page shows — fixed by the route (/production-runs or /manufacturing-orders).
  const activeTab: 'production-runs' | 'manufacturing-orders' = initialTab || 'production-runs';
  const [isPRModalOpen, setIsPRModalOpen] = useState(false);
  const [prModalBom, setPrModalBom] = useState<any>(null);
  const [prModalInitialSizes, setPrModalInitialSizes] = useState<Record<string, string> | undefined>(undefined);
  const [prModalTotalQty, setPrModalTotalQty] = useState<string | undefined>(undefined);
  const [prModalSalesOrderId, setPrModalSalesOrderId] = useState<string | undefined>(undefined);
  const [prModalSalesOrderCode, setPrModalSalesOrderCode] = useState<string | undefined>(undefined);
  const [prModalInitialEntries, setPrModalInitialEntries] = useState<Array<{bomId: string; itemId?: string; sizeQtys: Record<string,string>; sizeTokens?: Record<string,number>; totalQty: string; locked?: boolean}> | undefined>(undefined);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newWO, setNewWO] = useState({
      code: '',
      bom_id: '',
      location_code: '',
      source_location_code: '',
      qty: 1.0,
      target_start_date: '',
      target_end_date: '',
      sales_order_id: '',
      bom_size_id: '',
      create_nested: true,
  });

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [codeConfig, setCodeConfig] = useState<CodeConfig>({
      prefix: 'MO',
      suffix: '',
      separator: '-',
      includeItemCode: true,
      includeVariant: false,
      variantAttributeNames: [],
      includeYear: false,
      includeMonth: false
  });
  // Local search inputs (debounced into context, which drives server-side paginated search)
  const [moCodeFilter, setMoCodeFilter] = useState<string>(initialMOFilter || moSearch || '');
  const [prSearch, setPrSearch] = useState<string>(initialPRFilter || prSearchCtx || '');

  useEffect(() => {
      if (initialMOFilter) setMoCodeFilter(initialMOFilter);
  }, [initialMOFilter]);

  useEffect(() => {
      if (initialPRFilter) setPrSearch(initialPRFilter);
  }, [initialPRFilter]);

  // Debounce both search inputs → context, which resets to page 1 and refetches the
  // matching page. The committed values live in DataContext (shared across pages),
  // hence useDebouncedCommit rather than the self-owning useDebouncedSearch.
  useDebouncedCommit(moCodeFilter, moSearch, setMoSearch);
  useDebouncedCommit(prSearch, prSearchCtx, setPrSearchCtx);

  // prSearchCtx lives in DataContext, so it outlives this view — leaving the page
  // with a deep-link PR filter still applied (e.g. after clicking a PR badge from
  // SO) would leave the shared productionRuns list narrowed to that one PR for
  // every other page reading it. Clear it on unmount so the list goes back to unfiltered.
  useEffect(() => {
      // unconditional: the cleanup closure captures prSearchCtx from mount time,
      // so checking it here would read a stale value instead of the latest one
      return () => { setPrSearchCtx(''); setPrSoFilter(''); setPrProgressFilter(''); };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const helpers = useManufacturingHelpers({ items, boms, locations, workCenters, attributes, stockBalance, itemIndex });
  const { getItemName, getAttributeValueName, getBomSizeLabel } = helpers;

  // Handle Automated Creation from Sales Order
  useEffect(() => {
      if (initialCreateState && items.length > 0 && boms.length > 0) {
          const { bom_id, qty, sales_order_id, bom_size_id } = initialCreateState;

          // Use the bom_id passed from the SO page (already matched on item + attributes)
          const bom = boms.find((b: any) => b.id === bom_id);

          if (bom) {
              const base = buildWOBasePattern(bom.id);
              fetchAvailableCode(base).then(suggestedCode => {
                  setNewWO(prev => ({
                      ...prev,
                      code: suggestedCode,
                      bom_id: bom.id,
                      qty: qty,
                      sales_order_id: sales_order_id || '',
                      bom_size_id: bom_size_id || '',
                  }));
                  setIsCreateOpen(true);
                  onClearInitialState();
                  showToast('Production details pre-filled from Sales Order', 'info');
              });
          } else {
              showToast('No active BOM found for the requested item.', 'warning');
              onClearInitialState();
          }
      }
  }, [initialCreateState, items, boms, onClearInitialState]);

  // Handle PR creation pre-fill from Sales Order
  useEffect(() => {
      if (initialPRState && boms.length > 0) {
          if (initialPRState.bom_entries) {
              // Multi-BOM entries path
              // An entry may arrive with NO bom_id: the SO states the size and
              // leaves the recipe to the planner, so `itemId` scopes the modal's
              // BOM picker and `sizeTokens` (folded size names) are resolved to
              // that BOM's own BOMSize rows once it is chosen.
              const entries = (initialPRState.bom_entries as any[]).map((e: any) => {
                  if (e.bom_id && !boms.find((b: any) => b.id === e.bom_id)) return null;
                  const sizeMap: Record<string, string> = {};
                  const tokenMap: Record<string, number> = {};
                  (e.sizes || []).forEach((sz: any) => {
                      if (sz.bom_size_id) sizeMap[sz.bom_size_id] = String(sz.qty);
                      const tok = String(sz.size_token || '').trim().toLowerCase();
                      if (tok) tokenMap[tok] = (tokenMap[tok] || 0) + (parseFloat(sz.qty) || 0);
                  });
                  return { bomId: e.bom_id || '', itemId: e.item_id || undefined, sizeQtys: sizeMap, sizeTokens: Object.keys(tokenMap).length > 0 ? tokenMap : undefined, totalQty: e.total_qty ? String(e.total_qty) : '', attributeValueIds: e.attribute_value_ids || [], colorId: e.color_id || undefined, colorLabel: e.color_label || undefined, labdipVariantCode: e.labdip_variant_code || undefined, locked: true };
              }).filter(Boolean) as Array<{bomId: string; itemId?: string; sizeQtys: Record<string,string>; sizeTokens?: Record<string,number>; totalQty: string; attributeValueIds?: string[]; colorId?: string; colorLabel?: string; labdipVariantCode?: string; locked?: boolean}>;

              if (entries.length > 0) {
                  setPrModalInitialEntries(entries);
                  setPrModalSalesOrderId(initialPRState.sales_order_id || undefined);
                  setPrModalSalesOrderCode(initialPRState.sales_order_code || undefined);
                  setIsPRModalOpen(true);
                  onClearInitialPRState?.();
                  const count = entries.length;
                  showToast(`Production Run pre-filled with ${count} BOM${count > 1 ? 's' : ''} from Sales Order`, 'info');
              } else {
                  showToast('No matching BOMs found for Production Run.', 'warning');
                  onClearInitialPRState?.();
              }
          } else {
              // Legacy single-BOM path
              const { bom_id, sizes, sales_order_id, total_qty } = initialPRState;
              const bom = boms.find((b: any) => b.id === bom_id);
              if (bom) {
                  const sizeMap: Record<string, string> = {};
                  (sizes || []).forEach((s: any) => { sizeMap[s.bom_size_id] = String(s.qty); });
                  setPrModalBom(bom);
                  setPrModalInitialSizes(Object.keys(sizeMap).length > 0 ? sizeMap : undefined);
                  setPrModalTotalQty(total_qty ? String(total_qty) : undefined);
                  setPrModalSalesOrderId(sales_order_id || undefined);
                  setPrModalSalesOrderCode(initialPRState.sales_order_code || undefined);
                  setIsPRModalOpen(true);
                  onClearInitialPRState?.();
                  showToast('Production Run pre-filled from Sales Order', 'info');
              } else {
                  showToast('No matching BOM found for Production Run.', 'warning');
                  onClearInitialPRState?.();
              }
          }
      }
  }, [initialPRState, boms]);

  useEffect(() => {
      const savedConfig = localStorage.getItem('mo_code_config');
      if (savedConfig) {
          try { setCodeConfig(JSON.parse(savedConfig)); } catch (e) {}
      }
  }, []);

  const buildWOBasePattern = (bomId: string, config = codeConfig) => {
      const bom = boms.find((b: any) => b.id === bomId);
      if (!bom) return '';
      const item = items.find((i: any) => i.id === bom.item_id);
      const itemCode = item ? item.code : 'PROD';

      const names: string[] = [];
      if (config.includeVariant && bom.attribute_value_ids) {
          for (const attrName of (config.variantAttributeNames ?? [])) {
              const attr = attributes.find((a: any) => a.name === attrName);
              if (!attr) continue;
              const selectedVal = attr.values.find((v: any) => bom.attribute_value_ids.includes(v.id));
              if (selectedVal) names.push(selectedVal.value.toUpperCase().replace(/\s+/g, ''));
          }
      }

      return buildCodeParts(config, itemCode, names).join(config.separator);
  };

  const fetchAvailableCode = async (base: string): Promise<string> => {
      try {
          const res = await authFetch(`${API_BASE}/manufacturing-orders/available-code?base=${encodeURIComponent(base)}`);
          if (res.ok) {
              const data = await res.json();
              return data.code;
          }
      } catch (_) {}
      return `${base}-00001`;
  };

  const handleSaveConfig = async (newConfig: CodeConfig) => {
      setCodeConfig(newConfig);
      localStorage.setItem('mo_code_config', JSON.stringify(newConfig));
      let base: string;
      if (newWO.bom_id) {
          base = buildWOBasePattern(newWO.bom_id, newConfig);
      } else {
          const parts = [];
          if (newConfig.prefix) parts.push(newConfig.prefix);
          const now = new Date();
          if (newConfig.includeYear) parts.push(now.getFullYear());
          if (newConfig.includeMonth) parts.push(String(now.getMonth() + 1).padStart(2, '0'));
          if (newConfig.suffix) parts.push(newConfig.suffix);
          base = parts.join(newConfig.separator);
      }
      if (base) {
          const suggested = await fetchAvailableCode(base);
          setNewWO(prev => ({ ...prev, code: suggested }));
      }
  };

  const handlePrintList = () => {
      window.print();
  };

  const handleBOMChange = async (bomId: string) => {
      const base = buildWOBasePattern(bomId);
      const suggestedCode = base ? await fetchAvailableCode(base) : '';
      setNewWO({...newWO, bom_id: bomId, code: suggestedCode});
  };

  const handleSubmit = async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (isSubmitting) return;
      if (!newWO.bom_id) { showToast('Select a product recipe (BOM).', 'danger'); return; }
      if (!newWO.code) { showToast('Enter an MO code.', 'danger'); return; }
      if (!newWO.qty || newWO.qty <= 0) { showToast('Quantity must be greater than 0.', 'danger'); return; }
      setIsSubmitting(true);
      try {
          // Clean dates: convert empty strings to null for Pydantic
          const payload = {
              ...newWO,
              target_start_date: newWO.target_start_date || null,
              target_end_date: newWO.target_end_date || null,
              sales_order_id: newWO.sales_order_id || null,
              bom_size_id: newWO.bom_size_id || null,
          };

          const res = await onCreateMO(payload);
          if (res && res.status === 400) {
              const baseMatch = newWO.code.match(/^(.*)-\d+$/);
              const base = baseMatch ? baseMatch[1] : newWO.code;
              const suggestedCode = await fetchAvailableCode(base);
              showToast(`Manufacturing Order Code "${newWO.code}" already exists. Suggesting: ${suggestedCode}`, 'warning');
              setNewWO({ ...newWO, code: suggestedCode });
          } else if (res && res.ok) {
              const createdMO = await res.json();
              if (createdMO.is_material_available === false) {
                  showToast('Manufacturing Order created, but insufficient materials!', 'warning');
              } else {
                  showToast('Manufacturing Order created successfully!', 'success');
              }
              setNewWO({ code: '', bom_id: '', location_code: '', source_location_code: '', qty: 1.0, target_start_date: '', target_end_date: '', sales_order_id: '', bom_size_id: '', create_nested: true });
              setIsCreateOpen(false);
          } else {
              let detail = 'Failed to create Manufacturing Order';
              try { const body = await res.json(); if (body.detail) detail = body.detail; } catch {}
              showToast(detail, 'danger');
          }
      } finally {
          setIsSubmitting(false);
      }
  };

  return (
      <div className="row g-4 fade-in print-container">
          <CodeConfigModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} type="MO" onSave={handleSaveConfig} initialConfig={codeConfig} attributes={attributes} />

          <ModalWrapper
              isOpen={isCreateOpen}
              modeless
              onClose={() => setIsCreateOpen(false)}
              title={<><i className="bi bi-gear-wide-connected me-1"></i> NEW MANUFACTURING ORDER</>}
              variant="success"
              size="xxl"
              footer={
                  <ModalFooterActions
                      onCancel={() => setIsCreateOpen(false)}
                      cancelLabel={t('cancel')}
                      onSubmit={() => handleSubmit()}
                      submitting={isSubmitting}
                      submitLabel="CREATE MANUFACTURING ORDER"
                      submittingLabel="Creating..."
                      variant="success"
                  />
              }
          >
              {/* Two-panel layout: left=form, right=live preview */}
              <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start' }}>

                  {/* ── LEFT: Form ── */}
                  <div style={{
                      width: 380, minWidth: 380, flexShrink: 0,
                      paddingRight: 20,
                      borderRight: '1px solid #aca899',
                  }}>
                      {/* Variant context badge */}
                      {(() => {
                          const bom = boms.find((b: any) => b.id === newWO.bom_id);
                          const attrNames: string[] = bom ? (bom.attribute_value_ids || []).map(getAttributeValueName).filter(Boolean) : [];
                          const sizeLabel = bom && newWO.bom_size_id ? getBomSizeLabel(bom.id, newWO.bom_size_id) : '';
                          if (!attrNames.length && !sizeLabel) return null;
                          return (
                              <div className="mb-2 px-2 py-1 rounded" style={{ background: '#f6f8ff', border: '1px solid #c8d8f8' }}>
                                  <div style={{ fontFamily: xpFont, fontSize: 9, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>
                                      <i className="bi bi-tag-fill me-1 text-primary opacity-75"></i>Product Variant
                                  </div>
                                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                                      {attrNames.map((name: string, i: number) => {
                                          const hex = colorHexFor(name);
                                          return (
                                              <VariantChip key={i} kind={hex ? 'color' : 'material'} size="sm"
                                                  swatch={hex} icon={null} title={name}
                                              >{name}</VariantChip>
                                          );
                                      })}
                                      {sizeLabel && (
                                          <VariantChip kind="size" size="sm" title={`Size: ${sizeLabel}`}>{sizeLabel}</VariantChip>
                                      )}
                                  </div>
                              </div>
                          );
                      })()}

                      {/* MO Details */}
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#888', borderBottom: '1px solid #c0bdb5', paddingBottom: 2, marginBottom: 8 }}>MO Details</div>

                      <div className="mb-2">
                          <label style={xpLabel()}>MO Reference Code</label>
                          <div style={{ display: 'flex' }}>
                              <input
                                  placeholder="Auto-generated"
                                  value={newWO.code}
                                  onChange={e => setNewWO({...newWO, code: e.target.value})}
                                  required
                                  style={xpInput({ flex: 1, borderRight: 'none', height: '22px', borderRadius: 0 })}
                              />
                              <button
                                  type="button"
                                  onClick={() => setIsConfigOpen(true)}
                                  style={{ fontFamily: xpFont, fontSize: 11, height: 24, padding: '0 7px', background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', borderRadius: 3, cursor: 'pointer', boxSizing: 'border-box' as const }}
                                  title="Configure code format"
                              ><i className="bi bi-gear-fill" style={{ fontSize: 10 }}></i></button>
                          </div>
                      </div>

                      <div className="mb-2">
                          <label style={xpLabel()}>Target Quantity</label>
                          <input type="number" style={xpInput({ width: '100%', height: '22px', borderRadius: 0 })} value={newWO.qty} onChange={e => setNewWO({...newWO, qty: parseFloat(e.target.value)})} required />
                      </div>

                      <div className="mb-2">
                          <label style={xpLabel()}>Product Recipe (BOM)</label>
                          <SearchableSelect
                              options={boms.map((b: any) => ({ value: b.id, label: `[${b.code}]  ${getItemName(b.item_id)}` }))}
                              value={newWO.bom_id}
                              onChange={handleBOMChange}
                              required
                              placeholder="Choose a product recipe..."
                          />
                      </div>

                      {/* Schedule */}
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#888', borderBottom: '1px solid #c0bdb5', paddingBottom: 2, marginBottom: 8, marginTop: 14 }}>Schedule</div>
                      <div className="row g-2 mb-2">
                          <div className="col-6">
                              <label style={xpLabel()}>Start Date</label>
                              <input type="date" style={xpInput({ width: '100%', height: '22px', borderRadius: 0 })} value={newWO.target_start_date} onChange={e => setNewWO({...newWO, target_start_date: e.target.value})} />
                          </div>
                          <div className="col-6">
                              <label style={xpLabel()}>End Date</label>
                              <input type="date" style={xpInput({ width: '100%', height: '22px', borderRadius: 0 })} value={newWO.target_end_date} onChange={e => setNewWO({...newWO, target_end_date: e.target.value})} />
                          </div>
                      </div>

                      {/* Locations are no longer set on the order. Output follows the
                          final work-order's output location; material source follows the
                          item master default / BOM-line override, resolved at staging. */}

                      {/* Nested toggle — clean */}
                      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid #aca899' }}>
                          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', margin: 0 }}>
                              <input
                                  type="checkbox"
                                  checked={newWO.create_nested}
                                  onChange={e => setNewWO({...newWO, create_nested: e.target.checked})}
                                  style={{ marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
                              />
                              <div>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: '#000084'}}>
                                      <i className="bi bi-diagram-3-fill me-1"></i>
                                      Create child MOs for nested BOMs
                                  </div>
                                  <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>
                                      Auto-generates sub-assembly orders for all nested recipes
                                  </div>
                              </div>
                          </label>
                      </div>
                  </div>

                  {/* ── RIGHT: Live Preview ── */}
                  <div style={{ flex: 1, paddingLeft: 20, minHeight: 280 }}>
                      {newWO.bom_id && newWO.qty > 0 ? (
                          <MOCreationPreview
                              bomId={newWO.bom_id}
                              qty={newWO.qty}
                              locationCode={newWO.location_code}
                              sourceLocationCode={newWO.source_location_code}
                              createNested={newWO.create_nested}
                              boms={boms}
                              locations={locations}
                              stockBalance={stockBalance}
                          />
                      ) : (
                          <div style={{
                              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                              height: '100%', minHeight: 280, gap: 10,
                              color: '#888',
                          }}>
                              <i className="bi bi-diagram-3" style={{ fontSize: 40, opacity: 0.35 }}></i>
                              <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 200 }}>
                                  Select a BOM and enter quantity to preview the MO
                              </div>
                          </div>
                      )}
                  </div>

              </div>
          </ModalWrapper>

          <div className="col-12 flex-print-fill">
              {/* ── Outer window shell ── */}
              <div
                  style={viewShellStyle()}
              >

                  {/* ── Title bar ──
                      Kept to the title alone. The Calendar/List picker moved down to
                      the tab's own toolbar, beside its search field, where the rest of
                      the app puts its filters (SearchField -> filters -> count ->
                      actions) — and where it can only be shown on the tab it actually
                      drives. Up here it also rendered over Production Runs, which reads
                      no viewMode, so clicking Calendar there changed nothing.

                      The Scanner button is gone as redundant: /scanner is reachable from
                      the sidebar's QUICK SCAN on every page, so a per-page copy of it is
                      just chrome in the ribbon. */}
                  <PageTitleBar
                      icon={activeTab === 'manufacturing-orders' ? 'bi-list-task' : 'bi-collection-play'}
                      title={activeTab === 'manufacturing-orders' ? (t('manufacturing_orders') || 'Manufacturing Orders') : 'Production Runs'}
                  />

                  {/* ── Body ── */}
                  <div style={{ background: '#ece9d8', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

                      {/* Production Runs tab content */}
                      {activeTab === 'production-runs' && (
                          <ProductionRunsTab
                              productionRuns={productionRuns}
                              prPage={prPage}
                              prTotal={prTotal}
                              setPrPage={setPrPage}
                              pageSize={pageSize}
                              prSearch={prSearch}
                              setPrSearch={setPrSearch}
                              prSoFilter={prSoFilter}
                              setPrSoFilter={setPrSoFilter}
                              prProgressFilter={prProgressFilter}
                              setPrProgressFilter={setPrProgressFilter}
                              onDeleteProductionRun={onDeleteProductionRun}
                              canManage={canManage}
                              companyProfile={companyProfile}
                              helpers={helpers}
                              onNewProductionRun={() => setIsPRModalOpen(true)}
                              onPrint={handlePrintList}
                          />
                      )}

                      {/* Manufacturing Orders tab content */}
                      {activeTab === 'manufacturing-orders' && (
                          <ManufacturingOrdersTab
                              items={items}
                              boms={boms}
                              locations={locations}
                              attributes={attributes}
                              manufacturingOrders={manufacturingOrders}
                              productionRuns={productionRuns}
                              workCenters={workCenters}
                              onUpdateStatus={onUpdateStatus}
                              onDeleteMO={onDeleteMO}
                              onCreateWO={onCreateWO}
                              onUpdateWO={onUpdateWO}
                              onUpdateWOStatus={onUpdateWOStatus}
                              onDeleteWO={onDeleteWO}
                              currentPage={currentPage}
                              totalItems={totalItems}
                              pageSize={pageSize}
                              onPageChange={onPageChange}
                              moCodeFilter={moCodeFilter}
                              setMoCodeFilter={setMoCodeFilter}
                              viewMode={viewMode}
                              setViewMode={setViewMode}
                              canManage={canManage}
                              companyProfile={companyProfile}
                              helpers={helpers}
                              onNewMO={() => setIsCreateOpen(true)}
                              onPrint={handlePrintList}
                          />
                      )}
                  </div>
              </div>
          </div>

          {isPRModalOpen && (
              <ProductionRunModal
                  boms={boms}
                  items={items}
                  attributes={attributes}
                  locations={locations}
                  onSave={onCreateProductionRun}
                  onClose={() => { setIsPRModalOpen(false); setPrModalBom(null); setPrModalInitialSizes(undefined); setPrModalTotalQty(undefined); setPrModalSalesOrderId(undefined); setPrModalSalesOrderCode(undefined); setPrModalInitialEntries(undefined); }}
                  initialBomId={prModalBom?.id}
                  initialSizes={prModalInitialSizes}
                  initialTotalQty={prModalTotalQty}
                  initialBomEntries={prModalInitialEntries}
                  salesOrderId={prModalSalesOrderId}
                  salesOrderCode={prModalSalesOrderCode}
                  productionRuns={productionRuns}
              />
          )}
      </div>
  );
}
