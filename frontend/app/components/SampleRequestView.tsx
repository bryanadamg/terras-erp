import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from '../context/ThemeContext';
import { useToast } from './Toast';
import { useLanguage } from '../context/LanguageContext';
import { useData } from '../context/DataContext';
import CodeConfigModal, { CodeConfig, buildCodeWithCounter } from './CodeConfigModal';
import SearchableSelect from './SearchableSelect';
import HistoryPane from './HistoryPane';
import ModalWrapper from './ModalWrapper';
import SamplePrintModal from './SamplePrintModal';

export default function SampleRequestView({ samples, customers, onCreateSample, onUpdateStatus, onUpdateColorStatus, onDeleteSample }: any) {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { companyProfile, attributes } = useData();
  const colorOptions = useMemo(() => {
    const colorsAttr = (attributes as any[]).find((a: any) => a.is_system);
    return (colorsAttr?.values ?? []).map((v: any) => ({ value: v.value, label: v.value }));
  }, [attributes]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [printSample, setPrintSample] = useState<any>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [historyEntityId, setHistoryEntityId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
      setExpandedIds(prev => {
          const next = new Set(prev);
          next.has(id) ? next.delete(id) : next.add(id);
          return next;
      });
  const [pendingColorName, setPendingColorName] = useState('');
  const [pendingColorIsRepeat, setPendingColorIsRepeat] = useState(false);
  const { uiStyle: currentStyle } = useTheme();
  const classic = currentStyle === 'classic';

  // Auto-expand and scroll to highlighted sample from ?highlight= param
  const highlightId = searchParams?.get('highlight');
  useEffect(() => {
      if (!highlightId || !samples?.length) return;
      setExpandedIds(prev => { const next = new Set(prev); next.add(highlightId); return next; });
      setTimeout(() => {
          highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
  }, [highlightId, samples?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── XP group box styles (create modal) ──────────────────────────────────
  const xpGroupBox: React.CSSProperties = {
      border: '1px solid #c0bdb5',
      boxShadow: 'inset 1px 1px 0 #fff, 1px 1px 0 #c0bdb5',
      marginBottom: 10,
  };
  const xpGroupHeader: React.CSSProperties = {
      background: 'linear-gradient(to right, #3a6fc4 0%, #6a9fd8 60%, #a8c8f0 100%)',
      color: '#fff',
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '10px',
      fontWeight: 'bold',
      padding: '3px 8px',
      letterSpacing: '0.5px',
      textTransform: 'uppercase' as const,
  };
  const xpGroupBody: React.CSSProperties = {
      background: '#fff',
      padding: '10px 10px 8px',
  };
  const xpLbl: React.CSSProperties = {
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '11px',
      color: '#000',
      display: 'block',
      marginBottom: 2,
  };

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

  const today = new Date().toISOString().split('T')[0];
  const emptyForm = () => ({
      code: '',
      request_date: today,
      customer_id: '',
      project: '',
      customer_article_code: '',
      internal_article_code: '',
      width: '',
      colors: [] as { name: string; is_repeat: boolean }[],
      main_material: '',
      middle_material: '',
      bottom_material: '',
      weft: '',
      warp: '',
      original_weight: '',
      original_weight_unit: 'g/y',
      production_weight: '',
      production_weight_unit: 'g/y',
      additional_info: '',
      quantity: '',
      sample_size: '',
      estimated_completion_date: '',
      completion_description: '',
  });
  const [newSample, setNewSample] = useState(emptyForm());

  const removeColorRow = (idx: number) =>
      setNewSample(prev => ({ ...prev, colors: prev.colors.filter((_, i) => i !== idx) }));

  const addPendingColor = () => {
      if (!pendingColorName.trim()) return;
      setNewSample(prev => ({ ...prev, colors: [...prev.colors, { name: pendingColorName.trim(), is_repeat: pendingColorIsRepeat }] }));
      setPendingColorName('');
  };

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
      let counter = 1;
      let code = buildCodeWithCounter(config, counter);
      while (samples.some((s: any) => s.code === code)) {
          counter++;
          code = buildCodeWithCounter(config, counter);
      }
      return code;
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
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + window.scrollY + 2, left: rect.right + window.scrollX - 180 });
      setOpenDropdownId(id);
  };

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      onCreateSample({
          ...newSample,
          customer_id: newSample.customer_id || null,
          original_weight: newSample.original_weight !== '' ? parseFloat(newSample.original_weight) : null,
          original_weight_unit: newSample.original_weight !== '' ? newSample.original_weight_unit : null,
          production_weight: newSample.production_weight !== '' ? parseFloat(newSample.production_weight) : null,
          production_weight_unit: newSample.production_weight !== '' ? newSample.production_weight_unit : null,
          estimated_completion_date: newSample.estimated_completion_date || null,
          colors: newSample.colors.filter(c => c.name.trim() !== ''),
      });
      setNewSample(emptyForm());
      setPendingColorName('');
      setPendingColorIsRepeat(false);
      setIsCreateOpen(false);
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
          APPROVED:      { bg: '#d4edda', border: '#27713a', color: '#0c3a1a' },
          REJECTED:      { bg: '#f8d7da', border: '#a01a1a', color: '#4a0000' },
          SENT:          { bg: '#dce4f5', border: '#3a5faa', color: '#0d2a6e' },
          IN_PRODUCTION: { bg: '#fff3cd', border: '#b8860b', color: '#3e2000' },
      };
      const s = map[status] || { bg: '#e8e8e8', border: '#7a7a7a', color: '#111' };
      return {
          background: s.bg, border: `1px solid ${s.border}`, color: s.color,
          padding: '1px 5px', fontSize: '9px', fontFamily: 'Tahoma, Arial, sans-serif',
          fontWeight: 'bold', whiteSpace: 'nowrap' as const,
      };
  };

  const getColorStatusStyle = (status: string): React.CSSProperties => {
      const map: Record<string, { bg: string; border: string; color: string }> = {
          APPROVED:      { bg: '#d4edda', border: '#27713a', color: '#0c3a1a' },
          REJECTED:      { bg: '#f8d7da', border: '#a01a1a', color: '#4a0000' },
          IN_PRODUCTION: { bg: '#fff3cd', border: '#b8860b', color: '#3e2000' },
          PENDING:       { bg: '#e8e8e8', border: '#7a7a7a', color: '#111' },
      };
      const s = map[status] || map['PENDING'];
      return {
          background: s.bg, border: `1px solid ${s.border}`, color: s.color,
          padding: '1px 5px', fontSize: '9px', fontFamily: 'Tahoma, Arial, sans-serif',
          fontWeight: 'bold', whiteSpace: 'nowrap' as const,
      };
  };

  const getColorStatusBadgeClass = (status: string) => {
      const map: Record<string, string> = {
          APPROVED: 'bg-success',
          REJECTED: 'bg-danger',
          IN_PRODUCTION: 'bg-warning text-dark',
          PENDING: 'bg-secondary',
      };
      return map[status] || 'bg-secondary';
  };

  // ── Color panel inner-table styles ──────────────────────────────────────────
  const colorThCell: React.CSSProperties = {
      background: 'linear-gradient(to bottom, #f0ede8, #e4e1da)',
      borderBottom: '1px solid #b0a898',
      borderRight: '1px solid #ccc',
      fontSize: '9px',
      fontWeight: 'bold',
      color: '#111',
      padding: '2px 6px',
      textAlign: 'left' as const,
      whiteSpace: 'nowrap' as const,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.3px',
      fontFamily: 'Tahoma, Arial, sans-serif',
  };

  const colorTdCell: React.CSSProperties = {
      padding: '3px 6px',
      borderBottom: '1px solid #e8e5e0',
      borderRight: '1px solid #e0ddd8',
      fontSize: '11px',
      verticalAlign: 'middle' as const,
      fontFamily: 'Tahoma, Arial, sans-serif',
  };

  const cbBase: React.CSSProperties = {
      fontFamily: 'Tahoma, Arial, sans-serif',
      fontSize: '10px',
      padding: '1px 7px',
      cursor: 'pointer',
      borderRadius: 0,
      whiteSpace: 'nowrap' as const,
      border: '1px solid',
  };
  const cbInprod = (active: boolean): React.CSSProperties => ({
      ...cbBase,
      background: active ? 'linear-gradient(to bottom, #ffe082, #c77800)' : 'linear-gradient(to bottom, #f5f5f5, #e0dfd8)',
      borderColor: active ? '#a06000 #603000 #603000 #a06000' : '#d0cfc8 #a0a09a #a0a09a #d0cfc8',
      color: active ? '#3e2000' : '#666',
      fontWeight: active ? 'bold' : 'normal',
      borderRight: 'none',
  });
  const cbApprove = (active: boolean): React.CSSProperties => ({
      ...cbBase,
      background: active ? 'linear-gradient(to bottom, #4cae4c, #2d7a2d)' : 'linear-gradient(to bottom, #f5f5f5, #e0dfd8)',
      borderColor: active ? '#1b5e20 #0a3e0a #0a3e0a #1b5e20' : '#d0cfc8 #a0a09a #a0a09a #d0cfc8',
      color: active ? '#fff' : '#666',
      fontWeight: active ? 'bold' : 'normal',
      borderRight: 'none',
  });
  const cbReject = (active: boolean): React.CSSProperties => ({
      ...cbBase,
      background: active ? 'linear-gradient(to bottom, #d32f2f, #8b0000)' : 'linear-gradient(to bottom, #f5f5f5, #e0dfd8)',
      borderColor: active ? '#7f0000 #4a0000 #4a0000 #7f0000' : '#d0cfc8 #a0a09a #a0a09a #d0cfc8',
      color: active ? '#fff' : '#666',
      fontWeight: active ? 'bold' : 'normal',
  });

  // Left-border + row background for each color status
  const colorRowStyle = (status: string): { borderLeftColor: string; background: string } => {
      const map: Record<string, { borderLeftColor: string; background: string }> = {
          PENDING:       { borderLeftColor: '#9e9e9e', background: '#fdfdfd' },
          IN_PRODUCTION: { borderLeftColor: '#c77800', background: '#fffdf8' },
          APPROVED:      { borderLeftColor: '#27713a', background: '#f8fff8' },
          REJECTED:      { borderLeftColor: '#a01a1a', background: '#fff8f8' },
      };
      return map[status] || map['PENDING'];
  };

  // Approved fraction numerator color: grey (0) → XP blue (partial) → green (complete)
  const fracNumColor = (approved: number, total: number): string => {
      if (total === 0) return '#777';
      if (approved === 0) return '#777';
      if (approved === total) return '#1a6e1a';
      return '#0047c8';
  };

  const createItemFromColor = (sample: any, color: any) => {
      const suggestedCode = encodeURIComponent(`${sample.code}-${color.name}`);
      router.push(
          `/inventory?source_sample_id=${sample.id}&source_color_id=${color.id}` +
          `&suggested_code=${suggestedCode}` +
          `&source_sample_code=${encodeURIComponent(sample.code)}` +
          `&source_color_name=${encodeURIComponent(color.name)}`
      );
  };

  const getCustomerName = (id: string) => (customers || []).find((c: any) => c.id === id)?.name || '—';

  const STATUS_FILTERS = ['ALL', 'IN_PRODUCTION', 'SENT', 'APPROVED', 'REJECTED'];

  const filteredSamples = samples.filter((s: any) => {
      const matchSearch = !searchTerm ||
          s.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (s.project && s.project.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (s.customer_article_code && s.customer_article_code.toLowerCase().includes(searchTerm.toLowerCase()));
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
           attributes={[]}
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

               {/* ══ ① Identity ══ */}
               {classic ? (
                   <div style={xpGroupBox}>
                       <div style={xpGroupHeader}>① Identity</div>
                       <div style={xpGroupBody}>
                           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                               <div>
                                   <label style={{ ...xpLbl, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                       <span>Request Code <span style={{ fontWeight: 'normal', color: '#a00' }}>*</span></span>
                                       <i className="bi bi-gear-fill" style={{ cursor: 'pointer', color: '#555', fontSize: 10 }} onClick={() => setIsConfigOpen(true)} title="Configure Auto-Suggestion" />
                                   </label>
                                   <input style={{ ...xpInput, width: '100%', boxSizing: 'border-box' as const }}
                                          value={newSample.code} onChange={e => setNewSample({ ...newSample, code: e.target.value })}
                                          placeholder="Auto-generated" required />
                               </div>
                               <div>
                                   <label style={xpLbl}>Request Date <span style={{ fontWeight: 'normal', color: '#a00' }}>*</span></label>
                                   <input type="date" style={{ ...xpInput, width: '100%', boxSizing: 'border-box' as const }}
                                          value={newSample.request_date} onChange={e => setNewSample({ ...newSample, request_date: e.target.value })} required />
                               </div>
                               <div style={{ gridColumn: '1 / -1' }}>
                                   <label style={xpLbl}>Customer <span style={{ fontWeight: 'normal', color: '#888' }}>(Optional)</span></label>
                                   <SearchableSelect
                                       options={[{ value: '', label: 'No Customer (Internal/Prototype)' }, ...(customers || []).map((c: any) => ({ value: c.id, label: c.name }))]}
                                       value={newSample.customer_id}
                                       onChange={(val: string) => setNewSample({ ...newSample, customer_id: val })}
                                       placeholder="Select Customer (Optional)…"
                                   />
                               </div>
                               <div>
                                   <label style={xpLbl}>Project</label>
                                   <input style={{ ...xpInput, width: '100%', boxSizing: 'border-box' as const }}
                                          value={newSample.project} onChange={e => setNewSample({ ...newSample, project: e.target.value })}
                                          placeholder="e.g. Spring 2026" />
                               </div>
                               <div>
                                   <label style={xpLbl}>Customer Article Code</label>
                                   <input style={{ ...xpInput, width: '100%', boxSizing: 'border-box' as const }}
                                          value={newSample.customer_article_code} onChange={e => setNewSample({ ...newSample, customer_article_code: e.target.value })}
                                          placeholder="Customer's ref code" />
                               </div>
                               <div style={{ gridColumn: '1 / -1' }}>
                                   <label style={xpLbl}>Internal Article Code</label>
                                   <input style={{ ...xpInput, width: '100%', boxSizing: 'border-box' as const }}
                                          value={newSample.internal_article_code} onChange={e => setNewSample({ ...newSample, internal_article_code: e.target.value })}
                                          placeholder="Bola Intan ref code" />
                               </div>
                           </div>
                       </div>
                   </div>
               ) : (
                   <div className="card border-0 mb-3">
                       <div className="card-header py-1 px-2 text-white small fw-bold" style={{ background: 'linear-gradient(to right, #2a5fbe, #4a8fd8)' }}>① Identity</div>
                       <div className="card-body p-2">
                           <div className="row g-2">
                               <div className="col-md-6">
                                   <label className="form-label d-flex justify-content-between align-items-center small text-muted">
                                       Request Code <i className="bi bi-gear-fill text-muted" style={{ cursor: 'pointer' }} onClick={() => setIsConfigOpen(true)} title="Configure Auto-Suggestion" />
                                   </label>
                                   <input className="form-control form-control-sm" value={newSample.code} onChange={e => setNewSample({ ...newSample, code: e.target.value })} placeholder="Auto-generated" required />
                               </div>
                               <div className="col-md-6">
                                   <label className="form-label small text-muted">Request Date</label>
                                   <input type="date" className="form-control form-control-sm" value={newSample.request_date} onChange={e => setNewSample({ ...newSample, request_date: e.target.value })} required />
                               </div>
                               <div className="col-12">
                                   <label className="form-label small text-muted">Customer <span className="fw-normal">(Optional)</span></label>
                                   <SearchableSelect
                                       options={[{ value: '', label: 'No Customer (Internal/Prototype)' }, ...(customers || []).map((c: any) => ({ value: c.id, label: c.name }))]}
                                       value={newSample.customer_id}
                                       onChange={(val: string) => setNewSample({ ...newSample, customer_id: val })}
                                       placeholder="Select Customer (Optional)…"
                                   />
                               </div>
                               <div className="col-md-6">
                                   <label className="form-label small text-muted">Project</label>
                                   <input className="form-control form-control-sm" value={newSample.project} onChange={e => setNewSample({ ...newSample, project: e.target.value })} placeholder="e.g. Spring 2026" />
                               </div>
                               <div className="col-md-6">
                                   <label className="form-label small text-muted">Customer Article Code</label>
                                   <input className="form-control form-control-sm" value={newSample.customer_article_code} onChange={e => setNewSample({ ...newSample, customer_article_code: e.target.value })} placeholder="Customer's ref code" />
                               </div>
                               <div className="col-12">
                                   <label className="form-label small text-muted">Internal Article Code</label>
                                   <input className="form-control form-control-sm" value={newSample.internal_article_code} onChange={e => setNewSample({ ...newSample, internal_article_code: e.target.value })} placeholder="Bola Intan ref code" />
                               </div>
                           </div>
                       </div>
                   </div>
               )}

               {/* ══ ② Colors & Specs ══ */}
               {classic ? (
                   <div style={xpGroupBox}>
                       <div style={xpGroupHeader}>② Colors &amp; Specs</div>
                       <div style={xpGroupBody}>
                           <div style={{ marginBottom: 10 }}>
                               <label style={xpLbl}>Width</label>
                               <input style={{ ...xpInput, width: 130 }}
                                      value={newSample.width} onChange={e => setNewSample({ ...newSample, width: e.target.value })}
                                      placeholder="e.g. 8 mm" />
                           </div>
                           <label style={xpLbl}>Colors</label>
                           <div style={{
                               background: '#f5f9ff', border: '1px solid #b0c8e8', minHeight: 40,
                               padding: '6px 8px', marginBottom: 6,
                               display: 'flex', flexWrap: 'wrap' as const, alignContent: 'flex-start' as const,
                           }}>
                               {newSample.colors.length === 0
                                   ? <span style={{ fontFamily: 'Tahoma', fontSize: 11, color: '#999', fontStyle: 'italic' }}>No colors added yet…</span>
                                   : newSample.colors.map((c, idx) => (
                                       <span key={idx} style={{
                                           display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px',
                                           marginRight: 4, marginBottom: 4,
                                           background: c.is_repeat ? '#dce8f8' : '#e8f4e8',
                                           border: `1px solid ${c.is_repeat ? '#7ab0d8' : '#7aba7a'}`,
                                           fontFamily: 'Tahoma, Arial, sans-serif', fontSize: 11,
                                       }}>
                                           <span style={{ fontSize: 9, fontWeight: 'bold', color: c.is_repeat ? '#0047c8' : '#228b22', textTransform: 'uppercase' as const }}>
                                               {c.is_repeat ? 'RPT' : 'NEW'}
                                           </span>
                                           {c.name}
                                           <span onClick={() => removeColorRow(idx)} style={{ cursor: 'pointer', color: '#a00', marginLeft: 2, fontWeight: 'bold', fontSize: 12, lineHeight: 1 }} title="Remove">×</span>
                                       </span>
                                   ))
                               }
                           </div>
                           <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                               <div style={{ flex: 1 }}>
                                   <SearchableSelect
                                       options={colorOptions}
                                       value={pendingColorName}
                                       onChange={setPendingColorName}
                                       placeholder="Select color…"
                                   />
                               </div>
                               <button
                                   type="button"
                                   style={pendingColorIsRepeat
                                       ? xpBtn({ background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)', color: '#fff', borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a', minWidth: 52 })
                                       : xpBtn({ minWidth: 52 })}
                                   onClick={() => setPendingColorIsRepeat(!pendingColorIsRepeat)}
                                   title="Toggle New / Repeat">
                                   {pendingColorIsRepeat ? 'Repeat' : 'New'}
                               </button>
                               <button type="button" style={xpBtn()} onClick={addPendingColor}>
                                   <i className="bi bi-plus-lg" /> Add Color
                               </button>
                           </div>
                       </div>
                   </div>
               ) : (
                   <div className="card border-0 mb-3">
                       <div className="card-header py-1 px-2 text-white small fw-bold" style={{ background: 'linear-gradient(to right, #2a5fbe, #4a8fd8)' }}>② Colors &amp; Specs</div>
                       <div className="card-body p-2">
                           <div className="mb-2">
                               <label className="form-label small text-muted">Width</label>
                               <input className="form-control form-control-sm" style={{ maxWidth: 160 }} value={newSample.width} onChange={e => setNewSample({ ...newSample, width: e.target.value })} placeholder="e.g. 8 mm" />
                           </div>
                           <label className="form-label small text-muted mb-1">Colors</label>
                           <div className="p-2 mb-2 d-flex flex-wrap" style={{ background: '#f0f5ff', border: '1px solid #c8d8f0', minHeight: 40 }}>
                               {newSample.colors.length === 0
                                   ? <span className="text-muted fst-italic small">No colors added yet…</span>
                                   : newSample.colors.map((c, idx) => (
                                       <span key={idx} className={`badge me-1 mb-1 d-inline-flex align-items-center gap-1 ${c.is_repeat ? 'bg-primary' : 'bg-success'}`} style={{ fontSize: 11, fontWeight: 'normal' }}>
                                           <small className="fw-bold">{c.is_repeat ? 'RPT' : 'NEW'}</small>
                                           {c.name}
                                           <span onClick={() => removeColorRow(idx)} style={{ cursor: 'pointer', marginLeft: 2 }} title="Remove">×</span>
                                       </span>
                                   ))
                               }
                           </div>
                           <div className="d-flex gap-2 align-items-center">
                               <div className="flex-grow-1">
                                   <SearchableSelect
                                       options={colorOptions}
                                       value={pendingColorName}
                                       onChange={setPendingColorName}
                                       placeholder="Select color…"
                                   />
                               </div>
                               <button type="button" className={`btn btn-sm ${pendingColorIsRepeat ? 'btn-primary' : 'btn-outline-secondary'}`} style={{ minWidth: 60 }} onClick={() => setPendingColorIsRepeat(!pendingColorIsRepeat)}>
                                   {pendingColorIsRepeat ? 'Repeat' : 'New'}
                               </button>
                               <button type="button" className="btn btn-sm btn-outline-secondary" onClick={addPendingColor}>
                                   <i className="bi bi-plus-lg me-1" />Add Color
                               </button>
                           </div>
                       </div>
                   </div>
               )}

               {/* ══ ③ Materials ══ */}
               {classic ? (
                   <div style={xpGroupBox}>
                       <div style={xpGroupHeader}>③ Materials</div>
                       <div style={xpGroupBody}>
                           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 12px', marginBottom: 8 }}>
                               {[
                                   { key: 'main_material', label: 'Main Material', placeholder: 'e.g. NILON' },
                                   { key: 'middle_material', label: 'Middle Material', placeholder: '' },
                                   { key: 'bottom_material', label: 'Bottom Material', placeholder: '' },
                               ].map(({ key, label, placeholder }) => (
                                   <div key={key}>
                                       <label style={xpLbl}>{label}</label>
                                       <input style={{ ...xpInput, width: '100%', boxSizing: 'border-box' as const }}
                                              value={(newSample as any)[key]} onChange={e => setNewSample({ ...newSample, [key]: e.target.value })}
                                              placeholder={placeholder} />
                                   </div>
                               ))}
                           </div>
                           <hr style={{ border: 'none', borderTop: '1px solid #d0cdc8', margin: '4px 0 8px' }} />
                           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                               <div>
                                   <label style={xpLbl}>Weft</label>
                                   <input style={{ ...xpInput, width: '100%', boxSizing: 'border-box' as const }}
                                          value={newSample.weft} onChange={e => setNewSample({ ...newSample, weft: e.target.value })}
                                          placeholder="e.g. NILON" />
                               </div>
                               <div>
                                   <label style={xpLbl}>Warp</label>
                                   <input style={{ ...xpInput, width: '100%', boxSizing: 'border-box' as const }}
                                          value={newSample.warp} onChange={e => setNewSample({ ...newSample, warp: e.target.value })}
                                          placeholder="e.g. SPANDEX" />
                               </div>
                               <div>
                                   <label style={xpLbl}>Original Weight</label>
                                   <div style={{ display: 'flex', gap: 2 }}>
                                       <input type="number" step="0.01" style={{ ...xpInput, flex: 1, minWidth: 0 }}
                                              value={newSample.original_weight} onChange={e => setNewSample({ ...newSample, original_weight: e.target.value })}
                                              placeholder="0.00" />
                                       <select style={{ ...xpInput, width: 68, padding: '0 2px' }}
                                               value={newSample.original_weight_unit} onChange={e => setNewSample({ ...newSample, original_weight_unit: e.target.value })}>
                                           <option value="g/y">g/y</option>
                                           <option value="gsm">gsm</option>
                                           <option value="g/m²">g/m²</option>
                                           <option value="oz/yd²">oz/yd²</option>
                                       </select>
                                   </div>
                               </div>
                               <div>
                                   <label style={xpLbl}>Production Weight</label>
                                   <div style={{ display: 'flex', gap: 2 }}>
                                       <input type="number" step="0.01" style={{ ...xpInput, flex: 1, minWidth: 0 }}
                                              value={newSample.production_weight} onChange={e => setNewSample({ ...newSample, production_weight: e.target.value })}
                                              placeholder="0.00" />
                                       <select style={{ ...xpInput, width: 68, padding: '0 2px' }}
                                               value={newSample.production_weight_unit} onChange={e => setNewSample({ ...newSample, production_weight_unit: e.target.value })}>
                                           <option value="g/y">g/y</option>
                                           <option value="gsm">gsm</option>
                                           <option value="g/m²">g/m²</option>
                                           <option value="oz/yd²">oz/yd²</option>
                                       </select>
                                   </div>
                               </div>
                               <div style={{ gridColumn: '1 / -1' }}>
                                   <label style={xpLbl}>Additional Information</label>
                                   <textarea style={{ ...xpInput, height: 'auto', padding: '4px 6px', width: '100%', resize: 'vertical' as const, boxSizing: 'border-box' as const }}
                                             rows={2} value={newSample.additional_info} onChange={e => setNewSample({ ...newSample, additional_info: e.target.value })}
                                             placeholder="e.g. PRINTING ROTARY" />
                               </div>
                           </div>
                       </div>
                   </div>
               ) : (
                   <div className="card border-0 mb-3">
                       <div className="card-header py-1 px-2 text-white small fw-bold" style={{ background: 'linear-gradient(to right, #2a5fbe, #4a8fd8)' }}>③ Materials</div>
                       <div className="card-body p-2">
                           <div className="row g-2 mb-2">
                               {[
                                   { key: 'main_material', label: 'Main Material', placeholder: 'e.g. NILON' },
                                   { key: 'middle_material', label: 'Middle Material', placeholder: '' },
                                   { key: 'bottom_material', label: 'Bottom Material', placeholder: '' },
                               ].map(({ key, label, placeholder }) => (
                                   <div key={key} className="col-md-4">
                                       <label className="form-label small text-muted">{label}</label>
                                       <input className="form-control form-control-sm" value={(newSample as any)[key]} onChange={e => setNewSample({ ...newSample, [key]: e.target.value })} placeholder={placeholder} />
                                   </div>
                               ))}
                           </div>
                           <hr className="my-2" />
                           <div className="row g-2">
                               <div className="col-md-6">
                                   <label className="form-label small text-muted">Weft</label>
                                   <input className="form-control form-control-sm" value={newSample.weft} onChange={e => setNewSample({ ...newSample, weft: e.target.value })} placeholder="e.g. NILON" />
                               </div>
                               <div className="col-md-6">
                                   <label className="form-label small text-muted">Warp</label>
                                   <input className="form-control form-control-sm" value={newSample.warp} onChange={e => setNewSample({ ...newSample, warp: e.target.value })} placeholder="e.g. SPANDEX" />
                               </div>
                               <div className="col-md-6">
                                   <label className="form-label small text-muted">Original Weight</label>
                                   <div className="input-group input-group-sm">
                                       <input type="number" step="0.01" className="form-control" value={newSample.original_weight} onChange={e => setNewSample({ ...newSample, original_weight: e.target.value })} placeholder="0.00" />
                                       <select className="form-select" style={{ maxWidth: 80 }} value={newSample.original_weight_unit} onChange={e => setNewSample({ ...newSample, original_weight_unit: e.target.value })}>
                                           <option value="g/y">g/y</option>
                                           <option value="gsm">gsm</option>
                                           <option value="g/m²">g/m²</option>
                                           <option value="oz/yd²">oz/yd²</option>
                                       </select>
                                   </div>
                               </div>
                               <div className="col-md-6">
                                   <label className="form-label small text-muted">Production Weight</label>
                                   <div className="input-group input-group-sm">
                                       <input type="number" step="0.01" className="form-control" value={newSample.production_weight} onChange={e => setNewSample({ ...newSample, production_weight: e.target.value })} placeholder="0.00" />
                                       <select className="form-select" style={{ maxWidth: 80 }} value={newSample.production_weight_unit} onChange={e => setNewSample({ ...newSample, production_weight_unit: e.target.value })}>
                                           <option value="g/y">g/y</option>
                                           <option value="gsm">gsm</option>
                                           <option value="g/m²">g/m²</option>
                                           <option value="oz/yd²">oz/yd²</option>
                                       </select>
                                   </div>
                               </div>
                               <div className="col-12">
                                   <label className="form-label small text-muted">Additional Information</label>
                                   <textarea className="form-control form-control-sm" rows={2} value={newSample.additional_info} onChange={e => setNewSample({ ...newSample, additional_info: e.target.value })} placeholder="e.g. PRINTING ROTARY" />
                               </div>
                           </div>
                       </div>
                   </div>
               )}

               {/* ══ ④ Logistics ══ */}
               {classic ? (
                   <div style={{ ...xpGroupBox, marginBottom: 0 }}>
                       <div style={xpGroupHeader}>④ Logistics</div>
                       <div style={xpGroupBody}>
                           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                               <div>
                                   <label style={xpLbl}>Sample Quantity</label>
                                   <input style={{ ...xpInput, width: '100%', boxSizing: 'border-box' as const }}
                                          value={newSample.quantity} onChange={e => setNewSample({ ...newSample, quantity: e.target.value })}
                                          placeholder="e.g. 1 METER" />
                               </div>
                               <div>
                                   <label style={xpLbl}>Per-Sample Size</label>
                                   <input style={{ ...xpInput, width: '100%', boxSizing: 'border-box' as const }}
                                          value={newSample.sample_size} onChange={e => setNewSample({ ...newSample, sample_size: e.target.value })}
                                          placeholder="Dimensions" />
                               </div>
                               <div>
                                   <label style={xpLbl}>Est. Completion Date</label>
                                   <input type="date" style={{ ...xpInput, width: '100%', boxSizing: 'border-box' as const }}
                                          value={newSample.estimated_completion_date} onChange={e => setNewSample({ ...newSample, estimated_completion_date: e.target.value })} />
                               </div>
                               <div style={{ gridColumn: '1 / -1' }}>
                                   <label style={xpLbl}>Completion Notes</label>
                                   <textarea style={{ ...xpInput, height: 'auto', padding: '4px 6px', width: '100%', resize: 'vertical' as const, boxSizing: 'border-box' as const }}
                                             rows={2} value={newSample.completion_description} onChange={e => setNewSample({ ...newSample, completion_description: e.target.value })}
                                             placeholder="Priority instructions, special notes…" />
                               </div>
                           </div>
                       </div>
                   </div>
               ) : (
                   <div className="card border-0 mb-0">
                       <div className="card-header py-1 px-2 text-white small fw-bold" style={{ background: 'linear-gradient(to right, #2a5fbe, #4a8fd8)' }}>④ Logistics</div>
                       <div className="card-body p-2">
                           <div className="row g-2">
                               <div className="col-md-6">
                                   <label className="form-label small text-muted">Sample Quantity</label>
                                   <input className="form-control form-control-sm" value={newSample.quantity} onChange={e => setNewSample({ ...newSample, quantity: e.target.value })} placeholder="e.g. 1 METER" />
                               </div>
                               <div className="col-md-6">
                                   <label className="form-label small text-muted">Per-Sample Size</label>
                                   <input className="form-control form-control-sm" value={newSample.sample_size} onChange={e => setNewSample({ ...newSample, sample_size: e.target.value })} placeholder="Dimensions" />
                               </div>
                               <div className="col-md-6">
                                   <label className="form-label small text-muted">Est. Completion Date</label>
                                   <input type="date" className="form-control form-control-sm" value={newSample.estimated_completion_date} onChange={e => setNewSample({ ...newSample, estimated_completion_date: e.target.value })} />
                               </div>
                               <div className="col-12">
                                   <label className="form-label small text-muted">Completion Notes</label>
                                   <textarea className="form-control form-control-sm" rows={2} value={newSample.completion_description} onChange={e => setNewSample({ ...newSample, completion_description: e.target.value })} placeholder="Priority instructions, special notes…" />
                               </div>
                           </div>
                       </div>
                   </div>
               )}
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
                       placeholder="Search code, article, project…"
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
                           placeholder="Search code, article, project…"
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
                               <th style={classic ? { ...xpThCell, width: '110px' } : undefined}>Customer</th>
                               <th style={classic ? xpThCell : undefined}>Article / Project</th>
                               <th style={classic ? xpThCell : undefined}>Specs</th>
                               <th style={classic ? { ...xpThCell, width: '100px' } : undefined}>Status</th>
                               <th style={classic ? { ...xpThCell, width: '90px' } : undefined}>Colors</th>
                               <th style={classic ? { ...xpThCell, textAlign: 'right' as const, borderRight: 'none', width: '130px' } : undefined} className={classic ? '' : 'text-end pe-4'}>Actions</th>
                           </tr>
                       </thead>
                       <tbody>
                           {filteredSamples.map((s: any, rowIndex: number) => (
                               <React.Fragment key={s.id}>
                               <tr
                                   key={`${s.id}-row`}
                                   ref={s.id === highlightId ? highlightRef : undefined}
                                   onClick={() => s.colors && s.colors.length > 0 && toggleExpand(s.id)}
                                   style={classic
                                       ? { background: s.id === highlightId ? '#fff8cc' : rowIndex % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5', cursor: s.colors && s.colors.length > 0 ? 'pointer' : 'default', outline: s.id === highlightId ? '2px solid #f0a000' : undefined }
                                       : { cursor: s.colors && s.colors.length > 0 ? 'pointer' : 'default', background: s.id === highlightId ? '#fff8e1' : undefined, outline: s.id === highlightId ? '2px solid #f0a000' : undefined }}
                               >
                                   <td style={classic ? tdBase : undefined} className={classic ? '' : 'ps-4'}>
                                       <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                           {s.colors && s.colors.length > 0 && (
                                               classic ? (
                                                   <button
                                                       onClick={e => { e.stopPropagation(); toggleExpand(s.id); }}
                                                       style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontFamily: 'Tahoma', fontSize: 10, color: '#333' }}
                                                   >
                                                       {expandedIds.has(s.id) ? '▼' : '▶'}
                                                   </button>
                                               ) : (
                                                   <button
                                                       className="btn btn-link p-0 text-muted"
                                                       style={{ fontSize: 10, lineHeight: 1 }}
                                                       onClick={e => { e.stopPropagation(); toggleExpand(s.id); }}
                                                   >
                                                       <i className={`bi bi-chevron-${expandedIds.has(s.id) ? 'down' : 'right'}`}></i>
                                                   </button>
                                               )
                                           )}
                                           <div>
                                               <div style={classic ? { fontFamily: "'Courier New', monospace", fontWeight: 'bold', color: '#0047c8', fontSize: '10px' } : undefined} className={classic ? '' : 'fw-bold font-monospace text-primary'}>
                                                   {s.code}
                                               </div>
                                               <div style={classic ? { fontSize: '9px', color: '#555' } : undefined} className={classic ? '' : 'small text-muted'}>
                                                   {new Date(s.created_at).toLocaleDateString()}
                                               </div>
                                           </div>
                                       </div>
                                   </td>
                                   <td style={classic ? tdBase : undefined}>
                                       {s.customer_id ? (
                                           <span style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px' } : undefined}
                                                 className={classic ? '' : 'fw-medium'}>
                                               {getCustomerName(s.customer_id)}
                                           </span>
                                       ) : (
                                           <span style={classic ? { fontSize: '9px', color: '#555', fontStyle: 'italic', fontFamily: 'Tahoma, Arial, sans-serif' } : undefined} className={classic ? '' : 'text-muted small fst-italic'}>
                                               Internal
                                           </span>
                                       )}
                                   </td>
                                   {/* Article / Project */}
                                   <td style={classic ? tdBase : undefined}>
                                       {s.customer_article_code && (
                                           <div style={classic ? { fontWeight: 'bold', fontSize: '11px' } : undefined} className={classic ? '' : 'fw-medium'}>
                                               {s.customer_article_code}
                                           </div>
                                       )}
                                       {s.project && (
                                           <div style={classic ? { fontSize: '9px', color: '#555' } : undefined} className={classic ? '' : 'small text-muted'}>
                                               {s.project}
                                           </div>
                                       )}
                                       {!s.customer_article_code && !s.project && (
                                           <span style={classic ? { fontSize: '9px', color: '#888', fontStyle: 'italic', fontFamily: 'Tahoma, Arial, sans-serif' } : undefined}
                                                 className={classic ? '' : 'text-muted small fst-italic'}>—</span>
                                       )}
                                   </td>
                                   {/* Specs */}
                                   <td style={classic ? tdBase : undefined}>
                                       {s.width && (
                                           <div style={classic ? { fontSize: '10px', fontFamily: 'Tahoma, Arial, sans-serif' } : undefined}
                                                className={classic ? '' : 'small'}>
                                               <i className="bi bi-rulers me-1 opacity-50"></i>{s.width}
                                           </div>
                                       )}
                                       <div style={classic ? { display: 'flex', gap: 2, flexWrap: 'wrap' as const, marginTop: 2 } : undefined}
                                            className={classic ? '' : 'small text-muted d-flex gap-1 flex-wrap mt-1'}>
                                           {s.colors && s.colors.map((c: any, i: number) => (
                                               classic ? (
                                                   <span key={i} style={{ background: c.is_repeat ? '#e8e8ff' : '#e8f5e8', border: `1px solid ${c.is_repeat ? '#8888cc' : '#88aa88'}`, color: c.is_repeat ? '#333' : '#1a3a1a', padding: '0 4px', fontSize: '9px', fontFamily: 'Tahoma, Arial, sans-serif' }}>
                                                       {c.name}{c.is_repeat ? ' (R)' : ''}
                                                   </span>
                                               ) : (
                                                   <span key={i} className={`badge ${c.is_repeat ? 'bg-primary bg-opacity-10 text-primary' : 'bg-success bg-opacity-10 text-success'} border`}>
                                                       {c.name}{c.is_repeat ? ' ↺' : ''}
                                                   </span>
                                               )
                                           ))}
                                       </div>
                                   </td>
                                   {/* Status — request-level only */}
                                   <td style={classic ? tdBase : undefined}>
                                       {classic ? (
                                           <span style={getStatusXPStyle(s.status)}>{s.status}</span>
                                       ) : (
                                           <span className={`badge ${getStatusBadge(s.status)}`}>{s.status}</span>
                                       )}
                                   </td>
                                   {/* Colors — approved fraction */}
                                   <td style={classic ? tdBase : undefined}>
                                       {s.colors && s.colors.length > 0 ? (() => {
                                           const approved = s.colors.filter((c: any) => c.status === 'APPROVED').length;
                                           const total = s.colors.length;
                                           const numColor = fracNumColor(approved, total);
                                           return classic ? (
                                               <div style={{ display: 'flex', alignItems: 'baseline', gap: 1, whiteSpace: 'nowrap' as const }}>
                                                   <span style={{ fontSize: 13, fontWeight: 'bold', color: numColor, fontFamily: 'Tahoma, Arial, sans-serif' }}>{approved}</span>
                                                   <span style={{ fontSize: 11, color: '#777', fontFamily: 'Tahoma, Arial, sans-serif', margin: '0 1px' }}>/</span>
                                                   <span style={{ fontSize: 13, fontWeight: 'bold', color: '#888', fontFamily: 'Tahoma, Arial, sans-serif' }}>{total}</span>
                                                   <span style={{ fontSize: 9, color: '#555', marginLeft: 3, fontFamily: 'Tahoma, Arial, sans-serif' }}>approved</span>
                                               </div>
                                           ) : (
                                               <span className="small">
                                                   <span style={{ fontWeight: 'bold', color: numColor }}>{approved}</span>
                                                   <span className="text-muted">/{total}</span>
                                                   <span className="text-muted ms-1" style={{ fontSize: 10 }}>approved</span>
                                               </span>
                                           );
                                       })() : (
                                           <span style={classic ? { fontSize: '9px', color: '#888', fontStyle: 'italic', fontFamily: 'Tahoma, Arial, sans-serif' } : undefined}
                                                 className={classic ? '' : 'text-muted small fst-italic'}>—</span>
                                       )}
                                   </td>
                                   {/* Actions — history icon + split Update button */}
                                   <td style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'right' as const } : undefined} className={classic ? '' : 'pe-4 text-end'}>
                                       <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end', alignItems: 'center' }}>
                                           {/* Print button */}
                                           <button
                                               title="Print SPK Sample"
                                               onClick={(e) => { e.stopPropagation(); setPrintSample(s); }}
                                               style={classic
                                                   ? xpBtn({ padding: '2px 5px', fontSize: '12px', lineHeight: '1' })
                                                   : undefined}
                                               className={classic ? '' : 'btn btn-sm btn-link text-muted p-0'}
                                           >
                                               <i className="bi bi-printer"></i>
                                           </button>
                                           {/* History button */}
                                           <button
                                               title="View History"
                                               onClick={(e) => { e.stopPropagation(); setHistoryEntityId(s.id); }}
                                               style={classic
                                                   ? xpBtn({ padding: '2px 5px', fontSize: '12px', lineHeight: '1' })
                                                   : undefined}
                                               className={classic ? '' : 'btn btn-sm btn-link text-muted p-0'}
                                           >
                                               <i className="bi bi-clock-history"></i>
                                           </button>
                                           {/* Update split button (classic) / plain button (modern) */}
                                           {classic ? (
                                               <div
                                                   className="action-dropdown-btn"
                                                   style={{ display: 'inline-flex', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', cursor: 'pointer' }}
                                                   onClick={(e) => toggleDropdown(s.id, e as any)}
                                               >
                                                   <button style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: 11, padding: '2px 9px', background: 'linear-gradient(to bottom, #fff, #d4d0c8)', border: 'none', borderRight: '1px solid #b0a898', cursor: 'pointer', color: '#000' }}>
                                                       Update
                                                   </button>
                                                   <button style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: 10, padding: '2px 6px', background: 'linear-gradient(to bottom, #fff, #d4d0c8)', border: 'none', cursor: 'pointer', color: '#000' }}>
                                                       ▾
                                                   </button>
                                               </div>
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
                               {expandedIds.has(s.id) && s.colors && s.colors.length > 0 && (
                                   <tr key={`${s.id}-colors`}>
                                       <td
                                           colSpan={7}
                                           style={{ padding: 0, borderBottom: classic ? '2px solid #9a9690' : '2px solid #dee2e6' }}
                                       >
                                           {classic ? (
                                               /* ── XP group-box expand panel ── */
                                               <div style={{ padding: '6px 10px 8px 34px', background: '#ece9d8' }}>
                                                   <div style={{ border: '1px solid #7a7a7a', background: '#fff' }}>
                                                       {/* Group box header */}
                                                       <div style={{ background: 'linear-gradient(to bottom, #e4e1d8, #d5d2c8)', borderBottom: '1px solid #9a9690', padding: '2px 8px', fontSize: 10, fontWeight: 'bold', color: '#111', letterSpacing: '0.3px', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Tahoma, Arial, sans-serif' }}>
                                                           🎨 Color Status — {s.colors.length} color{s.colors.length !== 1 ? 's' : ''} · {s.colors.filter((c: any) => c.status === 'APPROVED').length} approved
                                                       </div>
                                                       {/* Inner table — colgroup ensures headers and rows always align */}
                                                       <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' as const }}>
                                                           <colgroup>
                                                               <col style={{ width: 110 }} />
                                                               <col style={{ width: 62 }} />
                                                               <col style={{ width: 106 }} />
                                                               <col />{/* flex spacer */}
                                                               <col style={{ width: 240 }} />
                                                               <col style={{ width: 90 }} />
                                                           </colgroup>
                                                           <thead>
                                                               <tr>
                                                                   <th style={colorThCell}>Color Name</th>
                                                                   <th style={colorThCell}>Type</th>
                                                                   <th style={colorThCell}>Status</th>
                                                                   <th style={{ ...colorThCell, borderRight: 'none' }}></th>
                                                                   <th style={{ ...colorThCell, textAlign: 'center' as const }}>Update Status</th>
                                                                   <th style={{ ...colorThCell, borderRight: 'none', textAlign: 'center' as const }}>Item</th>
                                                               </tr>
                                                           </thead>
                                                           <tbody>
                                                               {s.colors.map((c: any, ci: number) => {
                                                                   const cst = colorRowStyle(c.status || 'PENDING');
                                                                   const isLast = ci === s.colors.length - 1;
                                                                   const tdStyle: React.CSSProperties = { ...colorTdCell, background: cst.background, borderBottom: isLast ? 'none' : colorTdCell.borderBottom };
                                                                   const isInProd = (c.status || 'PENDING') === 'IN_PRODUCTION';
                                                                   const isApproved = (c.status || 'PENDING') === 'APPROVED';
                                                                   const isRejected = (c.status || 'PENDING') === 'REJECTED';
                                                                   return (
                                                                       <tr key={c.id} style={{ background: cst.background }}>
                                                                           <td style={{ ...tdStyle, borderLeft: `4px solid ${cst.borderLeftColor}`, fontWeight: 'bold' }}>{c.name}</td>
                                                                           <td style={tdStyle}>
                                                                               <span style={{ background: c.is_repeat ? '#dce4f5' : '#d4edda', border: `1px solid ${c.is_repeat ? '#6878c8' : '#5aaa68'}`, color: c.is_repeat ? '#0d2a6e' : '#0c3a1a', padding: '0 4px', fontSize: '9px', fontFamily: 'Tahoma, Arial, sans-serif', fontWeight: 'bold' }}>
                                                                                   {c.is_repeat ? 'Repeat' : 'New'}
                                                                               </span>
                                                                           </td>
                                                                           <td style={tdStyle}>
                                                                               <span style={getColorStatusStyle(c.status || 'PENDING')}>{c.status || 'PENDING'}</span>
                                                                           </td>
                                                                           <td style={{ ...tdStyle, borderRight: 'none' }}></td>
                                                                           <td style={{ ...tdStyle, textAlign: 'center' as const }}>
                                                                               <div style={{ display: 'inline-flex' }}>
                                                                                   <button type="button" style={cbInprod(isInProd)} onClick={() => onUpdateColorStatus(s.id, c.id, isInProd ? 'PENDING' : 'IN_PRODUCTION')} title={isInProd ? 'Reset to Pending' : 'Set In Production'}>⚙ In Prod</button>
                                                                                   <button type="button" style={cbApprove(isApproved)} onClick={() => onUpdateColorStatus(s.id, c.id, isApproved ? 'PENDING' : 'APPROVED')} title={isApproved ? 'Reset to Pending' : 'Approve'}>✓ Approve</button>
                                                                                   <button type="button" style={cbReject(isRejected)} onClick={() => onUpdateColorStatus(s.id, c.id, isRejected ? 'PENDING' : 'REJECTED')} title={isRejected ? 'Reset to Pending' : 'Reject'}>✗ Reject</button>
                                                                               </div>
                                                                           </td>
                                                                           <td style={{ ...tdStyle, borderRight: 'none', textAlign: 'center' as const }}>
                                                                               {isApproved && (
                                                                                   <button
                                                                                       style={xpBtn({ background: 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#fff', fontSize: 10, padding: '1px 6px' })}
                                                                                       onClick={() => createItemFromColor(s, c)}
                                                                                       title="Create Item from this approved color"
                                                                                   >+ Item</button>
                                                                               )}
                                                                           </td>
                                                                       </tr>
                                                                   );
                                                               })}
                                                           </tbody>
                                                       </table>
                                                   </div>
                                               </div>
                                           ) : (
                                               /* ── Modern Bootstrap expand panel ── */
                                               <div style={{ background: '#f8f9fa', padding: '6px 12px 8px 32px' }}>
                                                   <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' as const }}>
                                                       <colgroup>
                                                           <col style={{ width: 110 }} /><col style={{ width: 62 }} /><col style={{ width: 106 }} />
                                                           <col /><col style={{ width: 240 }} /><col style={{ width: 90 }} />
                                                       </colgroup>
                                                       <thead>
                                                           <tr>
                                                               <th className="small text-muted fw-semibold" style={{ padding: '2px 6px', borderBottom: '1px solid #dee2e6', fontSize: 10 }}>Color</th>
                                                               <th className="small text-muted fw-semibold" style={{ padding: '2px 6px', borderBottom: '1px solid #dee2e6', fontSize: 10 }}>Type</th>
                                                               <th className="small text-muted fw-semibold" style={{ padding: '2px 6px', borderBottom: '1px solid #dee2e6', fontSize: 10 }}>Status</th>
                                                               <th style={{ borderBottom: '1px solid #dee2e6' }}></th>
                                                               <th className="small text-muted fw-semibold text-center" style={{ padding: '2px 6px', borderBottom: '1px solid #dee2e6', fontSize: 10 }}>Update Status</th>
                                                               <th className="small text-muted fw-semibold text-center" style={{ padding: '2px 6px', borderBottom: '1px solid #dee2e6', fontSize: 10 }}>Item</th>
                                                           </tr>
                                                       </thead>
                                                       <tbody>
                                                           {s.colors.map((c: any, ci: number) => {
                                                               const isInProd = (c.status || 'PENDING') === 'IN_PRODUCTION';
                                                               const isApproved = (c.status || 'PENDING') === 'APPROVED';
                                                               const isRejected = (c.status || 'PENDING') === 'REJECTED';
                                                               return (
                                                                   <tr key={c.id}>
                                                                       <td style={{ padding: '4px 6px', borderBottom: '1px solid #e9ecef', fontSize: 11, fontWeight: 500 }}>{c.name}</td>
                                                                       <td style={{ padding: '4px 6px', borderBottom: '1px solid #e9ecef' }}>
                                                                           <span className={`badge ${c.is_repeat ? 'bg-primary bg-opacity-10 text-primary' : 'bg-success bg-opacity-10 text-success'} border`} style={{ fontSize: 10 }}>{c.is_repeat ? 'Repeat' : 'New'}</span>
                                                                       </td>
                                                                       <td style={{ padding: '4px 6px', borderBottom: '1px solid #e9ecef' }}>
                                                                           <span className={`badge ${getColorStatusBadgeClass(c.status || 'PENDING')}`} style={{ fontSize: 10 }}>{c.status || 'PENDING'}</span>
                                                                       </td>
                                                                       <td style={{ borderBottom: '1px solid #e9ecef' }}></td>
                                                                       <td style={{ padding: '3px 6px', borderBottom: '1px solid #e9ecef', textAlign: 'center' as const }}>
                                                                           <div className="btn-group btn-group-sm" role="group">
                                                                               <button type="button" className={`btn ${isInProd ? 'btn-warning' : 'btn-outline-warning'}`} style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => onUpdateColorStatus(s.id, c.id, isInProd ? 'PENDING' : 'IN_PRODUCTION')} title={isInProd ? 'Reset to Pending' : 'Set In Production'}>⚙ In Prod</button>
                                                                               <button type="button" className={`btn ${isApproved ? 'btn-success' : 'btn-outline-success'}`} style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => onUpdateColorStatus(s.id, c.id, isApproved ? 'PENDING' : 'APPROVED')} title={isApproved ? 'Reset to Pending' : 'Approve'}>✓ Approve</button>
                                                                               <button type="button" className={`btn ${isRejected ? 'btn-danger' : 'btn-outline-danger'}`} style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => onUpdateColorStatus(s.id, c.id, isRejected ? 'PENDING' : 'REJECTED')} title={isRejected ? 'Reset to Pending' : 'Reject'}>✗ Reject</button>
                                                                           </div>
                                                                       </td>
                                                                       <td style={{ padding: '3px 6px', borderBottom: '1px solid #e9ecef', textAlign: 'center' as const }}>
                                                                           {isApproved && (
                                                                               <button className="btn btn-sm btn-success" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => createItemFromColor(s, c)} title="Create Item from this approved color">+ Item</button>
                                                                           )}
                                                                       </td>
                                                                   </tr>
                                                               );
                                                           })}
                                                       </tbody>
                                                   </table>
                                               </div>
                                           )}
                                       </td>
                                   </tr>
                               )}
                               </React.Fragment>
                           ))}
                           {filteredSamples.length === 0 && (
                               <tr>
                                   <td
                                       colSpan={7}
                                       style={classic ? { ...tdBase, borderRight: 'none', textAlign: 'center', padding: '24px 8px', color: '#555', fontStyle: 'italic' } : undefined}
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

       {printSample && (
           <SamplePrintModal
               sample={printSample}
               onClose={() => setPrintSample(null)}
               currentStyle={currentStyle}
               companyProfile={companyProfile}
               getCustomerName={getCustomerName}
           />
       )}

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
