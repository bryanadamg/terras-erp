import React, { useState, useEffect, useMemo, memo } from 'react';
import CodeConfigModal, { CodeConfig, buildCodeParts } from './CodeConfigModal';
import BulkImportModal from './BulkImportModal';
import SearchableSelect from './SearchableSelect';
import HistoryPane from './HistoryPane';
import { useToast } from './Toast';
import { useLanguage } from '../context/LanguageContext';

// Memoized Row Component
const InventoryRow = memo(({ item, isEditing, isSelected, onToggleSelect, onEdit, onDelete, onViewHistory, getAttributeNames }: any) => (
    <tr className={isEditing ? 'table-primary' : isSelected ? 'table-active' : ''}>
        <td className="ps-3">
            <input
                className="form-check-input"
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggleSelect(item.id)}
            />
        </td>
        <td className="ps-4 fw-medium font-monospace">
            {item.code}
        </td>
        <td>{item.name}</td>
        <td>{item.category && <span className="badge bg-light text-dark border">{item.category}</span>}</td>
        <td>
            {item.source_sample_id ? (
                <div className="text-primary small fw-medium">
                    <i className="bi bi-link-45deg"></i> Source Linked
                </div>
            ) : (
                <span className="text-muted small">-</span>
            )}
        </td>
        <td><span className="text-muted small">{getAttributeNames(item.attribute_ids)}</span></td>
        <td>
            <div className="d-flex gap-1">
                <button className="btn btn-sm btn-link text-info p-0" title="View History" onClick={() => onViewHistory(item.id)}>
                    <i className="bi bi-clock-history"></i>
                </button>
                <button className="btn btn-sm btn-link text-primary p-0" onClick={() => onEdit(item)}>
                    <i className="bi bi-pencil-square"></i>
                </button>
                <button className="btn btn-sm btn-link text-danger p-0" onClick={() => onDelete(item.id)}>
                    <i className="bi bi-trash"></i>
                </button>
            </div>
        </td>
    </tr>
));

InventoryRow.displayName = 'InventoryRow';

