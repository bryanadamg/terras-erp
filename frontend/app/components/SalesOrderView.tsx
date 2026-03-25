import { useState, useEffect } from 'react';
import CodeConfigModal, { CodeConfig, buildCodeParts } from './CodeConfigModal';
import { useToast } from './Toast';
import { useLanguage } from '../context/LanguageContext';
import SearchableSelect from './SearchableSelect';
import PrintHeader from './PrintHeader';
import ModalWrapper from './ModalWrapper';

export default function SalesOrderView({ items, attributes, salesOrders, partners, onCreateSO, onDeleteSO, onUpdateSOStatus, onGenerateWO }: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [printingSO, setPrintingSO] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [currentStyle, setCurrentStyle] = useState('classic');

  // Produce dropdown portal state
  const [produceDropdownSO, setProduceDropdownSO] = useState<any>(null);
  const [produceDropdownPos, setProduceDropdownPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
      const saved = localStorage.getItem('ui_style');
      if (saved) setCurrentStyle(saved);
  }, []);

  const classic = currentStyle === 'classic';

  // ── XP shared inline styles ──────────────────────────────────────────────
  const xpBevel: React.CSSProperties = {
      border: '2px solid',
      borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
      boxShadow: '2px 2px 4px rgba(0,0,0,0.3)',
      background: '#ece9d8',
      borderRadius: 0,
  };

  const xpTitleBar: React.CSSProperties = {
      background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)',
      color: '#ffffff',
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '12px',
      fontWeight: 'bold',
      padding: '4px 8px',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
      borderBottom: '1px solid #003080',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: '26px',
      flexWrap: 'wrap' as const,
      gap: '4px',
  };

  const xpToolbar: React.CSSProperties = {
      background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)',
      borderBottom: '1px solid #b0a898',
      padding: '3px 6px',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      flexWrap: 'wrap' as const,
  };

  const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '11px',
      padding: '2px 10px',
      cursor: 'pointer',
      background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
      border: '1px solid',
      borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
      color: '#000000',
      borderRadius: 0,
      ...extra,
  });

  const xpInput: React.CSSProperties = {
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '11px',
      border: '1px solid #7f9db9',
      boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)',
      padding: '1px 6px',
      background: '#ffffff',
      color: '#000000',
      height: '20px',
      outline: 'none',
  };

  const xpSep: React.CSSProperties = {
      width: '1px',
      height: '20px',
      background: '#a0988c',
      margin: '0 2px',
      flexShrink: 0,
  };

  const xpTableHeader: React.CSSProperties = {
      background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)',
      borderBottom: '2px solid #808080',
      fontSize: '10px',
      fontWeight: 'bold',
      color: '#000000',
  };

  const xpThCell: React.CSSProperties = {
      padding: '3px 6px',
      borderRight: '1px solid #b0aaa0',
      textAlign: 'left' as const,
      whiteSpace: 'nowrap' as const,
      fontFamily: 'Tahoma, Arial, sans-serif',
  };

  const tdBase: React.CSSProperties = {
      padding: '4px 6px',
      borderRight: '1px solid #c0bdb5',
      borderBottom: '1px solid #d0cdc8',
      verticalAlign: 'middle' as const,
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '11px',
  };

  // Close produce dropdown on outside click / scroll
  useEffect(() => {
      const close = (e: any) => {
          if (!e.target.closest('.produce-dropdown-btn') && !e.target.closest('.produce-dropdown-menu')) {
              setProduceDropdownSO(null);
          }
      };
      const closeScroll = () => setProduceDropdownSO(null);
      document.addEventListener('click', close);
      window.addEventListener('scroll', closeScroll, true);
      return () => {
          document.removeEventListener('click', close);
          window.removeEventListener('scroll', closeScroll, true);
      };
  }, []);

  const [newSO, setNewSO] = useState({
      po_number: '',
      customer_name: '',
      order_date: new Date().toISOString().split('T')[0],
      lines: [] as any[]
  });

  const [newLine, setNewLine] = useState({ item_id: '', qty: 0, due_date: '', attribute_value_ids: [] as string[] });

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
      const parts = buildCodeParts(config);
      const basePattern = parts.join(config.separator);
      let counter = 1;
      let baseCode = `${basePattern}${config.separator}001`;
      while (salesOrders.some((s: any) => s.po_number === baseCode)) {
          counter++;
          baseCode = `${basePattern}${config.separator}${String(counter).padStart(3, '0')}`;
      }
      return baseCode;
  };

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
      const otherValues = newLine.attribute_value_ids.filter(vid => !attr.values.some((v: any) => v.id === vid));
      setNewLine({...newLine, attribute_value_ids: valId ? [...otherValues, valId] : otherValues});
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      const payload = {
          ...newSO,
          order_date: newSO.order_date || null,
          lines: newSO.lines.map((line: any) => ({ ...line, due_date: line.due_date || null }))
      };
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
          default: return 'bg-secondary';
      }
  };

  const getStatusXPStyle = (status: string): React.CSSProperties => {
      const map: Record<string, { bg: string; border: string; color: string }> = {
          PENDING:   { bg: '#e8e8e8', border: '#6a6a6a', color: '#222' },
          READY:     { bg: '#e8f5e9', border: '#2e7d32', color: '#1b4620' },
          SENT:      { bg: '#fff8e1', border: '#c77800', color: '#4a3000' },
          DELIVERED: { bg: '#e8f5e9', border: '#1a5e1a', color: '#0a3e0a' },
          CANCELLED: { bg: '#fce4ec', border: '#b71c1c', color: '#6b0000' },
      };
      const s = map[status] || { bg: '#e8e8e8', border: '#6a6a6a', color: '#222' };
      return {
          background: s.bg, border: `1px solid ${s.border}`, color: s.color,
          padding: '1px 5px', fontSize: '9px', fontFamily: 'Tahoma, Arial, sans-serif',
          fontWeight: 'bold', whiteSpace: 'nowrap' as const,
      };
  };

  const formatDate = (date: string | null) => {
      if (!date) return '—';
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
  const getCustomerAddress = (name: string) => partners.find((p: any) => p.name === name)?.address || '—';

  const STATUS_FILTERS = ['ALL', 'PENDING', 'READY', 'SENT', 'DELIVERED'];

  const filteredOrders = salesOrders.filter((so: any) => {
      const matchSearch = !searchTerm ||
          so.po_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
          so.customer_name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === 'ALL' || so.status === statusFilter;
      return matchSearch && matchStatus;
  });

  const openProduceDropdown = (so: any, e: React.MouseEvent) => {
      e.stopPropagation();
      if (produceDropdownSO?.id === so.id) { setProduceDropdownSO(null); return; }
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      setProduceDropdownPos({ top: rect.bottom + window.scrollY + 2, left: rect.right + window.scrollX - 200 });
      setProduceDropdownSO(so);
  };

  // --- Print Template ---
  const SalesOrderPrintTemplate = ({ so }: { so: any }) => (
      <div className="bg-white p-5 h-100 position-fixed top-0 start-0 w-100 print-container" style={{zIndex: 2000, overflowY: 'auto'}}>
          <PrintHeader title="Sales Order" />
          <div className="row mb-3 mt-4">
              <div className="col-8">
                  <div className="small text-muted fw-bold">Order Reference</div>
                  <h4 className="font-monospace mb-0 fw-bold text-primary">{so.po_number}</h4>
                  <div className="small text-muted mt-1">Date: {new Date(so.order_date).toLocaleDateString()}</div>
              </div>
              <div className="col-4 text-end">
                  <div className="badge bg-secondary mb-3">{so.status}</div>
              </div>
          </div>
          <div className="row mb-5">
              <div className="col-6">
                  <div className="p-3 border rounded bg-light bg-opacity-50 h-100">
                      <h6 className="extra-small fw-bold text-uppercase text-muted border-bottom pb-2 mb-2">Customer Details</h6>
                      <div className="fw-bold fs-5">{so.customer_name}</div>
                      <div className="text-muted small mt-2" style={{ whiteSpace: 'pre-wrap' }}>{getCustomerAddress(so.customer_name)}</div>
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
                          <td className="text-end small">{line.due_date ? new Date(line.due_date).toLocaleDateString() : '—'}</td>
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
    <div className="fade-in">
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

       {/* Produce Dropdown Portal */}
       {produceDropdownSO && (
           <div
               className={`dropdown-menu show shadow produce-dropdown-menu ui-style-${currentStyle}`}
               style={{ position: 'absolute', top: produceDropdownPos.top, left: produceDropdownPos.left, zIndex: 9999, minWidth: 210 }}
           >
               <div className="px-3 py-1 border-bottom" style={{ fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>
                   Produce Line Item
               </div>
               {produceDropdownSO.lines.map((line: any, idx: number) => (
                   <button
                       key={idx}
                       className="dropdown-item small"
                       onClick={() => { onGenerateWO(produceDropdownSO, line); setProduceDropdownSO(null); }}
                   >
                       <i className="bi bi-gear-wide-connected me-2"></i>
                       <span className="fw-bold">{line.qty}×</span> {getItemName(line.item_id)}
                       {isSample(line.item_id) && <span className="badge bg-warning text-dark ms-2" style={{fontSize: '0.6rem'}}>Sample</span>}
                   </button>
               ))}
           </div>
       )}

       {/* Create SO Modal */}
       <ModalWrapper
           isOpen={isCreateOpen}
           onClose={() => { setIsCreateOpen(false); setNewSO({ po_number: '', customer_name: '', order_date: new Date().toISOString().split('T')[0], lines: [] }); }}
           title={<><i className="bi bi-cart-plus me-2"></i>Create Sales Order</>}
           variant="primary"
           size="lg"
           footer={
               <>
                   <button type="button" className="btn btn-sm btn-link text-muted" onClick={() => setIsCreateOpen(false)}>{t('cancel')}</button>
                   <button type="button" className="btn btn-sm btn-primary px-4 fw-bold" onClick={handleSubmit as any}>{t('save')} Order</button>
               </>
           }
       >
           <form onSubmit={handleSubmit} id="create-so-form">
               <div className="row g-3 mb-3">
                   <div className="col-md-4">
                       <label className="form-label d-flex justify-content-between align-items-center small text-muted">
                           Ref No. (PO#)
                           <i className="bi bi-gear-fill text-muted" style={{cursor: 'pointer'}} onClick={() => setIsConfigOpen(true)} title="Configure Auto-Suggestion"></i>
                       </label>
                       <input className="form-control" placeholder="Auto-generated" value={newSO.po_number} onChange={e => setNewSO({...newSO, po_number: e.target.value})} required />
                   </div>
                   <div className="col-md-5">
                       <label className="form-label small text-muted">Customer</label>
                       <SearchableSelect
                           options={customers.map((c: any) => ({ value: c.name, label: c.name, subLabel: c.address }))}
                           value={newSO.customer_name}
                           onChange={(val) => setNewSO({...newSO, customer_name: val})}
                           placeholder="Select Customer…"
                           required
                       />
                   </div>
                   <div className="col-md-3">
                       <label className="form-label small text-muted">Date</label>
                       <input type="date" className="form-control" value={newSO.order_date} onChange={e => setNewSO({...newSO, order_date: e.target.value})} required />
                   </div>
               </div>

               <h6 className="small text-uppercase text-muted fw-bold mb-2">Order Items</h6>
               <div className="p-3 mb-3 border" style={{ background: 'rgba(0,0,0,0.02)' }}>
                   <div className="row g-2 mb-2">
                       <div className="col-5">
                           <label className="form-label small text-muted mb-1">Item</label>
                           <SearchableSelect
                               options={items.map((item: any) => ({ value: item.id, label: item.name, subLabel: `${item.code}${item.category === 'Sample' ? ' ★' : ''}` }))}
                               value={newLine.item_id}
                               onChange={(val) => setNewLine({...newLine, item_id: val, attribute_value_ids: []})}
                               placeholder="Select Item…"
                           />
                       </div>
                       <div className="col-2">
                           <label className="form-label small text-muted mb-1">Qty</label>
                           <input type="number" className="form-control" placeholder="0" value={newLine.qty || ''} onChange={e => setNewLine({...newLine, qty: parseFloat(e.target.value)})} />
                       </div>
                       <div className="col-3">
                           <label className="form-label small text-muted mb-1">Due Date</label>
                           <input type="date" className="form-control" value={newLine.due_date} onChange={e => setNewLine({...newLine, due_date: e.target.value})} />
                       </div>
                       <div className="col-2 d-flex align-items-end">
                           <button type="button" className="btn btn-secondary w-100" onClick={handleAddLine} disabled={!newLine.item_id || newLine.qty <= 0}>
                               <i className="bi bi-plus-lg"></i>
                           </button>
                       </div>
                       {currentBoundAttrs.length > 0 && (
                           <div className="col-12 mt-1">
                               <div className="p-2 border" style={{ background: 'white' }}>
                                   <small className="text-muted fw-bold mb-2 d-block">Variants</small>
                                   <div className="row g-2">
                                       {currentBoundAttrs.map((attr: any) => (
                                           <div key={attr.id} className="col-md-4">
                                               <select
                                                   className="form-select form-select-sm"
                                                   value={newLine.attribute_value_ids.find(vid => attr.values.some((v: any) => v.id === vid)) || ''}
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
                   <div>
                       {newSO.lines.map((line: any, idx) => (
                           <div key={idx} className="d-flex justify-content-between align-items-center p-2 border mb-1 small" style={{ background: 'white' }}>
                               <div>
                                   <span className="fw-bold">{getItemName(line.item_id)}</span>
                                   <span className="text-muted ms-2 font-monospace small">{getItemCode(line.item_id)}</span>
                                   {isSample(line.item_id) && <span className="badge bg-warning text-dark ms-2" style={{fontSize: '0.6rem'}}>Sample</span>}
                                   {line.due_date && <span className="text-muted ms-2 small"><i className="bi bi-calendar2 me-1"></i>{new Date(line.due_date).toLocaleDateString()}</span>}
                                   <div className="small text-muted fst-italic">{(line.attribute_value_ids || []).map(getAttributeValueName).join(', ')}</div>
                               </div>
                               <div className="d-flex align-items-center gap-3">
                                   <span className="fw-bold">×{line.qty}</span>
                                   <button type="button" className="btn btn-sm btn-link text-danger p-0" onClick={() => handleRemoveLine(idx)}>
                                       <i className="bi bi-x-circle"></i>
                                   </button>
                               </div>
                           </div>
                       ))}
                       {newSO.lines.length === 0 && <div className="text-center text-muted small fst-italic py-2">No items added yet</div>}
                   </div>
               </div>
           </form>
       </ModalWrapper>

       {/* ── Outer shell ── */}
       <div
           style={classic ? xpBevel : undefined}
           className={classic ? '' : 'card border-0 shadow-sm'}
       >
           {/* ── Title bar ── */}
           {classic ? (
               <div style={xpTitleBar}>
                   <span>
                       <i className="bi bi-receipt-cutoff" style={{ marginRight: 6 }}></i>
                       {t('sales_orders')}
                   </span>
                   <button
                       style={xpBtn({ background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', fontWeight: 'bold' })}
                       onClick={() => setIsCreateOpen(true)}
                   >
                       <i className="bi bi-plus-lg" style={{ marginRight: 4 }}></i>{t('create')}
                   </button>
               </div>
           ) : (
               <div className="card-header bg-white d-flex justify-content-between align-items-center">
                   <div>
                       <h5 className="card-title mb-0">
                           <i className="bi bi-receipt-cutoff me-2"></i>{t('sales_orders')}
                       </h5>
                       <p className="text-muted small mb-0 mt-1">Manage incoming customer orders</p>
                   </div>
                   <button className="btn btn-sm btn-primary" onClick={() => setIsCreateOpen(true)}>
                       <i className="bi bi-plus-lg me-2"></i>{t('create')}
                   </button>
               </div>
           )}

           {/* ── Secondary toolbar: search + status filters + count ── */}
           {classic ? (
               <div style={xpToolbar}>
                   <input
                       style={{ ...xpInput, width: 180 }}
                       placeholder="Search PO# or customer…"
                       value={searchTerm}
                       onChange={e => setSearchTerm(e.target.value)}
                   />
                   <div style={xpSep}></div>
                   {STATUS_FILTERS.map(s => (
                       <button
                           key={s}
                           style={statusFilter === s
                               ? xpBtn({ background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)', color: '#fff', borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a', fontWeight: 'bold' })
                               : xpBtn()
                           }
                           onClick={() => setStatusFilter(s)}
                       >
                           {s}
                       </button>
                   ))}
                   <div style={xpSep}></div>
                   <span style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#333' }}>
                       {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}
                   </span>
               </div>
           ) : (
               <div className="px-3 py-2 border-bottom d-flex align-items-center gap-2 flex-wrap bg-white">
                   <div className="position-relative" style={{ flex: '1 1 160px', maxWidth: 240 }}>
                       <i className="bi bi-search position-absolute" style={{ left: 7, top: '50%', transform: 'translateY(-50%)', fontSize: 11, opacity: 0.5 }}></i>
                       <input
                           className="form-control form-control-sm"
                           style={{ paddingLeft: 24 }}
                           placeholder="Search PO# or customer…"
                           value={searchTerm}
                           onChange={e => setSearchTerm(e.target.value)}
                       />
                   </div>
                   <div className="d-flex gap-1 flex-wrap">
                       {STATUS_FILTERS.map(s => (
                           <button
                               key={s}
                               className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-light border'}`}
                               style={{ fontSize: 11 }}
                               onClick={() => setStatusFilter(s)}
                           >
                               {s}
                           </button>
                       ))}
                   </div>
                   <span className="text-muted small ms-1">
                       {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}
                   </span>
               </div>
           )}

           {/* ── Table ── */}
           <div
               className={classic ? '' : 'card-body p-0'}
               style={classic ? { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' } : undefined}
           >
               <div className="table-responsive">
                   <table
                       className={classic ? '' : 'table table-hover align-middle mb-0'}
                       style={classic ? { width: '100%', borderCollapse: 'collapse', background: '#fff' } : undefined}
                   >
                       <thead style={classic ? xpTableHeader : undefined} className={classic ? '' : 'table-light'}>
                           <tr>
                               <th style={classic ? { ...xpThCell, width: '130px' } : undefined} className={classic ? '' : 'ps-4'}>Order Ref (PO#)</th>
                               <th style={classic ? xpThCell : undefined}>Customer</th>
                               <th style={classic ? { ...xpThCell, width: '90px' } : undefined}>Date</th>
                               <th style={classic ? xpThCell : undefined}>Items</th>
                               <th style={classic ? { ...xpThCell, width: '90px' } : undefined}>Status</th>
                               <th style={classic ? { ...xpThCell, textAlign: 'right' as const, borderRight: 'none', width: '120px' } : undefined} className={classic ? '' : 'text-end pe-4'}>Actions</th>
                           </tr>
                       </thead>
                       <tbody>
                           {filteredOrders.map((so: any, rowIndex: number) => (
                               <tr
                                   key={so.id}
                                   style={classic ? { background: rowIndex % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' } : undefined}
                               >
                                   <td style={classic ? { ...tdBase, fontFamily: "'Courier New', monospace", fontWeight: 'bold', color: '#0058e6' } : undefined} className={classic ? '' : 'ps-4 fw-bold font-monospace text-primary'}>
                                       {so.po_number}
                                   </td>
                                   <td style={classic ? tdBase : undefined}>{so.customer_name}</td>
                                   <td style={classic ? { ...tdBase, fontSize: '10px' } : undefined} className={classic ? '' : 'small'}>
                                       {new Date(so.order_date).toLocaleDateString()}
                                   </td>
                                   <td style={classic ? tdBase : undefined}>
                                       <div>
                                           {classic ? (
                                               <span style={{ background: '#e8e8e8', border: '1px solid #6a6a6a', color: '#222', padding: '1px 5px', fontSize: '9px', fontFamily: 'Tahoma, Arial, sans-serif', fontWeight: 'bold' }}>
                                                   {so.lines.length} item{so.lines.length !== 1 ? 's' : ''}
                                               </span>
                                           ) : (
                                               <span className="badge bg-light text-dark border me-1">{so.lines.length} item{so.lines.length !== 1 ? 's' : ''}</span>
                                           )}
                                       </div>
                                       <div style={{ marginTop: 2 }}>
                                           {so.lines.map((line: any) => (
                                               <div key={line.id} style={classic ? { fontSize: '10px', color: '#333', lineHeight: 1.4 } : undefined} className={classic ? '' : 'small text-muted'}>
                                                   <span style={classic ? { fontWeight: 'bold' } : undefined} className={classic ? '' : 'fw-bold text-dark'}>{line.qty}×</span> {getItemName(line.item_id)}
                                                   {isSample(line.item_id) && <i className="bi bi-star-fill text-warning ms-1" style={{fontSize: '0.6rem'}}></i>}
                                               </div>
                                           ))}
                                       </div>
                                   </td>
                                   <td style={classic ? tdBase : undefined}>
                                       {classic ? (
                                           <span style={getStatusXPStyle(so.status)}>{so.status}</span>
                                       ) : (
                                           <span className={`badge ${getStatusBadge(so.status)}`}>{so.status}</span>
                                       )}
                                       {so.delivered_at && <div className="extra-small text-muted mt-1">Delivered: {formatDate(so.delivered_at)}</div>}
                                   </td>
                                   <td style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'right' as const } : undefined} className={classic ? '' : 'pe-4 text-end'}>
                                       <div style={classic ? { display: 'flex', gap: 2, justifyContent: 'flex-end', alignItems: 'center' } : undefined} className={classic ? '' : 'd-flex justify-content-end align-items-center gap-1'}>
                                           {so.status === 'READY' && (
                                               classic ? (
                                                   <button style={xpBtn()} onClick={() => onUpdateSOStatus(so.id, 'SENT')}>
                                                       <i className="bi bi-send" style={{ marginRight: 3 }}></i>SENT
                                                   </button>
                                               ) : (
                                                   <button className="btn btn-sm btn-light border py-0 px-2" style={{fontSize: 11}} onClick={() => onUpdateSOStatus(so.id, 'SENT')}>
                                                       <i className="bi bi-send me-1"></i>SENT
                                                   </button>
                                               )
                                           )}
                                           {so.status === 'SENT' && (
                                               classic ? (
                                                   <button style={xpBtn({ background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#fff' })} onClick={() => onUpdateSOStatus(so.id, 'DELIVERED')}>
                                                       <i className="bi bi-check2-all" style={{ marginRight: 3 }}></i>DELIVERED
                                                   </button>
                                               ) : (
                                                   <button className="btn btn-sm btn-light border py-0 px-2" style={{fontSize: 11}} onClick={() => onUpdateSOStatus(so.id, 'DELIVERED')}>
                                                       <i className="bi bi-check2-all me-1"></i>DELIVERED
                                                   </button>
                                               )
                                           )}
                                           {so.status === 'PENDING' && so.lines.length > 0 && (
                                               classic ? (
                                                   <button style={xpBtn()} className="produce-dropdown-btn" onClick={(e) => openProduceDropdown(so, e)}>
                                                       <i className="bi bi-gear-wide-connected" style={{ marginRight: 3 }}></i>PRODUCE
                                                   </button>
                                               ) : (
                                                   <button className="btn btn-sm btn-light border produce-dropdown-btn py-0 px-2" style={{fontSize: 11}} onClick={(e) => openProduceDropdown(so, e)}>
                                                       <i className="bi bi-gear-wide-connected me-1"></i>PRODUCE
                                                   </button>
                                               )
                                           )}
                                           {classic ? (
                                               <>
                                                   <button
                                                       title="Print"
                                                       onClick={() => handlePrintSO(so)}
                                                       style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: 'pointer', padding: '1px 4px', color: '#555', fontSize: '13px' }}
                                                       onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#7f9db9'; (e.currentTarget as HTMLButtonElement).style.background = '#e8f0f8'; }}
                                                       onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                                   >
                                                       <i className="bi bi-printer"></i>
                                                   </button>
                                                   <button
                                                       title="Delete"
                                                       onClick={() => onDeleteSO(so.id)}
                                                       style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: 'pointer', padding: '1px 4px', color: '#aa0000', fontSize: '13px' }}
                                                       onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#cc4444'; (e.currentTarget as HTMLButtonElement).style.background = '#fff0f0'; }}
                                                       onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                                   >
                                                       <i className="bi bi-trash"></i>
                                                   </button>
                                               </>
                                           ) : (
                                               <>
                                                   <button className="btn btn-sm btn-link text-muted p-0" title="Print" onClick={() => handlePrintSO(so)}>
                                                       <i className="bi bi-printer fs-6"></i>
                                                   </button>
                                                   <button className="btn btn-sm btn-link text-danger p-0" title="Delete" onClick={() => onDeleteSO(so.id)}>
                                                       <i className="bi bi-trash fs-6"></i>
                                                   </button>
                                               </>
                                           )}
                                       </div>
                                   </td>
                               </tr>
                           ))}
                           {filteredOrders.length === 0 && (
                               <tr>
                                   <td
                                       colSpan={6}
                                       style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'center', padding: '24px 8px', color: '#888', fontStyle: 'italic' } : undefined}
                                       className={classic ? '' : 'text-center py-5 text-muted'}
                                   >
                                       {searchTerm || statusFilter !== 'ALL'
                                           ? 'No orders match the current filter.'
                                           : 'No Sales Orders found. Create one to get started.'}
                                   </td>
                               </tr>
                           )}
                       </tbody>
                   </table>
               </div>
           </div>

           {/* ── Status bar ── */}
           {classic && (
               <div style={{
                   background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)',
                   borderTop: '1px solid #b0a898',
                   padding: '2px 8px',
                   display: 'flex',
                   gap: '12px',
                   fontFamily: 'Tahoma, Arial, sans-serif',
                   fontSize: '10px',
                   color: '#333',
               }}>
                   <span>{salesOrders.length} total</span>
                   <span>|</span>
                   <span>{salesOrders.filter((s: any) => s.status === 'PENDING').length} pending</span>
                   <span>|</span>
                   <span>{salesOrders.filter((s: any) => s.status === 'DELIVERED').length} delivered</span>
               </div>
           )}
       </div>
    </div>
  );
}
