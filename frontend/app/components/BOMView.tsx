import { useState } from 'react';
import BOMDesigner from './BOMDesigner'; // New component
import { useToast } from './Toast';
import { useLanguage } from '../context/LanguageContext';

export default function BOMView({ items, boms, locations, attributes, workCenters, operations, onCreateBOM, onDeleteBOM, onCreateItem, onSearchItem }: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  
  const [isDesignerOpen, setIsDesignerOpen] = useState(false);
  const [currentStyle, setCurrentStyle] = useState('default');
  
  // Tree Expansion State for List View
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  useState(() => {
      const savedStyle = localStorage.getItem('ui_style');
      if (savedStyle) setCurrentStyle(savedStyle);
  });

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
          // Try to parse error if json
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
  const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
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

  const toggleNode = (nodeId: string) => {
      setExpandedNodes(prev => ({...prev, [nodeId]: !prev[nodeId]}));
  };

  const renderBOMTree = (bomLines: any[], parentId: string, level = 0) => {
      return (
          <div className="d-flex flex-column gap-1">
              {bomLines.map((line: any) => {
                  const subBOM = boms.find((b: any) => b.item_id === line.item_id);
                  const isExpandable = !!subBOM;
                  // Scoped expansion key ensures opening one tree doesn't affect other table rows
                  const nodeKey = `${parentId}-${line.id}`;
                  const isExpanded = expandedNodes[nodeKey];

                  return (
                      <div key={line.id} className="small">
                          <div className="d-flex align-items-center">
                              {isExpandable && (
                                  <i 
                                    className={`bi bi-caret-${isExpanded ? 'down' : 'right'}-fill me-1 text-muted`} 
                                    style={{cursor: 'pointer', fontSize: '0.7rem', width: '12px'}}
                                    onClick={() => toggleNode(nodeKey)}
                                  ></i>
                              )}
                              {!isExpandable && <span style={{width: '12px', display: 'inline-block'}} className="me-1"></span>}
                              
                              <div className="d-flex align-items-center gap-1 border-bottom pb-1 border-light w-100 overflow-hidden">
                                  <span className="fw-bold text-primary flex-shrink-0" style={{minWidth: '20px'}}>{line.qty}</span> 
                                  <span className="text-truncate">{getItemName(line.item_id)}</span>
                                  <div className="text-muted fst-italic text-truncate flex-grow-1" style={{fontSize: '0.7rem'}}>
                                      {(line.attribute_value_ids || []).map(getAttributeValueName).join(', ')}
                                  </div>
                                  {line.source_location_id && (
                                      <span className="badge bg-light text-dark border ms-2 flex-shrink-0" style={{fontSize: '0.6rem'}}>
                                          <i className="bi bi-geo-alt"></i>
                                      </span>
                                  )}
                                  {isExpandable && <span className="badge bg-secondary ms-auto flex-shrink-0" style={{fontSize: '0.6rem'}}>Sub</span>}
                              </div>
                          </div>
                          
                          {isExpandable && isExpanded && subBOM.lines && (
                              <div className="ms-2 ps-2 border-start border-light-subtle mt-1">
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
    <div className="row g-4 fade-in">
       {/* New Designer Modal */}
       {isDesignerOpen && (
       <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, position: 'fixed', inset: 0 }}>
            <div className={`modal-dialog modal-xl modal-dialog-scrollable ui-style-${currentStyle}`}>
                <div className="modal-content shadow h-100">
                    <div className="modal-header bg-warning bg-opacity-10 text-warning-emphasis">
                        <h5 className="modal-title">
                            <i className="bi bi-diagram-3-fill me-2"></i>BOM Designer (Recursive)
                        </h5>
                        <button type="button" className="btn-close" onClick={() => setIsDesignerOpen(false)}></button>
                    </div>
                    
                    <BOMDesigner 
                        rootItemCode=""
                        items={items}
                        locations={locations || []}
                        attributes={attributes}
                        workCenters={workCenters}
                        operations={operations}
                        existingBOMs={boms}
                        onSave={handleCreateBOMWrapper}
                        onCreateItem={onCreateItem}
                        onCancel={() => setIsDesignerOpen(false)}
                        onSearchItem={onSearchItem}
                    />
                </div>
            </div>
       </div>
       )}

       {/* BOM List */}
       <div className="col-12">
          <div className="card h-100 shadow-sm border-0">
             <div className="card-header bg-white d-flex justify-content-between align-items-center">
                 <h5 className="card-title mb-0">{t('active_boms')}</h5>
                 <button data-testid="create-bom-btn" className="btn btn-sm btn-primary" onClick={() => setIsDesignerOpen(true)}>
                     <i className="bi bi-plus-lg me-2"></i>{t('create_recipe')}
                 </button>
             </div>
             <div className="card-body p-0" style={{maxHeight: 'calc(100vh - 150px)', overflowY: 'auto'}}>
                <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                        <thead className="table-light">
                            <tr>
                                <th className="ps-4">{t('item_code')}</th>
                                <th>{t('finished_good')}</th>
                                <th>{t('routing')}</th>
                                <th>{t('materials')}</th>
                                <th style={{width: '50px'}}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {boms.map((bom: any) => (
                                <tr key={bom.id}>
                                    <td className="ps-4 align-top"><span className="badge bg-light text-dark border font-monospace">{bom.code}</span></td>
                                    <td className="align-top">
                                        <div className="fw-medium">{getItemName(bom.item_id)}</div>
                                        <div className="text-muted small">
                                            {(bom.attribute_value_ids || []).map(getAttributeValueName).join(', ') || '-'}
                                        </div>
                                    </td>
                                    <td className="align-top">
                                        {bom.operations && bom.operations.length > 0 ? (
                                            <div className="small">
                                                {[...bom.operations].sort((a:any,b:any) => a.sequence - b.sequence).map((op: any) => (
                                                    <div key={op.id} className="text-muted">
                                                        {op.sequence}. {getOpName(op.operation_id)}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : <span className="text-muted small">-</span>}
                                    </td>
                                    <td className="align-top">
                                        {/* Recursive Tree View with unique parentId scoping */}
                                        {renderBOMTree(bom.lines, bom.id)}
                                    </td>
                                    <td className="pe-4 text-end align-top">
                                        <button className="btn btn-sm btn-link text-danger" onClick={() => onDeleteBOM(bom.id)}>
                                            <i className="bi bi-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
             </div>
          </div>
       </div>
    </div>
  );
}