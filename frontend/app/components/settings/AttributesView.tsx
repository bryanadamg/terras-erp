import { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';

export default function AttributesView({
    attributes,
    onCreateAttribute,
    onUpdateAttribute,
    onDeleteAttribute,
    onAddValue,
    onUpdateValue,
    onDeleteValue
}: any) {
  const { t } = useLanguage();
  const [newAttribute, setNewAttribute] = useState({ name: '', values: [] as any[] });
  const [newAttributeValue, setNewAttributeValue] = useState('');
  const [editingAttr, setEditingAttr] = useState<any>(null);
  const [newValueForEdit, setNewValueForEdit] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const { uiStyle: currentStyle } = useTheme();
  const classic = currentStyle === 'classic';
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const activeAttribute = editingAttr ? attributes.find((a: any) => a.id === editingAttr.id) : null;

  const getNextValue = (currentValues: any[]) => {
      const numbers = currentValues.map(v => parseInt(v.value)).filter(n => !isNaN(n));
      return numbers.length > 0 ? Math.max(...numbers) + 1 : null;
  };

  const nextValForNew = getNextValue(newAttribute.values);
  const nextValForEdit = activeAttribute ? getNextValue(activeAttribute.values) : null;

  const handleAddValueToNewAttribute = () => {
      if (!newAttributeValue) return;
      setNewAttribute({ ...newAttribute, values: [...newAttribute.values, { value: newAttributeValue }] });
      setNewAttributeValue('');
  };

  const handleAddNextToNew = () => {
      if (nextValForNew !== null) {
          setNewAttribute({ ...newAttribute, values: [...newAttribute.values, { value: String(nextValForNew) }] });
      }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      onCreateAttribute(newAttribute);
      setNewAttribute({ name: '', values: [] });
  };

  const startEditing = (attr: any) => setEditingAttr({ ...attr });
  const cancelEditing = () => { setEditingAttr(null); setNewValueForEdit(''); };

  const handleUpdateName = () => {
      if (editingAttr && editingAttr.name) onUpdateAttribute(editingAttr.id, editingAttr.name);
  };

  const handleAddValueToExisting = () => {
      if (editingAttr && newValueForEdit) {
          onAddValue(editingAttr.id, newValueForEdit);
          setNewValueForEdit('');
      }
  };

  const handleAddNextToExisting = () => {
      if (editingAttr && nextValForEdit !== null) onAddValue(editingAttr.id, String(nextValForEdit));
  };

  const filteredAttrs = (attributes || []).filter((a: any) =>
      a.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ── XP shared inline styles ──────────────────────────────────────────────
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
  const xpTitleBarEdit: React.CSSProperties = {
      background: 'linear-gradient(to right, #6a3a8e 0%, #a06ac8 100%)', color: '#ffffff',
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '12px', fontWeight: 'bold',
      padding: '4px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
      borderBottom: '1px solid #3d1a5e', display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', minHeight: '26px',
  };
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
  const xpLabel: React.CSSProperties = {
      fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2,
  };

  if (classic) {
      return (
          <div className="row g-3 fade-in">
              {/* ── Left panel: Create / Edit ── */}
              <div className="col-md-5">
                  <div style={{ ...xpBevel, height: '100%' }}>
                      <div style={activeAttribute ? xpTitleBarEdit : xpTitleBar()}>
                          <span>
                              {activeAttribute
                                  ? <><i className="bi bi-pencil-square" style={{ marginRight: 6 }}></i>Edit: {activeAttribute.name}</>
                                  : <><i className="bi bi-plus-circle" style={{ marginRight: 6 }}></i>Create Attribute</>
                              }
                          </span>
                          {activeAttribute && (
                              <button
                                  style={xpBtn({ padding: '1px 8px', fontSize: '10px' })}
                                  onClick={cancelEditing}
                              >
                                  Cancel
                              </button>
                          )}
                      </div>

                      <div style={{ padding: '8px', background: '#f5f4ef' }}>
                          {activeAttribute ? (
                              // ── EDIT MODE ──
                              <div>
                                  <label style={xpLabel}>Attribute Name</label>
                                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                                      <input
                                          style={{ ...xpInput, flex: 1 }}
                                          value={editingAttr.name}
                                          onChange={e => setEditingAttr({ ...editingAttr, name: e.target.value })}
                                      />
                                      <button style={xpBtn({ background: 'linear-gradient(to bottom,#316ac5,#1a4a8a)', borderColor:'#1a3a7a #0a2a5a #0a2a5a #1a3a7a', color:'#ffffff' })} onClick={handleUpdateName}>Save</button>
                                  </div>

                                  <label style={xpLabel}>Values ({activeAttribute.values.length})</label>
                                  <div style={{ background: '#ffffff', border: '1px solid #7f9db9', maxHeight: 200, overflowY: 'auto', marginBottom: 6 }}>
                                      {activeAttribute.values.map((val: any, i: number) => (
                                          <div key={val.id} style={{
                                              display: 'flex', alignItems: 'center',
                                              padding: '2px 4px',
                                              background: i % 2 === 0 ? '#ffffff' : '#f5f3ee',
                                              borderBottom: '1px solid #e0dfd8',
                                          }}>
                                              <input
                                                  style={{ ...xpInput, flex: 1, border: 'none', boxShadow: 'none', height: '18px', background: 'transparent' }}
                                                  defaultValue={val.value}
                                                  onBlur={e => { if (e.target.value !== val.value) onUpdateValue(val.id, e.target.value); }}
                                              />
                                              <button
                                                  style={{ ...xpBtn(), border: hoveredId === val.id ? '1px solid #808080' : '1px solid transparent', background: hoveredId === val.id ? 'linear-gradient(to bottom,#ffffff,#d4d0c8)' : 'transparent', padding: '0 4px' }}
                                                  onMouseEnter={() => setHoveredId(val.id)}
                                                  onMouseLeave={() => setHoveredId(null)}
                                                  onClick={() => onDeleteValue(val.id)}
                                              >
                                                  <i className="bi bi-x" style={{ color: '#c00000', fontSize: '11px' }}></i>
                                              </button>
                                          </div>
                                      ))}
                                      {activeAttribute.values.length === 0 && (
                                          <div style={{ padding: '8px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666', textAlign: 'center' }}>No values yet</div>
                                      )}
                                  </div>

                                  <div style={{ display: 'flex', gap: 4 }}>
                                      <input
                                          style={{ ...xpInput, flex: 1 }}
                                          placeholder="Add value..."
                                          value={newValueForEdit}
                                          onChange={e => setNewValueForEdit(e.target.value)}
                                          onKeyDown={e => e.key === 'Enter' && handleAddValueToExisting()}
                                      />
                                      <button style={xpBtn()} onClick={handleAddValueToExisting}>{t('add')}</button>
                                      {nextValForEdit !== null && (
                                          <button style={xpBtn({ background: 'linear-gradient(to bottom,#d4ead4,#a0c8a0)', borderColor:'#2e7d32 #1a5e1a #1a5e1a #2e7d32' })} onClick={handleAddNextToExisting}>+{nextValForEdit}</button>
                                      )}
                                  </div>
                              </div>
                          ) : (
                              // ── CREATE MODE ──
                              <form onSubmit={handleCreateSubmit}>
                                  <label style={xpLabel}>Name</label>
                                  <input
                                      style={{ ...xpInput, width: '100%', marginBottom: 8 }}
                                      placeholder="e.g. Size, Color"
                                      value={newAttribute.name}
                                      onChange={e => setNewAttribute({ ...newAttribute, name: e.target.value })}
                                      required
                                  />

                                  <label style={xpLabel}>Initial Values</label>
                                  <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                                      <input
                                          style={{ ...xpInput, flex: 1 }}
                                          placeholder="Value (e.g. S, M, L)"
                                          value={newAttributeValue}
                                          onChange={e => setNewAttributeValue(e.target.value)}
                                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddValueToNewAttribute(); } }}
                                      />
                                      <button type="button" style={xpBtn()} onClick={handleAddValueToNewAttribute}>{t('add')}</button>
                                      {nextValForNew !== null && (
                                          <button type="button" style={xpBtn({ background: 'linear-gradient(to bottom,#d4ead4,#a0c8a0)', borderColor:'#2e7d32 #1a5e1a #1a5e1a #2e7d32' })} onClick={handleAddNextToNew}>+{nextValForNew}</button>
                                      )}
                                  </div>

                                  {/* Value chips */}
                                  <div style={{ background: '#ffffff', border: '1px solid #7f9db9', minHeight: 32, padding: '4px 6px', display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                                      {newAttribute.values.map((v, i) => (
                                          <span key={i} style={{ background: '#dde8f5', border: '1px solid #7f9db9', padding: '1px 6px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000' }}>{v.value}</span>
                                      ))}
                                      {newAttribute.values.length === 0 && <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#888', fontStyle: 'italic' }}>No values added</span>}
                                  </div>

                                  <button
                                      type="submit"
                                      style={{ ...xpBtn({ background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)', borderColor:'#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color:'#ffffff', fontWeight:'bold' }), width: '100%', padding: '4px 10px' }}
                                  >
                                      <i className="bi bi-plus-circle" style={{ marginRight: 6 }}></i>Create Attribute
                                  </button>
                              </form>
                          )}
                      </div>
                  </div>
              </div>

              {/* ── Right panel: List ── */}
              <div className="col-md-7">
                  <div style={{ ...xpBevel, height: '100%' }}>
                      <div style={xpTitleBar()}>
                          <span><i className="bi bi-collection-fill" style={{ marginRight: 6 }}></i>Attribute Templates</span>
                      </div>
                      <div style={xpToolbar}>
                          <i className="bi bi-search" style={{ fontSize: '11px', color: '#666' }}></i>
                          <input
                              style={{ ...xpInput, width: 200 }}
                              placeholder="Search attributes..."
                              value={searchTerm}
                              onChange={e => setSearchTerm(e.target.value)}
                          />
                          <div style={xpSep} />
                          <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>
                              {filteredAttrs.length} attribute{filteredAttrs.length === 1 ? '' : 's'}
                          </span>
                      </div>
                      <div style={{ background: '#ffffff', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
                          {filteredAttrs.map((attr: any, i: number) => {
                              const isActive = activeAttribute?.id === attr.id;
                              return (
                                  <div
                                      key={attr.id}
                                      onClick={() => startEditing(attr)}
                                      style={{
                                          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                                          padding: '5px 8px', cursor: 'pointer',
                                          background: isActive ? '#316ac5' : (i % 2 === 0 ? '#ffffff' : '#f5f3ee'),
                                          borderBottom: '1px solid #c0bdb5',
                                          borderLeft: isActive ? '3px solid #08a5ff' : '3px solid transparent',
                                      }}
                                  >
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                              <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', fontWeight: 'bold', color: isActive ? '#ffffff' : '#000' }}>
                                                  {attr.name}
                                              </span>
                                              <span style={{ background: isActive ? 'rgba(255,255,255,0.2)' : '#e0dfd8', border: `1px solid ${isActive ? 'rgba(255,255,255,0.4)' : '#b0a898'}`, padding: '0 4px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: isActive ? '#ffffff' : '#555' }}>
                                                  {attr.values.length}
                                              </span>
                                          </div>
                                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                              {attr.values.slice(0, 8).map((v: any) => (
                                                  <span key={v.id} style={{ background: isActive ? 'rgba(255,255,255,0.15)' : '#dde8f5', border: `1px solid ${isActive ? 'rgba(255,255,255,0.35)' : '#7f9db9'}`, padding: '0 4px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: isActive ? '#ffffff' : '#333' }}>
                                                      {v.value}
                                                  </span>
                                              ))}
                                              {attr.values.length > 8 && (
                                                  <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '10px', color: isActive ? 'rgba(255,255,255,0.7)' : '#888' }}>…</span>
                                              )}
                                          </div>
                                      </div>
                                      <button
                                          onClick={e => { e.stopPropagation(); onDeleteAttribute(attr.id); }}
                                          style={{
                                              ...xpBtn(),
                                              border: hoveredId === `del-${attr.id}` ? '1px solid #808080' : '1px solid transparent',
                                              background: hoveredId === `del-${attr.id}` ? 'linear-gradient(to bottom,#ffffff,#d4d0c8)' : 'transparent',
                                              padding: '1px 6px', marginLeft: 6, flexShrink: 0,
                                          }}
                                          onMouseEnter={() => setHoveredId(`del-${attr.id}`)}
                                          onMouseLeave={() => setHoveredId(null)}
                                          title="Delete"
                                      >
                                          <i className="bi bi-trash" style={{ color: isActive ? '#ffcccc' : '#c00000', fontSize: '11px' }}></i>
                                      </button>
                                  </div>
                              );
                          })}
                          {filteredAttrs.length === 0 && (
                              <div style={{ textAlign: 'center', padding: '20px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666' }}>
                                  No attribute templates defined
                              </div>
                          )}
                      </div>
                      <div style={{
                          background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898',
                          padding: '2px 8px', display: 'flex', gap: 16,
                          fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#333',
                      }}>
                          <span><b>{(attributes || []).length}</b> Total</span>
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  // ── Modern (Bootstrap) mode ──────────────────────────────────────────────
  return (
      <div className="row g-4 fade-in">
          {/* Left Column: Create / Edit */}
          <div className="col-md-5">
              <div className={`card h-100 shadow-sm border-0 ${activeAttribute ? 'border-primary border-2' : ''}`}>
                  <div className={`card-header ${activeAttribute ? 'bg-primary bg-opacity-10 text-primary-emphasis' : 'bg-success bg-opacity-10 text-success-emphasis'}`}>
                      <h5 className="card-title mb-0">
                          {activeAttribute ? (
                              <span><i className="bi bi-pencil-square me-2"></i>{t('edit')} Template</span>
                          ) : (
                              <span><i className="bi bi-plus-circle me-2"></i>{t('create')} Template</span>
                          )}
                      </h5>
                  </div>
                  <div className="card-body">
                      {activeAttribute ? (
                          <div>
                              <div className="d-flex justify-content-between align-items-center mb-3">
                                  <span className="badge bg-primary text-white">{activeAttribute.name}</span>
                                  <button className="btn btn-sm btn-outline-secondary" onClick={cancelEditing}>{t('cancel')}</button>
                              </div>
                              <div className="mb-3">
                                  <label className="form-label small">Template Name</label>
                                  <div className="input-group">
                                      <input className="form-control" value={editingAttr.name} onChange={e => setEditingAttr({ ...editingAttr, name: e.target.value })} />
                                      <button className="btn btn-outline-primary" onClick={handleUpdateName}>{t('save')}</button>
                                  </div>
                              </div>
                              <label className="form-label small">Values</label>
                              <div className="list-group mb-3" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                  {activeAttribute.values.map((val: any) => (
                                      <div key={val.id} className="list-group-item d-flex justify-content-between align-items-center p-2">
                                          <input className="form-control form-control-sm border-0 bg-transparent" defaultValue={val.value}
                                              onBlur={e => { if (e.target.value !== val.value) onUpdateValue(val.id, e.target.value); }} />
                                          <button className="btn btn-sm text-danger" onClick={() => onDeleteValue(val.id)}>
                                              <i className="bi bi-trash"></i>
                                          </button>
                                      </div>
                                  ))}
                              </div>
                              <div className="input-group input-group-sm">
                                  <input className="form-control" placeholder="Add new value..." value={newValueForEdit} onChange={e => setNewValueForEdit(e.target.value)} />
                                  <button className="btn btn-secondary" onClick={handleAddValueToExisting}>{t('add')}</button>
                                  {nextValForEdit !== null && (
                                      <button className="btn btn-outline-success" onClick={handleAddNextToExisting}>+ {nextValForEdit}</button>
                                  )}
                              </div>
                          </div>
                      ) : (
                          <form onSubmit={handleCreateSubmit}>
                              <div className="mb-3">
                                  <label className="form-label small text-muted">Name</label>
                                  <input className="form-control" placeholder="e.g. Size, Color" value={newAttribute.name} onChange={e => setNewAttribute({ ...newAttribute, name: e.target.value })} required />
                              </div>
                              <div className="mb-3">
                                  <label className="form-label small text-muted">Initial Values</label>
                                  <div className="input-group mb-2">
                                      <input className="form-control" placeholder="Value (e.g. S, M, L)" value={newAttributeValue} onChange={e => setNewAttributeValue(e.target.value)} />
                                      <button type="button" className="btn btn-secondary" onClick={handleAddValueToNewAttribute}>{t('add')}</button>
                                      {nextValForNew !== null && (
                                          <button type="button" className="btn btn-outline-success" onClick={handleAddNextToNew}>+ {nextValForNew}</button>
                                      )}
                                  </div>
                                  <div className="d-flex flex-wrap gap-2 p-2 border rounded bg-light min-h-50">
                                      {newAttribute.values.map((v, i) => (
                                          <span key={i} className="badge bg-white text-dark border shadow-sm">{v.value}</span>
                                      ))}
                                      {newAttribute.values.length === 0 && <small className="text-muted fst-italic">No values added</small>}
                                  </div>
                              </div>
                              <button type="submit" className="btn btn-success w-100 fw-bold shadow-sm">{t('create')}</button>
                          </form>
                      )}
                  </div>
              </div>
          </div>

          {/* Right Column: List */}
          <div className="col-md-7">
              <div className="card h-100 shadow-sm border-0">
                  <div className="card-header bg-white d-flex justify-content-between align-items-center">
                      <h5 className="card-title mb-0">{t('attributes')}</h5>
                      <div className="input-group" style={{ width: 220 }}>
                          <span className="input-group-text"><i className="bi bi-search"></i></span>
                          <input className="form-control form-control-sm" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                      </div>
                  </div>
                  <div className="card-body p-0" style={{ maxHeight: 'calc(100vh - 150px)', overflowY: 'auto' }}>
                      <div className="list-group list-group-flush">
                          {filteredAttrs.map((attr: any) => (
                              <div
                                  key={attr.id}
                                  className={`list-group-item list-group-item-action d-flex justify-content-between align-items-start p-3 ${activeAttribute?.id === attr.id ? 'active' : ''}`}
                                  onClick={() => startEditing(attr)}
                                  style={{ cursor: 'pointer' }}
                              >
                                  <div className="flex-grow-1 me-3">
                                      <div className="d-flex justify-content-between mb-1">
                                          <h6 className="mb-0 fw-bold">{attr.name}</h6>
                                          <span className={`badge ${activeAttribute?.id === attr.id ? 'bg-light text-primary' : 'bg-light text-dark border'}`}>{attr.values.length}</span>
                                      </div>
                                      <div className="d-flex flex-wrap gap-1">
                                          {attr.values.slice(0, 8).map((v: any) => (
                                              <span key={v.id} className={`badge small ${activeAttribute?.id === attr.id ? 'bg-primary border border-white' : 'bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-10'}`}>{v.value}</span>
                                          ))}
                                          {attr.values.length > 8 && <span className="badge text-muted">...</span>}
                                      </div>
                                  </div>
                                  <div className="d-flex flex-column gap-2" onClick={e => e.stopPropagation()}>
                                      <button className="btn btn-sm btn-link text-danger p-0" title={t('delete')} onClick={() => onDeleteAttribute(attr.id)}>
                                          <i className="bi bi-trash fs-6"></i>
                                      </button>
                                  </div>
                              </div>
                          ))}
                          {filteredAttrs.length === 0 && <div className="text-center text-muted py-5">No templates defined yet.</div>}
                      </div>
                  </div>
              </div>
          </div>
      </div>
  );
}
