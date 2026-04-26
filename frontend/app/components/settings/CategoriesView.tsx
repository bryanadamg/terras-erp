import { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';

export default function CategoriesView({ categories, onCreateCategory, onDeleteCategory }: any) {
  const { t } = useLanguage();
  const [newCategoryName, setNewCategoryName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const { uiStyle: currentStyle } = useTheme();
  const classic = currentStyle === 'classic';
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const xpBevel: React.CSSProperties = {
      border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
      boxShadow: '2px 2px 4px rgba(0,0,0,0.3)', background: '#ece9d8', borderRadius: 0,
  };
  const xpTitleBar: React.CSSProperties = {
      background: 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)', color: '#ffffff',
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '12px', fontWeight: 'bold',
      padding: '4px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
      borderBottom: '1px solid #003080', display: 'flex', justifyContent: 'space-between',
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

  const handleCreate = (e: React.FormEvent) => {
      e.preventDefault();
      if (newCategoryName.trim()) {
          onCreateCategory(newCategoryName.trim());
          setNewCategoryName('');
      }
  };

  const filtered = (categories || []).filter((c: any) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (classic) {
      return (
          <div className="row justify-content-center fade-in">
              <div className="col-md-8">
                  <div style={xpBevel}>
                      <div style={xpTitleBar}>
                          <span><i className="bi bi-tag-fill" style={{ marginRight: 6 }}></i>Categories</span>
                      </div>
                      {/* Create row */}
                      <form onSubmit={handleCreate}>
                          <div style={{ ...xpToolbar, borderBottom: '1px solid #b0a898' }}>
                              <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000', whiteSpace: 'nowrap' }}>New category:</span>
                              <input
                                  style={{ ...xpInput, flex: 1, minWidth: 120 }}
                                  placeholder="e.g. Spare Parts, Raw Materials..."
                                  value={newCategoryName}
                                  onChange={e => setNewCategoryName(e.target.value)}
                              />
                              <button
                                  type="submit"
                                  style={xpBtn({ background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', fontWeight: 'bold' })}
                              >
                                  <i className="bi bi-plus-lg" style={{ marginRight: 4 }}></i>Add
                              </button>
                          </div>
                      </form>
                      {/* Search toolbar */}
                      <div style={xpToolbar}>
                          <i className="bi bi-search" style={{ fontSize: '11px', color: '#666' }}></i>
                          <input
                              style={{ ...xpInput, width: 200 }}
                              placeholder="Search categories..."
                              value={searchTerm}
                              onChange={e => setSearchTerm(e.target.value)}
                          />
                          <div style={xpSep} />
                          <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#444' }}>
                              {filtered.length} categor{filtered.length === 1 ? 'y' : 'ies'}
                          </span>
                      </div>
                      {/* List */}
                      <div style={{ background: '#ffffff', maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
                          {filtered.map((cat: any, i: number) => (
                              <div key={cat.id} style={{
                                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                  padding: '4px 8px',
                                  background: i % 2 === 0 ? '#ffffff' : '#f5f3ee',
                                  borderBottom: '1px solid #c0bdb5',
                              }}>
                                  <span style={{ fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#000' }}>{cat.name}</span>
                                  <button
                                      style={{
                                          ...xpBtn(),
                                          border: hoveredId === cat.id ? '1px solid #808080' : '1px solid transparent',
                                          background: hoveredId === cat.id ? 'linear-gradient(to bottom,#ffffff,#d4d0c8)' : 'transparent',
                                          padding: '1px 6px',
                                      }}
                                      onMouseEnter={() => setHoveredId(cat.id)}
                                      onMouseLeave={() => setHoveredId(null)}
                                      onClick={() => onDeleteCategory(cat.id)}
                                      title="Delete"
                                  >
                                      <i className="bi bi-trash" style={{ color: '#c00000', fontSize: '11px' }}></i>
                                  </button>
                              </div>
                          ))}
                          {filtered.length === 0 && (
                              <div style={{ textAlign: 'center', padding: '20px', fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#666' }}>
                                  No categories found
                              </div>
                          )}
                      </div>
                      {/* Status bar */}
                      <div style={{
                          background: 'linear-gradient(to bottom, #e8e6df, #d5d3cc)', borderTop: '1px solid #b0a898',
                          padding: '2px 8px', display: 'flex', gap: 16,
                          fontFamily: 'Tahoma,Arial,sans-serif', fontSize: '11px', color: '#333',
                      }}>
                          <span><b>{(categories || []).length}</b> Total</span>
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  return (
      <div className="row justify-content-center fade-in">
          <div className="col-md-8">
              <div className="card shadow-sm border-0">
                  <div className="card-header bg-white">
                      <h5 className="card-title mb-0">{t('categories')}</h5>
                      <p className="text-muted small mb-0 mt-1">Classify your inventory items for better organization and filtering.</p>
                  </div>
                  <div className="card-body">
                      <form onSubmit={handleCreate} className="mb-3">
                          <div className="input-group">
                              <input className="form-control" placeholder="e.g. Spare Parts, Raw Materials..." value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} required />
                              <button type="submit" className="btn btn-success px-4">{t('add')}</button>
                          </div>
                      </form>
                      <div className="input-group mb-3">
                          <span className="input-group-text"><i className="bi bi-search"></i></span>
                          <input className="form-control" placeholder="Search categories..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                      </div>
                      <div className="list-group list-group-flush border rounded">
                          {filtered.map((cat: any) => (
                              <div key={cat.id} className="list-group-item d-flex justify-content-between align-items-center">
                                  <span className="fw-medium">{cat.name}</span>
                                  <button className="btn btn-sm text-danger" onClick={() => onDeleteCategory(cat.id)}>
                                      <i className="bi bi-trash me-1"></i> {t('delete')}
                                  </button>
                              </div>
                          ))}
                          {filtered.length === 0 && (
                              <div className="list-group-item text-center text-muted py-4 fst-italic">No categories found</div>
                          )}
                      </div>
                  </div>
              </div>
          </div>
      </div>
  );
}
