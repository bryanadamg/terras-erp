import { useState, useEffect } from 'react';
import CodeConfigModal, { CodeConfig, buildCodeParts } from './CodeConfigModal';
import { useToast } from './Toast';
import { useLanguage } from '../context/LanguageContext';
import SearchableSelect from './SearchableSelect';
import PrintHeader from './PrintHeader';
import ModalWrapper from './ModalWrapper';
import { useTheme } from '../context/ThemeContext';

export default function PurchaseOrderView({ items, attributes, purchaseOrders, partners, locations, onCreatePO, onDeletePO, onReceivePO }: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [printingPO, setPrintingPO] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const { uiStyle: currentStyle } = useTheme();
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

  const [newPO, setNewPO] = useState({
      po_number: '',
      supplier_id: '',
      target_location_id: '',
      order_date: new Date().toISOString().split('T')[0],
      lines: [] as any[]
  });

  const [newLine, setNewLine] = useState({ item_id: '', qty: 0, due_date: '', attribute_value_ids: [] as string[] });

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

  const suggestPOCode = (config = codeConfig) => {
      const parts = buildCodeParts(config);
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
      const otherValues = newLine.attribute_value_ids.filter(vid => !attr.values.some((v: any) => v.id === vid));
      setNewLine({...newLine, attribute_value_ids: valId ? [...otherValues, valId] : otherValues});
  };

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      onCreatePO({
          ...newPO,
          supplier_id: newPO.supplier_id || null,
          target_location_id: newPO.target_location_id || null,
          order_date: newPO.order_date || null,
          lines: newPO.lines.map((line: any) => ({ ...line, due_date: line.due_date || null }))
      });
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

  const STATUS_FILTERS = ['ALL', 'PENDING', 'RECEIVED'];

  const filteredOrders = purchaseOrders.filter((po: any) => {
      const matchSearch = !searchTerm ||
          po.po_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
          getSupplierName(po.supplier_id).toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === 'ALL' || po.status === statusFilter;
      return matchSearch && matchStatus;
  });

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
                      <div className="text-muted small mt-2" style={{ whiteSpace: 'pre-wrap' }}>{getSupplierAddress(po.supplier_id)}</div>
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
                          <td className="small">{line.due_date ? new Date(line.due_date).toLocaleDateString() : '—'}</td>
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
    <div className="fade-in">
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
       <ModalWrapper
           isOpen={isCreateOpen}
           onClose={() => { setIsCreateOpen(false); setNewPO({ po_number: '', supplier_id: '', target_location_id: '', order_date: new Date().toISOString().split('T')[0], lines: [] }); }}
           title={<><i className="bi bi-cart-plus" style={classic?{marginRight:6}:{marginRight:8}}></i>Create Purchase Order</>}
           variant="success"
           size="lg"
           footer={classic ? (
               <>
                   <button type="button" style={xpBtn()} onClick={() => setIsCreateOpen(false)}>{t('cancel')}</button>
                   <button type="button" style={xpBtn({background:'linear-gradient(to bottom,#5ec85e,#2d7a2d)',borderColor:'#1a5e1a #0a3e0a #0a3e0a #1a5e1a',color:'#ffffff',fontWeight:'bold',padding:'2px 16px'})} onClick={handleSubmit as any}><i className="bi bi-floppy" style={{marginRight:4}}></i>{t('save')} PO</button>
               </>
           ) : (
               <>
                   <button type="button" className="btn btn-sm btn-link text-muted" onClick={() => setIsCreateOpen(false)}>{t('cancel')}</button>
                   <button type="button" className="btn btn-sm btn-success px-4 fw-bold" onClick={handleSubmit as any}>{t('save')} PO</button>
               </>
           )}
       >
           <form onSubmit={handleSubmit} id="create-po-form">
               <div className="row g-3 mb-3">
                   <div className="col-md-4">
                       <label style={classic?{fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2}:undefined} className={classic?'':'form-label d-flex justify-content-between align-items-center small text-muted'}>
                           PO Number
                           <i className="bi bi-gear-fill" style={{cursor:'pointer',color:classic?'#555':'',fontSize:classic?'11px':''}} onClick={() => setIsConfigOpen(true)} title="Configure Auto-Suggestion"></i>
                       </label>
                       <input className="form-control" style={classic?xpInput:undefined} placeholder="Auto-generated" value={newPO.po_number} onChange={e => setNewPO({...newPO, po_number: e.target.value})} required />
                   </div>
                   <div className="col-md-5">
                       <label style={classic?{fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2}:undefined} className={classic?'':'form-label small text-muted'}>Supplier</label>
                       <SearchableSelect options={suppliers.map((c: any) => ({ value: c.id, label: c.name, subLabel: c.address }))} value={newPO.supplier_id} onChange={(val) => setNewPO({...newPO, supplier_id: val})} placeholder="Select Supplier…" required />
                   </div>
                   <div className="col-md-3">
                       <label style={classic?{fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2}:undefined} className={classic?'':'form-label small text-muted'}>Date</label>
                       <input type="date" className="form-control" style={classic?{...xpInput,width:'100%',height:'22px'}:undefined} value={newPO.order_date} onChange={e => setNewPO({...newPO, order_date: e.target.value})} required />
                   </div>
                   <div className="col-md-12">
                       <label style={classic?{fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2}:undefined} className={classic?'':'form-label small text-muted'}>Receiving Warehouse</label>
                       <SearchableSelect options={locations.map((l: any) => ({ value: l.id, label: l.name, subLabel: l.code }))} value={newPO.target_location_id} onChange={(val) => setNewPO({...newPO, target_location_id: val})} placeholder="Select receiving location…" required />
                   </div>
               </div>

               {classic
                   ? <div style={{fontFamily:'Tahoma,Arial,sans-serif',fontSize:'10px',fontWeight:'bold',color:'#444',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4,paddingBottom:2,borderBottom:'1px solid #c0bdb5'}}>Order Items</div>
                   : <h6 className="small text-uppercase text-muted fw-bold mb-2">Order Items</h6>
               }
               <div style={{background:classic?'#f5f4ef':'rgba(0,0,0,0.02)',border:classic?'1px solid #b0a898':'1px solid #dee2e6',padding:classic?'6px 8px':'12px',marginBottom:classic?6:12}}>
                   <div className="row g-2 mb-2">
                       <div className="col-5">
                           <label style={classic?{fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2}:undefined} className={classic?'':'form-label small text-muted mb-1'}>Item</label>
                           <SearchableSelect options={items.map((item: any) => ({ value: item.id, label: item.name, subLabel: item.code }))} value={newLine.item_id} onChange={(val) => setNewLine({...newLine, item_id: val, attribute_value_ids: []})} placeholder="Select Item…" />
                       </div>
                       <div className="col-2">
                           <label style={classic?{fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2}:undefined} className={classic?'':'form-label small text-muted mb-1'}>Qty</label>
                           <input type="number" className="form-control" style={classic?xpInput:undefined} placeholder="0" value={newLine.qty || ''} onChange={e => setNewLine({...newLine, qty: parseFloat(e.target.value)})} />
                       </div>
                       <div className="col-3">
                           <label style={classic?{fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2}:undefined} className={classic?'':'form-label small text-muted mb-1'}>Expected By</label>
                           <input type="date" className="form-control" style={classic?{...xpInput,width:'100%',height:'22px'}:undefined} value={newLine.due_date} onChange={e => setNewLine({...newLine, due_date: e.target.value})} />
                       </div>
                       <div className="col-2 d-flex align-items-end">
                           <button type="button" style={classic?{...xpBtn(),width:'100%',padding:'2px 6px'}:undefined} className={classic?'':'btn btn-secondary w-100'} onClick={handleAddLine} disabled={!newLine.item_id || newLine.qty <= 0}>
                               <i className="bi bi-plus-lg"></i>
                           </button>
                       </div>
                       {currentBoundAttrs.length > 0 && (
                           <div className="col-12 mt-1">
                               <div style={{background:'#ffffff',border:classic?'1px solid #b0a898':'1px solid #dee2e6',padding:classic?'4px 6px':'8px'}}>
                                   <div style={classic?{fontFamily:'Tahoma,Arial,sans-serif',fontSize:'10px',fontWeight:'bold',color:'#444',marginBottom:4}:undefined} className={classic?'':'text-muted fw-bold mb-2 small'}>Variants</div>
                                   <div className="row g-2">
                                       {currentBoundAttrs.map((attr: any) => (
                                           <div key={attr.id} className="col-md-4">
                                               <select className="form-select form-select-sm" style={classic?{fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',border:'1px solid #7f9db9',height:'22px',borderRadius:0,padding:'1px 4px',background:'#ffffff',outline:'none'}:undefined} value={newLine.attribute_value_ids.find(vid => attr.values.some((v: any) => v.id === vid)) || ''} onChange={e => handleValueChange(e.target.value, attr.id)}>
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
                           <div key={idx} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:classic?'3px 6px':'8px',background:classic?(idx%2===0?'#ffffff':'#f5f3ee'):'white',border:classic?'1px solid #c0bdb5':'1px solid #dee2e6',marginBottom:2,fontFamily:classic?'Tahoma,Arial,sans-serif':undefined,fontSize:classic?'11px':undefined}}>
                               <div>
                                   <span style={{fontWeight:'bold'}}>{getItemName(line.item_id)}</span>
                                   <span style={{color:classic?'#555':'',marginLeft:8,fontSize:classic?'10px':''}}>{getItemCode(line.item_id)}</span>
                                   {line.due_date && <span style={{color:classic?'#666':'',marginLeft:8,fontSize:classic?'10px':''}}><i className="bi bi-calendar2" style={{marginRight:3}}></i>{new Date(line.due_date).toLocaleDateString()}</span>}
                                   {(line.attribute_value_ids||[]).length>0 && <div style={{color:classic?'#666':'',fontSize:classic?'10px':'',fontStyle:'italic'}}>{(line.attribute_value_ids||[]).map(getAttributeValueName).join(', ')}</div>}
                               </div>
                               <div style={{display:'flex',alignItems:'center',gap:12}}>
                                   <span style={{fontWeight:'bold'}}>×{line.qty}</span>
                                   <button type="button" style={classic?{...xpBtn(),border:'1px solid transparent',background:'transparent',padding:'1px 5px'}:undefined} className={classic?'':'btn btn-sm btn-link text-danger p-0'} onClick={() => handleRemoveLine(idx)}>
                                       <i className="bi bi-x-circle" style={{color:classic?'#c00000':''}}></i>
                                   </button>
                               </div>
                           </div>
                       ))}
                       {newPO.lines.length === 0 && <div style={{textAlign:'center',padding:'8px',fontFamily:classic?'Tahoma,Arial,sans-serif':'',fontSize:classic?'11px':'',color:classic?'#888':'',fontStyle:'italic'}}>No items added yet</div>}
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
                       <i className="bi bi-truck" style={{ marginRight: 6 }}></i>
                       {t('purchase_orders')}
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
                           <i className="bi bi-truck me-2"></i>{t('purchase_orders')}
                       </h5>
                       <p className="text-muted small mb-0 mt-1">Manage outgoing supplier orders and stock receiving</p>
                   </div>
                   <button className="btn btn-sm btn-success text-white" onClick={() => setIsCreateOpen(true)}>
                       <i className="bi bi-plus-lg me-2"></i>{t('create')}
                   </button>
               </div>
           )}

           {/* ── Secondary toolbar: search + status filters + count ── */}
           {classic ? (
               <div style={xpToolbar}>
                   <input
                       style={{ ...xpInput, width: 180 }}
                       placeholder="Search PO# or supplier…"
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
                           placeholder="Search PO# or supplier…"
                           value={searchTerm}
                           onChange={e => setSearchTerm(e.target.value)}
                       />
                   </div>
                   <div className="d-flex gap-1">
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
                               <th style={classic ? { ...xpThCell, width: '130px' } : undefined} className={classic ? '' : 'ps-4'}>PO Number</th>
                               <th style={classic ? xpThCell : undefined}>Supplier</th>
                               <th style={classic ? { ...xpThCell, width: '90px' } : undefined}>Date</th>
                               <th style={classic ? xpThCell : undefined}>Items</th>
                               <th style={classic ? { ...xpThCell, width: '90px' } : undefined}>Status</th>
                               <th style={classic ? { ...xpThCell, textAlign: 'right' as const, borderRight: 'none', width: '110px' } : undefined} className={classic ? '' : 'text-end pe-4'}>Actions</th>
                           </tr>
                       </thead>
                       <tbody>
                           {filteredOrders.map((po: any, rowIndex: number) => (
                               <tr
                                   key={po.id}
                                   style={classic ? { background: rowIndex % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' } : undefined}
                               >
                                   <td style={classic ? { ...tdBase, fontFamily: "'Courier New', monospace", fontWeight: 'bold', color: '#0058e6' } : undefined} className={classic ? '' : 'ps-4 fw-bold font-monospace text-primary'}>
                                       {po.po_number}
                                   </td>
                                   <td style={classic ? tdBase : undefined}>{getSupplierName(po.supplier_id)}</td>
                                   <td style={classic ? { ...tdBase, fontSize: '10px' } : undefined} className={classic ? '' : 'small'}>
                                       {new Date(po.order_date).toLocaleDateString()}
                                   </td>
                                   <td style={classic ? tdBase : undefined}>
                                       <div>
                                           {classic ? (
                                               <span style={{ background: '#e8e8e8', border: '1px solid #6a6a6a', color: '#222', padding: '1px 5px', fontSize: '9px', fontFamily: 'Tahoma, Arial, sans-serif', fontWeight: 'bold' }}>
                                                   {po.lines.length} item{po.lines.length !== 1 ? 's' : ''}
                                               </span>
                                           ) : (
                                               <span className="badge bg-light text-dark border me-1">{po.lines.length} item{po.lines.length !== 1 ? 's' : ''}</span>
                                           )}
                                       </div>
                                       <div style={{ marginTop: 2 }}>
                                           {po.lines.map((line: any) => (
                                               <div key={line.id} style={classic ? { fontSize: '10px', color: '#333', lineHeight: 1.4 } : undefined} className={classic ? '' : 'small text-muted'}>
                                                   <span style={classic ? { fontWeight: 'bold' } : undefined} className={classic ? '' : 'fw-bold text-dark'}>{line.qty}×</span> {getItemName(line.item_id)}
                                               </div>
                                           ))}
                                       </div>
                                   </td>
                                   <td style={classic ? tdBase : undefined}>
                                       {classic ? (
                                           <span style={{
                                               background: po.status === 'RECEIVED' ? '#e8f5e9' : '#e8e8e8',
                                               border: `1px solid ${po.status === 'RECEIVED' ? '#2e7d32' : '#6a6a6a'}`,
                                               color: po.status === 'RECEIVED' ? '#1b4620' : '#222',
                                               padding: '1px 5px', fontSize: '9px',
                                               fontFamily: 'Tahoma, Arial, sans-serif',
                                               fontWeight: 'bold', whiteSpace: 'nowrap' as const,
                                           }}>
                                               {po.status}
                                           </span>
                                       ) : (
                                           <span className={`badge ${po.status === 'RECEIVED' ? 'bg-success' : 'bg-secondary'}`}>
                                               {po.status}
                                           </span>
                                       )}
                                   </td>
                                   <td style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'right' as const } : undefined} className={classic ? '' : 'pe-4 text-end'}>
                                       <div style={classic ? { display: 'flex', gap: 2, justifyContent: 'flex-end', alignItems: 'center' } : undefined} className={classic ? '' : 'd-flex justify-content-end align-items-center gap-2'}>
                                           {po.status !== 'RECEIVED' && (
                                               classic ? (
                                                   <button
                                                       style={xpBtn({ background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#fff' })}
                                                       onClick={() => onReceivePO(po.id)}
                                                   >
                                                       <i className="bi bi-box-arrow-in-down" style={{ marginRight: 3 }}></i>Receive
                                                   </button>
                                               ) : (
                                                   <button
                                                       className="btn btn-sm btn-success text-white py-0 px-2"
                                                       style={{fontSize: '0.75rem'}}
                                                       onClick={() => onReceivePO(po.id)}
                                                   >
                                                       <i className="bi bi-box-arrow-in-down me-1"></i>Receive
                                                   </button>
                                               )
                                           )}
                                           {classic ? (
                                               <>
                                                   <button
                                                       title="Print"
                                                       onClick={() => handlePrintPO(po)}
                                                       style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: 'pointer', padding: '1px 4px', color: '#555', fontSize: '13px' }}
                                                       onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#7f9db9'; (e.currentTarget as HTMLButtonElement).style.background = '#e8f0f8'; }}
                                                       onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                                   >
                                                       <i className="bi bi-printer"></i>
                                                   </button>
                                                   <button
                                                       title="Delete"
                                                       onClick={() => onDeletePO(po.id)}
                                                       style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: 'pointer', padding: '1px 4px', color: '#aa0000', fontSize: '13px' }}
                                                       onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#cc4444'; (e.currentTarget as HTMLButtonElement).style.background = '#fff0f0'; }}
                                                       onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                                   >
                                                       <i className="bi bi-trash"></i>
                                                   </button>
                                               </>
                                           ) : (
                                               <>
                                                   <button className="btn btn-sm btn-link text-muted p-0" title="Print" onClick={() => handlePrintPO(po)}>
                                                       <i className="bi bi-printer fs-6"></i>
                                                   </button>
                                                   <button className="btn btn-sm btn-link text-danger p-0" title="Delete" onClick={() => onDeletePO(po.id)}>
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
                                           : 'No Purchase Orders found. Create one to get started.'}
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
                   <span>{purchaseOrders.length} total</span>
                   <span>|</span>
                   <span>{purchaseOrders.filter((p: any) => p.status === 'PENDING').length} pending</span>
                   <span>|</span>
                   <span>{purchaseOrders.filter((p: any) => p.status === 'RECEIVED').length} received</span>
               </div>
           )}
       </div>
    </div>
  );
}
