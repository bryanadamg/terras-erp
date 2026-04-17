import { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useToast } from './Toast';
import { useLanguage } from '../context/LanguageContext';
import CodeConfigModal, { CodeConfig, buildCodeParts } from './CodeConfigModal';
import SearchableSelect from './SearchableSelect';
import HistoryPane from './HistoryPane';
import ModalWrapper from './ModalWrapper';

export default function SampleRequestView({ samples, salesOrders, items, attributes, onCreateSample, onUpdateStatus, onDeleteSample }: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [historyEntityId, setHistoryEntityId] = useState<string | null>(null);
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

  const [newSample, setNewSample] = useState({
      code: '',
      sales_order_id: '',
      base_item_id: '',
      attribute_value_ids: [] as string[],
      notes: ''
  });

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [codeConfig, setCodeConfig] = useState<CodeConfig>({
      prefix: 'SMP',
      suffix: '',
      separator: '-',
      includeItemCode: false,
      includeVariant: false,
      variantAttributeNames: [],
      includeYear: true,
      includeMonth: true
  });

  useEffect(() => {
      const savedConfig = localStorage.getItem('sample_code_config');
      if (savedConfig) {
          try { setCodeConfig(JSON.parse(savedConfig)); } catch (e) {}
      }
  }, []);

  const handleSaveConfig = (newConfig: CodeConfig) => {
      setCodeConfig(newConfig);
      localStorage.setItem('sample_code_config', JSON.stringify(newConfig));
      setNewSample(prev => ({ ...prev, code: suggestSampleCode(newConfig) }));
  };

  const suggestSampleCode = (config = codeConfig) => {
      const parts = buildCodeParts(config);
      const basePattern = parts.join(config.separator);
      let counter = 1;
      let baseCode = `${basePattern}${config.separator}001`;
      while (samples.some((s: any) => s.code === baseCode)) {
          counter++;
          baseCode = `${basePattern}${config.separator}${String(counter).padStart(3, '0')}`;
      }
      return baseCode;
  };

  const openCreateModal = () => {
      if (!newSample.code) setNewSample(prev => ({ ...prev, code: suggestSampleCode() }));
      setIsCreateOpen(true);
  };

  // Close dropdown on outside click / scroll
  useEffect(() => {
      const handleGlobalClick = (event: any) => {
          if (!event.target.closest('.action-dropdown-btn') && !event.target.closest('.fixed-dropdown-menu')) {
              setOpenDropdownId(null);
          }
      };
      const handleScroll = () => setOpenDropdownId(null);
      document.addEventListener('click', handleGlobalClick);
      window.addEventListener('scroll', handleScroll, true);
      return () => {
          document.removeEventListener('click', handleGlobalClick);
          window.removeEventListener('scroll', handleScroll, true);
      };
  }, []);

  const toggleDropdown = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (openDropdownId === id) { setOpenDropdownId(null); return; }
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + window.scrollY + 2, left: rect.right + window.scrollX - 180 });
      setOpenDropdownId(id);
  };

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      onCreateSample({ ...newSample, sales_order_id: newSample.sales_order_id || null });
      setNewSample({ code: '', sales_order_id: '', base_item_id: '', attribute_value_ids: [], notes: '' });
      setIsCreateOpen(false);
  };

  const handleValueChange = (valId: string, attrId: string) => {
      const attr = attributes.find((a: any) => a.id === attrId);
      if (!attr) return;
      const otherValues = newSample.attribute_value_ids.filter(vid => !attr.values.some((v: any) => v.id === vid));
      setNewSample({...newSample, attribute_value_ids: valId ? [...otherValues, valId] : otherValues});
  };

  const getBoundAttributes = (itemId: string) => {
      const item = items.find((i: any) => i.id === itemId);
      if (!item || !item.attribute_ids) return [];
      return attributes.filter((a: any) => item.attribute_ids.includes(a.id));
  };

  const getStatusBadge = (status: string) => {
      switch(status) {
          case 'APPROVED': return 'bg-success';
          case 'REJECTED': return 'bg-danger';
          case 'SENT': return 'bg-info text-dark';
          case 'IN_PRODUCTION': return 'bg-warning text-dark';
          default: return 'bg-secondary';
      }
  };

  const getStatusXPStyle = (status: string): React.CSSProperties => {
      const map: Record<string, { bg: string; border: string; color: string }> = {
          APPROVED:      { bg: '#e8f5e9', border: '#2e7d32', color: '#1b4620' },
          REJECTED:      { bg: '#fce4ec', border: '#b71c1c', color: '#6b0000' },
          SENT:          { bg: '#e8eaf6', border: '#3949ab', color: '#1a237e' },
          IN_PRODUCTION: { bg: '#fff8e1', border: '#c77800', color: '#4a3000' },
      };
      const s = map[status] || { bg: '#e8e8e8', border: '#6a6a6a', color: '#222' };
      return {
          background: s.bg, border: `1px solid ${s.border}`, color: s.color,
          padding: '1px 5px', fontSize: '9px', fontFamily: 'Tahoma, Arial, sans-serif',
          fontWeight: 'bold', whiteSpace: 'nowrap' as const,
      };
  };

  const currentBoundAttrs = getBoundAttributes(newSample.base_item_id);
  const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
  const getPONumber = (id: string) => salesOrders.find((s: any) => s.id === id)?.po_number || 'No PO';

  const STATUS_FILTERS = ['ALL', 'IN_PRODUCTION', 'SENT', 'APPROVED', 'REJECTED'];

  const filteredSamples = samples.filter((s: any) => {
      const matchSearch = !searchTerm ||
          s.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
          getItemName(s.base_item_id).toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === 'ALL' || s.status === statusFilter;
      return matchSearch && matchStatus;
  });

  return (
    <div className="fade-in">
       <CodeConfigModal
           isOpen={isConfigOpen}
           onClose={() => setIsConfigOpen(false)}
           type="SAMPLE"
           onSave={handleSaveConfig}
           initialConfig={codeConfig}
           attributes={attributes}
       />

       {/* Create Modal */}
       <ModalWrapper
           isOpen={isCreateOpen}
           onClose={() => setIsCreateOpen(false)}
           title={<><i className="bi bi-eyedropper me-2"></i>New Sample Request</>}
           variant="primary"
           size="lg"
           footer={
               <>
                   <button
                       type="button"
                       style={classic ? xpBtn() : undefined}
                       className={classic ? '' : 'btn btn-sm btn-link text-muted'}
                       onClick={() => setIsCreateOpen(false)}
                   >{t('cancel')}</button>
                   <button
                       type="button"
                       style={classic ? xpBtn({ background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)', borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a', color: '#ffffff', fontWeight: 'bold' }) : undefined}
                       className={classic ? '' : 'btn btn-sm btn-primary px-4 fw-bold'}
                       onClick={handleSubmit as any}
                   >Create Request</button>
               </>
           }
       >
           <form onSubmit={handleSubmit} id="create-sample-form">
               <div className="row g-3 mb-3">
                   <div className="col-md-6">
                       <label
                           style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 } : undefined}
                           className={classic ? '' : 'form-label d-flex justify-content-between align-items-center small text-muted'}
                       >
                           Request Code
                           <i className="bi bi-gear-fill text-muted" style={{cursor: 'pointer'}} onClick={() => setIsConfigOpen(true)} title="Configure Auto-Suggestion"></i>
                       </label>
                       <input style={classic ? xpInput : undefined} className={classic ? '' : 'form-control'} placeholder="Auto-generated" value={newSample.code} onChange={e => setNewSample({...newSample, code: e.target.value})} required />
                   </div>
                   <div className="col-md-6">
                       <label
                           style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 } : undefined}
                           className={classic ? '' : 'form-label small text-muted'}
                       >Link to Sales Order <span style={classic ? { fontWeight: 'normal', color: '#666' } : undefined} className={classic ? '' : 'fw-normal'}>(Optional)</span></label>
                       <SearchableSelect
                           options={[
                               { value: "", label: "No Sales Order (Internal/Prototype)" },
                               ...salesOrders.map((so: any) => ({ value: so.id, label: `${so.po_number} — ${so.customer_name}` }))
                           ]}
                           value={newSample.sales_order_id}
                           onChange={(val) => setNewSample({...newSample, sales_order_id: val})}
                           placeholder="Select SO (Optional)…"
                       />
                   </div>
               </div>
               <div className="mb-3">
                   <label
                       style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 } : undefined}
                       className={classic ? '' : 'form-label small text-muted'}
                   >Base Item <span style={classic ? { fontWeight: 'normal', color: '#666' } : undefined} className={classic ? '' : 'fw-normal text-muted'}>(Prototype Model)</span></label>
                   <SearchableSelect
                       options={items.filter((i: any) => i.category === 'Sample').map((item: any) => ({ value: item.id, label: item.name, subLabel: item.code }))}
                       value={newSample.base_item_id}
                       onChange={(val) => setNewSample({...newSample, base_item_id: val, attribute_value_ids: []})}
                       required
                       placeholder="Select Base Item…"
                   />
               </div>
               {currentBoundAttrs.length > 0 && (
                   <div
                       style={classic ? { marginBottom: 8, padding: '6px 8px', background: '#f5f4ef', border: '1px solid #b0a898' } : undefined}
                       className={classic ? '' : 'mb-3 p-3 border config-attributes-section'}
                   >
                       {classic ? (
                           <div style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#555', borderBottom: '1px solid #c0bdb5', paddingBottom: 3, marginBottom: 6 }}>
                               Define Configuration
                           </div>
                       ) : (
                           <label className="form-label small text-muted mb-2">Define Configuration</label>
                       )}
                       <div className="row g-2">
                           {currentBoundAttrs.map((attr: any) => (
                               <div key={attr.id} className="col-md-6">
                                   <label
                                       style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 } : undefined}
                                       className={classic ? '' : 'form-label small mb-1'}
                                   >{attr.name}</label>
                                   <select
                                       style={classic ? { ...xpInput, height: 'auto', padding: '2px 4px', width: '100%' } : undefined}
                                       className={classic ? '' : 'form-select form-select-sm'}
                                       value={newSample.attribute_value_ids.find(vid => attr.values.some((v: any) => v.id === vid)) || ''}
                                       onChange={e => handleValueChange(e.target.value, attr.id)}
                                       required
                                   >
                                       <option value="">Select {attr.name}…</option>
                                       {attr.values.map((v: any) => <option key={v.id} value={v.id}>{v.value}</option>)}
                                   </select>
                               </div>
                           ))}
                       </div>
                   </div>
               )}
               <div className="mb-3">
                   <label
                       style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 } : undefined}
                       className={classic ? '' : 'form-label small text-muted'}
                   >Notes</label>
                   <textarea style={classic ? { ...xpInput, height: 'auto', padding: '4px 6px', width: '100%', resize: 'vertical' as const } : undefined} className={classic ? '' : 'form-control'} rows={3} value={newSample.notes} onChange={e => setNewSample({...newSample, notes: e.target.value})} placeholder="e.g. Client requested softer fabric…"></textarea>
               </div>
           </form>
       </ModalWrapper>

       {/* Floating Action Dropdown */}
       {openDropdownId && (
           <div
               className={`dropdown-menu show shadow fixed-dropdown-menu ui-style-${currentStyle}`}
               style={{ position: 'absolute', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, minWidth: 180 }}
           >
               <div className="px-3 py-1 border-bottom" style={{ fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>
                   Update Status
               </div>
               <button className="dropdown-item small" onClick={() => { onUpdateStatus(openDropdownId, 'IN_PRODUCTION'); setOpenDropdownId(null); }}>
                   <i className="bi bi-gear me-2"></i>Mark In Production
               </button>
               <button className="dropdown-item small" onClick={() => { onUpdateStatus(openDropdownId, 'SENT'); setOpenDropdownId(null); }}>
                   <i className="bi bi-send me-2"></i>Mark Sent to Client
               </button>
               <div className="dropdown-divider"></div>
               <button className="dropdown-item small text-success" onClick={() => { onUpdateStatus(openDropdownId, 'APPROVED'); setOpenDropdownId(null); }}>
                   <i className="bi bi-check-lg me-2"></i>Client Approved
               </button>
               <button className="dropdown-item small text-danger" onClick={() => { onUpdateStatus(openDropdownId, 'REJECTED'); setOpenDropdownId(null); }}>
                   <i className="bi bi-x-lg me-2"></i>Client Rejected
               </button>
               {onDeleteSample && (
                   <>
                       <div className="dropdown-divider"></div>
                       <button className="dropdown-item small text-danger" onClick={() => { onDeleteSample(openDropdownId); setOpenDropdownId(null); }}>
                           <i className="bi bi-trash me-2"></i>Delete Request
                       </button>
                   </>
               )}
           </div>
       )}

       {/* ── Outer shell ── */}
       <div
           style={classic ? xpBevel : undefined}
           className={classic ? '' : 'card border-0 shadow-sm'}
       >
           {/* ── Title bar ── */}
           {classic ? (
               <div style={xpTitleBar}>
                   <span>
                       <i className="bi bi-eyedropper" style={{ marginRight: 6 }}></i>
                       {t('sample_requests')}
                   </span>
                   <button
                       style={xpBtn({ background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', fontWeight: 'bold' })}
                       onClick={openCreateModal}
                   >
                       <i className="bi bi-plus-lg" style={{ marginRight: 4 }}></i>{t('create')}
                   </button>
               </div>
           ) : (
               <div className="card-header bg-white d-flex justify-content-between align-items-center">
                   <div>
                       <h5 className="card-title mb-0">
                           <i className="bi bi-eyedropper me-2"></i>{t('sample_requests')}
                       </h5>
                       <p className="text-muted small mb-0 mt-1">Track prototype and sample approval workflow</p>
                   </div>
                   <button className="btn btn-sm btn-primary" onClick={openCreateModal}>
                       <i className="bi bi-plus-lg me-2"></i>{t('create')}
                   </button>
               </div>
           )}

           {/* ── Secondary toolbar: search + status filters + count ── */}
           {classic ? (
               <div style={xpToolbar}>
                   <input
                       style={{ ...xpInput, width: 180 }}
                       placeholder="Search code or item…"
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
                           {s === 'IN_PRODUCTION' ? 'IN PROD' : s}
                       </button>
                   ))}
                   <div style={xpSep}></div>
                   <span style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#333' }}>
                       {filteredSamples.length} request{filteredSamples.length !== 1 ? 's' : ''}
                   </span>
               </div>
           ) : (
               <div className="px-3 py-2 border-bottom d-flex align-items-center gap-2 flex-wrap bg-white">
                   <div className="position-relative" style={{ flex: '1 1 160px', maxWidth: 240 }}>
                       <i className="bi bi-search position-absolute" style={{ left: 7, top: '50%', transform: 'translateY(-50%)', fontSize: 11, opacity: 0.5 }}></i>
                       <input
                           className="form-control form-control-sm"
                           style={{ paddingLeft: 24 }}
                           placeholder="Search code or item…"
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
                               {s === 'IN_PRODUCTION' ? 'IN PROD' : s}
                           </button>
                       ))}
                   </div>
                   <span className="text-muted small ms-1">
                       {filteredSamples.length} request{filteredSamples.length !== 1 ? 's' : ''}
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
                               <th style={classic ? { ...xpThCell, width: '130px' } : undefined} className={classic ? '' : 'ps-4'}>Request Code</th>
                               <th style={classic ? { ...xpThCell, width: '110px' } : undefined}>Related PO</th>
                               <th style={classic ? xpThCell : undefined}>Item Config</th>
                               <th style={classic ? { ...xpThCell, width: '90px' } : undefined}>Status</th>
                               <th style={classic ? { ...xpThCell, textAlign: 'right' as const, borderRight: 'none', width: '100px' } : undefined} className={classic ? '' : 'text-end pe-4'}>Actions</th>
                           </tr>
                       </thead>
                       <tbody>
                           {filteredSamples.map((s: any, rowIndex: number) => (
                               <tr
                                   key={s.id}
                                   style={classic ? { background: rowIndex % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' } : undefined}
                               >
                                   <td style={classic ? tdBase : undefined} className={classic ? '' : 'ps-4'}>
                                       <div style={classic ? { fontFamily: "'Courier New', monospace", fontWeight: 'bold', color: '#0058e6', fontSize: '10px' } : undefined} className={classic ? '' : 'fw-bold font-monospace text-primary'}>
                                           {s.code}
                                       </div>
                                       <div style={classic ? { fontSize: '9px', color: '#888' } : undefined} className={classic ? '' : 'small text-muted'}>
                                           {new Date(s.created_at).toLocaleDateString()}
                                       </div>
                                   </td>
                                   <td style={classic ? tdBase : undefined}>
                                       {s.sales_order_id ? (
                                           classic ? (
                                               <span style={{ background: '#e8e8e8', border: '1px solid #6a6a6a', color: '#000', padding: '1px 5px', fontSize: '9px', fontFamily: 'Tahoma, Arial, sans-serif' }}>
                                                   <i className="bi bi-receipt" style={{ marginRight: 3 }}></i>{getPONumber(s.sales_order_id)}
                                               </span>
                                           ) : (
                                               <span className="badge bg-light text-dark border"><i className="bi bi-receipt me-1"></i>{getPONumber(s.sales_order_id)}</span>
                                           )
                                       ) : (
                                           <span style={classic ? { fontSize: '9px', color: '#888', fontStyle: 'italic', fontFamily: 'Tahoma, Arial, sans-serif' } : undefined} className={classic ? '' : 'text-muted small fst-italic'}>
                                               Internal
                                           </span>
                                       )}
                                   </td>
                                   <td style={classic ? tdBase : undefined}>
                                       <div style={classic ? { fontWeight: 'bold', fontSize: '11px' } : undefined} className={classic ? '' : 'fw-medium'}>
                                           {getItemName(s.base_item_id)}
                                       </div>
                                       <div style={classic ? { display: 'flex', gap: 2, flexWrap: 'wrap' as const, marginTop: 2 } : undefined} className={classic ? '' : 'small text-muted d-flex gap-1 flex-wrap mt-1'}>
                                           {s.attribute_values && s.attribute_values.map((v: any) => (
                                               classic ? (
                                                   <span key={v.id} style={{ background: '#e8e8e8', border: '1px solid #aaa', color: '#333', padding: '0 4px', fontSize: '9px', fontFamily: 'Tahoma, Arial, sans-serif' }}>
                                                       {v.value}
                                                   </span>
                                               ) : (
                                                   <span key={v.id} className="badge bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-10">{v.value}</span>
                                               )
                                           ))}
                                       </div>
                                       {s.notes && (
                                           <div
                                               style={classic
                                                   ? { fontSize: '9px', color: '#666', fontStyle: 'italic', marginTop: 2, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }
                                                   : { maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                               className={classic ? '' : 'small text-muted fst-italic mt-1'}
                                           >
                                               <i className="bi bi-sticky" style={{ marginRight: 3 }}></i>{s.notes}
                                           </div>
                                       )}
                                   </td>
                                   <td style={classic ? tdBase : undefined}>
                                       {classic ? (
                                           <span style={getStatusXPStyle(s.status)}>{s.status}</span>
                                       ) : (
                                           <span className={`badge ${getStatusBadge(s.status)}`}>{s.status}</span>
                                       )}
                                   </td>
                                   <td style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'right' as const } : undefined} className={classic ? '' : 'pe-4 text-end'}>
                                       <div style={classic ? { display: 'flex', gap: 2, justifyContent: 'flex-end' } : undefined} className={classic ? '' : 'd-flex justify-content-end gap-2'}>
                                           {classic ? (
                                               <button
                                                   title="View History"
                                                   onClick={() => setHistoryEntityId(s.id)}
                                                   style={{ background: 'none', border: '1px solid transparent', borderRadius: 2, cursor: 'pointer', padding: '1px 4px', color: '#555', fontSize: '11px' }}
                                                   onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#7f9db9'; (e.currentTarget as HTMLButtonElement).style.background = '#e8f0f8'; }}
                                                   onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                                               >
                                                   <i className="bi bi-clock-history"></i>
                                               </button>
                                           ) : (
                                               <button className="btn btn-sm btn-link text-muted p-0" title="View History" onClick={() => setHistoryEntityId(s.id)}>
                                                   <i className="bi bi-clock-history"></i>
                                               </button>
                                           )}
                                           {classic ? (
                                               <button
                                                   style={xpBtn()}
                                                   className="action-dropdown-btn"
                                                   onClick={(e) => toggleDropdown(s.id, e)}
                                               >
                                                   Update <i className="bi bi-caret-down-fill ms-1" style={{fontSize: '0.65em'}}></i>
                                               </button>
                                           ) : (
                                               <button
                                                   className="btn btn-sm btn-light border action-dropdown-btn py-0 px-2"
                                                   style={{ fontSize: 11 }}
                                                   type="button"
                                                   onClick={(e) => toggleDropdown(s.id, e)}
                                               >
                                                   Update <i className="bi bi-caret-down-fill ms-1" style={{fontSize: '0.65em'}}></i>
                                               </button>
                                           )}
                                       </div>
                                   </td>
                               </tr>
                           ))}
                           {filteredSamples.length === 0 && (
                               <tr>
                                   <td
                                       colSpan={5}
                                       style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'center', padding: '24px 8px', color: '#888', fontStyle: 'italic' } : undefined}
                                       className={classic ? '' : 'text-center py-5 text-muted'}
                                   >
                                       {searchTerm || statusFilter !== 'ALL'
                                           ? 'No requests match the current filter.'
                                           : 'No sample requests found. Create one to get started.'}
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
                   <span>{samples.length} total</span>
                   <span>|</span>
                   <span>{samples.filter((s: any) => s.status === 'APPROVED').length} approved</span>
                   <span>|</span>
                   <span>{samples.filter((s: any) => s.status === 'IN_PRODUCTION').length} in production</span>
               </div>
           )}
       </div>

       {historyEntityId && (
           <HistoryPane
               entityType="SampleRequest"
               entityId={historyEntityId}
               onClose={() => setHistoryEntityId(null)}
           />
       )}
    </div>
  );
}
