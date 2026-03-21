import { useState, useRef, useEffect } from 'react';
import { useToast } from './Toast';
import { useLanguage } from '../context/LanguageContext';
import CodeConfigModal, { CodeConfig, buildCodeParts } from './CodeConfigModal';
import SearchableSelect from './SearchableSelect';
import HistoryPane from './HistoryPane';

export default function SampleRequestView({ samples, salesOrders, items, attributes, onCreateSample, onUpdateStatus, onDeleteSample, uiStyle }: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [historyEntityId, setHistoryEntityId] = useState<string | null>(null);
  
  const [newSample, setNewSample] = useState({
      code: '',
      sales_order_id: '',
      base_item_id: '',
      attribute_value_ids: [] as string[],
      notes: ''
  });

  // Config State
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
          try {
              setCodeConfig(JSON.parse(savedConfig));
          } catch (e) {
              console.error("Invalid config in localstorage");
          }
      }
  }, []);

  const handleSaveConfig = (newConfig: CodeConfig) => {
      setCodeConfig(newConfig);
      localStorage.setItem('sample_code_config', JSON.stringify(newConfig));
      const suggested = suggestSampleCode(newConfig);
      setNewSample(prev => ({ ...prev, code: suggested }));
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
      if (!newSample.code) {
          setNewSample(prev => ({ ...prev, code: suggestSampleCode() }));
      }
      setIsCreateOpen(true);
  };

  // Close dropdown when clicking outside (and handle scroll closing)
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
      if (openDropdownId === id) {
          setOpenDropdownId(null);
      } else {
          const rect = (e.target as HTMLElement).getBoundingClientRect();
          setDropdownPos({
              top: rect.bottom + window.scrollY + 2,
              left: rect.right + window.scrollX - 160 
          });
          setOpenDropdownId(id);
      }
  };

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const payload = {
          ...newSample,
          sales_order_id: newSample.sales_order_id || null
      };
      onCreateSample(payload);
      setNewSample({ code: '', sales_order_id: '', base_item_id: '', attribute_value_ids: [], notes: '' });
      setIsCreateOpen(false);
  };

  const handleValueChange = (valId: string, attrId: string) => {
      const attr = attributes.find((a: any) => a.id === attrId);
      if (!attr) return;

      const otherValues = newSample.attribute_value_ids.filter(vid => !attr.values.some((v:any) => v.id === vid));
      const newValues = valId ? [...otherValues, valId] : otherValues;
      setNewSample({...newSample, attribute_value_ids: newValues});
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

  const currentBoundAttrs = getBoundAttributes(newSample.base_item_id);
  const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
  const getPONumber = (id: string) => salesOrders.find((s: any) => s.id === id)?.po_number || 'No PO';

  return (
    <div className="row g-4 fade-in">
       <CodeConfigModal 
           isOpen={isConfigOpen} 
           onClose={() => setIsConfigOpen(false)} 
           type="SAMPLE"
           onSave={handleSaveConfig}
           initialConfig={codeConfig}
           attributes={attributes}
       />

       {/* Create Modal */}
       {isCreateOpen && (
       <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 20000, position: 'fixed', inset: 0 }}>
            <div className={`modal-dialog modal-lg modal-dialog-centered ui-style-${uiStyle}`}>
                <div className="modal-content shadow">
                    <div className="modal-header bg-primary bg-opacity-10 text-primary-emphasis">
                        <h5 className="modal-title"><i className="bi bi-eyedropper me-2"></i>New Sample Request</h5>
                        <button type="button" className="btn-close" onClick={() => setIsCreateOpen(false)}></button>
                    </div>
                    <div className="modal-body">
                        <form onSubmit={handleSubmit}>
                            <div className="row g-3 mb-3">
                                <div className="col-md-6">
                                    <label className="form-label d-flex justify-content-between align-items-center small text-muted">
                                        Request Code
                                        <i 
                                            className="bi bi-gear-fill text-muted" 
                                            style={{cursor: 'pointer'}}
                                            onClick={() => setIsConfigOpen(true)}
                                            title="Configure Auto-Suggestion"
                                        ></i>
                                    </label>
                                    <input className="form-control" placeholder="Auto-generated" value={newSample.code} onChange={e => setNewSample({...newSample, code: e.target.value})} required />
                                </div>
                                <div className="col-md-6">
                                    <label className="form-label small text-muted">Link to Sales Order (Optional)</label>
                                    <SearchableSelect 
                                        options={[
                                            { value: "", label: "No Sales Order (Internal/Prototype)" },
                                            ...salesOrders.map((so: any) => ({ value: so.id, label: `${so.po_number} - ${so.customer_name}` }))
                                        ]}
                                        value={newSample.sales_order_id} 
                                        onChange={(val) => setNewSample({...newSample, sales_order_id: val})}
                                        placeholder="Select SO (Optional)..."
                                    />
                                </div>
                            </div>
                            
                            <div className="mb-3">
                                <label className="form-label">Base Item (Prototype Model)</label>
                                <SearchableSelect 
                                    options={items.filter((i:any) => i.category === 'Sample').map((item: any) => ({ value: item.id, label: item.name, subLabel: item.code }))}
                                    value={newSample.base_item_id} 
                                    onChange={(val) => setNewSample({...newSample, base_item_id: val, attribute_value_ids: []})}
                                    required
                                    placeholder="Select Base Item..."
                                />
                            </div>

                            {currentBoundAttrs.length > 0 && (
                                <div className="mb-3 p-3 bg-light rounded border">
                                    <label className="form-label small text-muted mb-2">Define Configuration</label>
                                    <div className="row g-2">
                                        {currentBoundAttrs.map((attr: any) => (
                                            <div key={attr.id} className="col-md-6">
                                                <label className="form-label small mb-1">{attr.name}</label>
                                                <select 
                                                    className="form-select form-select-sm"
                                                    value={newSample.attribute_value_ids.find(vid => attr.values.some((v:any) => v.id === vid)) || ''}
                                                    onChange={e => handleValueChange(e.target.value, attr.id)}
                                                    required
                                                >
                                                    <option value="">Select {attr.name}...</option>
                                                    {attr.values.map((v: any) => <option key={v.id} value={v.id}>{v.value}</option>)}
                                                </select>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="mb-3">
                                <label className="form-label">Notes</label>
                                <textarea className="form-control" rows={3} value={newSample.notes} onChange={e => setNewSample({...newSample, notes: e.target.value})} placeholder="e.g. Client requested softer fabric..."></textarea>
                            </div>

                            <div className="d-flex justify-content-end gap-2 mt-3">
                                <button type="button" className="btn btn-secondary" onClick={() => setIsCreateOpen(false)}>{t('cancel')}</button>
                                <button type="submit" className="btn btn-primary fw-bold px-4">Create Request</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
       </div>
       )}

       {/* Floating Dropdown Menu */}
       {openDropdownId && (
           <div 
                className={`dropdown-menu show shadow fixed-dropdown-menu ui-style-${uiStyle}`}
                style={{
                    position: 'fixed', 
                    top: dropdownPos.top, 
                    left: dropdownPos.left, 
                    zIndex: 9999,
                    display: 'block'
                }}
           >
                <button className="dropdown-item small" onClick={() => { onUpdateStatus(openDropdownId, 'IN_PRODUCTION'); setOpenDropdownId(null); }}>Mark In Production</button>
                <button className="dropdown-item small" onClick={() => { onUpdateStatus(openDropdownId, 'SENT'); setOpenDropdownId(null); }}>Mark Sent to Client</button>
                <div className="dropdown-divider"></div>
                <button className="dropdown-item small text-success" onClick={() => { onUpdateStatus(openDropdownId, 'APPROVED'); setOpenDropdownId(null); }}><i className="bi bi-check-lg me-2"></i>Client Approved</button>
                <button className="dropdown-item small text-danger" onClick={() => { onUpdateStatus(openDropdownId, 'REJECTED'); setOpenDropdownId(null); }}><i className="bi bi-x-lg me-2"></i>Client Rejected</button>
                <div className="dropdown-divider"></div>
                <button className="dropdown-item small text-danger" onClick={() => { onDeleteSample(openDropdownId); setOpenDropdownId(null); }}>Delete Request</button>
           </div>
       )}

       {/* List */}
       <div className="col-12">
          <div className="card h-100 shadow-sm border-0">
             <div className="card-header bg-white d-flex justify-content-between align-items-center">
                 <h5 className="card-title mb-0">{t('sample_requests')}</h5>
                 <button className="btn btn-sm btn-primary" onClick={openCreateModal}>
                     <i className="bi bi-plus-lg me-2"></i> {t('create')}
                 </button>
             </div>
             <div className="card-body p-0">
                <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                        <thead className="table-light">
                            <tr>
                                <th className="ps-4">Request Code</th>
                                <th>Related PO</th>
                                <th>Item Config</th>
                                <th>Status</th>
                                <th style={{width: '120px'}} className="text-end pe-4">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {samples.map((s: any) => (
                                <tr key={s.id}>
                                    <td className="ps-4">
                                        <div className="fw-bold font-monospace text-primary">{s.code}</div>
                                        <div className="small text-muted">{new Date(s.created_at).toLocaleDateString()}</div>
                                    </td>
                                    <td>
                                        {s.sales_order_id ? (
                                            <span className="badge bg-light text-dark border"><i className="bi bi-receipt me-1"></i>{getPONumber(s.sales_order_id)}</span>
                                        ) : <span className="text-muted small">-</span>}
                                    </td>
                                    <td>
                                        <div className="fw-medium">{getItemName(s.base_item_id)}</div>
                                        <div className="small text-muted d-flex gap-1 flex-wrap mt-1">
                                            {s.attribute_values && s.attribute_values.map((v:any) => (
                                                <span key={v.id} className="badge bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-10">{v.value}</span>
                                            ))}
                                        </div>
                                        {s.notes && <div className="small text-muted fst-italic mt-1"><i className="bi bi-sticky me-1"></i>{s.notes}</div>}
                                    </td>
                                    <td><span className={`badge ${getStatusBadge(s.status)}`}>{s.status}</span></td>
                                    <td className="pe-4 text-end">
                                        <div className="d-flex justify-content-end gap-2">
                                            <button className="btn btn-sm btn-link text-info p-0" title="View History" onClick={() => setHistoryEntityId(s.id)}>
                                                <i className="bi bi-clock-history"></i>
                                            </button>
                                            <button 
                                                className="btn btn-sm btn-light border action-dropdown-btn" 
                                                type="button"
                                                onClick={(e) => toggleDropdown(s.id, e)}
                                            >
                                                Update <i className="bi bi-caret-down-fill ms-1" style={{fontSize: '0.7em'}}></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {samples.length === 0 && <tr><td colSpan={5} className="text-center py-5 text-muted">No sample requests found</td></tr>}
                        </tbody>
                    </table>
                </div>
             </div>
          </div>
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
