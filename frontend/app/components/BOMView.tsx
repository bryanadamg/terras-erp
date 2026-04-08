import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import BOMDesigner from './BOMDesigner'; // New component
import BOMDetailModal from './BOMDetailModal';
import { useToast } from './Toast';
import { useLanguage } from '../context/LanguageContext';

export default function BOMView({
    items, boms, locations, attributes, workCenters, operations,
    onCreateBOM, onDeleteBOM, onDeleteMultipleBOMs, onCreateItem, onSearchItem,
    initialCreateState, onClearInitialState
}: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();

  const [isDesignerOpen, setIsDesignerOpen] = useState(false);
  const [currentStyle, setCurrentStyle] = useState('default');
  const [searchQuery, setSearchQuery] = useState('');

  // Tree Expansion State for List View
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Detail modal state
  const [detailBom, setDetailBom] = useState<any>(null);

  // Filtered BOMs based on search query
  const filteredBOMs = useMemo(() => {
    if (!searchQuery.trim()) return boms;
    const q = searchQuery.toLowerCase();
    return boms.filter((b: any) => {
      const code = (b.code || '').toLowerCase();
      const name = (b.item_name || items.find((i: any) => i.id === b.item_id)?.name || '').toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [boms, searchQuery, items]);

  const allSelected = filteredBOMs.length > 0 && filteredBOMs.every((b: any) => selectedIds.has(b.id));
  const someSelected = filteredBOMs.some((b: any) => selectedIds.has(b.id)) && !allSelected;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      // Deselect only filtered rows, preserve hidden selections
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredBOMs.forEach((b: any) => next.delete(b.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredBOMs.forEach((b: any) => next.add(b.id));
        return next;
      });
    }
  };

  const handleBulkDelete = async () => {
    if (onDeleteMultipleBOMs) {
      await onDeleteMultipleBOMs([...selectedIds]);
      setSelectedIds(new Set());
    }
  };

  useEffect(() => {
      const savedStyle = localStorage.getItem('ui_style');
      if (savedStyle) setCurrentStyle(savedStyle);
  }, []);

  const initialItemCode = initialCreateState
      ? (items.find((i: any) => i.id === initialCreateState.item_id)?.code || "")
      : "";
  const initialAttributeIds = initialCreateState
      ? (initialCreateState.attribute_value_ids || "").split(',').filter(Boolean)
      : [];

  // Handle Initial State from URL
  useEffect(() => {
      if (initialCreateState && items.length > 0) {
          const item = items.find((i: any) => i.id === initialCreateState.item_id);
          if (item) {
              setIsDesignerOpen(true);
          }
      }
  }, [initialCreateState, items]);

  const handleCloseDesigner = () => {
      setIsDesignerOpen(false);
      if (onClearInitialState) onClearInitialState();
  };

  const handleCreateBOMWrapper = async (bomData: any) => {
      const res = await onCreateBOM(bomData);

      if (res && res.status === 400) {
          const err = await res.json();
          showToast(`Error creating BOM ${bomData.code}: ${err.detail || 'Duplicate?'}`, 'warning');
          throw new Error(err.detail || "Duplicate");
      } else if (res && res.status === 404) {
          const err = await res.json();
          showToast(`Failed to save BOM ${bomData.code}: Parent Item not found in inventory. (${err.detail})`, 'danger');
          throw new Error(err.detail || "Item not found");
      } else if (res && res.ok) {
          showToast(`BOM ${bomData.code} saved`, 'success');
      } else {
          try {
              const err = await res.json();
              showToast(`Failed to save BOM ${bomData.code}: ${err.detail}`, 'danger');
          } catch(e) {
              showToast(`Failed to save BOM ${bomData.code}`, 'danger');
          }
          throw new Error("Failed");
      }
  };

  // Helpers
  const getItemName = (id: string, providedName?: string) => providedName || items.find((i: any) => i.id === id)?.name || id;
  const getItemCode = (id: string, providedCode?: string) => providedCode || items.find((i: any) => i.id === id)?.code || id;
  const getOpName = (id: string) => operations.find((o: any) => o.id === id)?.name || id;
  const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || 'Default';
  const getAttributeValueName = (valId: string) => {
      if (!valId || !attributes) return '-';
      for (const attr of attributes) {
          const val = attr.values.find((v: any) => v.id === valId);
          if (val) return val.value;
      }
      return valId;
  };

  const classic = currentStyle === 'classic';

  const toggleNode = (nodeId: string) => {
      setExpandedNodes(prev => ({...prev, [nodeId]: !prev[nodeId]}));
  };

  const renderBOMTree = (bomLines: any[], parentId: string, level = 0) => {
      return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {bomLines.map((line: any) => {
                  // Use full boms prop (not filteredBOMs) so sub-BOMs of visible rows are always findable
                  const subBOM = boms.find((b: any) => b.item_id === line.item_id);
                  const isExpandable = !!subBOM;
                  const nodeKey = `${parentId}-${line.id}`;
                  const isExpanded = expandedNodes[nodeKey];

                  return (
                      <div key={line.id} style={{ fontSize: '11px' }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                              {isExpandable ? (
                                  <i
                                    className={`bi bi-caret-${isExpanded ? 'down' : 'right'}-fill`}
                                    style={{
                                      cursor: 'pointer',
                                      fontSize: '0.7rem',
                                      width: '12px',
                                      marginRight: '4px',
                                      color: classic ? '#0058e6' : undefined,
                                      flexShrink: 0,
                                    }}
                                    onClick={() => toggleNode(nodeKey)}
                                  />
                              ) : (
                                  <span style={{ width: '12px', display: 'inline-block', marginRight: '4px', flexShrink: 0 }} />
                              )}

                              <div
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '4px',
                                  paddingBottom: '2px',
                                  borderBottom: classic ? '1px solid #e0ddd4' : '1px solid #f0f0f0',
                                  width: '100%', overflow: 'hidden',
                                }}
                              >
                                  <span style={{ color: '#0058e6', fontWeight: 'bold', minWidth: '22px', flexShrink: 0 }}>
                                      {line.qty}
                                  </span>
                                  <span
                                    className="text-truncate me-1"
                                    style={{ fontFamily: "'Courier New', monospace", fontSize: '9px', color: '#555' }}
                                  >
                                      {getItemCode(line.item_id, line.item_code)}
                                  </span>
                                  <span className="text-truncate" style={{ color: '#000' }}>
                                      {getItemName(line.item_id, line.item_name)}
                                  </span>
                                  <div className="text-truncate flex-grow-1" style={{ fontSize: '0.7rem', color: '#666', fontStyle: 'italic' }}>
                                      {(line.attribute_value_ids || []).map(getAttributeValueName).join(', ')}
                                  </div>
                                  {line.source_location_id && (
                                      <span className="badge bg-light text-dark border ms-2 flex-shrink-0" style={{ fontSize: '0.6rem' }}>
                                          <i className="bi bi-geo-alt"></i>
                                      </span>
                                  )}
                                  {isExpandable && (
                                      <span
                                        style={{
                                          background: '#fff3cd', border: '1px solid #b8860b',
                                          color: '#6b4e00', fontSize: '8px', padding: '0 3px',
                                          fontWeight: 'bold', marginLeft: 'auto', flexShrink: 0,
                                        }}
                                      >
                                          Sub
                                      </span>
                                  )}
                              </div>
                          </div>

                          {isExpandable && isExpanded && subBOM.lines && (
                              <div style={{ borderLeft: '2px solid #b0aaa0', marginLeft: '14px', paddingLeft: '6px', marginTop: '4px' }}>
                                  {renderBOMTree(subBOM.lines, nodeKey, level + 1)}
                              </div>
                          )}
                      </div>
                  );
              })}
          </div>
      );
  };

  return (
    <>
    <div className="row g-4 fade-in">
       {/* BOM Designer Modal */}
       {isDesignerOpen && createPortal(
       <div style={{
           position: 'fixed', inset: 0, zIndex: 9999,
           background: 'rgba(0,0,0,0.45)',
           display: 'flex', alignItems: 'center', justifyContent: 'center',
       }}>
           <div style={{
               display: 'flex', flexDirection: 'column',
               width: 'min(1200px, 96vw)', height: 'min(860px, 94vh)',
               background: '#ece9d8',
               border: '2px solid #0a246a',
               boxShadow: '4px 4px 20px rgba(0,0,0,0.6), inset 0 0 0 1px #a6caf0',
               fontFamily: 'Tahoma, "Segoe UI", sans-serif',
               borderRadius: 4,
               overflow: 'hidden',
           }}>
               {/* XP Title Bar */}
               <div style={{
                   background: 'linear-gradient(to right, #0a246a, #a6caf0, #0a246a)',
                   padding: '3px 6px',
                   display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                   flexShrink: 0,
                   userSelect: 'none',
               }}>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                       <span style={{ fontSize: 14 }}>🗂️</span>
                       <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 12, fontFamily: 'Tahoma, "Segoe UI", sans-serif', textShadow: '1px 1px 2px rgba(0,0,0,0.6)' }}>
                           BOM Designer (Recursive)
                       </span>
                   </div>
                   <button
                       onClick={() => setIsDesignerOpen(false)}
                       style={{
                           width: 21, height: 21, padding: 0,
                           background: 'linear-gradient(to bottom, #e06060, #b03030)',
                           border: '1px solid #800',
                           borderRadius: 2, cursor: 'pointer',
                           color: '#fff', fontSize: 12, fontWeight: 'bold',
                           display: 'flex', alignItems: 'center', justifyContent: 'center',
                           lineHeight: 1,
                       }}
                   >✕</button>
               </div>
               {/* Content */}
               <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                   <BOMDesigner
                       rootItemCode={initialItemCode || ""}
                       initialAttributeValueIds={initialAttributeIds}
                       items={items}
                       locations={locations || []}
                       attributes={attributes}
                       workCenters={workCenters}
                       operations={operations}
                       existingBOMs={boms}
                       onSave={handleCreateBOMWrapper}
                       onCreateItem={onCreateItem}
                       onCancel={handleCloseDesigner}
                       onSearchItem={onSearchItem}
                   />
               </div>
           </div>
       </div>
       , document.body)}

       {/* BOM List */}
       <div className="col-12">
          {/* Outer shell — XP bevel in classic, Bootstrap card in default */}
          <div
            style={classic ? {
              border: '2px solid',
              borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
              boxShadow: '2px 2px 4px rgba(0,0,0,0.3)',
              background: '#ece9d8',
              borderRadius: 0,
            } : undefined}
            className={classic ? '' : 'card h-100 shadow-sm border-0'}
          >
            {/* Toolbar — XP title bar in classic, card-header in default */}
            {classic ? (
              <div style={{
                background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)',
                color: '#fff',
                fontFamily: 'Tahoma, Arial, sans-serif',
                fontSize: '12px',
                fontWeight: 'bold',
                padding: '4px 8px',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
                borderBottom: '1px solid #003080',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                {/* Left side */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>
                    <i className="bi bi-diagram-3-fill" style={{ marginRight: '6px' }}></i>
                    {t('active_boms')}
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search BOMs..."
                    style={{
                      fontFamily: 'Tahoma, Arial, sans-serif',
                      fontSize: '11px',
                      border: '1px solid #808080',
                      boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.15)',
                      padding: '2px 6px',
                      background: '#fff',
                      color: '#000',
                      outline: 'none',
                    }}
                  />
                  {selectedIds.size > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#fff' }}>
                        {selectedIds.size} selected
                      </span>
                      <button
                        style={{
                          fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px',
                          padding: '2px 10px', cursor: 'pointer',
                          background: 'linear-gradient(to bottom, #fff, #d4d0c8)',
                          border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                          color: '#000',
                        }}
                        onClick={handleBulkDelete}
                      >
                        <i className="bi bi-trash" style={{ marginRight: '4px' }}></i>Delete Selected
                      </button>
                      <button
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: '#fff', textDecoration: 'underline',
                          fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px',
                          padding: 0,
                        }}
                        onClick={() => setSelectedIds(new Set())}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
                {/* Right side */}
                <button
                  data-testid="create-bom-btn"
                  style={{
                    fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px',
                    padding: '2px 10px', cursor: 'pointer', fontWeight: 'bold',
                    background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)',
                    border: '1px solid', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a',
                    color: '#fff',
                  }}
                  onClick={() => setIsDesignerOpen(true)}
                >
                  <i className="bi bi-plus-lg" style={{ marginRight: '4px' }}></i>{t('create_recipe')}
                </button>
              </div>
            ) : (
              <div className="card-header bg-white d-flex justify-content-between align-items-center">
                <div className="d-flex align-items-center gap-2">
                  <h5 className="card-title mb-0">
                    <i className="bi bi-diagram-3-fill me-2"></i>{t('active_boms')}
                  </h5>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    style={{ width: '180px' }}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search BOMs..."
                  />
                  {selectedIds.size > 0 && (
                    <div className="d-flex align-items-center gap-2">
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
                <button data-testid="create-bom-btn" className="btn btn-sm btn-primary" onClick={() => setIsDesignerOpen(true)}>
                  <i className="bi bi-plus-lg me-2"></i>{t('create_recipe')}
                </button>
              </div>
            )}

            {/* Body */}
            <div
              className={classic ? '' : 'card-body p-0'}
              style={{ maxHeight: 'calc(100vh - 150px)', overflowY: 'auto' }}
            >
              <div className={classic ? '' : 'table-responsive'}>
                <table
                  className={classic ? '' : 'table table-hover align-middle mb-0'}
                  style={classic ? {
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontFamily: 'Tahoma, Arial, sans-serif',
                    fontSize: '11px',
                    background: '#fff',
                  } : undefined}
                >
                  {/* Table header */}
                  <thead>
                    <tr
                      style={classic ? {
                        background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)',
                        borderBottom: '2px solid #808080',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        color: '#000',
                        letterSpacing: '0.2px',
                      } : undefined}
                      className={classic ? '' : 'table-light'}
                    >
                      <th
                        style={classic ? { width: '40px', padding: '4px 6px', borderRight: '1px solid #b0aaa0' } : { width: '40px' }}
                        className={classic ? '' : 'ps-3'}
                      >
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected; }}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th
                        style={classic ? { padding: '4px 6px', borderRight: '1px solid #b0aaa0' } : undefined}
                        className={classic ? '' : 'ps-2'}
                      >
                        {t('item_code')}
                      </th>
                      <th style={classic ? { padding: '4px 6px', borderRight: '1px solid #b0aaa0' } : undefined}>
                        {t('finished_good')}
                      </th>
                      <th style={classic ? { padding: '4px 6px', borderRight: '1px solid #b0aaa0' } : undefined}>
                        {t('routing')}
                      </th>
                      <th style={classic ? { padding: '4px 6px', borderRight: '1px solid #b0aaa0' } : undefined}>
                        {t('materials')}
                      </th>
                      <th style={classic ? { width: '50px', padding: '4px 6px' } : { width: '50px' }}></th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredBOMs.length === 0 && searchQuery.trim() ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '16px', color: '#888', fontSize: '11px' }}>
                          No BOMs match your search.
                        </td>
                      </tr>
                    ) : (
                      filteredBOMs.map((bom: any, index: number) => {
                        const rowBg = classic
                          ? (selectedIds.has(bom.id) ? '#d8e4f8' : index % 2 === 0 ? '#ffffff' : '#f5f3ee')
                          : undefined;

                        return (
                          <tr
                            key={bom.id}
                            className={classic ? '' : (selectedIds.has(bom.id) ? 'table-active' : '')}
                            style={classic ? { background: rowBg, borderBottom: '1px solid #c0bdb5' } : undefined}
                          >
                            <td
                              style={classic ? { padding: '5px 6px', borderRight: '1px solid #c0bdb5', verticalAlign: 'top' } : undefined}
                              className={classic ? '' : 'ps-3 align-top'}
                            >
                              <input
                                className="form-check-input"
                                type="checkbox"
                                checked={selectedIds.has(bom.id)}
                                onChange={() => toggleSelect(bom.id)}
                              />
                            </td>
                            <td
                              onClick={() => setDetailBom(bom)}
                              style={classic ? { padding: '5px 6px', borderRight: '1px solid #c0bdb5', verticalAlign: 'top', cursor: 'pointer' } : { cursor: 'pointer' }}
                              className={classic ? '' : 'ps-2 align-top'}
                              title="Click to view BOM details"
                            >
                              <span
                                style={classic ? {
                                  fontFamily: "'Courier New', monospace",
                                  fontSize: '10px',
                                  background: '#fff',
                                  border: '1px solid #888',
                                  padding: '1px 5px',
                                  color: '#000',
                                  whiteSpace: 'nowrap',
                                } : undefined}
                                className={classic ? '' : 'badge bg-light text-dark border font-monospace'}
                              >
                                {bom.code}
                              </span>
                            </td>
                            <td
                              onClick={() => setDetailBom(bom)}
                              style={classic ? { padding: '5px 6px', borderRight: '1px solid #c0bdb5', verticalAlign: 'top', cursor: 'pointer' } : { cursor: 'pointer' }}
                              className={classic ? '' : 'align-top'}
                              title="Click to view BOM details"
                            >
                              <div style={classic ? { fontWeight: 'bold', color: '#000' } : undefined} className={classic ? '' : 'fw-medium'}>
                                {getItemName(bom.item_id, bom.item_name)} ({getItemCode(bom.item_id, bom.item_code)})
                              </div>
                              <div style={classic ? { fontSize: '9px', color: '#444', marginTop: '1px' } : undefined} className={classic ? '' : 'text-muted small'}>
                                {(bom.attribute_value_ids || []).map(getAttributeValueName).join(', ') || '-'}
                              </div>
                            </td>
                            <td
                              onClick={() => setDetailBom(bom)}
                              style={classic ? { padding: '5px 6px', borderRight: '1px solid #c0bdb5', verticalAlign: 'top', fontSize: '10px', color: '#222', cursor: 'pointer' } : { cursor: 'pointer' }}
                              className={classic ? '' : 'align-top'}
                              title="Click to view BOM details"
                            >
                              {bom.operations && bom.operations.length > 0 ? (
                                <div className={classic ? '' : 'small'}>
                                  {[...bom.operations].sort((a: any, b: any) => a.sequence - b.sequence).map((op: any) => (
                                    <div key={op.id} style={classic ? { color: '#333' } : undefined} className={classic ? '' : 'text-muted'}>
                                      {op.sequence}. {getOpName(op.operation_id)}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span style={classic ? { color: '#888' } : undefined} className={classic ? '' : 'text-muted small'}>-</span>
                              )}
                            </td>
                            <td
                              style={classic ? { padding: '5px 6px', borderRight: '1px solid #c0bdb5', verticalAlign: 'top' } : undefined}
                              className={classic ? '' : 'align-top'}
                            >
                              {renderBOMTree(bom.lines, bom.id)}
                            </td>
                            <td
                              style={classic ? { padding: '5px 6px', textAlign: 'right', verticalAlign: 'top' } : undefined}
                              className={classic ? '' : 'pe-4 text-end align-top'}
                            >
                              <button
                                style={classic ? { background: 'none', border: 'none', cursor: 'pointer', color: '#a00', padding: '0 2px' } : undefined}
                                className={classic ? '' : 'btn btn-sm btn-link text-danger'}
                                onClick={() => onDeleteBOM(bom.id)}
                              >
                                <i className="bi bi-trash"></i>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
       </div>
    </div>

    <BOMDetailModal
      bom={detailBom}
      isOpen={!!detailBom}
      onClose={() => setDetailBom(null)}
      boms={boms}
      items={items}
      locations={locations}
      attributes={attributes}
      operations={operations}
      workCenters={workCenters}
    />
    </>
  );
}
