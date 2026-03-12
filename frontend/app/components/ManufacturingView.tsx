import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import CodeConfigModal, { CodeConfig } from './CodeConfigModal';
import CalendarView from './CalendarView';
import SearchableSelect from './SearchableSelect';
import QRScannerView from './QRScannerView';
import { useToast } from './Toast';
import { useLanguage } from '../context/LanguageContext';
import ModalWrapper from './ModalWrapper';
import PrintHeader from './PrintHeader';

export default function ManufacturingView({ 
    items, 
    boms, 
    locations, 
    attributes, 
    workOrders, 
    stockBalance, 
    workCenters, 
    operations, 
    onCreateWO, 
    onUpdateStatus, 
    onDeleteWO, 
    currentPage, 
    totalItems, 
    pageSize, 
    onPageChange,
    initialCreateState,
    onClearInitialState 
}: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [viewMode, setViewMode] = useState('list'); 

  // Derived Pagination
  const totalPages = Math.ceil(totalItems / pageSize);
  const startRange = (currentPage - 1) * pageSize + 1;
  const endRange = Math.min(currentPage * pageSize, totalItems);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newWO, setNewWO] = useState({ 
      code: '', 
      bom_id: '', 
      location_code: '', 
      source_location_code: '', 
      qty: 1.0, 
      target_start_date: '',
      target_end_date: '',
      sales_order_id: '',
      create_nested: false // Default to false
  });
  
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [printingWO, setPrintingWO] = useState<any>(null); 
  const [qrDataUrl, setQrDataUrl] = useState<string>(''); 
  
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [codeConfig, setCodeConfig] = useState<CodeConfig>({
      prefix: 'WO',
      suffix: '',
      separator: '-',
      includeItemCode: true,
      includeVariant: false,
      variantAttributeNames: [],
      includeYear: false,
      includeMonth: false
  });

  const [currentStyle, setCurrentStyle] = useState('default');

  // Handle Automated Creation from Sales Order
  useEffect(() => {
      if (initialCreateState && items.length > 0 && boms.length > 0) {
          const { item_id, qty, sales_order_id } = initialCreateState;
          
          // Find matching BOM
          const bom = boms.find((b: any) => b.item_id === item_id);
          
          if (bom) {
              const suggestedCode = suggestWOCode(bom.id);
              setNewWO(prev => ({
                  ...prev,
                  code: suggestedCode,
                  bom_id: bom.id,
                  qty: qty,
                  sales_order_id: sales_order_id || ''
              }));
              setIsCreateOpen(true);
              onClearInitialState(); // Stop the loop by signaling parent to clear state
              showToast('Production details pre-filled from Sales Order', 'info');
          } else {
              showToast('No active BOM found for the requested item.', 'warning');
              onClearInitialState(); // Still clear state to stop the alert loop
          }
      }
  }, [initialCreateState, items, boms, onClearInitialState]);

  useEffect(() => {
      const savedConfig = localStorage.getItem('wo_code_config');
      if (savedConfig) {
          try { setCodeConfig(JSON.parse(savedConfig)); } catch (e) {}
      }
      const savedStyle = localStorage.getItem('ui_style');
      if (savedStyle) setCurrentStyle(savedStyle);
  }, []);

  const handleSaveConfig = (newConfig: CodeConfig) => {
      setCodeConfig(newConfig);
      localStorage.setItem('wo_code_config', JSON.stringify(newConfig));
      if (newWO.bom_id) {
          const suggested = suggestWOCode(newWO.bom_id, newConfig);
          setNewWO(prev => ({ ...prev, code: suggested }));
      }
  };

  const suggestWOCode = (bomId: string, config = codeConfig) => {
      const bom = boms.find((b: any) => b.id === bomId);
      if (!bom) return '';
      const item = items.find((i: any) => i.id === bom.item_id);
      const itemCode = item ? item.code : 'PROD';
      
      let variantName = '';
      if (config.includeVariant && bom.attribute_value_ids && bom.attribute_value_ids.length > 0) {
          const names: string[] = [];
          for (const valId of bom.attribute_value_ids) {
              for (const attr of attributes) {
                  const val = attr.values.find((v: any) => v.id === valId);
                  if (val) {
                      if (!config.variantAttributeNames || config.variantAttributeNames.length === 0 || config.variantAttributeNames.includes(attr.name)) {
                          names.push(val.value.toUpperCase().replace(/\s+/g, ''));
                      }
                      break;
                  }
              }
          }
          variantName = names.join('');
      }

      const parts = [];
      if (config.prefix) parts.push(config.prefix);
      if (config.includeItemCode) parts.push(itemCode);
      if (config.includeVariant && variantName) parts.push(variantName);
      const now = new Date();
      if (config.includeYear) parts.push(now.getFullYear());
      if (config.includeMonth) parts.push(String(now.getMonth() + 1).padStart(2, '0'));
      if (config.suffix) parts.push(config.suffix);
      const basePattern = parts.join(config.separator);
      let counter = 1;
      let baseCode = `${basePattern}${config.separator}001`;
      while (workOrders.some((w: any) => w.code === baseCode)) {
          counter++;
          baseCode = `${basePattern}${config.separator}${String(counter).padStart(3, '0')}`;
      }
      return baseCode;
  };

  const handlePrintList = () => {
      window.print();
  };

  const handlePrintWO = async (wo: any) => {
      try {
          const url = await QRCode.toDataURL(wo.code, { margin: 1, width: 200 });
          setQrDataUrl(url);
          setPrintingWO(wo);
          setTimeout(() => window.print(), 300);
      } catch (err) {
          console.error("QR Generation failed", err);
          setPrintingWO(wo);
          setTimeout(() => window.print(), 300);
      }
  };

  const filteredWorkOrders = workOrders.filter((wo: any) => {
      const date = new Date(wo.created_at);
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;
      if (start && date < start) return false;
      if (end) {
          const endDateTime = new Date(end);
          endDateTime.setHours(23, 59, 59, 999);
          if (date > endDateTime) return false;
      }
      return true;
  });

  const handleBOMChange = (bomId: string) => {
      const suggestedCode = suggestWOCode(bomId);
      setNewWO({...newWO, bom_id: bomId, code: suggestedCode});
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      
      // Clean dates: convert empty strings to null for Pydantic
      const payload = {
          ...newWO,
          target_start_date: newWO.target_start_date || null,
          target_end_date: newWO.target_end_date || null,
          sales_order_id: newWO.sales_order_id || null
      };

      const res = await onCreateWO(payload);
      if (res && res.status === 400) {
          let baseCode = newWO.code;
          const baseMatch = baseCode.match(/^(.*)-(\d+)$/);
          if (baseMatch) baseCode = baseMatch[1];
          let counter = 1;
          let suggestedCode = `${baseCode}-${counter}`;
          while (workOrders.some((w: any) => w.code === suggestedCode)) {
              counter++;
              suggestedCode = `${baseCode}-${counter}`;
          }
          showToast(`Work Order Code "${newWO.code}" already exists. Suggesting: ${suggestedCode}`, 'warning');
          setNewWO({ ...newWO, code: suggestedCode });
      } else if (res && res.ok) {
          const createdWO = await res.json();
          if (createdWO.is_material_available === false) {
              showToast('Work Order created, but insufficient materials!', 'warning');
          } else {
              showToast('Work Order created successfully!', 'success');
          }
          setNewWO({ code: '', bom_id: '', location_code: '', source_location_code: '', qty: 1.0, target_start_date: '', target_end_date: '' });
          setIsCreateOpen(false);
      } else {
          showToast('Failed to create Work Order', 'danger');
      }
  };

  const toggleRow = (id: string) => {
      setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Helpers
  const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
  const getItemCode = (id: string) => items.find((i: any) => i.id === id)?.code || id;
  const getBOMCode = (id: string) => boms.find((b: any) => b.id === id)?.code || id;
  const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || id;
  const getOpName = (id: string) => operations.find((o: any) => o.id === id)?.name || id;
  const getWCName = (id: string) => workCenters.find((w: any) => w.id === id)?.name || id;
  
  const getAttributeValueName = (valId: string) => {
      for (const attr of attributes) {
          const val = attr.values.find((v: any) => v.id === valId);
          if (val) return val.value;
      }
      return valId;
  };

  const getStatusBadge = (status: string) => {
      switch(status) {
          case 'COMPLETED': return 'bg-success';
          case 'IN_PROGRESS': return 'bg-warning text-dark';
          case 'CANCELLED': return 'bg-danger';
          default: return 'bg-secondary';
      }
  };

  const formatDate = (date: string | null) => {
      if (!date) return '-';
      return new Date(date).toLocaleDateString();
  };

  const formatDateTime = (date: string | null) => {
      if (!date) return '-';
      return new Date(date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  };

  const getDueDateWarning = (wo: any) => {
      if (wo.status === 'COMPLETED' || wo.status === 'CANCELLED') return null;
      if (!wo.target_end_date) return null;
      const due = new Date(wo.target_end_date);
      const now = new Date();
      const diffDays = (due.getTime() - now.getTime()) / (1000 * 3600 * 24);
      if (diffDays < 0) return { type: 'danger', icon: 'bi-exclamation-octagon-fill', text: 'Overdue!' };
      if (diffDays < 2) return { type: 'warning', icon: 'bi-exclamation-triangle-fill', text: 'Due Soon' };
      return null;
  };

  const calculateRequiredQty = (baseQty: number, line: any, bom: any) => {
      let required = parseFloat(line.qty);
      if (line.is_percentage) {
          required = (baseQty * required) / 100;
      } else {
          required = baseQty * required;
      }
      const tolerance = parseFloat(bom?.tolerance_percentage || 0);
      if (tolerance > 0) {
          required = required * (1 + (tolerance / 100));
      }
      return required;
  };

  const checkStockAvailability = (item_id: string, location_id: string, attribute_value_ids: string[] = [], required_qty: number) => {
      const targetIds = attribute_value_ids || [];
      const matchingEntries = stockBalance.filter((s: any) => 
          String(s.item_id) === String(item_id) && String(s.location_id) === String(location_id)
      );
      const available = matchingEntries.reduce((sum: number, e: any) => sum + parseFloat(e.qty), 0);
      return { available, isEnough: available >= required_qty };
  };

  // --- Print Template Component ---
  const WorkOrderPrintTemplate = ({ wo }: { wo: any }) => {
      const bom = boms.find((b: any) => b.id === wo.bom_id);
      
      const renderPrintBOMLines = (lines: any[], level = 0, currentParentQty = 1, currentBOM: any) => {
          return lines.map((line: any) => {
              const subBOM = boms.find((b: any) => b.item_id === line.item_id);
              let scaledQty = parseFloat(line.qty);
              if (line.is_percentage) {
                  scaledQty = (currentParentQty * scaledQty) / 100;
              } else {
                  scaledQty = currentParentQty * scaledQty;
              }
              const tolerance = parseFloat(currentBOM?.tolerance_percentage || 0);
              if (tolerance > 0) {
                  scaledQty = scaledQty * (1 + (tolerance / 100));
              }
              
              return (
                  <>
                      <tr key={line.id}>
                          <td style={{paddingLeft: `${level * 12 + 8}px`}}>
                              <span className="font-monospace extra-small">{line.item_code || getItemCode(line.item_id)}</span>
                          </td>
                          <td>
                              <div style={{fontSize: '9pt'}}>
                                  {level > 0 && <span className="text-muted me-1 small">↳</span>}
                                  {line.item_name || getItemName(line.item_id)}
                              </div>
                          </td>
                          <td className="extra-small fst-italic">
                              {line.qty}{line.is_percentage ? '%' : ''} 
                              {(line.attribute_value_ids || []).length > 0 && ` • ${(line.attribute_value_ids || []).map(getAttributeValueName).join(', ')}`}
                          </td>
                          <td><span className="extra-small">{getLocationName(line.source_location_id || wo.source_location_id || wo.location_id)}</span></td>
                          <td className="text-end fw-bold small">{(scaledQty * wo.qty).toFixed(3)}</td> 
                      </tr>
                      {subBOM && subBOM.lines && renderPrintBOMLines(subBOM.lines, level + 1, scaledQty, subBOM)}
                  </>
              );
          });
      };

      return (
          <div className="bg-white p-4 h-100 position-fixed top-0 start-0 w-100 print-container" style={{zIndex: 2000, overflowY: 'auto'}}>
              <PrintHeader title="Work Order" />

              <div className="d-flex justify-content-between border-bottom pb-2 mb-3 mt-4">
                  <div className="d-flex gap-3">
                      <div className="bg-white border p-1 rounded">
                          <img src={qrDataUrl} alt="WO QR" style={{ width: '100px', height: '100px' }} />
                      </div>
                      <div>
                          <h4 className="font-monospace mb-0 fw-bold text-primary">{wo.code}</h4>
                          <div className={`badge ${getStatusBadge(wo.status)} small mt-1`}>{wo.status}</div>
                      </div>
                  </div>
                  <div className="text-end">
                      <div className="extra-small text-muted mb-1">Production Timeline</div>
                      <div className="extra-small d-flex justify-content-end gap-2">
                          <span className="text-muted">Target:</span> 
                          <strong>{formatDate(wo.target_start_date)} - {formatDate(wo.target_end_date)}</strong>
                      </div>
                  </div>
              </div>

              <div className="row mb-3 g-2">
                  <div className="col-5">
                      <h6 className="text-uppercase text-muted extra-small fw-bold mb-1">Finished Good</h6>
                      <div className="fw-bold" style={{fontSize: '11pt'}}>{getItemName(wo.item_id)}</div>
                      <div className="extra-small font-monospace text-muted">{getItemCode(wo.item_id)}</div>
                  </div>
                  <div className="col-2 text-center border-start border-end">
                      <h6 className="text-uppercase text-muted extra-small fw-bold mb-1">Target Qty</h6>
                      <div className="fw-bold fs-4">{wo.qty}</div>
                  </div>
                  <div className="col-5 text-end">
                      <h6 className="text-uppercase text-muted extra-small fw-bold mb-1">Production Timeline</h6>
                      <div className="extra-small d-flex justify-content-end gap-2">
                          <span className="text-muted">Target:</span> 
                          <strong>{formatDate(wo.target_start_date)} - {formatDate(wo.target_end_date)}</strong>
                      </div>
                      <div className="extra-small d-flex justify-content-end gap-2 mt-1">
                          <span className="text-muted">Actual Start:</span> 
                          <strong>{formatDateTime(wo.actual_start_date)}</strong>
                      </div>
                      <div className="extra-small d-flex justify-content-end gap-2">
                          <span className="text-muted">Actual End:</span> 
                          <strong>{formatDateTime(wo.actual_end_date)}</strong>
                      </div>
                  </div>
              </div>

              <h6 className="fw-bold border-bottom pb-1 mb-2 mt-4">Bill of Materials (Full Tree)</h6>
              <table className="table table-bordered table-sm mb-4">
                  <thead className="table-light">
                      <tr style={{fontSize: '8pt'}}>
                          <th style={{width: '15%'}}>Code</th>
                          <th style={{width: '35%'}}>Component Name</th>
                          <th style={{width: '20%'}}>Attributes / Specs</th>
                          <th style={{width: '15%'}}>Source</th>
                          <th style={{width: '15%'}} className="text-end">Required Qty</th>
                      </tr>
                  </thead>
                  <tbody>
                      {bom ? renderPrintBOMLines(bom.lines, 0, 1, bom) : <tr><td colSpan={5}>No BOM found</td></tr>}
                  </tbody>
              </table>

              <div className="mt-5 pt-5 border-top d-flex justify-content-between text-muted small">
                  <div>Printed: {new Date().toLocaleString()}</div>
                  <div className="text-center" style={{width: '200px'}}>
                      <div className="border-bottom mb-1" style={{height: '40px'}}></div>
                      Authorized Signature
                  </div>
              </div>

              <div className="position-fixed top-0 end-0 p-3 no-print" style={{ zIndex: 3000 }}>
                  <button className="btn btn-dark shadow" onClick={() => setPrintingWO(null)}>
                      <i className="bi bi-x-lg me-2"></i>Close Preview
                  </button>
              </div>
          </div>
      );
  };

  return (
      <div className="row g-4 fade-in print-container">
          {printingWO && <WorkOrderPrintTemplate wo={printingWO} />}

          <CodeConfigModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} type="WO" onSave={handleSaveConfig} initialConfig={codeConfig} attributes={attributes} />

          <ModalWrapper
              isOpen={isCreateOpen}
              onClose={() => setIsCreateOpen(false)}
              title={<><i className="bi bi-play-circle me-1"></i> NEW PRODUCTION RUN</>}
              variant="success"
              size="lg"
              footer={
                  <>
                      <button type="button" className="btn btn-sm btn-link text-muted text-decoration-none" onClick={() => setIsCreateOpen(false)}>{t('cancel')}</button>
                      <button type="button" className="btn btn-sm btn-success px-4 fw-bold shadow-sm" onClick={handleSubmit}>CREATE WORK ORDER</button>
                  </>
              }
          >
              <div className="row g-3 mb-3">
                  <div className="col-md-6">
                      <label className="form-label extra-small fw-bold text-muted uppercase">WO Reference Code</label>
                      <div className="input-group">
                          <input className="form-control form-control-sm" placeholder="Auto-generated" value={newWO.code} onChange={e => setNewWO({...newWO, code: e.target.value})} required />
                          <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => setIsConfigOpen(true)}><i className="bi bi-gear-fill"></i></button>
                      </div>
                  </div>
                  <div className="col-md-6">
                      <label className="form-label extra-small fw-bold text-muted uppercase">Target Quantity</label>
                      <input type="number" className="form-control form-control-sm" value={newWO.qty} onChange={e => setNewWO({...newWO, qty: parseFloat(e.target.value)})} required />
                  </div>
              </div>

              <div className="mb-3">
                  <label className="form-label extra-small fw-bold text-muted uppercase">Product Recipe (BOM)</label>
                  <SearchableSelect 
                      options={boms.map((b: any) => ({ value: b.id, label: `${b.code} - ${getItemName(b.item_id)}` }))}
                      value={newWO.bom_id}
                      onChange={handleBOMChange}
                      required
                      placeholder="Choose a product recipe..."
                  />
              </div>

              <div className="row g-3 mb-3">
                  <div className="col-md-6">
                      <label className="form-label extra-small fw-bold text-muted uppercase">Target Start Date</label>
                      <input type="date" className="form-control form-control-sm" value={newWO.target_start_date} onChange={e => setNewWO({...newWO, target_start_date: e.target.value})} />
                  </div>
                  <div className="col-md-6">
                      <label className="form-label extra-small fw-bold text-muted uppercase">Target End Date</label>
                      <input type="date" className="form-control form-control-sm" value={newWO.target_end_date} onChange={e => setNewWO({...newWO, target_end_date: e.target.value})} />
                  </div>
              </div>

              <div className="row g-2 mb-3">
                  <div className="col-6">
                      <label className="form-label extra-small fw-bold text-muted uppercase">Output Target Location</label>
                      <select className="form-select form-select-sm" value={newWO.location_code} onChange={e => setNewWO({...newWO, location_code: e.target.value})} required>
                          <option value="">Select...</option>
                          {locations.map((loc: any) => <option key={loc.id} value={loc.code}>{loc.name}</option>)}
                      </select>
                  </div>
                  <div className="col-6">
                      <label className="form-label extra-small fw-bold text-muted uppercase">Material Source Location</label>
                      <select className="form-select form-select-sm" value={newWO.source_location_code} onChange={e => setNewWO({...newWO, source_location_code: e.target.value})}>
                          <option value="">Same as Production</option>
                          {locations.map((loc: any) => <option key={loc.id} value={loc.code}>{loc.name}</option>)}
                      </select>
                  </div>
              </div>

              <div className="mb-3 p-2 bg-info bg-opacity-10 border border-info border-opacity-25 rounded">
                  <div className="form-check form-switch">
                      <input 
                          className="form-check-input" 
                          type="checkbox" 
                          id="nested-wo-switch"
                          checked={newWO.create_nested}
                          onChange={e => setNewWO({...newWO, create_nested: e.target.checked})}
                      />
                      <label className="form-check-label small fw-bold text-info-emphasis" htmlFor="nested-wo-switch">
                          <i className="bi bi-diagram-3-fill me-2"></i>
                          Create child Work Orders for all nested BOMs
                      </label>
                  </div>
                  <div className="extra-small text-muted mt-1 ms-4 ps-1">
                      Automatically generate production runs for every sub-assembly in the recipe.
                  </div>
              </div>
          </ModalWrapper>

          <div className="col-12 flex-print-fill">
              <div className="card h-100 border-0 shadow-sm">
                  <div className="card-header bg-white d-flex justify-content-between align-items-center no-print">
                      <div className="d-flex align-items-center gap-3">
                          <h5 className="card-title mb-0">{t('production_schedule')}</h5>
                          <div className="btn-group ms-2">
                              <button className={`btn btn-sm btn-light border ${viewMode === 'calendar' ? 'active' : ''}`} onClick={() => setViewMode('calendar')}><i className="bi bi-calendar-event me-1"></i>Calendar</button>
                              <button className={`btn btn-sm btn-light border ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}><i className="bi bi-list-ul me-1"></i>List</button>
                              <button className={`btn btn-sm btn-light border ${viewMode === 'scanner' ? 'active' : ''}`} onClick={() => setViewMode('scanner')}><i className="bi bi-qr-code-scan me-1"></i>Scanner</button>
                          </div>
                      </div>
                      <div className="d-flex gap-2">
                          <button className="btn btn-success btn-sm text-white" onClick={() => setIsCreateOpen(true)}><i className="bi bi-plus-lg me-1"></i>{t('create')}</button>
                          <button className="btn btn-outline-primary btn-sm btn-print" onClick={handlePrintList}><i className="bi bi-printer me-1"></i>{t('print')}</button>
                      </div>
                  </div>
                  
                  <div className="card-body p-0">
                      {viewMode === 'calendar' ? (
                          <div className="p-3"><CalendarView workOrders={workOrders} items={items} /></div>
                      ) : (
                          <div className="table-responsive">
                                <table className="table table-hover align-middle mb-0">
                                    <thead className="table-light">
                                        <tr style={{fontSize: '9pt'}}>
                                            <th className="ps-4">WO Code</th>
                                            <th>Product / Variant</th>
                                            <th className="text-center">Qty</th>
                                            <th>Target Timeline</th>
                                            <th>Actual Progression</th>
                                            <th>{t('status')}</th>
                                            <th className="text-end pe-4 no-print">{t('actions')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredWorkOrders.map((wo: any) => {
                                            const warning = getDueDateWarning(wo);
                                            const isExpanded = expandedRows[wo.id];
                                            const bom = boms.find((b:any) => b.id === wo.bom_id);

                                            return (
                                                <>
                                                <tr key={wo.id} className={isExpanded ? 'table-primary bg-opacity-10' : ''}>
                                                    <td className="ps-4 fw-bold font-monospace small">{wo.code}</td>
                                                    <td style={{cursor: 'pointer'}} onClick={() => toggleRow(wo.id)}>
                                                        <div className="d-flex align-items-center gap-2">
                                                            <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'} text-muted`}></i>
                                                            <div>
                                                                <div className="fw-bold text-dark" style={{fontSize: '9pt'}}>{wo.item_name || getItemName(wo.item_id)}</div>
                                                                <div className="extra-small text-muted">
                                                                    BOM: {getBOMCode(wo.bom_id)}
                                                                    {wo.sales_order_id && <span className="ms-2 text-primary fw-bold">From SO</span>}
                                                                </div>
                                                                {wo.status === 'PENDING' && wo.is_material_available === false && <span className="badge bg-danger p-1 extra-small mt-1">LOW STOCK</span>}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="text-center fw-bold">{wo.qty}</td>
                                                    <td>
                                                        <div className="extra-small d-flex flex-column gap-1">
                                                            <span>S: {formatDate(wo.target_start_date)}</span>
                                                            <span className={warning ? `text-${warning.type} fw-bold` : ''}>E: {formatDate(wo.target_end_date)}</span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="extra-small d-flex flex-column gap-1 text-muted">
                                                            <span>Start: {formatDateTime(wo.actual_start_date)}</span>
                                                            <span>End: {formatDateTime(wo.actual_end_date)}</span>
                                                        </div>
                                                    </td>
                                                    <td><span className={`badge ${getStatusBadge(wo.status)} extra-small`}>{wo.status}</span></td>
                                                    <td className="text-end pe-4 no-print">
                                                        <div className="d-flex justify-content-end align-items-center gap-2">
                                                            <button className="btn btn-sm btn-link text-primary p-0" onClick={() => handlePrintWO(wo)} title="Print Work Order">
                                                                <i className="bi bi-printer fs-5"></i>
                                                            </button>
                                                            {wo.status === 'PENDING' && <button className="btn btn-sm btn-primary py-0 px-2" style={{fontSize: '0.75rem'}} onClick={() => onUpdateStatus(wo.id, 'IN_PROGRESS')}>START</button>}
                                                            {wo.status === 'IN_PROGRESS' && <button className="btn btn-sm btn-success py-0 px-2" style={{fontSize: '0.75rem'}} onClick={() => onUpdateStatus(wo.id, 'COMPLETED')}>FINISH</button>}
                                                            <button className="btn btn-sm btn-link text-danger p-0" onClick={() => onDeleteWO(wo.id)} title="Delete"><i className="bi bi-trash fs-5"></i></button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr key={`${wo.id}-detail`} className="bg-light">
                                                        <td colSpan={7} className="p-0 border-0">
                                                            <div className="p-4 ps-5 shadow-inner border-bottom">
                                                                <div className="row g-4">
                                                                    {/* Left: Material Readiness */}
                                                                    <div className="col-md-7 border-end">
                                                                        <h6 className="extra-small fw-bold text-uppercase text-muted mb-3 letter-spacing-1">Material Readiness Check</h6>
                                                                        <div className="table-responsive">
                                                                            <table className="table table-sm table-borderless small mb-0">
                                                                                <thead className="border-bottom text-muted">
                                                                                    <tr style={{fontSize: '8pt'}}><th>Component</th><th>Required</th><th>Stock</th><th>Status</th></tr>
                                                                                </thead>
                                                                                <tbody>
                                                                                    {bom?.lines.map((line: any) => {
                                                                                        const req = calculateRequiredQty(wo.qty, line, bom);
                                                                                        const { available, isEnough } = checkStockAvailability(line.item_id, line.source_location_id || wo.source_location_id || wo.location_id, [], req);
                                                                                        return (
                                                                                            <tr key={line.id}>
                                                                                                <td>
                                                                                                    <div className="fw-bold">{line.item_name || getItemName(line.item_id)}</div>
                                                                                                    <div className="extra-small text-muted font-monospace">{line.item_code || getItemCode(line.item_id)}</div>
                                                                                                </td>
                                                                                                <td className="fw-bold">{req.toFixed(2)}</td>
                                                                                                <td className={isEnough ? 'text-success' : 'text-danger'}>{available.toFixed(2)}</td>
                                                                                                <td>{isEnough ? <i className="bi bi-check-circle-fill text-success"></i> : <i className="bi bi-x-circle-fill text-danger"></i>}</td>
                                                                                            </tr>
                                                                                        );
                                                                                    })}
                                                                                </tbody>
                                                                            </table>
                                                                        </div>
                                                                    </div>
                                                                    {/* Right: Production Analytics */}
                                                                    <div className="col-md-5 ps-4">
                                                                        <h6 className="extra-small fw-bold text-uppercase text-muted mb-3 letter-spacing-1">Production Timeline Analysis</h6>
                                                                        <div className="d-flex flex-column gap-3">
                                                                            <div className="p-2 rounded border bg-white shadow-xs">
                                                                                <div className="extra-small text-muted mb-1">Lead Time Variance</div>
                                                                                {wo.actual_start_date && wo.target_start_date ? (
                                                                                    <div className="small fw-bold">
                                                                                        {new Date(wo.actual_start_date) > new Date(wo.target_start_date) ? 
                                                                                            <span className="text-danger">Delayed Start (+{Math.round((new Date(wo.actual_start_date).getTime() - new Date(wo.target_start_date).getTime()) / 3600000)}h)</span> : 
                                                                                            <span className="text-success">On Schedule</span>
                                                                                        }
                                                                                    </div>
                                                                                ) : <span className="small text-muted italic">Waiting for start signal...</span>}
                                                                            </div>
                                                                            <div className="p-2 rounded border bg-white shadow-xs">
                                                                                <div className="extra-small text-muted mb-1">Output Target</div>
                                                                                <div className="small fw-bold">{getLocationName(wo.location_id)}</div>
                                                                            </div>
                                                                            {/* Large Scan-from-screen QR Code */}
                                                                            <div className="mt-2 text-center bg-white p-3 border rounded shadow-sm no-print">
                                                                                <img 
                                                                                    src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${wo.code}`} 
                                                                                    alt="QR" 
                                                                                    style={{ width: '120px', height: '120px' }}
                                                                                />
                                                                                <div className="extra-small text-muted mt-2 font-monospace fw-bold">{wo.code}</div>
                                                                                <div className="extra-small text-info mt-1 uppercase fw-bold" style={{fontSize: '0.6rem'}}>Scan to Start/Finish</div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                                </>
                                            );
                                        })}
                                    </tbody>
                                </table>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      </div>
  );
}