export default function InventoryView({
    items,
    attributes,
    categories,
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
    categoryFilter,
    onCategoryChange
}: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  // UI State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [currentStyle, setCurrentStyle] = useState('default');

  // Derived Pagination
  const totalPages = Math.ceil(totalItems / pageSize);
  const startRange = (currentPage - 1) * pageSize + 1;
  const endRange = Math.min(currentPage * pageSize, totalItems);

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
  const [newItem, setNewItem] = useState({ code: '', name: '', uom: '', category: forcedCategory || '', source_sample_id: '', attribute_ids: [] as string[] });
  
  // Editing State
  const [editingItem, setEditingItem] = useState<any>(null);
  const [historyEntityId, setHistoryEntityId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showCatInput, setShowCatInput] = useState(false);

  useEffect(() => {
      const savedConfig = localStorage.getItem('item_code_config');
      if (savedConfig) {
          try {
              setCodeConfig(JSON.parse(savedConfig));
          } catch (e) {
              console.error("Invalid config in localstorage");
          }
      }
      const savedStyle = localStorage.getItem('ui_style');
      if (savedStyle) setCurrentStyle(savedStyle);
  }, []);

  // Update newItem category if forcedCategory changes (e.g. switching tabs)
  useEffect(() => {
      if (forcedCategory) {
          setNewItem(prev => ({ ...prev, category: forcedCategory }));
      }
  }, [forcedCategory]);

  const handleSaveConfig = (newConfig: CodeConfig) => {
      setCodeConfig(newConfig);
      localStorage.setItem('item_code_config', JSON.stringify(newConfig));
      const suggested = suggestItemCode(newConfig);
      setNewItem(prev => ({ ...prev, code: suggested }));
  };

  const suggestItemCode = (config = codeConfig) => {
      const parts = buildCodeParts(config);
      const basePattern = parts.join(config.separator);
      
      let counter = 1;
      let baseCode = `${basePattern}${config.separator}001`;
      
      // Simple collision check against existing items (visible page only - better to check backend)
      while (items.some((i: any) => i.code === baseCode)) {
          counter++;
          baseCode = `${basePattern}${config.separator}${String(counter).padStart(3, '0')}`;
      }
      return baseCode;
  };

  // Open modal handler - ensures code is suggested if empty
  const openCreateModal = () => {
      if (!newItem.code) {
          setNewItem(prev => ({ ...prev, code: suggestItemCode() }));
      }
      setIsCreateOpen(true);
  };

  // --- Item Handlers ---

  const handleSubmitItem = async (e: React.FormEvent) => {
      e.preventDefault();
      const payload: any = { ...newItem };
      if (forcedCategory) payload.category = forcedCategory; // Ensure it overrides
      if (!payload.source_sample_id) delete payload.source_sample_id;
      
      const res = await onCreateItem(payload);
      
      if (res && res.status === 400) {
          // Handle Duplicate Code
          let baseCode = newItem.code;
          // Strip existing suffix if any (e.g. -1, -2)
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
          // Success
          setNewItem({ code: '', name: '', uom: '', category: forcedCategory || '', source_sample_id: '', attribute_ids: [] });
          setIsCreateOpen(false);
          showToast('Item created successfully', 'success');
      } else {
          // Error (500 or other)
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
          category: editingItem.category,
          attribute_ids: editingItem.attribute_ids || [],
          source_sample_id: editingItem.source_sample_id || null
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

  // Filtered Items - Memoized (Backend now handles main search)
  const filteredItems = useMemo(() => {
      return items.filter((i: any) => {
          // 1. Handle Forced Category (e.g. in the dedicated Samples tab)
          if (forcedCategory) {
              return i.category === forcedCategory;
          }

          // 2. Main Inventory View: Filter out "Sample" category by default
          if (i.category === 'Sample') return false;

          // 3. Handle user category filter (search is now on backend)
          const matchesCategory = !categoryFilter || i.category === categoryFilter;
          return matchesCategory;
      });
  }, [items, forcedCategory, categoryFilter]);
      
  const sampleItems = useMemo(() => items.filter((i: any) => i.category === 'Sample'), [items]);

  const allSelected = filteredItems.length > 0 && selectedIds.size === filteredItems.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleSelect = (id: string) => {
      setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
      });
  };

  const toggleSelectAll = () => {
      if (allSelected) {
          setSelectedIds(new Set());
      } else {
          setSelectedIds(new Set(filteredItems.map((i: any) => i.id)));
      }
  };

  const handleBulkDelete = async () => {
      if (onDeleteMultipleItems) {
          await onDeleteMultipleItems([...selectedIds]);
          setSelectedIds(new Set());
      }
  };

  useEffect(() => { setSelectedIds(new Set()); }, [currentPage]);

  const getAttributeNames = (ids: string[]) => {
      if (!ids || ids.length === 0) return '-';
      return ids.map(id => attributes.find((a: any) => a.id === id)?.name).filter(Boolean).join(', ');
  };

  const handleEdit = (item: any) => {
      setEditingItem({...item, attribute_ids: item.attribute_ids || []});
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
      {isCreateOpen && (
       <div className="modal d-block" data-testid="create-item-modal" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 20000, position: 'fixed', inset: 0 }}>
            <div className={`modal-dialog modal-dialog-centered ui-style-${currentStyle}`}>
                <div className="modal-content shadow">
                    <div className="modal-header bg-primary bg-opacity-10 text-primary-emphasis">
                        <h5 className="modal-title" data-testid="modal-title"><i className="bi bi-box-seam me-2"></i>{t('create')} {forcedCategory ? t('sample_masters') : t('item_inventory')}</h5>
                        <button type="button" className="btn-close" onClick={() => setIsCreateOpen(false)}></button>
                    </div>
                    <div className="modal-body">
                        <form onSubmit={handleSubmitItem}>
                          <div className="mb-3">
                              <label className="form-label d-flex justify-content-between align-items-center small text-muted">
                                  {t('item_code')}
                                  <i 
                                      className="bi bi-gear-fill text-muted" 
                                      style={{cursor: 'pointer'}}
                                      onClick={() => setIsConfigOpen(true)}
                                      title="Configure Auto-Suggestion"
                                  ></i>
                              </label>
                              <input data-testid="item-code-input" className="form-control" placeholder="ITM-001" value={newItem.code} onChange={e => setNewItem({...newItem, code: e.target.value})} required />
                          </div>
                          <div className="mb-3">
                              <label className="form-label small text-muted">{t('item_name')}</label>
                              <input data-testid="item-name-input" className="form-control" placeholder="Product Name" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} required />
                          </div>
                          <div className="row g-2 mb-3">
                              <div className="col-7">
                                  <label className="form-label d-flex justify-content-between small text-muted">
                                      {t('categories')} 
                                      {!forcedCategory && <span className="text-primary" style={{cursor:'pointer'}} onClick={() => setShowCatInput(!showCatInput)}><i className="bi bi-plus-circle"></i></span>}
                                  </label>
                                  {forcedCategory ? (
                                      <input className="form-control" value={newItem.category} disabled />
                                  ) : showCatInput ? (
                                      <div className="input-group input-group-sm">
                                          <input className="form-control" placeholder="New..." value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} autoFocus />
                                          <button type="button" className="btn btn-primary" onClick={handleAddCategory}><i className="bi bi-check"></i></button>
                                      </div>
                                  ) : (
                                      <select data-testid="category-select" className="form-select" value={newItem.category} onChange={e => setNewItem({...newItem, category: e.target.value})}>
                                          <option value="">Select...</option>
                                          {categories.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                                      </select>
                                  )}
                              </div>
                              <div className="col-5">
                                  <label className="form-label small text-muted">{t('uom')}</label>
                                  <select data-testid="uom-select" className="form-select" value={newItem.uom} onChange={e => setNewItem({...newItem, uom: e.target.value})} required>
                                      <option value="">Unit...</option>
                                      {(uoms || []).map((u: any) => <option key={u.id} value={u.name}>{u.name}</option>)}
                                  </select>
                              </div>
                          </div>
                          
                          <div className="mb-3">
                              <label className="form-label small text-muted d-block">{t('attributes')}</label>
                              <div className="d-flex flex-wrap gap-2 p-2 border rounded bg-light" style={{maxHeight: '120px', overflowY: 'auto'}}>
                                  {attributes.map((attr: any) => (
                                      <div key={attr.id} className="form-check">
                                          <input 
                                              className="form-check-input" 
                                              type="checkbox" 
                                              id={`new-attr-${attr.id}`}
                                              checked={newItem.attribute_ids.includes(attr.id)}
                                              onChange={() => toggleAttribute(attr.id, false)}
                                          />
                                          <label className="form-check-label small" htmlFor={`new-attr-${attr.id}`}>
                                              {attr.name}
                                          </label>
                                      </div>
                                  ))}
                                  {attributes.length === 0 && <small className="text-muted fst-italic">No attributes defined</small>}
                              </div>
                          </div>

                          <div className="mb-3">
                              <label className="form-label small text-muted">{t('source_sample')}</label>
                              <SearchableSelect 
                                  options={sampleItems.map((s: any) => ({ value: s.id, label: s.name, subLabel: s.code }))}
                                  value={newItem.source_sample_id} 
                                  onChange={(val) => setNewItem({...newItem, source_sample_id: val})}
                                  placeholder="None"
                              />
                          </div>
                          
                          <div className="d-flex justify-content-end gap-2 mt-3">
                              <button type="button" className="btn btn-secondary" onClick={() => setIsCreateOpen(false)}>{t('cancel')}</button>
                              <button data-testid="submit-create-item" type="submit" className="btn btn-primary fw-bold px-4">{t('create')}</button>
                          </div>
                        </form>
                    </div>
                </div>
            </div>
       </div>
      )}

      {/* LEFT COLUMN: Items List (Now Full Width) */}
      <div className={`${activeEditingItem ? 'col-md-8' : 'col-12'} order-2 order-md-1`}>
        <div className="card h-100 border-0 shadow-sm">
          <div className="card-header bg-white">
            <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                    <h5 className="card-title mb-0">{forcedCategory ? t('sample_masters') : t('item_inventory')}</h5>
                    <p className="text-muted small mb-0 mt-1">
                        {forcedCategory ? 'Manage product samples and prototypes' : 'Master list of all products and materials'}
                    </p>
                    {selectedIds.size > 0 && (
                        <div className="d-flex align-items-center gap-2 mt-2">
                            <span className="text-muted small">{selectedIds.size} selected</span>
                            <button className="btn btn-sm btn-danger" onClick={handleBulkDelete}>
                                <i className="bi bi-trash me-1"></i>Delete Selected
                            </button>
                            <button className="btn btn-sm btn-link text-secondary p-0" onClick={() => setSelectedIds(new Set())}>
                                Clear
                            </button>
                        </div>
                    )}
                </div>
                <div className="d-flex gap-2">
                    <button className="btn btn-light btn-sm border" onClick={() => setIsImportOpen(true)}>
                        <i className="bi bi-upload me-2"></i>Import
                    </button>
                    <button data-testid="create-item-btn" className="btn btn-primary btn-sm" onClick={openCreateModal}>
                        <i className="bi bi-plus-lg me-2"></i>{t('create')}
                    </button>
                </div>
            </div>
            
            {/* Filter Bar */}
            <div className="row g-2 align-items-center bg-light p-2 rounded border">
                <div className="col-md-5">
                    <div className="input-group input-group-sm">
                        <span className="input-group-text bg-white border-end-0"><i className="bi bi-search"></i></span>
                        <input 
                            type="text" 
                            className="form-control border-start-0" 
                            placeholder={`${t('search')}...`}
                            value={searchTerm}
                            onChange={e => onSearchChange(e.target.value)}
                        />
                    </div>
                </div>
                {/* Spacer */}
                <div className="col-md-2"></div> 
                
                {/* Hide Category Filter if Forced */}
                {!forcedCategory && (
                <div className="col-md-3">
                    <SearchableSelect 
                        options={[{ value: '', label: t('categories') + ' (All)' }, ...categories.map((c: any) => ({ value: c.name, label: c.name }))]}
                        value={categoryFilter}
                        onChange={onCategoryChange}
                        placeholder={t('categories') + "..."}
                        className="form-control-sm border-0 p-0"
                    />
                </div>
                )}
            </div>
          </div>
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th className="ps-3" style={{width: '40px'}}>
                        <input
                            className="form-check-input"
                            type="checkbox"
                            checked={allSelected}
                            ref={el => { if (el) el.indeterminate = someSelected; }}
                            onChange={toggleSelectAll}
                        />
                    </th>
                    <th className="ps-4">{t('item_code')}</th>
                    <th>{t('item_name')}</th>
                    <th>{t('categories')}</th>
                    <th>{t('source_sample')}</th>
                    <th>{t('attributes')}</th>
                    <th style={{width: '80px'}}>{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item: any) => (
                    <InventoryRow
                        key={item.id}
                        item={item}
                        isEditing={editingItem?.id === item.id}
                        isSelected={selectedIds.has(item.id)}
                        onToggleSelect={toggleSelect}
                        onEdit={handleEdit}
                        onDelete={onDeleteItem}
                        onViewHistory={setHistoryEntityId}
                        getAttributeNames={getAttributeNames}
                    />
                  ))}
                  {filteredItems.length === 0 && <tr><td colSpan={7} className="text-center text-muted py-5">No items found</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card-footer bg-white border-top py-2 px-4 d-flex justify-content-between align-items-center">
              <div className="small text-muted font-monospace">
                  Showing {startRange}-{endRange} of {totalItems} items
              </div>
              <div className="btn-group">
                  <button 
                    className={`btn btn-sm btn-light border ${currentPage <= 1 ? 'disabled opacity-50' : ''}`}
                    onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                  >
                      <i className="bi bi-chevron-left me-1"></i>Previous
                  </button>
                  <div className="btn btn-sm btn-white border-top border-bottom px-3 fw-bold">
                      Page {currentPage} of {totalPages || 1}
                  </div>
                  <button 
                    className={`btn btn-sm btn-light border ${currentPage >= totalPages ? 'disabled opacity-50' : ''}`}
                    onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                  >
                      Next<i className="bi bi-chevron-right ms-1"></i>
                  </button>
              </div>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Edit Form (Only visible when editing) */}
      {activeEditingItem && (
      <div className="col-md-4 order-1 order-md-2">
        <div className="card sticky-top border-0 shadow-lg border-primary border-opacity-50" style={{top: '24px', zIndex: 100}}>
          <div className="card-header bg-primary text-white">
             <h5 className="card-title mb-0">
                 <span><i className="bi bi-pencil-square me-2"></i>{t('edit')}</span>
             </h5>
          </div>
          <div className="card-body">
                <div>
                    <form onSubmit={handleUpdateItemSubmit} className="mb-4">
                        <div className="mb-3">
                            <label className="form-label small text-muted">{t('item_code')}</label>
                            <input className="form-control" value={editingItem.code} onChange={e => setEditingItem({...editingItem, code: e.target.value})} required />
                        </div>
                        <div className="mb-3">
                            <label className="form-label small text-muted">{t('item_name')}</label>
                            <input className="form-control" value={editingItem.name} onChange={e => setEditingItem({...editingItem, name: e.target.value})} required />
                        </div>
                        <div className="row g-2 mb-3">
                            <div className="col-6">
                                <label className="form-label small text-muted">{t('categories')}</label>
                                {forcedCategory ? (
                                    <input className="form-control" value={editingItem.category} disabled />
                                ) : (
                                    <select className="form-select" value={editingItem.category || ''} onChange={e => setEditingItem({...editingItem, category: e.target.value})}>
                                        <option value="">Select...</option>
                                        {categories.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                                    </select>
                                )}
                            </div>
                            <div className="col-6">
                                <label className="form-label small text-muted">{t('uom')}</label>
                                <select className="form-select" value={editingItem.uom} onChange={e => setEditingItem({...editingItem, uom: e.target.value})} required>
                                    <option value="">Unit...</option>
                                    {(uoms || []).map((u: any) => <option key={u.id} value={u.name}>{u.name}</option>)}
                                </select>
                            </div>
                        </div>
                        
                        <div className="mb-3">
                            <label className="form-label small text-muted d-block">{t('attributes')}</label>
                            <div className="d-flex flex-wrap gap-2 p-2 border rounded bg-light">
                                {attributes.map((attr: any) => (
                                    <div key={attr.id} className="form-check">
                                        <input 
                                            className="form-check-input" 
                                            type="checkbox" 
                                            id={`edit-attr-${attr.id}`}
                                            checked={editingItem.attribute_ids?.includes(attr.id)}
                                            onChange={() => toggleAttribute(attr.id, true)}
                                        />
                                        <label className="form-check-label small" htmlFor={`edit-attr-${attr.id}`}>
                                            {attr.name}
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="mb-3">
                            <label className="form-label small text-muted">{t('source_sample')}</label>
                            <SearchableSelect 
                                options={sampleItems.map((s: any) => ({ value: s.id, label: s.name, subLabel: s.code }))}
                                value={editingItem.source_sample_id || ''} 
                                onChange={(val) => setEditingItem({...editingItem, source_sample_id: val})}
                                placeholder="None"
                            />
                        </div>
                        
                        <div className="d-flex justify-content-between">
                            <button type="button" className="btn btn-sm btn-light text-muted" onClick={() => setEditingItem(null)}>{t('cancel')}</button>
                            <button type="submit" className="btn btn-primary btn-sm px-3">{t('save')}</button>
                        </div>
                    </form>
                </div>
          </div>
        </div>
      </div>
      )}

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
