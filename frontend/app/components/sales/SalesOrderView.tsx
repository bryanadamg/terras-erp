import { useState, useEffect } from 'react';
import CodeConfigModal, { CodeConfig, buildCodeWithCounter } from '../shared/CodeConfigModal';
import { useToast } from '../shared/Toast';
import { useLanguage } from '../../context/LanguageContext';
import SearchableSelect from '../shared/SearchableSelect';
import ModalWrapper from '../shared/ModalWrapper';
import SalesPrintModal from './SalesPrintModal';
import SOTablePrintModal from './SOTablePrintModal';
import { useTheme } from '../../context/ThemeContext';
import { useData } from '../../context/DataContext';

export default function SalesOrderView({ items, attributes, boms, salesOrders, partners, onCreateSO, onDeleteSO, onUpdateSOStatus, onGenerateWO }: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [printingSO, setPrintingSO] = useState<any>(null);
  const [isTablePrintOpen, setIsTablePrintOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const { uiStyle: currentStyle } = useTheme();
  const { companyProfile } = useData();


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


  const [newSO, setNewSO] = useState({
      po_number: '',
      customer_po_ref: '',
      customer_name: '',
      order_date: new Date().toISOString().split('T')[0],
      lines: [] as any[]
  });

  const [newLine, setNewLine] = useState({
      item_id: '', qty: 0, due_date: '', attribute_value_ids: [] as string[],
      ket_stock: '', internal_confirmation_date: '', qty_kg: '', qty2: '', uom2: '',
      bom_size_id: '',
  });
  const [qtyMeter, setQtyMeter] = useState('');
  const [kgAuto, setKgAuto] = useState(true);

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
      let counter = 1;
      let code = buildCodeWithCounter(config, counter);
      while (salesOrders.some((s: any) => s.po_number === code)) {
          counter++;
          code = buildCodeWithCounter(config, counter);
      }
      return code;
  };

  useEffect(() => {
      if (isCreateOpen && !newSO.po_number) {
          setNewSO(prev => ({ ...prev, po_number: suggestSOCode() }));
      }
  }, [isCreateOpen]);

  const handleAddLine = () => {
      if (!newLine.item_id || newLine.qty <= 0) return;
      setNewSO({ ...newSO, lines: [...newSO.lines, { ...newLine, bom_size_id: newLine.bom_size_id || null }] });
      setNewLine({ item_id: '', qty: 0, due_date: '', attribute_value_ids: [], ket_stock: '', internal_confirmation_date: '', qty_kg: '', qty2: '', uom2: '', bom_size_id: '' });
      setQtyMeter('');
      setKgAuto(true);
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

  const getItemWeight = (id: string) => items.find((i: any) => i.id === id)?.weight_per_unit ?? null;
  const getItemWeightUnit = (id: string): string => items.find((i: any) => i.id === id)?.weight_unit ?? '';

  // Only g/y and g/m can auto-calculate KG from a length qty alone.
  // gsm / g/m² require fabric width, so auto-calc is disabled for those.
  const isAutoCalcSupported = (id: string) => {
      const w = getItemWeight(id);
      const unit = getItemWeightUnit(id);
      return !!w && (unit === 'g/y' || unit === 'g/m');
  };

  const calcKgAuto = (id: string, yd: number, m: number): string | null => {
      const w = getItemWeight(id);
      const unit = getItemWeightUnit(id);
      if (!w || yd <= 0) return null;
      if (unit === 'g/y') return String(Math.round(w * yd / 1000 * 1000) / 1000);
      if (unit === 'g/m' && m > 0) return String(Math.round(w * m / 1000 * 1000) / 1000);
      return null;
  };

  const handleLineItemChange = (val: string) => {
      const m = parseFloat(qtyMeter) || 0;
      const kg = kgAuto ? calcKgAuto(val, newLine.qty, m) : null;
      setNewLine({ ...newLine, item_id: val, attribute_value_ids: [], bom_size_id: '', qty_kg: kg !== null ? kg : newLine.qty_kg });
  };

  const getBOMSizesForLine = (itemId: string, attrValueIds: string[]) => {
      if (!boms || !itemId) return [];
      const bom = boms.find((b: any) => {
          if (b.item_id !== itemId) return false;
          const bomAttrs = b.attribute_value_ids || [];
          if (attrValueIds.length !== bomAttrs.length) return false;
          return attrValueIds.every((id: string) => bomAttrs.includes(id));
      });
      return bom?.sizes || [];
  };

  const formatBomSizeLabel = (bs: any): string => {
      const parts: string[] = [];
      const sizeName = bs.size_name || bs.size?.name;
      if (sizeName) parts.push(sizeName);
      if (bs.label) parts.push(bs.label);
      if (bs.target_measurement != null) {
          let meas = `${parseFloat(bs.target_measurement)}`;
          if (bs.measurement_min != null && bs.measurement_max != null) {
              meas += ` (${parseFloat(bs.measurement_min)}–${parseFloat(bs.measurement_max)})`;
          }
          parts.push(meas + ' cm');
      }
      return parts.join(' — ') || `Size ${bs.id.slice(0, 6)}`;
  };

  const getBomSizeLabelById = (bomSizeId: string): string => {
      if (!boms || !bomSizeId) return '';
      for (const bom of boms) {
          const bs = (bom.sizes || []).find((s: any) => s.id === bomSizeId);
          if (bs) return formatBomSizeLabel(bs);
      }
      return '';
  };

  const handleQtyYardChange = (ydStr: string) => {
      const yd = parseFloat(ydStr) || 0;
      const m = yd > 0 ? Math.round(yd * 0.9144 * 100) / 100 : 0;
      setQtyMeter(m > 0 ? String(m) : '');
      const kg = kgAuto ? calcKgAuto(newLine.item_id, yd, m) : null;
      setNewLine({ ...newLine, qty: yd, qty_kg: kg !== null ? kg : newLine.qty_kg });
  };

  const handleQtyMeterChange = (mStr: string) => {
      setQtyMeter(mStr);
      const m = parseFloat(mStr) || 0;
      const yd = m > 0 ? Math.round(m / 0.9144 * 100) / 100 : 0;
      const kg = kgAuto ? calcKgAuto(newLine.item_id, yd, m) : null;
      setNewLine({ ...newLine, qty: yd, qty_kg: kg !== null ? kg : newLine.qty_kg });
  };

  const toggleKgAuto = () => {
      const newAuto = !kgAuto;
      setKgAuto(newAuto);
      if (newAuto) {
          const m = parseFloat(qtyMeter) || 0;
          const kg = calcKgAuto(newLine.item_id, newLine.qty, m);
          if (kg !== null) setNewLine(prev => ({ ...prev, qty_kg: kg }));
      }
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      const payload = {
          ...newSO,
          customer_po_ref: newSO.customer_po_ref || null,
          order_date: newSO.order_date || null,
          lines: newSO.lines.map((line: any) => ({
              ...line,
              due_date: line.due_date || null,
              internal_confirmation_date: line.internal_confirmation_date || null,
              qty_kg: line.qty_kg !== '' ? parseFloat(line.qty_kg) || null : null,
              qty2: line.qty2 !== '' ? parseFloat(line.qty2) || null : null,
          }))
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
          setNewSO({ po_number: '', customer_po_ref: '', customer_name: '', order_date: new Date().toISOString().split('T')[0], lines: [] });
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

  const formatShortDate = (date: string | null | undefined) => {
      if (!date) return '';
      try {
          const d = new Date(date);
          return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
      } catch { return ''; }
  };

  const getAttributeValues = (ids: string[]) =>
      ids.map(vid => {
          for (const attr of attributes) {
              const val = attr.values?.find((v: any) => v.id === vid);
              if (val) return val.value;
          }
          return '';
      }).filter(Boolean).join(', ');

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
  };

  const customers = partners.filter((p: any) => p.type === 'CUSTOMER' && p.active);
  const STATUS_FILTERS = ['ALL', 'PENDING', 'READY', 'SENT', 'DELIVERED'];

  const filteredOrders = salesOrders.filter((so: any) => {
      const matchSearch = !searchTerm ||
          so.po_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
          so.customer_name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === 'ALL' || so.status === statusFilter;
      return matchSearch && matchStatus;
  });



  return (
    <div className="fade-in">
       {/* Table Print Modal */}
       {isTablePrintOpen && (
           <SOTablePrintModal
               salesOrders={filteredOrders}
               onClose={() => setIsTablePrintOpen(false)}
               currentStyle={currentStyle}
               companyProfile={companyProfile}
               items={items}
               attributes={attributes}
               partners={partners}
           />
       )}

       {/* Single SO Print Modal */}
       {printingSO && (
           <SalesPrintModal
               so={printingSO}
               onClose={() => setPrintingSO(null)}
               currentStyle={currentStyle}
               companyProfile={companyProfile}
               items={items}
               attributes={attributes}
               partners={partners}
           />
       )}

       <CodeConfigModal
           isOpen={isConfigOpen}
           onClose={() => setIsConfigOpen(false)}
           type="SO"
           onSave={handleSaveConfig}
           initialConfig={codeConfig}
           attributes={attributes}
       />


       {/* Create SO Modal */}
       <ModalWrapper
           isOpen={isCreateOpen}
           onClose={() => { setIsCreateOpen(false); setNewSO({ po_number: '', customer_po_ref: '', customer_name: '', order_date: new Date().toISOString().split('T')[0], lines: [] }); }}
           title={<><i className="bi bi-cart-plus" style={classic ? {marginRight:6} : {marginRight:8}}></i>Create Sales Order</>}
           variant="primary"
           size="lg"
           footer={classic ? (
               <>
                   <button type="button" style={xpBtn()} onClick={() => setIsCreateOpen(false)}>{t('cancel')}</button>
                   <button type="button" style={newSO.lines.length === 0 ? {...xpBtn(), opacity: 0.5} : xpBtn({background:'linear-gradient(to bottom,#316ac5,#1a4a8a)',borderColor:'#1a3a7a #0a2a5a #0a2a5a #1a3a7a',color:'#ffffff',fontWeight:'bold',padding:'2px 16px'})} onClick={handleSubmit as any} disabled={newSO.lines.length === 0} title={newSO.lines.length === 0 ? 'Add at least one item first' : undefined}><i className="bi bi-floppy" style={{marginRight:4}}></i>{t('save')} Order</button>
               </>
           ) : (
               <>
                   <button type="button" className="btn btn-sm btn-link text-muted" onClick={() => setIsCreateOpen(false)}>{t('cancel')}</button>
                   <button type="button" className="btn btn-sm btn-primary px-4 fw-bold" onClick={handleSubmit as any} disabled={newSO.lines.length === 0} title={newSO.lines.length === 0 ? 'Add at least one item first' : undefined}>{t('save')} Order</button>
               </>
           )}
       >
           <form onSubmit={handleSubmit} id="create-so-form">
               <div className="row g-3 mb-3">
                   <div className="col-md-4">
                       <label style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2} : undefined} className={classic ? '' : 'form-label d-flex justify-content-between align-items-center small text-muted'}>
                           Ref No. (PO#)
                           <i className="bi bi-gear-fill" style={{cursor:'pointer',color:classic?'#555':'',fontSize:classic?'11px':''}} onClick={() => setIsConfigOpen(true)} title="Configure Auto-Suggestion"></i>
                       </label>
                       <input className="form-control" style={classic ? xpInput : undefined} placeholder="Auto-generated" value={newSO.po_number} onChange={e => setNewSO({...newSO, po_number: e.target.value})} required />
                   </div>
                   <div className="col-md-4">
                       <label style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2} : undefined} className={classic ? '' : 'form-label small text-muted'}>Customer PO Ref</label>
                       <input className="form-control" style={classic ? xpInput : undefined} placeholder="Customer's own PO reference" value={newSO.customer_po_ref} onChange={e => setNewSO({...newSO, customer_po_ref: e.target.value})} />
                   </div>
                   <div className="col-md-4">
                       <label style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2} : undefined} className={classic ? '' : 'form-label small text-muted'}>Date</label>
                       <input type="date" className="form-control" style={classic ? {...xpInput,width:'100%',height:'22px'} : undefined} value={newSO.order_date} onChange={e => setNewSO({...newSO, order_date: e.target.value})} required />
                   </div>
                   <div className="col-md-12">
                       <label style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2} : undefined} className={classic ? '' : 'form-label small text-muted'}>Customer</label>
                       <SearchableSelect
                           options={customers.map((c: any) => ({ value: c.name, label: c.name, subLabel: c.address }))}
                           value={newSO.customer_name}
                           onChange={(val) => setNewSO({...newSO, customer_name: val})}
                           placeholder="Select Customer…"
                           required
                       />
                   </div>
               </div>

               {classic
                   ? <div style={{fontFamily:'Tahoma,Arial,sans-serif',fontSize:'10px',fontWeight:'bold',color:'#444',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4,paddingBottom:2,borderBottom:'1px solid #c0bdb5'}}>Order Items</div>
                   : <h6 className="small text-uppercase text-muted fw-bold mb-2">Order Items</h6>
               }
               <div style={{background:classic?'#f5f4ef':'rgba(0,0,0,0.02)',border:classic?'1px solid #b0a898':'1px solid #dee2e6',padding:classic?'6px 8px':'12px',marginBottom:classic?6:12}}>
                   <div className="row g-2 mb-2">
                       {/* Item + Add button */}
                       <div className="col-10">
                           <label style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2} : undefined} className={classic ? '' : 'form-label small text-muted mb-1'}>Item</label>
                           <SearchableSelect
                               options={items.map((item: any) => ({ value: item.id, label: item.name, subLabel: `${item.code}${item.category === 'Sample' ? ' ★' : ''}` }))}
                               value={newLine.item_id}
                               onChange={handleLineItemChange}
                               placeholder="Select Item…"
                           />
                       </div>
                       <div className="col-2 d-flex align-items-end">
                           {classic ? (
                               <button type="button"
                                   style={(!newLine.item_id || newLine.qty <= 0)
                                       ? {...xpBtn(), width:'100%', padding:'2px 6px', opacity: 0.5}
                                       : {...xpBtn({background:'linear-gradient(to bottom,#5ec85e,#2d7a2d)',borderColor:'#1a5e1a #0a3e0a #0a3e0a #1a5e1a',color:'#fff',fontWeight:'bold'}), width:'100%', padding:'2px 6px'}}
                                   onClick={handleAddLine} disabled={!newLine.item_id || newLine.qty <= 0}
                                   title={!newLine.item_id ? 'Select an item first' : newLine.qty <= 0 ? 'Enter Qty (Yd) first' : 'Add line'}
                               >
                                   <i className="bi bi-plus-lg"></i> Add
                               </button>
                           ) : (
                               <button type="button"
                                   className={`w-100 btn btn-sm ${(!newLine.item_id || newLine.qty <= 0) ? 'btn-outline-secondary' : 'btn-success'}`}
                                   onClick={handleAddLine} disabled={!newLine.item_id || newLine.qty <= 0}
                                   title={!newLine.item_id ? 'Select an item first' : newLine.qty <= 0 ? 'Enter Qty (Yd) first' : 'Add line'}
                               >
                                   <i className="bi bi-plus-lg"></i> Add
                               </button>
                           )}
                       </div>

                       {/* Option B: 2-column qty / dates grid */}
                       <div className="col-12">
                           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: classic ? 6 : 10 }}>

                               {/* Left: Qty inputs panel */}
                               <div style={{ background: classic ? '#f8f7f2' : 'rgba(0,0,0,0.02)', border: classic ? '1px solid #c0bdb5' : '1px solid #dee2e6', padding: classic ? '6px 8px' : '10px 12px' }}>

                                   {/* Yard / Meter pair */}
                                   <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginBottom: classic ? 5 : 8 }}>
                                       <div style={{ flex: 1, minWidth: 0 }}>
                                           <label style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2} : undefined} className={classic ? '' : 'form-label small text-muted mb-1'}>Qty (Yd)</label>
                                           <input type="number" className="form-control" style={classic ? {...xpInput, width:'100%'} : undefined} placeholder="0" value={newLine.qty || ''} onChange={e => handleQtyYardChange(e.target.value)} />
                                       </div>
                                       <div style={{ paddingBottom: classic ? 3 : 6, color: '#888', fontSize: 14, flexShrink: 0, userSelect: 'none' as const }}>&#8596;</div>
                                       <div style={{ flex: 1, minWidth: 0 }}>
                                           <label style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2} : undefined} className={classic ? '' : 'form-label small text-muted mb-1'}>Qty (m)</label>
                                           <input type="number" className="form-control" style={classic ? {...xpInput, width:'100%'} : undefined} placeholder="0" value={qtyMeter} onChange={e => handleQtyMeterChange(e.target.value)} />
                                       </div>
                                   </div>

                                   {/* KG with AUTO toggle */}
                                   <div style={{ marginBottom: classic ? 5 : 8 }}>
                                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                                           <label style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000'} : undefined} className={classic ? '' : 'form-label small text-muted mb-0'}>Qty (KG)</label>
                                           {kgAuto ? (
                                               <button type="button" onClick={toggleKgAuto} title="Click to enter manually"
                                                   style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'9px',padding:'1px 6px',background:'linear-gradient(to bottom,#4a9ae8,#1a5ec8)',border:'1px solid',borderColor:'#1a3a8a #0a2a6a #0a2a6a #1a3a8a',color:'#fff',cursor:'pointer',borderRadius:0} : undefined}
                                                   className={classic ? '' : 'badge bg-primary border-0'}
                                               >AUTO</button>
                                           ) : (
                                               <button type="button" onClick={toggleKgAuto} title="Click to restore auto calculation"
                                                   style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'9px',padding:'1px 6px',background:'linear-gradient(to bottom,#ffffff,#d4d0c8)',border:'1px solid',borderColor:'#dfdfdf #808080 #808080 #dfdfdf',color:'#000',cursor:'pointer',borderRadius:0} : undefined}
                                                   className={classic ? '' : 'badge bg-secondary border-0'}
                                               >&larr; Auto</button>
                                           )}
                                       </div>
                                       <input type="number" className="form-control"
                                           style={classic ? {...xpInput, width:'100%', background: (kgAuto && isAutoCalcSupported(newLine.item_id)) ? '#ececec' : '#ffffff'} : undefined}
                                           placeholder="0"
                                           value={newLine.qty_kg}
                                           readOnly={kgAuto && isAutoCalcSupported(newLine.item_id)}
                                           onChange={e => setNewLine({...newLine, qty_kg: e.target.value})}
                                       />
                                       {kgAuto && isAutoCalcSupported(newLine.item_id) && newLine.qty > 0 && (
                                           <div style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'10px', color:'#666', fontStyle:'italic', marginTop:2 }}>
                                               {getItemWeightUnit(newLine.item_id) === 'g/y'
                                                   ? `= ${getItemWeight(newLine.item_id)} g/y × ${newLine.qty} Yd`
                                                   : `= ${getItemWeight(newLine.item_id)} g/m × ${qtyMeter} m`}
                                           </div>
                                       )}
                                   </div>

                                   {/* Qty 3 compound input */}
                                   <div>
                                       <label style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2} : undefined} className={classic ? '' : 'form-label small text-muted mb-1'}>Qty 3</label>
                                       {classic ? (
                                           <div style={{ display: 'flex' }}>
                                               <input type="number" className="form-control"
                                                   style={{ ...xpInput, flex: 1, borderRight: 'none', minWidth: 0 }}
                                                   placeholder="0" value={newLine.qty2} onChange={e => setNewLine({...newLine, qty2: e.target.value})} />
                                               <select
                                                   style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'11px', border:'1px solid #7f9db9', height:'20px', borderRadius:0, padding:'1px 4px', background:'#ffffff', outline:'none', color:'#000', flexShrink: 0 }}
                                                   value={newLine.uom2} onChange={e => setNewLine({...newLine, uom2: e.target.value})}
                                               >
                                                   <option value="">Unit</option>
                                                   {['Pcs','Gross','Roll','Pic','Cone','Bal','Box','Set'].map(u => <option key={u} value={u}>{u}</option>)}
                                               </select>
                                           </div>
                                       ) : (
                                           <div className="input-group input-group-sm">
                                               <input type="number" className="form-control" placeholder="0" value={newLine.qty2} onChange={e => setNewLine({...newLine, qty2: e.target.value})} />
                                               <select className="form-select" style={{ maxWidth: 80 }} value={newLine.uom2} onChange={e => setNewLine({...newLine, uom2: e.target.value})}>
                                                   <option value="">Unit</option>
                                                   {['Pcs','Gross','Roll','Pic','Cone','Bal','Box','Set'].map(u => <option key={u} value={u}>{u}</option>)}
                                               </select>
                                           </div>
                                       )}
                                   </div>
                               </div>

                               {/* Right: Dates + Stock Notes */}
                               <div style={{ display: 'flex', flexDirection: 'column', gap: classic ? 5 : 8 }}>
                                   <div>
                                       <label style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2} : undefined} className={classic ? '' : 'form-label small text-muted mb-1'}>Del. Request</label>
                                       <input type="date" className="form-control" style={classic ? {...xpInput,width:'100%',height:'22px'} : undefined} value={newLine.due_date} onChange={e => setNewLine({...newLine, due_date: e.target.value})} />
                                   </div>
                                   <div>
                                       <label style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2} : undefined} className={classic ? '' : 'form-label small text-muted mb-1'}>Del. Confirmation</label>
                                       <input type="date" className="form-control" style={classic ? {...xpInput,width:'100%',height:'22px'} : undefined} value={newLine.internal_confirmation_date} onChange={e => setNewLine({...newLine, internal_confirmation_date: e.target.value})} />
                                   </div>
                                   <div>
                                       <label style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',color:'#000',display:'block',marginBottom:2} : undefined} className={classic ? '' : 'form-label small text-muted mb-1'}>Stock Notes</label>
                                       <input className="form-control" style={classic ? {...xpInput, width:'100%'} : undefined} placeholder="e.g. 1 IKAT 60 PCS" value={newLine.ket_stock} onChange={e => setNewLine({...newLine, ket_stock: e.target.value})} />
                                   </div>
                               </div>

                           </div>
                       </div>

                       {/* Variants */}
                       {currentBoundAttrs.length > 0 && (
                           <div className="col-12 mt-1">
                               <div style={{background:'#ffffff',border:classic?'1px solid #b0a898':'1px solid #dee2e6',padding:classic?'4px 6px':'8px'}}>
                                   <div style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'10px',fontWeight:'bold',color:'#444',marginBottom:4} : undefined} className={classic ? '' : 'text-muted fw-bold mb-2 small'}>Variants</div>
                                   <div className="row g-2">
                                       {currentBoundAttrs.map((attr: any) => (
                                           <div key={attr.id} className="col-md-4">
                                               <select
                                                   className="form-select form-select-sm"
                                                   style={classic ? {fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',border:'1px solid #7f9db9',height:'22px',borderRadius:0,padding:'1px 4px',background:'#ffffff',outline:'none'} : undefined}
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

                       {/* Size / Measurement */}
                       {(() => {
                           const bomSizes = getBOMSizesForLine(newLine.item_id, newLine.attribute_value_ids);
                           if (!bomSizes.length) return null;
                           return (
                               <div className="col-12 mt-1">
                                   <div style={{background:'#ffffff',border:classic?'1px solid #b0a898':'1px solid #dee2e6',padding:classic?'4px 6px':'8px'}}>
                                       <div style={classic?{fontFamily:'Tahoma,Arial,sans-serif',fontSize:'10px',fontWeight:'bold',color:'#444',marginBottom:4}:undefined} className={classic?'':'text-muted fw-bold mb-2 small'}>Size / Measurement</div>
                                       <select
                                           className="form-select form-select-sm"
                                           style={classic?{fontFamily:'Tahoma,Arial,sans-serif',fontSize:'11px',border:'1px solid #7f9db9',height:'22px',borderRadius:0,padding:'1px 4px',background:'#ffffff',outline:'none',width:'100%'}:undefined}
                                           value={newLine.bom_size_id}
                                           onChange={e => setNewLine({...newLine, bom_size_id: e.target.value})}
                                       >
                                           <option value="">No specific size</option>
                                           {bomSizes.map((bs: any) => (
                                               <option key={bs.id} value={bs.id}>{formatBomSizeLabel(bs)}</option>
                                           ))}
                                       </select>
                                   </div>
                               </div>
                           );
                       })()}
                   </div>
                   <div>
                       {newSO.lines.map((line: any, idx) => (
                           <div key={idx} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:classic?'3px 6px':'8px',background:classic?(idx%2===0?'#ffffff':'#f5f3ee'):'white',border:classic?'1px solid #c0bdb5':'1px solid #dee2e6',marginBottom:2,fontFamily:classic?'Tahoma,Arial,sans-serif':undefined,fontSize:classic?'11px':undefined}}>
                               <div>
                                   <span style={{fontWeight:'bold'}}>{getItemName(line.item_id)}</span>
                                   <span style={{color:classic?'#555':'',marginLeft:8,fontFamily:classic?'Tahoma,Arial,sans-serif':'',fontSize:classic?'10px':''}} className={classic?'':'text-muted ms-2 font-monospace small'}>{getItemCode(line.item_id)}</span>
                                   {isSample(line.item_id) && <span style={{background:'#fff8dc',border:'1px solid #c8a000',color:'#4a3000',padding:'0 4px',fontSize:'9px',fontFamily:classic?'Tahoma,Arial,sans-serif':'',marginLeft:6}} className={classic?'':'badge bg-warning text-dark ms-2'}>Sample</span>}
                                   {line.due_date && <span style={{color:classic?'#666':'',marginLeft:8,fontSize:classic?'10px':''}} className={classic?'':'text-muted ms-2 small'}><i className="bi bi-calendar2" style={{marginRight:3}}></i>{new Date(line.due_date).toLocaleDateString()}</span>}
                                   {(line.attribute_value_ids || []).length > 0 && <div style={{color:classic?'#666':'',fontSize:classic?'10px':'',fontStyle:'italic'}} className={classic?'':'small text-muted fst-italic'}>{(line.attribute_value_ids || []).map(getAttributeValueName).join(', ')}</div>}
                                   {line.bom_size_id && <div style={{color:classic?'#005':'',fontSize:classic?'10px':'',fontWeight:'bold'}} className={classic?'':'small text-primary fw-semibold'}><i className="bi bi-rulers me-1"></i>{getBomSizeLabelById(line.bom_size_id)}</div>}
                               </div>
                               <div style={{display:'flex',alignItems:'center',gap:12}}>
                                   <span style={{fontWeight:'bold'}}>×{line.qty}</span>
                                   <button type="button" style={classic?{...xpBtn(),border:'1px solid transparent',background:'transparent',padding:'1px 5px'}:undefined} className={classic?'':'btn btn-sm btn-link text-danger p-0'} onClick={() => handleRemoveLine(idx)}>
                                       <i className="bi bi-x-circle" style={{color:classic?'#c00000':''}}></i>
                                   </button>
                               </div>
                           </div>
                       ))}
                       {newSO.lines.length === 0 && <div style={{textAlign:'center',padding:classic?'8px':'8px',fontFamily:classic?'Tahoma,Arial,sans-serif':'',fontSize:classic?'11px':'',color:classic?'#888':'',fontStyle:'italic'}} className={classic?'':'text-center text-muted small fst-italic py-2'}>No items added yet</div>}
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
                   <div style={{ display: 'flex', gap: 4 }}>
                       <button style={xpBtn()} onClick={() => setIsTablePrintOpen(true)}>
                           <i className="bi bi-printer" style={{ marginRight: 4 }}></i>Print Table
                       </button>
                       <button
                           style={xpBtn({ background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', fontWeight: 'bold' })}
                           onClick={() => setIsCreateOpen(true)}
                       >
                           <i className="bi bi-plus-lg" style={{ marginRight: 4 }}></i>{t('create')}
                       </button>
                   </div>
               </div>
           ) : (
               <div className="card-header bg-white d-flex justify-content-between align-items-center">
                   <div>
                       <h5 className="card-title mb-0">
                           <i className="bi bi-receipt-cutoff me-2"></i>{t('sales_orders')}
                       </h5>
                       <p className="text-muted small mb-0 mt-1">Manage incoming customer orders</p>
                   </div>
                   <div className="d-flex gap-2">
                       <button className="btn btn-sm btn-outline-secondary btn-print" onClick={() => setIsTablePrintOpen(true)}>
                           <i className="bi bi-printer me-1"></i>Print Table
                       </button>
                       <button className="btn btn-sm btn-primary" onClick={() => setIsCreateOpen(true)}>
                           <i className="bi bi-plus-lg me-2"></i>{t('create')}
                       </button>
                   </div>
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
                               <th style={classic ? { ...xpThCell, width: '130px' } : undefined} className={classic ? '' : 'ps-3'}>PO# / Ref</th>
                               <th style={classic ? { ...xpThCell, width: '180px' } : undefined}>Customer</th>
                               <th style={classic ? { ...xpThCell, width: '72px' } : undefined}>Date</th>
                               <th style={classic ? { ...xpThCell, width: '180px' } : undefined}>Item</th>
                               <th style={classic ? { ...xpThCell, width: '80px' } : undefined}>Size</th>
                               <th style={classic ? { ...xpThCell, width: '140px' } : undefined}>Qty</th>
                               <th style={classic ? { ...xpThCell, width: '80px' } : undefined}>Qty 3</th>
                               <th style={classic ? { ...xpThCell, width: '110px' } : undefined}>Stock Notes</th>
                               <th style={classic ? { ...xpThCell, width: '88px' } : undefined}>Req / Conf</th>
                               <th style={classic ? { ...xpThCell, width: '80px' } : undefined}>Status</th>
                               <th style={classic ? { ...xpThCell, textAlign: 'right' as const, borderRight: 'none', width: '80px' } : undefined} className={classic ? '' : 'text-end pe-3'}>Actions</th>
                           </tr>
                       </thead>
                       <tbody>
                           {filteredOrders.flatMap((so: any, rowIndex: number) => {
                               const rowBg = rowIndex % 2 === 0 ? '#ffffff' : (classic ? '#f5f3ee' : '#fafafa');
                               const soLines: any[] = so.lines;
                               const lineCount = Math.max(soLines.length, 1);

                               const soTd = (extra: React.CSSProperties = {}): React.CSSProperties => classic
                                   ? { ...tdBase, background: rowBg, verticalAlign: 'middle', borderBottom: '1px solid #c0bdb5', ...extra }
                                   : { background: rowBg, verticalAlign: 'middle', padding: '6px 10px', borderBottom: '1px solid #dee2e6', ...extra };

                               const lineTd = (isFirst: boolean, isLast: boolean, extra: React.CSSProperties = {}): React.CSSProperties => classic
                                   ? { ...tdBase, background: rowBg, paddingTop: 3, paddingBottom: 3, fontSize: '10px', borderBottom: isLast ? '1px solid #c0bdb5' : 'none', borderTop: isFirst ? 'none' : '1px dashed #d0cdc8', ...extra }
                                   : { background: rowBg, padding: '3px 10px', fontSize: '0.78rem', borderBottom: isLast ? '1px solid #dee2e6' : 'none', borderTop: isFirst ? 'none' : '1px dashed #e4e4e4', ...extra };

                               const poCellContent = (
                                   <>
                                       <div style={classic ? { fontFamily:"'Courier New',monospace", fontWeight:'bold', color:'#0058e6', fontSize:'11px' } : undefined} className={classic ? '' : 'fw-bold font-monospace text-primary small'}>
                                           {so.po_number}
                                       </div>
                                       {so.customer_po_ref && (
                                           <div style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'10px', color:'#666', marginTop:1 }}>
                                               {so.customer_po_ref}
                                           </div>
                                       )}
                                   </>
                               );

                               const statusCellContent = (
                                   <>
                                       {classic ? (
                                           <span style={getStatusXPStyle(so.status)}>{so.status}</span>
                                       ) : (
                                           <span className={`badge ${getStatusBadge(so.status)}`}>{so.status}</span>
                                       )}
                                       {so.delivered_at && <div className="extra-small text-muted mt-1" style={{ fontSize:'9px' }}>Del: {formatDate(so.delivered_at)}</div>}
                                   </>
                               );

                               const actionsCellContent = (
                                   <div style={classic ? { display:'flex', gap:2, justifyContent:'flex-end', alignItems:'center' } : undefined} className={classic ? '' : 'd-flex justify-content-end align-items-center gap-1'}>
                                       {so.status === 'READY' && (
                                           classic ? (
                                               <button style={xpBtn({ padding:'1px 5px' })} title="Mark as Sent" onClick={() => onUpdateSOStatus(so.id, 'SENT')}>
                                                   <i className="bi bi-send"></i>
                                               </button>
                                           ) : (
                                               <button className="btn btn-sm btn-light border py-0 px-2" style={{fontSize:12}} title="Mark as Sent" onClick={() => onUpdateSOStatus(so.id, 'SENT')}>
                                                   <i className="bi bi-send"></i>
                                               </button>
                                           )
                                       )}
                                       {so.status === 'SENT' && (
                                           classic ? (
                                               <button style={xpBtn({ background:'linear-gradient(to bottom,#5ec85e,#2d7a2d)', borderColor:'#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color:'#fff', padding:'1px 5px' })} title="Mark as Delivered" onClick={() => onUpdateSOStatus(so.id, 'DELIVERED')}>
                                                   <i className="bi bi-check2-all"></i>
                                               </button>
                                           ) : (
                                               <button className="btn btn-sm btn-light border py-0 px-2" style={{fontSize:12}} title="Mark as Delivered" onClick={() => onUpdateSOStatus(so.id, 'DELIVERED')}>
                                                   <i className="bi bi-check2-all"></i>
                                               </button>
                                           )
                                       )}
                                       {classic ? (
                                           <>
                                               <button title="Print" onClick={() => handlePrintSO(so)}
                                                   style={{ background:'none', border:'1px solid transparent', borderRadius:2, cursor:'pointer', padding:'1px 4px', color:'#555', fontSize:'13px' }}
                                                   onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor='#7f9db9'; (e.currentTarget as HTMLButtonElement).style.background='#e8f0f8'; }}
                                                   onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor='transparent'; (e.currentTarget as HTMLButtonElement).style.background='none'; }}>
                                                   <i className="bi bi-printer"></i>
                                               </button>
                                               <button title="Delete" onClick={() => onDeleteSO(so.id)}
                                                   style={{ background:'none', border:'1px solid transparent', borderRadius:2, cursor:'pointer', padding:'1px 4px', color:'#aa0000', fontSize:'13px' }}
                                                   onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor='#cc4444'; (e.currentTarget as HTMLButtonElement).style.background='#fff0f0'; }}
                                                   onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor='transparent'; (e.currentTarget as HTMLButtonElement).style.background='none'; }}>
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
                               );

                               if (soLines.length === 0) {
                                   return [(
                                       <tr key={so.id}>
                                           <td style={soTd()} className={classic ? '' : 'ps-3'}>{poCellContent}</td>
                                           <td style={soTd()}>{so.customer_name}</td>
                                           <td style={soTd({ fontSize:'10px' })} className={classic ? '' : 'small'}>{new Date(so.order_date).toLocaleDateString()}</td>
                                           <td colSpan={6} style={classic ? { ...tdBase, background:rowBg, borderBottom:'1px solid #c0bdb5', color:'#aaa', fontStyle:'italic', fontSize:'10px' } : { background:rowBg, padding:'6px 10px', borderBottom:'1px solid #dee2e6', color:'#aaa', fontStyle:'italic', fontSize:'0.78rem' }}>No lines</td>
                                           <td style={soTd()}>{statusCellContent}</td>
                                           <td style={soTd({ textAlign:'right' as const, borderRight:'none' })} className={classic ? '' : 'pe-3 text-end'}>{actionsCellContent}</td>
                                       </tr>
                                   )];
                               }

                               return soLines.map((line: any, li: number) => {
                                   const isFirst = li === 0;
                                   const isLast = li === soLines.length - 1;
                                   return (
                                       <tr key={`${so.id}-${li}`}>
                                           {isFirst && (
                                               <>
                                                   <td rowSpan={lineCount} style={soTd()} className={classic ? '' : 'ps-3'}>{poCellContent}</td>
                                                   <td rowSpan={lineCount} style={soTd()}>{so.customer_name}</td>
                                                   <td rowSpan={lineCount} style={soTd({ fontSize:'10px' })} className={classic ? '' : 'small'}>{new Date(so.order_date).toLocaleDateString()}</td>
                                               </>
                                           )}

                                           {/* Item */}
                                           <td style={lineTd(isFirst, isLast)}>
                                               <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:6 }}>
                                                   <div style={{ flex:1, minWidth:0 }}>
                                                       <div style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'10px', fontWeight:'bold', lineHeight:1.3 }} className={classic ? '' : 'fw-semibold'}>
                                                           {getItemName(line.item_id)}
                                                           {isSample(line.item_id) && <i className="bi bi-star-fill text-warning ms-1" style={{fontSize:'0.6rem'}}></i>}
                                                       </div>
                                                       {(line.attribute_value_ids || []).length > 0 && (
                                                           <div style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'9px', color:'#666', fontStyle:'italic' }}>
                                                               {getAttributeValues(line.attribute_value_ids)}
                                                           </div>
                                                       )}
                                                   </div>
                                                   {so.status === 'PENDING' && (
                                                       classic ? (
                                                           <button title="Create Manufacturing Order" onClick={() => onGenerateWO(so, line)}
                                                               style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'9px', padding:'1px 5px', cursor:'pointer', whiteSpace:'nowrap' as const, background:'linear-gradient(to bottom,#5a9ae0,#0058e6)', border:'1px solid', borderColor:'#003080 #001840 #001840 #003080', color:'#fff', fontWeight:'bold', flexShrink:0 }}>
                                                               <i className="bi bi-gear-wide-connected" style={{ marginRight:2 }}></i>MO
                                                           </button>
                                                       ) : (
                                                           <button className="btn btn-sm btn-primary py-0 px-2" style={{ fontSize:10, whiteSpace:'nowrap', flexShrink:0 }} title="Create Manufacturing Order" onClick={() => onGenerateWO(so, line)}>
                                                               <i className="bi bi-gear-wide-connected me-1"></i>MO
                                                           </button>
                                                       )
                                                   )}
                                               </div>
                                           </td>

                                           {/* Size */}
                                           <td style={lineTd(isFirst, isLast)}>
                                               {line.bom_size_id ? (
                                                   <div style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'10px', fontWeight:'bold', color: classic?'#005':'#0d6efd' }}>
                                                       <i className="bi bi-rulers me-1"></i>{getBomSizeLabelById(line.bom_size_id)}
                                                   </div>
                                               ) : (
                                                   <span style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'9px', color:'#ccc' }}>—</span>
                                               )}
                                           </td>

                                           {/* Qty */}
                                           <td style={lineTd(isFirst, isLast)}>
                                               <div style={{ display:'flex', flexWrap:'nowrap' as const, gap:3, alignItems:'center' }}>
                                                   <span style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'9px', fontWeight:'bold', color: classic?'#003ea6':'#fff', background: classic?'#dce8ff':'#0d6efd', border: classic?'1px solid #9ab0e0':'none', padding:'1px 5px', borderRadius: classic?0:3 }}>{line.qty} Yd</span>
                                                   <span style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'9px', color: classic?'#444':'#555', background: classic?'#efefef':'#f0f0f0', border: classic?'1px solid #c0bdb5':'1px solid #ddd', padding:'1px 5px', borderRadius: classic?0:3 }}>{Math.round(line.qty * 0.9144 * 100) / 100} m</span>
                                                   {line.qty_kg != null && line.qty_kg !== '' && (
                                                       <span style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'9px', color: classic?'#1a5e1a':'#166534', background: classic?'#e4f5e4':'#dcfce7', border: classic?'1px solid #90c090':'1px solid #86efac', padding:'1px 5px', borderRadius: classic?0:3 }}>{line.qty_kg} KG</span>
                                                   )}
                                               </div>
                                           </td>

                                           {/* Qty 3 */}
                                           <td style={lineTd(isFirst, isLast)}>
                                               {line.qty2 != null && line.qty2 !== '' && line.uom2 ? (
                                                   <div style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'10px', color: classic?'#444':'' }}>{line.qty2} {line.uom2}</div>
                                               ) : (
                                                   <span style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'9px', color:'#ccc' }}>—</span>
                                               )}
                                           </td>

                                           {/* Stock Notes */}
                                           <td style={lineTd(isFirst, isLast)}>
                                               {line.ket_stock ? (
                                                   <div style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'9px', color: classic?'#555':'#666', fontStyle:'italic' }}>{line.ket_stock}</div>
                                               ) : (
                                                   <span style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'9px', color:'#ccc' }}>—</span>
                                               )}
                                           </td>

                                           {/* Req / Conf */}
                                           <td style={lineTd(isFirst, isLast)}>
                                               {line.due_date ? (
                                                   <div style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'9px', color: classic?'#555':'' }}>
                                                       <span style={{ color:'#999' }}>Req</span> {formatShortDate(line.due_date)}
                                                   </div>
                                               ) : null}
                                               {line.internal_confirmation_date ? (
                                                   <div style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'9px', color: classic?'#555':'' }}>
                                                       <span style={{ color:'#999' }}>Conf</span> {formatShortDate(line.internal_confirmation_date)}
                                                   </div>
                                               ) : null}
                                               {!line.due_date && !line.internal_confirmation_date && (
                                                   <span style={{ fontFamily:'Tahoma,Arial,sans-serif', fontSize:'9px', color:'#ccc' }}>—</span>
                                               )}
                                           </td>

                                           {isFirst && (
                                               <>
                                                   <td rowSpan={lineCount} style={soTd()}>{statusCellContent}</td>
                                                   <td rowSpan={lineCount} style={soTd({ textAlign:'right' as const, borderRight:'none' })} className={classic ? '' : 'pe-3 text-end'}>{actionsCellContent}</td>
                                               </>
                                           )}
                                       </tr>
                                   );
                               });
                           })}
                           {filteredOrders.length === 0 && (
                               <tr>
                                   <td
                                       colSpan={11}
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
