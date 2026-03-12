import { useState, useEffect } from 'react';
import CodeConfigModal, { CodeConfig } from './CodeConfigModal';
import { useToast } from './Toast';
import { useLanguage } from '../context/LanguageContext';
import SearchableSelect from './SearchableSelect';

export default function SalesOrderView({ items, attributes, salesOrders, partners, onCreateSO, onDeleteSO, onUpdateSOStatus, onGenerateWO }: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [printingSO, setPrintingSO] = useState<any>(null);
  
  const [newSO, setNewSO] = useState({
      po_number: '',
      customer_name: '',
      order_date: new Date().toISOString().split('T')[0],
      lines: [] as any[]
  });
  
  const [newLine, setNewLine] = useState({ item_id: '', qty: 0, due_date: '', attribute_value_ids: [] as string[] });

  // Config State
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
          try {
              setCodeConfig(JSON.parse(savedConfig));
          } catch (e) {
              console.error("Invalid config in localstorage");
          }
      }
  }, []);

  const handleSaveConfig = (newConfig: CodeConfig) => {
      setCodeConfig(newConfig);
      localStorage.setItem('so_code_config', JSON.stringify(newConfig));
      const suggested = suggestSOCode(newConfig);
      setNewSO(prev => ({ ...prev, po_number: suggested }));
  };

  const suggestSOCode = (config = codeConfig) => {
      const parts = [];
      if (config.prefix) parts.push(config.prefix);
      
      const now = new Date();
      if (config.includeYear) parts.push(now.getFullYear());
      if (config.includeMonth) parts.push(String(now.getMonth() + 1).padStart(2, '0'));
      if (config.suffix) parts.push(config.suffix);

      const basePattern = parts.join(config.separator);
      
      let counter = 1;
      let baseCode = `${basePattern}${config.separator}001`;
      
      while (salesOrders.some((s: any) => s.po_number === baseCode)) {
          counter++;
          baseCode = `${basePattern}${config.separator}${String(counter).padStart(3, '0')}`;
      }
      return baseCode;
  };

  // Generate initial suggestion when modal opens
  useEffect(() => {
      if (isCreateOpen && !newSO.po_number) {
          setNewSO(prev => ({ ...prev, po_number: suggestSOCode() }));
      }
  }, [isCreateOpen]);

  const handleAddLine = () => {
      if (!newLine.item_id || newLine.qty <= 0) return;
      setNewSO({ ...newSO, lines: [...newSO.lines, { ...newLine }] });
      setNewLine({ item_id: '', qty: 0, due_date: '', attribute_value_ids: [] });
  };

  const handleRemoveLine = (index: number) => {
      setNewSO({ ...newSO, lines: newSO.lines.filter((_, i) => i !== index) });
  };

  const handleValueChange = (valId: string, attrId: string) => {
      const attr = attributes.find((a: any) => a.id === attrId);
      if (!attr) return;

      const otherValues = newLine.attribute_value_ids.filter(vid => !attr.values.some((v:any) => v.id === vid));
      const newValues = valId ? [...otherValues, valId] : otherValues;
      setNewLine({...newLine, attribute_value_ids: newValues});
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      
      const payload = {
          ...newSO,
          order_date: newSO.order_date || null,
          lines: newSO.lines.map((line: any) => ({
              ...line,
              due_date: line.due_date || null
          }))
      };

      const res = await onCreateSO(payload);
      
      if (res && res.status === 400) {
          // Handle Duplicate PO Number
          let basePO = newSO.po_number;
          // Strip existing suffix if any (e.g. -1, -2)
          const baseMatch = basePO.match(/^(.*)-(\d+)$/);
          if (baseMatch) basePO = baseMatch[1];

          let counter = 1;
          let suggestedPO = `${basePO}-${counter}`;
          
          while (salesOrders.some((s: any) => s.po_number === suggestedPO)) {
              counter++;
              suggestedPO = `${basePO}-${counter}`;
          }

          showToast(`PO Number "${newSO.po_number}" already exists. Suggesting: ${suggestedPO}`, 'warning');
          setNewSO({ ...newSO, po_number: suggestedPO });
      } else if (res && res.ok) {
          setNewSO({ po_number: '', customer_name: '', order_date: new Date().toISOString().split('T')[0], lines: [] });
          setIsCreateOpen(false);
          showToast('Sales Order created successfully', 'success');
      }
  };

  const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
  const getItemCode = (id: string) => items.find((i: any) => i.id === id)?.code || id;
  const isSample = (id: string) => items.find((i: any) => i.id === id)?.category === 'Sample';

  const getStatusBadge = (status: string) => {
      switch(status) {
          case 'READY': return 'bg-info text-white';
          case 'SENT': return 'bg-warning text-dark';
          case 'DELIVERED': return 'bg-success';
          case 'CANCELLED': return 'bg-danger';
          case 'READY_TO_SHIP': return 'bg-info text-white'; // Alias if needed
          default: return 'bg-secondary';
      }
  };

  const formatDate = (date: string | null) => {
      if (!date) return '-';
      return new Date(date).toLocaleDateString();
  };

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

  const handlePrintSO = (so: any) => {
      setPrintingSO(so);
      setTimeout(() => window.print(), 300);
  };

  const customers = partners.filter((p: any) => p.type === 'CUSTOMER' && p.active);
  const getCustomerAddress = (name: string) => partners.find((p: any) => p.name === name)?.address || '-';

  // --- Print Template ---
  const SalesOrderPrintTemplate = ({ so }: { so: any }) => (
      <div className="bg-white p-5 h-100 position-fixed top-0 start-0 w-100 print-container" style={{zIndex: 2000, overflowY: 'auto'}}>
          <div className="d-flex justify-content-between border-bottom pb-3 mb-4">
              <div>
                  <h2 className="fw-bold mb-0">SALES ORDER</h2>
                  <div className="text-muted small">Terras ERP Enterprise System</div>
              </div>
              <div className="text-end">
                  <div className="small text-muted fw-bold uppercase">Order Reference</div>
                  <h4 className="font-monospace mb-0 fw-bold text-primary">{so.po_number}</h4>
                  <div className="small text-muted mt-1">Date: {new Date(so.order_date).toLocaleDateString()}</div>
              </div>
          </div>

          <div className="row mb-5">
              <div className="col-6">
                  <div className="p-3 border rounded bg-light bg-opacity-50 h-100">
                      <h6 className="extra-small fw-bold text-uppercase text-muted border-bottom pb-2 mb-2">Customer Details</h6>
                      <div className="fw-bold fs-5">{so.customer_name}</div>
                      <div className="text-muted small mt-2" style={{ whiteSpace: 'pre-wrap' }}>
                          {getCustomerAddress(so.customer_name)}
                      </div>
                  </div>
              </div>
              <div className="col-6">
                  <div className="p-3 border rounded h-100">
                      <h6 className="extra-small fw-bold text-uppercase text-muted border-bottom pb-2 mb-2">Order Status</h6>
                      <div className="badge bg-secondary mb-3">{so.status}</div>
                      <div className="small text-muted">Authorized By: ________________</div>
                  </div>
              </div>
          </div>

          <table className="table table-bordered table-sm mb-5">
              <thead className="table-light">
                  <tr style={{fontSize: '9pt'}}>
                      <th style={{width: '15%'}}>Item Code</th>
                      <th style={{width: '40%'}}>Item Description / Variation</th>
                      <th style={{width: '15%'}} className="text-end">Quantity</th>
                      <th style={{width: '15%'}} className="text-end">Due Date</th>
                      <th style={{width: '15%'}}>Note</th>
                  </tr>
              </thead>
              <tbody>
                  {so.lines.map((line: any) => (
                      <tr key={line.id} style={{fontSize: '10pt'}}>
                          <td className="font-monospace fw-bold">{getItemCode(line.item_id)}</td>
                          <td>
                              <div className="fw-medium">{getItemName(line.item_id)}</div>
                              <div className="extra-small text-muted fst-italic">
                                  {line.attribute_value_ids.map(getAttributeValueName).join(', ') || 'No variation'}
                              </div>
                          </td>
                          <td className="text-end fw-bold">{line.qty}</td>
                          <td className="text-end small">{line.due_date ? new Date(line.due_date).toLocaleDateString() : '-'}</td>
                          <td></td>
                      </tr>
                  ))}
              </tbody>
          </table>

          <div className="mt-5 pt-5 border-top row g-4 text-center">
              <div className="col-4">
                  <div className="small text-muted mb-5">Requested By</div>
                  <div className="border-top mx-4 pt-2 small fw-bold">Customer Representative</div>
              </div>
              <div className="col-4 offset-4">
                  <div className="small text-muted mb-5">Approved By</div>
                  <div className="border-top mx-4 pt-2 small fw-bold">Production Manager</div>
              </div>
          </div>

          <div className="position-fixed top-0 end-0 p-3 no-print">
              <button className="btn btn-dark shadow rounded-pill px-4" onClick={() => setPrintingSO(null)}>
                  <i className="bi bi-x-lg me-2"></i>Close Preview
              </button>
          </div>
      </div>
  );

  return (
    <div className="row g-4 fade-in">
       {/* Print Overlay */}
       {printingSO && <SalesOrderPrintTemplate so={printingSO} />}

       <CodeConfigModal 
           isOpen={isConfigOpen} 
           onClose={() => setIsConfigOpen(false)} 
           type="SO"
           onSave={handleSaveConfig}
           initialConfig={codeConfig}
           attributes={attributes}
       />

       {/* Create SO Modal */}
       {isCreateOpen && (
       <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 20000, position: 'fixed', inset: 0 }}>
            <div className={`modal-dialog modal-lg modal-dialog-centered`}>
                <div className="modal-content shadow">
                    <div className="modal-header bg-primary bg-opacity-10 text-primary-emphasis">
                        <h5 className="modal-title"><i className="bi bi-cart-plus me-2"></i>Create Sales Order (Incoming)</h5>
                        <button type="button" className="btn-close" onClick={() => setIsCreateOpen(false)}></button>
                    </div>
                    <div className="modal-body">
                        <form onSubmit={handleSubmit}>
                            <div className="row g-3 mb-3">
                                <div className="col-md-4">
                                    <label className="form-label d-flex justify-content-between align-items-center small text-muted">
                                        Ref No. (PO#)
                                        <i 
                                            className="bi bi-gear-fill text-muted" 
                                            style={{cursor: 'pointer'}}
                                            onClick={() => setIsConfigOpen(true)}
                                            title="Configure Auto-Suggestion"
                                        ></i>
                                    </label>
                                    <input className="form-control" placeholder="Auto-generated" value={newSO.po_number} onChange={e => setNewSO({...newSO, po_number: e.target.value})} required />
                                </div>
                                <div className="col-md-5">
                                    <label className="form-label small text-muted">Customer</label>
                                    <SearchableSelect 
                                        options={customers.map((c: any) => ({ value: c.name, label: c.name, subLabel: c.address }))}
                                        value={newSO.customer_name}
                                        onChange={(val) => setNewSO({...newSO, customer_name: val})}
                                        placeholder="Select Customer..."
                                        required
                                    />
                                </div>
                                <div className="col-md-3">
                                    <label className="form-label small text-muted">Date</label>
                                    <input type="date" className="form-control" value={newSO.order_date} onChange={e => setNewSO({...newSO, order_date: e.target.value})} required />
                                </div>
                            </div>
                            
                            <h6 className="small text-uppercase text-muted fw-bold mb-3">Order Items</h6>
                            <div className="bg-light p-3 rounded-3 mb-3 border border-dashed">
                                <div className="row g-2 mb-3">
                                    <div className="col-6">
                                        <label className="form-label small text-muted">Item</label>
                                        <SearchableSelect 
                                            options={items.map((item: any) => ({ value: item.id, label: item.name, subLabel: `${item.code} ${item.category === 'Sample' ? '★' : ''}` }))}
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
                                    {newSO.lines.map((line: any, idx) => (
                                        <div key={idx} className="d-flex justify-content-between align-items-center p-2 bg-white rounded border mb-1 small shadow-sm">
                                            <div>
                                                <span className="fw-bold">{getItemName(line.item_id)}</span>
                                                <span className="text-muted ms-2 font-monospace">{getItemCode(line.item_id)}</span>
                                                {isSample(line.item_id) && <span className="badge bg-warning text-dark ms-2" style={{fontSize: '0.65rem'}}>Sample</span>}
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
                                    {newSO.lines.length === 0 && <div className="text-center text-muted small fst-italic">No items added</div>}
                                </div>
                            </div>

                            <div className="d-flex justify-content-end gap-2 mt-3">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsCreateOpen(false)}>{t('cancel')}</button>
                                <button type="submit" className="btn btn-primary fw-bold px-4">{t('save')} Order</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
       </div>
       )}

       {/* SO List */}
       <div className="col-12">
          <div className="card h-100 shadow-sm border-0">
             <div className="card-header bg-white d-flex justify-content-between align-items-center">
                 <h5 className="card-title mb-0">{t('sales_orders')}</h5>
                 <button className="btn btn-sm btn-primary" onClick={() => setIsCreateOpen(true)}>
                     <i className="bi bi-plus-lg me-2"></i> {t('create')}
                 </button>
             </div>
             <div className="card-body p-0">
                <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                        <thead className="table-light">
                            <tr>
                                <th className="ps-4">Order Ref (PO#)</th>
                                <th>Customer</th>
                                <th>Date</th>
                                <th>Items</th>
                                <th>Status</th>
                                <th style={{width: '100px'}} className="text-end pe-4">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {salesOrders.map((so: any) => (
                                <tr key={so.id}>
                                    <td className="ps-4 fw-bold font-monospace text-primary">{so.po_number}</td>
                                    <td>{so.customer_name}</td>
                                    <td>{new Date(so.order_date).toLocaleDateString()}</td>
                                    <td>
                                        <div className="d-flex flex-column gap-1">
                                            {so.lines.map((line: any) => (
                                                <div key={line.id} className="small text-muted mb-1">
                                                    <div className="d-flex align-items-center">
                                                        <span className="fw-bold text-dark">{line.qty}</span> 
                                                        <span className="mx-1">x</span> 
                                                        <span className="fw-medium text-dark">{getItemName(line.item_id)}</span>
                                                        {isSample(line.item_id) && <i className="bi bi-star-fill text-warning ms-1" style={{fontSize: '0.6rem'}} title="Sample Item"></i>}
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
                                                    {/* Generate WO Action */}
                                                    {so.status === 'PENDING' && (
                                                        <div className="mt-1 ps-3">
                                                            <button 
                                                                className="btn btn-sm btn-outline-primary py-0 px-2 extra-small"
                                                                style={{fontSize: '0.65rem'}}
                                                                onClick={() => onGenerateWO(so, line)}
                                                                title="Create Work Order for this item"
                                                            >
                                                                <i className="bi bi-gear-wide-connected me-1"></i>PRODUCE
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </td>
                                    <td>
                                        <div className="d-flex flex-column gap-1">
                                            <span className={`badge ${getStatusBadge(so.status)}`}>{so.status}</span>
                                            {so.delivered_at && <div className="extra-small text-muted mt-1">Delivered: {formatDate(so.delivered_at)}</div>}
                                        </div>
                                    </td>
                                    <td className="pe-4 text-end">
                                        <div className="d-flex justify-content-end align-items-center gap-2">
                                            {/* Action Buttons based on Status */}
                                            {so.status === 'READY' && (
                                                <button className="btn btn-sm btn-primary py-0 px-2 extra-small" onClick={() => onUpdateSOStatus(so.id, 'SENT')}>
                                                    SENT
                                                </button>
                                            )}
                                            {so.status === 'SENT' && (
                                                <button className="btn btn-sm btn-success py-0 px-2 extra-small" onClick={() => onUpdateSOStatus(so.id, 'DELIVERED')}>
                                                    DELIVERED
                                                </button>
                                            )}

                                            <button className="btn btn-sm btn-link text-primary p-0" title="Print Order" onClick={() => handlePrintSO(so)}>
                                                <i className="bi bi-printer fs-5"></i>
                                            </button>
                                            <button className="btn btn-sm btn-link text-danger p-0" onClick={() => onDeleteSO(so.id)}>
                                                <i className="bi bi-trash fs-5"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {salesOrders.length === 0 && <tr><td colSpan={6} className="text-center py-5 text-muted">No Sales Orders found</td></tr>}
                        </tbody>
                    </table>
                </div>
             </div>
          </div>
       </div>
    </div>
  );
}
