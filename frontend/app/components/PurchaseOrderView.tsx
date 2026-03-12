import { useState, useEffect } from 'react';
import CodeConfigModal, { CodeConfig } from './CodeConfigModal';
import { useToast } from './Toast';
import { useLanguage } from '../context/LanguageContext';
import SearchableSelect from './SearchableSelect';
import PrintHeader from './PrintHeader';

export default function PurchaseOrderView({ items, attributes, purchaseOrders, partners, locations, onCreatePO, onDeletePO, onReceivePO }: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [printingPO, setPrintingPO] = useState<any>(null);
  
  const [newPO, setNewPO] = useState({
      po_number: '',
      supplier_id: '',
      target_location_id: '',
      order_date: new Date().toISOString().split('T')[0],
      lines: [] as any[]
  });
  
  const [newLine, setNewLine] = useState({ item_id: '', qty: 0, due_date: '', attribute_value_ids: [] as string[] });

  // Config State
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
          try {
              setCodeConfig(JSON.parse(savedConfig));
          } catch (e) {
              console.error("Invalid config in localstorage");
          }
      }
  }, []);

  const handleSaveConfig = (newConfig: CodeConfig) => {
      setCodeConfig(newConfig);
      localStorage.setItem('real_po_code_config', JSON.stringify(newConfig));
      const suggested = suggestPOCode(newConfig);
      setNewPO(prev => ({ ...prev, po_number: suggested }));
  };

  const suggestPOCode = (config = codeConfig) => {
      const parts = [];
      if (config.prefix) parts.push(config.prefix);
      
      const now = new Date();
      if (config.includeYear) parts.push(now.getFullYear());
      if (config.includeMonth) parts.push(String(now.getMonth() + 1).padStart(2, '0'));
      if (config.suffix) parts.push(config.suffix);

      const basePattern = parts.join(config.separator);
      
      let counter = 1;
      let baseCode = `${basePattern}${config.separator}001`;
      
      while (purchaseOrders.some((s: any) => s.po_number === baseCode)) {
          counter++;
          baseCode = `${basePattern}${config.separator}${String(counter).padStart(3, '0')}`;
      }
      return baseCode;
  };

  useEffect(() => {
      if (isCreateOpen && !newPO.po_number) {
          setNewPO(prev => ({ ...prev, po_number: suggestPOCode() }));
      }
  }, [isCreateOpen]);

  const handleAddLine = () => {
      if (!newLine.item_id || newLine.qty <= 0) return;
      setNewPO({ ...newPO, lines: [...newPO.lines, { ...newLine }] });
      setNewLine({ item_id: '', qty: 0, due_date: '', attribute_value_ids: [] });
  };

  const handleRemoveLine = (index: number) => {
      setNewPO({ ...newPO, lines: newPO.lines.filter((_, i) => i !== index) });
  };

  const handleValueChange = (valId: string, attrId: string) => {
      const attr = attributes.find((a: any) => a.id === attrId);
      if (!attr) return;

      const otherValues = newLine.attribute_value_ids.filter(vid => !attr.values.some((v:any) => v.id === vid));
      const newValues = valId ? [...otherValues, valId] : otherValues;
      setNewLine({...newLine, attribute_value_ids: newValues});
  };

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      
      const payload = {
          ...newPO,
          supplier_id: newPO.supplier_id || null,
          target_location_id: newPO.target_location_id || null,
          order_date: newPO.order_date || null,
          lines: newPO.lines.map((line: any) => ({
              ...line,
              due_date: line.due_date || null
          }))
      };

      onCreatePO(payload);
      setNewPO({ po_number: '', supplier_id: '', target_location_id: '', order_date: new Date().toISOString().split('T')[0], lines: [] });
      setIsCreateOpen(false);
  };

  const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
  const getItemCode = (id: string) => items.find((i: any) => i.id === id)?.code || id;
  
  const getBoundAttributes = (itemId: string) => {
      const item = items.find((i: any) => i.id === itemId);
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
      setTimeout(() => window.print(), 300);
  };

  const suppliers = partners.filter((p: any) => p.type === 'SUPPLIER' && p.active);
  const getSupplierName = (id: string) => partners.find((p: any) => p.id === id)?.name || id;
  const getSupplierAddress = (id: string) => partners.find((p: any) => p.id === id)?.address || '-';
  const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || id;

  // --- Print Template ---
  const PurchaseOrderPrintTemplate = ({ po }: { po: any }) => (
      <div className="bg-white p-5 h-100 position-fixed top-0 start-0 w-100 print-container" style={{zIndex: 2000, overflowY: 'auto'}}>
          <PrintHeader title="Purchase Order" />

          <div className="row mb-3 mt-4 text-dark">
              <div className="col-8">
                  <div className="small text-muted fw-bold uppercase">PO Number</div>
                  <h4 className="font-monospace mb-0 fw-bold text-success">{po.po_number}</h4>
                  <div className="small text-muted mt-1">Date: {new Date(po.order_date).toLocaleDateString()}</div>
              </div>
              <div className="col-4 text-end">
                   <div className="badge bg-secondary mb-3">Status: {po.status}</div>
              </div>
          </div>

          <div className="row mb-5">
              <div className="col-6">
                  <div className="p-3 border rounded bg-light bg-opacity-50 h-100">
                      <h6 className="extra-small fw-bold text-uppercase text-muted border-bottom pb-2 mb-2">Supplier Details</h6>
                      <div className="fw-bold fs-5">{getSupplierName(po.supplier_id)}</div>
                      <div className="text-muted small mt-2" style={{ whiteSpace: 'pre-wrap' }}>
                          {getSupplierAddress(po.supplier_id)}
                      </div>
                  </div>
              </div>
              <div className="col-6">
                  <div className="p-3 border rounded h-100">
                      <h6 className="extra-small fw-bold text-uppercase text-muted border-bottom pb-2 mb-2">Ship To / Destination</h6>
                      <div className="fw-bold text-dark mb-1">{getLocationName(po.target_location_id)}</div>
                      <div className="small text-muted mb-3">Terras Manufacturing Facility</div>
                      <div className="badge bg-secondary mb-3">Status: {po.status}</div>
                  </div>
              </div>
          </div>

          <table className="table table-bordered table-sm mb-5">
              <thead className="table-light">
                  <tr style={{fontSize: '9pt'}}>
                      <th style={{width: '15%'}}>Material Code</th>
                      <th style={{width: '45%'}}>Description / Specification</th>
                      <th style={{width: '15%'}} className="text-end">Quantity</th>
                      <th style={{width: '25%'}}>Expected Delivery</th>
                  </tr>
              </thead>
              <tbody>
                  {po.lines.map((line: any) => (
                      <tr key={line.id} style={{fontSize: '10pt'}}>
                          <td className="font-monospace fw-bold">{getItemCode(line.item_id)}</td>
                          <td>
                              <div className="fw-medium">{getItemName(line.item_id)}</div>
                              <div className="extra-small text-muted fst-italic">
                                  {line.attribute_value_ids.map(getAttributeValueName).join(', ') || 'No variation'}
                              </div>
                          </td>
                          <td className="text-end fw-bold">{line.qty}</td>
                          <td className="small">{line.due_date ? new Date(line.due_date).toLocaleDateString() : '-'}</td>
                      </tr>
                  ))}
              </tbody>
          </table>

          <div className="mt-5 pt-5 border-top row g-4 text-center">
              <div className="col-4">
                  <div className="small text-muted mb-5">Issued By</div>
                  <div className="border-top mx-4 pt-2 small fw-bold">Procurement Officer</div>
              </div>
              <div className="col-4 offset-4">
                  <div className="small text-muted mb-5">Acknowledged By</div>
                  <div className="border-top mx-4 pt-2 small fw-bold">Supplier Signature / Stamp</div>
              </div>
          </div>

          <div className="position-fixed top-0 end-0 p-3 no-print">
              <button className="btn btn-dark shadow rounded-pill px-4" onClick={() => setPrintingPO(null)}>
                  <i className="bi bi-x-lg me-2"></i>Close Preview
              </button>
          </div>
      </div>
  );

  return (
    <div className="row g-4 fade-in">
       {/* Print Overlay */}
       {printingPO && <PurchaseOrderPrintTemplate po={printingPO} />}

       <CodeConfigModal 
           isOpen={isConfigOpen} 
           onClose={() => setIsConfigOpen(false)} 
           type="PO"
           onSave={handleSaveConfig}
           initialConfig={codeConfig}
           attributes={attributes}
       />

       {/* Create PO Modal */}
       {isCreateOpen && (
       <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 20000, position: 'fixed', inset: 0 }}>
            <div className={`modal-dialog modal-lg modal-dialog-centered`}>
                <div className="modal-content shadow">
                    <div className="modal-header bg-success bg-opacity-10 text-success-emphasis">
                        <h5 className="modal-title"><i className="bi bi-cart-plus me-2"></i>Create Purchase Order (Outgoing)</h5>
                        <button type="button" className="btn-close" onClick={() => setIsCreateOpen(false)}></button>
                    </div>
                    <div className="modal-body">
                        <form onSubmit={handleSubmit}>
                            <div className="row g-3 mb-3">
                                <div className="col-md-4">
                                    <label className="form-label d-flex justify-content-between align-items-center small text-muted">
                                        PO Number
                                        <i 
                                            className="bi bi-gear-fill text-muted" 
                                            style={{cursor: 'pointer'}}
                                            onClick={() => setIsConfigOpen(true)}
                                            title="Configure Auto-Suggestion"
                                        ></i>
                                    </label>
                                    <input className="form-control" placeholder="Auto-generated" value={newPO.po_number} onChange={e => setNewPO({...newPO, po_number: e.target.value})} required />
                                </div>
                                <div className="col-md-5">
                                    <label className="form-label small text-muted">Supplier</label>
                                    <SearchableSelect 
                                        options={suppliers.map((c: any) => ({ value: c.id, label: c.name, subLabel: c.address }))}
                                        value={newPO.supplier_id}
                                        onChange={(val) => setNewPO({...newPO, supplier_id: val})}
                                        placeholder="Select Supplier..."
                                        required
                                    />
                                </div>
                                <div className="col-md-3">
                                    <label className="form-label small text-muted">Receiving Warehouse</label>
                                    <SearchableSelect 
                                        options={locations.map((l: any) => ({ value: l.id, label: l.name, subLabel: l.code }))}
                                        value={newPO.target_location_id}
                                        onChange={(val) => setNewPO({...newPO, target_location_id: val})}
                                        placeholder="Select..."
                                        required
                                    />
                                </div>
                                <div className="col-md-3">
                                    <label className="form-label small text-muted">Date</label>
                                    <input type="date" className="form-control" value={newPO.order_date} onChange={e => setNewPO({...newPO, order_date: e.target.value})} required />
                                </div>
                            </div>
                            
                            <h6 className="small text-uppercase text-muted fw-bold mb-3">Order Items</h6>
                            <div className="bg-light p-3 rounded-3 mb-3 border border-dashed">
                                <div className="row g-2 mb-3">
                                    <div className="col-6">
                                        <label className="form-label small text-muted">Item</label>
                                        <SearchableSelect 
                                            options={items.map((item: any) => ({ value: item.id, label: item.name, subLabel: `${item.code}` }))}
                                            value={newLine.item_id}
                                            onChange={(val) => setNewLine({...newLine, item_id: val, attribute_value_ids: []})}
                                            placeholder="Select Item..."
                                        />
                                    </div>
                                    <div className="col-3">
                                        <label className="form-label small text-muted">Qty</label>
                                        <input type="number" className="form-control" placeholder="0" value={newLine.qty} onChange={e => setNewLine({...newLine, qty: parseFloat(e.target.value)})} />
                                    </div>
                                    <div className="col-3 d-flex align-items-end">
                                        <button type="button" className="btn btn-secondary w-100" onClick={handleAddLine} disabled={!newLine.item_id}>Add</button>
                                    </div>
                                    
                                    {/* Attribute Selection */}
                                    {currentBoundAttrs.length > 0 && (
                                        <div className="col-12 mt-2">
                                            <div className="card card-body bg-white border-0 shadow-sm p-2">
                                                <small className="text-muted fw-bold mb-2 d-block">Variants</small>
                                                <div className="row g-2">
                                                    {currentBoundAttrs.map((attr: any) => (
                                                        <div key={attr.id} className="col-md-4">
                                                            <select 
                                                                className="form-select form-select-sm"
                                                                value={newLine.attribute_value_ids.find(vid => attr.values.some((v:any) => v.id === vid)) || ''}
                                                                onChange={e => handleValueChange(e.target.value, attr.id)}
                                                            >
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
                                
                                <div className="mt-2">
                                    {newPO.lines.map((line: any, idx) => (
                                        <div key={idx} className="d-flex justify-content-between align-items-center p-2 bg-white rounded border mb-1 small shadow-sm">
                                            <div>
                                                <span className="fw-bold">{getItemName(line.item_id)}</span>
                                                <span className="text-muted ms-2 font-monospace">{getItemCode(line.item_id)}</span>
                                                <div className="small text-muted fst-italic">
                                                    {(line.attribute_value_ids || []).map(getAttributeValueName).join(', ')}
                                                </div>
                                            </div>
                                            <div className="d-flex align-items-center gap-3">
                                                <span className="fw-bold">x{line.qty}</span>
                                                <button type="button" className="btn btn-sm btn-link text-danger p-0" onClick={() => handleRemoveLine(idx)}>
                                                    <i className="bi bi-x-circle"></i>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    {newPO.lines.length === 0 && <div className="text-center text-muted small fst-italic">No items added</div>}
                                </div>
                            </div>

                            <div className="d-flex justify-content-end gap-2 mt-3">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsCreateOpen(false)}>{t('cancel')}</button>
                                <button type="submit" className="btn btn-success fw-bold px-4">{t('save')} PO</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
       </div>
       )}

       {/* PO List */}
       <div className="col-12">
          <div className="card h-100 shadow-sm border-0">
             <div className="card-header bg-white d-flex justify-content-between align-items-center">
                 <h5 className="card-title mb-0">{t('purchase_orders')}</h5>
                 <button className="btn btn-sm btn-success text-white" onClick={() => setIsCreateOpen(true)}>
                     <i className="bi bi-plus-lg me-2"></i> {t('create')}
                 </button>
             </div>
             <div className="card-body p-0">
                <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                        <thead className="table-light">
                            <tr>
                                <th className="ps-4">PO Number</th>
                                <th>Supplier</th>
                                <th>Date</th>
                                <th>Items</th>
                                <th>Status</th>
                                <th style={{width: '120px'}} className="text-end pe-4">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {purchaseOrders.map((po: any) => (
                                <tr key={po.id}>
                                    <td className="ps-4 fw-bold font-monospace text-primary">{po.po_number}</td>
                                    <td>{getSupplierName(po.supplier_id)}</td>
                                    <td>{new Date(po.order_date).toLocaleDateString()}</td>
                                    <td>
                                        <div className="d-flex flex-column gap-1">
                                            {po.lines.map((line: any) => (
                                                <div key={line.id} className="small text-muted mb-1">
                                                    <div className="d-flex align-items-center">
                                                        <span className="fw-bold text-dark">{line.qty}</span> 
                                                        <span className="mx-1">x</span> 
                                                        <span className="fw-medium text-dark">{getItemName(line.item_id)}</span>
                                                    </div>
                                                    {line.attribute_value_ids && line.attribute_value_ids.length > 0 && (
                                                        <div className="ps-3 border-start ms-1 mt-1" style={{fontSize: '0.75rem'}}>
                                                            {line.attribute_value_ids.map((vid: string) => (
                                                                <span key={vid} className="badge bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-10 me-1">
                                                                    {getAttributeValueName(vid)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`badge ${po.status === 'RECEIVED' ? 'bg-success' : 'bg-secondary'}`}>
                                            {po.status}
                                        </span>
                                    </td>
                                    <td className="pe-4 text-end">
                                        <div className="d-flex justify-content-end align-items-center gap-2">
                                            <button className="btn btn-sm btn-link text-primary p-0" title="Print PO" onClick={() => handlePrintPO(po)}>
                                                <i className="bi bi-printer fs-5"></i>
                                            </button>
                                            {po.status !== 'RECEIVED' && (
                                                <button 
                                                    className="btn btn-sm btn-primary shadow-sm py-0 px-2" 
                                                    style={{fontSize: '0.75rem'}}
                                                    onClick={() => onReceivePO(po.id)}
                                                >
                                                    <i className="bi bi-box-arrow-in-down me-1"></i>Receive
                                                </button>
                                            )}
                                            <button className="btn btn-sm btn-link text-danger p-0" onClick={() => onDeletePO(po.id)}>
                                                <i className="bi bi-trash fs-5"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {purchaseOrders.length === 0 && <tr><td colSpan={6} className="text-center py-5 text-muted">No Purchase Orders found</td></tr>}
                        </tbody>
                    </table>
                </div>
             </div>
          </div>
       </div>
    </div>
  );
}
