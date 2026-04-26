import { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';

export default function RoutingView({ workCenters, operations, onCreateWorkCenter, onDeleteWorkCenter, onCreateOperation, onDeleteOperation, onRefresh }: any) {
  const { t } = useLanguage();
  const [newWorkCenter, setNewWorkCenter] = useState({ code: '', name: '', cost_per_hour: 0 });
  const [newOperation, setNewOperation] = useState({ code: '', name: '' });
  const [wcSearch, setWcSearch] = useState('');
  const [opSearch, setOpSearch] = useState('');
  const { uiStyle: currentStyle } = useTheme();
  const classic = currentStyle === 'classic';
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleCreateWC = (e: React.FormEvent) => {
      e.preventDefault();
      onCreateWorkCenter(newWorkCenter);
      setNewWorkCenter({ code: '', name: '', cost_per_hour: 0 });
  };

  const handleCreateOp = (e: React.FormEvent) => {
      e.preventDefault();
      onCreateOperation(newOperation);
      setNewOperation({ code: '', name: '' });
  };

  const filteredWC = (workCenters || []).filter((wc: any) =>
      wc.code.toLowerCase().includes(wcSearch.toLowerCase()) ||
      wc.name.toLowerCase().includes(wcSearch.toLowerCase())
  );
  const filteredOp = (operations || []).filter((op: any) =>
      op.code.toLowerCase().includes(opSearch.toLowerCase()) ||
      op.name.toLowerCase().includes(opSearch.toLowerCase())
  );

  // ── XP inline styles ─────────────────────────────────────────────────────
  const xpBevel: React.CSSProperties = {
      border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
      boxShadow: '2px 2px 4px rgba(0,0,0,0.3)', background: '#ece9d8', borderRadius: 0,
  };
  const xpTitleBar = (extra: any = {}): React.CSSProperties => ({
      background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)', color: '#ffffff',
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '12px', fontWeight: 'bold',
      padding: '4px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
      borderBottom: '1px solid #003080', display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', minHeight: '26px', ...extra,
  });
  const xpToolbar: React.CSSProperties = {
      background: 'linear-gradient(to bottom, #f5f4ef, #e0dfd8)', borderBottom: '1px solid #b0a898',
      padding: '3px 6px', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' as const,
  };
  const xpBtn = (extra: any = {}) => ({
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', padding: '2px 10px', cursor: 'pointer',
      background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)', border: '1px solid',
      borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#000000', borderRadius: 0, ...extra,
  });
  const xpInput: React.CSSProperties = {
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', border: '1px solid #7f9db9',
      boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)', padding: '1px 6px',
      background: '#ffffff', color: '#000000', height: '20px', outline: 'none',
  };
  const xpSep: React.CSSProperties = {
      width: '1px', height: '20px', background: '#a0988c', margin: '0 2px', flexShrink: 0,
  };
  const xpTableHeader: React.CSSProperties = {
      background: 'linear-gradient(to bottom, #ffffff, #d4d0c8)', borderBottom: '2px solid #808080',
      fontSize: '10px', fontWeight: 'bold', color: '#000000',
  };
  const xpLabel: React.CSSProperties = {
      fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2,
  };
  const xpStatusBar: React.CSSProperties = {
      background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898',
      padding: '2px 8px', display: 'flex', gap: 16,
      fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#333',
  };

  const XPPanel = ({ icon, title, accentColor, createForm, searchVal, onSearch, searchPlaceholder, countLabel, table }: any) => (
      <div style={{ ...xpBevel, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={xpTitleBar({ background: `linear-gradient(to right, ${accentColor[0]} 0%, ${accentColor[1]} 100%)`, borderBottom: `1px solid ${accentColor[2]}` })}>
              <span><i className={`bi ${icon}`} style={{ marginRight: 6 }}></i>{title}</span>
          </div>
          {/* Create form */}
          <div style={{ background: '#f5f4ef', borderBottom: '1px solid #b0a898', padding: '6px 8px' }}>
              {createForm}
          </div>
          {/* Search toolbar */}
          <div style={xpToolbar}>
              <i className="bi bi-search" style={{ fontSize: '11px', color: '#666' }}></i>
              <input style={{ ...xpInput, flex: 1, minWidth: 80 }} placeholder={searchPlaceholder} value={searchVal} onChange={(e: any) => onSearch(e.target.value)} />
              <div style={xpSep} />
              <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>{countLabel}</span>
          </div>
          {/* Table */}
          <div style={{ flex: 1, overflowY: 'auto', background: '#ffffff' }}>
              {table}
          </div>
      </div>
  );

  if (classic) {
      return (
          <div className="row g-3 fade-in">
              {/* Work Centers */}
              <div className="col-md-6">
                  <XPPanel
                      icon="bi-cpu-fill"
                      title={t('work_centers')}
                      accentColor={['#0058e6', '#08a5ff', '#003080']}
                      searchVal={wcSearch}
                      onSearch={setWcSearch}
                      searchPlaceholder="Search work centers..."
                      countLabel={`${filteredWC.length} station${filteredWC.length === 1 ? '' : 's'}`}
                      createForm={
                          <form onSubmit={handleCreateWC} style={{ display: 'flex', gap: 4, alignItems: 'flex-end', flexWrap: 'wrap' as const }}>
                              <div>
                                  <label style={xpLabel}>{t('item_code')}</label>
                                  <input style={{ ...xpInput, width: 72 }} placeholder="WC-01" value={newWorkCenter.code} onChange={e => setNewWorkCenter({ ...newWorkCenter, code: e.target.value })} required />
                              </div>
                              <div style={{ flex: 1 }}>
                                  <label style={xpLabel}>{t('station_name')}</label>
                                  <input style={{ ...xpInput, width: '100%' }} placeholder="Assembly Line 1" value={newWorkCenter.name} onChange={e => setNewWorkCenter({ ...newWorkCenter, name: e.target.value })} required />
                              </div>
                              <button type="submit" style={xpBtn({ background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', fontWeight: 'bold', padding: '2px 10px' })}>
                                  <i className="bi bi-plus-lg" style={{ marginRight: 3 }}></i>{t('add')}
                              </button>
                          </form>
                      }
                      table={
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                  <tr>
                                      <th style={{ ...xpTableHeader, padding: '3px 8px', width: 80 }}>{t('item_code')}</th>
                                      <th style={{ ...xpTableHeader, padding: '3px 8px' }}>{t('station_name')}</th>
                                      <th style={{ ...xpTableHeader, padding: '3px 8px', width: 36 }}></th>
                                  </tr>
                              </thead>
                              <tbody>
                                  {filteredWC.map((wc: any, i: number) => (
                                      <tr key={wc.id} style={{ background: i % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' }}>
                                          <td style={{ padding: '4px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', fontWeight: 'bold', color: '#00008b', fontVariant: 'all-small-caps' }}>{wc.code}</td>
                                          <td style={{ padding: '4px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000' }}>{wc.name}</td>
                                          <td style={{ padding: '2px 4px', textAlign: 'center' }}>
                                              <button
                                                  style={{ ...xpBtn(), border: hoveredId === `wc-${wc.id}` ? '1px solid #808080' : '1px solid transparent', background: hoveredId === `wc-${wc.id}` ? 'linear-gradient(to bottom,#ffffff,#d4d0c8)' : 'transparent', padding: '1px 5px' }}
                                                  onMouseEnter={() => setHoveredId(`wc-${wc.id}`)}
                                                  onMouseLeave={() => setHoveredId(null)}
                                                  onClick={() => onDeleteWorkCenter && onDeleteWorkCenter(wc.id)}
                                                  title="Delete"
                                              >
                                                  <i className="bi bi-trash" style={{ color: '#c00000', fontSize: '11px' }}></i>
                                              </button>
                                          </td>
                                      </tr>
                                  ))}
                                  {filteredWC.length === 0 && (
                                      <tr><td colSpan={3} style={{ textAlign: 'center', padding: '16px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666' }}>No work centers defined</td></tr>
                                  )}
                              </tbody>
                          </table>
                      }
                  />
                  <div style={xpStatusBar}><span><b>{(workCenters || []).length}</b> Total</span></div>
              </div>

              {/* Operations */}
              <div className="col-md-6">
                  <XPPanel
                      icon="bi-gear-fill"
                      title={t('standard_operations')}
                      accentColor={['#1a6e1a', '#3ab83a', '#0a4e0a']}
                      searchVal={opSearch}
                      onSearch={setOpSearch}
                      searchPlaceholder="Search operations..."
                      countLabel={`${filteredOp.length} operation${filteredOp.length === 1 ? '' : 's'}`}
                      createForm={
                          <form onSubmit={handleCreateOp} style={{ display: 'flex', gap: 4, alignItems: 'flex-end', flexWrap: 'wrap' as const }}>
                              <div>
                                  <label style={xpLabel}>{t('item_code')}</label>
                                  <input style={{ ...xpInput, width: 72 }} placeholder="OP-10" value={newOperation.code} onChange={e => setNewOperation({ ...newOperation, code: e.target.value })} required />
                              </div>
                              <div style={{ flex: 1 }}>
                                  <label style={xpLabel}>{t('operation_name')}</label>
                                  <input style={{ ...xpInput, width: '100%' }} placeholder="Cutting" value={newOperation.name} onChange={e => setNewOperation({ ...newOperation, name: e.target.value })} required />
                              </div>
                              <button type="submit" style={xpBtn({ background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', fontWeight: 'bold', padding: '2px 10px' })}>
                                  <i className="bi bi-plus-lg" style={{ marginRight: 3 }}></i>{t('add')}
                              </button>
                          </form>
                      }
                      table={
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                  <tr>
                                      <th style={{ ...xpTableHeader, padding: '3px 8px', width: 80 }}>{t('item_code')}</th>
                                      <th style={{ ...xpTableHeader, padding: '3px 8px' }}>{t('operation_name')}</th>
                                      <th style={{ ...xpTableHeader, padding: '3px 8px', width: 36 }}></th>
                                  </tr>
                              </thead>
                              <tbody>
                                  {filteredOp.map((op: any, i: number) => (
                                      <tr key={op.id} style={{ background: i % 2 === 0 ? '#ffffff' : '#f5f3ee', borderBottom: '1px solid #c0bdb5' }}>
                                          <td style={{ padding: '4px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', fontWeight: 'bold', color: '#1a5e1a', fontVariant: 'all-small-caps' }}>{op.code}</td>
                                          <td style={{ padding: '4px 8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000' }}>{op.name}</td>
                                          <td style={{ padding: '2px 4px', textAlign: 'center' }}>
                                              <button
                                                  style={{ ...xpBtn(), border: hoveredId === `op-${op.id}` ? '1px solid #808080' : '1px solid transparent', background: hoveredId === `op-${op.id}` ? 'linear-gradient(to bottom,#ffffff,#d4d0c8)' : 'transparent', padding: '1px 5px' }}
                                                  onMouseEnter={() => setHoveredId(`op-${op.id}`)}
                                                  onMouseLeave={() => setHoveredId(null)}
                                                  onClick={() => onDeleteOperation && onDeleteOperation(op.id)}
                                                  title="Delete"
                                              >
                                                  <i className="bi bi-trash" style={{ color: '#c00000', fontSize: '11px' }}></i>
                                              </button>
                                          </td>
                                      </tr>
                                  ))}
                                  {filteredOp.length === 0 && (
                                      <tr><td colSpan={3} style={{ textAlign: 'center', padding: '16px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666' }}>No operations defined</td></tr>
                                  )}
                              </tbody>
                          </table>
                      }
                  />
                  <div style={xpStatusBar}><span><b>{(operations || []).length}</b> Total</span></div>
              </div>
          </div>
      );
  }

  // ── Modern (Bootstrap) mode ───────────────────────────────────────────────
  return (
      <div className="row g-4 fade-in">
          {/* Work Centers */}
          <div className="col-md-6">
              <div className="card h-100 shadow-sm border-0">
                  <div className="card-header bg-white d-flex justify-content-between align-items-center">
                      <div>
                          <h5 className="card-title mb-0">{t('work_centers')}</h5>
                          <p className="text-muted small mb-0 mt-1">Define factory stations and machines.</p>
                      </div>
                      {onRefresh && <button className="btn btn-sm btn-outline-secondary" onClick={onRefresh}><i className="bi bi-arrow-clockwise"></i></button>}
                  </div>
                  <div className="card-body">
                      <form onSubmit={handleCreateWC} className="mb-3 p-3 bg-light rounded border">
                          <div className="row g-2 align-items-end">
                              <div className="col-4">
                                  <label className="form-label small">{t('item_code')}</label>
                                  <input className="form-control form-control-sm" placeholder="WC-01" value={newWorkCenter.code} onChange={e => setNewWorkCenter({ ...newWorkCenter, code: e.target.value })} required />
                              </div>
                              <div className="col-5">
                                  <label className="form-label small">{t('station_name')}</label>
                                  <input className="form-control form-control-sm" placeholder="Assembly Line 1" value={newWorkCenter.name} onChange={e => setNewWorkCenter({ ...newWorkCenter, name: e.target.value })} required />
                              </div>
                              <div className="col-3">
                                  <button type="submit" className="btn btn-sm btn-primary w-100">{t('add')}</button>
                              </div>
                          </div>
                      </form>
                      <div className="input-group input-group-sm mb-2">
                          <span className="input-group-text"><i className="bi bi-search"></i></span>
                          <input className="form-control" placeholder="Search work centers..." value={wcSearch} onChange={e => setWcSearch(e.target.value)} />
                      </div>
                      <div className="table-responsive">
                          <table className="table table-hover align-middle mb-0">
                              <thead className="table-light">
                                  <tr>
                                      <th>{t('item_code')}</th>
                                      <th>{t('station_name')}</th>
                                      <th style={{ width: '50px' }}></th>
                                  </tr>
                              </thead>
                              <tbody>
                                  {filteredWC.map((wc: any) => (
                                      <tr key={wc.id}>
                                          <td className="fw-bold font-monospace text-primary small">{wc.code}</td>
                                          <td>{wc.name}</td>
                                          <td>
                                              <button className="btn btn-sm text-danger" onClick={() => onDeleteWorkCenter && onDeleteWorkCenter(wc.id)}>
                                                  <i className="bi bi-trash"></i>
                                              </button>
                                          </td>
                                      </tr>
                                  ))}
                                  {filteredWC.length === 0 && <tr><td colSpan={3} className="text-center py-3 text-muted small">No work centers defined</td></tr>}
                              </tbody>
                          </table>
                      </div>
                  </div>
              </div>
          </div>

          {/* Operations */}
          <div className="col-md-6">
              <div className="card h-100 shadow-sm border-0">
                  <div className="card-header bg-white">
                      <h5 className="card-title mb-0">{t('standard_operations')}</h5>
                      <p className="text-muted small mb-0 mt-1">Define reusable process steps like "Cutting", "Welding".</p>
                  </div>
                  <div className="card-body">
                      <form onSubmit={handleCreateOp} className="mb-3 p-3 bg-light rounded border">
                          <div className="row g-2 align-items-end">
                              <div className="col-4">
                                  <label className="form-label small">{t('item_code')}</label>
                                  <input className="form-control form-control-sm" placeholder="OP-10" value={newOperation.code} onChange={e => setNewOperation({ ...newOperation, code: e.target.value })} required />
                              </div>
                              <div className="col-5">
                                  <label className="form-label small">{t('operation_name')}</label>
                                  <input className="form-control form-control-sm" placeholder="Cutting" value={newOperation.name} onChange={e => setNewOperation({ ...newOperation, name: e.target.value })} required />
                              </div>
                              <div className="col-3">
                                  <button type="submit" className="btn btn-sm btn-success w-100">{t('add')}</button>
                              </div>
                          </div>
                      </form>
                      <div className="input-group input-group-sm mb-2">
                          <span className="input-group-text"><i className="bi bi-search"></i></span>
                          <input className="form-control" placeholder="Search operations..." value={opSearch} onChange={e => setOpSearch(e.target.value)} />
                      </div>
                      <div className="table-responsive">
                          <table className="table table-hover align-middle mb-0">
                              <thead className="table-light">
                                  <tr>
                                      <th>{t('item_code')}</th>
                                      <th>{t('operation_name')}</th>
                                      <th style={{ width: '50px' }}></th>
                                  </tr>
                              </thead>
                              <tbody>
                                  {filteredOp.map((op: any) => (
                                      <tr key={op.id}>
                                          <td className="fw-bold font-monospace text-success small">{op.code}</td>
                                          <td>{op.name}</td>
                                          <td>
                                              <button className="btn btn-sm text-danger" onClick={() => onDeleteOperation && onDeleteOperation(op.id)}>
                                                  <i className="bi bi-trash"></i>
                                              </button>
                                          </td>
                                      </tr>
                                  ))}
                                  {filteredOp.length === 0 && <tr><td colSpan={3} className="text-center py-3 text-muted small">No operations defined</td></tr>}
                              </tbody>
                          </table>
                      </div>
                  </div>
              </div>
          </div>
      </div>
  );
}
