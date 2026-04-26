import { useState, useEffect } from 'react';
import CodeConfigModal, { CodeConfig, buildCodeWithCounter } from '../shared/CodeConfigModal';
import SearchableSelect from '../shared/SearchableSelect';
import { useLanguage } from '../../context/LanguageContext';

export default function BOMForm({ 
    initialItemCode, 
    items, 
    boms, 
    locations, 
    attributes, 
    workCenters, 
    operations, 
    onSave, 
    onCancel, 
    onCreateSubBOM, // New callback
    isSubForm = false
}: any) {
  const { t } = useLanguage();
  
  const [newBOM, setNewBOM] = useState({
      code: '',
      description: '',
      item_code: initialItemCode || '',
      attribute_value_ids: [] as string[],
      qty: 1.0,
      lines: [] as any[],
      operations: [] as any[]
  });
  
  const [newBOMLine, setNewBOMLine] = useState({ item_code: '', attribute_value_ids: [] as string[], qty: 0, source_location_code: '' });
  const [newBOMOp, setNewBOMOp] = useState({ operation_id: '', work_center_id: '', sequence: 10, time_minutes: 0 });
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [codeConfig, setCodeConfig] = useState<CodeConfig>({
      prefix: 'BOM',
      suffix: '',
      separator: '-',
      includeItemCode: true,
      includeVariant: false,
      variantAttributeNames: [],
      includeYear: false,
      includeMonth: false
  });

  useEffect(() => {
      const savedConfig = localStorage.getItem('bom_code_config');
      if (savedConfig) {
          try {
              setCodeConfig(JSON.parse(savedConfig));
          } catch (e) {
              console.error("Invalid config");
          }
      }
      
      // Auto-generate code if item selected
      if (initialItemCode) {
          const suggested = suggestBOMCode(initialItemCode, [], JSON.parse(savedConfig || '{}'));
          setNewBOM(prev => ({...prev, code: suggested, item_code: initialItemCode}));
      }
  }, [initialItemCode]);

  const suggestBOMCode = (itemCode: string, attributeValueIds: string[] = [], config = codeConfig) => {
      const names: string[] = [];
      if (config.includeVariant) {
          for (const attrName of (config.variantAttributeNames ?? [])) {
              const attr = attributes.find((a: any) => a.name === attrName);
              if (!attr) continue;
              const selectedVal = attr.values.find((v: any) => attributeValueIds.includes(v.id));
              if (selectedVal) names.push(selectedVal.value.toUpperCase().replace(/\s+/g, ''));
          }
      }
      let counter = 1;
      let code = buildCodeWithCounter(config, counter, itemCode, names);
      while (boms.some((b: any) => b.code === code)) {
          counter++;
          code = buildCodeWithCounter(config, counter, itemCode, names);
      }
      return code;
  };

  const handleSaveConfig = (newConfig: CodeConfig) => {
      setCodeConfig(newConfig);
      localStorage.setItem('bom_code_config', JSON.stringify(newConfig));
      const suggested = suggestBOMCode(newBOM.item_code, newBOM.attribute_value_ids, newConfig);
      setNewBOM(prev => ({ ...prev, code: suggested }));
  };

  const handleItemChange = (itemCode: string) => {
      const suggestedCode = suggestBOMCode(itemCode, []);
      setNewBOM({...newBOM, item_code: itemCode, code: suggestedCode, attribute_value_ids: []});
  };

  // ... (Other handlers: ValueChange, AddLine, AddOp, Remove) ...
  const handleValueChange = (valId: string, attrId: string, isHeader: boolean) => {
      const attr = attributes.find((a: any) => a.id === attrId);
      if (!attr) return;

      if (isHeader) {
          const otherValues = newBOM.attribute_value_ids.filter(vid => !attr.values.some((v:any) => v.id === vid));
          const newValues = valId ? [...otherValues, valId] : otherValues;
          const suggested = suggestBOMCode(newBOM.item_code, newValues);
          setNewBOM({...newBOM, attribute_value_ids: newValues, code: suggested});
      } else {
          const otherValues = newBOMLine.attribute_value_ids.filter(vid => !attr.values.some((v:any) => v.id === vid));
          const newValues = valId ? [...otherValues, valId] : otherValues;
          setNewBOMLine({...newBOMLine, attribute_value_ids: newValues});
      }
  };

  const handleAddLineToBOM = () => {
      if (!newBOMLine.item_code || newBOMLine.qty <= 0) return;
      setNewBOM({ ...newBOM, lines: [...newBOM.lines, { ...newBOMLine }] });
      setNewBOMLine({ item_code: '', attribute_value_ids: [], qty: 0, source_location_code: '' });
  };

  const handleAddOpToBOM = () => {
      if (!newBOMOp.operation_id) return;
      setNewBOM({ ...newBOM, operations: [...newBOM.operations, { ...newBOMOp }] });
      setNewBOMOp({ operation_id: '', work_center_id: '', sequence: newBOMOp.sequence + 10, time_minutes: 0 });
  };

  const handleRemoveLine = (index: number) => {
      setNewBOM({ ...newBOM, lines: newBOM.lines.filter((_, i) => i !== index) });
  };

  const handleRemoveOp = (index: number) => {
      setNewBOM({ ...newBOM, operations: newBOM.operations.filter((_, i) => i !== index) });
  };

  // Helpers
  const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
  const getItemId = (code: string) => items.find((i: any) => i.code === code)?.id;
  const getOpName = (id: string) => operations.find((o: any) => o.id === id)?.name || id;
  const getWCName = (id: string) => workCenters.find((w: any) => w.id === id)?.name || id;
  const getLocationNameByCode = (code: string) => locations.find((l: any) => l.code === code)?.name || code;
  
  const getAttributeValueName = (valId: string) => {
      for (const attr of attributes) {
          const val = attr.values.find((v: any) => v.id === valId);
          if (val) return val.value;
      }
      return valId;
  };

  const getBoundAttributes = (itemCode: string) => {
      const item = items.find((i: any) => i.code === itemCode);
      if (!item || !item.attribute_ids) return [];
      return attributes.filter((a: any) => item.attribute_ids.includes(a.id));
  };

  const headerBoundAttrs = getBoundAttributes(newBOM.item_code);
  const lineBoundAttrs = getBoundAttributes(newBOMLine.item_code);

  // Helper check for existing BOM
  const hasBOM = (itemCode: string) => {
      const itemId = getItemId(itemCode);
      return boms.some((b: any) => b.item_id === itemId);
  };

  return (
      <div className="modal-body">
          <CodeConfigModal 
               isOpen={isConfigOpen} 
               onClose={() => setIsConfigOpen(false)} 
               type="BOM"
               onSave={handleSaveConfig}
               initialConfig={codeConfig}
               attributes={attributes}
           />
           
          <form onSubmit={(e) => { e.preventDefault(); onSave(newBOM); }}>
              <div className="row g-3 mb-3">
                  <div className="col-md-8">
                      <label className="form-label d-flex justify-content-between align-items-center small text-muted">
                          {t('item_code')}
                          <i className="bi bi-gear-fill text-muted" style={{cursor: 'pointer'}} onClick={() => setIsConfigOpen(true)}></i>
                      </label>
                      <input className="form-control" placeholder="Auto-generated" value={newBOM.code} onChange={e => setNewBOM({...newBOM, code: e.target.value})} required />
                  </div>
                  <div className="col-md-4">
                      <label className="form-label small text-muted">{t('qty')}</label>
                      <input type="number" className="form-control" value={newBOM.qty} onChange={e => setNewBOM({...newBOM, qty: parseFloat(e.target.value)})} required />
                  </div>
              </div>
              
              <div className="p-3 bg-light rounded-3 mb-4 border border-warning border-opacity-25">
                  <h6 className="small text-uppercase text-muted fw-bold mb-3 border-bottom pb-2">{t('finished_good')}</h6>
                  <div className="mb-3">
                      <SearchableSelect 
                          options={items.map((item: any) => ({ value: item.code, label: item.name, subLabel: item.code }))}
                          value={newBOM.item_code}
                          onChange={handleItemChange}
                          required
                          disabled={isSubForm}
                          placeholder={t('search') + "..."}
                      />
                  </div>

                  {headerBoundAttrs.map((attr: any) => (
                      <div key={attr.id} className="mb-2">
                          <label className="form-label small mb-1 text-muted">{attr.name}</label>
                          <select 
                              className="form-select form-select-sm"
                              value={newBOM.attribute_value_ids.find(vid => attr.values.some((v:any) => v.id === vid)) || ''}
                              onChange={e => handleValueChange(e.target.value, attr.id, true)}
                          >
                              <option value="">Select {attr.name}...</option>
                              {attr.values.map((v: any) => <option key={v.id} value={v.id}>{v.value}</option>)}
                          </select>
                      </div>
                  ))}
              </div>

              <div className="row g-4">
                  {/* Routing Section */}
                  <div className="col-md-6">
                      <h6 className="small text-uppercase text-muted fw-bold mb-3">{t('routing_operations')}</h6>
                      <div className="bg-light p-3 rounded-3 mb-4 border border-dashed h-100">
                          {/* (Routing Inputs - Same as before) */}
                          <div className="row g-2 mb-3 align-items-end">
                              <div className="col-3">
                                  <label className="form-label small text-muted">Seq</label>
                                  <input className="form-control form-control-sm" value={newBOMOp.sequence} onChange={e => setNewBOMOp({...newBOMOp, sequence: parseInt(e.target.value)})} />
                              </div>
                              <div className="col-9">
                                  <label className="form-label small text-muted">Operation</label>
                                  <select className="form-select form-select-sm" value={newBOMOp.operation_id} onChange={e => setNewBOMOp({...newBOMOp, operation_id: e.target.value})}>
                                      <option value="">Select...</option>
                                      {(operations || []).map((op: any) => <option key={op.id} value={op.id}>{op.name}</option>)}
                                  </select>
                              </div>
                              <div className="col-6">
                                  <label className="form-label small text-muted">Station</label>
                                  <select className="form-select form-select-sm" value={newBOMOp.work_center_id} onChange={e => setNewBOMOp({...newBOMOp, work_center_id: e.target.value})}>
                                      <option value="">Optional...</option>
                                      {(workCenters || []).map((wc: any) => <option key={wc.id} value={wc.id}>{wc.name}</option>)}
                                  </select>
                              </div>
                              <div className="col-3">
                                  <label className="form-label small text-muted">Time(m)</label>
                                  <input type="number" className="form-control form-control-sm" value={newBOMOp.time_minutes} onChange={e => setNewBOMOp({...newBOMOp, time_minutes: parseFloat(e.target.value)})} />
                              </div>
                              <div className="col-3">
                                  <button type="button" className="btn btn-sm btn-info w-100" onClick={handleAddOpToBOM} disabled={!newBOMOp.operation_id}>
                                      <i className="bi bi-plus-lg"></i>
                                  </button>
                              </div>
                          </div>

                          <div className="mt-2" style={{maxHeight: '200px', overflowY: 'auto'}}>
                              {(newBOM.operations || []).sort((a:any,b:any) => a.sequence - b.sequence).map((op: any, idx) => (
                                  <div key={idx} className="d-flex justify-content-between align-items-center p-2 bg-white rounded border mb-1 small shadow-sm">
                                      <div className="d-flex align-items-center gap-2">
                                          <span className="badge bg-secondary">{op.sequence}</span>
                                          <span className="fw-bold">{getOpName(op.operation_id)}</span> 
                                          {op.work_center_id && <span className="text-muted fst-italic">@ {getWCName(op.work_center_id)}</span>}
                                      </div>
                                      <div className="d-flex align-items-center gap-2">
                                          <span className="text-muted">{op.time_minutes}m</span>
                                          <button type="button" className="btn btn-sm btn-link text-danger p-0" onClick={() => handleRemoveOp(idx)}>
                                              <i className="bi bi-x-circle"></i>
                                          </button>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>

                  {/* Materials Section */}
                  <div className="col-md-6">
                      <h6 className="small text-uppercase text-muted fw-bold mb-3">{t('materials')}</h6>
                      <div className="bg-light p-3 rounded-3 mb-3 border border-dashed h-100">
                          {/* (Material Inputs - Same as before) */}
                          <div className="row g-2 mb-3">
                              <div className="col-12">
                                  <label className="form-label small text-muted">Item</label>
                                  <SearchableSelect 
                                      options={items.map((item: any) => ({ value: item.code, label: item.name, subLabel: item.code }))}
                                      value={newBOMLine.item_code}
                                      onChange={(val) => setNewBOMLine({...newBOMLine, item_code: val, attribute_value_ids: []})}
                                      placeholder="Select Item..."
                                  />
                              </div>
                              
                              {lineBoundAttrs.map((attr: any) => (
                                  <div key={attr.id} className="col-6">
                                      <label className="form-label small text-muted">{attr.name}</label>
                                      <select 
                                          className="form-select form-select-sm"
                                          value={newBOMLine.attribute_value_ids.find(vid => attr.values.some((v:any) => v.id === vid)) || ''}
                                          onChange={e => handleValueChange(e.target.value, attr.id, false)}
                                      >
                                          <option value="">Any {attr.name}</option>
                                          {attr.values.map((v: any) => <option key={v.id} value={v.id}>{v.value}</option>)}
                                      </select>
                                  </div>
                              ))}

                              <div className="col-6">
                                  <label className="form-label small text-muted">Qty</label>
                                  <input type="number" className="form-control form-control-sm" placeholder="0" value={newBOMLine.qty} onChange={e => setNewBOMLine({...newBOMLine, qty: parseFloat(e.target.value)})} />
                              </div>
                              
                              <div className="col-6">
                                  <label className="form-label small text-muted">Source (Opt)</label>
                                  <select className="form-select form-select-sm" value={newBOMLine.source_location_code} onChange={e => setNewBOMLine({...newBOMLine, source_location_code: e.target.value})}>
                                      <option value="">Default...</option>
                                      {(locations || []).map((l: any) => (
                                          <option key={l.id} value={l.code}>{l.name}</option>
                                      ))}
                                  </select>
                              </div>

                              <div className="col-12 mt-2 text-end">
                                  <button type="button" className="btn btn-sm btn-secondary px-3" onClick={handleAddLineToBOM} disabled={!newBOMLine.item_code}>{t('add')}</button>
                              </div>
                          </div>
                          
                          <div className="mt-2" style={{maxHeight: '200px', overflowY: 'auto'}}>
                              {newBOM.lines.map((line: any, idx) => (
                                  <div key={idx} className="d-flex justify-content-between align-items-center p-2 bg-white rounded border mb-1 small shadow-sm">
                                      <div>
                                          <div className="d-flex align-items-center gap-2">
                                              <span className="fw-bold">{line.item_code}</span>
                                              {!hasBOM(line.item_code) && (
                                                  <button 
                                                      type="button" 
                                                      className="btn btn-sm btn-warning py-0 px-2 shadow-sm" 
                                                      style={{fontSize: '0.7rem', lineHeight: '1.5'}}
                                                      title="Define recipe for this item"
                                                      onClick={() => onCreateSubBOM && onCreateSubBOM(line.item_code)}
                                                  >
                                                      <i className="bi bi-diagram-3-fill me-1"></i>Add Recipe
                                                  </button>
                                              )}
                                          </div>
                                          <div className="text-muted" style={{fontSize: '0.75rem'}}>
                                              {(line.attribute_value_ids || []).map(getAttributeValueName).join(', ') || 'No variations'}
                                          </div>
                                          {line.source_location_code && (
                                              <div className="text-primary fst-italic" style={{fontSize: '0.7rem'}}>
                                                  <i className="bi bi-geo-alt"></i> {getLocationNameByCode(line.source_location_code)}
                                              </div>
                                          )}
                                      </div>
                                      <div className="d-flex align-items-center gap-2">
                                          <span className="badge bg-secondary">{line.qty}</span>
                                          <button type="button" className="btn btn-sm btn-link text-danger p-0" onClick={() => handleRemoveLine(idx)}>
                                              <i className="bi bi-x-circle"></i>
                                          </button>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>

              <div className="d-flex justify-content-end gap-2 mt-3">
                  <button type="button" className="btn btn-secondary" onClick={onCancel}>{t('cancel')}</button>
                  <button type="submit" className="btn btn-warning fw-bold px-4">{t('save')} {isSubForm ? 'Sub-BOM' : 'BOM'}</button>
              </div>
          </form>
      </div>
  );
}
